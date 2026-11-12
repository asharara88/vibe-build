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
 *
 * git never lists an entry named `.git` at the workspace's top or in a folder that holds tracked
 * files, and never lists a named pipe, a socket or a device. So the check also walks the workspace
 * itself (`entriesGitCannotSee`), and anything of that kind fails the step and is removed by the
 * reset (found by the review of package 2.1).
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, lstatSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * The fingerprint of a regular file, read a piece at a time, so that a file of any size can be
 * fingerprinted (reading it whole fails above 2 GiB). A link at the path is refused, not followed.
 */
function sha256File(path: string): string {
  const hash = createHash("sha256");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    for (let n = readSync(fd, buf, 0, buf.length, null); n > 0; n = readSync(fd, buf, 0, buf.length, null)) hash.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

/** An entry git cannot see, which the workspace must never hold. */
export interface NotAllowedEntry {
  /** Its path in the workspace. */
  path: string;
  /** What it is, in plain words. */
  what: string;
}

/**
 * Walk the workspace on this machine and list what git cannot see, which the workspace must never hold:
 *  - every entry named `.git`, in any letter case, at any depth, whatever it is (folder, file or
 *    link). git skips such entries, so the check after a step, the commit and the reset would not
 *    see them; and a `.git` folder can hold settings that make a later plain `git` run in that
 *    folder start a program;
 *  - every entry that is not a regular file, a folder or a symbolic link: a named pipe, a socket or a
 *    device. git does not list these either.
 * Each entry is looked at with lstat, so a link is never followed, and only names and types are read,
 * never a file's contents. A folder named `.git` is listed whole, not gone into.
 */
export function entriesGitCannotSee(workTree: string): NotAllowedEntry[] {
  const out: NotAllowedEntry[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(rel === "" ? workTree : join(workTree, rel)).sort()) {
      const path = rel === "" ? name : `${rel}/${name}`;
      const st = lstatSync(join(workTree, path), { throwIfNoEntry: false });
      if (name.toLowerCase() === ".git") out.push({ path, what: "named .git" });
      else if (!st) out.push({ path, what: "an entry whose name could not be read back" });
      else if (st.isDirectory()) walk(path);
      else if (st.isFile() || st.isSymbolicLink()) continue;
      else if (st.isFIFO()) out.push({ path, what: "a named pipe" });
      else if (st.isSocket()) out.push({ path, what: "a socket" });
      else if (st.isBlockDevice() || st.isCharacterDevice()) out.push({ path, what: "a device" });
      else out.push({ path, what: "neither a file, a folder nor a link" });
    }
  };
  walk("");
  return out;
}

/** The entries, for a message: "src/.git (named .git), src/pipe (a named pipe)". */
export const describeNotAllowed = (entries: NotAllowedEntry[]) => entries.map((e) => `${e.path} (${e.what})`).join(", ");

/**
 * Every file git ignores in the workspace, with its fingerprint. A symbolic link is fingerprinted by
 * where it points ("link:" and its target, read without following it), so pointing it elsewhere counts
 * as a change (found by the second review of package 2.1: every link had the same fingerprint).
 */
async function ignoredFiles(repo: ProjectRepo): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of parseStatus(await git(repo, ["status", "--porcelain", "-z", "--untracked-files=all", "--ignored"]))) {
    if (e.code !== "!!") continue;
    const full = join(repo.workTree, e.path);
    const st = lstatSync(full, { throwIfNoEntry: false });
    out[e.path] = st?.isFile() ? sha256File(full) : st?.isSymbolicLink() ? `link:${readlinkSync(full)}` : "not a file";
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
  const notAllowed = entriesGitCannotSee(repo.workTree);
  if (notAllowed.length) throw new Error(`The workspace holds entries git cannot see, so they could not be part of its history: ${describeNotAllowed(notAllowed)}.`);
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
  /** Entries git cannot see, which the workspace must never hold (`entriesGitCannotSee`). None can be in the last commit. */
  notAllowed: NotAllowedEntry[];
}

/** What differs from the last commit. Used by the check before a step, the check after it, and the reset. */
export async function workspaceChanges(repo: ProjectRepo): Promise<WorkspaceChanges> {
  const entries = parseStatus(await git(repo, ["status", "--porcelain", "-z", "--untracked-files=all", "--ignored"]));
  const changed = [...new Set(entries.filter((e) => e.code !== "!!").map((e) => e.path))].sort();
  const before = readIgnoredBaseline(repo);
  const now = await ignoredFiles(repo);
  const ignoredNew = Object.keys(now).filter((p) => !(p in before)).sort();
  const ignoredChanged = Object.keys(before).filter((p) => now[p] !== before[p]).sort();
  return { changed, ignoredNew, ignoredChanged, notAllowed: entriesGitCannotSee(repo.workTree) };
}

/** Commit everything in the workspace, with `author` as the author. Returns the new commit's id. Refused if the workspace holds anything git cannot see. */
export async function commitAll(repo: ProjectRepo, author: string, message: string): Promise<string> {
  const notAllowed = entriesGitCannotSee(repo.workTree);
  if (notAllowed.length) throw new Error(`Not committed: the workspace holds entries git cannot see: ${describeNotAllowed(notAllowed)}.`);
  await git(repo, ["add", "--all"]);
  await git(repo, ["commit", "--quiet", "--no-verify", `--author=${author}`, "-m", message]);
  await recordIgnoredBaseline(repo);
  return (await git(repo, ["rev-parse", "HEAD"])).trim();
}

/**
 * Put the workspace back as it was at the last commit, after a step that failed or was stopped:
 * changed files restored; new files removed, a folder holding a repository of its own included;
 * entries git cannot see (anything named `.git`, named pipes, sockets, devices) removed, since none
 * can be in the last commit; and ignored files that were not there at the last commit removed.
 * Then the workspace is compared with the last commit again, and everything still different is
 * returned as `unrestorable` (an ignored file that was there and has changed, for example: git never
 * had it). If that list is not empty, the caller must not go on.
 *
 * Each round puts the tracked files back first, then removes what is new, then puts the tracked files
 * back again. First, because `git clean` reads the workspace's own `.gitignore`, which a step can edit:
 * with that file restored first, the clean keeps the ignored session certificate (found by the last
 * re-read of package 2.1). Again, because a protected folder moved aside and replaced by a link to its
 * moved copy is not put back by the first `git reset --hard` (git reads the files through the link and
 * writes nothing), but is once the clean has removed the link and the copy (found by the second review).
 * A round is repeated, three rounds at most, while it still changes what is left different.
 *
 * Not handled (known gap 58): a folder tree deeper than the machine's path limit. git cannot read it,
 * and `git clean` fails, so the reset rejects with git's error and the tree stays.
 */
export async function resetToLastCommit(repo: ProjectRepo): Promise<{ removedIgnored: string[]; removedNotAllowed: string[]; unrestorable: string[] }> {
  const removedIgnored = new Set<string>();
  const removedNotAllowed = new Set<string>();
  let unrestorable: string[] = [];
  for (let round = 1; round <= 3; round++) {
    // The tracked files first, .gitignore among them, so that the clean below reads the committed one.
    await git(repo, ["reset", "--quiet", "--hard", "HEAD"]);
    // -f twice: with one, git leaves an untracked folder that holds a repository of its own. No -x:
    // ignored files stay (the session certificate among them); the new ones are removed below.
    await git(repo, ["clean", "--quiet", "-d", "-f", "-f"]);
    // rmSync removes a link itself, never what it points to.
    for (const e of entriesGitCannotSee(repo.workTree)) {
      rmSync(join(repo.workTree, e.path), { force: true, recursive: true });
      removedNotAllowed.add(e.path);
    }
    await git(repo, ["reset", "--quiet", "--hard", "HEAD"]);
    for (const p of (await workspaceChanges(repo)).ignoredNew) {
      rmSync(join(repo.workTree, p), { force: true, recursive: true });
      removedIgnored.add(p);
    }
    const left = await workspaceChanges(repo);
    const still = [...new Set([...left.changed, ...left.ignoredNew, ...left.ignoredChanged, ...left.notAllowed.map((e) => e.path)])].sort();
    const unchanged = still.join("\0") === unrestorable.join("\0");
    unrestorable = still;
    if (still.length === 0 || unchanged) break;
  }
  return { removedIgnored: [...removedIgnored].sort(), removedNotAllowed: [...removedNotAllowed].sort(), unrestorable };
}
