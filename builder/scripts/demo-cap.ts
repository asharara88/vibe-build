/**
 * Evidence run for the spending cap by holds (design note 5.5; build plan package 1.2).
 * It walks proof rows B1 to B6 and B15 to B19 (design note 7.2) and prints each one from the
 * event log and the holds table. B15 to B19 are the known limits of the hold that package 1.2
 * handles (known gap 41), added to what finishes the package on 13 Nov 2026.
 * A hold is a reservation worked out from the provider's token estimate plus an assumed margin,
 * not a proven ceiling on the bill. Nothing here shows how the real provider counts or bills.
 * Uses a stand-in model provider: no real key, no real provider, nothing spent.
 * Section B6 starts its first gateway as a process of its own (test/b6-gateway-process.ts) and stops it.
 * Run: npx tsx scripts/demo-cap.ts   (the database named by BUILDER_TEST_DATABASE_URL, or the local builder_test)
 */
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
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
// field ("count:<n>"), or fails to count on "count-fail". It bills what it counted, and half of
// max_tokens as output, unless the request's metadata names one of the behaviours below. Its
// usage states the speed, as the provider's reference lists it: "fast" when the request asked for
// fast mode, "standard" otherwise.
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
/** Per project, how many open holds the database had at the moment each call reached the stand-in (row B1). */
const openHoldsAtForward = new Map<string, number[]>();
standIn.post("/v1/messages", async (c) => {
  forwarded++;
  keysSeen.push(c.req.header("x-api-key") ?? "(none)");
  const body = (await c.req.json()) as { model: string; max_tokens: number; system?: string; speed?: string; metadata?: { test?: string; project?: string } };
  const test = body.metadata?.test ?? "";
  if (test === "note-open-holds") {
    const project = String(body.metadata?.project ?? "");
    const r = await pool.query<{ n: number }>("select count(*)::int as n from holds where project_id = $1 and state = 'open'", [project]);
    openHoldsAtForward.set(project, [...(openHoldsAtForward.get(project) ?? []), r.rows[0]!.n]);
  }
  if (test === "never-answers") {
    // No answer comes before the gateway's connection to the stand-in is closed (sections B5 and B6), as the test's stand-in does.
    await new Promise<void>((resolve) => (c.req.raw.signal.aborted ? resolve() : c.req.raw.signal.addEventListener("abort", () => resolve(), { once: true })));
    return c.json({ type: "error", error: { type: "api_error", message: "stand-in: no answer was meant to arrive" } }, 500);
  }
  // Row B16: bill 4% more prompt tokens than were counted, all as one-hour cache writes (the dearest input rate), and all of max_tokens.
  if (test === "bill-above-count") {
    const counted = countOf(body.system);
    const billed = counted + Math.ceil((counted * 4) / 100);
    const usage = { input_tokens: 0, cache_creation_input_tokens: billed, cache_creation: { ephemeral_1h_input_tokens: billed, ephemeral_5m_input_tokens: 0 }, cache_read_input_tokens: 0, output_tokens: body.max_tokens };
    return c.json({ id: "msg_demo", type: "message", model: body.model, content: [{ type: "text", text: "ok" }], usage });
  }
  // Row B19: error answers.
  if (test === "error-400-provider") return c.json({ type: "error", error: { type: "invalid_request_error", message: "stand-in: the request was rejected" } }, 400);
  if (test === "error-500") return c.json({ type: "error", error: { type: "api_error", message: "stand-in: internal error" } }, 500);
  if (test === "error-529") return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "stand-in: overloaded" } }), { status: 529, headers: { "content-type": "application/json" } });
  if (test === "error-400-not-provider") return c.text("<html>400 Bad Request from something in between</html>", 400);
  const usage = { input_tokens: countOf(body.system), output_tokens: Math.floor(body.max_tokens / 2), cache_creation_input_tokens: 0, cache_read_input_tokens: 0, speed: body.speed === "fast" ? "fast" : "standard" };
  return c.json({ id: "msg_demo", type: "message", model: body.model, content: [{ type: "text", text: "ok" }], usage });
});

const PROFILES = { ...DEFAULT_PROFILES, fast: { maxTokensCeiling: 16_000, allowFastMode: true } };
const DATABASE_URL = process.env.BUILDER_TEST_DATABASE_URL ?? "postgres:///builder_test?host=/var/run/postgresql";
/** The builder's own folder, where section B6 starts its first gateway as a process of its own. */
const BUILDER_DIR = fileURLToPath(new URL("..", import.meta.url));
const pool = createPool(DATABASE_URL);
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
      const writes = u["cache_creation_input_tokens"] ? `, ${u["cache_creation_input_tokens"]} cache-write tokens (${u["cache_creation_1h_tokens"]} of them one-hour writes)` : "";
      log(`  event ${e.kind}: status ${p["status"]}, billed ${u["input_tokens"]} input${writes} and ${u["output_tokens"]} output tokens, actual cost ${usd(p["cost_usd"] as number)}${p["rejected_before_work"] ? "; the provider's own answer says it rejected the request before any work" : ""}`);
    } else if (e.kind === "hold.settled") {
      log(`  event ${e.kind}: hold #${p["hold_id"]} of ${usd(p["amount_usd"] as number)} settled at ${usd(p["actual_usd"] as number)}; ${usd(p["returned_usd"] as number)} returned to the budget`);
    } else if (e.kind === "gateway.refused") {
      const detail = Object.entries(p)
        .filter(([k]) => !["reason", "path", "cap_usd", "spent_usd", "open_holds_usd", "this_hold_usd"].includes(k))
        .map(([k, v]) => `${k} ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(", ");
      log(`  event ${e.kind}: reason ${p["reason"]}` + (p["this_hold_usd"] !== undefined ? `; spent ${usd(p["spent_usd"] as number)} + open holds ${usd(p["open_holds_usd"] as number)} + this hold ${usd(p["this_hold_usd"] as number)} > cap ${usd(p["cap_usd"] as number)}` : "") + (detail ? `; ${detail}` : ""));
    } else if (e.kind === "hold.kept") {
      log(`  event ${e.kind}: hold #${p["hold_id"]} of ${usd(p["amount_usd"] as number)} kept open; reason: ${p["reason"]}`);
    } else if (e.kind === "hold.expired") {
      log(`  event ${e.kind}: hold #${p["hold_id"]} of ${usd(p["amount_usd"] as number)}; kept ${p["kept"]}, unreconciled ${p["unreconciled"]}, still open ${p["still_open"]}`);
    } else if (e.kind === "hold.exceeded") {
      log(`  event ${e.kind}: hold #${p["hold_id"]} of ${usd(p["amount_usd"] as number)}; actual cost ${usd(p["actual_usd"] as number)}`);
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
  for (let i = 1; i <= 2; i++) log(`  call ${i}: HTTP ${(await send(main.url, token, opus({ metadata: { test: "note-open-holds", project: id } }))).status}`);
  for (const [i, n] of (openHoldsAtForward.get(id) ?? []).entries()) log(`  when call ${i + 1} reached the stand-in provider, the database held ${n} open hold(s) for this project`);
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

log("\n== B6. Holds are database rows that survive the gateway stopping: the first gateway runs as a process of its own ==");
{
  const { id, token } = await project(0.2);
  // The first gateway: its own process, with tsx loaded into Node (`node --import tsx test/b6-gateway-process.ts`).
  const child = spawn(process.execPath, ["--import", "tsx", "test/b6-gateway-process.ts"], {
    cwd: BUILDER_DIR,
    env: { ...process.env, BUILDER_TEST_DATABASE_URL: DATABASE_URL, B6_UPSTREAM_URL: provider.url, B6_GATEWAY_ID: "gw_demo_first", B6_MODEL_KEY: REAL_KEY },
    stdio: ["ignore", "pipe", "inherit"],
  });
  try {
    const said: Array<Record<string, unknown>> = [];
    let partial = "";
    child.stdout.on("data", (d: Buffer) => {
      partial += d.toString();
      const parts = partial.split("\n");
      partial = parts.pop() ?? "";
      for (const line of parts) if (line.trim()) said.push(JSON.parse(line) as Record<string, unknown>);
    });
    // "close" comes once the process has ended and its output has closed, so every line it printed has been read.
    const exited = new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code)));
    const listening = () => said.find((s) => typeof s["listening"] === "string")?.["listening"] as string | undefined;
    for (let i = 0; i < 500 && !listening(); i++) await new Promise((r) => setTimeout(r, 20));
    const firstUrl = listening();
    if (!firstUrl) throw new Error("the first gateway's process did not start");
    log("  the first gateway, gw_demo_first, runs as a process of its own on the same database");
    const reachedBefore = forwarded;
    const inFlight = send(firstUrl, token, opus({ metadata: { test: "never-answers" } })).then(
      (r) => `answered with HTTP ${r.status}`,
      () => "the connection closed with no answer",
    );
    for (let i = 0; i < 500 && forwarded === reachedBefore; i++) await new Promise((r) => setTimeout(r, 20));
    if (forwarded === reachedBefore) throw new Error("the call through the first gateway did not reach the stand-in");
    log("  a call is in flight through gw_demo_first: its hold is open and the stand-in has the call; the stand-in does not answer it, and waits until the gateway's connection to it closes");
    child.kill("SIGTERM");
    log("  gw_demo_first is told to stop (the signal SIGTERM)");
    for (let i = 0; i < 500 && !said.some((s) => s["stopping"]); i++) await new Promise((r) => setTimeout(r, 20));
    if (!said.some((s) => s["stopping"])) throw new Error("the first gateway's process did not say it was stopping");
    const afterStop = await send(firstUrl, token, opus()).then(
      (r) => `answered with HTTP ${r.status}`,
      (e: unknown) => `refused, the connection was not taken (${String((e as { cause?: { code?: unknown } }).cause?.code)})`,
    );
    log(`  it says it is stopping: ${JSON.stringify(said.find((s) => s["stopping"]))}; a new call sent to it now: ${afterStop}${said.some((s) => s["stopped"]) ? "" : ", before the process said it had stopped"}`);
    const code = await exited;
    log(`  then it says, with each value read as it stops: ${JSON.stringify(said.at(-1))}`);
    log(`  the process exited with code ${code}; the first call's caller: ${await inFlight}`);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  const before = await showBudget(id, "budget with the first gateway's process exited");
  const keeper = await startHoldKeeper(pool, "gw_demo_second");
  keeper.stop();
  log("  a second gateway, gw_demo_second, starts on the same database, in this demonstration's own process, and looks for open holds");
  const h = (await listHolds(pool, id))[0]!;
  log(`  the hold's row: state ${h.state}, amount ${usd(Number(h.amount_usd))}, opened by ${h.gateway}; reason for keeping it: ${h.kept_reason ?? "none written"}; found at a start-up: ${h.seen_at_startup}`);
  await showEvents(id);
  log("  the first gateway's process had exited before the second gateway looked for open holds");
  const after = await showBudget(id, "budget after the second gateway started");
  log(`  spent + open holds the same before and after: ${before.spent + before.openHolds === after.spent + after.openHolds ? "yes" : "NO"}`);
  const second = await listen(gatewayApp("gw_demo_second"));
  log(`  a call through the second gateway, to show the hold still counts: HTTP ${(await send(second.url, token, opus())).status}`);
  second.server.close();
}

/** A request refused before anything is forwarded: what the caller sees, what reached the provider, what the log says. */
async function refused(label: string, body: unknown, profile = "standard") {
  const { id, token } = await project(1, profile);
  const before = forwarded;
  const res = await send(main.url, token, body);
  const b = (await res.json()) as { error: { type: string; message: string } };
  log(`  ${label}: HTTP ${res.status} (${b.error.type})`);
  log(`  message shown: "${b.error.message}"`);
  log(`  calls that reached the provider: ${forwarded - before}`);
  await showEvents(id);
  log(`  holds in the database for this project: ${(await listHolds(pool, id)).length}`);
}

log("\n== The known limits of the hold handled in package 1.2 (known gap 41): proof rows B15 to B19 ==");

log('\n== B15. inference_geo "us" (1.1 times every rate): a request that sets it is refused ==');
await refused('a request with inference_geo "us"', opus({ inference_geo: "us" }));
{
  const { id, token } = await project(1);
  log(`  the same request without inference_geo (the default routing): HTTP ${(await send(main.url, token, opus())).status}`);
  log(`  holds opened for that project: ${(await listHolds(pool, id)).length}`);
}

log("\n== B16. The token count being an estimate: a margin is added to the counted prompt ==");
{
  const { id, token } = await project(1);
  log("  the stand-in counts the prompt as 10,000 tokens, then bills 4% more (10,400), all as one-hour cache writes, and all 2,000 tokens of max_tokens");
  log(`  call: HTTP ${(await send(main.url, token, opus({ metadata: { test: "bill-above-count" } }))).status}`);
  await showEvents(id);
  const opened = (await listEvents(pool, id, "hold.opened"))[0]!.payload as { amount_usd: number; arithmetic: { counted_prompt_tokens: number; max_tokens: number; input_rate_usd_per_million: number; output_rate_usd_per_million: number } };
  const a = opened.arithmetic;
  const withoutMargin = (a.counted_prompt_tokens * a.input_rate_usd_per_million + a.max_tokens * a.output_rate_usd_per_million) / 1e6;
  const cost = ((await listEvents(pool, id, "model.call"))[0]!.payload as { cost_usd: number }).cost_usd;
  log(`  arithmetic only: without the margin the hold would have been ${usd(withoutMargin)} (${a.counted_prompt_tokens} x $${a.input_rate_usd_per_million} + ${a.max_tokens} x $${a.output_rate_usd_per_million} per million), ${cost > withoutMargin ? "below" : "not below"} this bill of ${usd(cost)}; with it, ${usd(opened.amount_usd)}`);
  log(`  hold.exceeded events for this project: ${(await listEvents(pool, id, "hold.exceeded")).length}`);
  log("  this shows that a margin is applied and covers this stand-in's 4%; whether it is large enough for the real provider is not shown (package 2.3)");
}

log("\n== B17. Server-side tools billed on top of tokens: a request that includes one is refused ==");
await refused("a request with a web search tool, which the provider runs itself", opus({ tools: [{ type: "web_search_20260209", name: "web_search" }] }));
await refused("a request that asks the provider to connect to tool servers", opus({ mcp_servers: [{ type: "url", url: "https://example.invalid", name: "x" }] }));
{
  const { token } = await project(1);
  log(`  a request with only the caller's own tools (which the caller runs): HTTP ${(await send(main.url, token, opus({ tools: [{ name: "read_file", input_schema: { type: "object" } }, { type: "bash_20250124", name: "bash" }] }))).status}`);
}

log("\n== B18. Fast mode on a model whose price is assumed: a request for it is refused ==");
await refused("Claude Sonnet 5.5 asked for fast mode, on a profile that allows fast mode (no fast-mode price is listed for it)", { model: "claude-sonnet-5-5", max_tokens: 2000, system: "count:10000", messages: [], speed: "fast" }, "fast");
{
  const { id, token } = await project(1, "fast");
  log(`  Claude Opus 5.5, whose fast-mode price is listed, asked for fast mode on the same profile: HTTP ${(await send(main.url, token, opus({ speed: "fast" }))).status}`);
  await showEvents(id);
}

log("\n== B19. What happens to a hold after an error answer: released only on the provider's own rejection before any work; kept otherwise ==");
for (const [label, test] of [
  ["the provider's own rejection (400, invalid_request_error)", "error-400-provider"],
  ["a server error (500, api_error)", "error-500"],
  ["an overloaded provider (529, overloaded_error)", "error-529"],
  ["a 400 that is not in the provider's error shape (an HTML page)", "error-400-not-provider"],
] as const) {
  const { id, token } = await project(0.2);
  log(`  ${label}: HTTP ${(await send(main.url, token, opus({ metadata: { test } }))).status}`);
  await showEvents(id);
  const h = (await listHolds(pool, id))[0]!;
  log(`  the hold's row: state ${h.state}, amount ${usd(Number(h.amount_usd))}, actual cost ${h.actual_usd === null ? "not known" : usd(Number(h.actual_usd))}, kept because ${h.kept_reason ?? "(not kept)"}, unreconciled ${h.unreconciled}`);
  await showBudget(id, "budget");
  log(`  a further call (room for one hold under this cap): HTTP ${(await send(main.url, token, opus())).status}`);
}

log(`\nEvery call that reached the provider carried the gateway's key, never a project token: ${keysSeen.length > 0 && keysSeen.every((k) => k === REAL_KEY) ? "yes" : "NO"} (${keysSeen.length} calls).`);
main.server.close();
provider.server.close();
await pool.end();
