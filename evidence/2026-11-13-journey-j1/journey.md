# J1: the owner's journey on the scripted engine — evidence

| | |
| --- | --- |
| Package | J1 (build plan section 7.7, shared work; the owner's message of 13 Nov 2026, `docs/DECISIONS.md`) |
| Design | `docs/design/journey-j1.md` (final design after one independent critique; not approved by the owner) |
| Branch | `claude/j1-journey`, from `claude/stage-1` at `b52e041` |
| This file | Part 1 only, 13 Nov 2026. Part 2 (build, preview, acceptance, export, the two cameras, the automated run) adds its own sections and the screenshots |
| Machine | The development machine (a cloud session); test database `builder_test_j1`; no container started by part 1's own tests |

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
| `npm run typecheck` | Passed, exit code 0 | `run-typecheck.txt` |
| The whole suite, live tests included, under the shared lock | Passed: 443 of 443 tests in 18 files, exit code 0, 211 s; the live tests ran (none skipped; the approved browser zip in its cache folder); no container on the machine before or after; lock held 12:31:46 to 12:35:17 UTC | `run-tests-full.txt` |
| The same, first run (on an earlier tree) | **Failed:** 1 of 443. The approved-images scan read 76 declarations of the interface's stylesheet (`gap:8px` and the like) as image references written `name:tag`. Fixed by writing the stylesheet with a space after each colon (`gap: 8px`), which no image reference has; the scan was not changed. All checks and the 25 controls were then run again on the new tree | `run-tests-full-first-red.txt` |
| `npm run check:licences` | Passed, exit code 0; no dependency added | `run-licences.txt` |
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
