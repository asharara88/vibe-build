/**
 * The recovery of a gateway journal line that cannot be read (build plan package 1.4b; the third outside review,
 * item 1). Run by Claude Code or an engineer when the owner asks, like reconcile.ts, while no gateway uses the
 * journal folder. Who set a line aside and why are written down as given: nothing checks them.
 *
 * A gateway that finds such a line in its journal at start-up forwards nothing, for any project, until the line
 * is recovered and the gateway restarted (builder/src/gateway/journal.ts): the line may be the record of a model
 * call whose ending was not recorded, for a project that cannot be told.
 *
 * Run, from builder/:
 *   npx tsx scripts/journal-recover.ts --list [--dir <journal folder>]
 *   npx tsx scripts/journal-recover.ts --set-aside --line <n> --fingerprint <sha256> --hold <id> --by "<who>" --reason "<why>" [--dir <journal folder>]
 *   npx tsx scripts/journal-recover.ts --set-aside --line <n> --fingerprint <sha256> --no-hold --by "<who>" --reason "<why>" [--dir <journal folder>]
 *
 * - --list prints each line of the journal file that cannot be read (its number, its length in bytes, why, its
 *   fingerprint and its text, with control characters shown as spaces), the readable records still waiting, the
 *   candidates (open holds kept because the gateway that opened them was found gone, which no freeze names), and
 *   the set-asides recorded before. It only reads, and says whether a process holds the folder's lock now.
 * - --set-aside sets one unreadable line aside: --line and --fingerprint (both from --list; the fingerprint checks
 *   that the line has not moved), and either --hold, the hold the line may stand for, whose project is frozen until
 *   the owner reconciles that hold (scripts/reconcile.ts), or --no-hold, for a line shown to concern no open hold.
 *   It goes through `setAsideLine` (builder/src/gateway/journal-recovery.ts) and is refused while a gateway, or
 *   another run of this script, holds the folder's lock. Afterwards, restart the gateway: it reads its journal only
 *   when it starts.
 * - The folder is --dir, else BUILDER_GATEWAY_JOURNAL_DIR, else builder/.gateway-journal, as for the gateway. The
 *   database is the one named by BUILDER_DATABASE_URL, or else the local builder_dev. The script prints the
 *   database's name, never its address (an address can carry a password). A journal record holds no model key and
 *   no request body; the script reads no key and no project token, and does not run migrations.
 *
 * Exit codes: 0 done; 1 the arguments were wrong (nothing was read or sent); 2 refused (nothing was changed for the
 * line asked for; a set-aside cut short earlier may have been finished first, and the message says so); 3 it could
 * not be completed: if it broke after the record, run the same command again, which finishes the move and writes
 * nothing twice.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type pg from "pg";
import { listJournal, printable, RecoveryRefused, setAsideLine, type SetAsideRow } from "../src/gateway/journal-recovery.js";
import { createPool, databaseUrl } from "../src/store/db.js";

const USAGE = [
  "Usage: npx tsx scripts/journal-recover.ts --list [--dir <journal folder>]",
  '   or: npx tsx scripts/journal-recover.ts --set-aside --line <n> --fingerprint <sha256> (--hold <id> | --no-hold) --by "<who>" --reason "<why>" [--dir <journal folder>]',
].join("\n");
const OPTIONS = {
  list: { type: "boolean" },
  "set-aside": { type: "boolean" },
  dir: { type: "string" },
  line: { type: "string" },
  fingerprint: { type: "string" },
  hold: { type: "string" },
  "no-hold": { type: "boolean" },
  by: { type: "string" },
  reason: { type: "string" },
} as const;
const FOR_SETTING_ASIDE = ["line", "fingerprint", "hold", "no-hold", "by", "reason"] as const;

function misuse(what: string): never {
  console.error(`Refused: ${what}. Nothing was read or sent.`);
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
const listing = v.list === true;
const settingAside = v["set-aside"] === true;
if (listing === settingAside) misuse("give one of --list and --set-aside");
if (v.dir !== undefined && v.dir.trim() === "") misuse("--dir is empty");
if (listing && FOR_SETTING_ASIDE.some((n) => v[n] !== undefined)) misuse("--list is given with options of a set-aside; run one or the other");
if (settingAside) {
  for (const name of ["line", "fingerprint", "by", "reason"] as const) if (v[name] === undefined || v[name].trim() === "") misuse(`--${name} is missing or empty`);
  if ((v.hold !== undefined) === (v["no-hold"] === true)) misuse("give one of --hold <id> and --no-hold");
  if (v.hold !== undefined && !/^[1-9][0-9]{0,17}$/.test(v.hold.trim())) misuse("--hold must be a hold's id, a whole number above 0");
  if (!/^[1-9][0-9]{0,8}$/.test(v.line!.trim())) misuse("--line must be a line number, a whole number from 1");
  if (!/^(sha256:)?[0-9a-fA-F]{64}$/.test(v.fingerprint!.trim())) misuse("--fingerprint must be the 64 hexadecimal characters --list prints");
}

const dir = resolve(v.dir?.trim() ?? process.env.BUILDER_GATEWAY_JOURNAL_DIR ?? fileURLToPath(new URL("../.gateway-journal", import.meta.url)));
const usd = (n: number) => `$${n.toFixed(6)}`;
/** At most this many characters of a line's text are printed. */
const SHOWN = 2000;
const clip = (s: string) => (s.length > SHOWN ? `${s.slice(0, SHOWN)} ... (${s.length - SHOWN} more characters not shown)` : s);

function printSetAside(r: SetAsideRow): void {
  console.log(`  set-aside ${r.set_aside_id} (row ${r.id}), ${r.recorded_at.toISOString()}: line ${r.line_number}, ${r.line_length} bytes, fingerprint ${r.fingerprint}`);
  console.log(`    ${r.hold_id === null ? "no hold named" : `hold ${r.hold_id} of project ${printable(r.project_id)}, freeze ${r.freeze_id}`}; by ${printable(r.set_aside_by)}; reason: ${printable(r.reason)}`);
  console.log(`    ${r.moved_at ? `moved out of the journal file at ${r.moved_at.toISOString()}` : "NOT YET MOVED out of the journal file: the next --set-aside finishes it"}`);
}

let pool: pg.Pool | undefined;
let exitCode = 0;
try {
  pool = createPool();
  pool.on("error", () => undefined); // an idle connection's error is not printed: it can name the address
  const db = await pool.query<{ name: string }>("select current_database() as name");
  console.log(`Database: ${db.rows[0]!.name} (its name only; the address is not printed)`);
  if (listing) {
    const l = await listJournal(pool, dir);
    console.log(`Journal folder: ${printable(dir)} (folder id ${l.folderId})`);
    console.log(
      l.inUse
        ? "In use now: YES. A gateway, or a run of this script, holds the folder's lock; a set-aside is refused until it stops."
        : "In use now: no. No process holds the folder's lock.",
    );
    console.log(`Journal file: ${l.file.lines} line(s), ${l.file.size} bytes, SHA-256 ${l.file.sha256}`);
    console.log(`  readable records waiting (a gateway writes them into the database when it starts): ${l.waiting.length}`);
    for (const w of l.waiting) console.log(`    line ${w.number}: journal line ${printable(w.journalId)}, project ${printable(w.projectId)}, hold ${w.holdId}, call ended ${printable(w.endedAt)}`);
    console.log(`  lines that cannot be read: ${l.unreadable.length}${l.unreadable.length > 0 ? " (while one is there, a gateway that starts forwards nothing, for any project)" : ""}`);
    for (const u of l.unreadable) {
      console.log(`    line ${u.number}: ${u.length} bytes; ${u.why}`);
      console.log(`      fingerprint: ${u.fingerprint}`);
      console.log(`      text:        ${clip(u.text)}`);
    }
    console.log("");
    console.log(`Candidates: open holds kept because the gateway that opened them was found gone, which no freeze names: ${l.candidates.length}`);
    for (const c of l.candidates) {
      console.log(`  hold ${c.holdId}, project ${printable(c.projectId)}: ${usd(c.amountUsd)} held; opened ${c.openedAt} by gateway ${printable(c.openedBy)}; deadline ${c.deadlineAt}; step ${c.step === null ? "(none)" : printable(c.step)}`);
    }
    console.log("  (A gateway marks the holds of a gateway found gone when it starts: start it once if a killed gateway's hold is not listed. It forwards nothing while a line here cannot be read.)");
    console.log("");
    console.log(`Set-asides recorded before for this folder: ${l.setAsides.length}`);
    for (const r of l.setAsides) printSetAside(r);
    if (l.unreadable.length > 0) {
      const u = l.unreadable[0]!;
      console.log("");
      console.log("To set a line aside, naming the hold it may stand for (that hold's project is then frozen until the owner reconciles the hold):");
      console.log(`  npx tsx scripts/journal-recover.ts --set-aside --line ${u.number} --fingerprint ${u.fingerprint} --hold <hold id> --by "<who>" --reason "<why>"`);
      console.log("or, for a line shown to concern no open hold, with --no-hold in place of --hold <hold id>. Then restart the gateway: it reads its journal only when it starts.");
    }
  } else {
    const r = await setAsideLine(pool, databaseUrl(), {
      dir,
      line: Number(v.line!.trim()),
      fingerprint: v.fingerprint!,
      hold: v.hold?.trim() ?? null,
      by: v.by!,
      reason: v.reason!,
    });
    console.log(`Journal folder: ${printable(dir)}`);
    for (const s of r.finishedEarlier) console.log(`First finished set-aside ${s}, recorded earlier but cut short: its line moved out of the journal file; nothing was written to the database again.`);
    console.log(`Line ${r.line.number} set aside (set-aside ${r.setAsideId}, row ${r.rowId})`);
    console.log(`  line:        ${r.line.length} bytes; ${r.line.why}; fingerprint ${r.line.fingerprint}`);
    console.log(`  text:        ${clip(r.line.text)}`);
    console.log(
      r.hold
        ? `  hold:        ${r.hold.id} of project ${printable(r.hold.projectId)}, ${usd(r.hold.amountUsd)} held: the project is FROZEN (freeze ${r.hold.freezeId}) until the owner reconciles that hold (scripts/reconcile.ts)`
        : "  hold:        none named: the operator states the line concerns no open hold; no project is frozen",
    );
    console.log(`  by:          ${printable(r.by)}`);
    console.log(`  reason:      ${printable(r.reason)}`);
    if (r.hold) console.log(`  events:      gateway.journal_line_set_aside ${r.hold.eventId}; project.frozen ${r.hold.frozenEventId}`);
    console.log(`  recorded at: ${r.recordedAt} (the database's clock)`);
    console.log(`  moved:       to unrecorded-endings.set-aside.jsonl in the folder (forced to disk); the journal file now holds ${r.linesLeft} line(s)`);
    console.log("Restart the gateway now: it reads its journal only when it starts.");
  }
} catch (e) {
  if (e instanceof RecoveryRefused) {
    console.error(`Refused (${e.code}): ${printable(e.message)}`);
    exitCode = 2;
  } else {
    console.error(`It could not be completed (error code ${codeOf(e)}). If it broke after the set-aside was recorded, run the same command again: it finishes the move and writes nothing twice.`);
    exitCode = 3;
  }
} finally {
  await pool?.end().catch(() => undefined);
}
process.exit(exitCode);
