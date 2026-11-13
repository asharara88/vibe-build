# Package 1.4: the failure tests

| | |
| --- | --- |
| Date | 13 November 2026 |
| Done means (build plan, 7.3) | Each failure test passes and in every one both invariants hold at every moment: (1) recorded spend plus open holds never above the approved cap; (2) recorded spend plus open holds never below what the provider was owed. No settled call costs more than its hold. Proof rows B8 to B13 (design note 7.2) |
| Built to | The package's design with every correction of its review (scratchpad, not in the repository). Known gap 35's proposal for the stop after a fault, **with no engineer's review: B10 rests on an unreviewed design.** Question 17 built to (b): a bill above its hold raises a fault and does not freeze the project |
| Run on | The development machine (a cloud session), on the host: PostgreSQL 16.15, test database `builder_test_pkg14`; a **stand-in provider** in the test's own process; `src/gateway/main.ts` run as its own process and killed with SIGKILL. The key is made up; no model was called; nothing was spent. Code of every run: commit `81d5443` |
| State | **Built, not tested.** Every row below ran and passed; every new test failed with its safeguard removed (23 controls). Its adversarial review (plan section 3, step 6) has not run |

**For the owner:** `run-traces.md`, one table per case: what was spent, held, allowed (the cap) and owed to the provider, after every event and at every point the stand-in billed. In every table, spent + held stays at or under the cap, and at or over what was owed.

## What was built (all in `builder/`)

- The stop after a fault. `src/gateway/app.ts`: when the write recording a call's ending fails (`:510`, `:522`), the gate closes at once, before anything is awaited (`:449-460`); while it is closed the gateway forwards nothing for any project and writes nothing (`:244-253`). `src/gateway/journal.ts`: the record forced to disk (`:58`), moved to a "done" file once recorded (`:87`), replayed at start-up (`:175`). `src/store/freezes.ts`: the freeze, the kept hold marked unreconciled, the fault and `project.frozen` in one transaction under the project's lock (`:89`); a replayed line adds nothing (`:95`). `src/store/migrations/009_project_freezes.sql`: the table, which can be cleared once and never deleted or rewritten (`:29-50`).
- A frozen project: refused under the lock in `openHold` (`src/store/holds.ts:147`) and `openStepHold` (`:641`), and before the counting call (`app.ts:329`). The check never reads the cap.
- Every kept hold is marked unreconciled (`holds.ts:334`, `:243`); a late answer's reason says why (`:257`).
- A gateway killed mid-call. `src/store/liveness.ts`: each gateway holds a lock on a connection of its own (`:40`); `recoverHolds` tries it for every other gateway's open hold and marks unreconciled only those whose gateway is gone (`holds.ts:404-457`). A gateway that loses its lock forwards nothing (`app.ts:239`).
- A database that cannot be used: 503 `gateway_unavailable`, only a fixed summary of the error kept (`app.ts:230`).
- `src/gateway/main.ts`: journal folder checked, lock taken, journal replayed, holds recovered, then it serves (`:22-39`).
- `test/invariants.ts`: the checker (`:71`, `:158`, `:181`). `test/failures.test.ts`: the stand-in, the tests, a test-only trigger that refuses chosen writes.

## Proof rows (`test/failures.test.ts`; `run-tests-failures.txt`: 17 passed)

| Row | Named test | Controls (each failed; `run-controls.txt`) |
| --- | --- | --- |
| B8 | "B8: six calls at once through two gateway processes, against room for one: ..." (`:367`). Six seen waiting on the row lock, one forwarded, five 402 | C1: no `for update`. The six still waited (on the foreign-key check), then all six were let through; **the checker flagged (1)**: open holds $0.059760 against a cap of $0.0149 |
| B9 | "B9 (1)" while the provider never answers, with a running sibling (`:420`); "B9 (2)" mid-stream (`:465`); "B9 (3)" while the settle waits on the lock (`:496`). Each: spent + held the same before the kill, while dead and after the restart; hold open, full, unreconciled | C2: gone gateway's holds not marked (all three fail). C3: lock not tried, so the running sibling's hold was marked |
| B10 | (1) the `model.call` write refused: frozen, the next call and the counting call refused, also after a cap raise; another project unaffected (`:539`). (2) the freeze write refused too: 503 for every project, nothing forwarded or written, until it is written (`:590`). (3) every write refused, SIGKILL, restart: the first call is refused as frozen (`:624`). (7) the journal file fails too (`:670`). (4) the store refuses a frozen project's hold, step and step call (`:698`). (5) a replay adds nothing; a settled hold left settled (`:720`). (6) the freeze row kept (`:741`) | C4 pre-check removed; C5 gate removed; C6 journal write skipped; C23 a failed journal write drops the record; C7, C8 the store's checks removed; C9 no "on conflict"; C10 hold not marked; C11 the migration's trigger let through (fresh database) |
| B11 | (1) stream cut after output began (`:761`); (2) no answer at all (`:788`) | C12, C13: settle on what was seen (**the checker flagged (2)**: spent $0.000162, owed $0.006142). C15: kept hold not marked |
| B12 | "B12": no usage block; not JSON (`:803`) | C14: settle a missing usage at $0 (**the checker flagged (2)**) |
| B13 | The checker runs in every case above: 88 states and 17 billing points checked, no violation (`run-traces.md`). "B13: the checker flags each kind of breach ..." (`:820`) | C16 to C20: each of its rules switched off in turn |
| Also | Liveness lost (`:847`); database not usable (`:864`) | C21, C22 |

"Every moment" is read as: after every event of the project, in id order, plus every billing point. Id order is commit order only because every budget write takes the project's row lock. A bill counts as owed from its call's `hold.opened`, which is stricter than from the answer. "No settled call costs more than its hold" is checked on these runs, not enforced: 1.2's over-hold test stays the named exception (known gaps 41, 79).

## Checks

- `npm run typecheck`: exit 0 (`run-typecheck.txt`).
- Full suite under the shared lock: 11 files, **283 passed**, exit 0 (`run-tests-full.txt`); 1.2's and 1.3's tests included (266 before).
- `npm run check:licences`: PASSED (`run-licences.txt`). No new dependency.

## Not shown, or resting on assumptions

- B10 rests on a design no engineer has reviewed (gap 35). A SIGKILL before the journal line is on disk loses the freeze (gap 73); survival of a power cut is designed, not shown (gap 74); the journal's edges (gap 75); a gateway whose machine stops answering (gap 76).
- Against a stand-in only. A hold is a reservation from the provider's estimate plus an assumed margin, not a proven ceiling.
