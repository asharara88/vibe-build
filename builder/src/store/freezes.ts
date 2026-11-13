/**
 * The stop after a fault (build plan package 1.4; design note 5.5 step 5, amendment e; proof row B10).
 *
 * When the gateway cannot write a model call's ending (the settle or the keep fails after the call was
 * forwarded), it keeps an `UnrecordedEnding` in a journal file of its own (gateway/journal.ts) and, once
 * the database takes writes, records it here with `recordFreeze`: in ONE transaction under the project's
 * lock, a `project_freezes` row, the hold kept open at its full amount and marked unreconciled
 * (`hold.kept`), a `gateway.fault` event and a `project.frozen` event. From then on the project is
 * frozen: `openHold` and `openStepHold` refuse it under the same lock (`activeFreezeIn`), and the gateway
 * refuses it before the counting call. Nothing here reads the cap, so a cap change does not reopen it.
 * Only the owner's recorded action clears it (package 1.5).
 *
 * Writing the same journal line twice adds nothing (`journal_id` is unique; the insert is `on conflict do
 * nothing`, and the events are written only when the row was inserted), so a replay after a crash is safe.
 * A write reported as failed may in fact have committed: the hold is read under the lock, and a hold found
 * settled is left settled; the project is still frozen, and the event says the hold was found settled.
 */
import type pg from "pg";
import { event, inTransaction, type Queryable } from "./tx.js";

/** One call whose ending the gateway could not write: what the journal keeps, one per line. */
export interface UnrecordedEnding {
  journal_id: string;
  gateway: string;
  project_id: string;
  hold_id: string;
  step: string | null;
  /** When the call ended, by the gateway's clock (ISO time). */
  ended_at: string;
  /** Which write failed: the settle (the usage was read) or the keep (it was not). */
  ending: "settle" | "keep";
  /** For a keep: why the hold was being kept. */
  kept_reason: string | null;
  /** For a settle: the cost the gateway worked out from the answer. */
  cost_usd_as_read: number | null;
  /** The call's record as the gateway would have stored it (already cleaned of the model key). */
  call: Record<string, unknown>;
  /** A fixed summary of the database error: its name and code, never its text. */
  error: { name: string; code?: string };
}

export interface Freeze {
  id: string;
  project_id: string;
  hold_id: string | null;
  journal_id: string;
  gateway: string;
  reason: string;
  ended_at: Date;
  hold_amount_usd: string | null;
  record: Record<string, unknown>;
  frozen_at: Date;
  cleared_at: Date | null;
}

/** Why a project is frozen, as the freeze's row says it. */
export const FREEZE_REASON = "a model call ended and the gateway could not write its ending to the event log";
/**
 * Package 1.4b: why a project is frozen when an operator set aside a journal line that could not be read, naming
 * one of its holds (builder/src/gateway/journal-recovery.ts). Such a freeze's `journal_id` starts with "set-aside:",
 * and its `ended_at` is when the line was set aside: when the call ended is not known.
 */
export const SET_ASIDE_FREEZE_REASON =
  "a line of the gateway's journal could not be read; an operator set it aside naming this project's hold, so the call it may record, and what that call cost, are not known";
const FAULT_MESSAGE = "A model call ended and its ending could not be written to the event log. Its hold stays open at its full amount; the project is frozen until the owner records what the call cost.";

/** The project's freeze that has not been cleared, if any. Run under the project's lock by every budget decision that opens anything. */
export async function activeFreezeIn(q: Queryable, projectId: string): Promise<Freeze | null> {
  const r = await q.query<Freeze>("select * from project_freezes where project_id = $1 and cleared_at is null order by id limit 1", [projectId]);
  return r.rows[0] ?? null;
}

export function activeFreeze(pool: pg.Pool, projectId: string): Promise<Freeze | null> {
  return activeFreezeIn(pool, projectId);
}

export async function listFreezes(pool: pg.Pool, projectId: string): Promise<Freeze[]> {
  return (await pool.query<Freeze>("select * from project_freezes where project_id = $1 order by id", [projectId])).rows;
}

/** The message a frozen project's caller sees (design note 5.5 step 5; wording Claude Code's, recorded in docs/DECISIONS.md). */
export function frozenMessage(f: Freeze, refused: "call" | "step" = "call"): string {
  const held = f.hold_amount_usd !== null ? ` Its hold of up to $${(Math.ceil(Math.round(Number(f.hold_amount_usd) * 1e6) / 10_000) / 100).toFixed(2)} stays counted against the budget.` : "";
  const now = refused === "call" ? "The gateway forwarded nothing" : "The step was not started";
  if (f.reason === SET_ASIDE_FREEZE_REASON) {
    return (
      `This project is stopped: a line of the gateway's journal that could not be read was set aside at ${f.frozen_at.toISOString()} as possibly the record of a call on its hold ${f.hold_id ?? "(none)"}, so what that call cost is not known.${held} ` +
      `${now}, and no further call will be made for this project until the owner records what that call cost.`
    );
  }
  return (
    `This project is stopped: a model call that ended at ${f.ended_at.toISOString()} could not be recorded, so what it cost is not known.${held} ` +
    `${now}, and no further call will be made for this project until the owner records what that call cost.`
  );
}

/**
 * Record one unrecorded ending: freeze the project, keep the hold open at its full amount and mark it
 * unreconciled, and write the fault. One transaction under the project's lock. Returns whether anything
 * was written (false when this journal line was already recorded).
 */
export async function recordFreeze(pool: pg.Pool, rec: UnrecordedEnding): Promise<{ written: boolean; freeze: Freeze | null }> {
  return inTransaction(pool, rec.project_id, async (c) => {
    const hold = (await c.query<{ id: string; amount_usd: string; state: string }>("select id, amount_usd, state from holds where id = $1 and project_id = $2 for update", [rec.hold_id, rec.project_id])).rows[0];
    const ins = await c.query<Freeze>(
      `insert into project_freezes(project_id, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, record)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (journal_id) do nothing
       returning *`,
      [rec.project_id, hold ? hold.id : null, rec.journal_id, rec.gateway, FREEZE_REASON, rec.ended_at, hold ? hold.amount_usd : null, JSON.stringify(rec)],
    );
    const freeze = ins.rows[0];
    if (!freeze) return { written: false, freeze: null };
    const amount = hold ? Number(hold.amount_usd) : null;
    const why = rec.ending === "settle" ? "the call's settlement could not be written to the event log" : `the call's ending could not be written to the event log (it was to be kept: ${rec.kept_reason ?? "no reason given"})`;
    if (hold && hold.state === "open") {
      await c.query("update holds set unreconciled = true, kept_reason = coalesce(kept_reason, $2) where id = $1", [hold.id, why]);
      await event(
        c,
        rec.project_id,
        "hold.kept",
        { hold_id: Number(hold.id), amount_usd: amount, reason: why, unreconciled: true, frozen: true, seen: { ...rec.call, cost_usd_as_read: rec.cost_usd_as_read }, journal_id: rec.journal_id },
        rec.step,
      );
    }
    await event(c, rec.project_id, "gateway.fault", { message: FAULT_MESSAGE, journal_id: rec.journal_id, gateway: rec.gateway, hold_id: Number(rec.hold_id), error: rec.error }, rec.step);
    await event(
      c,
      rec.project_id,
      "project.frozen",
      {
        freeze_id: Number(freeze.id),
        journal_id: rec.journal_id,
        hold_id: Number(rec.hold_id),
        hold_state: hold ? hold.state : "not found",
        hold_amount_usd: amount,
        ended_at: rec.ended_at,
        reason: FREEZE_REASON,
      },
      rec.step,
    );
    return { written: true, freeze };
  });
}
