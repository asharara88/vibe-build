import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGateway, normalisePath, startHoldKeeper } from "../src/gateway/app.js";
import { costUsd, emptyUsage } from "../src/gateway/cost.js";
import { COUNT_MARGIN, computeHold, DEFAULT_PROFILES, guardRequest, type ProfileLimits } from "../src/gateway/hold.js";
import { listEvents } from "../src/store/events.js";
import { CapChangeRefused, changeCap, expireHolds, getBudget, listHolds, micro, openHold, releaseUnsentHold, settleHold } from "../src/store/holds.js";
import { createProject, getProject, getSpend, issueProjectToken } from "../src/store/projects.js";
import { TEST_DB_URL, testPool, uniqueId } from "./helpers.js";

const REAL_KEY = "test-real-key-never-leaves-the-gateway";
/** The builder's own folder, where the gateway process of proof row B6 is started. */
const BUILDER_DIR = fileURLToPath(new URL("..", import.meta.url));
let pool: pg.Pool;
let upstream: ServerType;
let upstreamUrl: string;
let gateway: ServerType;
let gatewayUrl: string;
const seenKeys: string[] = [];
const faults: string[] = [];
/** How many metered calls reached the stand-in provider. A refused call must not move it. */
let forwarded = 0;
/** The last metered request body the stand-in received, as text. */
let lastForwardedBody = "";
/** For proof row B1: per project, how many open holds the database had when each call reached the stand-in. */
const openHoldsAtForward = new Map<string, number[]>();

const PROFILES: Record<string, ProfileLimits> = {
  ...DEFAULT_PROFILES,
  fast: { maxTokensCeiling: 16_000, allowFastMode: true },
};

// One plain call on Opus 5.5. The stand-in counts the prompt as 42 tokens and bills 42.
const PLAIN_USAGE = { input_tokens: 30, output_tokens: 300, cache_creation_input_tokens: 4, cache_read_input_tokens: 8 };
/** Costs and holds are rounded up to the next millionth of a dollar. */
const up6 = (usd: number) => Math.ceil(usd * 1e6 - 1e-6) / 1e6;
const PLAIN_COST = up6((30 * 4 + 4 * 5 + 8 * 0.2 + 300 * 20) / 1e6);
const PLAIN_MAX_TOKENS = 400;
const margin = (n: number) => Math.ceil(n * COUNT_MARGIN.fraction) + COUNT_MARGIN.tokens;
/** The hold for the plain call: (42 + margin) at the one-hour cache-write rate, plus max_tokens at the output rate. */
const PLAIN_HOLD = ((42 + margin(42)) * 8 + PLAIN_MAX_TOKENS * 20) / 1e6;

const STREAM_FRAMES = [
  `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { model: "claude-sonnet-5-5", usage: { input_tokens: 1000, cache_read_input_tokens: 500, cache_creation_input_tokens: 0, output_tokens: 1 } } })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hello" } })}\n\n`,
  `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 200 } })}\n\n`,
  `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
];

/**
 * A stand-in for the model provider: no real provider is called and nothing is spent.
 * Behaviour is chosen by fields in the request body. The count is steered by the `system`
 * field, because that field is part of what the gateway sends to the counting call.
 */
function standInProvider() {
  const app = new Hono();
  app.post("/v1/messages", async (c) => {
    forwarded++;
    seenKeys.push(c.req.header("x-api-key") ?? "(none)");
    lastForwardedBody = await c.req.text();
    const body = JSON.parse(lastForwardedBody) as { model: string; stream?: boolean; max_tokens?: number; system?: unknown; metadata?: { test?: string; project?: string } };
    const mode = body.metadata?.test ?? "";
    const ok = (usage: unknown, model: string = body.model) => c.json({ id: "msg_test", type: "message", model, content: [{ type: "text", text: "hello" }], usage });
    if (mode === "note-open-holds") {
      // Proof row B1: what the database says at the moment the call reaches the provider. Then answer as usual.
      const project = String(body.metadata?.project ?? "");
      const r = await pool.query<{ n: number }>("select count(*)::int as n from holds where project_id = $1 and state = 'open'", [project]);
      openHoldsAtForward.set(project, [...(openHoldsAtForward.get(project) ?? []), r.rows[0]!.n]);
    }
    if (mode === "bill-above-count") {
      // Proof row B16: the count is "an estimate". Bill 4% more prompt tokens than were counted, all at the
      // dearest input rate (one-hour cache writes), and the whole of max_tokens as output.
      const counted = Number(/^count:(\d+)$/.exec(typeof body.system === "string" ? body.system : "")?.[1] ?? 42);
      const billed = counted + Math.ceil((counted * 4) / 100);
      return ok({ input_tokens: 0, cache_creation_input_tokens: billed, cache_creation: { ephemeral_1h_input_tokens: billed, ephemeral_5m_input_tokens: 0 }, cache_read_input_tokens: 0, output_tokens: body.max_tokens });
    }
    // 529 is not a status the web framework's types list, so the answer is built by hand.
    if (mode === "fail-529") return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "stand-in overloaded" } }), { status: 529, headers: { "content-type": "application/json" } });
    if (mode === "bad-usage") return ok({ ...PLAIN_USAGE, cache_read_input_tokens: "lots" });
    if (mode === "negative-usage") return ok({ ...PLAIN_USAGE, input_tokens: -1_000_000 });
    if (mode === "fraction-usage") return ok({ ...PLAIN_USAGE, output_tokens: 12.5 });
    if (mode === "iterations") return ok({ ...PLAIN_USAGE, iterations: [{ type: "message", input_tokens: 30, output_tokens: 300 }] });
    if (mode === "served-unknown") return ok(PLAIN_USAGE, "claude-opus-4-8");
    if (mode === "fail-408") return c.json({ type: "error", error: { type: "timeout_error", message: "stand-in timeout" } }, 408);
    if (mode === "fail-400-other") return c.text("<html>Bad Request from something in between</html>", 400);
    if (mode === "fail-429") return c.json({ type: "error", error: { type: "rate_limit_error", message: "stand-in rate limit" } }, 429);
    if (mode === "odd-speed") return ok({ ...PLAIN_USAGE, speed: "turbo" });
    if (mode === "speed-fast-stated") return ok({ ...PLAIN_USAGE, speed: "fast" });
    if (mode === "cache-writes-not-itemised") return ok({ input_tokens: 30, cache_creation_input_tokens: 10_000, cache_read_input_tokens: 0, output_tokens: 300 });
    if (mode === "cache-writes-itemised-5m") return ok({ input_tokens: 30, cache_creation_input_tokens: 10_000, cache_creation: { ephemeral_5m_input_tokens: 10_000, ephemeral_1h_input_tokens: 0 }, cache_read_input_tokens: 0, output_tokens: 300 });
    if (mode === "speed-standard-stated") return ok({ ...PLAIN_USAGE, speed: "standard" });
    if (mode === "cache-mismatch") return ok({ ...PLAIN_USAGE, cache_creation: { ephemeral_1h_input_tokens: 1_000_000 } });
    if (mode === "server-tool-usage") return ok({ ...PLAIN_USAGE, server_tool_use: { web_search_requests: 5 } });
    if (mode === "priority-tier") return ok({ ...PLAIN_USAGE, service_tier: "priority" });
    if (mode === "zero-usage") return ok({ input_tokens: 0, output_tokens: 0 });
    if (mode === "echo-key-model") return ok(PLAIN_USAGE, `model-${c.req.header("x-api-key")}`);
    if (mode === "echo-key-header") return c.json({ id: "msg_test", type: "message", model: body.model, content: [], usage: PLAIN_USAGE }, 200, { "x-echo": c.req.header("x-api-key") ?? "" });
    const escapedKey = (c.req.header("x-api-key") ?? "").replace(/-/g, "\\u002d");
    if (mode === "echo-key-escaped-400") return c.body(`{"type":"error","error":{"type":"invalid_request_error","message":"echo ${escapedKey}"}}`, 400, { "content-type": "application/json" });
    if (mode === "echo-key-escaped-200") return c.body(`{"id":"msg_test","type":"message","model":"${body.model}","content":[{"type":"text","text":"echo ${escapedKey}"}],"usage":${JSON.stringify(PLAIN_USAGE)}}`, 200, { "content-type": "application/json" });
    if (mode === "echo-key-escaped-twice") return c.json({ type: "error", error: { type: "api_error", message: `inner {"note":"${escapedKey}"}` } }, 500);
    if (mode === "echo-key-escaped-not-json") return c.text(`<html>broken ${escapedKey}</html>`, 500);
    if (mode === "echo-key-header-name") return c.json({ id: "msg_test", type: "message", model: body.model, content: [], usage: PLAIN_USAGE }, 200, { [c.req.header("x-api-key") ?? "x-none"]: "1" });
    if (mode === "unknown-usage-field") return ok({ ...PLAIN_USAGE, premium_tokens: 1_000_000 });
    if (mode === "unknown-cache-member") return ok({ ...PLAIN_USAGE, cache_creation: { ephemeral_24h_input_tokens: 4 } });
    if (mode === "thinking-details") return ok({ ...PLAIN_USAGE, output_tokens_details: { thinking_tokens: 120 } });
    if (mode === "thinking-details-over") return ok({ ...PLAIN_USAGE, output_tokens_details: { thinking_tokens: 9_999 } });
    if (mode === "model-not-text") return c.json({ id: "msg_test", type: "message", model: ["claude-haiku-5-5"], content: [], usage: PLAIN_USAGE });
    const k = c.req.header("x-api-key") ?? "";
    // Found by the fifth review. One backslash in front of the key: for a key that begins with b, f, n, r or t this is
    // valid JSON whose first character is read as a tab or the like, and written out again it spells the key.
    if (mode === "echo-key-after-backslash-500") return c.body(`{"type":"error","error":{"type":"api_error","message":"\\${k}"}}`, 500, { "content-type": "application/json" });
    if (mode === "echo-key-after-backslash-200") return c.body(`{"id":"msg_test","type":"message","model":"${body.model}","note":"\\${k}","content":[],"usage":${JSON.stringify(PLAIN_USAGE)}}`, 200, { "content-type": "application/json" });
    // A backslash put in front of each u and x of the key.
    const uxKey = k.replace(/([ux])/g, "\\$1");
    if (mode === "echo-key-backslash-ux-text") return c.text(`bad key ${uxKey}`, 500);
    if (mode === "echo-key-backslash-ux-json") return c.json({ type: "error", error: { type: "api_error", message: `bad key ${uxKey}` } }, 500);
    if (mode === "echo-key-backslash-ux-header") return c.json({ id: "msg_test", type: "message", model: body.model, content: [], usage: PLAIN_USAGE }, 200, { "x-echo": uxKey });
    if (mode === "nul-500") return c.body(`{"type":"error","error":{"type":"api_error","message":"a\\u0000b"}}`, 500, { "content-type": "application/json" });
    if (mode === "served-constructor") return ok(PLAIN_USAGE, "constructor");
    if (mode === "huge-200") return c.body(`{"id":"msg_test","type":"message","model":"${body.model}","pad":"${"a".repeat(8_100_000)}","content":[],"usage":${JSON.stringify(PLAIN_USAGE)}}`, 200, { "content-type": "application/json" });
    if (mode === "backslash-run") return c.body(`{"id":"msg_test","type":"message","model":"${body.model}","big":12345678901234567890,  "content":[{"type":"text","text":"${"\\".repeat(30_000)}"}],"usage":${JSON.stringify(PLAIN_USAGE)}}`, 200, { "content-type": "application/json" });
    if (mode === "surrogate-500") return c.body(`{"type":"error","error":{"type":"api_error","message":"a\\ud800b"}}`, 500, { "content-type": "application/json" });
    // The same name twice in one object: a JSON reader keeps the second and drops the first.
    if (mode === "echo-key-shadowed-500") return c.body(`{"type":"error","error":{"type":"api_error","message":"bad key ${k}","message":"nothing here"}}`, 500, { "content-type": "application/json" });
    if (mode === "echo-key-shadowed-escaped-500") return c.body(`{"type":"error","error":{"type":"api_error","message":"bad key ${escapedKey}","message":"nothing here"}}`, 500, { "content-type": "application/json" });
    if (mode === "echo-key-shadowed-200") return c.body(`{"id":"msg_test","type":"message","model":"${body.model}","note":"${k}","note":"x","content":[],"usage":${JSON.stringify(PLAIN_USAGE)}}`, 200, { "content-type": "application/json" });
    if (mode === "many-backslashes") return c.body(`{"id":"msg_test","type":"message","model":"${body.model}","content":[{"type":"text","text":"${"\\".repeat(80)}"}],  "usage":${JSON.stringify(PLAIN_USAGE)}}`, 200, { "content-type": "application/json" });
    if (mode === "deep-500-key") return c.body(`{"type":"error","note":"${k}","error":${"[".repeat(20_000)}${"]".repeat(20_000)}}`, 500, { "content-type": "application/json" });
    if (mode === "deep-500") return c.body(`{"type":"error","error":${"[".repeat(20_000)}${"]".repeat(20_000)}}`, 500, { "content-type": "application/json" });
    if (mode === "model-missing") return c.json({ id: "msg_test", type: "message", content: [], usage: PLAIN_USAGE });
    if (mode === "model-empty") return c.json({ id: "msg_test", type: "message", model: "", content: [], usage: PLAIN_USAGE });
    if (mode === "echo-key-escaped-500") return c.body(`{"type":"error","error":{"type":"api_error","message":"echo ${(c.req.header("x-api-key") ?? "").replace(/-/g, "\\u002d")}"}}`, 500, { "content-type": "application/json" });
    if (mode === "echo-key-500") return c.json({ type: "error", error: { type: "api_error", message: `stand-in echo of ${c.req.header("x-api-key")}` } }, 500);
    if (mode === "fail-500") return c.json({ type: "error", error: { type: "api_error", message: "stand-in failure" } }, 500);
    if (mode === "fail-400") return c.json({ type: "error", error: { type: "invalid_request_error", message: "stand-in rejection" } }, 400);
    if (mode === "redirect") return c.redirect("http://127.0.0.1:9/elsewhere", 307);
    if (mode === "slow-wait") await new Promise((r) => setTimeout(r, 300));
    if (mode === "very-slow") await new Promise((r) => setTimeout(r, 1500));
    if (mode === "never-answers") {
      // Proof row B6 with the first gateway as its own process: no answer comes before the gateway's
      // connection to the stand-in is closed, which happens when that process exits.
      await new Promise<void>((resolve) => (c.req.raw.signal.aborted ? resolve() : c.req.raw.signal.addEventListener("abort", () => resolve(), { once: true })));
      return c.json({ type: "error", error: { type: "api_error", message: "stand-in: no answer was meant to arrive" } }, 500);
    }
    if (mode === "no-usage") return c.json({ id: "msg_test", type: "message", model: body.model, content: [{ type: "text", text: "hello" }] });
    if (body.stream) {
      const slow = mode === "slow-stream";
      const errorFrame = `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "stand-in" } })}\n\n`;
      const secondStart = `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { model: "claude-sonnet-5-5", usage: { input_tokens: 30, output_tokens: 1 } } })}\n\n`;
      const fallingDelta = `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 3 } })}\n\n`;
      const start = (model: unknown, usage: unknown) => `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { model, usage } })}\n\n`;
      const delta = (usage: unknown) => `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage })}\n\n`;
      const thirdReview: Record<string, string[]> = {
        // A frame named "error" whose data is not the provider's error object, then a normal end.
        "stream-error-name": [...STREAM_FRAMES.slice(0, 3), "event: error\ndata: something went wrong\n\n", STREAM_FRAMES[3]!],
        "stream-falling-input": [STREAM_FRAMES[0]!, delta({ input_tokens: 1, output_tokens: 200 }), STREAM_FRAMES[3]!],
        "stream-start-high-output": [start("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 9000 }), delta({ output_tokens: 200 }), STREAM_FRAMES[3]!],
        "stream-cache-item-falls": [
          start("claude-sonnet-5-5", { input_tokens: 1000, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_1h_input_tokens: 1000 }, output_tokens: 1 }),
          delta({ output_tokens: 200, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 1000 } }),
          STREAM_FRAMES[3]!,
        ],
        "stream-model-not-text": [start(["claude-haiku-5-5"], { input_tokens: 1000, output_tokens: 1 }), STREAM_FRAMES[2]!, STREAM_FRAMES[3]!],
        "stream-start-not-json": ["event: message_start\ndata: {broken\n\n", STREAM_FRAMES[0]!, STREAM_FRAMES[2]!, STREAM_FRAMES[3]!],
        // Found by the fourth review.
        "stream-fast-taken-back": [start("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 1, speed: "fast" }), delta({ output_tokens: 200, speed: "standard" }), STREAM_FRAMES[3]!],
        // A dearer figure behind a "blank line" made of LF then CR LF, which the gateway does not take as the end of a frame.
        "stream-hidden-frame": [STREAM_FRAMES[0]!, `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 10 } })}\n\r\nevent: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 5000 } })}\n\n`, STREAM_FRAMES[3]!],
        "stream-hidden-frame-cr": [STREAM_FRAMES[0]!, `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 10 } })}\r\revent: message_delta\rdata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 5000 } })}\n\n`, STREAM_FRAMES[3]!],
        "stream-unnamed-broken": [STREAM_FRAMES[0]!, STREAM_FRAMES[2]!, `data: {"type":"message_delta","usage":{"output_tokens":5000\n\n`, STREAM_FRAMES[3]!],
        "stream-two-names": [...STREAM_FRAMES.slice(0, 3), `event: ping\nevent: error\ndata: {"type":"ping"}\n\n`, STREAM_FRAMES[3]!],
        "stream-name-and-type-differ": [STREAM_FRAMES[0]!, STREAM_FRAMES[2]!, `event: message_delta\ndata: {"type":"ping","usage":{"output_tokens":5000}}\n\n`, STREAM_FRAMES[3]!],
        "stream-start-without-message": [`event: message_start\ndata: {"type":"message_start","message":null}\n\n`, ...STREAM_FRAMES],
        "stream-model-empty": [start("", { input_tokens: 1000, output_tokens: 1 }), STREAM_FRAMES[2]!, STREAM_FRAMES[3]!],
        // Found by the fifth review: a named frame with no data.
        "stream-named-no-data": [STREAM_FRAMES[0]!, STREAM_FRAMES[2]!, "event: message_delta\ndata:\n\n", STREAM_FRAMES[3]!],
        // Comment lines and a keep-alive with no name and no data are passed over, as before.
        "stream-with-comments": [": keep-alive\n\n", STREAM_FRAMES[0]!, ": another comment\n\n", `event: ping\ndata: {"type":"ping"}\n\n`, ...STREAM_FRAMES.slice(1)],
        // Review of 13 Nov 2026: a stream on Claude Opus 5.5 whose usage leaves the speed out, and one that states it.
        "stream-opus-no-speed": [start("claude-opus-5-5", { input_tokens: 1000, output_tokens: 1 }), delta({ output_tokens: 200 }), STREAM_FRAMES[3]!],
        "stream-opus-speed-fast": [start("claude-opus-5-5", { input_tokens: 1000, output_tokens: 1, speed: "fast" }), delta({ output_tokens: 200 }), STREAM_FRAMES[3]!],
        // Second re-read of 13 Nov 2026: a stream whose start carries 10,000 cache writes with no split into
        // five-minute and one-hour, and one whose start splits them all as five-minute writes.
        "stream-cache-writes-not-itemised": [start("claude-sonnet-5-5", { input_tokens: 30, cache_creation_input_tokens: 10_000, cache_read_input_tokens: 0, output_tokens: 1 }), delta({ output_tokens: 300 }), STREAM_FRAMES[3]!],
        "stream-cache-writes-itemised-5m": [
          start("claude-sonnet-5-5", { input_tokens: 30, cache_creation_input_tokens: 10_000, cache_creation: { ephemeral_5m_input_tokens: 10_000, ephemeral_1h_input_tokens: 0 }, cache_read_input_tokens: 0, output_tokens: 1 }),
          delta({ output_tokens: 300 }),
          STREAM_FRAMES[3]!,
        ],
      };
      const frames =
        thirdReview[mode] ? thirdReview[mode]
        : mode === "stream-no-usage" ? [STREAM_FRAMES[1]!, STREAM_FRAMES[3]!]
        : mode === "stream-no-stop" ? STREAM_FRAMES.slice(0, 3)
        : mode === "stream-error-event" ? [...STREAM_FRAMES.slice(0, 3), errorFrame]
        : mode === "stream-two-starts" ? [STREAM_FRAMES[0]!, secondStart, ...STREAM_FRAMES.slice(1)]
        : mode === "stream-falling-output" ? [...STREAM_FRAMES.slice(0, 3), fallingDelta, STREAM_FRAMES[3]!]
        : STREAM_FRAMES;
      const stream = new ReadableStream<Uint8Array>({
        async start(ctrl) {
          for (const f of frames) {
            ctrl.enqueue(new TextEncoder().encode(f));
            if (slow) await new Promise((r) => setTimeout(r, 250));
          }
          ctrl.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }
    const served = mode === "served-haiku" ? "claude-haiku-5-5" : body.model;
    const usage = mode === "fast-1h" ? { ...PLAIN_USAGE, cache_creation: { ephemeral_1h_input_tokens: 4 }, speed: "fast" } : PLAIN_USAGE;
    return c.json({ id: "msg_test", type: "message", model: served, content: [{ type: "text", text: "hello" }], usage });
  });
  app.post("/v1/messages/count_tokens", async (c) => {
    const body = (await c.req.json()) as { system?: string };
    const s = typeof body.system === "string" ? body.system : "";
    if (s === "count-fail") return c.json({ type: "error", error: { type: "api_error", message: "stand-in count failure" } }, 500);
    if (s === "count-garbage") return c.json({ input_tokens: "many" });
    if (s === "count-slow") {
      // Review of 13 Nov 2026: a slow count, so that a caller can leave before the call is forwarded.
      await new Promise((r) => setTimeout(r, 400));
      return c.json({ input_tokens: 42 });
    }
    if (s === "count-echo-after-backslash") return c.body(`{"input_tokens":42,"note":"\\${c.req.header("x-api-key") ?? ""}"}`, 200, { "content-type": "application/json" });
    if (s === "count-echo-key" || s === "count-echo-key-401") {
      const escaped = (c.req.header("x-api-key") ?? "").replace(/-/g, "\\u002d");
      return c.body(`{"input_tokens":42,"note":"echo ${escaped}"}`, s === "count-echo-key" ? 200 : 401, { "content-type": "application/json" });
    }
    const m = /^count:(\d+)$/.exec(s);
    return c.json({ input_tokens: m ? Number(m[1]) : 42 });
  });
  app.post("/v1/messages/batches", (c) => c.json({ id: "batch_should_never_be_reached" }));
  return app;
}

/** The address of a port on this machine where nothing listens: one is opened, read and closed again. (Port 9, used before, is on fetch's list of ports it refuses to use at all, so a call there never tries to connect.) */
async function closedPortUrl(): Promise<string> {
  const probe = createHttpServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

function listen(app: Hono): Promise<{ server: ServerType; url: string }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => resolve({ server, url: `http://127.0.0.1:${info.port}` }));
  });
}

beforeAll(async () => {
  pool = await testPool();
  ({ server: upstream, url: upstreamUrl } = await listen(standInProvider()));
  const app = createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, gatewayId: "gw_test_main", onFault: (m) => faults.push(m) });
  ({ server: gateway, url: gatewayUrl } = await listen(app));
});
afterAll(async () => {
  gateway.close();
  upstream.close();
  await pool.end();
});

async function newProject(capUsd: number, profile = "standard") {
  const id = uniqueId("p");
  await createProject(pool, { id, name: "gateway test", capUsd, profile });
  const token = await issueProjectToken(pool, id);
  return { id, token };
}

const callAt = (base: string, token: string, body: unknown, path = "/v1/messages", extra: Record<string, string> = {}, init: RequestInit = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": token, "anthropic-version": "2023-06-01", ...extra },
    body: JSON.stringify(body),
    ...init,
  });
const call = (token: string, body: unknown, path = "/v1/messages", extra: Record<string, string> = {}, init: RequestInit = {}) => callAt(gatewayUrl, token, body, path, extra, init);
const plain = (test?: string, more: Record<string, unknown> = {}) => ({ model: "claude-opus-5-5", max_tokens: PLAIN_MAX_TOKENS, messages: [], ...(test ? { metadata: { test } } : {}), ...more });
const streamed = (test?: string) => ({ model: "claude-sonnet-5-5", max_tokens: 250, stream: true, system: "count:1500", messages: [], ...(test ? { metadata: { test } } : {}) });

/** Wait until the project has the expected number of events of a kind (a stream records after the client finishes). */
async function waitForEvents(id: string, kind: string, n: number) {
  for (let i = 0; i < 100; i++) {
    const events = await listEvents(pool, id, kind);
    if (events.length >= n) return events;
    await new Promise((r) => setTimeout(r, 20));
  }
  return listEvents(pool, id, kind);
}
const kinds = async (id: string) => (await listEvents(pool, id)).map((e) => e.kind);
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(5e-7);

describe("model gateway: key and metering", () => {
  it("forwards with the real key, keeps the key out of the client's view, and records usage and cost", async () => {
    const { id, token } = await newProject(5);
    const res = await call(token, plain(), "/v1/messages", { "x-builder-step": "step-1" });
    expect(res.status).toBe(200);
    expect(seenKeys.at(-1)).toBe(REAL_KEY);
    const text = await res.text();
    expect(text).not.toContain(REAL_KEY);
    res.headers.forEach((v) => expect(v).not.toContain(REAL_KEY));
    const events = await listEvents(pool, id, "model.call");
    expect(events).toHaveLength(1);
    expect(JSON.stringify(await listEvents(pool, id))).not.toContain(REAL_KEY);
    const p = events[0]!.payload as { model: string; priced_as: string; usage: { input_tokens: number }; cost_usd: number };
    expect(events[0]!.step).toBe("step-1");
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.priced_as).toBe("claude-opus-5-5");
    expect(p.usage.input_tokens).toBe(30);
    near(p.cost_usd, PLAIN_COST);
    near(Number((await getSpend(pool, id)).spent_usd), PLAIN_COST);
  });

  it("relays a streamed response byte for byte and meters it from the stream's events", async () => {
    const { id, token } = await newProject(5);
    const res = await call(token, streamed());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(STREAM_FRAMES.join(""));
    const events = await waitForEvents(id, "model.call", 1);
    expect(events).toHaveLength(1);
    const p = events[0]!.payload as { usage: Record<string, number>; cost_usd: number; served_model: string };
    expect(p.usage).toMatchObject({ input_tokens: 1000, cache_read_input_tokens: 500, output_tokens: 200 });
    expect(p.served_model).toBe("claude-sonnet-5-5");
    near(p.cost_usd, (1000 * 2 + 500 * 0.1 + 200 * 10) / 1e6);
    expect((await getBudget(pool, id)).openHolds).toBe(0);
  });

  it("prices one-hour cache writes and fast mode from the response", async () => {
    const { id, token } = await newProject(5, "fast");
    expect((await call(token, plain("fast-1h"))).status).toBe(200);
    const p = (await listEvents(pool, id, "model.call"))[0]!.payload as { usage: { speed: string; cache_creation_1h_tokens: number }; cost_usd: number };
    expect(p.usage.speed).toBe("fast");
    expect(p.usage.cache_creation_1h_tokens).toBe(4);
    near(p.cost_usd, up6(2 * ((30 * 4 + 4 * 8 + 8 * 0.2 + 300 * 20) / 1e6)));
  });

  it("prices by the model that served the answer when it differs from the one requested", async () => {
    const { id, token } = await newProject(5);
    expect((await call(token, plain("served-haiku"))).status).toBe(200);
    const p = (await listEvents(pool, id, "model.call"))[0]!.payload as { priced_as: string; cost_usd: number };
    expect(p.priced_as).toBe("claude-haiku-5-5");
    near(p.cost_usd, costUsd("claude-haiku-5-5", { ...emptyUsage(), ...PLAIN_USAGE })!);
  });

  it("settles at nothing when the provider rejects the request before doing any work", async () => {
    const { id, token } = await newProject(5);
    const res = await call(token, plain("fail-400"));
    expect(res.status).toBe(400);
    const p = (await listEvents(pool, id, "model.call"))[0]!.payload as { status: number; cost_usd: number; rejected_before_work: boolean; upstream_error: unknown };
    expect(p).toMatchObject({ status: 400, cost_usd: 0, rejected_before_work: true });
    expect(p.upstream_error).toBeTruthy();
    expect((await getBudget(pool, id)).openHolds).toBe(0);
  });

  it("does not follow a redirect from the provider, so the key goes nowhere else", async () => {
    const { id, token } = await newProject(5);
    const res = await call(token, plain("redirect"));
    expect(res.status).toBe(502);
    expect(await listEvents(pool, id, "model.call")).toHaveLength(0);
    near((await getBudget(pool, id)).openHolds, PLAIN_HOLD);
  });

  it("answers 502, forwards nothing and opens no hold when the provider cannot be reached at all", async () => {
    const dead = createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl: await closedPortUrl(), profiles: PROFILES });
    const { server, url } = await listen(dead);
    try {
      const { id, token } = await newProject(5);
      const res = await callAt(url, token, plain());
      expect(res.status).toBe(502);
      expect(((await res.json()) as { error: { type: string } }).error.type).toBe("prompt_not_counted");
      expect(await kinds(id)).toEqual(["gateway.refused"]);
      expect(await listHolds(pool, id)).toHaveLength(0);
    } finally {
      server.close();
    }
  });
});

describe("holds: a call that ends without readable usage keeps its hold open", () => {
  // Marking these holds for the owner's list, and closing them, are packages 1.4 and 1.5.
  // What these tests check is the direction: nothing is released.
  const expectKept = async (id: string, reasonPart: string) => {
    const kept = await waitForEvents(id, "hold.kept", 1);
    expect(kept).toHaveLength(1);
    expect((kept[0]!.payload as { reason: string }).reason).toContain(reasonPart);
    expect(await listEvents(pool, id, "model.call")).toHaveLength(0);
    expect(await listEvents(pool, id, "hold.settled")).toHaveLength(0);
    const holds = await listHolds(pool, id);
    expect(holds).toHaveLength(1);
    expect(holds[0]!.state).toBe("open");
    return { budget: await getBudget(pool, id), kept: kept[0]!.payload as { amount_usd: number; seen: { usage: { input_tokens: number } } } };
  };

  it("a server error from the provider", async () => {
    const { id, token } = await newProject(5);
    expect((await call(token, plain("fail-500"))).status).toBe(500);
    const { budget } = await expectKept(id, "server error");
    near(budget.openHolds, PLAIN_HOLD);
    expect(budget.spent).toBe(0);
  });

  it("a stream the client abandoned part-way: the usage seen is written down and releases nothing", async () => {
    const { id, token } = await newProject(5);
    const controller = new AbortController();
    const res = await call(token, streamed("slow-stream"), "/v1/messages", {}, { signal: controller.signal });
    const reader = res.body!.getReader();
    await reader.read(); // first frame: message_start
    controller.abort();
    const { budget, kept } = await expectKept(id, "part-way");
    expect(kept.seen.usage.input_tokens).toBe(1000);
    near(budget.openHolds, kept.amount_usd);
    expect(budget.spent).toBe(0);
  });

  it("a successful answer with no usage block", async () => {
    const { id, token } = await newProject(5);
    expect((await call(token, plain("no-usage"))).status).toBe(200);
    const { budget } = await expectKept(id, "usage could not be read");
    near(budget.openHolds, PLAIN_HOLD);
  });

  it("a stream that ends cleanly without usage figures", async () => {
    const { id, token } = await newProject(5);
    const res = await call(token, streamed("stream-no-usage"));
    await res.text();
    await expectKept(id, "without usage figures");
  });

  it("the provider reachable for counting but not for the call itself: nothing was sent, and the record says so", async () => {
    // The call itself goes, through Node's own fetch, to a port where nothing listens: the connection is refused.
    const nobody = await closedPortUrl();
    const halfDead: typeof fetch = (input, init) => (String(input).endsWith("/v1/messages") ? fetch(nobody + "/v1/messages", init) : fetch(input, init));
    const { server, url } = await listen(createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, fetchImpl: halfDead, onFault: (m) => faults.push(m) }));
    try {
      const { id, token } = await newProject(5);
      const res = await callAt(url, token, plain());
      expect(res.status).toBe(502);
      expect(((await res.json()) as { error: { message: string } }).error.message).toBe("The gateway could not reach the model provider.");
      const { kept, budget } = await expectKept(id, "could not be reached");
      expect((kept as unknown as { reason: string }).reason).toBe("the provider could not be reached");
      expect((kept.seen as unknown as { error: { code: string } }).error.code).toBe("ECONNREFUSED");
      near(budget.openHolds, PLAIN_HOLD); // kept at its full amount
    } finally {
      server.close();
    }
  });

  it("a provider that reads the whole request and then drops the connection: the hold is kept, recorded as possibly billed, not as unreachable", async () => {
    let received = 0;
    // A stand-in for the call itself: it reads the whole request, then closes the connection without answering.
    const dropper = createHttpServer((req) => {
      req.resume();
      req.on("end", () => {
        received++;
        setTimeout(() => req.socket.destroy(), 20);
      });
    });
    await new Promise<void>((resolve) => dropper.listen(0, "127.0.0.1", () => resolve()));
    const dropUrl = `http://127.0.0.1:${(dropper.address() as AddressInfo).port}`;
    const toDropper: typeof fetch = (input, init) => (String(input).endsWith("/v1/messages") ? fetch(dropUrl + "/v1/messages", init) : fetch(input, init));
    const { server, url } = await listen(createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, fetchImpl: toDropper, onFault: (m) => faults.push(m) }));
    try {
      const { id, token } = await newProject(5);
      const res = await callAt(url, token, plain());
      expect(res.status).toBe(502);
      const message = ((await res.json()) as { error: { message: string } }).error.message;
      expect(message).toContain("failed after the request was sent, or may have been sent");
      expect(message).not.toMatch(/could not reach|unreachable/);
      expect(received).toBe(1); // the provider's stand-in did receive the whole call
      const { kept, budget } = await expectKept(id, "after the request was sent");
      expect((kept as unknown as { reason: string }).reason).toBe("the connection failed after the request was sent, or may have been sent; the provider may have billed it");
      expect((kept.seen as unknown as { error: { code: string } }).error.code).toBe("UND_ERR_SOCKET");
      near(budget.openHolds, PLAIN_HOLD); // kept at its full amount
      expect(budget.spent).toBe(0);
    } finally {
      server.close();
      dropper.close();
    }
  });
});

describe("holds: proof rows B1 to B6 of the design note", () => {
  it("B1: a hold is opened before the call is forwarded and settled to the actual cost", async () => {
    const { id, token } = await newProject(5);
    // Two calls. The stand-in looks in the database the moment each call reaches it.
    for (let i = 0; i < 2; i++) expect((await call(token, { ...plain(), metadata: { test: "note-open-holds", project: id } })).status).toBe(200);
    expect(openHoldsAtForward.get(id)).toEqual([1, 1]); // each call's hold was already open when the call was forwarded
    expect(await kinds(id)).toEqual(["hold.opened", "model.call", "hold.settled", "hold.opened", "model.call", "hold.settled"]);
    const opened = (await listEvents(pool, id, "hold.opened")).map(
      (e) =>
        e.payload as {
          hold_id: number;
          amount_usd: number;
          arithmetic: { counted_prompt_tokens: number; prompt_tokens_held: number; max_tokens: number; input_rate_usd_per_million: number; output_rate_usd_per_million: number; fast_mode_factor: number; input_part_usd: number; output_part_usd: number };
        },
    );
    const settled = (await listEvents(pool, id, "hold.settled")).map((e) => e.payload as { hold_id: number; amount_usd: number; actual_usd: number; returned_usd: number });
    expect(opened).toHaveLength(2);
    expect(settled).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const a = opened[i]!.arithmetic;
      expect(a).toMatchObject({ counted_prompt_tokens: 42, prompt_tokens_held: 42 + margin(42), max_tokens: PLAIN_MAX_TOKENS, input_rate_usd_per_million: 8, output_rate_usd_per_million: 20, fast_mode_factor: 1 });
      near(opened[i]!.amount_usd, (a.prompt_tokens_held * a.input_rate_usd_per_million + a.max_tokens * a.output_rate_usd_per_million) / 1e6);
      near(opened[i]!.amount_usd, PLAIN_HOLD);
      expect(settled[i]!.hold_id).toBe(opened[i]!.hold_id);
      near(settled[i]!.actual_usd, PLAIN_COST);
      expect(settled[i]!.actual_usd).toBeLessThanOrEqual(settled[i]!.amount_usd);
      near(settled[i]!.returned_usd, PLAIN_HOLD - PLAIN_COST);
    }
    const budget = await getBudget(pool, id);
    near(budget.spent, 2 * PLAIN_COST); // the difference is back in the budget
    expect(budget.openHolds).toBe(0);
    expect(await listEvents(pool, id, "hold.exceeded")).toHaveLength(0);
  });

  it("B2: a call whose hold does not fit is refused at the call: no hold, nothing forwarded", async () => {
    // Room for two calls' actual cost plus half a hold: the third call's hold does not fit.
    const { id, token } = await newProject(PLAIN_COST * 2 + PLAIN_HOLD * 0.5);
    expect((await call(token, plain())).status).toBe(200);
    expect((await call(token, plain())).status).toBe(200);
    const before = forwarded;
    const third = await call(token, plain());
    expect(third.status).toBe(402);
    const body = (await third.json()) as { error: { type: string; message: string } };
    expect(body.error.type).toBe("budget_reached");
    expect(body.error.message).toMatch(/has reached its budget of \$\d+\.\d\d \(spent \$\d+\.\d\d, with \$\d+\.\d\d held for work in progress or awaiting reconciliation; this call needed up to \$\d+\.\d\d\)/);
    expect(forwarded).toBe(before);
    const refused = await listEvents(pool, id, "gateway.refused");
    expect(refused).toHaveLength(1);
    const r = refused[0]!.payload as { reason: string; cap_usd: number; spent_usd: number; open_holds_usd: number; this_hold_usd: number };
    expect(r.reason).toBe("budget_reached");
    expect(r.spent_usd + r.open_holds_usd + r.this_hold_usd).toBeGreaterThan(r.cap_usd);
    expect(await listEvents(pool, id, "hold.opened")).toHaveLength(2);
    expect(await listHolds(pool, id)).toHaveLength(2);
  });

  it("B2: with calls arriving together against room for one hold, one is admitted, through one gateway or two", async () => {
    const second = await listen(createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, gatewayId: "gw_test_second", onFault: (m) => faults.push(m) }));
    try {
      const { id, token } = await newProject(PLAIN_HOLD * 1.5);
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) => callAt(i % 2 ? second.url : gatewayUrl, token, plain("slow-wait"))));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 402)).toHaveLength(5);
      expect(await listEvents(pool, id, "hold.opened")).toHaveLength(1);
      const b = await getBudget(pool, id);
      expect(b.spent + b.openHolds).toBeLessThanOrEqual(b.cap);
    } finally {
      second.server.close();
    }
  });

  it("B3: a prompt that cannot be counted is refused, with the reason named", async () => {
    const { id, token } = await newProject(5);
    for (const system of ["count-fail", "count-garbage"]) {
      const before = forwarded;
      const res = await call(token, plain(undefined, { system }));
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: { type: string; message: string } };
      expect(body.error.type).toBe("prompt_not_counted");
      expect(body.error.message).toMatch(/could not be counted/);
      expect(forwarded).toBe(before);
    }
    expect(await kinds(id)).toEqual(["gateway.refused", "gateway.refused"]);
    expect(((await listEvents(pool, id, "gateway.refused"))[0]!.payload as { reason: string }).reason).toBe("prompt_not_counted");
    expect(await listHolds(pool, id)).toHaveLength(0);
  });

  it("B4 (1): a model with a long-prompt rate is held at that rate when the prompt is at or near the threshold", async () => {
    const { id, token } = await newProject(5);
    const haiku = (count: number) => ({ model: "claude-haiku-5-5", max_tokens: 1000, system: `count:${count}`, messages: [] });
    expect((await call(token, haiku(99_900))).status).toBe(200); // under the threshold, but not by the margin
    expect((await call(token, haiku(1_000))).status).toBe(200); // far under it
    const [near100k, small] = (await listEvents(pool, id, "hold.opened")).map((e) => e.payload as { amount_usd: number; arithmetic: Record<string, unknown> });
    expect(near100k!.arithmetic).toMatchObject({ long_prompt_rates: true, input_rate_usd_per_million: 1, output_rate_usd_per_million: 2.5, long_prompt_threshold_tokens: 100_000 });
    near(near100k!.amount_usd, ((99_900 + margin(99_900)) * 1 + 1000 * 2.5) / 1e6);
    expect(small!.arithmetic).toMatchObject({ long_prompt_rates: false, input_rate_usd_per_million: 0.2, output_rate_usd_per_million: 0.5 });
    near(small!.amount_usd, ((1_000 + margin(1_000)) * 0.2 + 1000 * 0.5) / 1e6);
  });

  it("B4 (2): on a profile that allows fast mode, a model with a fast-mode price is held at twice the standard rates", async () => {
    const { id, token } = await newProject(5, "fast");
    expect((await call(token, plain())).status).toBe(200);
    const opened = (await listEvents(pool, id, "hold.opened"))[0]!.payload as { amount_usd: number; arithmetic: Record<string, unknown> };
    expect(opened.arithmetic).toMatchObject({ fast_mode_factor: 2, fast_mode_because: "the profile allows it" });
    near(opened.amount_usd, 2 * PLAIN_HOLD);
  });

  it("B5: a hold past its deadline is kept at its full amount, marked expired and unreconciled, and still counts", async () => {
    const quick = await listen(
      createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, gatewayId: "gw_test_quick", callTimeLimitMs: { plain: 150, stream: 150 }, holdDeadlineMarginMs: { plain: 100, stream: 100 }, onFault: (m) => faults.push(m) }),
    );
    try {
      const { id, token } = await newProject(PLAIN_HOLD * 1.5);
      const res = await callAt(quick.url, token, plain("very-slow"));
      expect(res.status).toBe(502); // cut off at the time limit
      const before = await getBudget(pool, id);
      near(before.openHolds, PLAIN_HOLD);
      expect((await expireHolds(pool, new Date(Date.now() - 60_000))).filter((h) => h.project_id === id)).toEqual([]); // not yet past its deadline
      await new Promise((r) => setTimeout(r, 300));
      const expired = (await expireHolds(pool)).filter((h) => h.project_id === id);
      expect(expired).toHaveLength(1);
      const hold = (await listHolds(pool, id))[0]!;
      expect(hold).toMatchObject({ state: "open", expired: true, unreconciled: true, actual_usd: null });
      near(Number(hold.amount_usd), PLAIN_HOLD);
      const ev = (await listEvents(pool, id, "hold.expired"))[0]!.payload as Record<string, unknown>;
      expect(ev).toMatchObject({ kept: true, unreconciled: true, still_open: true });
      const after = await getBudget(pool, id);
      near(after.openHolds, PLAIN_HOLD); // nothing was released
      expect(after.spent).toBe(0);
      expect((await callAt(quick.url, token, plain())).status).toBe(402); // and it still counts against the cap
      expect(await expireHolds(pool)).toEqual(expect.not.arrayContaining([expect.objectContaining({ project_id: id })])); // marked once
    } finally {
      quick.server.close();
    }
  });

  // Found by the review bot on 7ce5a33: the sweep that marks holds past their deadline runs every 30 seconds, so a
  // deadline can pass before the sweep has marked the hold. A settlement or a release that takes the project's lock in
  // that gap must still treat the hold as past its deadline. Each test below moves the deadline into the past in the
  // database, as if the lock had been waited for past it, and runs no sweep before the store is asked to end the hold.
  const holdPastItsDeadline = async (projectId: string, amountUsd: number) => {
    const o = await openHold(pool, { projectId, step: null, amountUsd, deadline: new Date(Date.now() + 60_000), gateway: "gw_test_store", arithmetic: {}, path: "/v1/messages" });
    if (!o.ok) throw new Error("hold not opened");
    // One second ago by the gateway's clock, the clock the sweep and the store judge deadlines by.
    await pool.query("update holds set deadline_at = $2 where id = $1", [o.hold.id, new Date(Date.now() - 1_000)]);
    return o.hold;
  };
  const outcome = async (projectId: string) => {
    const h = (await listHolds(pool, projectId))[0]!;
    const b = await getBudget(pool, projectId);
    return {
      hold: { state: h.state, expired: h.expired, unreconciled: h.unreconciled, actual_usd: h.actual_usd, closed: h.closed_at !== null },
      open_holds_usd: b.openHolds,
      spent_usd: b.spent,
      events: await kinds(projectId),
    };
  };

  it("B5: an answer that comes after the hold's deadline, before the sweep has marked it, does not settle it: the hold is marked expired there and then and kept at its full amount", async () => {
    const { id } = await newProject(5);
    const hold = await holdPastItsDeadline(id, 0.03);
    const r = await settleHold(pool, { projectId: id, holdId: hold.id, step: null, actualUsd: 0.001, call: { status: 200 } });
    expect({ settled: r.settled, ...(await outcome(id)) }).toEqual({
      settled: false,
      hold: { state: "open", expired: true, unreconciled: true, actual_usd: null, closed: false },
      open_holds_usd: 0.03, // nothing was released
      spent_usd: 0,
      events: ["hold.opened", "hold.expired", "hold.kept"],
    });
    expect((await listEvents(pool, id, "hold.expired"))[0]!.payload).toMatchObject({ hold_id: Number(hold.id), amount_usd: 0.03, kept: true, unreconciled: true, still_open: true });
    // The answer is written down for the owner, with the cost as read; it settles nothing.
    expect((await listEvents(pool, id, "hold.kept"))[0]!.payload).toMatchObject({ hold_id: Number(hold.id), amount_usd: 0.03, reason: "answer arrived after the hold expired", seen: { status: 200, cost_usd_as_read: 0.001 } });
    expect((await expireHolds(pool)).filter((h) => h.project_id === id)).toEqual([]); // the sweep, when it comes, has nothing left to mark here
  });

  it("B5: a hold past its deadline that the sweep has not yet marked is not released as never sent either: it is marked expired there and then and kept at its full amount", async () => {
    const { id } = await newProject(5);
    const hold = await holdPastItsDeadline(id, 0.02);
    const released = await releaseUnsentHold(pool, { projectId: id, holdId: hold.id, step: null, reason: "the caller left before the call was forwarded to the provider (test)" });
    expect({ released, ...(await outcome(id)) }).toEqual({
      released: false,
      hold: { state: "open", expired: true, unreconciled: true, actual_usd: null, closed: false },
      open_holds_usd: 0.02, // nothing was released
      spent_usd: 0,
      events: ["hold.opened", "hold.expired"],
    });
    expect((await expireHolds(pool)).filter((h) => h.project_id === id)).toEqual([]); // the sweep, when it comes, has nothing left to mark here
  });

  it("B6: holds are database rows: a gateway that starts finds the hold an earlier one left open, and keeps it", async () => {
    const first = await listen(createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, gatewayId: "gw_test_first", onFault: (m) => faults.push(m) }));
    const { id, token } = await newProject(PLAIN_HOLD * 1.5);
    // A call is in flight when the caller leaves and the first gateway's server is closed. Both gateways run in this
    // one process, so the first one's request handler can still record the call's ending after the second has started.
    const controller = new AbortController();
    const inFlight = callAt(first.url, token, plain("very-slow"), "/v1/messages", {}, { signal: controller.signal }).catch(() => null);
    await waitForEvents(id, "hold.opened", 1);
    controller.abort();
    await inFlight;
    await new Promise<void>((resolve) => first.server.close(() => resolve()));
    const before = await getBudget(pool, id);
    near(before.openHolds, PLAIN_HOLD);

    // A new gateway starts on the same database, in this same process (the next test runs the first gateway as a process of its own).
    const keeper = await startHoldKeeper(pool, "gw_test_restarted");
    keeper.stop();
    expect(keeper.found).toBeGreaterThanOrEqual(1);
    // A further start finds the same hold still open and does not write the event again.
    (await startHoldKeeper(pool, "gw_test_restarted_again")).stop();
    const found = await listEvents(pool, id, "hold.found_at_startup");
    expect(found).toHaveLength(1);
    expect(found[0]!.payload).toMatchObject({ opened_by: "gw_test_first", found_by: "gw_test_restarted", kept: true, still_open: true });
    const hold = (await listHolds(pool, id))[0]!;
    expect(hold.state).toBe("open");
    near(Number(hold.amount_usd), PLAIN_HOLD);
    const after = await getBudget(pool, id);
    expect(after.spent + after.openHolds).toBe(before.spent + before.openHolds);
    // The restarted gateway still counts it: a new call does not fit.
    const restarted = await listen(createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, gatewayId: "gw_test_restarted", onFault: (m) => faults.push(m) }));
    try {
      expect((await callAt(restarted.url, token, plain())).status).toBe(402);
    } finally {
      restarted.server.close();
    }
  });

  it("B6: a gateway process that stops cleanly with a call in flight leaves its hold open; a gateway started afterwards finds it, keeps it at its full amount and still counts it", async () => {
    // Second re-read of 13 Nov 2026: the first gateway runs as a process of its own (test/b6-gateway-process.ts),
    // started with tsx loaded into Node (`node --import tsx`), on this test database and against this file's stand-in.
    const { id, token } = await newProject(PLAIN_HOLD * 1.5);
    const child = spawn(process.execPath, ["--import", "tsx", "test/b6-gateway-process.ts"], {
      cwd: BUILDER_DIR,
      env: { ...process.env, BUILDER_TEST_DATABASE_URL: TEST_DB_URL, B6_UPSTREAM_URL: upstreamUrl, B6_GATEWAY_ID: "gw_test_b6_process", B6_MODEL_KEY: REAL_KEY },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const said: Array<Record<string, unknown>> = [];
    let stderr = "";
    let partial = "";
    child.stdout.on("data", (d: Buffer) => {
      partial += d.toString();
      const parts = partial.split("\n");
      partial = parts.pop() ?? "";
      for (const line of parts) if (line.trim()) said.push(JSON.parse(line) as Record<string, unknown>);
    });
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    // "close", not "exit": Node emits "close" once the process has ended and its output streams have closed,
    // so every line it printed has been read by then; at "exit" they may still be open (Node's child_process documentation).
    const exited = new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code)));
    const until = async (what: string, ok: () => boolean) => {
      for (let i = 0; i < 300 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
      if (!ok()) throw new Error(`the gateway process did not reach "${what}": ${JSON.stringify(said)} ${stderr}`);
    };
    try {
      await until("listening", () => said.some((s) => typeof s["listening"] === "string"));
      const childUrl = said.find((s) => typeof s["listening"] === "string")!["listening"] as string;
      // A call through the gateway process, to a stand-in that does not answer it.
      const before = forwarded;
      const inFlight = callAt(childUrl, token, plain("never-answers")).then(
        (r) => `answered ${r.status}`,
        () => "the connection closed with no answer",
      );
      await until("the call reached the stand-in", () => forwarded === before + 1);
      expect((await listHolds(pool, id))[0]).toMatchObject({ state: "open", gateway: "gw_test_b6_process" });
      // The gateway process is told to stop, as a service is: it stops taking calls, gives calls in progress
      // 300 ms, closes its database connections and exits with code 0.
      child.kill("SIGTERM");
      // It stops taking calls: once it says it is stopping, a new call to it has its connection refused,
      // before the process has said it stopped (that comes only after the 300 ms).
      await until("stopping", () => said.some((s) => s["stopping"]));
      const afterStop = await callAt(childUrl, token, plain()).then(
        (r) => `answered ${r.status}`,
        (e: unknown) => `refused (${String((e as { cause?: { code?: unknown } }).cause?.code)})`,
      );
      const stoppedAlreadySaid = said.some((s) => s["stopped"]);
      expect(afterStop).toBe("refused (ECONNREFUSED)");
      expect(stoppedAlreadySaid).toBe(false);
      expect(await exited).toBe(0);
      expect(said.find((s) => s["stopping"])).toEqual({ stopping: { calls_in_progress: 1 } });
      // Each value here is read by the process as it stops, not written in (test/b6-gateway-process.ts).
      expect(said.at(-1)).toEqual({ stopped: { calls_in_progress: 1, every_connection_ended: false, still_listening: false, database_connections_open: 0 } });
      expect(said.filter((s) => s["fault"])).toEqual([]);
      expect(await inFlight).toBe("the connection closed with no answer");
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
    }

    // The process has exited. The hold it opened is open at its full amount, with nothing written about the call's ending.
    expect(await kinds(id)).toEqual(["hold.opened"]);
    const held = (await listHolds(pool, id))[0]!;
    expect(held).toMatchObject({ state: "open", gateway: "gw_test_b6_process", kept_reason: null, seen_at_startup: false, actual_usd: null });
    near(Number(held.amount_usd), PLAIN_HOLD);
    const before = await getBudget(pool, id);
    expect(before.spent).toBe(0);
    near(before.openHolds, PLAIN_HOLD);

    // A gateway starts afterwards on the same database, in this test's process: first the look for open holds, as main.ts does.
    const keeper = await startHoldKeeper(pool, "gw_test_b6_after");
    keeper.stop();
    expect(keeper.found).toBeGreaterThanOrEqual(1);
    const found = await listEvents(pool, id, "hold.found_at_startup");
    expect(found).toHaveLength(1);
    expect(found[0]!.payload).toMatchObject({ opened_by: "gw_test_b6_process", found_by: "gw_test_b6_after", kept: true, still_open: true });
    near((found[0]!.payload as { amount_usd: number }).amount_usd, PLAIN_HOLD);
    const hold = (await listHolds(pool, id))[0]!;
    expect(hold).toMatchObject({ state: "open", seen_at_startup: true, actual_usd: null });
    near(Number(hold.amount_usd), PLAIN_HOLD);
    const after = await getBudget(pool, id);
    expect(after.spent + after.openHolds).toBe(before.spent + before.openHolds);
    // It still counts the hold: a new call through it does not fit, and nothing reaches the stand-in.
    const later = await listen(createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, gatewayId: "gw_test_b6_after", onFault: (m) => faults.push(m) }));
    try {
      const forwardedBefore = forwarded;
      expect((await callAt(later.url, token, plain())).status).toBe(402);
      expect(forwarded).toBe(forwardedBefore);
    } finally {
      later.server.close();
    }
    expect(await kinds(id)).toEqual(["hold.opened", "hold.found_at_startup", "gateway.refused"]);
  });
});

/**
 * Proof rows B15 to B19 of the design note (section 7.2, added 13 Nov 2026 by the owner's answer to
 * his question 1, as Claude Code reads it): one row for each case of known gap 41 that package 1.2 handles, by refusing the
 * request, by keeping the hold, or by a margin on the token count. Each test names its case as
 * gap 41 does. Against a stand-in: what the gateway does, not how the real provider bills.
 */
describe("holds: proof rows B15 to B19 of the design note (the known limits of the hold, known gap 41)", () => {
  /** A request refused before anything is forwarded: the reason named, the message shown, no hold. */
  const refusedBeforeForwarding = async (id: string, token: string, body: unknown, reason: string, messagePart: RegExp) => {
    const before = forwarded;
    const holdsBefore = (await listHolds(pool, id)).length;
    const refusedBefore = (await listEvents(pool, id, "gateway.refused")).length;
    const res = await call(token, body);
    expect(res.status).toBe(400);
    const b = (await res.json()) as { error: { type: string; message: string } };
    expect(b.error.message).toMatch(messagePart);
    expect(forwarded).toBe(before); // nothing reached the provider
    const refused = await listEvents(pool, id, "gateway.refused");
    expect(refused).toHaveLength(refusedBefore + 1);
    expect((refused.at(-1)!.payload as { reason: string }).reason).toBe(reason);
    expect(await listHolds(pool, id)).toHaveLength(holdsBefore); // no hold opened
    return refused.at(-1)!.payload as Record<string, unknown>;
  };

  it('B15: inference_geo "us" (1.1 times every rate): a request that sets it is refused before anything is forwarded', async () => {
    const { id, token } = await newProject(5);
    const p = await refusedBeforeForwarding(id, token, plain(undefined, { inference_geo: "us" }), "inference_geo_not_allowed", /inference_geo/);
    expect(p).toMatchObject({ inference_geo: "us" });
    // The same request without it (the default routing) is forwarded.
    expect((await call(token, plain())).status).toBe(200);
    expect(await listHolds(pool, id)).toHaveLength(1);
  });

  it("B16: the token count being an estimate: a margin is added to the counted prompt, and a bill a little above the count stays within the hold", async () => {
    const { id, token } = await newProject(5);
    // The margin, by its own figures (5% of the count, rounded up, plus 200 tokens), written out here, not taken from the code.
    expect((await call(token, plain())).status).toBe(200); // counted as 42
    expect((await call(token, plain("bill-above-count", { system: "count:10000" }))).status).toBe(200);
    const opened = (await listEvents(pool, id, "hold.opened")).map((e) => e.payload as { hold_id: number; amount_usd: number; arithmetic: Record<string, number> });
    expect(opened[0]!.arithmetic).toMatchObject({ counted_prompt_tokens: 42, count_margin_tokens: 203, prompt_tokens_held: 245 });
    expect(opened[1]!.arithmetic).toMatchObject({ counted_prompt_tokens: 10_000, count_margin_tokens: 700, prompt_tokens_held: 10_700 });
    near(opened[0]!.amount_usd, (245 * 8 + PLAIN_MAX_TOKENS * 20) / 1e6);
    near(opened[1]!.amount_usd, (10_700 * 8 + PLAIN_MAX_TOKENS * 20) / 1e6);
    // The stand-in billed 10,400 prompt tokens (4% above its count) as one-hour cache writes, and all 400 output tokens.
    const call2 = (await listEvents(pool, id, "model.call"))[1]!.payload as { usage: Record<string, number>; cost_usd: number };
    expect(call2.usage).toMatchObject({ cache_creation_input_tokens: 10_400, cache_creation_1h_tokens: 10_400, output_tokens: PLAIN_MAX_TOKENS });
    near(call2.cost_usd, (10_400 * 8 + PLAIN_MAX_TOKENS * 20) / 1e6);
    // Arithmetic only: without the margin, the hold would have been below this bill.
    expect(call2.cost_usd).toBeGreaterThan((10_000 * 8 + PLAIN_MAX_TOKENS * 20) / 1e6);
    const settled = (await listEvents(pool, id, "hold.settled")).map((e) => e.payload as { hold_id: number; amount_usd: number; actual_usd: number });
    expect(settled[1]!.hold_id).toBe(opened[1]!.hold_id);
    expect(settled[1]!.actual_usd).toBeLessThanOrEqual(settled[1]!.amount_usd);
    expect(await listEvents(pool, id, "hold.exceeded")).toHaveLength(0);
  });

  it("B17: server-side tools billed on top of tokens: a request that includes one, or asks for tool servers, is refused before anything is forwarded", async () => {
    const { id, token } = await newProject(5);
    const web = await refusedBeforeForwarding(id, token, plain(undefined, { tools: [{ type: "web_search_20260209", name: "web_search" }] }), "server_tool_not_allowed", /Tools the provider runs itself/);
    expect(web).toMatchObject({ tool_type: "web_search_20260209" });
    await refusedBeforeForwarding(id, token, plain(undefined, { tools: [{ name: "read_file", input_schema: { type: "object" } }, { type: "code_execution_20260120", name: "code_execution" }] }), "server_tool_not_allowed", /Tools the provider runs itself/);
    const mcp = await refusedBeforeForwarding(id, token, plain(undefined, { mcp_servers: [{ type: "url", url: "https://example.invalid", name: "x" }] }), "server_tool_not_allowed", /tool servers/);
    expect(mcp).toMatchObject({ field: "mcp_servers" });
    // The caller's own tools, which the caller runs, are forwarded.
    expect((await call(token, plain(undefined, { tools: [{ name: "read_file", input_schema: { type: "object" } }, { type: "bash_20250124", name: "bash" }] }))).status).toBe(200);
  });

  it("B18: fast mode on a model whose price is assumed: a request for it is refused before anything is forwarded, even where the profile allows fast mode", async () => {
    const { id, token } = await newProject(5, "fast");
    for (const model of ["claude-sonnet-5-5", "claude-haiku-5-5"]) {
      const p = await refusedBeforeForwarding(id, token, { model, max_tokens: 100, messages: [], speed: "fast" }, "fast_mode_not_priced", /fast-mode price is not in the gateway's price table/);
      expect(p).toMatchObject({ model });
    }
    // A model whose fast-mode price is listed is forwarded, held at twice the standard rates.
    expect((await call(token, plain(undefined, { speed: "fast" }))).status).toBe(200);
    const opened = (await listEvents(pool, id, "hold.opened"))[0]!.payload as { amount_usd: number; arithmetic: Record<string, unknown> };
    expect(opened.arithmetic).toMatchObject({ model: "claude-opus-5-5", fast_mode_factor: 2, fast_mode_because: "the request asks for it" });
    near(opened.amount_usd, 2 * PLAIN_HOLD);
  });

  it("B19: what happens to a hold after an error answer: released only when the provider's own answer shows the request was rejected before any work, kept in every other case", async () => {
    // Released: the provider's own error, of a type that means it turned the request away before doing any work.
    for (const [mode, status] of [["fail-400", 400], ["fail-429", 429]] as const) {
      const { id, token } = await newProject(5);
      expect((await call(token, plain(mode))).status).toBe(status);
      expect(await kinds(id)).toEqual(["hold.opened", "model.call", "hold.settled"]);
      expect((await listEvents(pool, id, "model.call"))[0]!.payload).toMatchObject({ status, cost_usd: 0, rejected_before_work: true });
      expect((await listEvents(pool, id, "hold.settled"))[0]!.payload).toMatchObject({ actual_usd: 0 });
      const b = await getBudget(pool, id);
      expect(b.openHolds).toBe(0);
      expect(b.spent).toBe(0);
    }
    // Kept: a server error, an overloaded provider, an error type not on the list, and a 400 not in the provider's error shape.
    for (const [mode, status, reasonPart] of [
      ["fail-500", 500, "server error"],
      ["fail-529", 529, "server error"],
      ["fail-408", 408, "not one of the provider's own rejections"],
      ["fail-400-other", 400, "not one of the provider's own rejections"],
    ] as const) {
      const { id, token } = await newProject(PLAIN_HOLD * 1.5);
      expect((await call(token, plain(mode))).status).toBe(status);
      expect(await kinds(id)).toEqual(["hold.opened", "hold.kept"]);
      const kept = (await listEvents(pool, id, "hold.kept"))[0]!.payload as { reason: string; amount_usd: number };
      expect(kept.reason).toContain(reasonPart);
      near(kept.amount_usd, PLAIN_HOLD);
      expect((await listHolds(pool, id))[0]).toMatchObject({ state: "open", actual_usd: null });
      const b = await getBudget(pool, id);
      near(b.openHolds, PLAIN_HOLD); // kept at its full amount
      expect(b.spent).toBe(0);
      expect((await call(token, plain())).status).toBe(402); // and it still counts: a second call does not fit
    }
  });
});

describe("holds: found by review, and kept fixed", () => {
  const keptOpen = async (id: string, reasonPart: string) => {
    const kept = await waitForEvents(id, "hold.kept", 1);
    expect(kept.length).toBeGreaterThanOrEqual(1);
    expect((kept[0]!.payload as { reason: string }).reason).toContain(reasonPart);
    expect(await listEvents(pool, id, "hold.settled")).toHaveLength(0);
    expect(await listEvents(pool, id, "model.call")).toHaveLength(0);
    const b = await getBudget(pool, id);
    near(b.openHolds, PLAIN_HOLD);
    expect(b.spent).toBe(0);
    expect((await listHolds(pool, id))[0]).toMatchObject({ state: "open", actual_usd: null });
  };

  it("a usage block with one field that is not a count releases nothing: text, a negative number, a fraction", async () => {
    for (const mode of ["bad-usage", "negative-usage", "fraction-usage"]) {
      const { id, token } = await newProject(PLAIN_HOLD * 1.5);
      expect((await call(token, plain(mode))).status).toBe(200);
      await keptOpen(id, "usage could not be read");
      expect((await call(token, plain())).status).toBe(402); // the hold still counts: a second call does not fit
    }
  });

  it("a usage block that itemises several attempts is not taken as the whole bill", async () => {
    const { id, token } = await newProject(5);
    expect((await call(token, plain("iterations"))).status).toBe(200);
    await keptOpen(id, "usage could not be read");
  });

  it("an answer from a model with no price keeps the hold", async () => {
    const { id, token } = await newProject(5);
    expect((await call(token, plain("served-unknown"))).status).toBe(200);
    await keptOpen(id, "no price");
  });

  it("an error answer settles at nothing only when it is the provider's own rejection before work", async () => {
    const rejected = await newProject(5);
    expect((await call(rejected.token, plain("fail-429"))).status).toBe(429);
    expect((await listEvents(pool, rejected.id, "model.call"))[0]!.payload).toMatchObject({ status: 429, cost_usd: 0, rejected_before_work: true });
    expect((await getBudget(pool, rejected.id)).openHolds).toBe(0);
    for (const mode of ["fail-408", "fail-400-other"]) {
      const { id, token } = await newProject(5);
      await call(token, plain(mode));
      await keptOpen(id, "not one of the provider's own rejections");
    }
  });

  it("refuses request fields outside its list, and beta features it was not told to allow", async () => {
    for (const extra of [{ thread: { type: "continue" } }, { fallbacks: [{ model: "claude-haiku-5-5" }] }, { service_tier: "priority" }, { container: "c_1" }, { context_management: {} }, { output_config: {} }]) {
      const { id, token } = await newProject(5);
      const before = forwarded;
      expect((await call(token, plain(undefined, extra))).status).toBe(400);
      expect(forwarded).toBe(before);
      expect(((await listEvents(pool, id, "gateway.refused"))[0]!.payload as { reason: string }).reason).toBe("field_not_allowed");
      expect(await listHolds(pool, id)).toHaveLength(0);
    }
    const { id, token } = await newProject(5);
    const before = forwarded;
    expect((await call(token, plain(), "/v1/messages", { "anthropic-beta": "some-beta-2026-01-01" })).status).toBe(400);
    expect(forwarded).toBe(before);
    expect(((await listEvents(pool, id, "gateway.refused"))[0]!.payload as { reason: string }).reason).toBe("beta_not_allowed");
    const lenient = await listen(createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, allowedBetas: ["some-beta-2026-01-01"], onFault: (m) => faults.push(m) }));
    try {
      expect((await callAt(lenient.url, token, plain(), "/v1/messages", { "anthropic-beta": "some-beta-2026-01-01" })).status).toBe(200);
      expect((await callAt(lenient.url, token, plain(), "/v1/messages", { "anthropic-beta": "some-beta-2026-01-01, another-beta" })).status).toBe(400);
    } finally {
      lenient.server.close();
    }
  });

  it("forwards the body as it read it: a repeated key cannot show the gateway one value and the provider another", async () => {
    const { id, token } = await newProject(5);
    const raw = `{"model":"claude-opus-5-5","max_tokens":128000,"max_tokens":${PLAIN_MAX_TOKENS},"messages":[{"role":"user","content":"a long prompt the count would never see"}],"messages":[]}`;
    const res = await fetch(gatewayUrl + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": token }, body: raw });
    expect(res.status).toBe(200);
    expect(lastForwardedBody).not.toContain("128000");
    expect(lastForwardedBody).not.toContain("a long prompt");
    expect(JSON.parse(lastForwardedBody)).toMatchObject({ max_tokens: PLAIN_MAX_TOKENS, messages: [] });
    expect((await listEvents(pool, id, "hold.opened"))[0]!.payload).toMatchObject({ arithmetic: { max_tokens: PLAIN_MAX_TOKENS } });
  });

  it("does not store or relay the real key when the provider's error echoes it", async () => {
    const { id, token } = await newProject(5);
    const res = await call(token, plain("echo-key-500"));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(REAL_KEY);
    expect(JSON.stringify(await listEvents(pool, id))).not.toContain(REAL_KEY);
    expect(JSON.stringify(await listEvents(pool, id))).toContain("[redacted]");
  });

  it("a bill above the hold is charged in full, recorded as a breach, and raises a fault; since package 1.4c it also freezes the project, so the next call is refused with nothing forwarded", async () => {
    // The stand-in serves fast mode although the request did not ask and the profile does not allow it.
    const breaches: string[] = [];
    const overHold = () => breaches.filter((m) => m.includes("cost more than its hold")).length;
    const g = await listen(createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, onFault: (m) => breaches.push(m) }));
    try {
      // (1) Extended after the review of 13 Nov 2026: a cap with room for this one hold and no more.
      // The hold is (42 + 203) x $8 + 300 x $20 per million = $0.00796, within the cap of $0.008.
      const tight = await newProject(0.008);
      const res = await callAt(g.url, tight.token, { ...plain("fast-1h"), max_tokens: 300 });
      expect(res.status).toBe(200);
      const exceeded = await listEvents(pool, tight.id, "hold.exceeded");
      expect(exceeded).toHaveLength(1);
      const p = exceeded[0]!.payload as { amount_usd: number; actual_usd: number };
      near(p.amount_usd, (245 * 8 + 300 * 20) / 1e6);
      expect(p.actual_usd).toBeGreaterThan(p.amount_usd);
      const b = await getBudget(pool, tight.id);
      near(b.spent, p.actual_usd); // the truth is what is charged
      expect(b.spent).toBeGreaterThan(b.cap); // one bill above its hold has taken spend above the cap
      expect(overHold()).toBe(1);
      // No room is left either; until package 1.4c the next call was refused at admission for that (budget_reached).
      // Since 1.4c the freeze written with the bill refuses it first, before its counting call.
      const tightNext = await callAt(g.url, tight.token, plain());
      expect(tightNext.status).toBe(402);
      expect(((await tightNext.json()) as { error: { type: string } }).error.type).toBe("project_frozen");
      // (2) Until package 1.4c the fault stopped nothing: on a project with room left, the call after the breach was
      // admitted as usual. Since 1.4c (the owner's answer to question 17, (a)) the project is frozen with the bill:
      // the call after it is refused as frozen, and nothing is forwarded.
      const roomy = await newProject(5);
      expect((await callAt(g.url, roomy.token, { ...plain("fast-1h"), max_tokens: 300 })).status).toBe(200);
      expect(await listEvents(pool, roomy.id, "hold.exceeded")).toHaveLength(1);
      expect(overHold()).toBe(2);
      const frozen = (await listEvents(pool, roomy.id, "project.frozen")).map((e) => e.payload);
      expect(frozen).toEqual([expect.objectContaining({ kind: "bill_above_hold", hold_id: (await listEvents(pool, roomy.id, "hold.exceeded"))[0]!.payload["hold_id"] })]);
      const sent = forwarded;
      const roomyNext = await callAt(g.url, roomy.token, plain());
      expect(roomyNext.status).toBe(402);
      expect(((await roomyNext.json()) as { error: { type: string } }).error.type).toBe("project_frozen");
      expect(forwarded).toBe(sent);
      expect(await listEvents(pool, roomy.id, "hold.settled")).toHaveLength(1);
    } finally {
      g.server.close();
    }
  });

  it("a streamed call that reaches the time limit keeps its hold", async () => {
    const quick = await listen(createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, callTimeLimitMs: { plain: 200, stream: 200 }, holdDeadlineMarginMs: { plain: 100, stream: 100 }, onFault: (m) => faults.push(m) }));
    try {
      const { id, token } = await newProject(5);
      const res = await callAt(quick.url, token, streamed("slow-stream"));
      await res.text().catch(() => "");
      const kept = await waitForEvents(id, "hold.kept", 1);
      expect((kept[0]!.payload as { reason: string }).reason).toContain("time limit");
      expect(await listEvents(pool, id, "hold.settled")).toHaveLength(0);
      expect((await listHolds(pool, id))[0]!.state).toBe("open");
    } finally {
      quick.server.close();
    }
  });

  it("marking overdue holds while calls are being admitted does not deadlock", async () => {
    const quick = await listen(createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, callTimeLimitMs: { plain: 60, stream: 60 }, holdDeadlineMarginMs: { plain: 1, stream: 1 }, onFault: (m) => faults.push(m) }));
    try {
      const projects = await Promise.all(Array.from({ length: 10 }, () => newProject(5)));
      await Promise.all(projects.map((p) => callAt(quick.url, p.token, plain("very-slow")))); // each leaves an overdue hold
      await new Promise((r) => setTimeout(r, 80));
      for (let round = 0; round < 3; round++) {
        const results = await Promise.all([expireHolds(pool), ...projects.map((p) => call(p.token, plain())), expireHolds(pool)]);
        for (const r of results.slice(1, -1)) expect((r as Response).status).toBe(200);
      }
    } finally {
      quick.server.close();
    }
  });

  it("refuses a cost that is not a real, non-negative amount at the database as well", async () => {
    const { id, token } = await newProject(5);
    expect((await call(token, plain("no-usage"))).status).toBe(200);
    const hold = (await listHolds(pool, id))[0]!;
    await expect(pool.query("update holds set state = 'settled', closed_at = now(), actual_usd = 'NaN' where id = $1", [hold.id])).rejects.toThrow(/holds_actual_is_a_number/);
    await expect(pool.query("update holds set state = 'settled', closed_at = now(), actual_usd = -1 where id = $1", [hold.id])).rejects.toThrow(/holds_actual_is_a_number/);
  });
});

describe("holds: found by the second review, and kept fixed", () => {
  const keptOnly = async (id: string, reasonPart: string) => {
    const kept = await waitForEvents(id, "hold.kept", 1);
    expect(kept.length).toBeGreaterThanOrEqual(1);
    expect((kept[0]!.payload as { reason: string }).reason).toContain(reasonPart);
    expect(await listEvents(pool, id, "hold.settled")).toHaveLength(0);
    expect(await listEvents(pool, id, "model.call")).toHaveLength(0);
    const holds = await listHolds(pool, id);
    expect(holds[0]).toMatchObject({ state: "open", actual_usd: null });
    const b = await getBudget(pool, id);
    expect(b.spent).toBe(0);
    near(b.openHolds, Number(holds[0]!.amount_usd));
  };

  it("a stream is settled only when the provider's end-of-message marker was seen and no error event was", async () => {
    for (const [mode, reason] of [["stream-no-stop", "end-of-message marker"], ["stream-error-event", "error inside the stream"]] as const) {
      const { id, token } = await newProject(5);
      const res = await call(token, streamed(mode));
      await res.text();
      await keptOnly(id, reason);
    }
  });

  it("a stream whose figures cannot both be right keeps its hold: two starts, or a running total that falls", async () => {
    for (const mode of ["stream-two-starts", "stream-falling-output"]) {
      const { id, token } = await newProject(5);
      const res = await call(token, streamed(mode));
      await res.text();
      await keptOnly(id, "usage figures that could be read");
    }
  });

  it("usage that points to a charge outside the token rates, or cannot be right, keeps the hold", async () => {
    for (const mode of ["odd-speed", "cache-mismatch", "server-tool-usage", "priority-tier", "zero-usage"]) {
      const { id, token } = await newProject(5);
      expect((await call(token, plain(mode))).status).toBe(200);
      await keptOnly(id, "usage could not be read");
    }
  });

  it("the lock holds whatever the database's default isolation level: 30 calls at once, room for one hold", async () => {
    const strictPool = new (await import("pg")).default.Pool({ connectionString: TEST_DB_URL, options: "-c default_transaction_isolation=repeatable\\ read", max: 20 });
    const a = await listen(createGateway({ pool: strictPool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, gatewayId: "gw_test_rr_a", onFault: (m) => faults.push(m) }));
    const b = await listen(createGateway({ pool: strictPool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, gatewayId: "gw_test_rr_b", onFault: (m) => faults.push(m) }));
    try {
      expect((await strictPool.query("show default_transaction_isolation")).rows[0]).toEqual({ default_transaction_isolation: "repeatable read" });
      const { id, token } = await newProject(PLAIN_HOLD * 1.5);
      const results = await Promise.all(Array.from({ length: 30 }, (_, i) => callAt(i % 2 ? a.url : b.url, token, plain("slow-wait"))));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 402)).toHaveLength(29);
      expect(await listEvents(pool, id, "hold.opened")).toHaveLength(1);
    } finally {
      a.server.close();
      b.server.close();
      await strictPool.end();
    }
  });

  it("the store refuses to settle at an amount that is not a real, non-negative number, and does not settle a kept hold", async () => {
    const { id, token } = await newProject(5);
    expect((await call(token, plain("no-usage"))).status).toBe(200); // leaves a kept, open hold
    const hold = (await listHolds(pool, id))[0]!;
    const r = await settleHold(pool, { projectId: id, holdId: hold.id, step: null, actualUsd: 0.001, call: {} });
    expect(r.settled).toBe(false);
    const fresh = await newProject(5);
    const opened = await openHold(pool, { projectId: fresh.id, step: null, amountUsd: 0.01, deadline: new Date(Date.now() + 60_000), gateway: "gw_test_store", arithmetic: {}, path: "/v1/messages" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1e8]) {
      expect((await settleHold(pool, { projectId: fresh.id, holdId: opened.hold.id, step: null, actualUsd: bad, call: {} })).settled).toBe(false);
    }
    expect((await listHolds(pool, fresh.id))[0]).toMatchObject({ state: "open", actual_usd: null });
    expect(await listEvents(pool, fresh.id, "model.call")).toHaveLength(0);
    near((await getBudget(pool, fresh.id)).openHolds, 0.01);
  });

  it("the budget does not count as spent a call whose hold is open, or a cost that is not a real amount", async () => {
    const { id } = await newProject(5);
    const opened = await openHold(pool, { projectId: id, step: null, amountUsd: 0.01, deadline: new Date(Date.now() + 60_000), gateway: "gw_test_store", arithmetic: {}, path: "/v1/messages" });
    if (!opened.ok) throw new Error("hold not opened");
    await pool.query("insert into events(project_id, kind, payload) values ($1, 'model.call', $2), ($1, 'model.call', $3)", [id, JSON.stringify({ cost_usd: -3.99998 }), JSON.stringify({ cost_usd: 0.5, hold_id: Number(opened.hold.id) })]);
    const b = await getBudget(pool, id);
    expect(b.spent).toBe(0);
    near(b.openHolds, 0.01);
  });

  it("forwards a fixed list of headers and nothing after a question mark in the address", async () => {
    let seen: Record<string, string> = {};
    const spy: typeof fetch = (input, init) => {
      if (String(input).endsWith("/v1/messages")) seen = Object.fromEntries(new Headers(init?.headers).entries());
      return fetch(input, init);
    };
    const g = await listen(createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, fetchImpl: spy, onFault: (m) => faults.push(m) }));
    try {
      const { id, token } = await newProject(5);
      const res = await callAt(g.url, token, plain(), "/v1/messages", { cookie: "a=b", "x-anything": "1", "anthropic-foo": "bar", "x-forwarded-for": "10.0.0.1", "proxy-authorization": "Basic xyz" });
      expect(res.status).toBe(200);
      const allowed = ["accept", "anthropic-beta", "anthropic-version", "content-type", "user-agent", "x-api-key"];
      for (const name of Object.keys(seen)) expect(allowed).toContain(name);
      for (const name of ["cookie", "x-anything", "anthropic-foo", "x-forwarded-for", "proxy-authorization"]) expect(seen[name]).toBeUndefined();
      expect(seen["x-api-key"]).toBe(REAL_KEY);
      const before = forwarded;
      const q = await callAt(g.url, token, plain(), "/v1/messages?beta=true&service_tier=priority");
      expect(q.status).toBe(400);
      expect(forwarded).toBe(before);
      expect(((await listEvents(pool, id, "gateway.refused")).at(-1)!.payload as { reason: string }).reason).toBe("query_not_allowed");
    } finally {
      g.server.close();
    }
  });

  it("keeps the key out of the log and out of what is passed back, wherever an answer echoes it", async () => {
    for (const mode of ["echo-key-model", "echo-key-header", "echo-key-escaped-500"]) {
      const { id, token } = await newProject(5);
      const res = await call(token, plain(mode));
      res.headers.forEach((v) => expect(v).not.toContain(REAL_KEY));
      const text = await res.text();
      expect(text).not.toContain(REAL_KEY);
      // Read as the caller would read it, too: a JSON body is parsed before it is looked at.
      expect(JSON.stringify(JSON.parse(text))).not.toContain(REAL_KEY);
      await new Promise((r) => setTimeout(r, 30));
      expect(JSON.stringify(await listEvents(pool, id))).not.toContain(REAL_KEY);
    }
  });

  it("gives a project with an unknown or odd profile name no limits by accident", async () => {
    const { id, token } = await newProject(5, "constructor");
    expect((await call(token, plain())).status).toBe(400);
    expect(((await listEvents(pool, id, "gateway.refused"))[0]!.payload as { reason: string }).reason).toBe("profile_unknown");
  });
});

describe("holds: found by the third review, and kept fixed", () => {
  const keptOnly = async (id: string, reason: string) => {
    const kept = await waitForEvents(id, "hold.kept", 1);
    expect(kept).toHaveLength(1);
    expect((kept[0]!.payload as { reason: string }).reason).toContain(reason);
    expect(await listEvents(pool, id, "hold.settled")).toHaveLength(0);
    expect(await listEvents(pool, id, "model.call")).toHaveLength(0);
    const holds = await listHolds(pool, id);
    expect(holds[0]).toMatchObject({ state: "open", actual_usd: null });
    const b = await getBudget(pool, id);
    expect(b.spent).toBe(0);
    near(b.openHolds, Number(holds[0]!.amount_usd));
  };
  /** Every text and name inside a parsed value, however deep. */
  const texts = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(texts) : v !== null && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...texts(x)]) : []);
  /** The caller must not find the key in a body, read as text or read as JSON, parsed as often as it parses. */
  const expectNoKey = (body: string, key: string) => {
    expect(body).not.toContain(key);
    let layer: unknown = body;
    for (let i = 0; i < 4 && typeof layer === "string"; i++) {
      try {
        layer = JSON.parse(layer);
      } catch {
        break;
      }
    }
    for (const t of texts(layer)) {
      expect(t).not.toContain(key);
      // A text inside may itself be JSON in part: undo one more layer of backslash escapes.
      expect(t.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))).not.toContain(key);
    }
  };

  it("a body that spells the key with escapes is cleaned before the caller gets it, as the caller would read it", async () => {
    const statuses: Record<string, number> = { "echo-key-escaped-500": 500, "echo-key-escaped-400": 400, "echo-key-escaped-200": 200, "echo-key-escaped-twice": 500, "echo-key-escaped-not-json": 500 };
    for (const [mode, status] of Object.entries(statuses)) {
      const { id, token } = await newProject(5);
      const res = await call(token, plain(mode));
      expect(res.status).toBe(status);
      const text = await res.text();
      expectNoKey(text, REAL_KEY);
      // A JSON answer stays JSON, with the rest of it intact.
      if (mode !== "echo-key-escaped-not-json") expect(JSON.stringify(JSON.parse(text))).toContain("[redacted]");
      await new Promise((r) => setTimeout(r, 30));
      const log = JSON.stringify(await listEvents(pool, id));
      expectNoKey(log, REAL_KEY);
      expect(log).not.toContain("\\\\u002d"); // nor the escaped spelling, which decodes to it
    }
  });

  it("the same holds on the token-counting pass-through, for a good answer and for an error", async () => {
    for (const [system, status] of [["count-echo-key", 200], ["count-echo-key-401", 401]] as const) {
      const { id, token } = await newProject(5);
      const res = await call(token, { model: "claude-opus-5-5", messages: [], system }, "/v1/messages/count_tokens");
      expect(res.status).toBe(status);
      const text = await res.text();
      expectNoKey(text, REAL_KEY);
      expect((JSON.parse(text) as { input_tokens: number }).input_tokens).toBe(42);
      expectNoKey(JSON.stringify(await listEvents(pool, id)), REAL_KEY);
    }
  });

  it("an answer that does not carry the key goes back byte for byte", async () => {
    const { token } = await newProject(5);
    const res = await call(token, plain("fail-400-other"));
    expect(await res.text()).toBe("<html>Bad Request from something in between</html>");
    // Also a JSON answer with odd spacing and a long run of backslashes in it.
    const many = await (await call(token, plain("many-backslashes"))).text();
    expect(many).toContain("\\".repeat(80));
    expect(many).toContain(`}],  "usage":`);
  });

  it("the key in a member that a JSON reader would drop (the same name twice) is not passed back either", async () => {
    // Undo backslash escapes the way any reader of the raw text could.
    const loose = (t: string) => t.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
    for (const [mode, status] of [["echo-key-shadowed-500", 500], ["echo-key-shadowed-escaped-500", 500], ["echo-key-shadowed-200", 200]] as const) {
      const { id, token } = await newProject(5);
      const res = await call(token, plain(mode));
      expect(res.status).toBe(status);
      const text = await res.text();
      expect(text).not.toContain(REAL_KEY);
      expect(loose(text)).not.toContain(REAL_KEY);
      expectNoKey(text, REAL_KEY);
      JSON.parse(text); // still JSON
      await new Promise((r) => setTimeout(r, 30));
      const log = JSON.stringify(await listEvents(pool, id));
      expect(loose(log)).not.toContain(REAL_KEY);
    }
  });

  it("an answer nested very deeply does not make the call fail: its hold is kept with a note in the log", async () => {
    // As first written (fourth review) this test also expected the body to be withheld. Since the sixth
    // review a body out of which the key cannot be read goes back as it was read, however deeply nested;
    // one that carries the key is written out again with the key cut out and its nesting cut at 200 levels (second half).
    const { id, token } = await newProject(5);
    const res = await call(token, plain("deep-500"));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe(`{"type":"error","error":${"[".repeat(20_000)}${"]".repeat(20_000)}}`);
    await keptOnly(id, "server error");
    const withKey = await newProject(5);
    const res2 = await call(withKey.token, plain("deep-500-key"));
    expect(res2.status).toBe(500);
    const text2 = await res2.text();
    expect(text2).not.toContain(REAL_KEY);
    expect(text2.length).toBeLessThan(5_000);
    await keptOnly(withKey.id, "server error");
    expect(JSON.stringify(await listEvents(pool, withKey.id))).not.toContain(REAL_KEY);
  });

  it("an answer that does not name the model that served it keeps its hold", async () => {
    for (const mode of ["model-missing", "model-empty"]) {
      const { id, token } = await newProject(5);
      expect((await call(token, plain(mode))).status).toBe(200);
      await keptOnly(id, "usage could not be read");
    }
  });

  it("a stream that is not framed the way the provider frames it keeps its hold", async () => {
    for (const [mode, reason] of [
      ["stream-fast-taken-back", "usage figures that could be read"],
      ["stream-hidden-frame", "usage figures that could be read"],
      ["stream-hidden-frame-cr", "usage figures that could be read"],
      ["stream-unnamed-broken", "usage figures that could be read"],
      ["stream-two-names", "error inside the stream"],
      ["stream-name-and-type-differ", "usage figures that could be read"],
      ["stream-start-without-message", "usage figures that could be read"],
      ["stream-model-empty", "usage figures that could be read"],
    ] as const) {
      const { id, token } = await newProject(5);
      const res = await call(token, streamed(mode));
      await res.text();
      await keptOnly(id, reason);
    }
  });

  it("a response header named after the key is not passed back, whatever the letter case of the key", async () => {
    const CAPS_KEY = "Test-Real-KEY-With-Capitals";
    const g = await listen(createGateway({ pool, modelApiKey: CAPS_KEY, upstreamUrl, profiles: PROFILES, onFault: (m) => faults.push(m) }));
    try {
      const { token } = await newProject(5);
      const res = await callAt(g.url, token, plain("echo-key-header-name"));
      expect(res.status).toBe(200);
      res.headers.forEach((v, k) => {
        expect(k.toLowerCase()).not.toContain(CAPS_KEY.toLowerCase());
        expect(v.toLowerCase()).not.toContain(CAPS_KEY.toLowerCase());
      });
    } finally {
      g.server.close();
    }
  });

  it("a stream whose figures contradict each other, or whose model is not a name, keeps its hold", async () => {
    for (const [mode, reason] of [
      ["stream-error-name", "error inside the stream"],
      ["stream-falling-input", "usage figures that could be read"],
      ["stream-start-high-output", "usage figures that could be read"],
      ["stream-cache-item-falls", "usage figures that could be read"],
      ["stream-model-not-text", "usage figures that could be read"],
      ["stream-start-not-json", "usage figures that could be read"],
    ] as const) {
      const { id, token } = await newProject(5);
      const res = await call(token, streamed(mode));
      await res.text();
      await keptOnly(id, reason);
    }
  });

  it("usage with a field the meter does not know, or a model that is not a name, keeps the hold", async () => {
    for (const mode of ["unknown-usage-field", "unknown-cache-member", "thinking-details-over", "model-not-text"]) {
      const { id, token } = await newProject(5);
      expect((await call(token, plain(mode))).status).toBe(200);
      await keptOnly(id, "usage could not be read");
    }
  });

  it("the breakdown of output tokens that the provider documents does not stop a call being settled", async () => {
    const { id, token } = await newProject(5);
    expect((await call(token, plain("thinking-details"))).status).toBe(200);
    expect(await listEvents(pool, id, "hold.settled")).toHaveLength(1);
    near((await getBudget(pool, id)).spent, PLAIN_COST);
  });

  it("an event the gateway did not write cannot make the budget unreadable or smaller", async () => {
    const { id } = await newProject(5);
    const other = await newProject(5);
    const mine = await openHold(pool, { projectId: id, step: null, amountUsd: 0.01, deadline: new Date(Date.now() + 60_000), gateway: "gw_test_store", arithmetic: {}, path: "/v1/messages" });
    const theirs = await openHold(pool, { projectId: other.id, step: null, amountUsd: 0.02, deadline: new Date(Date.now() + 60_000), gateway: "gw_test_store", arithmetic: {}, path: "/v1/messages" });
    if (!mine.ok || !theirs.ok) throw new Error("hold not opened");
    const add = (payload: string) => pool.query("insert into events(project_id, kind, payload) values ($1, 'model.call', $2::jsonb)", [id, payload]);
    await add('{"cost_usd": 0.25, "hold_id": 12.5}'); // not a whole number: counted, and the view still reads
    await add('{"cost_usd": 0.25, "hold_id": 1e30}'); // far too large to be an id: the same
    await add('{"cost_usd": 0.25, "hold_id": 999999999999}'); // names a hold that does not exist: counted
    await add(`{"cost_usd": 0.25, "hold_id": ${Number(theirs.hold.id)}}`); // another project's open hold: counted here
    await add(`{"cost_usd": 0.25, "hold_id": "${Number(mine.hold.id)}"}`); // the id as text: counted, and the hold too
    await add(`{"cost_usd": 0.5, "hold_id": ${Number(mine.hold.id)}}`); // this project's own open hold: the hold is counted, not the cost
    const b = await getBudget(pool, id);
    near(b.spent, 1.25);
    near(b.openHolds, 0.01);
    near((await getBudget(pool, other.id)).openHolds, 0.02);
    expect((await getBudget(pool, other.id)).spent).toBe(0);
  });

  it("writes down the names of the headers it did not pass on, never their values", async () => {
    const { id, token } = await newProject(5);
    expect((await call(token, plain(), "/v1/messages", { "x-stainless-lang": "js", "idempotency-key": "secret-value-1", "x-builder-step": "s1" })).status).toBe(200);
    const payload = (await listEvents(pool, id, "model.call"))[0]!.payload as { headers_not_forwarded: string[] };
    expect(payload.headers_not_forwarded).toEqual(expect.arrayContaining(["x-stainless-lang", "idempotency-key"]));
    expect(payload.headers_not_forwarded).not.toContain("x-builder-step");
    expect(payload.headers_not_forwarded).not.toContain("x-api-key");
    expect(JSON.stringify(await listEvents(pool, id))).not.toContain("secret-value-1");
  });
});

describe("holds: found by the fifth review, and kept fixed", () => {
  /** The project's whole event log exactly as the database holds it, as text. */
  const logAsStored = async (id: string) => String((await pool.query("select coalesce(string_agg(payload::text, ' '), '') as t from events where project_id = $1", [id])).rows[0].t);
  const keptWith = async (id: string, reason: string) => {
    const kept = await waitForEvents(id, "hold.kept", 1);
    expect(kept).toHaveLength(1);
    expect((kept[0]!.payload as { reason: string }).reason).toContain(reason);
    expect(await listEvents(pool, id, "hold.settled")).toHaveLength(0);
    expect((await listHolds(pool, id))[0]).toMatchObject({ state: "open", actual_usd: null });
  };

  it("what goes back and what is stored is judged once more as text: one backslash in front of the key does not carry it through", async () => {
    // The suite's key begins with "t", so "\\" + key is valid JSON that reads as a tab and "est-...".
    for (const [mode, status] of [["echo-key-after-backslash-500", 500], ["echo-key-after-backslash-200", 200]] as const) {
      const { id, token } = await newProject(5);
      const res = await call(token, plain(mode));
      expect(res.status).toBe(status);
      expect(await res.text()).not.toContain(REAL_KEY);
      await new Promise((r) => setTimeout(r, 30));
      expect(await logAsStored(id)).not.toContain(REAL_KEY);
      expect(await listEvents(pool, id, status === 200 ? "hold.settled" : "hold.kept")).toHaveLength(1);
    }
    const { id, token } = await newProject(5);
    const res = await call(token, { model: "claude-opus-5-5", messages: [], system: "count-echo-after-backslash" }, "/v1/messages/count_tokens");
    expect(await res.text()).not.toContain(REAL_KEY);
    expect(await logAsStored(id)).not.toContain(REAL_KEY);
  });

  it("a backslash in front of a u or an x of the key is undone like one in front of any other character", async () => {
    // The second key was found by the sixth review: "u0041" and "x41" inside the key itself, so that
    // a backslash put in front of them can be read two ways ("\\x41" as "A", or as "x41").
    for (const UX_KEY of ["sk-ant-api03-Aux9-example-xu", "sk-u0041bc-x41zz"]) await uxCase(UX_KEY);
  });

  const uxCase = async (UX_KEY: string) => {
    const g = await listen(createGateway({ pool, modelApiKey: UX_KEY, upstreamUrl, profiles: PROFILES, onFault: (m) => faults.push(m) }));
    const plainSpelling = (t: string) => t.replace(/\\/g, "");
    try {
      for (const mode of ["echo-key-backslash-ux-text", "echo-key-backslash-ux-json", "echo-key-backslash-ux-header"]) {
        const { id, token } = await newProject(5);
        const res = await callAt(g.url, token, plain(mode));
        res.headers.forEach((v) => expect(plainSpelling(v)).not.toContain(UX_KEY));
        const text = await res.text();
        expect(plainSpelling(text)).not.toContain(UX_KEY);
        await new Promise((r) => setTimeout(r, 30));
        expect(plainSpelling(await logAsStored(id))).not.toContain(UX_KEY);
      }
    } finally {
      g.server.close();
    }
  };

  it("an answer with 30,000 backslashes in a row and no key in it goes back exactly as it was read", async () => {
    const { token } = await newProject(5);
    const text = await (await call(token, plain("backslash-run"))).text();
    // The whole body, character for character: the long number and the odd spacing would not survive being written out again.
    expect(text).toBe(`{"id":"msg_test","type":"message","model":"claude-opus-5-5","big":12345678901234567890,  "content":[{"type":"text","text":"${"\\".repeat(30_000)}"}],"usage":${JSON.stringify(PLAIN_USAGE)}}`);
  });

  it("an answer holding half of a surrogate pair, which the database refuses, still gets its ending written down", async () => {
    const { id, token } = await newProject(5);
    expect((await call(token, plain("surrogate-500"))).status).toBe(500);
    await keptWith(id, "server error");
  });

  it("an answer holding a character the database refuses still gets its ending written down", async () => {
    const { id, token } = await newProject(5);
    expect((await call(token, plain("nul-500"))).status).toBe(500);
    await keptWith(id, "server error");
    expect(await logAsStored(id)).toContain("[NUL]");
  });

  it("a served model named like a built-in word has no price, and an answer too large to search is not passed on", async () => {
    const a = await newProject(5);
    expect((await call(a.token, plain("served-constructor"))).status).toBe(200);
    await keptWith(a.id, "no price");
    const b = await newProject(5);
    const res = await call(b.token, plain("huge-200"));
    expect(res.status).toBe(502);
    expect((await res.text()).length).toBeLessThan(1_000);
    await keptWith(b.id, "larger than the gateway reads");
  });

  it("a named stream frame with no data keeps the hold; comment lines and keep-alives do not", async () => {
    const a = await newProject(5);
    await (await call(a.token, streamed("stream-named-no-data"))).text();
    await keptWith(a.id, "usage figures that could be read");
    const b = await newProject(5);
    await (await call(b.token, streamed("stream-with-comments"))).text();
    expect(await waitForEvents(b.id, "hold.settled", 1)).toHaveLength(1);
  });
});

describe("holds: found by the review of 13 Nov 2026, and kept fixed", () => {
  const SPEED_NOT_STATED = "the hold allowed for fast mode, and the usage does not state the speed that served the call";
  /** The hold is kept at its full amount, with this reason, and nothing is charged. */
  const keptFor = async (id: string, reason: string) => {
    const kept = await waitForEvents(id, "hold.kept", 1);
    expect(kept).toHaveLength(1);
    expect((kept[0]!.payload as { reason: string }).reason).toBe(reason);
    expect(await listEvents(pool, id, "hold.settled")).toHaveLength(0);
    expect(await listEvents(pool, id, "model.call")).toHaveLength(0);
    const holds = await listHolds(pool, id);
    expect(holds[0]).toMatchObject({ state: "open", actual_usd: null });
    const b = await getBudget(pool, id);
    expect(b.spent).toBe(0);
    near(b.openHolds, Number(holds[0]!.amount_usd));
  };
  const settledAt = async (id: string, cost: number) => {
    const settled = await waitForEvents(id, "hold.settled", 1);
    expect(settled).toHaveLength(1);
    near((settled[0]!.payload as { actual_usd: number }).actual_usd, cost);
    near((await getBudget(pool, id)).spent, cost);
  };

  it("fast mode: a plain answer whose usage leaves the speed out keeps a hold that allowed for fast mode; one that states the speed is settled at that speed", async () => {
    // Asked for fast mode, on the profile that allows it: the hold carries the fast-mode factor.
    const asked = await newProject(5, "fast");
    expect((await call(asked.token, plain(undefined, { speed: "fast" }))).status).toBe(200); // the stand-in's usage has no speed
    expect(((await listEvents(pool, asked.id, "hold.opened"))[0]!.payload as { arithmetic: { fast_mode_factor: number } }).arithmetic.fast_mode_factor).toBe(2);
    await keptFor(asked.id, `the answer succeeded but its usage could not be read: ${SPEED_NOT_STATED}`);
    // Not asked, but the profile allows fast mode on this model, so the hold carries the factor too.
    const allowed = await newProject(5, "fast");
    expect((await call(allowed.token, plain())).status).toBe(200);
    await keptFor(allowed.id, `the answer succeeded but its usage could not be read: ${SPEED_NOT_STATED}`);
    // The same answers stating the speed are settled at that speed's rates.
    const fast = await newProject(5, "fast");
    expect((await call(fast.token, plain("speed-fast-stated", { speed: "fast" }))).status).toBe(200);
    await settledAt(fast.id, up6(2 * ((30 * 4 + 4 * 5 + 8 * 0.2 + 300 * 20) / 1e6)));
    const standard = await newProject(5, "fast");
    expect((await call(standard.token, plain("speed-standard-stated"))).status).toBe(200);
    await settledAt(standard.id, PLAIN_COST);
    // A hold without the factor (the standard profile) is settled as before when the speed is left out.
    const plainProfile = await newProject(5);
    expect((await call(plainProfile.token, plain())).status).toBe(200);
    await settledAt(plainProfile.id, PLAIN_COST);
  });

  it("cache writes the answer does not split into five-minute and one-hour are priced at the one-hour rate, unless the request asks for no one-hour cache anywhere", async () => {
    // The stand-in counts 10,000 prompt tokens and bills 10,000 cache writes with no breakdown, 30 input and 300 output tokens.
    const block = (cache_control?: Record<string, unknown>) => [{ role: "user", content: [{ type: "text", text: "hello", ...(cache_control ? { cache_control } : {}) }] }];
    const ask = (test: string, more: Record<string, unknown> = {}) => plain(test, { system: "count:10000", ...more });
    const oneHour = up6((30 * 4 + 10_000 * 8 + 300 * 20) / 1e6);
    const fiveMinutes = up6((30 * 4 + 10_000 * 5 + 300 * 20) / 1e6);
    const cases: Array<[string, unknown, number, string | null]> = [
      ['a block asking for "1h"', ask("cache-writes-not-itemised", { messages: block({ type: "ephemeral", ttl: "1h" }) }), oneHour, "the one-hour rate"],
      ['a tool asking for "1h"', ask("cache-writes-not-itemised", { tools: [{ name: "read_file", input_schema: { type: "object" }, cache_control: { type: "ephemeral", ttl: "1h" } }] }), oneHour, "the one-hour rate"],
      ["a lifetime the gateway does not know", ask("cache-writes-not-itemised", { messages: block({ type: "ephemeral", ttl: "2h" }) }), oneHour, "the one-hour rate"],
      ['a block asking for "5m"', ask("cache-writes-not-itemised", { messages: block({ type: "ephemeral", ttl: "5m" }) }), fiveMinutes, "the five-minute rate"],
      ["a block with no lifetime (the provider's default, five minutes)", ask("cache-writes-not-itemised", { messages: block({ type: "ephemeral" }) }), fiveMinutes, "the five-minute rate"],
      ["no cache_control at all", ask("cache-writes-not-itemised"), fiveMinutes, "the five-minute rate"],
      // An answer that does split them is priced as split, whatever the request asked.
      ['split as five-minute writes, though a block asks for "1h"', ask("cache-writes-itemised-5m", { messages: block({ type: "ephemeral", ttl: "1h" }) }), fiveMinutes, null],
    ];
    for (const [label, body, cost, pricedAt] of cases) {
      const { id, token } = await newProject(5);
      expect((await call(token, body)).status, label).toBe(200);
      const p = (await listEvents(pool, id, "model.call"))[0]!.payload as { cost_usd: number; usage: { cache_creation_1h_tokens: number }; cache_writes_not_itemised?: { tokens: number; priced_at: string } };
      near(p.cost_usd, cost);
      expect(p.usage.cache_creation_1h_tokens, label).toBe(0); // the usage is recorded as the provider gave it
      if (pricedAt === null) expect(p.cache_writes_not_itemised, label).toBeUndefined();
      else expect(p.cache_writes_not_itemised, label).toMatchObject({ tokens: 10_000, priced_at: pricedAt });
      near((await getBudget(pool, id)).spent, cost);
    }
    // The same on a stream, where the split is read from the stream's frames (second re-read of 13 Nov 2026).
    // On Claude Sonnet 5.5: 30 input tokens, 10,000 cache writes in the start frame, 300 output tokens.
    const streamAsk = (test: string, more: Record<string, unknown> = {}) => ({ model: "claude-sonnet-5-5", max_tokens: 400, stream: true, system: "count:10000", messages: [], metadata: { test }, ...more });
    const streamOneHour = up6((30 * 2 + 10_000 * 4 + 300 * 10) / 1e6);
    const streamFiveMinutes = up6((30 * 2 + 10_000 * 2.5 + 300 * 10) / 1e6);
    const streamCases: Array<[string, unknown, number, string | null]> = [
      ['a stream whose writes are not split, with a block asking for "1h"', streamAsk("stream-cache-writes-not-itemised", { messages: block({ type: "ephemeral", ttl: "1h" }) }), streamOneHour, "the one-hour rate"],
      ["a stream whose writes are not split, with no cache_control at all", streamAsk("stream-cache-writes-not-itemised"), streamFiveMinutes, "the five-minute rate"],
      ['a stream that splits its writes as five-minute writes, though a block asks for "1h"', streamAsk("stream-cache-writes-itemised-5m", { messages: block({ type: "ephemeral", ttl: "1h" }) }), streamFiveMinutes, null],
    ];
    for (const [label, body, cost, pricedAt] of streamCases) {
      const { id, token } = await newProject(5);
      const res = await call(token, body);
      expect(res.status, label).toBe(200);
      await res.text(); // the call is recorded once the stream has been read to its end
      const p = (await waitForEvents(id, "model.call", 1))[0]!.payload as { stream: boolean; cost_usd: number; usage: { cache_creation_input_tokens: number; cache_creation_1h_tokens: number }; cache_writes_not_itemised?: { tokens: number; priced_at: string } };
      expect(p.stream, label).toBe(true);
      near(p.cost_usd, cost);
      expect(p.usage, label).toMatchObject({ cache_creation_input_tokens: 10_000, cache_creation_1h_tokens: 0 }); // as the provider gave it
      if (pricedAt === null) expect(p.cache_writes_not_itemised, label).toBeUndefined();
      else expect(p.cache_writes_not_itemised, label).toMatchObject({ tokens: 10_000, priced_at: pricedAt });
      near((await getBudget(pool, id)).spent, cost);
      expect(await listEvents(pool, id, "hold.exceeded"), label).toHaveLength(0); // each bill is within its hold
    }
  });

  it("a caller that leaves before the call is forwarded: the hold is settled at nothing, with the reason, and the call itself is not forwarded", async () => {
    for (const body of [plain(undefined, { system: "count-slow" }), { ...streamed(), system: "count-slow" }]) {
      const { id, token } = await newProject(5);
      const before = forwarded;
      const controller = new AbortController();
      const leaving = call(token, body, "/v1/messages", {}, { signal: controller.signal }).catch(() => null);
      setTimeout(() => controller.abort(), 100); // while the prompt is still being counted
      await leaving;
      const settled = await waitForEvents(id, "hold.settled", 1);
      expect(settled).toHaveLength(1);
      expect(settled[0]!.payload).toMatchObject({ actual_usd: 0, forwarded: false, reason: "the caller left before the call was forwarded to the provider (only the counting call, assumed to cost nothing, was sent)" });
      expect(await kinds(id)).toEqual(["hold.opened", "hold.settled"]); // no model.call: no call was made
      expect(forwarded).toBe(before); // the call itself did not reach the stand-in (the counting call did: that is what was slowed)
      expect((await listHolds(pool, id))[0]).toMatchObject({ state: "settled" });
      const b = await getBudget(pool, id);
      expect(b.openHolds).toBe(0);
      expect(b.spent).toBe(0);
    }
  });

  it("the budget-reached message rounds so that its figures never appear to fit the cap", async () => {
    // Spent $0.02142 and $0.02142 held, against a cap of $0.0509; this call needs $0.00996. Each figure
    // rounded to the nearest cent would read 0.02 + 0.02 + 0.01 against 0.05, which looks as if it fits.
    const { id, token } = await newProject(0.0509);
    const deadline = new Date(Date.now() + 60_000);
    const done = await openHold(pool, { projectId: id, step: null, amountUsd: 0.03, deadline, gateway: "gw_test_store", arithmetic: {}, path: "/v1/messages" });
    if (!done.ok) throw new Error("hold not opened");
    expect((await settleHold(pool, { projectId: id, holdId: done.hold.id, step: null, actualUsd: 0.02142, call: {} })).settled).toBe(true);
    expect((await openHold(pool, { projectId: id, step: null, amountUsd: 0.02142, deadline, gateway: "gw_test_store", arithmetic: {}, path: "/v1/messages" })).ok).toBe(true);
    const before = forwarded;
    const res = await call(token, plain());
    expect(res.status).toBe(402);
    expect(forwarded).toBe(before);
    const message = ((await res.json()) as { error: { message: string } }).error.message;
    // What is needed, spent and held is rounded up; the cap down. The wording is unchanged.
    expect(message).toBe(
      "This project has reached its budget of $0.05 (spent $0.03, with $0.03 held for work in progress or awaiting reconciliation; this call needed up to $0.01). The gateway will forward nothing more until the budget is raised.",
    );
    const m = /budget of \$(\d+)\.(\d\d) \(spent \$(\d+)\.(\d\d), with \$(\d+)\.(\d\d) held .*; this call needed up to \$(\d+)\.(\d\d)\)/.exec(message)!;
    const cents = (i: number) => Number(m[i]) * 100 + Number(m[i + 1]);
    expect(cents(3) + cents(5) + cents(7)).toBeGreaterThan(cents(1)); // the figures shown do not fit
    const r = (await listEvents(pool, id, "gateway.refused"))[0]!.payload as { cap_usd: number; spent_usd: number; open_holds_usd: number; this_hold_usd: number };
    near(r.spent_usd + r.open_holds_usd + r.this_hold_usd, 0.0528); // the exact figures, in the log
  });

  it("fast mode: the same on a stream", async () => {
    const opusStream = (test: string) => ({ model: "claude-opus-5-5", max_tokens: 250, stream: true, system: "count:1500", messages: [], speed: "fast", metadata: { test } });
    const a = await newProject(5, "fast");
    await (await call(a.token, opusStream("stream-opus-no-speed"))).text();
    await keptFor(a.id, `the stream ended without usage figures that could be read: ${SPEED_NOT_STATED}`);
    const b = await newProject(5, "fast");
    await (await call(b.token, opusStream("stream-opus-speed-fast"))).text();
    await settledAt(b.id, up6(2 * ((1000 * 4 + 200 * 20) / 1e6)));
  });
});

describe("holds: what a hold cannot bound is refused before anything is forwarded", () => {
  const refusedWith = async (body: unknown, reason: string, profile = "standard") => {
    const { id, token } = await newProject(5, profile);
    const before = forwarded;
    const res = await call(token, body);
    expect(res.status).toBe(400);
    expect(forwarded).toBe(before);
    expect(((await listEvents(pool, id, "gateway.refused"))[0]!.payload as { reason: string }).reason).toBe(reason);
    expect(await listHolds(pool, id)).toHaveLength(0);
  };
  it("no max_tokens, or more than the profile's ceiling", async () => {
    await refusedWith({ model: "claude-opus-5-5", messages: [] }, "max_tokens_missing");
    await refusedWith(plain(undefined, { max_tokens: 16_001 }), "max_tokens_above_ceiling");
  });
  it("routing that changes the price of every token", async () => {
    await refusedWith(plain(undefined, { inference_geo: "us" }), "inference_geo_not_allowed");
  });
  it("tools the provider runs itself, and tool servers", async () => {
    await refusedWith(plain(undefined, { tools: [{ type: "web_search_20260209", name: "web_search" }] }), "server_tool_not_allowed");
    await refusedWith(plain(undefined, { tools: [{ type: "bash_code_execution_made_up", name: "x" }] }), "server_tool_not_allowed");
    await refusedWith(plain(undefined, { mcp_servers: [{ type: "url", url: "https://example.invalid", name: "x" }] }), "server_tool_not_allowed");
  });
  it("fast mode where the profile does not allow it, or the model has no fast-mode price", async () => {
    await refusedWith(plain(undefined, { speed: "fast" }), "fast_mode_not_allowed");
    await refusedWith({ model: "claude-sonnet-5-5", max_tokens: 100, messages: [], speed: "fast" }, "fast_mode_not_priced", "fast");
  });
  it("lets the caller's own tools through", async () => {
    const { token } = await newProject(5);
    const res = await call(token, plain(undefined, { tools: [{ name: "read_file", description: "x", input_schema: { type: "object" } }, { type: "custom", name: "y", input_schema: { type: "object" } }, { type: "bash_20250124", name: "bash" }] }));
    expect(res.status).toBe(200);
  });
  it("the arithmetic of a hold, on its own", () => {
    const std = DEFAULT_PROFILES["standard"]!;
    expect(guardRequest({ model: "claude-opus-5-5", max_tokens: 100 }, std)).toBeNull();
    const h = computeHold({ model: "claude-opus-5-5", max_tokens: 1000 }, 10_000, std, "2026-11-11");
    expect(h.prompt_tokens_held).toBe(10_000 + 500 + 200);
    near(h.hold_usd, (10_700 * 8 + 1000 * 20) / 1e6);
    const asked = computeHold({ model: "claude-fable-5-2", max_tokens: 1000, speed: "fast" }, 10_000, PROFILES["fast"]!, "2026-11-11");
    expect(asked.fast_mode_because).toBe("the request asks for it");
    near(asked.hold_usd, (2 * (10_700 * 16 + 1000 * 40)) / 1e6);
    // Sonnet has no fast-mode price: the profile allowing fast mode does not double it, and asking for it is refused.
    expect(computeHold({ model: "claude-sonnet-5-5", max_tokens: 1000 }, 10_000, PROFILES["fast"]!, "2026-11-11").fast_mode_factor).toBe(1);
  });
});

describe("model gateway: what is refused", () => {
  it("refuses a model that is not in the price table", async () => {
    const { token } = await newProject(5);
    const res = await call(token, { ...plain(), model: "some-other-model" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/not one the gateway may forward/);
  });

  it("refuses to be configured with a model that has no price", () => {
    expect(() => createGateway({ pool, modelApiKey: REAL_KEY, allowedModels: ["claude-opus-5-5", "mystery-model"] })).toThrow(/no price/);
  });

  it("refuses an unknown token and never forwards it", async () => {
    const before = seenKeys.length;
    const res = await call("bpt_nobody_xyz", plain());
    expect(res.status).toBe(401);
    expect(seenKeys.length).toBe(before);
  });

  it("refuses a non-JSON body", async () => {
    const { token } = await newProject(5);
    const res = await fetch(gatewayUrl + "/v1/messages", { method: "POST", headers: { "x-api-key": token }, body: "not json" });
    expect(res.status).toBe(400);
  });

  it("refuses paid paths it does not know, such as batches, and percent-encoded disguises", async () => {
    const { id, token } = await newProject(5);
    const batches = await call(token, plain(), "/v1/messages/batches");
    expect(batches.status).toBe(403);
    const disguised = await call(token, plain(), "/v1/%6Dessages/batches");
    expect(disguised.status).toBe(403);
    const refused = await listEvents(pool, id, "gateway.refused");
    expect(refused.map((r) => (r.payload as { reason: string }).reason)).toEqual(["path_not_allowed", "path_not_allowed"]);
    expect(normalisePath("/v1/%6Dessages/")).toBe("/v1/messages");
  });

  it("refuses methods other than POST", async () => {
    const { token } = await newProject(5);
    const res = await fetch(gatewayUrl + "/v1/messages", { method: "GET", headers: { "x-api-key": token } });
    expect(res.status).toBe(405);
  });

  it("passes token counting through, logged and unmetered", async () => {
    const { id, token } = await newProject(5);
    const res = await call(token, { model: "claude-opus-5-5", messages: [] }, "/v1/messages/count_tokens");
    expect(res.status).toBe(200);
    expect(await listEvents(pool, id, "gateway.passthrough")).toHaveLength(1);
    expect(await listEvents(pool, id, "model.call")).toHaveLength(0);
  });

  it("raised no faults during this run", () => {
    expect(faults).toEqual([]);
  });
});

describe("the cap change: proof rows B20 to B22 of the design note (package 1.2b)", () => {
  // Role names only (hard rule 10): who asked and who ran it are stated by the caller and not checked.
  const who = { askedBy: "the owner", changedBy: "Claude Code", reason: "test of package 1.2b" };
  const capChanges = (id: string) => listEvents(pool, id, "cap.changed");
  const eventCount = async (id: string) => (await listEvents(pool, id)).length;
  const deadline = () => new Date(Date.now() + 600_000);
  const storeHold = (projectId: string, amountUsd: number, p: pg.Pool = pool) =>
    openHold(p, { projectId, step: null, amountUsd, deadline: deadline(), gateway: "gw_test_cap", arithmetic: {}, path: "/v1/messages" });
  /** The refusal a change ends in. Anything else, a database error included, fails the test: the reason is asserted, not only that it threw. */
  async function refusal(change: Promise<unknown>): Promise<CapChangeRefused> {
    try {
      await change;
    } catch (e) {
      if (e instanceof CapChangeRefused) return e;
      throw e;
    }
    throw new Error("expected the change to be refused, but it was made");
  }
  /** A project with $0.0025 spent and one hold of $0.0075 open: spent plus open holds is exactly $0.01. */
  async function projectWithSpendAndHold(capUsd: number) {
    const p = await newProject(capUsd);
    const first = await storeHold(p.id, 0.004);
    if (!first.ok) throw new Error("hold not opened");
    expect((await settleHold(pool, { projectId: p.id, holdId: first.hold.id, step: null, actualUsd: 0.0025, call: {} })).settled).toBe(true);
    expect((await storeHold(p.id, 0.0075)).ok).toBe(true);
    const b = await getBudget(pool, p.id);
    expect([b.spent, b.openHolds, b.openHoldCount]).toEqual([0.0025, 0.0075, 1]);
    return p;
  }

  it("B20: a raise is recorded with its event, and the next call is judged against the new cap", async () => {
    const { id, token } = await newProject(0.005); // too small for one plain call's hold ($0.00996)
    const before = forwarded;
    expect((await call(token, plain())).status).toBe(402);
    expect(forwarded).toBe(before);
    expect(((await listEvents(pool, id, "gateway.refused"))[0]!.payload as { cap_usd: number }).cap_usd).toBe(0.005);
    const budgetBefore = await getBudget(pool, id);
    const change = await changeCap(pool, { projectId: id, newCapUsd: 0.05, ...who });
    expect(change).toMatchObject({ projectId: id, oldCapUsd: 0.005, newCapUsd: 0.05, spentUsd: 0, openHoldsUsd: 0, openHolds: 0, ...who });
    const events = await capChanges(id);
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe(change.eventId);
    expect(events[0]!.payload).toEqual({
      old_cap_usd: 0.005,
      new_cap_usd: 0.05,
      asked_by: "the owner",
      changed_by: "Claude Code",
      reason: "test of package 1.2b",
      changed_at: change.changedAt,
      spent_usd: 0,
      open_holds_usd: 0,
      open_holds: 0,
      // Package 1.3: the room reserved for running steps, and how many, at the moment of the change.
      step_room_usd: 0,
      open_steps: 0,
    });
    expect(Number.isNaN(Date.parse(change.changedAt))).toBe(false);
    // Spent and open holds are what they were; only the cap moved.
    expect(await getBudget(pool, id)).toEqual({ ...budgetBefore, cap: 0.05 });
    // The same call, now let through and judged against the new cap.
    expect((await call(token, plain())).status).toBe(200);
    expect(((await listEvents(pool, id, "hold.opened"))[0]!.payload as { budget_before: { cap_usd: number } }).budget_before.cap_usd).toBe(0.05);
    expect(await kinds(id)).toEqual(["gateway.refused", "cap.changed", "hold.opened", "model.call", "hold.settled"]);
  });

  it("B20: a lowering to exactly spent plus open holds is accepted and recorded, and the next call is refused", async () => {
    const { id, token } = await projectWithSpendAndHold(1);
    const change = await changeCap(pool, { projectId: id, newCapUsd: 0.01, ...who, reason: "test: lowered to spent plus open holds" });
    expect(change).toMatchObject({ oldCapUsd: 1, newCapUsd: 0.01, spentUsd: 0.0025, openHoldsUsd: 0.0075, openHolds: 1 });
    const events = await capChanges(id);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ old_cap_usd: 1, new_cap_usd: 0.01, spent_usd: 0.0025, open_holds_usd: 0.0075, open_holds: 1 });
    const before = forwarded;
    const res = await call(token, plain());
    expect(res.status).toBe(402);
    expect(forwarded).toBe(before);
    const refused = (await listEvents(pool, id, "gateway.refused")).at(-1)!.payload;
    expect(refused).toMatchObject({ reason: "budget_reached", cap_usd: 0.01, spent_usd: 0.0025, open_holds_usd: 0.0075 });
    // The rule the failure tests will check: spent plus open holds is not above the cap.
    const b = await getBudget(pool, id);
    expect(micro(b.spent) + micro(b.openHolds)).toBeLessThanOrEqual(micro(b.cap));
    // The hold that was open stays open at its amount; nothing about it changed.
    expect((await listHolds(pool, id)).filter((h) => h.state === "open").map((h) => Number(h.amount_usd))).toEqual([0.0075]);
  });

  it("B20: the figures at the edges of what is allowed are accepted as written: 0, 0.0003 and 99999999.9999", async () => {
    const { id } = await newProject(5);
    const steps: [number, number][] = [
      [5, 0],
      [0, 0.0003],
      [0.0003, 99999999.9999],
    ];
    for (const [old, next] of steps) {
      const c = await changeCap(pool, { projectId: id, newCapUsd: next, ...who });
      expect([c.oldCapUsd, c.newCapUsd]).toEqual([old, next]);
      expect((await getBudget(pool, id)).cap).toBe(next);
    }
    expect((await capChanges(id)).map((e) => [(e.payload as { old_cap_usd: number }).old_cap_usd, (e.payload as { new_cap_usd: number }).new_cap_usd])).toEqual(steps);
  });

  /** A pool of one connection whose session carries a name, so that the test can see it wait in pg_stat_activity. */
  const namedPool = async (name: string): Promise<pg.Pool> => new (await import("pg")).default.Pool({ connectionString: TEST_DB_URL, application_name: name, max: 1 });
  /** Wait until every named session is waiting for a lock another session holds (pg_blocking_pids is not empty), or fail after about 10 seconds. */
  async function waitUntilAllWait(names: string[]) {
    for (let i = 0; i < 500; i++) {
      const r = await pool.query<{ application_name: string; blocked_by: number[] }>(
        "select application_name, pg_blocking_pids(pid) as blocked_by from pg_stat_activity where application_name = any($1::text[])",
        [names],
      );
      const waiting = r.rows.filter((x) => x.blocked_by.length > 0).map((x) => x.application_name);
      if (names.every((n) => waiting.includes(n))) return;
      await new Promise((res) => setTimeout(res, 20));
    }
    throw new Error(`not every one of ${names.join(", ")} was seen waiting for a lock`);
  }
  /**
   * A third session takes the project's row lock and keeps it; `start` starts the work, each piece on a
   * pool of its own; once every piece is seen waiting, the lock is released and the work finishes.
   */
  async function withProjectLockHeld(id: string, names: string[], start: (pools: pg.Pool[]) => Promise<unknown>[]) {
    const pools = await Promise.all(names.map(namedPool));
    const holder = await pool.connect();
    let work: Promise<unknown>[] = [];
    let open = false;
    try {
      await holder.query("begin");
      open = true;
      await holder.query("select id from projects where id = $1 for update", [id]);
      work = start(pools);
      for (const w of work) w.catch(() => undefined); // judged below, once the lock is released
      await waitUntilAllWait(names);
      expect(await capChanges(id)).toHaveLength(0); // nothing is written while the lock is held
      await holder.query("commit");
      open = false;
      await Promise.all(work);
    } finally {
      if (open) await holder.query("rollback").catch(() => undefined);
      holder.release();
      await Promise.allSettled(work);
      await Promise.all(pools.map((p) => p.end()));
    }
  }

  it("B21: two changes to one project are judged one at a time: the second starts from the figure the first left", async () => {
    const { id } = await newProject(20);
    const names = [uniqueId("b21_change_a"), uniqueId("b21_change_b")];
    await withProjectLockHeld(id, names, ([a, b]) => [
      changeCap(a!, { projectId: id, newCapUsd: 30, ...who, reason: "test: change a" }),
      changeCap(b!, { projectId: id, newCapUsd: 40, ...who, reason: "test: change b" }),
    ]);
    const events = (await capChanges(id)).map((e) => e.payload as { old_cap_usd: number; new_cap_usd: number; changed_at: string; reason: string });
    expect(events).toHaveLength(2);
    expect(events[0]!.old_cap_usd).toBe(20);
    expect(events[1]!.old_cap_usd).toBe(events[0]!.new_cap_usd); // the chain: old figure of the second = new figure of the first
    expect(events.map((e) => e.new_cap_usd).sort()).toEqual([30, 40]);
    expect((await getBudget(pool, id)).cap).toBe(events[1]!.new_cap_usd);
    expect(Date.parse(events[1]!.changed_at)).toBeGreaterThanOrEqual(Date.parse(events[0]!.changed_at));
    console.log(`B21, two changes: ${events.map((e) => `${e.reason} (${e.old_cap_usd} to ${e.new_cap_usd})`).join(", then ")}`);
  });

  it("B21: a change and an admission are judged one at a time, and their events agree in the order they were written", async () => {
    // Two rounds; in each, the two are started in the opposite order. Whichever is judged first, the other must see its result.
    for (const changeFirst of [true, false]) {
      const { id } = await newProject(1);
      const names = [uniqueId("b21_change"), uniqueId("b21_admission")];
      await withProjectLockHeld(id, names, ([a, b]) => {
        const change = () => changeCap(a!, { projectId: id, newCapUsd: 2, ...who, reason: "test: change against an admission" });
        const admission = () => storeHold(id, 0.01, b!);
        return changeFirst ? [change(), admission()] : [admission(), change()];
      });
      const log = (await listEvents(pool, id)).filter((e) => e.kind === "cap.changed" || e.kind === "hold.opened");
      expect(log.map((e) => e.kind).sort()).toEqual(["cap.changed", "hold.opened"]);
      const changed = log.find((e) => e.kind === "cap.changed")!.payload as { old_cap_usd: number; new_cap_usd: number; open_holds: number; open_holds_usd: number };
      const opened = log.find((e) => e.kind === "hold.opened")!.payload as { budget_before: { cap_usd: number } };
      if (log[0]!.kind === "cap.changed") {
        // The change was judged first: the admission was judged against the new cap, and the change saw no open hold.
        expect(opened.budget_before.cap_usd).toBe(2);
        expect(changed).toMatchObject({ old_cap_usd: 1, new_cap_usd: 2, open_holds: 0, open_holds_usd: 0 });
      } else {
        // The admission was judged first: it was judged against the old cap, and the change saw its hold open.
        expect(opened.budget_before.cap_usd).toBe(1);
        expect(changed).toMatchObject({ old_cap_usd: 1, new_cap_usd: 2, open_holds: 1, open_holds_usd: 0.01 });
      }
      console.log(`B21, a change and an admission (started ${changeFirst ? "change first" : "admission first"}): judged ${log.map((e) => e.kind).join(", then ")}`);
    }
  });

  it("B22: a figure that is not a number of dollars, 0 or more, below $100,000,000 with at most 4 decimals is refused: nothing changed, nothing written", async () => {
    const { id } = await newProject(20);
    const before = await eventCount(id);
    const cases: [unknown, string][] = [
      [Number.NaN, "cap_not_a_number"],
      [Number.POSITIVE_INFINITY, "cap_not_a_number"],
      [Number.NEGATIVE_INFINITY, "cap_not_a_number"],
      ["30", "cap_not_a_number"],
      [-1, "cap_below_zero"],
      [-0.0001, "cap_below_zero"],
      [1e8, "cap_too_large"],
      [1e21, "cap_too_large"],
      [0.00001, "cap_more_than_4_decimals"],
      [20.12345, "cap_more_than_4_decimals"],
    ];
    for (const [figure, code] of cases) {
      const r = await refusal(changeCap(pool, { projectId: id, newCapUsd: figure as number, ...who }));
      expect([figure, r.code]).toEqual([figure, code]);
      expect(r.message).toContain("Nothing was changed and nothing was written.");
      expect((await getBudget(pool, id)).cap).toBe(20);
    }
    expect(await eventCount(id)).toBe(before);
  });

  it("B22: a name or reason that is missing, empty, longer than 500 characters, or holds a character the log cannot store is refused: nothing changed, nothing written", async () => {
    const { id } = await newProject(20);
    const before = await eventCount(id);
    const fields = [
      ["askedBy", "asked_by"],
      ["changedBy", "changed_by"],
      ["reason", "reason"],
    ] as const;
    const bad: [unknown, string][] = [
      [undefined, "missing"],
      ["", "missing"],
      ["   ", "missing"],
      [42, "missing"],
      ["x".repeat(501), "too_long"],
      ["the\u0000owner", "not_storable"],
      ["half \ud800 of a pair", "not_storable"],
    ];
    for (const [key, field] of fields) {
      for (const [value, kind] of bad) {
        const p: Record<string, unknown> = { projectId: id, newCapUsd: 30, ...who, [key]: value };
        if (value === undefined) delete p[key];
        const r = await refusal(changeCap(pool, p as Parameters<typeof changeCap>[1]));
        expect([key, value, r.code]).toEqual([key, value, `${field}_${kind}`]);
        expect((await getBudget(pool, id)).cap).toBe(20);
      }
    }
    expect(await eventCount(id)).toBe(before);
    // At the edge: exactly 500 characters, with spaces around them that are trimmed, is accepted.
    const c = await changeCap(pool, { projectId: id, newCapUsd: 30, ...who, reason: `  ${"r".repeat(500)}  ` });
    expect(c.reason).toBe("r".repeat(500));
    expect(((await capChanges(id))[0]!.payload as { reason: string }).reason).toBe("r".repeat(500));
  });

  it("B22: an unknown project, or a figure equal to the current cap, is refused: nothing changed, nothing written", async () => {
    const missing = uniqueId("p_missing");
    expect((await refusal(changeCap(pool, { projectId: missing, newCapUsd: 30, ...who }))).code).toBe("unknown_project");
    expect(await getProject(pool, missing)).toBeNull();
    const { id } = await newProject(20);
    const before = await eventCount(id);
    expect((await refusal(changeCap(pool, { projectId: id, newCapUsd: 20, ...who }))).code).toBe("no_change");
    expect((await getBudget(pool, id)).cap).toBe(20);
    expect(await eventCount(id)).toBe(before);
  });

  it("B22: a lowering below spent plus open holds is refused, naming the lowest figure allowed now: nothing changed, nothing written", async () => {
    const { id } = await projectWithSpendAndHold(1);
    const before = await eventCount(id);
    for (const lower of [0.0099, 0.005, 0]) {
      const r = await refusal(changeCap(pool, { projectId: id, newCapUsd: lower, ...who }));
      expect([lower, r.code, r.lowestAllowedUsd]).toEqual([lower, "below_spent_plus_open_holds", 0.01]);
      expect(r.message).toContain("The lowest cap allowed now is $0.0100.");
      expect(await getBudget(pool, id)).toMatchObject({ cap: 1, spent: 0.0025, openHolds: 0.0075, openHoldCount: 1 });
    }
    expect(await eventCount(id)).toBe(before);
    // When spent plus open holds has more than 4 decimals, the lowest figure allowed is rounded up to 4.
    const other = await newProject(1);
    expect((await call(other.token, plain())).status).toBe(200);
    const b = await getBudget(pool, other.id);
    expect([micro(b.spent), b.openHolds]).toEqual([micro(PLAIN_COST), 0]); // $0.006142 spent, nothing held
    const r = await refusal(changeCap(pool, { projectId: other.id, newCapUsd: 0.0061, ...who }));
    expect([r.code, r.lowestAllowedUsd]).toEqual(["below_spent_plus_open_holds", 0.0062]);
    expect((await getBudget(pool, other.id)).cap).toBe(1);
    expect(await capChanges(other.id)).toHaveLength(0);
    // The figure it names is accepted.
    expect((await changeCap(pool, { projectId: other.id, newCapUsd: 0.0062, ...who })).newCapUsd).toBe(0.0062);
  });

  it("the cap change: a cap that is not a number is refused by the database (migration 007) and by createProject", async () => {
    const { id } = await newProject(20);
    await expect(pool.query("update projects set cap_usd = 'NaN' where id = $1", [id])).rejects.toThrow(/projects_cap_is_a_number/);
    await expect(pool.query("insert into projects(id, name, cap_usd) values ($1, 'raw insert', 'NaN')", [uniqueId("p")])).rejects.toThrow(/projects_cap_is_a_number/);
    expect((await getBudget(pool, id)).cap).toBe(20);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1e8]) {
      const pid = uniqueId("p");
      await expect(createProject(pool, { id: pid, name: "gateway test", capUsd: bad })).rejects.toThrow(/^A project's cap must be a real number of dollars/);
      expect(await getProject(pool, pid)).toBeNull();
    }
    // A cap with more than 4 decimals is still taken by createProject and rounded by the database, as package 1.2's tests need.
    const rounded = await createProject(pool, { id: uniqueId("p"), name: "gateway test", capUsd: 0.017264 });
    expect(rounded.cap_usd).toBe("0.0173");
  });

  it("the cap change raised no faults", () => {
    expect(faults).toEqual([]);
  });
});
