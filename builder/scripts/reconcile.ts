/**
 * The unreconciled list, and the owner's recorded reconciliation of one kept hold (build plan package 1.5;
 * design note 5.5; proof row B14). Run by Claude Code or an engineer when the owner asks, like change-cap.ts.
 * Who asked and who ran it are written down as given: nothing checks them, nor the evidence.
 *
 * Run, from builder/:
 *   npx tsx scripts/reconcile.ts --list [--project <id>]
 *   npx tsx scripts/reconcile.ts --hold <id> --actual <dollars> --evidence "<the evidence, such as the provider's usage record>" \
 *       --asked-by "<who asked>" --by "<who recorded it>" --reason "<why>" [--project <id>]
 *   npx tsx scripts/reconcile.ts --overrun --hold <id> --evidence "<the evidence>" --asked-by "<who asked>" --by "<who recorded it>" \
 *       --reason "<why>" [--project <id>]
 *
 * - --list prints every hold kept at its full amount (in one project, or in all), with what is known of each,
 *   each project's budget, any freeze that reconciling cannot clear, and (package 1.4c) every project frozen after
 *   a bill above its hold, with the bill, the hold and the difference.
 * - A reconciliation needs all six of --hold, --actual, --evidence, --asked-by, --by and --reason, each once.
 *   --actual is a number of dollars written with digits only and at most 6 decimals, below $100,000,000.
 *   Without --project, the hold's own project is looked up. It goes through `reconcileHold`
 *   (builder/src/store/reconcile.ts): one transaction under the project's lock.
 * - --overrun (package 1.4c) records the owner's review of a bill above its hold and clears the freeze it caused.
 *   It needs --hold, --evidence, --asked-by, --by and --reason, each once, and takes no --actual: the bill was
 *   charged in full when the call was settled, and this moves no money. It goes through `recordOverrun`: one
 *   transaction under the project's lock.
 * - The database is the one named by BUILDER_DATABASE_URL, or else the local builder_dev. The script prints
 *   the database's name, never its address (an address can carry a password), and no secret. It reads no
 *   model key and no project token, prints no provider's answer, and does not run migrations.
 *
 * Exit codes: 0 done; 1 the arguments were wrong (nothing was sent to the database); 2 refused by the store
 * (nothing changed, nothing written); 3 it could not be completed: if the connection broke after the
 * reconciliation was sent, look in the event log for a `hold.reconciled` event of this hold (for --overrun, a
 * `hold.overrun_recorded` event) before trying again.
 */
import { parseArgs } from "node:util";
import type pg from "pg";
import { createPool } from "../src/store/db.js";
import { activeFreeze } from "../src/store/freezes.js";
import { getBudget } from "../src/store/holds.js";
import { listUnreconciled, ReconcileRefused, reconcileHold, recordOverrun, type UnreconciledHold } from "../src/store/reconcile.js";

const USAGE = [
  "Usage: npx tsx scripts/reconcile.ts --list [--project <id>]",
  '   or: npx tsx scripts/reconcile.ts --hold <id> --actual <dollars, at most 6 decimals> --evidence "<evidence>" --asked-by "<who asked>" --by "<who recorded it>" --reason "<why>" [--project <id>]',
  '   or: npx tsx scripts/reconcile.ts --overrun --hold <id> --evidence "<evidence>" --asked-by "<who asked>" --by "<who recorded it>" --reason "<why>" [--project <id>]',
].join("\n");
const OPTIONS = {
  list: { type: "boolean" },
  overrun: { type: "boolean" },
  project: { type: "string" },
  hold: { type: "string" },
  actual: { type: "string" },
  evidence: { type: "string" },
  "asked-by": { type: "string" },
  by: { type: "string" },
  reason: { type: "string" },
} as const;
const FOR_RECONCILING = ["hold", "actual", "evidence", "asked-by", "by", "reason"] as const;
/** Package 1.4c: what --overrun needs; it takes no --actual. */
const FOR_OVERRUN = ["hold", "evidence", "asked-by", "by", "reason"] as const;

function misuse(what: string): never {
  console.error(`Refused: ${what}. Nothing was sent to the database.`);
  console.error(USAGE);
  process.exit(1);
}

/** An error's short code, such as ECONNREFUSED or 42501, and never its message, which can carry the database address. */
function codeOf(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "(none)";
}

function readArgs() {
  try {
    return parseArgs({ options: OPTIONS, strict: true, allowPositionals: false, tokens: true });
  } catch (e) {
    return misuse(`the arguments could not be read (${codeOf(e)})`);
  }
}
const parsed = readArgs();
for (const name of Object.keys(OPTIONS)) {
  if (parsed.tokens.filter((t) => t.kind === "option" && t.name === name).length > 1) misuse(`--${name} was given more than once`);
}
const v = parsed.values;
if (v.project !== undefined && v.project.trim() === "") misuse("--project is empty");
const listing = v.list === true;
const overrun = v.overrun === true;
if (listing && overrun) misuse("--list and --overrun are both given; run one or the other");
if (listing && FOR_RECONCILING.some((n) => v[n] !== undefined)) misuse("--list is given with options of a reconciliation; run one or the other");
if (overrun) {
  if (v.actual !== undefined) misuse("--overrun takes no --actual: the bill was charged in full when the call was settled");
  for (const name of FOR_OVERRUN) if (v[name] === undefined || v[name].trim() === "") misuse(`--${name} is missing or empty`);
  if (!/^[1-9][0-9]{0,17}$/.test(v.hold!.trim())) misuse("--hold must be a hold's id, a whole number above 0");
} else if (!listing) {
  for (const name of FOR_RECONCILING) if (v[name] === undefined || v[name].trim() === "") misuse(`--${name} is missing or empty`);
  if (!/^[1-9][0-9]{0,17}$/.test(v.hold!.trim())) misuse("--hold must be a hold's id, a whole number above 0");
  if (!/^\d{1,8}(\.\d{1,6})?$/.test(v.actual!.trim())) misuse("--actual must be a number of dollars, digits only, with at most 6 decimals and below 100000000 (for example 0.006142)");
}

const usd = (n: number) => `$${n.toFixed(6)}`;
/** One line of text: an owner's or a gateway's words, with line breaks and control characters shown as spaces. */
const line = (s: unknown) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ");

function printHold(h: UnreconciledHold): void {
  console.log(`  hold ${h.holdId}: ${usd(h.amountUsd)} held, counted in full until reconciled`);
  console.log(`    kind:        ${h.kinds.join("; ")}`);
  console.log(`    reason kept: ${h.keptReason === null ? "(none: past its deadline)" : line(h.keptReason)}`);
  console.log(`    model:       ${h.model ?? "(not recorded)"}; step: ${h.step ?? "(none)"}${h.stepHoldId ? `, drawn from step hold ${h.stepHoldId}` : ""}`);
  console.log(`    opened:      ${h.openedAt} by gateway ${line(h.openedBy)}; deadline ${h.deadlineAt}${h.pastDeadline ? (h.expired ? " (passed; marked expired)" : " (passed; not yet marked)") : ""}`);
  if (h.foundAtStartup) console.log("    found open when a gateway started");
  if (h.seen) {
    const u = h.seen.usage && typeof h.seen.usage === "object" ? (h.seen.usage as Record<string, unknown>) : null;
    const usage = u ? `input ${u["input_tokens"]}, cache writes ${u["cache_creation_input_tokens"]}, cache reads ${u["cache_read_input_tokens"]}, output ${u["output_tokens"]}` : "none";
    const err = h.seen.error && typeof h.seen.error === "object" ? ` (error ${line((h.seen.error as Record<string, unknown>)["name"] ?? "")}${(h.seen.error as Record<string, unknown>)["code"] ? ` ${line((h.seen.error as Record<string, unknown>)["code"])}` : ""})` : "";
    console.log(`    seen:        status ${line(h.seen.status)}${err}; usage seen ${usage} (for information only)`);
  }
  for (const a of h.lateAnswers) console.log(`    late answer: ${a.at}, cost as read ${a.costUsdAsRead === null ? "(none)" : usd(a.costUsdAsRead)}; ${line(a.reason)}`);
  for (const f of h.freezes) {
    const what =
      f.kind === "late_answer_above_hold" ? "a late answer above its hold froze its project: freeze"
      : f.kind === "kept_above_hold" ? "the usage read before its call ended put it above its hold, which froze its project: freeze"
      : "froze its project: freeze";
    // Package 1.4b: a freeze from an unreadable journal line an operator set aside naming this hold (kind
    // 'journal_line_set_aside'; its journal id says so too, for one written before migration 012); when its call ended is not known.
    const setAside = f.journalId !== null && (f.kind === "journal_line_set_aside" || f.journalId.startsWith("set-aside:"));
    const where =
      f.journalId === null ? ""
      : setAside ? ` (an unreadable journal line set aside as ${line(f.journalId.slice("set-aside:".length))})`
      : ` (journal line ${line(f.journalId)})`;
    const when = f.kind === "late_answer_above_hold" ? "answer arrived" : setAside ? "set aside" : "call ended";
    console.log(`    ${what} ${f.freezeId}${where}, ${when} ${f.endedAt}; ${f.cleared ? "cleared" : "not cleared"}; cost as read ${f.costUsdAsRead === null ? "(none)" : usd(f.costUsdAsRead)}`);
  }
}

let pool: pg.Pool | undefined;
let exitCode = 0;
try {
  pool = createPool();
  pool.on("error", () => undefined); // an idle connection's error is not printed: it can name the address
  const db = await pool.query<{ name: string }>("select current_database() as name");
  console.log(`Database: ${db.rows[0]!.name} (its name only; the address is not printed)`);
  if (listing) {
    const list = await listUnreconciled(pool, { projectId: v.project?.trim() });
    console.log(`The unreconciled list, as of ${list.asOf}: ${list.holds.length} hold(s) kept at their full amount${v.project ? ` in project ${v.project.trim()}` : ""}`);
    for (const projectId of [...new Set(list.holds.map((h) => h.projectId))]) {
      const b = await getBudget(pool, projectId);
      const mine = list.holds.filter((h) => h.projectId === projectId);
      const frozen = await activeFreeze(pool, projectId);
      console.log("");
      console.log(`Project ${projectId}: ${mine.length} kept hold(s), ${usd(mine.reduce((a, h) => a + h.amountUsd, 0))} held; ${frozen ? `FROZEN (freeze ${frozen.id})` : "not frozen"}`);
      console.log(`  budget: cap $${b.cap.toFixed(4)}; spent ${usd(b.spent)}; open holds ${usd(b.openHolds)} (${b.openHoldCount}); reserved for running steps ${usd(b.stepRoom)}`);
      for (const h of mine) printHold(h);
    }
    if (list.freezesWithNoOpenHold.length > 0) {
      console.log("");
      console.log("Freezes that reconciling cannot clear (their hold is not open; an engineer has to look):");
      for (const f of list.freezesWithNoOpenHold) console.log(`  freeze ${f.freezeId}, project ${f.projectId}: hold ${f.holdId ?? "(none)"} is ${f.holdState ?? "not found"}; call ended ${f.endedAt}`);
    }
    console.log("");
    console.log(`Projects frozen after a bill above its hold (package 1.4c; cleared by --overrun): ${list.overrunFreezes.length}`);
    for (const f of list.overrunFreezes) {
      console.log(`  freeze ${f.freezeId}, project ${line(f.projectId)}: hold ${f.holdId} held ${usd(f.heldUsd)}; the call was billed ${usd(f.billUsd)}, above its hold by ${usd(f.aboveByUsd)}, charged in full`);
      console.log(`    model ${f.model === null ? "(not recorded)" : line(f.model)}; step: ${f.step === null ? "(none)" : line(f.step)}; call ended ${f.endedAt} (gateway ${line(f.gateway)}); frozen ${f.frozenAt}`);
    }
  } else if (overrun) {
    const holdId = v.hold!.trim();
    let projectId = v.project?.trim();
    if (projectId === undefined) {
      const r = await pool.query<{ project_id: string }>("select project_id from holds where id = $1", [holdId]);
      if (r.rows.length === 0) throw new ReconcileRefused("unknown_hold", `There is no hold ${holdId}. Nothing was changed and nothing was written.`);
      projectId = r.rows[0]!.project_id;
    }
    const r = await recordOverrun(pool, { projectId, holdId, evidence: v.evidence!, askedBy: v["asked-by"]!, recordedBy: v.by!, reason: v.reason! });
    console.log(`Bill above its hold recorded for hold ${r.holdId} of project ${r.projectId}`);
    console.log(`  held:          ${usd(r.heldUsd)}`);
    console.log(`  billed:        ${usd(r.billUsd)}, charged in full when the call was settled (nothing is charged now)`);
    console.log(`  above it by:   ${usd(r.aboveByUsd)}`);
    console.log(`  evidence:      ${line(r.evidence)}`);
    console.log(`  asked by:      ${line(r.askedBy)}`);
    console.log(`  recorded by:   ${line(r.recordedBy)}`);
    console.log(`  reason:        ${line(r.reason)}`);
    console.log(`  events:        hold.overrun_recorded ${r.eventId}; project.freeze_cleared ${r.clearedEventId}`);
    console.log(`  recorded at:   ${r.recordedAt} (the database's clock, under the project's lock)`);
    console.log(`  budget:        spent ${usd(r.budget.spent)}; open holds ${usd(r.budget.openHolds)}; cap $${r.budget.cap.toFixed(4)}`);
    console.log(`  freezes:       cleared ${r.freezeId}; ${r.projectStillFrozen ? "the project is STILL FROZEN by another freeze" : "the project is not frozen"}`);
  } else {
    const holdId = v.hold!.trim();
    let projectId = v.project?.trim();
    if (projectId === undefined) {
      const r = await pool.query<{ project_id: string }>("select project_id from holds where id = $1", [holdId]);
      if (r.rows.length === 0) throw new ReconcileRefused("unknown_hold", `There is no hold ${holdId}. Nothing was changed and nothing was written.`);
      projectId = r.rows[0]!.project_id;
    }
    const r = await reconcileHold(pool, { projectId, holdId, actualUsd: Number(v.actual!.trim()), evidence: v.evidence!, askedBy: v["asked-by"]!, recordedBy: v.by!, reason: v.reason! });
    console.log(`Hold ${r.holdId} of project ${r.projectId} reconciled`);
    console.log(`  kind:          ${r.kinds.join("; ")}`);
    console.log(`  held:          ${usd(r.heldUsd)}`);
    console.log(`  actual cost:   ${usd(r.actualUsd)}, now charged${r.aboveHold ? " (ABOVE the hold: charged in full; hold.exceeded written)" : `; ${usd(r.returnedUsd)} back to the budget`}`);
    console.log(`  evidence:      ${line(r.evidence)}`);
    console.log(`  asked by:      ${line(r.askedBy)}`);
    console.log(`  recorded by:   ${line(r.recordedBy)}`);
    console.log(`  reason:        ${line(r.reason)}`);
    console.log(`  events:        model.call ${r.modelCallEventId}; hold.reconciled ${r.eventId}`);
    console.log(`  recorded at:   ${r.recordedAt} (the database's clock, under the project's lock)`);
    console.log(`  budget before: spent ${usd(r.budgetBefore.spent)}; open holds ${usd(r.budgetBefore.openHolds)}; cap $${r.budgetBefore.cap.toFixed(4)}`);
    console.log(`  budget after:  spent ${usd(r.budgetAfter.spent)}; open holds ${usd(r.budgetAfter.openHolds)}; cap $${r.budgetAfter.cap.toFixed(4)}`);
    console.log(`  freezes:       ${r.freezesCleared.length > 0 ? `cleared ${r.freezesCleared.join(", ")}; ` : "none cleared; "}${r.projectStillFrozen ? "the project is STILL FROZEN by another freeze" : "the project is not frozen"}`);
  }
} catch (e) {
  if (e instanceof ReconcileRefused) {
    console.error(`Refused by the store (${e.code}): ${e.message}`);
    exitCode = 2;
  } else {
    console.error(`It could not be completed (error code ${codeOf(e)}). If the connection broke after it was sent, look in the event log for a ${overrun ? "hold.overrun_recorded" : "hold.reconciled"} event of this hold before trying again.`);
    exitCode = 3;
  }
} finally {
  await pool?.end().catch(() => undefined);
}
process.exit(exitCode);
