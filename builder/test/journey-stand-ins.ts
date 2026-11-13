/**
 * Package J1, part 2: a stand-in for example 1's sandboxes (src/orchestrator/example-1-adapter.ts), for the tests
 * that need no container. It makes a real workspace and a real history (the template copied, its first commit),
 * applies a step's fixed change on this machine as the applier would in the engine's container, and stands in
 * for the image build, the app camera and the acceptance runner. No container, no network, no model.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type pg from "pg";
import type { AcceptanceReport, AcceptanceRunInput } from "../src/acceptance/runner.js";
import { initProjectRepo } from "../src/engine/project-repo.js";
import { readManifest, type EngineRunner } from "../src/engine/scripted.js";
import type { ProjectSandbox, Sandboxes } from "../src/orchestrator/example-1-adapter.js";
import { APP_SHOTS } from "../src/orchestrator/journey-jobs.js";
import { CHANGE_SETS_DIR, EXAMPLE, type SandboxRecord } from "../src/orchestrator/journey.js";
import type { Sandbox, StreamingEnd } from "../src/sandbox/manager.js";
import { appendEvent } from "../src/store/events.js";

const templateDir = resolve(import.meta.dirname, "..", "..", "templates", "next");
/** A one-pixel PNG, made up for the tests. */
export const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");
export const PASSED_SUMMARY = "version passed; checklist incomplete (5 of the app spec's 6 checklist items have no test)";

export class StandInSandboxes implements Sandboxes {
  made: string[] = [];
  runnerCalls: Array<{ step: string; container: string }> = [];
  destroyed: string[] = [];
  destroyedRecorded: Array<{ projectId: string; rec: SandboxRecord }> = [];
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
  /** How many times the camera's image was checked, and how many times the camera ran. */
  cameraImageChecks = 0;
  cameraRuns = 0;
  /** The acceptance run's outcome: passed (item 1 passed) or did not run. */
  acceptanceOutcome: "passed" | "did not run" = "passed";
  /**
   * What the run's acceptance.run.finished event says its outcome word is (package 3.1b): by default the word that
   * goes with acceptanceOutcome ("passed" or "not passed"); a word of its own, or "absent" for an event with none
   * (a record written before 3.1b), to show the journey reads the word and not the summary's text.
   */
  outcomeWord: string | "absent" | null = null;
  /** The acceptance job fails after the runner has written its events (as a later fault in the job would). */
  acceptanceFailsAfterRun = false;
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
    const sb = { dir, composeFile: join(dir, "compose.yaml"), projectName: `builder_${projectId}` } as Sandbox;
    return { projectId, dir, workspace, changeSets: CHANGE_SETS_DIR, repo, sb, appPort: 3161, dbPort: 5591, appUrl: "http://127.0.0.1:3161", samplePassword: "made-up-sample-password", appStarted: false };
  }

  engineRunner(x: ProjectSandbox): EngineRunner {
    return (a) => {
      const step = a.cmd[a.cmd.indexOf("--step") + 1]!;
      this.runnerCalls.push({ step, container: a.container });
      const m = readManifest(CHANGE_SETS_DIR, EXAMPLE, step);
      let finish: (e: StreamingEnd) => void = () => undefined;
      const done = new Promise<StreamingEnd>((r) => (finish = r));
      setTimeout(() => {
        a.onLine(JSON.stringify({ kind: "start", example: EXAMPLE, step, files: m.files.length, label: m.label }));
        for (const f of m.files) {
          mkdirSync(dirname(join(x.workspace, f.path)), { recursive: true });
          writeFileSync(join(x.workspace, f.path), readFileSync(join(CHANGE_SETS_DIR, EXAMPLE, step, "files", f.path)));
          a.onLine(JSON.stringify({ kind: "write", op: f.op, path: f.path, sha256: f.sha256 }));
        }
        if (this.extraFile) {
          writeFileSync(join(x.workspace, this.extraFile), "made-up file the fixed change does not name\n");
          this.extraFile = null;
        }
        a.onLine(JSON.stringify({ kind: "done", written: m.files.length }));
        finish({ code: 0, stderrTail: "" });
      }, 5);
      return { container: a.container, done, kill: async () => finish({ code: 137, stderrTail: "" }) };
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

  async appCamera(_x: ProjectSandbox, a: { outDir: string; secretFile: string; onLine: (line: string) => void }): Promise<StreamingEnd> {
    // The password file is there while the camera runs.
    if (readFileSync(a.secretFile, "utf8") !== "made-up-sample-password") throw new Error("the stand-in camera did not find the sample password file");
    this.cameraRuns++;
    this.cameraWrites(a.outDir);
    a.onLine(JSON.stringify({ kind: "done", code: 0 }));
    return { code: 0, stderrTail: "" };
  }

  async runAcceptance(input: AcceptanceRunInput): Promise<AcceptanceReport> {
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

  async stopApp(x: ProjectSandbox): Promise<void> {
    this.stoppedApps.push(x.projectId);
    x.appStarted = false;
  }

  async destroy(x: ProjectSandbox): Promise<string> {
    this.destroyed.push(x.projectId);
    x.appStarted = false;
    rmSync(x.dir, { recursive: true, force: true });
    return "stand-in: folder removed";
  }

  async destroyRecorded(projectId: string, rec: SandboxRecord): Promise<string> {
    this.destroyedRecorded.push({ projectId, rec });
    return "stand-in";
  }

  removeAll(): void {
    for (const d of this.dirs) rmSync(d, { recursive: true, force: true });
  }
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
