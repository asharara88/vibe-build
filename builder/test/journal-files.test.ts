/**
 * Package 1.4b, after its review: the gateway's journal files when another process writes the same folder at the same
 * moment, and the folder's own id file. Since the review, a gateway that has lost its folder's lock (its database
 * connection down) still appends a call's ending to its journal file, while the recovery script, holding the lock
 * meanwhile, may rewrite that file. These tests show that such an append is never lost to the rewrite.
 *
 * Against the files only: no database, no provider, no container; the records are made up. Two journal objects on one
 * folder stand for the two processes (each has its own queue, as two processes do). The file system's functions are
 * wrapped here (vi.mock) so that an append lands at an exact moment of a rewrite: each case runs in that order every
 * time, not by chance. With no hook set, each wrapped function does exactly what the real one does.
 */
import { mkdtemp, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { FaultJournal, fingerprintOf } from "../src/gateway/journal.js";
import type { UnrecordedEnding } from "../src/store/freezes.js";

const hooks = vi.hoisted(
  () =>
    ({}) as {
      /** Runs just before a rename, which then goes ahead. */
      beforeRename?: (from: string, to: string) => Promise<void>;
      /** Returns a promise a handle's write waits for, or null to write at once. */
      stallWrite?: (path: string, flags: unknown) => Promise<void> | null;
      /** True to make a handle's write fail (a made-up disk error). */
      failWrite?: (path: string, flags: unknown) => boolean;
    },
);

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const wrap = (fh: import("node:fs/promises").FileHandle, path: string, flags: unknown) =>
    new Proxy(fh, {
      get(target, prop) {
        if (prop === "writeFile") {
          return async (...args: Parameters<typeof target.writeFile>) => {
            const stall = hooks.stallWrite?.(path, flags);
            if (stall) await stall;
            if (hooks.failWrite?.(path, flags)) throw Object.assign(new Error("made-up write failure"), { code: "EIO" });
            return target.writeFile(...args);
          };
        }
        const v: unknown = Reflect.get(target, prop, target);
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  return {
    ...actual,
    open: async (path: string, flags?: string | number, mode?: number) => wrap(await actual.open(path, flags, mode), String(path), flags),
    rename: async (from: string, to: string) => {
      await hooks.beforeRename?.(String(from), String(to));
      return actual.rename(from, to);
    },
  };
});

const dirs: string[] = [];
async function newDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "pkg14b-files-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  delete hooks.beforeRename;
  delete hooks.stallWrite;
  delete hooks.failWrite;
});
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

let n = 0;
/** A journal record as the gateway writes one (made up). */
function rec(): UnrecordedEnding {
  n += 1;
  return {
    journal_id: `j_made_up_files_${n}`,
    gateway: "gw_made_up_files",
    project_id: "made_up_project_files",
    hold_id: String(n),
    step: null,
    ended_at: new Date().toISOString(),
    ending: "settle",
    kept_reason: null,
    cost_usd_as_read: 0.006142,
    call: { model: "claude-opus-5-5", status: 200 },
    error: { name: "error", code: "P0001" },
  };
}
const line = (r: unknown) => JSON.stringify(r) + "\n";
const TORN = Buffer.from('{"journal_id":"j_made_up_cut","gat'); // a record cut short: not JSON as a line of its own

/** A folder whose journal file holds a readable record, then an unreadable line (line 2), as the recovery finds it. */
async function folderWithUnreadableLine() {
  const dir = await newDir();
  const gateway = await FaultJournal.open(dir); // the gateway's journal object; it has lost its lock and still appends
  const recovery = await FaultJournal.openExisting(dir); // the recovery script's, as a second process has
  const a = rec();
  await writeFile(gateway.file, Buffer.concat([Buffer.from(line(a)), TORN, Buffer.from("\n")]));
  return { gateway, recovery, a };
}

describe("1.4b's review: the journal's files when another process writes the same folder (the files only, with the file system wrapped to fix the order)", () => {
  it("(r1) an append that lands in the old journal file after a rewrite read it, and before its rename, is carried over into the new file", async () => {
    const { gateway, recovery, a } = await folderWithUnreadableLine();
    const b = rec();
    hooks.beforeRename = async (_from, to) => {
      if (to !== gateway.file) return;
      delete hooks.beforeRename;
      await gateway.append(b); // whole and forced to disk before the rename; the file is still the old one
    };
    const r = await recovery.removeLine(2, fingerprintOf(TORN));
    expect(await readFile(gateway.file, "utf8")).toBe(line(a) + line(b));
    const left = await recovery.pending();
    expect({ records: left.records.map((x) => x.journal_id), unreadable: left.unreadable.length }).toEqual({ records: [a.journal_id, b.journal_id], unreadable: 0 });
    expect(r.carriedOver).toBe(Buffer.byteLength(line(b)));
  });

  it("(r1b) a line still being written into the old file when it is replaced is carried over once it ends, not cut", async () => {
    const { gateway, recovery, a } = await folderWithUnreadableLine();
    const b = Buffer.from(line(rec()));
    let ended: Promise<void> = Promise.resolve();
    hooks.beforeRename = async (_from, to) => {
      if (to !== gateway.file) return;
      delete hooks.beforeRename;
      // Another process's line, through its own handle on the old file: its first half lands now, its second half
      // (with its line end) 200 ms later, after the rename.
      const fh = await open(gateway.file, "a");
      await fh.write(b.subarray(0, 40));
      ended = new Promise((resolve) =>
        setTimeout(() => {
          void fh
            .write(b.subarray(40))
            .then(() => fh.close())
            .then(resolve);
        }, 200),
      );
    };
    const r = await recovery.removeLine(2, fingerprintOf(TORN));
    await ended;
    expect(await readFile(gateway.file, "utf8")).toBe(line(a) + b.toString("utf8"));
    expect((await recovery.pending()).unreadable).toEqual([]);
    expect(r.carriedOver).toBe(b.length);
  });

  it("(r2) an append that opened the old journal file before a rewrite's rename, and writes after it, writes its line again into the new file", async () => {
    const { gateway, recovery, a } = await folderWithUnreadableLine();
    const b = rec();
    let atWrite!: () => void;
    const reached = new Promise<void>((r) => (atWrite = r));
    let letWrite!: () => void;
    const held = new Promise<void>((r) => (letWrite = r));
    hooks.stallWrite = (path) => {
      if (path !== gateway.file) return null;
      delete hooks.stallWrite;
      atWrite();
      return held;
    };
    const appending = gateway.append(b);
    await reached; // the gateway holds the old file open, about to write
    const r = await recovery.removeLine(2, fingerprintOf(TORN));
    letWrite();
    await appending;
    expect(await readFile(gateway.file, "utf8")).toBe(line(a) + line(b));
    expect((await recovery.pending()).records.map((x) => x.journal_id)).toEqual([a.journal_id, b.journal_id]);
    expect(r.carriedOver).toBe(0); // nothing had landed in the old file before it was replaced
  });

  it("(r3) the folder's id file is never left empty: a write of it that fails leaves no id file, and the next start makes a whole one", async () => {
    const dir = await newDir();
    hooks.failWrite = (path, flags) => {
      if (!basename(path).includes("journal-folder-id") || flags !== "wx") return false;
      delete hooks.failWrite;
      return true;
    };
    await expect(FaultJournal.open(dir)).rejects.toMatchObject({ code: "EIO" });
    expect((await readdir(dir)).filter((f) => f.includes("journal-folder-id"))).toEqual([]);
    const j = await FaultJournal.open(dir);
    expect(j.folderId).toMatch(/^jf_[0-9a-f]{32}$/);
    expect(await readFile(join(dir, "journal-folder-id"), "utf8")).toBe(j.folderId + "\n");
    expect((await FaultJournal.openExisting(dir)).folderId).toBe(j.folderId);
    expect((await readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("(r4) an entry appended to the set-aside file after an entry cut short by a crash starts on a line of its own, and can be read", async () => {
    const j = await FaultJournal.open(await newDir());
    const cut = '{"set_aside_id":"sa_made_up_cut","line_ba';
    await writeFile(j.setAsideFile, cut);
    await j.appendSetAside({ set_aside_id: "sa_made_up_next", reason: "made up for the test" });
    expect(await readFile(j.setAsideFile, "utf8")).toBe(cut + "\n" + line({ set_aside_id: "sa_made_up_next", reason: "made up for the test" }));
    expect((await j.setAsides()).map((e) => e["set_aside_id"])).toEqual(["sa_made_up_next"]);
  });
});
