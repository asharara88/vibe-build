import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGateway } from "../src/gateway/app.js";
import { costUsd } from "../src/gateway/cost.js";
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

/** A stand-in for the model provider: returns a fixed answer with a usage block, or a stream. */
function mockUpstream() {
  const app = new Hono();
  app.post("/v1/messages", async (c) => {
    seenKeys.push(c.req.header("x-api-key") ?? "(none)");
    const body = (await c.req.json()) as { model: string; stream?: boolean };
    if (body.stream) {
      const frames = [
        `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 1000, cache_read_input_tokens: 500, cache_creation_input_tokens: 0, output_tokens: 1 } } })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hello" } })}\n\n`,
        `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 200 } })}\n\n`,
        `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
      ];
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          for (const f of frames) ctrl.enqueue(new TextEncoder().encode(f));
          ctrl.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }
    return c.json({
      id: "msg_test",
      type: "message",
      model: body.model,
      content: [{ type: "text", text: "hello" }],
      usage: { input_tokens: 2000, output_tokens: 300, cache_creation_input_tokens: 100, cache_read_input_tokens: 400 },
    });
  });
  app.post("/v1/messages/count_tokens", (c) => c.json({ input_tokens: 42 }));
  return app;
}

function listen(app: Hono): Promise<{ server: ServerType; url: string }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
      resolve({ server, url: `http://127.0.0.1:${info.port}` });
    });
  });
}

beforeAll(async () => {
  pool = await testPool();
  ({ server: upstream, url: upstreamUrl } = await listen(mockUpstream()));
  const app = createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl });
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

const call = (token: string, body: unknown, path = "/v1/messages", extra: Record<string, string> = {}) =>
  fetch(gatewayUrl + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": token, "anthropic-version": "2023-06-01", ...extra },
    body: JSON.stringify(body),
  });

describe("model gateway", () => {
  it("replaces the project token with the real key and records usage and cost", async () => {
    const { id, token } = await newProject(5);
    const res = await call(token, { model: "claude-opus-5-5", max_tokens: 10, messages: [] }, "/v1/messages", { "x-builder-step": "step-1" });
    expect(res.status).toBe(200);
    expect(seenKeys.at(-1)).toBe(REAL_KEY);
    const events = await listEvents(pool, id, "model.call");
    expect(events).toHaveLength(1);
    const p = events[0]!.payload as { model: string; usage: { input_tokens: number }; cost_usd: number };
    expect(events[0]!.step).toBe("step-1");
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.usage.input_tokens).toBe(2000);
    // 2000 in at $4/M + 100 cache-write at $5/M + 400 cache-read at $0.20/M + 300 out at $20/M
    const expected = (2000 * 4 + 100 * 5 + 400 * 0.2 + 300 * 20) / 1e6;
    expect(p.cost_usd).toBeCloseTo(expected, 6);
    expect(costUsd("claude-opus-5-5", p.usage as never)).toBeCloseTo(expected, 6);
    const spend = await getSpend(pool, id);
    expect(Number(spend.spent_usd)).toBeCloseTo(expected, 6);
  });

  it("meters a streamed response without altering what the client receives", async () => {
    const { id, token } = await newProject(5);
    const res = await call(token, { model: "claude-sonnet-5-5", max_tokens: 10, stream: true, messages: [] });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("message_start");
    expect(text).toContain("message_stop");
    // Give the flush a moment to write the event.
    await new Promise((r) => setTimeout(r, 50));
    const events = await listEvents(pool, id, "model.call");
    expect(events).toHaveLength(1);
    const p = events[0]!.payload as { usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number }; cost_usd: number };
    expect(p.usage).toMatchObject({ input_tokens: 1000, cache_read_input_tokens: 500, output_tokens: 200 });
    expect(p.cost_usd).toBeCloseTo((1000 * 2 + 500 * 0.1 + 200 * 10) / 1e6, 6);
  });

  it("stops a project before its cap would be crossed, names the reason, and logs the refusal", async () => {
    // Cap of 2.5 calls: calls 1 and 2 pass (spent 2x); call 3 would reach 3x, so it is refused.
    const oneCall = (2000 * 4 + 100 * 5 + 400 * 0.2 + 300 * 20) / 1e6;
    const { id, token } = await newProject(oneCall * 2.5);
    const first = await call(token, { model: "claude-opus-5-5", max_tokens: 10, messages: [] });
    expect(first.status).toBe(200);
    const second = await call(token, { model: "claude-opus-5-5", max_tokens: 10, messages: [] });
    expect(second.status).toBe(200);
    const third = await call(token, { model: "claude-opus-5-5", max_tokens: 10, messages: [] });
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
    const oneCall = (2000 * 4 + 100 * 5 + 400 * 0.2 + 300 * 20) / 1e6;
    // Cap of exactly one call: the first call (no history) is allowed and reaches the cap; the second is refused.
    const { token } = await newProject(oneCall);
    expect((await call(token, { model: "claude-opus-5-5", max_tokens: 10, messages: [] })).status).toBe(200);
    expect((await call(token, { model: "claude-opus-5-5", max_tokens: 10, messages: [] })).status).toBe(402);
  });

  it("refuses a model that is not in the profile", async () => {
    const { token } = await newProject(5);
    const res = await call(token, { model: "some-other-model", max_tokens: 10, messages: [] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/not in this project's profile/);
  });

  it("refuses an unknown token and never forwards it", async () => {
    const before = seenKeys.length;
    const res = await call("bpt_nobody_xyz", { model: "claude-opus-5-5", max_tokens: 10, messages: [] });
    expect(res.status).toBe(401);
    expect(seenKeys.length).toBe(before);
  });

  it("passes other API paths through and logs them without metering", async () => {
    const { id, token } = await newProject(5);
    const res = await call(token, { model: "claude-opus-5-5", messages: [] }, "/v1/messages/count_tokens");
    expect(res.status).toBe(200);
    expect(await listEvents(pool, id, "gateway.passthrough")).toHaveLength(1);
    expect(await listEvents(pool, id, "model.call")).toHaveLength(0);
  });
});
