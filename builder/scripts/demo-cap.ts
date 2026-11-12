/**
 * Evidence run for the spending cap by holds (design note 5.5; build plan package 1.2).
 * It walks proof rows B1 to B6 and prints each one from the event log and the holds table.
 * Uses a stand-in model provider: no real key, no real provider, nothing spent.
 * Run: npx tsx scripts/demo-cap.ts   (needs the local builder_test database)
 */
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { createGateway, startHoldKeeper } from "../src/gateway/app.js";
import { DEFAULT_PROFILES } from "../src/gateway/hold.js";
import { createPool } from "../src/store/db.js";
import { listEvents } from "../src/store/events.js";
import { expireHolds, getBudget, listHolds } from "../src/store/holds.js";
import { migrate } from "../src/store/migrate.js";
import { createProject, issueProjectToken } from "../src/store/projects.js";

const log = (s = "") => console.log(s);
const usd = (n: number) => `$${n.toFixed(6)}`;
const listen = (app: Hono) =>
  new Promise<{ server: ServerType; url: string }>((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (i) => resolve({ server, url: `http://127.0.0.1:${i.port}` }));
  });

// The stand-in provider. It counts a prompt as the number given in the request's `system`
// field ("count:<n>"), or fails to count on "count-fail". It bills what it counted.
const REAL_KEY = "demo-real-key-held-only-by-the-gateway";
let forwarded = 0;
const keysSeen: string[] = [];
const countOf = (system: unknown) => {
  const m = /^count:(\d+)$/.exec(typeof system === "string" ? system : "");
  return m ? Number(m[1]) : 1000;
};
const standIn = new Hono();
standIn.post("/v1/messages/count_tokens", async (c) => {
  const body = (await c.req.json()) as { system?: string };
  if (body.system === "count-fail") return c.json({ type: "error", error: { type: "api_error", message: "stand-in: counting is down" } }, 500);
  return c.json({ input_tokens: countOf(body.system) });
});
standIn.post("/v1/messages", async (c) => {
  forwarded++;
  keysSeen.push(c.req.header("x-api-key") ?? "(none)");
  const body = (await c.req.json()) as { model: string; max_tokens: number; system?: string; metadata?: { test?: string } };
  if (body.metadata?.test === "never-answers") await new Promise((r) => setTimeout(r, 5000));
  const usage = { input_tokens: countOf(body.system), output_tokens: Math.floor(body.max_tokens / 2), cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  return c.json({ id: "msg_demo", type: "message", model: body.model, content: [{ type: "text", text: "ok" }], usage });
});

const PROFILES = { ...DEFAULT_PROFILES, fast: { maxTokensCeiling: 16_000, allowFastMode: true } };
const pool = createPool(process.env.BUILDER_TEST_DATABASE_URL ?? "postgres:///builder_test?host=/var/run/postgresql");
await migrate(pool);
const provider = await listen(standIn);
const run = Date.now();
let n = 0;
async function project(capUsd: number, profile = "standard") {
  const id = `demo_${run}_${++n}`;
  await createProject(pool, { id, name: "holds demonstration", capUsd, profile });
  return { id, token: await issueProjectToken(pool, id) };
}
const gatewayApp = (gatewayId: string, extra: Record<string, unknown> = {}) =>
  createGateway({ pool, modelApiKey: REAL_KEY, upstreamUrl: provider.url, profiles: PROFILES, gatewayId, onFault: (m) => log(`  [fault] ${m}`), ...extra });
const main = await listen(gatewayApp("gw_demo_main"));
const send = (url: string, token: string, body: unknown, signal?: AbortSignal) =>
  fetch(url + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": token }, body: JSON.stringify(body), signal });
const opus = (more: Record<string, unknown> = {}) => ({ model: "claude-opus-5-5", max_tokens: 2000, system: "count:10000", messages: [{ role: "user", content: "hello" }], ...more });
async function showBudget(id: string, label: string) {
  const b = await getBudget(pool, id);
  log(`  ${label}: cap ${usd(b.cap)} | spent ${usd(b.spent)} | open holds ${usd(b.openHolds)} (${b.openHoldCount}) | spent + open holds = ${usd(b.spent + b.openHolds)}`);
  return b;
}
async function showEvents(id: string) {
  for (const e of await listEvents(pool, id)) {
    const p = e.payload as Record<string, unknown>;
    if (e.kind === "hold.opened") {
      const a = p["arithmetic"] as Record<string, number | string | boolean | null>;
      log(`  event ${e.kind}: hold #${p["hold_id"]} for ${usd(p["amount_usd"] as number)}`);
      log(`      prompt counted ${a["counted_prompt_tokens"]} tokens + margin ${a["count_margin_tokens"]} = ${a["prompt_tokens_held"]} at $${a["input_rate_usd_per_million"]} per million (${a["input_rate_is"]}) = ${usd(a["input_part_usd"] as number)}`);
      log(`      max_tokens ${a["max_tokens"]} at $${a["output_rate_usd_per_million"]} per million = ${usd(a["output_part_usd"] as number)}; fast-mode factor ${a["fast_mode_factor"]}${a["fast_mode_because"] ? ` (${a["fast_mode_because"]})` : ""}; both parts include the factor`);
    } else if (e.kind === "model.call") {
      const u = p["usage"] as Record<string, number>;
      log(`  event ${e.kind}: status ${p["status"]}, billed ${u["input_tokens"]} input and ${u["output_tokens"]} output tokens, actual cost ${usd(p["cost_usd"] as number)}`);
    } else if (e.kind === "hold.settled") {
      log(`  event ${e.kind}: hold #${p["hold_id"]} of ${usd(p["amount_usd"] as number)} settled at ${usd(p["actual_usd"] as number)}; ${usd(p["returned_usd"] as number)} returned to the budget`);
    } else if (e.kind === "gateway.refused") {
      log(`  event ${e.kind}: reason ${p["reason"]}` + (p["this_hold_usd"] !== undefined ? `; spent ${usd(p["spent_usd"] as number)} + open holds ${usd(p["open_holds_usd"] as number)} + this hold ${usd(p["this_hold_usd"] as number)} > cap ${usd(p["cap_usd"] as number)}` : ""));
    } else if (e.kind === "hold.kept") {
      log(`  event ${e.kind}: hold #${p["hold_id"]} of ${usd(p["amount_usd"] as number)} kept open; reason: ${p["reason"]}`);
    } else if (e.kind === "hold.expired") {
      log(`  event ${e.kind}: hold #${p["hold_id"]} of ${usd(p["amount_usd"] as number)}; kept ${p["kept"]}, unreconciled ${p["unreconciled"]}, still open ${p["still_open"]}`);
    } else if (e.kind === "hold.found_at_startup") {
      log(`  event ${e.kind}: hold #${p["hold_id"]} of ${usd(p["amount_usd"] as number)}, opened by ${p["opened_by"]}, found by ${p["found_by"]}; kept ${p["kept"]}, still open ${p["still_open"]}`);
    } else log(`  event ${e.kind}`);
  }
}

log("Stand-in provider only: no real provider is called and nothing is spent.");
log("Prices used: Claude Opus 5.5 input $4, one-hour cache write $8, output $20 per million tokens; Claude Haiku 5.5 one-hour cache write $0.20 and output $0.50, or $1.00 and $2.50 over 100,000 prompt tokens.");

log("\n== B1. A hold is opened before every forwarded call and settled to the actual cost ==");
{
  const { id, token } = await project(1);
  for (let i = 1; i <= 2; i++) log(`  call ${i}: HTTP ${(await send(main.url, token, opus())).status}`);
  await showEvents(id);
  await showBudget(id, "budget afterwards");
  const settled = await listEvents(pool, id, "hold.settled");
  log(`  actual cost never above the hold: ${settled.every((e) => (e.payload as { actual_usd: number; amount_usd: number }).actual_usd <= (e.payload as { amount_usd: number }).amount_usd) ? "yes" : "NO"}`);
}

log("\n== B2. A call whose hold does not fit is refused at the call ==");
{
  const { id, token } = await project(0.15);
  const first = await send(main.url, token, opus());
  log(`  call 1: HTTP ${first.status}`);
  await showBudget(id, "budget before call 2");
  const before = forwarded;
  const second = await send(main.url, token, opus());
  const body = (await second.json()) as { error: { type: string; message: string } };
  log(`  call 2: HTTP ${second.status} (${body.error.type})`);
  log(`  message shown: "${body.error.message}"`);
  log(`  calls that reached the provider during call 2: ${forwarded - before}`);
  await showEvents(id);
  log(`  holds in the database for this project: ${(await listHolds(pool, id)).length} (one, from call 1; none for the refused call)`);
}

log("\n== B3. A prompt that cannot be counted is refused (amendment b) ==");
{
  const { id, token } = await project(1);
  const before = forwarded;
  const res = await send(main.url, token, opus({ system: "count-fail" }));
  const body = (await res.json()) as { error: { type: string; message: string } };
  log(`  call: HTTP ${res.status} (${body.error.type})`);
  log(`  message shown: "${body.error.message}"`);
  log(`  calls that reached the provider: ${forwarded - before}`);
  await showEvents(id);
  log(`  holds in the database for this project: ${(await listHolds(pool, id)).length}`);
}

log("\n== B4. The hold covers the long-prompt rate and fast mode when either could apply (amendment c) ==");
{
  log("  (1) Claude Haiku 5.5, prompt counted at 99,900 tokens, just under the 100,000 threshold:");
  const a = await project(1);
  log(`  call: HTTP ${(await send(main.url, a.token, { model: "claude-haiku-5-5", max_tokens: 1000, system: "count:99900", messages: [] })).status}`);
  await showEvents(a.id);
  log("  the same model with a prompt counted at 1,000 tokens, for comparison:");
  const b = await project(1);
  await send(main.url, b.token, { model: "claude-haiku-5-5", max_tokens: 1000, system: "count:1000", messages: [] });
  await showEvents(b.id);
  log("  (2) Claude Opus 5.5 on a profile that allows fast mode (the request does not ask for it):");
  const c = await project(1, "fast");
  log(`  call: HTTP ${(await send(main.url, c.token, opus())).status}`);
  await showEvents(c.id);
}

log("\n== B5. A hold past its deadline is kept, not released ==");
{
  const quick = await listen(gatewayApp("gw_demo_quick", { callTimeLimitMs: { plain: 200, stream: 200 }, holdDeadlineMarginMs: { plain: 200, stream: 200 } }));
  const { id, token } = await project(0.2);
  log("  this gateway cuts a call off after 0.2 seconds and gives its hold a deadline 0.2 seconds later; the stand-in does not answer in time");
  log(`  call: HTTP ${(await send(quick.url, token, opus({ metadata: { test: "never-answers" } }))).status}`);
  await showBudget(id, "budget after the cut-off");
  await new Promise((r) => setTimeout(r, 400));
  const expired = (await expireHolds(pool)).filter((h) => h.project_id === id);
  log(`  holds marked expired once the deadline had passed: ${expired.length}`);
  const h = (await listHolds(pool, id))[0]!;
  log(`  the hold's row: state ${h.state}, amount ${usd(Number(h.amount_usd))}, expired ${h.expired}, unreconciled ${h.unreconciled}, actual cost ${h.actual_usd ?? "not known"}`);
  await showEvents(id);
  await showBudget(id, "budget after expiry");
  log(`  a further call, to show the expired hold still counts: HTTP ${(await send(quick.url, token, opus())).status}`);
  quick.server.close();
}

log("\n== B6. Holds are database rows that survive the gateway stopping ==");
{
  const first = await listen(gatewayApp("gw_demo_first"));
  const { id, token } = await project(0.2);
  const controller = new AbortController();
  const inFlight = send(first.url, token, opus({ metadata: { test: "never-answers" } }), controller.signal).catch(() => null);
  while ((await listEvents(pool, id, "hold.opened")).length === 0) await new Promise((r) => setTimeout(r, 20));
  log("  a call is in flight through gateway gw_demo_first; the gateway is now stopped");
  controller.abort();
  await inFlight;
  await new Promise<void>((resolve) => first.server.close(() => resolve()));
  const before = await showBudget(id, "budget with the first gateway stopped");
  const keeper = await startHoldKeeper(pool, "gw_demo_second");
  keeper.stop();
  log("  a second gateway, gw_demo_second, starts on the same database and looks for open holds");
  const h = (await listHolds(pool, id))[0]!;
  log(`  the hold's row: state ${h.state}, amount ${usd(Number(h.amount_usd))}, opened by ${h.gateway}`);
  await showEvents(id);
  const after = await showBudget(id, "budget after the second gateway started");
  log(`  spent + open holds the same before and after: ${before.spent + before.openHolds === after.spent + after.openHolds ? "yes" : "NO"}`);
  const second = await listen(gatewayApp("gw_demo_second"));
  log(`  a call through the second gateway, to show the hold still counts: HTTP ${(await send(second.url, token, opus())).status}`);
  second.server.close();
}

log(`\nEvery call that reached the provider carried the gateway's key, never a project token: ${keysSeen.length > 0 && keysSeen.every((k) => k === REAL_KEY) ? "yes" : "NO"} (${keysSeen.length} calls).`);
main.server.close();
provider.server.close();
await pool.end();
