# J1: the owner's journey on the scripted engine — evidence

| | |
| --- | --- |
| Package | J1 (build plan section 7.7, shared work; the owner's message of 13 Nov 2026, `docs/DECISIONS.md`) |
| Design | `docs/design/journey-j1.md` (final design after one independent critique; not approved by the owner) |
| Branch | `claude/j1-journey`, from `claude/stage-1` at `b52e041` |
| This file | Part 1 (its sections first, as written then) and part 2 (from "Part 2" on), 13 Nov 2026 |
| Machine | The development machine (a cloud session); test database `builder_test_j1`; no container started by J1's own tests; the automated run under the shared lock, with its own database and data folder |

## Part 1: what the owner can now do

Once the interface is started (`npm run web` in `builder/`, with its settings; section "Starting it"), on 127.0.0.1:4020:

1. **Sign in** with one password; a visitor who is not signed in sees only the sign-in page. On a first run, choose the password on the page instead (12 characters or more, twice).
2. **See the project list**: name, stage, cap, spent, and a link to each project's record.
3. **Start a project**: a name, a cap in US dollars, and "What do you need?" (prefilled with example 1's ask; at most 2,000 characters; made-up data only).
4. **See the request restated in one sentence**, then "Continue with example 1" or "Stop".
5. **Answer the 20 questions** of the question bank as a chat, at most three per turn, each with its recommendation and reason, "their call" or nothing, and "something else"; or let the scripted customer answer the rest from example 1's answer sheet.
6. **See the proposed app**: the brief in its seven sections, the Later list, the choice made on his behalf, the checklist of 6; then "Confirm brief".
7. **See the build steps**: the two steps and what each will show, what is not built in scripted mode, and that the quality gate is not done; then "Confirm plan", which fixes the checklist's tests (stand-in tests, labelled).
8. **Read the cost panel** (cap, spent, held, step room, step reservations, freeze, unreconciled list) and **the record** (every event, in id order).
9. Do all of it **in English or Arabic** (a switch on every page; Arabic right to left).

What he cannot do yet: build, preview, run the checklist, sign off or export (part 2). He has not seen any of it: no screenshot is taken in part 1 (the cameras are part 2's, under question A (a)).

## Each screen: real or simulated

| Screen | Marked | What is real | What is simulated |
| --- | --- | --- | --- |
| Sign in, first-run password | Real | The password check, sessions, lock-out | — |
| Projects | Real | The list, read from the database | — |
| New project and brief | Real | The project, its cap and the brief, stored as typed (never given to the engine) | — |
| Restatement | Simulated | — | The analyst: example 1's one-sentence purpose, whatever was typed |
| Questions | Simulated | Each answer recorded as an event; "something else" logged | The analyst: B2's fixed questions for example 1; the scripted customer's answers from the sheet |
| Proposed app | Simulated | The confirmation, recorded | The brief: example 1's app spec, as written (in English on Arabic pages, so marked) |
| Build steps | Simulated | The confirmation; the stand-in tests written to the acceptance store as a version | The plan: the scripted change sets' two steps |
| Cost | Real | Every figure read from the store (budget view, step holds, freezes, unreconciled list) | — |
| Record | Real | Every event, in id order | — |

Every page carries the mode line "Scripted mode: no AI model is connected. The real-model gate is closed." (in Arabic on Arabic pages); a test checks it on every page in both languages.

## Routes

Open without a session: `GET /sign-in`, `POST /sign-in`, `GET|POST /setup` (first run only), `POST /language`, `GET /static/app.css`. Everything else is behind the guard: `POST /sign-out`; `GET /`, `GET /projects`, `GET /projects/new`, `POST /projects`; for a project made here (`j1-` and 12 hex digits): `GET /projects/:id` (to its current screen), `GET …/brief`, `…/questions`, `…/proposal`, `…/plan`, `…/cost`, `…/record`, `…/files/:eventId`; `POST …/continue`, `…/stop`, `…/answers`, `…/answer-rest`, `…/confirm-brief`, `…/confirm-plan`, `…/close`. No GET changes anything.

## What was run, and the results

All in `builder/`, on `builder/` tree `d5cce34` (named in each output; `git write-tree --prefix=builder/` before the first commit, equal to the committed `builder/` tree of part 1's last code commit).

| Check | Result | Output |
| --- | --- | --- |
| `npm run typecheck` | Passed, exit code 0 | `run-typecheck-part-1.txt` |
| The whole suite, live tests included, under the shared lock | Passed: 443 of 443 tests in 18 files, exit code 0, 211 s; the live tests ran (none skipped; the approved browser zip in its cache folder); no container on the machine before or after; lock held 12:31:46 to 12:35:17 UTC | `run-tests-full-part-1.txt` |
| The same, first run (on an earlier tree) | **Failed:** 1 of 443. The approved-images scan read 76 declarations of the interface's stylesheet (`gap:8px` and the like) as image references written `name:tag`. Fixed by writing the stylesheet with a space after each colon (`gap: 8px`), which no image reference has; the scan was not changed. All checks and the 25 controls were then run again on the new tree | `run-tests-full-first-red.txt` |
| `npm run check:licences` | Passed, exit code 0; no dependency added | `run-licences-part-1.txt` |
| 25 controls: each new safeguard removed, its test run | All 25 failed with the safeguard removed | `controls-part-1.txt` |

Part 1's own tests: `test/web.test.ts` (21), `test/intake.test.ts` (11), `test/journey.test.ts` (12). What each control removed:

| Control | Safeguard removed | Test that caught it |
| --- | --- | --- |
| J1-C1 | The sign-in guard | every route without a session gives only sign-in |
| J1-C2 | `csrf()` | a cross-origin POST is refused |
| J1-C3 | The content-security-policy | headers on every page |
| J1-C4 | Escaping of the brief (hono's `raw`) | the brief is escaped on display |
| J1-C5 | The lock-out check before a sign-in | lock-out for the whole server |
| J1-C6, C7 | Files: the inside-the-folder check; the SHA-256 check | serves only a file an event names |
| J1-C8 | The database setting required at start | start is refused without each setting |
| J1-C9 | The environment scrubbed at start | the password and model key taken out |
| J1-C10 | The instance lock's check | one interface per database |
| J1-C11 | The first-run digest file's mode 0600 (made 0644) | first run |
| J1-C12 | A GET that writes an event | no GET changes anything |
| J1-C13, C14 | The rule "no build before both confirmations"; "no export before sign-off" | the two journey tests |
| J1-C15 | The engine wrapper's wait for the event queue | step.hold_closed follows the last engine event |
| J1-C16 | Recovery limited to `j1-` projects | recovery touches journey projects only |
| J1-C17, C25 | One job at a time; the slot taken before the first await | one job at a time; exactly one of two simultaneous starts |
| J1-C18, C19 | The gate: an import of the gateway's journal; another engine named | the gate tests |
| J1-C20 to C22 | B2's words; at most three per turn; R reasons | the intake tests |
| J1-C23 | A message missing from Arabic | the key test |
| J1-C24 | The `j1-` id check on project routes | a project id not made by the journey is not found |

Two controls passed on their first run and were not counted until fixed: J1-C13's first patch removed only half of the rule (the plan check still refused, so the patch, not the test, was too narrow); J1-C18 showed a real hole: the import walker did not follow a bare `import "…"`, now fixed. J1-C25 was added after re-reading the job code found a race (two projects starting a job at the same moment could both start); the fix takes the slot before any await, and its test holds the "job started" write for 200 ms so the race is always exercised.

## Starting it

`BUILDER_DATABASE_URL` (its own database; no default), `BUILDER_DATA_DIR` (an absolute folder outside the repository), and either `BUILDER_UI_PASSWORD` (12 characters or more; automated runs) or `BUILDER_UI_FIRST_RUN=1`; then `npm run web`. It refuses to start without each, and if another interface holds the same database's instance lock. It removes `BUILDER_UI_PASSWORD` and `BUILDER_MODEL_API_KEY` from its own environment once read, starts no gateway, and listens on 127.0.0.1 only (port 4020, or `BUILDER_UI_PORT`).

## Checked and assumed

- **Checked by test:** everything in the tables above; the 20 questions and their options and recommendations word for word against B2's file; example 1's answer sheet against the app spec `loadAppSpec` accepts; the step reservation of a 4-turn step, $1.5552, as the design measured.
- **Not checked:** how the pages look (no screenshot in part 1; the HTML was read); that hono's escaping covers every value (shown for the brief and the project's name only); the Arabic, by a reader of Arabic (gap 134); the interface started as a process and used from a browser (only its refusal to start was run as a process); the owner's live use.
- **Assumed:** the disk floor of 4 GB before a build (not measured; the check itself uses the free space measured at the time).

## Not reviewed yet

J1 gets one fresh review once part 2 is built (build plan section 3, step 6), with the export's copy of tests and the cameras' mounts reviewed adversarially. Known gaps 130 to 134 are part 1's.

## Part 2: what the owner can now do

Part 2 adds, after "Confirm plan" (each with a screen in English and Arabic):

10. **Build each step**: "Build step 1", then its lines as they come (started, the reservation, one line per file written, finished, the reservation released), then "Approve and build the next step"; step 2 the same; then "Approve and start the app for the preview". Nothing goes on without the approval. A step that fails is put back to its last commit and can be tried again.
11. **See the preview**: four screenshots of the running app, signed in as the made-up sample employee, in English and Arabic, each captioned "Screenshot of the running app at <time> UTC. Not live. Sample data."
12. **Run the checklist**: item 1's result with the runner's screenshot, items 2 to 6 "No test written yet: did not run", the summary as the runner's reading wrote it, the label "stand-in test, not independent acceptance" and the stand-in note in full.
13. **Sign off**, offered only after a run that passed, labelled "Sign-off on a simulated build, checked by a stand-in test of item 1 only: not acceptance".
14. **Download the export**, offered only after sign-off: one .tar.gz, labelled internal only and not yet shown to start without the builder.
15. **Close a project**: its containers, images and folder removed; its record stays.

**What was shown on this machine, and what was not.** The automated run (below) walked the journey up to "Confirm plan" and the build screen, and photographed it. It stopped at step 1: the build was refused by the disk check, "This machine has 2.6 GB free; a build needs at least 4.0 GB (a floor assumed, not measured). The build was not started." (`screens/12-build-step-1-stopped-en.png`). Items 10 to 15 were therefore **not shown live**: they ran only in the tests, against a stand-in sandbox with no container (a real workspace and history, the step's fixed change applied on this machine, and stand-ins for the image build, the app camera and the acceptance runner). The floor was not lowered to let the run through (CLAUDE.md, hard rule 8): see "The disk" below.

## Part 2: each screen, real or simulated

| Screen | Marked | What is real | What is simulated |
| --- | --- | --- | --- |
| Build | Real (the job) and Simulated (each step) | The step's container (no network), the history and its commit, the step's reservation (package 1.3) and its release, the disk check | The changes: fixed, written in advance by Claude Code (package 2.1); no model call |
| Preview | Real | The app, built and started in the project's sandbox; the screenshots, taken by the app camera in the project's runner container | — (the app's data is the template's made-up sample data) |
| Checklist | Real (the run) and Simulated (the test) | The acceptance runner's run against the running app (package 3.1), its events, item 1's screenshot | The test: a stand-in test written in advance by Claude Code, labelled "stand-in test, not independent acceptance" (question B (a)) |
| Sign-off | Real | The event, with its label | — |
| Export | Real | The archive: a clone of the history, the tests and a note added in the copy only | Not shown to start without the builder (package 3.2) |
| Refused step | Real | Package 1.3's refusal and its message | — |

## Part 2: J1's "Done means", item by item

From `docs/design/journey-j1.md`, section 3. "Shown" means shown by the automated run of 13 Nov 2026, 13:32 UTC (`run-demo.txt`), with its screenshot; "tests only" means checked by a test with the stand-in sandbox, not live.

| Item | Result | Where |
| --- | --- | --- |
| One automated browser run, from a fresh database and data folder, under the shared lock | Shown (it stopped at step 1, below) | `run-demo.txt` |
| An unsigned visitor gets only sign-in | Shown | `screens/01-sign-in-en.png`, `-ar`, `-phone`; checks 1 to 3 |
| A wrong password is refused | Shown | `screens/02-sign-in-wrong-password-en.png` |
| It signs in | Shown | `screens/03-projects-en.png` |
| Creates "Leave requests (made-up)" with a $5.00 cap; enters a brief | Shown | `screens/04-new-project-en.png`, `05-brief-en.png` |
| Answers every turn | Shown: 8 turns, answered in the form | `screens/06-questions-en.png`, `-ar`, `-phone`; `07-questions-answered-en.png` |
| Confirms brief and plan | Shown | `screens/08-proposal-en.png`, `09-plan-en.png`, `10-plan-confirmed-en.png` |
| Builds and approves both steps, $1.5552 and $3.1104 reserved and released | **Not shown live**: refused by the disk check at step 1. Tests only | `screens/11-build-en.png`, `12-build-step-1-stopped-en.png`, `-ar`; `test/journey.test.ts`, `test/web.test.ts` |
| Sees the preview screenshots | **Not shown** (the app was not built). Tests only, with stand-in pictures | `test/journey.test.ts` ("the preview") |
| Runs the checklist: item 1 passed, 2 to 6 "did not run" | **Not shown live.** The screen tested with the stand-in runner's events | `test/web.test.ts` ("the whole journey through the screens") |
| Signs off | **Not shown live.** Tests only | the same |
| Sees $0.00 spent, no freeze, an empty unreconciled list | Shown, with no step reserved (the build was refused before its reservation) | `screens/18-cost-en.png`, `-ar`, `-phone` |
| Downloads the export | **Not shown live.** Tests only: a real export of a real history, listed and opened | `test/journey.test.ts` ("the export") |
| Opens the record: every event in id order | Shown | `screens/21-record-en.png`; `events.json` |
| A second project capped at $1.00 shows the refusal | **Not shown live** (the disk check comes first). Tests only | `test/journey.test.ts`, `test/web.test.ts` |
| Every screen in English; sign-in, questions, build, acceptance and cost also in Arabic and at 390 px | Shown for sign-in, questions and cost (all three); build in English and Arabic (stopped); acceptance not reached | `screens/` |
| No container, image or folder of J1 left after it | Shown: none before, none after; the database dropped; the run's folder removed | `run-demo.txt` |

## Part 2: the automated run

`scripts/demo-journey.ts`, run as `flock <scratchpad>/live-tests.lock npx tsx scripts/demo-journey.ts <evidence folder>` on `builder/` tree `4259eb0` (13:32 UTC; its output is `run-demo.txt`):

- A fresh database (`builder_j1_<run>`) and data folder; a random interface password, given to the interface in its environment and to the builder camera as one read-only file (mode 0400), never printed or kept; the interface started on 127.0.0.1:4020; the builder camera (`camera/builder-shots.mjs`) in the approved runner image, in a container of its own: read-only root, every capability dropped, the runner's unprivileged user, the machine's network, no video, no trace. It refused every address but 127.0.0.1:4020 inside the browser and checked that none was asked for.
- Result: **19 checks passed, 1 failed** ("step 1 built": refused by the disk check). 21 screenshots, listed above (`screens/`). Every event of the run in `events.json` (in id order); the camera's own lines in `camera-lines.jsonl`; the interface's output in `interface-log.txt` (it shows the refused job, and no address of the session's proxy).
- After it: no container, image, volume or network of J1 (none before either); the database dropped; the run's folder (data, the camera's output, the password file) removed. Other sessions' containers: none during the run.
- An earlier run (13:24 UTC, tree `a7d3ce1`) stopped at the same place with 2.9 GB free and took no picture of the cost panel or the record; the camera was then changed to photograph them after a stop, and everything was run again on the new tree.

## Part 2: the disk

The build refuses below 4 GB free, measured at the moment (`statfs` of the data folder; here on the same disk as Docker's). That floor was assumed, not measured. This machine had 3.5 GB free at 13:05 UTC and 2.6 GB at 13:32 UTC: each full suite run on it adds to Docker's build cache, which every session here shares (17.15 GB, 14.25 GB of it reclaimable, `docker system df` in `run-demo.txt`). J1 prunes nothing it did not make.

Measured instead, twice, while the whole suite ran (its live acceptance test builds example 1's app and runs the runner, as J1's preview would): free space, sampled every 2 s, went from 3.28 GB at its highest to 2.10 GB at its lowest, then, in the second run, from 2.95 GB to 1.78 GB: at most 1.18 GB used at once (GB of 1024^3 bytes; `run-tests-full.txt` holds the second run). That is one measurement of a similar build, not of J1's own (gap 137). Two ways on, for Claude Code and the owner to choose, each recorded first: prune the shared build cache under the shared lock; or set the floor from a measurement of J1's own build.

## Part 2: what was run, and the results

| Check | Result | Output |
| --- | --- | --- |
| `npm run typecheck` | Passed, exit code 0, on tree `4259eb0` | `run-typecheck.txt` |
| The whole suite, live tests included, under the shared lock | Passed: **458 of 458** tests in 18 files, exit code 0, 225 s, on tree `4259eb0`; none skipped (the approved browser zip in its cache folder); no container before or after; lock held 13:28:29 to 13:32:14 UTC. Also passed, 458 of 458, on tree `a7d3ce1` (13:16 to 13:19 UTC) | `run-tests-full.txt` |
| `npm run check:licences` | Passed, exit code 0; no dependency added | `run-licences.txt` |
| The automated run | 19 of 20 checks passed; stopped at step 1 by the disk check | `run-demo.txt` |
| 23 new controls, and part 1's 25 again | All 48 failed with their safeguard removed, on tree `a7d3ce1` (its source and tests are those of `4259eb0`; only the builder camera's script differs) | `controls-part-2.txt` |

Part 2's tests (no container; a stand-in sandbox, `test/journey-stand-ins.ts`): `test/journey.test.ts` 12 new (24 in all), `test/web.test.ts` 3 new (24 in all). Two of part 1's tests were changed only to name the step a build job is for, which part 2 requires. One test of part 1, "the only engine the journey makes", was extended to part 2's modules; those may also read `project-repo.ts` (the history helper), which is not an engine. What each new control removed:

| Control | Safeguard removed | Test that caught it |
| --- | --- | --- |
| J1-C26 | The build job's engine behind the ordering wrapper (each engine event's write held 150 ms) | step 1 runs through the step hold … step.hold_closed after the last |
| J1-C27 | The step run through package 1.3's step hold (the engine called directly) | a project capped at $1.00: step 1 refused before the engine is made |
| J1-C28 | The reset after a failed step | a step that fails leaves nothing behind |
| J1-C29 | The disk check before a step | the disk check: below the floor |
| J1-C30, C31 | A step only after the one before it is approved; approval only once built | step 1 runs through the step hold |
| J1-C32 | The PNG check on the app camera's files | a camera file that is not a PNG is not recorded |
| J1-C33, C34 | One project's app at a time; its ports checked free | one project's app at a time |
| J1-C35 | The camera's folder (and the password file in it) removed after the run | the preview |
| J1-C36 | Sign-off only after a run that passed | the checklist, sign-off and export in order |
| J1-C37 | The tests added in the exported copy only (written into the workspace instead) | the export |
| J1-C38 | The export refused when the history holds a file that looks like a secret | the export is refused when … |
| J1-C39 | Recovery at start removes a sandbox left by an interface that stopped | at start, a sandbox left … only j1- |
| J1-C40, C41 | The adapter removes only a journey project's folder (its compose file's name) and id | the adapter removes only journey sandboxes |
| J1-C42 | The sentence under a refused step | the build screen shows step 1 refused |
| J1-C43, C44, C45 | An item with no test never shown as passed; the stand-in label; no export offered before sign-off | the whole journey through the screens |
| J1-C46 | A GET of the build screen that writes an event | the whole journey through the screens (no GET writes at any stage) |
| J1-C47, C48 | The gate: another engine named in part 2's module; the gateway's journal imported | the gate tests |

## Part 2: checked and assumed

- **Checked, by running it:** the screens up to the build, in a browser, from a fresh database (the automated run); the cost panel and the record after the stop; the disk check refusing a build, live; that the camera loaded nothing but the interface; that nothing of J1 was left after the run; the events in id order.
- **Checked by test only (stand-in sandbox, no container):** the step through the step hold, with its events in order and `step.hold_closed` after the last engine event; $1.5552 and $3.1104 reserved and released; the $1.00 refusal; the reset after a failed step; the approvals' order; the preview's recording of screenshots; the checklist and sign-off rules; the export's contents (a real clone, tar and git); recovery of `j1-` projects only; each screen's labels; no GET writing at any stage.
- **Not checked at all:** the step in a real engine container through the adapter, the app's image build and start through the adapter, the app camera, the acceptance run from the interface, and the export of a real sandbox's history: they need the build, which the disk check refused. The two camera scripts are new; only the builder camera ran.
- **Assumed:** the disk floor of 4 GB (gap 137).

## Part 2: not reviewed yet

No fresh reviewer has checked part 2's claims against this evidence: the session that built it has no tool to start a reviewer, so the review (build plan section 3, step 6, with the export's copy of tests and the cameras' mounts read adversarially) is for the session that runs the work loop. Known gaps 135 to 139 are part 2's.
