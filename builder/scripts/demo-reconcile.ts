/**
 * Demonstration of package 1.5, the unreconciled list and the owner's recorded reconciliation (design note 5.5;
 * proof row B14), against a stand-in provider: no real key, no real provider, nothing spent. Every name, figure
 * and usage record is made up.
 *
 *   1. Seven holds kept at their full amount, one of each kind: an error answer, an interrupted call and an
 *      unreadable answer, made through the gateway; an expired hold, a hold whose gateway was found gone and a
 *      late answer written down, made through the store; and a call whose ending could not be recorded, made
 *      through the gateway with a test-only trigger refusing its write (created for this run, dropped right
 *      after), which freezes its project as in proof row B10.
 *   2. The list, printed by scripts/reconcile.ts --list.
 *   3. One reconciliation, recorded by scripts/reconcile.ts with its evidence (a made-up usage record).
 *   4. The frozen project runs again: its next call is forwarded and settled.
 *   5. The same reconciliation again: refused, nothing written.
 *
 * Run, from builder/: npx tsx scripts/demo-reconcile.ts
 * (the database named by BUILDER_TEST_DATABASE_URL, or the local builder_test; it prints the database's name,
 * never its address). Role names only.
 */
import { serve, type ServerType } from "@hono/node-server";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGateway } from "../src/gateway/app.js";
import { DEFAULT_PROFILES } from "../src/gateway/hold.js";
import { FaultGate, FaultJournal } from "../src/gateway/journal.js";
import { createPool } from "../src/store/db.js";
import { listEvents } from "../src/store/events.js";
import { expireHolds, getBudget, listHolds, openHold, recoverHolds, settleHold } from "../src/store/holds.js";
import { holdLivenessLock } from "../src/store/liveness.js";
import { migrate } from "../src/store/migrate.js";
import { createProject, issueProjectToken } from "../src/store/projects.js";

const BUILDER_DIR = fileURLToPath(new URL("..", import.meta.url));
const DB_URL = process.env.BUILDER_TEST_DATABASE_URL ?? "postgres:///builder_test?host=/var/run/postgresql";
const MODEL = "claude-opus-5-5";
/** The stand-in bills every call it answers: 30 input, 4 cache-write, 8 cache-read and 300 output tokens on Claude Opus 5.5, $0.006142. */
const USAGE = { input_tokens: 30, cache_creation_input_tokens: 4, cache_read_input_tokens: 8, output_tokens: 300 };
const log = (s = "") => console.log(s);
const usd = (n: number) => `$${n.toFixed(6)}`;

// The stand-in provider. Its mode is named in the request's metadata.
let forwarded = 0;
const standServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  let text = "";
  req.setEncoding("utf8");
  req.on("data", (d: string) => (text += d));
  req.on("end", () => {
    if (req.url === "/v1/messages/count_tokens") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ input_tokens: 42 }));
    forwarded++;
    const body = JSON.parse(text) as { model: string; metadata?: { test?: string } };
    const json = (status: number, o: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(o));
    const message = (withUsage: boolean) => ({ id: "msg_demo", type: "message", model: body.model, content: [{ type: "text", text: "hello" }], ...(withUsage ? { usage: USAGE } : {}) });
    const mode = body.metadata?.test ?? "ok";
    if (mode === "error") return void json(500, { type: "error", error: { type: "api_error", message: "a made-up server error" } });
    if (mode === "drop") return void req.socket.destroy();
    return void json(200, message(mode !== "no-usage"));
  });
});
await new Promise<void>((r) => standServer.listen(0, "127.0.0.1", () => r()));
const standUrl = `http://127.0.0.1:${(standServer.address() as AddressInfo).port}`;

const pool = createPool(DB_URL);
await migrate(pool);
const db = (await pool.query<{ name: string }>("select current_database() as name")).rows[0]!.name;
const run = Date.now().toString(36);
const gatewayId = `gw_demo15_${run}`;
const liveness = await holdLivenessLock(DB_URL, gatewayId);
const journalDir = await mkdtemp(join(tmpdir(), "demo15-journal-"));
const gate = new FaultGate({ pool, journal: await FaultJournal.open(journalDir), onFault: (m) => log(`  [gateway fault] ${m}`) });
const gateway = await new Promise<{ server: ServerType; url: string }>((resolve) => {
  const app = createGateway({ pool, modelApiKey: "demo-key-made-up-held-only-by-the-gateway", upstreamUrl: standUrl, profiles: DEFAULT_PROFILES, gatewayId, gate, liveness, onFault: (m) => log(`  [gateway fault] ${m}`) });
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (i) => resolve({ server, url: `http://127.0.0.1:${i.port}` }));
});

async function project(suffix: string, capUsd: number) {
  const id = `demo15_${run}_${suffix}`;
  await createProject(pool, { id, name: "reconciliation demonstration (made-up data)", capUsd });
  return { id, token: await issueProjectToken(pool, id) };
}
const call = async (p: { id: string; token: string }, mode: string) => {
  const res = await fetch(gateway.url + "/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": p.token, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [], metadata: { test: mode } }),
  });
  const text = await res.text();
  return { status: res.status, text };
};
const storeHold = async (projectId: string, deadline: Date, gw: string) => {
  const r = await openHold(pool, { projectId, step: null, amountUsd: 0.00996, deadline, gateway: gw, arithmetic: { model: MODEL }, path: "/v1/messages" });
  if (!r.ok) throw new Error(`hold not opened: ${r.reason}`);
  return r.hold.id;
};
/** scripts/reconcile.ts as its own process, against the same database. */
function reconcileScript(args: string[]): number | null {
  const r = spawnSync("npx", ["tsx", "scripts/reconcile.ts", ...args], { cwd: BUILDER_DIR, env: { ...process.env, BUILDER_DATABASE_URL: DB_URL }, encoding: "utf8" });
  log(`$ npx tsx scripts/reconcile.ts ${args.map((a) => (/^[\w./:-]+$/.test(a) ? a : JSON.stringify(a))).join(" ")}`);
  for (const l of `${r.stdout}${r.stderr}`.trimEnd().split("\n")) log(`  ${l}`);
  log(`  (exit code ${r.status})`);
  return r.status;
}

let exitCode = 0;
try {
  log(`Database: ${db} (its name only). Stand-in provider; made-up key; nothing is spent.`);
  log("");
  log("== 1. Holds kept at their full amount, one of each kind ==");
  const a = await project("a", 1);
  log(`Project ${a.id}, cap $1:`);
  for (const [mode, what] of [["error", "the stand-in answers with a server error (500)"], ["drop", "the stand-in reads the call and closes the connection with no answer"], ["no-usage", "the stand-in answers 200 with no usage figures"], ["ok", "an ordinary call, answered and settled (not on the list)"]] as const) {
    log(`  through the gateway, ${what}: HTTP ${(await call(a, mode)).status}`);
  }
  const expired = await storeHold(a.id, new Date(Date.now() - 1_000), gatewayId);
  const lateHold = await storeHold(a.id, new Date(Date.now() - 1_000), gatewayId);
  await expireHolds(pool); // the 30-second pass, run once now
  const marked = (await listHolds(pool, a.id)).filter((h) => h.expired).map((h) => h.id);
  log(`  through the store: holds ${expired} and ${lateHold} opened with their deadlines already passed; marked expired now: ${marked.join(" and ")} (by the second hold's admission and by the 30-second pass, run once)`);
  const gone = await storeHold(a.id, new Date(Date.now() + 600_000), `gw_demo15_${run}_killed`);
  const found = await recoverHolds(pool, `gw_demo15_${run}_starting`);
  log(`  through the store: hold ${gone} opened by a gateway that holds no liveness lock (as if killed); a gateway starting finds ${found.ownerGone} hold(s) whose gateway is gone`);
  const late = await settleHold(pool, { projectId: a.id, holdId: lateHold, step: null, actualUsd: 0.004, call: { model: MODEL, status: 200, usage: USAGE } });
  log(`  through the store: an answer for hold ${lateHold} arrives after its deadline, costing $0.004000 as read: settled ${late.settled} (written down, kept open)`);
  const inFlight = await storeHold(a.id, new Date(Date.now() + 600_000), gatewayId);
  log(`  through the store: hold ${inFlight}, a call still in flight on the running gateway (not on the list)`);

  const b = await project("b", 0.03);
  log(`Project ${b.id}, cap $0.03: a test-only trigger refuses its next model.call write (the database cannot record the call's ending):`);
  await pool.query(`
    create table if not exists demo_write_faults_p15 (project_id text not null);
    create or replace function demo_write_fault_p15() returns trigger language plpgsql as $$
    begin
      if new.kind = 'model.call' and exists (select 1 from demo_write_faults_p15 f where f.project_id = new.project_id) then
        raise exception 'demonstration fault: this write is refused';
      end if;
      return new;
    end $$;
    drop trigger if exists demo_write_fault_p15_events on events;
    create trigger demo_write_fault_p15_events before insert on events for each row execute function demo_write_fault_p15();`);
  await pool.query("insert into demo_write_faults_p15(project_id) values ($1)", [b.id]);
  try {
    log(`  through the gateway, an ordinary call, answered by the stand-in: HTTP ${(await call(b, "ok")).status}`);
  } finally {
    await pool.query("drop trigger if exists demo_write_fault_p15_events on events; drop function if exists demo_write_fault_p15(); drop table if exists demo_write_faults_p15;");
  }
  log("  the test-only trigger dropped");
  const refused = await call(b, "ok");
  log(`  its next call: HTTP ${refused.status}: ${(JSON.parse(refused.text) as { error: { message: string } }).error.message}`);
  log("");

  log("== 2. The list ==");
  reconcileScript(["--list"]);
  log("");

  const bHold = (await listHolds(pool, b.id))[0]!.id;
  log("== 3. One reconciliation, with its evidence (a made-up usage record) ==");
  const args = [
    "--hold", bHold,
    "--actual", "0.006142",
    "--evidence", "Provider usage record (made up for this demonstration): request req_demo_0001, Claude Opus 5.5, 30 input, 4 cache-write, 8 cache-read and 300 output tokens, billed $0.006142",
    "--asked-by", "the owner (demonstration; made up)",
    "--by", "Claude Code",
    "--reason", "package 1.5 demonstration: the usage record gives the call's actual cost",
  ];
  if (reconcileScript(args) !== 0) exitCode = 1;
  log("");

  log("== 4. The frozen project runs again ==");
  const sent = forwarded;
  const again = await call(b, "ok");
  log(`  its next call: HTTP ${again.status}; forwarded to the stand-in: ${forwarded - sent === 1 ? "yes" : "no"}`);
  const budget = await getBudget(pool, b.id);
  log(`  budget: cap $${budget.cap.toFixed(4)}; spent ${usd(budget.spent)} (the reconciled $0.006142 and this call's $0.006142); open holds ${usd(budget.openHolds)}`);
  log("  its event log:");
  for (const e of await listEvents(pool, b.id)) {
    const p = e.payload;
    const bits = ["hold_id", "amount_usd", "cost_usd", "actual_usd", "reason", "evidence", "asked_by", "recorded_by", "freeze_id", "project_still_frozen"].filter((k) => k in p).map((k) => `${k}=${JSON.stringify(p[k])}`);
    log(`    ${e.id} ${e.kind} ${bits.join(" ")}`);
  }
  if (again.status !== 200) exitCode = 1;
  log("");

  log("== 5. The same reconciliation again ==");
  if (reconcileScript(args) !== 2) exitCode = 1;
} finally {
  gateway.server.close();
  standServer.closeAllConnections();
  standServer.close();
  await liveness.stop();
  await pool.end();
  await rm(journalDir, { recursive: true, force: true });
}
process.exit(exitCode);
