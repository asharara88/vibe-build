/**
 * The build engine interface: the second seam (Decision F).
 * One step's instruction and a workspace in; changes, events and usage out.
 * Any engine adapter (Claude Agent SDK, Codex SDK) implements exactly this.
 */
import type { Usage } from "../gateway/cost.js";

export interface StepInstruction {
  projectId: string;
  stepId: string;
  /** The optimiser's instruction, in full. The only way instructions reach the engine. */
  instruction: string;
  /** Paths the engine must not change. Also mounted read-only. */
  protectedPaths: string[];
  /** Hard limit on agent turns, because the engine has no session timeout. */
  maxTurns: number;
}

export type EngineEvent =
  | { type: "tool_call"; tool: string; input: unknown; at: string }
  | { type: "text"; text: string; at: string }
  | { type: "blocked"; reason: string; at: string }
  | { type: "finished"; at: string }
  | { type: "failed"; reason: string; at: string };

export interface StepResult {
  ok: boolean;
  /** Files changed relative to the workspace, as reported by git. */
  changedFiles: string[];
  usage: Usage;
  turns: number;
  failureReason?: string;
}

export interface BuildEngine {
  readonly name: string;
  /**
   * Start one step. Events stream as they happen; the promise resolves when the step ends.
   * `onEvent` may throw, or return a promise that rejects: an engine must not let either bring the
   * builder down or leave its container running. The scripted engine then kills its container and
   * fails the step ("handling the step's events failed …"); it does not wait for a promise the handler
   * returns, so one that rejects once the step's commit has begun leaves the step reported as done
   * (one known before the commit begins fails the step).
   */
  runStep(step: StepInstruction, onEvent: (e: EngineEvent) => void): Promise<StepResult>;
  /** Stop the running step, if any. */
  stop(): Promise<void>;
}
