/**
 * The model gateway: the only route to the model.
 *
 * - Holds the real model key. The engine's container holds a project token instead.
 * - Forwards only the two paths the engine needs; every other path is refused and logged.
 * - Before forwarding a metered call it works out the most the call can cost (a hold) and
 *   checks the budget equation in one locked database transaction:
 *       spent + open holds + this call's hold <= cap.
 *   If it does not fit, nothing is forwarded.
 * - When the call ends with usage it can read, the hold is settled to the actual cost. Any
 *   other ending keeps the hold open at its full amount: money is never released on a guess.
 * - Refuses what a hold cannot bound: a prompt that cannot be counted, a model with no price,
 *   more output than the profile allows, routing or tools that are billed outside the token rates.
 *
 * Design note: docs/design/stage-1.md, sections 2.4 and 5.5. Build plan: package 1.2.
 */
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type pg from "pg";
import { appendEvent } from "../store/events.js";
import { expireHolds, keepHold, openHold, recoverHolds, settleHold } from "../store/holds.js";
import { projectForToken, type Project } from "../store/projects.js";
import { costUsd, emptyUsage, mergeUsage, type ProviderUsage, type Usage } from "./cost.js";
import { computeHold, countRequestBody, DEFAULT_PROFILES, guardRequest, type MeteredRequest, type ProfileLimits } from "./hold.js";
import { PRICE_TABLE_DATE, PRICES } from "./prices.js";

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
  /** What each project profile allows. Default: DEFAULT_PROFILES. */
  profiles?: Record<string, ProfileLimits>;
  /** A name for this gateway process, written on every hold it opens. Default: a random one. */
  gatewayId?: string;
  /** How long a call may run before the gateway cuts it off, in milliseconds. */
  callTimeLimitMs?: { plain: number; stream: number };
  /** Added to the time limit to give a hold its deadline, in milliseconds. */
  holdDeadlineMarginMs?: { plain: number; stream: number };
}

const MINUTE = 60_000;
const DEFAULT_TIME_LIMIT = { plain: 10 * MINUTE, stream: 60 * MINUTE };
/** Design note 5.5, step 4: ten minutes for a plain call, thirty for a streamed one. */
const DEFAULT_DEADLINE_MARGIN = { plain: 10 * MINUTE, stream: 30 * MINUTE };

/** The only paths forwarded. Everything else under /v1 is refused. */
const METERED_PATH = "/v1/messages";
const PASSTHROUGH_PATHS = new Set(["/v1/messages/count_tokens"]);

const STRIP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "x-api-key", "authorization"]);

type ErrorBody = { type: "error"; error: { type: string; message: string } };
const errorBody = (type: string, message: string): ErrorBody => ({ type: "error", error: { type, message } });

export function createGateway(opts: GatewayOptions) {
  const upstream = (opts.upstreamUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const allowed = new Set(opts.allowedModels ?? Object.keys(PRICES));
  for (const m of allowed) if (!PRICES[m]) throw new Error(`Model "${m}" has no price in the price table and cannot be allowed.`);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const fault = opts.onFault ?? ((m: string, d: unknown) => console.error(`[gateway fault] ${m}`, d));
  const profiles = opts.profiles ?? DEFAULT_PROFILES;
  const gatewayId = opts.gatewayId ?? `gw_${randomBytes(6).toString("hex")}`;
  const timeLimit = opts.callTimeLimitMs ?? DEFAULT_TIME_LIMIT;
  const deadlineMargin = opts.holdDeadlineMarginMs ?? DEFAULT_DEADLINE_MARGIN;
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
    let body: MeteredRequest = {};
    try {
      const parsed: unknown = rawBody ? JSON.parse(rawBody) : {};
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as MeteredRequest;
    } catch {
      return c.json(errorBody("invalid_request_error", "The request body is not a JSON object."), 400);
    }
    const requestedModel = typeof body.model === "string" ? body.model : "";
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
    const forward = (signal?: AbortSignal) => fetchImpl(upstream + path + url.search, { method: "POST", headers, body: rawBody, redirect: "manual", signal });

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

    // Metered. 1: refuse what a hold cannot bound.
    const stream = body.stream === true;
    const started = Date.now();
    const refuse = async (status: 400 | 402 | 502, type: string, reason: string, message: string, detail: Record<string, unknown> = {}) => {
      await appendEvent(opts.pool, project.id, "gateway.refused", { reason, path, model: requestedModel, ...detail }, step);
      return c.json(errorBody(type, message), status);
    };
    const profile = profiles[project.profile];
    if (!profile) return refuse(400, "invalid_request_error", "profile_unknown", `This project's profile "${project.profile}" has no limits set in the gateway.`, { profile: project.profile });
    const guard = guardRequest(body, profile);
    if (guard) return refuse(400, "invalid_request_error", guard.reason, guard.message, guard.detail);

    // 2: count the prompt with the provider's own counting call. No count, no call.
    let counted: number;
    try {
      const countHeaders = new Headers(headers);
      countHeaders.set("content-type", "application/json");
      const cr = await fetchImpl(upstream + "/v1/messages/count_tokens", {
        method: "POST",
        headers: countHeaders,
        body: JSON.stringify(countRequestBody(body)),
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      });
      const cj = cr.ok ? ((await cr.json()) as { input_tokens?: unknown }) : null;
      if (!cj || typeof cj.input_tokens !== "number" || !Number.isFinite(cj.input_tokens) || cj.input_tokens < 0) {
        return refuse(502, "prompt_not_counted", "prompt_not_counted", "The prompt could not be counted by the provider, so the most this call could cost is not known. The gateway did not forward it.", { count_status: cr.status });
      }
      counted = Math.ceil(cj.input_tokens);
    } catch (err) {
      return refuse(502, "prompt_not_counted", "prompt_not_counted", "The prompt could not be counted by the provider, so the most this call could cost is not known. The gateway did not forward it.", { error: errorSummary(err) });
    }

    // 3: work out the hold and check the budget equation, in one locked transaction.
    const arithmetic = computeHold(body, counted, profile, PRICE_TABLE_DATE);
    const limitMs = stream ? timeLimit.stream : timeLimit.plain;
    const deadline = new Date(started + limitMs + (stream ? deadlineMargin.stream : deadlineMargin.plain));
    const opened = await openHold(opts.pool, {
      projectId: project.id,
      step,
      amountUsd: arithmetic.hold_usd,
      deadline,
      gateway: gatewayId,
      arithmetic: { ...arithmetic },
      path,
    });
    if (!opened.ok) {
      const b = opened.budget;
      return c.json(
        errorBody(
          "budget_reached",
          `This project has reached its budget of $${b.cap.toFixed(2)} (spent $${b.spent.toFixed(2)}, with $${b.openHolds.toFixed(2)} held for work in progress or awaiting reconciliation; this call needed up to $${arithmetic.hold_usd.toFixed(2)}). The gateway will forward nothing more until the budget is raised.`,
        ),
        402,
      );
    }
    const holdId = opened.hold.id;

    // 4: forward. Exactly one ending is recorded for the hold.
    let ended = false;
    const callFields = (usage: Usage, status: number, servedModel: string, extra: Record<string, unknown> = {}) => {
      const priced = PRICES[servedModel] ? servedModel : requestedModel;
      return { priced, fields: { model: requestedModel, served_model: servedModel || null, priced_as: priced, path, status, stream, usage, duration_ms: Date.now() - started, ...extra } };
    };
    /** The call finished and its usage was read: settle the hold to the actual cost. */
    const settle = async (usage: Usage, status: number, servedModel: string, extra: Record<string, unknown> = {}) => {
      if (ended) return;
      ended = true;
      const { priced, fields } = callFields(usage, status, servedModel, extra);
      const cost = costUsd(priced, usage) ?? 0;
      try {
        const r = await settleHold(opts.pool, { projectId: project.id, holdId, step, actualUsd: cost, call: fields });
        if (r.exceeded) fault("A settled call cost more than its hold.", { project: project.id, hold: holdId, hold_usd: r.amountUsd, actual_usd: cost });
      } catch (err) {
        // The hold stays open in the database at its full amount: nothing was released.
        fault("A finished model call could not be written to the event log. Its hold stays open at its full amount.", { project: project.id, hold: holdId, error: errorSummary(err) });
      }
    };
    /** The call ended in a way that does not say what it cost: the hold stays open at its full amount. */
    const keep = async (reason: string, usage: Usage, status: number, servedModel: string, extra: Record<string, unknown> = {}) => {
      if (ended) return;
      ended = true;
      const { fields } = callFields(usage, status, servedModel, extra);
      try {
        await keepHold(opts.pool, { projectId: project.id, holdId, step, reason, seen: fields });
      } catch (err) {
        fault("A model call that ended without readable usage could not be noted in the event log. Its hold stays open at its full amount.", { project: project.id, hold: holdId, error: errorSummary(err) });
      }
    };
    const clientGone = c.req.raw.signal;
    const limit = new AbortController();
    const limitTimer = setTimeout(() => limit.abort(new Error("time limit reached")), limitMs);
    const stopTimer = () => clearTimeout(limitTimer);
    // If the caller goes away while a plain call is waiting, stop waiting for the provider too.
    // (A streamed call handles this where it reads the stream, below.)
    let callerLeft = false;
    const onCallerLeft = () => {
      callerLeft = true;
      limit.abort(new Error("caller disconnected"));
    };
    if (!stream) {
      if (clientGone.aborted) onCallerLeft();
      else clientGone.addEventListener("abort", onCallerLeft, { once: true });
    }
    const whyCut = () => (callerLeft ? "the caller disconnected before the answer arrived" : "the call reached its time limit");

    let res: Response;
    try {
      res = await forward(limit.signal);
    } catch (err) {
      stopTimer();
      await keep(limit.signal.aborted ? whyCut() : "the provider could not be reached", emptyUsage(), 0, "", { error: errorSummary(err) });
      return c.json(errorBody("api_error", limit.signal.aborted ? (callerLeft ? "The caller went away before the answer arrived." : "The call reached the gateway's time limit and was cut off.") : "The gateway could not reach the model provider."), 502);
    }
    if (res.status >= 300 && res.status < 400) {
      stopTimer();
      await keep("the provider answered with a redirect, which is not followed", emptyUsage(), res.status, "");
      return c.json(errorBody("api_error", "The model provider answered with a redirect, which the gateway does not follow."), 502);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      stopTimer();
      if (res.status >= 400 && res.status < 500) {
        // The provider rejected the request before doing any work: nothing was billed.
        await settle(emptyUsage(), res.status, "", { upstream_error: safeJson(text), rejected_before_work: true });
      } else {
        await keep("the provider answered with a server error", emptyUsage(), res.status, "", { upstream_error: safeJson(text) });
      }
      return new Response(text, { status: res.status, headers: copyHeaders(res.headers) });
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (stream && contentType.includes("text/event-stream") && res.body) {
      // Tee the stream: the client receives the bytes untouched; usage is read from the events.
      let usage = emptyUsage();
      let servedModel = "";
      let sawInput = false;
      let sawOutput = false;
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
          if (r.kind === "message_start") sawInput = true;
          if (r.kind === "message_delta") sawOutput = true;
        }
      };
      // Pull from the provider ourselves so that every ending is seen: a clean end, a provider
      // failure part-way, the time limit, or the client going away.
      const reader = res.body.getReader();
      const onClientGone = () => {
        stopTimer();
        reader.cancel("client disconnected").catch(() => undefined);
        void keep("the client disconnected part-way", usage, res.status, servedModel);
      };
      if (clientGone.aborted) onClientGone();
      else clientGone.addEventListener("abort", onClientGone, { once: true });
      limit.signal.addEventListener("abort", () => reader.cancel("time limit reached").catch(() => undefined), { once: true });
      const out = new ReadableStream<Uint8Array>({
        async pull(ctrl) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              stopTimer();
              if (buffer.trim()) consume("\n\n");
              if (limit.signal.aborted) await keep("the call reached its time limit", usage, res.status, servedModel);
              else if (sawInput && sawOutput) await settle(usage, res.status, servedModel);
              else await keep("the stream ended without usage figures that could be read", usage, res.status, servedModel);
              ctrl.close();
              return;
            }
            consume(decoder.decode(value, { stream: true }));
            ctrl.enqueue(value);
          } catch (err) {
            stopTimer();
            await keep("the provider's stream failed part-way", usage, res.status, servedModel, { error: errorSummary(err) });
            ctrl.error(err);
          }
        },
        async cancel(reason) {
          stopTimer();
          await reader.cancel(reason).catch(() => undefined);
          await keep("the client cancelled part-way", usage, res.status, servedModel);
        },
      });
      return new Response(out, { status: res.status, headers: copyHeaders(res.headers) });
    }

    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      stopTimer();
      await keep(limit.signal.aborted ? whyCut() : "the provider's answer broke off part-way", emptyUsage(), res.status, "", { error: errorSummary(err) });
      return c.json(errorBody("api_error", "The model provider's answer could not be read to the end."), 502);
    }
    stopTimer();
    let usage: Usage | null = null;
    let servedModel = "";
    try {
      const j = JSON.parse(text) as { usage?: ProviderUsage; model?: string };
      servedModel = typeof j.model === "string" ? j.model : "";
      if (j.usage && typeof j.usage.input_tokens === "number" && typeof j.usage.output_tokens === "number") usage = mergeUsage(emptyUsage(), j.usage);
    } catch {
      /* not JSON: usage stays unread */
    }
    if (usage) await settle(usage, res.status, servedModel);
    else await keep("the answer succeeded but its usage could not be read", emptyUsage(), res.status, servedModel);
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
export function readFrame(frame: string, acc: Usage): { usage: Usage; model?: string; kind?: "message_start" | "message_delta" } {
  const data = frame
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .join("\n");
  if (!data) return { usage: acc };
  try {
    const ev = JSON.parse(data) as { type?: string; message?: { usage?: ProviderUsage; model?: string }; usage?: ProviderUsage };
    if (ev.type === "message_start" && ev.message?.usage && typeof ev.message.usage.input_tokens === "number") {
      return { usage: mergeUsage(acc, ev.message.usage), model: ev.message.model, kind: "message_start" };
    }
    if (ev.type === "message_start" && ev.message) return { usage: acc, model: ev.message.model };
    if (ev.type === "message_delta" && ev.usage && typeof ev.usage.output_tokens === "number") return { usage: mergeUsage(acc, ev.usage), kind: "message_delta" };
  } catch {
    /* not JSON; ignore */
  }
  return { usage: acc };
}

/** Kept for callers of the old name. */
export const readUsageFromFrame = (frame: string, acc: Usage): Usage => readFrame(frame, acc).usage;

/**
 * What a gateway process does about holds outside any one request: at start-up it finds the
 * holds left open in the database, and from then on it marks holds that pass their deadline.
 * Nothing here releases money. Returns a function that stops the timer.
 */
export async function startHoldKeeper(pool: pg.Pool, gatewayId: string, everyMs = 30_000): Promise<{ found: number; expiredAtStart: number; stop: () => void }> {
  const r = await recoverHolds(pool, gatewayId);
  const timer = setInterval(() => {
    expireHolds(pool).catch((err) => console.error("[gateway fault] holds past their deadline could not be marked", errorSummary(err)));
  }, everyMs);
  timer.unref();
  return { found: r.found.length, expiredAtStart: r.expired.length, stop: () => clearInterval(timer) };
}
