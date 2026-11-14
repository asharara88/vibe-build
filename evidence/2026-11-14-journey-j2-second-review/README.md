# J2, second review: evidence for pull request #49

| | |
| --- | --- |
| What | The extra fixes from J2's second review, on top of J2 as merged (pull request #48). The review and its findings: `docs/reviews/2026-11-14-journey-j2-second-review.md` |
| Written | 14 November 2026, by Claude Code |
| Code | Commit `f8cfc57` (`builder/` tree `37ae8c2`). Its difference from `claude/stage-1` at `51a1321` is 10 files of `builder/`, about 120 lines, and J2's controls list |
| Machine | The development machine (a cloud session). Real Docker for the live tests and the automated run. The scripted engine only: no model was called and no gateway started. Made-up data only |
| How it was run | `full-checks.sh` in this folder, once, start to end; every step that starts containers under the shared lock |

## Results

| Check | Result | File |
| --- | --- | --- |
| The six tests these fixes add or extend, with the fixed files as on `claude/stage-1` | **6 of 6 failed**, as they should without the fixes | `new-tests-before-and-after.txt` |
| The same six, as committed | **6 of 6 passed** | the same file |
| Every control of J2's list: each safeguard removed in turn, its tests run, the files restored | **51 of 51** failed their tests with the safeguard removed; before that, every named test passed alone; the tree was unchanged after every control | `controls-output.txt` |
| The whole suite, live tests included, fresh database | **789 of 789 passed** in 31 files, in one run (1,044 s). No container on the machine before or after | `run-tests-full.txt` |
| Type check | Passed | `run-typecheck.txt` |
| Licence check | Passed. No dependency file is changed | `run-licences.txt` |
| J2's automated run (`scripts/demo-journey-j2.ts`) | **153 of 153 checks passed**; 41 of 41 screenshots; exit code 0. It was 150 before: the three new checks are the limit sentence on the checklist screen, and step 2's job found in the record on each of the two restart paths | `run-demo.txt`, `lock-lines.txt`, `events.json`, `camera-lines.jsonl`, `interface-log.txt` |

789 is the 787 of pull request #48's last run plus the two new tests (A4c and C12). This is also the first whole-suite run in one piece on a machine that began the day without the runner image since known gap 162 was fixed; the image had been built earlier in this session, so it does not show the fix again.

## What each fix is shown by

| Fix | Test | Control |
| --- | --- | --- |
| A step of an interrupted project is not approved | C12 (`test/web.test.ts`): a new interface on the same record is refused, with the reason, and nothing is written | J2-C46 |
| At a clean stop the journey is halted before the live preview's stop is awaited | C12: the halt's reason is already set when the preview's stop is called | J2-C47 |
| A link at any folder the broken step is copied through is refused | A4c (`test/journey.test.ts`): a link at each of the three folders; plain folders accepted; the real adapter's own check refuses too; nothing written to the link's target | J2-C48, J2-C49 |
| The demonstration's limit is on the Projects panel and on a broken copy's checklist screen, in both languages | "A2 and A8" and "A8: the broken copy through the screens"; the automated run's camera check | J2-C51 |
| The interrupted project's sentence no longer says its containers "were removed" | C7 pins the new sentence | none: a wording change |
| Rule N counts a process whose command line holds the sandbox's folder | C8, three new cases | J2-C50 |
| The automated run: a job not found is a failed check; ids and folders checked before clean-up; the log checked for the password | Shown only by the run passing with them in (two of the three new checks). No test makes a job go missing, an id malformed or a password appear | none |

## Screenshots (`screens/`, 6 of the run's 41)

Only the two screens these fixes change are kept here; the other 35 are as in `evidence/2026-11-13-journey-j2/screens/`, from J2's own run. `01-projects-en`, `-ar`, `-phone`: the "Simulated build" panel with the new sentence. `07-checklist-en`, `-ar`, `-phone`: the broken copy's checklist reading Failed, with the new sentence under the sign-off panel.

## Checked and assumed

- **Checked by running:** everything in the table above, on the commit named.
- **Checked by looking:** `07-checklist-en.png` of an earlier run of the same code path shows the sentence where the test says it is. The six pictures here were not each opened.
- **Not re-read by a reviewer when this was written:** the fixes themselves. A fresh review of this pull request's difference was started after the runs; its result is in the pull request and in the review's record.
- **Assumed:** that a real provider, a real engine and a slower machine change nothing here; none is involved.

## Left on the machine

After the whole suite: nothing but npm's and tsx's own caches. The three `builder-acceptance-standin-*` folders the suite's log lists (2.3 MB each) are dated 10:49 and 10:50 UTC, before the suite started at 10:50:54: they were left by controls, whose tests fail on purpose and so do not reach their own clean-up. Tried afterwards: C1 to C4, C11 and C12 each run alone leave no such folder.

## Not done

- The stop with the live preview on and a session open; Ctrl-C to the process group; a service manager; a PostgreSQL restart: not tried (gap 179).
- A removal made to fail, so that `removed: false` is shown: not built (gap 180).
- The older lock-lost path still stops the live preview before it halts the journey (gap 179, point 11).
