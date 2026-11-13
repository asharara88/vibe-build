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
 *
 * Since package 1.4c (the owner's answer to question 17, 13 Nov 2026: "(a) Yes, freeze"), a freeze has a kind
 * (migration 010). Besides the one above ('unrecorded_ending'), a bill above its hold freezes the project
 * ('bill_above_hold'), written by `freezeAfterOverrunIn` inside the settle's own transaction (holds.ts,
 * `settleHold`), and so does an answer that arrives for a hold already kept or expired whose cost as read is
 * above the hold ('late_answer_above_hold'). After the review of 1.4c (13 Nov 2026), so does a call the gateway
 * keeps (it ended without a bill it could settle) whose usage figures, as read before it ended, already price it
 * above its hold ('kept_above_hold'), written by `keepHold` in the transaction of its `hold.kept`. Every kind is
 * refused the same way by `activeFreezeIn`. A bill above its hold is cleared only by the owner's record of it
 * (reconcile.ts, `recordOverrun`); the other kinds name an open hold, and are cleared by the owner's reconciliation
 * of that hold (`reconcileHold`).
 *
 * Package 1.4b (brought up to date with 1.4c): an operator's set-aside of a journal line that could not be read,
 * naming an open kept hold, freezes that hold's project ('journal_line_set_aside', migration 012), written by
 * gateway/journal-recovery.ts. It has no bill: what the call cost is not known. Its hold is open, so the owner's
 * reconciliation of that hold clears it, as for 'unrecorded_ending'. There can be more than one per hold (one per
 * line set aside, by its `journal_id`), so it is outside the one-per-hold-and-kind index of the kinds above.
 */
import type pg from "pg";
import { event, inTransaction, type Queryable } from "./tx.js";

/** What froze a project (migrations 010 and 011; 'journal_line_set_aside': package 1.4b, migration 012). */
export type FreezeKind = "unrecorded_ending" | "bill_above_hold" | "late_answer_above_hold" | "kept_above_hold" | "journal_line_set_aside";
/** The kinds that carry a bill above the hold's amount, written by `freezeAfterOverrunIn` (packages 1.4c and after its review). */
export type OverrunKind = "bill_above_hold" | "late_answer_above_hold" | "kept_above_hold";

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
  /** Since package 1.4c; every freeze written before it is 'unrecorded_ending'. */
  kind: FreezeKind;
  hold_id: string | null;
  /** The journal line, for 'unrecorded_ending'; "set-aside:" and the set-aside's id, for 'journal_line_set_aside' (package 1.4b); null for the kinds of package 1.4c. */
  journal_id: string | null;
  gateway: string;
  reason: string;
  ended_at: Date;
  hold_amount_usd: string | null;
  /** For the kinds of package 1.4c: the bill, above the hold's amount ('kept_above_hold': the cost as read, a floor under the bill). */
  bill_usd: string | null;
  record: Record<string, unknown>;
  frozen_at: Date;
  cleared_at: Date | null;
}

/** Why a project is frozen, as the freeze's row says it. */
export const FREEZE_REASON = "a model call ended and the gateway could not write its ending to the event log";
/** Package 1.4c: the reasons of its kinds of freeze. */
export const BILL_ABOVE_HOLD_REASON = "a model call was billed more than its hold";
export const LATE_ANSWER_ABOVE_HOLD_REASON = "an answer that arrived after its hold was kept or expired says the call cost more than its hold";
/** After the review of 1.4c: a call kept without a bill the gateway could settle, whose figures as read already put it above its hold. */
export const KEPT_ABOVE_HOLD_REASON = "a model call ended without a bill the gateway could settle, and the usage figures read before it ended already put its cost above its hold";
/**
 * Package 1.4b: why a project is frozen when an operator set aside a journal line that could not be read, naming
 * one of its holds (builder/src/gateway/journal-recovery.ts). Such a freeze is of kind 'journal_line_set_aside'
 * (migration 012); its `journal_id` is "set-aside:" and the set-aside's id, and its `ended_at` is when the line was
 * set aside: when the call ended is not known.
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

/** An amount in dollars to the millionth, as stored: a bill above its hold can differ from it by less than a cent. */
const exact = (m: number): string => (m / 1e6).toFixed(6);
const microOf = (usd: string | null): number => Math.round(Number(usd) * 1e6);

/**
 * The message a frozen project's caller sees (design note 5.5 step 5; wording Claude Code's, recorded in
 * docs/DECISIONS.md). Since package 1.4c it names what froze the project; the new kinds' wording is also
 * Claude Code's, for the owner to confirm (docs/QUESTIONS.md, "Yours to confirm").
 */
export function frozenMessage(f: Freeze, refused: "call" | "step" = "call"): string {
  const now = refused === "call" ? "The gateway forwarded nothing" : "The step was not started";
  if (f.kind === "bill_above_hold" || f.kind === "late_answer_above_hold" || f.kind === "kept_above_hold") {
    const hold = microOf(f.hold_amount_usd);
    const bill = microOf(f.bill_usd);
    const thanHold = `more than its hold of $${exact(hold)} (above it by $${exact(bill - hold)})`;
    const figures = `$${exact(bill)}, ${thanHold}`;
    if (f.kind === "bill_above_hold") {
      return (
        `This project is stopped: a model call that ended at ${f.ended_at.toISOString()} was billed ${figures}. That bill is charged in full. ` +
        `${now}, and no further call will be made for this project until the owner records that bill.`
      );
    }
    if (f.kind === "kept_above_hold") {
      return (
        `This project is stopped: a model call that ended at ${f.ended_at.toISOString()}, without a bill the gateway could settle, had already used at least $${exact(bill)} by the usage figures read before it ended, ${thanHold}. ` +
        `The hold stays counted at its full amount. ${now}, and no further call will be made for this project until the owner records what that call cost.`
      );
    }
    return (
      `This project is stopped: an answer that arrived at ${f.ended_at.toISOString()}, after its call's hold had been kept or had expired, says the call cost ${figures}. ` +
      `The hold stays counted at its full amount. ${now}, and no further call will be made for this project until the owner records what that call cost.`
    );
  }
  const held = f.hold_amount_usd !== null ? ` Its hold of up to $${(Math.ceil(Math.round(Number(f.hold_amount_usd) * 1e6) / 10_000) / 100).toFixed(2)} stays counted against the budget.` : "";
  // Package 1.4b. Read by its kind, and by its reason too: a set-aside freeze written by package 1.4b on a database
  // that had not yet run 1.4c's migration 010 was given the kind 'unrecorded_ending' by it (a freeze is never rewritten).
  if (f.kind === "journal_line_set_aside" || f.reason === SET_ASIDE_FREEZE_REASON) {
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
 * Package 1.4c: freeze the project after a bill above its hold, or after a late answer above it, or (after the
 * review of 1.4c) after a call kept with figures as read above it. Run inside the caller's transaction, under the
 * project's lock: by `settleHold`, in the same transaction that writes the cost and `hold.exceeded` (or, for a late
 * answer, the `hold.kept` that writes it down), and by `keepHold`, in the transaction of its `hold.kept`, so the
 * freeze and what caused it are written together or not at all. Writes the freeze's row and a `project.frozen` event naming the hold, the bill,
 * the hold's amount and the difference. A freeze of the same kind for the same hold already written is returned
 * as it is, and nothing more is written.
 */
export async function freezeAfterOverrunIn(
  c: Queryable,
  p: {
    kind: OverrunKind;
    projectId: string;
    holdId: string;
    holdAmountUsd: number;
    billUsd: number;
    step: string | null;
    gateway: string;
    endedAt: Date;
    record: Record<string, unknown>;
  },
): Promise<Freeze> {
  const reason = p.kind === "bill_above_hold" ? BILL_ABOVE_HOLD_REASON : p.kind === "late_answer_above_hold" ? LATE_ANSWER_ABOVE_HOLD_REASON : KEPT_ABOVE_HOLD_REASON;
  const ins = await c.query<Freeze>(
    `insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, bill_usd, record)
     values ($1, $2, $3, null, $4, $5, $6, $7, $8, $9)
     on conflict (hold_id, kind) where kind not in ('unrecorded_ending', 'journal_line_set_aside') do nothing
     returning *`,
    [p.projectId, p.kind, p.holdId, p.gateway, reason, p.endedAt, p.holdAmountUsd, p.billUsd, JSON.stringify(p.record)],
  );
  const freeze = ins.rows[0];
  if (!freeze) {
    return (await c.query<Freeze>("select * from project_freezes where project_id = $1 and hold_id = $2 and kind = $3", [p.projectId, p.holdId, p.kind])).rows[0]!;
  }
  const hold = microOf(freeze.hold_amount_usd);
  const bill = microOf(freeze.bill_usd);
  await event(
    c,
    p.projectId,
    "project.frozen",
    {
      freeze_id: Number(freeze.id),
      kind: p.kind,
      hold_id: Number(p.holdId),
      hold_amount_usd: hold / 1e6,
      bill_usd: bill / 1e6,
      above_by_usd: (bill - hold) / 1e6,
      ended_at: p.endedAt.toISOString(),
      reason,
    },
    p.step,
  );
  return freeze;
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
        kind: "unrecorded_ending",
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
