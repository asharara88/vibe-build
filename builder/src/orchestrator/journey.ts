/**
 * The owner's journey on the scripted engine (package J1; final design, sections 0 to 4).
 *
 * Only this module changes a project's state (design note, section 2: the web pages call only the
 * orchestrator). A project's state is its events, in id order: no new table, no migration. A project made
 * here has an id starting "j1-", and nothing here touches a project without that prefix.
 *
 * Stages: brief entered → continued as example 1 (or stopped) → the 20 questions answered → brief confirmed →
 * plan confirmed → build (the build, preview, acceptance and export jobs are package J1's part 2). Nothing is
 * built before both confirmations, and nothing is exported before sign-off (`JOB_RULES`).
 *
 * SIMULATED: the analyst. The questions are fixed (intake.ts), the brief is never read or given to the engine,
 * and every project continues as test example 1. REAL: the store, the event log, the budget and step holds
 * (package 1.3), the acceptance store (package 3.1). The only engine this module makes is the ScriptedEngine
 * (package 2.1), which calls no model; no gateway is started here, and the real-model gate stays closed.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, statfsSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import type { BuildEngine, EngineEvent, StepInstruction, StepResult } from "../engine/interface.js";
import { listSteps, readManifest, ScriptedEngine, type ScriptedEngineOptions } from "../engine/scripted.js";
import { openStore, sha256, STAND_IN_LABEL } from "../acceptance/store.js";
import { writeStandInVersion } from "../acceptance/stand-in.js";
import type { AppSpec } from "../spec/app-spec.js";
import { appendEvent, listEvents, type Event } from "../store/events.js";
import { createProject, getProject, listProjects, type Project } from "../store/projects.js";
import { answerProblem, BUILDER_DIR, loadExampleSpec, loadIntake, sameAnswer, sheetAnswer, type Answer, type Intake } from "./intake.js";

export const JOURNEY_PREFIX = "j1-";
export const EXAMPLE = "example-1";
export const CHANGE_SETS_DIR = join(BUILDER_DIR, "scripted");
/** The label the stand-in tests carry in the journey (the owner's answer to question B, 13 Nov 2026). */
export const JOURNEY_STAND_IN_LABEL = "stand-in test, not independent acceptance";
export const MAX_BRIEF = 2_000;
export const MAX_NAME = 100;

/** The events this module writes. Part 2 writes `step_approved`, `signed_off` and its jobs' own events. */
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
} as const;

export type Stage = "brief" | "questions" | "brief_review" | "plan_review" | "build" | "stopped" | "closed";
export type JobKind = "build_step" | "preview" | "acceptance" | "export";

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
  /** A job was marked interrupted: the screen offers "Close project" or "New project", no resume. */
  interrupted: boolean;
}

/** A refusal the screens show as it is: the action was not taken and nothing was written. */
export class JourneyRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JourneyRefused";
  }
}

/** Work out a project's state from its events, in id order. */
export function journeyState(project: Project, events: Event[], intake: Intake): JourneyState {
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
      case EV.closed:
        closed = true;
        break;
      case EV.jobStarted:
        s.jobs.push({ jobId: String(p.job_id), kind: p.kind as JobKind, step: typeof p.step === "string" ? p.step : null, state: "running", startedEventId: e.id, reason: null });
        break;
      case EV.jobFinished:
      case EV.jobFailed:
      case EV.jobInterrupted: {
        const j = s.jobs.find((x) => x.jobId === String(p.job_id));
        if (j && j.state === "running") {
          j.state = e.kind === EV.jobFinished ? "finished" : e.kind === EV.jobFailed ? "failed" : "interrupted";
          j.reason = typeof p.reason === "string" ? p.reason : null;
          if (j.state === "interrupted") s.interrupted = true;
        }
        break;
      }
    }
  }
  s.runningJob = s.jobs.find((j) => j.state === "running") ?? null;
  s.nextTurn = intake.turns.findIndex((t) => t.some((q) => !s.answers.has(q)));
  if (s.nextTurn === -1) s.nextTurn = null;
  if (closed) s.stage = "closed";
  else if (stopped) s.stage = "stopped";
  else if (s.planConfirmed) s.stage = "build";
  else if (s.briefConfirmed) s.stage = "plan_review";
  else if (continued && s.nextTurn === null) s.stage = "brief_review";
  else if (continued) s.stage = "questions";
  else s.stage = "brief";
  return s;
}

/**
 * When a job may start (design: no build before both confirmations; no export before sign-off). Returns why
 * not, or null. Checked under the project's lock, with no other job running in the process.
 */
export const JOB_RULES: Record<JobKind, (s: JourneyState) => string | null> = {
  build_step: (s) => (!s.briefConfirmed ? "The brief is not confirmed yet. Nothing is built until you confirm it." : !s.planConfirmed ? "The plan is not confirmed yet. Nothing is built until you confirm it." : null),
  preview: (s) => (s.planConfirmed ? null : "The plan is not confirmed yet."),
  acceptance: (s) => (s.planConfirmed && s.acceptanceVersion ? null : "The plan is not confirmed yet, so the checklist's tests are not fixed."),
  export: (s) => (s.signedOff ? null : "The project is not signed off yet. Export is offered only after sign-off."),
};

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
  /** Called when a project is closed, or found with a job left running at start: removes its containers (part 2). */
  cleanupProject?: (projectId: string) => Promise<void>;
  /** Called when a job's body throws or the interface stops part-way, before it is recorded failed. */
  onFault?: (message: string, detail: unknown) => void;
}

export type JobBody = (ctx: { projectId: string; jobId: string; queue: EventQueue; state: JourneyState }) => Promise<Record<string, unknown> | void>;

export class Journey {
  readonly pool: pg.Pool;
  readonly dataDir: string;
  readonly intake: Intake;
  readonly spec: AppSpec;
  readonly specSha256: string;
  private readonly locks = new Map<string, Promise<unknown>>();
  private running: { projectId: string; jobId: string; done: Promise<void> } | null = null;

  constructor(private readonly o: JourneyOptions) {
    this.pool = o.pool;
    this.dataDir = o.dataDir;
    this.intake = o.intake ?? loadIntake();
    this.spec = loadExampleSpec(this.intake);
    this.specSha256 = sha256(readFileSync(join(BUILDER_DIR, this.intake.app_spec)));
  }

  /** The steps of the plan, from the scripted change sets' manifests, with what each will show. */
  planSteps(): Array<{ step: string; label: string; files: number }> {
    return listSteps(CHANGE_SETS_DIR, EXAMPLE).map((step) => {
      const m = readManifest(CHANGE_SETS_DIR, EXAMPLE, step);
      return { step, label: m.label, files: m.files.length };
    });
  }

  /** One action at a time per project, in this process. */
  private withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(projectId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
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
    const name = input.name.trim();
    if (name === "" || name.length > MAX_NAME || CONTROL.test(name)) throw new JourneyRefused(`Give the project a name of 1 to ${MAX_NAME} characters, on one line.`);
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(input.cap.trim())) throw new JourneyRefused("Give the cap in US dollars, such as 5 or 5.00.");
    const capUsd = Number(input.cap.trim());
    const brief = input.brief.replace(/\r\n/g, "\n");
    if (brief.trim() === "") throw new JourneyRefused("Write what you need in the box.");
    if (brief.length > MAX_BRIEF) throw new JourneyRefused(`The brief is longer than ${MAX_BRIEF.toLocaleString("en")} characters.`);
    if (CONTROL_EXCEPT_LINES.test(brief)) throw new JourneyRefused("The brief holds control characters.");
    const id = `${JOURNEY_PREFIX}${randomBytes(6).toString("hex")}`;
    await createProject(this.pool, { id, name, capUsd });
    await appendEvent(this.pool, id, EV.briefEntered, { text: brief, characters: brief.length, given_to_engine: false });
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
        steps: this.planSteps(),
        acceptance_version: written.version,
        acceptance_label: JOURNEY_STAND_IN_LABEL,
        acceptance_written_by: "stand-in",
        stand_in_label: STAND_IN_LABEL,
        quality_gate_after_each_step: "not done (milestone 1)",
      });
    });
  }

  /** Close a project: its containers are removed (part 2's cleanup) and nothing more happens to it. */
  closeProject(projectId: string): Promise<void> {
    return this.withLock(projectId, async () => {
      const s = await this.load(projectId);
      if (s.stage === "closed") return;
      if (this.running?.projectId === projectId) throw new JourneyRefused("A job is running for this project; wait for it to end.");
      await this.o.cleanupProject?.(projectId);
      await appendEvent(this.pool, projectId, EV.closed, { at_stage: s.stage });
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
   * Start a job, one at a time in this process. Its preconditions (`JOB_RULES`) are checked under the project's
   * lock; then `journey.job.started` is written and the body runs in the background. When it ends, the events
   * it pushed are written first, then `journey.job.finished` or `journey.job.failed`.
   */
  startJob(projectId: string, kind: JobKind, body: JobBody, o: { step?: string } = {}): Promise<{ jobId: string }> {
    return this.withLock(projectId, async () => {
      const s = await this.load(projectId);
      if (s.stage === "stopped" || s.stage === "closed") throw new JourneyRefused("This project is stopped or closed.");
      if (s.interrupted) throw new JourneyRefused("A job of this project was interrupted. Close the project, or start a new one.");
      const why = JOB_RULES[kind](s);
      if (why) throw new JourneyRefused(why);
      if (this.running) throw new JourneyRefused("Another job is running. One job runs at a time.");
      const jobId = `job-${randomBytes(4).toString("hex")}`;
      // The slot is taken before anything is awaited, so that two jobs of two projects asked for at the same
      // moment cannot both pass the check above (each project has its own lock).
      let ended!: () => void;
      const slot = { projectId, jobId, done: new Promise<void>((r) => (ended = r)) };
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
          const result = (await body({ projectId, jobId, queue, state: s })) ?? {};
          await queue.drain();
          ending = { kind: EV.jobFinished, payload: { job_id: jobId, kind, ...result } };
        } catch (err) {
          await queue.settled();
          const reason = err instanceof JourneyRefused ? err.message : `the job stopped with an error (${err instanceof Error ? err.name : typeof err})`;
          this.o.onFault?.(`A ${kind} job failed.`, { project: projectId, job: jobId, error: err instanceof Error ? err.message : String(err) });
          ending = { kind: EV.jobFailed, payload: { job_id: jobId, kind, reason } };
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

  /** Wait for the running job, if any, to end (the automated run and the tests use it). */
  async waitForJob(): Promise<void> {
    await this.running?.done;
  }

  /**
   * At start: a journey project whose last job event is "started" was left by an interface that stopped. Its job
   * is marked interrupted and its containers removed (`cleanupProject`); nothing is resumed. Only projects whose
   * id starts "j1-" are looked at. Returns the projects touched.
   */
  async recoverInterrupted(): Promise<string[]> {
    const touched: string[] = [];
    for (const r of await listProjects(this.pool, { idPrefix: JOURNEY_PREFIX })) {
      if (!r.id.startsWith(JOURNEY_PREFIX)) continue;
      if (this.running?.projectId === r.id) continue;
      const { spent_usd: _spent, ...project } = r;
      const s = journeyState(project, await listEvents(this.pool, r.id), this.intake);
      const left = s.jobs.filter((j) => j.state === "running");
      if (left.length === 0) continue;
      for (const j of left) {
        await appendEvent(this.pool, r.id, EV.jobInterrupted, { job_id: j.jobId, kind: j.kind, reason: "The interface stopped while this job ran. It is not resumed." }, j.step);
      }
      try {
        await this.o.cleanupProject?.(r.id);
      } catch (err) {
        this.o.onFault?.("A project's containers could not be removed after an interruption.", { project: r.id, error: err instanceof Error ? err.message : String(err) });
      }
      touched.push(r.id);
    }
    return touched;
  }
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
