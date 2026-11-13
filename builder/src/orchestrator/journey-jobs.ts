/**
 * The journey's jobs (package J1, part 2; final design, sections 1 and 4): build a step, approve it and go on,
 * start the app and photograph it (the preview), run the checklist, and write the export. Each runs as one job
 * of the journey (journey.ts, `startJob`): one at a time in this process, its preconditions checked under the
 * project's lock, `journey.job.started` written first and `journey.job.finished` or `.failed` last.
 *
 * - A step runs through package 1.3's `runBudgetedStep`: its whole reservation is opened before the engine is
 *   made, sized at claude-opus-5-5's prices for as many turns as the fixed change has files, and released when
 *   the step ends. The engine is the scripted engine (package 2.1), which calls no model: the real-model gate
 *   stays closed, no gateway is started, and the step's token is passed to nothing.
 * - Before a step and before the app is built, the free disk space is measured; below the floor (4 GB, a
 *   figure assumed, not measured) the job is refused before anything is made.
 * - Package 0.6c: the project's containers sit on its private networks. The app is reached only at
 *   http://app:3161, from containers on its `front` network; nothing here connects to it from the machine. The
 *   only port of the project on the machine is the image build's (127.0.0.1:13161), checked free before the app
 *   is built (`Sandboxes.portsBusy`).
 * - After a failed step, the workspace is put back to its last commit (`resetToLastCommit`).
 * - The app is built once, after the last step is approved (the preview), through example-1-adapter.ts. Before
 *   it is built, and again just before the app camera starts, the runner image the camera uses is checked with
 *   package 3.1b's `runnerImageProblem` (`Sandboxes.cameraImageProblem`): with a problem, nothing is built or
 *   started, or the app is stopped, and no screenshot is recorded. Just before the camera starts, its service is
 *   checked to be on the project's `front` network alone, and `front` to be internal and in 0.6c's "isolated"
 *   gateway mode (`Sandboxes.cameraNetworkProblem`), with the same result.
 * - The handles of this process's sandboxes are kept in memory. A sandbox left by an interface that stopped is
 *   not resumed: it is removed at the next start (journey.ts, `recoverInterrupted`).
 * - After the review bot on defb9c4: when the journey is halted (the interface lost its instance lock), the job's
 *   signal is aborted. The engine's container and the app camera's are killed at once; every job checks the signal
 *   before each further step (`stillOwned`); and a halted job changes nothing more in its sandbox (no workspace reset,
 *   no app stopped): the next start's recovery removes the sandbox. An operation already running that cannot be
 *   stopped from here (the app's image build and start, a checklist run, the export's archive) runs to its own end.
 * - After the review bot on defb9c4: each preview attempt copies its screenshots into a folder of its own, named by
 *   its job (`shots/<job id>/`), so that a retry never meets, or overwrites, a file an earlier event names.
 */
import { chmodSync, chownSync, closeSync, constants, fstatSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { RUNNER_UID } from "../acceptance/runner-image.js";
import { openStore, sha256 } from "../acceptance/store.js";
import { readManifest, TEMPLATE_PROTECTED_PATHS } from "../engine/scripted.js";
import { resetToLastCommit } from "../engine/project-repo.js";
import { DEFAULT_PROFILES } from "../gateway/hold.js";
import { appendEvent } from "../store/events.js";
import { journeyFolder } from "../web/files.js";
import type { ProjectSandbox, Sandboxes } from "./example-1-adapter.js";
import { writeExport } from "./export.js";
import { CHANGE_SETS_DIR, diskRefusal, DISK_FLOOR_BYTES, engineEventHandler, EV, EXAMPLE, EXPORT_LABEL, freeBytes, Journey, JourneyRefused, JOURNEY_STAND_IN_LABEL, scriptedEngineFor, stillOwned, type SandboxRecord } from "./journey.js";
import { runBudgetedStep } from "./steps.js";

/** The model whose prices size a step's reservation in J1 (final design, section 1, item 6). */
export const PRICED_MODEL = "claude-opus-5-5";
/** Given to `runBudgetedStep` as the gateway's address. Nothing uses it: the scripted engine calls no model and no gateway is started. */
export const NO_GATEWAY = "none:the-scripted-engine-calls-no-model";
/** The instruction a scripted step is given. The scripted engine records its length and does not read it. */
export const STEP_INSTRUCTION = "Scripted mode: build test example 1's fixed change for this step. The scripted engine does not read this instruction.";
/** How long a step may hold its reservation: the engine's own limit for a step (ten minutes) and a minute's margin. */
export const STEP_TIME_LIMIT_MS = 660_000;
/** The extra sentence under a refused step (final design, section 1, item 10). */
export const REFUSAL_EXTRA =
  "Scripted steps spend $0; this is a reservation sized from a real model's price. To go on, ask Claude Code to change the cap (a recorded change), or start a new project.";
/** Where the running app is reached from (package 0.6c), as `journey.app.started` records it. */
export const APP_REACHED_FROM = "containers on the project's front network only; no port of the app or its database on the machine";
/** The caption under a screenshot of the running app (final design, section 1, item 7). */
export const appShotCaption = (at: Date) => `Screenshot of the running app at ${at.toISOString().replace("T", " ").slice(0, 19)} UTC. Not live. Sample data.`;

/** What the app camera takes, in order: file name, page, language. Only these files are ever read from its folder. */
export const APP_SHOTS = [
  { name: "app-home-en", page: "/en/home", lang: "en" },
  { name: "app-my-requests-en", page: "/en/my-requests", lang: "en" },
  { name: "app-home-ar", page: "/ar/home", lang: "ar" },
  { name: "app-my-requests-ar", page: "/ar/my-requests", lang: "ar" },
] as const;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SHOT_MAX_BYTES = 20 * 1024 * 1024;

export interface JobsOptions {
  journey: Journey;
  sandboxes: Sandboxes;
  /** The free space under a path, in bytes (the tests give a stand-in). */
  measureFree?: (path: string) => number;
  diskFloorBytes?: number;
  stepTimeLimitMs?: number;
  onFault?: (message: string, detail: unknown) => void;
}

export class JourneyJobs {
  private readonly handles = new Map<string, ProjectSandbox>();
  private readonly j: Journey;

  constructor(private readonly o: JobsOptions) {
    this.j = o.journey;
  }

  /** This process's handle to a project's sandbox, if it has one. */
  handle(projectId: string): ProjectSandbox | undefined {
    return this.handles.get(projectId);
  }

  private disk(): void {
    const why = diskRefusal(this.j.dataDir, this.o.diskFloorBytes ?? DISK_FLOOR_BYTES, this.o.measureFree ?? freeBytes);
    if (why) throw new JourneyRefused(why);
  }

  private held(projectId: string): ProjectSandbox {
    const x = this.handles.get(projectId);
    if (!x) throw new JourneyRefused("This project's sandbox is not held by this interface (it was made by one that has since stopped, or removed). It is not resumed. Close the project, or start a new one.");
    return x;
  }

  /** Build one step of the plan (final design, section 1, item 6). */
  buildStep(projectId: string, step: string): Promise<{ jobId: string }> {
    return this.j.startJob(
      projectId,
      "build_step",
      async ({ queue, state, signal }) => {
        this.disk();
        let x = this.handles.get(projectId);
        if (!x) {
          if (state.sandbox) throw new JourneyRefused("This project's sandbox was made by an interface that has since stopped. It is not resumed. Close the project, or start a new one.");
          stillOwned(signal);
          x = await this.o.sandboxes.make(projectId);
          this.handles.set(projectId, x);
          // Recorded even if the journey was halted meanwhile, so that the next start finds the sandbox and removes it.
          await appendEvent(this.j.pool, projectId, EV.sandboxMade, { dir: x.dir, app_url: x.appUrl, build_proxy_port: x.buildProxyPort, compose_project: x.sb.projectName, containers: 0 }, step);
        }
        stillOwned(signal);
        const sandboxNow = x;
        const files = readManifest(CHANGE_SETS_DIR, EXAMPLE, step).files.length;
        const r = await runBudgetedStep({
          pool: this.j.pool,
          profile: DEFAULT_PROFILES.standard!,
          model: PRICED_MODEL,
          gatewayUrl: NO_GATEWAY,
          // The step's token is not passed on: the scripted engine takes none and calls no model.
          engineFor: () => {
            stillOwned(signal);
            const engine = scriptedEngineFor(
              { sandbox: sandboxNow.sb, workspace: sandboxNow.workspace, gitDir: sandboxNow.repo.gitDir, changeSetsDir: sandboxNow.changeSets, example: EXAMPLE, runner: this.o.sandboxes.engineRunner(sandboxNow) },
              queue,
            );
            // Halted: the engine's container is killed at once, and the step ends "stopped" with nothing committed.
            signal.addEventListener("abort", () => void engine.stop(), { once: true });
            return engine;
          },
          step: { projectId, stepId: step, instruction: STEP_INSTRUCTION, protectedPaths: [...TEMPLATE_PROTECTED_PATHS], maxTurns: files },
          onEvent: engineEventHandler(queue, step),
          stepTimeLimitMs: this.o.stepTimeLimitMs ?? STEP_TIME_LIMIT_MS,
          onFault: this.o.onFault,
        });
        await queue.drain();
        if (!r.ok) {
          // Halted: the workspace is not touched; the next start removes the sandbox.
          stillOwned(signal);
          // A failed step leaves nothing behind in the workspace: it is put back to its last commit.
          const reset = await resetToLastCommit(sandboxNow.repo);
          await appendEvent(this.j.pool, projectId, EV.workspaceReset, { removed_ignored: reset.removedIgnored, removed_not_allowed: reset.removedNotAllowed, unrestorable: reset.unrestorable }, step);
          throw new JourneyRefused(r.failureReason ?? "The step failed.");
        }
        return { step, ok: true, changed_files: r.changedFiles.length, turns: r.turns };
      },
      { step },
    );
  }

  /** "Approve and build the next step"; after the last step, the approval starts the preview. */
  async approve(projectId: string, step: string): Promise<{ next: "build_step" | "preview"; jobId: string }> {
    await this.j.approveStep(projectId, step);
    const plan = (await this.j.state(projectId)).plan;
    const next = plan[plan.indexOf(step) + 1];
    if (next) return { next: "build_step", ...(await this.buildStep(projectId, next)) };
    return { next: "preview", ...(await this.preview(projectId)) };
  }

  /** The preview (final design, section 1, item 7): build the app once, start it, photograph it in English and Arabic. */
  preview(projectId: string): Promise<{ jobId: string }> {
    return this.j.startJob(projectId, "preview", async ({ queue, jobId, signal }) => {
      this.disk();
      const x = this.held(projectId);
      for (const [other, h] of this.handles) {
        if (other !== projectId && h.appStarted) throw new JourneyRefused("Another project's app is running. One project's app runs at a time: close that project first.");
      }
      const busy = await this.o.sandboxes.portsBusy(x);
      if (busy) throw new JourneyRefused(busy);
      // Package 3.1b: the camera's runner image is checked first, so that no app is built for a camera that cannot run.
      const imageProblem = await this.o.sandboxes.cameraImageProblem(x);
      if (imageProblem) throw new JourneyRefused(`The app camera cannot start, so the app was not built: ${imageProblem}.`);
      stillOwned(signal);
      let recordedStarted = false;
      try {
        x.appStarted = true;
        await this.o.sandboxes.buildAndStart(x, (line) => queue.push(EV.previewLine, { line: line.trim() }));
        await queue.drain();
        stillOwned(signal);
        await appendEvent(this.j.pool, projectId, EV.appStarted, { app_url: x.appUrl, reached_from: APP_REACHED_FROM, live_view: false });
        recordedStarted = true;
        const shots = await this.appShots(projectId, x, (line) => queue.push(EV.previewLine, { line: `app camera: ${line.slice(0, 300)}` }), { jobId, signal });
        await queue.drain();
        return { screenshots: shots };
      } catch (err) {
        await queue.settled();
        // Halted: nothing more is changed in the sandbox; its app is left for the next start's recovery to remove.
        if (signal.aborted) throw err;
        // A preview that failed leaves no container or image behind: the next try starts from the images' build.
        await this.o.sandboxes.stopApp(x).catch((e: unknown) => this.o.onFault?.("The app could not be stopped after a failed preview.", { project: projectId, error: e instanceof Error ? e.message : String(e) }));
        if (recordedStarted) await appendEvent(this.j.pool, projectId, EV.appStopped, { reason: "The preview failed; its containers and images were removed." });
        throw err;
      }
    });
  }

  /**
   * The app camera, in the project's `acceptance` service. Its folder is fresh, and only the files named in
   * APP_SHOTS are read from it: each a plain file, not too large, starting as a PNG does, copied into this
   * attempt's own folder inside the project's shots folder (`shots/<job id>/`, made new: review bot on defb9c4) and
   * recorded with its SHA-256. Returns how many were recorded. The camera's container is killed when `signal` is aborted.
   */
  async appShots(projectId: string, x: ProjectSandbox, onLine: (line: string) => void, attempt: { jobId: string; signal?: AbortSignal }): Promise<number> {
    if (!/^job-[0-9a-f]{8}$/.test(attempt.jobId)) throw new Error(`"${attempt.jobId}" is not a job's id; no screenshot is recorded under it.`);
    const signal = attempt.signal ?? new AbortController().signal;
    const runDir = join(this.j.dataDir, "journey", projectId, "camera-runs", `run-${randomBytes(6).toString("hex")}`);
    const outDir = join(runDir, "out");
    const secretDir = join(runDir, "secret");
    mkdirSync(outDir, { recursive: true, mode: 0o700 });
    mkdirSync(secretDir, { mode: 0o700 });
    const secretFile = join(secretDir, "sample-password");
    try {
      // Package 3.1b: the runner image again, just before the camera starts (the app's build can take minutes).
      const imageProblem = await this.o.sandboxes.cameraImageProblem(x);
      if (imageProblem) throw new JourneyRefused(`The app camera did not start: ${imageProblem}. No screenshot was recorded.`);
      // Package 0.6c: the camera's browser loads the app's pages, so its service must be on the project's front network alone, a private one.
      const networkProblem = await this.o.sandboxes.cameraNetworkProblem(x);
      if (networkProblem) throw new JourneyRefused(`The app camera did not start: ${networkProblem}. No screenshot was recorded.`);
      stillOwned(signal);
      writeFileSync(secretFile, x.samplePassword, { mode: 0o400 });
      if (process.getuid?.() === 0) {
        chownSync(outDir, RUNNER_UID, RUNNER_UID);
        chownSync(secretFile, RUNNER_UID, RUNNER_UID);
      } else {
        // Not root: the runner's user cannot be given the folder, so it is opened to every user (development machine only).
        chmodSync(outDir, 0o777);
        chmodSync(secretFile, 0o444);
      }
      const end = await this.o.sandboxes.appCamera(x, { outDir, secretFile, onLine, signal });
      rmSync(secretFile, { force: true });
      stillOwned(signal);
      // Its own lines (in the preview's lines) say what went wrong; its error output is not copied into the record.
      if (end.code !== 0) throw new JourneyRefused(`The app camera ended with exit code ${end.code ?? "none"}${end.timedOut ? " (past its time limit)" : ""}; no screenshot was recorded from it.`);
      // This attempt's own folder, made new (never one an earlier attempt made): an earlier attempt that failed
      // part-way leaves files its events name, and those are never overwritten (review bot on defb9c4).
      const shotsRoot = journeyFolder(this.j.dataDir, projectId, "shots");
      mkdirSync(shotsRoot, { recursive: true, mode: 0o700 });
      const shotsDir = join(shotsRoot, attempt.jobId);
      mkdirSync(shotsDir, { mode: 0o700 });
      const at = new Date();
      let n = 0;
      for (const [i, shot] of APP_SHOTS.entries()) {
        const body = readShot(join(outDir, `${shot.name}.png`));
        const dest = join(shotsDir, `${String(i + 1).padStart(2, "0")}-${shot.name}.png`);
        writeFileSync(dest, body, { mode: 0o600, flag: "wx" });
        await appendEvent(this.j.pool, projectId, EV.screenshot, {
          file: { path: dest, sha256: sha256(body) },
          job_id: attempt.jobId,
          name: shot.name,
          page: shot.page,
          lang: shot.lang,
          camera: "app camera (approved runner image, project's acceptance service on its front network; no video, no trace)",
          caption: appShotCaption(at),
          taken_at: at.toISOString(),
          live: false,
        });
        n++;
      }
      return n;
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  }

  /** "Run the checklist" (final design, section 1, item 8): package 3.1's runner, against the running app. */
  acceptance(projectId: string): Promise<{ jobId: string }> {
    return this.j.startJob(projectId, "acceptance", async ({ state, signal }) => {
      const x = this.held(projectId);
      const store = openStore(this.j.dataDir, { refuse: [x.dir] });
      stillOwned(signal);
      const r = await this.o.sandboxes.runAcceptance({
        pool: this.j.pool,
        sandbox: x.sb,
        store,
        projectId,
        version: state.acceptanceVersion!,
        appUrl: x.appUrl,
        samplePassword: x.samplePassword,
        checklistItems: this.j.spec.acceptance.length,
      });
      return { run_id: r.runId, version: r.version, summary: r.reading.summary, refused: r.refused, container_started: r.exit !== null, label: JOURNEY_STAND_IN_LABEL };
    });
  }

  /** The export (final design, section 1, item 9), only after sign-off (`JOB_RULES.export`). */
  exportProject(projectId: string): Promise<{ jobId: string }> {
    return this.j.startJob(projectId, "export", async ({ state, signal }) => {
      const x = this.held(projectId);
      const store = openStore(this.j.dataDir, { refuse: [x.dir] });
      stillOwned(signal);
      const out = await writeExport({ repo: x.repo, store, projectId, version: state.acceptanceVersion!, exportsDir: journeyFolder(this.j.dataDir, projectId, "exports") });
      await appendEvent(this.j.pool, projectId, EV.exportWritten, {
        file: { path: out.path, sha256: out.sha256 },
        bytes: out.bytes,
        export_commit: out.exportCommit,
        workspace_head: out.workspaceHead,
        workspace_history_changed: false,
        commits: out.commits,
        files: out.files.length,
        acceptance_version: state.acceptanceVersion,
        acceptance_in_exported_copy_only: true,
        label: EXPORT_LABEL,
      });
      return { file: out.path, bytes: out.bytes, sha256: out.sha256 };
    });
  }

  /** Remove a project's containers, images and folder (closing it, or at start). Only for journey projects. */
  async cleanup(projectId: string, recorded: SandboxRecord | null): Promise<void> {
    const x = this.handles.get(projectId);
    if (x) {
      await this.o.sandboxes.destroy(x);
      this.handles.delete(projectId);
      return;
    }
    if (recorded) await this.o.sandboxes.destroyRecorded(projectId, recorded);
  }
}

/** Read one camera file: a plain file (a link is not followed), 8 bytes to 20 MB, starting as a PNG does. */
export function readShot(path: string): Buffer {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new JourneyRefused(`The camera did not leave ${path.split("/").pop()} as a plain file.`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size < 8 || st.size > SHOT_MAX_BYTES) throw new JourneyRefused(`The camera's ${path.split("/").pop()} is not a plain file of 8 bytes to 20 MB.`);
    const body = Buffer.alloc(st.size);
    let read = 0;
    while (read < st.size) {
      const n = readSync(fd, body, read, st.size - read, read);
      if (n === 0) break;
      read += n;
    }
    if (read !== st.size || !body.subarray(0, 8).equals(PNG)) throw new JourneyRefused(`The camera's ${path.split("/").pop()} is not a PNG image.`);
    return body;
  } finally {
    closeSync(fd);
  }
}

