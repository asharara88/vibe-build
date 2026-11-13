/**
 * Package 1.4: the failure tests (build plan 7.3; design note 7.2, proof rows B8 to B13).
 *
 * Against a stand-in provider written here as a plain Node server (it can park a call, cut a stream and
 * drop a connection), the gateway in this process and the gateway's own start-up file (src/gateway/main.ts)
 * run as a process of its own and killed with SIGKILL. No real provider is called; the key is made up;
 * nothing is spent. The data is made up.
 *
 * In every case the invariant checker (test/invariants.ts) replays the project's events and checks, after
 * each one and at each billing point, (1) spent + open holds (+ room reserved for steps) <= cap and (2) spent
 * + open holds >= what the stand-in says it billed, and that no settled call costs more than its hold.
 * The stand-in prices its bills by hand: every call it bills is the usage below on Claude Opus 5.5.
 *
 * A test-only trigger (created here, never a migration, dropped at the end) makes the database refuse
 * chosen writes, for proof row B10.
 */
import { serve, type ServerType } from "@hono/node-server";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGateway } from "../src/gateway/app.js";
import { FaultGate, FaultJournal } from "../src/gateway/journal.js";
import { DEFAULT_PROFILES } from "../src/gateway/hold.js";
import { createClient, createPool } from "../src/store/db.js";
import { listEvents } from "../src/store/events.js";
import { activeFreeze, listFreezes, recordFreeze, type UnrecordedEnding } from "../src/store/freezes.js";
import { changeCap, listHolds, openHold, openStepHold, OWNER_GONE } from "../src/store/holds.js";
import { gatewayLockKeySql, holdLivenessLock, type Liveness } from "../src/store/liveness.js";
import { createProject, issueProjectToken } from "../src/store/projects.js";
import { checkProject, checkTrace, micro, traceTable, type Bill, type Sample, type TraceEvent } from "./invariants.js";
import { TEST_DB_URL, testPool, uniqueId } from "./helpers.js";

/**
 * The file operations, for B10 (9) (the review bot on 2ad751d). Passed through unchanged unless a test names a
 * journal file to watch: then each append to it is counted from its open to its close, and the rename that ends
 * a mark-done rewrite of it can be held until the test lets it go. Nothing here changes what a file holds.
 */
const fsWatch = vi.hoisted(() => ({
  journal: null as string | null,
  appendsOpen: 0,
  whenNoAppendOpen: [] as Array<() => void>,
  holdRename: null as Promise<void> | null,
  renameHeld: false,
  order: [] as string[],
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const appendClosed = () => {
    fsWatch.appendsOpen--;
    if (fsWatch.appendsOpen === 0) for (const f of fsWatch.whenNoAppendOpen.splice(0)) f();
  };
  const open = async (...args: Parameters<typeof real.open>) => {
    const [path, flags] = args;
    if (fsWatch.journal === null || String(path) !== fsWatch.journal || flags !== "a") return real.open(...args);
    fsWatch.appendsOpen++;
    fsWatch.order.push("append to the journal: opened");
    let fh: Awaited<ReturnType<typeof real.open>>;
    try {
      fh = await real.open(...args);
    } catch (err) {
      appendClosed();
      throw err;
    }
    const close = fh.close.bind(fh);
    fh.close = async () => {
      try {
        await close();
      } finally {
        fsWatch.order.push("append to the journal: closed");
        appendClosed();
      }
    };
    return fh;
  };
  const rename = async (...args: Parameters<typeof real.rename>) => {
    const watched = fsWatch.journal !== null && String(args[1]) === fsWatch.journal;
    if (watched && fsWatch.holdRename) {
      fsWatch.renameHeld = true;
      fsWatch.order.push("mark-done rewrite: rename held");
      await fsWatch.holdRename;
    }
    await real.rename(...args);
    if (watched) fsWatch.order.push("mark-done rewrite: renamed");
  };
  return { ...real, open, rename };
});
/** Resolves once no append to the watched journal is open (at once if none is). */
const noAppendOpen = () => (fsWatch.appendsOpen === 0 ? Promise.resolve() : new Promise<void>((r) => fsWatch.whenNoAppendOpen.push(r)));

/** Made up for these tests; never a real key. */
const MADE_UP_KEY = "made-up-key-for-package-1-4-failure-tests";
const BUILDER_DIR = fileURLToPath(new URL("..", import.meta.url));
const MODEL = "claude-opus-5-5";
/** What every billed call used, and its bill worked out by hand at Claude Opus 5.5's rates ($4 in, $5 five-minute cache writes, $0.20 cache reads, $20 out, per million). */
const USAGE = { input_tokens: 30, cache_creation_input_tokens: 4, cache_read_input_tokens: 8, output_tokens: 300 };
const BILL_MICRO = Math.ceil(30 * 4 + 4 * 5 + 8 * 0.2 + 300 * 20 - 1e-9); // 6,141.6 millionths, rounded up: $0.006142
/** The hold of each call: (42 counted + 5% + 200) x $8 + 400 x $20, per million. */
const HOLD_USD = 0.00996;
/** What a stream shows before it is cut: its start (output 1 token so far) and one piece of text. */
const SEEN_BEFORE_CUT = { ...USAGE, output_tokens: 1 };

let pool: pg.Pool;
let standServer: Server;
let standUrl: string;
const children: ChildProcess[] = [];
const livenesses: Liveness[] = [];
const servers: ServerType[] = [];
const journalDirs: string[] = [];

/* ------------------------------------------------------------------ the stand-in provider */

const stand = {
  /** Metered calls and counting calls that reached the stand-in. A refused call must move neither. */
  messages: 0,
  counts: 0,
  bills: new Map<string, Bill[]>(),
  samples: new Map<string, Sample[]>(),
  arrivedByTag: new Map<string, number>(),
};
type How = "answer" | "cut";
const parks = new Map<string, { promise: Promise<How>; release: (how: How) => void }>();
function park(tag: string) {
  let p = parks.get(tag);
  if (!p) {
    let release!: (how: How) => void;
    const promise = new Promise<How>((r) => (release = r));
    p = { promise, release };
    parks.set(tag, p);
  }
  return p;
}
const release = (tag: string, how: How = "answer") => park(tag).release(how);

const frame = (o: Record<string, unknown>) => `event: ${String(o["type"])}\ndata: ${JSON.stringify(o)}\n\n`;
const START = frame({ type: "message_start", message: { model: MODEL, usage: SEEN_BEFORE_CUT } });
const PIECE = frame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } });
const END = frame({ type: "message_delta", usage: { output_tokens: USAGE.output_tokens } }) + frame({ type: "message_stop" });

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.setEncoding("utf8");
    req.on("data", (d: string) => (s += d));
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

/** The stand-in bills a call when it arrives: pinned to the project's latest hold.opened (this call's hold, committed before it was forwarded), with the budget view read at that moment. */
async function bill(project: string): Promise<void> {
  const r = await pool.query<{ id: string }>("select coalesce(max(id), 0)::text as id from events where project_id = $1 and kind = 'hold.opened'", [project]);
  const bills = stand.bills.get(project) ?? [];
  bills.push({ pinnedAt: Number(r.rows[0]!.id), billMicro: BILL_MICRO });
  stand.bills.set(project, bills);
  const v = (
    await pool.query<{ cap_usd: string; spent_usd: string; open_holds_usd: string; step_room_usd: string }>(
      "select cap_usd, spent_usd, open_holds_usd, step_room_usd from project_budget where project_id = $1",
      [project],
    )
  ).rows[0]!;
  const samples = stand.samples.get(project) ?? [];
  samples.push({
    spentMicro: micro(Number(v.spent_usd)),
    openMicro: micro(Number(v.open_holds_usd)),
    roomMicro: micro(Number(v.step_room_usd)),
    capMicro: micro(Number(v.cap_usd)),
    owedMicro: bills.reduce((a, b) => a + b.billMicro, 0),
  });
  stand.samples.set(project, samples);
}

async function standIn(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const text = await readBody(req);
  const closed = new Promise<"closed">((r) => res.once("close", () => r("closed")));
  if (req.url === "/v1/messages/count_tokens") {
    stand.counts++;
    // A counting call whose first message is "park-count:<tag>" is held until the test releases "count:<tag>".
    let first: unknown;
    try {
      first = (JSON.parse(text) as { messages?: Array<{ content?: unknown }> }).messages?.[0]?.content;
    } catch {
      first = undefined;
    }
    if (typeof first === "string" && first.startsWith("park-count:")) {
      const tag = `count:${first.slice("park-count:".length)}`;
      stand.arrivedByTag.set(tag, (stand.arrivedByTag.get(tag) ?? 0) + 1);
      if ((await Promise.race([park(tag).promise, closed])) === "closed") return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ input_tokens: 42 }));
    return;
  }
  if (req.url !== "/v1/messages") {
    res.writeHead(404).end();
    return;
  }
  stand.messages++;
  const body = JSON.parse(text) as { model: string; metadata?: { test?: string; project?: string; tag?: string } };
  const mode = body.metadata?.test ?? "ok";
  const tag = body.metadata?.tag ?? "";
  if (body.metadata?.project) await bill(body.metadata.project);
  stand.arrivedByTag.set(tag, (stand.arrivedByTag.get(tag) ?? 0) + 1);
  const json = (o: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
  const message = (withUsage = true) => ({ id: "msg_test", type: "message", model: body.model, content: [{ type: "text", text: "hello" }], ...(withUsage ? { usage: USAGE } : {}) });
  switch (mode) {
    case "ok":
      return void json(message());
    case "park": {
      // Held until the test releases it (or the caller's connection closes).
      if ((await Promise.race([park(tag).promise, closed])) === "closed") return;
      return void json(message());
    }
    case "never":
      await closed; // no answer is ever sent
      return;
    case "drop":
      // The whole request was read; the connection is closed with no answer.
      req.socket.destroy();
      return;
    case "no-usage":
      return void json(message(false));
    case "not-json":
      res.writeHead(200, { "content-type": "application/json" }).end("<html>an answer that is not JSON</html>");
      return;
    case "stream": {
      // The start and one piece of output, then held: the test either lets it finish or has the connection cut.
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(START + PIECE);
      const how = await Promise.race([park(tag).promise, closed]);
      if (how === "closed") return;
      if (how === "cut") {
        res.socket?.destroy();
        return;
      }
      res.end(END);
      return;
    }
    default:
      res.writeHead(400).end();
  }
}

/* ------------------------------------------------------------------ helpers */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Bounded polling: check every 20 ms, fail with the name of what did not happen. */
async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(20);
  }
}

function listen(app: { fetch: (r: Request) => Response | Promise<Response> }): Promise<{ server: ServerType; url: string }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => resolve({ server, url: `http://127.0.0.1:${info.port}` }));
    servers.push(server);
  });
}

async function newProject(capUsd: number) {
  const id = uniqueId("f14");
  await createProject(pool, { id, name: "failure test (made-up data)", capUsd });
  return { id, token: await issueProjectToken(pool, id) };
}

const body = (project: string, mode = "ok", tag = "", more: Record<string, unknown> = {}) => ({ model: MODEL, max_tokens: 400, messages: [], metadata: { test: mode, project, tag }, ...more });
const callAt = (base: string, token: string, b: unknown, path = "/v1/messages") =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-api-key": token, "anthropic-version": "2023-06-01" }, body: JSON.stringify(b) });
const errorOf = async (res: Response) => ((await res.json()) as { error: { type: string; message: string } }).error;
const kinds = async (id: string) => (await listEvents(pool, id)).map((e) => e.kind);

/** A gateway in this process, holding its liveness lock, with its own gate (and journal, if a folder is given). */
async function inProcessGateway(name: string, o: { journalDir?: string; retryMs?: number } = {}) {
  const gatewayId = uniqueId(name);
  const liveness = await holdLivenessLock(TEST_DB_URL, gatewayId, { retryMs: o.retryMs });
  livenesses.push(liveness);
  const faults: string[] = [];
  const journal = o.journalDir ? await FaultJournal.open(o.journalDir) : null;
  const gate = new FaultGate({ pool, journal, onFault: (m) => faults.push(m) });
  const app = createGateway({ pool, modelApiKey: MADE_UP_KEY, upstreamUrl: standUrl, profiles: DEFAULT_PROFILES, gatewayId, gate, liveness, onFault: (m) => faults.push(m) });
  const { url } = await listen(app);
  return { url, gatewayId, gate, journal, faults, liveness };
}

async function newJournalDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "pkg14-journal-"));
  journalDirs.push(d);
  return d;
}

/** src/gateway/main.ts as a process of its own, started as `node --import tsx`, on this test database, against this stand-in. Its environment is built here, from nothing secret. */
async function startMain(journalDir: string) {
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
  const exited = new Promise<void>((r) => proc.on("close", () => r()));
  const LISTENING = /^gateway (gw_[0-9a-f]+) listening on ([\d.]+):(\d+)$/;
  await until("the gateway process to listen", () => out.some((l) => LISTENING.test(l)) || proc.exitCode !== null, 30_000);
  const line = out.find((l) => LISTENING.test(l));
  if (!line) throw new Error(`the gateway process did not start: ${out.join(" | ")} ${err}`);
  const m = LISTENING.exec(line)!;
  return { url: `http://${m[2]}:${m[3]}`, id: m[1]!, proc, out, err: () => err, exited };
}

/** Whether nobody holds a gateway's liveness lock (tried for one transaction only, as a starting gateway does). */
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

/**
 * How many sessions wait, directly or through the queue, on a lock the session `holderPid` holds. A row lock's
 * first waiter waits on the holder; the others wait on the waiter ahead of them (pg_blocking_pids names it), so
 * the chain is followed back to the holder.
 */
async function blockedBehind(holderPid: number): Promise<number> {
  const r = await pool.query<{ pid: number; by: number[] }>("select pid, pg_blocking_pids(pid) as by from pg_stat_activity where datname = current_database()");
  const behind = new Set<number>([holderPid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const row of r.rows) if (!behind.has(row.pid) && row.by.some((b) => behind.has(b))) (behind.add(row.pid), (grew = true));
  }
  return behind.size - 1;
}

/** SIGKILL the gateway process, wait for it to end, and for the database to end its session (its lock is then free). */
async function kill9(g: Awaited<ReturnType<typeof startMain>>): Promise<void> {
  g.proc.kill("SIGKILL");
  await g.exited;
  await until(`the killed gateway's liveness lock to be released`, () => lockFree(g.id));
}

/** Spent + open holds of a project, in millionths. */
async function committed(id: string): Promise<number> {
  const r = await pool.query<{ spent_usd: string; open_holds_usd: string }>("select spent_usd, open_holds_usd from project_budget where project_id = $1", [id]);
  return micro(Number(r.rows[0]!.spent_usd)) + micro(Number(r.rows[0]!.open_holds_usd));
}

/** The invariant checker on one project: no violation, and the number of states it checked. */
async function invariantsHold(id: string): Promise<number> {
  const r = await checkProject(pool, id, stand.bills.get(id) ?? [], stand.samples.get(id) ?? []);
  // For the evidence: the trace of every checked state, when asked for.
  const out = process.env["PKG14_TRACE_OUT"];
  if (out) appendFileSync(out, traceTable(`${expect.getState().currentTestName ?? "?"} | project ${id}`, r.rows, stand.samples.get(id) ?? []));
  expect(r.violations.map((v) => `${v.rule}, ${v.at}: ${JSON.stringify(v.detail)}`)).toEqual([]);
  expect(r.states).toBeGreaterThan(1);
  return r.states;
}

/** The test-only fault: the database refuses an insert into the event log or project_freezes when a rule matches. */
const fault = {
  on: (project: string, target: string) => pool.query("insert into test_write_faults(project_id, target) values ($1, $2)", [project, target]),
  off: () => pool.query("delete from test_write_faults"),
};

beforeAll(async () => {
  pool = await testPool();
  await pool.query(`
    create table if not exists test_write_faults (project_id text not null, target text not null);
    delete from test_write_faults;
    create or replace function test_write_fault() returns trigger language plpgsql as $$
    begin
      if exists (select 1 from test_write_faults f
                  where (f.project_id = '*' or f.project_id = new.project_id)
                    and (f.target = '*' or f.target = tg_table_name or f.target = to_jsonb(new)->>'kind')) then
        raise exception 'test fault: this write is refused';
      end if;
      return new;
    end $$;
    drop trigger if exists test_write_fault_events on events;
    create trigger test_write_fault_events before insert on events for each row execute function test_write_fault();
    drop trigger if exists test_write_fault_freezes on project_freezes;
    create trigger test_write_fault_freezes before insert on project_freezes for each row execute function test_write_fault();
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
    drop trigger if exists test_write_fault_events on events;
    drop trigger if exists test_write_fault_freezes on project_freezes;
    drop function if exists test_write_fault();
    drop table if exists test_write_faults;
  `);
  await pool.end();
  for (const d of journalDirs) await rm(d, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ B8 */

describe("package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider)", () => {
  it("B8: six calls at once through two gateway processes, against room for one: exactly one forwarded, five refused, judged one after another under the project's row lock", async () => {
    const { id, token } = await newProject(HOLD_USD * 1.5);
    const [a, b] = await Promise.all([startMain(await newJournalDir()), startMain(await newJournalDir())]);
    const holder = await pool.connect();
    const holderPid = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
    const before = { messages: stand.messages, counts: stand.counts };
    const answers: Array<{ status: number; type?: string }> = [];
    let calls: Promise<void>[] = [];
    let open = false;
    try {
      // A third session holds the project's row lock: every admission has to wait for it.
      await holder.query("begin");
      open = true;
      await holder.query("select id from projects where id = $1 for update", [id]);
      calls = Array.from({ length: 6 }, (_, i) =>
        callAt(i % 2 ? b.url : a.url, token, body(id, "park", "b8")).then(async (r) => {
          answers.push({ status: r.status, type: r.status === 200 ? undefined : (await errorOf(r)).type });
        }),
      );
      // All six are seen waiting on that lock (bounded polling of pg_blocking_pids, followed through the queue).
      await until("all six admissions waiting on the project's row lock", async () => (await blockedBehind(holderPid)) >= 6);
      expect(await listEvents(pool, id, "hold.opened")).toHaveLength(0); // nothing is written while the lock is held
      expect(stand.counts - before.counts).toBe(6); // each was counted (the counting call is not metered)
      await holder.query("commit");
      open = false;
      // Every call either answered or reached the stand-in, where the one admitted is held.
      await until("every call answered or forwarded", () => answers.length + (stand.arrivedByTag.get("b8") ?? 0) >= 6);
      // The checker first: with one call admitted, spent + open holds stayed within the cap at every event.
      await invariantsHold(id);
      expect(stand.messages - before.messages).toBe(1);
      await until("five answers", () => answers.length >= 5);
      expect(answers).toHaveLength(5);
      expect(answers.every((x) => x.status === 402 && x.type === "budget_reached")).toBe(true);
      release("b8");
      await Promise.all(calls);
      expect(answers.filter((x) => x.status === 200)).toHaveLength(1);
      expect(await listEvents(pool, id, "hold.opened")).toHaveLength(1);
      expect((await listEvents(pool, id, "gateway.refused")).map((e) => (e.payload as { reason: string }).reason)).toEqual(Array(5).fill("budget_reached"));
      await until("the admitted call settled", async () => (await listEvents(pool, id, "hold.settled")).length === 1);
      await invariantsHold(id);
    } finally {
      if (open) await holder.query("rollback").catch(() => undefined);
      holder.release();
      release("b8");
      await Promise.allSettled(calls);
      a.proc.kill("SIGKILL");
      b.proc.kill("SIGKILL");
      await Promise.all([a.exited, b.exited]);
    }
  }, 90_000);

  /* ------------------------------------------------------------------ B9 */

  it("B9 (1): the gateway process killed while the provider has not answered: a gateway started afterwards finds the hold, keeps it at its full amount and marks it unreconciled; a running sibling's hold is left alone", async () => {
    const p = await newProject(HOLD_USD * 1.5);
    const q = await newProject(HOLD_USD * 1.5);
    // A sibling gateway, running in this process with its liveness lock, has a call in flight on project Q.
    const sibling = await inProcessGateway("gw_b9_sibling");
    const siblingCall = callAt(sibling.url, q.token, body(q.id, "park", "b9-1-sibling"));
    const k = await startMain(await newJournalDir());
    let k2: Awaited<ReturnType<typeof startMain>> | null = null;
    try {
      const inFlight = callAt(k.url, p.token, body(p.id, "never", "b9-1")).then(
        (r) => `answered ${r.status}`,
        () => "connection closed with no answer",
      );
      await until("both calls at the stand-in", () => (stand.arrivedByTag.get("b9-1") ?? 0) === 1 && (stand.arrivedByTag.get("b9-1-sibling") ?? 0) === 1);
      const beforeKill = await committed(p.id);
      await kill9(k);
      expect(await inFlight).toBe("connection closed with no answer");
      const whileDead = await committed(p.id);
      k2 = await startMain(await newJournalDir());
      const afterRestart = await committed(p.id);
      expect([beforeKill, whileDead, afterRestart]).toEqual([micro(HOLD_USD), micro(HOLD_USD), micro(HOLD_USD)]);
      // The running sibling's hold first: found, and left alone.
      const qHold = (await listHolds(pool, q.id))[0]!;
      expect(qHold).toMatchObject({ state: "open", unreconciled: false, kept_reason: null, seen_at_startup: true });
      expect((await listEvents(pool, q.id, "hold.found_at_startup"))[0]!.payload).toMatchObject({ opened_by: sibling.gatewayId, owner_gone: false, unreconciled: false });
      // The killed gateway's hold: kept at its full amount, still open, unreconciled.
      const pHold = (await listHolds(pool, p.id))[0]!;
      expect(pHold).toMatchObject({ state: "open", unreconciled: true, kept_reason: OWNER_GONE, actual_usd: null, gateway: k.id });
      expect(micro(Number(pHold.amount_usd))).toBe(micro(HOLD_USD));
      expect(await kinds(p.id)).toEqual(["hold.opened", "hold.found_at_startup"]);
      expect((await listEvents(pool, p.id, "hold.found_at_startup"))[0]!.payload).toMatchObject({ opened_by: k.id, found_by: k2.id, owner_gone: true, unreconciled: true, kept: true, still_open: true });
      expect(k2.out.join("\n")).toContain("their gateway found gone: ");
      // The sibling's call then ends normally and is settled.
      release("b9-1-sibling");
      expect((await siblingCall).status).toBe(200);
      expect((await listHolds(pool, q.id))[0]).toMatchObject({ state: "settled" });
      await invariantsHold(p.id);
      await invariantsHold(q.id);
    } finally {
      release("b9-1-sibling");
      if (k2) await kill9(k2);
      if (k.proc.exitCode === null && k.proc.signalCode === null) await kill9(k);
    }
  }, 90_000);

  it("B9 (2): the gateway process killed mid-stream, after output began: the hold is kept at its full amount, unreconciled, by the gateway started afterwards", async () => {
    const p = await newProject(HOLD_USD * 1.5);
    const k = await startMain(await newJournalDir());
    let k2: Awaited<ReturnType<typeof startMain>> | null = null;
    try {
      const res = await callAt(k.url, p.token, body(p.id, "stream", "b9-2", { stream: true }));
      const reader = res.body!.getReader();
      let seen = "";
      await until("the caller to read output", async () => {
        const r = await reader.read();
        seen += new TextDecoder().decode(r.value ?? new Uint8Array());
        return seen.includes("content_block_delta") || r.done;
      });
      expect(seen).toContain("text_delta");
      const beforeKill = await committed(p.id);
      await kill9(k);
      await reader.read().catch(() => undefined);
      const whileDead = await committed(p.id);
      k2 = await startMain(await newJournalDir());
      expect([beforeKill, whileDead, await committed(p.id)]).toEqual([micro(HOLD_USD), micro(HOLD_USD), micro(HOLD_USD)]);
      const h = (await listHolds(pool, p.id))[0]!;
      expect(h).toMatchObject({ state: "open", unreconciled: true, kept_reason: OWNER_GONE, actual_usd: null });
      expect(await kinds(p.id)).toEqual(["hold.opened", "hold.found_at_startup"]);
      await invariantsHold(p.id);
    } finally {
      release("b9-2", "cut");
      if (k2) await kill9(k2);
      if (k.proc.exitCode === null && k.proc.signalCode === null) await kill9(k);
    }
  }, 90_000);

  it("B9 (3): the gateway process killed while it waits to write the settle (a third session holds the project's lock): nothing is written for the call, and the hold is kept, unreconciled, by the gateway started afterwards", async () => {
    const p = await newProject(HOLD_USD * 1.5);
    const k = await startMain(await newJournalDir());
    let k2: Awaited<ReturnType<typeof startMain>> | null = null;
    const holder = await pool.connect();
    let open = false;
    try {
      const pending = callAt(k.url, p.token, body(p.id, "park", "b9-3")).then(
        (r) => `answered ${r.status}`,
        () => "connection closed with no answer",
      );
      await until("the call at the stand-in", () => (stand.arrivedByTag.get("b9-3") ?? 0) === 1);
      const holderPid = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      await holder.query("begin");
      open = true;
      await holder.query("select id from projects where id = $1 for update", [p.id]);
      release("b9-3"); // the stand-in answers in full; the gateway's settle then waits for the lock
      await until("the gateway's settle waiting on the project's row lock", async () => (await blockedBehind(holderPid)) >= 1);
      const beforeKill = await committed(p.id);
      k.proc.kill("SIGKILL");
      await k.exited;
      // The lock is let go only after the kill (a gateway starting while it is held would wait for it).
      await holder.query("commit");
      open = false;
      await until("the killed gateway's liveness lock to be released", () => lockFree(k.id));
      expect(await pending).toBe("connection closed with no answer");
      const whileDead = await committed(p.id);
      expect(await kinds(p.id)).toEqual(["hold.opened"]); // the settle never ran: no model.call, no hold.settled
      k2 = await startMain(await newJournalDir());
      expect([beforeKill, whileDead, await committed(p.id)]).toEqual([micro(HOLD_USD), micro(HOLD_USD), micro(HOLD_USD)]);
      expect((await listHolds(pool, p.id))[0]).toMatchObject({ state: "open", unreconciled: true, kept_reason: OWNER_GONE, actual_usd: null });
      expect(await kinds(p.id)).toEqual(["hold.opened", "hold.found_at_startup"]);
      await invariantsHold(p.id);
    } finally {
      if (open) await holder.query("rollback").catch(() => undefined);
      holder.release();
      if (k2) await kill9(k2);
      if (k.proc.exitCode === null && k.proc.signalCode === null) await kill9(k);
    }
  }, 90_000);

  /* ------------------------------------------------------------------ B10 */

  it("B10 (1): the database refuses the call's model.call write after the provider answered: the hold stays open, unreconciled; the project is frozen, the fault raised; its next call and its counting call are refused with the reason, nothing forwarded, also after a cap raise; another project is unaffected", async () => {
    const journalDir = await newJournalDir();
    const g = await inProcessGateway("gw_b10_1", { journalDir });
    const p = await newProject(HOLD_USD * 3); // room for the next call: a refusal must come from the freeze, not the budget
    const q = await newProject(5);
    const parked = callAt(g.url, p.token, body(p.id, "park", "b10-1"));
    await until("the call at the stand-in", () => (stand.arrivedByTag.get("b10-1") ?? 0) === 1);
    await fault.on(p.id, "model.call");
    release("b10-1");
    expect((await parked).status).toBe(200); // the caller got the provider's answer
    await fault.off();
    // Recorded once the write failed: the hold kept and unreconciled, the fault, the freeze.
    expect(await kinds(p.id)).toEqual(["hold.opened", "hold.kept", "gateway.fault", "project.frozen"]);
    const h = (await listHolds(pool, p.id))[0]!;
    expect(h).toMatchObject({ state: "open", unreconciled: true, actual_usd: null });
    expect(micro(Number(h.amount_usd))).toBe(micro(HOLD_USD));
    expect((await listEvents(pool, p.id, "hold.kept"))[0]!.payload).toMatchObject({ unreconciled: true, frozen: true, seen: { usage: { input_tokens: 30, output_tokens: 300 }, cost_usd_as_read: BILL_MICRO / 1e6 } });
    const freezes = await listFreezes(pool, p.id);
    expect(freezes).toHaveLength(1);
    expect(freezes[0]).toMatchObject({ hold_id: h.id, gateway: g.gatewayId, cleared_at: null });
    expect(g.faults.filter((m) => m.includes("could not be written to the event log"))).toHaveLength(1);
    expect(g.gate.closed()).toBe(false);
    // The journal line was moved to the done file once written; it never holds the key.
    expect((await g.journal!.pending()).records).toHaveLength(0);
    const done = await readFile(g.journal!.doneFile, "utf8");
    expect(done).toContain(freezes[0]!.journal_id);
    expect(done).not.toContain(MADE_UP_KEY);

    // The next call, and the counting call, are refused with the reason: nothing reaches the stand-in.
    const before = { messages: stand.messages, counts: stand.counts };
    const next = await callAt(g.url, p.token, body(p.id));
    expect(next.status).toBe(402);
    const e = await errorOf(next);
    expect(e.type).toBe("project_frozen");
    expect(e.message).toMatch(/^This project is stopped: a model call that ended at \S+ could not be recorded, so what it cost is not known\. Its hold of up to \$0\.01 stays counted against the budget\. The gateway forwarded nothing/);
    const count = await callAt(g.url, p.token, { model: MODEL, messages: [] }, "/v1/messages/count_tokens");
    expect(count.status).toBe(402);
    expect((await errorOf(count)).type).toBe("project_frozen");
    // A cap raise does not reopen it.
    await changeCap(pool, { projectId: p.id, newCapUsd: 10, askedBy: "the test (made up)", changedBy: "the test", reason: "B10: a raise must not reopen a frozen project" });
    const afterRaise = await callAt(g.url, p.token, body(p.id));
    expect(afterRaise.status).toBe(402);
    expect((await errorOf(afterRaise)).type).toBe("project_frozen");
    expect({ messages: stand.messages, counts: stand.counts }).toEqual(before);
    expect((await listEvents(pool, p.id, "gateway.refused")).map((x) => (x.payload as { reason: string }).reason)).toEqual(["project_frozen", "project_frozen", "project_frozen"]);
    // Another project on the same gateway is unaffected.
    expect((await callAt(g.url, q.token, body(q.id))).status).toBe(200);
    await invariantsHold(p.id);
    await invariantsHold(q.id);
  }, 60_000);

  it("B10 (2): the freeze itself cannot be written either: the gateway's gate stays closed and it forwards nothing for any project, writing nothing, until the freeze is written; then the project is frozen and the other resumes", async () => {
    const g = await inProcessGateway("gw_b10_2", { journalDir: await newJournalDir() });
    const p = await newProject(HOLD_USD * 3);
    const q = await newProject(5);
    const parked = callAt(g.url, p.token, body(p.id, "park", "b10-2"));
    await until("the call at the stand-in", () => (stand.arrivedByTag.get("b10-2") ?? 0) === 1);
    await fault.on(p.id, "model.call");
    await fault.on(p.id, "project_freezes");
    release("b10-2");
    expect((await parked).status).toBe(200);
    expect(g.gate.closed()).toBe(true);
    expect((await g.journal!.pending()).records.map((r) => r.project_id)).toEqual([p.id]);
    const before = { messages: stand.messages, counts: stand.counts, p: (await kinds(p.id)).length, q: (await kinds(q.id)).length };
    for (const [who, path] of [[p, "/v1/messages"], [q, "/v1/messages"], [q, "/v1/messages/count_tokens"]] as const) {
      const r = await callAt(g.url, who.token, body(who.id), path);
      expect(r.status).toBe(503);
      expect((await errorOf(r)).type).toBe("gateway_unrecorded");
    }
    // Nothing was forwarded, not even a counting call, and nothing was written.
    expect({ messages: stand.messages, counts: stand.counts, p: (await kinds(p.id)).length, q: (await kinds(q.id)).length }).toEqual(before);
    expect(await kinds(p.id)).toEqual(["hold.opened"]);
    // The database takes writes again: the next request records the freeze first.
    await fault.off();
    expect((await callAt(g.url, q.token, body(q.id))).status).toBe(200);
    expect(g.gate.closed()).toBe(false);
    expect(await kinds(p.id)).toEqual(["hold.opened", "hold.kept", "gateway.fault", "project.frozen"]);
    const r = await callAt(g.url, p.token, body(p.id));
    expect(r.status).toBe(402);
    expect((await errorOf(r)).type).toBe("project_frozen");
    expect((await g.journal!.pending()).records).toHaveLength(0);
    await invariantsHold(p.id);
    await invariantsHold(q.id);
  }, 60_000);

  it("B10 (3): every write refused, then the gateway process killed: the journal line survives, and the gateway started afterwards writes it before it serves, so the project's first call is refused as frozen", async () => {
    const journalDir = await newJournalDir();
    const k = await startMain(journalDir);
    let k2: Awaited<ReturnType<typeof startMain>> | null = null;
    const p = await newProject(HOLD_USD * 3);
    const q = await newProject(5);
    try {
      const parked = callAt(k.url, p.token, body(p.id, "park", "b10-3"));
      await until("the call at the stand-in", () => (stand.arrivedByTag.get("b10-3") ?? 0) === 1);
      await fault.on("*", "*");
      release("b10-3");
      expect((await parked).status).toBe(200);
      const before = { messages: stand.messages, counts: stand.counts };
      for (const who of [p, q]) {
        const r = await callAt(k.url, who.token, body(who.id));
        expect(r.status).toBe(503);
        expect((await errorOf(r)).type).toBe("gateway_unrecorded");
      }
      expect({ messages: stand.messages, counts: stand.counts }).toEqual(before);
      await kill9(k);
      await fault.off();
      expect(await kinds(p.id)).toEqual(["hold.opened"]); // nothing reached the log before the kill
      k2 = await startMain(journalDir);
      // The project's first call after the restart is refused as frozen: the journal was written before serving.
      const first = await callAt(k2.url, p.token, body(p.id));
      expect(first.status).toBe(402);
      expect((await errorOf(first)).type).toBe("project_frozen");
      expect((await callAt(k2.url, q.token, body(q.id))).status).toBe(200);
      expect({ messages: stand.messages, counts: stand.counts }).toEqual({ messages: before.messages + 1, counts: before.counts + 1 });
      expect(k2.out).toContain("journal lines replayed at start-up: 1; all recorded: true");
      // ... and before it began listening: the replay's line comes before the "listening" line (review of 1.4).
      expect(k2.out.indexOf("journal lines replayed at start-up: 1; all recorded: true")).toBeLessThan(k2.out.findIndex((l) => / listening on /.test(l)));
      // The line survived the kill: it is now in the done file, and none is left waiting.
      const journal = await FaultJournal.open(journalDir);
      expect((await journal.pending()).records).toHaveLength(0);
      const freeze = (await listFreezes(pool, p.id))[0]!;
      expect(await readFile(journal.doneFile, "utf8")).toContain(freeze.journal_id);
      expect((await kinds(p.id)).slice(0, 4)).toEqual(["hold.opened", "hold.kept", "gateway.fault", "project.frozen"]);
      expect((await listHolds(pool, p.id))[0]).toMatchObject({ state: "open", unreconciled: true });
      await invariantsHold(p.id);
      await invariantsHold(q.id);
    } finally {
      await fault.off();
      if (k2) await kill9(k2);
      if (k.proc.exitCode === null && k.proc.signalCode === null) await kill9(k);
    }
  }, 90_000);

  it("B10 (7): the journal file cannot be written either: the gate stays closed, with the record kept in memory, until the database takes it", async () => {
    const dir = await newJournalDir();
    const g = await inProcessGateway("gw_b10_7", { journalDir: dir });
    await rm(dir, { recursive: true, force: true }); // the journal's folder is gone: writing to it fails
    const p = await newProject(HOLD_USD * 3);
    const q = await newProject(5);
    const parked = callAt(g.url, p.token, body(p.id, "park", "b10-7"));
    await until("the call at the stand-in", () => (stand.arrivedByTag.get("b10-7") ?? 0) === 1);
    await fault.on(p.id, "model.call");
    await fault.on(p.id, "project_freezes");
    release("b10-7");
    expect((await parked).status).toBe(200);
    expect(g.faults.filter((m) => m.includes("could not be written to the gateway's journal file either")).length).toBeGreaterThan(0);
    const before = { messages: stand.messages, counts: stand.counts };
    const r = await callAt(g.url, q.token, body(q.id));
    expect(r.status).toBe(503);
    expect((await errorOf(r)).type).toBe("gateway_unrecorded");
    expect({ messages: stand.messages, counts: stand.counts }).toEqual(before);
    await fault.off();
    expect((await callAt(g.url, q.token, body(q.id))).status).toBe(200);
    expect(await kinds(p.id)).toEqual(["hold.opened", "hold.kept", "gateway.fault", "project.frozen"]);
    const frozen = await callAt(g.url, p.token, body(p.id));
    expect(frozen.status).toBe(402);
    expect((await errorOf(frozen)).type).toBe("project_frozen");
    await invariantsHold(p.id);
    await invariantsHold(q.id);
  }, 60_000);

  it("B10 (8): a call that passed the gate before it closed, and waits at its counting call, is not forwarded once the gate is closed: its hold is given back (only the counting call was sent) and it gets the 503", async () => {
    const g = await inProcessGateway("gw_b10_8", { journalDir: await newJournalDir() });
    const p = await newProject(HOLD_USD * 3); // room for both calls: a refusal must come from the gate, not the budget
    const a = callAt(g.url, p.token, body(p.id, "park", "b10-8a"));
    await until("call A at the stand-in", () => (stand.arrivedByTag.get("b10-8a") ?? 0) === 1);
    // Call B, same project, passes the gate while it is open and is held at its counting call.
    const b = callAt(g.url, p.token, body(p.id, "ok", "b10-8b", { messages: [{ role: "user", content: "park-count:b10-8b" }] }));
    await until("call B at its counting call", () => (stand.arrivedByTag.get("count:b10-8b") ?? 0) === 1);
    // A's ending and the freeze are both refused: the gate closes and stays closed.
    await fault.on(p.id, "model.call");
    await fault.on(p.id, "project_freezes");
    release("b10-8a");
    expect((await a).status).toBe(200);
    expect(g.gate.closed()).toBe(true);
    const before = stand.messages;
    release("count:b10-8b");
    const rb = await b;
    expect(rb.status).toBe(503);
    expect((await errorOf(rb)).type).toBe("gateway_unrecorded");
    expect(stand.messages).toBe(before); // B never reached the stand-in
    expect(stand.arrivedByTag.get("b10-8b")).toBeUndefined();
    // B's hold was opened under the lock, then given back at nothing, marked not forwarded; A's stays open, full.
    expect(await kinds(p.id)).toEqual(["hold.opened", "hold.opened", "hold.settled"]);
    expect((await listEvents(pool, p.id, "hold.settled"))[0]!.payload).toMatchObject({ actual_usd: 0, forwarded: false });
    await fault.off();
    expect(await g.gate.drain()).toBe(true);
    expect(await kinds(p.id)).toEqual(["hold.opened", "hold.opened", "hold.settled", "hold.kept", "gateway.fault", "project.frozen"]);
    expect((await listHolds(pool, p.id)).filter((h) => h.state === "open")).toHaveLength(1);
    await invariantsHold(p.id);
  }, 60_000);

  it("B10 (9): a second call's ending appended to the journal while the first one's line is being moved to the done file is kept: the move cannot drop it, and a gateway started afterwards still finds it (review bot on 2ad751d)", async () => {
    const dir = await newJournalDir();
    const journal = await FaultJournal.open(dir);
    const faults: string[] = [];
    const g = new FaultGate({ pool, journal, onFault: (m) => faults.push(m) });
    const deadline = new Date(Date.now() + 600_000);
    const holdFor = async (projectId: string) => {
      const opened = await openHold(pool, { projectId, step: null, amountUsd: HOLD_USD, deadline, gateway: "gw_test_b10_9", arithmetic: {}, path: "/v1/messages" });
      if (!opened.ok) throw new Error("not opened");
      return opened.hold.id;
    };
    const pa = await newProject(5);
    const pb = await newProject(5);
    const a = unrecordedFor(pa.id, await holdFor(pa.id));
    const b = unrecordedFor(pb.id, await holdFor(pb.id));
    let letRenameGo!: () => void;
    const unwatch = () => {
      letRenameGo();
      Object.assign(fsWatch, { journal: null, holdRename: null, renameHeld: false, order: [] });
    };
    fsWatch.journal = journal.file;
    fsWatch.holdRename = new Promise<void>((r) => (letRenameGo = r));
    try {
      // A's ending: noted and forced to disk, as app.ts does; the database takes A's freeze, but will keep refusing B's.
      g.note(a);
      await g.persist(a.journal_id);
      await fault.on(pb.id, "project_freezes");
      const drained = g.drain();
      // A's line is being moved: the done file written, the journal's rewrite built from what the file held then, its rename held.
      await until("A's mark-done rewrite to reach its rename", () => fsWatch.renameHeld);
      // B's ending arrives now. If its append is not held back, it is let finish before the rename goes ahead.
      g.note(b);
      const persisted = g.persist(b.journal_id);
      await new Promise((r) => setImmediate(r));
      await noAppendOpen();
      letRenameGo();
      await persisted;
      expect(await drained).toBe(false); // B's freeze is still refused
      const order = fsWatch.order.slice();
      // B is still waiting in the journal (once), and only A was moved to the done file.
      expect((await journal.pending()).records.map((r) => r.journal_id)).toEqual([b.journal_id]);
      const done = await readFile(journal.doneFile, "utf8");
      expect(done).toContain(a.journal_id);
      expect(done).not.toContain(b.journal_id);
      // B's append ran after the rewrite's rename, never inside it.
      expect(order).toEqual([
        "append to the journal: opened",
        "append to the journal: closed",
        "mark-done rewrite: rename held",
        "mark-done rewrite: renamed",
        "append to the journal: opened",
        "append to the journal: closed",
      ]);
      expect(g.closed()).toBe(true);
      expect(await kinds(pa.id)).toEqual(["hold.opened", "hold.kept", "gateway.fault", "project.frozen"]);
      expect(await kinds(pb.id)).toEqual(["hold.opened"]);
      unwatch();
      // The gateway restarts while the database still refuses B's freeze: the new one finds B in the journal.
      const g2 = new FaultGate({ pool, journal: await FaultJournal.open(dir), onFault: (m) => faults.push(m) });
      expect(await g2.replay()).toEqual({ loaded: 1, unreadable: 0, recorded: false });
      expect(g2.oldest()?.journal_id).toBe(b.journal_id);
      await fault.off();
      expect(await g2.drain()).toBe(true);
      expect(await kinds(pb.id)).toEqual(["hold.opened", "hold.kept", "gateway.fault", "project.frozen"]);
      expect((await listHolds(pool, pb.id))[0]).toMatchObject({ state: "open", unreconciled: true });
      expect((await journal.pending()).records).toHaveLength(0);
      expect(await readFile(journal.doneFile, "utf8")).toContain(b.journal_id);
      expect(faults).toEqual([]);
      await invariantsHold(pa.id);
      await invariantsHold(pb.id);
    } finally {
      unwatch();
      await fault.off();
    }
  }, 60_000);

  it("B10 (4): under the project's lock, a frozen project opens no hold, starts no step, and a running step's calls are refused, whatever the cap", async () => {
    const { id } = await newProject(5);
    const deadline = new Date(Date.now() + 600_000);
    const step = await openStepHold(pool, { projectId: id, stepId: "step-b10-4", model: MODEL, maxTurns: 2, profile: { maxTokensCeiling: 400, allowFastMode: false, stepPromptTokens: 42 }, deadline });
    expect(step.ok).toBe(true);
    if (!step.ok) return;
    const opened = await openHold(pool, { projectId: id, step: null, amountUsd: HOLD_USD, deadline, gateway: "gw_test_b10_4", arithmetic: {}, path: "/v1/messages" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await recordFreeze(pool, unrecordedFor(id, opened.hold.id));
    const plain = await openHold(pool, { projectId: id, step: null, amountUsd: HOLD_USD, deadline, gateway: "gw_test_b10_4", arithmetic: {}, path: "/v1/messages" });
    expect(plain).toMatchObject({ ok: false, reason: "project_frozen" });
    const drawn = await openHold(pool, { projectId: id, step: "step-b10-4", amountUsd: HOLD_USD, deadline, gateway: "gw_test_b10_4", arithmetic: {}, path: "/v1/messages", stepHoldId: step.stepHold.id, model: MODEL, maxTokens: 400 });
    expect(drawn).toMatchObject({ ok: false, reason: "project_frozen" });
    const another = await openStepHold(pool, { projectId: id, stepId: "step-b10-4b", model: MODEL, maxTurns: 1, profile: { maxTokensCeiling: 400, allowFastMode: false, stepPromptTokens: 42 }, deadline });
    expect(another).toMatchObject({ ok: false, reason: "project_frozen" });
    if (!another.ok) expect(another.message).toContain("The step was not started");
    expect(await listHolds(pool, id)).toHaveLength(1);
    expect((await listEvents(pool, id, "step.refused")).map((e) => (e.payload as { reason: string }).reason)).toEqual(["project_frozen"]);
    await invariantsHold(id);
  });

  it("B10 (5): writing the same journal line twice adds nothing, and a hold the failed write had in fact settled is left settled, with the project still frozen", async () => {
    const { id } = await newProject(5);
    const deadline = new Date(Date.now() + 600_000);
    const opened = await openHold(pool, { projectId: id, step: null, amountUsd: HOLD_USD, deadline, gateway: "gw_test_b10_5", arithmetic: {}, path: "/v1/messages" });
    if (!opened.ok) throw new Error("not opened");
    const rec = unrecordedFor(id, opened.hold.id);
    expect((await recordFreeze(pool, rec)).written).toBe(true);
    expect((await recordFreeze(pool, rec)).written).toBe(false); // a replay after a crash
    expect(await kinds(id)).toEqual(["hold.opened", "hold.kept", "gateway.fault", "project.frozen"]);
    expect(await listFreezes(pool, id)).toHaveLength(1);
    // A settle reported as failed that had in fact committed: the freeze is still written, the hold left settled.
    const other = await newProject(5);
    const o = await openHold(pool, { projectId: other.id, step: null, amountUsd: HOLD_USD, deadline, gateway: "gw_test_b10_5", arithmetic: {}, path: "/v1/messages" });
    if (!o.ok) throw new Error("not opened");
    await pool.query("update holds set state = 'settled', closed_at = now(), actual_usd = 0 where id = $1", [o.hold.id]);
    expect((await recordFreeze(pool, unrecordedFor(other.id, o.hold.id))).written).toBe(true);
    expect((await listHolds(pool, other.id))[0]).toMatchObject({ state: "settled" });
    expect((await listEvents(pool, other.id, "project.frozen"))[0]!.payload).toMatchObject({ hold_state: "settled" });
    expect(await activeFreeze(pool, other.id)).not.toBeNull();
  });

  it("B10 (6): a freeze is never deleted, rewritten or emptied; it can only be cleared, once", async () => {
    const { id } = await newProject(5);
    const opened = await openHold(pool, { projectId: id, step: null, amountUsd: HOLD_USD, deadline: new Date(Date.now() + 600_000), gateway: "gw_test_b10_6", arithmetic: {}, path: "/v1/messages" });
    if (!opened.ok) throw new Error("not opened");
    const { freeze } = await recordFreeze(pool, unrecordedFor(id, opened.hold.id));
    const refused = async (sql: string) => {
      const err = await pool.query(sql, [freeze!.id]).then(() => null, (e: Error) => e.message);
      expect(err ?? "the database accepted it").toMatch(/freeze/);
    };
    await refused("delete from project_freezes where id = $1");
    await refused("update project_freezes set reason = 'edited' where id = $1");
    await refused("update project_freezes set project_id = project_id, cleared_at = null, frozen_at = now() - interval '1 day' where id = $1");
    expect(await pool.query("truncate project_freezes").then(() => null, (e: Error) => e.message)).toMatch(/freeze/);
    expect(await activeFreeze(pool, id)).not.toBeNull();
    await pool.query("update project_freezes set cleared_at = now() where id = $1", [freeze!.id]);
    await refused("update project_freezes set cleared_at = null where id = $1");
  });

  /* ------------------------------------------------------------------ B11 */

  it("B11 (1): a stream cut after output began keeps its full hold, open and unreconciled; the usage seen is recorded for information only, and nothing is released", async () => {
    const g = await inProcessGateway("gw_b11_1");
    const p = await newProject(HOLD_USD * 1.5);
    const res = await callAt(g.url, p.token, body(p.id, "stream", "b11-1", { stream: true }));
    const reader = res.body!.getReader();
    let seen = "";
    await until("the caller to read output", async () => {
      const r = await reader.read();
      seen += new TextDecoder().decode(r.value ?? new Uint8Array());
      return seen.includes("content_block_delta") || r.done;
    });
    release("b11-1", "cut"); // the provider's connection is cut after output began
    for (;;) {
      const r = await reader.read().catch(() => ({ done: true }));
      if (r.done) break;
    }
    await until("the call's ending recorded", async () => (await listEvents(pool, p.id)).some((e) => e.kind === "hold.kept" || e.kind === "hold.settled"));
    await invariantsHold(p.id); // the bill was more than the usage seen, and the full hold still covers it
    const kept = (await listEvents(pool, p.id, "hold.kept"))[0]!.payload as { reason: string; unreconciled: boolean; seen: { usage: Record<string, number> } };
    expect(kept.reason).toBe("the provider's stream failed part-way");
    expect(kept.unreconciled).toBe(true);
    expect(kept.seen.usage).toMatchObject({ input_tokens: 30, output_tokens: 1 });
    expect(await kinds(p.id)).toEqual(["hold.opened", "hold.kept"]);
    expect((await listHolds(pool, p.id))[0]).toMatchObject({ state: "open", unreconciled: true, actual_usd: null });
    expect(await committed(p.id)).toBe(micro(HOLD_USD));
  });

  it("B11 (2): a call that gets no answer at all (the provider read it and closed the connection) keeps its full hold, open and unreconciled", async () => {
    const g = await inProcessGateway("gw_b11_2");
    const p = await newProject(HOLD_USD * 1.5);
    const r = await callAt(g.url, p.token, body(p.id, "drop", "b11-2"));
    expect(r.status).toBe(502);
    await invariantsHold(p.id);
    const kept = (await listEvents(pool, p.id, "hold.kept"))[0]!.payload as { reason: string; unreconciled: boolean };
    expect(kept.reason).toBe("the connection failed after the request was sent, or may have been sent; the provider may have billed it");
    expect(kept.unreconciled).toBe(true);
    expect((await listHolds(pool, p.id))[0]).toMatchObject({ state: "open", unreconciled: true, actual_usd: null });
    expect(await committed(p.id)).toBe(micro(HOLD_USD));
  });

  /* ------------------------------------------------------------------ B12 */

  it("B12: a successful answer that cannot be read (no usage block; a body that is not JSON) keeps its full hold, open, and the call marked unreconciled", async () => {
    const g = await inProcessGateway("gw_b12");
    for (const mode of ["no-usage", "not-json"]) {
      const p = await newProject(HOLD_USD * 1.5);
      expect((await callAt(g.url, p.token, body(p.id, mode, `b12-${mode}`))).status).toBe(200);
      await invariantsHold(p.id);
      expect(await kinds(p.id)).toEqual(["hold.opened", "hold.kept"]);
      const kept = (await listEvents(pool, p.id, "hold.kept"))[0]!.payload as { reason: string; unreconciled: boolean };
      expect(kept.reason).toBe("the answer succeeded but its usage could not be read");
      expect(kept.unreconciled).toBe(true);
      expect((await listHolds(pool, p.id))[0]).toMatchObject({ state: "open", unreconciled: true, actual_usd: null });
      expect(await committed(p.id)).toBe(micro(HOLD_USD));
    }
  });

  /* ------------------------------------------------------------------ B13 */

  it("B13: the invariant checker flags each kind of breach: above the cap, below what was owed, a settled call above its hold, hold.exceeded, and a hold row changed by hand with no event", async () => {
    const ev = (id: number, kind: string, payload: Record<string, unknown>): TraceEvent => ({ id, kind, payload });
    const opened = (id: number, hold: number, usd: number) => ev(id, "hold.opened", { hold_id: hold, amount_usd: usd });
    const called = (id: number, hold: number, usd: number) => ev(id, "model.call", { hold_id: hold, cost_usd: usd });
    const settled = (id: number, hold: number, held: number, usd: number) => ev(id, "hold.settled", { hold_id: hold, amount_usd: held, actual_usd: usd });
    const rules = (r: { violations: Array<{ rule: string }> }) => [...new Set(r.violations.map((v) => v.rule))];
    // A clean trace: no violation.
    expect(rules(checkTrace([opened(1, 1, 0.01), called(2, 1, 0.006), settled(3, 1, 0.01, 0.006)], [{ pinnedAt: 1, billMicro: 6000 }], micro(0.015)))).toEqual([]);
    // (1) two holds above the cap.
    expect(rules(checkTrace([opened(1, 1, 0.01), opened(2, 2, 0.01)], [], micro(0.015)))).toEqual(["1: above the cap"]);
    // (2) settled below what the provider billed.
    expect(rules(checkTrace([opened(1, 1, 0.01), called(2, 1, 0.001), settled(3, 1, 0.01, 0.001)], [{ pinnedAt: 1, billMicro: 6000 }], micro(1)))).toEqual(["2: below what was owed"]);
    // A settled call above its hold, and the hold.exceeded event that goes with it.
    expect(rules(checkTrace([opened(1, 1, 0.01), called(2, 1, 0.02), settled(3, 1, 0.01, 0.02), ev(4, "hold.exceeded", {})], [], micro(1)))).toEqual(["a settled call above its hold", "hold.exceeded written"]);
    // A cap change with no new cap cannot be read: it is flagged, and rule (1) still applies after it.
    expect(rules(checkTrace([ev(1, "cap.changed", {}), opened(2, 1, 0.01), opened(3, 2, 0.01)], [], micro(0.015)))).toEqual(["an event the replay cannot read", "1: above the cap"]);
    // A billing point where the view showed too little.
    expect(rules(await checkProjectWith([{ spentMicro: 0, openMicro: 0, roomMicro: 0, capMicro: 1, owedMicro: 5 }]))).toEqual(["2: below what was owed"]);
    // A hold row changed by hand, with no event: the replay no longer matches the budget view.
    const { id } = await newProject(5);
    const o = await openHold(pool, { projectId: id, step: null, amountUsd: HOLD_USD, deadline: new Date(Date.now() + 600_000), gateway: "gw_test_b13", arithmetic: {}, path: "/v1/messages" });
    if (!o.ok) throw new Error("not opened");
    expect((await checkProject(pool, id, [], [])).violations).toEqual([]);
    await pool.query("update holds set amount_usd = 0 where id = $1", [o.hold.id]);
    expect(rules(await checkProject(pool, id, [], []))).toEqual(["replay differs from the budget view"]);
  });

  /* ------------------------------------------------------------------ the gateway's own refusals */

  it("1.4: a gateway that loses its liveness connection forwards nothing until it holds its lock again", async () => {
    const g = await inProcessGateway("gw_live", { retryMs: 1_000 });
    const p = await newProject(5);
    expect((await callAt(g.url, p.token, body(p.id))).status).toBe(200);
    const pid = g.liveness.pid();
    await pool.query("select pg_terminate_backend($1)", [pid]);
    await until("the gateway to see its lock lost", () => !g.liveness.ok());
    const before = { messages: stand.messages, counts: stand.counts, events: (await kinds(p.id)).length };
    const r = await callAt(g.url, p.token, body(p.id));
    expect(r.status).toBe(503);
    expect((await errorOf(r)).type).toBe("gateway_unavailable");
    expect({ messages: stand.messages, counts: stand.counts, events: (await kinds(p.id)).length }).toEqual(before);
    await until("the lock taken again", () => g.liveness.ok());
    expect(g.liveness.pid()).not.toBe(pid);
    expect((await callAt(g.url, p.token, body(p.id))).status).toBe(200);
  });

  it("1.4: a call that passed the liveness check, and waits at its counting call, is not forwarded once the gateway has lost its lock: its hold is given back and it gets the 503", async () => {
    const g = await inProcessGateway("gw_live_mid", { retryMs: 120_000 }); // the lock is not taken again during the test
    const p = await newProject(5);
    const b = callAt(g.url, p.token, body(p.id, "ok", "live-mid", { messages: [{ role: "user", content: "park-count:live-mid" }] }));
    await until("the call at its counting call", () => (stand.arrivedByTag.get("count:live-mid") ?? 0) === 1);
    await pool.query("select pg_terminate_backend($1)", [g.liveness.pid()]);
    await until("the gateway to see its lock lost", () => !g.liveness.ok());
    const before = stand.messages;
    release("count:live-mid");
    const r = await b;
    expect(r.status).toBe(503);
    expect((await errorOf(r)).type).toBe("gateway_unavailable");
    expect(stand.messages).toBe(before);
    expect(stand.arrivedByTag.get("live-mid")).toBeUndefined();
    expect(await kinds(p.id)).toEqual(["hold.opened", "hold.settled"]);
    expect((await listEvents(pool, p.id, "hold.settled"))[0]!.payload).toMatchObject({ actual_usd: 0, forwarded: false });
    await invariantsHold(p.id);
  });

  it("1.4: a database that cannot be reached gets a 503 that names the reason, not a bare 500, and the error's text is not passed on", async () => {
    const nowhere = createPool(TEST_DB_URL.replace(/builder_test[a-z0-9_]*/, "no_such_database_pkg14"));
    const faults: Array<{ m: string; d: unknown }> = [];
    try {
      const app = createGateway({ pool: nowhere, modelApiKey: MADE_UP_KEY, upstreamUrl: standUrl, onFault: (m, d) => faults.push({ m, d }) });
      const { url } = await listen(app);
      const before = { messages: stand.messages, counts: stand.counts };
      const r = await callAt(url, "bpt_made_up_token", { model: MODEL, max_tokens: 400, messages: [] });
      expect(r.status).toBe(503);
      const e = await errorOf(r);
      expect(e.type).toBe("gateway_unavailable");
      expect(e.message).not.toMatch(/no_such_database|does not exist/);
      expect({ messages: stand.messages, counts: stand.counts }).toEqual(before);
      expect(faults.map((f) => f.m)).toEqual(["The gateway could not use its database for a request; the request was stopped."]);
      expect(JSON.stringify(faults[0]!.d)).not.toMatch(/no_such_database/);
    } finally {
      await nowhere.end();
    }
  });

  /* ------------------------------------------------------------------ stopped while a request waits before its first forward (review bot on 899cbf0) */

  it("B10 (10): requests that passed the gate while it was open, and waited for their token to be read, forward nothing once it has closed: not a call's counting call, not a counting request passed through; each gets the 503 and nothing is written (review bot on 899cbf0)", async () => {
    const g = await inProcessGateway("gw_b10_10", { journalDir: await newJournalDir() });
    const p = await newProject(HOLD_USD * 3);
    const q = await newProject(5); // another project, never frozen: only the gate can stop its requests
    const a = callAt(g.url, p.token, body(p.id, "park", "b10-10a"));
    await until("call A at the stand-in", () => (stand.arrivedByTag.get("b10-10a") ?? 0) === 1);
    const held = await holdTokenReads();
    try {
      // B (a metered call) and C (a counting request, passed through) pass the gate while it is open, then wait for their token to be read.
      const b = callAt(g.url, q.token, body(q.id, "ok", "b10-10b"));
      const cr = callAt(g.url, q.token, { model: MODEL, messages: [{ role: "user", content: "b10-10c" }] }, "/v1/messages/count_tokens");
      await until("B and C waiting for their token to be read", async () => (await held.waiting()) === 2);
      // A's ending and the freeze are both refused: the gate closes and stays closed.
      await fault.on(p.id, "model.call");
      await fault.on(p.id, "project_freezes");
      release("b10-10a");
      expect((await a).status).toBe(200);
      expect(g.gate.closed()).toBe(true);
      const before = { messages: stand.messages, counts: stand.counts };
      await held.letGo();
      const [rb, rc] = await Promise.all([b, cr]);
      expect({
        metered: await outcome(rb),
        passthrough: await outcome(rc),
        reached_the_stand_in: { messages: stand.messages - before.messages, counts: stand.counts - before.counts },
        written_for_q: await kinds(q.id),
      }).toEqual({
        metered: { status: 503, type: "gateway_unrecorded", nothing_forwarded: true },
        passthrough: { status: 503, type: "gateway_unrecorded", nothing_forwarded: true },
        reached_the_stand_in: { messages: 0, counts: 0 },
        written_for_q: [],
      });
    } finally {
      await held.letGo();
      await fault.off();
    }
    // The database takes writes again: the freeze is written, the gate opens, and the other project's calls go through.
    expect(await g.gate.drain()).toBe(true);
    expect(await kinds(p.id)).toEqual(["hold.opened", "hold.kept", "gateway.fault", "project.frozen"]);
    expect((await callAt(g.url, q.token, body(q.id))).status).toBe(200);
    await invariantsHold(p.id);
    await invariantsHold(q.id);
  }, 60_000);

  it("1.4: requests that passed the liveness check, and waited for their token to be read, forward nothing once the gateway has lost its lock: not a call's counting call, not a counting request passed through; each gets the 503 and nothing is written (review bot on 899cbf0)", async () => {
    const g = await inProcessGateway("gw_live_tok", { retryMs: 120_000 }); // the lock is not taken again during the test
    const p = await newProject(5);
    const held = await holdTokenReads();
    try {
      const b = callAt(g.url, p.token, body(p.id, "ok", "live-tok-b"));
      const cr = callAt(g.url, p.token, { model: MODEL, messages: [{ role: "user", content: "live-tok-c" }] }, "/v1/messages/count_tokens");
      await until("B and C waiting for their token to be read", async () => (await held.waiting()) === 2);
      await pool.query("select pg_terminate_backend($1)", [g.liveness.pid()]);
      await until("the gateway to see its lock lost", () => !g.liveness.ok());
      const before = { messages: stand.messages, counts: stand.counts };
      await held.letGo();
      const [rb, rc] = await Promise.all([b, cr]);
      expect({
        metered: await outcome(rb),
        passthrough: await outcome(rc),
        reached_the_stand_in: { messages: stand.messages - before.messages, counts: stand.counts - before.counts },
        written_for_p: await kinds(p.id),
      }).toEqual({
        metered: { status: 503, type: "gateway_unavailable", nothing_forwarded: true },
        passthrough: { status: 503, type: "gateway_unavailable", nothing_forwarded: true },
        reached_the_stand_in: { messages: 0, counts: 0 },
        written_for_p: [],
      });
    } finally {
      await held.letGo();
    }
  });
});

/**
 * Holds every request that reaches its token read (in the gateway, just after the gate and liveness checks on arrival)
 * until `letGo`: a connection of its own, outside the pool, takes the token table's strongest lock, so the read waits
 * on it. `waiting` counts the sessions waiting on that lock (review bot on 899cbf0).
 */
async function holdTokenReads() {
  const holder = createClient(TEST_DB_URL);
  await holder.connect();
  await holder.query("begin");
  await holder.query("lock table project_tokens in access exclusive mode");
  const pid = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
  let held = true;
  return {
    waiting: () => blockedBehind(pid),
    letGo: async () => {
      if (!held) return;
      held = false;
      await holder.query("rollback");
      await holder.end();
    },
  };
}

/** What a request got back: its status, the error type if any, and whether the answer says nothing was forwarded. */
async function outcome(res: Response) {
  const j = (await res.json()) as { error?: { type?: string; message?: string } };
  return { status: res.status, type: j.error?.type ?? null, nothing_forwarded: j.error?.message?.endsWith("Nothing was forwarded.") ?? false };
}

/** A journal record for a hold, as the gateway writes one (made-up call fields). */
function unrecordedFor(projectId: string, holdId: string): UnrecordedEnding {
  return {
    journal_id: uniqueId("j_test"),
    gateway: "gw_test_store",
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

/** The checker on billing-point samples alone (no events): for B13. */
async function checkProjectWith(samples: Sample[]) {
  const { id } = await newProject(5);
  return checkProject(pool, id, [], samples);
}
