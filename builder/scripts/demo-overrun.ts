/**
 * Demonstration of package 1.4c: a bill above its hold freezes the project until the owner records it (the
 * owner's answer to question 17 on 13 Nov 2026, "(a) Yes, freeze"), against a stand-in provider: no real key, no
 * real provider, nothing spent. Every name, figure and usage record is made up.
 *
 *   1. Project a: an ordinary call, settled. Then a call the stand-in says was served in fast mode, which the
 *      request did not ask for and the profile does not allow: billed $0.012284 against its hold of $0.009960.
 *      It is charged in full, and the same database transaction freezes the project naming that hold.
 *   2. Project a's next call: refused, nothing forwarded. Project b's call: forwarded and settled.
 *   3. The list, printed by scripts/reconcile.ts --list.
 *   4. The owner's record of that bill, by scripts/reconcile.ts --overrun with its evidence (a made-up usage record).
 *   5. Project a's next call: forwarded and settled. Its event log.
 *   6. The same record again: refused, nothing written.
 *
 * Run, from builder/: npx tsx scripts/demo-overrun.ts
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
import { activeFreeze } from "../src/store/freezes.js";
import { getBudget, listHolds } from "../src/store/holds.js";
import { holdLivenessLock } from "../src/store/liveness.js";
import { migrate } from "../src/store/migrate.js";
import { createProject, issueProjectToken } from "../src/store/projects.js";

const BUILDER_DIR = fileURLToPath(new URL("..", import.meta.url));
const DB_URL = process.env.BUILDER_TEST_DATABASE_URL ?? "postgres:///builder_test?host=/var/run/postgresql";
const MODEL = "claude-opus-5-5";
/** The stand-in's usage for every call: 30 input, 4 cache-write, 8 cache-read and 300 output tokens on Claude Opus 5.5 ($0.006142; in fast mode, twice that, $0.012284). */
const USAGE = { input_tokens: 30, cache_creation_input_tokens: 4, cache_read_input_tokens: 8, output_tokens: 300 };
const log = (s = "") => console.log(s);
const usd = (n: number) => `$${n.toFixed(6)}`;

// The stand-in provider. Mode "fast" says the call was served in fast mode.
let forwarded = 0;
let counted = 0;
const standServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  let text = "";
  req.setEncoding("utf8");
  req.on("data", (d: string) => (text += d));
  req.on("end", () => {
    if (req.url === "/v1/messages/count_tokens") {
      counted++;
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ input_tokens: 42 }));
    }
    forwarded++;
    const body = JSON.parse(text) as { model: string; metadata?: { test?: string } };
    const usage = body.metadata?.test === "fast" ? { ...USAGE, speed: "fast" } : USAGE;
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "msg_demo", type: "message", model: body.model, content: [{ type: "text", text: "hello" }], usage }));
  });
});
await new Promise<void>((r) => standServer.listen(0, "127.0.0.1", () => r()));
const standUrl = `http://127.0.0.1:${(standServer.address() as AddressInfo).port}`;

const pool = createPool(DB_URL);
await migrate(pool);
const db = (await pool.query<{ name: string }>("select current_database() as name")).rows[0]!.name;
const run = Date.now().toString(36);
const gatewayId = `gw_demo14c_${run}`;
const liveness = await holdLivenessLock(DB_URL, gatewayId);
const journalDir = await mkdtemp(join(tmpdir(), "demo14c-journal-"));
const gate = new FaultGate({ pool, journal: await FaultJournal.open(journalDir), onFault: (m) => log(`  [gateway fault] ${m}`) });
const gateway = await new Promise<{ server: ServerType; url: string }>((resolve) => {
  const app = createGateway({
    pool,
    modelApiKey: "demo-key-made-up-held-only-by-the-gateway",
    upstreamUrl: standUrl,
    profiles: DEFAULT_PROFILES,
    gatewayId,
    gate,
    liveness,
    onFault: (m, d) => log(`  [gateway fault] ${m} ${JSON.stringify(d)}`),
  });
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (i) => resolve({ server, url: `http://127.0.0.1:${i.port}` }));
});

async function project(suffix: string, capUsd: number) {
  const id = `demo14c_${run}_${suffix}`;
  await createProject(pool, { id, name: "overrun freeze demonstration (made-up data)", capUsd });
  return { id, token: await issueProjectToken(pool, id) };
}
const call = async (p: { id: string; token: string }, mode: string) => {
  const res = await fetch(gateway.url + "/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": p.token, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [], metadata: { test: mode } }),
  });
  return { status: res.status, text: await res.text() };
};
/** scripts/reconcile.ts as its own process, against the same database. */
function reconcileScript(args: string[]): number | null {
  const r = spawnSync("npx", ["tsx", "scripts/reconcile.ts", ...args], { cwd: BUILDER_DIR, env: { ...process.env, BUILDER_DATABASE_URL: DB_URL }, encoding: "utf8" });
  log(`$ npx tsx scripts/reconcile.ts ${args.map((a) => (/^[\w./:-]+$/.test(a) ? a : JSON.stringify(a))).join(" ")}`);
  for (const l of `${r.stdout}${r.stderr}`.trimEnd().split("\n")) log(`  ${l}`);
  log(`  (exit code ${r.status})`);
  return r.status;
}
const budgetLine = async (id: string) => {
  const b = await getBudget(pool, id);
  return `cap $${b.cap.toFixed(4)}; spent ${usd(b.spent)}; open holds ${usd(b.openHolds)}`;
};

let exitCode = 0;
const expect = (ok: boolean, what: string) => {
  if (!ok) {
    log(`  NOT AS EXPECTED: ${what}`);
    exitCode = 1;
  }
};
try {
  log(`Database: ${db} (its name only). Stand-in provider; made-up key; nothing is spent.`);
  log("");
  log("== 1. A bill above its hold ==");
  const a = await project("a", 1);
  const b = await project("b", 1);
  log(`Project ${a.id}, cap $1, and project ${b.id}, cap $1.`);
  const first = await call(a, "ok");
  log(`  project a, an ordinary call: HTTP ${first.status}; ${await budgetLine(a.id)}`);
  const over = await call(a, "fast");
  log(`  project a, a call the stand-in says was served in fast mode (not asked for): HTTP ${over.status}`);
  const holds = await listHolds(pool, a.id);
  const h = holds[holds.length - 1]!;
  log(`  its hold ${h.id}: held ${usd(Number(h.amount_usd))}; settled at ${usd(Number(h.actual_usd))}, charged in full; ${await budgetLine(a.id)}`);
  const f = await activeFreeze(pool, a.id);
  log(`  project a frozen: ${f ? `yes, freeze ${f.id}, kind ${f.kind}, naming hold ${f.hold_id}, bill ${usd(Number(f.bill_usd))}` : "NO"}`);
  expect(over.status === 200 && f?.kind === "bill_above_hold" && f.hold_id === h.id, "the bill above its hold froze project a naming its hold");
  const txs = (
    await pool.query<{ kind: string; tx: string }>(
      "select kind, xmin::text as tx from events where project_id = $1 and kind in ('model.call', 'hold.settled', 'hold.exceeded', 'project.frozen') and payload->>'hold_id' = $2 order by id",
      [a.id, String(h.id)],
    )
  ).rows;
  const freezeTx = f ? (await pool.query<{ tx: string }>("select xmin::text as tx from project_freezes where id = $1", [f.id])).rows[0]!.tx : "(none)";
  log(`  written by one database transaction (each row's xmin): ${txs.map((r) => `${r.kind} ${r.tx}`).join("; ")}; the freeze's row ${freezeTx}`);
  expect(txs.length === 4 && new Set([...txs.map((r) => r.tx), freezeTx]).size === 1, "one transaction");
  log("");

  log("== 2. Project a is refused; project b is not ==");
  const sent = { forwarded, counted };
  const refused = await call(a, "ok");
  log(`  project a's next call: HTTP ${refused.status}: ${(JSON.parse(refused.text) as { error: { message: string } }).error.message}`);
  log(`  forwarded to the stand-in for it: ${forwarded - sent.forwarded} calls, ${counted - sent.counted} counting calls`);
  expect(refused.status === 402 && forwarded === sent.forwarded && counted === sent.counted, "nothing forwarded for project a");
  const other = await call(b, "ok");
  log(`  project b's call: HTTP ${other.status}; forwarded: ${forwarded - sent.forwarded === 1 ? "yes" : "no"}; ${await budgetLine(b.id)}`);
  expect(other.status === 200, "project b's call forwarded");
  log("");

  log("== 3. The list ==");
  reconcileScript(["--list", "--project", a.id]);
  log("");

  log("== 4. The owner's record of that bill, with its evidence (a made-up usage record) ==");
  const args = [
    "--overrun",
    "--hold", String(h.id),
    "--evidence", "Provider usage record (made up for this demonstration): request req_demo_14c_0001, Claude Opus 5.5, fast mode, 30 input, 4 cache-write, 8 cache-read and 300 output tokens, billed $0.012284",
    "--asked-by", "the owner (demonstration; made up)",
    "--by", "Claude Code",
    "--reason", "package 1.4c demonstration: the bill above its hold was looked at; fast mode was served though not asked for",
  ];
  expect(reconcileScript(args) === 0, "the record is accepted");
  log("");

  log("== 5. Project a runs again ==");
  const before = forwarded;
  const again = await call(a, "ok");
  log(`  its next call: HTTP ${again.status}; forwarded to the stand-in: ${forwarded - before === 1 ? "yes" : "no"}; ${await budgetLine(a.id)}`);
  expect(again.status === 200 && forwarded === before + 1, "project a's next call forwarded and settled");
  log("  its event log:");
  for (const e of await listEvents(pool, a.id)) {
    const p = e.payload;
    const bits = ["hold_id", "amount_usd", "cost_usd", "actual_usd", "kind", "bill_usd", "above_by_usd", "reason", "freeze_id", "freeze_kind", "evidence", "asked_by", "recorded_by", "project_still_frozen"].filter((k) => k in p).map((k) => `${k}=${JSON.stringify(p[k])}`);
    log(`    ${e.id} ${e.kind} ${bits.join(" ")}`);
  }
  log("");

  log("== 6. The same record again ==");
  expect(reconcileScript(args) === 2, "the second record is refused");
} finally {
  gateway.server.close();
  standServer.closeAllConnections();
  standServer.close();
  await liveness.stop();
  await pool.end();
  await rm(journalDir, { recursive: true, force: true });
}
log("");
log(exitCode === 0 ? "Every step as expected." : "A step was NOT as expected (see above).");
process.exit(exitCode);
