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
 * Once read, BUILDER_UI_PASSWORD and BUILDER_MODEL_API_KEY are deleted from `process.env`, so no child process
 * inherits them. The process's starting environment, which the same user or root can read in /proc/<pid>/environ
 * (of this process and of the npm or tsx process that started it), still holds them: Node cannot change it
 * (review of 13 Nov 2026, known gap 130). The interface starts no gateway and calls no model; it listens on
 * 127.0.0.1 only.
 */
import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { dataDirFromSetting, openStore } from "../acceptance/store.js";
import { createClient, createPool } from "../store/db.js";
import { migrate } from "../store/migrate.js";
import { example1Sandboxes } from "../orchestrator/example-1-adapter.js";
import { Journey } from "../orchestrator/journey.js";
import { JourneyJobs } from "../orchestrator/journey-jobs.js";
import { createWebApp } from "./app.js";
import { passwordFromSettings, Sessions, SignInLimiter, type PasswordState } from "./auth.js";

export const UI_HOST = "127.0.0.1";
export const DEFAULT_UI_PORT = 4020;
/** The variables taken out of `process.env` at start (not out of /proc/<pid>/environ, which Node cannot change). */
export const SCRUBBED = ["BUILDER_UI_PASSWORD", "BUILDER_MODEL_API_KEY"] as const;

export interface Settings {
  databaseUrl: string;
  dataDir: string;
  port: number;
  password: PasswordState;
}

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
    const password = passwordFromSettings(env, dataDir);
    return { databaseUrl, dataDir, port, password };
  } finally {
    for (const k of SCRUBBED) delete env[k];
  }
}

/** The instance lock's key: one interface per database. */
const INSTANCE_LOCK_SQL = "('x' || substr(md5('builder-web-interface'), 1, 16))::bit(64)::bigint";

/** Take the instance lock on a connection of its own and keep it. Throws if another instance holds it. */
export async function holdInstanceLock(url: string): Promise<{ release: () => Promise<void> }> {
  const c: pg.Client = createClient(url);
  c.on("error", () => undefined);
  await c.connect();
  const r = await c.query<{ got: boolean }>(`select pg_try_advisory_lock(${INSTANCE_LOCK_SQL}) as got`);
  if (!r.rows[0]!.got) {
    await c.end().catch(() => undefined);
    throw new Error("Another interface is running on this database (its instance lock is held). This one does not start.");
  }
  return { release: () => c.end().catch(() => undefined) };
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  let s: Settings;
  try {
    s = readSettings(env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const lock = await holdInstanceLock(s.databaseUrl).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
  const pool = createPool(s.databaseUrl);
  await migrate(pool);
  const fault = (m: string, d: unknown) => console.error(`[interface fault] ${m}`, d);
  // The jobs remove a project's sandbox when it is closed, or found at start from an interface that stopped.
  let jobs: JourneyJobs | null = null;
  const journey = new Journey({ pool, dataDir: s.dataDir, onFault: fault, cleanupProject: (id, rec) => jobs?.cleanup(id, rec) ?? Promise.resolve() });
  jobs = new JourneyJobs({ journey, sandboxes: example1Sandboxes(), onFault: fault });
  const touched = await journey.recoverInterrupted();
  console.log(`Projects with a job or a sandbox left by an interface that stopped, marked interrupted and removed at start: ${touched.length}.`);
  const app = createWebApp({ journey, jobs, password: s.password, sessions: new Sessions(), limiter: new SignInLimiter(), dataDir: s.dataDir, onFault: fault });
  const server = serve({ fetch: app.fetch, port: s.port, hostname: UI_HOST }, (info) => {
    console.log(`Interface listening on http://${info.address}:${info.port} (password from: ${s.password.source}).`);
  });
  const stop = () => {
    server.close();
    void lock.release().then(() => pool.end()).then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) void main();
