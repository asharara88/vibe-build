/**
 * The model gateway: the only route to the model.
 *
 * - Holds the real model key. The engine's container holds a project token instead.
 * - Records every call as a `model.call` event with tokens and cost.
 * - Refuses a call when the project's spend has reached its cap, with a named reason.
 * - Refuses models that are not in the price table, so no call can go unmetered.
 *
 * Design note: docs/design/stage-1.md, sections 2.4, 5.4 and 5.5.
 */
import { Hono } from "hono";
import type pg from "pg";
import { appendEvent } from "../store/events.js";
import { getSpend, projectForToken, recentCallCostEstimate, type Project } from "../store/projects.js";
import { costUsd, emptyUsage, mergeUsage, type Usage } from "./cost.js";
import { PRICES } from "./prices.js";

export interface GatewayOptions {
  pool: pg.Pool;
  /** The real model key. Never logged, never returned. */
  modelApiKey: string;
  /** Where to forward. Default: Anthropic. Tests point this at a mock. */
  upstreamUrl?: string;
  /** Models this gateway may forward. Default: every model in the price table. */
  allowedModels?: string[];
  fetchImpl?: typeof fetch;
}

const HOP_BY_HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "x-api-key", "authorization"]);

function plainError(status: number, type: string, message: string) {
  return { status, body: { type: "error", error: { type, message } } };
}

export function createGateway(opts: GatewayOptions) {
  const upstream = (opts.upstreamUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const allowed = new Set(opts.allowedModels ?? Object.keys(PRICES));
  const fetchImpl = opts.fetchImpl ?? fetch;
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  // Every Anthropic API path is forwarded; only /v1/messages is metered, because that is
  // the only path that spends money on model output. Other paths (for example token counting)
  // pass through with the project identified and are logged as `gateway.passthrough`.
  app.all("/v1/*", async (c) => {
    const token = c.req.header("x-api-key") ?? bearer(c.req.header("authorization"));
    if (!token) {
      const e = plainError(401, "authentication_error", "No project token was sent. The engine must send its project token as the API key.");
      return c.json(e.body, e.status as 401);
    }
    const project: Project | null = await projectForToken(opts.pool, token);
    if (!project) {
      const e = plainError(401, "authentication_error", "This project token is not recognised or has been revoked.");
      return c.json(e.body, e.status as 401);
    }
    const step = c.req.header("x-builder-step") ?? null;
    const path = new URL(c.req.url).pathname + new URL(c.req.url).search;
    const metered = /^\/v1\/messages\/?(\?|$)/.test(path);

    const rawBody = c.req.method === "GET" || c.req.method === "HEAD" ? null : await c.req.text();
    let model = "";
    let stream = false;
    if (metered) {
      try {
        const parsed = rawBody ? (JSON.parse(rawBody) as { model?: string; stream?: boolean }) : {};
        model = parsed.model ?? "";
        stream = parsed.stream === true;
      } catch {
        const e = plainError(400, "invalid_request_error", "The request body is not valid JSON.");
        return c.json(e.body, e.status as 400);
      }
      if (!allowed.has(model)) {
        await appendEvent(opts.pool, project.id, "gateway.refused", { reason: "model_not_allowed", model, path }, step);
        const e = plainError(400, "invalid_request_error", `The model "${model}" is not in this project's profile, so the gateway will not forward the call.`);
        return c.json(e.body, e.status as 400);
      }
      // The cap is never crossed knowingly: a call is refused when what has been spent plus the
      // estimated cost of this call (the dearest of the last three) would exceed the cap. The very
      // first call of a project has no history and is allowed; it can be the one that overshoots.
      const spend = await getSpend(opts.pool, project.id);
      const spent = Number(spend.spent_usd);
      const cap = Number(spend.cap_usd);
      const estimate = await recentCallCostEstimate(opts.pool, project.id);
      if (spent >= cap || spent + estimate > cap) {
        await appendEvent(
          opts.pool,
          project.id,
          "gateway.refused",
          { reason: "budget_reached", spent_usd: spent, cap_usd: cap, next_call_estimate_usd: estimate, path },
          step,
        );
        const e = plainError(
          402,
          "budget_reached",
          `This project has reached its budget of $${cap.toFixed(2)} (spent $${spent.toFixed(2)}; the next call was expected to cost about $${estimate.toFixed(2)}). Nothing more will be built until the budget is raised.`,
        );
        return c.json(e.body, e.status as 402);
      }
    }

    const headers = new Headers();
    c.req.raw.headers.forEach((v, k) => {
      if (!HOP_BY_HOP.has(k.toLowerCase()) && !k.toLowerCase().startsWith("x-builder-")) headers.set(k, v);
    });
    headers.set("x-api-key", opts.modelApiKey);

    const started = Date.now();
    let res: Response;
    try {
      res = await fetchImpl(upstream + path, { method: c.req.method, headers, body: rawBody });
    } catch (err) {
      await appendEvent(opts.pool, project.id, "gateway.error", { path, error: String(err) }, step);
      const e = plainError(502, "api_error", "The gateway could not reach the model provider.");
      return c.json(e.body, e.status as 502);
    }

    if (!metered) {
      await appendEvent(opts.pool, project.id, "gateway.passthrough", { path, status: res.status }, step);
      return passThrough(res);
    }

    const record = async (usage: Usage, status: number, extra: Record<string, unknown> = {}) => {
      const cost = costUsd(model, usage);
      await appendEvent(
        opts.pool,
        project.id,
        "model.call",
        { model, path, status, stream, usage, cost_usd: cost, duration_ms: Date.now() - started, ...extra },
        step,
      );
    };

    if (!res.ok) {
      const text = await res.text();
      await record(emptyUsage(), res.status, { upstream_error: safeJson(text) });
      return new Response(text, { status: res.status, headers: copyHeaders(res.headers) });
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (stream && contentType.includes("text/event-stream") && res.body) {
      // Tee the stream: the client receives bytes untouched; we read usage from the events.
      let usage = emptyUsage();
      let buffer = "";
      const decoder = new TextDecoder();
      const meter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          controller.enqueue(chunk);
          buffer += decoder.decode(chunk, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            usage = readUsageFromFrame(frame, usage);
          }
        },
        async flush() {
          if (buffer.trim()) usage = readUsageFromFrame(buffer, usage);
          await record(usage, res.status);
        },
      });
      return new Response(res.body.pipeThrough(meter), { status: res.status, headers: copyHeaders(res.headers) });
    }

    const text = await res.text();
    let usage = emptyUsage();
    try {
      const j = JSON.parse(text) as { usage?: Partial<Usage> };
      if (j.usage) usage = mergeUsage(usage, j.usage);
    } catch {
      /* leave usage empty; recorded as such */
    }
    await record(usage, res.status);
    return new Response(text, { status: res.status, headers: copyHeaders(res.headers) });
  });

  return app;
}

function bearer(h: string | undefined): string | undefined {
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1];
}

function copyHeaders(h: Headers): Headers {
  const out = new Headers();
  h.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k.toLowerCase()) && k.toLowerCase() !== "content-encoding") out.set(k, v);
  });
  return out;
}

function passThrough(res: Response): Response {
  return new Response(res.body, { status: res.status, headers: copyHeaders(res.headers) });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}

/** Read usage from one SSE frame: message_start carries input usage, message_delta carries output. */
export function readUsageFromFrame(frame: string, acc: Usage): Usage {
  const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
  if (!dataLine) return acc;
  try {
    const ev = JSON.parse(dataLine.slice(5).trim()) as {
      type?: string;
      message?: { usage?: Partial<Usage> };
      usage?: Partial<Usage>;
    };
    if (ev.type === "message_start" && ev.message?.usage) return mergeUsage(acc, ev.message.usage);
    if (ev.type === "message_delta" && ev.usage) return mergeUsage(acc, ev.usage);
  } catch {
    /* not JSON; ignore */
  }
  return acc;
}
