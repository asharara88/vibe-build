/**
 * Running one step under its budget (build plan package 1.3; design note 5.5, "The pre-step check";
 * proof row B7). There is no orchestrator yet: this is the piece of it that 1.3 needs.
 *
 * Before the engine is created, the step's whole budget is reserved by `openStepHold` (the store,
 * under the project's lock). If it does not fit, the step is not started: the engine is never
 * created, the step is reported failed with the message, and `step.refused` is in the event log.
 * If it fits, the engine is created with the gateway's address and the step's own token, so its calls
 * draw from the step's hold; when the step ends, in every way it can end (finished, failed, or the
 * engine throwing), the hold is closed: the room left is released and the token revoked.
 *
 * The build-engine interface (Decision F) is unchanged: the token reaches the engine through
 * `engineFor`, as the workspace reaches the scripted engine through its constructor. No engine in the
 * builder takes a token yet (the scripted engine calls no model; known gap 69): until package 2.2,
 * only the stand-in engines of the tests and the demonstration make calls with it.
 */
import type pg from "pg";
import { emptyUsage } from "../gateway/cost.js";
import { StepBudgetInvalid, type ProfileLimits } from "../gateway/hold.js";
import type { BuildEngine, EngineEvent, StepInstruction, StepResult } from "../engine/interface.js";
import { closeStepHold, openStepHold } from "../store/holds.js";

export interface BudgetedStepOptions {
  pool: pg.Pool;
  /** The limits the step's budget is worked out from: the output ceiling and the step's prompt limit. */
  profile: ProfileLimits;
  /** The one model the step's calls may use. */
  model: string;
  /** The gateway's address, as the engine will reach it. */
  gatewayUrl: string;
  /** Makes the engine for this step, given the gateway's address and the step's token. Called only if the step is let start. */
  engineFor: (a: { gatewayUrl: string; token: string }) => BuildEngine;
  step: StepInstruction;
  onEvent: (e: EngineEvent) => void;
  /**
   * How long the step may hold its budget, in milliseconds, from now. Past it, the step's hold is closed
   * by the sweep or the next budget decision, and its token stops working. Set it from the engine's own
   * limit for a step, with a margin (review of the 1.3 design, item 4).
   */
  stepTimeLimitMs: number;
  /** Called when the step's hold could not be closed after the step ended. The step's own result is kept. */
  onFault?: (message: string, detail: unknown) => void;
}

const failed = (reason: string): StepResult => ({ ok: false, changedFiles: [], usage: emptyUsage(), turns: 0, failureReason: reason });

/**
 * Run one step only if its budget fits. Returns the engine's result, or a failed result with the
 * message when the step was refused before it started. If the engine throws, the step's hold is still
 * closed and the error is passed on.
 */
export async function runBudgetedStep(o: BudgetedStepOptions): Promise<StepResult> {
  if (typeof o.stepTimeLimitMs !== "number" || !Number.isFinite(o.stepTimeLimitMs) || o.stepTimeLimitMs <= 0) {
    throw new Error("A step's time limit must be a number of milliseconds above 0. The step was not started.");
  }
  let opened;
  try {
    opened = await openStepHold(o.pool, {
      projectId: o.step.projectId,
      stepId: o.step.stepId,
      model: o.model,
      maxTurns: o.step.maxTurns,
      profile: o.profile,
      deadline: new Date(Date.now() + o.stepTimeLimitMs),
    });
  } catch (err) {
    if (!(err instanceof StepBudgetInvalid)) throw err;
    o.onEvent({ type: "failed", reason: err.message, at: new Date().toISOString() });
    return failed(err.message);
  }
  if (!opened.ok) {
    o.onEvent({ type: "failed", reason: opened.message, at: new Date().toISOString() });
    return failed(opened.message);
  }
  const fault = o.onFault ?? ((m: string, d: unknown) => console.error(`[orchestrator fault] ${m}`, d));
  try {
    const engine = o.engineFor({ gatewayUrl: o.gatewayUrl, token: opened.token });
    return await engine.runStep(o.step, o.onEvent);
  } finally {
    try {
      await closeStepHold(o.pool, { projectId: o.step.projectId, stepHoldId: opened.stepHold.id, reason: "step_ended" });
    } catch (err) {
      // The step's result (or its error) is kept. The hold stays open until its deadline, when the sweep closes it.
      fault("A step's hold could not be closed after the step ended. It is closed by the sweep at its deadline.", {
        project: o.step.projectId,
        step_hold: opened.stepHold.id,
        error: err instanceof Error ? err.name : typeof err,
      });
    }
  }
}
