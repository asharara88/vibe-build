import type pg from "pg";

export interface Event {
  id: string;
  project_id: string;
  at: Date;
  kind: string;
  step: string | null;
  payload: Record<string, unknown>;
}

/** Append one event. There is no update and no delete; the database refuses both. */
export async function appendEvent(
  pool: pg.Pool,
  projectId: string,
  kind: string,
  payload: Record<string, unknown>,
  step: string | null = null,
): Promise<Event> {
  const r = await pool.query<Event>(
    "insert into events(project_id, kind, step, payload) values ($1, $2, $3, $4) returning *",
    [projectId, kind, step, JSON.stringify(payload)],
  );
  return r.rows[0]!;
}

export async function listEvents(pool: pg.Pool, projectId: string, kind?: string): Promise<Event[]> {
  const r = kind
    ? await pool.query<Event>("select * from events where project_id = $1 and kind = $2 order by id", [projectId, kind])
    : await pool.query<Event>("select * from events where project_id = $1 order by id", [projectId]);
  return r.rows;
}
