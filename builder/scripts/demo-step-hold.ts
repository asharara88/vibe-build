/**
 * Demonstration of package 1.3, the pre-step check and the step hold (design note 5.5; proof row B7),
 * against a stand-in provider and a stand-in engine: no real key, no real provider, nothing spent.
 * The engine is a stand-in written for this demonstration: it calls the gateway with the step's token.
 * No engine in the builder takes a token yet (known gap 69).
 *
 *   1. A step is refused at a cap of $0.02, and the message is shown.
 *   2. The cap is raised to $0.03 with scripts/change-cap.ts, which writes cap.changed.
 *   3. The same step is let start: its three calls draw from its hold, and when it ends the unused part
 *      is released.
 *   4. A step runs out of room: its next call is refused, though the project's cap has room.
 *   5. During a step, a cap lowering below spent + open holds + the room reserved is refused by
 *      change-cap.ts; a raise is accepted and leaves the room as it was.
 *
 * Run, from builder/: npx tsx scripts/demo-step-hold.ts
 * (the database named by BUILDER_TEST_DATABASE_URL, or the local builder_test; it prints the database's
 * name, never its address). Made-up data only. Role names only.
 */
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createGateway } from "../src/gateway/app.js";
import { emptyUsage } from "../src/gateway/cost.js";
import { DEFAULT_PROFILES, type ProfileLimits } from "../src/gateway/hold.js";
import type { BuildEngine, EngineEvent } from "../src/engine/interface.js";
import { runBudgetedStep } from "../src/orchestrator/steps.js";
import { createPool } from "../src/store/db.js";
import { listEvents } from "../src/store/events.js";
import { getBudget, listStepHolds, micro } from "../src/store/holds.js";
import { migrate } from "../src/store/migrate.js";
import { createProject } from "../src/store/projects.js";

const BUILDER_DIR = fileURLToPath(new URL("..", import.meta.url));
const DB_URL = process.env.BUILDER_TEST_DATABASE_URL ?? "postgres:///builder_test?host=/var/run/postgresql";
const log = (s = "") => console.log(s);
const usd = (n: number) => `$${n.toFixed(6)}`;
const listen = (app: Hono) =>
  new Promise<{ server: ServerType; url: string }>((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (i) => resolve({ server, url: `http://127.0.0.1:${i.port}` }));
  });

// The stand-in provider: it counts every prompt as 42 tokens and bills 30 input, 4 cache-write, 8 cache-read
// and 300 output tokens ($0.006142 on Claude Opus 5.5).
let forwarded = 0;
const standIn = new Hono();
standIn.post("/v1/messages/count_tokens", (c) => c.json({ input_tokens: 42 }));
standIn.post("/v1/messages", async (c) => {
  forwarded++;
  const body = (await c.req.json()) as { model: string };
  return c.json({ id: "msg_demo", type: "message", model: body.model, content: [{ type: "text", text: "hello" }], usage: { input_tokens: 30, output_tokens: 300, cache_creation_input_tokens: 4, cache_read_input_tokens: 8 } });
});

const pool = createPool(DB_URL);
await migrate(pool);
const db = (await pool.query<{ name: string }>("select current_database() as name")).rows[0]!.name;
const provider = await listen(standIn);
const gw = await listen(createGateway({ pool, modelApiKey: "demo-real-key-held-only-by-the-gateway", upstreamUrl: provider.url, profiles: DEFAULT_PROFILES, gatewayId: "gw_demo_steps", onFault: (m) => log(`  [fault] ${m}`) }));

/** The limits a step's budget is worked out from here: Claude Opus 5.5, up to 400 output tokens and a 42-token prompt per call. */
const STEP_PROFILE: ProfileLimits = { maxTokensCeiling: 400, allowFastMode: false, stepPromptTokens: 42 };
const MODEL = "claude-opus-5-5";
const run = Date.now().toString(36);
let n = 0;
const projects: string[] = [];
async function project(capUsd: number) {
  const id = `demo13_${run}_${++n}`;
  projects.push(id);
  await createProject(pool, { id, name: "step hold demonstration", capUsd });
  return id;
}

/** A stand-in engine: `calls` calls through the gateway with the step's token, then `during`, then finished. */
function engine(calls: number, during?: () => Promise<void>) {
  const seen = { created: 0 };
  const engineFor = ({ gatewayUrl, token }: { gatewayUrl: string; token: string }): BuildEngine => {
    seen.created++;
    return {
      name: "stand-in engine (demonstration)",
      async runStep(_step, onEvent) {
        for (let i = 1; i <= calls; i++) {
          const res = await fetch(gatewayUrl + "/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": token },
            body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: "user", content: "made-up request" }] }),
          });
          const body = (await res.json()) as { error?: { type: string; message: string } };
          log(`  engine: call ${i} answered ${res.status}${body.error ? ` ${body.error.type}: ${body.error.message}` : ""}`);
        }
        if (during) await during();
        onEvent({ type: "finished", at: new Date().toISOString() });
        return { ok: true, changedFiles: [], usage: emptyUsage(), turns: calls };
      },
      async stop() {},
    };
  };
  return { engineFor, seen };
}

function step(id: string, e: ReturnType<typeof engine>, maxTurns: number) {
  const events: EngineEvent[] = [];
  return runBudgetedStep({
    pool,
    profile: STEP_PROFILE,
    model: MODEL,
    gatewayUrl: gw.url,
    engineFor: e.engineFor,
    step: { projectId: id, stepId: "step-1", instruction: "Made-up instruction for the demonstration.", protectedPaths: [], maxTurns },
    onEvent: (ev) => events.push(ev),
    stepTimeLimitMs: 600_000,
    onFault: (m) => log(`  [fault] ${m}`),
  }).then((r) => ({ r, events }));
}

async function showBudget(id: string, label: string) {
  const b = await getBudget(pool, id);
  log(`  ${label}: cap ${usd(b.cap)} | spent ${usd(b.spent)} | open holds ${usd(b.openHolds)} (${b.openHoldCount}) | reserved for running steps ${usd(b.stepRoom)} (${b.openSteps})`);
}

async function showEvents(id: string, from = 0) {
  for (const e of (await listEvents(pool, id)).slice(from)) {
    const p = e.payload as Record<string, unknown>;
    const s = p["step_hold"] as Record<string, number> | undefined;
    if (e.kind === "step.refused") {
      log(`  event step.refused: spent ${usd(p["spent_usd"] as number)} + open holds ${usd(p["open_holds_usd"] as number)} + reserved ${usd(p["step_room_usd"] as number)} + this step's budget ${usd(p["step_budget_usd"] as number)} (${p["turns"]} turns x ${usd(p["per_turn_usd"] as number)}) > cap ${usd(p["cap_usd"] as number)}`);
    } else if (e.kind === "step.hold_opened") {
      log(`  event step.hold_opened: step hold #${p["step_hold_id"]}, budget ${usd(p["step_budget_usd"] as number)} = ${p["turns"]} turns x ${usd(p["per_turn_usd"] as number)} (${p["model"]}, up to ${p["max_tokens_ceiling"]} output tokens and a ${p["prompt_tokens"]}-token prompt per call)`);
    } else if (e.kind === "hold.opened") {
      log(`  event hold.opened: hold #${p["hold_id"]} for ${usd(p["amount_usd"] as number)}${s ? `, drawn from step hold #${s["step_hold_id"]}: room ${usd(s["room_before_usd"]!)} -> ${usd(s["room_after_usd"]!)}` : ""}`);
    } else if (e.kind === "model.call") {
      log(`  event model.call: actual cost ${usd(p["cost_usd"] as number)}`);
    } else if (e.kind === "hold.settled") {
      log(`  event hold.settled: hold #${p["hold_id"]} of ${usd(p["amount_usd"] as number)} settled at ${usd(p["actual_usd"] as number)}${s && s["room_after_usd"] !== undefined ? `; ${usd(p["returned_usd"] as number)} back to the step's room: ${usd(s["room_before_usd"]!)} -> ${usd(s["room_after_usd"]!)}` : ""}`);
    } else if (e.kind === "step.hold_closed") {
      log(`  event step.hold_closed (${p["reason"]}): budget ${usd(p["budget_usd"] as number)}; drawn ${usd(p["drawn_usd"] as number)} by ${p["calls_drawn"]} call(s); spent in the step ${usd(p["spent_in_step_usd"] as number)}; still held ${usd(p["still_held_usd"] as number)}; released ${usd(p["released_usd"] as number)}; overrun not covered ${usd(p["overrun_not_covered_usd"] as number)}; tokens revoked ${p["tokens_revoked"]}`);
      const m = (k: string) => micro(p[k] as number);
      log(`      check: released + still held + spent in the step - overrun not covered = ${usd((m("released_usd") + m("still_held_usd") + m("spent_in_step_usd") - m("overrun_not_covered_usd")) / 1e6)}; the budget was ${usd(p["budget_usd"] as number)}`);
    } else if (e.kind === "gateway.refused") {
      log(`  event gateway.refused: reason ${p["reason"]}${s ? `; room left ${usd(s["room_usd"]!)} of ${usd(s["budget_usd"]!)}; this call's hold ${usd(p["this_hold_usd"] as number)}` : ""}; cap ${usd(p["cap_usd"] as number)}, spent ${usd(p["spent_usd"] as number)}, open holds ${usd(p["open_holds_usd"] as number)}, reserved ${usd(p["step_room_usd"] as number)}`);
    } else if (e.kind === "cap.changed") {
      log(`  event cap.changed: ${usd(p["old_cap_usd"] as number)} -> ${usd(p["new_cap_usd"] as number)}; asked by "${p["asked_by"]}", run by "${p["changed_by"]}"; spent ${usd(p["spent_usd"] as number)}, open holds ${usd(p["open_holds_usd"] as number)}, reserved ${usd(p["step_room_usd"] as number)} (${p["open_steps"]} step(s))`);
    } else {
      log(`  event ${e.kind}`);
    }
  }
}

/** scripts/change-cap.ts as its own process, against the same database. */
function changeCapScript(id: string, cap: string, reason: string) {
  const args = ["tsx", "scripts/change-cap.ts", "--project", id, "--cap", cap, "--asked-by", "the demonstration script (scripts/demo-step-hold.ts)", "--by", "Claude Code", "--reason", reason];
  log(`  $ npx ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`);
  const r = spawnSync("npx", args, { cwd: BUILDER_DIR, env: { ...process.env, BUILDER_DATABASE_URL: DB_URL }, encoding: "utf8" });
  for (const line of `${r.stdout}${r.stderr}`.trim().split("\n")) log(`  | ${line}`);
  log(`  exit code: ${r.status}`);
}

log("Package 1.3 demonstration: the pre-step check and the step hold. Stand-in provider and stand-in engine; nothing spent.");
log(`Database: ${db} (its name only). Prices: Claude Opus 5.5, $8 per million for a one-hour cache write, $20 per million output.`);
log("One turn's share: (42 counted + 5% + 200 margin = 245 tokens) x $8 + 400 x $20 per million = $0.009960. A 3-turn step: $0.029880.");

log("");
log("== 1. A step refused before it starts, at a cap of $0.02 ==");
const a = await project(0.02);
await showBudget(a, "before");
const e1 = engine(3);
const before1 = forwarded;
const s1 = await step(a, e1, 3);
log(`  result: ok ${s1.r.ok}, turns ${s1.r.turns}; engine created ${e1.seen.created} time(s); calls forwarded ${forwarded - before1}`);
log(`  the message shown: ${s1.r.failureReason}`);
log(`  the step's event: ${s1.events.map((e) => e.type).join(", ")}`);
await showEvents(a);
log(`  step holds opened: ${(await listStepHolds(pool, a)).length}`);

log("");
log("== 2. The cap raised to $0.03 with scripts/change-cap.ts ==");
changeCapScript(a, "0.03", "demonstration of package 1.3: raise the cap so the step can start");
await showEvents(a, 1);

log("");
log("== 3. The same step let start: three calls draw from its hold; the unused part is released when it ends ==");
const before3 = (await listEvents(pool, a)).length;
const e3 = engine(3);
const s3 = await step(a, e3, 3);
log(`  result: ok ${s3.r.ok}, turns ${s3.r.turns}; engine created ${e3.seen.created} time(s)`);
await showEvents(a, before3);
await showBudget(a, "after the step");

log("");
log("== 4. A step runs out of room: a 2-turn step ($0.019920) whose engine makes three calls, at a cap of $1 ==");
const b = await project(1);
const before4 = forwarded;
await step(b, engine(3), 2);
log(`  calls forwarded: ${forwarded - before4}`);
await showEvents(b);

log("");
log("== 5. During a step, change-cap.ts: a lowering below spent + open holds + the room reserved is refused; a raise is accepted ==");
const c = await project(0.05);
await step(
  c,
  engine(1, async () => {
    await showBudget(c, "during the step");
    log(`  room of the running step: ${usd(Number((await listStepHolds(pool, c))[0]!.room_usd))}`);
    changeCapScript(c, "0.02", "demonstration of package 1.3: a lowering during a step");
    changeCapScript(c, "0.06", "demonstration of package 1.3: a raise during a step");
    log(`  room of the running step after the raise: ${usd(Number((await listStepHolds(pool, c))[0]!.room_usd))}`);
  }),
  3,
);
await showEvents(c);

log("");
const leaked = await pool.query<{ n: number }>("select count(*)::int as n from events where project_id = any($1::text[]) and payload::text like '%bpt\\_%'", [projects]);
log(`Events of these projects that contain a step token: ${leaked.rows[0]!.n}. Calls forwarded to the stand-in in all: ${forwarded}.`);
gw.server.close();
provider.server.close();
await pool.end();
