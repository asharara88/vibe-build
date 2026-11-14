/**
 * The one way the builder makes a project's tables (package 3.2, design section 2; known gap 53, option (a)):
 * `drizzle-kit migrate`, in the project's tools container (the template image's `tools` stage), from the fixed
 * migration files in the workspace's `drizzle/` folder, which the image build copied in. The exported app's
 * `setup` service runs the same command (builder/src/export/app-compose.ts). Before 3.2 the builder ran
 * `drizzle-kit push --force`, which works the tables out at every start and accepts statements that lose data
 * without asking; nothing makes tables that way any more.
 *
 * Then the drift check: `drizzle-kit generate`, in the same tools image, into a temporary copy of the workspace's
 * `drizzle/` folder mounted over the image's. It passes only when generate says "No schema changes, nothing to
 * migrate" and the copy holds exactly what it held before. Its exit code is never read: generate exits 0 when it
 * could not write (measured, design section 2, K2) and when it wrote a new migration (K3). What it compares is the
 * schema files with the migrations' snapshots, not the SQL files with the live tables (gap N8).
 *
 * Used by scripts/example-1-sandbox.ts (the builder's sandbox), scripts/demo-scripted.ts and scripts/demo-template.ts.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, chownSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sandbox, type Sandbox, type StreamingRun } from "./manager.js";

/** The command that makes the tables, run in the tools container from the image's working folder (/app). */
export const MIGRATE_COMMAND = ["node_modules/.bin/drizzle-kit", "migrate"] as const;
/** The drift check's command, run in a tools container with the temporary copy mounted at /app/drizzle. */
export const DRIFT_COMMAND = ["node_modules/.bin/drizzle-kit", "generate", "--name=drift_check"] as const;
/** What generate prints when the schema files and the migrations' snapshots agree (measured, design section 2, K1). */
export const NO_DRIFT = "No schema changes, nothing to migrate";
/** Where the image keeps the migrations; the temporary copy is mounted there. */
export const IMAGE_MIGRATIONS = "/app/drizzle";
/** The drift check's container is killed after this long: a generate that waits for an answer never gets one. */
export const DRIFT_TIMEOUT_MS = 120_000;

/** How the helper reaches the tools container. The default is the sandbox manager; the fast tests give a stand-in. */
export interface TablesRunner {
  runOnce(sb: Sandbox, service: string, cmd: string[]): Promise<string>;
  runStreaming(sb: Sandbox, service: string, cmd: string[], opts: { container: string; volumes: string[]; onLine: (line: string) => void; timeoutMs: number }): StreamingRun;
}

const managerRunner: TablesRunner = {
  runOnce: (sb, service, cmd) => sandbox.runOnce(sb, service, cmd),
  runStreaming: (sb, service, cmd, opts) => sandbox.runStreaming(sb, service, cmd, opts),
};

export interface DriftCheck {
  ok: boolean;
  /** Why it did not pass; absent when it passed. */
  reason?: string;
  /** What generate printed, standard output then the end of standard error. Recorded, and read for NO_DRIFT. */
  output: string;
  /** Recorded only: it decides nothing. */
  exitCode: number | null;
  /** Paths in the copy, relative to `drizzle/`, that generate added, changed or removed. */
  added: string[];
  changed: string[];
  removed: string[];
}

/** A folder's plain files, by path relative to it, with their SHA-256; anything that is not a plain file or folder is named in `other`. */
export function listFolder(dir: string): { files: Map<string, string>; other: string[] } {
  const files = new Map<string, string>();
  const other: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      const st = lstatSync(join(dir, p));
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) files.set(p, createHash("sha256").update(readFileSync(join(dir, p))).digest("hex"));
      else other.push(p);
    }
  };
  walk("");
  return { files, other };
}

/**
 * The drift check's verdict, from what generate printed and what the copy held before and after. Its exit code is
 * not an input. It passes only on NO_DRIFT with the copy unchanged.
 */
export function driftVerdict(output: string, before: Map<string, string>, after: { files: Map<string, string>; other: string[] }): Pick<DriftCheck, "ok" | "reason" | "added" | "changed" | "removed"> {
  const added = [...after.files.keys()].filter((p) => !before.has(p)).concat(after.other).sort();
  const changed = [...after.files.keys()].filter((p) => before.has(p) && before.get(p) !== after.files.get(p)).sort();
  const removed = [...before.keys()].filter((p) => !after.files.has(p)).sort();
  const said = output.includes(NO_DRIFT);
  const touched = [...added.map((p) => `${p} (added)`), ...changed.map((p) => `${p} (changed)`), ...removed.map((p) => `${p} (removed)`)];
  if (said && touched.length === 0) return { ok: true, added, changed, removed };
  const reason = !said
    ? `drizzle-kit generate did not say "${NO_DRIFT}"${touched.length ? `, and it wrote ${touched.join(", ")}` : ""}: the schema files and the migrations do not match, or the check could not run`
    : `drizzle-kit generate said "${NO_DRIFT}" but the migrations folder changed: ${touched.join(", ")}`;
  return { ok: false, reason, added, changed, removed };
}

/**
 * Copy the workspace's `drizzle/` folder into a fresh folder under `scratchDir`, refusing anything in it that is
 * not a plain file or folder (a link would be followed when the copy is read back on the machine), and make the
 * copy writable by the tools image's user `node` (uid 1000).
 */
function copyMigrations(workspace: string, scratchDir: string): { holder: string; copy: string; before: Map<string, string> } {
  const source = join(workspace, "drizzle");
  const st = lstatSync(source, { throwIfNoEntry: false });
  if (!st?.isDirectory()) throw new Error("The drift check is refused: the workspace has no drizzle/ folder of migrations.");
  const { files, other } = listFolder(source);
  if (other.length) throw new Error(`The drift check is refused: drizzle/ holds something other than plain files and folders: ${other.join(", ")}.`);
  const holder = join(scratchDir, `drift-check-${randomBytes(4).toString("hex")}`);
  const copy = join(holder, "drizzle");
  mkdirSync(copy, { recursive: true });
  const asRoot = process.getuid?.() === 0;
  const own = (p: string, mode: number) => (asRoot ? chownSync(p, 1000, 1000) : chmodSync(p, mode));
  own(copy, 0o777);
  for (const rel of files.keys()) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) {
      const d = join(copy, ...parts.slice(0, i));
      if (!lstatSync(d, { throwIfNoEntry: false })) {
        mkdirSync(d);
        own(d, 0o777);
      }
    }
    const target = join(copy, rel);
    writeFileSync(target, readFileSync(join(source, rel)), { flag: "wx" });
    own(target, 0o666);
  }
  return { holder, copy, before: files };
}

/** Run the drift check (see the top of this file). The temporary copy is removed afterwards, whatever happened. */
export async function driftCheck(sb: Sandbox, workspace: string, scratchDir: string, runner: TablesRunner = managerRunner): Promise<DriftCheck> {
  const { holder, copy, before } = copyMigrations(workspace, scratchDir);
  try {
    const lines: string[] = [];
    const r = runner.runStreaming(sb, "tools", [...DRIFT_COMMAND], {
      container: `${sb.projectName}-drift-check-${randomBytes(3).toString("hex")}`.slice(0, 120),
      volumes: [`${copy}:${IMAGE_MIGRATIONS}`],
      onLine: (l) => lines.push(l),
      timeoutMs: DRIFT_TIMEOUT_MS,
    });
    const end = await r.done;
    const output = (lines.join("\n") + "\n" + end.stderrTail).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    const verdict = driftVerdict(output, before, listFolder(copy));
    return { ...verdict, output, exitCode: end.code };
  } finally {
    rmSync(holder, { recursive: true, force: true });
  }
}

/**
 * Make the tables with `drizzle-kit migrate` in the tools container, then run the drift check; refuse, naming the
 * drift, when it does not pass. The database must be running. Returns migrate's output and the check.
 */
export async function makeTables(sb: Sandbox, opts: { workspace: string; scratchDir: string }, runner: TablesRunner = managerRunner): Promise<{ migrate: string; drift: DriftCheck }> {
  const migrate = await runner.runOnce(sb, "tools", [...MIGRATE_COMMAND]);
  const drift = await driftCheck(sb, opts.workspace, opts.scratchDir, runner);
  if (!drift.ok) throw new Error(`The tables were made, but the drift check did not pass: ${drift.reason}.`);
  return { migrate, drift };
}
