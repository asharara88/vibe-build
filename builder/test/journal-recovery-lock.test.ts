/**
 * Package 1.4b, after the review bot on 88e984b, its second finding (P2): the recovery script holds the journal folder's
 * lock on a database connection of its own. If that connection ended after the lock was taken, the script ignored it and
 * went on writing (set-aside rows, freezes, events, the journal folder's files) through other connections, although the
 * database had released the lock and another process could take it.
 *
 * Here that connection is ended (its session terminated, as a database restart or a dropped connection ends it) at each
 * point of a set-aside, and nothing may be written from then on: no set-aside row, freeze or event, no file changed in the
 * journal folder; the run says it stopped. A test database; the data is made up; nothing is spent.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FaultJournal, fingerprintOf, type JournalLine } from "../src/gateway/journal.js";
import { setAsideLine, type RecoveryWrite, type SetAsideRequest } from "../src/gateway/journal-recovery.js";
import { createClient } from "../src/store/db.js";
import type { UnrecordedEnding } from "../src/store/freezes.js";
import { keepHold, openHold } from "../src/store/holds.js";
import { holdLivenessLock, journalFolderLockKeySql } from "../src/store/liveness.js";
import { createProject } from "../src/store/projects.js";
import { TEST_DB_URL, testPool, uniqueId } from "./helpers.js";

const BUILDER_DIR = fileURLToPath(new URL("..", import.meta.url));
const MODEL = "claude-opus-5-5";
const WHO = { by: "the test (a made-up operator)", reason: "package 1.4b test after the review bot: the line stands for the call on this hold" };

let pool: pg.Pool;
const dirs: string[] = [];

beforeAll(async () => {
  pool = await testPool();
});
afterAll(async () => {
  await pool.end();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(20);
  }
}

async function newDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "pkg14b-lock-"));
  dirs.push(d);
  return d;
}
async function newProject(): Promise<string> {
  const id = uniqueId("j14bl");
  await createProject(pool, { id, name: "journal recovery lock test (made-up data)", capUsd: 5 });
  return id;
}
async function keptHold(projectId: string): Promise<string> {
  const r = await openHold(pool, { projectId, step: null, amountUsd: 0.00996, deadline: new Date(Date.now() + 600_000), gateway: "gw_test14bl_gone", arithmetic: { model: MODEL }, path: "/v1/messages" });
  if (!r.ok) throw new Error("not opened");
  await keepHold(pool, { projectId, holdId: r.hold.id, step: null, reason: "the provider's answer broke off part-way", seen: {} });
  return r.hold.id;
}
function unrecordedFor(projectId: string, holdId: string): UnrecordedEnding {
  return {
    journal_id: uniqueId("j_test14bl"),
    gateway: "gw_test14bl",
    project_id: projectId,
    hold_id: holdId,
    step: null,
    ended_at: new Date().toISOString(),
    ending: "settle",
    kept_reason: null,
    cost_usd_as_read: 0.006142,
    call: { model: MODEL, status: 200 },
    error: { name: "error", code: "P0001" },
  };
}

/** The session holding this journal folder's lock, if any. */
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
/** End the session that holds the folder's lock (the recovery's own connection), and wait until the lock is free. */
async function endLockSession(folderId: string): Promise<void> {
  const pid = await folderLockPid(folderId);
  if (pid === null) throw new Error("no session holds the folder's lock");
  await pool.query("select pg_terminate_backend($1)", [pid]);
  await until("the folder's lock to be free", async () => (await folderLockPid(folderId)) === null);
}

/** Everything a set-aside can write: the folder's files (byte for byte), and the database's rows for the folder and these projects. */
async function state(dir: string, folderId: string, projects: string[]) {
  const files: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort()) files[name] = (await readFile(join(dir, name))).toString("base64");
  const rows = (await pool.query<{ n: number; moved: number }>("select count(*)::int as n, count(moved_at)::int as moved from journal_set_asides where journal_folder_id = $1", [folderId])).rows[0]!;
  const freezes = (await pool.query<{ n: number }>("select count(*)::int as n from project_freezes where project_id = any($1)", [projects])).rows[0]!.n;
  const events = (await pool.query<{ n: number }>("select count(*)::int as n from events where project_id = any($1)", [projects])).rows[0]!.n;
  return { files, rows: rows.n, moved: rows.moved, freezes, events };
}

/** A folder whose journal file holds one line cut short by a crash, standing for a call on a kept hold of a project. */
async function folderWithCutLine() {
  const dir = await newDir();
  const journal = await FaultJournal.open(dir);
  const project = await newProject();
  const hold = await keptHold(project);
  const cut = Buffer.from(`{"journal_id":"j_made_up_lock","gateway":"gw_made_up","project_id":"${project}","hold_id":"${hold}","st`);
  await writeFile(journal.file, Buffer.concat([cut, Buffer.from("\n")]));
  const req: SetAsideRequest = { dir, line: 1, fingerprint: fingerprintOf(cut), hold, by: WHO.by, reason: WHO.reason };
  return { dir, journal, project, hold, cut, req };
}

const outcomeOf = (p: Promise<unknown>) =>
  p.then(
    () => ({ name: "done", code: null as unknown }),
    (e: unknown) => ({ name: (e as { name?: string }).name ?? "Error", code: (e as { code?: unknown }).code ?? null, message: String((e as { message?: unknown }).message ?? "") }),
  );

describe("the review bot on 88e984b, finding 2: a recovery that has lost the journal folder's lock writes nothing more and says it stopped (package 1.4b)", () => {
  it("(l1) the bot's case: the recovery's lock connection ends right after it took the lock, and another process takes the lock: the run writes no set-aside row, freeze or event and changes no file in the folder, and stops with RecoveryStopped", async () => {
    const f = await folderWithCutLine();
    const start = await state(f.dir, f.journal.folderId, [f.project]);
    const lines = FaultJournal.prototype.lines;
    let other: Awaited<ReturnType<typeof holdLivenessLock>> | null = null;
    // Right after the lock is taken, the run reads the journal file: there its lock connection is ended, and another
    // process (a gateway starting on the folder) takes the lock, which it can now.
    const spy = vi.spyOn(FaultJournal.prototype, "lines").mockImplementationOnce(async function (this: FaultJournal): Promise<{ lines: JournalLine[]; sha256: string; size: number }> {
      await endLockSession(f.journal.folderId);
      other = await holdLivenessLock(TEST_DB_URL, uniqueId("gw_14bl_other"), { journalFolderId: f.journal.folderId });
      return lines.call(this);
    });
    try {
      const out = await outcomeOf(setAsideLine(pool, TEST_DB_URL, f.req));
      expect(other).not.toBeNull(); // the other process held the folder's lock meanwhile
      expect(out).toMatchObject({ name: "RecoveryStopped", code: "folder_lock_lost" });
      expect((out as { message: string }).message).toContain("lost the journal folder's lock part-way");
      expect(await state(f.dir, f.journal.folderId, [f.project])).toEqual(start);
    } finally {
      spy.mockRestore();
      await (other as Awaited<ReturnType<typeof holdLivenessLock>> | null)?.stop();
    }
  }, 60_000);

  it("(l2) the script, as a process of its own: its lock connection ends while its set-aside's transaction waits for the project's lock; the transaction then reaches its commit and is rolled back; the script exits with code 4 and a plain message, having written nothing", async () => {
    const f = await folderWithCutLine();
    const start = await state(f.dir, f.journal.folderId, [f.project]);
    // The project's row held in a transaction here, so the script's set-aside waits inside its own transaction.
    const holder = createClient(TEST_DB_URL);
    await holder.connect();
    await holder.query("begin");
    await holder.query("select id from projects where id = $1 for update", [f.project]);
    const holderPid = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
    let holding = true;
    const proc = spawn("npx", ["tsx", "scripts/journal-recover.ts", "--set-aside", "--dir", f.dir, "--line", "1", "--fingerprint", f.req.fingerprint, "--hold", f.hold, "--by", WHO.by, "--reason", WHO.reason], {
      cwd: BUILDER_DIR,
      env: { ...process.env, BUILDER_DATABASE_URL: TEST_DB_URL },
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (err += d.toString()));
    const exited = new Promise<number | null>((r) => proc.on("close", (code) => r(code)));
    try {
      await until("the script to hold the folder's lock and wait for the project's lock", async () => {
        if ((await folderLockPid(f.journal.folderId)) === null) return false;
        return (await pool.query<{ n: number }>("select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))", [holderPid])).rows[0]!.n > 0;
      }, 60_000);
      await endLockSession(f.journal.folderId);
      await holder.query("rollback");
      holding = false;
      const code = await exited;
      expect({ code, stopped: err.includes("Stopped (folder_lock_lost):"), says: err.includes("it wrote nothing to the database and changed nothing in the journal folder") }).toEqual({ code: 4, stopped: true, says: true });
      expect(out).not.toContain("set aside (set-aside");
      expect(out + err).not.toContain("/var/run/postgresql");
      expect(await state(f.dir, f.journal.folderId, [f.project])).toEqual(start);
    } finally {
      if (holding) await holder.query("rollback").catch(() => undefined);
      await holder.end().catch(() => undefined);
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    }
  }, 120_000);

  it("(l3) the lock lost right before each write of a set-aside (a leftover moved in; an earlier set-aside's entry, removal and row; the record, its commit; the entry, the removal, the row): from there on nothing is written, the run stops with RecoveryStopped, and the same set-aside run again finishes it", async () => {
    type Case = { write: RecoveryWrite; setUp: () => Promise<{ dir: string; journal: FaultJournal; projects: string[]; req: SetAsideRequest }> };
    const plain = async () => {
      const f = await folderWithCutLine();
      return { dir: f.dir, journal: f.journal, projects: [f.project], req: f.req };
    };
    const noHold = async () => {
      const s = await plain();
      return { ...s, req: { ...s.req, hold: null } };
    };
    /** A set-aside recorded and then cut short before its entry was written (a made-up disk error), as test (e2) makes one. */
    const cutShort = async () => {
      const s = await plain();
      const spy = vi.spyOn(FaultJournal.prototype, "appendSetAside").mockRejectedValueOnce(Object.assign(new Error("made-up disk error"), { code: "EIO" }));
      try {
        await expect(setAsideLine(pool, TEST_DB_URL, s.req)).rejects.toMatchObject({ code: "EIO" });
      } finally {
        spy.mockRestore();
      }
      return s;
    };
    /** A leftover of a rewrite cut short, holding a record the journal file does not. */
    const withLeftover = async () => {
      const s = await plain();
      const other = await newProject();
      const rec = unrecordedFor(other, await keptHold(other));
      await writeFile(join(s.dir, "unrecorded-endings.jsonl.prev-a0a1a2a3a4a5a6a7"), JSON.stringify(rec) + "\n");
      return { ...s, projects: [...s.projects, other] };
    };
    const cases: Case[] = [
      { write: "absorb leftovers", setUp: withLeftover },
      { write: "earlier: set-aside entry", setUp: cutShort },
      { write: "earlier: journal line removed", setUp: cutShort },
      { write: "earlier: row marked moved", setUp: cutShort },
      { write: "record: row", setUp: noHold },
      { write: "record: transaction", setUp: plain },
      { write: "record: commit", setUp: plain },
      { write: "set-aside entry", setUp: plain },
      { write: "journal line removed", setUp: plain },
      { write: "row marked moved", setUp: plain },
    ];
    // Every case's outcome is gathered, then compared at once: a failure shows every case.
    const got: Record<string, unknown> = {};
    const want: Record<string, unknown> = {};
    for (const c of cases) {
      const s = await c.setUp();
      let atStop: Awaited<ReturnType<typeof state>> | null = null;
      const run = setAsideLine(pool, TEST_DB_URL, s.req, {
        beforeWrite: async (w) => {
          if (w !== c.write || atStop) return;
          atStop = await state(s.dir, s.journal.folderId, s.projects);
          await endLockSession(s.journal.folderId);
        },
      });
      const out = await outcomeOf(run);
      const after = await state(s.dir, s.journal.folderId, s.projects);
      // Run again with the lock: it finishes; the line is out of the journal file, and its row is marked moved.
      const again = await outcomeOf(setAsideLine(pool, TEST_DB_URL, s.req));
      const done = await state(s.dir, s.journal.folderId, s.projects);
      const left = await readFile(s.journal.file);
      got[c.write] = {
        reached: atStop !== null,
        name: out.name,
        code: out.code,
        unchangedSinceTheStop: JSON.stringify(after) === JSON.stringify(atStop),
        runAgain: { name: again.name, rows: done.rows, moved: done.moved, lineGone: !left.includes(Buffer.from('"j_made_up_lock"')) },
      };
      want[c.write] = { reached: true, name: "RecoveryStopped", code: "folder_lock_lost", unchangedSinceTheStop: true, runAgain: { name: "done", rows: 1, moved: 1, lineGone: true } };
    }
    expect(got).toEqual(want);
  }, 180_000);
});
