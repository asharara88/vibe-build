/**
 * Holds in the database (design note 5.5; build plan package 1.2).
 *
 * The budget equation, checked before every metered call:
 *     spent + open holds + this call's hold <= cap
 * The check and the insert of the hold run in ONE transaction that locks the project's row, so
 * two calls arriving together are judged one after the other, whatever gateway process they
 * came through. A hold leaves the equation in one way only in this package: it is settled to
 * the actual cost of a call whose usage was read. Every other ending keeps it open.
 */
import type pg from "pg";

export interface Budget {
  cap: number;
  spent: number;
  openHolds: number;
  openHoldCount: number;
}

export interface Hold {
  id: string;
  project_id: string;
  step: string | null;
  amount_usd: string;
  state: "open" | "settled";
  expired: boolean;
  unreconciled: boolean;
  kept_reason: string | null;
  gateway: string;
  opened_at: Date;
  deadline_at: Date;
  closed_at: Date | null;
  actual_usd: string | null;
}

type Queryable = Pick<pg.PoolClient, "query">;

/** Money is compared in millionths of a dollar, as whole numbers, so sums never drift. */
export const micro = (usd: number): number => Math.round(usd * 1e6);

async function readBudget(q: Queryable, projectId: string): Promise<Budget> {
  const r = await q.query<{ cap_usd: string; spent_usd: string; open_holds_usd: string; open_holds: string }>(
    "select cap_usd, spent_usd, open_holds_usd, open_holds from project_budget where project_id = $1",
    [projectId],
  );
  const row = r.rows[0];
  if (!row) throw new Error(`Unknown project ${projectId}`);
  return { cap: Number(row.cap_usd), spent: Number(row.spent_usd), openHolds: Number(row.open_holds_usd), openHoldCount: Number(row.open_holds) };
}

export function getBudget(pool: pg.Pool, projectId: string): Promise<Budget> {
  return readBudget(pool, projectId);
}

async function event(q: Queryable, projectId: string, kind: string, payload: Record<string, unknown>, step: string | null) {
  await q.query("insert into events(project_id, kind, step, payload) values ($1, $2, $3, $4)", [projectId, kind, step, JSON.stringify(payload)]);
}

async function inTransaction<T>(pool: pg.Pool, projectId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
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

export type OpenResult =
  | { ok: true; hold: Hold; budget: Budget }
  | { ok: false; budget: Budget };

/**
 * Check the budget equation and, if the hold fits, open it. One transaction, under the
 * project's row lock. When it does not fit, a `gateway.refused` event is written and no hold
 * is opened. `arithmetic` is stored in the event so the amount can be checked by hand.
 */
export async function openHold(
  pool: pg.Pool,
  p: { projectId: string; step: string | null; amountUsd: number; deadline: Date; gateway: string; arithmetic: Record<string, unknown>; path: string },
): Promise<OpenResult> {
  return inTransaction(pool, p.projectId, async (c) => {
    await expireHoldsIn(c, p.projectId, new Date());
    const budget = await readBudget(c, p.projectId);
    if (micro(budget.spent) + micro(budget.openHolds) + micro(p.amountUsd) > micro(budget.cap)) {
      await event(
        c,
        p.projectId,
        "gateway.refused",
        { reason: "budget_reached", cap_usd: budget.cap, spent_usd: budget.spent, open_holds_usd: budget.openHolds, this_hold_usd: p.amountUsd, path: p.path },
        p.step,
      );
      return { ok: false as const, budget };
    }
    const r = await c.query<Hold>(
      "insert into holds(project_id, step, amount_usd, deadline_at, gateway) values ($1, $2, $3, $4, $5) returning *",
      [p.projectId, p.step, p.amountUsd, p.deadline, p.gateway],
    );
    const hold = r.rows[0]!;
    await event(
      c,
      p.projectId,
      "hold.opened",
      {
        hold_id: Number(hold.id),
        amount_usd: p.amountUsd,
        deadline_at: p.deadline.toISOString(),
        budget_before: { cap_usd: budget.cap, spent_usd: budget.spent, open_holds_usd: budget.openHolds },
        arithmetic: p.arithmetic,
      },
      p.step,
    );
    return { ok: true as const, hold, budget };
  });
}

/**
 * Settle a hold to the actual cost of a finished call whose usage was read. One transaction:
 * the `model.call` event with the actual cost, the hold closed, and a `hold.settled` event.
 * If the actual cost is above the hold, that is recorded as a breach; the truth is still charged.
 */
export async function settleHold(
  pool: pg.Pool,
  p: { projectId: string; holdId: string; step: string | null; actualUsd: number; call: Record<string, unknown> },
): Promise<{ settled: boolean; exceeded: boolean; amountUsd: number }> {
  return inTransaction(pool, p.projectId, async (c) => {
    const r = await c.query<Hold>("select * from holds where id = $1 and project_id = $2 for update", [p.holdId, p.projectId]);
    const hold = r.rows[0];
    if (!hold) throw new Error(`Hold ${p.holdId} does not exist for project ${p.projectId}`);
    if (hold.state !== "open") throw new Error(`Hold ${p.holdId} is already ${hold.state}`);
    const amountUsd = Number(hold.amount_usd);
    if (hold.expired || hold.unreconciled) {
      // An expired or unreconciled hold is closed only by the owner's recorded action. An answer
      // that arrives afterwards is written down for him, and the hold stays open at its full amount.
      await event(
        c,
        p.projectId,
        "hold.kept",
        { hold_id: Number(hold.id), amount_usd: amountUsd, reason: "answer arrived after the hold expired", seen: { ...p.call, cost_usd_as_read: p.actualUsd } },
        p.step,
      );
      return { settled: false, exceeded: false, amountUsd };
    }
    const exceeded = micro(p.actualUsd) > micro(amountUsd);
    await event(c, p.projectId, "model.call", { ...p.call, cost_usd: p.actualUsd, hold_id: Number(hold.id) }, p.step);
    await c.query("update holds set state = 'settled', closed_at = now(), actual_usd = $2 where id = $1", [p.holdId, p.actualUsd]);
    await event(
      c,
      p.projectId,
      "hold.settled",
      {
        hold_id: Number(hold.id),
        amount_usd: amountUsd,
        actual_usd: p.actualUsd,
        returned_usd: Math.round((amountUsd - p.actualUsd) * 1e6) / 1e6,
      },
      p.step,
    );
    if (exceeded) {
      await event(c, p.projectId, "hold.exceeded", { hold_id: Number(hold.id), amount_usd: amountUsd, actual_usd: p.actualUsd }, p.step);
    }
    return { settled: true, exceeded, amountUsd };
  });
}

/**
 * Record that a call ended in a way that does not tell the gateway what it cost. The hold is
 * NOT released: it stays open at its full amount. What was seen is recorded for information.
 * (Marking such holds for the owner's list and closing them is packages 1.4 and 1.5.)
 */
export async function keepHold(
  pool: pg.Pool,
  p: { projectId: string; holdId: string; step: string | null; reason: string; seen: Record<string, unknown> },
): Promise<void> {
  await inTransaction(pool, p.projectId, async (c) => {
    const r = await c.query<Hold>("select * from holds where id = $1 and project_id = $2 for update", [p.holdId, p.projectId]);
    const hold = r.rows[0];
    if (!hold || hold.state !== "open") return;
    await c.query("update holds set kept_reason = coalesce(kept_reason, $2) where id = $1", [p.holdId, p.reason]);
    await event(c, p.projectId, "hold.kept", { hold_id: Number(hold.id), amount_usd: Number(hold.amount_usd), reason: p.reason, seen: p.seen }, p.step);
  });
}

async function expireHoldsIn(c: Queryable, projectId: string | null, now: Date): Promise<Hold[]> {
  const r = await c.query<Hold>(
    `update holds set expired = true, unreconciled = true
      where state = 'open' and not expired and deadline_at <= $1 and ($2::text is null or project_id = $2)
      returning *`,
    [now, projectId],
  );
  for (const h of r.rows) {
    await event(
      c,
      h.project_id,
      "hold.expired",
      { hold_id: Number(h.id), amount_usd: Number(h.amount_usd), deadline_at: h.deadline_at.toISOString(), kept: true, unreconciled: true, still_open: true },
      h.step,
    );
  }
  return r.rows;
}

/**
 * Mark every open hold past its deadline as expired and unreconciled. It is kept at its full
 * amount and stays open: nothing is released.
 */
export async function expireHolds(pool: pg.Pool, now: Date = new Date()): Promise<Hold[]> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const rows = await expireHoldsIn(client, null, now);
    await client.query("commit");
    return rows;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * What a gateway does when it starts: find the holds that are open in the database. They were
 * left by an earlier gateway process (or by one still running beside this one). Each is kept at
 * its full amount and still counts as an open hold; a `hold.found_at_startup` event says so.
 * Holds past their deadline are marked expired by the same rule as at any other time.
 */
export async function recoverHolds(pool: pg.Pool, gateway: string, now: Date = new Date()): Promise<{ found: Hold[]; expired: Hold[] }> {
  const expired = await expireHolds(pool, now);
  const r = await pool.query<Hold>("select * from holds where state = 'open' and gateway <> $1 order by id", [gateway]);
  for (const h of r.rows) {
    await pool.query("insert into events(project_id, kind, step, payload) values ($1, $2, $3, $4)", [
      h.project_id,
      "hold.found_at_startup",
      h.step,
      JSON.stringify({ hold_id: Number(h.id), amount_usd: Number(h.amount_usd), opened_by: h.gateway, found_by: gateway, kept: true, still_open: true, expired: h.expired }),
    ]);
  }
  return { found: r.rows, expired };
}

export async function listHolds(pool: pg.Pool, projectId: string): Promise<Hold[]> {
  const r = await pool.query<Hold>("select * from holds where project_id = $1 order by id", [projectId]);
  return r.rows;
}
