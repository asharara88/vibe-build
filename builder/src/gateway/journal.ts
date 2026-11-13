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
 * A journal belongs to one gateway process: its folder is fixed for a deployment
 * (BUILDER_GATEWAY_JOURNAL_DIR), not tied to the gateway's id, which is new at each start. One process per
 * folder is not enforced (known gaps). The record never holds the model key: it is built from what the
 * gateway would have stored, which is cleaned of the key first.
 *
 * What is shown and what is not: a process killed with SIGKILL after the line was forced to disk leaves
 * it in the file (proof row B10, case 3). That the line survives a power cut rests on fsync doing what
 * the operating system documents; it is designed, not shown.
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import { recordFreeze, type UnrecordedEnding } from "../store/freezes.js";

const JOURNAL = "unrecorded-endings.jsonl";
const DONE = "unrecorded-endings.done.jsonl";

export class FaultJournal {
  readonly file: string;
  readonly doneFile: string;
  private constructor(readonly dir: string) {
    this.file = join(dir, JOURNAL);
    this.doneFile = join(dir, DONE);
  }

  /** Open the journal in this folder, creating it if needed. Throws if a file cannot be written and forced to disk there. */
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
    return new FaultJournal(dir);
  }

  /** Append one record as a line and force it to disk. */
  async append(rec: UnrecordedEnding): Promise<void> {
    await appendSynced(this.file, JSON.stringify(rec) + "\n");
  }

  /** The records in the journal not yet written to the database, and the lines that could not be read. */
  async pending(): Promise<{ records: UnrecordedEnding[]; unreadable: string[] }> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return { records: [], unreadable: [] };
      throw err;
    }
    const records: UnrecordedEnding[] = [];
    const unreadable: string[] = [];
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const r = JSON.parse(line) as UnrecordedEnding;
        if (typeof r.journal_id !== "string" || typeof r.project_id !== "string") throw new Error("not a record");
        records.push(r);
      } catch {
        unreadable.push(line);
      }
    }
    return { records, unreadable };
  }

  /** Move a recorded line to the done file: copied there and forced to disk first, then removed from the journal by a rewrite and a rename. */
  async markDone(journalId: string): Promise<void> {
    const text = await readFile(this.file, "utf8").catch(() => "");
    const lines = text.split("\n").filter((l) => l.trim() !== "");
    const isIt = (l: string) => {
      try {
        return (JSON.parse(l) as { journal_id?: unknown }).journal_id === journalId;
      } catch {
        return false;
      }
    };
    const moving = lines.filter(isIt);
    if (moving.length === 0) return;
    await appendSynced(this.doneFile, moving.join("\n") + "\n");
    const keep = lines.filter((l) => !isIt(l));
    const tmp = `${this.file}.${randomBytes(4).toString("hex")}.tmp`;
    const fh = await open(tmp, "w");
    try {
      await fh.writeFile(keep.length ? keep.join("\n") + "\n" : "");
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, this.file);
    await syncDir(this.dir);
  }
}

async function appendSynced(file: string, text: string): Promise<void> {
  const fh = await open(file, "a");
  try {
    await fh.writeFile(text);
    await fh.sync();
  } finally {
    await fh.close();
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
 * The gateway's gate: closed while any call's ending is unrecorded. One per gateway process. Without a
 * journal (in tests) it keeps the records in memory only.
 */
export class FaultGate {
  private readonly waiting: Array<{ rec: UnrecordedEnding; journaled: boolean }> = [];
  private draining: Promise<boolean> | null = null;
  constructor(private readonly o: { pool: pg.Pool; journal?: FaultJournal | null; onFault?: (message: string, detail: unknown) => void }) {}

  /** True while a call's ending is unrecorded: the gateway then forwards nothing. */
  closed(): boolean {
    return this.waiting.length > 0;
  }

  /** The oldest unrecorded ending, for the refusal's message. */
  oldest(): UnrecordedEnding | null {
    return this.waiting[0]?.rec ?? null;
  }

  /** Close the gate for this record. Synchronous on purpose: it takes effect before anything else is awaited. */
  note(rec: UnrecordedEnding): void {
    if (!this.waiting.some((w) => w.rec.journal_id === rec.journal_id)) this.waiting.push({ rec, journaled: false });
  }

  /** Append the record to the journal and force it to disk. A failure leaves the gate closed and the record in memory. */
  async persist(journalId: string): Promise<void> {
    const w = this.waiting.find((x) => x.rec.journal_id === journalId);
    if (!w || w.journaled || !this.o.journal) return;
    try {
      await this.o.journal.append(w.rec);
      w.journaled = true;
    } catch (err) {
      this.o.onFault?.("A call's ending could not be written to the gateway's journal file either. The gateway forwards nothing until it is written to the event log.", { journal_id: journalId, error: summary(err) });
    }
  }

  /** Load the journal's lines not yet written (at start-up, before taking calls) and try to write them. */
  async replay(): Promise<{ loaded: number; unreadable: number; recorded: boolean }> {
    if (!this.o.journal) return { loaded: 0, unreadable: 0, recorded: !this.closed() };
    const { records, unreadable } = await this.o.journal.pending();
    for (const rec of records) if (!this.waiting.some((w) => w.rec.journal_id === rec.journal_id)) this.waiting.push({ rec, journaled: true });
    if (unreadable.length > 0) {
      this.o.onFault?.("Lines of the gateway's journal could not be read; they are left in the file for an engineer.", { file: this.o.journal.file, lines: unreadable.length });
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

function summary(err: unknown): { name: string; code?: string } {
  const e = err as { name?: string; code?: string };
  return { name: e?.name ?? "Error", code: e?.code };
}

/** A new journal id: unique per unrecorded ending. */
export const newJournalId = (): string => `j_${Date.now().toString(36)}_${randomBytes(8).toString("hex")}`;
