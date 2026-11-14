/**
 * The export (package J1; final design, section 1, item 9), offered only after sign-off; since package 3.2
 * (docs/design/package-3.2.md, sections 1, 4 and 5), a folder that starts on its own with one command.
 *
 * A clone of the project's history, with the acceptance tests copied from the store and committed IN THE
 * EXPORTED COPY ONLY: never in the workspace history the engine's container mounts read-write (design note,
 * section 2.7; the tests are kept apart from the engine). Downloaded as one .tar.gz, labelled internal only
 * (`EXPORT_LABEL`). Its start, migration and licence files come from the house template, in the project's history
 * from its first commit, and must be the builder's own template copies, byte for byte.
 *
 * git and tar run on the machine that hosts the builder; they read and copy files and run none of them. git runs
 * with no hooks, no file-system monitor, and none of the machine's or the user's own settings, as for the
 * project's history (project-repo.ts). The copy holds only the objects the history reaches. Refused, in this order:
 * - S8: a version that does not match its manifest; S9: a manifest that is not the one the passing run checked (the
 *   job reads that run from the record: `signedOffRun`); S12: an archive of this project that exists already;
 * - in any commit of any branch or tag: an acceptance folder (S6), a file that looks like a secret (S7),
 *   EXPORT-NOTE.txt (S3), a file Docker Compose or the image build reads without being told (S29), a symbolic link
 *   or a submodule (S1);
 * - in the clone, which takes an empty template folder (no sample hooks are shipped): a checkout that is not byte for
 *   byte what the history holds, or holds anything else (S5); a drizzle/ folder that does not match its journal (S14);
 *   a fixed file that is not the builder's template copy (S13);
 * - the exporter's own files are created exclusively and never through a link, in folders it has just made (S2);
 *   the export commit must add exactly them, as plain files, with their content, on the workspace's last commit (S4);
 *   the workspace history must not move while the export is made (S10);
 * - the packed archive: a node_modules folder, or a path named like a development-only package (S20); then the
 *   checks with Docker (`check`, the journey's `Sandboxes.checkExport`; design section 4, items 3 to 7), each of
 *   which must pass.
 * The archive is packed under a temporary name in a fresh folder of the exports folder and linked into place only if
 * no file has its final name (S12): a failed export leaves no file.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { checkProjectId, sha256, STAND_IN_NOTE, verifyVersion, type AcceptanceStore } from "../acceptance/store.js";
import { git, type ProjectRepo } from "../engine/project-repo.js";
import { readWithoutBeingTold } from "../export/app-compose.js";
import { devOnlyNames, DOCKER_CHECK_IDS, TEMPLATE_DIR, type ExportCheck, type PackedExport } from "../export/export-check.js";
import type { Event } from "../store/events.js";
import { EXPORT_LABEL, JOURNEY_STAND_IN_LABEL, JourneyRefused } from "./journey.js";

const run = promisify(execFile);

/** Who commits the acceptance folder in the exported copy. */
export const EXPORT_AUTHOR = "Builder export <export@example.invalid>";
/** The note the exporter writes at the copy's top; no commit of the history may hold it (S3). */
export const EXPORT_NOTE = "EXPORT-NOTE.txt";
/**
 * S13: the files an exported copy must hold exactly as the builder's own template copies: the start files, the build
 * files, the six licence files and the template's own first migration (design section 5).
 */
export const FIXED_FILES = [
  "compose.yaml",
  "README.md",
  "Dockerfile",
  ".dockerignore",
  "tsconfig.json",
  "package.json",
  "package-lock.json",
  "THIRD-PARTY-NOTICES.md",
  "licence-rule.json",
  "scripts/licence/check.ts",
  "scripts/licence/rule.ts",
  "scripts/check-licences.sh",
  "scripts/check-lock.mjs",
  "drizzle/0000_template.sql",
  "drizzle/meta/0000_snapshot.json",
] as const;

/** The environment git and tar run with: nothing of the builder's own settings, no git settings from outside. */
function plainEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", LC_ALL: "C" };
}

/** git in a folder, with no hooks, no file-system monitor and no outside ignore or attributes files. */
async function gitIn(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.excludesFile=/dev/null", "-c", "core.attributesFile=/dev/null", "-c", "core.quotePath=false", "-c", "user.name=Builder", "-c", "user.email=builder@example.invalid", ...args],
    { cwd, env: plainEnv(), maxBuffer: 20 * 1024 * 1024 },
  );
  return stdout;
}

/** A path in the history that looks like a secret: a settings file (other than .env.example), a key, a certificate, a secrets folder. */
export function secretLikePath(p: string): boolean {
  return /(^|\/)\.env(\.(?!example$)[^/]*)?$/.test(p) || /\.(crt|pem|key|p12|pfx)$/i.test(p) || /(^|\/)secrets\//.test(p) || /(^|\/)id_(rsa|ed25519|ecdsa)/.test(p);
}

const refuse = (message: string): never => {
  throw new JourneyRefused(message);
};
/** A list of found problems, the first ten and how many more. */
const listed = (items: string[]) => (items.length > 10 ? `${items.slice(0, 10).join(", ")} and ${items.length - 10} more` : items.join(", "));

/** Git's object name of a file's bytes (a blob), in the history's object format. */
function blobName(body: Buffer, format: string): string {
  return createHash(format === "sha256" ? "sha256" : "sha1")
    .update(`blob ${body.length}\0`)
    .update(body)
    .digest("hex");
}

/** Test hooks (design section 5's tests E1b, E4 and E8): called at fixed points; the journey passes none. */
export interface ExportHooks {
  /** After the clone and its checks, just before the exporter writes its own files. */
  beforeWrites?: (top: string) => void | Promise<void>;
  /** After the exporter's files are written, just before they are committed. */
  beforeCommit?: (top: string) => void | Promise<void>;
  /** After the export commit. */
  afterCommit?: (top: string) => void | Promise<void>;
}

export interface ExportInput {
  repo: ProjectRepo;
  store: AcceptanceStore;
  projectId: string;
  /** The acceptance version fixed when the plan was confirmed. */
  version: string;
  /** Where the archive is written (`journeyFolder(dataDir, projectId, "exports")`). */
  exportsDir: string;
  /** S9: the manifest SHA-256 recorded by the passing run that journey.signed_off names (`signedOffRun`). */
  runManifestSha256: string;
  /**
   * The checks with Docker on the packed archive (design section 4, items 3 to 7; the journey's `Sandboxes.checkExport`).
   * Each of `DOCKER_CHECK_IDS` must be reported, and passed.
   */
  check: (packed: PackedExport) => Promise<ExportCheck[]>;
  /** Called just before the archive is moved into place (the job: is this interface still the owner?). */
  beforePlace?: () => void;
  /** The builder's own template copy the fixed files are compared with (S13); templates/next by default. */
  templateDir?: string;
  hooks?: ExportHooks;
}

export interface ExportResult {
  path: string;
  sha256: string;
  bytes: number;
  /** The exported copy's last commit (the one that adds the acceptance folder and the note). */
  exportCommit: string;
  /** The workspace history's last commit, which the export does not change. */
  workspaceHead: string;
  /** Commits in the exported copy. */
  commits: number;
  /** Every file of the exported copy at its last commit. */
  files: string[];
  /** The version's manifest SHA-256, and its items' fingerprints. */
  manifestSha256: string;
  items: Array<{ number: number; file: string; sha256: string }>;
  /** The one command under the copy's README heading "Start it". */
  readmeCommand: string;
  /** Section 4's checks, items 1 to 7, in order; every one passed. */
  checks: ExportCheck[];
}

/**
 * S9's reading of the record: the run the last journey.signed_off names, its one acceptance.run.finished, passed, of
 * `version`, with the manifest SHA-256 the runner recorded (runner.ts). Returns the run, or why not.
 */
export function signedOffRun(events: Event[], version: string | null): { runId: string; manifestSha256: string } | string {
  const signed = events.filter((e) => e.kind === "journey.signed_off").at(-1);
  if (!signed) return "the project's record holds no sign-off";
  const runId = signed.payload.acceptance_run;
  if (typeof runId !== "string" || !runId) return "its sign-off names no checklist run";
  const ends = events.filter((e) => e.kind === "acceptance.run.finished" && e.payload.run_id === runId);
  if (ends.length !== 1) return `the record holds ${ends.length} ends of run ${runId}, the run its sign-off names, not one`;
  const p = ends[0]!.payload;
  if (p.outcome !== "passed") return `run ${runId}, the run its sign-off names, did not pass`;
  if (version !== null && p.version !== version) return `run ${runId}, the run its sign-off names, checked version ${String(p.version)}, not ${version}`;
  if (typeof p.manifest_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(p.manifest_sha256)) return `run ${runId}, the run its sign-off names, records no manifest SHA-256`;
  return { runId, manifestSha256: p.manifest_sha256 };
}

/** Every path an archive lists (tar's own listing; folders end with "/"). */
export async function listArchive(path: string): Promise<string[]> {
  const { stdout } = await run("tar", ["--list", "--gzip", "--file", path], { env: plainEnv(), maxBuffer: 50 * 1024 * 1024 });
  return stdout.split("\n").filter(Boolean);
}

/**
 * S20 (design section 4, item 1): the archive's paths that are, or are inside, a node_modules folder or one named like
 * a development-only package (compared without regard to case), each given once, up to the part so named.
 */
export function archivePathProblems(paths: string[], devNames: readonly string[]): string[] {
  const bad = new Set(["node_modules", ...devNames.map((n) => n.toLowerCase())]);
  const out: string[] = [];
  for (const p of paths) {
    const parts = p.split("/");
    const i = parts.findIndex((seg) => bad.has(seg.toLowerCase()));
    if (i < 0) continue;
    const hit = parts.slice(0, i + 1).join("/") + (i < parts.length - 1 ? "/" : "");
    if (!out.includes(hit)) out.push(hit);
  }
  return out;
}

/** The one code block under the README's level-2 heading "Start it", or null if there is not exactly one. */
export function startItCommand(readme: string): string | null {
  const start = readme.indexOf("\n## Start it\n");
  if (start < 0) return null;
  const rest = readme.slice(start + "\n## Start it\n".length);
  const next = rest.indexOf("\n## ");
  const section = next < 0 ? rest : rest.slice(0, next);
  const blocks = [...section.matchAll(/^```[^\n]*\n([\s\S]*?)^```$/gm)].map((m) => m[1]!.trim());
  return blocks.length === 1 && blocks[0] ? blocks[0] : null;
}

/** Every file under a folder, relative to `base`, `/`-separated; anything but files and folders is reported. */
function filesUnder(dir: string, rel: string, skipTopGit: boolean): { files: string[]; other: string[] } {
  const files: string[] = [];
  const other: string[] = [];
  const walk = (d: string, r: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (skipTopGit && r === rel && e.name === ".git") continue;
      const p = r ? `${r}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(d, e.name), p);
      else if (e.isFile()) files.push(p);
      else other.push(p);
    }
  };
  walk(dir, rel);
  return { files, other };
}

/** S5: the checkout against what the history holds, by git's own object names of the bytes on disk. */
async function checkoutProblems(top: string): Promise<string[]> {
  const format = (await gitIn(top, ["rev-parse", "--show-object-format"])).trim();
  const want = new Map<string, string>();
  const problems: string[] = [];
  for (const line of (await gitIn(top, ["ls-files", "-s", "-z"])).split("\0").filter(Boolean)) {
    const tab = line.indexOf("\t");
    const [mode, name, stage] = line.slice(0, tab).split(" ");
    const path = line.slice(tab + 1);
    if (stage !== "0" || (mode !== "100644" && mode !== "100755")) problems.push(`${path} (mode ${mode})`);
    else want.set(path, name!);
  }
  const { files, other } = filesUnder(top, "", true);
  for (const p of other) problems.push(`${p} (not a plain file)`);
  for (const p of files) {
    const name = want.get(p);
    if (name === undefined) problems.push(`${p} (not in the history)`);
    else if (blobName(readFileSync(join(top, p)), format) !== name) problems.push(`${p} (bytes differ)`);
  }
  const seen = new Set(files);
  for (const p of want.keys()) if (!seen.has(p)) problems.push(`${p} (missing)`);
  return problems;
}

/** S14: the drizzle/ folder holds its journal and, for each entry, its SQL file and snapshot, and nothing else. */
export function migrationProblems(top: string): string[] {
  const dir = join(top, "drizzle");
  if (!lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) return ["there is no drizzle/ folder"];
  const { files, other } = filesUnder(dir, "drizzle", false);
  const problems = other.map((p) => `${p} is not a plain file`);
  const journalPath = "drizzle/meta/_journal.json";
  if (!files.includes(journalPath)) return [...problems, `${journalPath} is missing`];
  let entries: Array<{ idx?: unknown; tag?: unknown }>;
  try {
    const j = JSON.parse(readFileSync(join(top, journalPath), "utf8")) as { entries?: unknown };
    if (!Array.isArray(j.entries)) throw new Error("no entries");
    entries = j.entries as typeof entries;
  } catch {
    return [...problems, `${journalPath} is not a journal drizzle-kit writes`];
  }
  const expected = new Set([journalPath]);
  entries.forEach((e, n) => {
    const prefix = String(n).padStart(4, "0");
    if (e.idx !== n || typeof e.tag !== "string" || !new RegExp(`^${prefix}_[a-z0-9_]+$`).test(e.tag)) {
      problems.push(`the journal's entry ${n} is not numbered ${n} with a tag starting ${prefix}_`);
      return;
    }
    expected.add(`drizzle/${e.tag}.sql`);
    expected.add(`drizzle/meta/${prefix}_snapshot.json`);
  });
  for (const f of expected) if (!files.includes(f)) problems.push(`${f} is missing`);
  for (const f of files) if (!expected.has(f)) problems.push(`${f} is not in the journal`);
  return problems;
}

/** S13: the fixed files of the copy that are not the builder's own template copies, byte for byte. */
function fixedFileProblems(top: string, templateDir: string): string[] {
  const out: string[] = [];
  for (const f of FIXED_FILES) {
    const st = lstatSync(join(top, f), { throwIfNoEntry: false });
    if (!st?.isFile()) out.push(`${f} (missing)`);
    else if (!readFileSync(join(top, f)).equals(readFileSync(join(templateDir, f)))) out.push(f);
  }
  return out;
}

/** S2: a file the exporter writes, created exclusively and without following a link. */
function createExclusive(top: string, rel: string, body: string | Buffer): void {
  let fd: number;
  try {
    fd = openSync(join(top, rel), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
  } catch (err) {
    return refuse(`The exporter could not create ${rel} as a new plain file (${(err as NodeJS.ErrnoException).code ?? "error"}); the export is refused.`);
  }
  try {
    const buf = typeof body === "string" ? Buffer.from(body, "utf8") : body;
    let done = 0;
    while (done < buf.length) done += writeSync(fd, buf, done, buf.length - done);
  } finally {
    closeSync(fd);
  }
}

/** S2: a folder the exporter makes, new (an existing folder or link is refused). */
function makeFolder(top: string, rel: string): void {
  try {
    mkdirSync(join(top, rel), { mode: 0o755 });
  } catch (err) {
    refuse(`The exporter could not make the folder ${rel} anew (${(err as NodeJS.ErrnoException).code ?? "error"}); the export is refused.`);
  }
}

/** Remove an archive this export placed, if it is still the one it placed (the job, when its event cannot be written). */
export function removePlacedExport(r: Pick<ExportResult, "path" | "sha256">): boolean {
  const st = lstatSync(r.path, { throwIfNoEntry: false });
  if (!st?.isFile() || sha256(readFileSync(r.path)) !== r.sha256) return false;
  rmSync(r.path, { force: true });
  return true;
}

export async function writeExport(i: ExportInput): Promise<ExportResult> {
  checkProjectId(i.projectId);
  const templateDir = i.templateDir ?? TEMPLATE_DIR;
  const v = verifyVersion(i.store, i.projectId, i.version);
  if (!v.ok || !v.manifest || !v.manifestSha256) return refuse(`The acceptance version ${i.version} does not match its manifest (${v.problems.join("; ")}); the export is refused.`);
  // S9: the version is the one the passing run checked.
  if (v.manifestSha256 !== i.runManifestSha256) refuse(`The acceptance version's manifest (SHA-256 ${v.manifestSha256}) is not the one the passing run checked (${i.runManifestSha256}); the export is refused.`);
  const finalName = `${i.projectId}-export.tar.gz`;
  const path = join(i.exportsDir, finalName);
  const exists = () => refuse(`An export of this project exists already (${finalName}); one export per project, so the export is refused.`);
  // S12: one export per project.
  if (lstatSync(path, { throwIfNoEntry: false })) exists();
  // What the workspace history holds, in every commit any branch or tag reaches (the exported copy holds all of
  // them, not only the last): never an acceptance folder, never a file that looks like a secret (review of 13 Nov
  // 2026, note 5: this read the last commit only); since package 3.2, never the note, a file Compose or the image
  // build reads without being told, a link or a submodule.
  const workspaceHead = (await git(i.repo, ["rev-parse", "HEAD"])).trim();
  const tracked = [...new Set((await git(i.repo, ["log", "--all", "--root", "-m", "--no-renames", "--format=", "--name-only", "-z"])).split("\0").map((p) => p.replace(/^\n+/, "")).filter(Boolean))].sort();
  if (tracked.some((f) => f === "acceptance" || f.startsWith("acceptance/"))) refuse("The workspace history holds an acceptance folder, which it must never hold; the export is refused.");
  const secretLike = tracked.filter(secretLikePath);
  if (secretLike.length) refuse(`The project's history holds files that look like secrets (${secretLike.join(", ")}); the export is refused.`);
  if (tracked.some((f) => f.toLowerCase() === EXPORT_NOTE.toLowerCase())) refuse(`The project's history holds ${EXPORT_NOTE}, which only the exporter writes; the export is refused.`);
  const composeRead = tracked.filter(readWithoutBeingTold);
  if (composeRead.length) refuse(`The project's history holds files that Docker Compose or the image build would read without being told (${listed(composeRead)}); the export is refused.`);
  // S1: links (mode 120000) and submodules (160000), in any commit, read from git's raw listing of every change.
  const raw = (await git(i.repo, ["log", "--all", "--root", "-m", "--no-renames", "--no-abbrev", "--format=", "--raw", "-z"])).split("\0");
  const special = new Set<string>();
  for (let k = 0; k < raw.length - 1; k++) {
    const meta = raw[k]!.replace(/^\n+/, "");
    if (!meta.startsWith(":")) continue;
    const [oldMode, newMode] = meta.slice(1).split(" ");
    const p = raw[++k]!;
    for (const m of [oldMode, newMode]) {
      if (m === "120000") special.add(`${p} (a symbolic link)`);
      if (m === "160000") special.add(`${p} (a submodule)`);
    }
  }
  if (special.size) refuse(`The project's history holds a symbolic link or a submodule (${listed([...special].sort())}); the export is refused.`);

  mkdirSync(i.exportsDir, { recursive: true, mode: 0o700 });
  const staging = mkdtempSync(join(i.exportsDir, ".staging-"));
  try {
    const top = join(staging, i.projectId);
    // An empty template folder: the clone gets no sample hooks, no description and no exclude file.
    const emptyTemplate = join(staging, "empty-template");
    mkdirSync(emptyTemplate, { mode: 0o700 });
    // --no-local: through git's own transfer, so the copy holds only the objects a branch or tag reaches. A local
    // clone copies the whole objects folder, objects no commit reaches among them (as a reset can leave).
    await gitIn(staging, ["clone", "--quiet", "--no-local", "--no-hardlinks", `--template=${emptyTemplate}`, "--", i.repo.gitDir, top]);
    // The copy does not point back at this machine's folder.
    await gitIn(top, ["remote", "remove", "origin"]);
    // S5: the checkout is byte for byte what the history holds, and nothing else.
    const differ = await checkoutProblems(top);
    if (differ.length) refuse(`The exported copy's checkout is not byte for byte what its history holds (${listed(differ)}); the export is refused.`);
    // S14, then S13.
    const migrations = migrationProblems(top);
    if (migrations.length) refuse(`The exported copy's drizzle/ folder does not match its journal (${listed(migrations)}); the export is refused.`);
    const fixed = fixedFileProblems(top, templateDir);
    if (fixed.length) refuse(`The exported copy's fixed files differ from the builder's own template copies (${listed(fixed)}); the export is refused.`);
    const readmeCommand = startItCommand(readFileSync(join(top, "README.md"), "utf8"));
    if (!readmeCommand) refuse('The exported copy\'s README.md does not hold exactly one command under "Start it"; the export is refused.');

    await i.hooks?.beforeWrites?.(top);
    // S2: the acceptance tests, copied from the store as the version's manifest names them, and the note, each
    // created exclusively, without following a link, in folders made here.
    const intended = new Map<string, Buffer>();
    for (const f of ["manifest.json", ...v.manifest.items.map((it) => it.file)]) intended.set(`acceptance/${i.version}/${f}`, readFileSync(join(v.dir, f)));
    intended.set(
      "acceptance/README.txt",
      Buffer.from(
        [
          `Label: ${JOURNEY_STAND_IN_LABEL}.`,
          "",
          STAND_IN_NOTE,
          "",
          `Version ${i.version}, copied from the builder's acceptance store into this exported copy only; the project's own history does not hold these files.`,
          `Its manifest's SHA-256 when copied: ${v.manifestSha256}.`,
          "",
        ].join("\n"),
      ),
    );
    intended.set(
      EXPORT_NOTE,
      Buffer.from(
        [
          EXPORT_LABEL,
          "",
          "Built by the scripted engine: fixed changes written in advance by Claude Code (the AI assistant building this project); no AI model was called by the builder.",
          "Made-up data only.",
          "",
        ].join("\n"),
      ),
    );
    makeFolder(top, "acceptance");
    makeFolder(top, `acceptance/${i.version}`);
    for (const [rel, body] of intended) createExclusive(top, rel, body);
    await i.hooks?.beforeCommit?.(top);
    await gitIn(top, ["add", "--", "acceptance", EXPORT_NOTE]);
    await gitIn(top, ["commit", "--quiet", "--no-verify", `--author=${EXPORT_AUTHOR}`, "-m", `[export] acceptance ${i.version} (${JOURNEY_STAND_IN_LABEL}) and the export note, in the exported copy only`]);
    // S4: the export commit adds exactly the intended paths, as plain files, with their content, on the workspace's last commit.
    const format = (await gitIn(top, ["rev-parse", "--show-object-format"])).trim();
    const commitProblems: string[] = [];
    const parents = (await gitIn(top, ["rev-list", "--parents", "-n", "1", "HEAD"])).trim().split(" ").slice(1);
    if (parents.length !== 1 || parents[0] !== workspaceHead) commitProblems.push(`its parents are ${parents.join(" ") || "none"}, not the workspace's last commit`);
    const diff = (await gitIn(top, ["diff-tree", "-r", "--raw", "--no-renames", "--no-abbrev", "-z", "HEAD^", "HEAD"])).split("\0");
    const added = new Set<string>();
    for (let k = 0; k < diff.length - 1; k++) {
      if (!diff[k]!.startsWith(":")) continue;
      const [oldMode, newMode, , newName, status] = diff[k]!.slice(1).split(" ");
      const p = diff[++k]!;
      added.add(p);
      const body = intended.get(p);
      if (!body) commitProblems.push(`${p} (not intended)`);
      else if (oldMode !== "000000" || newMode !== "100644" || status !== "A" || newName !== blobName(body, format)) commitProblems.push(`${p} (not a new plain file with the intended content)`);
    }
    for (const p of intended.keys()) if (!added.has(p)) commitProblems.push(`${p} (not added)`);
    if (commitProblems.length) refuse(`The export commit does not add exactly the intended files as plain files with the intended content (${listed(commitProblems)}); the export is refused.`);
    await i.hooks?.afterCommit?.(top);
    const exportCommit = (await gitIn(top, ["rev-parse", "HEAD"])).trim();
    const commits = Number((await gitIn(top, ["rev-list", "--count", "HEAD"])).trim());
    const files = (await gitIn(top, ["ls-files", "-z"])).split("\0").filter(Boolean);
    // S10: the workspace history is as it was: the copy's commit is not in it.
    const unmoved = async () => {
      if ((await git(i.repo, ["rev-parse", "HEAD"])).trim() !== workspaceHead) refuse("The workspace history changed while the export was made; the export is refused.");
    };
    await unmoved();

    // Packed in the fresh staging folder, under a name of its own.
    const packed = join(staging, "archive.tar.gz");
    await run("tar", ["--create", "--gzip", "--file", packed, "--directory", staging, "--owner=0", "--group=0", "--numeric-owner", "--", i.projectId], { env: plainEnv() });
    chmodSync(packed, 0o600);
    const body = readFileSync(packed);
    const digest = sha256(body);
    // Item 1 (S20), on the machine, reading only.
    const paths = await listArchive(packed);
    const devPaths = archivePathProblems(paths, devOnlyNames(templateDir));
    if (devPaths.length) refuse(`The archive holds a node_modules folder or a path named like a development-only package (${listed(devPaths)}); the export is refused.`);
    const checks: ExportCheck[] = [
      { id: "archive_contents", passed: true, summary: `The archive holds no node_modules folder and no file or folder named like any of the 14 development-only packages (${paths.length} paths read).` },
      {
        id: "fixed_files",
        passed: true,
        summary: `The ${FIXED_FILES.length} fixed files (the start, build, licence and first migration files) are byte-equal to the builder's own template copies, and no commit holds a file Docker Compose or the image build would read without being told.`,
        files: [...FIXED_FILES],
      },
    ];
    // Items 3 to 7, with Docker, on the packed archive, before it is placed or recorded.
    const unpackDir = join(staging, "check");
    mkdirSync(unpackDir, { mode: 0o700 });
    const docker = await i.check({ path: packed, sha256: digest, bytes: body.length, top: i.projectId, unpackDir });
    const failed = docker.find((c) => c.passed !== true);
    if (failed) refuse(`The export check "${failed.summary}" did not pass; the export is refused.`);
    const missing = DOCKER_CHECK_IDS.filter((id) => docker.filter((c) => c.id === id).length !== 1);
    if (missing.length) refuse(`The export checks did not report ${missing.join(", ")}; the export is refused.`);
    for (const id of DOCKER_CHECK_IDS) checks.push(docker.find((c) => c.id === id)!);
    await unmoved();
    i.beforePlace?.();
    // S12: moved into place only if no file has the final name (a link is made, which fails if one has).
    try {
      linkSync(packed, path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") exists();
      throw err;
    }
    return {
      path,
      sha256: digest,
      bytes: statSync(path).size,
      exportCommit,
      workspaceHead,
      commits,
      files,
      manifestSha256: v.manifestSha256,
      items: v.manifest.items.map((it) => ({ number: it.number, file: it.file, sha256: it.sha256 })),
      readmeCommand: readmeCommand!,
      checks,
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
