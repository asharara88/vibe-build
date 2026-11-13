# J1: the owner's journey on the scripted engine — evidence

| | |
| --- | --- |
| Package | J1 (build plan section 7.7, shared work; the owner's message of 13 Nov 2026, `docs/DECISIONS.md`) |
| Design | `docs/design/journey-j1.md` (final design after one independent critique; not approved by the owner) |
| Branch | `claude/j1-journey`, from `claude/stage-1` at `b52e041` |
| This file | Part 1 (its sections first, as written then), part 2 (from "Part 2" on) and what changed after J1's review ("After the review", at the end), 13 Nov 2026 |
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

`BUILDER_DATABASE_URL` (its own database; no default), `BUILDER_DATA_DIR` (an absolute folder outside the repository), and either `BUILDER_UI_PASSWORD` (12 characters or more; automated runs) or `BUILDER_UI_FIRST_RUN=1`; then `npm run web`. It refuses to start without each, and if another interface holds the same database's instance lock. It removes `BUILDER_UI_PASSWORD` and `BUILDER_MODEL_API_KEY` from `process.env` once read, so no child process inherits them (*corrected after the review:* this said "from its own environment"; the process's starting environment, readable in `/proc/<pid>/environ`, still holds them, gap 130), starts no gateway, and listens on 127.0.0.1 only (port 4020, or `BUILDER_UI_PORT`).

## Checked and assumed

- **Checked by test:** everything in the tables above; the 20 questions and their options and recommendations word for word against B2's file; example 1's answer sheet against the app spec `loadAppSpec` accepts; the step reservation of a 4-turn step, $1.5552, as the design measured.
- **Not checked:** how the pages look (no screenshot in part 1; the HTML was read); that hono's escaping covers every value (shown for the brief and the project's name only); the Arabic, by a reader of Arabic (gap 134); the interface started as a process and used from a browser (only its refusal to start was run as a process); the owner's live use.
- **Assumed:** the disk floor of 4 GB before a build (not measured; the check itself uses the free space measured at the time).

## Not reviewed yet

J1 gets one fresh review once part 2 is built (build plan section 3, step 6), with the export's copy of tests and the cameras' mounts reviewed adversarially. Known gaps 130 to 134 are part 1's.

## Part 2: what the owner can now do

Part 2 adds, after "Confirm plan" (each screen in English and Arabic):

10. **Build each step**: "Build step 1", then its lines as they come (started, the reservation, one line per file written, finished, the reservation released), then "Approve and build the next step"; step 2 the same; then "Approve and start the app for the preview". Nothing goes on without the approval. A step that fails is put back to its last commit and can be tried again.
11. **See the preview**: four screenshots of the running app, signed in as the made-up sample employee, in English and Arabic, each captioned "Screenshot of the running app at <time> UTC. Not live. Sample data."
12. **Run the checklist**: item 1's result with the runner's screenshot, items 2 to 6 "No test written yet: did not run", the summary as the runner's reading wrote it, the label "stand-in test, not independent acceptance" and the stand-in note in full.
13. **Sign off**, offered only after a run that passed, labelled "Sign-off on a simulated build, checked by a stand-in test of item 1 only: not acceptance".
14. **Download the export**, offered only after sign-off: one .tar.gz, labelled internal only and not yet shown to start without the builder.
15. **Close a project**: its containers, images and folder removed; its record stays.
16. **See a refused step**: a project capped at $1.00 is refused before step 1, with package 1.3's message and the sentence under it.

All of it was shown by the automated run of 13 Nov 2026, 13:37 UTC: 45 checks, all passed, 35 screenshots (below). The owner has not used it himself: nobody has started the interface for him.

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

From `docs/design/journey-j1.md`, section 3. All shown by the automated run of 13:37 UTC (`before-review/run-demo.txt`, tree `4259eb0`); each check is one line of `before-review/camera-lines.jsonl`. *After the review:* that run's outputs moved to `before-review/`, and its lock lines were copied there (`before-review/run-demo-wrapper.txt`); the screenshots in `screens/` were replaced by the run after the review (the same 35 names and items; section "After the review"); the 13:37 run's are in the history at commit `0a5121c`.

| Item | Result | Where |
| --- | --- | --- |
| One automated browser run, from a fresh database and data folder, under the shared lock | Shown; lock held 13:37:30 to 13:38:36 UTC | `before-review/run-demo-wrapper.txt` (the lock lines; *corrected after the review:* this cited `run-demo.txt`, which has none) |
| An unsigned visitor gets only sign-in | Shown (`/projects`, `/projects/new` and `/`) | `screens/01-sign-in-en.png`, `-ar`, `-phone` |
| A wrong password is refused | Shown | `screens/02-sign-in-wrong-password-en.png` |
| It signs in | Shown | `screens/03-projects-en.png` |
| Creates "Leave requests (made-up)" with a $5.00 cap; enters a brief | Shown | `screens/04-new-project-en.png`, `05-brief-en.png` |
| Answers every turn | Shown: 8 turns, answered in the form (the recommended option where there is one) | `screens/06-questions-en.png`, `-ar`, `-phone`; `07-questions-answered-en.png` |
| Confirms brief and plan | Shown; tests fixed as v001, labelled | `screens/08-proposal-en.png`, `09-plan-en.png`, `10-plan-confirmed-en.png` |
| Builds and approves both steps, seeing $1.5552 and $3.1104 reserved and released | Shown: each step's lines, 4 and 8 files written, "Reserved while it ran: $1.5552 … released. Spent: $0.00." and $3.1104 | `screens/11-build-en.png`, `12-build-step-1-en.png`, `13-build-step-2-en.png`, `-ar`, `-phone` |
| Sees the preview screenshots | Shown: four, each loaded, each captioned "Not live. Sample data." | `screens/14-preview-en.png` |
| Runs the checklist: item 1 passed, 2 to 6 "did not run" | Shown, with the label, the stand-in note, the summary and item 1's screenshot | `screens/15-checklist-before-run-en.png`, `16-checklist-en.png`, `-ar`, `-phone` |
| Signs off | Shown, labelled | `screens/17-signed-off-en.png` |
| Sees $0.00 spent, no freeze, an empty unreconciled list | Shown, with the two step reservations closed | `screens/18-cost-en.png`, `-ar`, `-phone` |
| Downloads the export | Shown: downloaded in the browser, 415,862 bytes, its SHA-256 the one the page shows and the event records; it holds `acceptance/v001/item-01.spec.ts`, `manifest.json`, `EXPORT-NOTE.txt` and the history; no file that looks like a secret | `screens/19-export-before-en.png`, `20-export-en.png`; `before-review/export-contents.txt` |
| Opens the record: every event in id order | Shown | `screens/21-record-en.png`; `before-review/events.json` |
| A second project capped at $1.00 shows the refusal | Shown: "This step needs up to $1.56 to finish (4 turns); this project has $1.00 left …", with the sentence under it | `screens/23-refused-en.png`, `-ar` |
| Every screen in English; sign-in, questions, build, acceptance and cost also in Arabic and at 390 px | Shown; also the refused step in Arabic | `screens/` |
| No container, image or folder of J1 left after it | Shown: none before, none after; both projects closed through the screens (`22-closed-en.png`); the database dropped; the run's folder removed | `before-review/run-demo.txt` |

Screenshots (`screens/`): 01-sign-in-en, -ar, -phone; 02-sign-in-wrong-password-en; 03-projects-en; 04-new-project-en; 05-brief-en; 06-questions-en, -ar, -phone; 07-questions-answered-en; 08-proposal-en; 09-plan-en; 10-plan-confirmed-en; 11-build-en; 12-build-step-1-en; 13-build-step-2-en, -ar, -phone; 14-preview-en; 15-checklist-before-run-en; 16-checklist-en, -ar, -phone; 17-signed-off-en; 18-cost-en, -ar, -phone; 19-export-before-en; 20-export-en; 21-record-en; 22-closed-en; 23-refused-en, -ar; 24-projects-end-en (35 files).

## Part 2: the automated run

`scripts/demo-journey.ts`, run as `flock <scratchpad>/live-tests.lock npx tsx scripts/demo-journey.ts <evidence folder>` on `builder/` tree `4259eb0` (the committed tree of `0f63492`):

- A fresh database (`builder_j1_<run>`) and data folder; a random interface password, given to the interface in its environment and to the builder camera as one read-only file (mode 0400), never printed or kept; the interface started on 127.0.0.1:4020 (`npm run web`'s own entry point); the builder camera (`camera/builder-shots.mjs`) in the approved runner image, in a container of its own: read-only root, every capability dropped, the runner's unprivileged user, the machine's network, no video, no trace. It refused every address but 127.0.0.1:4020 inside the browser, and none was asked for.
- The interface's jobs did the rest: each step in its engine container through the adapter; the app's images built and the app started in the project's sandbox; the app camera (`camera/app-shots.mjs`) in the project's runner container; package 3.1's runner; the export from the project's real history.
- Result: **45 checks, all passed**; 35 screenshots; 115 events for the 2 projects, in id order, in `before-review/events.json`; the camera's own lines in `before-review/camera-lines.jsonl`; the interface's output in `before-review/interface-log.txt` (the $1.00 project's refused job; no address of the session's proxy).
- After it: no container, image, volume or network of J1 (none before either); both sandbox folders the events record gone; the database dropped; the run's folder (data, the camera's output, the password file) removed. Other sessions' containers: none during the run.
- The app's images were built in 5 s: Docker reused the cached layers of an identical earlier build (the same template and fixed changes; the suite's live acceptance test builds the same). The preview's line "the template's guard check and next build ran in the build" comes from `example-1-sandbox.ts`, unchanged; here they ran in that earlier build, not in this one (gap 136).
- Two earlier runs on 13 Nov (13:24 UTC on tree `a7d3ce1`, 13:32 UTC on tree `4259eb0`) **were refused at step 1 by the disk check**: "This machine has 2.6 GB free; a build needs at least 4.0 GB (a floor assumed, not measured). The build was not started." The 13:32 run's log is `run-demo-earlier-disk-refusal.txt`, with its two screenshots in `screens-earlier-run/`; the 13:24 run's (2.9 GB free) is `run-demo-earlier-disk-refusal-1324.txt` (copied in after the review). The floor was not lowered (CLAUDE.md, hard rule 8). The room came back when this session removed its own temporary folder (below) and the machine's shared build cache shrank (12.61 GB at 13:37, from 17.28 GB; not by this session).

## Part 2: the disk

The build refuses below 4 GB free, measured at the moment (`statfs` of the data folder; here on the same disk as Docker's). That floor is assumed, not measured. Measured on 13 Nov, in GB of 1024^3 bytes, sampled every 2 s:

- J1's own run, at 13:37: free space from 10.09 GB to 9.04 GB at its lowest, so at most 1.05 GB used at once, with the image build served from Docker's cache.
- The whole suite, twice (its live acceptance test builds example 1's app and runs the runner): 3.28 to 2.10 GB, then 2.95 to 1.78 GB; at most 1.18 GB used at once (`run-tests-full.txt` holds the second).
- Found while measuring: the two runs of the whole suite left folders in this session's temporary folder (`builder-sb-*`, `builder-live-*`, `builder-home-*` and others, made by other packages' tests). When this session removed that folder, its own, free space went from 2.6 GB to 5.8 GB (`df`), with Docker's use unchanged (`docker system df`).

None of these measures a build with nothing cached (gap 137).

## Part 2: what was run, and the results

| Check | Result | Output |
| --- | --- | --- |
| `npm run typecheck` | Passed, exit code 0, on tree `4259eb0` | `run-typecheck.txt` |
| The whole suite, live tests included, under the shared lock | Passed: **458 of 458** tests in 18 files, exit code 0, 225 s, on tree `4259eb0`; none skipped (the approved browser zip in its cache folder); no container before or after; lock held 13:28:29 to 13:32:14 UTC. Also passed, 458 of 458, on tree `a7d3ce1` (13:16 to 13:19 UTC) | `run-tests-full.txt`; the run on `a7d3ce1`: `run-tests-full-a7d3ce1.txt` (copied in after the review) |
| `npm run check:licences` | Passed, exit code 0; no dependency added | `run-licences.txt` |
| The automated run | 45 of 45 checks passed, on tree `4259eb0` | `before-review/run-demo.txt` |
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

- **Checked, by running it** (the automated run): every item of "Done means" above, in a browser, from a fresh database, with the real containers: the steps in their engine container, the image build and the app's start, the app camera, the acceptance run started from the screen, the export of the project's real history; the disk check refusing a build (the two earlier runs); that the camera loaded nothing but the interface; that nothing of J1 was left after the run.
- **Checked by test** (stand-in sandbox, no container): the events in emission order with `step.hold_closed` after the last engine event (each write held 150 ms); the reset after a failed step; the camera's file checks; the export refused for a secret-like file; recovery of `j1-` projects only; no GET writing at any stage; each safeguard, by its control.
- **Not checked:** the export started without the builder (package 3.2); recovery at start against real containers (shown only with the stand-in); how the app's own Arabic pages look at full size (the preview shows them small); the Arabic, by a reader of Arabic (gap 134); the owner's own use.
- **Assumed:** the disk floor of 4 GB (gap 137).

## Part 2: not reviewed yet

No fresh reviewer has checked part 2's claims against this evidence: the session that built it has no tool to start a reviewer, so the review (build plan section 3, step 6, with the export's copy of tests and the cameras' mounts read adversarially) is for the session that runs the work loop. Known gaps 135 to 139 are part 2's.

## After the review

J1's one fresh review (build plan section 3, step 6) read commit `0a5121c` (`builder/` tree `4259eb0`) on 13 Nov 2026 and returned **one blocking item and eleven notes**. Its other claims it checked held, apart from the two in "Claims that did not hold" below. The fixes are commits `945c4a2` (`builder/` tree `5662ce6`) and `211870b` (tree `e9a1021`, the run's port; below); this section's outputs are all in this folder.

### What the owner can now do

The same journey as in Part 2, items 10 to 16, with these differences. The sign-in now holds against many attempts sent at once. Arabic pages show step names as they are written ("01-data"). A checklist run whose job failed is shown as failed, and sign-off is not offered on an earlier run. The export holds only the project's own history, checked commit by commit.

### Each item, and what was done

| Item | What the review found | Done | Shown by |
| --- | --- | --- | --- |
| **Blocking 1** | The sign-in lock-out was read before the request's body arrived, so attempts sent at the same moment all passed it: over HTTP, 30 passwords were checked in one burst, and the right one got a session while the server was locked | **Fixed** (`src/web/app.ts`): the lock-out is read after the body, with no wait between it, the password check and the failure count | A new test sends 11 attempts at once: before the fix 11 passwords were checked and the right one got in (`run-new-tests-before-fixes.txt`); after it, 5, and the right one is refused. Control J1-C49. The reviewer's two probes again: 5 checked, the right password refused with 429 (`probe-lockout-after-review.txt`) |
| Note 1 | `csrf()` judges form bodies only: a JSON POST with no Origin, sent with the session cookie, ran its action | **Fixed**: every request but a GET or HEAD must be a form, or it is refused with 415 before any route | New test (before the fix: 303); control J1-C50; gap 132 |
| Note 2 | The Host header is not checked: DNS rebinding on a first run | Not changed; recorded | Gap 131 |
| Note 3 | At start, an interrupted step's reservation stayed open, so the cost panel went on showing it | **Fixed** (`src/orchestrator/journey.ts`): closed at start with package 1.3's close, reason `job_interrupted` | New test (before the fix: still open); control J1-C55; gap 139 |
| Note 4 | Sign-off was judged on the last checklist job that finished, while the screen shows the last run: a later run whose job failed left sign-off offered on an earlier run | **Fixed**: a checklist job that failed or was interrupted counts as the last run, and did not pass; the checklist screen shows its failure | New tests: the journey's (before the fix: signed off) and the screen's; controls J1-C52 and J1-C56 |
| Note 5 | The export's check for files that look like secrets read the last commit only, while the exported copy holds the whole history | **Fixed** (`src/orchestrator/export.ts`): every commit any branch or tag reaches is checked; and the copy is cloned with `--no-local`, so it holds only the objects the history reaches (a local clone copied the whole objects folder, objects no commit reaches among them; found while fixing this) | Two new tests: a `.env` committed and removed again is refused (before: exported); an object no commit reaches is not in the copy (before: it was). Controls J1-C53 and J1-C54 |
| Note 6 | Two requests at once (two tabs) can answer a recorded approval with 409 | Not changed; recorded | Gap 139 |
| Note 7 | On Arabic pages, step ids were reordered ("data-01") | **Fixed** (`src/web/pages.ts`): every step id is shown in `<bdi dir="ltr">` (build, plan, cost, record) | New test in both languages; control J1-C51; screenshots `13-build-step-2-ar`, `18-cost-ar`, `23-refused-ar` |
| Note 8 | Lines this file cites were only in the session's scratchpad | **Copied in**: `before-review/run-demo-wrapper.txt` (the 13:37 run's lock lines), `run-demo-earlier-disk-refusal-1324.txt`, `run-tests-full-a7d3ce1.txt`; the new run's lock lines are in `run-demo-wrapper.txt` | Part 2's references corrected |
| Note 9 | "Removed from its own environment" is true of `process.env` only; `/proc/<pid>/environ` still holds the values | **Wording corrected** in `main.ts`, `auth.ts` and "Starting it" | Gap 130 |
| Note 10 | The password check runs on the interface's only thread | Not changed; measured (about 72 ms per check here, so up to about 0.4 s per lock-out window) | Gap 130 |
| Note 11 | The record's screenshots show the machine's folder paths | Not changed; recorded (not secrets) | Gap 138 |

The review's other notes said what held (the guard, the file server, no GET writing, no session fixation, escaping, the gate, recovery, the export's copy, the cameras, no secrets); nothing to do.

### Claims that did not hold, and what they say now

- "Lock-out: 5 failures, then a lock-out; even the right password is refused while locked" (Part 1's table, gap 130, `docs/DECISIONS.md`): **did not hold** for attempts sent at the same moment. It holds now, shown by the test and the probes above.
- "Lock held 13:37:30 to 13:38:36 UTC", citing `run-demo.txt`: true, but that file had no lock lines. Now cited from `before-review/run-demo-wrapper.txt`.

### The run's port

The first automated run after the fixes, at 14:26:58 UTC, **was refused before it started anything**: another interface was already listening on 127.0.0.1:4020 (`run-demo-refused-port-4020.txt`). That interface was started by the session that runs the work loop, from its own copy of the builder. This work did not stop it. The run can now be given another port (`J1_DEMO_UI_PORT`, commit `211870b`). The builder camera is given that one address, and before its browser starts it refuses any that is not `http://127.0.0.1:<port>`. Shown, with its control, in the approved runner image with no network (`camera-address-check.txt`): with the check, the camera stopped at once; without it, its browser went for the address it was given.

### What was run after the fixes, and the results

| Check | Result | Output |
| --- | --- | --- |
| The 7 new tests, before any fix | All 7 failed, each for the reason the review gave | `run-new-tests-before-fixes.txt` |
| `npm run typecheck` | Passed, exit code 0, on tree `e9a1021` (and on `5662ce6`) | `run-typecheck-after-review.txt` (`-5662ce6`) |
| `npm run check:licences` | Passed, exit code 0; no dependency added | `run-licences-after-review.txt` (`-5662ce6`) |
| The whole suite, live tests included, under the shared lock | Passed: **466 of 466** in 18 files, exit code 0, 232 s, on tree `e9a1021`, none skipped; no container before or after; lock held 14:44:18 to 14:48:10 UTC. Also 466 of 466 on `5662ce6` (14:21 to 14:26 UTC) | `run-tests-full-after-review.txt` (`-5662ce6`) |
| 8 new controls, and the 48 earlier ones again | All 56 failed with their safeguard removed | `controls-after-review.txt` |
| The camera's address check and its control | As above | `camera-address-check.txt` |
| The automated run, under the shared lock, interface on port 4021 | **45 of 45 checks passed**, on tree `e9a1021`; lock held 14:38:09 to 14:39:15 UTC; 35 of 35 screenshots, replacing those of 13:37 (19 byte for byte the same as before; 16 differ, among them the three Arabic screens the fix changes); 115 events for the 2 projects, in id order; the export 380,083 bytes, its SHA-256 the same in the browser and in its event, holding the tests and the note, no file that looks like a secret; the camera loaded nothing but 127.0.0.1:4021; no container, image, volume, network or folder of J1 before or after; the database dropped | `run-demo-wrapper.txt` (with the lock lines), `run-demo.txt`, `events.json`, `camera-lines.jsonl`, `interface-log.txt`, `export-contents.txt`, `screens/` |

J1's own tests: `test/web.test.ts` 28 (4 new), `test/journey.test.ts` 28 (4 new), `test/intake.test.ts` 11. Disk during the run: 13.18 GB free at the start, 12.13 GB at the lowest.

### Checked and assumed

- **Checked:** each fix by a test that failed before it (the blocking item and notes 1, 3, 4, 5 and 7) and by its control; the blocking item also by the reviewer's own probes over HTTP; the screens after the fix, by the automated run and by looking at `13-build-step-2-ar`, `18-cost-ar`, `23-refused-ar` and `02-sign-in-wrong-password-en` (the password field empty).
- **Assumed, not checked:** why the export is smaller than before the review (415,862 bytes then, 380,083 now; likely the clone through git's transfer, which packs only what the history reaches; not measured).
- **Not checked:** the Host header, the thread and `/proc` items left as gaps; the owner's own use.

### Not reviewed yet

No reviewer has read these fixes. Whether they need the review's second round (build plan section 3, step 7) is for the session that runs the work loop.
