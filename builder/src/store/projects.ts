import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";

export interface Project {
  id: string;
  name: string;
  profile: string;
  cap_usd: string;
  created_at: Date;
}

export async function createProject(pool: pg.Pool, p: { id: string; name: string; capUsd: number; profile?: string }): Promise<Project> {
  const r = await pool.query<Project>(
    "insert into projects(id, name, profile, cap_usd) values ($1, $2, $3, $4) returning *",
    [p.id, p.name, p.profile ?? "standard", p.capUsd],
  );
  return r.rows[0]!;
}

export async function getProject(pool: pg.Pool, id: string): Promise<Project | null> {
  const r = await pool.query<Project>("select * from projects where id = $1", [id]);
  return r.rows[0] ?? null;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issue a project token: what the engine's container is given in place of the real
 * model key. The token is returned once and only its hash is stored.
 */
export async function issueProjectToken(pool: pg.Pool, projectId: string, label = "engine"): Promise<string> {
  const token = `bpt_${projectId}_${randomBytes(18).toString("base64url")}`;
  await pool.query("insert into project_tokens(token_hash, project_id, label) values ($1, $2, $3)", [
    hashToken(token),
    projectId,
    label,
  ]);
  return token;
}

export async function projectForToken(pool: pg.Pool, token: string): Promise<Project | null> {
  const r = await pool.query<Project>(
    `select p.* from project_tokens t join projects p on p.id = t.project_id
      where t.token_hash = $1 and t.revoked_at is null`,
    [hashToken(token)],
  );
  return r.rows[0] ?? null;
}

export interface Spend {
  project_id: string;
  cap_usd: string;
  spent_usd: string;
  model_calls: string;
}

export async function getSpend(pool: pg.Pool, projectId: string): Promise<Spend> {
  const r = await pool.query<Spend>("select * from project_spend where project_id = $1", [projectId]);
  if (!r.rows[0]) throw new Error(`Unknown project ${projectId}`);
  return r.rows[0];
}
