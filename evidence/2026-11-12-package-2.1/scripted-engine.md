# Package 2.1: the scripted engine

| | |
| --- | --- |
| Date | 12 November 2026 |
| Package | 2.1 of `docs/BUILD-PLAN.md`: "A scripted engine behind the build-engine interface: it makes fixed, known changes and calls no model." It depends on licence code L9, true since 12 November. Branch `claude/pkg-2.1-scripted-engine`, started from `claude/stage-1` at `2bfc8fb`, and rebased after its review onto `claude/stage-1` at `5c8b01a` (pull requests #18 and #19 merged in the meantime) |
| Done means (plan) | "Later packages can exercise their own behaviour with no spend. Anything produced by it is labelled 'scripted' wherever it appears" |
| Run on | The development machine (a cloud session), development profile: the app, database and tools containers share the host's network (known gap 1); the engine container has no network at all. Made-up data only. **No model was called** |
| Result | **Shown on the development profile** (run 3 below, `run-live.txt`, at commit `04cb23e`; and again after the review, run 4, `run-live-4-after-review.txt`, at commit `69b0e28`, whose screenshots are the ones in `screens/` now). In the engine container, the scripted engine applied example 1's two fixed steps to a fresh copy of the template: 4 and 8 files, each step's files exactly the ones its change names, each step committed as `[scripted] example-1 <step>` by "Scripted engine", with zero usage. The built app passed the template's guard check and `next build`, its table was created in the tools container, and as the sample employee a five-day request was sent and listed as "Waiting" (`waiting` in the database), in English, in Arabic and at a phone's width, under a banner that says the scripted engine built it. After the review, 40 tests of this package pass in `npm test` (134 in all), among them 12 that start a container of the engine's image (`run-tests-all.txt`). **State: built, not tested**, until an independent reviewer has read the commit that is merged. The review of this package and what was done about each finding are at the end of this file |

Plain words for the terms used here:
- A **container** is a sealed box a program runs in, with only the files and settings put into it.
- The **scripted engine** is a stand-in for the AI builder. It writes the same fixed files every time and never calls an AI model, so later parts of the builder can be tried at no cost.
- A **change set** is one step's fixed files, with a list (the **manifest**) of what each file does: added, or replacing a file that must be exactly the expected one.
- A **fingerprint** (SHA-256) is a short code worked out from a file's contents; any change to the file changes it.
- A **commit** is one saved entry in the project's history (git), with who made it and why.

## What was built

- **The engine container** (`builder/src/sandbox/manager.ts`), a new `engine` service in the project's Compose file, under its own profile:
  - `node:22-alpine`, run as the user `node` (uid 1000), with the hardening every project container gets (all capabilities dropped, no new privileges, process and memory limits, read-only root, a small `/tmp`), and without the image's start-up script.
  - **No network at all** (`network_mode: none`), no settings file, no environment entry.
  - Three mounts only: the workspace, read-write, at `/workspace`; an empty folder, read-only, over `/workspace/certs`, so the session certificate that the development build needs is not visible to the engine; the change sets, read-only, at `/engine`. A missing source is an error, never created. Each step's protected paths are added, read-only over themselves, for that run only.
  - `up` refuses it. A new `runStreaming` runs one step in a named container, hands on each line as it is printed, and can kill the container by name. `destroy` names the engine profile, so a run that was cut off is removed with the project.
- **Example 1's two fixed changes** (`builder/scripted/example-1/`):
  - `01-data`, 4 files: adds `src/db/app-schema.ts`, the leave-request table (employee, first day, last day, working days, reason, status, manager's note, and the who-and-when stamps); replaces `drizzle.config.ts` to name both schema files; replaces both message files to add the banner sentence. The database itself refuses an unknown status, a last day before the first, and days outside 1 to the calendar days in the range.
  - `02-submitter-screen`, 8 files: My requests (`/my-requests`, an employee's own requests, newest first, with an empty state); the new-request form (`/my-requests/new`) with its checks; the form action `submitLeaveRequest`, which saves the request as `waiting` for the signed-in employee (shown by the screen checks and the database row) and is written to run the form's checks again on the server (designed: the screen run never sends the server a request the browser's check has refused, so none of the server's refusals was reached; what the screen run shows of the server is a sound request accepted and saved); home with links for an employee; both message files with 34 new texts in each language.
  - No template file was edited. The template's example pages stay.
- **The applier** (`builder/scripted/apply.mjs`): applies one step, inside the engine container only. It uses only Node's own modules and prints one line per operation. What it refuses, and how each is shown (all live tests in `builder/test/scripted-engine.test.ts`, run in a container):
  - a protected path: **shown** ("a protected path: the applier refuses to write it");
  - a wrong fingerprint for a replace, with nothing written although the entry before it was sound (so every entry is checked before any is written); an add over an existing file; a path outside the workspace (`../outside.txt` and `/tmp/outside.txt`); a path through a link: **shown** after the review ("the applier's refusals, in the engine container");
  - the turn limit, inside the applier (`--max-writes`): **shown** after the review ("the turn limit inside the applier"); before, only with the stand-in runner, which prints the limit line itself;
  - its own guard: run from anywhere but `/engine`, and in a container with no workspace mounted, it does not start: **shown** after the review (same test). Its third test, that `/.dockerenv` exists, is **designed**: it cannot fail in any container, and running the applier on the machine that hosts the builder to see it fail is what hard rule 9 forbids;
  - a missing copy in the change set, an unknown operation, a copy whose fingerprint differs from its manifest's: **designed** (written, not run).
- **The engine class** (`builder/src/engine/scripted.ts`, `ScriptedEngine`, name `scripted`): starts the container with the step's protected paths mounted read-only; turns the applier's lines into the interface's events (`text`, `tool_call` named `scripted.write`, `blocked`, `finished`, `failed`); usage is always zero; turns are files written; the turn limit is passed to the applier and "turn limit reached" ends the step; an unknown step fails before any container starts; `stop()` kills the container. After the review: no container is started once a stop has been asked for, and `stop()` resolves only when the step has ended; a step's container is killed after a time limit (ten minutes unless set), and the step fails saying so; an event handler that throws ends the step as failed, with the container killed. The workspace and the sandbox come in through its constructor (the interface's step instruction carries no workspace); the step's free-text instruction is not read, and its length is recorded in the first event.
- **The project's history, outside the workspace** (`builder/src/engine/project-repo.ts`): git runs in the builder as `git --git-dir=<sandbox>/workspace.git --work-tree=<sandbox>/workspace`, with hooks, the file-system monitor and every git setting from outside the project switched off. No container mounts the history. After a step, `git status --porcelain -z --untracked-files=all --ignored` must show exactly the change's files, with exactly its contents, and no file git ignores may be new or changed; and, since the review, a walk of the workspace must find nothing git cannot see (an entry named `.git` in any letter case at any depth, a named pipe, a socket, a device). Otherwise the step fails and nothing is committed. Then the step is committed. A failed step can be put back: since the review, with `git clean -ffd` (so a folder holding a repository of its own goes too), the walk's entries removed, and everything still different from the last commit returned as "unrestorable".
- **The demonstration** (`builder/scripts/demo-scripted.ts`) and its screen checks (`builder/scripts/screenshot-scripted.ts`).
- **A helper** (`builder/scripts/scripted-manifest.ts`) that fills in the manifests' fingerprints from the files; it reads files and runs nothing. `npm test` checks the result.

## The "scripted" label, where it appears

| Where | What |
| --- | --- |
| Every screen of the app | The sample-data banner adds "Built by the scripted engine: fixed changes, no AI model." and, in Arabic, "بناه المحرّك المُبرمَج مسبقاً: تغييرات ثابتة، دون نموذج ذكاء اصطناعي." (screens 01 to 08). The layout was not touched; the sentence comes from the change set's message files |
| Every code file written (8 of the 12 files) | First line: "Written by the scripted engine (fixed change example-1/&lt;step&gt;). No AI model wrote this." The four message files are data, which cannot carry a comment; their label is the banner |
| The engine's events and results | Name `scripted`; tool calls `scripted.write`; the first event says no model is called |
| The project's history | Author "Scripted engine &lt;scripted@example.invalid&gt;", message "[scripted] example-1 &lt;step&gt;"; committer "Builder" |
| The evidence | This folder's screenshots are named `NN-scripted-…` |

Not labelled yet: a project row in the builder's own database (no project row is made in 2.1). Whether a scripted project needs a profile of its own is a question for package W1 and the owner (design note 2.8, decision F).

## Decisions taken (recorded in `docs/DECISIONS.md`, standing "Claude Code")

The decisions in the package's brief are recorded as given. Where the brief could not be followed literally, the closest sound thing was done, and it is said here:

- **The role list is `src/app-config.ts`, not `src/lib/app-config.ts`.** The brief named the second, which does not exist. `src/lib/access.ts` reads its `isRole` from `../app-config`, which is `src/app-config.ts`, so that is the file protected.
- **Ignored files are compared with the last commit, not refused outright.** The brief said a step fails if any changed or ignored file is not in the manifest. The session certificate is in the workspace and git ignores it, so a literal reading would fail every step. Instead: an ignored file that was not there at the last commit, or whose fingerprint has changed, fails the step. The fingerprints are kept beside the history at each commit. Tested with a planted certificate and a planted file under `node_modules/`.
- **The image build can skip Docker's cache.** Run 2 below took the whole build from the cache of run 1, because the files were identical, so neither the guard check nor `next build` ran. `sandbox.build` now takes `{ noCache }`, and the demonstration uses it and stops if the guard check's result is not in the build's output.
- **The design note gets dated amendments** (after section 7.1), as build plan section 8, rule 9 requires for a change to the design: push instead of a migration for now, no network for the scripted engine, the history beside the workspace, and the narrow slice of example 1.
- **The reason is limited to 1,000 characters.** Not in the brief or the spec; added so the form has a bound.

**Protected paths for these steps (12), and why.** Each is mounted read-only over itself in the engine container, which stops a write to the file in place (and its removal), not its replacement: a folder above it can be renamed and a new file written at the same path (shown live after the review, "a protected file replaced through a renamed folder"; first written here as if the mount stopped every change). The applier refuses to write a protected path (shown), and the check after the step fails a step that changed one by any route (shown, the renamed folder included); that check is the control that decides (known gap 56):

| Path | Why |
| --- | --- |
| `src/auth.ts`, `src/lib/roles.tsx`, `src/lib/access.ts`, `src/app-config.ts` | Sign-in, the role guard, and the list of roles the guard reads |
| `src/db/schema.ts` | The sign-in tables and the who-and-when stamps. The app's own tables go in `src/db/app-schema.ts`, so this file can be protected whole |
| `scripts/check-guards.ts` | The build check that refuses a page, action or route without its guard |
| `package.json`, `package-lock.json`, `Dockerfile`, `.dockerignore` | What is installed and how the image is built |
| `next.config.ts`, `tsconfig.json` | Which files Next.js serves, and what `@/` means |

## Run 1: the first run (`run-live-1-first.txt`)

`npx tsx scripts/demo-scripted.ts ../templates/next <scratch folder>`, from `builder/`, on the files before the first commit of this branch. Exit code 0, 56 seconds. Everything below passed in it as in run 3, and the guard check and `next build` ran: their output is in the file. *Corrected after the review:* this section first said the image "was built from scratch", which was not shown. The build was not told to skip Docker's cache, run 1 did not record which steps came from it, and its images were ready 34 seconds after the start against 68 for run 3, which skipped the cache; a reviewer read Docker's cache records and found that the dependency install and the steps before it were most likely taken from the cache. Its screenshots were looked at and not kept. Two things in the printout were then changed: drizzle-kit's terminal colour codes are taken out, and a column of the table listing is named. In the kept file the colour codes were removed after the run, as its first line now says.

## Run 2: the build came from the cache (output not kept)

The same command, writing into this folder, at commit `e339efc`. Exit code 0, 32 seconds. The image build took 10 seconds and printed no guard check: Docker had taken every step from run 1's cache, because the workspace's files were identical. So this run did not show the build, and its output was discarded and replaced by run 3. This is why the build can now skip the cache.

A further run with the build skipping the cache passed the same way and printed the guard check, but reported one step of the app build as taken from the cache without naming it. The demonstration was changed to name such steps and run again (run 3); that run's output was not kept either.

## Run 3: the evidence run (`run-live.txt`, `screens/`)

`npx tsx scripts/demo-scripted.ts ../templates/next ../evidence/2026-11-12-package-2.1/screens`, from `builder/`, with the files of commit `04cb23e`. Exit code 0. Whole run 90 seconds. Its screenshots 04 to 08 were replaced by run 4's (below); 01 to 03 came out the same, byte for byte. Its screenshot 04 showed the stale message the review found (the value 5, and under it "cannot be more than 5"); it is in the history at `04cb23e`. The checkout's path is shown as `<checkout>`. Section by section:

1. **The history.** The template copy was committed in `<sandbox>/workspace.git`; the workspace has no `.git`.
2. **The two steps,** each in a fresh engine container:
   - `01-data`: 4 `scripted.write` events, ok, 4 turns, all usage figures 0. Files git saw changed: exactly the 4 in the manifest. Commit "[scripted] example-1 01-data" by "Scripted engine".
   - `02-submitter-screen`: 8 events, ok, 8 turns, zero usage, exactly the 8 files. Commit "[scripted] example-1 02-submitter-screen".
3. **A probe in the engine service, with the same mounts as a step:**
   - user id 1000;
   - writes to `src/auth.ts`, `src/lib/roles.tsx`, `certs/planted.crt` and `/engine` all refused by the system (`EROFS`, a read-only file system);
   - the certs folder, as the engine sees it, is empty;
   - its mounts: root read-only, `/engine` read-only, `/tmp` and `/workspace` read-write, `/workspace/certs` and the 12 protected paths read-only;
   - network interfaces: `lo` only. A name lookup of `registry.npmjs.org` failed (`EAI_AGAIN`), and so did a connection to the project database's port on the host (`ECONNREFUSED`); the same connection was tried again in section 5, once the database was listening on the host, and failed the same way;
   - settings inside, names only: `HOME`, `HOSTNAME`, `NODE_VERSION`, `PATH`, `YARN_VERSION` (what Docker and the image set; none from the builder).
4. **The image build**, with nothing from Docker's cache in the app image but one step (`WORKDIR /app`, which makes an empty folder). The template's guard check read 44 code files and listed every page, action and route with its guard, the two new pages, the changed home page and the new action among them: "RESULT: PASSED". `next build` listed `/[locale]/my-requests` and `/[locale]/my-requests/new`. The text the check shows for what each scripted file's guard is given is wrong (for example `guardedPage(ploye)` for home's `guardedPage(ROLES)`): a defect in how the check prints, which does not change what it decides (known gap 52).
5. **Tables, users, the app.** `drizzle-kit push` in the tools container created the table ("Changes applied"), with the list of two schema files. The seed created the three sample users. Read back from the database: the 12 columns, the status default `'waiting'`, the three checks and the three links to the user table. The app container started and was healthy.
6. **The screens** (`scripts/screenshot-scripted.ts`), 14 checks, all PASS:
   - the banner names the scripted engine, in English and in Arabic;
   - My requests before any request: no request listed, and the empty state;
   - 9 working days from Monday 3 to Friday 7 May 2027 (a made-up week) refused with "Working days requested cannot be more than 5, the number of calendar days from the first day of leave to the last.", and the page stayed on the form;
   - the five-day request sent: one request listed, stored status `waiting`, shown as "Waiting", and the confirmation "Your request was saved. Its status is Waiting.";
   - in Arabic: the page right to left, the status shown as "قيد الانتظار";
   - at a phone's width (390), in Arabic and in English: no sideways scrolling.
   Then, from the database: the request belongs to `employee@example.test`, 2027-05-03 to 2027-05-07, 5 days, `waiting`, created and last changed by the employee.
7. **The history:** the template copy by "Builder", then the two `[scripted]` commits by "Scripted engine", each with exactly its files.

Then every container, the network, the volume, both images and the temporary folder were removed; the run's last line lists the project's containers and images left: none.

The screenshots in `screens/`, as run 4 (after the review) left them:

| Screenshot | What it shows |
| --- | --- |
| `01-scripted-home-employee-en.png` | Home, signed in as the sample employee, with links to My requests and a new request |
| `02-scripted-my-requests-empty-en.png` | My requests with no request: the empty state and its button |
| `03-scripted-form-error-en.png` | The form refusing 9 working days for a Monday-to-Friday range, the message under the field |
| `04-scripted-form-five-days-en.png` | The five-day request filled in, before it is sent. No message: the one the 9 days brought up went when the value was corrected (screen checks "the message goes once the value is corrected" and "aria-invalid") |
| `05-scripted-my-requests-waiting-en.png` | My requests: the confirmation and the request, "Waiting", the reason, and "Sent on November 12, 2026 at 17:12 UTC" |
| `06-scripted-my-requests-waiting-ar.png` | The same list in Arabic; the reason reads "Made-up family visit." with its full stop at its end (before the review it showed as ".Made-up family visit") |
| `07-scripted-my-requests-waiting-ar-phone.png`, `08-scripted-my-requests-waiting-en-phone.png` | The same list at a phone's width, in Arabic and in English |

The sample users' names are in English on the Arabic pages ("Sample Employee"); they are data, as known gap 36 records.

## Run 4: after the review (`run-live-4-after-review.txt`, `screens/`)

The same command as run 3, with the files of commit `69b0e28` (the code is the same at the last commit of this round; the commits after it change only this folder). 12 Nov 2026, 17:10 to 17:12 UTC. Exit code 0. Whole run 89 seconds. The image was built without Docker's cache except the one step `WORKDIR /app`, as in run 3; the guard check read 44 code files ("RESULT: PASSED", still with the wrong printed text of known gap 52), and `next build` listed the two new routes. What is new against run 3:

- Sections 1 and 2: a walk of the workspace found nothing git cannot see, before the steps and after each.
- Section 2: the fingerprints of four of step 02's files are new (the form, the list page and both message files), as the change set was changed.
- Section 6, the screens: 20 checks, all PASS (14 before). The six new ones: after the 9-day refusal, the last day changed to Wednesday 5 May with 9 days still entered, and the message became "cannot be more than 3" with no Submit; the last day put back and the days set to 5, and the message went, with the days field no longer marked wrong; the reason inside a `<bdi>` element, in English and in Arabic; and "Sent on November 12, 2026 at 17:12 UTC", which names its zone.
- Then, as in run 3: the request stored for the sample employee, 2027-05-03 to 2027-05-07, 5 days, `waiting`; the history; and every container, image and temporary folder of the run removed ("Containers of the project left: none. Images of the project left: none.").

## Checks after the review (`builder/`, files of commit `69b0e28`; outputs kept)

- `npm run typecheck`: passed, exit code 0 (`run-typecheck.txt`).
- The three scripts, which the type check's folders do not include, type-checked with the same settings: exit code 0 (`run-typecheck-scripts.txt`).
- `npx vitest run`, all files, each test listed: 134 of 134 passed in 7 files, exit code 0 (`run-tests-all.txt`). 40 of them are this package's (`test/scripted-engine.test.ts`); 14 were added after the review:
  - with the stand-in runner: `stop()` resolves only once the step has ended; a stop asked for during preparation starts no container; a time limit or a failing event handler reported by the runner fails the step saying so; an event handler that throws before any container fails the step; each of a `.git` at the top, a `.git` in a folder git tracks, a `.GIT`, a named pipe and a nested repository fails the step, is reported, nothing is committed and the reset leaves nothing; a step does not start on a workspace holding such an entry, and the walk follows no link; the reset removes a nested repository and a named pipe and returns what it cannot put back;
  - live, in a container: a stop during preparation (no container started); a time-out (the container killed and removed, "the step ran longer than its time limit (2 seconds)"); an event handler that throws (the builder goes on, the container is killed and removed); a protected file replaced through a renamed folder (the write in place refused with `EROFS`, the file on this machine replaced, the step failed "protected files changed: src/lib/access.ts, src/lib/roles.tsx", nothing committed, the file put back); `.git` folders and a named pipe planted beside a step's own file (git's own status lists only the file; the step failed naming all three; the reset removed them); the applier's refusals (a wrong fingerprint, an add over an existing file, two paths outside the workspace, a path through a link, the applier outside `/engine`, and in a container with no workspace); the turn limit inside the applier; `runStreaming` with a line handler that throws (the run ends carrying the error within seconds, no container left).
  - Two made-up "misbehaving engines" are short commands run in the engine service in place of the applier, through the class's `runner` option, with the step's mounts: nothing they do runs on this machine.
- `npm run check:licences`: RESULT: PASSED, exit code 0 (`run-licences.txt`). No package was added or removed.
- The applier and everything the engine wrote ran only in containers. The only things made on this machine by the tests are what the stand-in tests plant themselves (a named pipe with `mkfifo`, a `.git` folder, a nested repository with `git init`), in temporary folders.
- The process that stops a step now exits when its work is done: 1.7 seconds against 16.6 before the fix (`measure-kill-timer.txt`, with its script `measure-kill-timer.mts`).
- Docker objects after all of this: no container, no image and no temporary folder of these tests or of the demonstration left. `test/sandbox.test.ts`, which this package does not change, still leaves about ten `/tmp/builder-*` folders per full run (prefixes `builder-sb`, `builder-home`, `builder-tools`, `builder-user-docker`, `builder-live`); this round's two full runs left 20 of them, which were not removed.

## Checks of the first round (`builder/`, at `04cb23e`)

- `npm run typecheck`: passed (exit 0).
- `npx vitest run`: 117 of 117 tests passed in 7 files, 26 of them new, in `test/scripted-engine.test.ts` (`run-tests-scripted-engine.txt`):
  - the change sets: two steps in order; every copy matches its fingerprint; every add is a file not yet there and every replace names the fingerprint of the file the step finds (the template's or the previous step's); no path protected, outside the workspace, under `certs/` or hidden; every protected path is a file in the template; the header line on all 8 code files; the banner in both languages after each step, and the same message keys in both; the statuses exactly the spec's, with `waiting` the default and the stamps used; nothing in the change sets but the applier, the manifests and their files; the applier imports only Node's own modules;
  - the engine service in the compose file, on both profiles, compared field by field; no engine service unless asked for; Docker Compose accepts the file; `up` refuses the service; a missing mount source is refused;
  - the class against a stand-in runner that replays the applier's lines and makes its changes (no container, no model): a step that runs (events, zero usage, turns, the commit's author, committer and message, the next step from it); the turn limit; an unknown step started no container; a refused write turned into "blocked"; a file not named, a planted certificate and a planted file under `node_modules/` each fail the step, nothing is committed, and the workspace is put back; `stop()`; a workspace with changes not committed, and a missing protected path, refused;
  - live, in the engine container: a stop part-way (the container killed and gone, the workspace put back); both steps applied and committed, with zero usage; a write to `src/auth.ts` refused by the applier ("blocked") and, past the applier, by the read-only mount (`EROFS`, and the file unchanged); the container's own view (uid 1000, five settings, `lo` only, an empty certs folder, the change sets read-only, `/.dockerenv` present); an engine run cut off is removed with the project.
- `npm run check:licences`: passed (exit 0). No package was added or removed.
- The applier was never run on this machine: only in the engine container, by the live tests and the demonstration.
- The new scripts are outside the type check's folders; they were type-checked separately with the same settings (exit 0).
- All three were run again at `10d9af1`, which only makes the class's tests remove their temporary folders: the same results (117 of 117; type check and licence check passed).

## What this does not show

- **Packages 3.1, 3.2, 2.2 and W2 are not built.** The acceptance store and runner, the exporter, the real engine and the test harness are what this package is for; none of them exists yet. That later packages can use it "with no spend" is designed, not shown: nothing uses it yet.
- **The network, for the real engine.** The engine container has no network. Attempts made from it, in 3.1, to reach the acceptance store over the network or through the database will fail for that reason alone, and say nothing about package 2.2's engine, which needs a route to the gateway (known gap 50).
- **The server profile.** Only the development profile was run. The engine service is the same in both (unit test), but it was not started on a server.
- **The rest of example 1.** No employee record, no balance, no telling the manager, no manager or HR screens, and no mail catcher in the template (known gap 54). Acceptance item 1 is what this app can pass; items 2 to 6 cannot.
- **Migrations.** The table is made by `drizzle-kit push`; there are no migration files (known gap 53).
- **That git in the builder cannot be made to run something by the engine's files.** It is designed so that git reads and runs none of them; an engineer's view is asked for (known gap 51). Entries git cannot see (`.git` entries, pipes, sockets, devices) are now found by a walk and fail the step (shown); the other files gap 51 lists are not shown either way.
- **Protected paths: a read-only mount over a file stops writes in place only.** It does not stop the file being replaced through a renamed folder (shown), nor new files beside it. What catches both in 2.1 is the check after the step, which fails any file not in the fixed change and any protected path changed (shown with the stand-in, and live for the renamed folder). The scripted engine itself writes only its fixed files. For the real engine the per-file mounts are not enough on their own (known gap 56).
- **Some of the applier's refusals and the server's re-check.** Not run: the applier's `/.dockerenv` test (it cannot fail in a container, and is not run on this machine), a missing copy, an unknown operation, and a copy whose fingerprint differs from its manifest's (designed). The form action's own run of the checks, its refusals, and its employee-only guard were not reached by the screen run (designed); the screen run shows a sound request accepted and saved for the signed-in employee.
- **Disk use.** The engine can write as much as the machine holds (known gap 58).
- **The engine's user.** The workspace was handed to uid 1000 because the builder runs as root here (known gap 57).
- **The browser ran on this machine.** Playwright's browser ran on the host and ran the app's page code there; the app's server ran in its container (known gap 55).
- **The Arabic texts** were written by Claude Code and have not been checked by anyone who reads Arabic. They are on `docs/arabic-wording-list.md` for the owner.
- **The answers to the review have not been re-read by an independent reviewer.** The review below was made at `af685fd`, before them.

## Review and answers

**The review.** On 12 Nov 2026 four fresh reviewers, who did not write the code, read this package at `af685fd`, each through one lens: containment, the engine interface and the sandbox manager, the generated app, and the records. Each finding was then checked by two more reviewers, who tried to show it wrong. Nothing was rated blocking. Nine findings were confirmed (both checkers agreed each was real; for two of them one checker rated it a note rather than should-fix), and there were ten notes. Every confirmed finding and every note is listed here with what was done. "Shown" names the test or run; line numbers are those of this round's last code commit.

**First, the branch was brought up to date.** `claude/stage-1` had moved from `2bfc8fb` to `5c8b01a` (pull requests #18 and #19). The branch was rebased onto it. Three files conflicted: in `builder/src/sandbox/manager.ts` both changes were kept (`up` stays an async function, so a refusal is a rejected promise, and refuses both `tools` and `engine`, line 623-626; `destroy` and every command but `up` name both one-off profiles, line 456; `runStreaming` uses `dockerEnv` as #19 left it); in `docs/KNOWN-GAPS.md` and `docs/DECISIONS.md` both sides' rows were kept. The engine's `up` test now uses the stricter form #19 introduced (`builder/test/scripted-engine.test.ts`:234).

**Commit names before the rebase.** The commits this file names above were made before the rebase, which gave them new names; the old names are not on the branch that will be pushed. With the same changes (plus, where they conflicted, those of #18 and #19): `51405bf` is now `bea3512`, `91489f9` is `63c8556`, `cc09819` is `b7736b9`, `2cec415` is `418acdd`, `e339efc` is `a0a7950`, `04cb23e` is `e172328`, `0352901` is `8af039b`, `10d9af1` is `f2389f4`, and `af685fd` is `6d0b2b8`. Runs 1 to 3 ran before the rebase, on the old commits.

### Containment

| # | Finding (verdicts) | What was done | Shown by |
| --- | --- | --- | --- |
| C1 | The check after a step cannot see a planted `.git` (at the top, or in a folder that holds tracked files) or a named pipe; such a step succeeded, was committed, and they stayed. A planted `.git` with a file-system monitor setting made a later plain `git status` by the workspace's owner run a program (should-fix, should-fix) | A walk of the workspace with lstat, never following a link and reading no file, lists every entry named `.git` in any letter case at any depth and everything that is not a file, folder or link: `entriesGitCannotSee`, `builder/src/engine/project-repo.ts`:114. `workspaceChanges` returns it (`notAllowed`, :205-212), so the check before a step (`builder/src/engine/scripted.ts`:223), the check after it (:284) and the reset use it; `commitAll` refuses to commit while it lists anything (:216), and a workspace holding such an entry is not made a project (:182). Records corrected: known gap 51 names this case; the decisions row that said `git status` "must show exactly the manifest's files"; this file | Stand-in tests at `builder/test/scripted-engine.test.ts`:456 and :484; live test at :753 (git's own status lists only the step's file; the step fails naming `.git`, `src/.git` and `src/pipe`; nothing committed; the reset removes them); demonstration run 4, sections 1 and 2 |
| C2 | `resetToLastCommit` left a nested repository behind and still reported nothing unrestorable (should-fix, should-fix) | `git clean -ffd`, still without `-x` so the ignored session certificate stays (`builder/src/engine/project-repo.ts`:238); the walk's entries are removed; then the workspace is compared with the last commit again and everything still different is returned as `unrestorable` (:234-246) | `builder/test/scripted-engine.test.ts`:503 (a nested repository, a named pipe and a `.git`: nothing left; a changed ignored file is returned as unrestorable); the reset assertions in :456 and the live tests |
| C3 | The read-only mount over a protected file does not stop it being replaced: renaming its folder works (note, should-fix) | Records corrected: known gap 56 now says the mount stops writes in place only and the check after the step catches a replaced file, and records for 2.2 that per-file mounts are not enough on their own; the live test's name (`builder/test/scripted-engine.test.ts`:710); this file's "Protected paths" paragraph; a dated amendment to the design note's 2.4 | Live test at `builder/test/scripted-engine.test.ts`:723: in the engine container, with the step's mounts, a write in place is refused (`EROFS`), `src/lib` is renamed and a new `roles.tsx` written; the step fails "protected files changed: src/lib/access.ts, src/lib/roles.tsx", nothing is committed, and the reset puts the file back |
| Note | Fingerprinting an ignored file read it whole, so a file over 2 GiB made the check throw; the workspace has no disk limit | Ignored files are fingerprinted a piece at a time, without following a link (`builder/src/engine/project-repo.ts`:83). New known gap 58: no limit on how much the engine can write, for package 2.2 | Designed: not tested with a file over 2 GiB |

### The engine interface and the sandbox manager

| # | Finding (verdicts) | What was done | Shown by |
| --- | --- | --- | --- |
| I1 | `stop()` returned before the step had stopped, and a container was still started after the stop; checkers measured the applier writing up to four files after `stop()` had returned (should-fix, should-fix) | The class keeps the running step's promise; `stop()` kills the container if there is one and resolves only when the step has ended (`builder/src/engine/scripted.ts`:151-180). The stop is checked after the preparing checks, with nothing awaited between that check and the runner, so no container is started after a stop (:265). Not changed: when a stop arrives after the container was asked for but before it exists, the kill is retried every 250 ms, so the applier can still write in that moment; the step then ends "stopped" with the files listed, and `stop()` resolves only after the container is gone | Stand-in tests at `builder/test/scripted-engine.test.ts`:406 (the last event is out before `stop()` resolves) and :420 (a stop during preparation: no runner call, and the next step runs); live tests at :631 (no container left when `stop()` resolves) and :651 (a stop during preparation in the engine's sandbox: the runner never called, no container, the workspace unchanged) |
| I2 | An exception in the event callback crashed the builder and left the engine container running (note, should-fix) | `runStreaming` catches an error thrown by the line handler: the first error is kept, the run is killed, later lines are not handed on, and the run ends carrying it (`handlerError`; `builder/src/sandbox/manager.ts`:538-545). The class turns it into a failed result (`builder/src/engine/scripted.ts`:272), and guards the events it sends outside the container's lines (:186), so a throwing handler never leaves a step half handled | Live test at `builder/test/scripted-engine.test.ts`:838 (`runStreaming` with a handler that throws: the run ends carrying the error within seconds, no container left); live test at :679 (the class: the step fails "handling the step's events failed …", no container left, nothing committed); stand-in tests at :435 and :447 |
| Note | `kill()` left a 15-second timer pending, so a process that stopped a step lingered about 15 s | The wait is cleared when the run ends (`waitAtMost`, `builder/src/sandbox/manager.ts`:508). `kill()` can be called more than once; the calls share one kill (:570) | `measure-kill-timer.txt`: the process exits 1.7 s after the start, against 16.6 s with the code before the fix |
| Note | A runner time-out was not reported as a time-out | The run's end says so (`timedOut`, `builder/src/sandbox/manager.ts`:588), and the step fails "the step ran longer than its time limit (N seconds), so the engine container was stopped" (`builder/src/engine/scripted.ts`:273). The limit can be set per engine (`stepTimeoutMs`, default ten minutes) | Live test at `builder/test/scripted-engine.test.ts`:668 (a 2-second limit); stand-in test at :435 |

### The generated app

| # | Finding (verdicts) | What was done | Shown by |
| --- | --- | --- | --- |
| A1 | The form kept showing an error after the value was corrected, and evidence screen 04 showed it (should-fix, should-fix) | When a value changes, the form checks the current values again and keeps or updates only the messages already shown: a corrected value clears its message, and a message that depends on two fields follows the other one; no new message appears before Submit (`builder/scripted/example-1/02-submitter-screen/files/src/app/[locale]/my-requests/new/NewRequestForm.tsx`:24-38). Fingerprints updated with `scripts/scripted-manifest.ts`. Screen 04 retaken and described as it is | Run 4's screen checks (`builder/scripts/screenshot-scripted.ts`:80-87): the message became "cannot be more than 3" when the last day changed, went when the days were corrected to 5, and the field was no longer marked wrong; screen 04 |
| Note | "Sent on" was a moment shown in UTC without saying so | Shown with its time and its zone named, "Sent on November 12, 2026 at 17:12 UTC"; the two leave dates stay plain calendar dates (`builder/scripted/example-1/02-submitter-screen/files/src/app/[locale]/my-requests/page.tsx`:31 and :73-75). A time-zone setting for the app is not added | Run 4's screen check (`builder/scripts/screenshot-scripted.ts`:101); screen 05 |
| Note | The reason's direction was not isolated, so its full stop moved in Arabic | The reason is wrapped in `<bdi>` through the message (`"Reason: <bdi>{reason}</bdi>"`, `builder/scripted/example-1/02-submitter-screen/files/src/app/[locale]/my-requests/page.tsx`:70) | Run 4's screen checks in both languages (`builder/scripts/screenshot-scripted.ts`:99, :109); screen 06 shows "Made-up family visit." with its full stop at its end |
| Note | The Arabic for "calendar days" said only "days" | Now "عدد الأيام التقويمية" (`builder/scripted/example-1/02-submitter-screen/files/messages/ar.json`:92); the wording list regenerated, and its tool now shows tags as text | `docs/arabic-wording-list.md`; the owner has not read it |
| Not checked by the reviewer, still not checked | That a second employee cannot see the first's requests (the seed has one employee), and what the form does when the session ends mid-form | Nothing | Not done |

### The records

| # | Finding (verdicts) | What was done | Shown by |
| --- | --- | --- | --- |
| R1 | Gap number 49 collided with the 0.5 follow-up's, now merged; the build report's "nothing else uses 49 or above" was no longer true (should-fix, should-fix) | Rebased onto `5c8b01a`; this package's gaps renumbered 50 to 57 in the gaps, the decisions, the design note amendments, this file and the code comments (commit `3f42df2`); the build report's sentence corrected (it is kept outside the repository) | `git diff 3f42df2~1 3f42df2` |
| R2 | The applier's refusals and the server's re-check were written as fact, though most never ran (should-fix, should-fix) | Live tests added for every refusal that could be run in a container; the "What was built" list now marks each refusal shown (with its test) or designed; the server's re-check is marked designed, with what the screen run did show; "What this does not show" lists the rest | Live tests at `builder/test/scripted-engine.test.ts`:783 and :827 |
| R3 | Run 1 was said to have been built "from scratch", which was not shown (should-fix, should-fix) | Corrected to what was shown: the guard check and `next build` ran; which steps came from Docker's cache was not recorded, and most likely the dependency install did. `run-live-1-first.txt` now starts with a line saying its colour codes were removed after the run | Run 1's section |
| Note | "The three new pages" was a miscount | "The two new pages, the changed home page and the new action" | Run 3's section 4 |
| Note | Gap 51 (now 52) counted three files and the shift was one character short | Four files, and the shift is the first line plus its line break: re-measured on the four files at `e172328`, which is `04cb23e` after the rebase (each text shown starts 104 characters before the real one; the first line is 103 characters long) | Known gap 52 |
| Note | The Arabic "calendar days" | As in the app table | |
| Note | No output was kept for the full test run, the type check or the licence check | Kept this time: `run-typecheck.txt`, `run-typecheck-scripts.txt`, `run-tests-all.txt`, `run-licences.txt` | This folder |

**Commits of this round:** `3f42df2` (gaps renumbered), `f461b84` (sandbox manager), `82a8c22` (the walk, the reset, `stop()`, events, time limit, tests), `7e8ef9a` (change set 02 and the screen checks), `d3e5717` (the applier without a workspace, live), `69b0e28` (gaps, decisions, design amendment, sources), and the evidence commits after it.
