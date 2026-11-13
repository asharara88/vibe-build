/**
 * The export (package J1; final design, section 1, item 9), offered only after sign-off.
 *
 * A clone of the project's history, with the acceptance tests copied from the store and committed IN THE
 * EXPORTED COPY ONLY: never in the workspace history the engine's container mounts read-write (design note,
 * section 2.7; the tests are kept apart from the engine). Downloaded as one .tar.gz, labelled internal only and
 * not yet shown to start without the builder (package 3.2): its tables are made by the builder's tools
 * container, and it has no notices file (known gaps 39 and 53).
 *
 * git and tar run on the machine that hosts the builder; they read and copy files and run none of them. git runs
 * with no hooks, no file-system monitor, and none of the machine's or the user's own settings, as for the
 * project's history (project-repo.ts). The export is refused if the history holds a file that looks like a
 * secret (a settings file, a key or a certificate), or an acceptance folder.
 */
import { execFile } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { checkProjectId, sha256, STAND_IN_NOTE, verifyVersion, type AcceptanceStore } from "../acceptance/store.js";
import { git, type ProjectRepo } from "../engine/project-repo.js";
import { EXPORT_LABEL, JOURNEY_STAND_IN_LABEL } from "./journey.js";

const run = promisify(execFile);

/** Who commits the acceptance folder in the exported copy. */
export const EXPORT_AUTHOR = "Builder export <export@example.invalid>";

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

export interface ExportInput {
  repo: ProjectRepo;
  store: AcceptanceStore;
  projectId: string;
  /** The acceptance version fixed when the plan was confirmed. */
  version: string;
  /** Where the archive is written (`journeyFolder(dataDir, projectId, "exports")`). */
  exportsDir: string;
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
}

export async function writeExport(i: ExportInput): Promise<ExportResult> {
  checkProjectId(i.projectId);
  const v = verifyVersion(i.store, i.projectId, i.version);
  if (!v.ok || !v.manifest) throw new Error(`The acceptance version ${i.version} does not match its manifest (${v.problems.join("; ")}); the export is refused.`);
  // What the workspace history holds: never an acceptance folder, never a file that looks like a secret.
  const workspaceHead = (await git(i.repo, ["rev-parse", "HEAD"])).trim();
  const tracked = (await git(i.repo, ["ls-tree", "-r", "--name-only", "HEAD"])).split("\n").filter(Boolean);
  if (tracked.some((f) => f === "acceptance" || f.startsWith("acceptance/"))) throw new Error("The workspace history holds an acceptance folder, which it must never hold; the export is refused.");
  const secretLike = tracked.filter(secretLikePath);
  if (secretLike.length) throw new Error(`The project's history holds files that look like secrets (${secretLike.join(", ")}); the export is refused.`);

  mkdirSync(i.exportsDir, { recursive: true, mode: 0o700 });
  const staging = mkdtempSync(join(i.exportsDir, ".staging-"));
  try {
    const top = join(staging, i.projectId);
    await gitIn(staging, ["clone", "--quiet", "--no-hardlinks", "--", i.repo.gitDir, top]);
    // The copy does not point back at this machine's folder.
    await gitIn(top, ["remote", "remove", "origin"]);
    // The acceptance tests, copied from the store, as the version's manifest names them.
    const dest = join(top, "acceptance", i.version);
    mkdirSync(dest, { recursive: true });
    for (const f of ["manifest.json", ...v.manifest.items.map((it) => it.file)]) copyFileSync(join(v.dir, f), join(dest, f));
    writeFileSync(
      join(top, "acceptance", "README.txt"),
      [
        `Label: ${JOURNEY_STAND_IN_LABEL}.`,
        "",
        STAND_IN_NOTE,
        "",
        `Version ${i.version}, copied from the builder's acceptance store into this exported copy only; the project's own history does not hold these files.`,
        `Its manifest's SHA-256 when copied: ${v.manifestSha256}.`,
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(top, "EXPORT-NOTE.txt"),
      [
        EXPORT_LABEL,
        "",
        "Built by the scripted engine: fixed changes written in advance by Claude Code (the AI assistant building this project); no AI model was called by the builder.",
        "Made-up data only.",
        "",
      ].join("\n"),
    );
    await gitIn(top, ["add", "--", "acceptance", "EXPORT-NOTE.txt"]);
    await gitIn(top, ["commit", "--quiet", "--no-verify", `--author=${EXPORT_AUTHOR}`, "-m", `[export] acceptance ${i.version} (${JOURNEY_STAND_IN_LABEL}) and the export note, in the exported copy only`]);
    const exportCommit = (await gitIn(top, ["rev-parse", "HEAD"])).trim();
    const commits = Number((await gitIn(top, ["rev-list", "--count", "HEAD"])).trim());
    const files = (await gitIn(top, ["ls-files"])).split("\n").filter(Boolean);
    // The workspace history is as it was: the copy's commit is not in it.
    if ((await git(i.repo, ["rev-parse", "HEAD"])).trim() !== workspaceHead) throw new Error("The workspace history changed while the export was made; the export is refused.");
    const path = join(i.exportsDir, `${i.projectId}-export.tar.gz`);
    rmSync(path, { force: true });
    await run("tar", ["--create", "--gzip", "--file", path, "--directory", staging, "--owner=0", "--group=0", "--numeric-owner", "--", i.projectId], { env: plainEnv() });
    chmodSync(path, 0o600);
    const body = readFileSync(path);
    return { path, sha256: sha256(body), bytes: statSync(path).size, exportCommit, workspaceHead, commits, files };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
