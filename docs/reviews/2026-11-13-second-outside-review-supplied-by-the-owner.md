# A second outside review, of integration commit `9f50e5d` and package 1.2 at `7ce5a33`, supplied by the owner

| | |
| --- | --- |
| Supplied | By the owner, Ahmed Sharara, in the working session of 13 November 2026, after pull request #25 was merged. His message began "go ahead." and went on with the review, which addresses him by name; where his own words end and the review's begin is not marked, so the whole message is quoted below as supplied. Who wrote the review is not stated; under the working rule of 12 Nov (`docs/DECISIONS.md`) it is recorded as supplied by the owner, and his own approval of anything in it is kept separate |
| What it read | Integration commit `9f50e5d` and pull request #12's candidate `7ce5a33`. In its own words: "This was source and evidence review, not an independent test run" |
| How it was checked | Read by Claude Code against the repository at `9f50e5d`, at `7ce5a33` and at `90484c1` (the commit merged), file and line below; pull request #12's review thread and the review bot's results read from GitHub's API on 13 Nov 2026. Read-only |
| This file | The review's text as supplied, then each claim checked, and what was done |

## The review as supplied

> go ahead. also Ahmed, the budget implementation has improved, but I would hold PR #12 for a specific defect. The integration branch’s latest changes are documentation and licence records; isolation remains unfixed.
>
> Reviewed integration 9f50e5d and budget candidate 7ce5a33. This was source and evidence review, not an independent test run.
>
> 1. Fix the expired-hold race before merging.
> The GitHub reviewer flagged this, and I confirmed it in the code: settlement checks whether a hold is marked expired, but does not check its actual deadline. If settlement runs after the deadline but before the expiry sweep, it can release reserved money that the stated rule requires keeping.
>
> Check the deadline inside the locked settlement transaction, and add a regression test where settlement wins the race against the sweep. The new releaseUnsentHold function also relies on those flags and should be checked against the intended expiry rule. Source.
>
> 2. The cap still limits admission—not the eventual bill.
> The updated tests explicitly demonstrate a bill exceeding its hold and taking spending above the cap. They also demonstrate that an over-hold fault does not stop subsequent calls when budget remains. Claude now states this honestly, but project freezing and the remaining failure tests must precede real spending. PR #12.
>
> 3. Your “change it later” condition needs an implemented operation.
> Currently changing a project’s cap requires a manual database edit. I support proposed question 13(a): add an audited cap-change operation immediately after this package. It should use the same project lock and define what happens if the new cap is below spending plus outstanding holds. Proposal.
>
> What moved in the right direction: Claude corrected the acceptance proposal to require a separately generated live check before checkpoint 2, documented the broader licence inventory, and proposed resolving the network boundary before generated code runs. Those remain proposals and prerequisites, not implemented safeguards. PR #25.
>
> My recommendation: fix the expiry race, finish the budget failure controls, and schedule the isolation correction as concrete work. Keep the real-model gate closed.

The words "Source.", "PR #12.", "Proposal." and "PR #25." are as supplied; they look like the text of links that did not survive copying.

## What the check found

Files and lines are as they stand at the commit named in each row.

| Claim | Finding | Done |
| --- | --- | --- |
| The integration branch's latest changes are documentation and licence records | **Accurate.** Between `0e8e1f9` and `9f50e5d` (pull request #25), 113 files changed, every one under `docs/` (`git diff --stat 0e8e1f9 9f50e5d`) | Nothing to correct |
| Isolation remains unfixed | **Accurate.** At `9f50e5d`, known gap 60 is open (`docs/KNOWN-GAPS.md`:76), and "The work on this boundary is not yet scheduled" (`docs/STATUS.md`:107, item (xiii)) | Scheduled as package 0.6c (below) |
| Hold pull request #12 for a specific defect | **Followed.** Pull request #12 was not merged at `7ce5a33`. It was merged at `90484c1`, after the fix, on 13 Nov 2026 at 06:15 UTC (merge commit `98f280d`) | Recorded in `docs/DECISIONS.md` (13 Nov) |
| 1. Settlement checks the expired mark, not the deadline; between the deadline and the sweep it can release money the rule keeps; "the GitHub reviewer flagged this" | **Accurate.** At `7ce5a33`, `settleHold` decided from the hold's `expired` and `unreconciled` marks (`builder/src/store/holds.ts`:155) and nothing in it compared the deadline with the clock; holds past their deadline were marked by the sweep every 30 seconds (`builder/src/gateway/app.ts`:720) and at admission. The review bot's finding is on that line (pull request #12, 05:47 UTC). The rule: proof row B5 and design note 5.5, step 4 (`docs/design/stage-1.md`:384) | Shown failing at `7ce5a33` by two new B5 tests (`evidence/2026-11-12-package-1.2/run-2026-11-13-review-bot-before-fix.txt`), fixed in `9dc236d` before the merge: at `90484c1`, `settleHold` marks the project's holds past their deadline first, in its own transaction under the project's lock (`builder/src/store/holds.ts`:148). The regression test where settlement wins the race against the sweep: `builder/test/gateway.test.ts`:646. Control 24 (a): with the check removed, the test fails (`run-tests-with-fixes-removed.txt`) |
| 1. `releaseUnsentHold` also relies on those marks and should be checked against the expiry rule | **Accurate.** At `7ce5a33` it returned on the marks alone (`builder/src/store/holds.ts`:201), so a call never sent closed a hold past its deadline at nothing | Checked and fixed the same way in `9dc236d` (`builder/src/store/holds.ts`:211 at `90484c1`); its own regression test (`builder/test/gateway.test.ts`:663) and control 24 (b). One gap left, money not affected: such a call leaves no record that it was never sent (known gap 62, for package 1.5) |
| 2. The cap limits admission, not the eventual bill; the tests show a bill above its hold taking spend above the cap, and the fault not stopping later calls; Claude states this | **Accurate.** The test "a bill above the hold is charged in full, recorded as a breach, and raises a fault" (`builder/test/gateway.test.ts`:958 at `7ce5a33`): spend above the cap, then "(2) The fault itself stops nothing" (:979). Stated in the evidence file (`evidence/2026-11-12-package-1.2/holds.md`:27 at `7ce5a33`) | Nothing to correct. 1.2 is marked tested as of `90484c1` with this stated as not shown (`docs/DECISIONS.md`, 13 Nov) |
| 2. Project freezing and the remaining failure tests must precede real spending | **Matches the plan and the records.** Package 1.4, the failure tests and the freeze (`docs/BUILD-PLAN.md`:169 at `9f50e5d`), is a dependency of 2.3, the first real call (:180); Claude Code's stance: no real model call on 1.2's code before the project is stopped when a finished call cannot be saved (`docs/STATUS.md`:68) | Unchanged; the order of work (below) takes 1.3, 1.4 and 1.5 next after 1.2b |
| 3. Changing a project's cap requires a manual database edit | **Accurate.** The cap is written only when a project is created (`builder/src/store/projects.ts`:12-14 at `90484c1`); known gap 64 (`docs/KNOWN-GAPS.md`:80 at `7ce5a33`); `docs/STATUS.md`:72 at `9f50e5d` | The owner answered question 13 ("a, add the cap change after 1.2"): package 1.2b |
| 3. The operation should use the same project lock and define what happens if the new cap is below spending plus outstanding holds | **Not yet defined at `9f50e5d`:** question 13 (a) named the lock and the event (`docs/STATUS.md`:74), not that case | Package 1.2b defines it: such a lowering is accepted, the open holds stay as they are, and the next call that does not fit is refused, shown by a test that fails with its safeguard removed (`docs/BUILD-PLAN.md`, section 7.3) |
| A separately generated live check before checkpoint 2; the licence inventory; resolving the boundary before generated code runs; these remain proposals, not safeguards | **Accurate.** Question 12's recommended option, not yet answered (`docs/STATUS.md`:103); `docs/licences/runtime-inventory.md`; item (xiii), "yours to confirm" (`docs/STATUS.md`:107) | Question 12 still waits on the owner. Question 11 (a) was approved by the owner the same day, for internal development and testing only (`docs/DECISIONS.md`, 13 Nov). The boundary is now scheduled work (below) |
| Recommendation: fix the expiry race, finish the budget failure controls, schedule the isolation correction as concrete work, keep the real-model gate closed | **The records now follow it.** No real model call has been made by this project (`docs/STATUS.md`:13) | Race fixed before the merge (above). Order of work: 1.2b, then 1.3, 1.4 and 1.5. Package 0.6c, the development profile's network boundary, added to the plan, its design drafted in parallel and read by an engineer or put to the owner before it is built. Package 2.3, the first real call, now depends on 0.6c as well as 1.4 (`docs/DECISIONS.md`, 13 Nov; `docs/BUILD-PLAN.md`, sections 7.2 and 7.4) |

## What was done

- **The race:** fixed before the merge (`9dc236d`), with a regression test for each of `settleHold` and `releaseUnsentHold`, both shown failing at `7ce5a33` and passing at `90484c1`, and control 24. A fresh reader re-ran them against copies of both commits; the review bot had no findings at `90484c1`.
- **The cap change:** package 1.2b, scheduled by the owner's answer to question 13, under the project's lock, with a `cap.changed` event, and a defined result when the new cap is below spent plus open holds.
- **Isolation:** package 0.6c, scheduled as concrete work; how it is done changes design note 2.5, so its design is put to the owner, with an engineer, before it is built. The reading of "resolved" in known gap 60 stays Claude Code's, for the owner to confirm.
- **The real-model gate:** stays closed until 1.4 and 0.6c are tested, among 2.3's other dependencies.
- Nothing is approved by this file.
