# Second review of package J2, 14 November 2026

Written by Claude Code (the session behind pull request #49).

**Why there is a second review.** Two sessions finished J2 at the same time without knowing of each other. One built J2, had it reviewed (two adversarial reviewers, a check of claims, then the review bot) and merged it as pull request #48. The other, which had started from `main`'s out-of-date record, took up the same branch at an earlier commit (`5a2254d`), merged it with the day's fixes (commit `a84b80c`) and gave it to three fresh reviewers. This file records those three. The two sessions then agreed by message that #48 is J2 and that pull request #49 carries only what #48 does not already have.

**Who reviewed, and what they were given.** Three fresh reviewers. None wrote the code and none saw an author's conversation. Each had the design (`docs/design/journey-j2.md`), the author's evidence as it stood at `5a2254d`, the code and its change, the project rules, the build plan's review rules, the decisions of 13 and 14 November, and the open gaps on this area. Two parts were reviewed adversarially (try to break it): part (a)'s path to the acceptance runner, and part (c)'s removal of containers at a stop. Everything else had one careful review.

**What they read is not what was merged.** They read `a84b80c`. Pull request #48 merged a later state of J2, with its own first-round fixes. Where #48 had already answered a point, the table says so. Nobody has re-read the fixes of pull request #49: they are shown by tests and controls only.

**Result: no reviewer found a blocking defect in the code, and none found an existing check weakened, removed or edited.** "Blocking" means: it breaks a hard rule, or it leaves an item of "Done means" unmet.

## Reviewer A: part (a), the broken copy's path to the runner (adversarial)

Found sound: no request, name, replayed form, concurrent request or restart makes a normal project build the broken step; no route gets a broken copy signed off, exported or opened live; the rule for the live app, combined with the sign-off fix of the same day, is in the right order; the checklist run uses the tests fixed at plan confirmation. It ran part (a)'s 22 tests on `a84b80c`: 22 passed.

| # | Finding | Blocking | Where it stands |
| --- | --- | --- | --- |
| A1 | No control had a recorded result at `5a2254d`; one control no longer matched the merged code | For the evidence | Answered by #48 (its controls were run on its merged code) |
| A2 | J2's gaps and the owner's answer were not in the records | No | Answered by #48 |
| A3 | Some safeguards had no test that fails without them: one arm of the "any trace" rule, the validation of the choice, the real adapter's own check | No | The "any trace" arm: #48 (test A6b). The real adapter's check: **#49** (test A4c, control J2-C49). The malformed choice: gap 184 |
| A4 | Staging could write outside the sandbox through a linked folder one level down. Only a process with write access to the sandbox's folder on the machine could plant the link | No | #48 reads the real path of the top folder. **#49** also refuses a link at any folder the copy goes through (test A4c, control J2-C48) |
| A5 | The name refusal is passed by look-alike names | No | Answered by #48 (gap 182) |
| A6 | The run's events file was in text order, not id order | No | Answered by #48 |
| A7 | The demonstration's limit was on no screen; small points on a broken copy's screens; the app's banner text copied into the builder's lines | No | The limit: **#49** (`demo.limit`, both languages, control J2-C51). The rest: gaps 176 and 183 |

## Reviewer B: part (c), the clean stop and the recovery (adversarial)

Found sound: removal is by exact project id from this interface's own database, only while it holds its lock, every wait bounded; no path removes anything of another project or interface. The step's reservation closes once, only after the engine's process has ended; J2 changed no reservation code. The pause comes only from the process's settings.

| # | Finding | Blocking | Where it stands |
| --- | --- | --- | --- |
| B1 | The record can say `removed: true`, and the interface can exit 0 saying "removed", with containers or images left, and nothing then retries | No | Gap 180, with the fix planned and not built. **#49** corrects the screen sentence that stated removal as a fact |
| B2 | A step of an interrupted project could still be approved by a direct request (nothing was then built) | No | **#49** (test C12, control J2-C46) |
| B3 | "Never removes once the lock is lost" says more than the code does | No | Gap 179, points 9 and 12 |
| B4 | The stop with a live session open, or a sign-off in flight, is not tested | No | Gap 179, points 10 and 13 |
| B5 | The halt came after the live preview's stop, leaving seconds in which a request in flight could start a job | No | **#49** for the clean stop (test C12, control J2-C47). The older lock-lost path keeps the old order: gap 179, point 11 |
| B6 | Under `npm run web`, a signal to the whole process group can count as a second signal | No | Gap 179, point 14 |
| B7 | Signals are caught only once the start has finished; SIGHUP is not caught | No | Gap 179, point 15 |
| B8 | Rule N's process check could miss the builder's own Docker commands, which name the folder | No | **#49** (test C8 extended, control J2-C50) |
| B9 | Other untested behaviour of the stop | No | Gap 179, point 16; gap 184 |

## Reviewer C: everything else, and the claims against the evidence

Found sound: the run's counts matched its log; every new message is in both languages with the same placeholders; every label the design asks for is where the design puts it; all output is escaped; nothing reads as a claim of security, readiness or independent acceptance. J2's test change removed or changed 16 existing lines, none of them an assertion, a test name, a time limit or an expected value.

| # | Finding | Blocking | Where it stands |
| --- | --- | --- | --- |
| C1, C2 | No control output and no whole-suite run existed at `5a2254d` | For the evidence | Answered by #48 |
| C3 | Events read in text order | No | Answered by #48 |
| C4 | Two groups of record checks would be skipped, uncounted, if a job id were not found | No | **#49:** a job not found is a failed check |
| C5 | Some checks weaker than the design's words | No | Gap 184 |
| C6 | "Its containers were removed" shown even when the record says the removal failed | No | **#49:** the sentence no longer states it as a fact |
| C7 | Small screen points | No | Gap 176 |
| C8 | The real adapter's target check had no test | No | **#49**, as A3 |
| C9 | The run script: the log not checked for the password; ids and folders not checked before clean-up | No | **#49** for those three. Left: gap 184, point 9 |

## Not looked at by any of the three

The Arabic wording itself; 37 of the 41 screenshots; Ctrl-C, a service manager and a PostgreSQL restart for real; the code of #48 after `5a2254d`; the fixes of #49.
