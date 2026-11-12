/**
 * The model gateway: the only route to the model.
 *
 * - Holds the real model key. The engine's container holds a project token instead.
 * - Forwards only the two paths the engine needs; every other path is refused and logged.
 * - Records every metered call as a `model.call` event with tokens and cost, including calls
 *   that were cancelled or failed part-way, marked incomplete.
 * - Refuses a call when the project's spend, plus what is already in flight, plus the estimate
 *   for this call, would exceed the cap. The check-and-reserve is serialised per project so
 *   parallel calls cannot slip past it. The estimate is the dearest of the last three calls,
 *   which a growing call can exceed (docs/KNOWN-GAPS.md).
 * - Refuses models that are not in the price table, so no call can go unmetered.
 *
 * Design note: docs/design/stage-1.md, sections 2.4, 5.4 and 5.5.
 */
import { Hono } from "hono";
import type pg from "pg";
import { appendEvent } from "../store/events.js";
import { getSpend, projectForToken, recentCallCostEstimate, type Project } from "../store/projects.js";
import { costUsd, emptyUsage, mergeUsage, type ProviderUsage, type Usage } from "./cost.js";
import { PRICES } from "./prices.js";

export interface GatewayOptions {
  pool: pg.Pool;
  /** The real model key. Never logged, never returned. */
  modelApiKey: string;
  /** Where to forward. Default: Anthropic. Tests point this at a stand-in. */
  upstreamUrl?: string;
  /** Models this gateway may forward. Default: every model in the price table. Must be a subset of it. */
  allowedModels?: string[];
  fetchImpl?: typeof fetch;
  /** Called when something that should never happen happens (for example the event log is unreachable). */
  onFault?: (message: string, detail: unknown) => void;
}

/** The only paths forwarded. Everything else under /v1 is refused. */
const METERED_PATH = "/v1/messages";
const PASSTHROUGH_PATHS = new Set(["/v1/messages/count_tokens"]);

const STRIP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "x-api-key", "authorization"]);

type ErrorBody = { type: "error"; error: { type: string; message: string } };
const errorBody = (type: string, message: string): ErrorBody => ({ type: "error", error: { type, message } });

/** In-flight reservations and a per-project queue, so check-and-reserve never runs twice at once. */
class Reservations {
  private pending = new Map<string, number>();
  private inFlight = new Map<string, number>();
  private idleWaiters = new Map<string, Array<() => void>>();
  private queues = new Map<string, Promise<unknown>>();

  async serialised<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(projectId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(projectId, next.catch(() => undefined));
    return next;
  }
  pendingFor(projectId: string): number {
    return this.pending.get(projectId) ?? 0;
  }
  inFlightFor(projectId: string): number {
    return this.inFlight.get(projectId) ?? 0;
  }
  /** Resolves once the project has no call in flight. Used when there is no history to estimate from. */
  whenIdle(projectId: string): Promise<void> {
    if (this.inFlightFor(projectId) === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const list = this.idleWaiters.get(projectId) ?? [];
      list.push(resolve);
      this.idleWaiters.set(projectId, list);
    });
  }
  reserve(projectId: string, amount: number) {
    this.pending.set(projectId, this.pendingFor(projectId) + amount);
    this.inFlight.set(projectId, this.inFlightFor(projectId) + 1);
  }
  release(projectId: string, amount: number) {
    const left = this.pendingFor(projectId) - amount;
    if (left <= 1e-12) this.pending.delete(projectId);
    else this.pending.set(projectId, left);
    const n = this.inFlightFor(projectId) - 1;
    if (n <= 0) {
      this.inFlight.delete(projectId);
      for (const w of this.idleWaiters.get(projectId) ?? []) w();
      this.idleWaiters.delete(projectId);
    } else this.inFlight.set(projectId, n);
  }
}

export function createGateway(opts: GatewayOptions) {
  const upstream = (opts.upstreamUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const allowed = new Set(opts.allowedModels ?? Object.keys(PRICES));
  for (const m of allowed) if (!PRICES[m]) throw new Error(`Model "${m}" has no price in the price table and cannot be allowed.`);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const fault = opts.onFault ?? ((m: string, d: unknown) => console.error(`[gateway fault] ${m}`, d));
  const reservations = new Reservations();
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.all("/v1/*", async (c) => {
    const token = c.req.header("x-api-key") ?? bearer(c.req.header("authorization"));
    if (!token) return c.json(errorBody("authentication_error", "No project token was sent. The engine must send its project token as the API key."), 401);
    const project: Project | null = await projectForToken(opts.pool, token);
    if (!project) return c.json(errorBody("authentication_error", "This project token is not recognised or has been revoked."), 401);

    const step = c.req.header("x-builder-step") ?? null;
    const url = new URL(c.req.url);
    const path = normalisePath(url.pathname);
    const metered = path === METERED_PATH;
    const passthrough = PASSTHROUGH_PATHS.has(path);

    if (!metered && !passthrough) {
      await appendEvent(opts.pool, project.id, "gateway.refused", { reason: "path_not_allowed", path: url.pathname }, step);
      return c.json(errorBody("invalid_request_error", `The gateway forwards only ${METERED_PATH} and ${[...PASSTHROUGH_PATHS].join(", ")}. "${url.pathname}" is not forwarded.`), 403);
    }
    if (c.req.method !== "POST") {
      await appendEvent(opts.pool, project.id, "gateway.refused", { reason: "method_not_allowed", method: c.req.method, path }, step);
      return c.json(errorBody("invalid_request_error", "Only POST requests are forwarded."), 405);
    }

    const rawBody = await c.req.text();
    let body: { model?: string; stream?: boolean } = {};
    try {
      body = rawBody ? (JSON.parse(rawBody) as typeof body) : {};
    } catch {
      return c.json(errorBody("invalid_request_error", "The request body is not valid JSON."), 400);
    }
    const requestedModel = body.model ?? "";
    if (!allowed.has(requestedModel)) {
      await appendEvent(opts.pool, project.id, "gateway.refused", { reason: "model_not_allowed", model: requestedModel, path }, step);
      return c.json(errorBody("invalid_request_error", `The model "${requestedModel}" is not one the gateway may forward.`), 400);
    }

    const headers = new Headers();
    c.req.raw.headers.forEach((v, k) => {
      const key = k.toLowerCase();
      if (!STRIP.has(key) && !key.startsWith("x-builder-")) headers.set(k, v);
    });
    headers.set("x-api-key", opts.modelApiKey);
    const forward = () => fetchImpl(upstream + path + url.search, { method: "POST", headers, body: rawBody, redirect: "manual" });

    if (passthrough) {
      let res: Response;
      try {
        res = await forward();
      } catch (err) {
        await appendEvent(opts.pool, project.id, "gateway.error", { path, error: errorSummary(err) }, step);
        return c.json(errorBody("api_error", "The gateway could not reach the model provider."), 502);
      }
      await appendEvent(opts.pool, project.id, "gateway.passthrough", { path, status: res.status }, step);
      return relay(res);
    }

    // Metered: check and reserve under the project's lock, then forward outside it.
    const stream = body.stream === true;
    const started = Date.now();
    const decision = await reservations.serialised(project.id, async () => {
      // With no completed call to estimate from, let one call finish before admitting another.
      if ((await recentCallCostEstimate(opts.pool, project.id)) === 0) await reservations.whenIdle(project.id);
      const spend = await getSpend(opts.pool, project.id);
      const spent = Number(spend.spent_usd);
      const cap = Number(spend.cap_usd);
      const pending = reservations.pendingFor(project.id);
      const estimate = await recentCallCostEstimate(opts.pool, project.id);
      if (spent >= cap || spent + pending + estimate > cap) {
        await appendEvent(
          opts.pool,
          project.id,
          "gateway.refused",
          { reason: "budget_reached", spent_usd: spent, in_flight_usd: pending, cap_usd: cap, next_call_estimate_usd: estimate, path },
          step,
        );
        return { ok: false as const, spent, cap, pending, estimate };
      }
      reservations.reserve(project.id, estimate);
      return { ok: true as const, estimate };
    });
    if (!decision.ok) {
      const inFlight = decision.pending > 0 ? `, with $${decision.pending.toFixed(2)} still in flight` : "";
      return c.json(
        errorBody(
          "budget_reached",
          `This project has reached its budget of $${decision.cap.toFixed(2)} (spent $${decision.spent.toFixed(2)}${inFlight}; the next call was expected to cost about $${decision.estimate.toFixed(2)}). The gateway will forward nothing more until the budget is raised.`,
        ),
        402,
      );
    }
    const reserved = decision.estimate;
    let settled = false;
    const record = async (usage: Usage, status: number, servedModel: string, extra: Record<string, unknown> = {}) => {
      if (settled) return;
      settled = true;
      const priced = PRICES[servedModel] ? servedModel : requestedModel;
      const cost = costUsd(priced, usage);
      const payload = {
        model: requestedModel,
        served_model: servedModel || null,
        priced_as: priced,
        path,
        status,
        stream,
        usage,
        cost_usd: cost ?? 0,
        price_known: cost !== null,
        duration_ms: Date.now() - started,
        ...extra,
      };
      try {
        await appendEvent(opts.pool, project.id, "model.call", payload, step);
      } catch (err) {
        fault("A model call could not be written to the event log. Its usage is lost from the meter.", { project: project.id, payload, error: errorSummary(err) });
      } finally {
        // Released only after the event is written, so a waiting call reads the spend that includes this one.
        reservations.release(project.id, reserved);
      }
    };
    // If the client goes away, stop reading from the provider and record what was used.
    const clientGone = c.req.raw.signal;

    let res: Response;
    try {
      res = await forward();
    } catch (err) {
      await record(emptyUsage(), 0, "", { incomplete: true, error: errorSummary(err) });
      return c.json(errorBody("api_error", "The gateway could not reach the model provider."), 502);
    }
    if (res.status >= 300 && res.status < 400) {
      await record(emptyUsage(), res.status, "", { incomplete: true, error: "upstream redirected; redirects are not followed" });
      return c.json(errorBody("api_error", "The model provider answered with a redirect, which the gateway does not follow."), 502);
    }
    if (!res.ok) {
      const text = await res.text();
      await record(emptyUsage(), res.status, "", { upstream_error: safeJson(text) });
      return new Response(text, { status: res.status, headers: copyHeaders(res.headers) });
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (stream && contentType.includes("text/event-stream") && res.body) {
      // Tee the stream: the client receives the bytes untouched; usage is read from the events.
      let usage = emptyUsage();
      let servedModel = "";
      let buffer = "";
      const decoder = new TextDecoder();
      const consume = (text: string) => {
        buffer += text;
        let idx: number;
        while ((idx = frameEnd(buffer)) >= 0) {
          const frame = buffer.slice(0, idx.valueOf());
          buffer = buffer.slice(idx + (buffer.startsWith("\r\n", idx) ? 4 : 2));
          const r = readFrame(frame, usage);
          usage = r.usage;
          if (r.model) servedModel = r.model;
        }
      };
      // Pull from the provider ourselves so that every ending is seen: a clean end, a provider
      // failure part-way, or the client going away. Each one records what was used.
      const reader = res.body.getReader();
      const onClientGone = () => {
        reader.cancel("client disconnected").catch(() => undefined);
        void record(usage, res.status, servedModel, { incomplete: true, error: "client disconnected" });
      };
      if (clientGone.aborted) onClientGone();
      else clientGone.addEventListener("abort", onClientGone, { once: true });
      const out = new ReadableStream<Uint8Array>({
        async pull(ctrl) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              if (buffer.trim()) consume("\n\n");
              await record(usage, res.status, servedModel);
              ctrl.close();
              return;
            }
            consume(decoder.decode(value, { stream: true }));
            ctrl.enqueue(value);
          } catch (err) {
            await record(usage, res.status, servedModel, { incomplete: true, error: errorSummary(err) });
            ctrl.error(err);
          }
        },
        async cancel(reason) {
          await reader.cancel(reason).catch(() => undefined);
          await record(usage, res.status, servedModel, { incomplete: true, error: "client cancelled" });
        },
      });
      return new Response(out, { status: res.status, headers: copyHeaders(res.headers) });
    }

    const text = await res.text();
    let usage = emptyUsage();
    let servedModel = "";
    try {
      const j = JSON.parse(text) as { usage?: ProviderUsage; model?: string };
      if (j.usage) usage = mergeUsage(usage, j.usage);
      servedModel = j.model ?? "";
    } catch {
      /* leave usage empty; recorded as such */
    }
    await record(usage, res.status, servedModel);
    return new Response(text, { status: res.status, headers: copyHeaders(res.headers) });
  });

  return app;
}

/** Decode percent-encoding and collapse trailing slashes so "/v1/%6Dessages/" is seen as "/v1/messages". */
export function normalisePath(pathname: string): string {
  let p = pathname;
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep as is; it will not match an allowed path */
  }
  return p.replace(/\/+$/, "") || "/";
}

function bearer(h: string | undefined): string | undefined {
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1];
}

function copyHeaders(h: Headers): Headers {
  const out = new Headers();
  h.forEach((v, k) => {
    const key = k.toLowerCase();
    if (!STRIP.has(key) && key !== "content-encoding") out.set(k, v);
  });
  return out;
}

function relay(res: Response): Response {
  return new Response(res.body, { status: res.status, headers: copyHeaders(res.headers) });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}

/** A fixed, header-free summary of an error: never the error's full text, which is outside our control. */
export function errorSummary(err: unknown): { name: string; code?: string } {
  const e = err as { name?: string; code?: string; cause?: { code?: string } };
  return { name: e?.name ?? "Error", code: e?.code ?? e?.cause?.code };
}

/** Index of the end of the first complete SSE frame ("\n\n" or "\r\n\r\n"), or -1. */
function frameEnd(buffer: string): number {
  const a = buffer.indexOf("\n\n");
  const b = buffer.indexOf("\r\n\r\n");
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

/** Read usage (and the served model) from one SSE frame. message_start carries input usage; message_delta carries output. */
export function readFrame(frame: string, acc: Usage): { usage: Usage; model?: string } {
  const data = frame
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .join("\n");
  if (!data) return { usage: acc };
  try {
    const ev = JSON.parse(data) as { type?: string; message?: { usage?: ProviderUsage; model?: string }; usage?: ProviderUsage };
    if (ev.type === "message_start" && ev.message) return { usage: ev.message.usage ? mergeUsage(acc, ev.message.usage) : acc, model: ev.message.model };
    if (ev.type === "message_delta" && ev.usage) return { usage: mergeUsage(acc, ev.usage) };
  } catch {
    /* not JSON; ignore */
  }
  return { usage: acc };
}

/** Kept for callers of the old name. */
export const readUsageFromFrame = (frame: string, acc: Usage): Usage => readFrame(frame, acc).usage;
