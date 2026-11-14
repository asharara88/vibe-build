# J2: the broken copy rejected, and a restart mid-step — evidence of the automated run

| | |
| --- | --- |
| Package | J2, parts (a) and (c) (planned in `docs/design/journey-j1.md`; part (b), package 3.2, comes after) |
| Design | `docs/design/journey-j2.md` (final design after two independent critiques; the owner answered its one question on 14 Nov 2026, option (a); section 13 lists the changes made during the build) |
| Branch | `claude/j2-broken-and-restart`, from `claude/stage-1` at `14787d8`; not pushed |
| This file | First version, 14 Nov 2026: the automated run of section 7. Written by Claude Code. Not reviewed yet |
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

`flock <scratchpad>/live-tests.lock npx tsx scripts/demo-journey-j2.ts <evidence folder>`, from `builder/`, on commit `c81eccb` (`builder/` tree `8449a9a`), 14 Nov 2026, lock held 04:56:17 to 04:58:50 UTC (`lock-lines.txt`).

**Result: 150 of 150 checks passed; 41 of 41 screenshots copied; exit code 0** (`run-demo.txt`, its last lines).

How it ran (design section 7):
- **Before:** the runner image checked (`runnerImageProblem`); nothing named `builder_j1-` on the machine (else it refuses); ports 13161 and 4022 free (it waits, and stops nothing); a fresh database, data folder and camera folder, all in one run folder; a random interface password, given to the interface in its environment and to the builder camera as one read-only file (mode 0400), never printed.
- **Start 1** (`node --import tsx`, no setting): the builder camera's walk `j2a`, the whole of (a), then "Close project". SIGTERM: exit 0, "removed at the stop: 0".
- **Start 2** (`node_modules/.bin/tsx`, as `npm run web` starts it; the demonstration pause 4,000 ms): walk `j2c-run`, project P1 "Restart: clean stop (made-up)" to step 2 running, photographed; the walk ended. The run checked T1, then sent SIGTERM to the wrapper's process id only.
- **Start 3** (`node --import tsx`, the pause on): T5; walk `j2c-after` for P1 (T6, T7); walk `j2c-run` for P2 "Restart: crash (made-up)"; K1; then SIGKILL to that node process itself.
- **Start 4** (`node --import tsx`, no setting): K3, K4; walk `j2c-after` for P2 (K5, K6). SIGTERM: exit 0.
- No signal was sent while a camera walk ran. Signals went only to the process ids the run started. Clean-up was only by the run's exact project ids and its cameras' exact names; nothing was left to clean.

Timing, measured (`run-demo.txt`): walk `j2a` took 77 s; each `j2c-run` 25 s, step 2's first write recorded about 24 s into the walk (step 1's four writes at 4 s each came first), so the signal came with 1 of step 2's 8 files written. The tsx wrapper exited 0.6 s after SIGTERM; the interface started directly exited 0.2 s after it.

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
| T2 | SIGTERM to the tsx wrapper: exit code 0 after 0.6 s. The interface's lines named the job (`job-7eb18240`) and the sandbox it removed, said "removed at the stop: 1" and ended "Exit code 0." (`interface-log.txt`, start 2). |
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

Each picture was looked at for a password, a pass or a secret: none is shown. No sign-in page is photographed in this run; the password is typed only into the sign-in form and never photographed; the record pages hold the run's events, which hold no password (checked by the run before `events.json` was written). Run folder paths show on the record pages; they name this session's scratch folder and were removed after the run.

## Files

- `run-demo.txt`: the run's own log, each check with its detail, the lists of Docker and the machine between the starts (counts, and what N matches of each project), the disk, the result.
- `events.json`: every event of the run's database, 193, for the 3 projects, in id order (the run folder written `<run folder>`).
- `camera-lines.jsonl`: every line of the five camera walks, each walk starting with a `{"kind":"walk"}` line.
- `interface-log.txt`: the interface's own output, each line marked with its start (1 to 4).
- `lock-lines.txt`: the lock lines around the run. `first-run/`: the first run's log.
- `new-tests-a-…`, `new-tests-c-…`, `touched-test-files-c.txt`: the tests of parts (a) and (c), before and after (written by those parts).

## Checked and assumed

- **Checked (by the run, with the output named):** every item above; that the run used real Docker and the real interface process, started as named; the disk: 6.31 GB free at the start, 5.27 GB at the lowest, so about 1.0 GB used at once (sampled every 2 s); after the run, no container on the machine, nothing named `builder_j1-`, ports 4022 and 13161 free.
- **Checked by reading the pictures:** the screens listed above show what their lines say, in both languages where taken.
- **Assumed, not shown:** that the clean stop behaves the same on a slower machine or with a job that cannot be stopped (the 30 s wait, the 5 s lock check and the 90 s bound were not reached here: every stop took under 1 s); that a `docker build` cut off by a crash cannot outlive the next start's removal (here the crash came mid-step, with no image build running; gap 165 in the design).
- **Not shown here because the run's live preview was off:** the broken copy's live refusal ("A deliberately broken copy is not offered as a live app…"). Test A7 shows it with the front on.

## Not done

- **Ctrl-C to the process group, a real PostgreSQL restart, WebKit:** not tried.
- **The controls of section 6 for (c)**, the whole suite on this branch, `check:licences` after this run, and the review the design asks for (section 8): not done in this step.
- **The records** (DECISIONS, BUILD-PLAN progress row, KNOWN-GAPS 162 to 167 and gap 139, SOURCES, STATUS, the Arabic wording list): not updated in this step.
- **J2 (b), package 3.2**, the real engine, the quality check after each step and its one retry, resuming after a restart: not in J2 (design section 10).
- **The owner** has not used any of it himself; nobody has started an interface with this branch for him.
