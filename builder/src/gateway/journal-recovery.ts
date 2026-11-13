/**
 * The recovery of a journal line that cannot be read (build plan package 1.4b; the third outside review, item 1).
 *
 * A line of the gateway's journal that cannot be read keeps every gateway that reads it at start-up closed, for
 * every project (gateway/journal.ts): it may be the record of a model call whose ending was not recorded, for a
 * project that cannot be told. Recovery is an operator's recorded action, run through
 * builder/scripts/journal-recover.ts while no gateway uses the folder:
 *
 * - `listJournal` shows each unreadable line (its number, length, fingerprint and text) and, to help, the
 *   candidates: open holds kept because the gateway that opened them was found gone, which no freeze names.
 * - `setAsideLine` records, in ONE transaction under the project's lock, a freeze of the named hold's project
 *   naming that hold (so the owner's reconciliation of the hold, store/reconcile.ts, clears it), a
 *   `journal_set_asides` row, and the events `gateway.journal_line_set_aside` and `project.frozen`; then moves the
 *   line from the journal file into the folder's set-aside file (forced to disk), and marks the row moved. With no
 *   hold (a line the operator has shown concerns no open hold) it records the row alone, as no project's event.
 *   Only an open hold that is kept at its full amount (kept, marked unreconciled or expired) with no cost recorded
 *   can be named: a freeze on any other could not be cleared by a reconciliation (known gap 100).
 *
 * It takes the journal folder's lock (store/liveness.ts) for the whole set-aside, and refuses without it: a gateway
 * using the folder holds that lock, and a gateway cannot start while the set-aside holds it. A gateway that has lost its
 * lock (its database connection down) still appends to the journal file; the rewrite carries such lines over
 * (gateway/journal.ts, 1.4b's review). `--list` only reads which locks are held; it takes none. A set-aside cut short
 * (after its database record, before its line left the journal file) is finished by the next run, which writes
 * nothing to the database for it again; a second set-aside of a line already moved out is refused. Who set it aside
 * and why are written as stated: nothing checks them.
 *
 * After the review bot on 88e984b:
 * - A rewrite of the journal file cut short leaves the old file under a second name (gateway/journal.ts). `--list` shows
 *   what such a leftover alone holds, numbered as it will be in the journal file; a set-aside first moves it there
 *   (`absorbLeftovers`), leaving out a line recorded as set aside already.
 * - The folder's lock lives on the run's own database connection. That connection's 'error' and 'end' are tracked; right
 *   before each write (to the database or in the journal folder) the run checks that it still holds the lock, by that
 *   flag and by a query on that connection, and inside the set-aside's transaction again right before its commit. Once
 *   the lock is lost, the run writes nothing more and stops with `RecoveryStopped` (the script exits with code 4).
 */
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { createClient } from "../store/db.js";
import { SET_ASIDE_FREEZE_REASON, type Freeze } from "../store/freezes.js";
import { expireHoldsIn, LONE_SURROGATE_IN, OWNER_GONE, type Hold } from "../store/holds.js";
import { journalFolderLockKeySql } from "../store/liveness.js";
import { event, inTransaction } from "../store/tx.js";
import { FaultJournal, fingerprintOf, joinLines, onlyInLeftovers, readLine, setAsideFingerprints, type JournalLine, type Unreadable } from "./journal.js";

/** Why a set-aside was refused. Each has its own code; nothing is changed or written for the line asked for. */
export type RecoveryRefusalCode =
  | "folder_not_found"
  | "folder_in_use"
  | "line_not_valid"
  | "fingerprint_not_valid"
  | "hold_id_not_valid"
  | `${"by" | "reason"}_${"missing" | "too_long" | "not_storable"}`
  | "line_out_of_range"
  | "line_blank"
  | "line_readable"
  | "line_too_long"
  | "fingerprint_differs"
  | "already_set_aside"
  | "identical_lines"
  | "earlier_set_aside_unclear"
  | "unknown_hold"
  | "hold_not_open"
  | "hold_not_kept"
  | "cost_already_recorded";

export class RecoveryRefused extends Error {
  constructor(
    readonly code: RecoveryRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = "RecoveryRefused";
  }
}

/**
 * After the review bot on 88e984b: the run lost the journal folder's lock part-way (its own database connection ended),
 * so it stopped before a write; it wrote nothing more to the database or in the journal folder.
 */
export class RecoveryStopped extends Error {
  readonly code = "folder_lock_lost";
  constructor(
    /** The write it stopped before. */
    readonly before: string,
  ) {
    super(
      `The run lost the journal folder's lock part-way (its database connection ended), so it stopped before ${before}: from then on it wrote nothing to the database and changed nothing in the journal folder. Another process may use the folder now. Run the same command again once none does: a set-aside recorded before the stop is finished then, and nothing is written twice.`,
    );
    this.name = "RecoveryStopped";
  }
}

/** The writes of a set-aside, in the order they can happen; a test can stop the run right before one (`SetAsideOptions.beforeWrite`). */
export type RecoveryWrite =
  | "absorb leftovers"
  | "earlier: set-aside entry"
  | "earlier: journal line removed"
  | "earlier: row marked moved"
  | "record: row"
  | "record: transaction"
  | "record: commit"
  | "set-aside entry"
  | "journal line removed"
  | "row marked moved";

export interface SetAsideOptions {
  /** For tests: runs right before each write's check that the run still holds the folder's lock. */
  beforeWrite?: (write: RecoveryWrite) => Promise<void>;
}

const NOTHING_CHANGED = "Nothing was changed for this line.";
const MAX_TEXT = 500;
/** A longer line is refused: an engineer has to look at it. */
const MAX_LINE_BYTES = 1024 * 1024;
const lenient = new TextDecoder("utf-8");
/** `--list` shows at most this many bytes of a line as text: a line of hundreds of megabytes is not decoded whole (1.4b's review). */
export const LISTED_BYTES = 8 * 1024;

/** Text as one line for a terminal: control characters (C0, DEL, C1), line and paragraph separators and bidirectional controls shown as spaces. */
export const printable = (s: unknown): string => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g, " ");

/** A line's bytes as text for reading: bytes that are not UTF-8 shown as U+FFFD, then made printable. */
export const shownText = (bytes: Buffer): string => printable(lenient.decode(bytes));

/**
 * Whether a gateway (or a run of the script) holds the folder's lock now, read from the database's list of locks held
 * (`pg_locks`) without taking the lock, even for a moment: a gateway starting meanwhile must not find it taken (1.4b's
 * review). A lock on a 64-bit key is listed with its high half as `classid`, its low half as `objid` and `objsubid` 1
 * (PostgreSQL documentation, pg_locks; docs/SOURCES.md).
 */
async function folderInUse(pool: pg.Pool, folderId: string): Promise<boolean> {
  const r = await pool.query<{ held: boolean }>(
    `select exists (
       select 1 from pg_locks l
        where l.locktype = 'advisory' and l.granted and l.objsubid = 1
          and l.database = (select oid from pg_database where datname = current_database())
          and ((l.classid::bigint << 32) | l.objid::bigint) = ${journalFolderLockKeySql("$1")}
     ) as held`,
    [folderId],
  );
  return r.rows[0]!.held;
}

async function openFolder(dir: string): Promise<FaultJournal> {
  try {
    return await FaultJournal.openExisting(dir);
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    throw new RecoveryRefused(
      "folder_not_found",
      `The journal folder or its id file could not be read (${typeof code === "string" ? code : "no code"}). A gateway makes the id file when it first opens the folder. ${NOTHING_CHANGED}`,
    );
  }
}

export interface UnreadableShown {
  number: number;
  length: number;
  fingerprint: string;
  why: Unreadable;
  /** The line as text, printable: what the operator reads to judge which call it may record. From `--list`, its first `LISTED_BYTES` bytes only. */
  text: string;
  /** After the review bot on 88e984b: from `--list`, the leftover of a rewrite cut short that alone holds it (its file name); `number` is then the line it will be in the journal file. */
  leftover?: string;
}

export interface Candidate {
  holdId: string;
  projectId: string;
  amountUsd: number;
  openedAt: string;
  deadlineAt: string;
  openedBy: string;
  step: string | null;
}

export interface SetAsideRow {
  id: string;
  set_aside_id: string;
  journal_folder_id: string;
  fingerprint: string;
  line_number: number;
  line_length: number;
  line_base64: string;
  line_shown: string;
  why_unreadable: string;
  pending_sha256_before: string;
  pending_sha256_after: string;
  project_id: string | null;
  hold_id: string | null;
  freeze_id: string | null;
  set_aside_by: string;
  reason: string;
  recorded_at: Date;
  moved_at: Date | null;
}

export interface JournalListing {
  dir: string;
  folderId: string;
  /** A gateway, or another run of the script, holds the folder's lock now. */
  inUse: boolean;
  file: { lines: number; size: number; sha256: string };
  unreadable: UnreadableShown[];
  /** Readable records still waiting: a gateway writes them into the database when it starts. */
  waiting: { number: number; journalId: string; projectId: string; holdId: string; endedAt: string; leftover?: string }[];
  /** After the review bot on 88e984b: leftovers of rewrites cut short in the folder; the lines only they hold are in `unreadable` and `waiting`, marked. */
  leftovers: { name: string; lines: number; size: number; sha256: string }[];
  candidates: Candidate[];
  /** This folder's set-asides recorded in the database, oldest first; `moved_at` null for one cut short. */
  setAsides: SetAsideRow[];
}

/** The open holds kept because their gateway was found gone, which no freeze names: the holds an unreadable line may stand for. */
export async function candidateHolds(pool: pg.Pool): Promise<Candidate[]> {
  const r = await pool.query<Hold>(
    `select h.* from holds h
      where h.state = 'open' and h.unreconciled and h.kept_reason = $1
        and not exists (select 1 from project_freezes f where f.hold_id = h.id)
      order by h.opened_at, h.id`,
    [OWNER_GONE],
  );
  return r.rows.map((h) => ({
    holdId: String(h.id),
    projectId: h.project_id,
    amountUsd: Number(h.amount_usd),
    openedAt: h.opened_at.toISOString(),
    deadlineAt: h.deadline_at.toISOString(),
    openedBy: h.gateway,
    step: h.step,
  }));
}

/** What the journal folder holds, for the operator. It only reads; it does not take the folder's lock. */
export async function listJournal(pool: pg.Pool, dir: string): Promise<JournalListing> {
  const journal = await openFolder(dir);
  const { lines, sha256, size } = await journal.lines();
  const leftovers = await journal.leftovers();
  const setAsides = (await pool.query<SetAsideRow>("select * from journal_set_asides where journal_folder_id = $1 order by id", [journal.folderId])).rows;
  const unreadable: UnreadableShown[] = [];
  const waiting: JournalListing["waiting"] = [];
  const show = (l: JournalLine, number: number, r: ReturnType<typeof readLine>, leftover?: string) => {
    const from = leftover === undefined ? {} : { leftover };
    if (r.kind === "unreadable") unreadable.push({ number, length: l.bytes.length, fingerprint: fingerprintOf(l.bytes), why: r.why, text: shownText(l.bytes.subarray(0, LISTED_BYTES)), ...from });
    if (r.kind === "record") waiting.push({ number, journalId: r.record.journal_id, projectId: r.record.project_id, holdId: r.record.hold_id, endedAt: r.record.ended_at, ...from });
  };
  for (const l of lines) show(l, l.number, readLine(l));
  // After the review bot on 88e984b: what leftovers alone hold, numbered as the next set-aside or gateway start adds it to the journal file.
  let next = lines.length;
  for (const a of onlyInLeftovers(lines, leftovers, new Set(setAsides.map((r) => r.fingerprint)))) show(a.line, ++next, a.read, a.leftover);
  return {
    dir,
    folderId: journal.folderId,
    inUse: await folderInUse(pool, journal.folderId),
    file: { lines: lines.length, size, sha256 },
    unreadable,
    waiting,
    leftovers: leftovers.map((l) => ({ name: l.name, lines: l.lines.length, size: l.size, sha256: l.sha256 })),
    candidates: await candidateHolds(pool),
    setAsides,
  };
}

export interface SetAsideRequest {
  dir: string;
  line: number;
  fingerprint: string;
  /** The hold the line may stand for, or null for a line shown to concern no open hold. */
  hold: string | null;
  by: string;
  reason: string;
}

export interface SetAside {
  setAsideId: string;
  rowId: string;
  line: UnreadableShown;
  hold: { id: string; projectId: string; amountUsd: number; freezeId: string; eventId: string; frozenEventId: string } | null;
  by: string;
  reason: string;
  /** The database's clock, at the record. */
  recordedAt: string;
  /** Lines the journal file holds after the move. */
  linesLeft: number;
  /** Earlier set-asides, cut short, that this run finished first (their line moved; nothing written to the database again). */
  finishedEarlier: string[];
  /**
   * True when this line's set-aside was recorded earlier (a run cut short, finished now) naming another hold than the one
   * asked for now, or a hold where none is asked, or none where one is: the earlier record stands (1.4b's review).
   */
  holdDiffersFromRequest: boolean;
}

function checkText(field: "by" | "reason", value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") throw new RecoveryRefused(`${field}_missing`, `--${field} is missing or empty. ${NOTHING_CHANGED}`);
  if ([...text].length > MAX_TEXT) throw new RecoveryRefused(`${field}_too_long`, `--${field} is longer than ${MAX_TEXT} characters. ${NOTHING_CHANGED}`);
  if (text.includes("\u0000") || LONE_SURROGATE_IN.test(text)) {
    throw new RecoveryRefused(`${field}_not_storable`, `--${field} holds a character the database cannot store (a NUL character, or half of a surrogate pair). ${NOTHING_CHANGED}`);
  }
  return text;
}

/** The set-aside file's entry for a recorded set-aside: everything needed to read the line again, and the row that records it. */
function entryFor(row: SetAsideRow): Record<string, unknown> {
  return {
    set_aside_id: row.set_aside_id,
    database_row: Number(row.id),
    recorded_at: row.recorded_at.toISOString(),
    journal_folder_id: row.journal_folder_id,
    line_number: row.line_number,
    line_length: row.line_length,
    fingerprint: row.fingerprint,
    why_unreadable: row.why_unreadable,
    line_base64: row.line_base64,
    project_id: row.project_id,
    hold_id: row.hold_id === null ? null : Number(row.hold_id),
    freeze_id: row.freeze_id === null ? null : Number(row.freeze_id),
    set_aside_by: row.set_aside_by,
    reason: row.reason,
  };
}

/** Unreadable lines of the journal file with this fingerprint. */
const unreadableWith = (lines: JournalLine[], fingerprint: string) => lines.filter((l) => readLine(l).kind === "unreadable" && fingerprintOf(l.bytes) === fingerprint);

/**
 * Move out of the journal file the lines of set-asides recorded but not yet moved (a run cut short), writing nothing
 * to the database for them again. While such a line is in the journal file, every gateway reading it stays closed and
 * appends nothing, so the one unreadable line with its fingerprint is that line; two would be unclear, and refused.
 */
async function finishEarlier(pool: pg.Pool, journal: FaultJournal, write: (w: RecoveryWrite) => Promise<void>): Promise<SetAsideRow[]> {
  const rows = (await pool.query<SetAsideRow>("select * from journal_set_asides where journal_folder_id = $1 and moved_at is null order by id", [journal.folderId])).rows;
  const finished: SetAsideRow[] = [];
  for (const row of rows) {
    const { lines } = await journal.lines();
    const same = unreadableWith(lines, row.fingerprint);
    if (same.length > 1) {
      throw new RecoveryRefused(
        "earlier_set_aside_unclear",
        `Set-aside ${row.set_aside_id} was recorded but its line was not moved out, and the journal file holds ${same.length} unreadable lines with its fingerprint: which one it was cannot be told. An engineer has to look. Nothing was changed.`,
      );
    }
    if (!(await journal.setAsides()).some((e) => e["set_aside_id"] === row.set_aside_id)) {
      await write("earlier: set-aside entry");
      await journal.appendSetAside(entryFor(row));
    }
    if (same.length === 1) {
      await write("earlier: journal line removed");
      await journal.removeLine(same[0]!.number, row.fingerprint);
    }
    await write("earlier: row marked moved");
    await pool.query("update journal_set_asides set moved_at = clock_timestamp() where id = $1 and moved_at is null", [row.id]);
    finished.push(row);
  }
  return finished;
}

/**
 * Set aside one unreadable line of the journal file: record it (with the hold's project frozen, when a hold is
 * named), then move it to the set-aside file. Refuses, having changed nothing for this line, with `RecoveryRefused`.
 * `databaseUrl` is for the folder's lock, held on a connection of its own for the whole run. After the review bot on
 * 88e984b: throws `RecoveryStopped`, having written nothing more, once that connection is lost.
 */
export async function setAsideLine(pool: pg.Pool, databaseUrl: string, req: SetAsideRequest, o: SetAsideOptions = {}): Promise<SetAside> {
  if (!Number.isInteger(req.line) || req.line < 1) throw new RecoveryRefused("line_not_valid", `A line number is a whole number from 1. ${NOTHING_CHANGED}`);
  const fingerprint = req.fingerprint.trim().toLowerCase().replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new RecoveryRefused("fingerprint_not_valid", `A fingerprint is the 64 hexadecimal characters --list prints. ${NOTHING_CHANGED}`);
  if (req.hold !== null && !/^[1-9][0-9]{0,17}$/.test(req.hold)) throw new RecoveryRefused("hold_id_not_valid", `A hold's id is a whole number above 0. ${NOTHING_CHANGED}`);
  const by = checkText("by", req.by);
  const reason = checkText("reason", req.reason);
  const journal = await openFolder(req.dir);

  // The folder's lock, for the whole run: no gateway uses the folder while it is held, and none can start.
  const lock = createClient(databaseUrl);
  // After the review bot on 88e984b: the connection's end, or an error on it, ends the lock (PostgreSQL releases a session's
  // locks when the session ends). Neither ends the process; an error's message, which can name the address, is not kept.
  let gotLock = false;
  let connectionLost = false;
  lock.on("error", () => (connectionLost = true));
  lock.on("end", () => (connectionLost = true));
  await lock.connect();
  const held = () => gotLock && !connectionLost;
  /** Right before each write: throws RecoveryStopped unless the lock is still held, by the flag, then by a query on the lock's own connection. */
  let last: RecoveryWrite = "absorb leftovers";
  const write = async (w: RecoveryWrite): Promise<void> => {
    last = w;
    await o.beforeWrite?.(w);
    if (held()) {
      try {
        await lock.query("select 1"); // the lock's own session still answers: it still holds the lock
      } catch {
        connectionLost = true;
      }
    }
    if (!held()) throw new RecoveryStopped(WRITES[w]);
  };
  try {
    const got = (await lock.query<{ got: boolean }>(`select pg_try_advisory_lock(${journalFolderLockKeySql("$1")}) as got`, [journal.folderId])).rows[0]!.got;
    if (!got) {
      throw new RecoveryRefused(
        "folder_in_use",
        `A gateway, or another run of this script, is using this journal folder now (it holds the folder's lock). Stop the gateway first: a running gateway reads its journal only when it starts. ${NOTHING_CHANGED}`,
      );
    }
    gotLock = true;
    // The journal's own rewrites and set-aside appends check the lock too, inside its queue (as the gateway's do).
    journal.guardWrites(held);
    // After the review bot on 88e984b: the leftover of a rewrite cut short is moved into the journal file first.
    if ((await journal.leftovers()).length > 0) {
      const setAside = await setAsideFingerprints(pool, journal.folderId);
      await write("absorb leftovers");
      await journal.absorbLeftovers(setAside);
    }
    const finishedRows = await finishEarlier(pool, journal, write);
    const finishedEarlier = finishedRows.map((r) => r.set_aside_id);
    // The same command run again after it was cut short: its own set-aside is the one just finished.
    const mine = finishedRows.find((r) => r.fingerprint === fingerprint);
    if (mine) {
      const earlier = await fromRow(pool, mine, finishedEarlier, (await journal.lines()).lines.length);
      return { ...earlier, holdDiffersFromRequest: (mine.hold_id === null ? null : String(mine.hold_id)) !== req.hold };
    }
    try {
      return await setAsideLocked(pool, journal, req, fingerprint, by, reason, finishedEarlier, write);
    } catch (err) {
      if (err instanceof RecoveryRefused && finishedEarlier.length > 0) {
        throw new RecoveryRefused(err.code, `${err.message} (First, set-aside(s) ${finishedEarlier.join(", ")}, recorded earlier but cut short, were finished: their lines moved out of the journal file.)`);
      }
      throw err;
    }
  } catch (err) {
    // The lock lost between the run's check and the journal's own (inside its queue): stopped all the same.
    if ((err as { code?: unknown }).code === "JOURNAL_FOLDER_NOT_HELD") throw new RecoveryStopped(WRITES[last]);
    throw err;
  } finally {
    await lock.end().catch(() => undefined); // the folder's lock ends with this session
  }
}

/** Each write in plain words, for `RecoveryStopped`'s message. */
const WRITES: Record<RecoveryWrite, string> = {
  "absorb leftovers": "moving the leftover of a rewrite cut short into the journal file",
  "earlier: set-aside entry": "writing an earlier set-aside's entry to the set-aside file",
  "earlier: journal line removed": "removing an earlier set-aside's line from the journal file",
  "earlier: row marked moved": "marking an earlier set-aside's row as moved",
  "record: row": "recording the set-aside in the database",
  "record: transaction": "recording the set-aside in the database",
  "record: commit": "committing the set-aside's record (it was rolled back: nothing of it is in the database)",
  "set-aside entry": "writing the line's entry to the set-aside file",
  "journal line removed": "removing the line from the journal file",
  "row marked moved": "marking the set-aside's row as moved",
};

/** What a set-aside recorded earlier, and just finished, says: read back from its row (and its freeze's events). */
async function fromRow(pool: pg.Pool, row: SetAsideRow, finishedEarlier: string[], linesLeft: number): Promise<SetAside> {
  let hold: SetAside["hold"] = null;
  if (row.hold_id !== null && row.project_id !== null && row.freeze_id !== null) {
    const evs = (
      await pool.query<{ id: string; kind: string }>(
        "select id, kind from events where project_id = $1 and kind in ('gateway.journal_line_set_aside', 'project.frozen') and payload->>'set_aside_id' = $2 order by id",
        [row.project_id, row.set_aside_id],
      )
    ).rows;
    const amount = (await pool.query<{ hold_amount_usd: string | null }>("select hold_amount_usd from project_freezes where id = $1", [row.freeze_id])).rows[0]?.hold_amount_usd ?? null;
    hold = {
      id: String(row.hold_id),
      projectId: row.project_id,
      amountUsd: Number(amount ?? 0),
      freezeId: String(row.freeze_id),
      eventId: evs.find((e) => e.kind === "gateway.journal_line_set_aside")?.id ?? "(not found)",
      frozenEventId: evs.find((e) => e.kind === "project.frozen")?.id ?? "(not found)",
    };
  }
  return {
    setAsideId: row.set_aside_id,
    rowId: String(row.id),
    line: { number: row.line_number, length: row.line_length, fingerprint: row.fingerprint, why: row.why_unreadable as Unreadable, text: row.line_shown },
    hold,
    by: row.set_aside_by,
    reason: row.reason,
    recordedAt: row.recorded_at.toISOString(),
    linesLeft,
    finishedEarlier,
    holdDiffersFromRequest: false,
  };
}

/** The set-aside itself, run while the folder's lock is held. */
async function setAsideLocked(
  pool: pg.Pool,
  journal: FaultJournal,
  req: SetAsideRequest,
  fingerprint: string,
  by: string,
  reason: string,
  finishedEarlier: string[],
  write: (w: RecoveryWrite) => Promise<void>,
): Promise<SetAside> {
  const { lines, sha256 } = await journal.lines();
  const before = (await pool.query<SetAsideRow>("select * from journal_set_asides where journal_folder_id = $1 and fingerprint = $2 order by id", [journal.folderId, fingerprint])).rows;
  if (before.length > 0 && unreadableWith(lines, fingerprint).length === 0) {
    const b = before[before.length - 1]!;
    throw new RecoveryRefused(
      "already_set_aside",
      `The line with this fingerprint was set aside already (set-aside ${b.set_aside_id}, ${b.recorded_at.toISOString()}, by ${printable(b.set_aside_by)}), and the journal file no longer holds it. ${NOTHING_CHANGED}`,
    );
  }
  const line = lines.find((l) => l.number === req.line);
  if (!line) throw new RecoveryRefused("line_out_of_range", `The journal file has ${lines.length} line(s); there is no line ${req.line}. ${NOTHING_CHANGED}`);
  const read = readLine(line);
  if (read.kind === "blank") throw new RecoveryRefused("line_blank", `Line ${req.line} is blank: it is skipped, and does not keep the gateway closed. ${NOTHING_CHANGED}`);
  if (read.kind === "record") throw new RecoveryRefused("line_readable", `Line ${req.line} is a record the gateway can read: it writes it into the database when it starts. ${NOTHING_CHANGED}`);
  const actual = fingerprintOf(line.bytes);
  if (actual !== fingerprint) {
    throw new RecoveryRefused("fingerprint_differs", `Line ${req.line}'s fingerprint is ${actual}, not the one given: the file may have changed since it was listed. Run --list again. ${NOTHING_CHANGED}`);
  }
  if (lines.some((l) => l !== line && fingerprintOf(l.bytes) === fingerprint)) {
    throw new RecoveryRefused("identical_lines", `Another line of the journal file has exactly the same bytes as line ${req.line}: which call each stands for cannot be told. An engineer has to look. ${NOTHING_CHANGED}`);
  }
  if (line.bytes.length > MAX_LINE_BYTES) throw new RecoveryRefused("line_too_long", `Line ${req.line} is longer than ${MAX_LINE_BYTES} bytes. An engineer has to look. ${NOTHING_CHANGED}`);

  const shown: UnreadableShown = { number: line.number, length: line.bytes.length, fingerprint, why: read.why, text: shownText(line.bytes) };
  const setAsideId = `sa_${randomBytes(8).toString("hex")}`;
  const after = fingerprintOf(joinLines(lines.filter((l) => l !== line)));
  const rowValues = (projectId: string | null, holdId: string | null, freezeId: string | null) => [
    setAsideId,
    journal.folderId,
    fingerprint,
    line.number,
    line.bytes.length,
    line.bytes.toString("base64"),
    shown.text,
    read.why,
    sha256,
    after,
    projectId,
    holdId,
    freezeId,
    by,
    reason,
  ];
  const INSERT_ROW = `insert into journal_set_asides(set_aside_id, journal_folder_id, fingerprint, line_number, line_length, line_base64, line_shown, why_unreadable,
                        pending_sha256_before, pending_sha256_after, project_id, hold_id, freeze_id, set_aside_by, reason)
                      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning *`;

  // 1. The record: in one transaction, under the hold's project's lock when a hold is named.
  let row: SetAsideRow;
  let hold: SetAside["hold"] = null;
  if (req.hold === null) {
    await write("record: row");
    row = (await pool.query<SetAsideRow>(INSERT_ROW, rowValues(null, null, null))).rows[0]!;
  } else {
    const holdId = req.hold;
    const owner = (await pool.query<{ project_id: string }>("select project_id from holds where id = $1", [holdId])).rows[0];
    if (!owner) throw new RecoveryRefused("unknown_hold", `There is no hold ${holdId}. ${NOTHING_CHANGED}`);
    const projectId = owner.project_id;
    await write("record: transaction");
    ({ row, hold } = await inTransaction(pool, projectId, async (c) => {
      await expireHoldsIn(c, projectId, new Date()); // as every budget decision does: a hold past its deadline counts as kept
      const h = (await c.query<Hold>("select * from holds where id = $1 and project_id = $2 for update", [holdId, projectId])).rows[0];
      if (!h) throw new RecoveryRefused("unknown_hold", `There is no hold ${holdId}. ${NOTHING_CHANGED}`);
      if (h.state !== "open") {
        throw new RecoveryRefused("hold_not_open", `Hold ${holdId} is closed: a freeze naming it could never be cleared by a reconciliation (known gap 100). ${NOTHING_CHANGED}`);
      }
      if (!h.unreconciled && !h.expired && h.kept_reason === null) {
        throw new RecoveryRefused(
          "hold_not_kept",
          `Hold ${holdId} is open for a call that has not ended (it is not kept at its full amount), so it is not on the unreconciled list and a freeze naming it could not be cleared. A gateway marks the holds of a gateway found gone when it starts. ${NOTHING_CHANGED}`,
        );
      }
      const costed = await c.query(
        `select 1 from events
          where project_id = $1 and kind = 'model.call'
            and case when jsonb_typeof(payload->'hold_id') = 'number' and (payload->>'hold_id') ~ '^[0-9]{1,18}$' then (payload->>'hold_id')::bigint end = $2
            and case when jsonb_typeof(payload->'cost_usd') = 'number' then (payload->>'cost_usd')::numeric >= 0 else false end`,
        [projectId, h.id],
      );
      if ((costed.rowCount ?? 0) > 0) {
        throw new RecoveryRefused("cost_already_recorded", `A model.call event already records a cost for hold ${holdId}; it could not be reconciled, so a freeze naming it could not be cleared. ${NOTHING_CHANGED}`);
      }
      const amount = Number(h.amount_usd);
      const freeze = (
        await c.query<Freeze>(
          `insert into project_freezes(project_id, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, record)
           values ($1, $2, $3, $4, $5, clock_timestamp(), $6, $7) returning *`,
          [
            projectId,
            h.id,
            `set-aside:${setAsideId}`,
            h.gateway,
            SET_ASIDE_FREEZE_REASON,
            h.amount_usd,
            JSON.stringify({
              set_aside_id: setAsideId,
              journal_folder_id: journal.folderId,
              line_number: line.number,
              fingerprint,
              why_unreadable: read.why,
              set_aside_by: by,
              reason,
              ended_at: "not known: this freeze's ended_at is when the line was set aside",
            }),
          ],
        )
      ).rows[0]!;
      const r = (await c.query<SetAsideRow>(INSERT_ROW, rowValues(projectId, String(h.id), String(freeze.id)))).rows[0]!;
      const eventId = await event(
        c,
        projectId,
        "gateway.journal_line_set_aside",
        {
          set_aside_id: setAsideId,
          set_aside_row: Number(r.id),
          journal_folder_id: journal.folderId,
          line_number: line.number,
          line_length: line.bytes.length,
          fingerprint,
          why_unreadable: read.why,
          line: shown.text,
          line_base64: r.line_base64,
          hold_id: Number(h.id),
          freeze_id: Number(freeze.id),
          set_aside_by: by,
          reason,
        },
        h.step,
      );
      const frozenEventId = await event(
        c,
        projectId,
        "project.frozen",
        { freeze_id: Number(freeze.id), journal_id: freeze.journal_id, hold_id: Number(h.id), hold_state: h.state, hold_amount_usd: amount, ended_at: null, reason: SET_ASIDE_FREEZE_REASON, set_aside_id: setAsideId },
        h.step,
      );
      await write("record: commit"); // lost now: the transaction is rolled back, and nothing of it is written
      return { row: r, hold: { id: String(h.id), projectId, amountUsd: amount, freezeId: String(freeze.id), eventId, frozenEventId } };
    }));
  }

  // 2. The move: the entry forced to disk in the set-aside file, then the journal file rewritten without the line.
  await write("set-aside entry");
  await journal.appendSetAside(entryFor(row));
  await write("journal line removed");
  await journal.removeLine(line.number, fingerprint);
  await write("row marked moved");
  await pool.query("update journal_set_asides set moved_at = clock_timestamp() where id = $1 and moved_at is null", [row.id]);
  return {
    setAsideId,
    rowId: String(row.id),
    line: shown,
    hold,
    by,
    reason,
    recordedAt: row.recorded_at.toISOString(),
    linesLeft: lines.length - 1,
    finishedEarlier,
    holdDiffersFromRequest: false,
  };
}
