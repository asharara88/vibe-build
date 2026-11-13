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
  // A cap must be a real number of dollars, 0 or more and below $100,000,000: a NaN cap would refuse no
  // call (migration 007 refuses it in the database too). Decimals beyond the fourth are still rounded by
  // the database, as before: package 1.2's tests create such caps (docs/DECISIONS.md, 13 Nov 2026).
  if (typeof p.capUsd !== "number" || !Number.isFinite(p.capUsd) || p.capUsd < 0 || p.capUsd >= 1e8) {
    throw new Error(`A project's cap must be a real number of dollars, 0 or more and below $100,000,000 (got ${typeof p.capUsd === "number" ? String(p.capUsd) : typeof p.capUsd})`);
  }
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

export interface ProjectListed extends Project {
  /** What the event log records as spent (its `model.call` events). */
  spent_usd: string;
}

/**
 * Every project, oldest first, with what it has spent (package J1: the builder's project list). It only reads.
 * `idPrefix`, when given, keeps only the projects whose id starts with it.
 */
export async function listProjects(pool: pg.Pool, o: { idPrefix?: string } = {}): Promise<ProjectListed[]> {
  const r = await pool.query<ProjectListed>(
    `select p.*, s.spent_usd from projects p join project_spend s on s.project_id = p.id
      where $1::text is null or starts_with(p.id, $1::text)
      order by p.created_at, p.id`,
    [o.idPrefix ?? null],
  );
  return r.rows;
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

/**
 * The project a presented token belongs to and, for a step's token (package 1.3), its step hold and
 * the step's id. A revoked token, or one not known, gives null. The step's id comes from the step
 * hold, not from anything the caller sends.
 */
export async function tokenOwner(pool: pg.Pool, token: string): Promise<{ project: Project; stepHold: { id: string; stepId: string } | null } | null> {
  const r = await pool.query<Project & { step_hold_id: string | null; step_id: string | null }>(
    `select p.*, t.step_hold_id, s.step_id
       from project_tokens t
       join projects p on p.id = t.project_id
       left join step_holds s on s.id = t.step_hold_id and s.project_id = t.project_id
      where t.token_hash = $1 and t.revoked_at is null`,
    [hashToken(token)],
  );
  const row = r.rows[0];
  if (!row) return null;
  const { step_hold_id, step_id, ...project } = row;
  return { project, stepHold: step_hold_id !== null && step_id !== null ? { id: step_hold_id, stepId: step_id } : null };
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
