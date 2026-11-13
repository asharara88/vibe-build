/**
 * Package 1.4c: a bill above its hold freezes the project until the owner records it (the owner's answer to
 * question 17 on 13 Nov 2026, "(a) Yes, freeze (Recommended)"; docs/DECISIONS.md).
 *
 * Against a stand-in provider written here as a plain Node server and the gateway in this process: no real
 * provider is called, the key is made up, nothing is spent, and every figure, name and usage record is made up.
 * The stand-in answers each call with the same usage on Claude Opus 5.5 (30 input, 4 cache-write, 8 cache-read and
 * 300 output tokens). In mode "ok" it bills $0.006142; in mode "fast" it says fast mode served the call, which the
 * request did not ask for and the profile does not allow, so the bill doubles to $0.012284 (worked out by hand
 * below), above the call's hold of $0.009960. The invariant checker of package 1.4 (test/invariants.ts) replays
 * each project's events against those bills.
 *
 * A test-only trigger (created here, never a migration, dropped at the end; its names are this file's own) makes
 * the database refuse the insert of a freeze of the kind 'bill_above_hold' for a chosen project, so the settle's
 * transaction fails as a whole.
 */
import { serve, type ServerType } from "@hono/node-server";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGateway } from "../src/gateway/app.js";
import { DEFAULT_PROFILES, type ProfileLimits } from "../src/gateway/hold.js";
import { FaultGate, FaultJournal } from "../src/gateway/journal.js";
import { listEvents } from "../src/store/events.js";
import { activeFreeze, frozenMessage, listFreezes, recordFreeze, type UnrecordedEnding } from "../src/store/freezes.js";
import { expireHolds, getBudget, listHolds, openHold, openStepHold, settleHold } from "../src/store/holds.js";
import { holdLivenessLock, type Liveness } from "../src/store/liveness.js";
import { createProject, issueProjectToken } from "../src/store/projects.js";
import { listUnreconciled, reconcileHold, ReconcileRefused, recordOverrun } from "../src/store/reconcile.js";
import { checkProject, checkTrace, micro, type Bill, type TraceEvent } from "./invariants.js";
import { TEST_DB_URL, testPool, uniqueId } from "./helpers.js";

/** Made up for these tests; never a real key. */
const MADE_UP_KEY = "made-up-key-for-package-1-4c-tests";
const BUILDER_DIR = fileURLToPath(new URL("..", import.meta.url));
const MODEL = "claude-opus-5-5";
const USAGE = { input_tokens: 30, cache_creation_input_tokens: 4, cache_read_input_tokens: 8, output_tokens: 300 };
/** At Claude Opus 5.5's rates ($4 in, $5 five-minute cache writes, $0.20 cache reads, $20 out, per million): 6,141.6 millionths, rounded up. */
const BILL_MICRO = 6142;
/** The same usage in fast mode, at twice those rates: 12,283.2 millionths, rounded up. */
const FAST_BILL_MICRO = 12284;
const FAST_BILL_USD = FAST_BILL_MICRO / 1e6;
/** The hold of each call: (42 counted + 5% + 200) x $8 + 400 x $20, per million. */
const HOLD_MICRO = 9960;
const HOLD_USD = HOLD_MICRO / 1e6;
/** $0.012284 - $0.009960. */
const ABOVE_MICRO = FAST_BILL_MICRO - HOLD_MICRO;
/** A step of up to 3 calls of that size (the profile of test/step-hold.test.ts). */
const STEP_PROFILE: ProfileLimits = { maxTokensCeiling: 400, allowFastMode: false, stepPromptTokens: 42 };
/** A made-up usage record, standing in for the provider's own. */
const EVIDENCE = "Provider usage record (made up for this test): request req_test_14c_0001, Claude Opus 5.5, fast mode, 30 input, 4 cache-write, 8 cache-read and 300 output tokens, billed $0.012284";
const WHO = { askedBy: "the owner (made up for this test)", recordedBy: "the test", reason: "package 1.4c test: the bill above its hold was looked at and is recorded" };

let pool: pg.Pool;
let standServer: Server;
let standUrl: string;
const servers: ServerType[] = [];
const livenesses: Liveness[] = [];
const journalDirs: string[] = [];
const bills = new Map<string, Bill[]>();
/** Metered calls and counting calls that reached the stand-in. A refused call must move neither. */
let forwarded = 0;
let counted = 0;

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
async function bill(project: string, billMicro: number): Promise<void> {
  const r = await pool.query<{ id: string }>("select coalesce(max(id), 0)::text as id from events where project_id = $1 and kind = 'hold.opened'", [project]);
  bills.set(project, [...(bills.get(project) ?? []), { pinnedAt: Number(r.rows[0]!.id), billMicro }]);
}

const frame = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

async function standIn(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const text = await readBody(req);
  if (req.url === "/v1/messages/count_tokens") {
    counted++;
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ input_tokens: 42 }));
    return;
  }
  if (req.url !== "/v1/messages") {
    res.writeHead(404).end();
    return;
  }
  forwarded++;
  const body = JSON.parse(text) as { model: string; stream?: boolean; metadata?: { test?: string; project?: string } };
  const fast = body.metadata?.test === "fast";
  const project = body.metadata?.project;
  if (project) await bill(project, fast ? FAST_BILL_MICRO : BILL_MICRO);
  const usage = fast ? { ...USAGE, speed: "fast" } : USAGE;
  if (body.stream) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(frame("message_start", { type: "message_start", message: { model: body.model, usage: { ...usage, output_tokens: 1 } } }));
    res.write(frame("content_block_delta", { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } }));
    res.write(frame("message_delta", { type: "message_delta", usage: { output_tokens: USAGE.output_tokens } }));
    res.end(frame("message_stop", { type: "message_stop" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "msg_test", type: "message", model: body.model, content: [{ type: "text", text: "hello" }], usage }));
}

/* ------------------------------------------------------------------ helpers */

function listen(app: { fetch: (r: Request) => Response | Promise<Response> }): Promise<{ server: ServerType; url: string }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => resolve({ server, url: `http://127.0.0.1:${info.port}` }));
    servers.push(server);
  });
}

async function newProject(capUsd: number) {
  const id = uniqueId("p14c");
  await createProject(pool, { id, name: "overrun freeze test (made-up data)", capUsd });
  return { id, token: await issueProjectToken(pool, id) };
}

const body = (project: string, mode = "ok", more: Record<string, unknown> = {}) => ({ model: MODEL, max_tokens: 400, messages: [], metadata: { test: mode, project }, ...more });
const callAt = (base: string, token: string, b: unknown, path = "/v1/messages") =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-api-key": token, "anthropic-version": "2023-06-01" }, body: JSON.stringify(b) });
const errorOf = async (res: Response) => ((await res.json()) as { error: { type: string; message: string } }).error;
const later = () => new Date(Date.now() + 600_000);
const earlier = () => new Date(Date.now() - 1_000);

/** A gateway in this process, holding its liveness lock, with its own gate and journal; its faults are kept with their details. */
async function inProcessGateway(name: string) {
  const gatewayId = uniqueId(name);
  const liveness = await holdLivenessLock(TEST_DB_URL, gatewayId);
  livenesses.push(liveness);
  const dir = await mkdtemp(join(tmpdir(), "pkg14c-journal-"));
  journalDirs.push(dir);
  const faults: Array<{ message: string; detail: Record<string, unknown> }> = [];
  const onFault = (message: string, detail: unknown) => faults.push({ message, detail: (detail ?? {}) as Record<string, unknown> });
  const journal = await FaultJournal.open(dir);
  const gate = new FaultGate({ pool, journal, onFault });
  const app = createGateway({ pool, modelApiKey: MADE_UP_KEY, upstreamUrl: standUrl, profiles: DEFAULT_PROFILES, gatewayId, gate, liveness, onFault });
  const { url } = await listen(app);
  return { url, gatewayId, gate, faults };
}

/** Open a hold through the store, as the gateway does before it forwards a call. */
async function hold(projectId: string, o: { deadline?: Date } = {}) {
  const r = await openHold(pool, { projectId, step: null, amountUsd: HOLD_USD, deadline: o.deadline ?? later(), gateway: "gw_p14c_store", arithmetic: { model: MODEL }, path: "/v1/messages" });
  if (!r.ok) throw new Error(`hold not opened: ${r.reason}`);
  return r.hold.id;
}

/** Wait until a condition holds (a stream is recorded once the client has read it to the end). */
async function until(what: string, f: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await f()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

/** The invariant checker on one project: the rules it flagged, each once, in the order first flagged. */
async function rulesOf(id: string): Promise<string[]> {
  const r = await checkProject(pool, id, bills.get(id) ?? [], []);
  return [...new Set(r.violations.map((v) => v.rule))];
}
/**
 * What the checker flags for a project with one bill above its hold, as designed: the bill is above the hold, so
 * from its hold.opened to its settlement the replay is below what was owed (rule 2, as in package 1.4), and the
 * settlement above its hold and its hold.exceeded are flagged. Rules 1, 3 and 4 and the replay hold.
 */
const ONE_BILL_ABOVE_ITS_HOLD = ["2: below what was owed", "a settled call above its hold", "hold.exceeded written"];

/** Everything a refusal must leave as it was. */
async function snapshot(id: string) {
  return { events: (await listEvents(pool, id)).length, holds: await listHolds(pool, id), freezes: await listFreezes(pool, id), budget: await getBudget(pool, id) };
}

async function overrunRefused(code: string, p: Parameters<typeof recordOverrun>[1]): Promise<ReconcileRefused> {
  const err = await recordOverrun(pool, p).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `expected the refusal ${code}`).toBeInstanceOf(ReconcileRefused);
  expect((err as ReconcileRefused).code).toBe(code);
  expect((err as ReconcileRefused).message).toContain("Nothing was changed and nothing was written.");
  return err as ReconcileRefused;
}

/** The transaction that wrote each of these rows (its `xmin`): rows written by one transaction share it. */
async function txOf(table: "events" | "project_freezes", ids: string[]): Promise<string[]> {
  return (await pool.query<{ tx: string }>(`select xmin::text as tx from ${table} where id = any($1::bigint[]) order by id`, [ids])).rows.map((r) => r.tx);
}

/** The test-only fault: the database refuses the insert of a 'bill_above_hold' freeze for a chosen project. */
const freezeFault = {
  on: (project: string) => pool.query("insert into test_freeze_faults_p14c(project_id) values ($1)", [project]),
  off: () => pool.query("delete from test_freeze_faults_p14c"),
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

/** A journal line for a hold, as the gateway writes one when a call's ending cannot be recorded (package 1.4; made-up fields). */
function unrecordedFor(projectId: string, holdId: string): UnrecordedEnding {
  return {
    journal_id: uniqueId("j_p14c"),
    gateway: "gw_p14c_store",
    project_id: projectId,
    hold_id: holdId,
    step: null,
    ended_at: new Date().toISOString(),
    ending: "settle",
    kept_reason: null,
    cost_usd_as_read: BILL_MICRO / 1e6,
    call: { model: MODEL, status: 200, usage: USAGE },
    error: { name: "error", code: "P0001" },
  };
}

beforeAll(async () => {
  pool = await testPool();
  await pool.query(`
    create table if not exists test_freeze_faults_p14c (project_id text not null);
    delete from test_freeze_faults_p14c;
    create or replace function test_freeze_fault_p14c() returns trigger language plpgsql as $$
    begin
      if new.kind = 'bill_above_hold' and exists (select 1 from test_freeze_faults_p14c f where f.project_id = new.project_id) then
        raise exception 'test fault: this freeze is refused';
      end if;
      return new;
    end $$;
    drop trigger if exists test_freeze_fault_p14c_insert on project_freezes;
    create trigger test_freeze_fault_p14c_insert before insert on project_freezes for each row execute function test_freeze_fault_p14c();
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
    drop trigger if exists test_freeze_fault_p14c_insert on project_freezes;
    drop function if exists test_freeze_fault_p14c();
    drop table if exists test_freeze_faults_p14c;
  `);
  await pool.end();
  for (const d of journalDirs) await rm(d, { recursive: true, force: true });
});

describe("package 1.4c: a bill above its hold freezes the project until the owner records it (against a stand-in provider)", () => {
  /** One call billed above its hold through the gateway, streamed or not, and what it must leave behind. */
  async function billAboveHold(stream: boolean) {
    const g = await inProcessGateway(stream ? "gw_p14c_stream" : "gw_p14c_plain");
    const p = await newProject(1);
    const q = await newProject(1);
    const res = await callAt(g.url, p.token, body(p.id, "fast", stream ? { stream: true } : {}));
    expect(res.status).toBe(200);
    const text = await res.text(); // read to the end: a stream is settled once its last event has been read
    if (stream) expect(text).toContain("message_stop");
    await until("the project's freeze", async () => (await listEvents(pool, p.id, "project.frozen")).length === 1);

    // The first bill is charged in full: the hold is settled at the bill, which is what is spent.
    const [h] = await listHolds(pool, p.id);
    expect(h).toMatchObject({ state: "settled" });
    expect(micro(Number(h!.amount_usd))).toBe(HOLD_MICRO);
    expect(micro(Number(h!.actual_usd))).toBe(FAST_BILL_MICRO);
    const budget = await getBudget(pool, p.id);
    expect(micro(budget.spent)).toBe(FAST_BILL_MICRO);
    expect(micro(budget.openHolds)).toBe(0);
    // The breach is recorded as before, and the project is frozen naming that hold, with the bill, the hold and the difference.
    const exceeded = await listEvents(pool, p.id, "hold.exceeded");
    expect(exceeded.map((e) => e.payload)).toEqual([{ hold_id: Number(h!.id), amount_usd: HOLD_USD, actual_usd: FAST_BILL_USD }]);
    const freezes = await listFreezes(pool, p.id);
    expect(freezes).toHaveLength(1);
    const f = freezes[0]!;
    expect(f).toMatchObject({ kind: "bill_above_hold", hold_id: String(h!.id), journal_id: null, reason: "a model call was billed more than its hold", gateway: g.gatewayId, cleared_at: null });
    expect(micro(Number(f.hold_amount_usd))).toBe(HOLD_MICRO);
    expect(micro(Number(f.bill_usd))).toBe(FAST_BILL_MICRO);
    expect(f.record).toMatchObject({ model: MODEL, stream, cost_usd: FAST_BILL_USD, usage: { speed: "fast" } });
    const frozenEv = (await listEvents(pool, p.id, "project.frozen"))[0]!;
    expect(frozenEv.payload).toMatchObject({ freeze_id: Number(f.id), kind: "bill_above_hold", hold_id: Number(h!.id), hold_amount_usd: HOLD_USD, bill_usd: FAST_BILL_USD, above_by_usd: ABOVE_MICRO / 1e6, reason: "a model call was billed more than its hold" });
    // One transaction: the call's cost, the settlement, the breach, the freeze's event and the freeze's row share
    // the id of the transaction that wrote them (each row's xmin).
    const evIds = ["model.call", "hold.settled", "hold.exceeded", "project.frozen"];
    const written = (await listEvents(pool, p.id)).filter((e) => evIds.includes(e.kind));
    expect(written.map((e) => e.kind)).toEqual(evIds);
    const txs = [...(await txOf("events", written.map((e) => e.id))), ...(await txOf("project_freezes", [f.id]))];
    expect(new Set(txs).size).toBe(1);
    // The fault the gateway raises says the project is frozen, and which freeze.
    expect(g.faults.map((x) => x.message)).toEqual(["A settled call cost more than its hold."]);
    expect(g.faults[0]!.detail).toMatchObject({ project: p.id, project_frozen: true, freeze_id: Number(f.id) });

    // The project's next calls are refused as a frozen project is, with nothing forwarded: no counting call, no
    // call, no passed-through request, and no hold. The message names what froze it.
    const sent = { forwarded, counted, holds: (await listHolds(pool, p.id)).length };
    for (const [b, path] of [[body(p.id, "ok"), "/v1/messages"], [body(p.id, "ok", { stream: true }), "/v1/messages"], [{ model: MODEL, messages: [] }, "/v1/messages/count_tokens"]] as const) {
      const r = await callAt(g.url, p.token, b, path);
      expect(r.status).toBe(402);
      const e = await errorOf(r);
      expect(e.type).toBe("project_frozen");
      expect(e.message).toBe(frozenMessage(f));
      expect(e.message).toContain(`was billed $0.012284, more than its hold of $0.009960 (above it by $0.002324). That bill is charged in full. The gateway forwarded nothing, and no further call will be made for this project until the owner records that bill.`);
    }
    expect({ forwarded, counted, holds: (await listHolds(pool, p.id)).length }).toEqual(sent);
    const refused = (await listEvents(pool, p.id, "gateway.refused")).map((e) => e.payload);
    expect(refused).toHaveLength(3);
    for (const r of refused) expect(r).toMatchObject({ reason: "project_frozen", freeze_id: Number(f.id), freeze_kind: "bill_above_hold", journal_id: null });
    // No step starts either.
    const step = await openStepHold(pool, { projectId: p.id, stepId: "step-1", model: MODEL, maxTurns: 1, profile: STEP_PROFILE, deadline: later() });
    expect(step).toMatchObject({ ok: false, reason: "project_frozen" });
    expect(step.ok === false && step.message).toContain("The step was not started, and no further call will be made for this project until the owner records that bill.");

    // Another project is not affected: its call is forwarded and settled.
    const before = forwarded;
    const other = await callAt(g.url, q.token, body(q.id, "ok", stream ? { stream: true } : {}));
    expect(other.status).toBe(200);
    await other.text();
    await until("the other project's settlement", async () => (await listEvents(pool, q.id, "hold.settled")).length === 1);
    expect(forwarded).toBe(before + 1);
    expect(await activeFreeze(pool, q.id)).toBeNull();
    expect(micro((await getBudget(pool, q.id)).spent)).toBe(BILL_MICRO);

    // The invariant checker: the bill above its hold is flagged as designed; the freeze is in the settle's
    // transaction (rule 3) and nothing opened while the project was frozen (rule 4); the replay equals the view.
    expect(await rulesOf(p.id)).toEqual(ONE_BILL_ABOVE_ITS_HOLD);
    expect(await rulesOf(q.id)).toEqual([]);
    return { g, p, q, hold: h!, freeze: f };
  }

  it("1.4c (a1) not streamed: a bill above its hold is charged in full and, in the same transaction as its hold.exceeded, freezes the project naming that hold; the project's next calls are refused with nothing forwarded; another project's call is forwarded", async () => {
    await billAboveHold(false);
  });

  it("1.4c (a2) streamed: the same, for a stream settled when its last event is read", async () => {
    await billAboveHold(true);
  });

  it("1.4c (a3) one transaction: with the freeze's write refused, nothing of the settle is written (no cost, no hold.exceeded, no freeze of this kind); the ending goes to package 1.4's journal path and the project is still frozen; the owner's reconciliation above the hold does not freeze", async () => {
    const g = await inProcessGateway("gw_p14c_atomic");
    const p = await newProject(1);
    await freezeFault.on(p.id);
    let res: Response;
    try {
      res = await callAt(g.url, p.token, body(p.id, "fast"));
    } finally {
      await freezeFault.off();
    }
    expect(res.status).toBe(200); // the caller has its answer: the provider did the work
    await res.text();
    // Neither: the settle's transaction was rolled back as a whole.
    const kinds = (await listEvents(pool, p.id)).map((e) => e.kind);
    expect(kinds).not.toContain("model.call");
    expect(kinds).not.toContain("hold.settled");
    expect(kinds).not.toContain("hold.exceeded");
    const [h] = await listHolds(pool, p.id);
    expect(h).toMatchObject({ state: "open", unreconciled: true, actual_usd: null });
    expect(micro((await getBudget(pool, p.id)).spent)).toBe(0);
    expect(micro((await getBudget(pool, p.id)).openHolds)).toBe(HOLD_MICRO);
    // Package 1.4's path: the ending is unrecorded, kept in the journal, and recorded as a freeze of that kind.
    expect(g.faults.map((x) => x.message)).toEqual(["A finished model call could not be written to the event log. Its hold stays open at its full amount."]);
    expect(g.gate.closed()).toBe(false); // the journal line was recorded and the gate reopened
    const freezes = await listFreezes(pool, p.id);
    expect(freezes.map((f) => [f.kind, f.hold_id, f.cleared_at])).toEqual([["unrecorded_ending", String(h!.id), null]]);
    expect(freezes[0]!.journal_id).not.toBeNull();
    expect(freezes[0]!.record).toMatchObject({ ending: "settle", cost_usd_as_read: FAST_BILL_USD });
    expect(kinds).toEqual(["hold.opened", "hold.kept", "gateway.fault", "project.frozen"]);
    // Still frozen: the next call is refused with nothing forwarded.
    const sent = forwarded;
    const next = await callAt(g.url, p.token, body(p.id, "ok"));
    expect(next.status).toBe(402);
    expect((await errorOf(next)).type).toBe("project_frozen");
    expect(forwarded).toBe(sent);
    // The owner reconciles that hold at the bill, above the hold (package 1.5): charged in full, the freeze cleared,
    // and, by Claude Code's decision (docs/DECISIONS.md, 13 Nov 2026), no new freeze: it is his own recorded action.
    const r = await reconcileHold(pool, { projectId: p.id, holdId: String(h!.id), actualUsd: FAST_BILL_USD, evidence: EVIDENCE, ...WHO });
    expect(r).toMatchObject({ aboveHold: true, projectStillFrozen: false, freezesCleared: [freezes[0]!.id] });
    expect((await listEvents(pool, p.id, "hold.exceeded")).map((e) => e.payload)).toEqual([{ hold_id: Number(h!.id), amount_usd: HOLD_USD, actual_usd: FAST_BILL_USD, reconciled: true }]);
    expect((await listFreezes(pool, p.id)).map((f) => f.kind)).toEqual(["unrecorded_ending"]);
    expect(await activeFreeze(pool, p.id)).toBeNull();
    const again = await callAt(g.url, p.token, body(p.id, "ok"));
    expect(again.status).toBe(200);
    expect(forwarded).toBe(sent + 1);
    expect(micro((await getBudget(pool, p.id)).spent)).toBe(FAST_BILL_MICRO + BILL_MICRO);
    // The checker: a reconciliation's hold.exceeded needs no freeze (rule 3 looks only at a settlement's).
    expect(await rulesOf(p.id)).toEqual(ONE_BILL_ABOVE_ITS_HOLD);
  });

  it("1.4c (b) a step-held call above its hold: charged in full, the step's room takes the difference, the project is frozen naming that hold; the step's next call and a new step are refused; once the bill is recorded, the step's next call is forwarded and settled", async () => {
    const g = await inProcessGateway("gw_p14c_step");
    const p = await newProject(1);
    const s = await openStepHold(pool, { projectId: p.id, stepId: "step-1", model: MODEL, maxTurns: 3, profile: STEP_PROFILE, deadline: later() });
    if (!s.ok) throw new Error("the step did not start");
    expect(micro(Number(s.stepHold.room_usd))).toBe(3 * HOLD_MICRO);
    const res = await callAt(g.url, s.token, body(p.id, "fast"));
    expect(res.status).toBe(200);
    await res.text();
    const [h] = await listHolds(pool, p.id);
    expect(h).toMatchObject({ state: "settled", step: "step-1", step_hold_id: String(s.stepHold.id) });
    expect(micro(Number(h!.actual_usd))).toBe(FAST_BILL_MICRO);
    // The step's room: 3 x $0.009960 less this call's hold, then its hold less its bill given back (here below 0, so taken from the room).
    const settled = (await listEvents(pool, p.id, "hold.settled"))[0]!.payload;
    expect(settled["step_hold"]).toMatchObject({ step_open: true, room_before_usd: (2 * HOLD_MICRO) / 1e6, room_after_usd: (3 * HOLD_MICRO - FAST_BILL_MICRO) / 1e6, overrun_not_covered_usd: 0 });
    const [f] = await listFreezes(pool, p.id);
    expect(f).toMatchObject({ kind: "bill_above_hold", hold_id: String(h!.id) });
    const frozenEv = (await listEvents(pool, p.id, "project.frozen"))[0]!;
    expect(frozenEv).toMatchObject({ step: "step-1", payload: { kind: "bill_above_hold", hold_id: Number(h!.id) } });
    const ids = (await listEvents(pool, p.id)).filter((e) => ["hold.settled", "hold.exceeded", "project.frozen"].includes(e.kind)).map((e) => e.id);
    expect(new Set([...(await txOf("events", ids)), ...(await txOf("project_freezes", [f!.id]))]).size).toBe(1);
    // The step's next call: refused, nothing forwarded, the step's room untouched. A new step: refused.
    const sent = { forwarded, counted };
    const next = await callAt(g.url, s.token, body(p.id, "ok"));
    expect(next.status).toBe(402);
    expect((await errorOf(next)).type).toBe("project_frozen");
    expect({ forwarded, counted }).toEqual(sent);
    expect(micro((await getBudget(pool, p.id)).stepRoom)).toBe(3 * HOLD_MICRO - FAST_BILL_MICRO);
    const step2 = await openStepHold(pool, { projectId: p.id, stepId: "step-2", model: MODEL, maxTurns: 1, profile: STEP_PROFILE, deadline: later() });
    expect(step2).toMatchObject({ ok: false, reason: "project_frozen" });
    // The owner records the bill; the step's next call goes ahead and draws from the room left.
    const rec = await recordOverrun(pool, { projectId: p.id, holdId: String(h!.id), evidence: EVIDENCE, ...WHO });
    expect(rec).toMatchObject({ step: "step-1", projectStillFrozen: false });
    const again = await callAt(g.url, s.token, body(p.id, "ok"));
    expect(again.status).toBe(200);
    expect(forwarded).toBe(sent.forwarded + 1);
    expect((await listHolds(pool, p.id)).map((x) => [x.state, x.step_hold_id])).toEqual([
      ["settled", String(s.stepHold.id)],
      ["settled", String(s.stepHold.id)],
    ]);
    expect(await rulesOf(p.id)).toEqual(ONE_BILL_ABOVE_ITS_HOLD);
  });

  it("1.4c (c1) the owner's record of the bill clears that freeze, and only that one, with who, why, the evidence, the bill and the hold; it moves no money; the project's next call is forwarded and settled", async () => {
    const { g, p, hold: h, freeze: f } = await billAboveHold(false);
    const before = await getBudget(pool, p.id);
    const r = await recordOverrun(pool, { projectId: p.id, holdId: String(h.id), evidence: `  ${EVIDENCE}  `, ...WHO });
    expect(r).toMatchObject({
      projectId: p.id,
      holdId: String(h.id),
      freezeId: f.id,
      heldUsd: HOLD_USD,
      billUsd: FAST_BILL_USD,
      aboveByUsd: ABOVE_MICRO / 1e6,
      evidence: EVIDENCE,
      askedBy: WHO.askedBy,
      recordedBy: WHO.recordedBy,
      reason: WHO.reason,
      model: MODEL,
      gateway: g.gatewayId,
      projectStillFrozen: false,
    });
    expect(r.budget).toEqual(before);
    expect(await getBudget(pool, p.id)).toEqual(before); // nothing charged, nothing given back
    const recorded = await listEvents(pool, p.id, "hold.overrun_recorded");
    expect(recorded.map((e) => e.id)).toEqual([r.eventId]);
    expect(recorded[0]!.payload).toMatchObject({
      hold_id: Number(h.id),
      freeze_id: Number(f.id),
      amount_usd: HOLD_USD,
      bill_usd: FAST_BILL_USD,
      above_by_usd: ABOVE_MICRO / 1e6,
      evidence: EVIDENCE,
      asked_by: WHO.askedBy,
      recorded_by: WHO.recordedBy,
      reason: WHO.reason,
      project_still_frozen: false,
    });
    const cleared = await listEvents(pool, p.id, "project.freeze_cleared");
    expect(cleared.map((e) => [e.id, e.payload])).toEqual([[r.clearedEventId, expect.objectContaining({ freeze_id: Number(f.id), kind: "bill_above_hold", hold_id: Number(h.id), by: "the owner's record of a bill above its hold", hold_overrun_recorded_event_id: Number(r.eventId) })]]);
    expect(new Set(await txOf("events", [r.eventId, r.clearedEventId])).size).toBe(1);
    expect((await listFreezes(pool, p.id))[0]!.cleared_at).not.toBeNull();
    expect(await activeFreeze(pool, p.id)).toBeNull();
    expect((await listUnreconciled(pool, { projectId: p.id })).overrunFreezes).toEqual([]);
    // The hold is closed: package 1.5's reconciliation refuses it, which is why this record exists.
    await expect(reconcileHold(pool, { projectId: p.id, holdId: String(h.id), actualUsd: FAST_BILL_USD, evidence: EVIDENCE, ...WHO })).rejects.toMatchObject({ code: "hold_already_closed" });
    // The next call is forwarded and settled.
    const sent = forwarded;
    const next = await callAt(g.url, p.token, body(p.id, "ok"));
    expect(next.status).toBe(200);
    expect(forwarded).toBe(sent + 1);
    expect((await listEvents(pool, p.id, "hold.settled")).length).toBe(2);
    expect(micro((await getBudget(pool, p.id)).spent)).toBe(FAST_BILL_MICRO + BILL_MICRO);
    expect(await rulesOf(p.id)).toEqual(ONE_BILL_ABOVE_ITS_HOLD);
  });

  it("1.4c (c2) the record is refused, changing and writing nothing: a freeze of another kind, a hold with no freeze, one already recorded, missing or unstorable texts, a bad id, an unknown project, another project's hold", async () => {
    const { p, q, hold: h } = await billAboveHold(false);
    // Project u: frozen by an ending that could not be recorded (package 1.4), and a settled hold with no freeze.
    const u = await newProject(1);
    const plain = await hold(u.id);
    await settleHold(pool, { projectId: u.id, holdId: plain, step: null, actualUsd: BILL_MICRO / 1e6, call: { model: MODEL, status: 200, usage: USAGE } });
    const kept = await hold(u.id);
    expect((await recordFreeze(pool, unrecordedFor(u.id, kept))).written).toBe(true);
    const ok = { projectId: p.id, holdId: String(h.id), evidence: EVIDENCE, ...WHO };
    const all = async () => ({ p: await snapshot(p.id), q: await snapshot(q.id), u: await snapshot(u.id) });
    const start = await all();

    const wrongKind = await overrunRefused("no_overrun_freeze", { ...ok, projectId: u.id, holdId: String(kept) });
    expect(wrongKind.message).toContain("it froze its project for another reason (its call's ending could not be recorded), which a reconciliation of the hold with its actual cost clears");
    const none = await overrunRefused("no_overrun_freeze", { ...ok, projectId: u.id, holdId: String(plain) });
    expect(none.message).toBe(`Hold ${plain} has no freeze after a bill above its hold. Nothing was changed and nothing was written.`);
    await overrunRefused("unknown_hold", { ...ok, projectId: q.id }); // another project's hold
    await overrunRefused("unknown_hold", { ...ok, holdId: "999999999999" });
    await overrunRefused("unknown_project", { ...ok, projectId: uniqueId("p14c_none") });
    for (const bad of ["0", "-1", "1.5", "abc", "", "1".repeat(19)]) await overrunRefused("hold_id_not_valid", { ...ok, holdId: bad });
    await overrunRefused("evidence_missing", { ...ok, evidence: "   " });
    await overrunRefused("evidence_missing", { ...ok, evidence: undefined as unknown as string });
    await overrunRefused("evidence_too_long", { ...ok, evidence: "x".repeat(2001) });
    await overrunRefused("evidence_not_storable", { ...ok, evidence: "made up\u0000" });
    await overrunRefused("asked_by_missing", { ...ok, askedBy: "" });
    await overrunRefused("recorded_by_missing", { ...ok, recordedBy: " " });
    await overrunRefused("reason_missing", { ...ok, reason: "" });
    await overrunRefused("reason_too_long", { ...ok, reason: "x".repeat(501) });
    expect(await all()).toEqual(start);
    expect(await activeFreeze(pool, p.id)).not.toBeNull();

    // Recorded once; a second record is refused.
    await recordOverrun(pool, ok);
    const afterOne = await all();
    const twice = await overrunRefused("overrun_already_recorded", ok);
    expect(twice.message).toContain(`The freeze after hold ${h.id}'s bill above its hold was already cleared, at `);
    expect(await all()).toEqual(afterOne);
    // Project u is still frozen by its own freeze, which this record did not touch.
    expect((await activeFreeze(pool, u.id))?.kind).toBe("unrecorded_ending");
  });

  it("1.4c (c3) two calls billed above their holds: two freezes; each record clears only its own, and the project runs again only after both", async () => {
    const p = await newProject(1);
    const first = await hold(p.id);
    const second = await hold(p.id); // in flight when the first bill froze the project
    const call = { model: MODEL, status: 200, usage: { ...USAGE, speed: "fast" } };
    const r1 = await settleHold(pool, { projectId: p.id, holdId: first, step: null, actualUsd: FAST_BILL_USD, call });
    expect(r1).toMatchObject({ settled: true, exceeded: true, freeze: expect.objectContaining({ kind: "bill_above_hold" }) });
    const r2 = await settleHold(pool, { projectId: p.id, holdId: second, step: null, actualUsd: FAST_BILL_USD, call });
    expect(r2).toMatchObject({ settled: true, exceeded: true, freeze: expect.objectContaining({ kind: "bill_above_hold" }) });
    expect((await listFreezes(pool, p.id)).map((f) => [f.kind, f.hold_id])).toEqual([
      ["bill_above_hold", String(first)],
      ["bill_above_hold", String(second)],
    ]);
    const list = await listUnreconciled(pool, { projectId: p.id });
    expect(list.overrunFreezes.map((o) => [o.holdId, o.heldUsd, o.billUsd, o.aboveByUsd])).toEqual([
      [String(first), HOLD_USD, FAST_BILL_USD, ABOVE_MICRO / 1e6],
      [String(second), HOLD_USD, FAST_BILL_USD, ABOVE_MICRO / 1e6],
    ]);
    expect(list.freezesWithNoOpenHold).toEqual([]);
    expect(list.holds).toEqual([]);
    const a = await recordOverrun(pool, { projectId: p.id, holdId: String(second), evidence: EVIDENCE, ...WHO });
    expect(a.projectStillFrozen).toBe(true);
    expect((await activeFreeze(pool, p.id))?.hold_id).toBe(String(first));
    expect(await openStepHold(pool, { projectId: p.id, stepId: "step-1", model: MODEL, maxTurns: 1, profile: STEP_PROFILE, deadline: later() })).toMatchObject({ ok: false, reason: "project_frozen" });
    const b = await recordOverrun(pool, { projectId: p.id, holdId: String(first), evidence: EVIDENCE, ...WHO });
    expect(b.projectStillFrozen).toBe(false);
    expect(await activeFreeze(pool, p.id)).toBeNull();
    expect(micro((await getBudget(pool, p.id)).spent)).toBe(2 * FAST_BILL_MICRO);
    // The checker (no stand-in bills here): the two breaches are flagged as designed; rules 3 and 4 hold.
    expect(await rulesOf(p.id)).toEqual(["a settled call above its hold", "hold.exceeded written"]);
  });

  it("1.4c (c4) the script: --list shows each project frozen after a bill above its hold with the bill, the hold and the difference; --overrun records it (exit 0) and is refused a second time (exit 2); misuse is refused before the database (exit 1); no address is printed", async () => {
    const { p, hold: h } = await billAboveHold(false);
    const list = await runScript(["--list", "--project", p.id]);
    expect(list.code).toBe(0);
    expect(list.out).toContain("Projects frozen after a bill above its hold (package 1.4c; cleared by --overrun): 1");
    expect(list.out).toContain(`project ${p.id}: hold ${h.id} held $0.009960; the call was billed $0.012284, above its hold by $0.002324, charged in full`);
    expect(list.out).toContain(`model ${MODEL}; step: (none)`);
    const args = ["--overrun", "--hold", String(h.id), "--evidence", EVIDENCE, "--asked-by", WHO.askedBy, "--by", WHO.recordedBy, "--reason", WHO.reason];
    for (const [bad, why] of [
      [[...args, "--actual", "0.012284"], "--overrun takes no --actual"],
      [args.filter((_, i) => i !== 3 && i !== 4), "--evidence is missing or empty"],
      [["--list", "--overrun"], "--list and --overrun are both given"],
      [["--overrun", "--hold", "x", ...args.slice(3)], "--hold must be a hold's id"],
    ] as const) {
      const r = await runScript([...bad]);
      expect(r.code, why).toBe(1);
      expect(r.err).toContain(why);
      expect(r.err).toContain("Nothing was sent to the database.");
    }
    expect(await activeFreeze(pool, p.id)).not.toBeNull();
    const rec = await runScript(args);
    expect(rec.code).toBe(0);
    expect(rec.out).toContain(`Bill above its hold recorded for hold ${h.id} of project ${p.id}`);
    expect(rec.out).toContain("billed:        $0.012284, charged in full when the call was settled (nothing is charged now)");
    expect(rec.out).toContain("above it by:   $0.002324");
    expect(rec.out).toContain("the project is not frozen");
    expect(await activeFreeze(pool, p.id)).toBeNull();
    const again = await runScript(args);
    expect(again.code).toBe(2);
    expect(again.err).toContain("Refused by the store (overrun_already_recorded)");
    for (const r of [list, rec, again]) {
      expect(`${r.out}${r.err}`).not.toMatch(/postgres(ql)?:\/\/|host=|\/var\/run\/postgresql/);
      expect(`${r.out}${r.err}`).not.toContain(MADE_UP_KEY);
    }
  });

  it("1.4c (late) an answer that arrives after its hold expired, with a cost above the hold, freezes the project (kind 'late_answer_above_hold') in the same transaction as its hold.kept; one below its hold does not; the owner's reconciliation of that hold clears it, and the record of a bill refuses it", async () => {
    const p = await newProject(1);
    const below = await hold(p.id, { deadline: earlier() });
    const above = await hold(p.id, { deadline: earlier() });
    await expireHolds(pool);
    const call = { model: MODEL, status: 200, usage: { ...USAGE, speed: "fast" } };
    const r1 = await settleHold(pool, { projectId: p.id, holdId: below, step: null, actualUsd: 0.004, call });
    expect(r1).toEqual({ settled: false, exceeded: false, amountUsd: HOLD_USD, freeze: null });
    expect(await activeFreeze(pool, p.id)).toBeNull();
    const r2 = await settleHold(pool, { projectId: p.id, holdId: above, step: null, actualUsd: FAST_BILL_USD, call });
    expect(r2).toMatchObject({ settled: false, exceeded: false, amountUsd: HOLD_USD, freeze: expect.objectContaining({ kind: "late_answer_above_hold", hold_id: String(above) }) });
    const f = (await activeFreeze(pool, p.id))!;
    expect(f).toMatchObject({ kind: "late_answer_above_hold", hold_id: String(above), reason: "an answer that arrived after its hold was kept or expired says the call cost more than its hold" });
    expect(micro(Number(f.bill_usd))).toBe(FAST_BILL_MICRO);
    expect(f.record).toMatchObject({ cost_usd_as_read: FAST_BILL_USD });
    const evs = await listEvents(pool, p.id);
    const keptAbove = evs.filter((e) => e.kind === "hold.kept" && e.payload["hold_id"] === Number(above));
    const frozenEv = evs.filter((e) => e.kind === "project.frozen");
    expect(frozenEv.map((e) => e.payload)).toEqual([expect.objectContaining({ kind: "late_answer_above_hold", hold_id: Number(above), bill_usd: FAST_BILL_USD, hold_amount_usd: HOLD_USD })]);
    expect(new Set([...(await txOf("events", [keptAbove[0]!.id, frozenEv[0]!.id])), ...(await txOf("project_freezes", [f.id]))]).size).toBe(1);
    // Both holds stay open at their full amount: nothing was settled.
    expect((await listHolds(pool, p.id)).map((h) => h.state)).toEqual(["open", "open"]);
    expect(micro((await getBudget(pool, p.id)).openHolds)).toBe(2 * HOLD_MICRO);
    expect(frozenMessage(f)).toContain("after its call's hold had been kept or had expired, says the call cost $0.012284, more than its hold of $0.009960 (above it by $0.002324). The hold stays counted at its full amount.");
    // The list shows it with its hold; it is not one of the bills above a hold.
    const list = await listUnreconciled(pool, { projectId: p.id });
    expect(list.holds.find((h) => h.holdId === String(above))).toMatchObject({ kinds: ["late answer above its hold", "expired", "late answer written down"], freezes: [{ freezeId: f.id, kind: "late_answer_above_hold", journalId: null, cleared: false, costUsdAsRead: FAST_BILL_USD }] });
    expect(list.overrunFreezes).toEqual([]);
    expect(list.freezesWithNoOpenHold).toEqual([]);
    // The record of a bill refuses it; the reconciliation of its hold clears it.
    const refused = await overrunRefused("no_overrun_freeze", { projectId: p.id, holdId: String(above), evidence: EVIDENCE, ...WHO });
    expect(refused.message).toContain("another reason (a late answer above its hold)");
    const r = await reconcileHold(pool, { projectId: p.id, holdId: String(above), actualUsd: FAST_BILL_USD, evidence: EVIDENCE, ...WHO });
    expect(r).toMatchObject({ aboveHold: true, freezesCleared: [f.id], projectStillFrozen: false });
    expect(await activeFreeze(pool, p.id)).toBeNull();
    expect((await listFreezes(pool, p.id)).map((x) => x.kind)).toEqual(["late_answer_above_hold"]);
    expect(await rulesOf(p.id)).toEqual(["a settled call above its hold", "hold.exceeded written"]);
  });

  it("1.4c (d) the invariant checker: rule 3 (a settlement's hold.exceeded needs a 'bill_above_hold' freeze of that hold, written in the same transaction) and rule 4 (nothing opens while a freeze is not cleared), on made-up traces", () => {
    const ev = (id: number, kind: string, payload: Record<string, unknown>, tx?: string): TraceEvent => ({ id, kind, payload, ...(tx ? { tx } : {}) });
    const opened = (id: number, hold: number, usd: number) => ev(id, "hold.opened", { hold_id: hold, amount_usd: usd });
    const called = (id: number, hold: number, usd: number) => ev(id, "model.call", { hold_id: hold, cost_usd: usd });
    const settled = (id: number, hold: number, held: number, usd: number) => ev(id, "hold.settled", { hold_id: hold, amount_usd: held, actual_usd: usd });
    const frozen = (id: number, freeze: number, hold: number, kind: string, tx?: string) => ev(id, "project.frozen", { freeze_id: freeze, kind, hold_id: hold }, tx);
    const rules = (events: TraceEvent[]) => [...new Set(checkTrace(events, [], micro(1)).violations.map((v) => v.rule))];
    const breach = (tx: string) => [opened(1, 1, 0.01), called(2, 1, 0.02), settled(3, 1, 0.01, 0.02), ev(4, "hold.exceeded", { hold_id: 1 }, tx)];
    const flagged = ["a settled call above its hold", "hold.exceeded written"];
    const rule3 = "3: a bill above its hold with no freeze in its transaction";
    const rule4 = "4: a hold opened or a step started while its project was frozen";
    // Rule 3.
    expect(rules([...breach("t1"), frozen(5, 1, 1, "bill_above_hold", "t1")])).toEqual(flagged);
    expect(rules([...breach("t1"), frozen(5, 1, 1, "bill_above_hold", "t2")])).toEqual([...flagged, rule3]); // in another transaction
    expect(rules([...breach("t1"), frozen(5, 1, 2, "bill_above_hold", "t1")])).toEqual([...flagged, rule3]); // naming another hold
    expect(rules([...breach("t1"), frozen(5, 1, 1, "unrecorded_ending", "t1")])).toEqual([...flagged, rule3]); // of another kind
    expect(rules(breach("t1"))).toEqual([...flagged, rule3]); // none
    expect(rules([opened(1, 1, 0.01), called(2, 1, 0.02), ev(3, "hold.reconciled", { hold_id: 1, amount_usd: 0.01, actual_usd: 0.02 }), ev(4, "hold.exceeded", { hold_id: 1, reconciled: true })])).toEqual(flagged); // the owner's reconciliation does not freeze
    // A trace read without transaction ids is judged by the hold alone.
    expect(rules([opened(1, 1, 0.01), called(2, 1, 0.02), settled(3, 1, 0.01, 0.02), ev(4, "hold.exceeded", { hold_id: 1 }), frozen(5, 1, 1, "bill_above_hold")])).toEqual(flagged);
    // Rule 4.
    expect(rules([frozen(1, 7, 1, "bill_above_hold"), opened(2, 2, 0.01)])).toEqual([rule4]);
    expect(rules([frozen(1, 7, 1, "bill_above_hold"), ev(2, "step.hold_opened", { step_hold_id: 1, step_budget_usd: 0.01 })])).toEqual([rule4]);
    expect(rules([frozen(1, 7, 1, "bill_above_hold"), frozen(2, 8, 1, "late_answer_above_hold"), ev(3, "project.freeze_cleared", { freeze_id: 7 }), opened(4, 2, 0.01)])).toEqual([rule4]); // one of two cleared
    expect(rules([frozen(1, 7, 1, "bill_above_hold"), ev(2, "project.freeze_cleared", { freeze_id: 7 }), opened(3, 2, 0.01)])).toEqual([]);
  });
});
