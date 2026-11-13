/**
 * The acceptance store (package 3.1; design note 2.7; docs/design/package-3.1.md, section 1).
 *
 * Each project's acceptance tests are kept outside every project's folder, under the folder named by the
 * setting BUILDER_DATA_DIR: $BUILDER_DATA_DIR/acceptance/<projectId>/v001, v002, ... Each version holds
 * its test files and manifest.json (who wrote it, the app spec's fingerprint, each item's number, file and
 * fingerprint, and the version's marker: a random string also put into every test file's label line, so
 * that a search finds any copy). A version is written under a temporary name and then renamed; a version
 * that exists is refused.
 *
 * What protects a version: this code only. The builder runs as root on the development machine (known
 * gap 57), and file modes do not stop root, so the files' read-only modes are a courtesy. The runner
 * checks every file against the manifest before any test starts (verifyVersion), and the builder checks
 * the manifest against its `acceptance.version.written` event. The records say "the store refuses a
 * rewrite", never "cannot be changed".
 *
 * Runs are kept beside it: $BUILDER_DATA_DIR/acceptance-runs/<projectId>/<runId>/, with results/ (the
 * runner's /results), secret/ (the sample password file, removed after the run) and builder/ (what the
 * builder writes after the run).
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export const DATA_DIR_SETTING = "BUILDER_DATA_DIR";
/** The repository's top folder. */
export const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
/** In a test file as committed, the place in its label line where the version's marker goes. */
export const MARKER_PLACEHOLDER = "__VERSION_MARKER__";
/** The label every stand-in test carries (owner, question 12 (a), 13 Nov 2026). */
export const STAND_IN_LABEL = "stand-in test";
export const STAND_IN_NOTE =
  "Stand-in test, written in advance by Claude Code (the AI assistant building this project), not by the builder's acceptance writer. No model call by the builder. Allowed only to develop and test the acceptance runner (package 3.1); it shows that the tests are kept apart from the engine, not independent acceptance.";

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const VERSION = /^v\d{3}$/;
export const ITEM_FILE = /^item-(\d{2})\.spec\.ts$/;
const RUN_ID = /^run-[0-9a-z-]{8,80}$/;
/** Largest test file or manifest the store takes or reads. */
const MAX_FILE_BYTES = 256 * 1024;

export const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

export interface AcceptanceStore {
  /** The data folder, resolved (realpath). */
  dataDir: string;
  /** $dataDir/acceptance: one folder per project, one folder per version. */
  root: string;
  /** $dataDir/acceptance-runs: one folder per project, one folder per run. */
  runsRoot: string;
}

/** The data folder named by the setting. It has no default: an unset or relative setting is refused. */
export function dataDirFromSetting(env: NodeJS.ProcessEnv = process.env): string {
  const v = env[DATA_DIR_SETTING];
  if (!v) throw new Error(`${DATA_DIR_SETTING} is not set. It names the folder that holds the acceptance store; it has no default, and must be outside the repository and every project's folder.`);
  if (!isAbsolute(v)) throw new Error(`${DATA_DIR_SETTING} must be an absolute path; "${v}" is not.`);
  return v;
}

/** The path with links resolved, as far as it exists; the rest is added as written. */
export function realpathAsFar(p: string): string {
  const abs = resolve(p);
  let head = abs;
  const tail: string[] = [];
  while (!existsSync(head)) {
    const parent = dirname(head);
    if (parent === head) break;
    tail.unshift(head.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    head = parent;
  }
  return join(realpathSync(head), ...tail);
}

/** True if `child` is `parent` or inside it. Both are compared as given; resolve links first. */
export function insideOrEqual(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * Open the store under a data folder, creating its two folders (mode 0700) if needed. Refused when the
 * data folder, after links are resolved, is inside or equal to the repository (which holds builder/,
 * builder/scripted and templates/) or any of the folders in `refuse` (each project's sandbox folder).
 */
export function openStore(dataDir: string, opts: { refuse?: string[] } = {}): AcceptanceStore {
  if (!isAbsolute(dataDir)) throw new Error(`The data folder must be an absolute path; "${dataDir}" is not.`);
  const real = realpathAsFar(dataDir);
  const forbidden: Array<[string, string]> = [
    [realpathAsFar(REPO_ROOT), "the repository (which holds builder/, builder/scripted and templates/)"],
    [realpathAsFar(join(REPO_ROOT, "builder")), "builder/"],
    [realpathAsFar(join(REPO_ROOT, "templates")), "templates/"],
    ...(opts.refuse ?? []).map((p): [string, string] => [realpathAsFar(p), `a project's sandbox folder (${p})`]),
  ];
  for (const [p, what] of forbidden) {
    if (insideOrEqual(real, p)) throw new Error(`The acceptance store's data folder ${real} is inside ${what}; it is refused.`);
  }
  mkdirSync(real, { recursive: true, mode: 0o700 });
  const root = join(real, "acceptance");
  const runsRoot = join(real, "acceptance-runs");
  for (const d of [root, runsRoot]) {
    mkdirSync(d, { recursive: true, mode: 0o700 });
    const st = lstatSync(d);
    if (!st.isDirectory()) throw new Error(`${d} is not a folder (a link is not accepted).`);
  }
  return { dataDir: real, root, runsRoot };
}

export function checkProjectId(projectId: string): void {
  if (!PROJECT_ID.test(projectId)) throw new Error(`"${projectId}" is not a project id the store accepts (letters, digits, _ and -, starting with a letter or digit, at most 64).`);
}

export function projectDir(store: AcceptanceStore, projectId: string): string {
  checkProjectId(projectId);
  return join(store.root, projectId);
}

export interface ManifestItem {
  number: number;
  file: string;
  sha256: string;
  /** The checklist item, from the app spec: what the user does and what they should see. */
  checklist: string;
}

export interface VersionManifest {
  version: string;
  project_id: string;
  written_by: "stand-in";
  written_by_note: string;
  written_at: string;
  app_spec_sha256: string;
  marker: string;
  items: ManifestItem[];
}

export interface ItemSource {
  number: number;
  /** item-NN.spec.ts */
  file: string;
  /** The file as committed: its label line holds MARKER_PLACEHOLDER once. */
  content: string;
  checklist: string;
}

export interface WrittenVersion {
  version: string;
  dir: string;
  manifest: VersionManifest;
  manifestSha256: string;
}

export function listVersions(store: AcceptanceStore, projectId: string): string[] {
  const dir = projectDir(store, projectId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && VERSION.test(e.name))
    .map((e) => e.name)
    .sort();
}

/**
 * Write a new version of a project's tests: the next number after the last, under a temporary name in the
 * project's folder, then renamed. The marker is new for every version. Each file must hold the marker
 * placeholder exactly once, in its label line, which must also carry the stand-in label.
 */
export function writeVersion(store: AcceptanceStore, projectId: string, input: { writtenBy: "stand-in"; appSpecSha256: string; items: ItemSource[] }): WrittenVersion {
  const pdir = projectDir(store, projectId);
  if (input.writtenBy !== "stand-in") throw new Error("Only stand-in tests can be written in package 3.1.");
  if (!/^[0-9a-f]{64}$/.test(input.appSpecSha256)) throw new Error("The app spec's fingerprint is not a SHA-256.");
  if (input.items.length === 0) throw new Error("A version needs at least one test.");
  const numbers = new Set<number>();
  for (const it of input.items) {
    const m = ITEM_FILE.exec(it.file);
    if (!m || Number(m[1]) !== it.number) throw new Error(`"${it.file}" is not the file name for item ${it.number} (item-NN.spec.ts).`);
    if (numbers.has(it.number)) throw new Error(`Item ${it.number} is given twice.`);
    numbers.add(it.number);
    if (Buffer.byteLength(it.content) > MAX_FILE_BYTES) throw new Error(`${it.file} is larger than the store takes.`);
    const lines = it.content.split("\n");
    const holding = lines.filter((l) => l.includes(MARKER_PLACEHOLDER));
    if (holding.length !== 1 || it.content.split(MARKER_PLACEHOLDER).length !== 2) throw new Error(`${it.file} must hold the marker's place exactly once.`);
    if (!holding[0]!.includes(`Label: ${STAND_IN_LABEL}.`)) throw new Error(`${it.file}'s label line must say "Label: ${STAND_IN_LABEL}."`);
    if (!lines[0]!.startsWith("// Stand-in acceptance test, written in advance by Claude Code")) throw new Error(`${it.file} must start with the stand-in sentence.`);
  }
  mkdirSync(pdir, { recursive: true, mode: 0o700 });
  const existing = listVersions(store, projectId);
  const next = existing.length ? Number(existing[existing.length - 1]!.slice(1)) + 1 : 1;
  if (next > 999) throw new Error("The project has 999 versions; no more can be written.");
  const version = `v${String(next).padStart(3, "0")}`;
  const marker = `acceptance-marker-${randomBytes(16).toString("hex")}`;
  const tmp = join(pdir, `.writing-${randomBytes(6).toString("hex")}`);
  mkdirSync(tmp, { mode: 0o700 });
  try {
    const items: ManifestItem[] = [];
    for (const it of [...input.items].sort((a, b) => a.number - b.number)) {
      const content = it.content.replace(MARKER_PLACEHOLDER, marker);
      writeFileSync(join(tmp, it.file), content, { mode: 0o444, flag: "wx" });
      items.push({ number: it.number, file: it.file, sha256: sha256(content), checklist: it.checklist });
    }
    const manifest: VersionManifest = {
      version,
      project_id: projectId,
      written_by: input.writtenBy,
      written_by_note: STAND_IN_NOTE,
      written_at: new Date().toISOString(),
      app_spec_sha256: input.appSpecSha256,
      marker,
      items,
    };
    const text = JSON.stringify(manifest, null, 2) + "\n";
    writeFileSync(join(tmp, "manifest.json"), text, { mode: 0o444, flag: "wx" });
    // Readable by the runner's user through its read-only mount; nobody's to write (root ignores modes).
    chmodSync(tmp, 0o555);
    const final = join(pdir, version);
    // A version that exists is refused, never replaced. (rename(2) would replace an empty folder.)
    if (lstatSync(final, { throwIfNoEntry: false })) throw new Error(`Version ${version} of ${projectId} exists already; the store refuses to rewrite it.`);
    renameSync(tmp, final);
    return { version, dir: final, manifest, manifestSha256: sha256(text) };
  } catch (err) {
    if (existsSync(tmp)) {
      chmodSync(tmp, 0o700);
      rmSync(tmp, { recursive: true, force: true });
    }
    throw err;
  }
}

/** Read a regular file without following a link, within a size limit. */
function readPlain(path: string, max = MAX_FILE_BYTES): Buffer {
  const st = lstatSync(path, { throwIfNoEntry: false });
  if (!st) throw new Error(`${path} is missing`);
  if (!st.isFile()) throw new Error(`${path} is not a plain file`);
  if (st.size > max) throw new Error(`${path} is larger than allowed`);
  return readFileSync(path);
}

export interface VersionCheck {
  ok: boolean;
  problems: string[];
  manifest?: VersionManifest;
  manifestSha256?: string;
  dir: string;
}

/**
 * Check a version against its manifest before any test starts: the folder is a folder (not a link); it
 * holds exactly the manifest and the files it names, each a plain file with its fingerprint and the
 * marker in its label line; the manifest names this project and version.
 */
export function verifyVersion(store: AcceptanceStore, projectId: string, version: string): VersionCheck {
  const dir = join(projectDir(store, projectId), version);
  const problems: string[] = [];
  if (!VERSION.test(version)) return { ok: false, problems: [`"${version}" is not a version name`], dir };
  const st = lstatSync(dir, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) return { ok: false, problems: [`version ${version} is missing, or is not a folder`], dir };
  let manifest: VersionManifest;
  let manifestSha256: string;
  try {
    const raw = readPlain(join(dir, "manifest.json"));
    manifestSha256 = sha256(raw);
    manifest = JSON.parse(raw.toString("utf8")) as VersionManifest;
  } catch (err) {
    return { ok: false, problems: [`the manifest cannot be read: ${(err as Error).message}`], dir };
  }
  if (manifest.version !== version || manifest.project_id !== projectId) problems.push("the manifest names another project or version");
  if (manifest.written_by !== "stand-in") problems.push(`the manifest says it was written by "${String(manifest.written_by)}"`);
  if (typeof manifest.marker !== "string" || !/^acceptance-marker-[0-9a-f]{32}$/.test(manifest.marker)) problems.push("the manifest's marker is not one the store writes");
  const named = new Set<string>(["manifest.json"]);
  for (const it of Array.isArray(manifest.items) ? manifest.items : []) {
    if (!ITEM_FILE.test(it.file) || named.has(it.file)) {
      problems.push(`the manifest names "${it.file}", which is not a test file name, or twice`);
      continue;
    }
    named.add(it.file);
    try {
      const content = readPlain(join(dir, it.file));
      if (sha256(content) !== it.sha256) problems.push(`${it.file} does not match its fingerprint in the manifest`);
      const label = content.toString("utf8").split("\n").find((l) => l.includes("Label: "));
      if (!label || !label.includes(manifest.marker) || !label.includes(`Label: ${STAND_IN_LABEL}.`)) problems.push(`${it.file}'s label line does not carry the stand-in label and the version's marker`);
    } catch (err) {
      problems.push(`${it.file}: ${(err as Error).message}`);
    }
  }
  if (!Array.isArray(manifest.items) || manifest.items.length === 0) problems.push("the manifest names no test");
  for (const e of readdirSync(dir)) if (!named.has(e)) problems.push(`the version holds "${e}", which the manifest does not name`);
  return { ok: problems.length === 0, problems, manifest, manifestSha256, dir };
}

export interface RunFolder {
  runId: string;
  dir: string;
  /** Mounted at /results in the runner: the runner's to write. */
  results: string;
  /** The sample password file, mounted at /run/secrets/sample-password; removed after the run. */
  secretFile: string;
  /** What the builder writes after the run. */
  builder: string;
}

export function newRunId(): string {
  return `run-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").toLowerCase()}-${randomBytes(4).toString("hex")}`;
}

/** A fresh run folder. Refused if it exists. */
export function newRunFolder(store: AcceptanceStore, projectId: string, runId: string): RunFolder {
  checkProjectId(projectId);
  if (!RUN_ID.test(runId)) throw new Error(`"${runId}" is not a run id.`);
  const pdir = join(store.runsRoot, projectId);
  mkdirSync(pdir, { recursive: true, mode: 0o700 });
  const dir = join(pdir, runId);
  mkdirSync(dir, { mode: 0o700 }); // fails if it exists
  const results = join(dir, "results");
  const secret = join(dir, "secret");
  const builder = join(dir, "builder");
  for (const d of [results, secret, builder]) mkdirSync(d, { mode: 0o700 });
  return { runId, dir, results, secretFile: join(secret, "sample-password"), builder };
}
