/**
 * Package 1.4b: the third outside review, item 1 ("An unreadable fault record can let the gateway restart and
 * accept calls"; docs/reviews/2026-11-13-third-outside-review-supplied-by-the-owner.md). Its required fix:
 * "unreadable records must block forwarding until recovered; test a truncated journal followed by restart".
 *
 * Against a stand-in provider written here (it can park a call), the gateway's own start-up file
 * (src/gateway/main.ts) run as a process of its own and killed with SIGKILL, and the gateway in this process.
 * No real provider is called; the key is made up; nothing is spent. The data is made up.
 *
 * A test-only trigger (created here, never a migration, dropped at the end) makes the database refuse a chosen
 * project's writes, so that the real gateway writes a call's ending to its journal, as in proof row B10.
 */
import { serve, type ServerType } from "@hono/node-server";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGateway } from "../src/gateway/app.js";
import { DEFAULT_PROFILES } from "../src/gateway/hold.js";
import { FaultGate, FaultJournal, fingerprintOf } from "../src/gateway/journal.js";
import { LISTED_BYTES, listJournal, RecoveryRefused, setAsideLine } from "../src/gateway/journal-recovery.js";
import { createClient } from "../src/store/db.js";
import { listEvents } from "../src/store/events.js";
import { activeFreeze, listFreezes, SET_ASIDE_FREEZE_REASON, type UnrecordedEnding } from "../src/store/freezes.js";
import { listUnreconciled, ReconcileRefused, reconcileHold, recordOverrun } from "../src/store/reconcile.js";
import { keepHold, listHolds, openHold, OWNER_GONE, settleHold } from "../src/store/holds.js";
import { gatewayLockKeySql, holdLivenessLock, type Liveness } from "../src/store/liveness.js";
import { createProject, issueProjectToken } from "../src/store/projects.js";
import { checkProject, micro, type Bill, type Sample } from "./invariants.js";
import { TEST_DB_URL, testPool, uniqueId } from "./helpers.js";

/** Made up for these tests; never a real key. */
const MADE_UP_KEY = "made-up-key-for-package-1-4b-journal-tests";
const BUILDER_DIR = fileURLToPath(new URL("..", import.meta.url));
const MODEL = "claude-opus-5-5";
/** What every billed call used, and its bill worked out by hand at Claude Opus 5.5's rates ($4 in, $5 five-minute cache writes, $0.20 cache reads, $20 out, per million). */
const USAGE = { input_tokens: 30, cache_creation_input_tokens: 4, cache_read_input_tokens: 8, output_tokens: 300 };
const BILL_MICRO = Math.ceil(30 * 4 + 4 * 5 + 8 * 0.2 + 300 * 20 - 1e-9); // $0.006142
/** The hold of each call: (42 counted + 5% + 200) x $8 + 400 x $20, per million. */
const HOLD_USD = 0.00996;
const PENDING = "unrecorded-endings.jsonl";
const SET_ASIDE_FILE = "unrecorded-endings.set-aside.jsonl";
const WHO = { by: "the test (a made-up operator)", reason: "package 1.4b test: the line stands for the call on this hold, by the project and hold its readable part names" };

let pool: pg.Pool;
let standServer: Server;
let standUrl: string;
const children: ChildProcess[] = [];
const livenesses: Liveness[] = [];
const servers: ServerType[] = [];
const dirs: string[] = [];

/* ------------------------------------------------------------------ the stand-in provider */

const stand = { messages: 0, counts: 0, bills: new Map<string, Bill[]>(), samples: new Map<string, Sample[]>(), arrivedByTag: new Map<string, number>() };
const parks = new Map<string, { promise: Promise<void>; release: () => void }>();
function park(tag: string) {
  let p = parks.get(tag);
  if (!p) {
    let release!: () => void;
    const promise = new Promise<void>((r) => (release = r));
    p = { promise, release };
    parks.set(tag, p);
  }
  return p;
}
const release = (tag: string) => park(tag).release();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.setEncoding("utf8");
    req.on("data", (d: string) => (s += d));
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

/** The stand-in bills a call when it arrives, pinned to the project's latest hold.opened, with the budget view read then (as in test/failures.test.ts). */
async function bill(project: string): Promise<void> {
  const r = await pool.query<{ id: string }>("select coalesce(max(id), 0)::text as id from events where project_id = $1 and kind = 'hold.opened'", [project]);
  const bills = stand.bills.get(project) ?? [];
  bills.push({ pinnedAt: Number(r.rows[0]!.id), billMicro: BILL_MICRO });
  stand.bills.set(project, bills);
  const v = (await pool.query<{ cap_usd: string; spent_usd: string; open_holds_usd: string; step_room_usd: string }>("select cap_usd, spent_usd, open_holds_usd, step_room_usd from project_budget where project_id = $1", [project])).rows[0]!;
  const samples = stand.samples.get(project) ?? [];
  samples.push({ spentMicro: micro(Number(v.spent_usd)), openMicro: micro(Number(v.open_holds_usd)), roomMicro: micro(Number(v.step_room_usd)), capMicro: micro(Number(v.cap_usd)), owedMicro: bills.reduce((a, b) => a + b.billMicro, 0) });
  stand.samples.set(project, samples);
}

async function standIn(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const text = await readBody(req);
  const closed = new Promise<"closed">((r) => res.once("close", () => r("closed")));
  if (req.url === "/v1/messages/count_tokens") {
    stand.counts++;
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ input_tokens: 42 }));
    return;
  }
  if (req.url !== "/v1/messages") return void res.writeHead(404).end();
  stand.messages++;
  const body = JSON.parse(text) as { model: string; metadata?: { test?: string; project?: string; tag?: string } };
  const tag = body.metadata?.tag ?? "";
  if (body.metadata?.project) await bill(body.metadata.project);
  stand.arrivedByTag.set(tag, (stand.arrivedByTag.get(tag) ?? 0) + 1);
  if (body.metadata?.test === "park" && (await Promise.race([park(tag).promise.then(() => "go" as const), closed])) === "closed") return;
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "msg_test", type: "message", model: body.model, content: [{ type: "text", text: "hello" }], usage: USAGE }));
}

/* ------------------------------------------------------------------ helpers */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(20);
  }
}

async function newProject(capUsd: number) {
  const id = uniqueId("j14b");
  await createProject(pool, { id, name: "journal recovery test (made-up data)", capUsd });
  return { id, token: await issueProjectToken(pool, id) };
}
const body = (project: string, mode = "ok", tag = "") => ({ model: MODEL, max_tokens: 400, messages: [], metadata: { test: mode, project, tag } });
const callAt = (base: string, token: string, b: unknown, path = "/v1/messages") =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-api-key": token, "anthropic-version": "2023-06-01" }, body: JSON.stringify(b) });
async function outcome(res: Response) {
  const j = (await res.json()) as { error?: { type?: string; message?: string } };
  return { status: res.status, type: j.error?.type ?? null, nothing_forwarded: j.error?.message?.endsWith("Nothing was forwarded.") ?? false, message: j.error?.message ?? "" };
}
const kinds = async (id: string) => (await listEvents(pool, id)).map((e) => e.kind);

async function newDir(prefix = "pkg14b-journal-"): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** A journal record for a hold, as the gateway writes one (made-up call fields). */
function unrecordedFor(projectId: string, holdId: string): UnrecordedEnding {
  return {
    journal_id: uniqueId("j_test14b"),
    gateway: "gw_test14b_store",
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
const line = (rec: unknown) => JSON.stringify(rec) + "\n";

async function storeHold(projectId: string, gateway = "gw_test14b_gone") {
  const r = await openHold(pool, { projectId, step: null, amountUsd: HOLD_USD, deadline: new Date(Date.now() + 600_000), gateway, arithmetic: { model: MODEL }, path: "/v1/messages" });
  if (!r.ok) throw new Error("not opened");
  return r.hold.id;
}

/** src/gateway/main.ts as a process of its own, on this test database, against this stand-in. Its environment is built here, from nothing secret. */
function spawnMain(journalDir: string) {
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: process.env["HOME"] ?? "/tmp",
    TMPDIR: process.env["TMPDIR"] ?? "/tmp",
    BUILDER_DATABASE_URL: TEST_DB_URL,
    BUILDER_UPSTREAM_URL: standUrl,
    BUILDER_MODEL_API_KEY: MADE_UP_KEY,
    BUILDER_GATEWAY_PORT: "0",
    BUILDER_GATEWAY_JOURNAL_DIR: journalDir,
  };
  if (process.env["PGUSER"]) env["PGUSER"] = process.env["PGUSER"];
  const proc = spawn(process.execPath, ["--import", "tsx", "src/gateway/main.ts"], { cwd: BUILDER_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(proc);
  const out: string[] = [];
  let err = "";
  let partial = "";
  proc.stdout!.on("data", (d: Buffer) => {
    partial += d.toString();
    const parts = partial.split("\n");
    partial = parts.pop() ?? "";
    out.push(...parts.filter((l) => l.trim() !== ""));
  });
  proc.stderr!.on("data", (d: Buffer) => (err += d.toString()));
  const exited = new Promise<number | null>((r) => proc.on("close", (code) => r(code)));
  return { proc, out, err: () => err, exited };
}
const LISTENING = /^gateway (gw_[0-9a-f]+) listening on ([\d.]+):(\d+)$/;

async function startMain(journalDir: string) {
  const s = spawnMain(journalDir);
  await until("the gateway process to listen", () => s.out.some((l) => LISTENING.test(l)) || s.proc.exitCode !== null, 30_000);
  const found = s.out.find((l) => LISTENING.test(l));
  if (!found) throw new Error(`the gateway process did not start: ${s.out.join(" | ")} ${s.err()}`);
  const m = LISTENING.exec(found)!;
  return { ...s, url: `http://${m[2]}:${m[3]}`, id: m[1]! };
}

/** main.ts started where it must not start: it exits; what it printed, and its exit code. */
async function mainThatStops(journalDir: string) {
  const s = spawnMain(journalDir);
  const code = await Promise.race([s.exited, sleep(30_000).then(() => "still running" as const)]);
  return { code, out: s.out, err: s.err() };
}

async function lockFree(gatewayId: string): Promise<boolean> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    return (await c.query<{ free: boolean }>(`select pg_try_advisory_xact_lock(${gatewayLockKeySql("$1")}) as free`, [gatewayId])).rows[0]!.free;
  } finally {
    await c.query("rollback");
    c.release();
  }
}

/** SIGKILL the gateway process, wait for it to end, and for the database to end its session (its locks are then free). */
async function kill9(g: Awaited<ReturnType<typeof startMain>>): Promise<void> {
  if (g.proc.exitCode === null && g.proc.signalCode === null) g.proc.kill("SIGKILL");
  await g.exited;
  await until("the killed gateway's locks to be released", () => lockFree(g.id));
}

/** A script of builder/scripts as its own process, against the test database. */
function runScript(script: "journal-recover.ts" | "reconcile.ts", args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["tsx", `scripts/${script}`, ...args], { cwd: BUILDER_DIR, env: { ...process.env, BUILDER_DATABASE_URL: TEST_DB_URL } });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (err += d.toString()));
    proc.on("close", (code) => resolve({ code, out, err }));
  });
}
const recover = (args: string[]) => runScript("journal-recover.ts", args);

/** The test-only fault: the database refuses an insert into the event log or project_freezes for this project. */
const fault = {
  on: (project: string) => pool.query("insert into test_write_faults_14b(project_id) values ($1)", [project]),
  off: () => pool.query("delete from test_write_faults_14b"),
};

/**
 * The real gateway (main.ts) writes a call's ending of project `p` to its journal (every write of `p` refused), and is
 * killed; then the journal's last line is cut in the middle, with no line end, as a crash during its append leaves it.
 */
async function journalLineCutShort(dir: string, p: { id: string; token: string }, tag: string) {
  const k1 = await startMain(dir);
  try {
    const parked = callAt(k1.url, p.token, body(p.id, "park", tag));
    await until("the call at the stand-in", () => (stand.arrivedByTag.get(tag) ?? 0) === 1);
    await fault.on(p.id);
    release(tag);
    expect((await parked).status).toBe(200); // the caller got the provider's answer; its ending could not be written
  } finally {
    await kill9(k1);
    await fault.off();
  }
  const whole = await readFile(join(dir, PENDING));
  const rec = JSON.parse(whole.toString("utf8")) as UnrecordedEnding;
  expect(rec.project_id).toBe(p.id);
  expect(whole.at(-1)).toBe(0x0a);
  const cut = whole.subarray(0, Math.floor(whole.length / 2)); // no line end
  await writeFile(join(dir, PENDING), cut);
  return { holdId: rec.hold_id, cut, whole };
}

/** The invariant checker on one project: no violation. */
async function invariantsHold(id: string): Promise<void> {
  const r = await checkProject(pool, id, stand.bills.get(id) ?? [], stand.samples.get(id) ?? []);
  expect(r.violations.map((v) => `${v.rule}, ${v.at}: ${JSON.stringify(v.detail)}`)).toEqual([]);
}

/** Holds the event log's token table so requests that passed the arrival checks wait for their token to be read (as test/failures.test.ts B10 (10)). */
async function holdTokenReads() {
  const holder = createClient(TEST_DB_URL);
  await holder.connect();
  await holder.query("begin");
  await holder.query("lock table project_tokens in access exclusive mode");
  const pid = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
  let held = true;
  return {
    waiting: async () => (await pool.query<{ n: number }>("select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))", [pid])).rows[0]!.n,
    letGo: async () => {
      if (!held) return;
      held = false;
      await holder.query("rollback");
      await holder.end();
    },
  };
}

beforeAll(async () => {
  pool = await testPool();
  await pool.query(`
    create table if not exists test_write_faults_14b (project_id text not null);
    delete from test_write_faults_14b;
    create or replace function test_write_fault_14b() returns trigger language plpgsql as $$
    begin
      if exists (select 1 from test_write_faults_14b f where f.project_id = new.project_id) then
        raise exception 'test fault: this write is refused';
      end if;
      return new;
    end $$;
    drop trigger if exists test_write_fault_14b_events on events;
    create trigger test_write_fault_14b_events before insert on events for each row execute function test_write_fault_14b();
    drop trigger if exists test_write_fault_14b_freezes on project_freezes;
    create trigger test_write_fault_14b_freezes before insert on project_freezes for each row execute function test_write_fault_14b();
  `);
  standServer = createServer((req, res) => {
    standIn(req, res).catch(() => res.destroy());
  });
  await new Promise<void>((r) => standServer.listen(0, "127.0.0.1", () => r()));
  standUrl = `http://127.0.0.1:${(standServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const tag of parks.keys()) release(tag);
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  for (const l of livenesses) await l.stop();
  for (const s of servers) s.close();
  standServer.closeAllConnections();
  standServer.close();
  await pool.query(`
    drop trigger if exists test_write_fault_14b_events on events;
    drop trigger if exists test_write_fault_14b_freezes on project_freezes;
    drop function if exists test_write_fault_14b();
    drop table if exists test_write_faults_14b;
  `);
  await pool.end();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe("the third outside review, item 1: an unreadable journal line keeps the gateway closed until it is recovered (package 1.4b, against a stand-in provider)", () => {
  it("(a) the review's required test: the journal's last record cut short mid-line, as a crash during its append leaves it, then the gateway restarted (main.ts as a process): every request, metered, counting or passed through, any project, is refused 503 gateway_journal_unreadable; the stand-in receives nothing, no hold is opened, nothing is written", async () => {
    const dir = await newDir();
    const p = await newProject(HOLD_USD * 3);
    const q = await newProject(5); // another project, never frozen: only the unreadable line can stop it
    const { cut } = await journalLineCutShort(dir, p, "j14b-a");
    const k2 = await startMain(dir);
    try {
      expect(k2.out).toContain("journal lines replayed at start-up: 0; all recorded: true");
      const said = k2.out.findIndex((l) => l.startsWith("journal lines that could not be read at start-up: 1; this gateway forwards nothing, for any project"));
      expect(said).toBeGreaterThanOrEqual(0);
      expect(said).toBeLessThan(k2.out.findIndex((l) => LISTENING.test(l))); // said before it listened
      expect(k2.err()).toContain("Lines of the gateway's journal could not be read.");
      const before = { messages: stand.messages, counts: stand.counts, p: await kinds(p.id), q: await kinds(q.id), holdsP: (await listHolds(pool, p.id)).length };
      const got = [];
      for (const [who, path, b] of [
        [q, "/v1/messages", body(q.id)],
        [q, "/v1/messages/count_tokens", { model: MODEL, messages: [] }],
        [p, "/v1/messages", body(p.id)],
        [p, "/v1/messages/count_tokens", { model: MODEL, messages: [] }],
      ] as const) {
        const o = await outcome(await callAt(k2.url, who.token, b, path));
        got.push({ status: o.status, type: o.type, nothing_forwarded: o.nothing_forwarded, says_what_to_do: o.message.includes("An operator has to recover the journal (builder/scripts/journal-recover.ts) and then restart the gateway") });
      }
      expect(got).toEqual(Array(4).fill({ status: 503, type: "gateway_journal_unreadable", nothing_forwarded: true, says_what_to_do: true }));
      // After 1.4b's review: its health check says so too.
      const health = await fetch(k2.url + "/healthz");
      const hb = (await health.json()) as { ok?: boolean; error?: { type?: string } };
      expect({ status: health.status, ok: hb.ok, type: hb.error?.type }).toEqual({ status: 503, ok: false, type: "gateway_journal_unreadable" });
      expect({ messages: stand.messages, counts: stand.counts, p: await kinds(p.id), q: await kinds(q.id), holdsP: (await listHolds(pool, p.id)).length, holdsQ: (await listHolds(pool, q.id)).length }).toEqual({
        ...before,
        holdsQ: 0,
      });
      // The line is left as it was.
      expect((await readFile(join(dir, PENDING))).equals(cut)).toBe(true);
    } finally {
      await kill9(k2);
    }
  }, 120_000);

  it("(a2) the same refusal at the re-checks just before each forward: requests that passed the arrival checks and waited for their token are refused 503 gateway_journal_unreadable once the journal's replay finds an unreadable line; nothing reaches the stand-in", async () => {
    const dir = await newDir();
    const journal = await FaultJournal.open(dir);
    const gatewayId = uniqueId("gw_14b_a2");
    const liveness = await holdLivenessLock(TEST_DB_URL, gatewayId);
    livenesses.push(liveness);
    const gate = new FaultGate({ pool, journal });
    const app = createGateway({ pool, modelApiKey: MADE_UP_KEY, upstreamUrl: standUrl, profiles: DEFAULT_PROFILES, gatewayId, gate, liveness, onFault: () => undefined });
    const url = await new Promise<string>((resolve) => servers.push(serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (i) => resolve(`http://127.0.0.1:${i.port}`))));
    const q = await newProject(5);
    const held = await holdTokenReads();
    try {
      const metered = callAt(url, q.token, body(q.id));
      const counting = callAt(url, q.token, { model: MODEL, messages: [] }, "/v1/messages/count_tokens");
      await until("both requests waiting for their token", async () => (await held.waiting()) === 2);
      await writeFile(journal.file, "a line that is not JSON (made up)\n");
      expect(await gate.replay()).toEqual({ loaded: 0, unreadable: 1, recorded: true });
      const before = { messages: stand.messages, counts: stand.counts };
      await held.letGo();
      const [m, c] = await Promise.all([metered, counting]);
      expect([await outcome(m), await outcome(c)].map((o) => ({ status: o.status, type: o.type, nothing_forwarded: o.nothing_forwarded }))).toEqual(
        Array(2).fill({ status: 503, type: "gateway_journal_unreadable", nothing_forwarded: true }),
      );
      expect({ messages: stand.messages, counts: stand.counts }).toEqual(before);
      expect(await kinds(q.id)).toEqual([]);
    } finally {
      await held.letGo();
    }
  }, 60_000);

  it("(b) a line that is not JSON between two readable records: both records are written (their projects frozen), the gate stays closed for every project, and the line is kept as it was", async () => {
    const dir = await newDir();
    const pa = await newProject(5);
    const pb = await newProject(5);
    const q = await newProject(5);
    const ra = unrecordedFor(pa.id, await storeHold(pa.id));
    const rb = unrecordedFor(pb.id, await storeHold(pb.id));
    const garbage = "this line is not JSON: made up for the test {\"journal_id\":";
    const journal = await FaultJournal.open(dir);
    await writeFile(journal.file, line(ra) + garbage + "\n" + line(rb));
    // As main.ts does: the gate, its replay, then the gateway.
    const faults: string[] = [];
    const gate = new FaultGate({ pool, journal, onFault: (m) => faults.push(m) });
    expect(await gate.replay()).toEqual({ loaded: 2, unreadable: 1, recorded: true });
    expect((await activeFreeze(pool, pa.id))?.journal_id).toBe(ra.journal_id);
    expect((await activeFreeze(pool, pb.id))?.journal_id).toBe(rb.journal_id);
    expect(gate.closed()).toBe(true);
    expect(gate.unreadableLines().map((u) => ({ number: u.number, why: u.why, fingerprint: u.fingerprint }))).toEqual([
      { number: 2, why: "not JSON", fingerprint: fingerprintOf(Buffer.from(garbage)) },
    ]);
    expect(faults.some((m) => m.startsWith("Lines of the gateway's journal could not be read."))).toBe(true);
    // The two records moved to the done file; the unreadable line stays, byte for byte.
    expect(await readFile(journal.file, "utf8")).toBe(garbage + "\n");
    const done = await readFile(journal.doneFile, "utf8");
    expect(done).toContain(ra.journal_id);
    expect(done).toContain(rb.journal_id);
    const gatewayId = uniqueId("gw_14b_b");
    const liveness = await holdLivenessLock(TEST_DB_URL, gatewayId);
    livenesses.push(liveness);
    const app = createGateway({ pool, modelApiKey: MADE_UP_KEY, upstreamUrl: standUrl, profiles: DEFAULT_PROFILES, gatewayId, gate, liveness, onFault: () => undefined });
    const url = await new Promise<string>((resolve) => servers.push(serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (i) => resolve(`http://127.0.0.1:${i.port}`))));
    const before = { messages: stand.messages, counts: stand.counts };
    for (const [who, path] of [[q, "/v1/messages"], [q, "/v1/messages/count_tokens"], [pa, "/v1/messages"]] as const) {
      const o = await outcome(await callAt(url, who.token, body(who.id), path));
      expect({ status: o.status, type: o.type, nothing_forwarded: o.nothing_forwarded }).toEqual({ status: 503, type: "gateway_journal_unreadable", nothing_forwarded: true });
    }
    expect({ messages: stand.messages, counts: stand.counts }).toEqual(before);
    expect(await kinds(q.id)).toEqual([]);
    // Draining again (as before each request and in the 30-second keeper) does not open it.
    expect(await gate.drain()).toBe(true);
    expect(gate.closed()).toBe(true);
  }, 60_000);

  it("(b2) each kind of line that cannot be read is found and closes the gate: not JSON, JSON not of a record's shape (one the 1.4 check took), not valid UTF-8, and a whole record that is the file's last line with no line end; blank lines are skipped", async () => {
    const p = await newProject(5);
    const whole = unrecordedFor(p.id, await storeHold(p.id));
    const cases: Array<[string, Buffer, string | null]> = [
      ["not JSON", Buffer.from("{ this is not JSON\n"), "not JSON"],
      ["a record's two ids only (the 1.4 check took it)", Buffer.from(JSON.stringify({ journal_id: "j_made_up", project_id: p.id }) + "\n"), "JSON, but not a record's shape"],
      ["a record with its hold id a number", Buffer.from(JSON.stringify({ ...unrecordedFor(p.id, "1"), hold_id: 1 }) + "\n"), "JSON, but not a record's shape"],
      ["not valid UTF-8", Buffer.concat([Buffer.from('{"journal_id":"j_'), Buffer.from([0xff, 0xfe]), Buffer.from('"}\n')]), "not valid UTF-8"],
      ["a whole record with no line end", Buffer.from(JSON.stringify(whole)), "torn: the file ends inside it, with no line end"],
      ["blank lines", Buffer.from("\n   \n\t\n"), null],
    ];
    const found: Record<string, unknown> = {};
    for (const [name, bytes, why] of cases) {
      const journal = await FaultJournal.open(await newDir());
      await writeFile(journal.file, bytes);
      const gate = new FaultGate({ pool, journal });
      const r = await gate.replay();
      found[name] = { unreadable: r.unreadable, why: gate.unreadableLines()[0]?.why ?? null, closed: gate.closed() };
      expect(found[name], name).toEqual({ unreadable: why === null ? 0 : 1, why, closed: why !== null });
    }
    expect(await listFreezes(pool, p.id)).toEqual([]); // the whole record with no line end was not taken as read
  }, 60_000);

  it("(c) markDone keeps every line it does not move byte for byte (one not JSON, one not UTF-8, a blank one, and a last one with no line end), and an append after that last line starts on a line of its own", async () => {
    const p = await newProject(5);
    const r1 = unrecordedFor(p.id, await storeHold(p.id));
    const r2 = unrecordedFor(p.id, await storeHold(p.id));
    const r3 = unrecordedFor(p.id, await storeHold(p.id));
    const notUtf8 = Buffer.from([0x7b, 0xff, 0xfe, 0x41, 0x00, 0x7d]);
    const torn = Buffer.from('{"journal_id":"j_made_up_torn","gateway":"gw_x","pro');
    const kept = Buffer.concat([notUtf8, Buffer.from("\n   \ngarbage {\n"), torn]);
    const journal = await FaultJournal.open(await newDir());
    await writeFile(journal.file, Buffer.concat([Buffer.from(line(r1)), notUtf8, Buffer.from("\n   \ngarbage {\n"), Buffer.from(line(r2)), torn]));
    const before = (await journal.pending()).unreadable.map((u) => u.fingerprint);
    expect(before).toHaveLength(3);
    await journal.markDone(r1.journal_id);
    await journal.markDone(r2.journal_id);
    expect((await readFile(journal.file)).equals(kept)).toBe(true);
    expect((await journal.pending()).unreadable.map((u) => u.fingerprint)).toEqual(before);
    const done = await readFile(journal.doneFile, "utf8");
    expect(done).toBe(line(r1) + line(r2));
    // An append after a last line with no line end: the new record is on a line of its own, the torn bytes unchanged.
    await journal.append(r3);
    expect((await readFile(journal.file)).equals(Buffer.concat([kept, Buffer.from("\n" + line(r3))]))).toBe(true);
    const after = await journal.pending();
    expect(after.records.map((r) => r.journal_id)).toEqual([r3.journal_id]);
    expect(after.unreadable.map((u) => u.fingerprint)).toEqual(before);
    // The recovery script's rewrite keeps the others too.
    const notUtf8Line = after.unreadable.find((u) => u.why === "not valid UTF-8")!;
    await journal.removeLine(notUtf8Line.number, notUtf8Line.fingerprint);
    expect((await readFile(journal.file)).equals(Buffer.concat([Buffer.from("   \ngarbage {\n"), torn, Buffer.from("\n" + line(r3))]))).toBe(true);
  });

  it("(d) the recovery: --list shows the line and the candidate hold; --set-aside naming that hold freezes its project; after a restart another project's call is forwarded and settled and the named one is refused; 1.5's reconciliation clears the freeze and its next call is forwarded", async () => {
    const dir = await newDir();
    const p = await newProject(HOLD_USD * 3);
    const q = await newProject(5);
    const { holdId, cut } = await journalLineCutShort(dir, p, "j14b-d");
    // The gateway restarted: closed, and at its start the killed gateway's hold was marked unreconciled.
    const k2 = await startMain(dir);
    let k3: Awaited<ReturnType<typeof startMain>> | null = null;
    try {
      expect((await outcome(await callAt(k2.url, q.token, body(q.id)))).type).toBe("gateway_journal_unreadable");
      expect((await listHolds(pool, p.id))[0]).toMatchObject({ id: holdId, state: "open", unreconciled: true, kept_reason: OWNER_GONE });
      const fp = fingerprintOf(cut);
      const setAside = ["--set-aside", "--dir", dir, "--line", "1", "--fingerprint", fp, "--hold", holdId, "--by", WHO.by, "--reason", WHO.reason];
      // While the gateway runs, the set-aside is refused.
      const busy = await recover(setAside);
      expect(busy.code).toBe(2);
      expect(busy.err).toContain("Refused (folder_in_use)");
      // --list reads which locks are held, without taking one (1.4b's review).
      const listBusy = await recover(["--list", "--dir", dir]);
      expect(listBusy.code).toBe(0);
      expect(listBusy.out).toContain("In use now: YES.");
      await kill9(k2);

      const list = await recover(["--list", "--dir", dir]);
      expect(list.code).toBe(0);
      expect(list.out).toContain("In use now: no.");
      expect(list.out).toContain(`line 1: ${cut.length} bytes; torn: the file ends inside it, with no line end`);
      expect(list.out).toContain(`fingerprint: ${fp}`);
      expect(list.out).toContain(`text:        ${cut.toString("utf8")}`);
      expect(list.out).toMatch(new RegExp(`hold ${holdId}, project ${p.id}: \\$0\\.009960 held; opened \\S+ by gateway gw_[0-9a-f]+;`));

      const done = await recover(setAside);
      expect(done.code).toBe(0);
      expect(done.out).toContain(`Line 1 set aside (set-aside sa_`);
      expect(done.out).toContain(`hold:        ${holdId} of project ${p.id}, $0.009960 held: the project is FROZEN`);
      // Recorded: the freeze naming the hold, the row, the two events; the line moved to the set-aside file, byte for byte.
      const freeze = (await activeFreeze(pool, p.id))!;
      expect(freeze).toMatchObject({ hold_id: holdId, reason: SET_ASIDE_FREEZE_REASON });
      expect(freeze.journal_id).toMatch(/^set-aside:sa_[0-9a-f]{16}$/);
      expect((await kinds(p.id)).slice(-2)).toEqual(["gateway.journal_line_set_aside", "project.frozen"]);
      const ev = (await listEvents(pool, p.id, "gateway.journal_line_set_aside"))[0]!.payload;
      expect(ev).toMatchObject({ line_number: 1, line_length: cut.length, fingerprint: fp, line: cut.toString("utf8"), line_base64: cut.toString("base64"), hold_id: Number(holdId), set_aside_by: WHO.by, reason: WHO.reason });
      const rows = (await pool.query("select * from journal_set_asides where fingerprint = $1", [fp])).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].moved_at).not.toBeNull();
      expect((await readFile(join(dir, PENDING))).length).toBe(0);
      const entry = JSON.parse(await readFile(join(dir, SET_ASIDE_FILE), "utf8")) as Record<string, unknown>;
      expect(Buffer.from(String(entry["line_base64"]), "base64").equals(cut)).toBe(true);
      for (const r of [busy, listBusy, list, done]) {
        expect(r.out + r.err).not.toContain("/var/run/postgresql");
        expect(r.out + r.err).not.toContain(MADE_UP_KEY);
      }

      // The restart: the journal has no unreadable line; the named project is refused as frozen, another forwarded and settled.
      k3 = await startMain(dir);
      expect(k3.out).toContain("journal lines that could not be read at start-up: 0");
      const health = await fetch(k3.url + "/healthz");
      expect({ status: health.status, body: await health.json() }).toEqual({ status: 200, body: { ok: true } });
      const sent = { messages: stand.messages, counts: stand.counts };
      const frozen = await outcome(await callAt(k3.url, p.token, body(p.id)));
      expect(frozen).toMatchObject({ status: 402, type: "project_frozen" });
      expect(frozen.message).toContain("a line of the gateway's journal that could not be read was set aside");
      expect({ messages: stand.messages, counts: stand.counts }).toEqual(sent);
      expect((await callAt(k3.url, q.token, body(q.id))).status).toBe(200);
      expect(await kinds(q.id)).toEqual(["hold.opened", "model.call", "hold.settled"]);

      // 1.5's reconciliation of the named hold clears the freeze; the project's next call is forwarded and settled.
      const rec = await runScript("reconcile.ts", ["--hold", holdId, "--actual", (BILL_MICRO / 1e6).toFixed(6), "--evidence", "Usage record (made up for the test): billed $0.006142", "--asked-by", "the owner (made up)", "--by", "the test", "--reason", "package 1.4b test: the set-aside's hold reconciled"]);
      expect(rec.code).toBe(0);
      expect(rec.out).toContain(`cleared ${freeze.id}; the project is not frozen`);
      expect(await activeFreeze(pool, p.id)).toBeNull();
      expect((await callAt(k3.url, p.token, body(p.id))).status).toBe(200);
      expect((await kinds(p.id)).slice(-3)).toEqual(["hold.opened", "model.call", "hold.settled"]);
      await invariantsHold(p.id);
      await invariantsHold(q.id);
    } finally {
      await kill9(k2);
      if (k3) await kill9(k3);
    }
  }, 180_000);

  it("(e) the script's refusals, each changing nothing: a missing reason, a line number out of range, a fingerprint that differs, a readable line, a hold not open, a hold still in flight, a running gateway, and a second set-aside of the same line; --no-hold records the set-aside and freezes nothing", async () => {
    const dir = await newDir();
    const journal = await FaultJournal.open(dir);
    const p = await newProject(5);
    const kept = await storeHold(p.id);
    await keepHold(pool, { projectId: p.id, holdId: kept, step: null, reason: "the provider's answer broke off part-way", seen: {} });
    const inFlight = await storeHold(p.id);
    const closed = await storeHold(p.id);
    await settleHold(pool, { projectId: p.id, holdId: closed, step: null, actualUsd: 0.001, call: { model: MODEL, status: 200, usage: USAGE } });
    const readable = unrecordedFor(p.id, inFlight);
    const tornA = Buffer.from(`{"journal_id":"j_made_up_a","gateway":"gw_made_up","project_id":"${p.id}","hold_id":"${kept}","st`);
    const notJsonB = Buffer.from("made-up garbage, line three");
    await writeFile(journal.file, Buffer.concat([Buffer.from(line(readable)), notJsonB, Buffer.from("\n"), tornA]));
    const fpA = fingerprintOf(tornA);
    const fpB = fingerprintOf(notJsonB);
    const state = async () => ({
      file: (await readFile(journal.file)).toString("base64"),
      rows: Number((await pool.query("select count(*) from journal_set_asides where journal_folder_id = $1", [journal.folderId])).rows[0].count),
      freezes: (await listFreezes(pool, p.id)).length,
      events: (await kinds(p.id)).length,
    });
    const start = await state();
    const args = (o: Record<string, string | null>) => ["--set-aside", "--dir", dir, ...Object.entries(o).flatMap(([k, v]) => (v === null ? [`--${k}`] : [`--${k}`, v]))];
    const base = { line: "3", fingerprint: fpA, hold: kept, by: WHO.by, reason: WHO.reason } as Record<string, string | null>;
    const refusals: Array<[string, string[], number, string]> = [
      ["a missing reason", args({ ...base, reason: null }).filter((a) => a !== "--reason"), 1, "--reason is missing or empty"],
      ["a line number out of range", args({ ...base, line: "4" }), 2, "Refused (line_out_of_range)"],
      ["a fingerprint that differs", args({ ...base, line: "2" }), 2, "Refused (fingerprint_differs)"],
      ["a readable line", args({ ...base, line: "1", fingerprint: fingerprintOf(Buffer.from(JSON.stringify(readable))) }), 2, "Refused (line_readable)"],
      ["a hold not open", args({ ...base, hold: closed }), 2, "Refused (hold_not_open)"],
      ["a hold still in flight", args({ ...base, hold: inFlight }), 2, "Refused (hold_not_kept)"],
    ];
    for (const [name, a, code, says] of refusals) {
      const r = await recover(a);
      expect({ name, code: r.code, says: r.err.includes(says) }).toEqual({ name, code, says: true });
      expect(await state(), name).toEqual(start);
    }
    // A running gateway: the folder's lock held as main.ts holds it.
    const gw = await holdLivenessLock(TEST_DB_URL, uniqueId("gw_14b_e"), { journalFolderId: journal.folderId });
    try {
      const r = await recover(args(base));
      expect({ code: r.code, says: r.err.includes("Refused (folder_in_use)") }).toEqual({ code: 2, says: true });
      expect(await state()).toEqual(start);
    } finally {
      await gw.stop();
    }
    // Done once; the same command again is refused, and writes nothing twice.
    const ok = await recover(args(base));
    expect(ok.code).toBe(0);
    const once = await state();
    expect(once).toMatchObject({ rows: start.rows + 1, freezes: start.freezes + 1, events: start.events + 2 });
    const again = await recover(args(base));
    expect({ code: again.code, says: again.err.includes("Refused (already_set_aside)") }).toEqual({ code: 2, says: true });
    expect(await state()).toEqual(once);
    // --no-hold: the row only; no freeze, no event.
    const none = await recover(args({ ...base, line: "2", fingerprint: fpB, hold: null }).map((a) => (a === "--hold" ? "--no-hold" : a)));
    expect(none.code).toBe(0);
    expect(none.out).toContain("hold:        none named");
    const last = await state();
    expect(last).toMatchObject({ rows: once.rows + 1, freezes: once.freezes, events: once.events });
    expect(await readFile(journal.file, "utf8")).toBe(line(readable));
    expect((await journal.setAsides()).map((e) => e["fingerprint"])).toEqual([fpA, fpB]);
  }, 120_000);

  it("(e2) a set-aside cut short after its record is finished by the same command run again: the line moved out, nothing written to the database twice", async () => {
    const dir = await newDir();
    const journal = await FaultJournal.open(dir);
    const p = await newProject(5);
    const kept = await storeHold(p.id);
    await keepHold(pool, { projectId: p.id, holdId: kept, step: null, reason: "the provider's answer broke off part-way", seen: {} });
    const torn = Buffer.from('{"journal_id":"j_made_up_e2","gat');
    await writeFile(journal.file, torn);
    const req = { dir, line: 1, fingerprint: fingerprintOf(torn), hold: kept, by: WHO.by, reason: WHO.reason };
    const spy = vi.spyOn(FaultJournal.prototype, "appendSetAside").mockRejectedValueOnce(Object.assign(new Error("made-up disk error"), { code: "EIO" }));
    try {
      const first = await setAsideLine(pool, TEST_DB_URL, req).then(
        () => "done",
        (e: unknown) => (e instanceof RecoveryRefused ? `refused ${e.code}` : `failed ${(e as { code?: string }).code}`),
      );
      expect(first).toBe("failed EIO");
    } finally {
      spy.mockRestore();
    }
    // Recorded, not moved: the project is frozen and the line is still in the journal file (a gateway reading it stays closed).
    expect((await pool.query("select moved_at from journal_set_asides where journal_folder_id = $1", [journal.folderId])).rows).toEqual([{ moved_at: null }]);
    expect(await activeFreeze(pool, p.id)).not.toBeNull();
    expect((await readFile(journal.file)).equals(torn)).toBe(true);
    const second = await setAsideLine(pool, TEST_DB_URL, req);
    expect(second.finishedEarlier).toEqual([second.setAsideId]);
    expect(second.hold).toMatchObject({ id: kept, projectId: p.id });
    expect((await pool.query("select count(*)::int as n, count(moved_at)::int as moved from journal_set_asides where journal_folder_id = $1", [journal.folderId])).rows[0]).toEqual({ n: 1, moved: 1 });
    expect(await listFreezes(pool, p.id)).toHaveLength(1);
    expect((await kinds(p.id)).filter((k) => k === "gateway.journal_line_set_aside")).toHaveLength(1);
    expect((await readFile(journal.file)).length).toBe(0);
    expect((await journal.setAsides()).map((e) => e["set_aside_id"])).toEqual([second.setAsideId]);
  }, 60_000);

  it("(f) a journal file that exists and cannot be read stops start-up, with a plain message, before the gateway listens; a second gateway on a folder in use does not start either", async () => {
    const dir = await newDir();
    await mkdir(join(dir, PENDING)); // the journal file's name is a folder: reading it fails (EISDIR)
    const stopped = await mainThatStops(dir);
    expect(stopped.code).toBe(1);
    expect(stopped.err).toContain("The gateway's journal file cannot be read");
    expect(stopped.err).toContain("the gateway does not start");
    expect(stopped.out.some((l) => LISTENING.test(l))).toBe(false);
    // One gateway per journal folder (on one database): a second one stops at its start.
    const shared = await newDir();
    const first = await startMain(shared);
    try {
      const second = await mainThatStops(shared);
      expect(second.code).toBe(1);
      expect(second.err).toContain("Another process is using the gateway's journal folder");
      expect(second.out.some((l) => LISTENING.test(l))).toBe(false);
    } finally {
      await kill9(first);
    }
  }, 120_000);

  it("(g) the folder's lock: a gateway that loses its connection does not take the folder back while a recovery holds it (it stays stopped meanwhile); its journal moves nothing in its file while it does not hold the lock, and still appends (1.4b's review)", async () => {
    const dir = await newDir();
    const journal = await FaultJournal.open(dir);
    const gw = await holdLivenessLock(TEST_DB_URL, uniqueId("gw_14b_g"), { retryMs: 200, journalFolderId: journal.folderId });
    livenesses.push(gw);
    journal.guardWrites(() => gw.ok());
    const p = await newProject(5);
    const r1 = unrecordedFor(p.id, await storeHold(p.id));
    const r2 = unrecordedFor(p.id, "1");
    await journal.append(r1);
    // The connection drops; a recovery takes the folder's lock (as the script does) before the gateway takes it back.
    const recovery = createClient(TEST_DB_URL);
    await recovery.connect();
    try {
      await pool.query("select pg_terminate_backend($1)", [gw.pid()]);
      await until("the gateway to see its locks lost", () => !gw.ok());
      const got = (await recovery.query<{ got: boolean }>("select pg_try_advisory_lock(('x' || substr(md5('builder-gateway-journal-folder:' || $1), 1, 16))::bit(64)::bigint) as got", [journal.folderId])).rows[0]!.got;
      expect(got).toBe(true);
      await sleep(1_000); // five of the gateway's tries
      expect(gw.ok()).toBe(false);
      const before = await readFile(journal.file);
      const refusedWith = async (op: Promise<unknown>) => op.then(() => "written", (e: unknown) => (e as { code?: string }).code);
      // A call's ending is still appended: that is when the database may be out of reach.
      expect(await refusedWith(journal.append(r2))).toBe("written");
      const withR2 = await readFile(journal.file);
      expect(withR2.equals(Buffer.concat([before, Buffer.from(line(r2))]))).toBe(true);
      // Its rewrites are refused, and the set-aside file is not written.
      expect(await refusedWith(journal.markDone(r1.journal_id))).toBe("JOURNAL_FOLDER_NOT_HELD");
      expect(await refusedWith(journal.removeLine(1, fingerprintOf(Buffer.from(JSON.stringify(r1)))))).toBe("JOURNAL_FOLDER_NOT_HELD");
      expect(await refusedWith(journal.appendSetAside({ set_aside_id: "sa_made_up_g" }))).toBe("JOURNAL_FOLDER_NOT_HELD");
      expect((await readFile(journal.file)).equals(withR2)).toBe(true);
      expect(await readFile(journal.setAsideFile).catch((e: { code?: string }) => e.code)).toBe("ENOENT");
    } finally {
      await recovery.end();
    }
    await until("the gateway to take its locks back", () => gw.ok());
    await journal.markDone(r1.journal_id);
    expect(await readFile(journal.file, "utf8")).toBe(line(r2));
    await journal.markDone(r2.journal_id);
    expect((await readFile(journal.file)).length).toBe(0);
  }, 60_000);

  it("(e3) after 1.4b's review: a set-aside cut short, then run again naming another hold, finishes the earlier record (its hold's project frozen), writes nothing for the hold asked now, and the script says so", async () => {
    const dir = await newDir();
    const journal = await FaultJournal.open(dir);
    const p = await newProject(5);
    const first = await storeHold(p.id);
    const other = await storeHold(p.id);
    for (const h of [first, other]) await keepHold(pool, { projectId: p.id, holdId: h, step: null, reason: "the provider's answer broke off part-way", seen: {} });
    const torn = Buffer.from('{"journal_id":"j_made_up_e3","gat');
    await writeFile(journal.file, torn);
    const fp = fingerprintOf(torn);
    const spy = vi.spyOn(FaultJournal.prototype, "appendSetAside").mockRejectedValueOnce(Object.assign(new Error("made-up disk error"), { code: "EIO" }));
    try {
      await expect(setAsideLine(pool, TEST_DB_URL, { dir, line: 1, fingerprint: fp, hold: first, by: WHO.by, reason: WHO.reason })).rejects.toMatchObject({ code: "EIO" });
    } finally {
      spy.mockRestore();
    }
    const again = await recover(["--set-aside", "--dir", dir, "--line", "1", "--fingerprint", fp, "--hold", other, "--by", WHO.by, "--reason", WHO.reason]);
    expect(again.code).toBe(0);
    expect(again.out).toContain(`NOTE: this line was set aside earlier (a run cut short, finished now) naming hold ${first}, not hold ${other} as asked now.`);
    expect(again.out).toContain(`hold:        ${first} of project ${p.id}`);
    expect((await listFreezes(pool, p.id)).map((f) => f.hold_id)).toEqual([first]);
    expect((await readFile(journal.file)).length).toBe(0);
  }, 60_000);

  it("(h) after 1.4b's review, the review's probe: the gateway's lock connection lost and kept from it, then a call's ending refused by the database, then the gateway killed: the ending is in its journal, and the restarted gateway (main.ts as a process) freezes the project and forwards nothing for it", async () => {
    const dir = await newDir();
    const p = await newProject(HOLD_USD * 3);
    const q = await newProject(5);
    const tag = "j14b-h";
    const k1 = await startMain(dir);
    const blocker = createClient(TEST_DB_URL);
    await blocker.connect();
    let blocking = true;
    let k2: Awaited<ReturnType<typeof startMain>> | null = null;
    try {
      const parked = callAt(k1.url, p.token, body(p.id, "park", tag));
      await until("the call at the stand-in", () => (stand.arrivedByTag.get(tag) ?? 0) === 1);
      await fault.on(p.id);
      // The gateway's lock connection is ended, and its lock taken here at once, so it cannot take it back (in place of
      // a database it cannot reach); the gateway then holds neither its liveness lock nor its folder's lock.
      const lockPid = (
        await pool.query<{ pid: number }>(
          `select l.pid from pg_locks l
            where l.locktype = 'advisory' and l.granted and l.objsubid = 1
              and l.database = (select oid from pg_database where datname = current_database())
              and ((l.classid::bigint << 32) | l.objid::bigint) = ${gatewayLockKeySql("$1")}`,
          [k1.id],
        )
      ).rows[0]!.pid;
      const taken = blocker.query(`select pg_advisory_lock(${gatewayLockKeySql("$1")})`, [k1.id]);
      await pool.query("select pg_terminate_backend($1)", [lockPid]);
      await taken;
      await until("the gateway to see its lock lost", () => k1.err().includes("liveness lock was lost"));
      // The provider answers; the database refuses to record the call's ending.
      release(tag);
      expect((await parked).status).toBe(200);
      await until("the ending written to the journal file", async () => (await readFile(join(dir, PENDING)).catch(() => Buffer.alloc(0))).at(-1) === 0x0a);
      const rec = JSON.parse(await readFile(join(dir, PENDING), "utf8")) as UnrecordedEnding;
      expect({ project: rec.project_id, ending: rec.ending }).toEqual({ project: p.id, ending: "settle" });
      expect(k1.err()).not.toContain("could not be written to the gateway's journal file either");
      // Killed with the database still out of its reach.
      k1.proc.kill("SIGKILL");
      await k1.exited;
      await blocker.end();
      blocking = false;
      await fault.off();

      k2 = await startMain(dir);
      expect(k2.out).toContain("journal lines replayed at start-up: 1; all recorded: true");
      expect((await activeFreeze(pool, p.id))?.journal_id).toBe(rec.journal_id);
      expect((await listHolds(pool, p.id)).map((h) => ({ id: h.id, state: h.state, unreconciled: h.unreconciled }))).toEqual([{ id: rec.hold_id, state: "open", unreconciled: true }]);
      const sent = { messages: stand.messages, counts: stand.counts };
      const frozen = await outcome(await callAt(k2.url, p.token, body(p.id)));
      expect({ status: frozen.status, type: frozen.type }).toEqual({ status: 402, type: "project_frozen" });
      expect({ messages: stand.messages, counts: stand.counts }).toEqual(sent);
      expect((await callAt(k2.url, q.token, body(q.id))).status).toBe(200);
      await invariantsHold(p.id);
      await invariantsHold(q.id);
    } finally {
      if (k1.proc.exitCode === null && k1.proc.signalCode === null) k1.proc.kill("SIGKILL");
      if (blocking) await blocker.end().catch(() => undefined);
      await fault.off();
      if (k2) await kill9(k2);
    }
  }, 120_000);

  it("(i) after 1.4b's review: --list takes no lock, even for a moment, yet says when the folder is in use; and it decodes only the start of a very long line", async () => {
    const dir = await newDir();
    const journal = await FaultJournal.open(dir);
    const long = Buffer.alloc(3 * 1024 * 1024, 0x61); // 3 MiB of "a": not JSON (made up)
    await writeFile(journal.file, Buffer.concat([long, Buffer.from("\n")]));
    // Every statement the listing sends to the database, recorded.
    const sent: string[] = [];
    const record = (q: unknown) => sent.push(typeof q === "string" ? q : String((q as { text?: unknown }).text));
    const watched = {
      query: (q: unknown, v?: unknown[]) => (record(q), pool.query(q as string, v)),
      connect: async () => {
        const c = await pool.connect();
        return new Proxy(c, {
          get(t, prop) {
            if (prop === "query") return (q: unknown, v?: unknown[]) => (record(q), t.query(q as string, v));
            const val: unknown = Reflect.get(t, prop, t);
            return typeof val === "function" ? (val as (...a: unknown[]) => unknown).bind(t) : val;
          },
        });
      },
    } as unknown as pg.Pool;
    const free = await listJournal(watched, dir);
    const gw = await holdLivenessLock(TEST_DB_URL, uniqueId("gw_14b_i"), { journalFolderId: journal.folderId });
    let held;
    try {
      held = await listJournal(watched, dir);
    } finally {
      await gw.stop();
    }
    expect({ free: free.inUse, held: held.inUse }).toEqual({ free: false, held: true });
    expect(sent.filter((q) => /pg_(try_)?advisory(_xact)?_lock/.test(q))).toEqual([]);
    const u = free.unreadable[0]!;
    expect({ lines: free.unreadable.length, length: u.length, why: u.why, textLength: u.text.length }).toEqual({ lines: 1, length: long.length, why: "not JSON", textLength: LISTED_BYTES });
    const listed = await recover(["--list", "--dir", dir]);
    expect(listed.code).toBe(0);
    expect(listed.out).toContain(`(the line is ${long.length} bytes long; only its start is shown)`);
  }, 60_000);

  it("(m) brought up to date with 1.4c: a set-aside's freeze is of kind 'journal_line_set_aside' (two lines may name one hold); the database refuses one with no hold, no fingerprint or a bill; it is refused with its own message, listed as freezing its project, refused by the record of a bill above its hold, and cleared by its hold's reconciliation", async () => {
    const dir = await newDir();
    const journal = await FaultJournal.open(dir);
    const p = await newProject(5);
    const kept = await storeHold(p.id);
    await keepHold(pool, { projectId: p.id, holdId: kept, step: null, reason: "the provider's answer broke off part-way", seen: {} });
    const notJson = Buffer.from("made-up garbage, line one of (m)");
    const torn = Buffer.from(`{"journal_id":"j_made_up_m","gateway":"gw_made_up","project_id":"${p.id}","hold_id":"${kept}","st`);
    await writeFile(journal.file, Buffer.concat([notJson, Buffer.from("\n"), torn]));
    // Two lines set aside, each naming the same hold: a freeze for each, as on 1.4b's branch.
    const first = await setAsideLine(pool, TEST_DB_URL, { dir, line: 1, fingerprint: fingerprintOf(notJson), hold: kept, by: WHO.by, reason: WHO.reason });
    const second = await setAsideLine(pool, TEST_DB_URL, { dir, line: 1, fingerprint: fingerprintOf(torn), hold: kept, by: WHO.by, reason: WHO.reason });
    const freezes = await listFreezes(pool, p.id);
    expect(freezes.map((f) => [f.kind, f.hold_id, f.journal_id, f.bill_usd, f.record["fingerprint"], f.cleared_at])).toEqual([
      ["journal_line_set_aside", kept, `set-aside:${first.setAsideId}`, null, fingerprintOf(notJson), null],
      ["journal_line_set_aside", kept, `set-aside:${second.setAsideId}`, null, fingerprintOf(torn), null],
    ]);
    expect((await listEvents(pool, p.id, "project.frozen")).map((e) => [e.payload["kind"], e.payload["freeze_id"]])).toEqual(freezes.map((f) => ["journal_line_set_aside", Number(f.id)]));
    // Its own refusal message, and the gateway's refusal event names its kind.
    const app = createGateway({ pool, modelApiKey: MADE_UP_KEY, upstreamUrl: standUrl, profiles: DEFAULT_PROFILES, gatewayId: uniqueId("gw_14b_m"), journal: await FaultJournal.open(await newDir()), onFault: () => undefined });
    const url = await new Promise<string>((resolve) => servers.push(serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (i) => resolve(`http://127.0.0.1:${i.port}`))));
    const sent = { messages: stand.messages, counts: stand.counts };
    const refused = await outcome(await callAt(url, p.token, body(p.id)));
    expect(refused).toMatchObject({ status: 402, type: "project_frozen" });
    expect(refused.message).toContain(`a line of the gateway's journal that could not be read was set aside at ${freezes[0]!.frozen_at.toISOString()} as possibly the record of a call on its hold ${kept}`);
    expect({ messages: stand.messages, counts: stand.counts }).toEqual(sent);
    expect((await listEvents(pool, p.id, "gateway.refused")).map((e) => [e.payload["freeze_kind"], e.payload["freeze_id"]])).toEqual([["journal_line_set_aside", Number(freezes[0]!.id)]]);
    // Listed as freezing its project, each freeze with its kind.
    const listed = (await listUnreconciled(pool, { projectId: p.id })).holds;
    expect(listed.map((h) => [h.holdId, h.kinds.includes("froze its project"), h.freezes.map((f) => f.kind)])).toEqual([[kept, true, ["journal_line_set_aside", "journal_line_set_aside"]]]);
    const script = await runScript("reconcile.ts", ["--list", "--project", p.id]);
    expect(script.code).toBe(0);
    for (const f of freezes) {
      expect(script.out).toContain(`    froze its project: freeze ${f.id} (an unreadable journal line set aside as ${f.journal_id!.slice("set-aside:".length)}), set aside ${f.ended_at.toISOString()}; not cleared; cost as read (none)`);
    }
    // The database refuses such a freeze with no hold, with no fingerprint, or with a bill (what the call cost is not known).
    const insert = (hold: string | null, record: Record<string, unknown>, billUsd: string | null) =>
      pool.query(
        `insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, bill_usd, record)
         values ($1, 'journal_line_set_aside', $2, $3, 'gw_made_up', 'test (made up)', now(), $4, $5, $6)`,
        [p.id, hold, `set-aside:${String(record["set_aside_id"])}`, HOLD_USD, billUsd, JSON.stringify(record)],
      ).then(
        () => null,
        (e: unknown) => e,
      );
    const fp = "a".repeat(64);
    for (const [hold, record, billUsd] of [
      [null, { set_aside_id: "sa_made_up_m1", fingerprint: fp }, null],
      [kept, { set_aside_id: "sa_made_up_m2" }, null],
      [kept, { set_aside_id: "sa_made_up_m3", fingerprint: "not a fingerprint" }, null],
      [kept, { set_aside_id: "sa_made_up_m4", fingerprint: fp }, "0.012284"],
    ] as const) {
      expect(await insert(hold, record, billUsd)).toMatchObject({ code: "23514", constraint: "project_freezes_set_aside_line" });
    }
    expect(await listFreezes(pool, p.id)).toHaveLength(2);
    // The record of a bill above its hold refuses it, naming what froze the project; nothing changes.
    const overrun = await recordOverrun(pool, { projectId: p.id, holdId: kept, evidence: "made up", askedBy: "the owner (made up)", recordedBy: "the test", reason: "package 1.4b test (m)" }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(overrun).toBeInstanceOf(ReconcileRefused);
    expect(overrun).toMatchObject({ code: "no_overrun_freeze" });
    expect((overrun as Error).message).toContain("an unreadable line of the gateway's journal was set aside naming it");
    expect((await listFreezes(pool, p.id)).filter((f) => f.cleared_at === null)).toHaveLength(2);
    // The hold's reconciliation clears both; the project's next call is forwarded and settled.
    const rec = await reconcileHold(pool, { projectId: p.id, holdId: kept, actualUsd: BILL_MICRO / 1e6, evidence: "Usage record (made up for the test)", askedBy: "the owner (made up)", recordedBy: "the test", reason: "package 1.4b test (m)" });
    expect({ cleared: rec.freezesCleared, stillFrozen: rec.projectStillFrozen }).toEqual({ cleared: freezes.map((f) => f.id), stillFrozen: false });
    expect(await activeFreeze(pool, p.id)).toBeNull();
    expect((await callAt(url, p.token, body(p.id))).status).toBe(200);
    expect((await kinds(p.id)).slice(-3)).toEqual(["hold.opened", "model.call", "hold.settled"]);
    await invariantsHold(p.id);
  }, 60_000);
});
