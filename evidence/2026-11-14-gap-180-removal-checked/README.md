# Known gap 180's fix: a removal is recorded as done only when Docker lists nothing of the project

| | |
| --- | --- |
| What | The fix of known gap 180 (`docs/KNOWN-GAPS.md`), found by J2's second review (finding B1): the record could say a project's containers were removed, and the interface could exit 0 saying so, with containers or images left, and nothing then tried again |
| Written | 14 November 2026, by Claude Code. Brought up to date the same day, after the fix's own review: the sections "Results after the review" and "Review and answers" are new, and the others are corrected where the code changed |
| Code | **Before the review:** commit `7433518` (`builder/` tree `783af9f`), on `claude/stage-1` after pull request #49. **After the review's fixes:** commit `df3b3c0` (`builder/` tree `dd9d7c8`), with the controls script of commit `46a7c83`, on the branch `tmp/gap180`. The output files name commit `b86680a`, the commit after those two, which changes documents only: its `builder/` tree is the same `dd9d7c8`. Not pushed, not merged |
| Machine | The development machine (a cloud session). Real Docker for the live tests. The scripted engine only: no model was called. Made-up data only |
| How it was run | Before the review: `full-checks.sh` in this folder, from a side working copy; then the whole suite a second time (see "The red run"). After the review: `after-review/checks.sh` |

## Read this first

There are two sets of results here, and they are on two different states of the code.

- **Before the review** (commit `7433518`): the whole suite, 58 controls, the type check and the licence check. These results say nothing about the code as it is now.
- **After the review's fixes** (`builder/` tree `dd9d7c8`): the type check, the licence check, the real-Docker test file, the tests of the stop, the close and the removal, the two test files they sit in, and all 79 controls. **The whole suite was not run after the review's fixes**, and J2's automated run was not repeated.
- **Nobody has re-read the fixes made after the review.** They are shown by tests and controls only.

## What changed, in plain words

- **One checked ending for every removal.** At "Close project", at a stop on purpose and at the next start, removing a project's sandbox ends in the same function. It removes what is left of the project by its Compose label, then reads Docker's own lists of containers, volumes, networks and images. Only if they hold nothing of the project is the project's folder removed and the removal reported as done.
- **If something is left,** the folder is kept, and the record says `removed: false` and names what is left. The sandbox stays in the record, so the next start, or the next "Close project", tries again.
- **"Close project" does not close a project whose removal left something.** It says what happened and what is left.
- **Docker's lists that cannot be read are not read as "nothing left".**

Added after the review:

- **No name can fool the check.** Docker's lists are read one JSON object a line. Before, a tab in a network's name hid the network from the check.
- **The check asks the same Docker as the sandbox does,** has a time limit, and records Docker's own words when Docker cannot be asked.
- **A folder that cannot be removed is reported like anything else left.** Before, it gave a plain error and a project that no later try could remove.
- **At a start, a project whose removal left something is named,** and is no longer counted as "removed at start".
- **After a refused "Close project" the project is "removal not finished".** Nothing of it is built, previewed, checked, approved, signed off, exported or opened any more. Its screens offer only "Close project", which tries again, and "New project".
- **The screen says what the last try recorded as left.** It no longer says "Still listed by Docker", which was not true in every case.

## Results after the review (`builder/` tree `dd9d7c8`, run 14 Nov 2026 by `after-review/checks.sh`)

| Check | Result | File in `after-review/` |
| --- | --- | --- |
| Type check | Passed | `run-typecheck.txt` |
| Licence check | Passed. No dependency file is changed | `run-licences.txt` |
| `test/removal-live.test.ts`, on real Docker, under the shared lock | **7 of 7 passed.** Nothing of the test left on the machine before or after (containers, networks, volumes: 0) | `run-removal-live.txt` |
| The tests of the stop, the close and the removal, by name filter: C1 to C7, C9, C11 to C15, C17 to C19 and C4b in `test/web.test.ts`; C6, C8, C10, C16, C20 to C22 and the broken copy's record checks in `test/journey.test.ts` | **25 of 25 passed** (17 and 8) | `run-named-tests.txt` |
| The whole of `test/journey.test.ts`, once | **75 of 75 passed** | `run-journey-whole.txt` |
| The whole of `test/web.test.ts`, first run | **77 of 78. 1 failed.** A red run, kept as it is: an older test, C13, failed in its own clean-up. The cause is below | `run-web-whole-first-run-1-failed.txt` |
| The whole of `test/web.test.ts`, second run | **78 of 78 passed** | `run-web-whole-second-run.txt` |
| Every control whose tests start no container: each safeguard removed in turn | **73 of 73** failed their tests with the safeguard removed; every named test passed alone first; the tree unchanged after every control | `controls-output-no-container.txt` |
| The six controls whose tests need real Docker, under the shared lock | **6 of 6** failed their tests with the safeguard removed; the tree unchanged; nothing left on the machine | `controls-output-real-docker.txt` |
| The whole suite | **Not run** after the review's fixes | |
| J2's automated run (`scripts/demo-journey-j2.ts`) | **Not run** after the review's fixes | |

79 controls: the 53 of pull request #49, the five of the fix (J2-C54 to J2-C58; the texts of J2-C54 and J2-C55 were updated where the code moved) and 21 for the review's fixes (J2-C59 to J2-C79). The two test files now hold 78 and 75 tests: 75 and 72 before, plus C17, C18, C19 and C20, C21, C22. The real-Docker file holds 7 tests: 3 before, plus 4.

## Results before the review (commit `7433518`)

These are the results the reviewers had. They are not results on the code as it is now.

| Check | Result | File |
| --- | --- | --- |
| The new tests with the fixed files as on `claude/stage-1`: C14, C15 (`test/web.test.ts`), C16 (`test/journey.test.ts`), and the real-Docker file `test/removal-live.test.ts` | **All failed.** This does not by itself show the old behaviour. The test files import names the old code does not have (`dockerLeftovers`, `SandboxNotRemoved`, the new reasons), and a test fails for that alone: the real-Docker file's output shows one such failure ("dockerLeftovers is not a function") and one that is the old behaviour itself (the removal said "containers removed: 0; folder removed" with a network left). For C14, C15 and C16 the file keeps only "1 failed", not why. What ties each test to its safeguard is its control | `new-tests-before-and-after.txt` |
| The same, as committed at `7433518` | **All passed**: C14, C15, C16, and 3 of 3 on real Docker. Nothing of the live test left on the machine | the same file |
| Every control of the journey's list: each safeguard removed in turn | **58 of 58** failed their tests with the safeguard removed (the 53 of pull request #49 and five for this fix); the tree unchanged after every control | `controls-output.txt` |
| The whole suite, first run | **785 of 796. 11 failed.** A red run, kept as it is. The cause is below | `run-tests-full-linked-packages-11-failed.txt` |
| The whole suite, second run | **796 of 796 passed** in 32 files, in one run (1,052 s). No container on the machine before or after | `run-tests-full.txt` |
| Type check | Passed | `run-typecheck.txt` |
| Licence check | Passed. No dependency file is changed | `run-licences.txt` |

796 is the 790 of pull request #49 plus six new tests.

## What each part is shown by

Results in this table are those after the review, unless a row says otherwise.

| Part | Test | Control |
| --- | --- | --- |
| A removal that leaves something throws, names what is left and keeps the folder; once nothing holds it, the same removal removes everything and the folder | `test/removal-live.test.ts`, on real Docker: a network carrying the project's label, held in use by a container that is not the project's. The container that is not the project's is not touched | J2-C54 |
| The same through the removal with a handle, the path "Close project" and a clean stop take in a running interface | `test/removal-live.test.ts`: the real adapter's `destroy` with a hand-made handle, the network held | J2-C78 |
| A labelled network with a tab in its name is seen; a network that is not the project's, with a line break in its name, is not reported | `test/removal-live.test.ts`, on real Docker; C21 on a made-up docker program | J2-C59, J2-C60 |
| A folder that cannot be removed is reported as left with the error's code; its compose file is kept for last, so the folder still passes its own check | `test/removal-live.test.ts`: one file made unremovable with `chattr +i` | J2-C61, J2-C62 |
| A recorded folder that fails its own check is left as it is; Docker's side is removed and checked all the same; the removal reports both | `test/removal-live.test.ts`: a folder with no compose file, a volume and a held network of the project | J2-C63 |
| Docker's lists that cannot be read are not read as nothing left | C16 | J2-C55 |
| Docker's own words, not the command line; a time limit on the four lists | C21 | J2-C74, J2-C75 |
| The sandbox's own Docker settings; a Docker context the sandbox refuses is reported, on both removals, and nothing is asked or removed | C22 | J2-C77 |
| At a stop: `removed: false` with what is left, the project left for the next start, exit 1. The next start tries again; its lines name the project left and do not count it as removed. The screen says what the last try recorded as left, left to right, with the button's own words | C14 | J2-C57, J2-C58, J2-C64, J2-C65, J2-C73, J2-C76 |
| "Close project" refused, saying what happened and what is left; recorded; the project not closed; pressed again with nothing left, it closes | C15 | J2-C56, J2-C58, J2-C66, J2-C73 |
| "Removal not finished": every job, approval and sign-off refused with one sentence, through the journey and the routes; only "Close project" and "New project" offered; the same from the record alone; the stand-in stops the app before it reports | C17, C19 | J2-C67 to J2-C71 |
| A stop with two projects, one left and one removed: the record, the lines and the exit code of each | C18 | J2-C79 |
| The three reasons written with `removed: false` do not hold "removed"; the automated run's record checks do not take them for a completed removal | C20 | J2-C72 |

## The red run before the review, and its cause

The first whole-suite run failed 11 live tests in four files (`acceptance-live`, `isolation`, `preview-live`, `sandbox`), every one at the same place: the container `egress-host`, the machine side of a project's door, exited with code 1.

**Cause: the side working copy, not the code.** That container runs `node --import tsx` with the builder's folder mounted into it, so it needs `builder/node_modules` inside that mount. This run was made from a side working copy in which `node_modules` was a symbolic link to another folder on the machine. Inside the container that folder does not exist.

**Shown** (`eleven-failures-cause.txt`): one of the four files, `test/sandbox.test.ts`, run alone on the same commit: it failed with the link, with a long and with a short temporary-folder path (the first guess, known gap 175's long path, was wrong); it passed 23 of 23 once the link was replaced by a real copy of the same installed packages. The whole suite then passed.

**What it does not say:** anything about this fix. The tests that failed do not use the changed code.

## The red run after the review, and its cause

The first whole run of `test/web.test.ts` reported C13 failed, 77 of 78. C13 is an older test of the stop's waiting time; nothing in it is changed on this branch.

**What failed is the test's clean-up, not an assertion.** The error, "permission denied to terminate process", is thrown where the test drops the database it made for itself (`drop database … with (force)`). PostgreSQL's own log has the same line for that statement.

**Checked** (`after-review/web-whole-first-run-cause.txt`): the tests connect as a role that is not a superuser; it is the only such error in PostgreSQL's log on this machine; the database could be dropped a moment later; C13 passed alone a minute before, on the same commit; the whole file passed 78 of 78 in the second run.

**Inferred, not seen:** which connection PostgreSQL would not let the test end. Most likely one of PostgreSQL's own background workers visiting the new database. And that C13's own assertions passed in that run: an error thrown in a test's clean-up takes the place of an earlier one in the output.

**Recorded** as known gap 185: any test that drops its own database this way can fail like this, for a reason outside the code under test.

## Review and answers

Three fresh reviewers read the fix at commit `7433518`: one for isolation, one for the journey, one for rules and claims. None found anything blocking. They made 21 points, seven each; several are the same point seen from another side. Their findings, as they gave them, are in `docs/reviews/2026-11-14-gap-180-removal-checked.md`. "Row 180" below is the gap's row in `docs/KNOWN-GAPS.md`.

### Reviewer 1: isolation

| # | Finding | What was done | Left |
| --- | --- | --- | --- |
| 1.1 | A tab in a network's name hides a labelled network from the check; a line break can raise a false alarm | Fixed. The lists are asked and read one JSON object a line; a line that cannot be read is "Docker could not be asked". The reviewer's case is a test on real Docker; C21. Controls J2-C59, J2-C60 | J2's automated run still reads its own lists the old way: row 180 (f) |
| 1.2 | A folder that cannot be removed in full gives a plain error; afterwards every try is refused before Docker is asked | Fixed, in three parts: the failure is reported as left, with the error's code; the compose file is removed last; a folder that fails its own check no longer stops Docker's side from being removed and checked. Two tests on real Docker. Controls J2-C61 to J2-C63 | Such a project cannot be closed from the interface until someone deals with the folder: row 180 (g). The folder is not renamed before removal, as the reviewer also suggested |
| 1.3 | The start line counts a project whose removal left something as "removed at start" | Fixed. A new method beside `recoverInterrupted` returns what was removed and what was left; the start prints one line for each project left, in the stop's words, and counts only the others. C14. Controls J2-C64, J2-C65 | The lines are tested through the function `main.ts` calls, not by starting an interface with a project left: row 180 (l) |
| 1.4 | The refusal of "Close project" says "Nothing else was changed" after the removal removed what it could | Fixed. The refusal says what happened; the advice to restart is gone; the project is then "removal not finished". C15, C17, C19. Controls J2-C66 to J2-C71 | The live session's end is still recorded as "project_closed": row 180 (e) |
| 1.5 | When Docker cannot be asked, the record names the command, not the reason; the screen says "Still listed by Docker"; no time limit | Fixed. Docker's own last line is recorded; the four lists have a time limit of 60 s, and so have the sweep's own commands; the sentence is reworded. C21, C14, C15. Controls J2-C74, J2-C75 | One sentence serves every case, not one sentence each. The time limit of the sweep's commands has no test, and the sandbox manager's own two image removals have none: row 180 (k), (l) |
| 1.6 | The check asks Docker with other settings than the sandbox's; the sandbox's refusal of a Docker context is swallowed | Fixed. Both removals use the sandbox's own settings, asked for before anything is removed; a refusal is reported by name. C22. Control J2-C77 | Not run against a second Docker daemon; the test sets `DOCKER_CONTEXT` only: row 180 (l) |
| 1.7 | The real-Docker test shows the failing case for one of the two removal paths only | Fixed. A test on real Docker calls the real adapter's `destroy` with a hand-made handle while the network is held. Control J2-C78 | The test's holder containers still have no `--rm`: if the test process is killed, they, their networks and the test's folder stay |

### Reviewer 2: the journey

| # | Finding | What was done | Left |
| --- | --- | --- | --- |
| 2.1 | The refusal says "Nothing else was changed", but the app and most of the sandbox are gone | As 1.4 | As 1.4 |
| 2.2 | After a refused close the project stays open and usable; a dead end at the checklist; sign-off still offered | Fixed as decided for this work: the project is "removal not finished", read from the record, so it holds after a restart. C17 (a project whose preview finished and whose checklist passed) and C19. Controls J2-C67 to J2-C71 | The checklist screen still says "Sign-off is offered once a checklist run has passed" under a passed run; the panel above says why nothing is offered: row 180 (j) |
| 2.3 | The start's console line counts a failed removal as removed | As 1.3 | As 1.3 |
| 2.4 | The note can stay on screen after the project runs again, and names things that are not Docker's list | Fixed. The note says what the last try recorded as left; and such a project can no longer be built or previewed, so it cannot run again under the note | The note gives no time: row 180 (j) |
| 2.5 | A removal that fails with any other error is not recorded by name; one case is never retried | Fixed for the folder: both folder cases are now reported by name, and the folder without its compose file no longer stops the retry | Any other error still gives the general page and no record at "Close project": row 180 (h) |
| 2.6 | No test of a stop with mixed outcomes, nor of the real state after a refused close | Fixed. The stand-in's leftovers can be set by project, and it stops the app before it reports, as the real removal does. C18; C17. Control J2-C79 | |
| 2.7 | The Arabic note names a button label the page does not show; names not kept left to right; the Projects list gives no sign | Fixed for the first two: the note takes the words of the button shown beside it, and what is left sits in a left-to-right span. C14, C15. Controls J2-C73, J2-C76 | The Projects list; not looked at in a browser; the Arabic is not read by a reader of Arabic: row 180 (j), (n) |

### Reviewer 3: rules and claims

| # | Finding | What was done | Left |
| --- | --- | --- | --- |
| 3.1 | At start the interface still prints "removed at start: N" for a project whose removal left something | As 1.3 | As 1.3 |
| 3.2 | The refusal says "Nothing else was changed"; the project stays open half-removed; the stand-in hides it | As 1.4, 2.2 and 2.6 | As 1.4 |
| 3.3 | The screen sentence "Still listed by Docker" is not true in every case; `interrupted.no_job` is unconditional; the Arabic | Fixed for `removal.left`, in both languages, as 1.5 and 2.7 | `interrupted.no_job` is not changed: an earlier test fixes its words, and no existing check is edited: row 180 (i) |
| 3.4 | The handle path has no test or control that makes its removal fail | As 1.7 | |
| 3.5 | The gap's row: "Closed, except (a) to (d)" beside "Planned, not built", and open points not listed | Fixed. Row 180 is rewritten to what the code does; its status is "Open in part"; (a) to (p) list what can still happen | |
| 3.6 | The controls script says no container is started; one control now starts one; no lock in its usage line | Fixed. The header and the usage line are corrected | The script still takes no lock itself; its header says to hold it |
| 3.7 | The product's check and the automated run's check are now the same rule | Recorded: row 180 (f), and the header of `builder/scripts/journey-restart-checks.ts` now says the product depends on the rule | The rule is still shared |

### The reviewers' notes on claims that said too much

| Claim | What was done |
| --- | --- |
| "the reason does not say 'removed'": all three reasons held the word | The three reasons are reworded; none holds "removed", and none starts the way the reason of a completed removal does. C20. Control J2-C72 |
| C16's name: "refused before anything is asked", which the test cannot see | Renamed to what it shows: "for an id that is not a journey project's the call is rejected" |
| The "before" half of `full-checks.sh` | The sentence in "Results before the review" is corrected. The script is left as it was run |
| The gap's row, the refusal, the screen sentence, the start line, the controls header | Each answered above |

**Also noted by a reviewer and not changed:** `full-checks.sh` holds this session's scratch path, and by default checks out five files in the main working copy with no restore if it is interrupted part-way. It was run from a side working copy. `after-review/checks.sh` changes no file itself; the controls script it runs restores each file it changes.

## Checked and assumed

- **Checked by running:** everything in the two results tables, each on the commit its table names.
- **Assumed:** that Docker lists a container, volume or network under its Compose label, or under the project's name, whenever it holds one of the project's (the matching rule is `projectLeftovers`).
- **Not checked:** the whole suite after the review's fixes; J2's automated run after them; the screens in a browser; the Arabic by a reader of Arabic.

## What this does not show

Row 180 of `docs/KNOWN-GAPS.md` lists it, (a) to (p). In short:

- A preview that failed still removes the app's containers without this check, and says they "were removed".
- The check reads Docker's lists once. Processes are not looked at. Images with no name are not matched.
- A project whose removal can never finish cannot be closed from the interface.
- An error of a removal that is not "something is left" still gives the general error page at "Close project".
- A removal made to fail in a full project built by the interface: the real-Docker tests use made-up projects with no app.
