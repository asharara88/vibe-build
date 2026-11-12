import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGateway, normalisePath, startHoldKeeper } from "../src/gateway/app.js";
import { costUsd, emptyUsage } from "../src/gateway/cost.js";
import { COUNT_MARGIN, computeHold, DEFAULT_PROFILES, guardRequest, type ProfileLimits } from "../src/gateway/hold.js";
import { listEvents } from "../src/store/events.js";
import { expireHolds, getBudget, listHolds } from "../src/store/holds.js";
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
/** How many metered calls reached the stand-in provider. A refused call must not move it. */
let forwarded = 0;

const PROFILES: Record<string, ProfileLimits> = {
  ...DEFAULT_PROFILES,
  fast: { maxTokensCeiling: 16_000, allowFastMode: true },
};

// One plain call on Opus 5.5. The stand-in counts the prompt as 42 tokens and bills 42.
const PLAIN_USAGE = { input_tokens: 30, output_tokens: 300, cache_creation_input_tokens: 4, cache_read_input_tokens: 8 };
const PLAIN_COST = (30 * 4 + 4 * 5 + 8 * 0.2 + 300 * 20) / 1e6;
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
    const body = (await c.req.json()) as { model: string; stream?: boolean; max_tokens?: number; metadata?: { test?: string } };
    const mode = body.metadata?.test ?? "";
    if (mode === "fail-500") return c.json({ type: "error", error: { type: "api_error", message: "stand-in failure" } }, 500);
    if (mode === "fail-400") return c.json({ type: "error", error: { type: "invalid_request_error", message: "stand-in rejection" } }, 400);
    if (mode === "redirect") return c.redirect("http://127.0.0.1:9/elsewhere", 307);
    if (mode === "slow-wait") await new Promise((r) => setTimeout(r, 300));
    if (mode === "very-slow") await new Promise((r) => setTimeout(r, 1500));
    if (mode === "no-usage") return c.json({ id: "msg_test", type: "message", model: body.model, content: [{ type: "text", text: "hello" }] });
    if (body.stream) {
      const slow = mode === "slow-stream";
      const frames = mode === "stream-no-usage" ? [STREAM_FRAMES[1]!, STREAM_FRAMES[3]!] : STREAM_FRAMES;
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
    const m = /^count:(\d+)$/.exec(s);
    return c.json({ input_tokens: m ? Number(m[1]) : 42 });
  });
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
    near(p.cost_usd, 2 * ((30 * 4 + 4 * 8 + 8 * 0.2 + 300 * 20) / 1e6));
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
    const dead = createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl: "http://127.0.0.1:9", profiles: PROFILES });
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
  // What package 1.2 guarantees is the direction: nothing is released.
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

  it("the provider reachable for counting but not for the call itself", async () => {
    const halfDead: typeof fetch = (input, init) => {
      if (String(input).endsWith("/v1/messages")) return Promise.reject(Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" }));
      return fetch(input, init);
    };
    const { server, url } = await listen(createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, fetchImpl: halfDead, onFault: (m) => faults.push(m) }));
    try {
      const { id, token } = await newProject(5);
      expect((await callAt(url, token, plain())).status).toBe(502);
      await expectKept(id, "could not be reached");
    } finally {
      server.close();
    }
  });
});

describe("holds: proof rows B1 to B6 of the design note", () => {
  it("B1: a hold is opened before the call is forwarded and settled to the actual cost", async () => {
    const { id, token } = await newProject(5);
    expect((await call(token, plain())).status).toBe(200);
    expect(await kinds(id)).toEqual(["hold.opened", "model.call", "hold.settled"]);
    const opened = (await listEvents(pool, id, "hold.opened"))[0]!.payload as {
      hold_id: number;
      amount_usd: number;
      arithmetic: { counted_prompt_tokens: number; prompt_tokens_held: number; max_tokens: number; input_rate_usd_per_million: number; output_rate_usd_per_million: number; fast_mode_factor: number; input_part_usd: number; output_part_usd: number };
    };
    const a = opened.arithmetic;
    expect(a).toMatchObject({ counted_prompt_tokens: 42, prompt_tokens_held: 42 + margin(42), max_tokens: PLAIN_MAX_TOKENS, input_rate_usd_per_million: 8, output_rate_usd_per_million: 20, fast_mode_factor: 1 });
    near(opened.amount_usd, (a.prompt_tokens_held * a.input_rate_usd_per_million + a.max_tokens * a.output_rate_usd_per_million) / 1e6);
    near(opened.amount_usd, PLAIN_HOLD);
    const settled = (await listEvents(pool, id, "hold.settled"))[0]!.payload as { hold_id: number; amount_usd: number; actual_usd: number; returned_usd: number };
    expect(settled.hold_id).toBe(opened.hold_id);
    near(settled.actual_usd, PLAIN_COST);
    expect(settled.actual_usd).toBeLessThanOrEqual(settled.amount_usd);
    near(settled.returned_usd, PLAIN_HOLD - PLAIN_COST);
    const budget = await getBudget(pool, id);
    near(budget.spent, PLAIN_COST); // the difference is back in the budget
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
      expect(await expireHolds(pool, new Date(Date.now() - 60_000))).toEqual([]); // not yet past its deadline
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

  it("B6: holds are database rows: a gateway that starts finds the hold an earlier one left open, and keeps it", async () => {
    const first = await listen(createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl, profiles: PROFILES, gatewayId: "gw_test_first", onFault: (m) => faults.push(m) }));
    const { id, token } = await newProject(PLAIN_HOLD * 1.5);
    // A call is in flight when the first gateway stops.
    const controller = new AbortController();
    const inFlight = callAt(first.url, token, plain("very-slow"), "/v1/messages", {}, { signal: controller.signal }).catch(() => null);
    await waitForEvents(id, "hold.opened", 1);
    controller.abort();
    await inFlight;
    await new Promise<void>((resolve) => first.server.close(() => resolve()));
    const before = await getBudget(pool, id);
    near(before.openHolds, PLAIN_HOLD);

    // A new gateway process starts on the same database.
    const keeper = await startHoldKeeper(pool, "gw_test_restarted");
    keeper.stop();
    expect(keeper.found).toBeGreaterThanOrEqual(1);
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
