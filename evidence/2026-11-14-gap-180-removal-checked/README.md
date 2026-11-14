# Known gap 180's fix: a removal is recorded as done only when Docker lists nothing of the project

| | |
| --- | --- |
| What | The fix of known gap 180 (`docs/KNOWN-GAPS.md`), found by J2's second review (finding B1): the record could say a project's containers were removed, and the interface could exit 0 saying so, with containers or images left, and nothing then tried again |
| Written | 14 November 2026, by Claude Code. Brought up to date the same day, after the fix's own review: the sections "Results after the review" (since renamed "Results after the first review") and "Review and answers" are new, and the others are corrected where the code changed. Brought up to date once more the same day, after a second review round: the section "Results after the second review round" and the part "Second round" of "Review and answers" are new, and sentences that said more than was shown are corrected where they stand |
| Code | **Before the review:** commit `7433518` (`builder/` tree `783af9f`), on `claude/stage-1` after pull request #49. **After the review's fixes:** commit `df3b3c0` (`builder/` tree `dd9d7c8`), with the controls script of commit `46a7c83`, on the branch `tmp/gap180`. The output files name commit `b86680a`, the commit after those two, which changes documents only: its `builder/` tree is the same `dd9d7c8`. **After the second round's answers:** commit `dccc01b` (`builder/` tree `0d359ca`), with the controls script of commit `f6de69f`. The outputs of the type check, the licence check and the tests without a container name commit `cb16530`; those of the controls and of the real-Docker run name `f6de69f`, which changes the controls script only: the `builder/` tree is the same `0d359ca` in all of them. Not pushed, not merged |
| Machine | The development machine (a cloud session). Real Docker for the live tests. The scripted engine only: no model was called. Made-up data only |
| How it was run | Before the review: `full-checks.sh` in this folder, from a side working copy; then the whole suite a second time (see "The red run"). After the review: `after-review/checks.sh`. After the second round: `after-review/second-round/checks.sh` |

## Read this first

There are three sets of results here, and they are on three different states of the code.

- **Before the review** (commit `7433518`): the whole suite, 58 controls, the type check and the licence check. These results say nothing about the code as it is now.
- **After the first review's fixes** (`builder/` tree `dd9d7c8`): the type check, the licence check, the real-Docker test file, the tests of the stop, the close and the removal, the two test files they sit in, and all 79 controls. These are the results the second-round reviewers had. They are not results on the code as it is now.
- **After the second round's answers** (`builder/` tree `0d359ca`): the type check, the licence check, the gap's tests by name, the two test files whole, the real-Docker test file, and all 87 controls. **The whole suite was not run after the first review's fixes, nor after the second round's answers**, and J2's automated run was not repeated.
- **Who has read what.** Three fresh reviewers read the fix. Two more re-read the fixes made after that review. **Nobody has re-read the answers to that second round:** there was no third round. They are shown by tests and controls only.

## What changed, in plain words

- **One checked ending for every removal.** At "Close project", at a stop on purpose and at the next start, removing a project's sandbox ends in the same function. It removes what is left of the project by its Compose label, then reads Docker's own lists of containers, volumes, networks and images. Only if they hold nothing of the project is the project's folder removed and the removal reported as done.
- **If something is left,** the folder is kept, and the record says `removed: false` and names what is left. The sandbox stays in the record, so the next start, or the next "Close project", tries again.
- **"Close project" does not close a project whose removal left something.** It says what happened and what is left.
- **Docker's lists that cannot be read are not read as "nothing left".**

Added after the review:

- **No name can fool the check.** Docker's lists are read one JSON object a line. Before, a tab in a network's name hid the network from the check.
- **The check asks the same Docker as the sandbox does,** has a time limit, and records why Docker could not be asked: Docker's own last line when Docker itself failed, the builder's own words otherwise (a line it could not read, no answer in time). Never the command line. *(Corrected after the second round: this said "Docker's own words" for every case.)*
- **A folder that cannot be removed is reported like anything else left.** Before, it gave a plain error and a project that no later try could remove.
- **At a start, a project whose removal left something is named,** and is no longer counted as "removed at start".
- **After a refused "Close project" the project is "removal not finished".** Nothing of it is built, previewed, checked, approved, signed off, exported or opened any more. Its screens offer only "Close project", which tries again, and "New project".
- **The screen says what the last try recorded as left.** It no longer says "Still listed by Docker", which was not true in every case.

Added after the second review round:

- **A folder that cannot itself be removed keeps its compose file.** The compose file is what lets a later try recognise the folder as the project's. The removal now asks for the folder's own removal first, with the call that can remove nothing but an empty folder, and touches the compose file only if nothing but "not empty" stood in the way. Before, such a folder was left empty, and every later try from the record refused it, also once the cause was cured.
- **A folder that cannot even be looked at is reported like anything else left,** by both removals. Before, it gave a plain error.
- **The refusal of "Close project" no longer says "its app is stopped".** Nothing checks that. It says what Docker's lists held after the removal, and that a container named as left may still be running.
- **The preview screen says nothing about the app while a removal is not finished.** Before, it said "The app is not running any more" under a note that could say Docker was never asked.
- **Two conditions that had no test now have one each:** a recorded folder that fails its own check is kept out of Compose's own removal, and its Docker client folder is not used.
- **The controls script keeps why each test failed.** Before, it kept only that it failed.

## Results after the second review round (`builder/` tree `0d359ca`, run 14 Nov 2026 by `after-review/second-round/checks.sh`)

| Check | Result | File in `after-review/second-round/` |
| --- | --- | --- |
| Type check | Passed | `run-typecheck.txt` |
| Licence check | Passed. No dependency file is changed | `run-licences.txt` |
| The gap's tests by name filter: C14, C15, C17, C18, C19 in `test/web.test.ts`; C16 and C20 to C25 in `test/journey.test.ts` | **12 of 12 passed** (5 and 7) | `run-named-tests.txt` |
| The whole of `test/web.test.ts`, once | **78 of 78 passed**, exit code 0 | `run-web-whole-run-1.txt` |
| The whole of `test/journey.test.ts`, once | **78 of 78 passed**, exit code 0 | `run-journey-whole-run-1.txt` |
| `test/removal-live.test.ts`, on real Docker, under the shared lock | **8 of 8 passed.** Nothing of the test on the machine before or after (containers, networks, volumes: 0) | `run-removal-live.txt` |
| Every control whose tests start no container: each safeguard removed in turn | **80 of 80**: every named test passed alone first; with its safeguard removed, each named test failed, and the first failure vitest printed is kept on a line under each control; none of them is a failure in a test's own clean-up; the tree unchanged after every control. Run twice, 80 of 80 each time: first with an earlier form of the script's added lines (commit `cb16530`), then with the script as it is now, whose earlier verdict rule is untouched | `controls-output-no-container.txt`; the first run: `controls-output-no-container-run-1-script-of-cb16530.txt` |
| The seven controls whose tests need real Docker, under the shared lock | **7 of 7**, kept in the same way; the tree unchanged; nothing left on the machine | `controls-output-real-docker.txt` |
| The controls script, given a failure in a test's own clean-up as vitest printed it (a second-round reviewer's kept output) | It reads it as a clean-up failure, not as a control that worked. This is the script reading a kept text, not a run of a control | `sample-clean-up-failure.txt`, `controls-read-of-sample.txt` |
| The whole suite | **Not run** | |
| J2's automated run (`scripts/demo-journey-j2.ts`) | **Not run** | |

87 controls: the 79 before, plus eight for the second round (J2-C80 to J2-C87). The text of J2-C66 was updated where its sentence was corrected. The two test files now hold 78 tests each: 78 and 75 before, plus C23, C24 and C25 in `test/journey.test.ts`. The real-Docker file holds 8 tests: 7 before, plus one.

**What "failed" means in the two controls rows.** For each control the kept file gives vitest's summary lines and, on a line under it, the first failure vitest printed for each of its tests: its message, and the first place in a test file it names. Whether that failure is the one the control's label speaks of was read by the writer for the 34 controls of this gap (J2-C54 to J2-C87): by its message and its place, each fails at an assertion about the safeguard its label names. For J2-C01 to J2-C53 the first failures are in the file for anyone to read; the writer did not check them against their tests. That none of the 87 is a failure in a test's own clean-up is the script's own reading of every one.

**A red run kept from the second round's review** (not one of the runs above): `reviewer-run-web-whole-78-passed-exit-1.txt`. One of a reviewer's four whole runs of `test/web.test.ts` ended with every test passed and exit code 1. Its cause, and the two other times the same clean-up turned a run red, are in `clean-up-failures-seen.txt` and in row 185 of `docs/KNOWN-GAPS.md`.

## Results after the first review (`builder/` tree `dd9d7c8`, run 14 Nov 2026 by `after-review/checks.sh`)

These are the results the second-round reviewers had. They are not results on the code as it is now.

| Check | Result | File in `after-review/` |
| --- | --- | --- |
| Type check | Passed | `run-typecheck.txt` |
| Licence check | Passed. No dependency file is changed | `run-licences.txt` |
| `test/removal-live.test.ts`, on real Docker, under the shared lock | **7 of 7 passed.** Nothing of the test left on the machine before or after (containers, networks, volumes: 0) | `run-removal-live.txt` |
| The tests of the stop, the close and the removal, by name filter: C1 to C7, C9, C11 to C15, C17 to C19 and C4b in `test/web.test.ts`; C6, C8, C10, C16, C20 to C22 and the broken copy's record checks in `test/journey.test.ts` | **25 of 25 passed** (17 and 8) | `run-named-tests.txt` |
| The whole of `test/journey.test.ts`, once | **75 of 75 passed** | `run-journey-whole.txt` |
| The whole of `test/web.test.ts`, first run | **77 of 78. 1 failed.** A red run, kept as it is: an older test, C13, failed in its own clean-up. The cause is below | `run-web-whole-first-run-1-failed.txt` |
| The whole of `test/web.test.ts`, second run | **78 of 78 passed** | `run-web-whole-second-run.txt` |
| Every control whose tests start no container: each safeguard removed in turn | **73 of 73**: with the safeguard removed, each named test failed; every named test passed alone first; the tree unchanged after every control. *Corrected after the second round:* this run kept only vitest's summary lines, so it shows that each test failed, not why. A second-round reviewer found no refused drop in PostgreSQL's log for the time of this run, and saw the failing assertion in runs of their own for J2-C54 to J2-C79 only | `controls-output-no-container.txt` |
| The six controls whose tests need real Docker, under the shared lock | **6 of 6**: with the safeguard removed, each named test failed (the same correction applies); the tree unchanged; nothing left on the machine | `controls-output-real-docker.txt` |
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

Every test and control named in this table ran again in the second round's run, on the code as it is now, and gave the result its row needs.

| Part | Test | Control |
| --- | --- | --- |
| A removal that leaves something throws, names what is left and keeps the folder; once nothing holds it, the same removal removes everything and the folder | `test/removal-live.test.ts`, on real Docker: a network carrying the project's label, held in use by a container that is not the project's. The container that is not the project's is not touched | J2-C54 |
| The same through the removal with a handle, the path "Close project" and a clean stop take in a running interface | `test/removal-live.test.ts`: the real adapter's `destroy` with a hand-made handle, the network held | J2-C78 |
| A labelled network with a tab in its name is seen; a network that is not the project's, with a line break in its name, is not reported | `test/removal-live.test.ts`, on real Docker; C21 on a made-up docker program | J2-C59, J2-C60 |
| A folder that cannot be removed is reported as left with the error's code; its compose file is kept for last, so the folder still passes its own check. Shown for two cases: an entry that cannot be removed, and (second round) a folder whose own removal is refused. Not shown, and still open: a removal cut off between the compose file and the folder (row 180 (q)) | `test/removal-live.test.ts`: one file made unremovable with `chattr +i`; the folder's parent made unchangeable with `chattr +i` | J2-C61, J2-C62, J2-C82 |
| A recorded folder that fails its own check is left as it is; Docker's side is removed by label and checked all the same; the removal reports both | `test/removal-live.test.ts`: a folder with no compose file, a volume and a held network of the project | J2-C63 |
| Such a folder is kept out of Compose's own removal, and its Docker client folder is not used (second round) | C23, on a made-up docker program: a folder whose compose file names another project and that holds a Docker client folder | J2-C80, J2-C81 |
| A folder that cannot be looked at is reported as not removed by both removals, not thrown as a plain error; a folder left empty is removed by the removal with a handle (second round) | C24, on a made-up docker program | J2-C83, J2-C84 |
| Docker's lists that cannot be read are not read as nothing left | C16 | J2-C55 |
| Why Docker could not be asked, never the command line: Docker's own last line for Docker's own failure, the builder's words for a line that cannot be read, for the time limit and for an exit with no output; a time limit on the four lists | C21 | J2-C74, J2-C75 |
| The sandbox's own Docker settings; a Docker context the sandbox refuses is reported, on both removals, and nothing is asked or removed; the handle then goes on saying its app is started (second round) | C22 | J2-C77, J2-C87 |
| At a stop: `removed: false` with what is left, the project left for the next start, exit 1. The next start tries again; its lines name the project left and do not count it as removed. The screen says what the last try recorded as left, left to right, with the button's own words | C14 | J2-C57, J2-C58, J2-C64, J2-C65, J2-C73, J2-C76 |
| "Close project" refused, saying what Docker's lists held after the removal and what is left, and not that the app is stopped (second round); recorded; the project not closed; pressed again with nothing left, it closes | C15 | J2-C56, J2-C58, J2-C66, J2-C73 |
| The same when the record names no sandbox: the refusal is recorded all the same (second round) | C25, with a made-up removal | J2-C85 |
| "Removal not finished": every job, approval and sign-off refused with one sentence, through the journey and the routes; only "Close project" and "New project" offered; the same through a second journey on the same record that holds no handle (not a real start, which first marks the project interrupted: C19 shows that); the stand-in stops the app before it reports | C17, C19 | J2-C67 to J2-C71 |
| While a removal is not finished the preview screen does not say "The app is not running any more"; once the project is closed it says it again (second round) | C17 | J2-C86 |
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

**Since then (second round).** "It is the only such error in PostgreSQL's log" was true when it was written. The same clean-up has turned a run red twice more, both in a second-round reviewer's runs: the refused drop again, in a single run of C14 made for a control; and a second form, a whole run of `test/web.test.ts` with every test passed and exit code 1. All three are listed, with PostgreSQL's log lines, in `after-review/second-round/clean-up-failures-seen.txt`; the reviewer's red run is kept beside it. The helper is not changed (row 185 says why, and what the fix should be).

## Review and answers

Three fresh reviewers read the fix at commit `7433518`: one for isolation, one for the journey, one for rules and claims. None found anything blocking. They made 21 points, seven each; several are the same point seen from another side. Two more fresh reviewers then re-read the fixes made in answer: that second round is the last part of this section. All findings, as given, are in `docs/reviews/2026-11-14-gap-180-removal-checked.md`. "Row 180" below is the gap's row in `docs/KNOWN-GAPS.md`. Where the second round corrected an answer of the first, the first round's tables below are left as they were written and the correction is in the second round's part.

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

### The first round's reviewers' notes on claims that said too much

| Claim | What was done |
| --- | --- |
| "the reason does not say 'removed'": all three reasons held the word | The three reasons are reworded; none holds "removed", and none starts the way the reason of a completed removal does. C20. Control J2-C72 |
| C16's name: "refused before anything is asked", which the test cannot see | Renamed to what it shows: "for an id that is not a journey project's the call is rejected" |
| The "before" half of `full-checks.sh` | The sentence in "Results before the review" is corrected. The script is left as it was run |
| The gap's row, the refusal, the screen sentence, the start line, the controls header | Each answered above |

**Also noted by a reviewer and not changed:** `full-checks.sh` holds this session's scratch path, and by default checks out five files in the main working copy with no restore if it is interrupted part-way. It was run from a side working copy. `after-review/checks.sh` changes no file itself; the controls script it runs restores each file it changes.

### Second round: two fresh reviewers re-read the fixes

Two fresh reviewers, neither of whom wrote the code, re-read the fixes made after the first review: one read the code, one the rules and the claims. Neither found anything blocking. They made six points and named ten sentences that said more than was shown. Each point was first checked by the agent that answered it; the column "Real?" says how. There is no third round: what is under "Left open" is open.

| # | Finding | Real? | What was done | Left open |
| --- | --- | --- | --- | --- |
| S1 | Code: if the folder itself cannot be removed after its contents went, it is left empty without its compose file, and every later removal from the record is refused, also once the cause is cured. Smaller: two looks at the folder can throw a plain error | Real. Read in the code, and measured: for a folder that still holds a file, `rmdir` answers EPERM when the parent may not be changed, and "not empty" when nothing else stands in the way | Fixed for the reviewer's own case. The removal now asks for the folder's own removal first (`rmdir`, which removes nothing but an empty folder) and removes the compose file only if nothing but "not empty" stood in the way: a folder whose own removal is refused keeps its compose file and still passes its check. A test on real Docker with the parent made unchangeable; control J2-C82. The looks at the folder are inside the removal's own error handling, and the record's check refuses a folder it cannot look at with the error's code: C24; controls J2-C83, J2-C84. The comment is rewritten to the three cases | **The reviewer's first suggestion was not taken:** letting an empty folder pass the record's check would change the answer an earlier test fixes for an empty folder, and no existing check is edited. So a folder left empty by a removal cut off at its very last step (the process ends, or the parent changes, between the compose file and the folder) is still refused by every later try from the record, until someone removes the empty folder by hand: row 180 (q). With the interface's own handle the same removal does remove it (C24). A folder that is a mount point was not measured: row 180 (l) |
| S2 | Code: after a removal in which Docker could not be asked, or that names the app's own container as left, the record's state and the preview screen still say the app is not running | Real. Read in the code. Shown for the screen by control J2-C86: with the fix taken out again, the preview page C17 reads holds "The app is not running any more." under the note of what was left | Fixed on the screen: while a removal is not finished the preview screen says nothing about the app; once the project is closed it says the sentence again. C17; control J2-C86. The handle's flag is now cleared only once Docker is about to be asked: with Docker's settings refused, nothing is asked or removed and the handle goes on saying what it said. C22, whose expectation changed with it (it was added on this branch); control J2-C87. The refusal's own sentence is corrected too (below) | The record's state is not changed: every removal event still marks the app as not running, and the handle's flag is cleared whenever Docker was asked, also when the app's container is then named as left: row 180 (k) |
| S3 | Rules and claims: one of the reviewer's four whole runs of `test/web.test.ts` was red (exit code 1, 78 of 78 passed): the tests' own database clean-up, in a second form that row 185 does not name | Real. PostgreSQL's log has the three lines the reviewer names (read by the writer). The cause of the second form is the reviewer's reading of the pool's code and their probe; it was not re-run here | The red run is kept (`after-review/second-round/reviewer-run-web-whole-78-passed-exit-1.txt`), with a list of the three times the clean-up turned a run red (`clean-up-failures-seen.txt`). Row 185 is corrected: seen three times, in two forms; the remedy it offered ("drop without force once the pool is ended") is marked as not enough | **The helper is not changed.** It is shared test code older than this branch; row 185 and the reviewer both call its fix a package of its own. Proposed as one (`g180-proposed-records.md`, kept outside the repository). Until then a whole run of either test file can be red for this reason: read the cause from the output, do not just run again |
| S4 | Rules and claims: a control's verdict does not look at why its test failed; a clean-up failure counts as "failed, as it should" | Real. Read in the script | Fixed. The controls script keeps, on a line under each control, the first failure vitest printed for each of its tests: its message and the first place in a test file. For a failure in a test's own clean-up it adds "NOT AS EXPECTED: … run this control again", and the result at the end is then "NOT every one failed as it should". The lines that decided a verdict before are as they were: the new lines come after them and can only take a "failed, as it should" away. All 87 controls were run again with it. The script reading a kept clean-up failure: `controls-read-of-sample.txt` | The clean-up case is shown by the script reading a kept text. The lines that then mark the control and the result were not exercised: no control failed that way in this run. Whether each first failure is the one its control's label means was read for the 34 controls of this gap, and for three of the other 53 (said under the results table) |
| S5 | Rules and claims: no test or control for the condition that keeps a refused recorded folder out of Compose's removal; nor for the close refused when the record names no sandbox | Real. With either condition dropped, C23 now fails (J2-C80, J2-C81); before, nothing did (the reviewer ran that) | A test for each: C23 (a recorded folder whose compose file names another project and that holds a Docker client folder: no Compose call, no call naming the folder or the other project, every call given a client folder outside it, the folder as it was) and C25 (a refused close with no sandbox in the record is recorded and leaves the project "removal not finished"). Controls J2-C80, J2-C81, J2-C85. The comment that said "never read" is corrected | What Compose's own removal would do to another project is read from the code, not run: row 180 (l). C25 uses a made-up removal: no real path is known that leaves something for a project whose record names no sandbox |
| S6 | Rules and claims: a consequence of the decided state is said nowhere: a signed-off project not yet exported can never be exported once "Close project" was refused | Real. Read in the code: every job of such a project is refused before its own rule is asked, and a closed project starts no job | Written down: row 180 (r); here; and in the text proposed for the decisions and the questions (`g180-proposed-records.md`, kept outside the repository), with a question for the owner. No code is changed: the state was decided | The owner's decision. Not shown by a test on a signed-off project: C17's project is not signed off |

**The sentences that said too much, and what each now says.** No check was changed to make a sentence true.

| Where | It said | It now says |
| --- | --- | --- |
| The comment of `removeSandboxFolder` (`builder/src/orchestrator/example-1-adapter.ts`); the same sentence in answer 1.2 above and in the table "What each part is shown by" | A removal cut off part-way, or an entry that cannot be removed, leaves a folder that still passes its own check | Three cases, each with what shows it: an entry that cannot be removed (shown); the folder's own removal refused (shown since this round); a removal cut off between the compose file and the folder (not closed: row 180 (q)) |
| Row 180, point (k) | When Docker could not be asked, the refusal says that what went is not known | The same, and: the record's own state still marks the app as not running after any removal event; what the preview screen and the handle now do |
| Row 185; this README, "The red run after the review" | Seen once; the only such error in PostgreSQL's log | Seen three times, in two forms; each named, with where it is kept |
| This README, the first review's results table | 73 of 73 and 6 of 6 "failed their tests with the safeguard removed" | That each named test failed; that only the summary lines were kept; what a reviewer checked beside it. The second round's run keeps the first failure of every control |
| Row 180, point (5) | A recorded folder that fails its own check is left as it is "while still doing steps 1 to 3" | Compose's own removal is not run on it and its Docker client folder is not used; the settings, the removal by label, the two image removals and the four lists are still done |
| Row 180, point (3); C21's name; two comments in the adapter; this README | "Docker could not be asked", "with Docker's own words" | Docker's own last line only when Docker itself failed; the builder's words for a line that cannot be read, the time limit and an exit with no output; never the command line |
| The comment in `destroyRecorded` (the adapter) | A refused folder is "left exactly as it is, and never read" | Its own check looks at it and reads its compose file once; after that nothing of it is read, changed or given to Docker. Each of the two conditions has a test (C23) |
| The refusal of "Close project" (`builder/src/orchestrator/journey.ts`) | "What could be removed of it was removed, and its app is stopped, except for what is named as left." | "After the removal, Docker's lists were read: they hold nothing more of this project than what is named as left. A container named there may still be running." C15's expected sentence and J2-C66's text follow it (both were added on this branch) |
| C17's name (`builder/test/web.test.ts`) | "the same from the record alone, as after a restart" | "the same through a second journey on the same record that holds no handle (not a real start, which would first mark the project interrupted: C19)" |
| The first fixer's report, items 2 and 8 | The two sentences on the folder above | The report is not in the repository; the same sentences are corrected where they stand in the code and here |

**Changed in tests that were added on this branch, and why.** C15: the refusal's expected sentence. C17: its name; two lines asking that the preview screen does not say the app's sentence while the removal is not finished, and one asking that it says it again once the project is closed. C21: its name. C22: its name, and the handle's flag expected to stay set when nothing was asked (it expected the flag cleared). No assertion, test name, time limit or expected value that existed before this branch is changed.

## Checked and assumed

- **Checked by running:** everything in the three results tables, each on the commit its table names.
- **Checked by reading, not by running:** the second round's findings S2 and S6 before they were answered; the cause of the second form of the clean-up failure (a reviewer's reading and probe).
- **Measured once, on this machine (Linux, Node 22.23.4):** that `rmdir` of a folder that still holds a file answers EPERM when the folder's parent may not be changed and "not empty" otherwise. The fix of S1 rests on that order of answers. Not measured: a folder that is a mount point; another operating system.
- **Assumed:** that Docker lists a container, volume or network under its Compose label, or under the project's name, whenever it holds one of the project's (the matching rule is `projectLeftovers`).
- **Not checked:** the whole suite after the first review's fixes or after the second round's answers; J2's automated run after them; the screens in a browser; the Arabic by a reader of Arabic; the second round's answers by a reviewer.

## What this does not show

Row 180 of `docs/KNOWN-GAPS.md` lists it, (a) to (r). In short:

- A preview that failed still removes the app's containers without this check, and says they "were removed".
- The check reads Docker's lists once. Processes are not looked at. Images with no name are not matched.
- A project whose removal can never finish cannot be closed from the interface.
- An error of a removal that is not "something is left" still gives the general error page at "Close project".
- A removal made to fail in a full project built by the interface: the real-Docker tests use made-up projects with no app.
- A folder left empty by a removal cut off at its very last step is refused by every later try from the record, until someone removes it by hand.
- A signed-off project that was not exported yet cannot be exported once "Close project" was pressed.
- The record's own state marks the app as not running after every removal event, also one that could not ask Docker.
- A whole run of the two test files can be red from the tests' own database clean-up (row 185): that helper is not changed.

## Added after the merge into pull request #51's branch (14 November 2026)

The whole suite, J2's automated run and every control were repeated on the code pull request #51 merges, and the tests' own database clean-up was changed (row 185), so the last line above no longer holds for that code. Results and files: [`merged/README.md`](merged/README.md). In short: the whole suite 814 of 814; 87 of 87 controls; J2's automated run 153 of 153; the two test files whole, three runs each, 78 of 78 with exit code 0 every time.
