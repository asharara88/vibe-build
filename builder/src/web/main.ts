/**
 * Starts the builder's own interface (package J1): `npm run web`.
 *
 * Start checks, each refusing the start in plain words:
 * - BUILDER_DATABASE_URL must be set (no default here: the evidence run and the owner's instance each get their
 *   own database); BUILDER_DATA_DIR must be set (an absolute folder outside the repository, as for the
 *   acceptance store);
 * - a password: BUILDER_UI_PASSWORD (12 characters or more), or the digest file a first run wrote in the data
 *   folder, or BUILDER_UI_FIRST_RUN=1 to let the first visitor choose it (auth.ts);
 * - one instance per database: a PostgreSQL advisory lock held on a connection of its own, as the gateway's
 *   liveness lock is (store/liveness.ts); a second instance on the same database is refused.
 * After the review bot on defb9c4: PostgreSQL releases that lock when the connection's session ends (terminated, or
 * the server restarted), and a second interface could then start and run its recovery against this one's jobs. So
 * the connection's end, or an error on it, stops this interface (`stopAfterLockLost`): every request is answered
 * with a plain 503 from then on, its journey is halted (no action or job starts; the running job is stopped and
 * changes nothing more in its sandbox), and the process exits with code 1 and one line saying why. The lock is also
 * asked of the database, on its own connection, just before every job starts (`InstanceLock.check`).
 * Once read, BUILDER_UI_PASSWORD and BUILDER_MODEL_API_KEY are deleted from `process.env`, so no child process
 * inherits them. The process's starting environment, which the same user or root can read in /proc/<pid>/environ
 * (of this process and of the npm or tsx process that started it), still holds them: Node cannot change it
 * (review of 13 Nov 2026, known gap 130). The interface starts no gateway and calls no model; it listens on
 * 127.0.0.1 only.
 * Package J3: the live preview's front (preview.ts) is started with the interface only when BUILDER_LIVE_PREVIEW=1
 * (after J3's review: off unless turned on, until the owner's phone test has been recorded), on
 * 127.0.0.1:BUILDER_PREVIEW_PORT (4030 by default), as BUILDER_PREVIEW_UID (1990 by default) when the interface runs as
 * root; it is stopped with the interface, and when the interface loses its instance lock every live session ends
 * first. Off, nothing listens on that port and "Open the live app" is refused ("started without the live preview").
 * On, a port already taken stops the interface's start, in one line.
 * Package J2 (c), the clean stop (docs/design/journey-j2.md, section 4.1): on SIGTERM or SIGINT (`stopOnSignal`) every
 * request is answered with a plain 503, "The interface is stopping."; the server and the live preview are stopped; the
 * journey is halted (no action or job starts; the running job is told to stop, its engine's container killed at once);
 * the interface waits, at most 30 s, for that job and for each project's action in progress; then, asking the database
 * before each project whether it still holds its instance lock (each answer bounded at 5 s), it removes every sandbox
 * left in its own database and records it, with the stop's own reason; never once the lock is lost or not confirmed.
 * Then it releases the lock, ends the pool and exits: 0 only if every open project was removed, else 1, naming each
 * project left for the next start. A second signal exits at once with 1; so does the whole stop past 90 s.
 * The demonstration pause, BUILDER_DEMO_STEP_PAUSE_MS (0 to 10,000; unset or 0: off), makes the scripted engine pause
 * that long before each write, so that a stop part-way can be shown; a line at start says so while it is on.
 */
import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { dataDirFromSetting, openStore } from "../acceptance/store.js";
import { createClient, createPool } from "../store/db.js";
import { migrate } from "../store/migrate.js";
import { example1Sandboxes } from "../orchestrator/example-1-adapter.js";
import { Journey, type StartRecovery } from "../orchestrator/journey.js";
import { JourneyJobs } from "../orchestrator/journey-jobs.js";
import { appendEvent } from "../store/events.js";
import { J1_BUILD_PROXY_PORT } from "../orchestrator/example-1-adapter.js";
import { createWebApp } from "./app.js";
import { passwordFromSettings, Sessions, SignInLimiter, type PasswordState } from "./auth.js";
import { frontTexts } from "./pages.js";
import { DEFAULT_PREVIEW_PORT, DEFAULT_PREVIEW_UID, LivePreview } from "./preview.js";

export const UI_HOST = "127.0.0.1";
export const DEFAULT_UI_PORT = 4020;
/** The variables taken out of `process.env` at start (not out of /proc/<pid>/environ, which Node cannot change). */
export const SCRUBBED = ["BUILDER_UI_PASSWORD", "BUILDER_MODEL_API_KEY"] as const;

export interface Settings {
  databaseUrl: string;
  dataDir: string;
  port: number;
  password: PasswordState;
  /** Package J3: the live preview front's port on 127.0.0.1, and its user when the interface runs as root. */
  previewPort: number;
  previewUid: number;
  /** Package J3, after its review: the front is started only when BUILDER_LIVE_PREVIEW is "1". Off by default. */
  livePreview: boolean;
  /** Package J2 (c): the demonstration pause before each write of a scripted step, in milliseconds; 0 (off) by default. */
  stepPauseMs: number;
}

/** Package J2 (c): the highest demonstration pause BUILDER_DEMO_STEP_PAUSE_MS takes, in milliseconds. */
export const MAX_DEMO_STEP_PAUSE_MS = 10_000;

/**
 * Read and check the settings, then delete the password and the model key from `env`. Throws, in plain words,
 * for the first setting that is missing or wrong; `env` is scrubbed whether or not it throws.
 */
export function readSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  try {
    const databaseUrl = env.BUILDER_DATABASE_URL;
    if (!databaseUrl) throw new Error("BUILDER_DATABASE_URL is not set. The interface needs its own database named; it has no default. The interface does not start.");
    let dataDir: string;
    try {
      dataDir = openStore(dataDirFromSetting(env)).dataDir;
    } catch (err) {
      throw new Error(`${err instanceof Error ? err.message : String(err)} The interface does not start.`);
    }
    const port = env.BUILDER_UI_PORT ? Number(env.BUILDER_UI_PORT) : DEFAULT_UI_PORT;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("BUILDER_UI_PORT must be a port number from 1024 to 65535. The interface does not start.");
    const previewPort = env.BUILDER_PREVIEW_PORT ? Number(env.BUILDER_PREVIEW_PORT) : DEFAULT_PREVIEW_PORT;
    if (!Number.isInteger(previewPort) || previewPort < 1024 || previewPort > 65535 || previewPort === port || previewPort === J1_BUILD_PROXY_PORT)
      throw new Error(`BUILDER_PREVIEW_PORT must be a port number from 1024 to 65535, not the interface's own nor ${J1_BUILD_PROXY_PORT}. The interface does not start.`);
    const previewUid = env.BUILDER_PREVIEW_UID ? Number(env.BUILDER_PREVIEW_UID) : DEFAULT_PREVIEW_UID;
    const live = env.BUILDER_LIVE_PREVIEW ?? "";
    if (!["", "0", "1"].includes(live)) throw new Error("BUILDER_LIVE_PREVIEW must be 1 (the live preview on) or 0 or unset (off). The interface does not start.");
    // Package J2 (c): a whole number of milliseconds from 0 to 10,000, written plainly; unset or 0 is off.
    const pause = env.BUILDER_DEMO_STEP_PAUSE_MS ?? "";
    if (!/^(0|[1-9]\d{0,4})?$/.test(pause) || Number(pause) > MAX_DEMO_STEP_PAUSE_MS)
      throw new Error(`BUILDER_DEMO_STEP_PAUSE_MS must be a whole number of milliseconds from 0 to ${MAX_DEMO_STEP_PAUSE_MS} (0 or unset: off). The interface does not start.`);
    const password = passwordFromSettings(env, dataDir);
    return { databaseUrl, dataDir, port, password, previewPort, previewUid, livePreview: live === "1", stepPauseMs: pause === "" ? 0 : Number(pause) };
  } finally {
    for (const k of SCRUBBED) delete env[k];
  }
}

/** The instance lock's key: one interface per database. */
const INSTANCE_LOCK_SQL = "('x' || substr(md5('builder-web-interface'), 1, 16))::bit(64)::bigint";

/** What the interface answers every request with, and logs, once it has lost its instance lock (review bot on defb9c4). */
export const LOCK_LOST =
  "The builder lost its instance lock on the database (the lock's own connection to PostgreSQL ended), so another interface could now start on the same database. This interface accepts no more work and must be restarted.";

/** How long the interface, once it has lost its lock, waits for its running job to end before it exits all the same. Chosen, not measured. */
export const LOCK_LOST_WAIT_MS = 60_000;

export interface InstanceLock {
  /** Why the lock is no longer held (its connection ended, or failed), or null while it is held. */
  lost(): string | null;
  /**
   * The same, asked of the database: the lock's own connection must answer, and PostgreSQL must list the lock as
   * granted to that connection's session (`pg_locks`). A loss found here is reported as one noticed by the connection.
   */
  check(): Promise<string | null>;
  /** End the lock's connection on purpose (the interface stopping): not reported as a loss. */
  release(): Promise<void>;
}

/**
 * Take the instance lock on a connection of its own and keep it. Throws if another instance holds it. After the
 * review bot on defb9c4: the connection's end, or an error on it, means the lock is gone (PostgreSQL releases a
 * session's locks when the session ends); `onLost` is called once, with LOCK_LOST, unless the lock was released on purpose.
 */
export async function holdInstanceLock(url: string, o: { onLost?: (why: string) => void } = {}): Promise<InstanceLock> {
  const c: pg.Client = createClient(url);
  let held = false;
  let released = false;
  let lostWhy: string | null = null;
  const lose = () => {
    if (!held || released || lostWhy !== null) return;
    lostWhy = LOCK_LOST;
    o.onLost?.(lostWhy);
  };
  // Neither ends the process; an error's message, which can name the database's address, is not kept.
  c.on("error", lose);
  c.on("end", lose);
  await c.connect();
  const r = await c.query<{ got: boolean }>(`select pg_try_advisory_lock(${INSTANCE_LOCK_SQL}) as got`);
  if (!r.rows[0]!.got) {
    released = true;
    await c.end().catch(() => undefined);
    throw new Error("Another interface is running on this database (its instance lock is held). This one does not start.");
  }
  held = true;
  return {
    lost: () => lostWhy,
    async check() {
      if (lostWhy !== null) return lostWhy;
      if (released) return "The interface is stopping: its instance lock was released. Nothing more starts.";
      try {
        // A lock on a 64-bit key is listed with its high half as classid, its low half as objid and objsubid 1
        // (PostgreSQL documentation, pg_locks), as journal-recovery.ts reads it.
        const q = await c.query<{ held: boolean }>(
          `select exists (
             select 1 from pg_locks l
              where l.locktype = 'advisory' and l.granted and l.objsubid = 1 and l.pid = pg_backend_pid()
                and l.database = (select oid from pg_database where datname = current_database())
                and ((l.classid::bigint << 32) | l.objid::bigint) = ${INSTANCE_LOCK_SQL}
           ) as held`,
        );
        if (!q.rows[0]!.held) lose();
      } catch {
        lose();
      }
      return lostWhy;
    },
    release: async () => {
      released = true;
      await c.end().catch(() => undefined);
    },
  };
}

/**
 * What the interface does once it has lost its instance lock (review bot on defb9c4). Every request is already
 * answered with a plain 503 (`createWebApp`'s `unavailable`). The journey is halted: no action or job starts from
 * now on, and the running job, if any, is stopped (the engine's or the app camera's container killed; otherwise at
 * its next step), changes nothing more in its sandbox, and is recorded as interrupted. The interface waits for that
 * job to end, for at most `waitMs`, then closes its server and exits with code 1, saying why in one line.
 */
export async function stopAfterLockLost(
  why: string,
  o: { journey: Journey; closeServer: () => void; log: (line: string) => void; exit: (code: number) => void; waitMs?: number; preview?: Pick<LivePreview, "stop"> },
): Promise<void> {
  const waitMs = o.waitMs ?? LOCK_LOST_WAIT_MS;
  const job = o.journey.runningJob();
  o.log(`[interface stopped] ${why} ${job ? `Its running job (${job.jobId}, project ${job.projectId}) is being stopped first.` : "No job was running."}`);
  // Package J3: every live session ends, its streams are killed, and the front stops.
  await o.preview?.stop("lock_lost").catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const ended = await Promise.race([
    o.journey.halt(why).then(() => true),
    new Promise<false>((r) => {
      timer = setTimeout(() => r(false), waitMs);
    }),
  ]);
  clearTimeout(timer);
  if (job) {
    o.log(
      ended
        ? `[interface stopped] The job ${job.jobId} has ended; its record says how. It is not resumed.`
        : `[interface stopped] The job ${job.jobId} had not ended after ${Math.round(waitMs / 1000)} s; the interface exits all the same. The next start records it as interrupted and removes the project's sandbox.`,
    );
  }
  o.closeServer();
  o.exit(1);
}

/* ------------------------------------------------------------------ package J2 (c): the clean stop */

/** What every request is answered with, plain and 503, from a stop signal on (final design, section 4.1, item 1). */
export const STOPPING = "The interface is stopping.";
/** How long the stop waits for the running job and each project's action in progress, all together. Chosen, not measured. */
export const STOP_WAIT_MS = 30_000;
/** How long one ask of the instance lock may take before the removal ends. Chosen, not measured. */
export const LOCK_CHECK_MS = 5_000;
/** The whole stop's bound, from the signal: past it, the process exits with code 1 at once. Chosen, not measured. */
export const STOP_DEADLINE_MS = 90_000;

export type StopSignal = "SIGTERM" | "SIGINT";

/** Why the journey is halted at a clean stop; the running job's record gives it. */
export const stoppedOnPurpose = (sig: StopSignal) => `The interface was stopped on purpose (${sig}).`;

/** Whether a stop signal has come: set once, never cleared. Read by every request through `unavailableReason`. */
export class StopFlag {
  why: string | null = null;
  set(): void {
    this.why ??= STOPPING;
  }
}

/**
 * Why the interface answers every request with a plain 503 now, or null (`createWebApp`'s `unavailable`): its instance
 * lock lost (review bot on defb9c4), else a stop signal come (package J2 (c)).
 */
export function unavailableReason(lock: Pick<InstanceLock, "lost">, flag: StopFlag): () => string | null {
  return () => lock.lost() ?? flag.why;
}

export interface StopOptions {
  journey: Journey;
  /** The instance lock: asked before each removal, released last. */
  lock: Pick<InstanceLock, "check" | "release">;
  flag: StopFlag;
  closeServer: () => void;
  preview?: Pick<LivePreview, "stop">;
  endPool: () => Promise<void>;
  log: (line: string) => void;
  exit: (code: number) => void;
  waitMs?: number;
  lockCheckMs?: number;
  deadlineMs?: number;
}

/** `p`'s value if it settles within `ms`, else `{ done: false }`; a rejection counts as settled, with no value. */
async function within<T>(p: Promise<T>, ms: number): Promise<{ done: true; value: T | undefined } | { done: false }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p.then(
        (value) => ({ done: true as const, value }),
        () => ({ done: true as const, value: undefined }),
      ),
      new Promise<{ done: false }>((r) => (timer = setTimeout(() => r({ done: false }), Math.max(0, ms)))),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const seconds = (ms: number) => `${Number((ms / 1000).toFixed(1))} s`;

/**
 * Package J2 (c): the clean stop on SIGTERM or SIGINT (final design, section 4.1), shaped like `stopAfterLockLost` so
 * that it can be tested without a process. In order: no new work (the flag: every request a plain 503), the server
 * closed; the journey halted with the stop's reason (the running job told to stop), then the live preview stopped
 * (this order since J2's second review); a wait of at most `waitMs`, counted from the halt, for that job and for each
 * project's action in progress; then every sandbox left in this database removed and
 * recorded (`Journey.removeAtStop`), the instance lock asked of the database before each, each ask bounded at
 * `lockCheckMs`: a lock lost or not confirmed ends the removal, and nothing more is removed. Then the lock is released,
 * the pool ended, and the process exits: 0 only if every open project was removed, else 1, with a line naming each
 * project left. Past `deadlineMs` from the signal, it exits with 1 at once. It never throws: a fault exits 1.
 */
export async function stopOnSignal(sig: StopSignal, o: StopOptions): Promise<void> {
  const waitMs = o.waitMs ?? STOP_WAIT_MS;
  const lockCheckMs = o.lockCheckMs ?? LOCK_CHECK_MS;
  const deadlineMs = o.deadlineMs ?? STOP_DEADLINE_MS;
  let exited = false;
  let deadline: NodeJS.Timeout | undefined;
  const exit = (code: number) => {
    if (exited) return;
    exited = true;
    clearTimeout(deadline);
    o.exit(code);
  };
  deadline = setTimeout(() => {
    if (exited) return;
    o.log(`[interface stopped] The stop had not finished ${seconds(deadlineMs)} after ${sig}; the interface exits now with code 1. What is left is removed at the next start.`);
    exit(1);
  }, deadlineMs);
  try {
    const why = stoppedOnPurpose(sig);
    // 1. No new work: every request gets a plain 503 from now on, and the server closes.
    o.flag.set();
    const job = o.journey.runningJob();
    o.log(`[interface stopping] ${why} ${job ? `Its running job (${job.jobId}, project ${job.projectId}) is being stopped first.` : "No job was running."} Every request is now answered "${STOPPING}"`);
    o.closeServer();
    // 2 and 3. The journey halted, and a bounded wait for the running job (each project's action is waited for below).
    // After J2's review (14 Nov 2026): halted before the live preview is stopped, not after. The halt is set, and the
    // running job told to stop, at once; a request already in flight can then start no job while the preview's stop,
    // which takes seconds, is awaited. The wait for the job counts from here, the preview's stop included.
    const waitUntil = Date.now() + waitMs;
    const halting = o.journey.halt(why);
    halting.catch(() => undefined);
    await o.preview?.stop().catch(() => undefined);
    const halted = await within(halting, waitUntil - Date.now());
    if (job) {
      o.log(
        halted.done
          ? `[interface stopping] The job ${job.jobId} has ended; its record says how. It is not resumed.`
          : `[interface stopping] The job ${job.jobId} had not ended after ${seconds(waitMs)}; its project ${job.projectId} is not removed while the job runs. The next start removes it.`,
      );
    }
    // 4 and 5. The removal, asking the lock of the database before each project, each ask bounded.
    const r = await o.journey.removeAtStop({
      waitUntil,
      goOn: () => !exited,
      mayRemove: async () => {
        const asked = await within(o.lock.check(), lockCheckMs);
        if (!asked.done) return `The instance lock was not confirmed by the database within ${seconds(lockCheckMs)}.`;
        return asked.value === undefined ? "The instance lock could not be asked of the database." : asked.value;
      },
    });
    for (const x of r.removed) o.log(`[interface stopping] Project ${x.projectId}: its sandbox (${x.dir}) was removed at the stop: its containers, images and folder. It is marked interrupted, not resumed.`);
    if (r.ended !== null) o.log(`[interface stopping] ${r.ended} Nothing more is removed: the interface never removes once it does not hold its lock. The next start removes what is left.`);
    for (const x of r.left) o.log(`[interface stopping] ${leftForNextStart(x)}`);
    o.log(`Projects with a sandbox, marked interrupted and removed at the stop: ${r.removed.length}.`);
    // 6. The lock released only now, so that no other interface on this database runs its recovery meanwhile.
    await o.lock.release().catch(() => undefined);
    await o.endPool().catch(() => undefined);
    const code = r.ended === null && r.left.length === 0 ? 0 : 1;
    if (!exited) o.log(`[interface stopped] Lock released. Exit code ${code}${code === 0 ? "." : ": a project is left for the next start."}`);
    exit(code);
  } catch (err) {
    o.log(`[interface stopped] The stop failed part-way (${err instanceof Error ? err.name : typeof err}); the interface exits with code 1. The next start removes what is left.`);
    exit(1);
  }
}

/** The words for a project left for the next start, the same at a stop and at a start (after the review of known gap 180's fix). */
export const leftForNextStart = (x: { projectId: string; why: string }) => `Project ${x.projectId} is left for the next start: ${x.why}.`;

/**
 * After the review of known gap 180's fix: the lines main.ts prints once the recovery at start has run
 * (`Journey.recoverAtStart`). One line for each project whose removal left something, naming what is left, in the
 * stop's own words for a project left; then the count line, which counts only the projects not left. With no project
 * left, the count line alone, reading as it always did (J2's automated run reads it).
 */
export function startRecoveryLines(r: StartRecovery): string[] {
  const left = new Set(r.left.map((x) => x.projectId));
  return [
    ...r.left.map((x) => `[interface starting] ${leftForNextStart(x)}`),
    `Projects with a job or a sandbox left by an interface that stopped, marked interrupted and removed at start: ${r.touched.filter((id) => !left.has(id)).length}.`,
  ];
}

/**
 * Package J2 (c): what main.ts runs on SIGTERM and SIGINT. The first starts the clean stop (`stopOnSignal`); a second,
 * during the stop, exits at once with code 1 and says so (section 4.1). Returns the stop for the first signal.
 */
export function stopSignalHandler(o: StopOptions): (sig: StopSignal) => Promise<void> | undefined {
  let exited = false;
  const exit = (code: number) => {
    if (exited) return;
    exited = true;
    o.exit(code);
  };
  let stopping: Promise<void> | null = null;
  return (sig) => {
    if (stopping) {
      o.log(`[interface stopped] A second stop signal (${sig}) came during the stop; the interface exits now with code 1. What is left is removed at the next start.`);
      exit(1);
      return undefined;
    }
    stopping = stopOnSignal(sig, { ...o, exit });
    return stopping;
  };
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  let s: Settings;
  try {
    s = readSettings(env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  // After the review bot on defb9c4: until the interface serves, a lost lock ends the process at once.
  let onLockLost: (why: string) => void = (why) => {
    console.error(`[interface stopped] ${why}`);
    process.exit(1);
  };
  const lock = await holdInstanceLock(s.databaseUrl, { onLost: (why) => onLockLost(why) }).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
  const pool = createPool(s.databaseUrl);
  await migrate(pool);
  const fault = (m: string, d: unknown) => console.error(`[interface fault] ${m}`, d);
  // The jobs remove a project's sandbox when it is closed, or found at start from an interface that stopped.
  let jobs: JourneyJobs | null = null;
  const journey = new Journey({ pool, dataDir: s.dataDir, onFault: fault, cleanupProject: (id, rec) => jobs?.cleanup(id, rec) ?? Promise.resolve(), ownership: () => lock.check() });
  jobs = new JourneyJobs({ journey, sandboxes: example1Sandboxes(), onFault: fault, stepPauseMs: s.stepPauseMs });
  if (s.stepPauseMs > 0)
    console.log(`Demonstration setting: the scripted engine pauses ${s.stepPauseMs} ms before each write (BUILDER_DEMO_STEP_PAUSE_MS), so that a stop part-way can be shown. Every step is slower; each build step records the pause.`);
  for (const line of startRecoveryLines(await journey.recoverAtStart())) console.log(line);
  // Package J3: the live preview's front, before the interface serves; only when it is turned on (J3's review).
  let preview: LivePreview | undefined;
  if (s.livePreview) {
    const p = new LivePreview({
      port: s.previewPort,
      uid: s.previewUid,
      texts: frontTexts(),
      openStream: (id) => jobs?.openStream(id) ?? null,
      onEvent: async (id, kind, payload) => void (await appendEvent(pool, id, kind, payload)),
      onFault: fault,
    });
    try {
      await p.start();
    } catch (err) {
      console.error(`${err instanceof Error ? err.message : String(err)} The interface does not start.`);
      await p.stop().catch(() => undefined);
      process.exit(1);
    }
    preview = p;
    jobs.attachPreview(p);
    console.log(`Live preview front listening on http://127.0.0.1:${s.previewPort}, as ${p.frontUser()}.`);
  } else {
    console.log(`Live preview: off (BUILDER_LIVE_PREVIEW is not 1). Nothing listens on 127.0.0.1:${s.previewPort}; "Open the live app" is refused.`);
  }
  // Package J2 (c): from a stop signal on, every request is answered with a plain 503, as after a lost lock.
  const stopFlag = new StopFlag();
  const app = createWebApp({ journey, jobs, password: s.password, sessions: new Sessions(), limiter: new SignInLimiter(), dataDir: s.dataDir, onFault: fault, unavailable: unavailableReason(lock, stopFlag), preview });
  const server = serve({ fetch: app.fetch, port: s.port, hostname: UI_HOST }, (info) => {
    console.log(`Interface listening on http://${info.address}:${info.port} (password from: ${s.password.source}).`);
  });
  onLockLost = (why) =>
    void stopAfterLockLost(why, { journey, closeServer: () => server.close(), log: (line) => console.error(line), exit: (code) => process.exit(code), preview });
  const lostAlready = lock.lost();
  if (lostAlready) onLockLost(lostAlready);
  // Package J2 (c): the clean stop; a second signal exits at once.
  const onStop = stopSignalHandler({
    journey,
    lock,
    flag: stopFlag,
    closeServer: () => server.close(),
    preview,
    endPool: () => pool.end(),
    log: (line) => console.log(line),
    exit: (code) => process.exit(code),
  });
  process.on("SIGINT", () => void onStop("SIGINT"));
  process.on("SIGTERM", () => void onStop("SIGTERM"));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) void main();
