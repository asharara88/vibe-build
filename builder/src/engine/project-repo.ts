/**
 * The project's repository (package 2.1): the workspace's git history, kept OUTSIDE the workspace.
 *
 * git runs on the machine that hosts the builder, as `git --git-dir=<repository> --work-tree=<workspace>`.
 * The repository folder (`<sandbox>/workspace.git`) is never mounted into any container, so the engine
 * cannot read or change the history, its settings or its hooks. git reads the files the engine wrote;
 * it runs none of them:
 *  - hooks are looked for only in the repository folder, and are switched off here as well
 *    (`core.hooksPath=/dev/null`);
 *  - the machine's and the user's own git settings are not read (GIT_CONFIG_NOSYSTEM,
 *    GIT_CONFIG_GLOBAL=/dev/null), nor the user's own ignore and attributes files, so nothing
 *    outside the project decides what git sees or runs;
 *  - the file-system monitor, which can run a program, is switched off.
 * A content filter named in a `.gitattributes` the engine writes runs only if the repository's own
 * settings define it, and they are written here only. Whether this is enough is for an engineer to
 * judge (known gap 51).
 *
 * The check after a step reads `git status --porcelain -z --untracked-files=all --ignored`, so files
 * that git ignores are seen too. Files git ignores are never committed, so their fingerprints are
 * kept beside the history at each commit, and the check compares against them: the session
 * certificate the development build needs lives in the workspace and is ignored.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface ProjectRepo {
  /** The repository folder, outside the workspace (for example `<sandbox>/workspace.git`). */
  gitDir: string;
  /** The workspace the engine writes to. */
  workTree: string;
}

/** Who commits: the builder, always. The author of a step's commit is the engine that wrote it. */
export const BUILDER_COMMITTER = { name: "Builder", email: "builder@example.invalid" };

const IGNORED_BASELINE = "builder-ignored-files.json";

/** The environment git runs with: nothing of the builder's own settings, and no git settings from outside the project. */
function gitEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: "/nonexistent",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    LC_ALL: "C",
  };
}

export async function git(repo: ProjectRepo, args: string[]): Promise<string> {
  const { stdout } = await run(
    "git",
    [
      "-c", "core.hooksPath=/dev/null",
      "-c", "core.fsmonitor=false",
      "-c", "core.excludesFile=/dev/null",
      "-c", "core.attributesFile=/dev/null",
      "-c", "core.quotePath=false",
      "-c", `user.name=${BUILDER_COMMITTER.name}`,
      "-c", `user.email=${BUILDER_COMMITTER.email}`,
      "--git-dir", repo.gitDir,
      "--work-tree", repo.workTree,
      ...args,
    ],
    { env: gitEnv(), maxBuffer: 20 * 1024 * 1024 },
  );
  return stdout;
}

const sha256File = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Every file git ignores in the workspace, with its fingerprint. */
async function ignoredFiles(repo: ProjectRepo): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of parseStatus(await git(repo, ["status", "--porcelain", "-z", "--untracked-files=all", "--ignored"]))) {
    if (e.code !== "!!") continue;
    const full = join(repo.workTree, e.path);
    const st = lstatSync(full, { throwIfNoEntry: false });
    out[e.path] = st?.isFile() ? sha256File(full) : st?.isSymbolicLink() ? "symbolic link" : "not a file";
  }
  return out;
}

async function recordIgnoredBaseline(repo: ProjectRepo): Promise<void> {
  writeFileSync(join(repo.gitDir, IGNORED_BASELINE), JSON.stringify(await ignoredFiles(repo), null, 2) + "\n");
}

function readIgnoredBaseline(repo: ProjectRepo): Record<string, string> {
  const f = join(repo.gitDir, IGNORED_BASELINE);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, string>) : {};
}

export interface StatusEntry {
  /** git's two-letter code: " M" changed, "??" new, " D" removed, "!!" ignored, and so on. */
  code: string;
  path: string;
}

/** Read `git status --porcelain -z`. A rename or copy carries a second path, which is read and listed too. */
export function parseStatus(z: string): StatusEntry[] {
  const parts = z.split("\0");
  const out: StatusEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.length < 4) continue;
    const code = p.slice(0, 2);
    out.push({ code, path: p.slice(3) });
    if (code[0] === "R" || code[0] === "C") {
      const from = parts[++i];
      if (from) out.push({ code, path: from });
    }
  }
  return out;
}

/** Make the workspace a repository whose history is outside it, and commit what is there now. */
export async function initProjectRepo(repo: ProjectRepo, message: string): Promise<string> {
  if (existsSync(repo.gitDir)) throw new Error(`${repo.gitDir} already exists; a project's repository is made once.`);
  if (existsSync(join(repo.workTree, ".git"))) throw new Error("The workspace already has a .git entry; the project's history is kept outside the workspace.");
  await git(repo, ["init", "--quiet", "--initial-branch=main"]);
  await git(repo, ["add", "--all"]);
  await git(repo, ["commit", "--quiet", "--no-verify", "-m", message]);
  await recordIgnoredBaseline(repo);
  return (await git(repo, ["rev-parse", "HEAD"])).trim();
}

export interface WorkspaceChanges {
  /** Files changed, added or removed since the last commit, as git reports them (ignored files not included). */
  changed: string[];
  /** Ignored files that were not there at the last commit. */
  ignoredNew: string[];
  /** Ignored files that were there at the last commit and are now different or gone. */
  ignoredChanged: string[];
}

export async function workspaceChanges(repo: ProjectRepo): Promise<WorkspaceChanges> {
  const entries = parseStatus(await git(repo, ["status", "--porcelain", "-z", "--untracked-files=all", "--ignored"]));
  const changed = [...new Set(entries.filter((e) => e.code !== "!!").map((e) => e.path))].sort();
  const before = readIgnoredBaseline(repo);
  const now = await ignoredFiles(repo);
  const ignoredNew = Object.keys(now).filter((p) => !(p in before)).sort();
  const ignoredChanged = Object.keys(before).filter((p) => now[p] !== before[p]).sort();
  return { changed, ignoredNew, ignoredChanged };
}

/** Commit everything in the workspace, with `author` as the author. Returns the new commit's id. */
export async function commitAll(repo: ProjectRepo, author: string, message: string): Promise<string> {
  await git(repo, ["add", "--all"]);
  await git(repo, ["commit", "--quiet", "--no-verify", `--author=${author}`, "-m", message]);
  await recordIgnoredBaseline(repo);
  return (await git(repo, ["rev-parse", "HEAD"])).trim();
}

/**
 * Put the workspace back as it was at the last commit, after a step that failed or was stopped:
 * changed files restored, new files removed, and ignored files that were not there at the last commit
 * removed. An ignored file that was there and has changed cannot be restored (git never had it):
 * it is reported, and the caller must not go on.
 */
export async function resetToLastCommit(repo: ProjectRepo): Promise<{ removedIgnored: string[]; unrestorable: string[] }> {
  await git(repo, ["reset", "--quiet", "--hard", "HEAD"]);
  await git(repo, ["clean", "--quiet", "-d", "--force"]);
  const { ignoredNew, ignoredChanged } = await workspaceChanges(repo);
  for (const p of ignoredNew) rmSync(join(repo.workTree, p), { force: true, recursive: true });
  return { removedIgnored: ignoredNew, unrestorable: ignoredChanged };
}
