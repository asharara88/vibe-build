/**
 * Package 1.3: the pre-step check and the step hold (design note 5.5, "The pre-step check"; proof row B7).
 * Against the store, the gateway and a stand-in provider in this process: no real provider is called,
 * no key exists, nothing is spent. The engines here are stand-ins written for these tests: they make
 * calls through the gateway with the step's token. No engine in the builder takes a token yet.
 *
 * The figures: a call on Claude Opus 5.5 whose prompt is counted as 42 tokens, with max_tokens 400, is
 * held at (42 + 5% + 200 = 245 tokens) x $8 + 400 x $20 per million = $0.00996, and the stand-in bills
 * it $0.006142. A step of 3 turns at that model, ceiling and prompt limit has a budget of $0.02988.
 */
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGateway } from "../src/gateway/app.js";
import { emptyUsage } from "../src/gateway/cost.js";
import { DEFAULT_PROFILES, StepBudgetInvalid, stepBudget, type ProfileLimits } from "../src/gateway/hold.js";
import { PRICE_TABLE_DATE } from "../src/gateway/prices.js";
import type { BuildEngine, EngineEvent, StepInstruction } from "../src/engine/interface.js";
import { runBudgetedStep } from "../src/orchestrator/steps.js";
import { listEvents } from "../src/store/events.js";
import { CapChangeRefused, changeCap, closeStepHold, committedMicro, expireHolds, getBudget, listHolds, listStepHolds, micro, openHold, openStepHold } from "../src/store/holds.js";
import { createProject, issueProjectToken } from "../src/store/projects.js";
import { TEST_DB_URL, testPool, uniqueId } from "./helpers.js";

const REAL_KEY = "test-real-key-of-package-1-3";
let pool: pg.Pool;
let upstream: ServerType;
let gateway: ServerType;
let gatewayUrl: string;
const faults: string[] = [];
/** Metered calls that reached the stand-in provider, and counting calls. */
let forwarded = 0;
let counted = 0;
/** Per project: spent + open holds + room reserved for steps, in millionths, at the moment each call reached the stand-in. */
const committedAtForward = new Map<string, number[]>();
/** Every project made here, for the check that no step token was written to the event log. */
const projects: string[] = [];

/** The limits a step's budget is worked out from in these tests: an output ceiling of 400 and a prompt limit of 42 tokens. */
const STEP_PROFILE: ProfileLimits = { maxTokensCeiling: 400, allowFastMode: false, stepPromptTokens: 42 };
const MODEL = "claude-opus-5-5";
const PER_TURN = 0.00996;
const S3 = 0.02988;
const COST = 0.006142;
const USAGE = { input_tokens: 30, output_tokens: 300, cache_creation_input_tokens: 4, cache_read_input_tokens: 8 };

/** A gate for the counting call: the test sees the count arrive, then lets it answer. */
let countGate: { arrived: () => void; release: Promise<void> } | null = null;

function standInProvider() {
  const app = new Hono();
  app.post("/v1/messages/count_tokens", async (c) => {
    counted++;
    const body = (await c.req.json()) as { system?: string };
    const s = typeof body.system === "string" ? body.system : "";
    if (s === "count-gated" && countGate) {
      countGate.arrived();
      await countGate.release;
      return c.json({ input_tokens: 42 });
    }
    const m = /^count:(\d+)$/.exec(s);
    return c.json({ input_tokens: m ? Number(m[1]) : 42 });
  });
  app.post("/v1/messages", async (c) => {
    forwarded++;
    const body = (await c.req.json()) as { model: string; max_tokens: number; metadata?: { test?: string; project?: string } };
    const mode = body.metadata?.test ?? "";
    if (mode === "note-budget") {
      const project = String(body.metadata?.project ?? "");
      const b = await getBudget(pool, project);
      committedAtForward.set(project, [...(committedAtForward.get(project) ?? []), committedMicro(b)]);
    }
    if (mode === "fail-500") return c.json({ type: "error", error: { type: "api_error", message: "stand-in failure" } }, 500);
    // Bills more output than max_tokens allowed: a cost above the call's hold.
    if (mode === "bill-over-hold") return c.json({ id: "msg_test", type: "message", model: body.model, content: [], usage: { ...USAGE, output_tokens: body.max_tokens + 2000 } });
    return c.json({ id: "msg_test", type: "message", model: body.model, content: [{ type: "text", text: "hello" }], usage: USAGE });
  });
  return app;
}

function listen(app: Hono): Promise<{ server: ServerType; url: string }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => resolve({ server, url: `http://127.0.0.1:${info.port}` }));
  });
}

beforeAll(async () => {
  pool = await testPool();
  const provider = await listen(standInProvider());
  upstream = provider.server;
  const app = createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl: provider.url, profiles: DEFAULT_PROFILES, gatewayId: "gw_test_steps", onFault: (m) => faults.push(m) });
  ({ server: gateway, url: gatewayUrl } = await listen(app));
});
afterAll(async () => {
  gateway.close();
  upstream.close();
  await pool.end();
});

async function newProject(capUsd: number) {
  const id = uniqueId("s13");
  projects.push(id);
  await createProject(pool, { id, name: "step hold test", capUsd });
  return { id, token: await issueProjectToken(pool, id) };
}

/** One plain call through the gateway, as an engine would make it. */
const call = (token: string, more: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  fetch(gatewayUrl + "/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": token, "anthropic-version": "2023-06-01", ...headers },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [], ...more }),
  });

interface PlannedCall {
  more?: Record<string, unknown>;
}
/**
 * A stand-in engine: for each planned call it calls the gateway with the step's token; then it runs
 * `during` (the test's own actions while the step is still running); then it throws, if told to, or
 * reports the step finished. `created` counts how many times the engine was made.
 */
function standInEngine(plan: { calls: PlannedCall[]; during?: () => Promise<void>; throwAtEnd?: boolean }) {
  const seen = { created: 0, statuses: [] as number[], bodies: [] as { error?: { type: string; message: string } }[], tokens: [] as string[] };
  const engineFor = ({ gatewayUrl: url, token }: { gatewayUrl: string; token: string }): BuildEngine => {
    seen.created++;
    seen.tokens.push(token);
    expect(url).toBe(gatewayUrl);
    return {
      name: "stand-in engine (test)",
      async runStep(step, onEvent) {
        for (const p of plan.calls) {
          const res = await call(token, p.more);
          seen.statuses.push(res.status);
          seen.bodies.push((await res.json()) as { error?: { type: string; message: string } });
        }
        if (plan.during) await plan.during();
        if (plan.throwAtEnd) throw new Error("stand-in engine failed part-way");
        onEvent({ type: "finished", at: new Date().toISOString() });
        return { ok: true, changedFiles: [], usage: emptyUsage(), turns: plan.calls.length, failureReason: undefined };
      },
      async stop() {},
    };
  };
  return { engineFor, seen };
}

const stepOf = (projectId: string, maxTurns = 3, stepId = "step-1"): StepInstruction => ({
  projectId,
  stepId,
  instruction: "Made-up instruction for a step-hold test.",
  protectedPaths: [],
  maxTurns,
});
function run(projectId: string, engine: ReturnType<typeof standInEngine>, o: { maxTurns?: number; events?: EngineEvent[]; profile?: ProfileLimits } = {}) {
  return runBudgetedStep({
    pool,
    profile: o.profile ?? STEP_PROFILE,
    model: MODEL,
    gatewayUrl,
    engineFor: engine.engineFor,
    step: stepOf(projectId, o.maxTurns ?? 3),
    onEvent: (e) => o.events?.push(e),
    stepTimeLimitMs: 600_000,
    onFault: (m) => faults.push(m),
  });
}
const openStep = (projectId: string, maxTurns = 3, deadline = new Date(Date.now() + 600_000), stepId = "step-1", profile = STEP_PROFILE) =>
  openStepHold(pool, { projectId, stepId, model: MODEL, maxTurns, profile, deadline });
const setUpHold = (projectId: string, amountUsd: number, p: pg.Pool = pool) =>
  openHold(p, { projectId, step: null, amountUsd, deadline: new Date(Date.now() + 600_000), gateway: "gw_test_setup", arithmetic: {}, path: "/v1/messages" });
const kinds = async (id: string) => (await listEvents(pool, id)).map((e) => e.kind);
const payloads = async (id: string, kind: string) => (await listEvents(pool, id, kind)).map((e) => e.payload as Record<string, unknown>);
/** budget = released + still held + spent in the step − overrun not covered, in millionths. */
function expectIdentity(p: Record<string, unknown>) {
  const m = (k: string) => micro(p[k] as number);
  expect(m("budget_usd")).toBe(m("released_usd") + m("still_held_usd") + m("spent_in_step_usd") - m("overrun_not_covered_usd"));
}

describe("package 1.3: the pre-step check and the step hold (proof row B7)", () => {
  it("1.3 the budget of a 3-turn step at the test's limits is $0.02988, worked in whole millionths", () => {
    const sb = stepBudget({ model: MODEL, maxTurns: 3, profile: STEP_PROFILE, priceTableDate: PRICE_TABLE_DATE });
    expect([sb.perTurnUsd, sb.budgetUsd, sb.budgetMicro, sb.perTurn.prompt_tokens_held]).toEqual([PER_TURN, S3, 29880, 245]);
    // Exact for every turn limit allowed. In dollars, 13 x 0.00996 x 1,000,000 comes to 129480.00000000001 (measured in Node).
    for (let turns = 1; turns <= 1000; turns++) {
      const b = stepBudget({ model: MODEL, maxTurns: turns, profile: STEP_PROFILE, priceTableDate: PRICE_TABLE_DATE });
      if (b.budgetMicro !== turns * 9960 || b.budgetUsd !== (turns * 9960) / 1e6) throw new Error(`${turns} turns: ${b.budgetMicro}`);
    }
    expect(stepBudget({ model: MODEL, maxTurns: 13, profile: STEP_PROFILE, priceTableDate: PRICE_TABLE_DATE }).budgetUsd).toBe(0.12948);
  });

  it("1.3 T1 (B7, refused): a step whose budget does not fit is refused before it starts, with the message shown; the engine is never created", async () => {
    const { id } = await newProject(0.02);
    const engine = standInEngine({ calls: [{}, {}, {}] });
    const events: EngineEvent[] = [];
    const before = { forwarded, counted };
    const r = await run(id, engine, { events });
    const message =
      "This step needs up to $0.03 to finish (3 turns); this project has $0.02 left of its budget of $0.02 (spent $0.00, with $0.00 held for work in progress or awaiting reconciliation). The step was not started. A cap of at least $0.03 would let it start now.";
    expect(r).toEqual({ ok: false, changedFiles: [], usage: emptyUsage(), turns: 0, failureReason: message });
    expect(engine.seen.created).toBe(0);
    expect({ forwarded, counted }).toEqual(before);
    expect(events.map((e) => [e.type, e.type === "failed" ? e.reason : ""])).toEqual([["failed", message]]);
    expect(await kinds(id)).toEqual(["step.refused"]);
    expect((await payloads(id, "step.refused"))[0]).toMatchObject({
      reason: "budget_reached",
      cap_usd: 0.02,
      spent_usd: 0,
      open_holds_usd: 0,
      step_room_usd: 0,
      step_budget_usd: S3,
      turns: 3,
      per_turn_usd: PER_TURN,
      model: MODEL,
      max_tokens_ceiling: 400,
      prompt_tokens: 42,
      lowest_cap_usd: 0.03,
      message,
    });
    expect(await listStepHolds(pool, id)).toEqual([]);
    expect(await getBudget(pool, id)).toEqual({ cap: 0.02, spent: 0, openHolds: 0, openHoldCount: 0, stepRoom: 0, openSteps: 0 });
    console.log(`1.3 T1, the message shown: ${message}`);
  });

  it("1.3 T2: a step budget equal to the room left is let start; one millionth more is refused", async () => {
    // Caps keep 4 decimals and the budget has 6, so a set-up hold makes the room left exactly the budget.
    const fits = await newProject(0.03);
    expect((await setUpHold(fits.id, 0.00012)).ok).toBe(true); // room left: 0.03 − 0.00012 = 0.02988
    const a = await openStep(fits.id);
    expect(a.ok).toBe(true);
    const b = await getBudget(pool, fits.id);
    expect([committedMicro(b), micro(b.cap)]).toEqual([30000, 30000]);
    const short = await newProject(0.03);
    expect((await setUpHold(short.id, 0.000121)).ok).toBe(true); // room left: 0.029879, one millionth short
    const r = await openStep(short.id);
    expect(r.ok).toBe(false);
    expect(await listStepHolds(pool, short.id)).toEqual([]);
    expect(await kinds(short.id)).toEqual(["hold.opened", "step.refused"]);
  });

  it("1.3 T3 (B7, drawn): each call's hold is drawn from the step's hold, and spent + open holds + reserved room stays at the step's budget at every forward", async () => {
    const { id } = await newProject(0.0299); // the step's budget fits; the step's budget plus one call outside it would not
    const engine = standInEngine({ calls: [1, 2, 3].map(() => ({ more: { metadata: { test: "note-budget", project: id } } })) });
    const r = await run(id, engine);
    expect(r.ok).toBe(true);
    expect(engine.seen.statuses).toEqual([200, 200, 200]);
    expect(committedAtForward.get(id)).toEqual([29880, 29880, 29880]);
    const opened = (await payloads(id, "hold.opened")).map((p) => p["step_hold"] as Record<string, number>);
    expect(opened.map((s) => [s.room_before_usd, s.room_after_usd])).toEqual([
      [0.02988, 0.01992],
      [0.023738, 0.013778],
      [0.017596, 0.007636],
    ]);
    const settled = (await payloads(id, "hold.settled")).map((p) => (p["step_hold"] as Record<string, number>).room_after_usd);
    expect(settled).toEqual([0.023738, 0.017596, 0.011454]);
    const holds = await listHolds(pool, id);
    expect(holds.map((h) => [h.step, h.state, h.step_hold_id])).toEqual(holds.map(() => ["step-1", "settled", (holds[0]!.step_hold_id ?? "none")]));
    expect(holds[0]!.step_hold_id).not.toBeNull();
    const closed = (await payloads(id, "step.hold_closed"))[0]!;
    expect(closed).toMatchObject({ reason: "step_ended", budget_usd: S3, drawn_usd: S3, calls_drawn: 3, spent_in_step_usd: 0.018426, still_held_usd: 0, released_usd: 0.011454, overrun_not_covered_usd: 0, tokens_revoked: 1 });
    expectIdentity(closed);
    // The step's token is a credential: it appears in no event.
    const log = JSON.stringify(await listEvents(pool, id));
    expect(log.includes(engine.seen.tokens[0]!)).toBe(false);
    expect(log.includes("bpt_")).toBe(false);
    console.log(`1.3 T3, the log: ${(await kinds(id)).join(", ")}`);
  });

  it("1.3 T4: a call that needs more than the room left in its step is refused (402, step_budget_reached) and not forwarded, though the project's free budget would fit it", async () => {
    const { id } = await newProject(1);
    const engine = standInEngine({ calls: [{}, {}, {}] });
    const before = forwarded;
    const r = await run(id, engine, { maxTurns: 2 }); // a budget of $0.01992 for three calls of $0.00996
    expect(r.ok).toBe(true); // the stand-in engine reports what it was told; the third call's answer is the point
    expect(engine.seen.statuses).toEqual([200, 200, 402]);
    expect(forwarded - before).toBe(2);
    expect(engine.seen.bodies[2]!.error).toEqual({
      type: "step_budget_reached",
      message:
        "This step has used up its budget: $0.00 is left of the $0.02 reserved for it, and this call needed up to $0.01. The gateway forwarded nothing. Raising the project's cap does not add to a running step's budget: the step has to end, and a new one be started.",
    });
    const refused = (await payloads(id, "gateway.refused"))[0]!;
    expect(refused).toMatchObject({ reason: "step_budget_used_up", this_hold_usd: PER_TURN, step_hold: { room_usd: 0.007636, budget_usd: 0.01992 } });
    expect(micro(refused["cap_usd"] as number) - micro(refused["spent_usd"] as number) - micro(refused["open_holds_usd"] as number) - micro(refused["step_room_usd"] as number)).toBeGreaterThan(micro(PER_TURN));
    const closed = (await payloads(id, "step.hold_closed"))[0]!;
    expect(closed).toMatchObject({ calls_drawn: 2, spent_in_step_usd: 0.012284, released_usd: 0.007636 });
    expectIdentity(closed);
  });

  it("1.3 T5 (B7, released): when the step ends its unused room is released, and a call outside the step that needed that room now fits", async () => {
    const { id, token } = await newProject(0.035);
    const outside: number[] = [];
    const engine = standInEngine({
      calls: [{}],
      during: async () => {
        outside.push((await call(token)).status); // during the step: $0.02988 reserved + $0.00996 > $0.035
      },
    });
    const r = await run(id, engine);
    expect(r.ok).toBe(true);
    outside.push((await call(token)).status); // after the step: $0.006142 spent + $0.00996 fits
    expect(outside).toEqual([402, 200]);
    const closed = (await payloads(id, "step.hold_closed"))[0]!;
    expect(closed).toMatchObject({ budget_usd: S3, drawn_usd: PER_TURN, calls_drawn: 1, spent_in_step_usd: COST, still_held_usd: 0, released_usd: 0.023738, overrun_not_covered_usd: 0 });
    expectIdentity(closed);
    expect((await getBudget(pool, id)).stepRoom).toBe(0);
    expect(await kinds(id)).toEqual(["step.hold_opened", "hold.opened", "model.call", "hold.settled", "gateway.refused", "step.hold_closed", "hold.opened", "model.call", "hold.settled"]);
  });

  it("1.3 T5: a call that costs more than its hold and the room left is charged in full, and the close's figures still add up (the overrun not covered is named)", async () => {
    const { id } = await newProject(1);
    const engine = standInEngine({ calls: [{ more: { metadata: { test: "bill-over-hold" } } }] });
    const faultsBefore = faults.length;
    const r = await run(id, engine, { maxTurns: 1 });
    expect(r.ok).toBe(true);
    const cost = Math.ceil(((30 * 4 + 4 * 5 + 8 * 0.2 + 2400 * 20) / 1e6) * 1e6 - 1e-6) / 1e6; // $0.0481416, rounded up to the millionth as every cost is: $0.048142
    const closed = (await payloads(id, "step.hold_closed"))[0]!;
    expect(closed).toMatchObject({ budget_usd: PER_TURN, spent_in_step_usd: cost, released_usd: 0, overrun_not_covered_usd: Math.round((cost - PER_TURN) * 1e6) / 1e6 });
    expectIdentity(closed);
    expect(await kinds(id)).toContain("hold.exceeded");
    expect(faults.slice(faultsBefore)).toEqual(["A settled call cost more than its hold."]);
    faults.splice(faultsBefore);
  });

  it("1.3 T6: an engine that throws part-way still has its step closed; a call kept after a server error stays open at its full amount", async () => {
    const { id } = await newProject(1);
    const engine = standInEngine({ calls: [{ more: { metadata: { test: "fail-500" } } }], throwAtEnd: true });
    await expect(run(id, engine)).rejects.toThrow("stand-in engine failed part-way");
    expect(engine.seen.statuses).toEqual([500]);
    const closed = (await payloads(id, "step.hold_closed"))[0]!;
    expect(closed).toMatchObject({ reason: "step_ended", drawn_usd: PER_TURN, still_held_usd: PER_TURN, still_held_calls: 1, spent_in_step_usd: 0, released_usd: 0.01992 });
    expectIdentity(closed);
    const holds = await listHolds(pool, id);
    expect(holds.map((h) => [h.state, Number(h.amount_usd), h.kept_reason !== null])).toEqual([["open", PER_TURN, true]]);
    expect(await getBudget(pool, id)).toMatchObject({ openHolds: PER_TURN, openHoldCount: 1, stepRoom: 0, openSteps: 0 });
  });

  it("1.3 T7: a call made with the step's token after the step ended is refused as an unknown token (401): the token was revoked", async () => {
    const { id } = await newProject(1);
    const engine = standInEngine({ calls: [{}] });
    expect((await run(id, engine)).ok).toBe(true);
    const before = { forwarded, counted, events: (await listEvents(pool, id)).length };
    const res = await call(engine.seen.tokens[0]!);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe("authentication_error");
    expect({ forwarded, counted, events: (await listEvents(pool, id)).length }).toEqual(before);
  });

  it("1.3 T7: a call whose token was accepted before its step closed, and judged after, is refused (401, step_closed) and not forwarded", async () => {
    const { id } = await newProject(1);
    const opened = await openStep(id);
    if (!opened.ok) throw new Error("step not opened");
    let arrived!: () => void;
    const countArrived = new Promise<void>((r) => (arrived = r));
    let release!: () => void;
    countGate = { arrived, release: new Promise<void>((r) => (release = r)) };
    try {
      const before = forwarded;
      const pending = call(opened.token, { system: "count-gated" });
      await countArrived; // the token was accepted and the prompt is being counted
      expect((await closeStepHold(pool, { projectId: id, stepHoldId: opened.stepHold.id, reason: "step_ended" })).closed).toBe(true);
      release();
      const res = await pending;
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: { type: string } }).error.type).toBe("step_closed");
      expect(forwarded).toBe(before);
      expect((await payloads(id, "gateway.refused")).map((p) => p["reason"])).toEqual(["step_closed"]);
      expect(await listHolds(pool, id)).toEqual([]);
    } finally {
      countGate = null;
    }
  });

  it("1.3 T9: during a step, a cap lowering below spent + open holds + the room reserved is refused, naming a floor that includes the room; a raise is accepted and leaves the room as it was", async () => {
    const { id } = await newProject(0.05);
    const who = { askedBy: "the test of package 1.3", changedBy: "Claude Code", reason: "test: cap change during a step" };
    const seen: { refusal?: CapChangeRefused; roomBefore?: string; roomAfter?: string; raise?: Awaited<ReturnType<typeof changeCap>> } = {};
    const engine = standInEngine({
      calls: [{}],
      during: async () => {
        // Now: spent $0.006142, no open call hold, $0.023738 reserved. Spent plus open holds alone would allow $0.02.
        try {
          await changeCap(pool, { projectId: id, newCapUsd: 0.02, ...who });
        } catch (e) {
          if (!(e instanceof CapChangeRefused)) throw e;
          seen.refusal = e;
        }
        seen.roomBefore = (await listStepHolds(pool, id))[0]!.room_usd;
        seen.raise = await changeCap(pool, { projectId: id, newCapUsd: 0.06, ...who });
        seen.roomAfter = (await listStepHolds(pool, id))[0]!.room_usd;
      },
    });
    expect((await run(id, engine)).ok).toBe(true);
    expect(seen.refusal?.code).toBe("below_spent_plus_open_holds");
    expect(seen.refusal?.lowestAllowedUsd).toBe(0.0299);
    expect(seen.refusal?.message).toBe(
      "The new cap $0.0200 is below what this project has already spent plus its open holds ($0.006142 spent + $0.000000 held in 0 open hold(s) and $0.023738 reserved for 1 running step(s) = $0.029880). The lowest cap allowed now is $0.0299. Nothing was changed and nothing was written.",
    );
    expect(seen.raise).toMatchObject({ oldCapUsd: 0.05, newCapUsd: 0.06, spentUsd: COST, openHoldsUsd: 0, stepRoomUsd: 0.023738, openSteps: 1 });
    expect([seen.roomBefore, seen.roomAfter]).toEqual(["0.023738", "0.023738"]);
    expect((await payloads(id, "cap.changed")).map((p) => [p["new_cap_usd"], p["step_room_usd"], p["open_steps"]])).toEqual([[0.06, 0.023738, 1]]);
  });

  /** A pool of one connection whose session carries a name, so that the test can see it wait in pg_stat_activity. */
  const namedPool = async (name: string): Promise<pg.Pool> => new (await import("pg")).default.Pool({ connectionString: TEST_DB_URL, application_name: name, max: 1 });
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
   * A third session holds the event log in share mode, so every decision stops at its first event,
   * after it has read the budget and written its row. With the project's lock, the first decision waits
   * there holding it and the second waits for the lock; without it, both read the budget before either
   * is saved. Released, the decisions finish; the test then judges the money.
   */
  async function withEventLogHeld(names: string[], start: (pools: pg.Pool[]) => Promise<unknown>[]): Promise<PromiseSettledResult<unknown>[]> {
    const pools = await Promise.all(names.map(namedPool));
    const holder = await pool.connect();
    let work: Promise<unknown>[] = [];
    let open = false;
    try {
      await holder.query("begin");
      open = true;
      await holder.query("lock table events in share mode");
      work = start(pools);
      for (const w of work) w.catch(() => undefined);
      await waitUntilAllWait(names);
      await holder.query("commit");
      open = false;
      return await Promise.allSettled(work);
    } finally {
      if (open) await holder.query("rollback").catch(() => undefined);
      holder.release();
      await Promise.allSettled(work);
      await Promise.all(pools.map((p) => p.end()));
    }
  }

  it("1.3 T10: a step's admission, a call's admission and a cap change are judged one at a time: with room for only one of two, exactly one gets it", async () => {
    // Round 1: a step ($0.02988) and a call ($0.00996) against a cap of $0.03: either fits alone, not both.
    const a = await newProject(0.03);
    const n1 = [uniqueId("t10_step"), uniqueId("t10_call")];
    const r1 = await withEventLogHeld(n1, ([x, y]) => [
      openStepHold(x!, { projectId: a.id, stepId: "step-1", model: MODEL, maxTurns: 3, profile: STEP_PROFILE, deadline: new Date(Date.now() + 600_000) }),
      setUpHold(a.id, PER_TURN, y!),
    ]);
    const admitted = r1.map((s) => s.status === "fulfilled" && (s.value as { ok: boolean }).ok);
    expect(admitted.filter(Boolean)).toHaveLength(1);
    const b1 = await getBudget(pool, a.id);
    expect(committedMicro(b1)).toBeLessThanOrEqual(micro(b1.cap));
    // Round 2: a step ($0.02988) and a lowering from $0.05 to $0.02, with $0.01 already held: either alone, not both.
    const b = await newProject(0.05);
    expect((await setUpHold(b.id, 0.01)).ok).toBe(true);
    const n2 = [uniqueId("t10_step"), uniqueId("t10_change")];
    const r2 = await withEventLogHeld(n2, ([x, y]) => [
      openStepHold(x!, { projectId: b.id, stepId: "step-1", model: MODEL, maxTurns: 3, profile: STEP_PROFILE, deadline: new Date(Date.now() + 600_000) }),
      changeCap(y!, { projectId: b.id, newCapUsd: 0.02, askedBy: "the test of package 1.3", changedBy: "Claude Code", reason: "test: a lowering against a step" }),
    ]);
    const stepOk = r2[0]!.status === "fulfilled" && (r2[0]!.value as { ok: boolean }).ok;
    const changeOk = r2[1]!.status === "fulfilled";
    expect([stepOk, changeOk].filter(Boolean)).toHaveLength(1);
    const b2 = await getBudget(pool, b.id);
    expect(committedMicro(b2)).toBeLessThanOrEqual(micro(b2.cap));
    console.log(`1.3 T10: round 1 admitted ${admitted[0] ? "the step" : "the call"}; round 2 ${stepOk ? "admitted the step and refused the lowering" : "made the lowering and refused the step"}`);
  });

  it("1.3 T11: a step past its deadline is closed by the sweep: its room is released and its token stops working", async () => {
    const { id } = await newProject(1);
    const opened = await openStep(id, 3, new Date(Date.now() + 3_600_000));
    if (!opened.ok) throw new Error("step not opened");
    await expireHolds(pool, new Date(Date.now() + 7_200_000)); // the sweep, run as if two hours later
    const closed = (await payloads(id, "step.hold_closed"))[0];
    expect(closed).toMatchObject({ reason: "deadline_passed", released_usd: S3, tokens_revoked: 1 });
    expect(await getBudget(pool, id)).toMatchObject({ stepRoom: 0, openSteps: 0 });
    const res = await call(opened.token);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe("authentication_error");
  });

  it("1.3 T11: a step past its deadline is closed by the next decision in its project, before the sweep: its call is refused (step_closed)", async () => {
    const { id } = await newProject(1);
    const opened = await openStep(id, 3, new Date(Date.now() + 200));
    if (!opened.ok) throw new Error("step not opened");
    await new Promise((r) => setTimeout(r, 300));
    const before = forwarded;
    const res = await call(opened.token);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe("step_closed");
    expect(forwarded).toBe(before);
    expect((await payloads(id, "step.hold_closed"))[0]).toMatchObject({ reason: "deadline_passed", released_usd: S3 });
    expect(await kinds(id)).toEqual(["step.hold_opened", "step.hold_closed", "gateway.refused"]);
  });

  it("1.3 T11: closing a step that is already closed writes nothing and does not throw, so a step that ends after the sweep closed it keeps its result", async () => {
    const { id } = await newProject(1);
    const engine = standInEngine({
      calls: [{}],
      during: async () => {
        await expireHolds(pool, new Date(Date.now() + 7_200_000)); // the sweep closes the step while it runs
      },
    });
    const faultsBefore = faults.length;
    const r = await run(id, engine);
    expect(r).toMatchObject({ ok: true, turns: 1 });
    expect(faults.slice(faultsBefore)).toEqual([]);
    expect((await payloads(id, "step.hold_closed")).map((p) => p["reason"])).toEqual(["deadline_passed"]);
    const stepHoldId = (await listStepHolds(pool, id))[0]!.id;
    const count = (await listEvents(pool, id)).length;
    expect(await closeStepHold(pool, { projectId: id, stepHoldId, reason: "step_ended" })).toEqual({ closed: false, closedReason: "deadline_passed" });
    expect((await listEvents(pool, id)).length).toBe(count);
  });

  it("1.3 T12: a turn limit or profile that is not a whole, finite, positive number is refused before anything is opened; the database refuses a NaN or negative step figure on its own", async () => {
    const { id, token } = await newProject(0.005); // below one call's hold: every call must be refused
    const bad: [string, number, ProfileLimits][] = [
      ["NaN turns", Number.NaN, STEP_PROFILE],
      ["-100 turns", -100, STEP_PROFILE],
      ["0 turns", 0, STEP_PROFILE],
      ["1.5 turns", 1.5, STEP_PROFILE],
      ["Infinity turns", Number.POSITIVE_INFINITY, STEP_PROFILE],
      ["1001 turns", 1001, STEP_PROFILE],
      ["'3' turns", "3" as unknown as number, STEP_PROFILE],
      ["NaN prompt limit", 3, { ...STEP_PROFILE, stepPromptTokens: Number.NaN }],
      ["-1 prompt limit", 3, { ...STEP_PROFILE, stepPromptTokens: -1 }],
      ["no prompt limit", 3, { maxTokensCeiling: 400, allowFastMode: false }],
      ["NaN ceiling", 3, { ...STEP_PROFILE, maxTokensCeiling: Number.NaN }],
    ];
    const outcomes: [string, unknown][] = [];
    for (const [label, turns, profile] of bad) {
      try {
        outcomes.push([label, await openStep(id, turns, undefined, "step-1", profile)]);
      } catch (e) {
        outcomes.push([label, e]);
      }
    }
    // First the money: whatever happened above, a call above the cap is still refused.
    expect((await call(token)).status).toBe(402);
    // Then each refusal: by the code, before the database, with nothing opened or written.
    for (const [label, o] of outcomes) expect([label, o instanceof StepBudgetInvalid]).toEqual([label, true]);
    expect(await listStepHolds(pool, id)).toEqual([]);
    expect(await kinds(id)).toEqual(["gateway.refused"]);
    const engine = standInEngine({ calls: [{}] });
    const r = await run(id, engine, { maxTurns: Number.NaN });
    expect([r.ok, r.turns, engine.seen.created]).toEqual([false, 0, 0]);
    expect(r.failureReason).toBe("The step's turn limit must be a whole number from 1 to 1000 (got NaN). The step was not started.");
    // The database's own checks (migration 008), each named.
    const insert = (cols: Record<string, unknown>) => {
      const row: Record<string, unknown> = { project_id: id, step_id: "raw", model: MODEL, max_tokens_ceiling: 400, prompt_tokens: 42, turns: 3, per_turn_usd: PER_TURN, budget_usd: S3, room_usd: S3, deadline_at: new Date(), ...cols };
      const keys = Object.keys(row);
      return pool.query(`insert into step_holds(${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
    };
    await expect(insert({ budget_usd: "NaN", room_usd: 0 })).rejects.toThrow(/step_holds_budget_is_a_number/);
    await expect(insert({ room_usd: "NaN" })).rejects.toThrow(/step_holds_room_is_a_number/);
    await expect(insert({ room_usd: -1 })).rejects.toThrow(/step_holds_room_is_a_number/);
    await expect(insert({ room_usd: 0.03 })).rejects.toThrow(/step_holds_room_is_a_number/);
    await expect(insert({ per_turn_usd: "NaN" })).rejects.toThrow(/step_holds_(per_turn|budget)_is_a_number/); // either check refuses it: the budget is turns x one turn
    await expect(insert({ turns: -100, budget_usd: -0.996, room_usd: -0.996 })).rejects.toThrow(/step_holds_/);
    await expect(insert({ budget_usd: 0.03, room_usd: 0.03 })).rejects.toThrow(/step_holds_budget_is_a_number/); // not turns x one turn
    await expect(insert({ state: "closed", closed_at: new Date(), closed_reason: "test" })).rejects.toThrow(/step_holds_closed_has_no_room/);
    await expect(insert({ turns: "NaN" })).rejects.toThrow(/integer/);
    expect(await listStepHolds(pool, id)).toEqual([]);
    expect((await call(token)).status).toBe(402);
  });

  it("1.3 T13: a step call outside the limits its budget was worked out from, or naming another step, is refused and not forwarded; a call within them goes through", async () => {
    const { id } = await newProject(1);
    const opened = await openStep(id);
    if (!opened.ok) throw new Error("step not opened");
    const before = forwarded;
    const cases: [string, Record<string, unknown>, Record<string, string>, number, string][] = [
      ["another model", { model: "claude-sonnet-5-5" }, {}, 400, 'this call asks for the model "claude-sonnet-5-5", and the step\'s budget was worked out for "claude-opus-5-5"'],
      ["more output than the step's ceiling", { max_tokens: 401 }, {}, 400, "this call asks for up to 401 output tokens, and the step's budget allows 400 per call"],
      ["a prompt larger than the step's limit", { system: "count:500" }, {}, 400, "this call's hold ($0.013800) is more than one turn's share of the step's budget ($0.009960)"],
      ["another step's name", {}, { "x-builder-step": "another-step" }, 400, "The step named in the x-builder-step header is not the step this token was issued for."],
    ];
    for (const [label, more, headers, status, text] of cases) {
      const res = await call(opened.token, more, headers);
      const body = (await res.json()) as { error?: { message?: string } };
      expect([label, res.status, (body.error?.message ?? "").includes(text)]).toEqual([label, status, true]);
    }
    expect(forwarded).toBe(before);
    expect((await payloads(id, "gateway.refused")).map((p) => [p["reason"], (p["step_hold"] as { which?: string } | undefined)?.which ?? null])).toEqual([
      ["step_call_outside_limits", "model"],
      ["step_call_outside_limits", "max_tokens"],
      ["step_call_outside_limits", "hold"],
      ["step_label_differs", null],
    ]);
    expect((await listStepHolds(pool, id))[0]!.room_usd).toBe("0.029880");
    // Within the limits, with the step's own name or none: let through, drawn from the room.
    expect((await call(opened.token, {}, { "x-builder-step": "step-1" })).status).toBe(200);
    expect(forwarded).toBe(before + 1);
  });

  it("1.3: no step token was written to the event log, and no fault was raised", async () => {
    const r = await pool.query<{ n: number }>("select count(*)::int as n from events where project_id = any($1::text[]) and payload::text like '%bpt\\_%'", [projects]);
    expect(r.rows[0]!.n).toBe(0);
    expect(faults).toEqual([]);
  });
});
