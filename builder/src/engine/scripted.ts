/**
 * The scripted engine (build plan package 2.1): a stand-in for the AI build engine, behind the same
 * interface (interface.ts). It makes fixed, known changes and calls no model, so that later packages
 * (the acceptance runner, the exporter, the test harness) can exercise their own behaviour with no
 * spend. Everything it produces is labelled "scripted": its name, its events, the first line of every
 * code file it writes, the app's banner, and its commits.
 *
 * Where the work happens (hard rule 9): the change is applied by builder/scripted/apply.mjs inside
 * the project's engine container (sandbox manager, `engine` service: no network, no settings, the
 * workspace read-write, each protected path read-only over itself, an empty folder over the
 * workspace's `certs`, the change sets read-only). This class runs in the builder: it starts the
 * container, turns the applier's JSON lines into events, then checks with git, on the host, that
 * the files changed are exactly the ones the change names, and commits them. git reads the files
 * the engine wrote; it runs none of them (project-repo.ts).
 *
 * The workspace and the sandbox reach it through its constructor: the interface's StepInstruction
 * carries no workspace. `stepId` picks the change set. The free-text instruction is not read; its
 * length is recorded in the first event.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, posix } from "node:path";
import { emptyUsage } from "../gateway/cost.js";
import { sandbox as sandboxManager, type Sandbox, type StreamingRun } from "../sandbox/manager.js";
import type { BuildEngine, EngineEvent, StepInstruction, StepResult } from "./interface.js";
import { commitAll, workspaceChanges, type ProjectRepo } from "./project-repo.js";

export const SCRIPTED_ENGINE_NAME = "scripted";
export const SCRIPTED_AUTHOR = "Scripted engine <scripted@example.invalid>";
export const scriptedCommitMessage = (example: string, step: string) => `[scripted] ${example} ${step}`;
export const scriptedHeader = (example: string, step: string) => `// Written by the scripted engine (fixed change ${example}/${step}). No AI model wrote this.`;
/** The sentence the scripted change sets add to the app's sample-data banner, in both languages. */
export const SCRIPTED_BANNER = {
  en: "Built by the scripted engine: fixed changes, no AI model.",
  ar: "بناه المحرّك المُبرمَج مسبقاً: تغييرات ثابتة، دون نموذج ذكاء اصطناعي.",
};

/**
 * The template's paths the scripted steps must not change, each mounted read-only over itself:
 * - sign-in and the role guard: src/auth.ts, src/lib/roles.tsx, src/lib/access.ts, and the list of
 *   roles src/app-config.ts, which access.ts reads (its `isRole`);
 * - the sign-in tables and the who-and-when stamps: src/db/schema.ts (the app's own tables go in
 *   src/db/app-schema.ts, so the whole file can be protected);
 * - the build check that refuses unguarded pages: scripts/check-guards.ts;
 * - what decides what is installed and how the image is built: package.json, package-lock.json,
 *   Dockerfile, .dockerignore;
 * - what decides which files Next.js serves and what "@/" means: next.config.ts, tsconfig.json.
 */
export const TEMPLATE_PROTECTED_PATHS = [
  "src/auth.ts",
  "src/lib/roles.tsx",
  "src/lib/access.ts",
  "src/app-config.ts",
  "src/db/schema.ts",
  "scripts/check-guards.ts",
  "package.json",
  "package-lock.json",
  "Dockerfile",
  ".dockerignore",
  "next.config.ts",
  "tsconfig.json",
] as const;

export interface ManifestEntry {
  path: string;
  op: "add" | "replace";
  /** The fingerprint (SHA-256) of the file the change writes. */
  sha256: string;
  /** For a replace: the fingerprint the file must have before the change. */
  expectSha256?: string;
}

export interface Manifest {
  example: string;
  step: string;
  label: string;
  files: ManifestEntry[];
}

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const sha256Of = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** The steps of an example, in order: the folders under builder/scripted/<example>. */
export function listSteps(changeSetsDir: string, example: string): string[] {
  if (!NAME.test(example)) return [];
  const dir = join(changeSetsDir, example);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && NAME.test(d.name) && existsSync(join(dir, d.name, "manifest.json")))
    .map((d) => d.name)
    .sort();
}

export function readManifest(changeSetsDir: string, example: string, step: string): Manifest {
  return JSON.parse(readFileSync(join(changeSetsDir, example, step, "manifest.json"), "utf8")) as Manifest;
}

/** How a step's container is started. The default is the sandbox manager's streaming runner, on the `engine` service. */
export type EngineRunner = (args: { container: string; cmd: string[]; volumes: string[]; onLine: (line: string) => void }) => StreamingRun;

export interface ScriptedEngineOptions {
  /** The project's sandbox, whose compose file has the engine service. */
  sandbox: Sandbox;
  /** The workspace on the host: the same folder the engine service mounts at /workspace. */
  workspace: string;
  /** The project's repository folder, outside the workspace (project-repo.ts). */
  gitDir: string;
  /** builder/scripted on the host: the same folder the engine service mounts at /engine. Read here for the manifests only. */
  changeSetsDir: string;
  /** Which example's change sets: "example-1". */
  example: string;
  /** For rehearsing a stop part-way: the applier pauses this long before each write. */
  delayMsPerWrite?: number;
  /** For tests: how the container is started. */
  runner?: EngineRunner;
}

type ApplierLine =
  | { kind: "start"; example: string; step: string; files: number; label: string }
  | { kind: "write"; op: string; path: string; sha256: string }
  | { kind: "done"; written: number }
  | { kind: "refused"; path: string; reason: string }
  | { kind: "limit"; written: number; needed: number; reason: string }
  | { kind: "error"; reason: string };

type Outcome = { kind: "done" } | { kind: "blocked" | "limit" | "error"; reason: string };

const now = () => new Date().toISOString();

export class ScriptedEngine implements BuildEngine {
  readonly name = SCRIPTED_ENGINE_NAME;
  private current: StreamingRun | null = null;
  private stopRequested = false;
  private running = false;

  constructor(private readonly opts: ScriptedEngineOptions) {
    if (!NAME.test(opts.example)) throw new Error(`"${opts.example}" is not an example name.`);
  }

  private get repo(): ProjectRepo {
    return { gitDir: this.opts.gitDir, workTree: this.opts.workspace };
  }

  async runStep(step: StepInstruction, onEvent: (e: EngineEvent) => void): Promise<StepResult> {
    if (this.running) throw new Error("A step is already running in this engine.");
    this.running = true;
    this.stopRequested = false;
    try {
      return await this.run(step, onEvent);
    } finally {
      this.running = false;
      this.current = null;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.stopRequested = true;
    await this.current?.kill();
  }

  private async run(step: StepInstruction, onEvent: (e: EngineEvent) => void): Promise<StepResult> {
    const { example, workspace, changeSetsDir } = this.opts;
    let turns = 0;
    const fail = (reason: string, changedFiles: string[] = []): StepResult => {
      onEvent({ type: "failed", reason, at: now() });
      return { ok: false, changedFiles, usage: emptyUsage(), turns, failureReason: reason };
    };
    onEvent({
      type: "text",
      text: `Scripted engine: fixed change ${example}/${step.stepId}. The instruction (${step.instruction.length} characters) is not read. No model is called.`,
      at: now(),
    });

    // Refusals before any container is started.
    if (!listSteps(changeSetsDir, example).includes(step.stepId)) return fail(`unknown step: there is no fixed change ${example}/${step.stepId}`);
    if (!Number.isInteger(step.maxTurns) || step.maxTurns < 0) return fail("the turn limit must be a whole number");
    const manifest = readManifest(changeSetsDir, example, step.stepId);
    const root = realpathSync(workspace);
    const volumes: string[] = [];
    for (const p of step.protectedPaths) {
      if (posix.normalize(p) !== p || p.startsWith("/") || p.split("/").includes("..") || p.includes(":") || p.includes(",")) {
        return fail(`the protected path "${p}" is not a plain relative path`);
      }
      const full = join(workspace, p);
      const st = lstatSync(full, { throwIfNoEntry: false });
      // A protected path is mounted read-only over itself. A missing one, a link or a folder link is refused:
      // the mount would create it, or follow the link out of the workspace.
      if (!st) return fail(`the protected path "${p}" does not exist in the workspace, so it cannot be mounted read-only`);
      if (st.isSymbolicLink() || !realpathSync(full).startsWith(root + "/")) return fail(`the protected path "${p}" is a link; it is not mounted`);
      volumes.push(`${full}:/workspace/${p}:ro`);
    }
    const before = await workspaceChanges(this.repo);
    if (before.changed.length + before.ignoredNew.length + before.ignoredChanged.length > 0) {
      return fail("the workspace has changes that are not committed; a step starts only from a committed workspace");
    }

    // The step itself, in the engine container.
    const cmd = ["node", "/engine/apply.mjs", "--example", example, "--step", step.stepId, "--protected", JSON.stringify(step.protectedPaths), "--max-writes", String(step.maxTurns)];
    if (this.opts.delayMsPerWrite) cmd.push("--delay-ms", String(this.opts.delayMsPerWrite));
    const container = `${this.opts.sandbox.projectName}-engine-${step.stepId}-${randomBytes(3).toString("hex")}`.slice(0, 120);
    // The first thing the applier reports that ends the step. Set from the line callback.
    const seen: { outcome: Outcome | null } = { outcome: null };
    const onLine = (raw: string) => {
      let line: ApplierLine;
      try {
        line = JSON.parse(raw) as ApplierLine;
      } catch {
        seen.outcome ??= { kind: "error", reason: "the engine printed a line that could not be read" };
        return;
      }
      if (line.kind === "write") {
        turns++;
        onEvent({ type: "tool_call", tool: "scripted.write", input: { op: line.op, path: line.path, sha256: line.sha256 }, at: now() });
      } else if (line.kind === "start") {
        onEvent({ type: "text", text: `Scripted engine: ${line.label} (${line.files} files).`, at: now() });
      } else if (line.kind === "refused") {
        seen.outcome ??= { kind: "blocked", reason: `${line.path}: ${line.reason}` };
        onEvent({ type: "blocked", reason: `${line.path}: ${line.reason}`, at: now() });
      } else if (line.kind === "limit") seen.outcome ??= { kind: "limit", reason: line.reason };
      else if (line.kind === "error") seen.outcome ??= { kind: "error", reason: line.reason };
      else if (line.kind === "done") seen.outcome ??= { kind: "done" };
      else seen.outcome ??= { kind: "error", reason: "the engine printed a line of a kind this builder does not know" };
    };
    const runner: EngineRunner =
      this.opts.runner ?? ((a) => sandboxManager.runStreaming(this.opts.sandbox, "engine", a.cmd, { container: a.container, volumes: a.volumes, onLine: a.onLine }));
    this.current = runner({ container, cmd, volumes, onLine });
    if (this.stopRequested) await this.current.kill();
    const ended = await this.current.done;

    let failure: string | null = null;
    const o = seen.outcome;
    if (this.stopRequested) failure = "stopped";
    else if (o?.kind === "blocked") failure = `blocked: ${o.reason}`;
    else if (o?.kind === "limit") failure = "turn limit reached";
    else if (o?.kind === "error") failure = o.reason;
    else if (ended.code !== 0) failure = `the engine container ended with exit code ${ended.code ?? "none (killed)"}: ${ended.stderrTail.trim().split("\n").pop() ?? ""}`;
    else if (o?.kind !== "done") failure = "the engine did not say that it had finished";

    // What git sees, whatever happened: the step's result reports it.
    const after = await workspaceChanges(this.repo);
    const changedFiles = [...new Set([...after.changed, ...after.ignoredNew, ...after.ignoredChanged])].sort();
    if (failure) return fail(failure, changedFiles);

    // The files changed must be exactly the change's own, with exactly the change's contents.
    const expected = new Set(manifest.files.map((f) => f.path));
    const unexpected = after.changed.filter((p) => !expected.has(p));
    const ignored = [...after.ignoredNew, ...after.ignoredChanged];
    const missing = [...expected].filter((p) => !after.changed.includes(p));
    const protectedHit = changedFiles.filter((p) => step.protectedPaths.some((q) => p === q || p.startsWith(q + "/")));
    const wrongContent = manifest.files.filter((f) => {
      const st = lstatSync(join(workspace, f.path), { throwIfNoEntry: false });
      return !st?.isFile() || sha256Of(readFileSync(join(workspace, f.path))) !== f.sha256;
    });
    if (protectedHit.length) return fail(`protected files changed: ${protectedHit.join(", ")}`, changedFiles);
    if (unexpected.length) return fail(`files changed that are not in the fixed change: ${unexpected.join(", ")}`, changedFiles);
    if (ignored.length) return fail(`files changed that git ignores, so the history would not show them: ${ignored.join(", ")}`, changedFiles);
    if (missing.length) return fail(`files of the fixed change that did not change: ${missing.join(", ")}`, changedFiles);
    if (wrongContent.length) return fail(`files whose contents are not the fixed change's: ${wrongContent.map((f) => f.path).join(", ")}`, changedFiles);

    await commitAll(this.repo, SCRIPTED_AUTHOR, scriptedCommitMessage(example, step.stepId));
    onEvent({ type: "finished", at: now() });
    return { ok: true, changedFiles, usage: emptyUsage(), turns };
  }
}
