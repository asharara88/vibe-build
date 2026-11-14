# Package 3.2: the export that starts on its own — evidence of the automated run

| | |
| --- | --- |
| Package | 3.2, the exporter (build plan section 7; "Done means": "The app starts from the export with the builder stopped, and the check passes from the exported copy") |
| Design | `docs/design/package-3.2.md` (read by two critics and corrected; not approved by the owner; questions 23 to 27 open; section 13 lists the changes made during the build, part D for this run) |
| Branch | `claude/pkg-3.2-exporter`, from the integration branch at `839be17`; not pushed |
| This file | First version, 14 Nov 2026, written by Claude Code: the automated run of design section 7. Not yet reviewed. The records (status, questions, decisions, known gaps) are not updated here |
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

Paths of this machine are written `<run folder>`, `<tmp>` and `<repo>`.

Written after the run's secret search, and so not covered by it: this file, `part-d-way-back-measured.txt` and `first-run/run-demo.txt` (the first run searched its own log for its own four secrets, with no hit; only paths were replaced in it since). None was written from anything that held a secret.

## Checked and assumed

- **Checked by the run:** everything in the table above, on real containers, with the builder that made the export stopped and its data deleted; and the two failures of the door's side.
- **Not checked:** a clean machine (the copy's build here took every step from layers made earlier on this machine; with an empty build cache and an empty npm store it would download its packages: inferred, milestone 6); another machine; that the exported app cannot reach the owner's 4020 (inferred from the 127.0.0.1 listener, not probed); the Arabic, by a reader of Arabic; the run by a reviewer.
- **Assumed:** that a CACHED install step built on Docker's default network from npm's store counts as "the builder stopped" is question 23, the owner's.

## Not done

- **The two failed checks.** The run does not pass section 7 as designed. Fixing it needs a decision: the door on a network that cannot reach the machine, or a different check. Neither is Claude Code's to make.
- 3.2 stays "built, not tested". Other reasons hold too:
  - questions 23 to 25 are open;
  - package 3.1 is not tested;
  - the review by risk (design section 8) has not been done.
- The records (status, questions, decisions, known gaps) are not updated here: section 13 lists what they need.
