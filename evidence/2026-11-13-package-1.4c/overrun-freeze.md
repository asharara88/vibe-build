# Package 1.4c: a bill above its hold freezes the project until the owner records it

| | |
| --- | --- |
| Date | 13 November 2026 |
| Package | 1.4c, the owner's answer to question 17: "(a) Yes, freeze (Recommended)" (`docs/DECISIONS.md`, 13 Nov 2026) |
| Done means | The question as asked: "After such a bill, a project with budget left makes no further call until you record it. It does not stop the first such bill. It needs the freeze written in the same step as the settle, and package 1.5 able to clear it." |
| Run on | The development machine (a cloud session), on the host: the builder's store, gateway and scripts; PostgreSQL databases made for this package (`builder_test_p14c` for the tests and controls, `builder_demo_p14c`, made empty, for the demonstration); and a **stand-in provider**. No model was called; the key is made up; nothing was spent; every name, figure and usage record is made up |
| Result | Ten new tests passed; 17 of 17 controls failed as they should; the full suite passed (16 files, 409 tests, at `acb5d5b`); type check and licence check passed; the demonstration ran with every step as expected. **After the review:** 8 more tests, which failed on the code the review read and pass on the fix; 12 of 12 new controls failed as they should; the full suite passed (16 files, 417 tests); type check and licence check passed |
| State | **Built, not tested.** One adversarial review found one blocking item; it is fixed and shown by tests ("After the review", below), and not reviewed again. It is marked tested only when its pull request merges with no blocking finding open |

A **freeze** stops a project: no call, no counting call, no step. A **hold** is the amount set aside before a call is forwarded. A **control** is a test run with one safeguard removed, to show the test notices.

## What was built (branch `claude/pkg-1.4c-overrun-freeze`, on 1.5's branch at `8927027`)

Commits: `20b9b26` (the code), `e37ebc0` (the tests), `acb5d5b` (the demonstration), then this evidence and the records.

- **A freeze has a kind** (migration `builder/src/store/migrations/010_overrun_freezes.sql`): `unrecorded_ending` (package 1.4), `bill_above_hold` and `late_answer_above_hold`. The two new kinds carry the bill and the hold. The migration also asks the database to refuse one whose bill is not above its hold, and to keep one per hold and kind; both are written, and no test exercises them.
- **The freeze written with the settle**: `settleHold` (`builder/src/store/holds.ts:234`) writes the cost, `hold.settled` and `hold.exceeded`, and now, in the same transaction, the freeze naming that hold (`:314`, through `freezeAfterOverrunIn`, `builder/src/store/freezes.ts:134`). The gateway uses one settle for every call it meters, streamed or not, and for calls drawn from a step (`builder/src/gateway/app.ts:526`). If that transaction fails, none of it is written and package 1.4's path applies: the ending goes to the journal and the project is frozen as an unrecorded ending (`app.ts:532`). The first bill is charged in full, as before.
- **A late answer above its hold** (an answer for a hold already kept or expired): written down and not settled, as before; if its cost as read is above the hold, the same transaction freezes the project (`holds.ts:278`). That hold is still open, so the owner's reconciliation of it (package 1.5) clears the freeze.
- **The refusal**: a frozen project is refused as package 1.4 refuses one, before its counting call (`app.ts:341`) and under the project's lock when a hold or a step would open. The message names the bill, the hold and the difference (`frozenMessage`, `freezes.ts:102`).
- **The owner's record of the bill**: `recordOverrun` (`builder/src/store/reconcile.ts:529`). The hold is closed, so 1.5's reconciliation refuses it; this is the recorded action that clears the freeze. One transaction under the project's lock: refused unless that hold has a freeze of this kind not yet cleared (`:540-553`); writes `hold.overrun_recorded` with who asked, who recorded it, why, the evidence, the bill, the hold and the difference, and `project.freeze_cleared`; clears only that freeze (`:556`). It takes no cost and moves no money.
- **The script**: `scripts/reconcile.ts --overrun --hold --evidence --asked-by --by --reason` (`builder/scripts/reconcile.ts:89-92`, `:155-175`); `--list` shows each project frozen after a bill above its hold, with the bill, the hold and the difference (`:149-154`).
- **The invariant checker** (`builder/test/invariants.ts`): rule 3, a settlement's `hold.exceeded` has a `bill_above_hold` freeze of that hold written in the same transaction, read from each event row's transaction id (`:170-182`, `:232`); rule 4, no hold opens and no step starts while a freeze is not cleared (`:112-115`). The earlier rules are kept.
- **The earlier test** "a bill above the hold is charged in full, recorded as a breach, and raises a fault" (`builder/test/gateway.test.ts`) is updated, not deleted: the next call is now refused as frozen with nothing forwarded.
- **The demonstration**: `builder/scripts/demo-overrun.ts`.

## Decisions taken (Claude Code, building the owner's answer to question 17; `docs/DECISIONS.md`)

1. A late answer above its hold freezes too (kind `late_answer_above_hold`); its reconciliation clears it. Shown by test "1.4c (late)".
2. The owner's own reconciliation above the hold does not freeze: it is his recorded action. Shown by test "1.4c (a3)".
3. The refusal gives the figures to the millionth of a dollar, since the difference can be under a cent. The wording is the owner's to confirm (`docs/QUESTIONS.md`).

## The tests (`builder/test/overrun.test.ts`; `run-tests-overrun.txt`: 10 passed)

| Test | Shows | Controls |
| --- | --- | --- |
| 1.4c (a1) not streamed | A call billed $0.012284 against its hold of $0.009960: charged in full; `hold.exceeded`; the project frozen naming that hold, with the bill, the hold and the difference ($0.002324). The cost, the settlement, `hold.exceeded`, the freeze's event and the freeze's row share one transaction id. The project's next call, streamed call and counting request: each refused (402), nothing forwarded, no counting call, no hold. A new step: refused. Another project's call: forwarded and settled. The checker: no rule 3 or 4 broken | Y1, Y5, Y7 |
| 1.4c (a2) streamed | The same for a stream, settled when the provider's body ends (first written as "when its last event is read", which the review found not exact: the last bytes reach the caller first, gap 145) | Y2 |
| 1.4c (a3) one transaction | With a test-only trigger refusing the freeze's insert: no cost, no settlement, no `hold.exceeded`, no freeze of this kind are written; the hold stays open at its full amount; package 1.4's journal path freezes the project; its next call is refused. The owner's reconciliation at the bill clears it, writes no new freeze, and the next call is forwarded | Y4 |
| 1.4c (b) step-held | A call drawn from a step, billed above its hold: charged in full; the step's room takes the difference; the project frozen naming that hold, in one transaction; the step's next call refused with nothing forwarded; a new step refused; after the record, the step's next call forwarded and settled | Y3 |
| 1.4c (c1) the record | Clears that freeze with who, why, the evidence, the bill and the hold; the budget unchanged; 1.5's reconciliation refuses the closed hold; the next call forwarded and settled | |
| 1.4c (c2) its refusals | 19 refusals, each changing and writing nothing: a freeze of another kind, a hold with no freeze, another project's hold, an unknown hold or project, six bad ids, missing, too long or unstorable texts; then, after one record, a second one refused, also changing nothing | Y8, Y9, Y10, Y11 |
| 1.4c (c3) two freezes | Two calls billed above their holds: two freezes; the list shows both with their figures; each record clears only its own | Y12, Y13 |
| 1.4c (c4) the script | `--list` shows the bill, the hold and the difference; `--overrun` records it (exit 0), is refused a second time (exit 2); four kinds of misuse refused before the database (exit 1); no address or key printed | Y14 |
| 1.4c (late) | A late answer below its hold: no freeze. One above it: frozen in the transaction that writes it down; listed with its hold; the record of a bill refuses it; the reconciliation of its hold clears it | Y6 |
| 1.4c (d) the checker | Rules 3 and 4 on made-up traces: a freeze in another transaction, of another hold or kind, or none, is flagged; a reconciliation's `hold.exceeded` is not; a hold or step opened while frozen is flagged, and not once cleared | Y15, Y16, Y17 |

## Controls (`controls.sh`, output in `run-controls.txt`)

Each control extracts the committed code with `git archive` into a scratch folder, removes one safeguard there with one substitution, runs the named test on this package's test database, and expects it to fail; the copy is then deleted. The worktree is never edited.

| Control | Safeguard removed (on a copy) | Test | How the test failed |
| --- | --- | --- | --- |
| Y1 | The freeze written by a settlement above its hold | 1.4c (a1) | No freeze appeared (timed out waiting for it) |
| Y2 | The same | 1.4c (a2), streamed | The same |
| Y3 | The same | 1.4c (b), step-held | No freeze |
| Y4 | The freeze moved out of the settle's transaction, into one of its own after the settle commits | 1.4c (a3) | With the freeze refused, the cost (`model.call`) was written all the same |
| Y5 | The same move | 1.4c (a1) | Two transaction ids instead of one |
| Y6 | The freeze after a late answer above its hold | 1.4c (late) | No freeze |
| Y7 | The refusal's figures (the bill, the hold, the difference) | 1.4c (a1) | The message lacked them |
| Y8 | The refusal of a freeze of another kind, or of a hold with none | 1.4c (c2) | The record went through |
| Y9 | The refusal of a record already made | 1.4c (c2) | A program error instead of the refusal. Nothing was cleared twice: the clearing statement itself only clears a freeze not yet cleared. (Migration 009's trigger also refuses a second clearing; that is read from its text, not shown by this control) |
| Y10 | The check of the evidence | 1.4c (c2) | Blank evidence was accepted |
| Y11 | The refusal of another project's hold | 1.4c (c2) | Refused with the wrong reason |
| Y12 | Clearing only the freeze the record names | 1.4c (c3) | The project's other freeze was cleared too |
| Y13 | The list's section of freezes after a bill above its hold | 1.4c (c3) | The list was empty |
| Y14 | The script's refusal of `--actual` with `--overrun` | 1.4c (c4) | The script ran (exit 0) instead of refusing (exit 1) |
| Y15 | The checker's rule 3 | 1.4c (d) | A bill with no freeze was not flagged |
| Y16 | Rule 3's condition that the freeze is in the same transaction | 1.4c (d) | A freeze in another transaction was not flagged |
| Y17 | The checker's rule 4 | 1.4c (d) | A hold opened while frozen was not flagged |

17 of 17 failed as they should, on a copy of `acb5d5b`.

## Checks

At `acb5d5b`, the code as committed:

- **Type check:** passed (`run-typecheck.txt`).
- **Whole suite**, live tests included, under the shared lock, on `builder_test_p14c`: 16 files, 409 tests passed (`run-tests-full.txt`).
- **Licence check:** passed, for `builder/` and `builder/runner/` (`run-licences.txt`). No package added.
- **Two earlier full runs**, before the code was committed (`run-tests-full-earlier.txt`): the first failed one test, `test/egress.test.ts`, whose request from this machine through the builder's egress proxy to the npm registry got no answer. This package does not touch that path. The registry then answered directly, that test passed alone, and the second full run passed (409 of 409).

## The demonstration (`run-demo.txt`)

From an empty database. Project a's call billed above its hold, frozen in one transaction:

```text
  project a, a call the stand-in says was served in fast mode (not asked for): HTTP 200
  its hold 2: held $0.009960; settled at $0.012284, charged in full; cap $1.0000; spent $0.018426; open holds $0.000000
  project a frozen: yes, freeze 1, kind bill_above_hold, naming hold 2, bill $0.012284
  written by one database transaction (each row's xmin): model.call 829441; hold.settled 829441; hold.exceeded 829441; project.frozen 829441; the freeze's row 829441
  project a's next call: HTTP 402: This project is stopped: a model call that ended at 2026-11-13T11:00:44.645Z was billed $0.012284, more than its hold of $0.009960 (above it by $0.002324). That bill is charged in full. The gateway forwarded nothing, and no further call will be made for this project until the owner records that bill.
  forwarded to the stand-in for it: 0 calls, 0 counting calls
  project b's call: HTTP 200; forwarded: yes; cap $1.0000; spent $0.006142; open holds $0.000000
```

The owner's record of the bill, then project a's next call:

```text
  Bill above its hold recorded for hold 2 of project demo14c_mwev8okc_a
    held:          $0.009960
    billed:        $0.012284, charged in full when the call was settled (nothing is charged now)
    above it by:   $0.002324
    freezes:       cleared 1; the project is not frozen
  its next call: HTTP 200; forwarded to the stand-in: yes; cap $1.0000; spent $0.024568; open holds $0.000000
```

The same record again: refused, exit code 2.

## What it is and is not

- **It is** the freeze after a bill above its hold, and the owner's recorded action that clears it, shown against a stand-in provider, the gateway and the store. **It is not** a screen: the owner asks; Claude Code or an engineer runs the script.
- **It does not stop the first such bill** (gap 114): the bill is known only once the answer is read. It is charged in full and can take spend above the cap. Calls already forwarded still settle, and may freeze the project again.
- **It does not check** who asked, or the evidence, against the provider; a mistaken bill stays charged (gap 115).
- **"The same transaction"** is shown by the rows' transaction ids and by a trigger refusing the freeze, not by a database failing on its own (gap 116).
- **A late answer whose cost cannot be worked out** is not compared with its hold (gap 117); a kept call is compared only on usage figures the gateway read and trusts (gap 144).
- **Design note 5.5** was not changed when this package was built; after the review, a dated note for 1.4c records the answer to question 17 (see "After the review").
- **One adversarial review** has read this package; its blocking item and notes are answered under "After the review".

## After the review (13 November 2026)

One adversarial review read the branch at `0784859` (the code as at `acb5d5b`). On a copy of it, with its own database, it ran the type check (passed), the five budget test files (158 of 158), the 17 controls of `controls.sh` (all failed as they should), the licence check (passed) and the full suite (407 passed; the 2 failures were git commands in `acceptance.test.ts` that cannot work in a copy with no git history, and 82 of 82 passed once the copy had one). It wrote tests of its own against a stand-in. It found **one blocking item** and nine notes.

### The blocking item: a call kept with usage figures above its hold froze nothing

**What the review showed** (its tests X3 and X3b): a streamed call served in fast mode, which was not asked for, priced by its figures at $0.012284 against a hold of $0.009960. The stand-in held its body open after its last event, past the time limit, or the caller left after reading the end marker. The gateway **kept** the hold instead of settling it, wrote the figures into `hold.kept`, compared them with nothing, and forwarded the project's next call. The same held for an error event after the figures and for a stream with no end marker. Only `settleHold` compared a cost with the hold.

**The fix** (commit `25b8bea`):

- **The keep compares the figures with the hold.** `keepHold` (`builder/src/store/holds.ts`) takes the cost worked out from the usage figures read before the call ended. When that cost is above the hold, the same transaction that writes `hold.kept` writes a freeze of a new kind, `kept_above_hold` (migration `builder/src/store/migrations/011_kept_above_hold.sql`), naming the hold, with the cost as read, the hold and the difference. The hold stays open at its full amount, nothing is charged, and the owner's reconciliation of the hold clears the freeze, as for a late answer.
- **The gateway passes the figures it trusts** (`builder/src/gateway/app.ts`). For a streamed call, from every ending that keeps the hold, when the provider's opening event with the prompt's figures was read and no figure fell, no frame was unreadable and fast mode was not taken back (`trusted()`). For a plain answer, when its figures were read but not settled on: no speed stated where the hold allowed for fast mode, or no prompt tokens. The figures are priced at the lower rate wherever the answer leaves the rate open (`leastCost`): the standard speed when the speed is not stated, and the five-minute rate for cache writes the answer does not itemise. Figures in a usage block only grow, so the cost is a floor under the bill. The gateway raises a fault naming the freeze.
- **What the owner sees.** The list (`builder/src/store/reconcile.ts`) shows the hold as "kept above its hold", with its freeze and the cost as read; `scripts/reconcile.ts --list` says so; the record of a bill (`--overrun`) refuses it and names the reason. The caller's refusal: "This project is stopped: a model call that ended at [time], without a bill the gateway could settle, had already used at least $0.012284 by the usage figures read before it ended, more than its hold of $0.009960 (above it by $0.002324). The hold stays counted at its full amount. The gateway forwarded nothing, and no further call will be made for this project until the owner records what that call cost." The wording is Claude Code's, for the owner to confirm (`docs/QUESTIONS.md`).

**The tests** (`builder/test/overrun.test.ts`, commit `0842aaf`). (e1) to (f) run the gateway in this process against the stand-in provider; (g) writes to the database directly:

| Test | Shows | Controls |
| --- | --- | --- |
| 1.4c (e1) the time limit | The provider sends its figures and its end marker, then holds its body open; the gateway's stream limit (0.5 s here; 60 minutes by default) cuts it. The hold is kept open at its full amount and nothing is charged; the project is frozen naming that hold, with the cost as read ($0.012284), the hold ($0.009960) and the difference; the `hold.kept`, the freeze's event and the freeze's row share one transaction id; the gateway raises its fault. The next call is refused (402) with nothing forwarded, no counting call and no hold. The list shows the hold as "kept above its hold"; the record of a bill refuses it; the owner's reconciliation at $0.012284 clears the freeze, and the next call is forwarded. The checker: no rule 3 or 4 broken | Z1, Z3, Z4, Z11, Z12 |
| 1.4c (e2) the caller leaves | The same, the caller leaving once it has read the end marker, before the provider's body ends | Z1, Z3, Z4, Z11 |
| 1.4c (e3) an error event | The same, for an error event after the figures | Z1, Z3, Z4, Z11 |
| 1.4c (e4) no end marker | The same, for a body that ends with no end marker | Z1, Z3, Z4, Z11 |
| 1.4c (e5) a dropped connection | The same, for a connection dropped after the figures | Z1, Z3, Z4, Z11 |
| 1.4c (e6) not frozen | Kept by the time limit below its hold ($0.006142): not frozen, the next call forwarded. Figures that cannot be trusted (the input count falls from 30 to 10, while either way they would price the call above its hold): kept, not frozen | Z5, Z7 |
| 1.4c (f) a plain answer | On a profile that allows fast mode (hold $0.019920), an answer with 1,000 output tokens and no speed stated: kept, priced at the standard rate at $0.020142, above the hold: frozen as in (e1), the record naming the usage as priced. The same with 300 output tokens ($0.006142): kept, not frozen | Z2, Z6 |
| 1.4c (g) the database's checks (the review's note 5) | The database refuses a freeze of each of the three kinds whose bill equals or is below its hold, is not a number, or names no hold; a freeze of an unknown kind; an unrecorded ending with no journal line; and a second freeze of the same kind for the same hold, which the store, writing it twice, returns without writing anything more | Z8, Z9, Z10 |

**Before the fix** (`run-tests-before-fix.txt`): on the code of `0784859` (a git-archive copy holding the new test file, on a database made empty for the run), (e1) to (e5) and (f) failed, each having waited for the project's freeze in vain; (g) failed because the database refused the new kind as unknown before its other checks; (e6) passed, as it should before the fix too, since it checks that nothing freezes. 7 failed, 1 passed.

**After the fix:** 18 of 18 passed in `builder/test/overrun.test.ts` (`run-tests-overrun-after-review.txt`); the five budget test files the review ran, 166 of 166 (the review's 158 and the 8 new) (`run-tests-5files-after-review.txt`).

**Controls** (`controls-after-review.sh`, output in `run-controls-after-review.txt`), each on a git-archive copy of commit `0842aaf`, as before; Z8 to Z10 change a migration, so each runs on a database of its own, made empty for it and dropped after:

| Control | Safeguard removed (on a copy) | Tests | How they failed |
| --- | --- | --- | --- |
| Z1 | The freeze written when a kept call's cost as read is above its hold | (e1) to (e5) | All 5: no freeze appeared (timed out waiting for it) |
| Z2 | The same | (f) | No freeze |
| Z3 | The freeze moved out of the keep's transaction, into one of its own after the keep commits | (e1) to (e5) | All 5: two transaction ids instead of one |
| Z4 | A streamed call's figures as read, passed to the keep | (e1) to (e5) | All 5: no freeze |
| Z5 | The condition that the figures can be trusted (no figure fell, no frame unreadable) | (e6) | Figures that fell froze the project |
| Z6 | A plain answer's figures as read, passed to the keep | (f) | No freeze |
| Z7 | The comparison of the cost as read with the hold | (e6) | A call below its hold was offered to the freeze; the database refused that freeze, so the keep's write failed and the call was recorded as an unrecorded ending, not kept |
| Z8 | Migration 010's check that a freeze's bill is a number above its hold's amount | (g) | A bill equal to its hold was accepted |
| Z9 | That check's refusal of "not a number" | (g) | A bill of "NaN" was accepted (PostgreSQL ranks it above every number) |
| Z10 | One freeze per hold and kind (the index made not unique) | (g) | The store's write, which relies on that index, could not run |
| Z11 | The refusal's message for this kind | (e1) to (e5) | All 5: the message was a late answer's, without "without a bill the gateway could settle" |
| Z12 | The list's kind "kept above its hold" | (e1) | The hold was listed as "interrupted" only |

12 of 12 failed as they should, on a copy of `0842aaf`. The worktree was not edited.

### The notes

| Note | What was done |
| --- | --- |
| 1. A stream is settled, and so frozen, only when the provider's body ends, after the end marker has reached the caller; the next call sent at once was forwarded before the freeze (the review's X2) | **Not fixed; known gap 131.** Holding back the last bytes until the settlement is written would make every caller wait for the provider's end; settling when the end marker is read would stop the gateway reading what follows it, which today's checks read. Each changes how every call is handled. The wording "settled when its last event is read" (test (a2) and the table above) is corrected |
| 2. The freeze is read outside the project's lock before the counting call, and not again between the hold and the forward | **Known gap 146**, with gap 114's calls in flight. No test covers it |
| 3. A settlement that reported failure but had been written leaves two freezes on a settled hold | **Known gap 147**, with gap 100. Read from the code, not shown by a test |
| 4. Decision row 118 says the freeze is cleared through 1.5's reconciliation; the branch adds a new action, not listed for the owner to confirm | **Fixed in the records:** a line in `docs/QUESTIONS.md`, "Yours to confirm" |
| 5. The migration's check and its one-per-hold index are exercised by no test | **Fixed:** test (g), with controls Z8 to Z10 |
| 6. Gap 62's sentence on late answers holds only when the cost can be worked out | **Fixed:** it now points to gap 117, and to gap 144 for kept calls |
| 7. Design note 5.5 still calls question 17 open; plan section 7.3 has no 1.4c row | **Fixed:** a dated note for 1.4c in 5.5 and a change-log row; a 1.4c row in plan section 7.3 |
| 8. The branch's upstream was package 1.5's | Already pushed under its own name: `origin/claude/pkg-1.4c-overrun-freeze` |
| 9. Found sound (one transaction, the clearings, concurrent records and calls) | Nothing to do |

### Checks after the fix

At the files committed as `25b8bea` and `0842aaf` (run just before they were committed; each file's checksum, listed at the top of the full run's output, matches those commits):

- **Type check:** passed (`run-typecheck-after-review.txt`).
- **Whole suite**, live tests included, under the shared lock, on this fix's own database (`builder_test_f14c`): 16 files, **417 tests passed** (409 before, and the 8 new) (`run-tests-full-after-review.txt`).
- **Licence check:** passed, for `builder/` and `builder/runner/` (`run-licences-after-review.txt`). No package added or changed.

### Not shown

- **Pricing at the lower rate** where the answer leaves the rate open is not shown by a test: the stand-in's requests ask for no one-hour cache, so both cache-write rates give the same figure (gap 144).
- **The review's X2 window** (note 1) is not closed (gap 145).
- **No review has read the fix.** The review bot on the pull request is next.

*Renumbered 13 Nov 2026, before the pull request left draft:* gaps 130 to 133 of this package are now **144 to 147** (130 to 139 are J1's, 140 and 141 are 3.1b's, 142 and 143 are 1.4b's). The run outputs kept in this folder were written before the renumbering and keep the old numbers; the test name that named gap 131 now names gap 145.
