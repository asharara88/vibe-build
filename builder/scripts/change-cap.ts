/**
 * Change a project's cap, with a record in the event log (build plan package 1.2b; design note 5.5).
 * Run by Claude Code or an engineer when the owner asks. Who asked and who ran it are written down as
 * given: nothing checks them.
 *
 * Run, from builder/:
 *   npx tsx scripts/change-cap.ts --project <id> --cap <dollars> --asked-by "<who asked>" --by "<who ran it>" --reason "<why>"
 *
 * - All five are required, each once. --cap is a number of dollars written with digits only and at most
 *   4 decimals (for example 20 or 20.5 or 0.0003), below $100,000,000.
 * - The database is the one named by BUILDER_DATABASE_URL, or else the local builder_dev. The script
 *   prints the database's name, never its address (an address can carry a password), and no secret.
 *   It reads no model key and no project token, and it does not run migrations.
 * - The change goes through `changeCap` (builder/src/store/holds.ts): one transaction under the
 *   project's lock, the cap and its `cap.changed` event together. A lowering below what the project has
 *   already spent plus its open holds (since package 1.3, with the room reserved for running steps) is
 *   refused, with the lowest figure allowed now.
 *
 * Exit codes: 0 changed; 1 the arguments were wrong (nothing was sent to the database); 2 refused by the
 * store (nothing changed, nothing written); 3 the change could not be completed: if the connection broke
 * after the change was sent, look in the event log for a `cap.changed` event of this project before
 * trying again.
 */
import { parseArgs } from "node:util";
import type pg from "pg";
import { createPool } from "../src/store/db.js";
import { CapChangeRefused, changeCap } from "../src/store/holds.js";

const USAGE =
  'Usage: npx tsx scripts/change-cap.ts --project <id> --cap <dollars, at most 4 decimals> --asked-by "<who asked>" --by "<who ran it>" --reason "<why>"';
const OPTIONS = { project: { type: "string" }, cap: { type: "string" }, "asked-by": { type: "string" }, by: { type: "string" }, reason: { type: "string" } } as const;

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
for (const name of Object.keys(OPTIONS) as (keyof typeof OPTIONS)[]) {
  if (v[name] === undefined || v[name].trim() === "") misuse(`--${name} is missing or empty`);
}
const capText = v.cap!.trim();
if (!/^\d{1,8}(\.\d{1,4})?$/.test(capText)) misuse("--cap must be a number of dollars, digits only, with at most 4 decimals and below 100000000 (for example 20 or 20.5)");

let pool: pg.Pool | undefined;
let exitCode = 0;
try {
  pool = createPool();
  pool.on("error", () => undefined); // an idle connection's error is not printed: it can name the address
  const db = await pool.query<{ name: string }>("select current_database() as name");
  console.log(`Database: ${db.rows[0]!.name} (its name only; the address is not printed)`);
  const r = await changeCap(pool, { projectId: v.project!.trim(), newCapUsd: Number(capText), askedBy: v["asked-by"]!, changedBy: v.by!, reason: v.reason! });
  console.log(`Cap changed for project ${r.projectId}`);
  console.log(`  old cap:     $${r.oldCapUsd.toFixed(4)}`);
  console.log(`  new cap:     $${r.newCapUsd.toFixed(4)}`);
  console.log(`  spent:       $${r.spentUsd.toFixed(6)}`);
  console.log(`  open holds:  $${r.openHoldsUsd.toFixed(6)} (${r.openHolds} open hold(s))`);
  console.log(`  reserved:    $${r.stepRoomUsd.toFixed(6)} for ${r.openSteps} running step(s) (package 1.3; counted with open holds)`);
  console.log(`  asked by:    ${r.askedBy}`);
  console.log(`  changed by:  ${r.changedBy}`);
  console.log(`  reason:      ${r.reason}`);
  console.log(`  event:       cap.changed, id ${r.eventId}`);
  console.log(`  changed at:  ${r.changedAt} (the database's clock, under the project's lock)`);
} catch (e) {
  if (e instanceof CapChangeRefused) {
    console.error(`Refused by the store (${e.code}): ${e.message}`);
    exitCode = 2;
  } else {
    console.error(`The change could not be completed (error code ${codeOf(e)}). If the connection broke after the change was sent, look in the event log for a cap.changed event of this project before trying again.`);
    exitCode = 3;
  }
} finally {
  await pool?.end().catch(() => undefined);
}
process.exit(exitCode);
