/**
 * The unreconciled list and the owner's reconciliation (build plan package 1.5; design note 5.5, steps 2 to 5;
 * proof row B14; the owner's answer to question 5 (a), 13 Nov 2026: an expired hold is kept open at its full
 * amount until the owner reconciles it).
 *
 * A hold kept at its full amount stays open and counts in the budget equation until the owner records what the
 * call actually cost and the evidence for it, such as the provider's usage record. `listUnreconciled` lists
 * every such hold with what is known of it. `reconcileHold` records the owner's action: in ONE transaction under
 * the project's lock, a `model.call` event with the stated actual cost (so the budget view counts it as spent,
 * as it counts a settled call), the hold closed at that cost, a `hold.reconciled` event with the evidence, who
 * asked, who recorded it and why, and, where the hold froze its project (package 1.4), the freeze cleared
 * (`project.freeze_cleared`). The actual cost is then what is charged, above the hold too (a `hold.exceeded`
 * event says so, as for a settled call; known gap 41).
 *
 * Who asked and who recorded it are written as the caller states them: nothing here checks them, and nothing
 * here checks the evidence against the provider (known gap 99). A refusal changes nothing and writes nothing.
 *
 * Package 1.4c (the owner's answer to question 17, 13 Nov 2026): a call the gateway settles above its hold freezes
 * its project (holds.ts, `settleHold`). Its hold is closed, so `reconcileHold` cannot clear that freeze;
 * `recordOverrun` is the owner's recorded action that does, and the list shows such freezes with the bill, the hold
 * and the difference (`overrunFreezes`). A late answer above its hold freezes the project too; that hold is still
 * open, so its reconciliation clears it. A reconciliation above the hold does not freeze the project: it is the
 * owner's own recorded action (Claude Code's decision, docs/DECISIONS.md, 13 Nov 2026).
 */
import type pg from "pg";
import { activeFreezeIn, type Freeze, type FreezeKind } from "./freezes.js";
import { closeStepsPastDeadlineIn, expireHoldsIn, LONE_SURROGATE_IN, micro, OWNER_GONE, readBudget, returnToStepIn, type Budget, type Hold } from "./holds.js";
import { event, inTransaction, type Queryable } from "./tx.js";

/**
 * The kinds a kept hold is listed under. A hold can be of more than one kind (an interrupted call whose
 * deadline then passed is "interrupted" and "expired"). The kind of a kept hold is read from the reason the
 * gateway wrote; a reason this table does not know is listed as "kept for another reason", with the reason shown.
 */
export type HoldKind =
  /** Its deadline passed while it was open: kept at its full amount (design note 5.5 step 4; question 5 (a)). */
  | "expired"
  /** The provider answered with an error that is not its own rejection before any work (proof row B19). */
  | "error answer"
  /** The call was cut part-way, or got no answer: the provider may have billed it (amendment a; B11). */
  | "interrupted"
  /** An answer whose cost could not be read or priced (amendment d; B12). */
  | "unreadable answer"
  /** The gateway that opened it was found gone while the call was in flight (B9). */
  | "gateway gone"
  /** Its ending could not be written to the event log, which froze its project (amendment e; B10). */
  | "froze its project"
  /** An answer arrived after it was kept or expired: written down, not settled. */
  | "late answer written down"
  /** Such an answer's cost as read is above the hold, which froze its project (package 1.4c). */
  | "late answer above its hold"
  | "kept for another reason";

const ERROR_ANSWER = new Set([
  "the provider answered with a server error",
  "an error answer that is not one of the provider's own rejections before work",
  "the provider reported an error inside the stream",
]);
const INTERRUPTED = new Set([
  "the caller disconnected before the answer arrived",
  "the call reached its time limit",
  "the client disconnected part-way",
  "the client cancelled part-way",
  "the provider's stream failed part-way",
  "the provider's answer broke off part-way",
  "the stream ended without the provider's end-of-message marker, so its figures may be partial",
  "the connection failed after the request was sent, or may have been sent; the provider may have billed it",
]);
const UNREADABLE = new Set(["the answer was larger than the gateway reads", "the answer came from a model that has no price in the gateway's table", "the cost worked out from the answer was not a valid amount"]);
const UNREADABLE_START = ["the stream ended without usage figures that could be read", "the answer succeeded but its usage could not be read"];
/** The reasons recordFreeze (freezes.ts) writes: the freeze itself says so. */
const FREEZE_START = ["the call's settlement could not be written to the event log", "the call's ending could not be written to the event log"];

/** Every kept reason this table knows, for the test that checks each is still written by the gateway or the store. */
export const KNOWN_KEPT_REASONS = { errorAnswer: [...ERROR_ANSWER], interrupted: [...INTERRUPTED], unreadable: [...UNREADABLE], unreadableStart: UNREADABLE_START, freezeStart: FREEZE_START };

function reasonKind(reason: string): HoldKind | null {
  if (reason === OWNER_GONE) return "gateway gone";
  if (ERROR_ANSWER.has(reason)) return "error answer";
  if (INTERRUPTED.has(reason)) return "interrupted";
  if (UNREADABLE.has(reason) || UNREADABLE_START.some((s) => reason.startsWith(s))) return "unreadable answer";
  if (FREEZE_START.some((s) => reason.startsWith(s))) return null; // listed as "froze its project", from the freeze's own row
  return "kept for another reason";
}

/** One hold kept at its full amount, with what is known of it. Money in dollars as stored. */
export interface UnreconciledHold {
  holdId: string;
  projectId: string;
  step: string | null;
  stepHoldId: string | null;
  /** The amount held: counted at its full amount in the budget equation until it is reconciled. */
  amountUsd: number;
  openedAt: string;
  deadlineAt: string;
  /** The gateway process that opened it. */
  openedBy: string;
  kinds: HoldKind[];
  /** Why it was kept, as the gateway or the store wrote it; null for a hold only expired. */
  keptReason: string | null;
  /** Marked expired (by the sweep, or by a budget decision in its project). */
  expired: boolean;
  /** Past its deadline by the clock given, marked or not yet. */
  pastDeadline: boolean;
  unreconciled: boolean;
  foundAtStartup: boolean;
  /** The model asked for, from `hold.opened`. */
  model: string | null;
  /** What the gateway saw when it kept the hold (the first `hold.kept` that is not a late answer), for information only. */
  seen: { status: unknown; servedModel: unknown; usage: unknown; error: unknown } | null;
  /** Answers that arrived after it was kept or expired, written down and not settled. */
  lateAnswers: { eventId: string; at: string; costUsdAsRead: number | null; reason: string }[];
  /** The freezes this hold caused (package 1.4; since 1.4c, also a late answer above it), each with its kind. */
  freezes: { freezeId: string; kind: FreezeKind; journalId: string | null; endedAt: string; frozenAt: string; cleared: boolean; costUsdAsRead: number | null }[];
}

/**
 * A freeze not cleared whose hold is not open (or was not found): reconciling cannot clear it (known gap 100).
 * A freeze after a bill above its hold is not one of these: its hold was settled by design, and it is listed with
 * `overrunFreezes` (package 1.4c).
 */
export interface FreezeWithNoOpenHold {
  freezeId: string;
  projectId: string;
  holdId: string | null;
  holdState: string | null;
  journalId: string | null;
  endedAt: string;
}

/** A freeze after a bill above its hold, not yet cleared (package 1.4c): cleared by the owner's record of the bill (`recordOverrun`). */
export interface OverrunFreeze {
  freezeId: string;
  projectId: string;
  holdId: string;
  step: string | null;
  /** What the hold held, what the call was billed (charged in full when it was settled) and the difference. */
  heldUsd: number;
  billUsd: number;
  aboveByUsd: number;
  /** When the call ended, by the gateway's clock, and when the project was frozen. */
  endedAt: string;
  frozenAt: string;
  gateway: string;
  model: string | null;
}

export interface UnreconciledList {
  /** The clock the list was judged by. */
  asOf: string;
  holds: UnreconciledHold[];
  freezesWithNoOpenHold: FreezeWithNoOpenHold[];
  /** Package 1.4c: projects frozen after a bill above its hold, each until the owner records that bill. */
  overrunFreezes: OverrunFreeze[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** What is known of each hold, read in one go: its `hold.opened` and `hold.kept` events and its freezes. */
async function describe(q: Queryable, rows: Hold[], now: Date): Promise<UnreconciledHold[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((h) => String(h.id));
  const projects = [...new Set(rows.map((h) => h.project_id))];
  const evs = (
    await q.query<{ id: string; at: Date; kind: string; payload: Record<string, unknown> }>(
      `select id, at, kind, payload from events
        where project_id = any($1::text[]) and kind in ('hold.opened', 'hold.kept')
          and jsonb_typeof(payload->'hold_id') = 'number' and (payload->>'hold_id') = any($2::text[])
        order by id`,
      [projects, ids],
    )
  ).rows;
  const fz = (await q.query<Freeze>("select * from project_freezes where hold_id = any($1::bigint[]) order by id", [ids])).rows;
  return rows.map((h) => {
    const mine = evs.filter((e) => String(e.payload["hold_id"]) === String(h.id));
    const opened = mine.find((e) => e.kind === "hold.opened");
    const kept = mine.filter((e) => e.kind === "hold.kept");
    // A late answer: settleHold wrote what the answer said it cost, and kept the hold (holds.ts). The keep a
    // freeze writes also carries a cost as read; it is listed with the freeze instead.
    const isLate = (e: (typeof kept)[number]) => e.payload["frozen"] !== true && obj(e.payload["seen"]) !== null && "cost_usd_as_read" in obj(e.payload["seen"])!;
    const late = kept.filter(isLate);
    const firstKeep = kept.find((e) => !isLate(e) && e.payload["frozen"] !== true) ?? kept.find((e) => !isLate(e));
    const seen = obj(firstKeep?.payload["seen"]);
    const freezes = fz.filter((f) => String(f.hold_id) === String(h.id));
    const kinds: HoldKind[] = [];
    const add = (k: HoldKind | null) => {
      if (k && !kinds.includes(k)) kinds.push(k);
    };
    if (freezes.some((f) => f.kind === "unrecorded_ending")) add("froze its project");
    if (freezes.some((f) => f.kind === "late_answer_above_hold")) add("late answer above its hold");
    if (h.kept_reason !== null) add(reasonKind(h.kept_reason));
    if (h.expired || h.deadline_at.getTime() <= now.getTime()) add("expired");
    if (late.length > 0) add("late answer written down");
    if (kinds.length === 0) add("kept for another reason"); // unreconciled with no reason: should not happen, and is listed all the same
    const arithmetic = obj(opened?.payload["arithmetic"]);
    return {
      holdId: String(h.id),
      projectId: h.project_id,
      step: h.step,
      stepHoldId: h.step_hold_id === null ? null : String(h.step_hold_id),
      amountUsd: Number(h.amount_usd),
      openedAt: h.opened_at.toISOString(),
      deadlineAt: h.deadline_at.toISOString(),
      openedBy: h.gateway,
      kinds,
      keptReason: h.kept_reason,
      expired: h.expired,
      pastDeadline: h.deadline_at.getTime() <= now.getTime(),
      unreconciled: h.unreconciled,
      foundAtStartup: h.seen_at_startup,
      model: typeof arithmetic?.["model"] === "string" ? (arithmetic["model"] as string) : null,
      seen: seen ? { status: seen["status"] ?? null, servedModel: seen["served_model"] ?? null, usage: seen["usage"] ?? null, error: seen["error"] ?? null } : null,
      lateAnswers: late.map((e) => ({ eventId: String(e.id), at: e.at.toISOString(), costUsdAsRead: num(obj(e.payload["seen"])!["cost_usd_as_read"]), reason: String(e.payload["reason"] ?? "") })),
      freezes: freezes.map((f) => ({
        freezeId: String(f.id),
        kind: f.kind,
        journalId: f.journal_id,
        endedAt: f.ended_at.toISOString(),
        frozenAt: f.frozen_at.toISOString(),
        cleared: f.cleared_at !== null,
        costUsdAsRead: num(obj(f.record)?.["cost_usd_as_read"]),
      })),
    };
  });
}

/** Which open holds are kept at their full amount: kept, marked unreconciled or expired, or past their deadline. */
const KEPT_SQL = "state = 'open' and (unreconciled or expired or kept_reason is not null or deadline_at <= $1)";

/**
 * Every hold kept at its full amount, in one project or in all, with what is known of each, and every freeze
 * not cleared whose hold is not open. It only reads. A hold past its deadline is listed as expired by the clock
 * given (the gateway's clock, as for every deadline), whether or not the sweep has marked it yet.
 */
export async function listUnreconciled(pool: pg.Pool, o: { projectId?: string; now?: Date } = {}): Promise<UnreconciledList> {
  const now = o.now ?? new Date();
  const rows = (
    await pool.query<Hold>(`select * from holds where ${KEPT_SQL} and ($2::text is null or project_id = $2) order by project_id, id`, [now, o.projectId ?? null])
  ).rows;
  const others = (
    await pool.query<Freeze & { hold_state: string | null }>(
      `select f.*, h.state as hold_state from project_freezes f left join holds h on h.id = f.hold_id
        where f.cleared_at is null and f.kind <> 'bill_above_hold' and (h.id is null or h.state <> 'open') and ($1::text is null or f.project_id = $1)
        order by f.project_id, f.id`,
      [o.projectId ?? null],
    )
  ).rows;
  // Package 1.4c: freezes after a bill above its hold, with the bill, the hold and the difference.
  const overruns = (
    await pool.query<Freeze & { step: string | null }>(
      `select f.*, h.step from project_freezes f join holds h on h.id = f.hold_id
        where f.cleared_at is null and f.kind = 'bill_above_hold' and ($1::text is null or f.project_id = $1)
        order by f.project_id, f.id`,
      [o.projectId ?? null],
    )
  ).rows;
  return {
    asOf: now.toISOString(),
    holds: await describe(pool, rows, now),
    freezesWithNoOpenHold: others.map((f) => ({ freezeId: String(f.id), projectId: f.project_id, holdId: f.hold_id === null ? null : String(f.hold_id), holdState: f.hold_state, journalId: f.journal_id, endedAt: f.ended_at.toISOString() })),
    overrunFreezes: overruns.map(overrunOf),
  };
}

/** One freeze after a bill above its hold, as listed and as recorded (package 1.4c). Figures worked in millionths. */
function overrunOf(f: Freeze & { step: string | null }): OverrunFreeze {
  const held = micro(Number(f.hold_amount_usd));
  const bill = micro(Number(f.bill_usd));
  const model = obj(f.record)?.["model"];
  return {
    freezeId: String(f.id),
    projectId: f.project_id,
    holdId: String(f.hold_id),
    step: f.step,
    heldUsd: held / 1e6,
    billUsd: bill / 1e6,
    aboveByUsd: (bill - held) / 1e6,
    endedAt: f.ended_at.toISOString(),
    frozenAt: f.frozen_at.toISOString(),
    gateway: f.gateway,
    model: typeof model === "string" ? model : null,
  };
}

/* ------------------------------------------------------------------ the owner's reconciliation */

/** Why a reconciliation was refused. Each refusal has its own code; nothing is changed or written. */
export type ReconcileRefusalCode =
  | "hold_id_not_valid"
  | "actual_not_a_number"
  | "actual_below_zero"
  | "actual_too_large"
  | "actual_more_than_6_decimals"
  | `${"evidence" | "asked_by" | "recorded_by" | "reason"}_${"missing" | "too_long" | "not_storable"}`
  | "unknown_project"
  | "unknown_hold"
  | "hold_already_closed"
  | "hold_not_kept"
  | "cost_already_recorded"
  /** Package 1.4c, `recordOverrun`: the hold has no freeze after a bill above it (none, or only of another kind). */
  | "no_overrun_freeze"
  /** Package 1.4c, `recordOverrun`: that freeze was already cleared. */
  | "overrun_already_recorded";

export class ReconcileRefused extends Error {
  constructor(
    readonly code: ReconcileRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = "ReconcileRefused";
  }
}

export interface Reconciliation {
  projectId: string;
  holdId: string;
  /** The amount the hold held, and the actual cost now charged in its place. */
  heldUsd: number;
  actualUsd: number;
  /** held − actual: what went back to the budget; below 0 when the actual cost is above the hold. */
  returnedUsd: number;
  aboveHold: boolean;
  kinds: HoldKind[];
  evidence: string;
  askedBy: string;
  recordedBy: string;
  reason: string;
  /** The database's clock, read under the project's lock. */
  recordedAt: string;
  /** The `hold.reconciled` event, and the `model.call` event that carries the cost. */
  eventId: string;
  modelCallEventId: string;
  /** The freezes this cleared (package 1.4), and whether the project is still frozen by another. */
  freezesCleared: string[];
  projectStillFrozen: boolean;
  budgetBefore: Budget;
  budgetAfter: Budget;
}

const NOTHING_CHANGED = "Nothing was changed and nothing was written.";
const MAX_TEXT = 500;
const MAX_EVIDENCE = 2000;

function checkActual(x: unknown): number {
  if (typeof x !== "number" || !Number.isFinite(x)) {
    throw new ReconcileRefused("actual_not_a_number", `The actual cost is not a number of dollars (got ${typeof x === "number" ? String(x) : typeof x}). ${NOTHING_CHANGED}`);
  }
  if (x < 0) throw new ReconcileRefused("actual_below_zero", `The actual cost is below $0 (got ${x}). ${NOTHING_CHANGED}`);
  if (x >= 1e8) throw new ReconcileRefused("actual_too_large", `The actual cost must be below $100,000,000 (got ${x}). ${NOTHING_CHANGED}`);
  // The column keeps 6 decimals and would round a seventh silently.
  if (Number(x.toFixed(6)) !== x) throw new ReconcileRefused("actual_more_than_6_decimals", `The actual cost has more than 6 decimal places (got ${x}); the database keeps 6 and would round it. ${NOTHING_CHANGED}`);
  return x;
}

function checkText(field: "evidence" | "asked_by" | "recorded_by" | "reason", value: unknown, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") throw new ReconcileRefused(`${field}_missing`, `${field} is missing or empty. ${NOTHING_CHANGED}`);
  if ([...text].length > max) throw new ReconcileRefused(`${field}_too_long`, `${field} is longer than ${max} characters. ${NOTHING_CHANGED}`);
  if (text.includes("\u0000") || LONE_SURROGATE_IN.test(text)) {
    throw new ReconcileRefused(`${field}_not_storable`, `${field} holds a character the event log cannot store (a NUL character, or half of a surrogate pair). ${NOTHING_CHANGED}`);
  }
  return text;
}

/**
 * Record the owner's reconciliation of one kept hold. Checks the figure and the texts first; then, in one
 * transaction under the project's lock: marks the project's holds past their deadline and closes its steps past
 * theirs (as every budget decision does), reads the hold, and refuses it unless it is open and kept at its full
 * amount (kept, unreconciled or expired) with no cost already counted for it. Then writes `model.call` with the
 * actual cost, closes the hold at that cost (returning what it did not cost to its step's room while the step
 * is open, as a settlement does), writes `hold.reconciled` (and `hold.exceeded` when the cost is above the
 * hold), and clears every freeze this hold caused, each with a `project.freeze_cleared` event. Throws
 * `ReconcileRefused`, having changed and written nothing, when it cannot be recorded.
 */
export async function reconcileHold(
  pool: pg.Pool,
  p: { projectId: string; holdId: string; actualUsd: number; evidence: string; askedBy: string; recordedBy: string; reason: string },
): Promise<Reconciliation> {
  if (typeof p.holdId !== "string" || !/^[1-9][0-9]{0,17}$/.test(p.holdId)) throw new ReconcileRefused("hold_id_not_valid", `A hold's id is a whole number above 0. ${NOTHING_CHANGED}`);
  const actual = checkActual(p.actualUsd);
  const evidence = checkText("evidence", p.evidence, MAX_EVIDENCE);
  const askedBy = checkText("asked_by", p.askedBy, MAX_TEXT);
  const recordedBy = checkText("recorded_by", p.recordedBy, MAX_TEXT);
  const reason = checkText("reason", p.reason, MAX_TEXT);
  return inTransaction(pool, p.projectId, async (c) => {
    // inTransaction holds the project's row lock from here on; it does not say whether the row exists.
    if ((await c.query("select 1 from projects where id = $1", [p.projectId])).rowCount === 0) throw new ReconcileRefused("unknown_project", `There is no project with the id given. ${NOTHING_CHANGED}`);
    const now = new Date();
    await expireHoldsIn(c, p.projectId, now);
    await closeStepsPastDeadlineIn(c, p.projectId, now);
    const hold = (await c.query<Hold>("select * from holds where id = $1 and project_id = $2 for update", [p.holdId, p.projectId])).rows[0];
    if (!hold) throw new ReconcileRefused("unknown_hold", `Project ${p.projectId} has no hold ${p.holdId}. ${NOTHING_CHANGED}`);
    if (hold.state !== "open") {
      throw new ReconcileRefused("hold_already_closed", `Hold ${p.holdId} is already closed (at $${hold.actual_usd}, ${hold.closed_at?.toISOString()}). ${NOTHING_CHANGED}`);
    }
    if (!hold.unreconciled && !hold.expired && hold.kept_reason === null) {
      throw new ReconcileRefused("hold_not_kept", `Hold ${p.holdId} is open for a call that has not ended: it is not on the unreconciled list. ${NOTHING_CHANGED}`);
    }
    // A model.call that names this hold, with a cost the budget view would count once the hold is closed (the
    // view's own test, migration 008): charging the actual cost as well would count the call twice.
    const already = await c.query(
      `select 1 from events
        where project_id = $1 and kind = 'model.call'
          and case when jsonb_typeof(payload->'hold_id') = 'number' and (payload->>'hold_id') ~ '^[0-9]{1,18}$' then (payload->>'hold_id')::bigint end = $2
          and case when jsonb_typeof(payload->'cost_usd') = 'number' then (payload->>'cost_usd')::numeric >= 0 else false end`,
      [p.projectId, hold.id],
    );
    if ((already.rowCount ?? 0) > 0) {
      throw new ReconcileRefused("cost_already_recorded", `A model.call event already records a cost for hold ${p.holdId}; reconciling it would count the call twice. An engineer has to look at it. ${NOTHING_CHANGED}`);
    }
    const [described] = await describe(c, [hold], now);
    const budgetBefore = await readBudget(c, p.projectId);
    const recordedAt = (await c.query<{ t: Date }>("select clock_timestamp() as t")).rows[0]!.t.toISOString();
    const held = Number(hold.amount_usd);
    const modelCallEventId = await event(
      c,
      p.projectId,
      "model.call",
      { hold_id: Number(hold.id), cost_usd: actual, model: described!.model, reconciled: true, note: "the actual cost recorded by the owner's reconciliation; its evidence is in the hold.reconciled event that follows" },
      hold.step,
    );
    await c.query("update holds set state = 'settled', closed_at = now(), actual_usd = $2 where id = $1", [hold.id, actual]);
    const step = await returnToStepIn(c, hold, actual);
    const cleared = (
      await c.query<Freeze>("update project_freezes set cleared_at = clock_timestamp() where project_id = $1 and hold_id = $2 and cleared_at is null returning *", [p.projectId, hold.id])
    ).rows;
    const stillFrozen = (await activeFreezeIn(c, p.projectId)) !== null;
    const budgetAfter = await readBudget(c, p.projectId);
    const aboveHold = micro(actual) > micro(held);
    const returnedUsd = (micro(held) - micro(actual)) / 1e6;
    const figures = (b: Budget) => ({ cap_usd: b.cap, spent_usd: b.spent, open_holds_usd: b.openHolds, step_room_usd: b.stepRoom });
    const eventId = await event(
      c,
      p.projectId,
      "hold.reconciled",
      {
        hold_id: Number(hold.id),
        amount_usd: held,
        actual_usd: actual,
        returned_usd: returnedUsd,
        evidence,
        asked_by: askedBy,
        recorded_by: recordedBy,
        reason,
        recorded_at: recordedAt,
        kinds: described!.kinds,
        kept_reason: hold.kept_reason,
        expired: hold.expired,
        model_call_event_id: Number(modelCallEventId),
        freezes_cleared: cleared.map((f) => Number(f.id)),
        project_still_frozen: stillFrozen,
        budget_before: figures(budgetBefore),
        budget_after: figures(budgetAfter),
        ...(step ? { step_hold: step } : {}),
      },
      hold.step,
    );
    if (aboveHold) await event(c, p.projectId, "hold.exceeded", { hold_id: Number(hold.id), amount_usd: held, actual_usd: actual, reconciled: true }, hold.step);
    for (const f of cleared) {
      await event(
        c,
        p.projectId,
        "project.freeze_cleared",
        { freeze_id: Number(f.id), kind: f.kind, journal_id: f.journal_id, hold_id: Number(hold.id), cleared_at: f.cleared_at!.toISOString(), by: "the owner's reconciliation of its hold", hold_reconciled_event_id: Number(eventId), project_still_frozen: stillFrozen },
        hold.step,
      );
    }
    return {
      projectId: p.projectId,
      holdId: String(hold.id),
      heldUsd: held,
      actualUsd: actual,
      returnedUsd,
      aboveHold,
      kinds: described!.kinds,
      evidence,
      askedBy,
      recordedBy,
      reason,
      recordedAt,
      eventId,
      modelCallEventId,
      freezesCleared: cleared.map((f) => String(f.id)),
      projectStillFrozen: stillFrozen,
      budgetBefore,
      budgetAfter,
    };
  });
}

/* ------------------------------------------------------------------ the owner's record of a bill above its hold (package 1.4c) */

/** What each kind of freeze is called in a refusal. */
const FREEZE_KIND_TEXT: Record<FreezeKind, string> = {
  unrecorded_ending: "its call's ending could not be recorded",
  bill_above_hold: "a bill above its hold",
  late_answer_above_hold: "a late answer above its hold",
};

export interface OverrunRecord extends OverrunFreeze {
  evidence: string;
  askedBy: string;
  recordedBy: string;
  reason: string;
  /** The database's clock, read under the project's lock. */
  recordedAt: string;
  /** The `hold.overrun_recorded` event, and the `project.freeze_cleared` event. */
  eventId: string;
  clearedEventId: string;
  /** Whether the project is still frozen by another freeze. */
  projectStillFrozen: boolean;
  /** The budget at that moment: this record moves no money. */
  budget: Budget;
}

/**
 * Record the owner's review of a bill above its hold, and clear the freeze that bill caused (package 1.4c; the
 * owner's answer to question 17, 13 Nov 2026, "(a) Yes, freeze"). The bill was charged in full when the call was
 * settled, so this moves no money. The hold is closed, so `reconcileHold` refuses it; this is the recorded action
 * that clears such a freeze. Checks the hold's id and the texts first; then, in one transaction under the project's
 * lock: refuses it unless the project exists, the hold is this project's, and the hold has a freeze after a bill
 * above it that is not cleared; clears that freeze, and only that one; writes `hold.overrun_recorded` with the hold,
 * the bill, the difference, the evidence, who asked, who recorded it and why, and `project.freeze_cleared`. Who asked
 * and who recorded it are written as stated, as for a reconciliation (known gap 99). Throws `ReconcileRefused`,
 * having changed and written nothing, when it cannot be recorded.
 */
export async function recordOverrun(
  pool: pg.Pool,
  p: { projectId: string; holdId: string; evidence: string; askedBy: string; recordedBy: string; reason: string },
): Promise<OverrunRecord> {
  if (typeof p.holdId !== "string" || !/^[1-9][0-9]{0,17}$/.test(p.holdId)) throw new ReconcileRefused("hold_id_not_valid", `A hold's id is a whole number above 0. ${NOTHING_CHANGED}`);
  const evidence = checkText("evidence", p.evidence, MAX_EVIDENCE);
  const askedBy = checkText("asked_by", p.askedBy, MAX_TEXT);
  const recordedBy = checkText("recorded_by", p.recordedBy, MAX_TEXT);
  const reason = checkText("reason", p.reason, MAX_TEXT);
  return inTransaction(pool, p.projectId, async (c) => {
    // inTransaction holds the project's row lock from here on; it does not say whether the row exists.
    if ((await c.query("select 1 from projects where id = $1", [p.projectId])).rowCount === 0) throw new ReconcileRefused("unknown_project", `There is no project with the id given. ${NOTHING_CHANGED}`);
    const hold = (await c.query<Hold>("select * from holds where id = $1 and project_id = $2", [p.holdId, p.projectId])).rows[0];
    if (!hold) throw new ReconcileRefused("unknown_hold", `Project ${p.projectId} has no hold ${p.holdId}. ${NOTHING_CHANGED}`);
    const freezes = (await c.query<Freeze>("select * from project_freezes where project_id = $1 and hold_id = $2 order by id", [p.projectId, hold.id])).rows;
    const overrun = freezes.find((f) => f.kind === "bill_above_hold");
    if (!overrun) {
      const others = [...new Set(freezes.filter((f) => f.cleared_at === null).map((f) => FREEZE_KIND_TEXT[f.kind] ?? f.kind))];
      throw new ReconcileRefused(
        "no_overrun_freeze",
        `Hold ${p.holdId} has no freeze after a bill above its hold${others.length > 0 ? `; it froze its project for another reason (${others.join("; ")}), which a reconciliation of the hold with its actual cost clears` : ""}. ${NOTHING_CHANGED}`,
      );
    }
    if (overrun.cleared_at !== null) {
      throw new ReconcileRefused("overrun_already_recorded", `The freeze after hold ${p.holdId}'s bill above its hold was already cleared, at ${overrun.cleared_at.toISOString()}. ${NOTHING_CHANGED}`);
    }
    const recordedAt = (await c.query<{ t: Date }>("select clock_timestamp() as t")).rows[0]!.t.toISOString();
    const cleared = (await c.query<Freeze>("update project_freezes set cleared_at = clock_timestamp() where id = $1 and cleared_at is null returning *", [overrun.id])).rows[0]!;
    const stillFrozen = (await activeFreezeIn(c, p.projectId)) !== null;
    const budget = await readBudget(c, p.projectId);
    const o = overrunOf({ ...overrun, step: hold.step });
    const eventId = await event(
      c,
      p.projectId,
      "hold.overrun_recorded",
      {
        hold_id: Number(hold.id),
        freeze_id: Number(overrun.id),
        amount_usd: o.heldUsd,
        bill_usd: o.billUsd,
        above_by_usd: o.aboveByUsd,
        ended_at: o.endedAt,
        evidence,
        asked_by: askedBy,
        recorded_by: recordedBy,
        reason,
        recorded_at: recordedAt,
        project_still_frozen: stillFrozen,
        budget: { cap_usd: budget.cap, spent_usd: budget.spent, open_holds_usd: budget.openHolds, step_room_usd: budget.stepRoom },
      },
      hold.step,
    );
    const clearedEventId = await event(
      c,
      p.projectId,
      "project.freeze_cleared",
      { freeze_id: Number(cleared.id), kind: cleared.kind, hold_id: Number(hold.id), cleared_at: cleared.cleared_at!.toISOString(), by: "the owner's record of a bill above its hold", hold_overrun_recorded_event_id: Number(eventId), project_still_frozen: stillFrozen },
      hold.step,
    );
    return { ...o, evidence, askedBy, recordedBy, reason, recordedAt, eventId, clearedEventId, projectStillFrozen: stillFrozen, budget };
  });
}
