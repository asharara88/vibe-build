/**
 * Holds in the database (design note 5.5; build plan package 1.2).
 *
 * The budget equation, checked before every metered call:
 *     spent + open holds + this call's hold <= cap
 * Since package 1.3, "open holds" also counts the room reserved for running steps and not yet drawn
 * (`stepRoom`; step holds are further down this file). A step's own calls draw from its room instead.
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
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { stepBudget, type ProfileLimits, type StepBudget } from "../gateway/hold.js";
import { PRICE_TABLE_DATE } from "../gateway/prices.js";
import { activeFreezeIn, frozenMessage, type Freeze } from "./freezes.js";
import { gatewayLockKeySql } from "./liveness.js";
import { hashToken } from "./projects.js";
import { event, inTransaction, type Queryable } from "./tx.js";

export interface Budget {
  cap: number;
  spent: number;
  /** Call holds that are open. */
  openHolds: number;
  openHoldCount: number;
  /** Room reserved for running steps and not yet drawn by their calls (package 1.3). It counts in the equation beside open holds. */
  stepRoom: number;
  openSteps: number;
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
  /** The step hold this call's hold was drawn from (package 1.3), or null. */
  step_hold_id: string | null;
}

/** Money is compared in millionths of a dollar, as whole numbers, so sums never drift. */
export const micro = (usd: number): number => Math.round(usd * 1e6);

/** What a project has committed, in millionths: spent + open holds + room reserved for running steps. */
export const committedMicro = (b: Budget): number => micro(b.spent) + micro(b.openHolds) + micro(b.stepRoom);

export async function readBudget(q: Queryable, projectId: string): Promise<Budget> {
  const r = await q.query<{ cap_usd: string; spent_usd: string; open_holds_usd: string; open_holds: string; step_room_usd: string; open_steps: string }>(
    "select cap_usd, spent_usd, open_holds_usd, open_holds, step_room_usd, open_steps from project_budget where project_id = $1",
    [projectId],
  );
  const row = r.rows[0];
  if (!row) throw new Error(`Unknown project ${projectId}`);
  return {
    cap: Number(row.cap_usd),
    spent: Number(row.spent_usd),
    openHolds: Number(row.open_holds_usd),
    openHoldCount: Number(row.open_holds),
    stepRoom: Number(row.step_room_usd),
    openSteps: Number(row.open_steps),
  };
}

/** The budget's figures as events carry them. */
const budgetFigures = (b: Budget) => ({ cap_usd: b.cap, spent_usd: b.spent, open_holds_usd: b.openHolds, step_room_usd: b.stepRoom });

export function getBudget(pool: pg.Pool, projectId: string): Promise<Budget> {
  return readBudget(pool, projectId);
}

/** Why a call was not let through by `openHold`. */
export type OpenRefusal =
  /** spent + open holds + room reserved for running steps + this hold > cap */
  | "budget_reached"
  /** A step call: this hold is more than the room left in its step's hold (package 1.3). */
  | "step_budget_used_up"
  /** A step call: its step has ended, though its token was still valid when the call arrived. */
  | "step_closed"
  /** A step call: a model, `max_tokens` or hold outside the limits its step's budget was worked out from. */
  | "step_call_outside_limits"
  /** The project is frozen after a fault (package 1.4): a call's ending could not be recorded. */
  | "project_frozen";

export type OpenResult =
  | { ok: true; hold: Hold; budget: Budget }
  | {
      ok: false;
      budget: Budget;
      reason: OpenRefusal;
      step?: { room: number; budget: number; perTurn: number; model: string; maxTokensCeiling: number; which?: "model" | "max_tokens" | "hold" };
      /** For `project_frozen`: the freeze. */
      freeze?: Freeze;
    };

/**
 * Check the budget equation and, if the hold fits, open it. One transaction, under the
 * project's row lock. When it does not fit, a `gateway.refused` event is written and no hold
 * is opened. `arithmetic` is stored in the event so the amount can be checked by hand.
 *
 * A call made with a step's token (`stepHoldId`, package 1.3) draws its hold from that step's room
 * instead: it is refused if the step has ended (`step_closed`), if its model, `max_tokens` or hold
 * is outside the limits the step's budget was worked out from (`step_call_outside_limits`), or if
 * the hold is more than the room left (`step_budget_used_up`), even when the project's free budget
 * would fit it. Otherwise the room goes down by the hold and the hold opens with the step's id. The
 * project's equation is still checked, with the hold counted once (it was inside the room).
 *
 * A frozen project (package 1.4) is refused first, under the same lock and before the budget is summed,
 * with `project_frozen`: nothing opens, whatever its cap. The check never reads the cap.
 */
export async function openHold(
  pool: pg.Pool,
  p: {
    projectId: string;
    step: string | null;
    amountUsd: number;
    deadline: Date;
    gateway: string;
    arithmetic: Record<string, unknown>;
    path: string;
    /** For a call made with a step's token: its step hold, and the call's model and max_tokens. */
    stepHoldId?: string | null;
    model?: string;
    maxTokens?: number;
  },
): Promise<OpenResult> {
  return inTransaction(pool, p.projectId, async (c) => {
    const freeze = await activeFreezeIn(c, p.projectId);
    if (freeze) {
      const budget = await readBudget(c, p.projectId);
      await event(c, p.projectId, "gateway.refused", { reason: "project_frozen", freeze_id: Number(freeze.id), journal_id: freeze.journal_id, this_hold_usd: p.amountUsd, path: p.path, ...(p.stepHoldId ? { step_hold_id: Number(p.stepHoldId) } : {}) }, p.step);
      return { ok: false as const, budget, reason: "project_frozen" as const, freeze };
    }
    const now = new Date();
    await expireHoldsIn(c, p.projectId, now);
    await closeStepsPastDeadlineIn(c, p.projectId, now);
    const budget = await readBudget(c, p.projectId);
    const refused = async (reason: OpenRefusal, step?: Record<string, unknown>) =>
      event(c, p.projectId, "gateway.refused", { reason, ...budgetFigures(budget), this_hold_usd: p.amountUsd, path: p.path, ...(step ? { step_hold: step } : {}) }, p.step);
    let draw: { id: string; roomBefore: number; roomAfter: number } | null = null;
    if (p.stepHoldId !== undefined && p.stepHoldId !== null) {
      const s = (await c.query<StepHoldRow>("select * from step_holds where id = $1 and project_id = $2 for update", [p.stepHoldId, p.projectId])).rows[0];
      if (!s) throw new Error(`Step hold ${p.stepHoldId} does not exist for project ${p.projectId}`);
      const room = Number(s.room_usd);
      const perTurn = Number(s.per_turn_usd);
      const figures = { room, budget: Number(s.budget_usd), perTurn, model: s.model, maxTokensCeiling: s.max_tokens_ceiling };
      const stepDetail = { step_hold_id: Number(s.id), room_usd: room, budget_usd: Number(s.budget_usd), per_turn_usd: perTurn, model: s.model, max_tokens_ceiling: s.max_tokens_ceiling };
      // Re-checked under the lock: the step may have closed after this call's token was accepted.
      if (s.state !== "open") {
        await refused("step_closed", stepDetail);
        return { ok: false as const, budget, reason: "step_closed" as const, step: figures };
      }
      const which: "model" | "max_tokens" | "hold" | null =
        p.model !== s.model ? "model"
        : typeof p.maxTokens !== "number" || p.maxTokens > s.max_tokens_ceiling ? "max_tokens"
        : micro(p.amountUsd) > micro(perTurn) ? "hold"
        : null;
      if (which !== null) {
        await refused("step_call_outside_limits", { ...stepDetail, which, call_model: p.model ?? null, call_max_tokens: p.maxTokens ?? null });
        return { ok: false as const, budget, reason: "step_call_outside_limits" as const, step: { ...figures, which } };
      }
      if (micro(p.amountUsd) > micro(room)) {
        await refused("step_budget_used_up", stepDetail);
        return { ok: false as const, budget, reason: "step_budget_used_up" as const, step: figures };
      }
      // The hold is inside the room, which the project's figures already count: it is not added twice.
      if (committedMicro(budget) > micro(budget.cap)) {
        await refused("budget_reached", stepDetail);
        return { ok: false as const, budget, reason: "budget_reached" as const, step: figures };
      }
      const after = (micro(room) - micro(p.amountUsd)) / 1e6;
      await c.query("update step_holds set room_usd = $2 where id = $1", [s.id, after]);
      draw = { id: s.id, roomBefore: room, roomAfter: after };
    } else if (committedMicro(budget) + micro(p.amountUsd) > micro(budget.cap)) {
      await refused("budget_reached");
      return { ok: false as const, budget, reason: "budget_reached" as const };
    }
    const r = await c.query<Hold>(
      "insert into holds(project_id, step, amount_usd, deadline_at, gateway, step_hold_id) values ($1, $2, $3, $4, $5, $6) returning *",
      [p.projectId, p.step, p.amountUsd, p.deadline, p.gateway, draw?.id ?? null],
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
        budget_before: budgetFigures(budget),
        ...(draw ? { step_hold: { step_hold_id: Number(draw.id), room_before_usd: draw.roomBefore, room_after_usd: draw.roomAfter } } : {}),
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
    const now = new Date();
    await expireHoldsIn(c, p.projectId, now);
    await closeStepsPastDeadlineIn(c, p.projectId, now);
    const r = await c.query<Hold>("select * from holds where id = $1 and project_id = $2 for update", [p.holdId, p.projectId]);
    const hold = r.rows[0];
    if (!hold) throw new Error(`Hold ${p.holdId} does not exist for project ${p.projectId}`);
    if (hold.state !== "open") throw new Error(`Hold ${p.holdId} is already ${hold.state}`);
    const amountUsd = Number(hold.amount_usd);
    if (!Number.isFinite(p.actualUsd) || p.actualUsd < 0 || p.actualUsd >= 1e8) {
      // A cost that is not a real, non-negative number is not a cost that was read.
      // Kept and marked unreconciled, as every kept hold is since package 1.4 (design note 5.5, steps 2 and 3).
      await c.query("update holds set kept_reason = coalesce(kept_reason, $2), unreconciled = true where id = $1", [p.holdId, "the cost worked out from the answer was not a valid amount"]);
      await event(c, p.projectId, "hold.kept", { hold_id: Number(hold.id), amount_usd: amountUsd, reason: "the cost worked out from the answer was not a valid amount", unreconciled: true, seen: p.call }, p.step);
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
      // Since package 1.4 a hold is also unreconciled when it was kept, or when the gateway that opened it
      // was found gone; the reason says which (review of the 1.4 design, item 4).
      const why = hold.expired ? "answer arrived after the hold expired" : `answer arrived after the hold was marked unreconciled (${hold.kept_reason ?? "no reason recorded"})`;
      await event(c, p.projectId, "hold.kept", { hold_id: Number(hold.id), amount_usd: amountUsd, reason: why, seen: { ...p.call, cost_usd_as_read: p.actualUsd } }, p.step);
      return { settled: false, exceeded: false, amountUsd };
    }
    const exceeded = micro(p.actualUsd) > micro(amountUsd);
    await event(c, p.projectId, "model.call", { ...p.call, cost_usd: p.actualUsd, hold_id: Number(hold.id) }, p.step);
    await c.query("update holds set state = 'settled', closed_at = now(), actual_usd = $2 where id = $1", [p.holdId, p.actualUsd]);
    const step = await returnToStepIn(c, hold, p.actualUsd);
    await event(
      c,
      p.projectId,
      "hold.settled",
      {
        hold_id: Number(hold.id),
        amount_usd: amountUsd,
        actual_usd: p.actualUsd,
        returned_usd: Math.round((amountUsd - p.actualUsd) * 1e6) / 1e6,
        ...(step ? { step_hold: step } : {}),
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
    const now = new Date();
    await expireHoldsIn(c, p.projectId, now);
    await closeStepsPastDeadlineIn(c, p.projectId, now);
    const r = await c.query<Hold>("select * from holds where id = $1 and project_id = $2 for update", [p.holdId, p.projectId]);
    const hold = r.rows[0];
    if (!hold || hold.state !== "open" || hold.kept_reason !== null || hold.expired || hold.unreconciled) return false;
    const amountUsd = Number(hold.amount_usd);
    await c.query("update holds set state = 'settled', closed_at = now(), actual_usd = 0 where id = $1", [p.holdId]);
    const step = await returnToStepIn(c, hold, 0);
    await event(
      c,
      p.projectId,
      "hold.settled",
      { hold_id: Number(hold.id), amount_usd: amountUsd, actual_usd: 0, returned_usd: amountUsd, forwarded: false, reason: p.reason, ...(step ? { step_hold: step } : {}) },
      p.step,
    );
    return true;
  });
}

/**
 * Record that a call ended in a way that does not tell the gateway what it cost. The hold is
 * NOT released: it stays open at its full amount, and is marked unreconciled (design note 5.5, steps 2
 * and 3; since package 1.4, for every reason). What was seen is recorded for information only.
 * (Closing such holds is the owner's recorded action, package 1.5.)
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
    await c.query("update holds set kept_reason = coalesce(kept_reason, $2), unreconciled = true where id = $1", [p.holdId, p.reason]);
    await event(c, p.projectId, "hold.kept", { hold_id: Number(hold.id), amount_usd: Number(hold.amount_usd), reason: p.reason, unreconciled: true, seen: p.seen }, p.step);
  });
}

export async function expireHoldsIn(c: Queryable, projectId: string, now: Date): Promise<Hold[]> {
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
  // The same pass closes step holds past their deadline (package 1.3), project by project in the
  // same way: the room left is released and the step's token revoked; calls' holds stay as they are.
  const due = await pool.query<{ project_id: string }>(
    `select project_id from holds where state = 'open' and not expired and deadline_at <= $1
     union
     select project_id from step_holds where state = 'open' and deadline_at <= $1
     order by project_id`,
    [now],
  );
  const out: Hold[] = [];
  for (const row of due.rows) {
    out.push(
      ...(await inTransaction(pool, row.project_id, async (c) => {
        const expired = await expireHoldsIn(c, row.project_id, now);
        await closeStepsPastDeadlineIn(c, row.project_id, now);
        return expired;
      })),
    );
  }
  return out;
}

/** Why a hold is kept when the gateway that opened it is found gone (package 1.4; proof row B9). */
export const OWNER_GONE = "the gateway that opened it was found gone while the call was in flight, so whether the provider billed it is not known";

/**
 * What a gateway does when it starts: find the holds that are open in the database. They were
 * left by an earlier gateway process (or by one still running beside this one). Each is kept at
 * its full amount and still counts as an open hold; a `hold.found_at_startup` event says so, once.
 * Holds past their deadline are marked expired by the same rule as at any other time.
 *
 * Since package 1.4 (proof row B9): for each open hold not yet unreconciled, the owner's liveness lock is
 * tried (store/liveness.ts). If the owner is gone, the hold is marked unreconciled and kept, in the
 * `hold.found_at_startup` event (`owner_gone: true`) when it is first found, or in a `hold.unreconciled`
 * event when it was found at an earlier start, while its owner was still running. A running owner's holds
 * are left alone. There is no later re-check: a hold whose owner goes after this start is marked at its
 * deadline (step 4), or by the next gateway to start.
 */
export async function recoverHolds(
  pool: pg.Pool,
  gateway: string,
  now: Date = new Date(),
): Promise<{ found: Hold[]; newlyNoted: number; ownerGone: number; expired: Hold[] }> {
  const expired = await expireHolds(pool, now);
  const r = await pool.query<Hold>("select * from holds where state = 'open' and gateway <> $1 order by project_id, id", [gateway]);
  let newlyNoted = 0;
  let ownerGone = 0;
  for (const h of r.rows) {
    if (h.seen_at_startup && h.unreconciled) continue; // noted already, and already unreconciled: it still counts
    await inTransaction(pool, h.project_id, async (c) => {
      const cur = (await c.query<Hold>("select * from holds where id = $1 and project_id = $2 for update", [h.id, h.project_id])).rows[0];
      if (!cur || cur.state !== "open" || (cur.seen_at_startup && cur.unreconciled)) return;
      // The probe takes the owner's lock only for this transaction: if it can, nobody holds it.
      const gone = (await c.query<{ gone: boolean }>(`select pg_try_advisory_xact_lock(${gatewayLockKeySql("$1")}) as gone`, [cur.gateway])).rows[0]!.gone;
      if (gone && !cur.unreconciled) {
        ownerGone++;
        await c.query("update holds set unreconciled = true, kept_reason = coalesce(kept_reason, $2) where id = $1", [cur.id, OWNER_GONE]);
      }
      if (!cur.seen_at_startup) {
        await c.query("update holds set seen_at_startup = true where id = $1", [cur.id]);
        newlyNoted++;
        await event(
          c,
          cur.project_id,
          "hold.found_at_startup",
          {
            hold_id: Number(cur.id),
            amount_usd: Number(cur.amount_usd),
            opened_by: cur.gateway,
            found_by: gateway,
            kept: true,
            still_open: true,
            expired: cur.expired,
            owner_gone: gone,
            unreconciled: cur.unreconciled || gone,
            ...(gone && !cur.unreconciled ? { reason: OWNER_GONE } : {}),
          },
          cur.step,
        );
      } else if (gone) {
        await event(
          c,
          cur.project_id,
          "hold.unreconciled",
          { hold_id: Number(cur.id), amount_usd: Number(cur.amount_usd), opened_by: cur.gateway, found_by: gateway, reason: OWNER_GONE, kept: true, still_open: true },
          cur.step,
        );
      }
    });
  }
  return { found: r.rows, newlyNoted, ownerGone, expired };
}

export async function listHolds(pool: pg.Pool, projectId: string): Promise<Hold[]> {
  const r = await pool.query<Hold>("select * from holds where project_id = $1 order by id", [projectId]);
  return r.rows;
}

/*
 * Step holds (build plan package 1.3; design note 5.5, "The pre-step check"; proof row B7).
 *
 * Before a step starts, `openStepHold` reserves its whole budget (turns x one turn's share, the hold
 * of one call at the step's model, output ceiling and prompt limit; `stepBudget` in gateway/hold.ts)
 * under the project's lock, by the same equation as a call: spent + open holds + room reserved for
 * running steps + this step's budget <= cap. If it does not fit, the step is refused before it starts
 * and a `step.refused` event says why. If it fits, the step gets a token of its own (only its hash is
 * stored): calls made with it draw their holds from the step's room (`openHold`), a settled call
 * returns what it did not cost to the room while the step is open, and `closeStepHold` releases the
 * room left and revokes the token when the step ends. A step past its deadline is closed the same way
 * by the 30-second sweep, or by the next budget decision in its project, whichever comes first.
 *
 * "Room to finish" covers this and no more: the step's turn limit of calls, each on the step's model,
 * with `max_tokens` at most the step's ceiling and a hold at most one turn's share, always fit in the
 * room (a call outside those limits is refused, `step_call_outside_limits`), unless a call costs more
 * than its hold. It does not cover a turn that makes more than one call, a real prompt larger than the
 * step's prompt limit (such a call is refused, so the step stops), or a bill above a hold (known gaps
 * 41, 81, 82). Like every hold, the budget is a reservation from the provider's estimate plus an
 * assumed margin, not a proven ceiling.
 */

export interface StepHoldRow {
  id: string;
  project_id: string;
  step_id: string;
  model: string;
  max_tokens_ceiling: number;
  prompt_tokens: number;
  turns: number;
  per_turn_usd: string;
  budget_usd: string;
  room_usd: string;
  overrun_not_covered_usd: string;
  state: "open" | "closed";
  opened_at: Date;
  deadline_at: Date;
  closed_at: Date | null;
  closed_reason: string | null;
}

/** What a step's hold came to when it closed. budget = released + still held + spent in the step − overrun not covered. */
export interface StepClose {
  stepHoldId: string;
  stepId: string;
  reason: string;
  budgetUsd: number;
  /** The holds its calls drew, and how many calls. */
  drawnUsd: number;
  callsDrawn: number;
  /** The actual cost of its calls that were settled (nothing for a call never sent). */
  spentInStepUsd: number;
  /** Its calls' holds still open (kept, expired, or not yet ended): they stay open as ordinary holds. */
  stillHeldUsd: number;
  stillHeldCalls: number;
  /** The room left, released at the close. */
  releasedUsd: number;
  /** What its calls cost above their own holds and above the room left at that moment. */
  overrunNotCoveredUsd: number;
}

const dollars = (m: number): number => m / 1e6;
/** Shown to the cent, worked in millionths, as the gateway's messages are: up for what is needed, spent and held; down for the cap and what is left. */
const centsUpMicro = (m: number): string => (Math.ceil(m / 10_000) / 100).toFixed(2);
const centsDownMicro = (m: number): string => (Math.floor(m / 10_000) / 100).toFixed(2);

/**
 * A settled call drawn from a step returns to the step's room what it did not cost, while the step is
 * open: room = max(room + hold − cost, 0). What it cost above its hold and the room left is recorded as
 * not covered. A step already closed gets nothing back: its room was released when it closed.
 */
export async function returnToStepIn(c: Queryable, hold: Hold, actualUsd: number): Promise<Record<string, unknown> | null> {
  if (hold.step_hold_id === null) return null;
  const s = (await c.query<StepHoldRow>("select * from step_holds where id = $1 and project_id = $2 for update", [hold.step_hold_id, hold.project_id])).rows[0];
  if (!s || s.state !== "open") return { step_hold_id: Number(hold.step_hold_id), step_open: false, returned_to_room_usd: 0 };
  const before = micro(Number(s.room_usd));
  const raw = before + micro(Number(hold.amount_usd)) - micro(actualUsd);
  const notCovered = raw < 0 ? -raw : 0;
  const after = Math.max(raw, 0);
  await c.query("update step_holds set room_usd = $2, overrun_not_covered_usd = overrun_not_covered_usd + $3 where id = $1", [s.id, dollars(after), dollars(notCovered)]);
  return { step_hold_id: Number(s.id), step_open: true, room_before_usd: dollars(before), room_after_usd: dollars(after), overrun_not_covered_usd: dollars(notCovered) };
}

/** Close one open step hold, under its project's lock: release the room left, revoke its token, and write `step.hold_closed` with the figures. */
async function closeStepIn(c: Queryable, s: StepHoldRow, reason: string): Promise<StepClose> {
  const f = (
    await c.query<{ drawn: string; calls: string; spent: string; still_held: string; still_calls: string }>(
      `select coalesce(sum(amount_usd), 0) as drawn,
              count(*) as calls,
              coalesce(sum(actual_usd) filter (where state = 'settled'), 0) as spent,
              coalesce(sum(amount_usd) filter (where state = 'open'), 0) as still_held,
              count(*) filter (where state = 'open') as still_calls
         from holds where step_hold_id = $1 and project_id = $2`,
      [s.id, s.project_id],
    )
  ).rows[0]!;
  const out: StepClose = {
    stepHoldId: s.id,
    stepId: s.step_id,
    reason,
    budgetUsd: Number(s.budget_usd),
    drawnUsd: Number(f.drawn),
    callsDrawn: Number(f.calls),
    spentInStepUsd: Number(f.spent),
    stillHeldUsd: Number(f.still_held),
    stillHeldCalls: Number(f.still_calls),
    releasedUsd: Number(s.room_usd),
    overrunNotCoveredUsd: Number(s.overrun_not_covered_usd),
  };
  await c.query("update step_holds set state = 'closed', room_usd = 0, closed_at = now(), closed_reason = $2 where id = $1", [s.id, reason]);
  const revoked = await c.query("update project_tokens set revoked_at = now() where step_hold_id = $1 and project_id = $2 and revoked_at is null", [s.id, s.project_id]);
  await event(
    c,
    s.project_id,
    "step.hold_closed",
    {
      step_hold_id: Number(s.id),
      reason,
      budget_usd: out.budgetUsd,
      drawn_usd: out.drawnUsd,
      calls_drawn: out.callsDrawn,
      spent_in_step_usd: out.spentInStepUsd,
      still_held_usd: out.stillHeldUsd,
      still_held_calls: out.stillHeldCalls,
      released_usd: out.releasedUsd,
      overrun_not_covered_usd: out.overrunNotCoveredUsd,
      tokens_revoked: revoked.rowCount ?? 0,
    },
    s.step_id,
  );
  return out;
}

/** Close the project's open step holds past their deadline, as the sweep does. Run under the project's lock by every decision that touches a step's room. */
export async function closeStepsPastDeadlineIn(c: Queryable, projectId: string, now: Date): Promise<StepClose[]> {
  const due = await c.query<StepHoldRow>("select * from step_holds where project_id = $1 and state = 'open' and deadline_at <= $2 order by id for update", [projectId, now]);
  const out: StepClose[] = [];
  for (const s of due.rows) out.push(await closeStepIn(c, s, "deadline_passed"));
  return out;
}

/** The message a refused step shows (design note 5.5, "What the user sees", as changed for a step on 13 Nov 2026). */
export function stepRefusalMessage(b: Budget, sb: Pick<StepBudget, "budgetMicro" | "turns">): string {
  const committed = committedMicro(b);
  const left = Math.max(micro(b.cap) - committed, 0);
  const reserved = micro(b.stepRoom) > 0 ? `, and $${centsUpMicro(micro(b.stepRoom))} reserved for ${b.openSteps} other running step(s)` : "";
  return (
    `This step needs up to $${centsUpMicro(sb.budgetMicro)} to finish (${sb.turns} turns); this project has $${centsDownMicro(left)} left of its budget of $${centsDownMicro(micro(b.cap))} ` +
    `(spent $${centsUpMicro(micro(b.spent))}, with $${centsUpMicro(micro(b.openHolds))} held for work in progress or awaiting reconciliation${reserved}). ` +
    `The step was not started. A cap of at least $${centsUpMicro(committed + sb.budgetMicro)} would let it start now.`
  );
}

export type StepOpenResult =
  | { ok: true; stepHold: StepHoldRow; token: string; budget: Budget; stepBudget: StepBudget }
  | { ok: false; budget: Budget; stepBudget: StepBudget; message: string; eventId: string; reason: "budget_reached" | "project_frozen" };

/**
 * The pre-step check (design note 5.5; package 1.3). Works out the step's budget first (`stepBudget`,
 * which throws `StepBudgetInvalid`, having touched nothing, for turns that are not a whole number from 1
 * to 1,000 or a budget that is not a finite amount above 0). Then, in one transaction under the
 * project's lock: closes steps and marks holds past their deadline, reads the budget, and either
 * refuses the step (spent + open holds + room reserved for running steps + this step's budget > cap),
 * writing one `step.refused` event and nothing else, or opens its hold with all of its budget as room,
 * issues the step's token (returned once; only its hash is stored) and writes `step.hold_opened`.
 */
export async function openStepHold(
  pool: pg.Pool,
  p: { projectId: string; stepId: string; model: string; maxTurns: number; profile: ProfileLimits; deadline: Date; priceTableDate?: string },
): Promise<StepOpenResult> {
  const sb = stepBudget({ model: p.model, maxTurns: p.maxTurns, profile: p.profile, priceTableDate: p.priceTableDate ?? PRICE_TABLE_DATE });
  if (typeof p.stepId !== "string" || p.stepId.trim() === "" || p.stepId.length > 200 || p.stepId.includes("\u0000")) {
    throw new Error("A step's id must be text of 1 to 200 characters, with no NUL character. The step was not started.");
  }
  if (!(p.deadline instanceof Date) || Number.isNaN(p.deadline.getTime())) throw new Error("A step's deadline must be a valid time. The step was not started.");
  return inTransaction(pool, p.projectId, async (c) => {
    // A frozen project starts no step (package 1.4), whatever its cap: refused first, under the lock.
    const freeze = await activeFreezeIn(c, p.projectId);
    if (freeze) {
      const budget = await readBudget(c, p.projectId);
      const message = frozenMessage(freeze, "step");
      const eventId = await event(c, p.projectId, "step.refused", { reason: "project_frozen", freeze_id: Number(freeze.id), journal_id: freeze.journal_id, step_budget_usd: sb.budgetUsd, message }, p.stepId);
      return { ok: false as const, budget, stepBudget: sb, message, eventId, reason: "project_frozen" as const };
    }
    const now = new Date();
    await expireHoldsIn(c, p.projectId, now);
    await closeStepsPastDeadlineIn(c, p.projectId, now);
    const budget = await readBudget(c, p.projectId);
    const figures = {
      step_budget_usd: sb.budgetUsd,
      turns: sb.turns,
      per_turn_usd: sb.perTurnUsd,
      model: sb.model,
      max_tokens_ceiling: sb.maxTokensCeiling,
      prompt_tokens: sb.promptTokens,
    };
    if (committedMicro(budget) + sb.budgetMicro > micro(budget.cap)) {
      const message = stepRefusalMessage(budget, sb);
      const lowest = Math.ceil((committedMicro(budget) + sb.budgetMicro) / 10_000) / 100;
      const eventId = await event(c, p.projectId, "step.refused", { reason: "budget_reached", ...budgetFigures(budget), ...figures, lowest_cap_usd: lowest, message, per_turn: sb.perTurn }, p.stepId);
      return { ok: false as const, budget, stepBudget: sb, message, eventId, reason: "budget_reached" as const };
    }
    const s = (
      await c.query<StepHoldRow>(
        `insert into step_holds(project_id, step_id, model, max_tokens_ceiling, prompt_tokens, turns, per_turn_usd, budget_usd, room_usd, deadline_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9) returning *`,
        [p.projectId, p.stepId, sb.model, sb.maxTokensCeiling, sb.promptTokens, sb.turns, sb.perTurnUsd, sb.budgetUsd, p.deadline],
      )
    ).rows[0]!;
    const token = `bpt_${p.projectId}_${randomBytes(18).toString("base64url")}`;
    await c.query("insert into project_tokens(token_hash, project_id, label, step_hold_id) values ($1, $2, 'step', $3)", [hashToken(token), p.projectId, s.id]);
    await event(
      c,
      p.projectId,
      "step.hold_opened",
      { step_hold_id: Number(s.id), ...figures, deadline_at: p.deadline.toISOString(), budget_before: budgetFigures(budget), per_turn: sb.perTurn },
      p.stepId,
    );
    return { ok: true as const, stepHold: s, token, budget, stepBudget: sb };
  });
}

/**
 * End a step's hold: under the project's lock, release the room left, revoke the step's token, and
 * write `step.hold_closed` with what the step drew, spent, still holds and released. Its calls' holds
 * that are still open stay open as ordinary holds, at their full amounts. A step already closed (by
 * the sweep, by its deadline, or by an earlier close) is left as it is: nothing is written and nothing
 * is thrown (review of the 1.3 design, item 4).
 */
export async function closeStepHold(
  pool: pg.Pool,
  p: { projectId: string; stepHoldId: string; reason: string },
): Promise<{ closed: true; figures: StepClose } | { closed: false; closedReason: string | null }> {
  return inTransaction(pool, p.projectId, async (c) => {
    const now = new Date();
    await expireHoldsIn(c, p.projectId, now);
    await closeStepsPastDeadlineIn(c, p.projectId, now);
    const s = (await c.query<StepHoldRow>("select * from step_holds where id = $1 and project_id = $2 for update", [p.stepHoldId, p.projectId])).rows[0];
    if (!s) throw new Error(`Step hold ${p.stepHoldId} does not exist for project ${p.projectId}`);
    if (s.state !== "open") return { closed: false as const, closedReason: s.closed_reason };
    return { closed: true as const, figures: await closeStepIn(c, s, p.reason) };
  });
}

export async function listStepHolds(pool: pg.Pool, projectId: string): Promise<StepHoldRow[]> {
  return (await pool.query<StepHoldRow>("select * from step_holds where project_id = $1 order by id", [projectId])).rows;
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
  /** Room reserved for running steps at that moment, and how many (package 1.3). A lowering below spent + open holds + this room is refused. */
  stepRoomUsd: number;
  openSteps: number;
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
export const LONE_SURROGATE_IN = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

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

/**
 * The refusal of a lowering below spent plus open holds, naming the lowest figure allowed now. Since
 * package 1.3 "open holds" here includes the room reserved for running steps, shown as its own figure.
 */
function belowCommitted(newCap: number, b: Budget): CapChangeRefused {
  const committed = committedMicro(b);
  // Rounded up to the cap's 4 decimals: a cap's step, $0.0001, is 100 millionths of a dollar.
  const lowest = Math.ceil(committed / 100) / 1e4;
  const reserved = b.openSteps > 0 || micro(b.stepRoom) > 0 ? ` and $${b.stepRoom.toFixed(6)} reserved for ${b.openSteps} running step(s)` : "";
  return new CapChangeRefused(
    "below_spent_plus_open_holds",
    `The new cap $${newCap.toFixed(4)} is below what this project has already spent plus its open holds ($${b.spent.toFixed(6)} spent + $${b.openHolds.toFixed(6)} held in ${b.openHoldCount} open hold(s)${reserved} = $${(committed / 1e6).toFixed(6)}). The lowest cap allowed now is $${lowest.toFixed(4)}. ${NOTHING_CHANGED}`,
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
    // Steps past their deadline are closed first, as by every other budget decision (package 1.3). A
    // refusal below rolls this back with everything else; the sweep then closes them.
    await closeStepsPastDeadlineIn(c, p.projectId, new Date());
    const budget = await readBudget(c, p.projectId);
    if (micro(newCap) === micro(budget.cap)) throw new CapChangeRefused("no_change", `The project's cap is already $${budget.cap.toFixed(4)}. ${NOTHING_CHANGED}`);
    if (micro(newCap) < committedMicro(budget)) throw belowCommitted(newCap, budget);
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
      step_room_usd: budget.stepRoom,
      open_steps: budget.openSteps,
    };
    const eventId = await event(c, p.projectId, "cap.changed", payload, null);
    return {
      projectId: p.projectId,
      oldCapUsd: budget.cap,
      newCapUsd: newCap,
      spentUsd: budget.spent,
      openHoldsUsd: budget.openHolds,
      openHolds: budget.openHoldCount,
      stepRoomUsd: budget.stepRoom,
      openSteps: budget.openSteps,
      askedBy,
      changedBy,
      reason,
      eventId,
      changedAt,
    };
  });
}
