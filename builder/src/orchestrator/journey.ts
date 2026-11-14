/**
 * The owner's journey on the scripted engine (package J1; final design, sections 0 to 4).
 *
 * Only this module changes a project's state (design note, section 2: the web pages call only the
 * orchestrator). A project's state is its events, in id order: no new table, no migration. A project made
 * here has an id starting "j1-", and nothing here touches a project without that prefix.
 *
 * Stages: brief entered → continued as example 1 (or stopped) → the 20 questions answered → brief confirmed →
 * plan confirmed → build (each step built, then approved) → preview → acceptance → signed off (then the export).
 * Nothing is built before both confirmations, a step only after the one before it is approved, and nothing is
 * exported before sign-off (`JOB_RULES`, `buildStepRefusal`). The jobs' bodies are in journey-jobs.ts.
 *
 * After the review of 14787d8 (known gap 161, the owner's choice): the live app is not opened once a project is signed
 * off (`JOB_RULES.live`), and a live session of the project is ended, its close recorded, before the sign-off is
 * recorded (`signOff`, through the hook journey-jobs.ts attaches with the live preview).
 *
 * SIMULATED: the analyst. The questions are fixed (intake.ts), the brief is never read or given to the engine,
 * and every project continues as test example 1. REAL: the store, the event log, the budget and step holds
 * (package 1.3), the acceptance store (package 3.1). The only engine this module makes is the ScriptedEngine
 * (package 2.1), which calls no model; no gateway is started here, and the real-model gate stays closed.
 *
 * Package J2 (a), the broken copy rejected (docs/design/journey-j2.md, section 3): the demonstration
 * (`createBrokenCopyDemo`) makes a project whose first event carries the owner's choice, `broken_copy`, written with
 * the project's row in one transaction. Its plan, worked out from the record alone, adds the deliberately broken step
 * 03-wrong-status (builder/scripted-broken), which journey-jobs.ts stages into the sandbox's own change-set folder just
 * before it runs. Any trace of the broken copy in a record refuses sign-off, the export and the live app.
 *
 * Package J2 (c), a restart mid-step (final design, section 4): at a clean stop (main.ts, `stopOnSignal`), once the
 * journey is halted, `removeAtStop` runs the loop of `recoverInterrupted` at the stop: it waits on each project's chain
 * of actions in progress (a bounded wait), asks before each removal whether it may go on (main.ts asks the instance lock
 * of the database, bounded), skips the project of a job still running and closed projects, and records each removal
 * with the stop's own reason. Nothing is resumed.
 */
import { randomBytes } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statfsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type pg from "pg";
import type { BuildEngine, EngineEvent, StepInstruction, StepResult } from "../engine/interface.js";
import { listSteps, readManifest, ScriptedEngine, type ScriptedEngineOptions } from "../engine/scripted.js";
import type { RunOutcome } from "../acceptance/results.js";
import { insideOrEqual, openStore, sha256, STAND_IN_LABEL } from "../acceptance/store.js";
import { writeStandInVersion } from "../acceptance/stand-in.js";
import type { AppSpec } from "../spec/app-spec.js";
import { appendEvent, listEvents, type Event } from "../store/events.js";
import { closeStepHold, listStepHolds } from "../store/holds.js";
import { createProject, getProject, listProjects, type Project } from "../store/projects.js";
import { event, inTransaction } from "../store/tx.js";
import { answerProblem, BUILDER_DIR, loadExampleSpec, loadIntake, sameAnswer, sheetAnswer, type Answer, type Intake } from "./intake.js";

export const JOURNEY_PREFIX = "j1-";
export const EXAMPLE = "example-1";
export const CHANGE_SETS_DIR = join(BUILDER_DIR, "scripted");
/** The label the stand-in tests carry in the journey (the owner's answer to question B, 13 Nov 2026). */
export const JOURNEY_STAND_IN_LABEL = "stand-in test, not independent acceptance";
export const MAX_BRIEF = 2_000;
export const MAX_NAME = 100;
/** B5's raw ask for example 1, as the new-project box is prefilled (pages.ts) and as the demonstration's brief. */
export const EXAMPLE_1_ASK = "I need an app where staff can request leave and managers approve it";

/* ------------------------------------------------------------------ J2 (a): the broken copy */

/** The deliberately broken step, written in advance by Claude Code for package 3.1 (builder/scripted-broken). */
export const BROKEN_STEP = "03-wrong-status";
/** Where it is read from. Never copied into builder/scripted, which every project's plan reads. */
export const BROKEN_CHANGE_SETS_DIR = join(BUILDER_DIR, "scripted-broken");
/** The name the builder gives the demonstration's project (final design, section 3.1). */
export const BROKEN_COPY_NAME = "Deliberately broken copy (made-up)";
/** The New project form refuses a name that starts so (case and spacing aside). */
export const BROKEN_COPY_NAME_PREFIX = "Deliberately broken copy";
/** The demonstration's cap, in US dollars. */
export const BROKEN_COPY_CAP_USD = 5;
/** Why a project with any trace of the broken copy is not signed off or exported (final design, section 3.5). */
export const BROKEN_COPY_REFUSAL = "A deliberately broken copy is never signed off or exported.";
/** Why it is not offered as a live app (section 3.6). */
export const BROKEN_LIVE_REFUSAL = "A deliberately broken copy is not offered as a live app: it was built to be rejected by the checklist.";
/** What a broken copy's plan records about the checks the product does not make yet (HANDOVER.md, milestones 1 and 3). */
export const NO_QUALITY_CHECK_AND_RETRY = "not done (milestones 1 and 3)";

/**
 * Whether the Projects screen offers the broken-copy demonstration (its panel and its route): the one place this is
 * decided. The owner's answer of 14 Nov 2026: "Always on Projects (Recommended)", the button always on his Projects
 * screen. Showing it only when a setting is on would be a change to this function alone.
 */
export function brokenCopyDemoShown(): boolean {
  return true;
}

/** The change-set folder a step is read from: builder/scripted-broken for the broken step, builder/scripted for any other. */
export function changeSetsFor(step: string): string {
  return step === BROKEN_STEP ? BROKEN_CHANGE_SETS_DIR : CHANGE_SETS_DIR;
}

/** The owner's choice, as the demonstration records it in the project's first event (`broken_copy`). */
export interface BrokenCopyChoice {
  by: "owner";
  step: string;
  source: string;
  label: string;
  manifest_sha256: string;
  sign_off: "never";
  export: "never";
}

/** The choice for the broken step as builder/scripted-broken holds it now: its label and its manifest's SHA-256. */
export function brokenCopyChoice(): BrokenCopyChoice {
  const manifestFile = join(BROKEN_CHANGE_SETS_DIR, EXAMPLE, BROKEN_STEP, "manifest.json");
  return {
    by: "owner",
    step: BROKEN_STEP,
    source: `builder/scripted-broken/${EXAMPLE}/${BROKEN_STEP}`,
    label: readManifest(BROKEN_CHANGE_SETS_DIR, EXAMPLE, BROKEN_STEP).label,
    manifest_sha256: sha256(readFileSync(manifestFile)),
    sign_off: "never",
    export: "never",
  };
}

/** A recorded choice the plan honours: the broken step, a manifest SHA-256, sign-off and export "never". */
function honouredChoice(v: unknown): BrokenCopyChoice | null {
  const c = v as Partial<BrokenCopyChoice> | null;
  if (typeof c !== "object" || c === null || Array.isArray(c)) return null;
  if (c.step !== BROKEN_STEP || typeof c.manifest_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(c.manifest_sha256)) return null;
  if (c.sign_off !== "never" || c.export !== "never") return null;
  return c as BrokenCopyChoice;
}

/**
 * Why the broken step may not be staged for a build job, or null (final design, section 3.3): it must be the broken
 * step, of a project made as the broken copy (the choice honoured), with every step before it approved. Checked again
 * inside the job, on the state it started from (`buildStepRefusal` already requires the order).
 */
export function brokenStageRefusal(s: Pick<JourneyState, "brokenCopy" | "plan" | "approved">, step: string): string | null {
  if (step !== BROKEN_STEP) return "Only the deliberately broken step is staged.";
  if (!s.brokenCopy || !s.plan.includes(BROKEN_STEP)) return "This project was not made as the deliberately broken copy, so its broken step is not staged.";
  for (const earlier of s.plan.slice(0, s.plan.indexOf(BROKEN_STEP))) {
    if (!s.approved.has(earlier)) return `Step ${earlier} must be built and approved before the broken step is staged.`;
  }
  return null;
}

/**
 * Why the broken step may not be staged into a sandbox's change-set folder, or null (final design, section 3.3): the
 * folder must be the sandbox's own, `engine-change-sets` inside its folder, as makeExample1 makes it, and not under
 * builder/ (so never builder/scripted, which every project's plan reads), by its path and by its real path as far as
 * the path exists (`realpathAsFar`).
 */
export function brokenStageTargetProblem(x: { dir: string; changeSets: string }): string | null {
  if (!isAbsolute(x.dir) || !isAbsolute(x.changeSets)) return "the sandbox's folders are not absolute paths";
  const own = join(resolve(x.dir), "engine-change-sets");
  if (resolve(x.changeSets) !== own || x.changeSets !== own) return `the sandbox's change-set folder is not its own folder's engine-change-sets (${x.changeSets})`;
  const builder = realpathAsFar(BUILDER_DIR);
  if (insideOrEqual(own, resolve(BUILDER_DIR)) || insideOrEqual(realpathAsFar(own), builder)) return `the sandbox's change-set folder is under builder/ (${x.changeSets})`;
  // After J2's second review (14 Nov 2026): the folders the copy goes through, too. The copy follows a linked folder inside its
  // destination path, so a link at engine-change-sets, at its example-1, or at the step's own folder would take the
  // broken step somewhere else. None of the three may be a link; makeExample1 makes them as plain folders.
  for (const through of [own, join(own, EXAMPLE), join(own, EXAMPLE, BROKEN_STEP)]) {
    let seen: ReturnType<typeof lstatSync> | undefined;
    try {
      seen = lstatSync(through, { throwIfNoEntry: false });
    } catch (err) {
      // After the review of pull request #49: a path that cannot be read (a file where a folder should be) is a reason, not a throw.
      return `a folder the broken step would be copied through could not be read (${through}: ${(err as NodeJS.ErrnoException).code ?? "error"})`;
    }
    if (seen?.isSymbolicLink()) return `a folder the broken step would be copied through is a link, not a folder (${through})`;
    if (seen && !seen.isDirectory()) return `a folder the broken step would be copied through is not a folder (${through})`;
  }
  return null;
}

/**
 * A path's real path, as far as it exists: the real path of its nearest folder that exists, with the rest of the path
 * after it, so that a folder not made yet under a link into builder/ is still seen as under builder/ (J2's review,
 * 14 Nov 2026). The path itself only when no part of it can be read.
 */
function realpathAsFar(p: string): string {
  const whole = resolve(p);
  const rest: string[] = [];
  for (let head = whole; ; ) {
    try {
      return join(realpathSync(head), ...rest);
    } catch {
      const up = dirname(head);
      if (up === head) return whole;
      rest.unshift(basename(head));
      head = up;
    }
  }
}

/** The events the journey writes (this module and journey-jobs.ts). */
export const EV = {
  briefEntered: "intake.brief_entered",
  continued: "intake.continued",
  answer: "intake.answer",
  stopped: "journey.stopped",
  briefConfirmed: "journey.brief_confirmed",
  planConfirmed: "journey.plan_confirmed",
  stepApproved: "journey.step_approved",
  signedOff: "journey.signed_off",
  closed: "journey.closed",
  jobStarted: "journey.job.started",
  jobFinished: "journey.job.finished",
  jobFailed: "journey.job.failed",
  jobInterrupted: "journey.job.interrupted",
  engineEvent: "engine.event",
  /** The project's sandbox folder, the app's address and the build's port (example-1-adapter.ts): files only, no container yet. */
  sandboxMade: "journey.sandbox.made",
  /** The sandbox's containers, images and folder removed: closed, or found at start from an interface that stopped. */
  sandboxRemoved: "journey.sandbox.removed",
  /** After a failed step: the workspace put back to its last commit (project-repo.ts, resetToLastCommit). */
  workspaceReset: "journey.workspace.reset",
  /** A line of the preview job (images built, tables made, app started). */
  previewLine: "journey.preview.line",
  appStarted: "journey.app.started",
  /** The app's containers and images removed after a preview that failed once the app had started. */
  appStopped: "journey.app.stopped",
  /** A screenshot of the running app, taken by the app camera: `file` {path, sha256} (files.ts serves it). */
  screenshot: "journey.screenshot",
  /** The export archive: `file` {path, sha256} (files.ts serves it as an attachment). */
  exportWritten: "journey.export.written",
  /** Package J3: a live session opened, its pass shown once (the pass is never recorded). */
  liveOpened: "journey.preview.live_opened",
  /** Package J3: the pass was used at the preview front (whether Sec-Fetch-Site came; no origin is recorded). */
  liveEntered: "journey.preview.live_entered",
  /** Package J3: a live session ended, and why. */
  liveClosed: "journey.preview.live_closed",
  /** Package J2: the broken step copied into the sandbox's own change-set folder, just before its engine (journey-jobs.ts). */
  brokenStepStaged: "journey.broken_step_staged",
  /** Package J2 (c): a build step run with the demonstration pause on (BUILDER_DEMO_STEP_PAUSE_MS), written first in its job. */
  stepPaused: "journey.step.paused_for_demonstration",
} as const;

/** Why a step of an interrupted project is not approved (after J2's second review, 14 Nov 2026). */
export const APPROVE_INTERRUPTED = "This project was interrupted when the interface stopped. It is not resumed, so no step of it is approved.";
/** Package J2 (c): why `journey.sandbox.removed` was written at a clean stop (final design, section 4.1, item 5). */
export const REMOVED_AT_STOP = "The interface was stopped on purpose; this project's containers, images and folder were removed at the stop. It is not resumed.";
/** Why it was written at start, for a sandbox left by an interface that stopped (a crash, or a stop that left it). */
export const FOUND_AT_START = "Found at start: made by an interface that has since stopped. It is not resumed.";

/** Package J2 (c): what the removal at a clean stop did (`Journey.removeAtStop`). */
export interface StopRemoval {
  /** The projects whose sandbox was removed at the stop, each recorded `journey.sandbox.removed` with `interrupted: true`. */
  removed: Array<{ projectId: string; dir: string }>;
  /** The projects left for the next start, each with why. */
  left: Array<{ projectId: string; why: string }>;
  /** Why the removal ended before every project was looked at (the lock lost, or not confirmed in time), or null. */
  ended: string | null;
}

/**
 * Why "Open the live app" is refused once the project is signed off (after the review of 14787d8, known gap 161: the
 * owner chose to refuse the live app after sign-off).
 */
export const LIVE_AFTER_SIGN_OFF = "This project is signed off. The live app is not opened after sign-off, so the signed-off app is not changed through it.";
/** The reason a live session's close carries when the sign-off ended it (after the review of 14787d8). */
export const LIVE_CLOSED_BY_SIGN_OFF = "signed_off";
/** The label a sign-off carries (final design, section 1, item 8). */
export const SIGN_OFF_LABEL = "Sign-off on a simulated build, checked by a stand-in test of item 1 only: not acceptance";
/**
 * The label the export carries (final design, section 1, item 9). Package 3.2 (design section 1, "The label"): as the
 * approvals are recorded, the two images for the builder's internal development and testing only (DEC:97, :110), the
 * development-only packages for development use only (DEC:45).
 */
export const EXPORT_LABEL =
  "Internal only, not for customers. The two container images it names are approved for the builder's internal development and testing only; its development-only packages are approved for development use only, never in what a customer receives. Made-up data only.";
/** Package 3.2 (safeguard S12): one export per project; a second is refused, and the first is left as it was. */
export const EXPORT_ONCE = "This project is exported already: one export per project. The archive recorded is the one offered.";
/**
 * Package 3.2 (safeguard S15): the export's note says no AI model was called by the builder, true only for the scripted
 * engine, so a project whose record shows anything else is not exported (`scriptedOnlyProblem`'s reason follows).
 */
export const EXPORT_SCRIPTED_ONLY = "Only a project the scripted engine built is exported, since its note says no AI model was called:";

export type Stage = "brief" | "questions" | "brief_review" | "plan_review" | "build" | "preview" | "acceptance" | "signed_off" | "stopped" | "closed";
export type JobKind = "build_step" | "preview" | "acceptance" | "export" | "live";

export interface RecordedAnswer {
  answer: Answer;
  by: "owner" | "scripted_customer";
  matchesSheet: boolean;
  eventId: string;
}

export interface JobRecord {
  jobId: string;
  kind: JobKind;
  step: string | null;
  state: "running" | "finished" | "failed" | "interrupted";
  startedEventId: string;
  reason: string | null;
}

export interface JourneyState {
  project: Project;
  events: Event[];
  stage: Stage;
  brief: string | null;
  answers: Map<string, RecordedAnswer>;
  /** The index in `intake.turns` of the next turn to answer, or null when every question is answered. */
  nextTurn: number | null;
  briefConfirmed: boolean;
  planConfirmed: boolean;
  acceptanceVersion: string | null;
  signedOff: boolean;
  jobs: JobRecord[];
  /** A job whose last event is "started": running now, or left so by an interface that stopped. */
  runningJob: JobRecord | null;
  /** A job was marked interrupted, or the sandbox was removed at start: the screen offers "Close project" or "New project", no resume. */
  interrupted: boolean;
  /**
   * The plan's steps, in order, from the record alone: the scripted change sets of example 1, then the broken step
   * when the project's first event carries the owner's choice (package J2).
   */
  plan: string[];
  /** Package J2: the owner's choice of the broken copy, honoured only on the project's first event, `intake.brief_entered`. */
  brokenCopy: BrokenCopyChoice | null;
  /**
   * Package J2: any trace of the broken copy in the record: a `broken_copy` field on any `intake.brief_entered`, a
   * `journey.broken_step_staged`, an engine event of the broken step, a `journey.plan_confirmed` listing it, or the
   * broken step in the plan. Sign-off, the export and the live app are refused on it; the badge is drawn from it.
   */
  brokenTrace: boolean;
  /** Each step's last build job. */
  stepJobs: Map<string, JobRecord>;
  /** The steps the owner approved ("Approve and build the next step"). */
  approved: Set<string>;
  /** The sandbox made for this project and not removed since. */
  sandbox: SandboxRecord | null;
  /** A preview job finished: the app was built, started and photographed. */
  previewFinished: boolean;
  /** The app was started and its sandbox not removed since. */
  appRunning: boolean;
  /**
   * The last acceptance job that ended, with what it reported. `outcome` is the one word the runner's own
   * `acceptance.run.finished` event of that run gives (package 3.1b): "passed", "failed" or "not passed"; null when
   * the job reported no run, or the run's event gives no such word (a record written before 3.1b). Sign-off reads
   * `outcome`, never the summary's text.
   */
  acceptanceRun: { jobId: string; runId: string | null; summary: string | null; refused: string | null; outcome: RunOutcome | null } | null;
  /** The last export written, by its event. */
  exportEventId: string | null;
  /** The last `journey.app.started` event, while the app runs (package J3: a live session is bound to it). */
  appStartedEventId: string | null;
  /** Package J3: the owner entered the live app since the app last started, so its data may have changed. */
  usedLiveSinceStart: boolean;
}

/**
 * Where a project's sandbox is, as `journey.sandbox.made` records it: its folder (all that removing it needs). Records
 * written before package 0.6c also named the app's and the database's ports on the machine; they are not read.
 */
export interface SandboxRecord {
  dir: string;
}

/** The plan's steps: the scripted change sets of example 1, in order. */
export const PLAN_STEPS: readonly string[] = listSteps(CHANGE_SETS_DIR, EXAMPLE);

/** A refusal the screens show as it is: the action was not taken and nothing was written. */
export class JourneyRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JourneyRefused";
  }
}

/** Work out a project's state from its events, in id order. The plan too comes from the record alone (package J2). */
export function journeyState(project: Project, events: Event[], intake: Intake): JourneyState {
  // Package J2: the choice is honoured only on the project's first event, written with the project in one transaction.
  const first = events[0];
  const brokenCopy = first?.kind === EV.briefEntered ? honouredChoice(first.payload.broken_copy) : null;
  const plan = [...PLAN_STEPS];
  if (brokenCopy && !plan.includes(BROKEN_STEP)) plan.push(BROKEN_STEP);
  const s: JourneyState = {
    project,
    events,
    stage: "brief",
    brief: null,
    answers: new Map(),
    nextTurn: 0,
    briefConfirmed: false,
    planConfirmed: false,
    acceptanceVersion: null,
    signedOff: false,
    jobs: [],
    runningJob: null,
    interrupted: false,
    plan,
    brokenCopy,
    brokenTrace: false,
    stepJobs: new Map(),
    approved: new Set(),
    sandbox: null,
    previewFinished: false,
    appRunning: false,
    acceptanceRun: null,
    exportEventId: null,
    appStartedEventId: null,
    usedLiveSinceStart: false,
  };
  let continued = false;
  let stopped = false;
  let closed = false;
  for (const e of events) {
    const p = e.payload;
    switch (e.kind) {
      case EV.briefEntered:
        s.brief = typeof p.text === "string" ? p.text : null;
        break;
      case EV.continued:
        continued = true;
        break;
      case EV.stopped:
        stopped = true;
        break;
      case EV.answer:
        if (typeof p.question === "string") s.answers.set(p.question, { answer: p.answer as Answer, by: p.by === "scripted_customer" ? "scripted_customer" : "owner", matchesSheet: p.matches_sheet === true, eventId: e.id });
        break;
      case EV.briefConfirmed:
        s.briefConfirmed = true;
        break;
      case EV.planConfirmed:
        s.planConfirmed = true;
        s.acceptanceVersion = typeof p.acceptance_version === "string" ? p.acceptance_version : null;
        break;
      case EV.signedOff:
        s.signedOff = true;
        break;
      case EV.stepApproved:
        if (typeof p.step === "string") s.approved.add(p.step);
        break;
      case EV.sandboxMade:
        s.sandbox = typeof p.dir === "string" ? { dir: p.dir } : null;
        break;
      case EV.sandboxRemoved:
        // A removal that failed (`removed: false`) leaves the sandbox recorded, so the next start tries again.
        if (p.removed !== false) s.sandbox = null;
        s.appRunning = false;
        s.appStartedEventId = null;
        if (p.interrupted === true) s.interrupted = true;
        break;
      case EV.appStarted:
        s.appRunning = true;
        s.appStartedEventId = e.id;
        s.usedLiveSinceStart = false;
        break;
      case EV.appStopped:
        s.appRunning = false;
        s.appStartedEventId = null;
        break;
      case EV.liveEntered:
        if (s.appRunning) s.usedLiveSinceStart = true;
        break;
      case EV.exportWritten:
        s.exportEventId = e.id;
        break;
      case EV.closed:
        closed = true;
        break;
      case EV.jobStarted: {
        const job: JobRecord = { jobId: String(p.job_id), kind: p.kind as JobKind, step: typeof p.step === "string" ? p.step : null, state: "running", startedEventId: e.id, reason: null };
        s.jobs.push(job);
        if (job.kind === "build_step" && job.step) s.stepJobs.set(job.step, job);
        break;
      }
      case EV.jobFinished:
      case EV.jobFailed:
      case EV.jobInterrupted: {
        const j = s.jobs.find((x) => x.jobId === String(p.job_id));
        if (j && j.state === "running") {
          j.state = e.kind === EV.jobFinished ? "finished" : e.kind === EV.jobFailed ? "failed" : "interrupted";
          j.reason = typeof p.reason === "string" ? p.reason : null;
          if (j.state === "interrupted") s.interrupted = true;
          if (j.state === "finished" && j.kind === "preview") s.previewFinished = true;
          if (j.state === "finished" && j.kind === "acceptance")
            s.acceptanceRun = { jobId: j.jobId, runId: typeof p.run_id === "string" ? p.run_id : null, summary: typeof p.summary === "string" ? p.summary : null, refused: typeof p.refused === "string" ? p.refused : null, outcome: null };
          // A checklist job that failed or was interrupted is the last run too: sign-off is judged on it, never on
          // an earlier run that passed (review of 13 Nov 2026, note 4).
          else if (j.kind === "acceptance") s.acceptanceRun = { jobId: j.jobId, runId: null, summary: null, refused: j.reason ?? `The checklist job was ${j.state}.`, outcome: null };
        }
        break;
      }
    }
  }
  // The outcome word of the last checklist job's run, from the runner's own event of that run (package 3.1b).
  if (s.acceptanceRun?.runId) s.acceptanceRun.outcome = runOutcome(events, s.acceptanceRun.runId);
  s.brokenTrace = s.plan.includes(BROKEN_STEP) || events.some(isBrokenTrace);
  s.runningJob = s.jobs.find((j) => j.state === "running") ?? null;
  s.nextTurn = intake.turns.findIndex((t) => t.some((q) => !s.answers.has(q)));
  if (s.nextTurn === -1) s.nextTurn = null;
  if (closed) s.stage = "closed";
  else if (stopped) s.stage = "stopped";
  else if (s.planConfirmed) s.stage = s.signedOff ? "signed_off" : s.previewFinished ? "acceptance" : s.plan.length > 0 && s.plan.every((st) => s.approved.has(st)) ? "preview" : "build";
  else if (s.briefConfirmed) s.stage = "plan_review";
  else if (continued && s.nextTurn === null) s.stage = "brief_review";
  else if (continued) s.stage = "questions";
  else s.stage = "brief";
  return s;
}

/** Package J2: an event that is a trace of the broken copy (see `JourneyState.brokenTrace`). */
function isBrokenTrace(e: Event): boolean {
  if (e.kind === EV.briefEntered) return Object.prototype.hasOwnProperty.call(e.payload, "broken_copy");
  if (e.kind === EV.brokenStepStaged) return true;
  if (e.kind === EV.engineEvent) return e.step === BROKEN_STEP;
  if (e.kind === EV.planConfirmed) return Array.isArray(e.payload.steps) && e.payload.steps.some((st: unknown) => st === BROKEN_STEP || (typeof st === "object" && st !== null && (st as { step?: unknown }).step === BROKEN_STEP));
  return false;
}

/** The three outcome words of package 3.1b; anything else is not one. */
const RUN_OUTCOMES: readonly RunOutcome[] = ["passed", "failed", "not passed"];

/**
 * The outcome word of one acceptance run, as the runner's `acceptance.run.finished` event of that run gives it
 * (package 3.1b, `RunReading.outcome`), or null: no such event, more than one, or no such word in it.
 */
export function runOutcome(events: Event[], runId: string): RunOutcome | null {
  const finished = events.filter((e) => e.kind === "acceptance.run.finished" && e.payload.run_id === runId);
  if (finished.length !== 1) return null;
  const word = finished[0]!.payload.outcome;
  return typeof word === "string" && (RUN_OUTCOMES as readonly string[]).includes(word) ? (word as RunOutcome) : null;
}

/**
 * The runner's record of the run a checklist job made, if it wrote one: the `acceptance.run.finished` event written
 * between the job's `journey.job.started` and its end (finished, failed or interrupted; one job runs at a time), the
 * one its finished event names first. Undefined for a job that ended before the runner wrote any event, and for a
 * job still running.
 */
export function jobRunFinished(events: Event[], job: JobRecord): Event | undefined {
  if (job.state === "running") return undefined;
  const started = BigInt(job.startedEventId);
  const end = events.find((e) => (e.kind === EV.jobFinished || e.kind === EV.jobFailed || e.kind === EV.jobInterrupted) && String(e.payload.job_id) === job.jobId);
  const inside = events.filter((e) => e.kind === "acceptance.run.finished" && BigInt(e.id) > started && (!end || BigInt(e.id) < BigInt(end.id)));
  const named = end && typeof end.payload.run_id === "string" ? inside.find((e) => e.payload.run_id === end.payload.run_id) : undefined;
  return named ?? inside.at(-1);
}

/**
 * When a job may start (design: no build before both confirmations; no export before sign-off). Returns why
 * not, or null. Checked under the project's lock, with no other job running in the process.
 */
export const JOB_RULES: Record<JobKind, (s: JourneyState) => string | null> = {
  build_step: (s) => (!s.briefConfirmed ? "The brief is not confirmed yet. Nothing is built until you confirm it." : !s.planConfirmed ? "The plan is not confirmed yet. Nothing is built until you confirm it." : null),
  preview: (s) =>
    !s.planConfirmed
      ? "The plan is not confirmed yet."
      : s.plan.some((st) => !s.approved.has(st))
        ? "Every step must be built and approved before the app is started for the preview."
        : s.previewFinished
          ? "The preview is already made."
          : null,
  acceptance: (s) =>
    !(s.planConfirmed && s.acceptanceVersion)
      ? "The plan is not confirmed yet, so the checklist's tests are not fixed."
      : !s.appRunning
        ? "The app is not running: make the preview first."
        : s.signedOff
          ? "The project is signed off; the checklist is not run again."
          : null,
  // Package J2: a broken copy is never exported, whatever its record says of sign-off (section 3.5). Package 3.2
  // (safeguard S12): one export per project.
  export: (s) => (!s.signedOff ? "The project is not signed off yet. Export is offered only after sign-off." : s.brokenTrace ? BROKEN_COPY_REFUSAL : s.exportEventId ? EXPORT_ONCE : null),
  // After the review of 14787d8 (known gap 161, the owner's choice): never after sign-off. Package J2: a broken copy is
  // refused before the scripted-only check, which its record would pass (section 3.6).
  live: (s) =>
    !s.planConfirmed
      ? "The plan is not confirmed yet."
      : s.signedOff
        ? LIVE_AFTER_SIGN_OFF
        : !s.appRunning
          ? "The app is not running: make the preview first. The live app is offered only while it runs."
          : s.brokenTrace
            ? BROKEN_LIVE_REFUSAL
            : scriptedOnlyProblem(s),
};

/**
 * Package J3, section 4.6 ("Scripted only"): why this project's app may not be used live, or null. Its record must
 * show only the scripted engine's fixed change sets: no model call; every engine event one the scripted engine
 * writes ("Scripted engine: ..." texts, `scripted.write` calls, finished, failed, blocked), of a step of the plan;
 * and for every step, its last build job finished, having written exactly the files of that step's fixed change, each
 * with the content its manifest names (SHA-256). The journey makes no other engine (journey.ts, `scriptedEngineFor`).
 * Each step's manifest is read where that step comes from (`changeSetsFor`, package J2).
 */
export function scriptedOnlyProblem(s: JourneyState): string | null {
  if (s.events.some((e) => e.kind === "model.call")) return "This project's record holds a model call: only an app built by the scripted engine may be used live.";
  for (const e of s.events) {
    if (e.kind !== EV.engineEvent) continue;
    const t = e.payload.type;
    const ok =
      e.step !== null &&
      s.plan.includes(e.step) &&
      ((t === "text" && typeof e.payload.text === "string" && e.payload.text.startsWith("Scripted engine: ")) ||
        (t === "tool_call" && e.payload.tool === "scripted.write") ||
        t === "finished" ||
        t === "failed" ||
        t === "blocked");
    if (!ok) return `An engine event in this project's record is not one the scripted engine writes (event ${e.id}): only an app built by the scripted engine may be used live.`;
  }
  for (const step of s.plan) {
    const job = s.stepJobs.get(step);
    if (job?.state !== "finished") return `Step ${step} has not been built: only an app built from every fixed change may be used live.`;
    const end = s.events.find((e) => e.kind === EV.jobFinished && String(e.payload.job_id) === job.jobId);
    if (!end) return `Step ${step}'s build has no recorded end.`;
    const writes = new Map<string, string>();
    for (const e of s.events) {
      if (e.kind !== EV.engineEvent || e.step !== step || BigInt(e.id) <= BigInt(job.startedEventId) || BigInt(e.id) >= BigInt(end.id)) continue;
      if (e.payload.type !== "tool_call") continue;
      const input = e.payload.input as { path?: unknown; sha256?: unknown } | undefined;
      if (typeof input?.path !== "string" || typeof input.sha256 !== "string") return `A write of step ${step} in the record names no file or no SHA-256.`;
      writes.set(input.path, input.sha256);
    }
    const manifest = readManifest(changeSetsFor(step), EXAMPLE, step);
    const want = new Map(manifest.files.map((f) => [f.path, f.sha256]));
    const same = writes.size === want.size && [...want].every(([path, digest]) => writes.get(path) === digest);
    if (!same) return `Step ${step}'s recorded writes are not exactly its fixed change's files and contents: only an app built by the scripted engine may be used live.`;
  }
  return null;
}

/**
 * Which step may be built (final design, section 1, item 6: nothing goes on without "Approve and build the next
 * step"): a step of the plan, every step before it approved, and the step itself not built already. A step whose
 * last job failed may be built again. Returns why not, or null.
 */
export function buildStepRefusal(s: JourneyState, step: string | undefined): string | null {
  if (!step || !s.plan.includes(step)) return "That step is not one of the plan's.";
  for (const earlier of s.plan.slice(0, s.plan.indexOf(step))) {
    if (!s.approved.has(earlier)) return `Step ${earlier} must be built and approved first.`;
  }
  const last = s.stepJobs.get(step);
  if (last?.state === "finished") return "This step is already built.";
  return null;
}

/** When a step may be approved: its last build job finished, and it is not approved yet. */
export function approveRefusal(s: JourneyState, step: string): string | null {
  if (s.stage === "stopped" || s.stage === "closed") return "This project is stopped or closed.";
  // After J2's second review (14 Nov 2026): an interrupted project is not resumed, so nothing of it is approved either. The
  // screen already showed no button; a request made anyway used to write the approval.
  if (s.interrupted) return APPROVE_INTERRUPTED;
  if (!s.plan.includes(step)) return "That step is not one of the plan's.";
  if (s.approved.has(step)) return "This step is already approved.";
  if (s.stepJobs.get(step)?.state !== "finished") return "This step is not built yet. A step is approved only once it has run to the end.";
  if (s.runningJob) return "A job of this project is running; wait for it to end.";
  return null;
}

/**
 * When the owner may sign off: the last checklist job finished (one that failed or was interrupted counts as the
 * last run, and did not pass), its run was not refused before its start, and the runner's own record of that run
 * gives the outcome "passed" (package 3.1b). The summary's text is not read: a run whose record has no outcome word
 * is not read as passed, whatever its summary says (a run that did not execute is never shown as passed, and is not
 * signed off).
 *
 * Package J2: never once the project was interrupted (its sandbox was removed; the screen offers only "Close project"
 * or "New project"), and never for a project with any trace of the broken copy, whatever its run's outcome reads; the
 * checklist's own reason is given first.
 */
export function signOffRefusal(s: JourneyState): string | null {
  if (s.stage === "stopped" || s.stage === "closed") return "This project is stopped or closed.";
  if (s.signedOff) return "This project is already signed off.";
  if (s.runningJob) return "A job of this project is running; wait for it to end.";
  if (s.interrupted) return "This project was interrupted when the interface stopped, so it is not signed off. Close the project, or start a new one.";
  const r = s.acceptanceRun;
  if (!r) return "The checklist has not been run yet.";
  if (r.refused || r.outcome !== "passed") return "The last checklist run did not pass, so there is nothing to sign off.";
  if (s.brokenTrace) return BROKEN_COPY_REFUSAL;
  return null;
}

/* ------------------------------------------------------------------ the event queue */

/**
 * Events written one after the other, in the order they were pushed, by one chain of awaits. The scripted
 * engine does not wait for its event handler's promise (scripted.ts) and the pool has five connections
 * (db.ts), so events written straight from the handler could be numbered out of order. The handler pushes
 * here instead, and `drain` waits until every pushed event is written.
 */
export class EventQueue {
  private chain: Promise<void> = Promise.resolve();
  private firstError: unknown = null;
  private written = 0;

  constructor(
    private readonly pool: pg.Pool,
    readonly projectId: string,
  ) {}

  push(kind: string, payload: Record<string, unknown>, step: string | null = null): void {
    this.chain = this.chain.then(
      () =>
        appendEvent(this.pool, this.projectId, kind, payload, step).then(
          () => {
            this.written++;
          },
          (err: unknown) => {
            this.firstError ??= err;
          },
        ),
    );
  }

  /** Wait for every event pushed so far. Never throws; `drain` does. */
  settled(): Promise<void> {
    return this.chain;
  }

  /** Wait for every event pushed so far; throws if any could not be written. */
  async drain(): Promise<number> {
    await this.chain;
    if (this.firstError !== null) throw new Error(`An event could not be written to the event log (${this.firstError instanceof Error ? this.firstError.name : typeof this.firstError}).`);
    return this.written;
  }
}

/** An engine event as the record keeps it: one `engine.event` per event, in emission order. */
export function engineEventHandler(queue: EventQueue, step: string): (e: EngineEvent) => void {
  return (e) => queue.push(EV.engineEvent, { ...e }, step);
}

/**
 * The engine wrapper: the step's result is returned only once every event its handler pushed is written,
 * so `step.hold_closed` (written by `runBudgetedStep` after the engine returns) follows the step's last event.
 */
export function orderedEngine(inner: BuildEngine, queue: EventQueue): BuildEngine {
  return {
    name: inner.name,
    async runStep(step: StepInstruction, onEvent: (e: EngineEvent) => void): Promise<StepResult> {
      try {
        return await inner.runStep(step, onEvent);
      } finally {
        await queue.settled();
      }
    },
    stop: () => inner.stop(),
  };
}

/** The only engine the journey makes: the scripted engine, which calls no model, behind the ordering wrapper. */
export function scriptedEngineFor(o: ScriptedEngineOptions, queue: EventQueue): BuildEngine {
  return orderedEngine(new ScriptedEngine(o), queue);
}

/* ------------------------------------------------------------------ disk */

/**
 * The free space a build needs, in bytes. ASSUMED, NOT MEASURED: about twice one project's two images as
 * measured on 13 Nov 2026 (tools 1.76 GB, app 274 MB). The check itself uses the free space measured at the
 * time (`statfs` of the data folder).
 */
export const DISK_FLOOR_BYTES = 4 * 1024 ** 3;
export function freeBytes(path: string): number {
  const s = statfsSync(path);
  return Number(s.bavail) * Number(s.bsize);
}
/** Why a build may not start for lack of disk, in plain words, or null. */
export function diskRefusal(path: string, floor = DISK_FLOOR_BYTES, measure: (p: string) => number = freeBytes): string | null {
  const free = measure(path);
  if (free >= floor) return null;
  const gb = (b: number) => (b / 1024 ** 3).toFixed(1);
  return `This machine has ${gb(free)} GB free; a build needs at least ${gb(floor)} GB (a floor assumed, not measured). The build was not started.`;
}

/* ------------------------------------------------------------------ the journey */

export interface JourneyOptions {
  pool: pg.Pool;
  /** BUILDER_DATA_DIR: the acceptance store and the journey's own files live under it. */
  dataDir: string;
  intake?: Intake;
  /**
   * Called when a project is closed, or found at start with a job left running or a sandbox left by an interface
   * that stopped: removes its containers, images and sandbox folder (journey-jobs.ts, through the adapter).
   * `recorded` is the sandbox as its event recorded it, for when this process holds no handle to it.
   */
  cleanupProject?: (projectId: string, recorded: SandboxRecord | null) => Promise<void>;
  /** Called when a job's body throws or the interface stops part-way, before it is recorded failed. */
  onFault?: (message: string, detail: unknown) => void;
  /**
   * Why this interface may not start a job now, or null (review bot on defb9c4: main.ts asks its instance lock of the
   * database). Asked under the project's lock just before every job is recorded; a reason refuses the job.
   */
  ownership?: () => Promise<string | null>;
}

/**
 * A job's body. `signal` is aborted when the journey is halted (the interface lost its instance lock, review bot on
 * defb9c4): the body then stops at once where it can, and before each further step (`stillOwned`), and changes
 * nothing more in its sandbox.
 */
export type JobBody = (ctx: { projectId: string; jobId: string; queue: EventQueue; state: JourneyState; signal: AbortSignal }) => Promise<Record<string, unknown> | void>;

/** Throws, with the reason the journey was halted for, once a job's signal is aborted (review bot on defb9c4). */
export function stillOwned(signal: AbortSignal): void {
  if (signal.aborted) throw new JourneyRefused(String(signal.reason));
}

export class Journey {
  readonly pool: pg.Pool;
  readonly dataDir: string;
  readonly intake: Intake;
  readonly spec: AppSpec;
  readonly specSha256: string;
  private readonly locks = new Map<string, Promise<unknown>>();
  private running: { projectId: string; jobId: string; done: Promise<void>; abort: AbortController } | null = null;
  /** Why the journey was halted (review bot on defb9c4), or null. Once set, nothing starts again in this process. */
  private haltedWhy: string | null = null;
  /**
   * After the review of 14787d8: ends a project's live session, if one is open or ending, and resolves once its close is
   * recorded. Attached by journey-jobs.ts with the live preview (`attachLiveEnd`); without a preview there is none to end.
   */
  private liveEnd: ((projectId: string, reason: string) => Promise<unknown>) | null = null;

  constructor(private readonly o: JourneyOptions) {
    this.pool = o.pool;
    this.dataDir = o.dataDir;
    this.intake = o.intake ?? loadIntake();
    this.spec = loadExampleSpec(this.intake);
    this.specSha256 = sha256(readFileSync(join(BUILDER_DIR, this.intake.app_spec)));
  }

  /** The steps of a project's plan (from its record, `JourneyState.plan`), each from its manifest, with what it will show. */
  planSteps(s: Pick<JourneyState, "plan">): Array<{ step: string; label: string; files: number }> {
    return s.plan.map((step) => {
      const m = readManifest(changeSetsFor(step), EXAMPLE, step);
      return { step, label: m.label, files: m.files.length };
    });
  }

  /** One action at a time per project, in this process. None once the journey is halted (review bot on defb9c4). */
  private withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(projectId) ?? Promise.resolve();
    const guarded = (): Promise<T> => (this.haltedWhy !== null ? Promise.reject(new JourneyRefused(this.haltedWhy)) : fn());
    const next = prev.then(guarded, guarded);
    this.locks.set(
      projectId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  private async load(projectId: string): Promise<JourneyState> {
    if (!projectId.startsWith(JOURNEY_PREFIX)) throw new JourneyRefused("That project was not made in this interface.");
    const project = await getProject(this.pool, projectId);
    if (!project) throw new JourneyRefused("There is no such project.");
    return journeyState(project, await listEvents(this.pool, projectId), this.intake);
  }

  state(projectId: string): Promise<JourneyState> {
    return this.load(projectId);
  }

  /** The journey's projects, oldest first, each with its stage. */
  async list(): Promise<Array<{ state: JourneyState; spentUsd: number }>> {
    const rows = await listProjects(this.pool, { idPrefix: JOURNEY_PREFIX });
    const out = [];
    for (const r of rows) {
      const { spent_usd, ...project } = r;
      out.push({ state: journeyState(project, await listEvents(this.pool, r.id), this.intake), spentUsd: Number(spent_usd) });
    }
    return out;
  }

  /** How many projects not made here are in the database (the list shows only the journey's). */
  async otherProjectCount(): Promise<number> {
    const r = await this.pool.query<{ n: string }>("select count(*)::text as n from projects where not starts_with(id, $1)", [JOURNEY_PREFIX]);
    return Number(r.rows[0]!.n);
  }

  /** A new project and its brief. The brief is stored as the owner typed it; it is never given to the engine. */
  async createProject(input: { name: string; cap: string; brief: string }): Promise<string> {
    if (this.haltedWhy !== null) throw new JourneyRefused(this.haltedWhy);
    const name = input.name.trim();
    if (name === "" || name.length > MAX_NAME || CONTROL.test(name)) throw new JourneyRefused(`Give the project a name of 1 to ${MAX_NAME} characters, on one line.`);
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(input.cap.trim())) throw new JourneyRefused("Give the cap in US dollars, such as 5 or 5.00.");
    const capUsd = Number(input.cap.trim());
    const brief = input.brief.replace(/\r\n/g, "\n");
    if (brief.trim() === "") throw new JourneyRefused("Write what you need in the box.");
    if (brief.length > MAX_BRIEF) throw new JourneyRefused(`The brief is longer than ${MAX_BRIEF.toLocaleString("en")} characters.`);
    if (CONTROL_EXCEPT_LINES.test(brief)) throw new JourneyRefused("The brief holds control characters.");
    // Package J2: the demonstration's name is the builder's to give, with its badge and refusals (section 3.1).
    if (name.replace(/\s+/g, " ").toLowerCase().startsWith(BROKEN_COPY_NAME_PREFIX.toLowerCase())) {
      throw new JourneyRefused(`A name that starts "${BROKEN_COPY_NAME_PREFIX}" is kept for the broken-copy demonstration on the Projects screen. Give this project another name.`);
    }
    const id = `${JOURNEY_PREFIX}${randomBytes(6).toString("hex")}`;
    await createProject(this.pool, { id, name, capUsd });
    await appendEvent(this.pool, id, EV.briefEntered, { text: brief, characters: brief.length, given_to_engine: false });
    return id;
  }

  /**
   * Package J2 (a): "Start the broken-copy demonstration". A project the builder names itself, capped at $5.00, with
   * example 1's ask as its brief; its first event carries the owner's choice, `broken_copy`. The project's row and that
   * event are written in one database transaction (tx.ts), so neither exists without the other. Nothing else writes
   * `broken_copy`: `createProject` takes no choice.
   */
  async createBrokenCopyDemo(): Promise<string> {
    if (this.haltedWhy !== null) throw new JourneyRefused(this.haltedWhy);
    if (!brokenCopyDemoShown()) throw new JourneyRefused("The broken-copy demonstration is not offered in this interface.");
    const choice = brokenCopyChoice();
    const id = `${JOURNEY_PREFIX}${randomBytes(6).toString("hex")}`;
    const brief = EXAMPLE_1_ASK;
    await inTransaction(this.pool, id, async (c) => {
      await createProject(c, { id, name: BROKEN_COPY_NAME, capUsd: BROKEN_COPY_CAP_USD });
      await event(c, id, EV.briefEntered, { text: brief, characters: brief.length, given_to_engine: false, broken_copy: choice }, null);
    });
    return id;
  }

  /** "Continue with example 1": the simulated analyst's restatement is accepted. */
  continueWithExample(projectId: string): Promise<void> {
    return this.withLock(projectId, async () => {
      const s = await this.load(projectId);
      if (s.stage !== "brief") throw new JourneyRefused("This project is past that point.");
      await appendEvent(this.pool, projectId, EV.continued, { example: EXAMPLE, restatement: this.spec.purpose.one_sentence, simulated_analyst: true, brief_read: false });
    });
  }

  /** "Stop": allowed before the plan is confirmed. */
  stop(projectId: string): Promise<void> {
    return this.withLock(projectId, async () => {
      const s = await this.load(projectId);
      if (!["brief", "questions", "brief_review", "plan_review"].includes(s.stage)) throw new JourneyRefused("This project cannot be stopped at this point.");
      await appendEvent(this.pool, projectId, EV.stopped, { at_stage: s.stage });
    });
  }

  /**
   * One turn's answers, in the turn's question order. Every question of the turn must be answered. Returns the
   * questions whose answer differs from example 1's answer sheet (the screen says the scripted build always
   * builds example 1's answers).
   */
  answerTurn(projectId: string, turn: number, answers: Record<string, Answer>): Promise<{ differs: string[] }> {
    return this.withLock(projectId, async () => {
      const s = await this.load(projectId);
      if (s.stage !== "questions") throw new JourneyRefused("This project is not at the questions.");
      if (turn !== s.nextTurn) throw new JourneyRefused("That turn is already answered.");
      const ids = this.intake.turns[turn]!;
      const problems: string[] = [];
      for (const id of ids) {
        const q = this.question(id);
        const a = answers[id];
        if (!a) problems.push(`${q.question} — not answered`);
        else {
          const p = answerProblem(q, a, this.spec);
          if (p) problems.push(`${q.question} — ${p}`);
        }
      }
      if (problems.length) throw new JourneyRefused(`Nothing was recorded: ${problems.join("; ")}.`);
      const differs: string[] = [];
      for (const id of ids) {
        const q = this.question(id);
        const a = answers[id]!;
        const matches = sameAnswer(a, sheetAnswer(q, this.spec));
        if (!matches) differs.push(id);
        await appendEvent(this.pool, projectId, EV.answer, answerPayload(id, turn, a, "owner", matches));
      }
      return { differs };
    });
  }

  /** "Answer the rest from example 1's answer sheet (scripted customer)". */
  answerRestFromSheet(projectId: string): Promise<number> {
    return this.withLock(projectId, async () => {
      const s = await this.load(projectId);
      if (s.stage !== "questions") throw new JourneyRefused("This project is not at the questions.");
      let n = 0;
      for (const [turn, ids] of this.intake.turns.entries()) {
        for (const id of ids) {
          if (s.answers.has(id)) continue;
          await appendEvent(this.pool, projectId, EV.answer, answerPayload(id, turn, sheetAnswer(this.question(id), this.spec), "scripted_customer", true));
          n++;
        }
      }
      return n;
    });
  }

  /** "Confirm brief" (B1 step 6). */
  confirmBrief(projectId: string): Promise<void> {
    return this.withLock(projectId, async () => {
      const s = await this.load(projectId);
      if (s.stage !== "brief_review") throw new JourneyRefused(s.stage === "questions" || s.stage === "brief" ? "Every question must be answered before the brief can be confirmed." : "The brief is already confirmed, or the project is stopped.");
      await appendEvent(this.pool, projectId, EV.briefConfirmed, {
        app_spec: this.intake.app_spec,
        app_spec_sha256: this.specSha256,
        later_items: this.spec.later.length,
        assumed_choices: this.spec.assumed.length,
        checklist_items: this.spec.acceptance.length,
        simulated_analyst: true,
      });
    });
  }

  /**
   * "Confirm plan" (B1 step 7). The checklist's tests are fixed now: the stand-in tests are written into the
   * acceptance store as a new version (package 3.1), labelled "stand-in test, not independent acceptance"
   * (the owner's answer to question B, 13 Nov 2026), then the confirmation is recorded with that version.
   */
  confirmPlan(projectId: string): Promise<void> {
    return this.withLock(projectId, async () => {
      const s = await this.load(projectId);
      if (s.stage !== "plan_review") throw new JourneyRefused(s.briefConfirmed ? "The plan is already confirmed, or the project is stopped." : "The brief must be confirmed before the plan.");
      const store = openStore(this.dataDir);
      const written = await writeStandInVersion(this.pool, store, projectId, EXAMPLE);
      await appendEvent(this.pool, projectId, EV.planConfirmed, {
        steps: this.planSteps(s),
        acceptance_version: written.version,
        acceptance_label: JOURNEY_STAND_IN_LABEL,
        acceptance_written_by: "stand-in",
        stand_in_label: STAND_IN_LABEL,
        quality_gate_after_each_step: "not done (milestone 1)",
        // Package J2: a broken copy's plan says so, and that no step is checked after it runs, nor retried.
        ...(s.brokenCopy ? { broken_copy: true, quality_check_after_each_step_and_retry: NO_QUALITY_CHECK_AND_RETRY } : {}),
      });
    });
  }

  /** Close a project: its containers are removed (part 2's cleanup) and nothing more happens to it. */
  closeProject(projectId: string): Promise<void> {
    return this.withLock(projectId, async () => {
      const s = await this.load(projectId);
      if (s.stage === "closed") return;
      if (this.running?.projectId === projectId) throw new JourneyRefused("A job is running for this project; wait for it to end.");
      await this.o.cleanupProject?.(projectId, s.sandbox);
      if (s.sandbox) await appendEvent(this.pool, projectId, EV.sandboxRemoved, { reason: "The project was closed.", interrupted: false });
      await appendEvent(this.pool, projectId, EV.closed, { at_stage: s.stage });
    });
  }

  /** "Approve and build the next step": the step's approval is recorded (the next job is started by journey-jobs.ts). */
  approveStep(projectId: string, step: string): Promise<void> {
    return this.withLock(projectId, async () => {
      const s = await this.load(projectId);
      const why = approveRefusal(s, step);
      if (why) throw new JourneyRefused(why);
      const last = s.stepJobs.get(step)!;
      await appendEvent(this.pool, projectId, EV.stepApproved, { step, job_id: last.jobId }, step);
    });
  }

  /**
   * "Sign off", labelled as the design says: on a simulated build, checked by a stand-in test of item 1 only.
   *
   * After the review of 14787d8 (known gap 161, the owner's choice): a live session of the project is ended first
   * (revoked at the front, its streams killed, its close recorded with the reason "signed_off"; a close already under
   * way is waited for), and only then is the sign-off recorded. Nothing can open a new one meanwhile, or after: an open
   * is a `live` job, started only under this project's lock and refused once the project is signed off
   * (`JOB_RULES.live`); and while one is in flight (its job running), the sign-off is refused below.
   */
  signOff(projectId: string): Promise<void> {
    return this.withLock(projectId, async () => {
      const s = await this.load(projectId);
      if (this.running?.projectId === projectId) throw new JourneyRefused("A job is running for this project; wait for it to end.");
      const why = signOffRefusal(s);
      if (why) throw new JourneyRefused(why);
      await this.liveEnd?.(projectId, LIVE_CLOSED_BY_SIGN_OFF);
      await appendEvent(this.pool, projectId, EV.signedOff, {
        label: SIGN_OFF_LABEL,
        acceptance_job: s.acceptanceRun!.jobId,
        acceptance_run: s.acceptanceRun!.runId,
        acceptance_outcome: s.acceptanceRun!.outcome,
        acceptance_summary: s.acceptanceRun!.summary,
        acceptance_label: JOURNEY_STAND_IN_LABEL,
      });
    });
  }

  question(id: string) {
    const q = this.intake.questions.find((x) => x.id === id);
    if (!q) throw new Error(`The intake has no question ${id}.`);
    return q;
  }

  /* -------------------------------------------------------------- jobs */

  /** The job running in this process, if any. */
  runningJob(): { projectId: string; jobId: string } | null {
    return this.running ? { projectId: this.running.projectId, jobId: this.running.jobId } : null;
  }

  /**
   * Halt the journey for good (review bot on defb9c4: the interface has lost its instance lock, so another interface
   * may now own the database). From now on no action or job starts in this process. The running job, if any, is told
   * to stop (its signal is aborted with `why`): it stops at once where it can, changes nothing more in its sandbox,
   * and its end is recorded as interrupted. Resolves once that job has ended.
   */
  halt(why: string): Promise<void> {
    this.haltedWhy ??= why;
    const r = this.running;
    if (!r) return Promise.resolve();
    r.abort.abort(this.haltedWhy);
    return r.done;
  }

  /** Why the journey was halted, or null. */
  halted(): string | null {
    return this.haltedWhy;
  }

  /**
   * Start a job, one at a time in this process. Its preconditions (`JOB_RULES`) are checked under the project's
   * lock; then `journey.job.started` is written and the body runs in the background. When it ends, the events
   * it pushed are written first, then `journey.job.finished` or `journey.job.failed`.
   */
  startJob(projectId: string, kind: JobKind, body: JobBody, o: { step?: string } = {}): Promise<{ jobId: string }> {
    return this.withLock(projectId, async () => {
      const s = await this.load(projectId);
      if (s.stage === "stopped" || s.stage === "closed") throw new JourneyRefused("This project is stopped or closed.");
      if (s.interrupted) throw new JourneyRefused("A job of this project was interrupted. Close the project, or start a new one.");
      const why = JOB_RULES[kind](s) ?? (kind === "build_step" ? buildStepRefusal(s, o.step) : null);
      if (why) throw new JourneyRefused(why);
      // After the review bot on defb9c4: the instance lock is asked of the database just before any job starts; then
      // the halt is looked at again, with nothing awaited between it, the check below and the slot being taken.
      const notOwned = (await this.o.ownership?.()) ?? null;
      if (notOwned !== null) throw new JourneyRefused(notOwned);
      if (this.haltedWhy !== null) throw new JourneyRefused(this.haltedWhy);
      if (this.running) throw new JourneyRefused("Another job is running. One job runs at a time.");
      const jobId = `job-${randomBytes(4).toString("hex")}`;
      // The slot is taken before anything is awaited, so that two jobs of two projects asked for at the same
      // moment cannot both pass the check above (each project has its own lock).
      let ended!: () => void;
      const abort = new AbortController();
      const slot = { projectId, jobId, done: new Promise<void>((r) => (ended = r)), abort };
      this.running = slot;
      try {
        await appendEvent(this.pool, projectId, EV.jobStarted, { job_id: jobId, kind, step: o.step ?? null }, o.step ?? null);
      } catch (err) {
        this.running = null;
        ended();
        throw err;
      }
      const queue = new EventQueue(this.pool, projectId);
      void (async () => {
        let ending: { kind: string; payload: Record<string, unknown> };
        try {
          stillOwned(abort.signal);
          const result = (await body({ projectId, jobId, queue, state: s, signal: abort.signal })) ?? {};
          await queue.drain();
          ending = { kind: EV.jobFinished, payload: { job_id: jobId, kind, ...result } };
        } catch (err) {
          await queue.settled();
          if (abort.signal.aborted) {
            // Halted (review bot on defb9c4): recorded as interrupted, as the next start would record it; not resumed.
            ending = {
              kind: EV.jobInterrupted,
              payload: { job_id: jobId, kind, reason: `The interface stopped while this job ran: ${String(abort.signal.reason)} The job was stopped part-way and is not resumed.` },
            };
          } else {
            const reason = err instanceof JourneyRefused ? err.message : `the job stopped with an error (${err instanceof Error ? err.name : typeof err})`;
            this.o.onFault?.(`A ${kind} job failed.`, { project: projectId, job: jobId, error: err instanceof Error ? err.message : String(err) });
            ending = { kind: EV.jobFailed, payload: { job_id: jobId, kind, reason } };
          }
        }
        try {
          await appendEvent(this.pool, projectId, ending.kind, ending.payload, o.step ?? null);
        } catch (err) {
          this.o.onFault?.("A job's ending could not be written; the project shows it as interrupted after a restart.", { project: projectId, job: jobId, error: err instanceof Error ? err.name : typeof err });
        } finally {
          this.running = null;
          ended();
        }
      })();
      return { jobId };
    });
  }

  /** After the review of 14787d8: how a project's live session is ended before its sign-off (journey-jobs.ts, `attachPreview`). */
  attachLiveEnd(fn: (projectId: string, reason: string) => Promise<unknown>): void {
    this.liveEnd = fn;
  }

  /** Wait for the running job, if any, to end (the automated run and the tests use it). */
  async waitForJob(): Promise<void> {
    await this.running?.done;
  }

  /**
   * At start: a journey project whose last job event is "started", or whose sandbox was made and not removed, was
   * left by an interface that stopped. Its job is marked interrupted, its containers, images and sandbox folder
   * removed (`cleanupProject`), and the removal recorded; an interrupted step's reservation is closed; nothing is
   * resumed. Only projects whose id starts "j1-" are looked at. Returns the projects touched.
   */
  async recoverInterrupted(): Promise<string[]> {
    return (await this.removeLeft("start", {})).touched;
  }

  /**
   * Package J2 (c), the clean stop (final design, section 4.1, items 3 to 5), called by main.ts once the journey is
   * halted: the same loop as at start, run at the stop. Every journey project of this database that has a sandbox and is
   * not closed is removed and recorded with the stop's own reason (`REMOVED_AT_STOP`, `interrupted: true`). Before each
   * project is read, its chain of actions in progress (such as a "Close project" that came before the stop) is waited
   * for until `waitUntil`; one not ended by then leaves its project for the next start. The project of a job still
   * running is left too. Before each removal `mayRemove` is asked (main.ts asks the instance lock of the database,
   * bounded): a reason ends the loop and nothing more is removed. `goOn` false (the process is exiting) ends it too.
   */
  async removeAtStop(o: { waitUntil: number; mayRemove: () => Promise<string | null>; goOn?: () => boolean }): Promise<StopRemoval> {
    const r = await this.removeLeft("stop", o);
    return { removed: r.removed, left: r.left, ended: r.ended };
  }

  /** The loop of `recoverInterrupted` and `removeAtStop`; `at` chooses the reason written, and whether to wait and ask first. */
  private async removeLeft(
    at: "start" | "stop",
    o: { waitUntil?: number; mayRemove?: () => Promise<string | null>; goOn?: () => boolean },
  ): Promise<StopRemoval & { touched: string[] }> {
    const out: StopRemoval & { touched: string[] } = { touched: [], removed: [], left: [], ended: null };
    for (const r of await listProjects(this.pool, { idPrefix: JOURNEY_PREFIX })) {
      if (!r.id.startsWith(JOURNEY_PREFIX)) continue;
      if (o.goOn && !o.goOn()) break;
      if (at === "stop") {
        // An action of this project already in progress (it passed the halt before it was set) ends first, so that the
        // stop and, say, a "Close project" never remove the same project at once (section 4.1, item 3).
        const chain = this.locks.get(r.id);
        if (chain && !(await settledBy(chain, o.waitUntil ?? Date.now()))) {
          out.left.push({ projectId: r.id, why: "an action of this project was still in progress when the wait ended" });
          continue;
        }
      }
      if (this.running?.projectId === r.id) {
        if (at === "stop") out.left.push({ projectId: r.id, why: `its job ${this.running.jobId} had not ended when the wait ended` });
        continue;
      }
      const { spent_usd: _spent, ...project } = r;
      const s = journeyState(project, await listEvents(this.pool, r.id), this.intake);
      const left = s.jobs.filter((j) => j.state === "running");
      const leftSandbox = s.stage !== "closed" ? s.sandbox : null;
      if (left.length === 0 && !leftSandbox) continue;
      // At the stop, asked just before anything of this project is changed (main.ts: the instance lock, bounded).
      const refused = o.mayRemove ? await o.mayRemove() : null;
      if (refused !== null) {
        out.ended = refused;
        break;
      }
      for (const j of left) {
        await appendEvent(this.pool, r.id, EV.jobInterrupted, { job_id: j.jobId, kind: j.kind, reason: "The interface stopped while this job ran. It is not resumed." }, j.step);
      }
      let removed = true;
      try {
        await this.o.cleanupProject?.(r.id, leftSandbox);
      } catch (err) {
        removed = false;
        this.o.onFault?.("A project's containers could not be removed after an interruption.", { project: r.id, error: err instanceof Error ? err.message : String(err) });
      }
      if (leftSandbox) {
        await appendEvent(this.pool, r.id, EV.sandboxRemoved, { reason: at === "stop" ? REMOVED_AT_STOP : FOUND_AT_START, interrupted: true, removed });
        if (removed) out.removed.push({ projectId: r.id, dir: leftSandbox.dir });
        else out.left.push({ projectId: r.id, why: `its sandbox (${leftSandbox.dir}) could not be removed; the next start tries again` });
      }
      // The reservation of a step whose job was interrupted is closed (package 1.3's close, as at a step's end):
      // nothing runs that step any more, so the cost panel must not go on showing its room as reserved (review of
      // 13 Nov 2026, note 3). Only the open reservations of the interrupted steps, of this project.
      const steps = new Set(left.filter((j) => j.kind === "build_step" && j.step).map((j) => j.step!));
      for (const h of await listStepHolds(this.pool, r.id)) {
        if (h.state !== "open" || !steps.has(h.step_id)) continue;
        try {
          await closeStepHold(this.pool, { projectId: r.id, stepHoldId: h.id, reason: "job_interrupted" });
        } catch (err) {
          this.o.onFault?.("An interrupted step's reservation could not be closed at start; it is closed at its deadline.", { project: r.id, step_hold: h.id, error: err instanceof Error ? err.message : String(err) });
        }
      }
      out.touched.push(r.id);
    }
    return out;
  }
}

/** Whether `p` settles by the time `until` (milliseconds since the epoch); a promise already settled counts, however late. */
function settledBy(p: Promise<unknown>, until: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((r) => (timer = setTimeout(() => r(false), Math.max(0, until - Date.now())))),
  ]).finally(() => clearTimeout(timer));
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_EXCEPT_LINES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

function answerPayload(question: string, turn: number, answer: Answer, by: "owner" | "scripted_customer", matchesSheet: boolean): Record<string, unknown> {
  const freeText = "something_else" in answer && answer.something_else !== undefined && answer.something_else.trim() !== "";
  return {
    question,
    turn: turn + 1,
    answer,
    by,
    matches_sheet: matchesSheet,
    // B1 step 2 and B2: every "something else" answer is logged as a sign that an option is missing.
    something_else_logged: freeText,
  };
}
