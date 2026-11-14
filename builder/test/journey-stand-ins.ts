/**
 * Package J1, part 2: a stand-in for example 1's sandboxes (src/orchestrator/example-1-adapter.ts), for the tests
 * that need no container. It makes a real workspace and a real history (the template copied, its first commit),
 * applies a step's fixed change on this machine as the applier would in the engine's container, and stands in
 * for the image build, the app camera and the acceptance runner. No container, no network, no model.
 *
 * Package J2 (final design, section 5): each stand-in sandbox has a change-set folder of its own,
 * `engine-change-sets` inside its own folder, copied from builder/scripted as makeExample1 does
 * (scripts/example-1-sandbox.ts); its runner reads manifests and files from that folder only, never from
 * builder/scripted. `stageBrokenStep` copies the deliberately broken step 03 there, and nowhere else. The checklist
 * run has a "failed" mode, written as package 3.1's runner writes a failed item (src/acceptance/runner.ts, results.ts).
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type pg from "pg";
import type { AcceptanceReport, AcceptanceRunInput } from "../src/acceptance/runner.js";
import { newRunFolder, sha256 } from "../src/acceptance/store.js";
import { initProjectRepo } from "../src/engine/project-repo.js";
import { readManifest, type EngineRunner } from "../src/engine/scripted.js";
import type { ProjectSandbox, Sandboxes } from "../src/orchestrator/example-1-adapter.js";
import { APP_SHOTS } from "../src/orchestrator/journey-jobs.js";
import { EXAMPLE, SandboxNotRemoved, type SandboxRecord } from "../src/orchestrator/journey.js";
import type { AppStream, Sandbox, StreamingEnd } from "../src/sandbox/manager.js";
import { appendEvent } from "../src/store/events.js";

const templateDir = resolve(import.meta.dirname, "..", "..", "templates", "next");
/** builder/scripted and builder/scripted-broken: the stand-in copies from them, as makeExample1 and stageBrokenStep do. */
const SCRIPTED_DIR = resolve(import.meta.dirname, "..", "scripted");
const SCRIPTED_BROKEN_DIR = resolve(import.meta.dirname, "..", "scripted-broken");
/** The deliberately broken step (builder/scripted-broken, package 3.1). */
export const BROKEN_STEP_ID = "03-wrong-status";
/** The summary package 3.1's results reader writes for the broken copy's run (test/acceptance-live.test.ts, run D). */
export const FAILED_SUMMARY = 'version failed: item 1 failed at step "sees status waiting"';
/** The step a failed item names in the stand-in's "failed" mode, as run D's runner names it. */
export const FAILED_STEP = "sees status waiting";
/** A one-pixel PNG, made up for the tests. */
export const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");
export const PASSED_SUMMARY = "version passed; checklist incomplete (5 of the app spec's 6 checklist items have no test)";

export class StandInSandboxes implements Sandboxes {
  made: string[] = [];
  /** Each engine container asked for: its step, its name and (package J2 (c)) the applier's command, to show the pause passed or not. */
  runnerCalls: Array<{ step: string; container: string; cmd: string[] }> = [];
  destroyed: string[] = [];
  destroyedRecorded: Array<{ projectId: string; rec: SandboxRecord }> = [];
  /**
   * Known gap 180's fix: what a removal leaves, as the real adapter reports it (it throws, and keeps the folder); null:
   * nothing. After the fix's review: a list is what every project's removal leaves; an object, by project id, what the
   * removal of each project named leaves (the others' removals complete).
   */
  notRemoved: string[] | Record<string, string[]> | null = null;
  stoppedApps: string[] = [];
  started: string[] = [];
  /** A file the next step also writes, which its fixed change does not name: the step then fails. */
  extraFile: string | null = null;
  /** What the app camera leaves in its folder. */
  cameraWrites: (outDir: string) => void = (outDir) => {
    for (const s of APP_SHOTS) writeFileSync(join(outDir, `${s.name}.png`), PNG_1X1);
  };
  ports: string | null = null;
  /** What the camera's image check answers (package 3.1b's runnerImageProblem): null, or a problem. */
  cameraImage: string | null = null;
  /** Set as cameraImage once the app is started: a problem that appears while the app is built. */
  cameraImageAfterStart: string | null = null;
  /** What the camera's network check answers (package 0.6c: its service on the project's front network alone): null, or a problem. */
  cameraNetwork: string | null = null;
  /** How many times the camera's image and network were checked, and how many times the camera ran. */
  cameraImageChecks = 0;
  cameraNetworkChecks = 0;
  cameraRuns = 0;
  /**
   * After the review bot on defb9c4: when set, the app camera waits until `release` resolves, or until the signal
   * its job gives it is aborted (the interface lost its instance lock); aborted, it writes nothing and ends as a
   * killed container would (counted in `cameraAborted`).
   */
  cameraHold: { started: () => void; release: Promise<void> } | null = null;
  cameraAborted = 0;
  /** After the review bot on defb9c4: when set, the engine's container (this stand-in runner) runs until it is killed; `started` is called once it is asked for. */
  engineHold: { started: () => void } | null = null;
  /** The engine containers killed, by name. */
  killedRunners: string[] = [];
  /**
   * The acceptance run's outcome: passed (item 1 passed), did not run, or (package J2) failed: item 1 failed at the
   * step "sees status waiting", with its failure file and its screenshot, the outcome word "failed" and exit code 1.
   */
  acceptanceOutcome: "passed" | "did not run" | "failed" = "passed";
  /**
   * What the run's acceptance.run.finished event says its outcome word is (package 3.1b): by default the word that
   * goes with acceptanceOutcome ("passed" or "not passed"); a word of its own, or "absent" for an event with none
   * (a record written before 3.1b), to show the journey reads the word and not the summary's text.
   */
  outcomeWord: string | "absent" | null = null;
  /** The acceptance job fails after the runner has written its events (as a later fault in the job would). */
  acceptanceFailsAfterRun = false;
  /** The acceptance job fails before the runner has written any event (as a fault before or inside the runner would). */
  acceptanceFailsBeforeRun = false;
  /** Package J2: when set, the next sandbox made uses this folder as its change-set folder, outside its own folder (a test of the target check). */
  changeSetsOutside: string | null = null;
  /** Package J2: every call of `stageBrokenStep`, with the folder it copied into. */
  stagedBroken: Array<{ projectId: string; into: string }> = [];
  /** Package J2: when set, the staged manifest is changed after the copy, so that its SHA-256 differs from the one chosen (a test of the read-back). */
  stageTamper = false;
  private dirs: string[] = [];

  constructor(private readonly pool: pg.Pool) {}

  async make(projectId: string): Promise<ProjectSandbox> {
    const dir = mkdtempSync(join(tmpdir(), "builder-acceptance-standin-"));
    this.dirs.push(dir);
    const workspace = join(dir, "workspace");
    cpSync(templateDir, workspace, { recursive: true, filter: (src) => !/\/(node_modules|\.next|certs|\.env(\.(?!example$)[^/]*)?)(\/|$)/.test(src) });
    // As createSandbox does on the development profile: the session certificate in the workspace, which git ignores.
    mkdirSync(join(workspace, "certs"));
    writeFileSync(join(workspace, "certs", "session-ca.crt"), "made-up certificate\n");
    const repo = { gitDir: join(dir, "workspace.git"), workTree: workspace };
    await initProjectRepo(repo, "Template copy (stand-in sandbox)");
    this.made.push(projectId);
    // Package J2: the sandbox's own change-set folder, as makeExample1 makes it: the applier and example 1's two fixed
    // steps, copied from builder/scripted. With `changeSetsOutside` set, that folder instead (outside the sandbox's own).
    const changeSets = this.changeSetsOutside ?? join(dir, "engine-change-sets");
    this.changeSetsOutside = null;
    mkdirSync(join(changeSets, EXAMPLE), { recursive: true });
    cpSync(join(SCRIPTED_DIR, "apply.mjs"), join(changeSets, "apply.mjs"));
    for (const step of ["01-data", "02-submitter-screen"]) cpSync(join(SCRIPTED_DIR, EXAMPLE, step), join(changeSets, EXAMPLE, step), { recursive: true });
    const sb = { dir, composeFile: join(dir, "compose.yaml"), projectName: `builder_${projectId}` } as Sandbox;
    return { projectId, dir, workspace, changeSets, repo, sb, appPort: 3161, buildProxyPort: 13161, appUrl: "http://app:3161", samplePassword: "made-up-sample-password", appStarted: false };
  }

  /** Package J2: copy the deliberately broken step 03 into the sandbox's change-set folder, as scripts/example-1-sandbox.ts's stageBrokenStep does. */
  async stageBrokenStep(x: ProjectSandbox): Promise<void> {
    this.stagedBroken.push({ projectId: x.projectId, into: x.changeSets });
    const dest = join(x.changeSets, EXAMPLE, BROKEN_STEP_ID);
    cpSync(join(SCRIPTED_BROKEN_DIR, EXAMPLE, BROKEN_STEP_ID), dest, { recursive: true });
    if (this.stageTamper) writeFileSync(join(dest, "manifest.json"), `${readFileSync(join(dest, "manifest.json"), "utf8")}\n`);
  }

  engineRunner(x: ProjectSandbox): EngineRunner {
    return (a) => {
      const step = a.cmd[a.cmd.indexOf("--step") + 1]!;
      this.runnerCalls.push({ step, container: a.container, cmd: [...a.cmd] });
      // Package J2: from the sandbox's own change-set folder, as the engine's container reads it (mounted at /engine).
      const m = readManifest(x.changeSets, EXAMPLE, step);
      let finish: (e: StreamingEnd) => void = () => undefined;
      const done = new Promise<StreamingEnd>((r) => (finish = r));
      const kill = async () => {
        this.killedRunners.push(a.container);
        finish({ code: 137, stderrTail: "" });
      };
      if (this.engineHold) {
        const hold = this.engineHold;
        setTimeout(() => hold.started(), 0);
        return { container: a.container, done, kill };
      }
      setTimeout(() => {
        a.onLine(JSON.stringify({ kind: "start", example: EXAMPLE, step, files: m.files.length, label: m.label }));
        for (const f of m.files) {
          mkdirSync(dirname(join(x.workspace, f.path)), { recursive: true });
          writeFileSync(join(x.workspace, f.path), readFileSync(join(x.changeSets, EXAMPLE, step, "files", f.path)));
          a.onLine(JSON.stringify({ kind: "write", op: f.op, path: f.path, sha256: f.sha256 }));
        }
        if (this.extraFile) {
          writeFileSync(join(x.workspace, this.extraFile), "made-up file the fixed change does not name\n");
          this.extraFile = null;
        }
        a.onLine(JSON.stringify({ kind: "done", written: m.files.length }));
        finish({ code: 0, stderrTail: "" });
      }, 5);
      return { container: a.container, done, kill };
    };
  }

  async portsBusy(): Promise<string | null> {
    return this.ports;
  }

  async buildAndStart(x: ProjectSandbox, log: (line: string) => void): Promise<void> {
    log("stand-in: no image built, no container started");
    this.started.push(x.projectId);
    if (this.cameraImageAfterStart !== null) this.cameraImage = this.cameraImageAfterStart;
  }

  async cameraImageProblem(): Promise<string | null> {
    this.cameraImageChecks++;
    return this.cameraImage;
  }

  async cameraNetworkProblem(): Promise<string | null> {
    this.cameraNetworkChecks++;
    return this.cameraNetwork;
  }

  /** Package J3: what the streams' network check answers (the `check` service on `front` alone): null, or a problem. */
  streamNetwork: string | null = null;
  streamNetworkChecks = 0;
  /** Package J3: where a stand-in stream connects (a stand-in app on the machine's loopback address, in the tests only). */
  upstreamPort: number | null = null;
  /** The stand-in streams opened, and those killed. */
  streamsOpened = 0;
  streamsKilled = 0;

  /**
   * After the review bot on af80dc9: when set, the streams' network check waits until `release` resolves; `started` is
   * called once it is asked. "Open the live app" is then pending, so a test can sign out meanwhile.
   */
  streamNetworkHold: { started: () => void; release: Promise<void> } | null = null;

  async streamNetworkProblem(): Promise<string | null> {
    this.streamNetworkChecks++;
    const hold = this.streamNetworkHold;
    if (hold) {
      hold.started();
      await hold.release;
    }
    return this.streamNetwork;
  }

  appStream(): AppStream {
    if (this.upstreamPort === null) throw new Error("the stand-in has no upstream for a stream");
    this.streamsOpened++;
    const sock = net.connect(this.upstreamPort, "127.0.0.1");
    sock.on("error", () => undefined);
    const done = new Promise<StreamingEnd>((r) => sock.on("close", () => r({ code: 0, stderrTail: "" })));
    return {
      container: `stand-in-stream-${this.streamsOpened}`,
      stdin: sock,
      stdout: sock,
      done,
      kill: async () => {
        this.streamsKilled++;
        sock.destroy();
        await done;
      },
      args: [],
    };
  }

  async appCamera(_x: ProjectSandbox, a: { outDir: string; secretFile: string; onLine: (line: string) => void; signal?: AbortSignal }): Promise<StreamingEnd> {
    // The password file is there while the camera runs.
    if (readFileSync(a.secretFile, "utf8") !== "made-up-sample-password") throw new Error("the stand-in camera did not find the sample password file");
    this.cameraRuns++;
    if (this.cameraHold) {
      const hold = this.cameraHold;
      hold.started();
      const aborted = await new Promise<boolean>((resolve) => {
        void hold.release.then(() => resolve(false));
        if (a.signal?.aborted) resolve(true);
        a.signal?.addEventListener("abort", () => resolve(true), { once: true });
      });
      if (aborted) {
        this.cameraAborted++;
        return { code: 137, stderrTail: "" };
      }
    }
    this.cameraWrites(a.outDir);
    a.onLine(JSON.stringify({ kind: "done", code: 0 }));
    return { code: 0, stderrTail: "" };
  }

  async runAcceptance(input: AcceptanceRunInput): Promise<AcceptanceReport> {
    if (this.acceptanceFailsBeforeRun) throw new Error("stand-in: the job failed before the runner wrote any event");
    if (this.acceptanceOutcome === "failed") return this.failedRun(input);
    const runId = `run-standin-${Date.now().toString(36)}`;
    const passed = this.acceptanceOutcome === "passed";
    const summary = passed ? PASSED_SUMMARY : "did not run: the stand-in said so";
    const word = this.outcomeWord ?? (passed ? "passed" : "not passed");
    const common = { run_id: runId, version: input.version, written_by: "stand-in", label: "stand-in test" };
    const events = [
      await appendEvent(this.pool, input.projectId, "acceptance.run.started", { ...common, container_started: passed, refused: null }),
      await appendEvent(this.pool, input.projectId, "acceptance.item", { ...common, item: 1, file: "item-01.spec.ts", status: passed ? "passed" : "did not run", why: passed ? "ran once and passed, with its screenshot" : "not reached", screenshot: null }),
      await appendEvent(this.pool, input.projectId, "acceptance.run.finished", { ...common, exit_code: passed ? 0 : null, timed_out: false, ...(word === "absent" ? {} : { outcome: word }), summary, run_problems: [] }),
    ];
    if (this.acceptanceFailsAfterRun) throw new Error("stand-in: the job failed after the runner wrote its events");
    return { runId, version: input.version, manifestSha256: null, writtenBy: "stand-in", refused: null, appAnswered: true, exit: passed ? { code: 0, stderrTail: "" } : null, args: null, reading: { outcome: word === "absent" ? "not passed" : word, items: [], runProblems: [], summary }, output: [], events } as unknown as AcceptanceReport;
  }

  /**
   * Package J2: a run whose item 1 failed, as package 3.1's runner writes it (runner.ts, results.ts): the item "failed",
   * "it ran and failed", the step it failed at, its failure file (in the run's builder folder) and its screenshot (in the
   * run's results folder, where the interface serves it from); the outcome word "failed", exit code 1. Items 2 to 6 have
   * no test, so no event.
   */
  private async failedRun(input: AcceptanceRunInput): Promise<AcceptanceReport> {
    const runId = `run-standin-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
    const folder = newRunFolder(input.store, input.projectId, runId);
    const shot = join(folder.results, "item-01-failed.png");
    writeFileSync(shot, PNG_1X1, { mode: 0o600 });
    const failure = join(folder.builder, "item-01-failure.txt");
    writeFileSync(failure, 'Made-up failure text of the stand-in runner: the list was expected to say "Waiting"; it said "Approved".\n', { mode: 0o600 });
    const word = this.outcomeWord ?? "failed";
    const common = { run_id: runId, version: input.version, written_by: "stand-in", label: "stand-in test" };
    const events = [
      await appendEvent(this.pool, input.projectId, "acceptance.run.started", { ...common, container_started: true, refused: null }),
      await appendEvent(this.pool, input.projectId, "acceptance.item", {
        ...common,
        item: 1,
        file: "item-01.spec.ts",
        status: "failed",
        why: "it ran and failed",
        test_title: "item 1 (made-up title of the stand-in)",
        step: FAILED_STEP,
        failure_file: { path: failure, sha256: sha256(readFileSync(failure)) },
        screenshot: { path: shot, sha256: sha256(readFileSync(shot)) },
      }),
      await appendEvent(this.pool, input.projectId, "acceptance.run.finished", { ...common, exit_code: 1, timed_out: false, ...(word === "absent" ? {} : { outcome: word }), summary: FAILED_SUMMARY, run_problems: [] }),
    ];
    return { runId, version: input.version, manifestSha256: null, writtenBy: "stand-in", runFolder: folder, refused: null, appAnswered: true, exit: { code: 1, stderrTail: "" }, args: null, reading: { outcome: word === "absent" ? "not passed" : word, items: [], runProblems: [], summary: FAILED_SUMMARY }, output: [], events } as unknown as AcceptanceReport;
  }

  async stopApp(x: ProjectSandbox): Promise<void> {
    this.stoppedApps.push(x.projectId);
    x.appStarted = false;
  }

  /** What the removal of one project leaves (`notRemoved`), or null. */
  private leftOf(projectId: string): string[] | null {
    const n = this.notRemoved;
    return n === null ? null : Array.isArray(n) ? n : (n[projectId] ?? null);
  }

  async destroy(x: ProjectSandbox): Promise<string> {
    const left = this.leftOf(x.projectId);
    if (left) {
      // As the real removal (after the fix's review): by the time it reports what is left, it has stopped the app and
      // removed what it could; the folder is kept.
      x.appStarted = false;
      throw new SandboxNotRemoved(x.projectId, left);
    }
    this.destroyed.push(x.projectId);
    x.appStarted = false;
    rmSync(x.dir, { recursive: true, force: true });
    return "stand-in: folder removed";
  }

  async destroyRecorded(projectId: string, rec: SandboxRecord): Promise<string> {
    const left = this.leftOf(projectId);
    if (left) throw new SandboxNotRemoved(projectId, left);
    this.destroyedRecorded.push({ projectId, rec });
    return "stand-in";
  }

  removeAll(): void {
    for (const d of this.dirs) rmSync(d, { recursive: true, force: true });
  }
}

/**
 * Package J2: what builder/scripted and builder/scripted-broken hold (each file with its SHA-256) and git's status of
 * both folders. The tests compare them before and after: neither is ever written by the journey.
 */
export function changeSetFolders(): { listing: string[]; status: string } {
  const builderDir = resolve(import.meta.dirname, "..");
  const listing: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) walk(join(dir, e.name), `${rel}/${e.name}`);
      else listing.push(`${rel}/${e.name} ${sha256(readFileSync(join(dir, e.name)))}`);
    }
  };
  for (const top of ["scripted", "scripted-broken"]) walk(join(builderDir, top), top);
  const status = execFileSync("git", ["-C", builderDir, "status", "--porcelain", "--untracked-files=all", "--ignored", "--", "scripted", "scripted-broken"], { encoding: "utf8" });
  return { listing, status };
}

/** A pool that holds every write of one event kind for `ms`, so that a write left unawaited lands late. */
export function slowPoolFor(pool: pg.Pool, kind: string, ms: number): pg.Pool {
  return new Proxy(pool, {
    get(target, prop) {
      if (prop === "query")
        return async (...args: unknown[]) => {
          if (Array.isArray(args[1]) && args[1][1] === kind) await new Promise((r) => setTimeout(r, ms));
          return (target.query as (...a: unknown[]) => unknown)(...args);
        };
      const v = Reflect.get(target, prop) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}
