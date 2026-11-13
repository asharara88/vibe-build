/**
 * The invariant checker of package 1.4 (proof row B13; build plan 7.3, "Done means" of 1.4; design note 5.5).
 *
 * The two invariants, for one project:
 *   (1) recorded spend plus open holds (plus the room reserved for running steps) is never above the cap;
 *   (2) recorded spend plus open holds is never below what the provider was owed;
 * and no settled call costs more than its hold.
 *
 * "Every moment" is read as: the state after every event of the project, in id order, and every billing
 * point. Replay in id order gives every committed state because every budget write takes the project's row
 * lock (store/tx.ts), so the events of one budget decision are numbered before those of the next. The replay
 * counts a call's cost as spent only once its hold is settled, as the budget view does (migration 008), so
 * no state inside a transaction shows a cost and its hold together.
 *
 * What the provider was owed comes from the stand-in, not from the gateway: when a call reaches it, the
 * stand-in works out by hand the bill it will stand for and pins it to that call's `hold.opened` event (the
 * hold was committed before the call was forwarded). From that event on, the bill counts as owed, which is
 * stricter than from the moment the provider answers. At the same moment it reads the budget view, and
 * that sample is checked too. At the end, the replay must equal the budget view.
 */
import type pg from "pg";

export const micro = (usd: number): number => Math.round(usd * 1e6);

export interface TraceEvent {
  id: string | number;
  kind: string;
  payload: Record<string, unknown>;
}

/** A bill the stand-in stands for: owed from the event `pinnedAt` on. */
export interface Bill {
  pinnedAt: number;
  billMicro: number;
}

/** The budget view as the stand-in read it when it billed, with what was owed by then (this bill included). */
export interface Sample {
  spentMicro: number;
  openMicro: number;
  roomMicro: number;
  capMicro: number;
  owedMicro: number;
}

export interface Violation {
  rule: "1: above the cap" | "2: below what was owed" | "a settled call above its hold" | "hold.exceeded written" | "replay differs from the budget view" | "an event the replay cannot read";
  at: string;
  detail: Record<string, unknown>;
}

export interface Replayed {
  spent: number;
  open: number;
  room: number;
  cap: number;
}

/** One state of the replay, for the trace shown to the owner: every figure in millionths. */
export interface TraceRow extends Replayed {
  at: string;
  owed: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Replay one project's events and check both invariants after each one. Pure: no database. Every figure is
 * worked in millionths of a dollar.
 */
export function checkTrace(events: TraceEvent[], bills: Bill[], initialCapMicro: number): { violations: Violation[]; states: number; final: Replayed; rows: TraceRow[] } {
  const violations: Violation[] = [];
  const holds = new Map<string, { amount: number; open: boolean }>();
  const costOfOpenHold = new Map<string, number>();
  const rooms = new Map<string, number>();
  let spent = 0;
  let open = 0;
  let cap = initialCapMicro;
  let states = 0;
  const rows: TraceRow[] = [];
  const roomSum = () => [...rooms.values()].reduce((a, b) => a + b, 0);
  const owedBy = (id: number) => bills.filter((b) => b.pinnedAt <= id).reduce((a, b) => a + b.billMicro, 0);
  const check = (at: string, id: number) => {
    states++;
    const room = roomSum();
    if (spent + open + room > cap) violations.push({ rule: "1: above the cap", at, detail: { spent, open, room, cap } });
    const owed = owedBy(id);
    rows.push({ at, spent, open, room, cap, owed });
    if (spent + open < owed) violations.push({ rule: "2: below what was owed", at, detail: { spent, open, owed } });
  };
  const bad = (e: TraceEvent, why: string) => violations.push({ rule: "an event the replay cannot read", at: `event ${e.id} ${e.kind}`, detail: { why } });

  check("before the first event", 0);
  for (const e of events) {
    const id = Number(e.id);
    const p = e.payload;
    const holdId = p["hold_id"] === undefined ? null : String(p["hold_id"]);
    const stepHold = (p["step_hold"] ?? null) as Record<string, unknown> | null;
    switch (e.kind) {
      case "hold.opened": {
        const amount = num(p["amount_usd"]);
        if (holdId === null || amount === null) {
          bad(e, "no hold id or amount");
          break;
        }
        holds.set(holdId, { amount: micro(amount), open: true });
        open += micro(amount);
        if (stepHold) rooms.set(String(stepHold["step_hold_id"]), micro(num(stepHold["room_after_usd"]) ?? 0));
        break;
      }
      case "model.call": {
        const cost = num(p["cost_usd"]);
        if (cost === null || cost < 0) break; // the view does not count it either
        if (holdId !== null && holds.get(holdId)?.open) costOfOpenHold.set(holdId, micro(cost));
        else spent += micro(cost);
        break;
      }
      case "hold.settled": {
        const h = holdId === null ? undefined : holds.get(holdId);
        if (!h || !h.open) {
          bad(e, "settles a hold the replay does not have open");
          break;
        }
        h.open = false;
        open -= h.amount;
        const cost = costOfOpenHold.get(holdId!) ?? 0;
        costOfOpenHold.delete(holdId!);
        spent += cost;
        const actual = num(p["actual_usd"]);
        if (actual !== null && micro(actual) > h.amount) violations.push({ rule: "a settled call above its hold", at: `event ${e.id}`, detail: { hold: h.amount, actual: micro(actual) } });
        if (micro(actual ?? 0) !== cost) bad(e, "the settled amount differs from its call's cost");
        if (stepHold && stepHold["step_open"] === true) rooms.set(String(stepHold["step_hold_id"]), micro(num(stepHold["room_after_usd"]) ?? 0));
        break;
      }
      case "hold.exceeded":
        violations.push({ rule: "hold.exceeded written", at: `event ${e.id}`, detail: p });
        break;
      case "step.hold_opened":
        rooms.set(String(p["step_hold_id"]), micro(num(p["step_budget_usd"]) ?? 0));
        break;
      case "step.hold_closed":
        rooms.set(String(p["step_hold_id"]), 0);
        break;
      case "cap.changed":
        cap = micro(num(p["new_cap_usd"]) ?? Number.NaN);
        break;
      default:
        // hold.kept, hold.expired, hold.found_at_startup, hold.unreconciled, gateway.*, project.frozen,
        // step.refused, ...: none moves money.
        break;
    }
    check(`after event ${e.id} ${e.kind}`, id);
  }
  return { violations, states, final: { spent, open, room: roomSum(), cap }, rows };
}

/** The checks on what the stand-in saw when it billed: each sample must satisfy both invariants. */
export function checkSamples(samples: Sample[]): Violation[] {
  const out: Violation[] = [];
  samples.forEach((s, i) => {
    if (s.spentMicro + s.openMicro + s.roomMicro > s.capMicro) out.push({ rule: "1: above the cap", at: `billing point ${i + 1}`, detail: { ...s } });
    if (s.spentMicro + s.openMicro < s.owedMicro) out.push({ rule: "2: below what was owed", at: `billing point ${i + 1}`, detail: { ...s } });
  });
  return out;
}

/** The budget view of one project, in millionths. */
export async function viewOf(q: Pick<pg.Pool, "query">, projectId: string): Promise<Replayed> {
  const r = await q.query<{ cap_usd: string; spent_usd: string; open_holds_usd: string; step_room_usd: string }>(
    "select cap_usd, spent_usd, open_holds_usd, step_room_usd from project_budget where project_id = $1",
    [projectId],
  );
  const row = r.rows[0]!;
  return { cap: micro(Number(row.cap_usd)), spent: micro(Number(row.spent_usd)), open: micro(Number(row.open_holds_usd)), room: micro(Number(row.step_room_usd)) };
}

/**
 * Check one project from the database: replay its events against the stand-in's bills and samples, and
 * compare the replay's end with the budget view.
 */
export async function checkProject(pool: pg.Pool, projectId: string, bills: Bill[], samples: Sample[]): Promise<{ violations: Violation[]; states: number; final: Replayed; rows: TraceRow[] }> {
  const events = (await pool.query<TraceEvent>("select id, kind, payload from events where project_id = $1 order by id", [projectId])).rows;
  const view = await viewOf(pool, projectId);
  const firstChange = events.find((e) => e.kind === "cap.changed");
  const initialCap = firstChange ? micro(Number(firstChange.payload["old_cap_usd"])) : view.cap;
  const out = checkTrace(events, bills, initialCap);
  const v = [...out.violations, ...checkSamples(samples)];
  const f = out.final;
  if (f.spent !== view.spent || f.open !== view.open || f.room !== view.room || f.cap !== view.cap) {
    v.push({ rule: "replay differs from the budget view", at: "end", detail: { replay: f, view } });
  }
  return { violations: v, states: out.states, final: f, rows: out.rows };
}

/** The trace as a table, in dollars, for the evidence file. */
export function traceTable(title: string, rows: TraceRow[], samples: Sample[]): string {
  const usd = (m: number) => (m / 1e6).toFixed(6);
  const out = [`== ${title} ==`, "| state | spent | open holds | step room | cap | owed to the provider |", "| --- | --- | --- | --- | --- | --- |"];
  for (const r of rows) out.push(`| ${r.at} | ${usd(r.spent)} | ${usd(r.open)} | ${usd(r.room)} | ${usd(r.cap)} | ${usd(r.owed)} |`);
  samples.forEach((s, i) => out.push(`| billing point ${i + 1} (the budget view, read by the stand-in) | ${usd(s.spentMicro)} | ${usd(s.openMicro)} | ${usd(s.roomMicro)} | ${usd(s.capMicro)} | ${usd(s.owedMicro)} |`));
  return out.join("\n") + "\n\n";
}
