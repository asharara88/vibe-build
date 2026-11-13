# Package 1.3: the pre-step check and the step hold

| | |
| --- | --- |
| Date | 13 November 2026 |
| Done means (build plan, 7.3) | "A step refused before it starts when its budget does not fit, with the message shown." Proof row B7 (design note 7.2) adds: "In a step that does start: each call's hold is drawn from the step hold, and the unused part is released when the step ends" |
| Built to | Option (a) of the owner's question 16 (B7 in full), before his answer, with every correction of the design's review applied |
| Run on | The development machine (a cloud session), on the host: PostgreSQL 16.15, test database `builder_test_pkg13`; a **stand-in provider** and **stand-in engines** in the test's own process. No key exists; no model was called; nothing was spent. Code of every run: commit `85c5959` (the controls: `2a32c12` and `c969917`, whose code under test is the same as `85c5959`'s) |
| State | **Tested at the commit its pull request merges**, against a stand-in provider and engines only. Every row below ran and passed; every new test failed with its safeguard removed; its one adversarial review (plan section 3, step 6) found nothing blocking ("After the review", below) |

**For the owner:** `run-demo-step-hold.txt`, section 1 (a step refused at a $0.02 cap, with the message), section 2 (the cap raised to $0.03 with `change-cap.ts`) and section 3 (the step let start, its three calls drawn from its hold, $0.011454 released when it ended).

## What was built (all in `builder/`)

- `src/store/migrations/008_step_holds.sql`: the `step_holds` table (`:13-45`) with checks that refuse a NaN or negative figure (`:36-44`); composite keys so a token or a hold names a step hold of its own project only (`:51-57`); the budget view with `step_room_usd` beside open holds (`:63-86`).
- `src/gateway/hold.ts`: `stepBudget` (`:308-342`), turns x one turn's share in whole millionths, refused by `StepBudgetInvalid` before the database unless the turns are a whole number from 1 to 1,000 and the budget a finite amount above 0; `stepPromptTokens` (`:33`, 8,000 in the standard profile, not measured).
- `src/store/holds.ts`: `openStepHold` (`:592-638`; the equation `:614`, the token `:627-628`, only its hash stored); step calls in `openHold` (`:164-196`: the re-check that the step is open `:171-175`, the limits `:176-184`, the room `:185-188`); the room returned on settle and release (`returnToStepIn`, `:497-507`); `closeStepHold` (`:647-660`, a closed step left as it is `:657`) and `closeStepIn` (`:510-557`, the token revoked `:536`); steps past their deadline closed by every decision (`:159`, `:238`, `:305`, `:604`, `:654`, `:799`) and by the sweep (`:385`), of which only the call's admission (`:159`) and the sweep are tested (T11; known gap 88); the cap change's floor counting the room (`:802`) and naming it (`:769`); the step's message (`stepRefusalMessage`, `:568-577`).
- `src/gateway/app.ts`: a step token's label from its step hold, another step's name refused (`:222-228`); the answers `step_closed` 401, `step_call_outside_limits` 400 and `step_budget_reached` 402 (`:358-376`); "reserved for running steps" in the call's refusal (`:381`). `src/store/projects.ts`: `tokenOwner` (`:63`).
- `src/orchestrator/steps.ts`: `runBudgetedStep` (`:52-91`): the step hold opened before the engine is made; refused, the engine is never made; the hold closed in `finally` (`:79-90`).
- `scripts/demo-step-hold.ts`; `scripts/change-cap.ts` prints the room reserved; `test/step-hold.test.ts` (18 tests); one existing test, B20's exact `cap.changed` payload, gained the two new fields (`test/gateway.test.ts:1817-1831`).

## The rows, their tests and runs

Tests: `run-tests-step-hold.txt` (18 passed). Demonstration: `run-demo-step-hold.txt`.

| Row | Shown by | Result |
| --- | --- | --- |
| Done means; B7 "refused" | T1: cap $0.02, a 3-turn step of $0.02988: refused with the exact message, the engine never made, nothing forwarded or counted, one `step.refused` event, no step hold. T2: a budget equal to the room left starts; one millionth over is refused. Demo section 1 | passed |
| B7 "drawn" | T3: three calls, each `hold.opened` showing the room before and after (0.02988 to 0.01992; 0.023738 to 0.013778; 0.017596 to 0.007636); spent + open holds + room = $0.02988 at every forward. T4: a call needing more than the room left gets 402 `step_budget_reached`, not forwarded, while the cap had room. Demo sections 3 and 4 | passed |
| B7 "released" | T5: at the end, $0.023738 released and a call outside the step that needed it now fits (402 before, 200 after); with a call billed above its hold, the figures still add up (budget = released + still held + spent − overrun not covered). T6: an engine that throws still has its step closed; a call kept after a 500 stays open at its full amount. Demo section 3 | passed |
| Around B7 | T7: the token revoked at the end (401); a call accepted before the close and judged after it refused (`step_closed`). T9: during a step a lowering below spent + open holds + room refused, naming the room; a raise accepted, the room unchanged (demo section 5). T10: a step and a call, and a step and a lowering, each with room for one: exactly one admitted. T11: a step past its deadline closed by the sweep, and by the next decision; a close of a closed step writes nothing. T12: NaN, −100, 0, 1.5, Infinity, 1001 and "3" turns and bad profiles refused before the database; the database's checks refuse NaN and negative figures. T13: another model, more output, a larger prompt, another step's name: refused, nothing forwarded. No step token in any event | passed |

T8 (one open step per project) was cut, as the review advised (known gap 86).

## Controls

`run-controls-2.txt`, at `c969917`: 19 controls, one exact change each, shown as a diff, then restored; `git diff --exit-code` clean after every one. **All 19 failed.** C0 the budget in dollars, not millionths; C1 the pre-step equation skipped; C2 `>` made `>=`; C3 a step call judged by the plain equation; C4 a call over the room let fall through; C5 the close in `finally` removed (T5, T6: 3 failed); C6 the close settling its calls' open holds; C7 no revocation; C8 no re-check under the lock (the room check then answers, 402); C9 the room left out of the cap change's floor; C10 `for update` removed (both admitted); C11 the sweep skipping steps; C12 a decision not closing past-deadline steps (200); C13 a close of a closed step throwing; C14 the code's guards removed (the database still refused); C15 the code's guards and the database's checks removed, on a fresh database (a call above the cap let through, 200); C16 the limits check removed; C17 the step-name check removed; C18 the token written into an event.

`run-controls-1.txt`, at `2a32c12`: the first run. **C0 passed with its safeguard removed:** 3 x 0.00996 happens to be exact in dollars. The test was made to check every turn limit from 1 to 1,000 (`c969917`), and all 19 controls were run again.

## The checks

| Check | File | Result |
| --- | --- | --- |
| `npm run typecheck`, and the three scripts outside `tsconfig.json` | `run-typecheck.txt` | exit 0, twice |
| Every test except the live ones | `run-tests-not-live.txt` | 10 files; 247 passed, 19 skipped; exit 0 |
| The whole suite once, live tests included, under the shared lock | `run-tests-full.txt` | 10 files; 266 passed; exit 0; no container before or after |
| `npm run check:licences`; no dependency added (`package.json`, the lock file, `licences.csv` unchanged) | `run-licences.txt` | RESULT: PASSED; exit 0 |

## After the review

One adversarial review (money and tests) read `4bd46f7`: **nothing blocking**, eight notes. No code changed, so no new test or control: `builder/` is the same as at `85c5959`. Notes 1 to 3 (three safeguards with no test of their own, shown by the reviewer's controls X3, X4 and X8, X6) are known gaps 87 to 89, and the "What was built" line above now says which deadline closes are tested; note 4 (no upper limit on a step's time limit) is in gap 85; note 5 (the 402 message rounds the room left to "$0.00") is gap 90; note 6 brought gaps 64 and 18 up to date; note 7 carried gap 66's items to 1.4. Note 8, checked: every summary row of `run-controls-2.txt` ends with its `|` (C0 and C15 included); the row that reads oddly is C0 in `run-controls-1.txt`, where vitest's own `|` was kept, and that output is left as it ran.

Run again at `ec358c1`, with its own test database `builder_test_pkg13_rev`: `run-typecheck-after-review.txt` (exit 0, twice); `run-tests-full-after-review.txt` (the whole suite under the shared lock: 10 files, 266 passed, exit 0, no container before or after); `run-licences-after-review.txt` (RESULT: PASSED, exit 0; no dependency changed).

## After the merge with the integration branch

The integration branch at `8a0ee2a` (pull requests #8 and #28, question 18) merged in at `aea350e`. This package's known gaps 67 to 76 are now 81 to 90, in order, wherever this branch named them; the integration branch's own 67 to 69 are untouched: `run-renumber-grep.txt`. No code of this package names a container image. Run again at `aea350e`, test database `builder_test_pkg13`: `run-typecheck-after-merge.txt` (exit 0, twice); `run-licences-after-merge.txt` (RESULT: PASSED, exit 0); `run-tests-full-after-merge.txt` (the whole suite under the shared lock: 11 files, 276 passed, the approved-images check's 10 included; exit 0; no container after).

## What this does not show

- **Anything about a real engine or provider.** The engines are stand-ins; no engine in the builder takes a token yet (known gap 83).
- **That a step's budget is enough for a real step.** The prompt limit is not measured (gap 81), and one turn is assumed to be one call (gap 82). A step's budget is a reservation from an estimate plus a margin, not a proven ceiling (gap 41).
- **"Room to finish" beyond the stored limits.** It holds for the step's turn limit of calls on its model, within its output ceiling and one turn's share, unless a call costs more than its hold. A larger call is refused, so the step stops.
- **A stop.** Nothing stops a running step; its reservation blocks a cap lowering until it ends or reaches its deadline (gap 85; the owner's question 16).
- **That the review's notes are fixed.** One adversarial review read it; the notes that need more than a line are open as known gaps 85 and 87 to 90. Nothing here says it is ready or safe.
