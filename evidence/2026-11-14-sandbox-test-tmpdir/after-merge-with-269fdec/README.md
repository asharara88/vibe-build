# After bringing pull request #39 up to date with `claude/stage-1` at `269fdec` (14 Nov 2026)

Written by Claude Code. Run on the development machine (a cloud session), a fresh one: the two sandbox images and the
approved browser zip were there, the acceptance runner's image was not. No model was called.

| Check | On | Result | File |
| --- | --- | --- | --- |
| Type check | `6299f89` | Passed | `run-typecheck.txt` |
| Licence check | `6299f89` | Passed | `run-licences.txt` |
| The whole suite, live tests included, fresh database, under the shared lock | `6299f89` | **744 of 749 passed, 5 failed.** All five are in `test/preview-live.test.ts`, each because "the runner image builder-acceptance-runner:local is not on this machine": known gap 162, a fresh machine, not this change. No test folder was left in the temporary folder (only `node-compile-cache` and `tsx-0`, as this pull request's own evidence says) | `run-tests-full.txt` |
| The fix for gap 162: `test/preview-live.test.ts` builds the runner image itself when it is not on the machine | `6299f89` with that one file changed | The image removed first (`docker rmi`), then that file run alone: **6 of 6 passed**, and the image was on the machine afterwards | `run-preview-live-without-image.txt` |

**What this shows.** Every test of the suite passed on this code: 744 in the whole-suite run, and the remaining five (with
their file's sixth) once the file builds the image it needs. **What it does not show:** the whole suite green in one run
on a fresh machine with the fix in; the next whole-suite run (package J2's) is that run. The type check was run again
after the change to the test file and passed; its output was not kept.

**The fix.** In the file's set-up, after the prerequisites: if, and only if, `runnerImageProblem` says the image is not
on the machine, it is built with `buildRunnerImage`, as `test/acceptance-live.test.ts` builds it. An image that is there
with the wrong label is left alone, so the tests still fail on it. No assertion was changed.
