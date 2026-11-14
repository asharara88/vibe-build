import type { Pool } from "pg";

/**
 * Drops a database that one test made for itself, AFTER the test has ended its own pool (known gap 185).
 *
 * Why this is not one statement. `drop database … with (force)` first ends every other connection to the database.
 * Made right after `pool.end()`, it turned whole runs red on 14 Nov 2026 for two reasons outside the code under test:
 *  - pg-pool's `end()` resolves when it has ASKED each connection to close, not when they are closed. The forced
 *    drop then ends one of the test's own connections, and its last message ("terminating connection due to
 *    administrator command") arrives where nobody listens: every test passes and the run still exits 1.
 *  - one of the connections is not the test role's to end (the test role is not a superuser here; inferred: a
 *    background worker of PostgreSQL visiting the new database), and the statement is refused with "permission
 *    denied to terminate process".
 *
 * What it does instead: it waits, for a bounded time, until PostgreSQL lists no connection to that database, and only
 * then drops it, without `force`, so it ends nobody's connection. A drop that PostgreSQL refuses because someone
 * connected in between is tried again within the same bound. When the bound is over it makes ONE last attempt with
 * `force`, and that attempt's own error, if any, is the one the test reports: a clean-up that cannot be done is still
 * a failure.
 *
 * It changes no assertion of any test. It is test support only; nothing under src/ uses it.
 */
export const DROP_WAIT_MS = 15_000;
const POLL_MS = 50;

export interface DropResult {
  /** How many times PostgreSQL was asked whether a connection was still there. */
  polls: number;
  /** Drops PostgreSQL refused before the one that worked. */
  refusedDrops: number;
  /** True when the bound ran out and the last attempt, with `force`, was the one made. */
  forced: boolean;
}

export async function dropTestDatabase(admin: Pool, name: string, waitMs = DROP_WAIT_MS): Promise<DropResult> {
  if (!/^[a-z0-9_]{1,63}$/.test(name)) throw new Error(`dropTestDatabase: "${name}" is not a test database's name.`);
  const quiet = async () => {
    const r = await admin.query<{ n: number }>("select count(*)::int as n from pg_stat_activity where datname = $1", [name]);
    return r.rows[0]!.n === 0;
  };
  const deadline = Date.now() + waitMs;
  let polls = 0;
  let refusedDrops = 0;
  for (;;) {
    polls += 1;
    if (await quiet()) {
      try {
        await admin.query(`drop database if exists "${name}"`);
        return { polls, refusedDrops, forced: false };
      } catch {
        // Someone connected between the question and the drop; asked again below, within the same bound.
        refusedDrops += 1;
      }
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  await admin.query(`drop database if exists "${name}" with (force)`);
  return { polls, refusedDrops, forced: true };
}
