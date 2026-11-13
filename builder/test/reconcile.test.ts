/**
 * Package 1.5: the unreconciled list and the owner's recorded reconciliation (build plan 7.3; design note 7.2,
 * proof row B14; the owner's answer to question 5 (a)).
 *
 * Against a stand-in provider written here as a plain Node server and the gateway in this process: no real
 * provider is called, the key is made up, nothing is spent, and every figure, name and usage record is made up.
 * The stand-in bills each call it answers or drops (the usage below on Claude Opus 5.5, worked out by hand); the
 * invariant checker of package 1.4 (test/invariants.ts) replays each project's events against those bills.
 *
 * A test-only trigger (created here, never a migration, dropped at the end; its names differ from the one in
 * failures.test.ts) makes the database refuse a chosen write, so a project is frozen as in proof row B10.
 */
import { serve, type ServerType } from "@hono/node-server";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGateway } from "../src/gateway/app.js";
import { DEFAULT_PROFILES } from "../src/gateway/hold.js";
import { FaultGate, FaultJournal } from "../src/gateway/journal.js";
import { listEvents } from "../src/store/events.js";
import { activeFreeze, listFreezes, recordFreeze, type UnrecordedEnding } from "../src/store/freezes.js";
import { expireHolds, getBudget, keepHold, listHolds, listStepHolds, openHold, openStepHold, OWNER_GONE, recoverHolds, settleHold } from "../src/store/holds.js";
import { holdLivenessLock, type Liveness } from "../src/store/liveness.js";
import { createProject, issueProjectToken } from "../src/store/projects.js";
import { KNOWN_KEPT_REASONS, listUnreconciled, reconcileHold, ReconcileRefused } from "../src/store/reconcile.js";
import { checkProject, micro, type Bill } from "./invariants.js";
import { TEST_DB_URL, testPool, uniqueId } from "./helpers.js";

/** Made up for these tests; never a real key. */
const MADE_UP_KEY = "made-up-key-for-package-1-5-tests";
const BUILDER_DIR = fileURLToPath(new URL("..", import.meta.url));
const MODEL = "claude-opus-5-5";
/** What every billed call used, and its bill at Claude Opus 5.5's rates ($4 in, $5 five-minute cache writes, $0.20 cache reads, $20 out, per million): 6,141.6 millionths, rounded up. */
const USAGE = { input_tokens: 30, cache_creation_input_tokens: 4, cache_read_input_tokens: 8, output_tokens: 300 };
const BILL_MICRO = Math.ceil(30 * 4 + 4 * 5 + 8 * 0.2 + 300 * 20 - 1e-9);
const BILL_USD = BILL_MICRO / 1e6;
/** The hold of each call: (42 counted + 5% + 200) x $8 + 400 x $20, per million. */
const HOLD_USD = 0.00996;
/** A made-up usage record, standing in for the provider's own. */
const EVIDENCE = "Provider usage record (made up for this test): request req_test_0001, Claude Opus 5.5, 30 input, 4 cache-write, 8 cache-read and 300 output tokens, billed $0.006142";
const WHO = { askedBy: "the owner (made up for this test)", recordedBy: "the test", reason: "package 1.5 test: the provider's usage record gives the actual cost" };

let pool: pg.Pool;
let standServer: Server;
let standUrl: string;
const servers: ServerType[] = [];
const livenesses: Liveness[] = [];
const journalDirs: string[] = [];
const bills = new Map<string, Bill[]>();
let forwarded = 0;

/* ------------------------------------------------------------------ the stand-in provider */

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.setEncoding("utf8");
    req.on("data", (d: string) => (s += d));
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

/** A bill, pinned to the project's latest hold.opened (this call's hold, committed before the call was forwarded). */
async function bill(project: string): Promise<void> {
  const r = await pool.query<{ id: string }>("select coalesce(max(id), 0)::text as id from events where project_id = $1 and kind = 'hold.opened'", [project]);
  bills.set(project, [...(bills.get(project) ?? []), { pinnedAt: Number(r.rows[0]!.id), billMicro: BILL_MICRO }]);
}

async function standIn(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const text = await readBody(req);
  if (req.url === "/v1/messages/count_tokens") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ input_tokens: 42 }));
    return;
  }
  if (req.url !== "/v1/messages") {
    res.writeHead(404).end();
    return;
  }
  forwarded++;
  const body = JSON.parse(text) as { model: string; metadata?: { test?: string; project?: string } };
  const mode = body.metadata?.test ?? "ok";
  const project = body.metadata?.project;
  const json = (status: number, o: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(o));
  const message = (withUsage: boolean) => ({ id: "msg_test", type: "message", model: body.model, content: [{ type: "text", text: "hello" }], ...(withUsage ? { usage: USAGE } : {}) });
  switch (mode) {
    case "ok":
      if (project) await bill(project);
      return void json(200, message(true));
    case "no-usage":
      if (project) await bill(project);
      return void json(200, message(false));
    case "error":
      // Not billed: the stand-in says the server error did no work.
      return void json(500, { type: "error", error: { type: "api_error", message: "a made-up server error" } });
    case "drop":
      // The whole request was read, and billed; the connection is closed with no answer.
      if (project) await bill(project);
      req.socket.destroy();
      return;
    default:
      res.writeHead(400).end();
  }
}

/* ------------------------------------------------------------------ helpers */

function listen(app: { fetch: (r: Request) => Response | Promise<Response> }): Promise<{ server: ServerType; url: string }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => resolve({ server, url: `http://127.0.0.1:${info.port}` }));
    servers.push(server);
  });
}

async function newProject(capUsd: number) {
  const id = uniqueId("p15");
  await createProject(pool, { id, name: "reconciliation test (made-up data)", capUsd });
  return { id, token: await issueProjectToken(pool, id) };
}

const body = (project: string, mode = "ok") => ({ model: MODEL, max_tokens: 400, messages: [], metadata: { test: mode, project } });
const callAt = (base: string, token: string, b: unknown) =>
  fetch(base + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": token, "anthropic-version": "2023-06-01" }, body: JSON.stringify(b) });
const errorOf = async (res: Response) => ((await res.json()) as { error: { type: string; message: string } }).error;
const kinds = async (id: string) => (await listEvents(pool, id)).map((e) => e.kind);
const later = () => new Date(Date.now() + 600_000);
const earlier = () => new Date(Date.now() - 1_000);

/** A gateway in this process, holding its liveness lock (so a starting gateway judges it running), with its own gate and journal. */
async function inProcessGateway(name: string) {
  const gatewayId = uniqueId(name);
  const liveness = await holdLivenessLock(TEST_DB_URL, gatewayId);
  livenesses.push(liveness);
  const dir = await mkdtemp(join(tmpdir(), "pkg15-journal-"));
  journalDirs.push(dir);
  const faults: string[] = [];
  const journal = await FaultJournal.open(dir);
  const gate = new FaultGate({ pool, journal, onFault: (m) => faults.push(m) });
  const app = createGateway({ pool, modelApiKey: MADE_UP_KEY, upstreamUrl: standUrl, profiles: DEFAULT_PROFILES, gatewayId, gate, liveness, onFault: (m) => faults.push(m) });
  const { url } = await listen(app);
  return { url, gatewayId, gate, faults };
}

/** Open a hold through the store, as the gateway does before it forwards a call. */
async function hold(projectId: string, o: { deadline?: Date; gateway?: string; amountUsd?: number; stepHoldId?: string; step?: string } = {}) {
  const r = await openHold(pool, {
    projectId,
    step: o.step ?? null,
    amountUsd: o.amountUsd ?? HOLD_USD,
    deadline: o.deadline ?? later(),
    gateway: o.gateway ?? "gw_p15_store",
    arithmetic: { model: MODEL },
    path: "/v1/messages",
    ...(o.stepHoldId ? { stepHoldId: o.stepHoldId, model: MODEL, maxTokens: 400 } : {}),
  });
  if (!r.ok) throw new Error(`hold not opened: ${r.reason}`);
  return r.hold.id;
}

/** A journal line for a hold, as the gateway writes one (made-up call fields). */
function unrecordedFor(projectId: string, holdId: string): UnrecordedEnding {
  return {
    journal_id: uniqueId("j_p15"),
    gateway: "gw_p15_store",
    project_id: projectId,
    hold_id: holdId,
    step: null,
    ended_at: new Date().toISOString(),
    ending: "settle",
    kept_reason: null,
    cost_usd_as_read: BILL_USD,
    call: { model: MODEL, status: 200, usage: USAGE },
    error: { name: "error", code: "P0001" },
  };
}

/** The invariant checker on one project: its violations, as text. */
async function violations(id: string): Promise<string[]> {
  const r = await checkProject(pool, id, bills.get(id) ?? [], []);
  return r.violations.map((v) => `${v.rule}, ${v.at}`);
}

/** Everything a refusal must leave as it was. */
async function snapshot(id: string) {
  return { events: (await listEvents(pool, id)).length, holds: await listHolds(pool, id), freezes: await listFreezes(pool, id), budget: await getBudget(pool, id) };
}

async function refusedWith(code: string, p: Parameters<typeof reconcileHold>[1]): Promise<void> {
  const err = await reconcileHold(pool, p).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `expected the refusal ${code}`).toBeInstanceOf(ReconcileRefused);
  expect((err as ReconcileRefused).code).toBe(code);
  expect((err as ReconcileRefused).message).toContain("Nothing was changed and nothing was written.");
}

/** The test-only fault: the database refuses an insert into the event log when a rule matches. */
const fault = {
  on: (project: string, kind: string) => pool.query("insert into test_write_faults_p15(project_id, kind) values ($1, $2)", [project, kind]),
  off: () => pool.query("delete from test_write_faults_p15"),
};

/** scripts/reconcile.ts as its own process, against the test database. */
function runScript(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["tsx", "scripts/reconcile.ts", ...args], { cwd: BUILDER_DIR, env: { ...process.env, BUILDER_DATABASE_URL: TEST_DB_URL } });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (err += d.toString()));
    proc.on("close", (code) => resolve({ code, out, err }));
  });
}

beforeAll(async () => {
  pool = await testPool();
  await pool.query(`
    create table if not exists test_write_faults_p15 (project_id text not null, kind text not null);
    delete from test_write_faults_p15;
    create or replace function test_write_fault_p15() returns trigger language plpgsql as $$
    begin
      if exists (select 1 from test_write_faults_p15 f where f.project_id = new.project_id and f.kind = new.kind) then
        raise exception 'test fault: this write is refused';
      end if;
      return new;
    end $$;
    drop trigger if exists test_write_fault_p15_events on events;
    create trigger test_write_fault_p15_events before insert on events for each row execute function test_write_fault_p15();
  `);
  standServer = createServer((req, res) => {
    standIn(req, res).catch(() => res.destroy());
  });
  await new Promise<void>((r) => standServer.listen(0, "127.0.0.1", () => r()));
  standUrl = `http://127.0.0.1:${(standServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const l of livenesses) await l.stop();
  for (const s of servers) s.close();
  standServer.closeAllConnections();
  standServer.close();
  await pool.query(`
    drop trigger if exists test_write_fault_p15_events on events;
    drop function if exists test_write_fault_p15();
    drop table if exists test_write_faults_p15;
  `);
  await pool.end();
  for (const d of journalDirs) await rm(d, { recursive: true, force: true });
});

describe("package 1.5: the unreconciled list and the owner's reconciliation, proof row B14 (against a stand-in provider)", () => {
  it("B14 (1): the list shows one hold of each kind with what is known of it (an error answer, an interrupted call and an unreadable answer made through the gateway; an expired hold; a hold whose gateway was found gone; a late answer written down; the call whose ending could not be recorded, which froze its project); a call in flight and a settled call are not on it", async () => {
    const g = await inProcessGateway("gw_p15_list");
    const a = await newProject(1);
    const b = await newProject(1);
    // Through the gateway: an error answer, an interrupted call, an unreadable answer, and one settled call.
    expect((await callAt(g.url, a.token, body(a.id, "error"))).status).toBe(500);
    expect((await callAt(g.url, a.token, body(a.id, "drop"))).status).toBe(502);
    expect((await callAt(g.url, a.token, body(a.id, "no-usage"))).status).toBe(200);
    expect((await callAt(g.url, a.token, body(a.id, "ok"))).status).toBe(200);
    const [errorHold, dropHold, unreadHold, settledHold] = (await listHolds(pool, a.id)).map((h) => h.id);
    // Through the store: a call in flight on the running gateway, an expired hold, a hold whose gateway is gone, a late answer.
    const inFlight = await hold(a.id, { gateway: g.gatewayId });
    const expiredHold = await hold(a.id, { deadline: earlier(), gateway: g.gatewayId });
    const lateHold = await hold(a.id, { deadline: earlier(), gateway: g.gatewayId });
    await expireHolds(pool);
    const goneHold = await hold(a.id, { gateway: uniqueId("gw_p15_gone") });
    await recoverHolds(pool, uniqueId("gw_p15_starting"));
    const late = await settleHold(pool, { projectId: a.id, holdId: lateHold, step: null, actualUsd: 0.004, call: { model: MODEL, status: 200, usage: USAGE } });
    expect(late.settled).toBe(false);
    // Project b: its call's model.call write is refused after the provider answered, so it is frozen (B10).
    await fault.on(b.id, "model.call");
    expect((await callAt(g.url, b.token, body(b.id, "ok"))).status).toBe(200);
    await fault.off();
    expect(await activeFreeze(pool, b.id)).not.toBeNull();

    const listA = await listUnreconciled(pool, { projectId: a.id });
    const byId = new Map(listA.holds.map((h) => [h.holdId, h]));
    expect([...byId.keys()].sort()).toEqual([errorHold, dropHold, unreadHold, expiredHold, goneHold, lateHold].map(String).sort());
    expect(byId.has(String(inFlight))).toBe(false);
    expect(byId.has(String(settledHold))).toBe(false);
    expect(byId.get(String(errorHold))).toMatchObject({ kinds: ["error answer"], keptReason: "the provider answered with a server error", seen: { status: 500 }, model: MODEL, unreconciled: true });
    expect(byId.get(String(dropHold))).toMatchObject({ kinds: ["interrupted"], keptReason: "the connection failed after the request was sent, or may have been sent; the provider may have billed it" });
    expect(byId.get(String(unreadHold))).toMatchObject({ kinds: ["unreadable answer"], keptReason: "the answer succeeded but its usage could not be read", seen: { status: 200 } });
    expect(byId.get(String(expiredHold))).toMatchObject({ kinds: ["expired"], keptReason: null, expired: true, pastDeadline: true });
    expect(byId.get(String(goneHold))).toMatchObject({ kinds: ["gateway gone"], keptReason: OWNER_GONE, foundAtStartup: true });
    expect(byId.get(String(lateHold))).toMatchObject({ kinds: ["expired", "late answer written down"], lateAnswers: [{ costUsdAsRead: 0.004, reason: "answer arrived after the hold expired" }] });
    for (const h of listA.holds) expect(micro(h.amountUsd)).toBe(micro(HOLD_USD));
    // Every listed hold is counted at its full amount: the list plus the call in flight is the budget's open holds.
    const budgetA = await getBudget(pool, a.id);
    expect(micro(budgetA.openHolds)).toBe(micro(HOLD_USD) * (listA.holds.length + 1));
    expect(micro(budgetA.spent)).toBe(BILL_MICRO);

    const listB = await listUnreconciled(pool, { projectId: b.id });
    expect(listB.holds).toHaveLength(1);
    expect(listB.holds[0]).toMatchObject({ kinds: ["froze its project"], freezes: [{ cleared: false, costUsdAsRead: BILL_USD }] });
    expect(listB.freezesWithNoOpenHold).toEqual([]);
    expect(await violations(a.id)).toEqual([]);
    expect(await violations(b.id)).toEqual([]);
  }, 60_000);

  it("B14 (2): one reconciliation recorded with its evidence: the hold is closed at the stated actual cost, which is then what is charged, its freeze is cleared in the same step, and the frozen project of B10 runs again", async () => {
    const g = await inProcessGateway("gw_p15_b14");
    const p = await newProject(HOLD_USD * 3); // room for the next call: a refusal must come from the freeze
    await fault.on(p.id, "model.call");
    expect((await callAt(g.url, p.token, body(p.id, "ok"))).status).toBe(200);
    await fault.off();
    const refused = await callAt(g.url, p.token, body(p.id, "ok"));
    expect(refused.status).toBe(402);
    expect((await errorOf(refused)).type).toBe("project_frozen");
    const h = (await listHolds(pool, p.id))[0]!;
    const freeze = (await listFreezes(pool, p.id))[0]!;
    const before = await getBudget(pool, p.id);
    expect({ spent: micro(before.spent), open: micro(before.openHolds) }).toEqual({ spent: 0, open: micro(HOLD_USD) });

    const r = await reconcileHold(pool, { projectId: p.id, holdId: h.id, actualUsd: BILL_USD, evidence: EVIDENCE, ...WHO });
    expect(r).toMatchObject({ holdId: h.id, heldUsd: HOLD_USD, actualUsd: BILL_USD, aboveHold: false, kinds: ["froze its project"], freezesCleared: [freeze.id], projectStillFrozen: false, evidence: EVIDENCE });
    expect(micro(r.returnedUsd)).toBe(micro(HOLD_USD) - BILL_MICRO);
    // One step: the cost, the reconciliation with its evidence, the freeze cleared.
    expect((await kinds(p.id)).slice(-3)).toEqual(["model.call", "hold.reconciled", "project.freeze_cleared"]);
    const rec = (await listEvents(pool, p.id, "hold.reconciled"))[0]!.payload;
    expect(rec).toMatchObject({ hold_id: Number(h.id), amount_usd: HOLD_USD, actual_usd: BILL_USD, evidence: EVIDENCE, asked_by: WHO.askedBy, recorded_by: WHO.recordedBy, reason: WHO.reason, freezes_cleared: [Number(freeze.id)], project_still_frozen: false });
    expect((await listEvents(pool, p.id, "model.call")).map((e) => e.payload)).toEqual([expect.objectContaining({ hold_id: Number(h.id), cost_usd: BILL_USD, reconciled: true })]);
    expect((await listHolds(pool, p.id))[0]).toMatchObject({ state: "settled", actual_usd: BILL_USD.toFixed(6) });
    expect(await activeFreeze(pool, p.id)).toBeNull();
    expect((await listFreezes(pool, p.id))[0]!.cleared_at).not.toBeNull();
    const after = await getBudget(pool, p.id);
    expect({ spent: micro(after.spent), open: micro(after.openHolds) }).toEqual({ spent: BILL_MICRO, open: 0 });
    expect((await listUnreconciled(pool, { projectId: p.id })).holds).toEqual([]);

    // The frozen project runs again: its next call is forwarded and settled, and charged beside the reconciled cost.
    const sent = forwarded;
    expect((await callAt(g.url, p.token, body(p.id, "ok"))).status).toBe(200);
    expect(forwarded).toBe(sent + 1);
    const end = await getBudget(pool, p.id);
    expect({ spent: micro(end.spent), open: micro(end.openHolds) }).toEqual({ spent: 2 * BILL_MICRO, open: 0 });
    expect(await violations(p.id)).toEqual([]);
  }, 60_000);

  it("B14 (3): the budget equation after a reconciliation: below the hold, the difference goes back to the budget; above it, the actual cost is charged in full, hold.exceeded says so, and a call that no longer fits is refused", async () => {
    const p = await newProject(0.03);
    const first = await hold(p.id);
    await keepHold(pool, { projectId: p.id, holdId: first, step: null, reason: "the provider answered with a server error", seen: { status: 500 } });
    const r1 = await reconcileHold(pool, { projectId: p.id, holdId: first, actualUsd: 0.002, evidence: EVIDENCE, ...WHO });
    expect({ before: micro(r1.budgetBefore.spent + r1.budgetBefore.openHolds), after: micro(r1.budgetAfter.spent), open: micro(r1.budgetAfter.openHolds) }).toEqual({ before: micro(HOLD_USD), after: 2_000, open: 0 });
    expect(micro(r1.returnedUsd)).toBe(micro(HOLD_USD) - 2_000);

    const second = await hold(p.id);
    await keepHold(pool, { projectId: p.id, holdId: second, step: null, reason: "the provider's stream failed part-way", seen: { status: 200 } });
    const r2 = await reconcileHold(pool, { projectId: p.id, holdId: second, actualUsd: 0.025, evidence: EVIDENCE, ...WHO });
    expect(r2).toMatchObject({ aboveHold: true, kinds: ["interrupted"] });
    expect(micro(r2.returnedUsd)).toBe(micro(HOLD_USD) - 25_000);
    expect(micro((await getBudget(pool, p.id)).spent)).toBe(27_000);
    expect((await listEvents(pool, p.id, "hold.exceeded")).map((e) => e.payload)).toEqual([{ hold_id: Number(second), amount_usd: HOLD_USD, actual_usd: 0.025, reconciled: true }]);
    // $0.027 spent + this call's hold of $0.00996 is above the cap of $0.03.
    const next = await openHold(pool, { projectId: p.id, step: null, amountUsd: HOLD_USD, deadline: later(), gateway: "gw_p15_store", arithmetic: {}, path: "/v1/messages" });
    expect(next).toMatchObject({ ok: false, reason: "budget_reached" });
    // The checker sees exactly the bill above its hold, as it does for a settled one (known gaps 41 and 97).
    expect(await violations(p.id)).toEqual([`a settled call above its hold, event ${(await listEvents(pool, p.id, "hold.reconciled"))[1]!.id}`, `hold.exceeded written, event ${(await listEvents(pool, p.id, "hold.exceeded"))[0]!.id}`]);
  });

  it("B14 (4): a reconciliation that cannot be recorded is refused with its own reason, and changes and writes nothing", async () => {
    const p = await newProject(1);
    const other = await newProject(1);
    const kept = await hold(p.id);
    await recordFreeze(pool, unrecordedFor(p.id, kept));
    const inFlight = await hold(other.id);
    const otherKept = await hold(other.id);
    await keepHold(pool, { projectId: other.id, holdId: otherKept, step: null, reason: "the provider answered with a server error", seen: {} });
    const ok = { projectId: p.id, holdId: kept, actualUsd: BILL_USD, evidence: EVIDENCE, ...WHO };
    const before = await snapshot(p.id);
    const beforeOther = await snapshot(other.id);

    for (const holdId of ["abc", "0", "", "1.5", "12345678901234567890"]) await refusedWith("hold_id_not_valid", { ...ok, holdId });
    for (const actualUsd of [Number.NaN, Number.POSITIVE_INFINITY, "0.1" as unknown as number]) await refusedWith("actual_not_a_number", { ...ok, actualUsd });
    await refusedWith("actual_below_zero", { ...ok, actualUsd: -0.000001 });
    await refusedWith("actual_too_large", { ...ok, actualUsd: 1e8 });
    await refusedWith("actual_more_than_6_decimals", { ...ok, actualUsd: 0.0000001 });
    for (const evidence of ["", "   ", undefined as unknown as string]) await refusedWith("evidence_missing", { ...ok, evidence });
    await refusedWith("evidence_too_long", { ...ok, evidence: "x".repeat(2001) });
    await refusedWith("evidence_not_storable", { ...ok, evidence: "a\u0000b" });
    await refusedWith("evidence_not_storable", { ...ok, evidence: "half a pair \ud800 here" });
    await refusedWith("asked_by_missing", { ...ok, askedBy: "" });
    await refusedWith("recorded_by_missing", { ...ok, recordedBy: " " });
    await refusedWith("reason_missing", { ...ok, reason: "" });
    await refusedWith("reason_too_long", { ...ok, reason: "y".repeat(501) });
    await refusedWith("unknown_project", { ...ok, projectId: uniqueId("p15_none") });
    await refusedWith("unknown_hold", { ...ok, holdId: "999999999999" });
    await refusedWith("unknown_hold", { ...ok, holdId: otherKept }); // another project's hold
    await refusedWith("hold_not_kept", { ...ok, projectId: other.id, holdId: inFlight }); // a call that has not ended
    expect(await snapshot(p.id)).toEqual(before);
    expect(await snapshot(other.id)).toEqual(beforeOther);

    // A cost already recorded for the hold (an event written by hand): reconciling would count it twice.
    await pool.query("insert into events(project_id, kind, payload) values ($1, 'model.call', $2)", [other.id, JSON.stringify({ hold_id: Number(otherKept), cost_usd: 0.001 })]);
    const handWritten = await snapshot(other.id);
    await refusedWith("cost_already_recorded", { ...ok, projectId: other.id, holdId: otherKept });
    expect(await snapshot(other.id)).toEqual(handWritten);

    // Accepted once; the second time the hold is already closed, and nothing more is written.
    await reconcileHold(pool, ok);
    const once = await snapshot(p.id);
    await refusedWith("hold_already_closed", ok);
    expect(await snapshot(p.id)).toEqual(once);
  });

  it("B14 (5): two reconciliations of the same hold at once are judged one after the other under the project's lock: one is recorded, the other refused, and the cost is charged once", async () => {
    const p = await newProject(1);
    const kept = await hold(p.id);
    await keepHold(pool, { projectId: p.id, holdId: kept, step: null, reason: "the client disconnected part-way", seen: {} });
    const both = await Promise.allSettled([0.001, 0.002].map((actualUsd) => reconcileHold(pool, { projectId: p.id, holdId: kept, actualUsd, evidence: EVIDENCE, ...WHO })));
    const done = both.filter((x) => x.status === "fulfilled");
    const no = both.filter((x): x is PromiseRejectedResult => x.status === "rejected");
    expect(done).toHaveLength(1);
    expect(no.map((x) => (x.reason as ReconcileRefused).code)).toEqual(["hold_already_closed"]);
    expect(await listEvents(pool, p.id, "model.call")).toHaveLength(1);
    expect(await listEvents(pool, p.id, "hold.reconciled")).toHaveLength(1);
    const actual = (done[0] as PromiseFulfilledResult<{ actualUsd: number }>).value.actualUsd;
    expect(micro((await getBudget(pool, p.id)).spent)).toBe(micro(actual));
    expect(await violations(p.id)).toEqual([]);
  });

  it("B14 (6): a project frozen by two calls stays frozen until both are reconciled; a hold past its deadline not yet marked is reconciled after being marked; a kept call of a running step gives back to the step what it did not cost; a freeze whose hold is not open is listed apart", async () => {
    const p = await newProject(1);
    const one = await hold(p.id);
    const two = await hold(p.id);
    await recordFreeze(pool, unrecordedFor(p.id, one));
    await recordFreeze(pool, unrecordedFor(p.id, two));
    const r1 = await reconcileHold(pool, { projectId: p.id, holdId: one, actualUsd: BILL_USD, evidence: EVIDENCE, ...WHO });
    expect(r1).toMatchObject({ projectStillFrozen: true });
    expect(r1.freezesCleared).toHaveLength(1);
    expect(await activeFreeze(pool, p.id)).not.toBeNull();
    expect((await listEvents(pool, p.id, "project.freeze_cleared"))[0]!.payload).toMatchObject({ hold_id: Number(one), project_still_frozen: true });
    const r2 = await reconcileHold(pool, { projectId: p.id, holdId: two, actualUsd: BILL_USD, evidence: EVIDENCE, ...WHO });
    expect(r2).toMatchObject({ projectStillFrozen: false });
    expect(await activeFreeze(pool, p.id)).toBeNull();

    // Past its deadline, not yet marked by the sweep: listed as expired, and marked when reconciled.
    const q = await newProject(1);
    const due = await hold(q.id, { deadline: earlier() });
    const listed = (await listUnreconciled(pool, { projectId: q.id })).holds;
    expect(listed).toEqual([expect.objectContaining({ holdId: String(due), kinds: ["expired"], expired: false, pastDeadline: true })]);
    const r3 = await reconcileHold(pool, { projectId: q.id, holdId: due, actualUsd: 0, evidence: EVIDENCE, ...WHO });
    expect(r3.kinds).toEqual(["expired"]);
    expect((await kinds(q.id)).slice(-3)).toEqual(["hold.expired", "model.call", "hold.reconciled"]);

    // A kept call drawn from a running step: what it did not cost goes back to the step's room.
    const s = await newProject(1);
    const step = await openStepHold(pool, { projectId: s.id, stepId: "step-p15", model: MODEL, maxTurns: 2, profile: { maxTokensCeiling: 400, allowFastMode: false, stepPromptTokens: 42 }, deadline: later() });
    if (!step.ok) throw new Error("step not started");
    const drawn = await hold(s.id, { stepHoldId: step.stepHold.id, step: "step-p15" });
    await keepHold(pool, { projectId: s.id, holdId: drawn, step: "step-p15", reason: "the call reached its time limit", seen: {} });
    const roomBefore = Number((await listStepHolds(pool, s.id))[0]!.room_usd);
    const r4 = await reconcileHold(pool, { projectId: s.id, holdId: drawn, actualUsd: 0.001, evidence: EVIDENCE, ...WHO });
    expect(r4.kinds).toEqual(["interrupted"]);
    expect(micro(Number((await listStepHolds(pool, s.id))[0]!.room_usd))).toBe(micro(roomBefore) + micro(HOLD_USD) - 1_000);
    expect(await violations(s.id)).toEqual([]);

    // A freeze whose hold a failed write had in fact settled: reconciling cannot clear it; the list shows it apart.
    const f = await newProject(1);
    const settled = await hold(f.id);
    await pool.query("update holds set state = 'settled', closed_at = now(), actual_usd = 0 where id = $1", [settled]);
    await recordFreeze(pool, unrecordedFor(f.id, settled));
    const lf = await listUnreconciled(pool, { projectId: f.id });
    expect(lf.holds).toEqual([]);
    expect(lf.freezesWithNoOpenHold).toEqual([expect.objectContaining({ projectId: f.id, holdId: String(settled), holdState: "settled" })]);
    await refusedWith("hold_already_closed", { projectId: f.id, holdId: settled, actualUsd: 0, evidence: EVIDENCE, ...WHO });
  });

  it("B14 (7): the script lists and records: --list prints the list; a reconciliation is recorded (exit 0) and printed; a refusal exits 2 and a misuse 1; neither the database's address nor a key is printed", async () => {
    const p = await newProject(1);
    const kept = await hold(p.id);
    await recordFreeze(pool, unrecordedFor(p.id, kept));
    const list = await runScript(["--list", "--project", p.id]);
    expect(list.code).toBe(0);
    expect(list.out).toContain(`Project ${p.id}: 1 kept hold(s), $0.009960 held; FROZEN`);
    expect(list.out).toContain(`hold ${kept}: $0.009960 held, counted in full until reconciled`);
    expect(list.out).toContain("kind:        froze its project");
    const done = await runScript(["--hold", kept, "--actual", BILL_USD.toFixed(6), "--evidence", EVIDENCE, "--asked-by", WHO.askedBy, "--by", WHO.recordedBy, "--reason", WHO.reason]);
    expect(done.code).toBe(0);
    expect(done.out).toContain(`Hold ${kept} of project ${p.id} reconciled`);
    expect(done.out).toContain("the project is not frozen");
    expect((await listEvents(pool, p.id, "hold.reconciled"))[0]!.payload).toMatchObject({ evidence: EVIDENCE, actual_usd: BILL_USD });
    const again = await runScript(["--hold", kept, "--actual", "0.006142", "--evidence", EVIDENCE, "--asked-by", WHO.askedBy, "--by", WHO.recordedBy, "--reason", WHO.reason]);
    expect(again.code).toBe(2);
    expect(again.err).toContain("Refused by the store (hold_already_closed)");
    const misuse = await runScript(["--hold", kept, "--actual", "0.0061421", "--evidence", EVIDENCE, "--asked-by", "x", "--by", "y", "--reason", "z"]);
    expect(misuse.code).toBe(1);
    expect(misuse.err).toContain("Nothing was sent to the database");
    for (const r of [list, done, again, misuse]) {
      const all = r.out + r.err;
      expect(all).not.toContain("/var/run/postgresql");
      expect(all).not.toContain("postgres://");
      expect(all).not.toContain(MADE_UP_KEY);
      expect(all).not.toMatch(/bpt_/); // no project token
    }
  }, 60_000);

  it("1.5: each reason the kinds table names is still written by the gateway or the store", async () => {
    const src = (await Promise.all(["src/gateway/app.ts", "src/store/holds.ts", "src/store/freezes.ts"].map((f) => readFile(join(BUILDER_DIR, f), "utf8")))).join("\n");
    const all = Object.values(KNOWN_KEPT_REASONS).flat();
    expect(all.length).toBeGreaterThan(15);
    for (const reason of all) expect(src, reason).toContain(reason);
  });
});
