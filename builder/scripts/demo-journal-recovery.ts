/**
 * Demonstration of package 1.4b, an unreadable journal line keeping the gateway closed until it is recovered (the
 * third outside review, item 1), against a stand-in provider: no real key, no real provider, nothing spent. Every
 * name, figure and usage record is made up. The gateway is its own start-up file, src/gateway/main.ts, run as a
 * process of its own, as it is deployed.
 *
 *   1. The gateway writes a call's ending of project a to its journal (a demonstration-only trigger, created for
 *      this run and dropped right after, refuses project a's writes, as in proof row B10), and is killed.
 *   2. The journal's last line is cut in the middle, with no line end, as a crash during its append leaves it.
 *   3. The gateway restarted: it forwards nothing, for any project; project b's call is refused with a 503.
 *   4. The recovery, with the gateway stopped: scripts/journal-recover.ts --list, then --set-aside naming the hold.
 *   5. The gateway restarted: project a is refused as frozen; project b's call is forwarded and settled.
 *   6. The owner's reconciliation of that hold (scripts/reconcile.ts, package 1.5) clears the freeze.
 *   7. Project a's next call is forwarded and settled.
 *
 * Run, from builder/: npx tsx scripts/demo-journal-recovery.ts
 * (the database named by BUILDER_TEST_DATABASE_URL, or the local builder_test; it prints the database's name, never
 * its address; the journal folder and the checkout's path are printed as <journal folder> and <checkout>).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintOf } from "../src/gateway/journal.js";
import { createPool } from "../src/store/db.js";
import { listEvents } from "../src/store/events.js";
import { getBudget, listHolds } from "../src/store/holds.js";
import { gatewayLockKeySql } from "../src/store/liveness.js";
import { migrate } from "../src/store/migrate.js";
import { createProject, issueProjectToken } from "../src/store/projects.js";

const BUILDER_DIR = fileURLToPath(new URL("..", import.meta.url));
const CHECKOUT = dirname(BUILDER_DIR.replace(/\/$/, ""));
const DB_URL = process.env.BUILDER_TEST_DATABASE_URL ?? "postgres:///builder_test?host=/var/run/postgresql";
const MODEL = "claude-opus-5-5";
const MADE_UP_KEY = "demo-key-made-up-held-only-by-the-gateway";
/** The stand-in bills every call it answers: 30 input, 4 cache-write, 8 cache-read and 300 output tokens on Claude Opus 5.5, $0.006142. */
const USAGE = { input_tokens: 30, cache_creation_input_tokens: 4, cache_read_input_tokens: 8, output_tokens: 300 };
const journalDir = await mkdtemp(join(tmpdir(), "demo14b-journal-"));
const clean = (s: string) => s.split(journalDir).join("<journal folder>").split(CHECKOUT).join("<checkout>");
const log = (s = "") => console.log(clean(s));
const usd = (n: number) => `$${n.toFixed(6)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The stand-in provider. A call whose metadata says "park" is held until released.
const seen = { messages: 0, counts: 0 };
let releaseParked: (() => void) | null = null;
const parked = new Promise<void>((r) => (releaseParked = r));
let parkArrived = false;
const standServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  let text = "";
  req.setEncoding("utf8");
  req.on("data", (d: string) => (text += d));
  req.on("end", () => {
    if (req.url === "/v1/messages/count_tokens") {
      seen.counts++;
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ input_tokens: 42 }));
    }
    seen.messages++;
    const body = JSON.parse(text) as { model: string; metadata?: { test?: string } };
    const answer = () => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "msg_demo", type: "message", model: body.model, content: [{ type: "text", text: "hello" }], usage: USAGE }));
    if (body.metadata?.test === "park") {
      parkArrived = true;
      void parked.then(answer);
      return;
    }
    answer();
  });
});
await new Promise<void>((r) => standServer.listen(0, "127.0.0.1", () => r()));
const standUrl = `http://127.0.0.1:${(standServer.address() as AddressInfo).port}`;

const pool = createPool(DB_URL);
await migrate(pool);
const db = (await pool.query<{ name: string }>("select current_database() as name")).rows[0]!.name;
const run = Date.now().toString(36);

/** The gateway's start-up file as a process of its own, on this database, against the stand-in. */
type Gateway = { proc: ChildProcess; out: string[]; err: () => string; url: string; id: string; exited: Promise<void> };
async function startGateway(): Promise<Gateway> {
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: process.env["HOME"] ?? "/tmp",
    TMPDIR: process.env["TMPDIR"] ?? "/tmp",
    BUILDER_DATABASE_URL: DB_URL,
    BUILDER_UPSTREAM_URL: standUrl,
    BUILDER_MODEL_API_KEY: MADE_UP_KEY,
    BUILDER_GATEWAY_PORT: "0",
    BUILDER_GATEWAY_JOURNAL_DIR: journalDir,
  };
  if (process.env["PGUSER"]) env["PGUSER"] = process.env["PGUSER"];
  const proc = spawn(process.execPath, ["--import", "tsx", "src/gateway/main.ts"], { cwd: BUILDER_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
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
  for (let i = 0; i < 1500 && !out.some((l) => LISTENING.test(l)) && proc.exitCode === null; i++) await sleep(20);
  const line = out.find((l) => LISTENING.test(l));
  if (!line) throw new Error(`the gateway did not start: ${out.join(" | ")} ${err}`);
  const m = LISTENING.exec(line)!;
  for (const l of out) log(`  | ${l}`);
  return { proc, out, err: () => err, url: `http://${m[2]}:${m[3]}`, id: m[1]!, exited };
}
async function stopGateway(g: Gateway, signal: "SIGKILL" | "SIGTERM"): Promise<void> {
  g.proc.kill(signal);
  await g.exited;
  // Its database session ends with it, and its locks with that session.
  for (let i = 0; i < 500; i++) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      const free = (await c.query<{ free: boolean }>(`select pg_try_advisory_xact_lock(${gatewayLockKeySql("$1")}) as free`, [g.id])).rows[0]!.free;
      if (free) return;
    } finally {
      await c.query("rollback");
      c.release();
    }
    await sleep(20);
  }
  throw new Error("the stopped gateway's lock was not released");
}

async function project(suffix: string, capUsd: number) {
  const id = `demo14b_${run}_${suffix}`;
  await createProject(pool, { id, name: "journal recovery demonstration (made-up data)", capUsd });
  return { id, token: await issueProjectToken(pool, id) };
}
const call = async (g: Gateway, p: { token: string }, mode = "ok", path = "/v1/messages") => {
  const res = await fetch(g.url + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": p.token, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [], metadata: { test: mode } }),
  });
  const text = await res.text();
  let message = "";
  try {
    message = (JSON.parse(text) as { error?: { type?: string; message?: string } }).error?.message ?? "";
  } catch {
    /* not JSON */
  }
  return { status: res.status, message };
};
/** A script of builder/scripts as its own process, against the same database. */
function script(name: string, args: string[]): number | null {
  const r = spawnSync("npx", ["tsx", `scripts/${name}`, ...args], { cwd: BUILDER_DIR, env: { ...process.env, BUILDER_DATABASE_URL: DB_URL }, encoding: "utf8" });
  log(`$ npx tsx scripts/${name} ${args.map((a) => (/^[\w./:<>-]+$/.test(a) ? a : JSON.stringify(a))).join(" ")}`);
  for (const l of `${r.stdout}${r.stderr}`.trimEnd().split("\n")) log(`  ${l}`);
  log(`  (exit code ${r.status})`);
  return r.status;
}
const eventLog = async (id: string) => {
  for (const e of await listEvents(pool, id)) {
    const p = e.payload;
    const bits = ["hold_id", "amount_usd", "cost_usd", "actual_usd", "line_number", "fingerprint", "set_aside_by", "freeze_id", "reason", "evidence"]
      .filter((k) => k in p)
      .map((k) => `${k}=${JSON.stringify(p[k])}`);
    log(`    ${e.id} ${e.kind} ${bits.join(" ")}`);
  }
};

let exitCode = 0;
const gateways: Gateway[] = [];
const expect = (ok: boolean, what: string) => {
  if (!ok) {
    exitCode = 1;
    log(`  NOT AS EXPECTED: ${what}`);
  }
};
try {
  log(`Database: ${db} (its name only). Stand-in provider; made-up key; nothing is spent. Journal folder: a new temporary folder, <journal folder>.`);
  const a = await project("a", 0.03);
  const b = await project("b", 0.03);
  log(`Projects: ${a.id} and ${b.id}, each with a cap of $0.03.`);
  log("");

  log("== 1. A call's ending written to the journal by the gateway, which is then killed ==");
  const g1 = await startGateway();
  gateways.push(g1);
  const parkedCall = call(g1, a, "park");
  for (let i = 0; i < 500 && !parkArrived; i++) await sleep(20);
  await pool.query(`
    create table if not exists demo_write_faults_p14b (project_id text not null);
    create or replace function demo_write_fault_p14b() returns trigger language plpgsql as $$
    begin
      if exists (select 1 from demo_write_faults_p14b f where f.project_id = new.project_id) then
        raise exception 'demonstration fault: this write is refused';
      end if;
      return new;
    end $$;
    drop trigger if exists demo_write_fault_p14b_events on events;
    create trigger demo_write_fault_p14b_events before insert on events for each row execute function demo_write_fault_p14b();
    drop trigger if exists demo_write_fault_p14b_freezes on project_freezes;
    create trigger demo_write_fault_p14b_freezes before insert on project_freezes for each row execute function demo_write_fault_p14b();`);
  await pool.query("insert into demo_write_faults_p14b(project_id) values ($1)", [a.id]);
  try {
    releaseParked!();
    log(`  project a's call, held at the stand-in while a demonstration-only trigger began refusing project a's writes, answered: HTTP ${(await parkedCall).status}`);
    const whole = await readFile(join(journalDir, "unrecorded-endings.jsonl"));
    log(`  the gateway could not write the call's ending to the event log, so it wrote it to its journal: 1 line, ${whole.length} bytes, ending with a line end: ${whole.at(-1) === 0x0a}`);
    await stopGateway(g1, "SIGKILL");
    log("  the gateway killed (SIGKILL)");
  } finally {
    await pool.query("drop trigger if exists demo_write_fault_p14b_events on events; drop trigger if exists demo_write_fault_p14b_freezes on project_freezes; drop function if exists demo_write_fault_p14b(); drop table if exists demo_write_faults_p14b;");
  }
  log("  the demonstration-only trigger dropped");
  const hold = (await listHolds(pool, a.id))[0]!;
  log(`  project a's hold ${hold.id}: ${hold.state}, ${usd(Number(hold.amount_usd))} held; project a frozen: no (the freeze was never written)`);
  log("");

  log("== 2. The journal's last line cut in the middle, as a crash during its append leaves it ==");
  const whole = await readFile(join(journalDir, "unrecorded-endings.jsonl"));
  const cut = whole.subarray(0, Math.floor(whole.length / 2));
  await writeFile(join(journalDir, "unrecorded-endings.jsonl"), cut);
  log(`  the journal file: ${whole.length} bytes before, ${cut.length} after; its last byte is a line end: ${cut.at(-1) === 0x0a}`);
  log(`  what is left of the line: ${cut.toString("utf8")}`);
  log("");

  log("== 3. The gateway started again: it forwards nothing, for any project ==");
  const g2 = await startGateway();
  gateways.push(g2);
  const before = { ...seen };
  const rb = await call(g2, b);
  log(`  project b's call: HTTP ${rb.status}: ${rb.message}`);
  const rc = await call(g2, b, "ok", "/v1/messages/count_tokens");
  log(`  project b's counting request (passed through): HTTP ${rc.status}`);
  const ra = await call(g2, a);
  log(`  project a's call: HTTP ${ra.status}`);
  log(`  reached the stand-in since the restart: ${seen.messages - before.messages} calls, ${seen.counts - before.counts} counting calls; holds opened for project b: ${(await listHolds(pool, b.id)).length}`);
  expect(rb.status === 503 && rc.status === 503 && ra.status === 503 && seen.messages === before.messages && seen.counts === before.counts, "every request refused with 503, nothing forwarded");
  log(`  project a's hold ${hold.id}, as the restarted gateway left it: kept, unreconciled (its gateway was found gone): ${(await listHolds(pool, a.id))[0]!.unreconciled}`);
  await stopGateway(g2, "SIGTERM");
  log("  the gateway stopped (SIGTERM), for the recovery");
  log("");

  log("== 4. The recovery: the line listed, then set aside naming the hold it stands for ==");
  script("journal-recover.ts", ["--list", "--dir", journalDir]);
  log("");
  const setAside = [
    "--set-aside", "--dir", journalDir, "--line", "1", "--fingerprint", fingerprintOf(cut), "--hold", hold.id,
    "--by", "Claude Code (demonstration)",
    "--reason", "package 1.4b demonstration: the line's readable part names project a and hold " + hold.id + ", the one candidate",
  ];
  expect(script("journal-recover.ts", setAside) === 0, "the set-aside recorded");
  log("");

  log("== 5. The gateway started again ==");
  const g3 = await startGateway();
  gateways.push(g3);
  const before3 = { ...seen };
  const fa = await call(g3, a);
  log(`  project a's call: HTTP ${fa.status}: ${fa.message}`);
  log(`  forwarded to the stand-in for it: ${seen.messages - before3.messages === 0 && seen.counts - before3.counts === 0 ? "nothing, not even its counting call" : "SOMETHING"}`);
  const fb = await call(g3, b);
  log(`  project b's call: HTTP ${fb.status}; forwarded: ${seen.messages - before3.messages === 1 ? "yes" : "no"}`);
  log(`  project b's events: ${(await listEvents(pool, b.id)).map((e) => e.kind).join(", ")}`);
  expect(fa.status === 402 && fb.status === 200, "project a refused as frozen, project b forwarded");
  log("");

  log("== 6. The owner's reconciliation of the named hold (package 1.5) ==");
  expect(
    script("reconcile.ts", [
      "--hold", hold.id,
      "--actual", "0.006142",
      "--evidence", "Provider usage record (made up for this demonstration): request req_demo_14b, Claude Opus 5.5, 30 input, 4 cache-write, 8 cache-read and 300 output tokens, billed $0.006142",
      "--asked-by", "the owner (demonstration; made up)",
      "--by", "Claude Code",
      "--reason", "package 1.4b demonstration: the usage record gives the set-aside call's actual cost",
    ]) === 0,
    "the reconciliation recorded",
  );
  log("");

  log("== 7. Project a runs again ==");
  const sent = seen.messages;
  const again = await call(g3, a);
  log(`  project a's call: HTTP ${again.status}; forwarded to the stand-in: ${seen.messages - sent === 1 ? "yes" : "no"}`);
  const budget = await getBudget(pool, a.id);
  log(`  budget: cap $${budget.cap.toFixed(4)}; spent ${usd(budget.spent)} (the reconciled $0.006142 and this call's $0.006142); open holds ${usd(budget.openHolds)}`);
  log("  project a's event log:");
  await eventLog(a.id);
  expect(again.status === 200, "project a forwarded after the reconciliation");
  await stopGateway(g3, "SIGTERM");
  log("  the gateway stopped");
  log("");
  log(`Files in the journal folder: unrecorded-endings.jsonl ${(await readFile(join(journalDir, "unrecorded-endings.jsonl"))).length} bytes; the set-aside file holds the line (fingerprint ${fingerprintOf(cut)}).`);
} finally {
  for (const g of gateways) if (g.proc.exitCode === null && g.proc.signalCode === null) g.proc.kill("SIGKILL");
  standServer.closeAllConnections();
  standServer.close();
  await pool.end();
  await rm(journalDir, { recursive: true, force: true });
}
log(exitCode === 0 ? "Every step as expected." : "A step was NOT as expected (above).");
process.exit(exitCode);
