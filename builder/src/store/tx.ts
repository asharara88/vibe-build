/**
 * The one way a budget decision touches the database: a transaction that first locks the project's row.
 * Moved here from holds.ts in package 1.4, unchanged, so that the freeze (freezes.ts) takes the same lock.
 *
 * Every budget write takes this lock, so a project's events written under it are numbered in the order the
 * lock was held: id order is commit order for them (the invariant checker of package 1.4 relies on this).
 */
import type pg from "pg";

export type Queryable = Pick<pg.PoolClient, "query">;

export async function event(q: Queryable, projectId: string, kind: string, payload: Record<string, unknown>, step: string | null): Promise<string> {
  return (await q.query<{ id: string }>("insert into events(project_id, kind, step, payload) values ($1, $2, $3, $4) returning id", [projectId, kind, step, JSON.stringify(payload)])).rows[0]!.id;
}

export async function inTransaction<T>(pool: pg.Pool, projectId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    // "Read committed" is stated, not left to the database's default: under a stricter default a
    // transaction would keep reading the budget as it stood before it waited for the lock.
    await client.query("begin isolation level read committed");
    // The lock that makes check-and-hold one step: every budget decision for a project waits here.
    await client.query("select id from projects where id = $1 for update", [projectId]);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
