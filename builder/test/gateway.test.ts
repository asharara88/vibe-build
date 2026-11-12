import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGateway, normalisePath } from "../src/gateway/app.js";
import { costUsd, emptyUsage } from "../src/gateway/cost.js";
import { listEvents } from "../src/store/events.js";
import { createProject, getSpend, issueProjectToken } from "../src/store/projects.js";
import { testPool, uniqueId } from "./helpers.js";

const REAL_KEY = "test-real-key-never-leaves-the-gateway";
let pool: pg.Pool;
let upstream: ServerType;
let upstreamUrl: string;
let gateway: ServerType;
let gatewayUrl: string;
const seenKeys: string[] = [];
const faults: string[] = [];

const PLAIN_USAGE = { input_tokens: 2000, output_tokens: 300, cache_creation_input_tokens: 100, cache_read_input_tokens: 400 };
const PLAIN_COST = (2000 * 4 + 100 * 5 + 400 * 0.2 + 300 * 20) / 1e6; // one plain call on Opus 5.5

const STREAM_FRAMES = [
  `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { model: "claude-sonnet-5-5", usage: { input_tokens: 1000, cache_read_input_tokens: 500, cache_creation_input_tokens: 0, output_tokens: 1 } } })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hello" } })}\n\n`,
  `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 200 } })}\n\n`,
  `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
];

/** A stand-in for the model provider. Behaviour is chosen by fields in the request body. */
function standInProvider() {
  const app = new Hono();
  app.post("/v1/messages", async (c) => {
    seenKeys.push(c.req.header("x-api-key") ?? "(none)");
    const body = (await c.req.json()) as { model: string; stream?: boolean; max_tokens?: number; metadata?: { test?: string } };
    const mode = body.metadata?.test ?? "";
    if (mode === "fail-500") return c.json({ type: "error", error: { type: "api_error", message: "stand-in failure" } }, 500);
    if (mode === "redirect") return c.redirect("http://127.0.0.1:9/elsewhere", 307);
    if (mode === "slow-wait") await new Promise((r) => setTimeout(r, 300));
    if (body.stream) {
      const slow = mode === "slow-stream";
      const stream = new ReadableStream<Uint8Array>({
        async start(ctrl) {
          for (const f of STREAM_FRAMES) {
            ctrl.enqueue(new TextEncoder().encode(f));
            if (slow) await new Promise((r) => setTimeout(r, 250));
          }
          ctrl.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }
    const served = mode === "served-haiku" ? "claude-haiku-5-5" : body.model;
    const usage = mode === "fast-1h" ? { ...PLAIN_USAGE, cache_creation: { ephemeral_1h_input_tokens: 100 }, speed: "fast" } : PLAIN_USAGE;
    return c.json({ id: "msg_test", type: "message", model: served, content: [{ type: "text", text: "hello" }], usage });
  });
  app.post("/v1/messages/count_tokens", (c) => c.json({ input_tokens: 42 }));
  app.post("/v1/messages/batches", (c) => c.json({ id: "batch_should_never_be_reached" }));
  return app;
}

function listen(app: Hono): Promise<{ server: ServerType; url: string }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => resolve({ server, url: `http://127.0.0.1:${info.port}` }));
  });
}

beforeAll(async () => {
  pool = await testPool();
  ({ server: upstream, url: upstreamUrl } = await listen(standInProvider()));
  const app = createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl, onFault: (m) => faults.push(m) });
  ({ server: gateway, url: gatewayUrl } = await listen(app));
});
afterAll(async () => {
  gateway.close();
  upstream.close();
  await pool.end();
});

async function newProject(capUsd: number) {
  const id = uniqueId("p");
  await createProject(pool, { id, name: "gateway test", capUsd });
  const token = await issueProjectToken(pool, id);
  return { id, token };
}

const call = (token: string, body: unknown, path = "/v1/messages", extra: Record<string, string> = {}, init: RequestInit = {}) =>
  fetch(gatewayUrl + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": token, "anthropic-version": "2023-06-01", ...extra },
    body: JSON.stringify(body),
    ...init,
  });
const plain = (test?: string) => ({ model: "claude-opus-5-5", max_tokens: 10, messages: [], ...(test ? { metadata: { test } } : {}) });

/** Wait until the project has the expected number of model.call events (the stream records after the client finishes). */
async function waitForCalls(id: string, n: number) {
  for (let i = 0; i < 50; i++) {
    const events = await listEvents(pool, id, "model.call");
    if (events.length >= n) return events;
    await new Promise((r) => setTimeout(r, 20));
  }
  return listEvents(pool, id, "model.call");
}

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
    expect(JSON.stringify(events[0]!.payload)).not.toContain(REAL_KEY);
    const p = events[0]!.payload as { model: string; priced_as: string; usage: { input_tokens: number }; cost_usd: number; price_known: boolean };
    expect(events[0]!.step).toBe("step-1");
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.priced_as).toBe("claude-opus-5-5");
    expect(p.price_known).toBe(true);
    expect(p.usage.input_tokens).toBe(2000);
    expect(p.cost_usd).toBeCloseTo(PLAIN_COST, 6);
    expect(Number((await getSpend(pool, id)).spent_usd)).toBeCloseTo(PLAIN_COST, 6);
  });

  it("relays a streamed response byte for byte and meters it from the stream's events", async () => {
    const { id, token } = await newProject(5);
    const res = await call(token, { model: "claude-sonnet-5-5", max_tokens: 10, stream: true, messages: [] });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(STREAM_FRAMES.join(""));
    const events = await waitForCalls(id, 1);
    expect(events).toHaveLength(1);
    const p = events[0]!.payload as { usage: Record<string, number>; cost_usd: number; served_model: string; incomplete?: boolean };
    expect(p.usage).toMatchObject({ input_tokens: 1000, cache_read_input_tokens: 500, output_tokens: 200 });
    expect(p.served_model).toBe("claude-sonnet-5-5");
    expect(p.incomplete).toBeUndefined();
    expect(p.cost_usd).toBeCloseTo((1000 * 2 + 500 * 0.1 + 200 * 10) / 1e6, 6);
  });

  it("records a stream the client abandoned part-way, marked incomplete, with the usage seen so far", async () => {
    const { id, token } = await newProject(5);
    const controller = new AbortController();
    const res = await call(token, { model: "claude-sonnet-5-5", max_tokens: 10, stream: true, messages: [], metadata: { test: "slow-stream" } }, "/v1/messages", {}, { signal: controller.signal });
    const reader = res.body!.getReader();
    await reader.read(); // first frame: message_start
    controller.abort();
    const events = await waitForCalls(id, 1);
    expect(events).toHaveLength(1);
    const p = events[0]!.payload as { incomplete?: boolean; usage: { input_tokens: number } };
    expect(p.incomplete).toBe(true);
    expect(p.usage.input_tokens).toBe(1000);
  });

  it("prices one-hour cache writes and fast mode from the response, not the request", async () => {
    const { id, token } = await newProject(5);
    expect((await call(token, plain("fast-1h"))).status).toBe(200);
    const p = (await listEvents(pool, id, "model.call"))[0]!.payload as { usage: { speed: string; cache_creation_1h_tokens: number }; cost_usd: number };
    expect(p.usage.speed).toBe("fast");
    expect(p.usage.cache_creation_1h_tokens).toBe(100);
    const expected = 2 * ((2000 * 4 + 100 * 8 + 400 * 0.2 + 300 * 20) / 1e6);
    expect(p.cost_usd).toBeCloseTo(expected, 6);
  });

  it("prices by the model that served the answer when it differs from the one requested", async () => {
    const { id, token } = await newProject(5);
    expect((await call(token, plain("served-haiku"))).status).toBe(200);
    const p = (await listEvents(pool, id, "model.call"))[0]!.payload as { priced_as: string; cost_usd: number };
    expect(p.priced_as).toBe("claude-haiku-5-5");
    expect(p.cost_usd).toBeCloseTo(costUsd("claude-haiku-5-5", { ...emptyUsage(), ...PLAIN_USAGE })!, 6);
  });

  it("records a failed upstream answer with zero usage and the upstream error", async () => {
    const { id, token } = await newProject(5);
    const res = await call(token, plain("fail-500"));
    expect(res.status).toBe(500);
    const p = (await listEvents(pool, id, "model.call"))[0]!.payload as { status: number; cost_usd: number; upstream_error: unknown };
    expect(p.status).toBe(500);
    expect(p.cost_usd).toBe(0);
    expect(p.upstream_error).toBeTruthy();
  });

  it("does not follow a redirect from the provider, so the key goes nowhere else", async () => {
    const { id, token } = await newProject(5);
    const res = await call(token, plain("redirect"));
    expect(res.status).toBe(502);
    const p = (await listEvents(pool, id, "model.call"))[0]!.payload as { status: number; incomplete: boolean };
    expect(p.status).toBe(307);
    expect(p.incomplete).toBe(true);
  });

  it("answers 502 and records the attempt when the provider cannot be reached", async () => {
    const dead = createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl: "http://127.0.0.1:9" });
    const { server, url } = await listen(dead);
    try {
      const { id, token } = await newProject(5);
      const res = await fetch(url + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": token }, body: JSON.stringify(plain()) });
      expect(res.status).toBe(502);
      const p = (await listEvents(pool, id, "model.call"))[0]!.payload as { incomplete: boolean; status: number };
      expect(p.incomplete).toBe(true);
      expect(p.status).toBe(0);
    } finally {
      server.close();
    }
  });
});

describe("model gateway: the cap", () => {
  it("refuses the call whose estimate would cross the cap, names the reason, and logs the refusal", async () => {
    const { id, token } = await newProject(PLAIN_COST * 2.5);
    expect((await call(token, plain())).status).toBe(200);
    expect((await call(token, plain())).status).toBe(200);
    const third = await call(token, plain());
    expect(third.status).toBe(402);
    const body = (await third.json()) as { error: { type: string; message: string } };
    expect(body.error.type).toBe("budget_reached");
    expect(body.error.message).toMatch(/reached its budget/);
    const refused = await listEvents(pool, id, "gateway.refused");
    expect(refused).toHaveLength(1);
    expect((refused[0]!.payload as { reason: string }).reason).toBe("budget_reached");
    expect(await listEvents(pool, id, "model.call")).toHaveLength(2);
    const spend = await getSpend(pool, id);
    expect(Number(spend.spent_usd)).toBeLessThanOrEqual(Number(spend.cap_usd));
  });

  it("refuses outright once spend has reached the cap", async () => {
    const { token } = await newProject(PLAIN_COST);
    expect((await call(token, plain())).status).toBe(200);
    expect((await call(token, plain())).status).toBe(402);
  });

  it("holds parallel calls to the cap: with history, in-flight calls count against it", async () => {
    const { id, token } = await newProject(PLAIN_COST * 2.5);
    expect((await call(token, plain())).status).toBe(200); // history: one call
    const results = await Promise.all(Array.from({ length: 5 }, () => call(token, plain("slow-wait"))));
    const allowed = results.filter((r) => r.status === 200).length;
    const refused = results.filter((r) => r.status === 402).length;
    expect(allowed).toBe(1);
    expect(refused).toBe(4);
    const spend = await getSpend(pool, id);
    expect(Number(spend.spent_usd)).toBeLessThanOrEqual(Number(spend.cap_usd));
  });

  it("holds parallel calls to the cap: with no history, one call completes before the next is judged", async () => {
    const { id, token } = await newProject(PLAIN_COST * 1.5);
    const results = await Promise.all(Array.from({ length: 3 }, () => call(token, plain("slow-wait"))));
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    expect(results.filter((r) => r.status === 402).length).toBe(2);
    expect(await listEvents(pool, id, "model.call")).toHaveLength(1);
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
