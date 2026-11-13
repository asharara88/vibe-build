/**
 * Package 1.4b, after the review bot on 88e984b, its first finding (P1): a rewrite of the journal file stopped right after
 * its rename, as a crash leaves it, lost a call's ending that another process had appended, whole and forced to disk, to
 * the old file after the rewrite read it. The append had returned; the line was in the old file only, which no name
 * reached any more.
 *
 * Here a rewrite (the gateway's move to the done file, or the recovery script's removal of a set-aside line) is stopped
 * at each of its steps, as a crash would stop it: the operation at that step never returns, and nothing after it runs.
 * The append lands, by a hook, right after the rewrite read the file. Then a gateway starts: main.ts as a process of its
 * own for the bot's own case, and the gateway's start-up (FaultJournal.open, FaultGate.replay, as main.ts calls them) in
 * this process for each step. Its project must be frozen, naming that record.
 *
 * The file system's functions are wrapped here (vi.mock) so each step is reached in the same order every time; with no
 * hook set each does what the real one does. A test database; a stand-in provider written here; the data and the key are
 * made up; nothing is spent.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FaultGate, FaultJournal, fingerprintOf } from "../src/gateway/journal.js";
import { listJournal, setAsideLine } from "../src/gateway/journal-recovery.js";
import { activeFreeze, listFreezes, type UnrecordedEnding } from "../src/store/freezes.js";
import { keepHold, openHold } from "../src/store/holds.js";
import { gatewayLockKeySql, journalFolderLockKeySql } from "../src/store/liveness.js";
import { createProject, issueProjectToken } from "../src/store/projects.js";
import { TEST_DB_URL, testPool, uniqueId } from "./helpers.js";

/** A hook on every wrapped file operation, before and after it; what it returns is waited for. */
const fsHooks = vi.hoisted(() => ({ at: null as null | ((op: string, path: string, phase: "before" | "after", flags: unknown) => Promise<void> | void) }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const around = async <T,>(op: string, path: string, flags: unknown, run: () => Promise<T>): Promise<T> => {
    await fsHooks.at?.(op, path, "before", flags);
    const out = await run();
    await fsHooks.at?.(op, path, "after", flags);
    return out;
  };
  const HOOKED = new Set(["readFile", "writeFile", "sync", "stat"]);
  const wrap = (fh: import("node:fs/promises").FileHandle, path: string, flags: unknown) =>
    new Proxy(fh, {
      get(target, prop) {
        const v: unknown = Reflect.get(target, prop, target);
        if (typeof prop === "string" && HOOKED.has(prop) && typeof v === "function") {
          return (...args: unknown[]) => around(`handle.${prop}`, path, flags, () => (v as (...a: unknown[]) => Promise<unknown>).apply(target, args));
        }
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  return {
    ...real,
    open: (path: string, flags?: string | number, mode?: number) => around("open", String(path), flags, async () => wrap(await real.open(path, flags, mode), String(path), flags)),
    rename: (from: string, to: string) => around("rename", String(to), undefined, () => real.rename(from, to)),
    link: (from: string, to: string) => around("link", String(to), undefined, () => real.link(from, to)),
    unlink: (path: string) => around("unlink", String(path), undefined, () => real.unlink(path)),
  };
});

const MADE_UP_KEY = "made-up-key-for-package-1-4b-crash-tests";
const BUILDER_DIR = fileURLToPath(new URL("..", import.meta.url));
const MODEL = "claude-opus-5-5";
const USAGE = { input_tokens: 30, cache_creation_input_tokens: 4, cache_read_input_tokens: 8, output_tokens: 300 };
const HOLD_USD = 0.00996;
const PENDING = "unrecorded-endings.jsonl";
const WHO = { by: "the test (a made-up operator)", reason: "package 1.4b test after the review bot: the line stands for the call on this hold" };
const isLeftover = (name: string) => /^unrecorded-endings\.jsonl\.prev-/.test(name);

let pool: pg.Pool;
let standServer: Server;
let standUrl: string;
const stand = { messages: 0, counts: 0 };
const children: ChildProcess[] = [];
const dirs: string[] = [];

/* ------------------------------------------------------------------ helpers */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(20);
  }
}
/** A promise that never settles: the operation that waits for it never returns, as in a process that was killed. */
const never = () => new Promise<void>(() => undefined);

async function newDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "pkg14b-crash-"));
  dirs.push(d);
  return d;
}
async function newProject() {
  const id = uniqueId("j14bc");
  await createProject(pool, { id, name: "journal crash test (made-up data)", capUsd: 5 });
  return { id, token: await issueProjectToken(pool, id) };
}
async function storeHold(projectId: string): Promise<string> {
  const r = await openHold(pool, { projectId, step: null, amountUsd: HOLD_USD, deadline: new Date(Date.now() + 600_000), gateway: "gw_test14bc_gone", arithmetic: { model: MODEL }, path: "/v1/messages" });
  if (!r.ok) throw new Error("not opened");
  return r.hold.id;
}
async function keptHold(projectId: string): Promise<string> {
  const h = await storeHold(projectId);
  await keepHold(pool, { projectId, holdId: h, step: null, reason: "the provider's answer broke off part-way", seen: {} });
  return h;
}
function unrecordedFor(projectId: string, holdId: string): UnrecordedEnding {
  return {
    journal_id: uniqueId("j_test14bc"),
    gateway: "gw_test14bc_lost_its_lock",
    project_id: projectId,
    hold_id: holdId,
    step: null,
    ended_at: new Date().toISOString(),
    ending: "settle",
    kept_reason: null,
    cost_usd_as_read: 0.006142,
    call: { model: MODEL, status: 200, usage: USAGE },
    error: { name: "error", code: "P0001" },
  };
}
const line = (rec: unknown) => JSON.stringify(rec) + "\n";

/** The session holding this journal folder's lock (a run of the recovery), if any. */
async function folderLockPid(folderId: string): Promise<number | null> {
  const r = await pool.query<{ pid: number }>(
    `select l.pid from pg_locks l
      where l.locktype = 'advisory' and l.granted and l.objsubid = 1
        and l.database = (select oid from pg_database where datname = current_database())
        and ((l.classid::bigint << 32) | l.objid::bigint) = ${journalFolderLockKeySql("$1")}`,
    [folderId],
  );
  return r.rows[0]?.pid ?? null;
}
/** A killed process's database session ends with it: here, the recovery's lock session is ended, and its lock is then free. */
async function endLockSession(folderId: string): Promise<void> {
  const pid = await folderLockPid(folderId);
  if (pid !== null) await pool.query("select pg_terminate_backend($1)", [pid]);
  await until("the folder's lock to be free", async () => (await folderLockPid(folderId)) === null);
}

/* ------------------------------------------------------------------ the steps of a rewrite, and where it is stopped */

type Step = { name: string; at: (op: string, path: string, phase: "before" | "after", flags: unknown, s: { renamed: boolean; journal: string }) => boolean };
/** Each step of a rewrite (gateway/journal.ts, `rewriteWithout`), named by the file operation it is stopped at. */
const STEPS: Step[] = [
  { name: "1. after the lines are chosen (and copied to the done file or the set-aside file), before the old file gets its second name", at: (op, path, phase) => op === "link" && phase === "before" && isLeftover(basename(path)) },
  { name: "2. after the second name is made, before the folder is forced to disk", at: (op, path, phase) => op === "link" && phase === "after" && isLeftover(basename(path)) },
  { name: "3. after the folder is forced to disk, before the new file is written", at: (op, path, phase, flags) => op === "open" && phase === "before" && path.endsWith(".tmp") && flags === "w" },
  { name: "4. after the new file is written and forced to disk, before the rename", at: (op, path, phase, _f, s) => op === "rename" && phase === "before" && path === s.journal },
  { name: "5. right after the rename, before the folder is forced to disk (the review bot's case)", at: (op, path, phase, _f, s) => op === "rename" && phase === "after" && path === s.journal },
  { name: "6. after the folder is forced to disk, before the carry-over reads the old file", at: (op, path, phase, flags, s) => s.renamed && op === "handle.stat" && phase === "before" && path === s.journal && flags === "r" },
  { name: "7. after the carry-over is forced to disk, before the second name is removed", at: (op, path, phase) => op === "unlink" && phase === "before" && isLeftover(basename(path)) },
  { name: "8. after the second name is removed, before the folder is forced to disk", at: (op, path, phase) => op === "unlink" && phase === "after" && isLeftover(basename(path)) },
];

/**
 * Set the hooks for one rewrite of `journalFile`: right after it reads the file, `appendNow` runs (another process's append,
 * whole and forced to disk); at `step`, the rewrite stops for good. Returns what was reached.
 */
function stopRewriteAt(journalFile: string, step: Step | null, appendNow: () => Promise<void>) {
  const s = { renamed: false, journal: journalFile, appending: false, appended: false, stopped: false };
  let reachedStop!: () => void;
  const stoppedThere = new Promise<void>((r) => (reachedStop = r));
  fsHooks.at = async (op, path, phase, flags) => {
    if (s.stopped || s.appending) return;
    if (op === "handle.readFile" && phase === "after" && path === journalFile && flags === "r" && !s.appended) {
      s.appending = true;
      await appendNow(); // returns once the line is whole and forced to disk
      s.appending = false;
      s.appended = true;
      return;
    }
    if (!s.appended) return;
    if (op === "rename" && phase === "after" && path === journalFile) s.renamed = true;
    if (step && step.at(op, path, phase, flags, s)) {
      s.stopped = true;
      reachedStop();
      await never();
    }
  };
  return { s, stoppedThere };
}

/** The folder after a stop: the journal file, the leftovers, and what the gateway's start-up then finds. */
async function leftoversIn(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter(isLeftover);
}

/** The gateway's start-up in this process, as main.ts runs it: open the journal, replay it. */
async function startUp(dir: string, faults: string[] = []) {
  const journal = await FaultJournal.open(dir);
  const gate = new FaultGate({ pool, journal, onFault: (m) => faults.push(m) });
  const replay = await gate.replay();
  return { journal, gate, replay };
}

/* ------------------------------------------------------------------ main.ts as a process, and a stand-in provider */

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.setEncoding("utf8");
    req.on("data", (d: string) => (s += d));
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}
async function standIn(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const text = await readBody(req);
  if (req.url === "/v1/messages/count_tokens") {
    stand.counts++;
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ input_tokens: 42 }));
    return;
  }
  if (req.url !== "/v1/messages") return void res.writeHead(404).end();
  stand.messages++;
  const b = JSON.parse(text) as { model: string };
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "msg_test", type: "message", model: b.model, content: [{ type: "text", text: "hello" }], usage: USAGE }));
}

const LISTENING = /^gateway (gw_[0-9a-f]+) listening on ([\d.]+):(\d+)$/;
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
  const exited = new Promise<number | null>((r) => proc.on("close", (code) => r(code)));
  await until("the gateway process to listen", () => out.some((l) => LISTENING.test(l)) || proc.exitCode !== null, 30_000);
  const found = out.find((l) => LISTENING.test(l));
  if (!found) throw new Error(`the gateway process did not start: ${out.join(" | ")} ${err}`);
  const m = LISTENING.exec(found)!;
  return { proc, out, err: () => err, exited, url: `http://${m[2]}:${m[3]}`, id: m[1]! };
}
async function kill9(g: Awaited<ReturnType<typeof startMain>>): Promise<void> {
  if (g.proc.exitCode === null && g.proc.signalCode === null) g.proc.kill("SIGKILL");
  await g.exited;
  await until("the killed gateway's lock to be free", async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      return (await c.query<{ free: boolean }>(`select pg_try_advisory_xact_lock(${gatewayLockKeySql("$1")}) as free`, [g.id])).rows[0]!.free;
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
}
/** The recovery script as a process of its own, against the test database. */
function recover(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["tsx", "scripts/journal-recover.ts", ...args], { cwd: BUILDER_DIR, env: { ...process.env, BUILDER_DATABASE_URL: TEST_DB_URL } });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (err += d.toString()));
    proc.on("close", (code) => resolve({ code, out, err }));
  });
}
const callAt = (base: string, token: string, project: string) =>
  fetch(base + "/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": token, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [], metadata: { project } }),
  });

beforeAll(async () => {
  pool = await testPool();
  standServer = createServer((req, res) => {
    standIn(req, res).catch(() => res.destroy());
  });
  await new Promise<void>((r) => standServer.listen(0, "127.0.0.1", () => r()));
  standUrl = `http://127.0.0.1:${(standServer.address() as AddressInfo).port}`;
});
afterEach(() => {
  fsHooks.at = null;
});
afterAll(async () => {
  fsHooks.at = null;
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  standServer.closeAllConnections();
  standServer.close();
  await pool.end();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ the tests */

describe("the review bot on 88e984b, finding 1: no call's ending appended to the journal is lost by a rewrite stopped part-way (package 1.4b)", () => {
  it("(k1) the bot's case: a gateway that lost its lock appends a call's ending after the recovery script's rewrite read the journal; the script is stopped right after its rename; the gateway then started (main.ts as a process) replays the ending and freezes its project", async () => {
    const dir = await newDir();
    const gateway = await FaultJournal.open(dir); // the gateway that lost its folder's lock: it still appends
    const p1 = await newProject(); // the project of the hold the unreadable line is set aside for
    const p2 = await newProject(); // the project of the call whose ending is appended meanwhile
    const k1 = await keptHold(p1.id);
    const b = unrecordedFor(p2.id, await storeHold(p2.id));
    const torn = Buffer.from(`{"journal_id":"j_made_up_k1","gateway":"gw_made_up","project_id":"${p1.id}","hold_id":"${k1}","st`);
    await writeFile(gateway.file, Buffer.concat([torn, Buffer.from("\n")]));
    const folderId = gateway.folderId;
    const { s, stoppedThere } = stopRewriteAt(gateway.file, STEPS[4]!, () => gateway.append(b));
    // The recovery script's set-aside, in this process; it never returns once stopped.
    void setAsideLine(pool, TEST_DB_URL, { dir, line: 1, fingerprint: fingerprintOf(torn), hold: k1, by: WHO.by, reason: WHO.reason }).catch(() => undefined);
    await stoppedThere;
    expect({ appended: s.appended, renamed: s.renamed }).toEqual({ appended: true, renamed: true });
    // The append returned: the record was whole and forced to disk. The script's process is now gone, as a killed one is.
    await endLockSession(folderId);
    fsHooks.at = null;

    const g = await startMain(dir);
    try {
      const sent = { messages: stand.messages, counts: stand.counts };
      const r = await callAt(g.url, p2.token, p2.id);
      const j = (await r.json()) as { error?: { type?: string } };
      const doneFile = await readFile(join(dir, "unrecorded-endings.done.jsonl"), "utf8").catch(() => "");
      expect({
        replayedAtStart: g.out.find((l) => l.startsWith("journal lines replayed at start-up")),
        unreadableAtStart: g.out.find((l) => l.startsWith("journal lines that could not be read at start-up")),
        projectFrozenNaming: (await activeFreeze(pool, p2.id))?.journal_id ?? "not frozen",
        itsNextCall: { status: r.status, type: j.error?.type ?? null },
        reachedTheStandIn: stand.messages - sent.messages + (stand.counts - sent.counts),
        // The set-aside's own project is frozen by its record; the leftover is gone, the record moved to the done file.
        setAsideHoldFrozen: (await activeFreeze(pool, p1.id))?.hold_id ?? "not frozen",
        leftovers: await leftoversIn(dir),
        journalFileBytes: (await readFile(join(dir, PENDING))).length,
        inTheDoneFile: doneFile.includes(b.journal_id),
      }).toEqual({
        replayedAtStart: "journal lines replayed at start-up: 1; all recorded: true",
        unreadableAtStart: "journal lines that could not be read at start-up: 0",
        projectFrozenNaming: b.journal_id,
        itsNextCall: { status: 402, type: "project_frozen" },
        reachedTheStandIn: 0,
        setAsideHoldFrozen: k1,
        leftovers: [],
        journalFileBytes: 0,
        inTheDoneFile: true,
      });
    } finally {
      await kill9(g);
    }
  }, 120_000);

  for (const kind of ["the gateway's move to the done file", "the recovery script's removal of a set-aside line"] as const) {
    it(`(k2) ${kind}, stopped at each step of its rewrite with a call's ending appended after it read the file: the ending is on disk at every step, --list shows it waiting, and the gateway started afterwards freezes its project; nothing set aside comes back, and nothing is left over`, async () => {
      // Every step's outcome is gathered, then compared at once: a failure shows every step.
      const seen: Record<string, unknown> = {};
      const expected: Record<string, unknown> = {};
      for (const step of [...STEPS, null]) {
        const name = step?.name ?? "9. not stopped (the whole rewrite)";
        const dir = await newDir();
        const appender = await FaultJournal.open(dir); // another process that appends (a gateway that lost its lock)
        const rewriter = await FaultJournal.openExisting(dir); // the process that rewrites, holding the lock
        const p1 = await newProject();
        const p2 = await newProject();
        const b = unrecordedFor(p2.id, await storeHold(p2.id));
        let run: () => Promise<unknown>;
        let torn: Buffer | null = null;
        let a: UnrecordedEnding | null = null;
        if (kind === "the gateway's move to the done file") {
          a = unrecordedFor(p1.id, await storeHold(p1.id));
          await writeFile(appender.file, line(a));
          const faults: string[] = [];
          const gate = new FaultGate({ pool, journal: rewriter, onFault: (m) => faults.push(m) });
          run = () => gate.replay(); // records a, then moves its line to the done file
        } else {
          const k1 = await keptHold(p1.id);
          torn = Buffer.from(`{"journal_id":"j_made_up_k2","gateway":"gw_made_up","project_id":"${p1.id}","hold_id":"${k1}","st`);
          await writeFile(appender.file, Buffer.concat([torn, Buffer.from("\n")]));
          const t = torn;
          run = () => setAsideLine(pool, TEST_DB_URL, { dir, line: 1, fingerprint: fingerprintOf(t), hold: k1, by: WHO.by, reason: WHO.reason });
        }
        const { s, stoppedThere } = stopRewriteAt(appender.file, step, () => appender.append(b));
        const running = run();
        if (step) {
          // The run is stopped at the step, or (if the step is never reached) ends.
          await Promise.race([stoppedThere, running.then(() => undefined, () => undefined)]);
          if (torn) await endLockSession(appender.folderId);
        } else {
          await running;
        }
        fsHooks.at = null;
        // On disk now: the ending is in the journal file or in a leftover.
        const onDisk = [await readFile(appender.file, "utf8"), ...(await Promise.all((await leftoversIn(dir)).map((f) => readFile(join(dir, f), "utf8"))))].join("");
        const listed = await listJournal(pool, dir);
        // The gateway starts.
        const faults: string[] = [];
        const up = await startUp(dir, faults);
        const leftAfter = await leftoversIn(dir);
        const outcome = {
          appended: s.appended,
          stoppedThere: step ? s.stopped : "not stopped",
          onDisk: onDisk.includes(b.journal_id),
          listedWaiting: listed.waiting.some((w) => w.journalId === b.journal_id),
          listedUnreadable: listed.unreadable.length,
          frozen: (await activeFreeze(pool, p2.id))?.journal_id === b.journal_id,
          unreadableAtStart: up.replay.unreadable,
          closed: up.gate.closed(),
          leftoversAfterStart: leftAfter.length,
          faults: faults.length,
        };
        // A line set aside comes back only while its removal had not reached the rename: it is then still in the journal file itself.
        const setAsideStillInFile = torn !== null && step !== null && STEPS.indexOf(step) < 4;
        const want: Record<string, unknown> = {
          appended: true,
          stoppedThere: step ? true : "not stopped",
          onDisk: true,
          listedWaiting: true,
          listedUnreadable: setAsideStillInFile ? 1 : 0,
          frozen: true,
          unreadableAtStart: setAsideStillInFile ? 1 : 0,
          closed: setAsideStillInFile,
          leftoversAfterStart: 0,
          faults: setAsideStillInFile ? 1 : 0,
        };
        const got: Record<string, unknown> = { ...outcome };
        if (a) {
          // The record moved: one freeze for it, however often its line was replayed.
          got["freezesOfTheMovedRecord"] = (await listFreezes(pool, p1.id)).map((f) => f.journal_id);
          want["freezesOfTheMovedRecord"] = [a.journal_id];
        }
        if (torn) {
          // The same set-aside run again (when it was stopped) finishes it; the next start is open, and finds nothing left over.
          try {
            if (step) {
              const again = await setAsideLine(pool, TEST_DB_URL, { dir, line: 1, fingerprint: fingerprintOf(torn), hold: (await listFreezes(pool, p1.id))[0]!.hold_id!, by: WHO.by, reason: WHO.reason });
              got["runAgainFinished"] = again.finishedEarlier.length;
              want["runAgainFinished"] = 1;
            }
            const next = await startUp(dir);
            got["nextStart"] = { unreadable: next.replay.unreadable, closed: next.gate.closed(), freezes: (await listFreezes(pool, p1.id)).length, leftovers: (await leftoversIn(dir)).length };
          } catch (e) {
            got["nextStart"] = `failed: ${String((e as { code?: unknown }).code ?? (e as Error).message)}`;
          }
          want["nextStart"] = { unreadable: 0, closed: false, freezes: 1, leftovers: 0 };
        }
        seen[name] = got;
        expected[name] = want;
      }
      expect(seen).toEqual(expected);
    }, 180_000);
  }

  it("(k3) fails closed: while the database's set-asides cannot be read, every unreadable line of a leftover counts and the leftover is kept; once they can be read, a leftover's unreadable line never set aside is moved into the journal file, keeps the gateway closed, and is set aside as any other", async () => {
    const dir = await newDir();
    const journal = await FaultJournal.open(dir);
    const p1 = await newProject();
    const k1 = await keptHold(p1.id);
    const p2 = await newProject();
    const b = unrecordedFor(p2.id, await storeHold(p2.id));
    // A leftover as a rewrite cut short leaves it: the old file, holding a record and then a line cut short by a crash during an append.
    const cut = Buffer.from(`{"journal_id":"j_made_up_k3","gateway":"gw_made_up","project_id":"${p1.id}","hold_id":"${k1}","en`);
    const leftover = "unrecorded-endings.jsonl.prev-00112233aabbccdd";
    await writeFile(join(dir, leftover), Buffer.concat([Buffer.from(line(b)), cut]));
    await writeFile(journal.file, "");
    // The set-asides cannot be read (a made-up refusal of that one query).
    const failing = {
      query: (q: unknown, v?: unknown[]) =>
        String(typeof q === "string" ? q : (q as { text?: string }).text).includes("journal_set_asides") ? Promise.reject(Object.assign(new Error("made-up refusal"), { code: "57P01" })) : pool.query(q as string, v),
      connect: () => pool.connect(),
    } as unknown as pg.Pool;
    const faults: string[] = [];
    const blind = new FaultGate({ pool: failing, journal: await FaultJournal.open(dir), onFault: (m) => faults.push(m) });
    expect(await blind.replay()).toEqual({ loaded: 1, unreadable: 1, recorded: true });
    expect(blind.closed()).toBe(true);
    expect(blind.unreadableLines().map((u) => ({ number: u.number, leftover: u.leftover, fingerprint: u.fingerprint }))).toEqual([{ number: 2, leftover, fingerprint: fingerprintOf(cut) }]);
    expect(await leftoversIn(dir)).toEqual([leftover]);
    expect(faults.some((m) => m.includes("the lines set aside could not be read from the database"))).toBe(true);
    expect((await activeFreeze(pool, p2.id))?.journal_id).toBe(b.journal_id);
    // A start that can read them: the cut line was never set aside, so it is moved into the journal file and the gateway stays closed.
    const up = await startUp(dir);
    expect({ unreadable: up.replay.unreadable, closed: up.gate.closed(), leftovers: await leftoversIn(dir) }).toEqual({ unreadable: 1, closed: true, leftovers: [] });
    expect((await readFile(journal.file)).equals(cut)).toBe(true); // b moved to the done file; the cut line kept byte for byte
    const listed = await listJournal(pool, dir);
    expect(listed.unreadable.map((u) => ({ number: u.number, leftover: u.leftover ?? null }))).toEqual([{ number: 1, leftover: null }]);
    // Set aside as any other line; then the gateway starts open.
    const done = await setAsideLine(pool, TEST_DB_URL, { dir, line: 1, fingerprint: fingerprintOf(cut), hold: k1, by: WHO.by, reason: WHO.reason });
    expect(done.hold?.id).toBe(k1);
    const after = await startUp(dir);
    expect({ unreadable: after.replay.unreadable, closed: after.gate.closed() }).toEqual({ unreadable: 0, closed: false });
  }, 60_000);

  it("(k4) --list numbers what a leftover alone holds as the line it will be in the journal file, leaving out a line set aside already; the recovery script moves the leftover in first, so a line listed so is set aside at that number; a record only the leftover held is kept for the gateway", async () => {
    const dir = await newDir();
    const journal = await FaultJournal.open(dir);
    const p1 = await newProject();
    const [k1, k2, k3] = [await keptHold(p1.id), await keptHold(p1.id), await keptHold(p1.id)];
    const p2 = await newProject();
    const b = unrecordedFor(p2.id, await storeHold(p2.id));
    const torn = (n: number, hold: string) => Buffer.from(`{"journal_id":"j_made_up_k4_${n}","gateway":"gw_made_up","project_id":"${p1.id}","hold_id":"${hold}","st`);
    const [u1, u2, u3] = [torn(1, k1), torn(2, k2), torn(3, k3)];
    const nl = Buffer.from("\n");
    await writeFile(journal.file, Buffer.concat([u1, nl]));
    await setAsideLine(pool, TEST_DB_URL, { dir, line: 1, fingerprint: fingerprintOf(u1), hold: k1, by: WHO.by, reason: WHO.reason });
    // The journal file holds u2; a leftover holds u1 (set aside already), the record b and u3 (never set aside).
    const leftover = "unrecorded-endings.jsonl.prev-0123456789abcdef";
    await writeFile(journal.file, Buffer.concat([u2, nl]));
    await writeFile(join(dir, leftover), Buffer.concat([u1, nl, Buffer.from(line(b)), u3, nl]));
    const listed = await listJournal(pool, dir);
    expect({
      leftovers: listed.leftovers.map((l) => [l.name, l.lines]),
      waiting: listed.waiting.map((w) => [w.number, w.journalId, w.leftover ?? null]),
      unreadable: listed.unreadable.map((u) => [u.number, u.fingerprint, u.leftover ?? null]),
    }).toEqual({
      leftovers: [[leftover, 3]],
      waiting: [[2, b.journal_id, leftover]],
      unreadable: [
        [1, fingerprintOf(u2), null],
        [3, fingerprintOf(u3), leftover],
      ],
    });
    // The script's --list says the same to the operator.
    const shown = await recover(["--list", "--dir", dir]);
    expect(shown.code).toBe(0);
    expect(shown.out).toContain(`Leftovers of a rewrite cut short (the journal file as it was before a rewrite that stopped part-way): 1`);
    expect(shown.out).toContain(`  ${leftover}: 3 line(s),`);
    expect(shown.out).toContain(`    line 2 (only in ${leftover}): journal line ${b.journal_id}, project ${p2.id}`);
    expect(shown.out).toContain(`    line 3 (only in ${leftover}): ${u3.length} bytes; not JSON`);
    const third = await setAsideLine(pool, TEST_DB_URL, { dir, line: 3, fingerprint: fingerprintOf(u3), hold: k3, by: WHO.by, reason: WHO.reason });
    expect(third.hold?.id).toBe(k3);
    expect(await leftoversIn(dir)).toEqual([]);
    expect(await readFile(journal.file, "utf8")).toBe(u2.toString("utf8") + "\n" + line(b));
    const up = await startUp(dir);
    expect({ loaded: up.replay.loaded, unreadable: up.replay.unreadable, closed: up.gate.closed(), frozen: (await activeFreeze(pool, p2.id))?.journal_id }).toEqual({ loaded: 1, unreadable: 1, closed: true, frozen: b.journal_id });
    await setAsideLine(pool, TEST_DB_URL, { dir, line: 1, fingerprint: fingerprintOf(u2), hold: k2, by: WHO.by, reason: WHO.reason });
    const open = await startUp(dir);
    expect({ unreadable: open.replay.unreadable, closed: open.gate.closed(), journal: (await readFile(journal.file)).length }).toEqual({ unreadable: 0, closed: false, journal: 0 });
  }, 60_000);
});
