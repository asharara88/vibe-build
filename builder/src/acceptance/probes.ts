/**
 * Attempts to reach the acceptance store from inside the engine container, and what is checked from the
 * machine alongside them (package 3.1, "Done means" (4); docs/design/package-3.1.md, section 6).
 *
 *  - Mounts: each engine container is inspected while it runs (`inspectWhileRunning`); a probe in the
 *    engine service prints its whole /proc/self/mountinfo.
 *  - By file path: the probe (FILE_PROBE, mounted read-only at /probe) tries to open, by their paths on
 *    the machine, the store, the project's folder in it, the version, a test file, the run folder, the
 *    repository's stand-in-acceptance/ and evidence/, and /acceptance and /results; then it reads every
 *    file it can (outside /proc, /sys and /dev) and searches them for the version's marker, a phrase of
 *    the test's source and the run's reason. Each of the three is given to it in two halves, joined only
 *    in memory, so the whole string is never in its arguments or in `docker inspect`.
 *  - On the machine: the same three are searched for in the source folder of every engine mount
 *    (`searchFolders`), in every revision of the project's history (`historyCheck`), and in dumps of
 *    the project's database and of the builder's events (`searchText`).
 */
import { execFile } from "node:child_process";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { StreamingRun } from "../sandbox/manager.js";

const run = promisify(execFile);

export interface Needle {
  label: string;
  text: string;
}

/** The two halves a probe is given for a needle. */
export function halves(n: Needle): { label: string; a: string; b: string } {
  const cut = Math.floor(n.text.length / 2);
  return { label: n.label, a: n.text.slice(0, cut), b: n.text.slice(cut) };
}

/** The file probe, run in the engine container with the step's own mounts. Node's own modules only. */
export const FILE_PROBE = `// Package 3.1: attempts, from inside the engine container, to reach the acceptance store by file path.
// Settings: one JSON argument {paths: [{label, path}], needles: [{label, a, b}]}. Prints one JSON line per result.
import { lstatSync, openSync, readFileSync, readdirSync, closeSync } from "node:fs";
import { join } from "node:path";
const settings = JSON.parse(process.argv[2]);
const out = (o) => console.log(JSON.stringify(o));
out({ kind: "who", uid: process.getuid(), gid: process.getgid() });
for (const p of settings.paths) {
  let result;
  try {
    const st = lstatSync(p.path);
    try {
      if (st.isDirectory()) { const names = readdirSync(p.path); result = "LISTED (" + names.length + " entries)"; }
      else { const fd = openSync(p.path, "r"); closeSync(fd); result = "OPENED"; }
    } catch (e) { result = "found but not readable (" + e.code + ")"; }
  } catch (e) { result = "not found (" + e.code + ")"; }
  out({ kind: "path", label: p.label, path: p.path, result });
}
const needles = settings.needles.map((n) => ({ label: n.label, text: n.a + n.b }));
const skip = new Set(["/proc", "/sys", "/dev"]);
let files = 0, bytes = 0, unreadable = 0, skippedLarge = 0;
const found = Object.fromEntries(needles.map((n) => [n.label, []]));
const walk = (dir, depth) => {
  if (depth > 40) return;
  let names;
  try { names = readdirSync(dir); } catch { unreadable++; return; }
  for (const name of names) {
    const full = join(dir, name);
    if (skip.has(full)) continue;
    let st;
    try { st = lstatSync(full); } catch { unreadable++; continue; }
    if (st.isDirectory()) walk(full, depth + 1);
    else if (st.isFile()) {
      if (st.size > 64 * 1024 * 1024) { skippedLarge++; continue; }
      let data;
      try { data = readFileSync(full); } catch { unreadable++; continue; }
      files++; bytes += data.length;
      for (const n of needles) if (data.includes(n.text)) found[n.label].push(full);
    }
  }
};
walk("/", 0);
out({ kind: "search", root: "/ (all but /proc, /sys and /dev; links not followed)", files, bytes, unreadable, skippedLarge, found });
out({ kind: "mountinfo", lines: readFileSync("/proc/self/mountinfo", "utf8").trim().split("\\n") });
out({ kind: "end" });
`;

export interface ProbeLine {
  kind: string;
  [k: string]: unknown;
}

export function parseProbe(lines: string[]): ProbeLine[] {
  return lines.flatMap((l) => {
    try {
      const o = JSON.parse(l) as ProbeLine;
      return o && typeof o === "object" && typeof o.kind === "string" ? [o] : [];
    } catch {
      return [];
    }
  });
}

export interface InspectSeen {
  container: string;
  /** True if `docker inspect` answered while the container was still running, before its run ended. */
  whileRunning: boolean;
  mounts: Array<{ Type?: string; Source?: string; Destination?: string; RW?: boolean }>;
  networkMode?: string;
  user?: string;
  problem?: string;
}

/**
 * Inspect a container while it runs: `docker inspect` is asked every 100 ms until it answers with the
 * container running, or the run has ended. The result says whether the answer came before the end;
 * evidence that relies on it fails if it did not (no fixed wait).
 */
export async function inspectWhileRunning(handle: StreamingRun, env: NodeJS.ProcessEnv): Promise<InspectSeen> {
  let ended = false;
  void handle.done.then(() => (ended = true));
  while (!ended) {
    try {
      const { stdout } = await run("docker", ["inspect", handle.container, "--format", "{{json .}}"], { env, maxBuffer: 8 * 1024 * 1024 });
      const info = JSON.parse(stdout) as { State?: { Running?: boolean }; Mounts?: InspectSeen["mounts"]; HostConfig?: { NetworkMode?: string }; Config?: { User?: string } };
      if (info.State?.Running) {
        const before = !ended;
        return { container: handle.container, whileRunning: before, mounts: info.Mounts ?? [], networkMode: info.HostConfig?.NetworkMode, user: info.Config?.User };
      }
    } catch {
      /* not created yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { container: handle.container, whileRunning: false, mounts: [], problem: "the container ended before docker inspect saw it running" };
}

/** Search every plain file under each folder (links not followed) for each needle. */
export function searchFolders(folders: string[], needles: Needle[]): { files: number; found: Record<string, string[]> } {
  const found: Record<string, string[]> = Object.fromEntries(needles.map((n) => [n.label, []]));
  let files = 0;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = lstatSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) {
        files++;
        const data = readFileSync(full);
        for (const n of needles) if (data.includes(n.text)) found[n.label]!.push(full);
      }
    }
  };
  for (const f of folders) {
    const st = lstatSync(f);
    if (st.isDirectory()) walk(f);
    else if (st.isFile()) {
      files++;
      const data = readFileSync(f);
      for (const n of needles) if (data.includes(n.text)) found[n.label]!.push(f);
    }
  }
  return { files, found };
}

/** Count the places each needle appears in a text. */
export function searchText(text: string, needles: Needle[]): Record<string, number> {
  return Object.fromEntries(needles.map((n) => [n.label, text.split(n.text).length - 1]));
}

/**
 * The project's history (kept outside the workspace): every file name in every revision, the acceptance
 * files among them, and each needle searched for in every revision. git reads the history; it runs none
 * of the project's files.
 */
export async function historyCheck(gitDir: string, needles: Needle[]): Promise<{ revisions: number; fileNames: number; acceptanceFiles: string[]; found: Record<string, number>; commands: string[] }> {
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const git = (args: string[]) => run("git", ["--git-dir", gitDir, "-c", "core.hooksPath=/dev/null", ...args], { env, maxBuffer: 64 * 1024 * 1024 });
  const revs = (await git(["rev-list", "--all"])).stdout.trim().split("\n").filter(Boolean);
  const names = (await git(["log", "--all", "--name-only", "--format="])).stdout.split("\n").filter(Boolean);
  const acceptanceFiles = [...new Set(names.filter((n) => /(^|\/)(item-\d{2}\.spec\.ts|manifest\.json)$|(^|\/)acceptance\//.test(n)))];
  const found: Record<string, number> = {};
  for (const n of needles) {
    // git grep exits 1 when nothing matches.
    const r = await git(["grep", "-F", "-c", "-e", n.text, ...revs]).catch((e: { code?: number; stdout?: string }) => {
      if (e.code === 1) return { stdout: "" };
      throw e;
    });
    found[n.label] = r.stdout.split("\n").filter(Boolean).length;
  }
  return {
    revisions: revs.length,
    fileNames: new Set(names).size,
    acceptanceFiles,
    found,
    commands: ["git rev-list --all", "git log --all --name-only --format=", "git grep -F -c -e <needle> <every revision>"],
  };
}
