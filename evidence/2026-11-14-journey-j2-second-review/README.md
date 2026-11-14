# J2, second review: evidence for pull request #49

| | |
| --- | --- |
| What | The extra fixes from J2's second review, on top of J2 as merged (pull request #48). The reviews and their findings: `docs/reviews/2026-11-14-journey-j2-second-review.md` |
| Written | 14 November 2026, by Claude Code |
| Code | Commit `51a68d3` (`builder/` tree `b737641`). It differs from `abe41e5` (`builder/` tree `f942582`), on which most checks below ran, by one added line and its comment in one test (`test/journey.test.ts`, the race described below) |
| Machine | The development machine (a cloud session). Real Docker for the live tests and the automated run. The scripted engine only: no model was called and no gateway started. Made-up data only |
| How it was run | `full-checks.sh` in this folder, once, on `abe41e5`, with nothing committed while it ran; then, after the one failure was understood and the test fixed, the type check, the licence check and the whole suite again on `51a68d3` |

## Results

| Check | On | Result | File |
| --- | --- | --- | --- |
| The seven tests these fixes add or extend, with the fixed files as on `claude/stage-1` | `abe41e5` | **7 of 7 failed**, as they should without the fixes | `new-tests-before-and-after.txt` |
| The same seven, as committed | `abe41e5` | **7 of 7 passed** | the same file |
| Every control of J2's list: each safeguard removed in turn, its tests run, the files restored | `abe41e5` | **53 of 53** failed their tests with the safeguard removed; before that, every named test passed alone; the tree was unchanged after every control | `controls-output.txt` |
| The whole suite, live tests included, fresh database | `abe41e5` | **789 of 790 passed, 1 failed.** A red run, kept as it is. The cause is below | `run-tests-full-abe41e5-one-failed.txt` |
| The whole suite again, after the fix to that one test | `51a68d3` | **790 of 790 passed** in 31 files, in one run (1,048 s). No container on the machine before or after | `run-tests-full.txt` |
| Type check | both | Passed | `run-typecheck.txt`, `run-typecheck-51a68d3.txt` |
| Licence check | both | Passed. No dependency file is changed | `run-licences.txt`, `run-licences-51a68d3.txt` |
| J2's automated run (`scripts/demo-journey-j2.ts`) | `abe41e5` | **153 of 153 checks passed**; 41 of 41 screenshots; exit code 0 | `run-demo.txt`, `lock-lines.txt`, `events.json`, `camera-lines.jsonl`, `interface-log.txt` |

790 is the 787 of pull request #48's last run plus three new tests (A4c, C12, C13).

## The one red run, and its cause

The whole-suite run on `abe41e5` failed one test: "is refused when Compose does not read the check service as on front alone" (`test/journey.test.ts`), a test of package J3 that this pull request does not otherwise touch. Its error was "A job is running for this project; wait for it to end."

**Cause: a race in the test, not in the code under test.** The refusal it checks comes from inside the live job and reaches the caller before that job's ending is written; the test then closed its project at once. Usually the ending is written first. This once it was not.

**Shown on purpose** (`race-shown.txt`): with a 300 ms delay put before a job's ending is written, the test as it was fails with exactly that error; with the delay and a wait for the job before the close, it passes; with the delay taken out again, it passes 10 times of 10. The delay was never committed.

**The fix:** the test waits for the job to end before it closes the project, as the tests around it do. No assertion was changed. The same race could not be found by reading in the other tests that close a project after a refusal: their refusals come before any job starts.

**What this is not:** a product defect. In the product the same moment would show the owner "A job is running for this project; wait for it to end" if he pressed "Close project" within milliseconds of a refused "Open the live app".

## What each fix is shown by

| Fix | Test | Control |
| --- | --- | --- |
| A step of an interrupted project is not approved | C12 (`test/web.test.ts`): a new interface on the same record is refused, with the reason, and nothing is written | J2-C46 |
| At a clean stop the journey is halted before the live preview's stop is awaited | C12: the halt's reason is already set when the preview's stop is called | J2-C47 |
| The wait for a job that will not stop counts from the halt | C13: behind a preview whose stop outlasts the wait, nothing more is waited | J2-C53 |
| A link at the three folders above the copy is refused; whatever is at the step's own folder is removed, never followed, before the copy | A4c (`test/journey.test.ts`): a link at each of the three folders; links inside an existing step folder; a file where a folder should be; plain folders accepted; the real adapter's own check | J2-C48, J2-C49, J2-C52 |
| The demonstration's limit is on the Projects panel and on a broken copy's checklist screen, in both languages | "A2 and A8" and "A8: the broken copy through the screens"; the automated run's camera check | J2-C51 |
| The interrupted project's sentence no longer says its containers "were removed" | C7 pins the new sentence | none: a wording change. The sentence still states the removal without condition (gap 180) |
| Rule N counts a process whose command line holds the sandbox's folder | C8, three new cases | J2-C50 |
| The automated run: a job not found is a failed check; ids and folders checked before clean-up; the log checked for the password; a bad id reported from inside the run's own handling | Shown only by the run passing with them in (two of its three new checks). No test makes a job go missing, an id malformed or a password appear | none |

## Screenshots (`screens/`, 6 of the run's 41)

Only the two screens these fixes change are kept here; the other 35 are as in `evidence/2026-11-13-journey-j2/screens/`, from J2's own run. `01-projects-en`, `-ar`, `-phone`: the "Simulated build" panel with the new sentence. `07-checklist-en`, `-ar`, `-phone`: the broken copy's checklist reading Failed, with the new sentence under the sign-off panel.

## Checked and assumed

- **Checked by running:** everything in the table above, on the commit named in its row.
- **Checked by looking:** `01-projects-en.png` and `07-checklist-en.png` show the sentence where the tests say it is. The reviewer of this pull request opened all six of an earlier run of the same screens.
- **Not run on `51a68d3`:** the before-and-after, the controls and the automated run. They ran on `abe41e5`; the one line that differs is in a test none of them runs.
- **Not re-read by a reviewer:** the fixes made after this pull request's own review (`docs/reviews/2026-11-14-journey-j2-second-review.md`, last table).
- **Assumed:** that a real provider, a real engine and a slower machine change nothing here; none is involved.

## Left on the machine

After each whole suite: nothing but npm's and tsx's own caches, and `builder-acceptance-standin-*` folders dated before the suite began: they are left by the controls, whose tests fail on purpose and so do not reach their own clean-up.

## Not done

- The stop with the live preview on and a session open; Ctrl-C to the process group; a service manager; a PostgreSQL restart: not tried (gap 179).
- A removal made to fail, so that `removed: false` is shown: not in this pull request (gap 180; its fix follows in a pull request of its own).
- The older lock-lost path still stops the live preview before it halts the journey (gap 179, point 11).
