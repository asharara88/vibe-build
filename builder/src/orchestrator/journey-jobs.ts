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
 * - Package J3: "Open the live app" is a `live` job (`openLive`): only while this interface's app of the project
 *   runs; only for a record that shows the scripted engine's fixed change sets alone (journey.ts,
 *   `scriptedOnlyProblem`); only once Compose reads the `check` service as on `front` alone (`streamNetworkProblem`).
 *   It opens a session of the live preview (src/web/preview.ts), whose pass is shown once and never recorded. The
 *   session ends before a checklist run (whose record then says the app was used live), when the app stops or the
 *   project closes, and as preview.ts says.
 * - After the review bot on af80dc9: the open is registered with the preview before anything is awaited, so that the
 *   sign-out of the builder sign-in session that asked for it cancels it; the preview looks at that, and at whether the
 *   sign-in session still reads as valid, with nothing awaited between that look and the session being opened; and
 *   if the session has ended by the time its opening is recorded, its pass is not returned.
 * - Package J2 (a): a step's turn count comes from its own manifest, wherever that step is read from (`changeSetsFor`).
 *   A build job of the broken step 03-wrong-status stages it just before its engine is made, only for a project made
 *   as the broken copy whose earlier steps are approved (`brokenStageRefusal`, checked again here), and only into the
 *   sandbox's own change-set folder (`brokenStageTargetProblem`). It reads the staged manifest back from that copy (what
 *   the engine reads), refuses the step unless its SHA-256 is the one chosen, and records `journey.broken_step_staged`.
 * - Package J2 (c): with the demonstration pause on (`stepPauseMs`, from BUILDER_DEMO_STEP_PAUSE_MS, off by default), each
 *   build step first records `journey.step.paused_for_demonstration`, and the scripted engine's applier pauses that long
 *   before each write (`delayMsPerWrite`), so that a stop part-way can be shown. Off, neither happens.
 * - After the review of 14787d8 (known gap 161, the owner's choice): "Open the live app" is refused once the project is
 *   signed off (journey.ts, `JOB_RULES.live`); attaching the preview gives the journey the way to end a project's live
 *   session, and wait for its close to be recorded, before its sign-off is recorded (journey.ts, `signOff`).
 * - Package 3.2 (docs/design/package-3.2.md, sections 1, 4 and 5): one export per project (`JOB_RULES.export`). The
 *   export job refuses a project whose record shows anything but the scripted engine's fixed change sets
 *   (`scriptedOnlyProblem`, S15), and a version whose manifest is not the one checked by the run that journey.signed_off
 *   names (export.ts, `signedOffRun`, S9). After the disk check every build makes, the archive is checked with Docker
 *   before it is placed or recorded (`Sandboxes.checkExport`, design section 4, items 3 to 7). journey.export.written
 *   also records the project's id, the manifest's SHA-256 and its items' fingerprints, the checklist count, the passing
 *   run's id, the checks' results and the README's command. If that event cannot be written, the archive placed is
 *   removed again, so that a failed export leaves no file.
 */
import { chmodSync, chownSync, closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { RUNNER_UID } from "../acceptance/runner-image.js";
import { openStore, sha256 } from "../acceptance/store.js";
import { readManifest, TEMPLATE_PROTECTED_PATHS, type Manifest } from "../engine/scripted.js";
import { resetToLastCommit } from "../engine/project-repo.js";
import { DEFAULT_PROFILES } from "../gateway/hold.js";
import { appendEvent } from "../store/events.js";
import { journeyFolder } from "../web/files.js";
import type { AppStream } from "../sandbox/manager.js";
import { LiveOpenCancelled, type LivePreview, type OpenCancelledReason } from "../web/preview.js";
import type { ProjectSandbox, Sandboxes } from "./example-1-adapter.js";
import { removePlacedExport, signedOffRun, writeExport } from "./export.js";
import {
  BROKEN_STEP,
  brokenStageRefusal,
  brokenStageTargetProblem,
  changeSetsFor,
  diskRefusal,
  DISK_FLOOR_BYTES,
  engineEventHandler,
  EV,
  EXAMPLE,
  EXPORT_LABEL,
  EXPORT_SCRIPTED_ONLY,
  freeBytes,
  Journey,
  JourneyRefused,
  JOURNEY_STAND_IN_LABEL,
  scriptedEngineFor,
  scriptedOnlyProblem,
  stillOwned,
  type JourneyState,
  type SandboxRecord,
} from "./journey.js";
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
/**
 * Where the running app is reached from (package 0.6c; package J3), as `journey.app.started` records it. Since J3 the
 * builder's live preview exchanges HTTP with it, through short-lived `check` containers on that network; nothing on
 * the machine opens a TCP connection to it.
 */
export const APP_REACHED_FROM =
  "containers on the project's front network only; no port of the app or its database on the machine; the live preview's streams are check containers on that network, whose HTTP the builder's preview front reads on the machine";
/** The labels of the live app (package J3, section 1). */
export const LIVE_LABEL = "Simulated build: scripted engine, sample data";
export const LIVE_DATA_LABEL = "Made-up data only. No customer or personal details. Removed when the project closes.";
/** The made-up employee of the sample data (templates/next/scripts/seed.ts), whose sign-in "Show" gives. */
export const SAMPLE_EMPLOYEE_EMAIL = "employee@example.test";
/** What a checklist run's record says when the app was used live before it (section 4.7). */
export const USED_LIVE_NOTE = "The app was used live before this run; its data changed.";
/** Why "Open the live app" opened nothing: its builder sign-in session ended while it was being opened (after the review bot on af80dc9). */
export const liveCancelledRefusal = (why: OpenCancelledReason) =>
  `The live app was not opened: ${
    why === "sign_out"
      ? "this sign-in session was signed out while it was being opened"
      : why === "signed_in_again"
        ? "a new sign-in in this browser ended this sign-in session while it was being opened"
        : "this sign-in session ended while it was being opened"
  }. No live session is open. Sign in and ask again.`;
/** Package J2 (c): what `journey.step.paused_for_demonstration` says, with the pause in milliseconds beside it. */
export const DEMO_PAUSE_LABEL = "Demonstration setting: the scripted engine pauses before each write, so that a stop part-way can be shown. Every step is slower.";
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
  /**
   * Package J2 (c): the demonstration pause, in milliseconds (main.ts reads BUILDER_DEMO_STEP_PAUSE_MS, 0 to 10,000).
   * Unset or 0: off. Otherwise the scripted engine's applier pauses this long before each write of every step.
   */
  stepPauseMs?: number;
}

export class JourneyJobs {
  private readonly handles = new Map<string, ProjectSandbox>();
  private readonly j: Journey;
  private live: LivePreview | null = null;

  constructor(private readonly o: JobsOptions) {
    this.j = o.journey;
  }

  /**
   * Package J3: the live preview this interface runs (main.ts). Without it, "Open the live app" is refused. After the
   * review of 14787d8: the journey ends a project's live session with it before recording the project's sign-off.
   */
  attachPreview(p: LivePreview): void {
    this.live = p;
    this.j.attachLiveEnd((projectId, reason) => p.closeFor(projectId, reason));
  }

  /**
   * Package J3: a stream to the running app of a project, for the live preview's pump socket, or null when this
   * interface holds no running app of that project (the session then ends, "app_stopped").
   */
  openStream(projectId: string): AppStream | null {
    const x = this.handles.get(projectId);
    if (!x?.appStarted) return null;
    return this.o.sandboxes.appStream(x);
  }

  /**
   * Package J3: "Open the live app", a `live` job (final design, sections 4.4 and 4.6). Under the project's lock, with
   * no other job running: the app must run and be this interface's; the record must show the scripted engine's fixed
   * change sets alone (`JOB_RULES.live`); Compose must read the `check` service as on `front` alone. Then a session is
   * opened, bound to this builder sign-in session, this project and this start of the app, and
   * `journey.preview.live_opened` written, without the pass. Resolves with the pass, to be shown once.
   * `builderSessionEndsAt`: when that sign-in session expires, if known; the live session ends no later (J3's review).
   * `builderSessionValid`: whether that sign-in session is still valid (after the review bot on af80dc9); the open is
   * refused if it is not when the session would be opened, or when its opening has been recorded.
   */
  async openLive(
    projectId: string,
    builderSession: string,
    builderSessionEndsAt: number | null = null,
    builderSessionValid?: () => boolean,
  ): Promise<{ pass: string; shown: string; expiresAt: Date; sessionId: string }> {
    const preview = this.live;
    if (!preview) throw new JourneyRefused("This interface was started without the live preview.");
    // After the review bot on af80dc9: registered before anything is awaited, so that the sign-out of this sign-in
    // session (or a new sign-in that ends it) from now on cancels this open (preview.ts, `signedOut`).
    const pending = preview.beginOpen(builderSession);
    try {
      return await this.openLiveJob(preview, pending, projectId, builderSession, builderSessionEndsAt, builderSessionValid);
    } finally {
      preview.endOpen(pending);
    }
  }

  private async openLiveJob(
    preview: LivePreview,
    pending: ReturnType<LivePreview["beginOpen"]>,
    projectId: string,
    builderSession: string,
    builderSessionEndsAt: number | null,
    builderSessionValid: (() => boolean) | undefined,
  ): Promise<{ pass: string; shown: string; expiresAt: Date; sessionId: string }> {
    let give!: (v: { pass: string; shown: string; expiresAt: Date; sessionId: string }) => void;
    let fail!: (e: unknown) => void;
    const got = new Promise<{ pass: string; shown: string; expiresAt: Date; sessionId: string }>((a, b) => {
      give = a;
      fail = b;
    });
    got.catch(() => undefined);
    await this.j.startJob(projectId, "live", async ({ state, signal }) => {
      try {
        const x = this.held(projectId);
        if (!x.appStarted || !state.appStartedEventId) throw new JourneyRefused("The app is not running in this interface. The live app is offered only while it runs.");
        // Checked again here, inside the job, on the state the job started from.
        const why = scriptedOnlyProblem(state);
        if (why) throw new JourneyRefused(why);
        const network = await this.o.sandboxes.streamNetworkProblem(x);
        if (network) throw new JourneyRefused(`The live app was not opened: ${network}.`);
        stillOwned(signal);
        let r: Awaited<ReturnType<LivePreview["open"]>>;
        try {
          // After the review bot on af80dc9: refused if this sign-in session signed out, or no longer reads as valid,
          // since the open was asked for; looked at with nothing awaited between that look and the session being set.
          r = await preview.open({ projectId, builderSession, builderSessionEndsAt, appStartEventId: state.appStartedEventId, appPort: x.appPort, pending, builderSessionValid });
        } catch (err) {
          if (err instanceof LiveOpenCancelled) throw new JourneyRefused(liveCancelledRefusal(err.reason));
          throw err;
        }
        try {
          await appendEvent(this.j.pool, projectId, EV.liveOpened, {
            session: r.sessionId,
            pass_recorded: false,
            pass_valid_seconds: 120,
            bound_to: "this builder sign-in session, this project and this start of the app",
            app_started_event: state.appStartedEventId,
            front: preview.frontUser(),
            streams: "short-lived check containers on the project's front network (docker compose run), one connection to http://app:3161 each",
            label: LIVE_LABEL,
            data_label: LIVE_DATA_LABEL,
          });
        } catch (err) {
          await preview.closeFor(projectId, "not_recorded");
          throw err;
        }
        // After the review bot on af80dc9: a sign-out while the opening was being recorded has ended the session
        // (`signedOut`); a sign-in session that ended otherwise meanwhile ends it now. Its pass is not returned.
        const stillOpen = preview.status(projectId)?.sessionId === r.sessionId;
        const ended: OpenCancelledReason | null = pending.cancelled ?? (builderSessionValid && !builderSessionValid() ? "builder_session_ended" : null);
        if (!stillOpen || ended) {
          if (stillOpen) await preview.closeFor(projectId, "builder_session_ended");
          throw new JourneyRefused(ended ? liveCancelledRefusal(ended) : "The live app was not opened: its session ended before its pass could be shown. No live session is open.");
        }
        give(r);
        return { session: r.sessionId };
      } catch (err) {
        fail(err);
        throw err;
      }
    });
    return got;
  }

  /** Package J3: "End the live app" on the builder's preview screen. */
  async endLive(projectId: string): Promise<boolean> {
    return (await this.live?.closeFor(projectId, "ended_on_builder")) ?? false;
  }

  /** Package J3: the live session of a project, if one is open (the preview screen shows it). */
  liveStatus(projectId: string) {
    return this.live?.status(projectId) ?? null;
  }

  /** Package J3: the front's port and user (the preview screen and the record say where the live app is). */
  livePort(): number | null {
    return this.live ? this.live.port() : null;
  }

  /**
   * Package J3, "Show": the made-up employee's sign-in, from this interface's handle to the running app (the sample
   * password is the sandbox's own, made when it was). Only while the app runs here. Never written to a record or a log.
   */
  sampleSignIn(projectId: string): { email: string; password: string } {
    const x = this.held(projectId);
    if (!x.appStarted) throw new JourneyRefused("The app is not running in this interface.");
    return { email: SAMPLE_EMPLOYEE_EMAIL, password: x.samplePassword };
  }

  /** Package J2 (c): the demonstration pause before each write, in milliseconds; 0 when it is off. */
  stepPauseMs(): number {
    return this.o.stepPauseMs ?? 0;
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
        // Package J2 (c): the demonstration pause, when it is on, recorded first.
        const pause = this.stepPauseMs();
        if (pause > 0) await appendEvent(this.j.pool, projectId, EV.stepPaused, { pause_ms: pause, setting: "BUILDER_DEMO_STEP_PAUSE_MS", label: DEMO_PAUSE_LABEL }, step);
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
        // Package J2: the broken step is staged here, just before its engine is made, and only here: for a build job of
        // it, on a project made as the broken copy whose earlier steps are approved, checked again on the state the job
        // started from. Any other step stages nothing; the broken step without those is refused.
        const stageRefused = brokenStageRefusal(state, step);
        if (stageRefused === null) await this.stageBroken(projectId, sandboxNow, state, step);
        else if (step === BROKEN_STEP) throw new JourneyRefused(stageRefused);
        stillOwned(signal);
        const files = readManifest(changeSetsFor(step), EXAMPLE, step).files.length;
        const r = await runBudgetedStep({
          pool: this.j.pool,
          profile: DEFAULT_PROFILES.standard!,
          model: PRICED_MODEL,
          gatewayUrl: NO_GATEWAY,
          // The step's token is not passed on: the scripted engine takes none and calls no model.
          engineFor: () => {
            stillOwned(signal);
            const engine = scriptedEngineFor(
              {
                sandbox: sandboxNow.sb,
                workspace: sandboxNow.workspace,
                gitDir: sandboxNow.repo.gitDir,
                changeSetsDir: sandboxNow.changeSets,
                example: EXAMPLE,
                runner: this.o.sandboxes.engineRunner(sandboxNow),
                ...(pause > 0 ? { delayMsPerWrite: pause } : {}),
              },
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

  /**
   * Package J2 (a), final design, section 3.3: stage the broken step for one build job of it, once `brokenStageRefusal`
   * has passed on the state the job started from. Refused unless the sandbox's change-set folder is its own; then copied
   * there (the adapter checks the folder again), its manifest read back from that copy and refused unless its SHA-256 is
   * the one recorded in the project's first event, and `journey.broken_step_staged` written.
   */
  private async stageBroken(projectId: string, x: ProjectSandbox, state: JourneyState, step: string): Promise<void> {
    const target = brokenStageTargetProblem(x);
    if (target) throw new JourneyRefused(`The broken step was not staged: ${target}.`);
    await this.o.sandboxes.stageBrokenStep(x);
    // Read back from the sandbox's own copy: what the engine reads.
    const body = readFileSync(join(x.changeSets, EXAMPLE, step, "manifest.json"));
    const digest = sha256(body);
    const chosen = state.brokenCopy!.manifest_sha256;
    if (digest !== chosen) {
      throw new JourneyRefused(`The staged broken step's manifest has the SHA-256 ${digest}, not ${chosen}, recorded when the project was made. Step ${state.plan.indexOf(step) + 1} was not built.`);
    }
    const m = JSON.parse(body.toString("utf8")) as Manifest;
    await appendEvent(
      this.j.pool,
      projectId,
      EV.brokenStepStaged,
      {
        step,
        source: state.brokenCopy!.source,
        into: x.changeSets,
        manifest_sha256: digest,
        manifest_read_from: "the sandbox's own copy, as the engine reads it",
        files: m.files.map((f) => ({ path: f.path, sha256: f.sha256 })),
        label: m.label,
      },
      step,
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
        await appendEvent(this.j.pool, projectId, EV.appStarted, { app_url: x.appUrl, reached_from: APP_REACHED_FROM, live_view: true });
        recordedStarted = true;
        const shots = await this.appShots(projectId, x, (line) => queue.push(EV.previewLine, { line: `app camera: ${line.slice(0, 300)}` }), { jobId, signal });
        await queue.drain();
        return { screenshots: shots };
      } catch (err) {
        await queue.settled();
        // Halted: nothing more is changed in the sandbox; its app is left for the next start's recovery to remove.
        if (signal.aborted) throw err;
        // A preview that failed leaves no container or image behind: the next try starts from the images' build.
        await this.live?.closeFor(projectId, "app_stopped");
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
      // Package J3 (section 4.7): the live app is closed first; the run's record says whether it was used live.
      const closed = (await this.live?.closeFor(projectId, "checklist")) ?? false;
      const usedLive = state.usedLiveSinceStart || (closed && (await this.j.state(projectId)).usedLiveSinceStart);
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
      return {
        run_id: r.runId,
        version: r.version,
        summary: r.reading.summary,
        refused: r.refused,
        container_started: r.exit !== null,
        label: JOURNEY_STAND_IN_LABEL,
        app_used_live: usedLive,
        ...(usedLive ? { app_used_live_note: USED_LIVE_NOTE } : {}),
      };
    });
  }

  /**
   * The export (final design, section 1, item 9), only after sign-off and once per project (`JOB_RULES.export`). Package
   * 3.2: only for a project the scripted engine built (S15), of the version the passing run checked (S9), checked with
   * Docker before it is placed or recorded (design section 4).
   */
  exportProject(projectId: string): Promise<{ jobId: string }> {
    return this.j.startJob(projectId, "export", async ({ state, signal }) => {
      const x = this.held(projectId);
      const notScripted = scriptedOnlyProblem(state);
      if (notScripted) throw new JourneyRefused(`${EXPORT_SCRIPTED_ONLY} ${notScripted}`);
      const passing = signedOffRun(state.events, state.acceptanceVersion);
      if (typeof passing === "string") throw new JourneyRefused(`The export is refused: ${passing}.`);
      // The export check builds two images (design section 4, item 3): the disk check every build makes, first.
      this.disk();
      const store = openStore(this.j.dataDir, { refuse: [x.dir] });
      stillOwned(signal);
      const out = await writeExport({
        repo: x.repo,
        store,
        projectId,
        version: state.acceptanceVersion!,
        exportsDir: journeyFolder(this.j.dataDir, projectId, "exports"),
        runManifestSha256: passing.manifestSha256,
        check: (packed) => this.o.sandboxes.checkExport(x, packed),
        beforePlace: () => stillOwned(signal),
      });
      try {
        stillOwned(signal);
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
          project_id: projectId,
          manifest_sha256: out.manifestSha256,
          items: out.items,
          checklist_items: this.j.spec.acceptance.length,
          acceptance_run: passing.runId,
          export_checks: out.checks,
          readme_command: out.readmeCommand,
          paths: out.files,
        });
      } catch (err) {
        // A failed export leaves no file: the archive placed is removed again (S12).
        removePlacedExport(out);
        throw err;
      }
      return { file: out.path, bytes: out.bytes, sha256: out.sha256 };
    });
  }

  /** Remove a project's containers, images and folder (closing it, or at start). Only for journey projects. */
  async cleanup(projectId: string, recorded: SandboxRecord | null): Promise<void> {
    await this.live?.closeFor(projectId, "project_closed");
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

