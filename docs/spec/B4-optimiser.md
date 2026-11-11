> Living specification. Cut unchanged from HANDOVER.md Part B on 11 November 2026. Change only with the owner's agreement, and record the change in docs/DECISIONS.md.

## B4. Optimiser

The second component of the control layer. It sits between the analyst's confirmed package and the build engine. The customer never sees it.

Its rules cannot be written from first principles. They depend on how our build engine actually behaves, and that is measured by the test protocol (B5). Until then the rule slots below stay empty. Filling them before the test data exists would be invention.

**Role.** Turn each confirmed build step into the instruction the engine performs best on, attach the quality rules that apply to that step, and check the engine's output against the step and its acceptance item before the customer sees it.

**Inputs.** The package from the analyst (brief, build plan, acceptance test, Later list); the engine's output for the current step; this component's rule set.

**Procedure.**

1. *Take one step from the build plan.* Never more than one. The gate is per step.
2. *Rewrite it as an engine instruction.* A fixed template, to be derived from "phrasing that worked" in the protocol: what to name first, how to state data, how to state the screen, how to state the action, what to say about what not to touch.
3. *Attach the quality rules that apply to this step.* A mapping of the ten rules to step types (data step, screen step, action step, rule step), to be derived from "quality rules met" in the protocol: which rules the engine satisfies unprompted and which must be stated every time.
4. *Send to the engine.*
5. *Check the output.* Against the step's acceptance item and the attached rules. Pass: show the customer. Fail: rewrite once using the "where it drifted" and "where it ignored" patterns, and resend. Second fail: show the customer with the failure named. Do not hide it.
6. *Log.* Step, instruction sent, pass or fail, rewrite used. This log is the dataset the next version is written from.

**Rule slots, to be filled from the protocol.**

| Rule slot | Filled from |
| --- | --- |
| Phrasings the engine follows reliably | "Phrasing that worked", across all ten examples |
| Phrasings the engine misreads; never use | "Phrasing that failed" |
| Things the engine adds unasked; always say "do not" | "Where it drifted" |
| Things the engine skips; always state explicitly | "Where it ignored the instruction" |
| Rules the engine meets unprompted; no need to state | "Quality rules met" |
| Step types with low tuned scores; break into smaller steps | Acceptance score by pattern |

**Approval points.** None of its own. It inherits the analyst's gates: the customer approves each step's output, not the instruction that produced it.

**Output.** The engine instruction for the step; the pass/fail check; the log row.

**When unsure.** If a step cannot be expressed in the template, send it back to the analyst as a step that needs splitting. Never improvise an instruction outside the template.
