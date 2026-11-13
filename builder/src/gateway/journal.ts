/**
 * Where the gateway keeps a model call's ending while the database refuses to record it (build plan
 * package 1.4; design note 5.5 step 5, amendment e; known gap 35's proposal; proof row B10).
 *
 * When the write that records a call's ending fails after the call was forwarded, the gateway:
 *   1. closes its gate at once, in memory, before anything else is awaited (`FaultGate.note`): from then
 *      on this gateway forwards nothing, for any project, and writes nothing for a refused request;
 *   2. appends the call's record as one JSON line to its journal file and forces it to disk
 *      (`FaultJournal.append`, fsync). If that fails, the gate stays closed and the record is kept in memory;
 *   3. writes the record into the database (`recordFreeze`: the project frozen, the hold kept open and
 *      unreconciled, the fault), and only then reopens its gate. It tries again before each request and
 *      in the 30-second hold keeper, and the start-up file replays the journal before taking calls;
 *   4. once written, moves the line to the journal's "done" file (copied there and forced to disk first,
 *      then the journal rewritten through a temporary file and a rename). Nothing is deleted.
 *
 * Every operation on the journal's files (an append, the read of what is waiting, a move to the done file)
 * passes through one queue per journal, each whole before the next begins (review bot on 2ad751d): an
 * append can no longer land between a move's read and its rename, where the rename dropped it (B10 (9)).
 *
 * Package 1.4b (the third outside review, item 1). A line of the journal that cannot be read (not JSON, JSON
 * not of a record's shape, not valid UTF-8, or a last line the file ends inside, with no line end, as a crash
 * during an append leaves it) may be the record of a call whose ending was not recorded, for a project that
 * cannot be told. Found at start-up (`FaultGate.replay`), it keeps the gate closed for EVERY project until an
 * operator recovers it (builder/scripts/journal-recover.ts) and the gateway is restarted: the journal is read
 * only at start-up. Readable lines in the same file are still replayed. Every rewrite of the journal file
 * keeps every line it does not move, an unreadable one included, byte for byte. An append to a file whose
 * last line has no line end starts with one, so the new record is not joined to that line.
 *
 * A journal belongs to one gateway process: its folder is fixed for a deployment
 * (BUILDER_GATEWAY_JOURNAL_DIR), not tied to the gateway's id, which is new at each start. Since package 1.4b
 * the folder has an id of its own (the file `journal-folder-id`, made by the first gateway to open it, written
 * whole under a temporary name and then linked to its own name, so it never exists empty), and a gateway started
 * by main.ts holds a lock on that id, beside its liveness lock (store/liveness.ts): a second gateway, or the
 * recovery script, cannot use the folder while it runs, on the same database. The record never holds the model
 * key: it is built from what the gateway would have stored, which is cleaned of the key first.
 *
 * After 1.4b's review. While the gateway does not hold that lock (its database connection is down), the journal
 * refuses its rewrites (a move to the done file) but still appends: an append only adds a line, and a call's
 * ending must reach the disk above all while the database cannot be reached (design note 5.5 step 5). An append
 * can then meet a rewrite by another process (the recovery script, which may hold the lock meanwhile): a rewrite
 * reads the file through one open handle, renames its new file over the old one, then carries over into the new
 * file any bytes appended to the old one after it was read; an append whose file was replaced while it wrote
 * writes its line again into the file now there. A line can so be written twice, which is harmless (a record is
 * known by its id); it is not lost.
 *
 * After the review bot on 88e984b. The carry-over runs after the rename, so a rewrite that stopped between the two (a
 * crash, a kill, an I/O error) left an append that had already returned only in the old file, which no name reached any
 * more: it was lost. Now a rewrite first gives the old file a second name in the same folder (a hard link,
 * `unrecorded-endings.jsonl.prev-<id>`, with the folder forced to disk), and removes that name only once everything
 * appended to the old file is in the new one and forced to disk. A rewrite stopped at any point so leaves every
 * acknowledged line on disk, under one name or the other. The gateway at start-up and the recovery script under the
 * folder's lock read such a leftover beside the journal file and move into the journal file what it alone holds
 * (`absorbLeftovers`), then remove it; `--list` shows it. A record is counted once (by its journal id); an unreadable line
 * once (by its fingerprint), and not at all when it is in a leftover only and journal_set_asides records its
 * fingerprint for this folder (it was set aside; the leftover is the file as it was before the set-aside's removal).
 * When that cannot be read, every unreadable line of a leftover counts: it fails closed.
 *
 * What is shown and what is not: a process killed with SIGKILL after the line was forced to disk leaves
 * it in the file (proof row B10, case 3). That the line survives a power cut rests on fsync doing what
 * the operating system documents; it is designed, not shown.
 */
import { createHash, randomBytes } from "node:crypto";
import { link, mkdir, open, readdir, readFile, rename, stat, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import { recordFreeze, type UnrecordedEnding } from "../store/freezes.js";

const JOURNAL = "unrecorded-endings.jsonl";
const DONE = "unrecorded-endings.done.jsonl";
/** Package 1.4b: the lines an operator has set aside, moved out of the journal file (builder/scripts/journal-recover.ts). */
const SET_ASIDE = "unrecorded-endings.set-aside.jsonl";
/** Package 1.4b: the folder's own id, made by the first gateway to open it. */
const FOLDER_ID = "journal-folder-id";
const FOLDER_ID_SHAPE = /^jf_[0-9a-f]{32}$/;
/**
 * After the review bot on 88e984b: the second name a rewrite gives the journal file it replaces, kept until what was
 * appended to that file is in the new one. One left in the folder is a rewrite cut short (`absorbLeftovers`).
 */
const LEFTOVER_PREFIX = `${JOURNAL}.prev-`;
const LEFTOVER_SHAPE = /^unrecorded-endings\.jsonl\.prev-[0-9a-f]{16}$/;
const NL = Buffer.from("\n");

/** One line of the journal file as it is on disk: its bytes without the line end, and whether it had one. */
export interface JournalLine {
  /** Its line number in the file, counting from 1; every line counts, blank ones too. */
  number: number;
  bytes: Buffer;
  /** False only for a last line the file ends inside. */
  ended: boolean;
}

/** Why a line cannot be read. */
export type Unreadable = "torn: the file ends inside it, with no line end" | "not valid UTF-8" | "not JSON" | "JSON, but not a record's shape";

/** A line of the journal file that cannot be read (package 1.4b). */
export interface UnreadableLine {
  number: number;
  /** Its length in bytes, without its line end. */
  length: number;
  /** SHA-256 of its bytes (without its line end), in hex: the line's fingerprint. */
  fingerprint: string;
  why: Unreadable;
  bytes: Buffer;
  /** After the review bot on 88e984b: the leftover of a rewrite cut short that alone holds it (its file name), if not the journal file. */
  leftover?: string;
}

/** After the review bot on 88e984b: a leftover of a rewrite cut short, as it is on disk. */
export interface Leftover {
  /** Its file name in the journal folder. */
  name: string;
  lines: JournalLine[];
  size: number;
  sha256: string;
}

/**
 * After the review bot on 88e984b: the lines a leftover alone holds, beside the journal file's `lines`, in the leftover's
 * order: a record whose journal id neither holds yet; an unreadable line whose fingerprint neither holds yet, unless
 * `setAside` (journal_set_asides' fingerprints for the folder) has it. With `setAside` null, none is known set aside: every
 * such line counts (it fails closed). Blank lines are not taken. Leftovers are taken in the order given; what one adds
 * counts as held for the next.
 */
export function onlyInLeftovers(
  lines: JournalLine[],
  leftovers: Leftover[],
  setAside: ReadonlySet<string> | null,
): Array<{ leftover: string; line: JournalLine; read: { kind: "record"; record: UnrecordedEnding } | { kind: "unreadable"; why: Unreadable } }> {
  const ids = new Set<string>();
  const prints = new Set<string>();
  for (const l of lines) {
    const r = readLine(l);
    if (r.kind === "record") ids.add(r.record.journal_id);
    else if (r.kind === "unreadable") prints.add(fingerprintOf(l.bytes));
  }
  const out: ReturnType<typeof onlyInLeftovers> = [];
  for (const lf of leftovers) {
    for (const l of lf.lines) {
      const r = readLine(l);
      if (r.kind === "record") {
        if (ids.has(r.record.journal_id)) continue;
        ids.add(r.record.journal_id);
        out.push({ leftover: lf.name, line: l, read: r });
      } else if (r.kind === "unreadable") {
        const fp = fingerprintOf(l.bytes);
        if (prints.has(fp) || setAside?.has(fp)) continue;
        prints.add(fp);
        out.push({ leftover: lf.name, line: l, read: r });
      }
    }
  }
  return out;
}

/** Split a journal file's bytes into its lines, each kept byte for byte. */
export function splitLines(buf: Buffer): JournalLine[] {
  const out: JournalLine[] = [];
  for (let start = 0, n = 1; start < buf.length; n++) {
    const end = buf.indexOf(0x0a, start);
    if (end === -1) {
      out.push({ number: n, bytes: buf.subarray(start), ended: false });
      break;
    }
    out.push({ number: n, bytes: buf.subarray(start, end), ended: true });
    start = end + 1;
  }
  return out;
}

/** The bytes of these lines, each with its line end if it had one. */
export const joinLines = (lines: JournalLine[]): Buffer => Buffer.concat(lines.flatMap((l) => (l.ended ? [l.bytes, NL] : [l.bytes])));

export const fingerprintOf = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** Whether a parsed value has the shape of a record the gateway writes: every field recordFreeze reads, of its type. */
export function isUnrecordedEnding(v: unknown): v is UnrecordedEnding {
  const obj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
  if (!obj(v)) return false;
  const text = (x: unknown) => typeof x === "string" && x.length > 0;
  const textOrNull = (x: unknown) => x === null || typeof x === "string";
  return (
    text(v["journal_id"]) &&
    text(v["gateway"]) &&
    text(v["project_id"]) &&
    typeof v["hold_id"] === "string" &&
    /^[1-9][0-9]{0,17}$/.test(v["hold_id"]) &&
    textOrNull(v["step"]) &&
    typeof v["ended_at"] === "string" &&
    Number.isFinite(Date.parse(v["ended_at"])) &&
    (v["ending"] === "settle" || v["ending"] === "keep") &&
    textOrNull(v["kept_reason"]) &&
    (v["cost_usd_as_read"] === null || (typeof v["cost_usd_as_read"] === "number" && Number.isFinite(v["cost_usd_as_read"]))) &&
    obj(v["call"]) &&
    obj(v["error"]) &&
    typeof v["error"]["name"] === "string" &&
    (v["error"]["code"] === undefined || typeof v["error"]["code"] === "string" || typeof v["error"]["code"] === "number")
  );
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/** What one line of the journal file is: blank, a record, or unreadable (and why). */
export function readLine(l: JournalLine): { kind: "blank" } | { kind: "record"; record: UnrecordedEnding } | { kind: "unreadable"; why: Unreadable } {
  let text: string;
  try {
    text = strictUtf8.decode(l.bytes);
  } catch {
    return { kind: "unreadable", why: "not valid UTF-8" };
  }
  if (text.trim() === "") return { kind: "blank" };
  // A last line with no line end may be a record cut short by a crash during its append: never taken as read.
  if (!l.ended) return { kind: "unreadable", why: "torn: the file ends inside it, with no line end" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "unreadable", why: "not JSON" };
  }
  return isUnrecordedEnding(parsed) ? { kind: "record", record: parsed } : { kind: "unreadable", why: "JSON, but not a record's shape" };
}

/** Read the journal file's lines: none if it does not exist. Any other error (it cannot be read) is thrown. */
async function readLines(file: string): Promise<{ lines: JournalLine[]; sha256: string; size: number }> {
  let buf: Buffer;
  try {
    buf = await readFile(file);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return { lines: [], sha256: fingerprintOf(Buffer.alloc(0)), size: 0 };
    throw err;
  }
  return { lines: splitLines(buf), sha256: fingerprintOf(buf), size: buf.length };
}

/** The folder's id, read from its id file; made first if `create` and there is none. Throws if it cannot be read, or is not an id. */
async function folderIdIn(dir: string, create: boolean): Promise<string> {
  const file = join(dir, FOLDER_ID);
  const read = async (): Promise<string> => {
    const id = (await readFile(file, "utf8")).trim();
    if (!FOLDER_ID_SHAPE.test(id)) throw Object.assign(new Error("The journal folder's id file does not hold a folder id."), { code: "JOURNAL_FOLDER_ID_NOT_VALID" });
    return id;
  };
  try {
    return await read();
  } catch (err) {
    if ((err as { code?: string }).code !== "ENOENT" || !create) throw err;
  }
  const id = `jf_${randomBytes(16).toString("hex")}`;
  // Written whole, and forced to disk, under a temporary name; then linked to its own name, which fails if the name is
  // taken. The id file so never exists empty or half written, even if the process stops part-way (1.4b's review).
  const tmp = join(dir, `.${FOLDER_ID}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    const fh = await open(tmp, "wx");
    try {
      await fh.writeFile(id + "\n");
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      await link(tmp, file);
    } catch (err) {
      if ((err as { code?: string }).code === "EEXIST") return await read(); // another gateway starting made it first
      throw err;
    }
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
  await syncDir(dir);
  return id;
}

export class FaultJournal {
  readonly file: string;
  readonly doneFile: string;
  /** Package 1.4b: where an operator's set-aside moves an unreadable line (builder/scripts/journal-recover.ts). */
  readonly setAsideFile: string;
  /** The tail of this journal's queue: every file operation waits for the one before it, failed or not. One process only (known gap 105). */
  private queue: Promise<void> = Promise.resolve();
  /**
   * Package 1.4b: while this returns false, the journal refuses its rewrites and the set-aside file's appends (main.ts:
   * while the gateway does not hold its folder's lock). Its own appends are never refused (1.4b's review).
   */
  private mayWrite: () => boolean = () => true;
  private constructor(
    readonly dir: string,
    /** Package 1.4b: the folder's own id, the key of its lock. */
    readonly folderId: string,
  ) {
    this.file = join(dir, JOURNAL);
    this.doneFile = join(dir, DONE);
    this.setAsideFile = join(dir, SET_ASIDE);
  }

  /**
   * Open the journal in this folder, creating it and its id file if needed. Throws if a file cannot be written
   * and forced to disk there, or if its id file cannot be read.
   */
  static async open(dir: string): Promise<FaultJournal> {
    await mkdir(dir, { recursive: true });
    const probe = join(dir, `.write-check-${randomBytes(4).toString("hex")}`);
    const fh = await open(probe, "w");
    try {
      await fh.writeFile("check\n");
      await fh.sync();
    } finally {
      await fh.close();
    }
    await unlink(probe);
    return new FaultJournal(dir, await folderIdIn(dir, true));
  }

  /** Open an existing journal folder for its recovery (package 1.4b): nothing is created; throws if the folder or its id file is missing or cannot be read. */
  static async openExisting(dir: string): Promise<FaultJournal> {
    return new FaultJournal(dir, await folderIdIn(dir, false));
  }

  /**
   * Package 1.4b: from now on, refuse every rewrite of the journal file (and every append to the set-aside file) while
   * `ok` returns false (main.ts passes the gateway's lock on the folder). Appends to the journal file go on: a call's
   * ending must reach the disk while the database cannot be reached (1.4b's review).
   */
  guardWrites(ok: () => boolean): void {
    this.mayWrite = ok;
  }

  private checkMayWrite(): void {
    if (!this.mayWrite()) {
      throw Object.assign(new Error("The gateway does not hold its journal folder's lock now; it moves nothing in the journal file until it does (it still appends to it)."), {
        code: "JOURNAL_FOLDER_NOT_HELD",
      });
    }
  }

  /** Run one operation on the journal's files once every one queued before it has ended. */
  private serial<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Append one record as a line and force it to disk. A file whose last line has no line end gets one first. Never
   * refused for the folder's lock (1.4b's review): if the file was replaced while the line was written, it is written
   * again into the file now there (`appendWhole`).
   */
  append(rec: UnrecordedEnding): Promise<void> {
    const line = Buffer.from(JSON.stringify(rec) + "\n");
    return this.serial(() => appendWhole(this.file, line));
  }

  /**
   * The records in the journal not yet written to the database, and the lines that could not be read. Throws if the file
   * exists and cannot be read. After the review bot on 88e984b: with the lines that leftovers of rewrites cut short alone
   * hold (`onlyInLeftovers`; `setAside`, the folder's set-aside fingerprints, or null when they are not known: then every
   * unreadable line of a leftover counts). Throws if a leftover cannot be read.
   */
  pending(setAside: ReadonlySet<string> | null = null): Promise<{ records: UnrecordedEnding[]; unreadable: UnreadableLine[] }> {
    return this.serial(() => this.readPending(setAside));
  }

  /** After the review bot on 88e984b: the leftovers of rewrites cut short in this folder, by name, as they are on disk (none, usually). */
  leftovers(): Promise<Leftover[]> {
    return this.serial(() => this.readLeftovers());
  }

  /**
   * After the review bot on 88e984b, under the folder's lock (the gateway at start-up, the recovery script): append to
   * the journal file, forced to disk, the lines leftovers of rewrites cut short alone hold (`onlyInLeftovers`, with the
   * folder's set-aside fingerprints), each leftover's in its order and on lines of their own; then remove the leftovers,
   * the folder forced to disk. Stopped part-way, it leaves each line in a leftover or the journal file, or both, which
   * the next run reads as one. Returns the leftovers removed and the lines added.
   */
  absorbLeftovers(setAside: ReadonlySet<string>): Promise<{ removed: string[]; added: number }> {
    return this.serial(async () => {
      this.checkMayWrite();
      const leftovers = await this.readLeftovers();
      if (leftovers.length === 0) return { removed: [], added: 0 };
      const adding = onlyInLeftovers((await readLines(this.file)).lines, leftovers, setAside).map((a) => a.line);
      if (adding.length > 0) {
        // On lines of their own, as appends write them: a line with no line end (only a leftover's last can be one) gets one when another follows.
        const bytes = Buffer.concat(adding.flatMap((l, i) => (i < adding.length - 1 || l.ended ? [l.bytes, NL] : [l.bytes])));
        this.checkMayWrite();
        await appendWhole(this.file, bytes);
      }
      for (const lf of leftovers) {
        this.checkMayWrite();
        await unlink(join(this.dir, lf.name));
      }
      await syncDir(this.dir);
      return { removed: leftovers.map((l) => l.name), added: adding.length };
    });
  }

  /** Every line of the journal file as it is on disk, with the file's SHA-256 (package 1.4b, for the recovery script). */
  lines(): Promise<{ lines: JournalLine[]; sha256: string; size: number }> {
    return this.serial(() => readLines(this.file));
  }

  /** Move a recorded line to the done file: copied there and forced to disk first, then removed from the journal by a rewrite and a rename. The whole move is one operation of the queue. */
  markDone(journalId: string): Promise<void> {
    return this.serial(() => this.moveToDone(journalId));
  }

  /**
   * Package 1.4b, for the recovery script: rewrite the journal file without its line `number`, which must still have
   * this fingerprint; every other line is kept byte for byte, and lines a gateway appends meanwhile are carried over.
   * Returns the file's SHA-256 before, and as renamed into place (before any bytes carried over).
   */
  removeLine(number: number, fingerprint: string): Promise<{ before: string; after: string; carriedOver: number }> {
    return this.serial(async () => {
      this.checkMayWrite();
      const r = await this.rewriteWithout((lines) => {
        const line = lines.find((l) => l.number === number);
        if (!line || fingerprintOf(line.bytes) !== fingerprint) {
          throw Object.assign(new Error(`Line ${number} of the journal file is not the line with that fingerprint; nothing was removed.`), { code: "JOURNAL_LINE_MOVED" });
        }
        return [line];
      });
      return r!; // a line was chosen, or it threw
    });
  }

  /**
   * Package 1.4b, for the recovery script: append one entry to the set-aside file and force it to disk, on a line of its
   * own even when the file's last entry was cut short by a crash (1.4b's review).
   */
  appendSetAside(entry: Record<string, unknown>): Promise<void> {
    return this.serial(async () => {
      this.checkMayWrite();
      await appendWhole(this.setAsideFile, Buffer.from(JSON.stringify(entry) + "\n"));
    });
  }

  /** Package 1.4b, for the recovery script: the set-aside file's entries that can be read (none if it does not exist). */
  setAsides(): Promise<Record<string, unknown>[]> {
    return this.serial(async () => {
      const { lines } = await readLines(this.setAsideFile);
      const out: Record<string, unknown>[] = [];
      for (const l of lines) {
        try {
          const v: unknown = JSON.parse(l.bytes.toString("utf8"));
          if (v !== null && typeof v === "object" && !Array.isArray(v)) out.push(v as Record<string, unknown>);
        } catch {
          /* not an entry; it stays in the file as it is */
        }
      }
      return out;
    });
  }

  private async readPending(setAside: ReadonlySet<string> | null): Promise<{ records: UnrecordedEnding[]; unreadable: UnreadableLine[] }> {
    const { lines } = await readLines(this.file);
    const records: UnrecordedEnding[] = [];
    const unreadable: UnreadableLine[] = [];
    for (const l of lines) {
      const r = readLine(l);
      if (r.kind === "record") records.push(r.record);
      else if (r.kind === "unreadable") unreadable.push({ number: l.number, length: l.bytes.length, fingerprint: fingerprintOf(l.bytes), why: r.why, bytes: Buffer.from(l.bytes) });
    }
    // After the review bot on 88e984b: what leftovers of rewrites cut short alone hold, numbered as absorbLeftovers adds it.
    let next = lines.length;
    for (const a of onlyInLeftovers(lines, await this.readLeftovers(), setAside)) {
      next += 1;
      if (a.read.kind === "record") records.push(a.read.record);
      else unreadable.push({ number: next, length: a.line.bytes.length, fingerprint: fingerprintOf(a.line.bytes), why: a.read.why, bytes: Buffer.from(a.line.bytes), leftover: a.leftover });
    }
    return { records, unreadable };
  }

  /** The leftovers in the folder, sorted by name. Throws if the folder cannot be listed or a leftover cannot be read. */
  private async readLeftovers(): Promise<Leftover[]> {
    const names = (await readdir(this.dir)).filter((n) => n.startsWith(LEFTOVER_PREFIX) && LEFTOVER_SHAPE.test(n)).sort();
    const out: Leftover[] = [];
    for (const name of names) {
      const { lines, sha256, size } = await readLines(join(this.dir, name));
      out.push({ name, lines, size, sha256 });
    }
    return out;
  }

  private async moveToDone(journalId: string): Promise<void> {
    this.checkMayWrite();
    const isIt = (l: JournalLine) => {
      const r = readLine(l);
      return r.kind === "record" && r.record.journal_id === journalId;
    };
    // Package 1.4b: every other line is kept as it is on disk, byte for byte: an unreadable one, a blank one, a last one with no line end.
    await this.rewriteWithout(
      (lines) => lines.filter(isIt),
      (moving) => appendSynced(this.doneFile, joinLines(moving)),
    );
  }

  /**
   * Rewrite the journal file without the lines `pick` chooses from it, keeping every other line byte for byte: through a
   * temporary file forced to disk and a rename. `beforeRename` runs once they are chosen (the move to the done file
   * copies them there first). The file is read through one open handle, kept until the end: bytes another process
   * appended to that old file after it was read (it had opened the file before the rename) are then carried over to the
   * end of the new file (1.4b's review). Returns null when nothing was chosen (nothing is written then).
   *
   * After the review bot on 88e984b, in this order: (1) the old file gets a second name in the folder (a hard link, the
   * leftover name), checked to be the file read, and the folder is forced to disk; (2) the new file is written under a
   * temporary name and forced to disk; (3) it is renamed over the journal file, and the folder forced to disk; (4) what
   * was appended to the old file is carried over and forced to disk; (5) only then is the second name removed. Stopped
   * at any point, every line appended to the old file is on disk under the leftover name or in the journal file, and the
   * next gateway to start, or the recovery script, reads both (`pending`, `absorbLeftovers`). An error before the rename
   * removes the second name again (the journal file still names the old file); one after it leaves it.
   */
  private async rewriteWithout(
    pick: (lines: JournalLine[]) => JournalLine[],
    beforeRename?: (moving: JournalLine[]) => Promise<void>,
  ): Promise<{ before: string; after: string; carriedOver: number } | null> {
    let old: FileHandle;
    try {
      old = await open(this.file, "r");
    } catch (err) {
      if ((err as { code?: string }).code !== "ENOENT") throw err;
      pick([]); // no file: nothing to choose (removeLine's choice throws)
      return null;
    }
    try {
      const read = await old.readFile();
      const lines = splitLines(read);
      const moving = pick(lines);
      if (moving.length === 0) return null;
      await beforeRename?.(moving);
      const bytes = joinLines(lines.filter((l) => !moving.includes(l)));
      // (1) The old file's second name, before anything replaces it (review bot on 88e984b).
      const keep = join(this.dir, `${LEFTOVER_PREFIX}${randomBytes(8).toString("hex")}`);
      await link(this.file, keep);
      const oldStat = await old.stat();
      const kept = await stat(keep);
      const tmp = `${this.file}.${randomBytes(4).toString("hex")}.tmp`;
      try {
        if (kept.ino !== oldStat.ino || kept.dev !== oldStat.dev) {
          throw Object.assign(new Error("The journal file was replaced by another process while it was being rewritten; nothing was rewritten."), { code: "JOURNAL_FILE_REPLACED" });
        }
        await syncDir(this.dir);
        // (2) The new file, whole and forced to disk.
        const fh = await open(tmp, "w");
        try {
          await fh.writeFile(bytes);
          await fh.sync();
        } finally {
          await fh.close();
        }
        // (3) Into place.
        await rename(tmp, this.file);
      } catch (err) {
        await unlink(tmp).catch(() => undefined);
        // The journal file still names the old file: the second name holds nothing it does not, and goes.
        const now = await stat(this.file).catch(() => null);
        if (now !== null && now.ino === kept.ino && now.dev === kept.dev) await unlink(keep).catch(() => undefined);
        throw err;
      }
      await syncDir(this.dir);
      // (4) What was appended to the old file after it was read, carried over and forced to disk.
      const carriedOver = await this.carryOver(old, read.length);
      // (5) Only now is the old file's second name removed.
      await unlink(keep);
      await syncDir(this.dir);
      return { before: fingerprintOf(read), after: fingerprintOf(bytes), carriedOver };
    } finally {
      await old.close();
    }
  }

  /**
   * Copy to the end of the journal file the bytes appended to a file it replaced, after `from` (what the rewrite read).
   * A line still being written ends within moments: while the bytes do not end with a line end, this waits up to a
   * second for it; one still cut after that is copied as it is (it then cannot be read, and closes the next gateway to
   * start: it fails closed). The process writing it also sees its file replaced and writes its line again into the new
   * one (`appendWhole`), so the line may be there twice, which is harmless. Returns how many bytes were carried over.
   */
  private async carryOver(old: FileHandle, from: number): Promise<number> {
    let extra = await bytesFrom(old, from);
    for (let waited = 0; extra.length > 0 && extra[extra.length - 1] !== 0x0a && waited < CARRY_OVER_WAIT_MS; waited += 20) {
      await new Promise((r) => setTimeout(r, 20));
      extra = await bytesFrom(old, from);
    }
    if (extra.length > 0) await appendWhole(this.file, extra);
    return extra.length;
  }
}

/** How long a rewrite waits for a line being written into the file it replaced to end (`carryOver`). */
const CARRY_OVER_WAIT_MS = 1_000;

async function appendSynced(file: string, text: string | Buffer): Promise<void> {
  const fh = await open(file, "a");
  try {
    await fh.writeFile(text);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** The file's bytes from `from` to its end, read through this handle. */
async function bytesFrom(fh: FileHandle, from: number): Promise<Buffer> {
  const size = (await fh.stat()).size;
  if (size <= from) return Buffer.alloc(0);
  const buf = Buffer.alloc(size - from);
  let got = 0;
  while (got < buf.length) {
    const { bytesRead } = await fh.read(buf, got, buf.length - got, from + got);
    if (bytesRead === 0) break;
    got += bytesRead;
  }
  return buf.subarray(0, got);
}

/**
 * Append bytes to a file and force them to disk, on a line of their own: after a line end if the file's last line has
 * none (a crash during an append leaves one). Then check that the file at that name is still the one written to: if
 * another process's rewrite renamed a new file over it meanwhile, having read it before these bytes landed, they are
 * written again into the file now there (1.4b's review). They are then in it at least once, at most twice.
 */
async function appendWhole(file: string, data: Buffer): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const fh = await open(file, "a+"); // appends; readable, for its last byte
    let wroteTo: { ino: number; dev: number };
    try {
      const st = await fh.stat();
      wroteTo = { ino: st.ino, dev: st.dev };
      let endsInsideALine = false;
      if (st.size > 0) {
        const one = Buffer.alloc(1);
        await fh.read(one, 0, 1, st.size - 1);
        endsInsideALine = one[0] !== 0x0a;
      }
      await fh.writeFile(endsInsideALine ? Buffer.concat([NL, data]) : data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    const now = await stat(file).catch(() => null);
    if (now !== null && now.ino === wroteTo.ino && now.dev === wroteTo.dev) return;
    if (attempt >= 5) throw Object.assign(new Error("The journal file was replaced each time a line was written to it."), { code: "JOURNAL_FILE_REPLACED" });
  }
}

/** Force the folder's own entry list to disk after a rename (best effort: not every system allows it). */
async function syncDir(dir: string): Promise<void> {
  try {
    const fh = await open(dir, "r");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
    /* not available here; the rename itself is still done */
  }
}

/**
 * The gateway's gate: closed while any call's ending is unrecorded, and (package 1.4b) from start-up on while
 * the journal held a line that could not be read. One per gateway process. Without a journal (in tests) it
 * keeps the records in memory only.
 */
export class FaultGate {
  private readonly waiting: Array<{ rec: UnrecordedEnding; journaled: boolean; appending?: Promise<void> }> = [];
  private draining: Promise<boolean> | null = null;
  /** Package 1.4b: the journal's lines that could not be read when it was replayed. Nothing in this process clears them: the gateway is restarted after their recovery. */
  private unreadable: UnreadableLine[] = [];
  constructor(private readonly o: { pool: pg.Pool; journal?: FaultJournal | null; onFault?: (message: string, detail: unknown) => void }) {}

  /** True while a call's ending is unrecorded, or the journal held a line that could not be read: the gateway then forwards nothing. */
  closed(): boolean {
    return this.waiting.length > 0 || this.unreadable.length > 0;
  }

  /** Package 1.4b: the journal's lines that could not be read at start-up. While there is one, the gateway forwards nothing, for any project. */
  unreadableLines(): readonly UnreadableLine[] {
    return this.unreadable;
  }

  /** The oldest unrecorded ending, for the refusal's message. */
  oldest(): UnrecordedEnding | null {
    return this.waiting[0]?.rec ?? null;
  }

  /** Close the gate for this record. Synchronous on purpose: it takes effect before anything else is awaited. */
  note(rec: UnrecordedEnding): void {
    if (!this.waiting.some((w) => w.rec.journal_id === rec.journal_id)) this.waiting.push({ rec, journaled: false });
  }

  /**
   * Append the record to the journal and force it to disk. A failure leaves the gate closed and the record in memory.
   * One append per record at a time: a drain that reaches the record while its append waits in the journal's
   * queue waits for that append instead of queueing a second line.
   */
  async persist(journalId: string): Promise<void> {
    const w = this.waiting.find((x) => x.rec.journal_id === journalId);
    const journal = this.o.journal;
    if (!w || w.journaled || !journal) return;
    w.appending ??= journal
      .append(w.rec)
      .then(
        () => {
          w.journaled = true;
        },
        (err: unknown) => {
          this.o.onFault?.("A call's ending could not be written to the gateway's journal file either. The gateway forwards nothing until it is written to the event log.", { journal_id: journalId, error: summary(err) });
        },
      )
      .finally(() => {
        w.appending = undefined;
      });
    await w.appending;
  }

  /**
   * Load the journal's lines not yet written (at start-up, before taking calls) and try to write them. A line
   * that cannot be read closes the gate for every project from here on (package 1.4b): it may be the record of a
   * call whose ending was not recorded, for a project that cannot be told. The readable lines are still written.
   * Throws, changing nothing, if the journal file exists and cannot be read (main.ts then does not start).
   */
  async replay(): Promise<{ loaded: number; unreadable: number; recorded: boolean }> {
    if (!this.o.journal) return { loaded: 0, unreadable: 0, recorded: this.waiting.length === 0 };
    // After the review bot on 88e984b: leftovers of rewrites cut short are read beside the journal file, and moved into it.
    let setAside: ReadonlySet<string> | null = null;
    if ((await this.o.journal.leftovers()).length > 0) {
      setAside = await setAsideFingerprints(this.o.pool, this.o.journal.folderId).catch(() => null);
      if (setAside === null) {
        this.o.onFault?.(
          "The gateway's journal folder holds the leftover of a rewrite cut short, and the lines set aside could not be read from the database: every line of the leftover that cannot be read counts, and the leftover is kept for the next start.",
          { dir: this.o.journal.dir },
        );
      } else {
        await this.o.journal.absorbLeftovers(setAside).catch((err: unknown) =>
          this.o.onFault?.("The leftover of a rewrite cut short could not be moved into the gateway's journal file; its lines are read from it, and it is kept for the next start.", { dir: this.o.journal!.dir, error: summary(err) }),
        );
      }
    }
    const { records, unreadable } = await this.o.journal.pending(setAside);
    if (unreadable.length > 0) this.unreadable = unreadable; // before anything else is awaited
    for (const rec of records) if (!this.waiting.some((w) => w.rec.journal_id === rec.journal_id)) this.waiting.push({ rec, journaled: true });
    if (unreadable.length > 0) {
      this.o.onFault?.(
        "Lines of the gateway's journal could not be read. Each may be the record of a model call whose ending was not recorded, so the gateway forwards nothing, for any project, until an operator recovers them (builder/scripts/journal-recover.ts) and restarts it.",
        { file: this.o.journal.file, lines: unreadable.map((u) => ({ line: u.number, bytes: u.length, why: u.why, fingerprint: u.fingerprint })) },
      );
    }
    const recorded = await this.drain();
    return { loaded: records.length, unreadable: unreadable.length, recorded };
  }

  /** Write every waiting record to the database, oldest first. Returns true when none is left. One drain at a time. */
  drain(): Promise<boolean> {
    if (this.waiting.length === 0) return Promise.resolve(true);
    if (!this.draining) {
      this.draining = this.drainOnce().finally(() => {
        this.draining = null;
      });
    }
    return this.draining;
  }

  private async drainOnce(): Promise<boolean> {
    while (this.waiting.length > 0) {
      const w = this.waiting[0]!;
      if (!w.journaled) await this.persist(w.rec.journal_id);
      try {
        await recordFreeze(this.o.pool, w.rec);
      } catch {
        return false; // the database still refuses: the gate stays closed
      }
      if (w.journaled && this.o.journal) {
        // Already in the database: a line left in the journal by a failure here is replayed harmlessly (it adds nothing).
        await this.o.journal.markDone(w.rec.journal_id).catch((err: unknown) =>
          this.o.onFault?.("A recorded line could not be moved out of the gateway's journal; it is replayed harmlessly at the next start.", { journal_id: w.rec.journal_id, error: summary(err) }),
        );
      }
      this.waiting.shift();
    }
    return true;
  }
}

/** After the review bot on 88e984b: the fingerprints of the lines recorded as set aside for this journal folder (builder/scripts/journal-recover.ts). */
export async function setAsideFingerprints(pool: Pick<pg.Pool, "query">, folderId: string): Promise<Set<string>> {
  const r = await pool.query<{ fingerprint: string }>("select distinct fingerprint from journal_set_asides where journal_folder_id = $1", [folderId]);
  return new Set(r.rows.map((x) => x.fingerprint));
}

function summary(err: unknown): { name: string; code?: string } {
  const e = err as { name?: string; code?: string };
  return { name: e?.name ?? "Error", code: e?.code };
}

/** A new journal id: unique per unrecorded ending. */
export const newJournalId = (): string => `j_${Date.now().toString(36)}_${randomBytes(8).toString("hex")}`;
