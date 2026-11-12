# Package 2.1: the scripted engine

| | |
| --- | --- |
| Date | 12 November 2026 |
| Package | 2.1 of `docs/BUILD-PLAN.md`: "A scripted engine behind the build-engine interface: it makes fixed, known changes and calls no model." It depends on licence code L9, true since 12 November. Branch `claude/pkg-2.1-scripted-engine`, started from `claude/stage-1` at `2bfc8fb` |
| Done means (plan) | "Later packages can exercise their own behaviour with no spend. Anything produced by it is labelled 'scripted' wherever it appears" |
| Run on | The development machine (a cloud session), development profile: the app, database and tools containers share the host's network (known gap 1); the engine container has no network at all. Made-up data only. **No model was called** |
| Result | **Shown on the development profile** (run 3 below, `run-live.txt`, at commit `04cb23e`). In the engine container, the scripted engine applied example 1's two fixed steps to a fresh copy of the template: 4 and 8 files, each step's files exactly the ones its change names, each step committed as `[scripted] example-1 <step>` by "Scripted engine", with zero usage. The built app passed the template's guard check and `next build`, its table was created in the tools container, and as the sample employee a five-day request was sent and listed as "Waiting" (`waiting` in the database), in English, in Arabic and at a phone's width, under a banner that says the scripted engine built it. 26 new tests pass in `npm test`, among them 5 that start the engine container. **State: built, not tested**, until an independent reviewer has read the commit that is merged |

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
  - `02-submitter-screen`, 8 files: My requests (`/my-requests`, an employee's own requests, newest first, with an empty state); the new-request form (`/my-requests/new`) with its checks; the form action `submitLeaveRequest`, which checks again on the server and saves the request as `waiting` for the signed-in employee; home with links for an employee; both message files with 34 new texts in each language.
  - No template file was edited. The template's example pages stay.
- **The applier** (`builder/scripted/apply.mjs`): applies one step, inside the engine container only (it refuses to start elsewhere). It uses only Node's own modules. It checks every entry before writing any and refuses a path outside the workspace, a protected path, a path through a link, an existing file for an add, and a wrong fingerprint for a replace. It prints one line per operation.
- **The engine class** (`builder/src/engine/scripted.ts`, `ScriptedEngine`, name `scripted`): starts the container with the step's protected paths mounted read-only; turns the applier's lines into the interface's events (`text`, `tool_call` named `scripted.write`, `blocked`, `finished`, `failed`); usage is always zero; turns are files written; the turn limit is passed to the applier and "turn limit reached" ends the step; an unknown step fails before any container starts; `stop()` kills the container. The workspace and the sandbox come in through its constructor (the interface's step instruction carries no workspace); the step's free-text instruction is not read, and its length is recorded in the first event.
- **The project's history, outside the workspace** (`builder/src/engine/project-repo.ts`): git runs in the builder as `git --git-dir=<sandbox>/workspace.git --work-tree=<sandbox>/workspace`, with hooks, the file-system monitor and every git setting from outside the project switched off. No container mounts the history. After a step, `git status --porcelain -z --untracked-files=all --ignored` must show exactly the change's files, with exactly its contents, and no file git ignores may be new or changed; otherwise the step fails and nothing is committed. Then the step is committed. A failed step can be put back.
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

**Protected paths for these steps (12), and why.** Each is mounted read-only over itself in the engine container, the applier refuses to write it, and the check after the step would fail it:

| Path | Why |
| --- | --- |
| `src/auth.ts`, `src/lib/roles.tsx`, `src/lib/access.ts`, `src/app-config.ts` | Sign-in, the role guard, and the list of roles the guard reads |
| `src/db/schema.ts` | The sign-in tables and the who-and-when stamps. The app's own tables go in `src/db/app-schema.ts`, so this file can be protected whole |
| `scripts/check-guards.ts` | The build check that refuses a page, action or route without its guard |
| `package.json`, `package-lock.json`, `Dockerfile`, `.dockerignore` | What is installed and how the image is built |
| `next.config.ts`, `tsconfig.json` | Which files Next.js serves, and what `@/` means |

## Run 1: the first run (`run-live-1-first.txt`)

`npx tsx scripts/demo-scripted.ts ../templates/next <scratch folder>`, from `builder/`, on the files before the first commit of this branch. Exit code 0, 56 seconds. Everything below passed in it as in run 3; the image was built from scratch, and the guard check and `next build` ran. Its screenshots were looked at and not kept. Two things in the printout were then changed: drizzle-kit's terminal colour codes are taken out, and a column of the table listing is named (in the kept file the colour codes have been removed after the fact).

## Run 2: the build came from the cache (output not kept)

The same command, writing into this folder, at commit `e339efc`. Exit code 0, 32 seconds. The image build took 10 seconds and printed no guard check: Docker had taken every step from run 1's cache, because the workspace's files were identical. So this run did not show the build, and its output was discarded and replaced by run 3. This is why the build can now skip the cache.

A further run with the build skipping the cache passed the same way and printed the guard check, but reported one step of the app build as taken from the cache without naming it. The demonstration was changed to name such steps and run again (run 3); that run's output was not kept either.

## Run 3: the evidence run (`run-live.txt`, `screens/`)

`npx tsx scripts/demo-scripted.ts ../templates/next ../evidence/2026-11-12-package-2.1/screens`, from `builder/`, with the files of commit `04cb23e`. Exit code 0. Whole run 90 seconds. The checkout's path is shown as `<checkout>`. Section by section:

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
4. **The image build**, with nothing from Docker's cache in the app image but one step (`WORKDIR /app`, which makes an empty folder). The template's guard check read 44 code files and listed every page, action and route with its guard, the three new pages and the new action among them: "RESULT: PASSED". `next build` listed `/[locale]/my-requests` and `/[locale]/my-requests/new`. The text the check shows for what each scripted file's guard is given is wrong (for example `guardedPage(ploye)` for home's `guardedPage(ROLES)`): a defect in how the check prints, which does not change what it decides (known gap 51).
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

| Screenshot | What it shows |
| --- | --- |
| `01-scripted-home-employee-en.png` | Home, signed in as the sample employee, with links to My requests and a new request |
| `02-scripted-my-requests-empty-en.png` | My requests with no request: the empty state and its button |
| `03-scripted-form-error-en.png` | The form refusing 9 working days for a Monday-to-Friday range, the message under the field |
| `04-scripted-form-five-days-en.png` | The five-day request filled in, before it is sent |
| `05-scripted-my-requests-waiting-en.png` | My requests: the confirmation and the request, "Waiting" |
| `06-scripted-my-requests-waiting-ar.png` | The same list in Arabic |
| `07-scripted-my-requests-waiting-ar-phone.png`, `08-scripted-my-requests-waiting-en-phone.png` | The same list at a phone's width, in Arabic and in English |

The sample users' names are in English on the Arabic pages ("Sample Employee"); they are data, as known gap 36 records.

## Checks (`builder/`, at `04cb23e`)

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
- **The network, for the real engine.** The engine container has no network. Attempts made from it, in 3.1, to reach the acceptance store over the network or through the database will fail for that reason alone, and say nothing about package 2.2's engine, which needs a route to the gateway (known gap 49).
- **The server profile.** Only the development profile was run. The engine service is the same in both (unit test), but it was not started on a server.
- **The rest of example 1.** No employee record, no balance, no telling the manager, no manager or HR screens, and no mail catcher in the template (known gap 53). Acceptance item 1 is what this app can pass; items 2 to 6 cannot.
- **Migrations.** The table is made by `drizzle-kit push`; there are no migration files (known gap 52).
- **That git in the builder cannot be made to run something by the engine's files.** It is designed so that git reads and runs none of them; an engineer's view is asked for (known gap 50).
- **Protected paths stop changes to the files themselves, not new files beside them.** The scripted engine cannot add any file outside its fixed change; the real engine will need a rule (known gap 55).
- **The engine's user.** The workspace was handed to uid 1000 because the builder runs as root here (known gap 56).
- **The browser ran on this machine.** Playwright's browser ran on the host and ran the app's page code there; the app's server ran in its container (known gap 54).
- **The Arabic texts** were written by Claude Code and have not been checked by anyone who reads Arabic. They are on `docs/arabic-wording-list.md` for the owner.
- **No independent review** has been made of this package yet.
