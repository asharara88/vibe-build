/**
 * Holds in the database (design note 5.5; build plan package 1.2).
 *
 * The budget equation, checked before every metered call:
 *     spent + open holds + this call's hold <= cap
 * The check and the insert of the hold run in ONE transaction that locks the project's row, so
 * two calls arriving together are judged one after the other, whatever gateway process they
 * came through. A hold leaves the equation in one way only in this package: it is settled, to
 * the actual cost of a call whose usage was read, or at nothing when the provider's own error
 * says the request was turned away before any work, or at nothing when the call was never sent
 * because the caller left first. Every other ending keeps it open.
 *
 * A hold past its deadline is never settled or released, whether or not the sweep (`expireHolds`,
 * run every 30 seconds) has marked it yet: every function here that can close a hold first marks,
 * in its own transaction and under the project's lock, the project's open holds past their
 * deadline, as the sweep does, and only then reads the hold (review bot on 7ce5a33). Deadlines are
 * judged by the gateway's clock (`new Date()` in the gateway process): settlement, release and
 * admission read it once the project's lock is held; the 30-second pass reads it once, at its start.
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
  seen_at_startup: boolean;
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

async function event(q: Queryable, projectId: string, kind: string, payload: Record<string, unknown>, step: string | null): Promise<string> {
  return (await q.query<{ id: string }>("insert into events(project_id, kind, step, payload) values ($1, $2, $3, $4) returning id", [projectId, kind, step, JSON.stringify(payload)])).rows[0]!.id;
}

async function inTransaction<T>(pool: pg.Pool, projectId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
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
 * A hold past its deadline is not settled, even if the sweep has not marked it yet (see the top of this file).
 */
export async function settleHold(
  pool: pg.Pool,
  p: { projectId: string; holdId: string; step: string | null; actualUsd: number; call: Record<string, unknown> },
): Promise<{ settled: boolean; exceeded: boolean; amountUsd: number }> {
  return inTransaction(pool, p.projectId, async (c) => {
    // Under the project's lock, before the hold is read: a deadline that passed while this waited counts.
    await expireHoldsIn(c, p.projectId, new Date());
    const r = await c.query<Hold>("select * from holds where id = $1 and project_id = $2 for update", [p.holdId, p.projectId]);
    const hold = r.rows[0];
    if (!hold) throw new Error(`Hold ${p.holdId} does not exist for project ${p.projectId}`);
    if (hold.state !== "open") throw new Error(`Hold ${p.holdId} is already ${hold.state}`);
    const amountUsd = Number(hold.amount_usd);
    if (!Number.isFinite(p.actualUsd) || p.actualUsd < 0 || p.actualUsd >= 1e8) {
      // A cost that is not a real, non-negative number is not a cost that was read.
      await c.query("update holds set kept_reason = coalesce(kept_reason, $2) where id = $1", [p.holdId, "the cost worked out from the answer was not a valid amount"]);
      await event(c, p.projectId, "hold.kept", { hold_id: Number(hold.id), amount_usd: amountUsd, reason: "the cost worked out from the answer was not a valid amount", seen: p.call }, p.step);
      return { settled: false, exceeded: false, amountUsd };
    }
    if (hold.kept_reason !== null && !hold.expired && !hold.unreconciled) {
      // Already kept for a reason: only the owner's recorded action closes it (package 1.5).
      await event(c, p.projectId, "hold.kept", { hold_id: Number(hold.id), amount_usd: amountUsd, reason: `already kept: ${hold.kept_reason}`, seen: { ...p.call, cost_usd_as_read: p.actualUsd } }, p.step);
      return { settled: false, exceeded: false, amountUsd };
    }
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
 * Close a hold at nothing for a call that was never sent: the caller left after the hold was
 * opened and before the call was forwarded to the provider; only the counting call, assumed to
 * cost nothing, had been sent (review of 13 Nov 2026). One
 * transaction: the hold closed at nothing and a `hold.settled` event that says nothing was
 * forwarded, and why. No `model.call` event is written, because no call was made. A hold already
 * kept, expired or closed is left as it is, and so is one past its deadline that the sweep has not
 * marked yet (it is marked here first; see the top of this file). Returns whether the hold was closed.
 */
export async function releaseUnsentHold(pool: pg.Pool, p: { projectId: string; holdId: string; step: string | null; reason: string }): Promise<boolean> {
  return inTransaction(pool, p.projectId, async (c) => {
    // Under the project's lock, before the hold is read: a deadline that passed while this waited counts.
    await expireHoldsIn(c, p.projectId, new Date());
    const r = await c.query<Hold>("select * from holds where id = $1 and project_id = $2 for update", [p.holdId, p.projectId]);
    const hold = r.rows[0];
    if (!hold || hold.state !== "open" || hold.kept_reason !== null || hold.expired || hold.unreconciled) return false;
    const amountUsd = Number(hold.amount_usd);
    await c.query("update holds set state = 'settled', closed_at = now(), actual_usd = 0 where id = $1", [p.holdId]);
    await event(c, p.projectId, "hold.settled", { hold_id: Number(hold.id), amount_usd: amountUsd, actual_usd: 0, returned_usd: amountUsd, forwarded: false, reason: p.reason }, p.step);
    return true;
  });
}

/**
 * Record that a call ended in a way that does not tell the gateway what it cost. The hold is
 * NOT released: it stays open at its full amount. What was seen is recorded for information.
 * (Marking such holds for the owner's list and closing them is packages 1.4 and 1.5.)
 * It neither closes nor releases a hold, so it does not mark deadlines first: a hold it keeps after
 * its deadline stays open at its full amount either way, and is marked expired by the sweep, or by
 * the next admission, settlement or release in its project (review bot on 7ce5a33).
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

async function expireHoldsIn(c: Queryable, projectId: string, now: Date): Promise<Hold[]> {
  const r = await c.query<Hold>(
    `update holds set expired = true, unreconciled = true
      where state = 'open' and not expired and deadline_at <= $1 and project_id = $2
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
  // One project at a time, each under that project's lock, in the same order every budget
  // decision takes its locks (project first, then its holds). A sweep across all projects in
  // one statement could deadlock with a call being admitted.
  const due = await pool.query<{ project_id: string }>(
    "select distinct project_id from holds where state = 'open' and not expired and deadline_at <= $1 order by project_id",
    [now],
  );
  const out: Hold[] = [];
  for (const row of due.rows) {
    out.push(...(await inTransaction(pool, row.project_id, (c) => expireHoldsIn(c, row.project_id, now))));
  }
  return out;
}

/**
 * What a gateway does when it starts: find the holds that are open in the database. They were
 * left by an earlier gateway process (or by one still running beside this one). Each is kept at
 * its full amount and still counts as an open hold; a `hold.found_at_startup` event says so.
 * Holds past their deadline are marked expired by the same rule as at any other time.
 */
export async function recoverHolds(pool: pg.Pool, gateway: string, now: Date = new Date()): Promise<{ found: Hold[]; newlyNoted: number; expired: Hold[] }> {
  const expired = await expireHolds(pool, now);
  const r = await pool.query<Hold>("select * from holds where state = 'open' and gateway <> $1 order by project_id, id", [gateway]);
  let newlyNoted = 0;
  for (const h of r.rows) {
    if (h.seen_at_startup) continue; // noted at an earlier start; it is still open and still counts
    await inTransaction(pool, h.project_id, async (c) => {
      const u = await c.query("update holds set seen_at_startup = true where id = $1 and state = 'open' and not seen_at_startup", [h.id]);
      if (u.rowCount !== 1) return;
      newlyNoted++;
      await event(
        c,
        h.project_id,
        "hold.found_at_startup",
        { hold_id: Number(h.id), amount_usd: Number(h.amount_usd), opened_by: h.gateway, found_by: gateway, kept: true, still_open: true, expired: h.expired },
        h.step,
      );
    });
  }
  return { found: r.rows, newlyNoted, expired };
}

export async function listHolds(pool: pg.Pool, projectId: string): Promise<Hold[]> {
  const r = await pool.query<Hold>("select * from holds where project_id = $1 order by id", [projectId]);
  return r.rows;
}

/*
 * Changing a project's cap (build plan package 1.2b; the owner's answer to question 13, 13 Nov 2026,
 * "a, add the cap change after 1.2"; design note 5.5 and proof rows B20 to B22).
 *
 * `changeCap` is run by Claude Code or an engineer when the owner asks (`builder/scripts/change-cap.ts`).
 * Who asked and who ran it are stated by the caller: nothing here checks them. The change and its
 * `cap.changed` event are written in ONE transaction, under the same lock on the project's row that
 * every admission takes, so a change and a call being let through are judged one after the other.
 *
 * A lowering below what the project has already spent plus its open holds is refused (Claude Code's
 * default, pending the owner's question 14): it would make "recorded spend plus open holds is never
 * above the approved cap" (design note 5.5, the two invariants) untrue. The refusal names the lowest
 * figure allowed at that moment. A refusal of any kind changes nothing and writes nothing.
 */

/** Why a cap change was refused. Each refusal has its own code. */
export type CapChangeRefusalCode =
  | "cap_not_a_number"
  | "cap_below_zero"
  | "cap_too_large"
  | "cap_more_than_4_decimals"
  | `${"asked_by" | "changed_by" | "reason"}_${"missing" | "too_long" | "not_storable"}`
  | "unknown_project"
  | "no_change"
  | "below_spent_plus_open_holds"
  | "stored_figure_differs";

/** A cap change that was refused: nothing was changed and nothing was written. */
export class CapChangeRefused extends Error {
  constructor(
    readonly code: CapChangeRefusalCode,
    message: string,
    /** Only for a lowering below spent plus open holds: the lowest cap allowed at that moment, in dollars, rounded up to 4 decimals. */
    readonly lowestAllowedUsd: number | null = null,
  ) {
    super(message);
    this.name = "CapChangeRefused";
  }
}

export interface CapChange {
  projectId: string;
  oldCapUsd: number;
  newCapUsd: number;
  /** What the project had spent, and held in open holds, at the moment of the change. */
  spentUsd: number;
  openHoldsUsd: number;
  openHolds: number;
  askedBy: string;
  changedBy: string;
  reason: string;
  /** The id of the `cap.changed` event. Events written under the project's lock are numbered in the order the lock was held. */
  eventId: string;
  /** The database's clock (`clock_timestamp()`), read under the project's lock. The event's own `at` is when its transaction began, which can be before the wait for the lock. */
  changedAt: string;
}

const NOTHING_CHANGED = "Nothing was changed and nothing was written.";
/** The longest name or reason accepted, in characters. */
const MAX_TEXT = 500;
/** Half of a surrogate pair: the database's JSON type refuses it, as it refuses a NUL character. */
const LONE_SURROGATE_IN = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/**
 * The new figure must be a number of dollars, 0 or more, below $100,000,000 (the bound `settleHold`
 * uses, and the most the column holds), with at most 4 decimals (what the column keeps: the database
 * would round a fifth decimal silently, and turn 0.00001 into 0).
 */
function checkCapFigure(x: unknown): number {
  if (typeof x !== "number" || !Number.isFinite(x)) {
    throw new CapChangeRefused("cap_not_a_number", `The new cap is not a number of dollars (got ${typeof x === "number" ? String(x) : typeof x}). ${NOTHING_CHANGED}`);
  }
  if (x < 0) throw new CapChangeRefused("cap_below_zero", `The new cap is below $0 (got ${x}). ${NOTHING_CHANGED}`);
  if (x >= 1e8) throw new CapChangeRefused("cap_too_large", `The new cap must be below $100,000,000 (got ${x}). ${NOTHING_CHANGED}`);
  // Measured by a critic of the design: Number.isInteger(x * 1e4) refuses valid figures such as 0.0003; the round trip through toFixed(4) does not.
  if (Number(x.toFixed(4)) !== x) {
    throw new CapChangeRefused("cap_more_than_4_decimals", `The new cap has more than 4 decimal places (got ${x}); the database keeps 4 and would round it. ${NOTHING_CHANGED}`);
  }
  return x;
}

/** Who asked, who ran it and why: text, trimmed, not empty, at most 500 characters, and storable in the event log. */
function checkText(field: "asked_by" | "changed_by" | "reason", value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") throw new CapChangeRefused(`${field}_missing`, `${field} is missing or empty. ${NOTHING_CHANGED}`);
  if ([...text].length > MAX_TEXT) throw new CapChangeRefused(`${field}_too_long`, `${field} is longer than ${MAX_TEXT} characters. ${NOTHING_CHANGED}`);
  if (text.includes("\u0000") || LONE_SURROGATE_IN.test(text)) {
    throw new CapChangeRefused(`${field}_not_storable`, `${field} holds a character the event log cannot store (a NUL character, or half of a surrogate pair). ${NOTHING_CHANGED}`);
  }
  return text;
}

/** The refusal of a lowering below spent plus open holds, naming the lowest figure allowed now. */
function belowCommitted(newCap: number, b: Budget): CapChangeRefused {
  const committed = micro(b.spent) + micro(b.openHolds);
  // Rounded up to the cap's 4 decimals: a cap's step, $0.0001, is 100 millionths of a dollar.
  const lowest = Math.ceil(committed / 100) / 1e4;
  return new CapChangeRefused(
    "below_spent_plus_open_holds",
    `The new cap $${newCap.toFixed(4)} is below what this project has already spent plus its open holds ($${b.spent.toFixed(6)} spent + $${b.openHolds.toFixed(6)} held in ${b.openHoldCount} open hold(s) = $${(committed / 1e6).toFixed(6)}). The lowest cap allowed now is $${lowest.toFixed(4)}. ${NOTHING_CHANGED}`,
    lowest,
  );
}

/**
 * Change a project's cap, with a record. One transaction, under the project's row lock: the cap is
 * updated and a `cap.changed` event is written with the old and new figures, who asked, who ran it,
 * the reason, the time (the database's clock under the lock), and what was spent and held at that
 * moment. Spent and open holds are not touched: holds already open stay as they are, and the next
 * admission is judged against the new cap. Throws `CapChangeRefused`, having changed and written
 * nothing, when the change cannot be made.
 */
export async function changeCap(
  pool: pg.Pool,
  p: { projectId: string; newCapUsd: number; askedBy: string; changedBy: string; reason: string },
): Promise<CapChange> {
  const newCap = checkCapFigure(p.newCapUsd);
  const askedBy = checkText("asked_by", p.askedBy);
  const changedBy = checkText("changed_by", p.changedBy);
  const reason = checkText("reason", p.reason);
  return inTransaction(pool, p.projectId, async (c) => {
    // inTransaction holds the project's row lock from here on; it does not say whether the row exists.
    const found = await c.query("select 1 from projects where id = $1", [p.projectId]);
    if (found.rowCount === 0) throw new CapChangeRefused("unknown_project", `There is no project with the id given. ${NOTHING_CHANGED}`);
    const budget = await readBudget(c, p.projectId);
    if (micro(newCap) === micro(budget.cap)) throw new CapChangeRefused("no_change", `The project's cap is already $${budget.cap.toFixed(4)}. ${NOTHING_CHANGED}`);
    if (micro(newCap) < micro(budget.spent) + micro(budget.openHolds)) throw belowCommitted(newCap, budget);
    const u = await c.query<{ cap_usd: string; changed_at: Date }>(
      "update projects set cap_usd = $2 where id = $1 returning cap_usd, clock_timestamp() as changed_at",
      [p.projectId, newCap],
    );
    const row = u.rows[0]!;
    // Compared here, in JavaScript: in PostgreSQL 'NaN' = 'NaN' is true. On a mismatch the transaction is rolled back.
    if (micro(Number(row.cap_usd)) !== micro(newCap)) {
      throw new CapChangeRefused("stored_figure_differs", `The database stored a different figure ($${row.cap_usd}) from the one given; the change was rolled back. ${NOTHING_CHANGED}`);
    }
    const changedAt = row.changed_at.toISOString();
    const payload = {
      old_cap_usd: budget.cap,
      new_cap_usd: newCap,
      asked_by: askedBy,
      changed_by: changedBy,
      reason,
      changed_at: changedAt,
      spent_usd: budget.spent,
      open_holds_usd: budget.openHolds,
      open_holds: budget.openHoldCount,
    };
    const eventId = await event(c, p.projectId, "cap.changed", payload, null);
    return {
      projectId: p.projectId,
      oldCapUsd: budget.cap,
      newCapUsd: newCap,
      spentUsd: budget.spent,
      openHoldsUsd: budget.openHolds,
      openHolds: budget.openHoldCount,
      askedBy,
      changedBy,
      reason,
      eventId,
      changedAt,
    };
  });
}
