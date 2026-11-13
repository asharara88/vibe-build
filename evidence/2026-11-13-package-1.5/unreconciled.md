# Package 1.5: the unreconciled list

| | |
| --- | --- |
| Date | 13 November 2026 |
| Done means | "The list shown with one example of each kind, and one reconciliation recorded with its evidence" (build plan, package 1.5); proof row B14 of design note 7.2 |
| Run on | The development machine (a cloud session), on the host: the builder's store, gateway and scripts, PostgreSQL databases made for this package (`builder_test_pkg15` for the tests, `builder_demo_pkg15`, made empty, for the demonstration) and a **stand-in provider**. No model was called; the key is made up; nothing was spent; every name, figure and usage record is made up |
| State | **Built, not tested.** B14 ran and passed against a stand-in; each new test failed with its safeguard removed (16 controls). No review yet: the plan asks for an adversarial one (the cap) |

A **reconciliation** is the owner's recorded action that closes a kept hold at the call's actual cost. A **control** is a test run with one safeguard removed, to show the test notices.

## What was built (branch `claude/pkg-1.5-unreconciled`, on 1.4's branch at `2ad751d`)

- **The list**, `listUnreconciled` (`builder/src/store/reconcile.ts:202-220`): every open hold that is kept, unreconciled, expired, or past its deadline though not yet marked (`:195`), with its kinds and what is known of it: amount, reason, model, gateway, deadline, what the gateway saw, late answers with their cost as read, freezes (`describe`, `:129-192`). The kind is read from the reason the gateway wrote (`reasonKind`, `:68-75`). Freezes whose hold is not open are listed apart.
- **The reconciliation**, `reconcileHold` (`:309-423`). Figure and texts checked first (`:278-297`). Then one transaction under the project's lock (`:319`): holds past their deadline marked (`:323`); refused unless the hold is in this project, open, kept, and has no cost already recorded (`:325-344`); `model.call` with the actual cost (`:349-355`), the hold closed at it (`:356`), the unused part back to a running step (`:357`), the hold's freezes cleared (`:358-361`), `hold.reconciled` with the evidence, who asked, who recorded it, the reason and the budget before and after (`:366-391`), `hold.exceeded` when above the hold (`:392`), `project.freeze_cleared` per freeze (`:393-402`). Each refusal has its own code (`:225-236`) and writes nothing.
- **The script**, `builder/scripts/reconcile.ts`: `--list [--project]`, or `--hold --actual --evidence --asked-by --by --reason`. Database name only (`:110`), control characters stripped (`:83`), exit 0 / 1 misuse / 2 refused / 3 not completed.
- **The controls** are run by `controls.sh` in this folder.
- **The demonstration**, `builder/scripts/demo-reconcile.ts`. **The tests**, `builder/test/reconcile.test.ts:258-512`. The invariant checker reads `hold.reconciled` as a settlement (`builder/test/invariants.ts:118-120`). Four helpers and one constant of `holds.ts` exported, its lines unchanged.

## B14, test by test (`run-tests-reconcile.txt`: 8 passed; controls in `run-controls.txt`: 16 of 16 failed as they should)

| Test | Shows | Controls |
| --- | --- | --- |
| B14 (1) | One hold of each kind on the list with its details: error answer, interrupted, unreadable (through the gateway); expired, gateway gone, late answer (store); a call whose ending could not be recorded, freezing its project (gateway, refused write). A call in flight and a settled call are not listed; the list is the open holds less the one in flight | X1 selection, X2 a kind |
| B14 (2) | The B10 freeze reconciled with a made-up usage record: the hold closed at $0.006142, charged; `model.call`, `hold.reconciled`, `project.freeze_cleared` in one step; the project's next call forwarded and settled; invariant checker clean | X3 freeze clearing, X4 checker |
| B14 (3) | Below the hold, the difference goes back; above it, charged in full with `hold.exceeded`, and a call that no longer fits is refused | X5 the close, X6 `hold.exceeded` |
| B14 (4) | 27 refusals, each its own code, nothing changed: bad id or figure, missing or unstorable texts, unknown project or hold, another project's hold, a call in flight, a cost already recorded, a second reconciliation | X7, X8, X9 |
| B14 (5) | Two at once: one recorded, one refused, the cost charged once | X10 both locks |
| B14 (6) | Two freezes: frozen until both reconciled; an unmarked past-deadline hold listed and marked first; a step's room gets the unused part; a freeze with a closed hold listed apart | X11, X12, X13, X14 |
| B14 (7) | The script lists, records (exit 0), refuses (2), rejects misuse (1); no address, key or token printed | X15 |
| 1.5 | Every reason in the kinds table is still written by the gateway or store | X16 |

**Control X10, first run:** with only the project's lock removed, B14 (5) still passed; the hold's own row lock serialises two reconciliations. It fails with both removed (known gap 102).

## Checks, at `ca7f226`

Type check: passed (`run-typecheck.txt`). Whole suite, live tests included, on `builder_test_pkg15` under the lock: 13 files, 303 tests passed (`run-tests-full.txt`). Licence check: passed (`run-licences.txt`). No new dependency.

## What it is and is not

- **It is** the list and the recorded close of kept holds, shown against a stand-in. **It is not** a screen: the owner asks; Claude Code or an engineer runs the script (gap 99).
- **It does not check** who asked, or the evidence against the provider: both are written as stated (gap 99).
- **A cost above the hold** is charged in full and can take spend above the cap; it neither faults nor freezes (question 17; gap 97).
- **A freeze whose hold is not open** cannot be cleared this way: listed apart (gap 100).

## What the owner can look at

`run-demo.txt`, from the empty database: the list of seven kept holds (section 2), then project b, frozen, reconciled (section 3):

```text
  Hold 9 of project demo15_mwern0r2_b reconciled
    kind:          froze its project
    held:          $0.009960
    actual cost:   $0.006142, now charged; $0.003818 back to the budget
    evidence:      Provider usage record (made up for this demonstration): request req_demo_0001, Claude Opus 5.5, 30 input, 4 cache-write, 8 cache-read and 300 output tokens, billed $0.006142
    budget before: spent $0.000000; open holds $0.009960; cap $0.0300
    budget after:  spent $0.006142; open holds $0.000000; cap $0.0300
    freezes:       cleared 1; the project is not frozen
```

Its next call: HTTP 200, forwarded and settled (section 4). The same reconciliation again: refused, exit 2 (section 5).
