# Package 3.2: the export that starts on its own — evidence of the automated run

| | |
| --- | --- |
| Package | 3.2, the exporter (build plan section 7; "Done means": "The app starts from the export with the builder stopped, and the check passes from the exported copy") |
| Design | `docs/design/package-3.2.md` (read by two critics and corrected; not approved by the owner; questions 23 to 27 open; section 13 lists the changes made during the build, part D for this run) |
| Branch | `claude/pkg-3.2-exporter`, from the integration branch at `839be17`; not pushed |
| This file | First version, 14 Nov 2026, written by Claude Code: the automated run of design section 7. Completed the same day with the controls, the full checks and the reopened packages (sections "The controls", "The full checks" and "The reopened packages"), and the records named in "Records". Not yet reviewed |
| Machine | The development machine (a cloud session); the run under the shared lock, with its own database (`builder_x32_<run>`), data folder and interface port (127.0.0.1:4025); the live preview off; real Docker; the scripted engine only; no model called |

## The result, first

**Not every check passed: 152 of 154 checks passed, 2 failed; 5 of 5 pictures copied; the secret search found nothing; nothing of the run was left in Docker's lists; exit code 1** (`run-demo.txt`, its last lines).

The two failed checks are the same check of design section 7 C, "no way back to the machine", from the door's side:
- From the network of the exported app's **door** (its one way in from the machine), a connection to a listener the run started on the machine, bound to every address, **succeeded** at two addresses: the gateway of the copy's `edge` network and Docker's default bridge address.
- The design says each such connection "must fail". The door is on an ordinary network that has a route out (design gap N1), and such a network can reach the machine's own addresses. This was measured before the run as well (`part-d-way-back-measured.txt`).
- The check was not changed. It cannot pass as long as the door sits on an ordinary network; what to change (the door's network, or the check) is not Claude Code's to decide (design section 13, D8).

Everything else of section 7 passed, on the run of record. What did not fail:
- From the **app's** own network, nothing of the machine was reached, at any address.
- From either side, the listener bound only to 127.0.0.1 was reached at no address. The owner's builder on 4020 listens on 127.0.0.1 only; that it cannot be reached either is inferred from this, not probed.

## What the owner can now do

Shown by the automated run, with pictures; not done on his own builder:
1. **Export a signed-off project** from the Export screen, as in J1. The screen now carries the new label ("Internal only, not for customers. …") and lists the eight checks made on the export before it was offered, each "Passed", in English and Arabic, and at phone width.
2. **Start the exported copy on its own**, with the builder that made it stopped, its database dropped and its data deleted: one command from the copy's README, `docker compose up --build`, in the unpacked folder. It makes its own passwords, database, tables and three made-up users, and opens one door at http://localhost:3000 on this machine only.
3. **See the sample password** with the README's own command, `docker compose run --rm --no-deps keys cat /keys/sample_password`, and sign in at http://localhost:3000.
4. **Run the checklist's test from the copy** with the builder's own check script, `scripts/check-export.ts`: "passed", "version passed; checklist incomplete (5 of the app spec's 6 checklist items have no test)", labelled "stand-in test, not independent acceptance".

What it is not: a clean machine (milestone 6); anything a customer may receive (the export is internal only); independent acceptance (the test is Claude Code's stand-in); an app or tests written by a model.

## Real or simulated, part by part

| Part | Marked | What is real | What is simulated |
| --- | --- | --- | --- |
| The journey to sign-off (A) | Real (the jobs), Simulated (the steps) | The builder's interface and jobs, the project's containers, its history, the reservations, the preview, the checklist run | The two steps: fixed changes written in advance (scripted engine); the questions answered from example 1's sheet |
| The export (A) | Real | The archive, its history, its eight checks (two images built from the archive, the package listings, the notices file, the template's licence check), the event | — |
| The builder stopped (B) | Real | Its process ended (exit code 0), its database dropped, its data and sandbox folders deleted, nothing of the project left in Docker | — |
| The copy's start (C, F) | Real | The README's command, run as written with only PATH and HOME set: the build, the keys, the tables by migration, the made-up users, the app and its door | — (made-up data) |
| The packages it installs (C) | Real, from earlier layers | Every build step, the install step and the app's build included, was taken from layers made earlier on this machine on Docker's default build network (part C's first live run, 13:54 UTC; design section 13, C14 and D13). npm did not run in this run | — |
| The licence checks on the person's images (D) | Real | Section 4's items 4 to 7 on the images the copy's own command built | — |
| The check from the copy (E) | Real (the run), Simulated (the test) | The builder's check script, the runner image, the forwarder, the runner in its namespace, against the app the copy started | The test: a stand-in test written in advance by Claude Code, labelled so |

## The automated run

`flock <scratchpad>/live-tests.lock npx tsx scripts/demo-export.ts ../evidence/2026-11-14-package-3.2`, from `builder/`, with `TMPDIR` the session's short scratch folder. Run of record: commit `8805037` (`builder/` tree `f412c73`), run `20261114_51b07c`, lock held 15:03:18 to 15:05:41 UTC.

How it ran (design section 7):
- **Before.** The runner image checked (`runnerImageProblem`). The two approved base images on the machine (nothing is downloaded). Free disk and Docker's lists recorded. Nothing refused for other people's names; the run's own names checked absent. Ports 4025, 3000 and 13161 free. A fresh database, data folder and camera folder. A random interface password, given to the interface and, as a 0400 file, to the camera; never printed.
- **A.** The interface (`node --import tsx src/web/main.ts`) on 127.0.0.1:4025, the live preview off. The builder camera (walk `x32`, in the approved runner image) walked J1's path in 67 s to the export, photographed the export screen three ways, downloaded the archive and closed the project.
- **B.** Events saved; SIGTERM to the interface's own process: exit code 0 after 0.3 s, "removed at the stop: 0". Then the database dropped, the archive and events copied out, the data folder and sandbox folders deleted.
- **C.** The archive (380,439 bytes) unpacked in a fresh folder. The README's command run as written: the app healthy after 19 s.
- **D.** Section 4's items 4 to 7 on the person's own images.
- **E.** The check script, as a command, with the event's four values: 4.5 s.
- **F.** A second start: healthy after 13 s.
- **G.** The copy unchanged.
- **H.** Clean-up by exact names.

**A first run** (14:59:24 to 15:02:01 UTC, commit `5af307a`) gave 157 of 160 (`first-run/run-demo.txt`):
- the same two checks of the door failed;
- B.2 failed on a fault of the run script: it counted its own open connection to the run's database as a process naming that database;
- it also took Docker's words "invalid IP" (the gateway an isolated network does not have) as two addresses.

Both faults were fixed in the script (commit `8805037`, design section 13, D5 and D6); no check was changed.

## The checks, part by part

Each line of `run-demo.txt` that starts "PASSED" or "FAILED" is one counted check.

| Part | Checks | Result | What they show | Files |
| --- | --- | --- | --- | --- |
| Before | 2 | Passed | None of the run's own names, nor any of the project's, existed at the start | `run-demo.txt` |
| A | 59 | Passed | The interface started with no model key; the camera's 40 checks (the journey; the export screen's label and its eight checks, each passed, in English, Arabic and at 390 px; nothing loaded but 127.0.0.1:4025); J1's six network checks on the sandbox's containers; the event holds the project's id, the manifest's SHA-256 (the one the passing run recorded), its item, the checklist count 6, the passing run's id, the eight checks in order and the README's command; the downloaded archive's SHA-256 is the event's, and so is the archive's in the data folder | `run-demo.txt`, `events.json`, `export-contents.txt`, `screens/01-export-*.png` |
| B | 14 | Passed | Exit code 0 and "removed at the stop: 0"; the process gone and 4025 free; no process naming the run's data folder, sandbox folder, database or interface; nothing of the project in Docker (rule N, the export check's images too); no gateway started (nothing listened on 4010); the database dropped; no container mounting the deleted folders; npm's cache mount and the base images recorded; 4020 listening, 4032 and 4033 not, recorded and not touched | `run-demo.txt`, `interface-log.txt` |
| C | 46 | **44 passed, 2 failed** | The archive and its history (the export commit's parent is the workspace's head; `acceptance/` only in the last commit; `git status` empty); exactly the 72 files the event lists; the four start files byte-equal to the template's; none of S29's names; S30's comparison; the README's one command; the app healthy; one published port, the door's, on 127.0.0.1:3000; the networks of each container; the sign-in page 200; sign-in with origin http://localhost:3000 200, with http://127.0.0.1:3000 403; the sample password read with the README's command; the way back (16 probes and 2 controls; **2 probes failed**, above); the tables (2 migrations, the 3 made-up users) | `run-demo.txt`, `compose-output.txt`, `npm-build-lines.txt` |
| D | 2 | Passed | On the person's run image: none of the 14 development-only packages under `/app`, only the base image's npm copy of `spdx-exceptions` 2.5.0 elsewhere ("checked under this reading", question 26 (a), never called met); the notices file byte-equal; on the tools image: six copies listed, and the template's licence check passed with no network | `run-demo.txt` |
| E | 13 | Passed | Exit code 0; "passed" and the summary; the reading labelled as the stand-in; item 1 passed; the app found was the copy's own, from its folder, its image the one Compose built, at http://localhost:3000; the copy unchanged during the check and the forwarder removed; the runner, inspected while it ran: in the forwarder's namespace, the forwarder on the project's front network alone, user `runner`, a read-only root, every capability dropped, 3.1's three mounts, BASE_URL the app's APP_URL | `run-demo.txt`, `check-reading.json`, `screens/02-item-1-from-export-en.png` |
| F | 9 | Passed | The keys "kept", the users "exist", none created, still 2 migrations, the app healthy | `run-demo.txt`, `compose-output.txt` |
| G | 2 | Passed | All 142 entries of the copy, its history included, and `git status` unchanged after C to F | `run-demo.txt` |
| The record page | 4 | Passed | The camera, with no network, photographed the page the run wrote from its own files | `screens/03-run-record-en.png` |
| H | 2 | Passed | Nothing new of the run in Docker's containers, images, volumes or networks; the run folder (with the check's trace, which holds the sample password) removed | `docker-after.txt` |
| The secret search | 1 | Passed | No evidence file holds any of the four secrets | `run-secret-search.txt` |

## The pictures

All in `screens/`, from the run of record. Each was looked at before it was kept: none shows a password, a secret or a real name.

| Picture | What it shows |
| --- | --- |
| `01-export-en.png` | The export screen after the export: the new label, the file, its size and SHA-256, 4 commits, and the eight checks, each "Passed", with the copies of development-only packages listed |
| `01-export-ar.png` | The same screen in Arabic, right to left, with the English label under the Arabic one |
| `01-export-phone.png` | The same screen 390 px wide |
| `02-item-1-from-export-en.png` | The checklist's item-1 picture, taken by the runner in the app started from the export, with the builder that made it stopped: "My requests", "Your request was saved. Its status is Waiting.", a five-day request marked "Waiting" whose reason names the run's id, under the app's banner "Sample data… Built by the scripted engine: fixed changes, no AI model." It does not show the reading, the label or that the builder was stopped |
| `03-run-record-en.png` | The run's record: a page the run wrote from its own files and photographed with no network, labelled as such, not a screen of the builder or the app. It shows the outcome "passed", the summary, the stand-in label, the run's id (the same as in the item's picture), and the times the builder stopped (15:04:26.978 UTC), its database was dropped and its folders deleted, the app was started from the export (15:04:27.990) and healthy (15:04:47.083), and the check ran (15:04:56 to 15:05:00) |

## The controls

A *control* removes one safeguard and shows that its test then fails; it proves the test can see that safeguard.

**Result: 75 controls, and every one failed its test, as it should** (`controls-output.txt`; the script: `controls-scripts/controls.py`, in the style of J2's).
- Run on the branch's head `8e8e198`, 15:16 to 16:13 UTC on 14 Nov 2026, with a fresh test database (`builder_test_x32ctl`, made and dropped).
- Before the controls, on the tree as committed: each of the 44 test names the controls use, run alone, passed (69 tests in all: some names select a group, as "T2 (S22)" selects T2's tests), and the live file passed in full (10 of 10, 139 s).
- Each control: one safeguard removed by exact text replacement (each text occurring exactly once), the test that guards it run, the files put back with `git checkout`, and the tree checked unchanged. Fast tests ran alone (`-t <name>`); live tests ran as the whole of `test/export-live.test.ts` under the shared lock, since each needs the ones before it.
- After the last control, `builder/` and `templates/` were as committed (`git status` empty), and Docker's lists of containers, images, volumes and networks were the same as at the start.

| Safeguards (design section 5) | Controls | Tests that failed |
| --- | --- | --- |
| S1 to S6, S8 to S10, S12 to S15 (the exporter) | 16 | E1 to E10, E12, E13, E16, S9's two tests (`test/export.test.ts`) |
| S7 (secret-like paths), S11 (only reachable objects, no remote), S16 (sign-off first, never a broken copy) | 5 | J1's and J2's own tests in `test/journey.test.ts` and `test/web.test.ts`, as section 5 names them (here controlled again on this branch's code) |
| S17 to S19 (the image checks) | 7 | The verdict tests (fast) and live test L1's refusals |
| S20, S21 (the archive; the tests kept out of the images) | 5 | E20; T1 three times; live: with both lines removed, the export's own check refused the export ("the archive's images could not be built"), so L1 failed before L2 could build |
| S22 (the compose rules) | 12 | T2, each rule in turn, `compose.yaml` written again from its source |
| S23, S24 (protected paths; the tables and the drift check) | 9 | T3, the scripted engine's S23 tests, T7, live test L4 |
| S25 to S27 (the check from the copy) | 7 | Live tests L3, L3b, L3c; T8 |
| S28 to S31 (label, S29's names, what Compose reads, the checklist count) | 6 | E15, E21, S30's verdict test and live test L2b, E17 |
| Added by the builders, with a test of their own (design section 13) | 8 | A Docker check not passed, or not reported, does not refuse (E10); the check containers' read-only root; the check's images on the removal list; T5 twice; T6; T8 |

**Checks the builders added that no test names** (design section 13, C3 and C4; reported apart, not counted above). Each was removed in the same way and the live file run in full, to find out whether any test sees the removal:
- P1: the app container started from the copy's `compose.yaml` alone (Compose's `config_files` label);
- P2: the copy's `keys` volume carrying Compose's labels for this project;
- P3: the project's front network internal, in the isolated gateway mode;
- P4: the app's `APP_URL` exactly `http://localhost:<port>`;
- P5: a one-off container of the service `app` not taken for the app.

**No test saw any of the five:** the live file passed in full, 10 of 10, each time. Each check is in the code and ran in the passing runs, but that each refuses what it should is not shown: known gap 204. (P2 took 817 s, not about 140: it waited about 11 minutes for the shared lock, which a listener left by another measurement held until its owner stopped it.)

## The full checks

**Result: the typecheck passed, the licence check passed, and the whole suite passed, 863 of 863 tests in 33 files, live tests included, none skipped** (`run-typecheck.txt`, `run-licences.txt`, `run-tests-full.txt`; the script: `full-checks.sh`, as J2's checks were run).
- Run on `7c0c9c9` (`builder/` tree `f412c73`, the code the controls and the automated run's fixes ran on), 14 Nov 2026: the typecheck and the licence check at 16:23 UTC; the suite under the shared lock, 16:23:08 to 16:43:56 UTC (1,247 s), on a fresh database (`builder_test_x32full`, made and dropped), the browser zip read only and unchanged.
- No container before or after; no preview folder or test database left; Docker's lists the same as before.
- **An earlier run was cut off, and a duplicate was started; neither is counted.** A first run of the same script began at 16:13:41 UTC. Its typecheck and licence check passed; its suite was stopped part-way at about 16:16 UTC, when the coordinating session stopped the build workflow, one of whose agents had started a second copy of the script at 16:13:52. That copy dropped and recreated the test database before it waited for the lock; it was stopped while waiting and ran no test. The cut-off suite left one container and two images of a test project (`builder_p_acc_live_d96ba287`), each removed by its exact name (the container and the app image by this part's agent, the tools image by the coordinating session), and two folders of its own in the run's temporary folder, which were deleted. Its log held only its first lines and was replaced by this run's. This run, on a fresh database, with no other run started, is the run of record.

## The reopened packages

Package 3.2 changes two packages already marked tested, 2.1 (the scripted engine: step 01 now writes 7 files; more protected paths; a refusal after each step) and 0.5 (set-up in a tools container: the tables by `drizzle-kit migrate`). Under the plan's rule for reopening, each is set back to "built" on this branch, and its evidence was run again here on 14 Nov 2026, under the shared lock (`reopened/README.md`):
- **2.1:** its demonstration, `scripts/demo-scripted.ts`: exit code 0. Step 01 wrote and committed exactly its 7 files, step 02 its 8; the tables made by `migrate`, the drift check passed; the screens' 20 checks all passed.
- **0.5:** its "Done means" demonstration, `scripts/demo-template.ts --guard`: exit code 0. The stand-in seed step saw none of the builder's settings, twice; the tables made by `migrate`; the role guard's 26 checks passed. Its tests in `test/sandbox.test.ts`: 8 of 8 passed.
- **Checked by reading:** 0.6a, which depends on 0.5, does not use the table set-up. 3.1, which depends on 2.1, passed its tests in the whole suite. 2.2 is not built.

Neither is marked tested again here: that comes with 3.2's merge and review.

## Records

Updated on this branch with the package (build plan section 3, step 10), in plain words for the owner. **Not** updated here: `docs/STATUS.md` and `docs/QUESTIONS.md`, which the session that writes the status keeps.
- `docs/design/stage-1.md`: the amendment for package 3.2, rows 1 and 2 only (the tables by fixed migration files; the one command and the door). Rows 3 to 6 are the owner's and are written only as he answers questions 23, 24, 25 and 27.
- `docs/DECISIONS.md`: "Package 3.2 … built as follows" (the design's 20 decisions, each the owner's to overrule) and "3.2 before 3.1 is tested", a departure from the plan's order, recorded as such.
- `docs/KNOWN-GAPS.md`: gaps **190 to 204** added (the design's N1 to N15; N16 is a note in gap 137, and the five checks with no test are a note in gap 204); gap **53 closed** (the run showed the tables made by `migrate` from the copy); gap **39 rewritten**, the licence condition never called met; gaps 34, 40, 51, 61, 72, 75, 118, 137, 139 and 179 updated; gap 190 also records the coordinating session's measurement of other networks for the door (`part-e-door-networks-measured.txt`).
- `docs/SOURCES.md`: the outside facts of the design's section 9, each with its page and the date read, or "measured only".
- `docs/arabic-wording-list.md`: the 12 new messages of the export screen and the changed label.
- `docs/BUILD-PLAN.md`: 3.2's own progress row (built, not tested, and why), and the reopening noted on 2.1's and 0.5's rows.
- `docs/design/package-3.2.md`, section 13: part E, this part's notes.

## Files

- `run-demo.txt`: the run's own log, every check with its detail; `first-run/run-demo.txt`, the first run's.
- `events.json`: every event of the run's database (90), saved before the stop; none was written during it.
- `interface-log.txt`: the interface's own output.
- `compose-output.txt`: the copy's own output, both starts and the `down` commands.
- `npm-build-lines.txt`: the install step's lines in both starts ("CACHED"), npm's cache mount before and after, and the build cache records the first start used, with when each was made.
- `check-reading.json`: the check's reading, from its run folder; the run folder itself, with the runner's trace (it holds the sample password, known gap 72), was removed.
- `export-contents.txt`: the archive's listing.
- `docker-after.txt`: Docker's lists at the start and the end.
- `run-secret-search.txt`: the search for the four secrets.
- `part-d-way-back-measured.txt`: the measurement, before the run, of what a container on an ordinary network can reach of the machine.
- `part-e-door-networks-measured.txt`: the coordinating session's measurement, after the run, of the door on other kinds of network (gap 190).
- `controls-output.txt` and `controls-scripts/controls.py`: the controls.
- `run-typecheck.txt`, `run-licences.txt`, `run-tests-full.txt` and `full-checks.sh`: the full checks (the run of record; the log of the run that was cut off held only its first lines and was replaced, section "The full checks").
- `reopened/`: packages 2.1 and 0.5 run again, with their pictures and a README.

Paths of this machine are written `<run folder>`, `<tmp>` and `<repo>`.

Written after the run's secret search, and so not covered by it: this file, `part-d-way-back-measured.txt` and `first-run/run-demo.txt` (the first run searched its own log for its own four secrets, with no hit; only paths were replaced in it since), and everything added with the controls, the full checks and the reopened packages. None was written from anything that held one of the run's secrets: those were made by the run and are gone with it. The reruns of 2.1 and 0.5 made passwords of their own, in memory, never printed; their logs were searched for the forms such a password takes, with no hit.

## Checked and assumed

- **Checked by the run:** everything in the table above, on real containers, with the builder that made the export stopped and its data deleted; and the two failures of the door's side.
- **Checked after the run:** the controls (75, each failed its test), the full checks and the reopened packages, above.
- **Not checked:** a clean machine (the copy's build here took every step from layers made earlier on this machine; with an empty build cache and an empty npm store it would download its packages: inferred, milestone 6); another machine; that the exported app cannot reach the owner's 4020 (inferred from the 127.0.0.1 listener, not probed); the Arabic, by a reader of Arabic; the run by a reviewer; five checks of the check from the copy, which no test sees (gap 204).
- **Assumed:** that a CACHED install step built on Docker's default network from npm's store counts as "the builder stopped" is question 23, the owner's.

## Not done

- **The two failed checks.** The run does not pass section 7 as designed. Fixing it needs a decision: the door on a network that cannot reach the machine, or a different check. Neither is Claude Code's to make.
- 3.2 stays "built, not tested". Other reasons hold too:
  - questions 23 to 25 are open;
  - package 3.1 is not tested;
  - the review by risk (design section 8) has not been done.
- `docs/STATUS.md` and `docs/QUESTIONS.md` are not updated here (section "Records"). Points (3) and (19) of the decisions also belong on the questions file's "Yours to confirm".
- No test was written for the five checks gap 204 names.
