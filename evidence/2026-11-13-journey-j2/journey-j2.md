# J2: the broken copy rejected, and a restart mid-step — evidence of the automated run

| | |
| --- | --- |
| Package | J2, parts (a) and (c) (planned in `docs/design/journey-j1.md`; part (b), package 3.2, comes after) |
| Design | `docs/design/journey-j2.md` (final design after two independent critiques; the owner answered its one question on 14 Nov 2026, option (a); section 13 lists the changes made during the build) |
| Branch | `claude/j2-broken-and-restart`, from `claude/stage-1` at `14787d8`; pushed up to `5a2254d` (13 and 14 Nov 2026), every later commit on this machine only; no pull request opened. *Corrected after the review, 14 Nov 2026: this said "not pushed".* Brought up to date with `claude/stage-1` at `c4f198b` on 14 Nov 2026 (merge commit `3231071`; see the last section) |
| This file | 14 Nov 2026. First version: the automated run of section 7. Completed the same day with the controls of section 6 and the full checks (the whole suite, typecheck, licence check). Written by Claude Code. Reviewed once, on 14 Nov 2026: see "After the review". Brought up to date with the integration branch at `c4f198b` the same day, and the automated run repeated on the merged head: see the last section; "The automated run" and the sections after it describe that run |
| Machine | The development machine (a cloud session); the run under the shared lock, with its own database (`builder_j2_<run>`), data folder and port (127.0.0.1:4022); the live preview off; real Docker; the scripted engine only, no model called |

## What the owner can now do

**(a) Watch the checklist reject a broken app, on his own screens.** On the Projects screen, a panel of its own, labelled **"Simulated build"**, has one button: **"Start the broken-copy demonstration"** (always shown: his answer of 14 Nov 2026). It makes a project the builder names itself, "Deliberately broken copy (made-up)", capped at $5.00. Every page of it, and its row in the list, carries the badge **"Deliberately broken copy: a defect Claude Code planted on purpose"**, in English and Arabic. He goes through the same screens as in J1. The plan has a third step, written in advance by Claude Code for package 3.1: a new leave request is saved as Approved instead of Waiting. It builds, and he can approve it: nothing checks the app after a step yet, and there is no retry, and the plan and build screens say so. The preview's pictures show the app's own banner, "This is a deliberately broken copy, made to be rejected by the acceptance check." He presses "Run the checklist": the result reads **Failed**, item 1 **Failed**, "Failed at step: sees status waiting", with the checker's own picture. There is no sign-off button and no Export tab. "Close project" removes it.

- **What this shows:** the checklist runner, run for real against the real app, rejected one defect that was planted on purpose.
- **What it does not show:** that the checklist catches defects in general. Claude Code wrote both the defect and the test, each knowing the other. It is a "stand-in test, not independent acceptance".

**(c) See what happens when the builder's interface stops in the middle of a step** (shown by the automated run, with pictures; not done on his own instance):
- **A stop on purpose** (SIGTERM, a polite request to stop, as a service manager sends one): the interface stops the step, marks the project interrupted and removes its containers (sealed boxes on the machine in which a step or the app runs) before it exits.
- **A crash** (SIGKILL, the interface ended at once): its containers stay until the next start, which removes them.
- After either, the project's screens say it was interrupted and offer only "Close project" or "New project". Nothing is resumed. The cost screen shows the step's reservation released, marked "stopped part-way when the interface stopped; not resumed", and $0.00 spent.
- **On his own instance, from J2 on:** stopping the interface on purpose removes the containers of his open projects at the stop, instead of at the next start. Either way they end interrupted, not resumed.

## Each screen: real or simulated

| Screen | Marked | What is real | What is simulated |
| --- | --- | --- | --- |
| The "Simulated build" panel | Simulated, with "The checklist run on it is real." | The project it makes, its first event (the choice, in one transaction) | The three steps: fixed changes written in advance by Claude Code; no model call |
| The badge, on every page and the list row | Added by the system, from the record | — | — |
| Plan and build steps | Simulated (each step); Real (the job) | The step's container, the history, the reservation and its release | The changes, step 3 broken on purpose |
| Preview | Real | The app, built and started in the project's sandbox; the app camera's pictures; the banner, the app's own | — (made-up sample data) |
| Checklist | Real (the run); Simulated (the test, "stand-in test, not independent acceptance") | The runner's run against the running app, its outcome and item 1's failure | The test, written in advance by Claude Code |
| Sign-off | Real | No button: refused on any trace of the broken copy | — |
| Interrupted panel, build line, cost note (c) | Real | Written by the interface from what happened | — |
| "Demonstration setting" line (c) | Shown as a warning while the pause is on | The pause (4,000 ms before each write, in the run) | — |

## The automated run

`flock <scratchpad>/live-tests.lock npx tsx scripts/demo-journey-j2.ts <evidence folder>`, from `builder/`, on the merged head, commit `3231071` (`builder/` tree `993b1f0`), 14 Nov 2026, lock held 10:02:04 to 10:04:37 UTC (`lock-lines.txt`). `TMPDIR` was a short link, `/tmp/j2mg-10d8e4`, to a folder in the session's scratch folder, removed after the run: with `TMPDIR` set to the scratch folder's own path, tsx's wrapper could not make its socket there (a socket path holds at most 107 bytes) and start 2 did not start (the first try, `after-merge/first-try/`: 72 of 73 checks, start 2 failed with EADDRINUSE; nothing of its one project left).

**Result: 150 of 150 checks passed; 41 of 41 screenshots copied; exit code 0** (`run-demo.txt`, its last lines). The run before the merge, on `c81eccb` (`builder/` tree `8449a9a`), 04:56 to 04:58 UTC, also passed 150 of 150 with 41 screenshots; its log and lock lines are in `run-before-merge/`, and its events, camera lines, interface log and screenshots in this folder as of commit `93d59ec`.

How it ran (design section 7):
- **Before:** the runner image checked (`runnerImageProblem`); nothing named `builder_j1-` on the machine (else it refuses); ports 13161 and 4022 free (it waits, and stops nothing); a fresh database, data folder and camera folder, all in one run folder; a random interface password, given to the interface in its environment and to the builder camera as one read-only file (mode 0400), never printed.
- **Start 1** (`node --import tsx`, no setting): the builder camera's walk `j2a`, the whole of (a), then "Close project". SIGTERM: exit 0, "removed at the stop: 0".
- **Start 2** (`node_modules/.bin/tsx`, as `npm run web` starts it; the demonstration pause 4,000 ms): walk `j2c-run`, project P1 "Restart: clean stop (made-up)" to step 2 running, photographed; the walk ended. The run checked T1, then sent SIGTERM to the wrapper's process id only.
- **Start 3** (`node --import tsx`, the pause on): T5; walk `j2c-after` for P1 (T6, T7); walk `j2c-run` for P2 "Restart: crash (made-up)"; K1; then SIGKILL to that node process itself.
- **Start 4** (`node --import tsx`, no setting): K3, K4; walk `j2c-after` for P2 (K5, K6). SIGTERM: exit 0.
- No signal was sent while a camera walk ran. Signals went only to the process ids the run started. Clean-up was only by the run's exact project ids and its cameras' exact names; nothing was left to clean.

Timing, measured (`run-demo.txt`), the same as in the run before the merge: walk `j2a` took 77 s; `j2c-run` 25 s for P1 and 24 s for P2, step 2's first write recorded about 24 s into the walk (step 1's four writes at 4 s each came first), so the signal came with 1 of step 2's 8 files written. The tsx wrapper exited 0.6 s after SIGTERM; the interface started directly exited 0.2 s after it.

A first run (commit `5a624d5`, 04:34 UTC) also passed, 147 of 147, but its script kept the shared lock about 95 s after its end (timers), counted one write of P1 in a K1 sample, and left processes out of K4's first look. All three were fixed in the script, and the run above is the run of record. The first run's log is in `first-run/`.

## The checks, item by item

Each line of `run-demo.txt` that starts "PASSED" is one counted check; the camera's own lines are also in `camera-lines.jsonl`.

### J2 (a): the broken copy rejected (70 checks)

| Design item (section 2) | Shown by | Pictures |
| --- | --- | --- |
| 1. The panel, "Simulated build", one button, apart from "New project"; the New project form's three fields | Camera | `01-projects-en`, `-ar`, `-phone`; `02-new-project-en` |
| 2. One project, "Deliberately broken copy (made-up)", $5.00 cap; its first event `intake.brief_entered` carrying `broken_copy` (by owner, step 03-wrong-status, source, label, manifest SHA-256, `sign_off: "never"`, `export: "never"`); the badge on every page (10 screens) and the list row, in English and Arabic | Camera; the run's database query and record check | `03-brief-en`, `-ar`; `12-projects-end-en` |
| 3. Three steps on the plan, step 3's label and sentence; `journey.plan_confirmed` lists the three, `broken_copy: true`; the quality-check line on the plan and build screens | Camera; record | `04-plan-en`, `-ar`, `-phone` |
| 4. Steps 1 to 3 built and approved; $1.5552, $3.1104 and $1.1664 made and released; $0.00 spent; exactly one `journey.broken_step_staged` (event 56), after step 2's approval (54) and before step 3's first engine event (58), its SHA-256 read back from the sandbox's own copy, equal to the chosen one; no other project has one | Camera (the approve buttons' wording too); record | `05-build-step-3-en`, `-ar`, `-phone` |
| 5. The app camera's pictures in both languages; its banner lines: English pages carry "This is a deliberately broken copy, made to be rejected by the acceptance check.", Arabic pages "هذه نسخة معطّلة عمداً، صُنعت ليرفضها فحص القبول." | Camera (four pictures loaded); record (four banner lines) | `06-preview-en` |
| 6. Outcome `failed`, shown "Failed"; exit code 1; version v001, the one fixed at "Confirm plan"; the summary `version failed: item 1 failed at step "sees status waiting"`; item 1 "Failed", "Failed at step: sees status waiting", the runner's picture; items 2 to 6 "did not run"; the failure file exists, its SHA-256 is the event's, its text holds "Approved" (not copied here) | Camera; record; the run read the file | `07-checklist-en`, `-ar`, `-phone` |
| 7. No sign-off button; "Sign-off is offered once a checklist run has passed." and "A deliberately broken copy is never signed off or exported."; no Export tab; no `journey.signed_off`, no `journey.export.written` | Camera; record | `07-checklist-*`; `08-sign-off-en` |
| 8. Three reservations, each "closed (step_ended)"; $0.00 spent | Camera; record | `09-cost-en`, `-ar`, `-phone` |
| 9. The record, every event in id order (92 before closing); nothing of the project left (N) | Camera; Docker's and the machine's lists | `10-record-en`, `11-closed-en` |
| J1's six network checks on the app's containers (no published port; only the door's machine side on the machine's network; the app camera and the runner on the front network alone) | Docker's list, every 0.5 s during the walk | — |
| Start 1's stop: exit 0, "removed at the stop: 0", the interface's own last line "Exit code 0." | The interface's lines | — |

Item 10 (the normal path unchanged) is shown by tests, not by the run: the regression guards A1, A1b, A2b's extra-field part and C8, which pass at `14787d8` too (`new-tests-a-before-and-after.txt`, `new-tests-c-before-and-after.txt`).

### J2 (c): a restart mid-step (75 checks)

| Design item | What the run found |
| --- | --- |
| T1 | The camera saw step 1 approved and step 2 running, the running note, the demonstration setting line and 1 file written (`21-t-build-running-en`), and exited 0. Then the record held 1 of step 2's 8 writes, and Docker listed `builder_<P1>-engine-02-submitter-screen-2baa2b`. |
| T2 | SIGTERM to the tsx wrapper: exit code 0 after 0.6 s. The interface's lines named the job (`job-a42f91fe`) and the sandbox it removed, said "removed at the stop: 1" and ended "Exit code 0." (`interface-log.txt`, start 2). |
| T3 | Right after the exit, before any restart: nothing of P1 left (N): no container, volume, network, image or process, the folder gone. |
| T4 | `journey.job.interrupted` with "…stopped on purpose (SIGTERM)…"; `step.hold_closed` step_ended; `journey.sandbox.removed` with `interrupted: true`, `removed: true` and the stop's own reason; no job finished or failed, no `journey.workspace.reset`. |
| T5 | The restart printed "…removed at start: 0."; the camera signed in again. |
| T6 | The project page opened its build screen with the interrupted panel, only "Close project" and "New project"; step 2 "Interrupted: the interface stopped while it ran.", no build, approve or retry button; no sign-off button on the build or checklist screen; cost: step 2 "closed (step_ended)" with the part-way note, step 1 without it, step room $0.0000, spent $0.00 (`31-t-…`, `32-t-…`, each in English, Arabic and at 390 px). |
| T7 | "Close project" opened the record, which ends with `journey.closed` (`33-t-record-en`, `34-t-closed-en`). |
| K1 | As T1, for P2 (`41-k-build-running-en`). |
| K2 | SIGKILL: ended at once. Left, as found: step 2's engine container and its `docker compose run` process; the sandbox folder still there (checked). |
| K3 | The restart (first try) printed "…removed at start: 1."; the record: "The interface stopped while this job ran. It is not resumed.", `journey.sandbox.removed` "Found at start…" with `interrupted: true`, `removed: true`; `step.hold_closed` job_interrupted. |
| K4 | Right after the recovery, and again once no process named `builder_<P2>`: nothing of P2 left (N), processes included. |
| K5, K6 | As T6 and T7, the cost screen reading "closed (job_interrupted)" with the same note (`51-k-…`, `52-k-…`, `53-k-record-en`, `54-k-closed-en`). |
| Start 4's stop | Exit 0, "removed at the stop: 0". |

"closed (step_ended)", in plain words: the step's reservation was given back when the step ended. After a stop on purpose the step ends through the halt, so its reservation reads step_ended like a finished step; the note under it says this one stopped part-way. After a crash the next start closes it as job_interrupted.

### The whole run (5 checks)

Nothing of the three projects left (N); no container of the run's builder camera; the run folder removed and the database dropped. Also checked: no other project had a `journey.broken_step_staged`, and the run's record holds no sign-off and no export.

## Screenshots (`screens/`, 41)

| File | What it shows |
| --- | --- |
| `01-projects-en`, `-ar`, `-phone` | The Projects screen: the "Simulated build" panel and its one button, apart from "New project" |
| `02-new-project-en` | The New project form: name, cap, brief |
| `03-brief-en`, `-ar` | The broken copy's brief, the badge next to its name |
| `04-plan-en`, `-ar`, `-phone` | The plan's three steps; step 3's label and sentence; the quality-check line |
| `05-build-step-3-en`, `-ar`, `-phone` | The build screen after step 3: three steps, each reservation released; "Go on to the preview with this broken step (no quality check after a step yet)" |
| `06-preview-en` | The app camera's four pictures of the running broken copy (its banner at the top of each) |
| `07-checklist-en`, `-ar`, `-phone` | The checklist: Failed; item 1 Failed at "sees status waiting", with the runner's picture (the new request marked Approved); items 2 to 6 did not run; the sign-off panel with no button |
| `08-sign-off-en` | The sign-off panel alone |
| `09-cost-en`, `-ar`, `-phone` | $0.00 spent; three reservations, each closed (step_ended) |
| `10-record-en` | The record before closing, 92 events in id order |
| `11-closed-en` | The record after "Close project" |
| `12-projects-end-en` | The list after (a): the closed broken copy with its badge |
| `21-t-build-running-en` | P1, step 2 running with 1 file written; the demonstration setting line |
| `31-t-build-interrupted-en`, `-ar`, `-phone` | P1 after the restart: the interrupted panel; step 2 "Interrupted…" |
| `32-t-cost-en`, `-ar`, `-phone` | P1's cost: step 2 closed (step_ended), stopped part-way |
| `33-t-record-en`, `34-t-closed-en` | P1's record; after "Close project" |
| `41-k-build-running-en` | P2, step 2 running with 1 file written |
| `51-k-build-interrupted-en`, `-ar`, `-phone` | P2 after the crash and restart: the interrupted panel; step 2 "Interrupted…" |
| `52-k-cost-en`, `-ar`, `-phone` | P2's cost: step 2 closed (job_interrupted), stopped part-way |
| `53-k-record-en`, `54-k-closed-en` | P2's record; after "Close project" |

Each picture of the run on the merged head was looked at (the tall ones in pieces) for a password, a pass, a secret, an email address or a real name: none is shown. The only email address is the app's made-up sample user, `employee@example.test`, on the record pages; the names are the projects' made-up names and the app's "Sample Employee". No sign-in page is photographed; the password is typed only into the sign-in form and never photographed; the record pages hold the run's events, which hold no password (checked by the run before `events.json` was written, and `events.json` searched again after: no field named for a pass, a secret or a password). Run folder paths show on the record pages (the short link and the scratch folder's own path); the folders were removed after the run.

## Files

- `run-demo.txt`: the run's own log, each check with its detail, the lists of Docker and the machine between the starts (counts, and what N matches of each project), the disk, the result.
- `events.json`: every event of the run's database, 193, for the 3 projects, in id order (by number: checked, 1 to 193), the run folder written `<run folder>`. *The run before the merge sorted them by the id as text (1, 10, 100, …); corrected after the review (`after-review/events-order.txt`), and fixed in the script, whose new order this run is the first to use. Six paths the record holds through the folder's real path (screenshots and the checklist's files) were also written `<run folder>`, by hand after the run.*
- `camera-lines.jsonl`: every line of the five camera walks, each walk starting with a `{"kind":"walk"}` line.
- `interface-log.txt`: the interface's own output, each line marked with its start (1 to 4).
- `lock-lines.txt`: the lock lines around the run. `first-run/`: the first run's log (13 Nov code). `run-before-merge/`: the log and lock lines of the run before the merge. `after-merge/`: the checks after the merge, and the first try on the merged head (`first-try/`).
- `new-tests-a-…`, `new-tests-c-…`, `touched-test-files-c.txt`: the tests of parts (a) and (c), before and after (written by those parts).
- `controls-scripts/controls.py`, `controls-output.txt`: the controls (below).
- `full-checks.sh`: the script that ran the controls, the whole suite, the typecheck and the licence check; `run-tests-full.txt`, `run-typecheck.txt`, `run-licences.txt`: their output.
- `after-review/`: the checks after the review (see "After the review"): `checks-after-review.sh`, `new-tests-before-and-after.txt`, `controls-after-review.txt`, `run-tests-full.txt`, `run-typecheck.txt`, `run-licences.txt`, `events-order.txt`.

## The controls (design section 6)

A control removes one safeguard from the code, runs the test that guards it alone, and checks that the test now fails; then the code is put back. It shows that the test would notice if the safeguard were lost. `controls-scripts/controls.py`, run from `builder/` under the shared lock by `full-checks.sh`, on `5a2254d` (`builder/` tree `8449a9a`, the tree of the automated run), 14 Nov 2026; output in `controls-output.txt`.

- **How:** each safeguard is removed by replacing an exact piece of text that occurs once in its file (the script refuses a text that occurs any other number of times); the named tests are run alone (`npx vitest run <file> -t <name>`); then the file is put back with `git checkout` and checked unchanged. Before the controls, each of the 30 named tests was run once on the code as committed: each passed, and each name selected exactly one test. *Corrected after the review, 14 Nov 2026: this said 31, the number of section 6's controls (J2-C01 to J2-C31), not of tests (14 in `test/journey.test.ts`, 16 in `test/web.test.ts`). The message of commit `74736fd` says 31 too; it is not rewritten.*
- **Result: 42 of 42 controls failed their tests, as they should.** After every control the code was the same as committed (`git diff HEAD` empty).
- **Section 6's table:** its 30 rows are J2-C01 to J2-C31 (the row "the second wording; the cost note" is two controls, J2-C27 and J2-C28). Each names the test the design names; where the design names two tests (J2-C02: A1b and A3; J2-C05: A1 and A4) or a test written in both files (A6, A7, A9), each was run and each failed.
- **Safeguards the builders added (design section 13), J2-C32 to J2-C42:** the name refusal's folding of capitals and spaces (A2b); the job refusing the broken step when staging is refused (A4); the comparison of the staged manifest's SHA-256 (A4); the target check's "not under builder/" (A4); the stop setting the 503 flag (C9); the bound on the wait for the running job (C4); the removal ending once the process has exited (C11); the pause setting's upper bound (C6); the pause recorded (C6); the build screen's pause line (C6); the clean stop installed on SIGTERM in the real process (C5).
- **Two controls failed by running into the test's time limit (20 s)**, as a stop that waits for ever would: J2-C23 (the lock check unbounded) and J2-C37 (the wait for the running job unbounded). Each left its test's own database, which the script then dropped (`controls-output.txt`, last line).
- **No control here:** `POST /projects` with extra fields (A2b's guard part), as section 6 says: the safeguard is that the form takes no choice at all. And the adapter's own target check before staging (`example1Sandboxes().stageBrokenStep`, `builder/src/orchestrator/example-1-adapter.ts`): no test reaches the real adapter's method, which needs a real sandbox; the job's own check, which runs first, has its controls (J2-C07, J2-C35). The automated run went through the adapter once, on its own folder.

## The whole suite, the typecheck and the licence check

Run by `full-checks.sh` from `builder/`, as J3's were (`evidence/2026-11-13-journey-j3/after-bot/full-suite.sh`): under the shared lock, with `BUILDER_BROWSER_CACHE` set, on a fresh database `builder_test_j2_full` (dropped after), `TMPDIR` in the session's scratch folder.

- **The whole suite: 728 of 728 tests passed, in 29 of 29 test files, none skipped**, live tests included (package 3.1's run D among them), on `74736fd` (`builder/` tree `8449a9a`, as in the automated run), 14 Nov 2026; the lock held from 05:45:24 to 06:02:42 UTC (`run-tests-full.txt`). No container on the machine before or after; after, no short preview folder left in /tmp and no database of the J2 (c) tests left. Free disk 6.1 GB before, 5.9 GB after.
- **Run D, which part (a)'s report recorded failing here:** at 03:20 UTC on 14 Nov it failed on this worktree, and on `14787d8`'s own code too (the project's `egress-host` container exited with code 1). This worktree's `node_modules` was then a link into another worktree's, and has since been made a folder of its own; that this was the cause is assumed, not shown. In the run above, run D passed.
- **`npm run typecheck`:** passed, exit code 0 (`run-typecheck.txt`).
- **`npm run check:licences`:** passed for `builder/` and `builder/runner/`, exit code 0; no dependency file and no image list changed since `14787d8` (`run-licences.txt`). No dependency was added by J2.

## Checked and assumed

- **Checked (by the run, with the output named):** every item above; that the run used real Docker and the real interface process, started as named; the disk: 16.48 GB free at the start, 15.43 GB at the lowest, so about 1.0 GB used at once (sampled every 2 s); after the run, no container on the machine, nothing named `builder_j1-`, ports 4022 and 13161 free.
- **Checked by reading the pictures:** the screens listed above show what their lines say, in both languages where taken.
- **Assumed, not shown:** that the clean stop behaves the same on a slower machine or with a job that cannot be stopped (the 30 s wait, the 5 s lock check and the 90 s bound were not reached here: every stop took under 1 s); and what a `docker build` left running by a stop or a crash does: it can outlive the next start's removal (here each stop came mid-step, with no image build running; gap 178).
- **Not shown here because the run's live preview was off:** the broken copy's live refusal ("A deliberately broken copy is not offered as a live app…"). Test A7 shows it with the front on.

## Not done

- **Ctrl-C to the process group, a real PostgreSQL restart, WebKit:** not tried.
- **The review the design asks for (section 8):** done once, on 14 Nov 2026: see "After the review".
- **The records** were updated on 14 Nov 2026, after the controls and the full checks: DECISIONS (the owner's answer word for word, and Claude Code's choices), the BUILD-PLAN progress row (and the stale J1 and J3 rows corrected), KNOWN-GAPS 175 to 180 and gap 139, SOURCES (tsx's signal relay and exit code), STATUS, QUESTIONS, the Arabic wording list, and the design's section 12 (answered (a)). Gaps 175 to 180 were renumbered from 162-167 on 14 Nov 2026, because 162 was taken by pull request #40.
- **J2 (b), package 3.2**, the real engine, the quality check after each step and its one retry, resuming after a restart: not in J2 (design section 10).
- **The owner** has not used any of it himself; nobody has started an interface with this branch for him.

## After the review

*Added by Claude Code on 14 Nov 2026.* The review of design section 8 read `5ed7f04`, by fresh reviewers that did not write the code, each through a lens of its own (among them acceptance separation and the claims). This is the one round of fixes after it (build plan section 3, step 7). Files in `after-review/`; the script, `after-review/checks-after-review.sh`, written as `full-checks.sh`.

**The three blocking findings: each was checked, and each was right. All three were wording in the records.**

| Finding | Checked | What was done |
| --- | --- | --- |
| "The controls" said each of the **31** named tests was run alone before the controls; the output shows 30 | `grep -c ' \| passed, alone \| ' controls-output.txt` gives 30 (14 in `test/journey.test.ts`, 16 in `test/web.test.ts`); the script builds its list from the controls' tests, 30 distinct. 31 is the number of section 6's controls (J2-C01 to J2-C31) | **Corrected** to 30, with a note. The message of commit `74736fd` says 31 too; it is not rewritten |
| `docs/STATUS.md` was **410 words**, over the owner's limit of 400 (build plan section 8, rule 6) | `wc -w docs/STATUS.md` gave 410 | **Rewritten** within the limit (`wc -w`: 396); the version before kept as `docs/log/2026-11-14-status-before-j2-review.md` |
| This file, `docs/STATUS.md` and the plan's J2 row said the branch was **"not pushed"**; it was pushed up to `5a2254d` | `git ls-remote origin refs/heads/claude/j2-broken-and-restart` gave `5a2254dd965620c59adb6126fb24303723517425` (14 Nov 2026, checked again at 06:48 UTC); the commits after it are on this machine only | **Corrected** in all three: pushed up to `5a2254d`, every later commit not pushed, no pull request opened. Nothing was pushed in this round |

**The notes** (the ones that asked for something; the others confirmed what this file says):

| Note | What was done | Shown by |
| --- | --- | --- |
| Two safeguards had no test that failed without them: the trace rule for a `journey.plan_confirmed` that lists step 03 (`isBrokenTrace`), and the real-path half of the staging target check (`brokenStageTargetProblem`) | **Tests added** (`test/journey.test.ts`): **A6b**, a normal project whose record holds only a forged `journey.plan_confirmed` listing step 03 (in the form `confirmPlan` writes, and as plain step names) is refused sign-off and export; **A4b**, the target check with links | Control J2-C43 (the trace rule removed: A6b fails); J2-C44 (the real-path half removed: A4b fails) |
| The target check fell back to the path as written when `engine-change-sets` did not exist yet, so a sandbox folder that is itself a link into builder/ was accepted. Not reachable today: makeExample1 makes the folder with mkdtemp and `engine-change-sets` before any staging | **Fixed** (`16afa9e`): the real path is read as far as the path exists (`realpathAsFar`, `builder/src/orchestrator/journey.ts`): the nearest folder that exists, then the rest of the path. It only widens a refusal; the real adapter uses the same check | A4b failed on `5ed7f04`'s code ("expected 'accepted' to match /under builder\//", at the sandbox folder that is a link) and passes after; control J2-C45 (the old fallback put back: A4b fails) |
| The New project form's name refusal is passed by names that only look the same (a zero-width space; a Cyrillic "е"). Design section 3.1's "a normal project cannot carry the demonstration's name without its badge" holds for the name as written only | **Recorded:** gap 181, and design section 13. Checked again with the check's own expression: the name as written and "deliberately  Broken copy" refused; the three look-alikes accepted. Such a project is a normal one in every rule; the badge comes from the record, so a broken copy cannot be hidden this way | — |
| `events.json` is not "in id order": the run script's query sorted by the id as text (1, 10, 100, 101, …) | **Corrected** in "Files" above. **Fixed in the script** (`order by events.id`, the number), for its next run; the run of record is not repeated. No counted check depended on that order (the reviewer's reading: the record checks sort by number, and item 9's order was read on the record page by the camera). The script's `.at(-1)` look-ups each had one event to find in this run (checked in `events.json`: one `journey.sandbox.made` per project, and one build job and one pause of step 2 for each of P1 and P2) | `after-review/events-order.txt`: PostgreSQL's two orders on made-up ids, and `events.json` sorted as text, not by number |
| The live and export job bodies do not check the trace again; only `JOB_RULES` does, when the job starts, on the same state | Not changed: defence in depth, not a defect (the reviewer's words). Recorded in gap 175 | — |
| Gap 139 still read "package J2 (c) (built, not tested)" | **Reworded:** built; its tests and the automated run passed; not tested under the plan's rule until its pull request merges | — |
| A copy of the database (the same project ids) used by another interface would be treated as its own (a caveat since J1's recovery) | **Recorded** in gap 178, item (8) | — |
| The adapter's own target check has no test | Unchanged, as "The controls" says; it now reads real paths the same way as the job's check, which has tests | — |

**The checks after the review** (on `16afa9e`, `builder/` tree `bfe5217`; each under the shared lock, on fresh databases dropped after, `TMPDIR` in the session's scratch folder):

| Check | Result | File |
| --- | --- | --- |
| The new tests, on `builder/src` as at `5ed7f04` and after | Before: A4b failed at the sandbox folder that is a link; A6b passed, as it should (it guards a rule that was already there). After: 2 of 2 passed; every J2 (a) test of both files, 24 of 24 | `new-tests-before-and-after.txt` |
| Controls | **45 of 45 failed** with their safeguard removed: the 42 of "The controls" again, and J2-C43 to J2-C45. Each of the 32 named tests passed alone first; after every control the code was as committed. two databases were left by controls' tests, as in the first run, where J2-C23 and J2-C37 ran into their test's time limit; both dropped | `controls-after-review.txt`; the script, `controls-scripts/controls.py` |
| `npm run typecheck` | Passed, exit code 0 | `run-typecheck.txt` |
| `npm run check:licences` | Passed, exit code 0; no dependency file or image list changed since `14787d8`; no dependency added | `run-licences.txt` |
| `npm test`, the whole suite, live tests included | **730 of 730 passed, in 29 of 29 files, none skipped** (the 728 before and A4b, A6b); the lock held from 06:44:09 to 07:01:43 UTC. No container before or after; no short preview folder left in /tmp; no database of the J2 (c) tests left; the browser zip in the cache the same size and time after as before | `run-tests-full.txt` |
| The automated run | **Not repeated.** The product change only widens a refusal, which the run passed through once on a real folder; the script's change is the order of its event queries | — |

**Checked and assumed.** Checked: the findings against the files and the remote, the look-alike names against the check's expression, and the checks above. Not checked: the fixes after the review have not been read by a reviewer; the run script's new order has not been run (only its query's order, on made-up ids); the real adapter's target check still has no test.

**The isolation reviewer's notes not handled in the round of fixes** (*added 14 Nov 2026, with the merge below*; recorded, not fixed; also in gaps 178 and 179):
- Gap 178, item (4), says a lock lost while a project is being removed "ends the process at once". That holds only when no job is left running: with a job that outlived the 30 s wait, the removal under way runs to its end, and the exit comes from the stop's own path, with code 1. (The reviewer's reading; not checked again.)
- No test drives the stop with a live session open.
- Rule N, as the automated run matches it (`builder/scripts/journey-restart-checks.ts`, `projectLeftovers`), has three weaknesses, each checked by reading that function and test C8: (1) C8 has no case of a network matched only by its Compose label; (2) the process rule matches only command lines that hold `builder_<P>`, so a lingering `docker compose -f <dir>/compose.yaml` up, down or build of the project, which has no `-p`, would not be seen (matching the sandbox folder's path would be stronger); (3) dangling `<none>` images are not matched.

## Brought up to date with the integration branch at `c4f198b`

*Added by Claude Code on 14 Nov 2026.* The integration branch `claude/stage-1` at `c4f198b` was merged into this branch (merge commit `3231071`). It brought four merged pull requests J2 did not have: #40 (question 18's records), #41 (the phone test's decision: `builder/scripts/probe-phone.ts` and a new test file), #42 (gap 145: a streamed call read above its hold stops its project; the gateway, `store/holds.ts`, migration 013, `test/overrun-stop.test.ts`) and #43 (sign-off and the live app: "Open the live app" refused after sign-off, and an open live session ended before the sign-off is recorded; `journey.ts`, `journey-jobs.ts`, `web/preview.ts`, tests in `test/web.test.ts`). Files in `after-merge/`; the checks' script, `after-merge/checks-after-merge.sh`, written as `after-review/checks-after-review.sh`.

**Each conflicted hunk in code, and how it was resolved** (every refusal of both sides kept; no test of either side dropped or changed):

| File, hunk | Resolution |
| --- | --- |
| `builder/src/orchestrator/journey.ts`, the constants after `EV` | Both kept: J2's `REMOVED_AT_STOP`, `FOUND_AT_START` and `StopRemoval`, then the sign-off fix's `LIVE_AFTER_SIGN_OFF` and `LIVE_CLOSED_BY_SIGN_OFF`. |
| `journey.ts`, `JOB_RULES.export` (in the same hunk as `live`) | J2's rule kept (not signed off, then any trace of the broken copy); the integration branch had not changed it. |
| `journey.ts`, `JOB_RULES.live` | Every refusal of both kept, in this order: plan not confirmed; signed off (`LIVE_AFTER_SIGN_OFF`); the app not running; any trace of the broken copy (`BROKEN_LIVE_REFUSAL`); the scripted-only check. Each side's own order is unchanged; a broken copy is never signed off, so on a real record the two new refusals never meet (a broken copy with a forged `journey.signed_off` gets the after-sign-off refusal: still refused). |
| `builder/src/orchestrator/journey-jobs.ts`, the file's opening comment | Both bullets kept: J2's (a) and (c), then the sign-off fix's. |
| `builder/test/web.test.ts`, the end of the file | Both new `describe` blocks kept, J2's first, then the sign-off fix's, each closed. |

Merged without a conflict, and read: `signOff` (the live session ended after J2's refusals, just before `journey.signed_off` is written) and `attachPreview` (the hook given to the journey). The records: `docs/DECISIONS.md`, every new row of both kept (the integration branch's six, then J2's three); `docs/KNOWN-GAPS.md`, gap 161 kept only in its updated form (closed for use after sign-off; J2's side held the old copy), and every new row of both kept (162, 168, 170, 173, 174; 175 to 181); `docs/SOURCES.md`, both new sections kept. Checked after: no gap number twice (`grep -E '^\| [0-9]+ \|' docs/KNOWN-GAPS.md | awk -F'|' '{print $2}' | sort | uniq -d` printed nothing), no two DECISIONS rows with the same first 120 characters, no question number twice in `docs/QUESTIONS.md` (its `**N.**` entries). `docs/STATUS.md` was taken from J2 and rewritten for the merged state (the version before kept as `docs/log/2026-11-14-status-before-j2-merge.md`).

**One control's text updated:** J2-C14 (the broken copy's live refusal removed) replaced three lines that, after the merge, occur 0 times: the sign-off fix's refusal now comes before "the app is not running", so the same three lines sit two spaces deeper. The control now replaces the merged three lines, which hold the same safeguard (`controls-scripts/controls.py`, with a comment saying so). Every other text to replace, of J2's 45 controls and of the sign-off fix's 8 (`evidence/2026-11-14-fix-signoff-live/controls.py`, not changed), occurred exactly once in the merged code.

**The checks on the merged head** (`3231071`, `builder/` tree `993b1f0`; each under the shared lock, on fresh databases dropped after, `TMPDIR` in the session's scratch folder):

| Check | Result | File |
| --- | --- | --- |
| `npm run typecheck` | Passed, exit code 0 | `after-merge/run-typecheck.txt` |
| `npm run check:licences` | Passed for `builder/` and `builder/runner/`, exit code 0; no dependency file or image list changed since `14787d8`; no dependency added | `after-merge/run-licences.txt` |
| J2's controls | **45 of 45 failed** with their safeguard removed, as they should. Each of the 32 named tests passed alone first; after every control the code was as committed. Two databases were left by controls' tests that ran into their time limit (J2-C23 and J2-C37, as before); both dropped | `after-merge/controls-j2-after-merge.txt` |
| The sign-off fix's controls | **8 of 8 failed** with their safeguard removed, as they should; after every control the code was as committed; no database left | `after-merge/controls-signoff-after-merge.txt` |
| `npm test`, the whole suite, live tests included | **787 of 787 passed, in 31 of 31 files, none skipped** (J2's 730 and the 57 the integration branch added since `14787d8`); the lock held from 09:38:40 to 09:58:31 UTC. No container before or after; no short preview folder left in /tmp; no database of the J2 (c) tests left; the browser zip in the cache the same size and time after as before | `after-merge/run-tests-full.txt` |
| The automated run, again on the merged head | **150 of 150 checks passed, 41 of 41 screenshots, exit code 0**, lock held 10:02:04 to 10:04:37 UTC (the second try; see below). The same figures as the run before the merge: the same event numbers (the broken step staged at event 56, after step 2's approval at 54 and before step 3's first engine event at 58), 92 events before closing, 193 in all, each stop under 1 s | `run-demo.txt`, `lock-lines.txt`, `events.json`, `camera-lines.jsonl`, `interface-log.txt`, `screens/` (each replacing the earlier run's; its log in `run-before-merge/`) |

**The automated run, two tries.** The first try (10:00 UTC, `after-merge/first-try/`) ran with `TMPDIR` set to a folder in the session's scratch folder, as every other check here. Start 1, the whole of part (a), passed; start 2 did not start: tsx's wrapper makes a socket in `TMPDIR`, the run gives the interface `<run folder>/tmp` as its `TMPDIR`, and with the scratch folder's path (83 bytes) in front the socket's path was 127 bytes, above the 107 a socket path may hold, so it was cut short to the run folder itself and refused (EADDRINUSE). The run counted that as a failed check (72 of 73), cleaned up and exited 1; nothing of its one project, no camera container and no run folder were left, and its database was dropped. The second try gave `TMPDIR` as a short link in /tmp (`/tmp/j2mg-10d8e4`) to a new folder in the scratch folder, so every file the run wrote still landed in the scratch folder; the link was removed after the run. This is a change to how the run was started, not to the run or the code. The run before the merge had a `TMPDIR` short enough (not recorded).

**After the run, checked:** no container on the machine; nothing named `builder_j1-`; ports 4022 and 13161 free; the run's database dropped and its run folder removed (the run's own checks); the link gone; no database `builder_j2_*` or `builder_test_j2_mg*` left (`psql`); the four volumes Docker lists are anonymous ones made on 13 Nov 2026, before this work, and were left alone. The scratch folders the checks and the run used (`<scratchpad>/j2mg-tmp`, `<scratchpad>/j2mg-demo-tmp`) were removed after. Found in the first before removing it: 10 folders left by tests in their `TMPDIR`, 3 `builder-acceptance-standin-*` made during the controls (09:37 to 09:38 UTC) and 4 `builder-sb-*`, 2 `builder-user-docker-*` and 1 `builder-home-*` made during the whole suite (09:55 UTC); not looked into further.

**Checked and assumed.** Checked: each conflict against both sides' diffs from `14787d8`; that every refusal of both sides is in the merged rules (read, and shown by both sides' tests and controls passing and failing as they should); the checks and the run above. Not checked: the merge has not been read by a reviewer; nothing was pushed.
