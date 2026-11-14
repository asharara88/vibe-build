# J2: the broken copy rejected, and a restart mid-step

*Status:* **Final design, not yet built.** 13 Nov 2026. Written by Claude Code from its draft of the same day and two independent critiques of that draft; section 13 says what changed and why. Read at `14787d8` on branch `claude/j2-broken-and-restart` (from `claude/stage-1`, J1 and J3 merged). Not approved by the owner: one question is his (section 12). It covers parts (a) and (c) of J2 as J1's design plans them (R docs/design/journey-j1.md:35). Part (b), package 3.2, comes after and is not designed here. Nothing was edited except this file. Nothing was run except reads (`sed`, `grep`, `wc`, and reads of J1's evidence events and of tsx's own files).

**Keys.** BP, DEC, ST, KG, DN = docs/BUILD-PLAN, DECISIONS, STATUS, KNOWN-GAPS, design/stage-1; HO = HANDOVER.md; J1D, J3D = docs/design/journey-j1.md, journey-j3.md; E31 = evidence/2026-11-13-package-3.1/acceptance.md; EJ1, EJ3 = evidence/2026-11-13-journey-j1/journey.md, evidence/2026-11-13-journey-j3/live-preview.md; J1EV = evidence/2026-11-13-journey-j1/events.json; SPEC1 = stand-in-acceptance/example-1/item-01.spec.ts; BROKEN = builder/scripted-broken/example-1/03-wrong-status; TSX = builder/node_modules/tsx/dist/cli.mjs (tsx 4.23.15). A code path with no leading folder is under builder/; `templates/` and `stand-in-acceptance/` are at the repository root. R = read at the line cited; I = inference or proposal; M = to be measured by the automated run.
**Citation drift.** J1D:35 cites BP:190 and BP:191. On this branch those rows are BP:192 (3.1, "Done means" item 2) and BP:193 (3.2) (R). This note cites the current lines.

## 1. What the owner can then do

**(a) Watch the checklist reject a broken app, on his own screens.**
- The Projects screen gets a panel of its own, apart from "New project", labelled **"Simulated build"**, with one button: **"Start the broken-copy demonstration"**. The New project form keeps its three fields; it only refuses the demonstration's fixed name. Whether this button is always there, or only when a setting is on, is his choice (section 12).
- The button makes a project that the builder names itself: "Deliberately broken copy (made-up)". Every screen of that project, and its row in the list, carries the badge **"Deliberately broken copy: a defect Claude Code planted on purpose"**, in English and Arabic.
- He goes through the same screens as in J1: the questions (or "Answer the rest from example 1's answer sheet"), the brief, the plan, the build, the preview, the checklist and the cost.
- The plan has a **third step**: "a new leave request is saved as Approved instead of Waiting". Claude Code wrote this broken change in advance for package 3.1 (R BROKEN/manifest.json:4).
- Step 3 builds without any complaint, and he can approve it. The scripted engine checks only that a step wrote exactly its fixed files, with their fingerprints (R src/engine/scripted.ts:334-363). Nothing checks the app's quality after a step yet, and there is no retry, and the screen says so: "No quality check after a step yet, and no retry (milestones 1 and 3): only the checklist at the end checks the app." (A *milestone* is one of the stages of the product plan, DN:586-592.)
- The preview pictures show the app's own banner: "This is a deliberately broken copy, made to be rejected by the acceptance check." (R BROKEN/files/messages/en.json:4). The run checks that sentence in English and Arabic.
- He presses "Run the checklist". The result reads **Failed**. Item 1 reads **Failed**, with the checker's own picture and the step that failed: "sees status waiting".
- There is never a sign-off button and never an export for this project. "Close project" removes it.
- **What this shows:** the checklist runner, run for real against the real app, rejected one defect that was planted on purpose.
- **What it does not show:** that the checklist catches defects in general. Claude Code wrote both the defect and the test, each knowing the other (R SPEC1:1-5, :48-58). It is a "stand-in test, not independent acceptance" (R DEC:130).

**(c) See what happens when the builder's interface stops in the middle of a step.**
- This is shown by an automated run, with pictures. It is not done on his own instance. It is shown two ways:
  - **A deliberate stop:** a stop request (SIGTERM) sent to the interface, as a service manager sends one. From J2 on, the interface tidies up before it exits. The step stops, the project is marked interrupted, and its *containers* are removed at once. (A container is a sealed box on the machine in which a build step or the app runs.)
  - **A crash:** the interface is killed outright. Its containers stay on the machine until the interface is started again, and that start removes them.
- After either, the project's screens say it was interrupted. They offer only "Close project" or "New project". Nothing is resumed. The cost screen shows the step's reservation released, marked as stopped part-way, and $0.00 spent.
- **Not shown:** pressing Ctrl-C in the terminal. That also signals the docker programs the interface started, and the step may then be recorded as failed rather than interrupted (I; gap 165).
- **On his own instance, from J2 on:** stopping the interface on purpose removes the containers of his open projects at the stop, instead of at the next start (KG:154, gap 139). Either way the projects end the same: interrupted, not resumed.

**Labelled, and why** (I):

| Part | Marked | Why |
| --- | --- | --- |
| The demonstration panel and its button | "Simulated build", and the line "The checklist run on it is real." | The broken change is fixed, written in advance by Claude Code; the builder calls no model (R BROKEN/manifest.json:4) |
| The badge on every page of that project and its list row | "Deliberately broken copy: a defect Claude Code planted on purpose", added by the system | The owner does not type this name, so the label cannot be lost or left out. It does not say "simulated": on that project the checklist run and its rejection are real (R src/web/messages/en.json:187, :240-241) |
| Plan and step panels | Simulated changes; Real containers, history and reservation | As in J1 (R en.json:187) |
| Preview pictures | Real app, built from fixed changes | The banner in the pictures is the app's own (R templates/next/src/app/[locale]/layout.tsx:26-28) |
| Checklist results | Real runner; Simulated test, labelled "stand-in test, not independent acceptance" | R en.json:240-241; DEC:130 |
| Interrupted panel, record, cost | Real | Written by the orchestrator from what happened |
| The pause before each write, in (c) | "Demonstration setting", shown on the build screen while it is on | A scripted step lasts about half a second (R J1EV: step 01 from 16:02:29.928 to 16:02:30.507), too short to stop part-way |
| The crash | A real kill (SIGKILL) of the interface's own process, standing in for a crash | A crash cannot be ordered on demand (I) |

## 2. Done means

**N. How "nothing left" is matched.** For a project with id P, the run lists Docker's containers, volumes, networks and images, and the machine's processes, and counts as P's:
- a container whose name starts `builder_<P>-`, or whose label `com.docker.compose.project` is `builder_<P>`;
- a volume or a network whose name starts `builder_<P>_`, or that has that label;
- an image `builder_<P>-app:latest` or `builder_<P>-tools:latest`, or any other image whose repository starts `builder_<P>-`. The two images are made by a plain `docker build --tag`, which adds no Compose label, so they are matched by name (R src/sandbox/manager.ts:201-211, :978);
- a process whose command line holds `builder_<P>`;
- the sandbox folder that P's `journey.sandbox.made` records.

This is J1's prefix approach (R scripts/demo-journey.ts:71-81), narrowed to the exact id. The matching functions are tested with made-up lists in which each kind, alone, must be reported (C8). Every "nothing left" below means: nothing matched by N.

### J2 (a): the broken copy rejected

One automated browser run (section 7), from a fresh database and data folder, under the shared lock. Each numbered item is a check that the run counts:
1. **Projects screen:** the demonstration panel, labelled "Simulated build", with its one button, apart from "New project". The New project form has the same three fields as today (name, cap, brief) (R src/web/pages.ts:264-287; src/web/app.ts:247).
2. **Pressing the button** makes one project named "Deliberately broken copy (made-up)" with a $5.00 cap. Its record's first event is `intake.brief_entered`, and that event carries `broken_copy`, with `by: "owner"`, the step `03-wrong-status`, the manifest's label and SHA-256, `sign_off: "never"` and `export: "never"`. The badge "Deliberately broken copy: a defect Claude Code planted on purpose" is on every page of the project and in its list row, in English and Arabic.
3. **After the questions and both confirmations:**
   - The plan lists three steps. Step 3 shows its manifest label (R BROKEN/manifest.json:4) and the plain sentence.
   - `journey.plan_confirmed` lists all three steps, with `broken_copy: true`.
   - The line "No quality check after a step yet, and no retry (milestones 1 and 3): only the checklist at the end checks the app." is on the plan and build screens.
4. **Build:**
   - Steps 1, 2 and 3 are built and approved.
   - Each step shows its reservation as made and released: $1.5552, $3.1104 and $1.1664. The third is I: 3 files at $0.3888 a turn (R J1D:20; src/orchestrator/journey-jobs.ts:297, :314; BROKEN/manifest.json:5-23).
   - Spent: $0.00.
   - Exactly one `journey.broken_step_staged`, after step 2's approval and before step 3's first engine event. The manifest SHA-256 it records, read back from the sandbox's own copy, equals the one in `broken_copy`. No other project of the run has one.
5. **Preview:** the app camera's pictures are recorded for both languages. Its recorded lines give the app's banner text on each page: in English it contains "This is a deliberately broken copy, made to be rejected by the acceptance check." (R BROKEN/files/messages/en.json:4); in Arabic, "هذه نسخة معطّلة عمداً، صُنعت ليرفضها فحص القبول." (R BROKEN/files/messages/ar.json:4).
6. **Checklist:**
   - The run table's outcome is the word the record gives, `failed` (shown "Failed", `data-outcome="failed"`). The exit code is 1.
   - The version is the same as `journey.plan_confirmed`'s `acceptance_version`. So the tests were not changed to suit the app.
   - The summary is exactly `version failed: item 1 failed at step "sees status waiting"` (R test/acceptance-live.test.ts:201).
   - Item 1's row reads "Failed", with "Failed at step: sees status waiting" and the runner's screenshot. Items 2 to 6 read "did not run".
   - The failure file that item 1's `acceptance.item` event names exists, its SHA-256 equals the event's, and its text contains "Approved", as run D checks (R test/acceptance-live.test.ts:200; src/acceptance/runner.ts:199-216). The text itself is not copied into the evidence: it can quote the test (R test/acceptance-live.test.ts:205).
   - If the record gives `not passed`, or anything else, this check fails. That would mean the run did not reject the defect by its test.
7. **Sign-off and export:**
   - There is no sign-off button. The panel reads "Sign-off is offered once a checklist run has passed." (R en.json:258) and "A deliberately broken copy is never signed off or exported."
   - There is no Export tab.
   - The record holds no `journey.signed_off` and no `journey.export.written`.
   - The refusals of a direct POST are shown by tests (section 6), not by the run.
8. **Cost:** three step reservations, each "closed (step_ended)"; spent $0.00.
9. **Close project:** the record lists every event in id order. Nothing of the project is left on the machine (N).
10. **The normal path is unchanged, except where listed.**
    - These existing tests pass with no edit: a step name refused while the project is still at the brief, which the brief rule refuses first (R test/web.test.ts:963-972; src/orchestrator/journey.ts:328, :838); builder/scripted still holds only 01 and 02 (R test/acceptance.test.ts:683-686); package 3.1's run D (R test/acceptance-live.test.ts:187-208).
    - New test A1b: a normal project, past both confirmations, with steps 1 and 2 built and approved, asks to build `03-wrong-status`. It gets 409 and "That step is not one of the plan's." (R journey.ts:397-398). No job starts, nothing is staged, builder/scripted is unchanged.
    - Deliberate changes to every project, each with its own test: "Failed at step: <step>" in a failed item's row (A8); the app camera's banner line, four more preview lines per preview (A8b); sign-off refused for an interrupted project (A9); the second interrupted wording (C7); the cost screen's note on a step stopped part-way (C7); the clean stop on SIGINT and SIGTERM (C1 to C5, C9 to C11); the demonstration's fixed name refused on the New project form (A2b).

**Languages:** every screen in English. The projects list, plan, build, checklist and cost screens also in Arabic and at 390 px wide. This is adapted from J1's rule, which names sign-in, questions, build, acceptance and cost (R BP:242): these are the screens where (a) differs from J1.

### J2 (c): a restart mid-step

The same run, after (a)'s project is closed. Two projects of the normal kind, never the broken one. Each item is a check that the run counts.

**Path T, the clean stop (SIGTERM, a polite request to stop).** The interface is started through `node_modules/.bin/tsx`, as `npm run web` starts it (R builder/package.json:16). The run sends SIGTERM to that wrapper's process id only, as a service manager would; tsx passes it on to the interface (R TSX, `relaySignalToChild`). This is not Ctrl-C, which signals the whole process group (I; gap 165).
- T1. Project P1 ("Restart: clean stop (made-up)") has step 1 approved and step 2 running. This is checked three ways, and the signal is sent only after all three:
  - the camera walk shows the build screen with the running note (`data-job-running="build_step"`) and the pause line, photographs it, and exits with code 0;
  - the record holds at least 1 and fewer than 8 `scripted.write` events of step 2;
  - Docker lists a container whose name starts `builder_<P1>-engine-02-submitter-screen-`.
- T2. SIGTERM. The wrapper exits with code 0 within 120 s; it exits with the interface's own code (R TSX, the child's `close` handler). The interface's last lines name the job it stopped and the sandbox it removed, and say "removed at the stop: 1".
- T3. **Right after the exit, before any restart:** nothing of P1 is left (N): no container, volume, network or image, no `docker` process, and the folder is gone.
- T4. **Record:**
  - `journey.job.interrupted` for the step-2 job, its reason naming a stop on purpose;
  - `step.hold_closed` for step 2 with reason `step_ended` (the halt path, R src/orchestrator/steps.ts:81);
  - `journey.sandbox.removed` with `interrupted: true`, `removed: true` and the stop's own reason;
  - no `journey.job.finished` or `journey.job.failed` for that job, and no `journey.workspace.reset` (the kind, R journey.ts:62; written only after a failed step that was not halted, R journey-jobs.ts:320-326).
- T5. **Restart** on the same database, data folder and port. The interface takes the lock and prints "…marked interrupted and removed at start: 0." (R src/web/main.ts:229). The camera signs in again, since sign-ins live in memory (R src/web/auth.ts:143-151).
- T6. **Screens**, in English, Arabic and at 390 px:
  - the project page shows the interrupted panel with only "Close project" and "New project" (R pages.ts:324-331), and no sign-off button;
  - the build screen's step-2 line reads "Interrupted: the interface stopped while it ran." (R en.json:204), with no build, approve or retry button (R pages.ts:640);
  - the cost screen shows step 2 "closed (step_ended)", with the note "stopped part-way when the interface stopped; not resumed", step room $0.0000 and spent $0.00. ("step_ended" is the name package 1.3 gives the end of any step; the note says this one did not finish.)
- T7. "Close project": the record page opens, and the record ends with `journey.closed`.

**Path K, the crash (SIGKILL, ended at once).** The interface is started as `node --import tsx src/web/main.ts`. The kill goes to that node process itself, not to a wrapper (R EJ3:38, item 2).
- K1. Project P2 ("Restart: crash (made-up)") is mid-step 2, checked as in T1, the camera walk ending with code 0 first.
- K2. SIGKILL. Right after, the run records what is left of P2 (N). The check is that the folder still exists, so the crash path is real; the rest is recorded as found.
- K3. **Restart.** The run retries for at most 30 s if the lock is still held. Then the interface prints "…: 1.". The record holds:
  - `journey.job.interrupted` with "The interface stopped while this job ran. It is not resumed." (R journey.ts:917);
  - `journey.sandbox.removed` with `interrupted: true`, `removed: true` and "Found at start…" (R journey.ts:926-930);
  - `step.hold_closed` with reason `job_interrupted` (R journey.ts:940).
- K4. **After the restart's recovery,** and again once no process names `builder_<P2>` (the run waits at most 60 s): nothing of P2 is left (N).
- K5. **Screens** as in T6, except that the cost screen reads "closed (job_interrupted)", with the same note.
- K6. "Close project", as in T7.

**For the whole run:** at the end, nothing is left of the run's three projects (N), and no container of the run's builder camera (`j2-builder-camera-*`). The database is dropped and the run folder removed.

## 3. The design of (a)

**3.1 How the broken copy is chosen.** The options considered (I):

| Option | Verdict |
| --- | --- |
| 1. A box to tick on the New project form, unticked by default | Not chosen. A demonstration option would sit on the product's real creation form, and a mistaken tick would turn a real-looking project into a broken one |
| 2. A second "Confirm plan" button | Not chosen. Two buttons side by side for a choice that cannot be undone (the tests version is written then, R journey.ts:738-753), and no badge on the earlier screens |
| **3. A separate demonstration button with a name the system fixes, always shown** | **Recommended to the owner (section 12).** The normal form and J1's walk stay as they are. The label is in a badge on every page. A mistaken press costs only a demonstration project, which can be closed. It stays in the product (gap 162) |
| 4. A project kind of its own (id prefix "j2-") | Not chosen. Every guard and clean-up is keyed on "j1-" (R journey.ts:33; example-1-adapter.ts:110-114; app.ts:259, :264). Widening them loosens what limits removal |
| 5. Script only, or reuse 3.1's run D (R E31:24) | Not chosen. The owner would never see it on his screens. Writing journey events from a script makes a record the orchestrator did not produce (R journey.ts:4-6) |
| 6. Option 3, shown only when a setting is on (as `BUILDER_LIVE_PREVIEW`, R main.ts:83-86) | **Put to the owner as the other choice (section 12).** The same code, plus one setting checked at start. The product shows nothing new by default; the owner sees the demonstration in the run's pictures, or on his instance if it is started with the setting |

- **The route** is `POST /demonstrations/broken-copy`, behind sign-in and csrf like every route (I). It cannot live under `/projects/…`: those paths accept only a journey id or "new" (R app.ts:257-266). Under option 6 the route and the panel exist only when the setting is on.
- **What the route makes**, in **one database transaction** on one connection (begin, the project row, its first event, commit), as tx.ts's `inTransaction` does (R src/store/tx.ts:16-33):
  - a project with an id `j1-` plus 12 hex characters, so every existing guard still applies (R example-1-adapter.ts:110-114);
  - the name "Deliberately broken copy (made-up)" and a $5.00 cap;
  - its first event, `intake.brief_entered`, with example 1's ask as the brief (the text the New project form prefills, R pages.ts:264-287) and the field `broken_copy`: by, step, source folder, label, manifest SHA-256, `sign_off: "never"`, `export: "never"`.
  
  So a project of that name never exists without its choice, and the choice never exists without the project: a crash or stop part-way leaves neither (I). `createProject` in src/store/projects.ts takes a `Queryable` (R tx.ts:10), so that the same insert runs inside the transaction; it stays as it is otherwise (R src/store/projects.ts:12-24).
- **Never by default.** Only this route writes `broken_copy`. `POST /projects` reads only name, cap and brief (R app.ts:247), and `Journey.createProject` has no way to take a choice. The New project form refuses any name that starts "Deliberately broken copy", so a normal project cannot carry the demonstration's name without its badge and refusals.

**3.2 Where the plan comes from** (I):
- **Today:** the plan is a constant read from builder/scripted (R journey.ts:35, :158). Four places read manifests only from there:
  - `planSteps()` (R journey.ts:581-586);
  - `buildStep`'s turn count (R journey-jobs.ts:297);
  - `scriptedOnlyProblem` (R journey.ts:356, :384);
  - the test stand-in (R test/journey-stand-ins.ts:89, :96, :112).
- **One source for the plan.** `journeyState` takes a `plan` parameter, default `PLAN_STEPS` (R journey.ts:169), and `scriptedOnlyProblem` a `changeSetsDir` parameter, default builder/scripted (R journey.ts:356). No caller passes either (R grep of src, test and scripts). Both parameters are removed. The plan is worked out from the record alone: `PLAN_STEPS`, then `03-wrong-status` when the choice is honoured.
- **The choice is honoured only on the project's first event**, `intake.brief_entered`, written with the project in one transaction. A `broken_copy` field on any later event is ignored for the plan, so a broken step cannot be added to a project later. The state gets `brokenCopy` (honoured). Every caller of `journeyState` gets the right plan (R journey.ts:607, :620, :912).
- **Any trace counts for the refusals.** The state also gets `brokenTrace`, true when the record holds any of: a `broken_copy` field on any `intake.brief_entered`; any `journey.broken_step_staged`; any `engine.event` of step `03-wrong-status`; a `journey.plan_confirmed` whose steps include it; or `03-wrong-status` in the plan. If 03 were ever copied into builder/scripted, every normal project's plan would include it (R journey.ts:158), and this would refuse their sign-off and export and show the badge (I). Sign-off, export and the live app are refused on `brokenTrace` (3.5, 3.6); the badge is drawn from it.
- **New: `changeSetsFor(step)`.** It gives builder/scripted-broken for `03-wrong-status` and builder/scripted for any other step. It is used by:
  - `planSteps(s)`, which now takes the state;
  - `buildStep`'s turn count;
  - `scriptedOnlyProblem`.
- **The screens use the state's plan.** The plan and build screens take `j.planSteps(s)` instead of `j.planSteps()` (R pages.ts:472, :639). Otherwise the build screen would offer "Go to the preview" after step 2 while the preview job refused (R pages.ts:655; journey.ts:332-333).
- **The record lists all three steps.** `journey.plan_confirmed` records the three steps (R journey.ts:745), with `broken_copy: true` and `quality_check_after_each_step_and_retry: "not done (milestones 1 and 3)"`. A normal project's `plan_confirmed` is unchanged.

**3.3 What runs** (I):
- **Nothing new in the engine, the runner or the result reader.** The engine refuses a step that is not in its own sandbox's change-set folder (R src/engine/scripted.ts:234). It checks with git that exactly the manifest's files changed, with their fingerprints (R scripted.ts:334-363).
- **New: staging step 3.** `Sandboxes` gains `stageBrokenStep(x)`. In the real adapter it calls the existing `stageBrokenStep` (R scripts/example-1-sandbox.ts:103-106) unchanged, after `checkJourneyId`.
- **When `buildStep` stages.** Only in a build job of `03-wrong-status`, when the state holds the honoured choice and steps 1 and 2 are approved (`buildStepRefusal` already requires this, R journey.ts:397-403; it is checked again here). Otherwise it refuses.
- **Where it stages.** Only into the sandbox's own change-set folder: the job refuses unless `x.changeSets` is `join(x.dir, "engine-change-sets")`, as makeExample1 makes it (R scripts/example-1-sandbox.ts:64-67), and that folder is not under builder/. The adapter's method checks the same. So 03 can never be copied into builder/scripted, which every project's plan reads and which the test files share while they run.
- **What it records.** Just before step 3's engine is made, the job stages, reads the staged manifest back from the sandbox's copy (what the engine reads), and refuses the step unless its SHA-256 equals the one in `broken_copy`. Then it writes `journey.broken_step_staged` with the files and that SHA-256. A retry of step 3 after a failed job stages again and writes one more event: one per build job of step 3. The engine containers of steps 1 and 2 never see the broken step, as 3.1 intended (R example-1-sandbox.ts:6-9).
- **The checklist job is unchanged.** It runs `runAcceptance` with the version fixed at "Confirm plan" (R journey-jobs.ts:449-478). The runner writes one `acceptance.item` per item, with `status`, `why`, `step`, the failure file and the screenshot, then `acceptance.run.finished` with `outcome` and `summary` (R src/acceptance/runner.ts:198-229). A failed item makes the outcome `failed` (R src/acceptance/results.ts:379-382).
- **The app camera** prints one more line per page: `{"kind":"banner","name":…,"text":…}`, the first 200 characters of the app's banner (the page's `role="note"` element, R templates/next/src/app/[locale]/layout.tsx:26-28). The line goes into the record as a preview line, as every camera line does (R journey-jobs.ts:365). The English banner of the broken copy is 187 characters, so it fits whole (R, counted). This is what Done means (a) item 5 checks.

**3.4 What the screens show** (I, wording Claude Code's; Arabic on docs/arabic-wording-list.md):
- **Projects screen:** the panel "Simulated build", the line "Builds example 1 with one more step that Claude Code broke on purpose: a new request is saved as Approved instead of Waiting. The steps are fixed changes written in advance; no AI model is called. The checklist run on it is real. It is never signed off or exported.", and the button.
- **Badge:** next to the project's name in the page heading (R pages.ts:316) and in the list row (R pages.ts:245). It is drawn by one helper from `brokenTrace`, never from the name.
- **Plan:** step 3 shows its label, plus "Deliberately broken copy: a new request is saved as Approved instead of Waiting. Made so that the checklist rejects it." Below the existing line "Quality gate after each step: not done (milestone 1)." (R en.json:120; pages.ts:477), a broken copy's plan adds: "No quality check after a step yet, and no retry (milestones 1 and 3): only the checklist at the end checks the app." (R HO:145; DN:334, :588, :590).
- **Build:** the same two lines (R pages.ts:665). The approve buttons (R pages.ts:648) read:
  - after step 2: "Approve and build step 3 (the deliberately broken copy)";
  - after step 3: "Go on to the preview with this broken step (no quality check after a step yet)".

  The approval itself is the same event as today. The existing "Try step N again" (R en.json:181) is not HANDOVER's retry. It appears only after a failed or interrupted job (R pages.ts:651), and step 3 does not fail.
- **Checklist:**
  - unchanged: the outcome word, the summary, the "Failed" row with its why and screenshot, and the stand-in labels (R pages.ts:815-856; en.json:240-241);
  - added for every project: "Failed at step: <step>" in a failed item's row, from the event's `step`. Today the row's why reads only "it ran and failed" (R results.ts:363), and the step appears only in the summary (R pages.ts:863).
- **Sign-off panel:** the existing "Sign-off is offered once a checklist run has passed." (R pages.ts:878), plus "A deliberately broken copy is never signed off or exported." If a run on such a project ever reads `passed`, the panel shows a warning instead: "A checklist run passed on a deliberately broken copy: the check did not catch the planted defect. It is still not signed off."

**3.5 Sign-off and export refused** (I):
- **Today one condition stops both.** Sign-off needs the last run's outcome to be "passed" (R journey.ts:424-432). Export needs sign-off (R journey.ts:345).
- **J2 adds a refusal of its own, on `brokenTrace`.** It goes in `signOffRefusal` and in `JOB_RULES.export`, and holds whatever the outcome reads. The checklist's own reason is shown first.
- **Why refuse the export rather than label it:**
  - An export is the one thing that leaves the builder. An archive of an app known to be broken has no use to the owner, and a label can be lost once the file is copied.
  - Refusing needs no new screen: the Export tab is shown only after sign-off (R pages.ts:302).
  - A forged "passed", or a future change to how the outcome is read, still cannot sign off or export a broken build. Tests give exactly that forged input (section 6).
- **Also for every project: no sign-off once interrupted.** Today `signOffRefusal` does not look at `s.interrupted` (R journey.ts:424-432), so a project removed at start still offers "Sign off" beside the interrupted panel if its last run passed (R pages.ts:869-878). The clean stop removes idle projects at the checklist stage too (4.1), so this would become more common, and it contradicts the panel's "Close project or New project". J2 adds `s.interrupted` to the refusal (test A9).

**3.6 The live preview is refused for it** (I):
- `JOB_RULES.live` refuses a project with `brokenTrace`, with a plain sentence, before `scriptedOnlyProblem` runs (R journey.ts:346).
- Without this refusal, `scriptedOnlyProblem` would accept a broken copy's record once it reads step 3's manifest through `changeSetsFor` (its writes match 03's manifest), and the live app would be offered for a broken build. The preview screen evaluates that rule while it renders (R pages.ts:718); test A7 renders it.
- The live preview is off by default anyway (R main.ts:83-86).

**3.7 Records written for (a)** (I):
- `intake.brief_entered` with `broken_copy` (by, step, source folder, label, manifest SHA-256, `sign_off: "never"`, `export: "never"`), the project's first event;
- `journey.plan_confirmed` with three steps;
- `journey.broken_step_staged`, one per build job of step 3;
- step 3's engine events, `step.hold_opened` and `step.hold_closed`, and its job's end;
- the app camera's banner lines, as preview lines;
- the runner's three kinds of event.

No new table. The checklist can be run again while the app runs and nothing is signed off (R journey.ts:337-344). This stays as it is; a second run is expected to fail again.

## 4. The design of (c)

**4.1 What stops the interface.**
- **Today** (R main.ts:262-271), SIGINT or SIGTERM does five things: close the server, stop the live preview, release the lock, end the database pool, exit 0. It does not halt the journey, wait for the running job, or remove anything. So a clean stop leaves everything for the next start, as a crash does (I). Gap 139 names the remedy: "A stop that also removes them is J2 (c)." (R KG:154).
- **J2 adds the clean stop**, as an exported function `stopOnSignal`. It is shaped like `stopAfterLockLost` (R main.ts:176-202) so that it can be tested without a process (I). In order:
  1. **No new work.** A `stopping` flag is set. Every request gets a plain 503, "The interface is stopping.", through the same hook as a lost lock (`unavailable`, R main.ts:254; app.ts:120-124). Then the server is closed and the live preview is stopped.
  2. **The journey is halted** with "The interface was stopped on purpose (SIGTERM)." (or SIGINT) (R journey.ts:815-821). From then on no action or job starts (R journey.ts:589-591, :844). The running job is told to stop. A step's engine container is killed at once (R journey-jobs.ts:309-311). The job is recorded interrupted with that reason (R journey.ts:870-876), and the step's hold closes as `step_ended` (R steps.ts:81).
  3. **A bounded wait,** `STOP_WAIT_MS` = 30 s, chosen, not measured, for two things:
     - the running job. Some operations cannot be stopped from here: the image build and start, a checklist run, the export's archive (R journey-jobs.ts:26-30);
     - each project's action already in progress, such as a "Close project" that passed the 503 before the flag was set. The stop waits on that project's chain of actions (`locks`, R journey.ts:567, :589-600) before it reads the project. So the stop and a close never remove the same project at once, and the record never holds two removals.

     A project whose job or action has not ended in time is not removed. A line names it, the exit code becomes 1, and the next start removes it, as today.
  4. **The lock is asked of the database** (`lock.check()`, R main.ts:142-160) before each project, and each check is bounded at 5 s (`LOCK_CHECK_MS`, chosen). A check that reports the lock lost, or does not answer within 5 s, ends the removal: nothing more is removed, and the exit code is 1. The interface never removes after the lock is lost. A loss found by the check also fires the existing `onLockLost`, which runs `stopAfterLockLost` and exits 1 (R main.ts:258-259, :176-202). The outcome is the same: nothing more removed, exit 1. `stopAfterLockLost` itself is unchanged and removes nothing (R journey-jobs.ts:26-30).
  5. **Removal.** Every journey project of its own database that has a sandbox and is not closed is removed. This is `recoverInterrupted`'s loop (R journey.ts:906-948) with one option, the moment it runs ("start" or "stop"), which chooses the reason written. The loop reads only "j1-" projects (R journey.ts:907-908), skips the project of a job still running (R journey.ts:910) and closed projects (R journey.ts:914).
     - It removes through `JourneyJobs.cleanup`, which uses the process's own handle (R journey-jobs.ts:505-515).
     - It records `journey.sandbox.removed` with `interrupted: true`, `removed`, and the reason "The interface was stopped on purpose; this project's containers, images and folder were removed at the stop. It is not resumed."
     - `closeProject` cannot be used: a halted journey refuses every action (R journey.ts:589-591).
  6. **Then the end:** release the lock, end the pool, exit. The exit code is 0 only if every open project was removed; otherwise 1, with a line naming each project left. The lock is released only after the removal, so a second interface on the same database cannot run its own recovery at the same time (I).
- **A last bound.** If the stop has not finished 90 s after the signal (`STOP_DEADLINE_MS`, chosen), the process exits 1 at once, and the rest is left to the next start (gap 165).
- **A second SIGINT or SIGTERM** exits at once with code 1. It leaves the rest to the next start and says so (I).
- **Under `npm run web`**, the signal passes through tsx 4.23.15. Sent to tsx alone, tsx waits about 30 ms for the interface to report the signal, then sends it to the interface. If the interface does not report it within about 30 ms more, tsx kills it with SIGKILL (R TSX, `relaySignalToChild`). The interface's preflight handler reports it (R node_modules/tsx/dist/preflight.cjs). tsx exits with the interface's own code (R TSX, the child's `close` handler). Path T goes through this wrapper on purpose, to show it (M).
- **Ctrl-C is not shown** (I). In a terminal it sends SIGINT to the whole process group: npm, tsx, the interface, the docker programs it started, and the live preview's front. A docker program that ends first can end the step as failed, with a workspace reset, before the halt marks it interrupted. J2 does not kill or shield those programs (gap 165).
- **Idle projects are removed too** (I). An idle project has a sandbox but no job, for example its app running at the checklist stage. The next start would remove it and mark it interrupted in any case (R journey.ts:914-930). Removing it at the stop changes only when, and that is what gap 139 asks for.

**4.2 Mid-step: a labelled pause** (I):
- **The setting** `BUILDER_DEMO_STEP_PAUSE_MS` takes a whole number from 0 to 10,000. Unset or 0 means off. Anything else, and the interface refuses to start, as with `BUILDER_LIVE_PREVIEW` (R main.ts:83-84).
- **When it is on:**
  - `buildStep` passes it as `delayMsPerWrite` to the scripted engine. The engine already has this option "for rehearsing a stop part-way" (R scripted.ts:117-118, :268); apply.mjs pauses before each write (R scripted/apply.mjs:85, :134). Today the journey never passes it (R journey-jobs.ts:306-308).
  - At start the interface prints a line about the setting.
  - Each build step first writes `journey.step.paused_for_demonstration` with the pause.
  - The build screen shows "Demonstration setting: the scripted engine pauses N ms before each write, so that a stop part-way can be shown."
- **The run uses 4,000 ms.** Step 1 then lasts about 16 s (4 files) and step 2 about 32 s (8 files) (I). That leaves time for the camera walk to photograph step 2 running and exit, and for the run's three checks, before the signal (T1).
- **Not chosen:**
  - stopping during the preview job (29 s in J1's run, R J1EV: 16:02:33.948 to 16:03:03.179): that is mid-job, not mid-step, and it hits the image build, which cannot be stopped;
  - catching a half-second step: unreliable (R EJ1:404, a one-second sample missed the engine containers).

**4.3 What the screens show after the next start:**
- **Unchanged:**
  - the interrupted panel (R pages.ts:319, :324-331);
  - the step line "Interrupted…" (R en.json:204);
  - no build, preview, checklist, export or live action (R pages.ts:640, :718, :792, :831, :888);
  - the cost screen's hold state with its reason (R pages.ts:514).
- **Wording, for every project** (I):
  - The panel says "A job of this project was interrupted…" (R en.json:157). That is untrue for a project that had a sandbox but no job running: it too is marked interrupted (R journey.ts:234, :914-929), and the clean stop makes this case more common. A second message is used when no job of the project was interrupted: "The interface stopped while this project's app was set up or running. Its containers were removed; nothing is resumed. Close the project, or start a new one."
  - On the cost screen, a closed reservation whose step's last build job was interrupted gets the note "stopped part-way when the interface stopped; not resumed". Without it, "closed (step_ended)" reads like a normal finish.
  - No sign-off button on an interrupted project (3.5).

**4.4 Records written:**

| | Clean stop (path T) | Crash, then start (path K) |
| --- | --- | --- |
| The job | `journey.job.interrupted`, reason "The interface stopped while this job ran: The interface was stopped on purpose (SIGTERM). …" (halt path, R journey.ts:870-876) | `journey.job.interrupted`, "The interface stopped while this job ran. It is not resumed." (R journey.ts:917) |
| The step's hold | `step.hold_closed`, `step_ended` (R steps.ts:81) | `step.hold_closed`, `job_interrupted` (R journey.ts:940) |
| The sandbox | `journey.sandbox.removed`: `interrupted: true`, `removed`, reason "stopped on purpose" (new) | The same, reason "Found at start…" (R journey.ts:926-930) |
| Start line | "…removed at start: 0." | "…removed at start: 1." (R main.ts:229) |

The evidence must not claim `job_interrupted` for path T.

**4.5 Not endangering another interface's sandbox:**
- **Same database:** the lock allows one interface per database (R main.ts:119-139). The clean stop removes only while it holds that lock, asks before each project with a bounded check, and releases the lock last.
- **Another database,** such as the owner's 4020 instance: recovery and removal read only their own database's projects (R journey.ts:907) and remove exact `builder_<id>` names (R example-1-adapter.ts:110-114, :319-347).
- **The run** uses its own database, data folder and port 4022, which nothing else uses (R grep of builder/ and docs/). The live preview is off.
- **The run signals only the process it started,** by its pid, never by name, port or process group.
- **The run waits for port 13161 and never stops anything,** as J3's run does (R scripts/demo-journey-j3.ts:150-153). It refuses to start if anything named `builder_j1-` exists before it (R scripts/demo-journey.ts:136-142).
- **Its clean-up removes only its own projects, by exact id (N).** It does not use J1's machine-wide prefix sweep (R demo-journey.ts:364-375), which would reach the owner's sandboxes if he had one.

## 5. Stack and files

- **No new dependency.**
- **No migration.** Everything is events (R J1D:10). The highest migration is `012_journal_set_asides.sql` (R src/store/migrations/). Were one ever unavoidable, it would be 013.
- **Change** (I):
  - **src/orchestrator/journey.ts:** `EV.brokenStepStaged` and the pause event; `BROKEN_STEP` and `changeSetsFor`; `brokenCopy` and `brokenTrace` in the state, and the plan from the record (the `plan` parameter removed); `planSteps(s)`; `scriptedOnlyProblem` through `changeSetsFor` (its `changeSetsDir` parameter removed); the broken-copy refusals in `signOffRefusal`, `JOB_RULES.export` and `JOB_RULES.live`; `s.interrupted` in `signOffRefusal`; `createBrokenCopyDemo`, in one transaction; the name refusal in `createProject`; `recoverInterrupted`'s option for when it runs, with the wait on each project's chain of actions.
  - **src/orchestrator/journey-jobs.ts:** the turn count through `changeSetsFor`; staging just before step 3, with its target check and read-back; the pause.
  - **src/orchestrator/example-1-adapter.ts:** `Sandboxes.stageBrokenStep`, with the same target check.
  - **src/store/projects.ts:** `createProject` takes a `Queryable`, so it can run inside a transaction.
  - **src/web/main.ts:** the pause setting; `stopOnSignal` with its three bounds; the `stopping` flag in `unavailable`; the second signal.
  - **src/web/app.ts:** the demonstration route.
  - **src/web/pages.ts:** the demonstration panel, the badge, the plan from the state, step 3's wording, the approve wording, the failed step in the row, the sign-off lines, the two interrupted wordings, the cost note, the pause note.
  - **src/web/messages/en.json, ar.json:** the new messages.
  - **camera/app-shots.mjs:** the banner line.
  - **camera/builder-shots.mjs:** walks `j2a`, `j2c-run` and `j2c-after`, chosen by `BUILDER_CAMERA_WALK` (R camera/builder-shots.mjs:385).
  - **test/journey-stand-ins.ts:** each stand-in sandbox gets its own change-set folder, `engine-change-sets` inside its own folder, copied from builder/scripted as makeExample1 does (R scripts/example-1-sandbox.ts:64-67); its runner reads manifests and files from `x.changeSets`, not builder/scripted (R test/journey-stand-ins.ts:89, :96, :112); `stageBrokenStep` copies 03 there only; `runAcceptance` gets a "failed" mode, as results.ts writes it.
  - **test/journey.test.ts, test/web.test.ts:** the new tests (section 6).
- **Add:**
  - `scripts/demo-journey-j2.ts`;
  - `scripts/journey-restart-checks.ts`: pure checks on Docker's lists, processes and events, among them N, as `journey-network-checks.ts` is (R scripts/journey-network-checks.ts:1-5);
  - `evidence/<date>-journey-j2/`.
- **Records:**
  - DEC: Claude Code's choices, each the owner's to overrule (section 12), and the owner's answer to the question once he gives it.
  - BP: a progress row for J2, as J3 has one (R BP:303) and no row of its own in 7.7. J2 is planned in J1's design (R J1D:35) and, like J1, counts toward no milestone (R J1D:29). The stale progress rows also need fixing: J1 still reads "#37, draft" and J3 "Not opened (not pushed)" (R BP:302-303), but both are merged (R `git log`: `14787d8` merges #38).
  - KG: 162 to 167, and gap 139 updated (section 9).
  - SOURCES: tsx 4.23.15's signal relay and exit code, read in its own files, with the date.
  - ST, and docs/arabic-wording-list.md.

## 6. Tests and controls

**Tests that must fail first** (I): each new test is committed, then run with `builder/src` checked out at `14787d8`, where it must fail; then on the change, where it must pass. The output goes to `new-tests-before-and-after.txt`, as J3 did (R evidence/2026-11-13-journey-j3/after-bot/new-tests-before-and-after.sh, 40 lines). No test may skip; the gate scan fails the suite on a skip (R KG:128, gap 112).

**Regression guards, which cannot fail first:** A1, A1b, A2b's extra-field part and C8 pass at `14787d8` too. A normal journey works today and nothing stages; a normal project refuses 03 today; `POST /projects` reads three fields today; and scripts/ is not under src/. They are marked so in the evidence. That each can fail is shown by its control, or, for C8, by its own made-up lists that must be reported.

| # | Test (stand-in sandboxes unless said) | File |
| --- | --- | --- |
| A1 | Guard. A normal project goes through the whole journey: two steps, `stageBrokenStep` never called, builder/scripted unchanged (its listing and `git status`) | journey.test.ts |
| A1b | Guard. A normal project, past both confirmations, with steps 1 and 2 built and approved (the preview job waited for), posts `/projects/<id>/build` with `step=03-wrong-status`: 409, "That step is not one of the plan's.", no `journey.job.started`, `stageBrokenStep` not called, builder/scripted unchanged | web.test.ts |
| A2 | The demonstration route: fixed name and cap; the first event is `brief_entered` with `broken_copy`; a three-step plan; `plan_confirmed` lists 03 with its label from scripted-broken. With a database that refuses the second insert, no project row is left | web.test.ts, journey.test.ts |
| A2b | `POST /projects` with extra fields (`broken_copy=1`, `step=03-wrong-status`) makes a normal project: two steps, no badge (guard). A name starting "Deliberately broken copy" is refused on the New project form | web.test.ts |
| A3 | The choice is honoured only on the first event. A second `intake.brief_entered` carrying `broken_copy`, appended by hand: the plan stays at two steps, and sign-off and export are still refused | journey.test.ts |
| A4 | Staging happens once per build job of step 3, just before its engine, never before steps 1 and 2 are approved. It writes only into the sandbox's own change-set folder; builder/scripted is unchanged. The recorded SHA-256 is read from the staged copy. A sandbox whose change-set folder is outside its own folder: staging refused, nothing copied | journey.test.ts |
| A5 | Step 3's reservation is sized for 3 turns | journey.test.ts |
| A6 | A broken project with a forged run outcome of "passed": sign-off refused, and the warning shown. With a forged `journey.signed_off`: export refused by `JOB_RULES.export` and by POST. A normal project whose record holds only a `journey.broken_step_staged`, or only an engine event of step 03: sign-off and export refused, badge shown | journey.test.ts, web.test.ts |
| A7 | Live refused for a broken project with a plain sentence. Its preview screen renders, with no error, with the front on | journey.test.ts, web.test.ts |
| A8 | Screens: the panel; the badge on every project page and the list (en, ar); step 3's wording; the quality-check line; "Failed at step"; the sign-off lines; no export tab | web.test.ts |
| A8b | The app camera's script prints one banner line per page, its text cut at 200 characters. Read from the script's text, as the existing camera test reads it (R test/journey.test.ts:1178-1186), since the browser is not on this machine; the run (Done means (a) item 5) is what shows it working | journey.test.ts |
| A9 | An interrupted project whose last checklist run passed: no sign-off button, and POST sign-off gets 409 | journey.test.ts, web.test.ts |
| C1 | `stopOnSignal` with a step running: the engine is killed; the job is interrupted with the stop's reason; the hold closes `step_ended`; the sandbox is removed and recorded; the removal comes before `lock.release`; exit 0 | web.test.ts |
| C2 | An idle project with a sandbox is removed at the stop. A closed project whose record still names a sandbox, and a project whose id does not start "j1-", are untouched | web.test.ts |
| C3 | The lock found lost before removal: nothing is removed, a line says so, exit 1. A lock check that does not answer within its bound: the same | web.test.ts |
| C4 | A job that has not ended within the wait: its project is not removed, the others are, a line names it, exit 1 | web.test.ts |
| C4b | A second signal during the stop exits at once with code 1 | web.test.ts |
| C5 | The real process (as R test/web.test.ts:1292-1383 spawns it): SIGTERM with no project gives exit 0 and "removed at the stop: 0" | web.test.ts |
| C6 | The pause setting: values out of range are refused; the engine gets the pause only when it is set; the pause line | web.test.ts, journey.test.ts |
| C7 | The panel's two wordings; the cost screen's note on a step stopped part-way | web.test.ts |
| C8 | Guard. The run's pure checks, N among them, each fed made-up Docker lists, processes and events; a list holding only one image, one volume, one network or one process of the project must be reported | journey.test.ts |
| C9 | A request during the stop gets 503 "The interface is stopping." | web.test.ts |
| C10 | A "Close project" in progress when the signal comes: the stop waits for it, then skips the closed project; the record holds one `journey.sandbox.removed` | journey.test.ts |
| C11 | The stop's last bound: a removal that does not end within it exits 1 | web.test.ts |

**Controls** (I): each safeguard is removed by exact text replacement, its guarding test is run alone and shown failing, and then the file is restored. The checkout is compared with HEAD once at the end, as in J3's `controls.py` (R evidence/2026-11-13-journey-j3/controls-scripts/controls.py:7-146).

| Safeguard removed | Test that must fail |
| --- | --- |
| The plan check in `buildStepRefusal` (`!s.plan.includes(step)`, R journey.ts:398) | A1b |
| The choice honoured on any event, not only the first | A1b, A3 |
| The transaction (project row and first event written separately) | A2 |
| The name refusal on the New project form | A2b |
| The state check before staging | A1, A4 |
| "Just before step 3" (staged when the sandbox is made instead) | A4 |
| The target check before staging (the stand-in's outside folder accepted) | A4 |
| The read-back of the staged manifest | A4 |
| `changeSetsFor` (step 3 read from builder/scripted) | A2 |
| The broken-copy rule in `signOffRefusal` | A6 |
| The broken-copy rule in `JOB_RULES.export` | A6 |
| The refusal on any trace, not only on the honoured choice | A6 |
| The warning when a broken copy's run reads "passed" | A6 |
| The live refusal | A7 |
| The badge helper | A8 |
| The banner line in the app camera | A8b |
| `s.interrupted` in `signOffRefusal` | A9 |
| The halt in `stopOnSignal` | C1 |
| Removal before release (order swapped) | C1 |
| The closed-project check in the stop's removal | C2 |
| The "j1-" filter, in both the query and the loop | C2 |
| The lock check before removal | C3 |
| The bound on the lock check | C3 |
| The bounded wait (the running project removed) | C4 |
| The second-signal handler | C4b |
| The pause only when set | C6 |
| The second wording; the cost note | C7 |
| The `stopping` flag in `unavailable` | C9 |
| The wait on the project's chain of actions | C10 |
| The stop's last bound | C11 |

`POST /projects` with extra fields (A2b) has no control: the safeguard is that `createProject` takes no choice at all, and a control would have to add a hole rather than remove a guard. It is a regression guard only.

**The whole suite** runs under `flock <scratchpad>/live-tests.lock`, with `BUILDER_BROWSER_CACHE` set and a database of its own, as J3's did (R evidence/2026-11-13-journey-j3/after-bot/full-suite.sh). The live run D of 3.1 runs in it (R test/acceptance-live.test.ts:187). Also `npm run typecheck` and `npm run check:licences` before every push.

## 7. The automated run

`flock <scratchpad>/live-tests.lock npx tsx scripts/demo-journey-j2.ts <evidence folder>`. It copies J1's and J3's runs (R scripts/demo-journey.ts; scripts/demo-journey-j3.ts) (I):

**Before** (nothing is started on a refusal):
- the runner image is checked with `runnerImageProblem` (R demo-journey.ts:124-128);
- the builder tree, free disk and Docker's list are recorded;
- the run refuses if anything named `builder_j1-` exists (R demo-journey.ts:136-142);
- it waits up to 30 min for ports 13161 and 4022 to be free, and never stops anything (R demo-journey-j3.ts:150-153);
- a fresh database `builder_j2_<run>`, data folder and camera folder are made;
- a random interface password goes into the interface's environment and, as a 0400 file, to the camera. It is never printed (R demo-journey-j3.ts:155-170).

**The interface** runs on 127.0.0.1:4022, with the live preview off and, under option 6, the demonstration setting on. It is started four times:

| Start | How it is started | Setting | What happens |
| --- | --- | --- | --- |
| 1 | `node --import tsx` | none | Camera walk `j2a`: the whole of (a), then "Close project". The walk exits 0. SIGTERM; expects exit 0 and "removed at the stop: 0" |
| 2 | `node_modules/.bin/tsx` (as `npm run web`) | pause 4,000 ms | Walk `j2c-run`: P1 to step 2, photographed running; the walk exits 0. The run checks T1, then sends SIGTERM to the wrapper. Then T2 to T4 |
| 3 | `node --import tsx` | pause 4,000 ms | T5. Walk `j2c-after` for P1 (T6, T7); it exits 0. Walk `j2c-run` for P2; it exits 0. The run checks K1, then SIGKILL to this node process. Then K2 |
| 4 | `node --import tsx` | none | K3 and K4. Walk `j2c-after` for P2 (K5, K6); it exits 0. SIGTERM; exit 0 |

No signal is sent while a camera walk is running: a walk cut off by the stop would get 503s or refused connections, and the run requires every walk to exit 0.

**Docker** (I):
- While a `j2c-run` walk runs, the run reads Docker's list every 0.5 s and polls its own database for step 2's writes.
- Between the stops and the starts it records `docker ps -a`, `docker volume ls`, `docker network ls`, `docker image ls` and `ps -eo pid,args`, and reports what N matches for each project.
- J1's six network checks are kept for (a)'s app (R scripts/journey-network-checks.ts:11-29).

**Screenshots** go to `evidence/<date>-journey-j2/screens/NN-<screen>-<en|ar|phone>.png`, under the same name and size rules as J1 (R demo-journey.ts:96-118):
- for (a): the projects list with the panel, the brief with the badge, the plan, the build after step 3, the preview, the checklist, sign-off, cost and the record;
- for (c): the build screen with step 2 running, then for each path the project page with the interrupted panel, the build screen and the cost screen.

**Files and result:**
- The run also writes `events.json` (refused if it holds a password or pass), `camera-lines.jsonl`, `interface-log.txt` (with placeholders for the run folder and the session proxy) and `run-demo.txt` (R demo-journey.ts:308-318, :354-361).
- It prints "Checks in all: N passed, M failed". It exits 0 only if every camera walk exited 0, every check passed and every shot was copied.
- Clean-up runs in `finally`, by exact project ids (N), after every check has been counted. Anything left still sets exit code 1.

**Evidence file:** `evidence/<date>-journey-j2/journey-j2.md`, in J1's and J3's shape: what the owner can now do, a Real or Simulated table per screen, the checks with their files, the screenshot table, "Checked and assumed", and "Not done" (R EJ1:11-41; EJ3:5-14). It glosses "closed (step_ended)" in plain words, and marks the regression guards as such.

## 8. Review

Review is by risk, under the plan (R BP:47):
- **(a) touches acceptance separation (I).** It lets a step outside builder/scripted write to the workspace that the runner then tests. It also adds refusals on sign-off and export that rest on the checklist's verdict.
- **(c)'s clean stop removes containers on the machine (I).** Its danger is removing another interface's sandbox, which is isolation.
- **So:** one review by fresh reviewers. These parts are reviewed adversarially (each serious finding challenged by others):
  - (a)'s path to the runner: the choice and its transaction, staging and its target check, `changeSetsFor`, the tests version, and the sign-off and export refusals;
  - (c)'s removal under the lock, with its waits and bounds.

  The rest gets one fresh review. This follows J1's precedent (R J1D:81).
- **The cap** (I): J2 changes no reservation code. Holds close as today: `step_ended` on a halt, `job_interrupted` at start. If the build changes that, the cap part joins the adversarial list.
- **Rounds:** at most two. After the second, findings that are not blocking go to KNOWN-GAPS (R BP:53).

## 9. Risks, and known gaps to add

**Risks** (I unless cited):
- **A broken build signed off or exported.** Guarded by two refusals on any trace of the broken copy, with tests A3 and A6 and their controls.
- **The broken copy reaching a project whose owner did not choose it.** Guarded by the plan check (A1b), the first-event rule (A3), staging's state and target checks (A4) and the transaction (A2). The existing tests stay unchanged (R test/web.test.ts:963-972; test/acceptance.test.ts:683-686). Weakening any of them breaks hard rule 8.
- **Reading the rejection as proof that the checklist catches defects in general.** The labels and gap 163 say otherwise.
- **The record says `removed: true` while something is left.** `destroyRecorded` ignores Docker's errors and returns normally (R example-1-adapter.ts:327-345). A docker program cut off by SIGKILL may still run after the restart. So the evidence checks Docker's list (N), not the record (K4).
- **Restart timing.** After SIGKILL, PostgreSQL must notice that the session has ended before the lock is free. Otherwise the start prints "Another interface is running…" and exits 1 (R main.ts:137). The run retries for at most 30 s (M).
- **Shared resources.** One project's app runs at a time, and port 13161 must be free (R journey-jobs.ts:348-349; example-1-adapter.ts:276-280). The disk floor is 4 GB, assumed, not measured (R journey.ts:509-525).
- **The owner's instance.** His 4020 interface is stopped (R ST:20). Restarting it removes the sandboxes of his running projects (R J3D:236). From J2 on, so does stopping it on purpose. He is told before either.
- **J1's and J3's runs** wait 15 s after SIGTERM (R demo-journey.ts:346-352). They close their projects first, so their stop removes nothing and still fits that time. Unchanged.

**Gaps to add** (162 is the next free number; R KG:176 is 161):
- **162. The broken-copy demonstration is in the product.**
  - It consists of a panel, a route, and the journey reading builder/scripted-broken. Under option 6 it is there only while its setting is on.
  - It is made only by that route, in one transaction. Its sign-off and export are refused by a rule of their own, on any trace of it, and live use is refused. builder/scripted keeps its two steps.
  - Whether to keep it once per-step checks exist is the owner's call.
- **163. One planted defect, one stand-in test, same author.**
  - The rejection shows that the runner rejected this defect through a test written knowing it, and that reads the list item because the confirmation "says 'Waiting' whatever was stored" (R SPEC1:48-58).
  - It says nothing about defects in general, and it is not independent acceptance (3.2b, R BP:196).
- **164. No quality check after a step, and no retry.** HO:145 asks for both (milestones 1 and 3, R DN:588, :590). The scripted engine checks only that a step wrote its fixed files (R scripted.ts:334-363). A broken step builds, is shown and is approved with nothing stopping it. Only the checklist at the end catches it, and the screen says so.
- **165. The clean stop's limits.**
  - It waits at most 30 s (chosen, not measured) for a job it cannot stop, or an action in progress. That project is left for the next start, and the exit code is 1.
  - Docker programs the interface started may run on after it exits; it kills no process group. A `docker build` left running (R manager.ts:978) can finish after the next start has removed the project's images, and recreate `builder_<id>-app:latest` with no record left to remove it. The run's check (N) would show it; on the owner's machine nothing would remove it.
  - Ctrl-C signals the whole process group, docker programs included. Not shown; the step may be recorded as failed, with a workspace reset, instead of interrupted.
  - Each lock check is bounded at 5 s, and the whole stop at 90 s, both chosen. A lock lost while a project is being removed ends the process at once through the existing path (exit 1), part-way through that removal; the next start removes the rest.
  - A second signal exits at once.
  - A stop that is not a signal is a crash, and nothing is removed until the next start. Examples: the session's machine paused or reclaimed (R HO:303), or tsx's SIGKILL if the report back fails.
- **166. `removed: true` in the record is not proof** (as above). The evidence reads Docker's list.
- **167. The demonstration pause is product code.** It is off unless `BUILDER_DEMO_STEP_PAUSE_MS` is set. When set, every step is slower, and the screen and the record say so.
- **Gap 139, updated:** "A stop that also removes them" is done for SIGTERM and SIGINT, while the lock is held. Sign-off is no longer offered on an interrupted project. Its parts (1) and (2) remain. Part (3) is partly answered by J2's run, which shows real containers but not a PostgreSQL restart.

## 10. What is not done

**Not done:**
- **J2 (b), package 3.2:** the app starting from the export with the builder stopped, and the check passing from the exported copy (R BP:193), after gaps 53 and 39 (R KG:69, :56). This comes next, after J2.
- **The real engine:** 2.2 and 2.3 (R BP:185-186). Everything here is the scripted engine.
- **The quality check after each step and HANDOVER's one retry** (R HO:145; DN:334, :588, :590). With them goes milestone 3's "one deliberate failure shown with its name" at the step: step 3 applies cleanly (R E31:24), so it cannot show a step failure.
- **Resuming after a restart:** J2 resumes nothing (R J1D:44). W2's "resumes without repeating a finished build" stays W2's (R BP:239).
- **An engineer's reading:** none has read 0.6c or J3 (R ST:29). The clean stop's removal should be read with gap 139.
- **Not tried:** a real PostgreSQL restart (R KG:154, part 3), Ctrl-C to the process group, and WebKit. The owner's phone test (J3's M1) is still pending (R ST:24).

**Not in J2** (beyond what J1D:35 plans; none of it is built here):
- the defect shown at the step, and a fix-and-retry loop;
- a broken copy of any other step or example;
- the broken copy in the live preview;
- killing the interface's docker programs by process group;
- removal at the stop of an operation that cannot be stopped;
- changes to J1's or J3's automated runs, or to the record of a project made before J2.

## 11. Checked and assumed

- **Checked (R):**
  - every line cited above, at `14787d8`;
  - J1's step and preview durations, by reading J1EV;
  - tsx's signal relay and its exit code, in its dist files in this worktree;
  - that no caller passes `journeyState`'s `plan` or `scriptedOnlyProblem`'s `changeSetsDir` (grep of src, test and scripts);
  - that the cited 409 test posts to a project still at the brief (R test/web.test.ts:963-972);
  - that the two images carry no Compose label (R manager.ts:978);
  - that the broken banner fits the camera's line (187 and 158 characters, counted);
  - that port 4022 appears nowhere in builder/ or docs/ outside this file;
  - that no known gap yet covers the quality check after a step, the retry or the broken copy (grep of KG).
- **Assumed (I), to be shown by tests or the run (M):**
  - that the clean stop finishes within 120 s for a mid-step project;
  - that tsx's wrapper lets it run (path T);
  - that 4,000 ms a write puts the signal between step 2's first and last write;
  - that PostgreSQL frees the lock within 30 s of a SIGKILL;
  - that step 3's reservation is $1.1664;
  - that, without 3.6's refusal, the live app would be offered for a broken copy (test A7's control shows it);
  - that Ctrl-C to the process group can record a step as failed (not tried).

## 12. For the owner

- **One question** (it changes what he sees, beyond what the plan names): *Where should the broken-copy demonstration live?*
  - **(a) A button always on your Projects screen, clearly labelled (recommended).** You can press it yourself, whenever you like, and watch the checklist fail. A mistaken press makes only a demonstration project, which "Close project" removes. It stays in the product until you decide otherwise (gap 162).
  - (b) The same button, shown only when a setting is on, as the live preview is. Your product shows nothing new; you see the demonstration in the run's pictures, or on your instance if Claude Code starts it with the setting.
  - *Why (a):* you judge by what you can see working, and nothing here costs money or touches your data. Either way the code is the same, apart from one setting; the build can start on everything else while you decide.
- **Claude Code's choices, each his to overrule** (to be recorded in DEC): the export refused for a broken copy rather than labelled; the choice written in the project's first event, in one transaction; sign-off and export refused on any trace of the broken copy; the clean stop removing containers at the stop; the pause setting for the demonstration, at 4,000 ms in the run; the waits of 30 s, 5 s and 90 s; sign-off no longer offered on an interrupted project; "Failed at step" in a failed item's row; the banner line from the app camera; following J3's precedent (a progress row only) in the build plan.
- **One thing he should know, not decide:** from J2 on, stopping his interface on purpose removes his open projects' containers at the stop. This is gap 139's remedy, planned in J1's design (R J1D:35). Those projects end interrupted either way.

## 13. Changes after the two critiques (13 Nov 2026)

Two independent critics read the draft; one found it sound, the other asked for three changes. All three were made; none was refused.
- **The event kind** in T4 is `journey.workspace.reset` (R journey.ts:62), not `journey.workspace_reset`, so the check can fail.
- **"Nothing left" is matched by N** (section 2): names by prefix, the Compose label, and the two images by name, which carry no label (R manager.ts:978). It was "exact Compose name", which no container, volume, network or image has.
- **A new test, A1b, with its control**, shows a confirmed normal project refusing step 03 by the plan check. The test cited before (R test/web.test.ts:963-972) gets its 409 from the brief rule (R journey.ts:328, :838) and is no longer cited for this.

From the critics' other points, each taken:
- the scope choice put to the owner as a multiple choice (section 12);
- the badge and name no longer say "simulated", since the rejection is real;
- "no quality check after a step yet" instead of "nothing checks a step";
- path T described as a stop request, not as Ctrl-C, and Ctrl-C named as not shown (I);
- the banner checked by the run, through the app camera's lines;
- the failure file checked for "Approved", as run D does;
- the choice written in the project's first event, in one transaction, with the fixed name refused on the normal form;
- one source for the plan, the two unused parameters removed;
- refusals on any trace of the broken copy;
- stand-in sandboxes with change-set folders of their own, and a target check before staging;
- regression guards marked as such;
- the missing controls added;
- the stop waiting on each project's chain of actions;
- the lock check and the whole stop bounded;
- exit code 1 when a project is left;
- sign-off refused once interrupted;
- the camera walks ending before each signal, with the pause raised to 4,000 ms to leave room;
- the `docker build` that can outlive the stop, added to gap 165;
- staging once per build job, its SHA-256 read from the staged copy;
- a BP progress row only, as for J3;
- J1's language rule named as adapted;
- the cost note for a step stopped part-way;
- "Failed at step" listed as a change to the normal path;
- the citations corrected (R test/acceptance-live.test.ts:201, :187-208; src/web/pages.ts:863; the 40-line script; repository-root paths in the Keys; the preview's 29 s from J1EV).

### Changes during the build: part (a), 14 Nov 2026

Built at `6b7d877` (tests first at `d3603ba`). The owner answered section 12's question on 14 Nov 2026: "Always on Projects (Recommended)", option (a). So no setting was added; the panel and its route are shown as one function decides, `brokenCopyDemoShown` (R builder/src/orchestrator/journey.ts:74; read at src/web/app.ts:261 and src/web/pages.ts:283), and showing them only under a setting would change that function alone. Where the build departs from sections 3, 5 and 6, the departure is the smallest found:
- **The name refused on the New project form ignores case and spacing.** Section 3.1 says a name that "starts 'Deliberately broken copy'". The check folds runs of white space and compares in lower case (R journey.ts:802), so "deliberately  Broken copy" is refused too. Reason: a name that differs only so would carry the demonstration's name without its badge. It only widens a refusal.
- **`EXAMPLE_1_ASK` now lives in journey.ts; pages.ts re-exports it.** The demonstration's brief is the text the form prefills (section 3.1), and journey.ts cannot import pages.ts, which imports journey.ts (R src/web/pages.ts:20 at `14787d8`). The value is unchanged.
- **Staging is decided by one check on every build job.** `brokenStageRefusal` (R journey.ts:122) runs for each build job, on the state it started from: null only for step 03 of a project whose first event holds the choice, with steps 1 and 2 approved; the job then stages. For step 03 without that, the job refuses; for any other step it stages nothing (R journey-jobs.ts:325-327). This is section 3.3's rule; written so, removing the check stages for every step, so A1 fails as well as A4, as the controls table says.
- **The job's own check is tested with a changed state.** The journey's rules refuse step 03 before the job starts (`buildStepRefusal`, and a plan from the record), so the check inside the job cannot be reached through the routes. Test A4 ("the job checks the state again") gives the job's body a state without the choice, or without step 2's approval, through a wrapper around `startJob` (R test/journey.test.ts, `make`), and shows the refusal with nothing staged.
- **A1b also covers a `broken_copy` written by hand on a later event.** Without it, the control "the choice honoured on any event" could not fail A1b, as the controls table says it must.
- **Step 3's sentence is shown on its build panel too,** not only on the plan (section 3.4 names the plan).
- **The app camera folds the banner's white space** to single spaces before the 200-character cut (R builder/camera/app-shots.mjs:50). The banner is one line of text; this keeps the record's line on one line.
- **Sign-off on an interrupted project is refused before the checklist's own reasons,** with its own sentence (R journey.ts:585), as `startJob` looks at `interrupted` before its rules (R journey.ts:837 at `14787d8`). Section 3.5 does not fix the order.
- **The stand-in sandbox has two test-only switches**, `changeSetsOutside` (a change-set folder outside its own, for A4's target check) and `stageTamper` (a staged manifest changed after the copy, for A4's read-back). Section 5 names only its own folder, its staging and its failed mode.
- **A1, a regression guard, reads the new state field as "not true"** (`brokenTrace` does not exist at `14787d8`), so that it passes there too, as section 6 says it must.
- **The "before" run also puts builder/camera back as at `14787d8`,** not only builder/src (section 6). A8b reads the app camera's script, which is outside src; with src alone put back it passed before the change. With both: 20 of the 22 new tests fail, and the two regression guards, A1 and A1b, pass; after the change, 22 of 22 pass (evidence/2026-11-13-journey-j2/new-tests-a-before-and-after.txt).

### Changes during the build: part (c), 14 Nov 2026

Built on branch `claude/j2-broken-and-restart` after part (a) (tests first, then the change; the commits are listed in the report). Built: `stopOnSignal` and the second signal (R builder/src/web/main.ts), the stop's removal (`removeAtStop`, R src/orchestrator/journey.ts), the demonstration pause (R src/web/main.ts, src/orchestrator/journey-jobs.ts), the second interrupted wording and the cost note (R src/web/pages.ts), and the run's pure checks (R builder/scripts/journey-restart-checks.ts). Sign-off refused once a project is interrupted was already built in part (a) (R journey.ts, `signOffRefusal`; tests A9). The automated run (`scripts/demo-journey-j2.ts`) and its camera walks are not part of this build. Where the build departs from sections 4 to 6, the departure is the smallest found:
- **The stop's removal is its own method, `removeAtStop`, on `recoverInterrupted`'s loop.** Section 4.1, item 5, gives `recoverInterrupted` one option. The loop is now a private `removeLeft(at, …)`, run at "start" by `recoverInterrupted` and at "stop" by `removeAtStop`; only the reason written, the wait on each project's chain and the ask before each removal differ. Reason: `recoverInterrupted` returns the list of projects touched, which main.ts prints at start and existing tests read (R test/web.test.ts:1058; test/journey.test.ts:239, :803, :830); the stop also needs what was left, and why, and whether the lock ended it. Its signature is unchanged.
- **One wait of 30 s, shared.** Section 4.1, item 3, waits 30 s for the running job and for each project's action in progress. The build waits once: from the halt, every wait (the job, then each project's chain) ends by the same moment, 30 s on. Reason: 30 s for each project could pass the whole stop's 90 s bound with a few projects.
- **The lock is asked before each project that is to be changed**, not before every project (item 4): a closed project, or one with no sandbox and no job left in its record, is read and skipped without asking. Reason: the ask guards a removal; it is made just before one, nothing between it and the removal but the removal's own steps.
- **A job that ends after the wait, but before the removal reaches its project, does not leave it.** Section 4.1, item 3, says a project whose job has not ended in time is not removed. The build skips the project of a job still running when the removal reaches it (R journey.ts, `removeLeft`); a job that ended a moment after the wait has changed nothing since the halt, and its project is removed like any other. The line after the wait says "not removed while the job runs".
- **A removal that fails at the stop leaves its project.** It is recorded `removed: false`, as at start (R journey.ts, `removeLeft`), the project is named as left and the exit code is 1. Section 4.1 does not say how a failed removal counts.
- **The second signal and the 503 hook are exported.** `stopSignalHandler` (the first signal starts the stop, a second exits at once with 1) is what main.ts installs on both signals; the flag and the hook are `StopFlag` and `unavailableReason`. Reason: C4b and C9 test main.ts's own code without a process, as section 6 asks; without them the tests would test a copy.
- **After the last bound, or a second signal, the loop stops before the next project;** a removal already under way is not cut. In the process, the exit ends it at once; in the tests, whose exit is a stub, nothing more is removed after it (C11).
- **The stop's lines are written to standard output,** as the start line is; the lines of a lost lock stay on standard error, as before. The last line names the exit code.
- **The cost note marks the reservations opened by the step's last build job, when that job was interrupted** (between its start and its interrupted end, R pages.ts, `holdsStoppedPartWay`), not every reservation of that step. Reason: an earlier attempt of the step that failed has a reservation of its own, closed at a normal end.
- **The pause is recorded first in the build job,** before the disk check, with its label: "Demonstration setting: the scripted engine pauses before each write, so that a stop part-way can be shown. Every step is slower." The build screen's line is shown as a warning (`class="warn"`). The setting is written plainly: "0" to "10000", no sign, no leading zero, no space.
- **The tests.** Every C test that makes projects (C1 to C5, C4b, C6's screen part, C7, C9, C10, C11) runs on a database of its own, made and dropped by the test, because the stop reads every journey project of its database. C10 tests the journey's part (`removeAtStop` on a halted journey) directly. C5 also starts the interface through the tsx wrapper, as `npm run web` does, and sends SIGINT to the wrapper's process alone; and it checks the pause line at start. C7 makes the crash's record as a crash leaves it (a build job left started, its reservation open), then runs `recoverInterrupted`. The stand-in sandbox records each engine command, so that C6 can show `--delay-ms` passed or not.
- **C8's file holds more than N:** parsers for Docker's and `ps`'s lines, and the record checks of T1 and K1, T4 and K3. It imports nothing from src/, so it passes at `14787d8` too, as section 6 says of C8.
- **Not done here:** the controls of section 6 for (c), and the automated run. They follow.

### Changes during the build: the automated run, 14 Nov 2026

Built on branch `claude/j2-broken-and-restart` after parts (a) and (c): `scripts/demo-journey-j2.ts`, the camera walks `j2a`, `j2c-run` and `j2c-after` (R builder/camera/builder-shots.mjs, `WALKS`), and the run's record checks of (a) (R scripts/journey-restart-checks.ts, `brokenCopyRecordChecks`). Run for real under the shared lock against real Docker on commit `c81eccb`: 150 of 150 checks passed, 41 screenshots (R evidence/2026-11-13-journey-j2/run-demo.txt, journey-j2.md). No product code was changed. Where the run departs from sections 2 and 7, the departure is the smallest found:
- **The run's record checks of (a) are pure checks in `journey-restart-checks.ts`,** beside N and (c)'s, given a reader for item 1's failure file; a test feeds them a made-up record on which each fault, given alone, is reported by its own check (R test/journey.test.ts, "the automated run's record checks of the broken copy"). Section 5 names that file for N and (c)'s checks only. Reason: the same reason as C8, a check that can be shown to fail.
- **"The project page" of T6 is the screen `GET /projects/<id>` opens:** the build screen, the stage the project was at (R src/web/app.ts, `app.get("/projects/:id")`). So the project page with the interrupted panel and the build screen are one picture per language (`31-t-build-interrupted-*`, `51-k-…`); the checklist screen is opened too, to show no sign-off button there either.
- **The picture of step 2 running is in English only** (`21-t-…`, `41-k-…`); the screens after each restart are in English, Arabic and at 390 px (T6). Reason: each picture before the signal delays it, and the signal must come between step 2's first and last write. Measured: the signal came with 1 of 8 written.
- **`j2c-run` does not sign out:** it ends as soon as its picture is taken, for the same reason; sign-ins live in memory and end with the interface (R src/web/auth.ts:143-151).
- **(c)'s pictures carry their path's letter and numbers of their own** (21; 31 to 34; 41; 51 to 54), because the five walks write into one folder; (a)'s are 01 to 12. The sign-off panel is also photographed on its own (`08-sign-off-en`).
- **Between the stops and the starts, the lists are read in full but only their counts and what N matches are written** (R run-demo.txt, "After …"). Reason: Docker's lists and `ps` on this machine hold other sessions' containers and command lines, which the evidence should not carry.
- **The interface's temporary folder, where its sandboxes are made, is inside the run folder** (`<run folder>/tmp`), so removing the run folder leaves nothing; N still checks each sandbox folder the record names.
- **More is checked than section 2 lists, nothing less:** each walk's own checks (for example the approve buttons' wording, the list row's cap, "nothing but 127.0.0.1:4022 was loaded"), the demonstration setting's line at start, the interface's own last line ("Exit code 0.") at each clean stop, the camera walks' exit codes, and no sign-off or export in the whole run's record.
- **A first run** (commit `5a624d5`) passed 147 of 147, but its script held the shared lock about 95 s after its end (two bounds whose timers were not released), counted one write of P1 in K1's first sample (a log line, not a check), and left processes out of K4's first look. The three were fixed (`2b0da07`, `c81eccb`) and the run repeated; its log is kept (R evidence/2026-11-13-journey-j2/first-run/).
