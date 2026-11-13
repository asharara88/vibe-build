# Build plan: from here to the Stage 1 gate

| | |
| --- | --- |
| File | `docs/BUILD-PLAN.md` |
| Written | 11 November 2026, for the owner, Ahmed Sharara. Fifth version, with the owner's four rounds of amendments of the same day |
| Amended | 12 November 2026, in answer to an independent assistant's review of commit `e0e22e6`, supplied by the owner (the owner's own approval of this amendment is not yet recorded): package 1.2's "Done means" now names the exact proof rows that finish it (B1 to B6). Nothing else in the plan was changed. *Note of 13 Nov 2026:* his approval of this amendment is now recorded, by Claude Code's reading of his answer to question 1 (the next row): question 1, as put to him, said that choosing (a) also accepts proof rows B1 to B6 as rewritten on 12 Nov (B4 split in two; B1, B2, B5 and B6 say more) and package 1.2's narrowing to them, and his answer is read as (a) |
| Amended again | 13 November 2026, by the owner's answer to his question 1 ("apply budget cap as long aswe can change it later", read by Claude Code as option (a), on the condition that the cap and these finish criteria stay changeable later by a recorded decision; `docs/DECISIONS.md`): package 1.2's "Done means" adds proof rows B15 to B19, one for each known limit of the hold that 1.2 handles. No other package's row was changed |
| Amended a third time | 13 November 2026, after package 1.2 was merged and tested (`docs/DECISIONS.md`, 13 Nov). (1) By the owner's answer to his question 13 ("a, add the cap change after 1.2"): package 1.2b, a recorded way to change a project's cap, between 1.2 and 1.3; 1.3 now depends on it. (2) By Claude Code, under section 4 ("Fixing a reviewer's finding"), after the second outside review the owner supplied that day advised "schedule the isolation correction as concrete work", and by known gap 60: package 0.6c, the development profile's network boundary, after 0.6b; package 2.3 now also depends on 0.6c (in section 7.4 and in the alternative path of section 7.5). The owner can change (2). (3) By the owner's answer to question 12, option (a): 3.1 may use stand-in tests to develop the runner, and package 3.2b, the acceptance writer's first model call, comes before 3.3, which now depends on it. (4) By the owner's answer to question 14: 1.2b refuses a lowering below spent plus open holds. No other package's row was changed |
| Starting point | Branch `claude/walking-skeleton` at commit `6fca006`. Its code is an **unapproved starting baseline**: built, partly tested, not accepted by the owner |
| Authority | This is the owner's standing instruction for long-running work. It replaces "do one task, then stop". The hard rules in `CLAUDE.md` and `HANDOVER.md` section 11 are unchanged and win over anything written here |

## 1. What this plan is for

Deliver the builder to the Stage 1 gate in `HANDOVER.md` section 6, working across as many sessions as it takes, without the owner present for most of them.

Three things make that possible:

1. **A queue, not a task.** Section 7 lists every work package in order, with what each one depends on. A session takes the first package it can do and keeps going.
2. **Blocked work is parked, not waited on.** If a package depends on the owner, the question is written down and the session moves to the next package it can do.
3. **Owner questions are gathered at checkpoints** (section 6), so the owner is asked a few times, not every hour.

## 2. What "delivered" means

The ten gate items in `HANDOVER.md` section 6, each marked done with its evidence. Nothing else counts as delivery.

Stage 1 is a single-user prototype of the whole journey. The following stay out of scope and must not be built or claimed: more than one customer on one installation, single sign-on, billing, an install package, deployment on a cloud in the UAE, connections to outside systems, real customer data. What comes after the gate is in `HANDOVER.md` section 15 and is not part of this plan.

Gate item 10 (one prospective buyer has seen it) is the owner's task.

**Three states, never merged into one word.** Every package is tracked as:

- **Built:** the work exists on a branch.
- **Tested:** its "Done means" was run and passed, the evidence file exists, and the reviewer's findings are closed.
- **Accepted:** the owner approved it at a checkpoint and it is in `main`.

Only the owner moves anything to accepted.

## 3. How every session runs

1. Read `docs/STATUS.md` and `docs/QUESTIONS.md`, then the progress table in section 10 of this file.
2. Start the development services (`CLAUDE.md`, Commands).
3. Take the first package in section 7 that is not tested and whose "Depends on" entries are all met.
4. If they are not met, write the exact question for the owner in `docs/QUESTIONS.md` (at most six lines: the options and the recommendation; questions that block work come first), mark the package **parked**, and take the next package whose dependencies are met.
5. Work on a branch of its own, started from the integration branch `claude/stage-1`.
6. When the package's "Done means" has been run and has passed, write the evidence file. Then have it reviewed **by risk** (owner, 13 Nov 2026): **adversarial review** (fresh reviewers, each serious finding challenged by others) only for the gateway and the cap, isolation, acceptance separation and key handling; **one fresh review** for other code; **no review** for documents and records. A reviewer did not write the code and does not see the author's conversation. It is given:
   - the claims, the evidence and the code;
   - the parts of the specification and the design note that apply;
   - the decisions in `docs/DECISIONS.md` that apply;
   - the package's "Done means";
   - every earlier finding on this area that is still open.
7. Fix what the reviewer finds. List every finding in the pull request, including any left open. **At most two review rounds per package.** After the second, findings that are not blocking go to `docs/KNOWN-GAPS.md` and the package merges. Blocking means: it breaks a hard rule, or it leaves a "Done means" unmet.
8. **Narrowing a claim does not finish a package.** If a report said more than the evidence shows, correct the report. If a "Done means" still fails, the package stays built and not tested, or it is parked for the owner's decision on its scope. It is never marked tested by describing it more modestly.
9. Open a pull request into `claude/stage-1`. Merge it only when every required check passes and no open finding breaks a hard rule or leaves a "Done means" unmet, whatever label the reviewer gave it. If the session cannot merge pull requests, start the next package's branch from this one and say so in `docs/STATUS.md`.
10. The package's own pull request updates the records it affects: the progress table, `docs/STATUS.md`, `docs/QUESTIONS.md`, `docs/KNOWN-GAPS.md` and `docs/DECISIONS.md`. There are no separate record-update pull requests (owner, 13 Nov 2026). Push.
11. Go to step 3.

End the turn only when one of these is true: no package can be done without the owner; a stop condition in section 5 is met; or the session is close to its limit. In every case, write `docs/STATUS.md` first.

**Push after every package and after every passing test run.** A cloud session can end without notice, and nothing outside the repository carries over.

**Set-up for the first session under this plan.**

1. Create `claude/stage-1` from `claude/walking-skeleton`.
2. Close pull request #2 as superseded, with a link to this plan. Do not point it at the new branch, where it would show no difference.
3. Save the owner's review of that pull request as `docs/reviews/2026-11-11-pull-request-2.md`, one finding per row, each linked to the package in section 7 that answers it.
4. Record in `docs/DECISIONS.md` that the code on the branch is an unapproved starting baseline.
5. Add one line to `CLAUDE.md` under "Every session": "Then follow `docs/BUILD-PLAN.md`, section 3."

The `main` branch is changed only by the owner.

## 4. Who decides what

**Decide without the owner, and record it in `docs/DECISIONS.md`:**

- How something is built, inside the approved design note.
- A new dependency whose licence is on the permitted list, recorded in `docs/SOURCES.md`.
- How a check is designed, and adding checks.
- Splitting a package into smaller ones, keeping its dependencies.
- The wording of screens and messages, in English and Arabic.
- Fixing a reviewer's finding.

**Already decided by this plan.** The owner's approval of this plan approves the five amendments to design note 5.5 listed in package 1.1. Record them in `docs/DECISIONS.md` with this plan as the source. Do not ask again.

**Always the owner. Park the package and ask:**

- Any paid service, sign-up or upgrade (hard rule 4). Show the price and its source.
- Any licence outside the permitted list (hard rule 2).
- Changing anything recorded in `docs/DECISIONS.md`, or any of decisions A to F in the design note.
- Any call to a real model before checkpoint 1.
- The scope of a package whose "Done means" cannot be met.
- Anything that changes `main`, the repository's settings or visibility, or the session's network list.
- The pass target for the test protocol.
- Removing or relaxing a check. If a check is wrong, say why and propose the change. Do not make it (hard rule 8).
- Any statement that something is secure, ready, reviewed or compliant (hard rule 6).

Questions to the owner stay one at a time, multiple choice, with a recommendation and its reason.

## 5. When to stop, and when only to park

**Stop the whole run and write `docs/STATUS.md`:**

- A key, password or token has appeared in the repository, a log, a screenshot or the conversation.
- With the real model key in use: a cap check fails, a call costs more than its hold, or the gateway's recorded spend disagrees with the provider's own usage figures.
- The plan seems to require breaking a hard rule.
- Material from another vendor's product that is not public has been encountered.

**Park the package and continue with others:**

- The same check still fails after three different approaches. Record what was tried and what was seen. Do not weaken the check.
- A fact a safeguard depends on cannot be confirmed from its source. Mark it as an assumption and do not build the safeguard on it.
- The projected model spend for a package is more than the room left under the monthly limit.

## 6. Checkpoints with the owner

At a checkpoint the session writes a one-page pack in `docs/checkpoints/` with the evidence and the questions. **It does not stop while other packages can still be done.** A checkpoint is also where the owner accepts tested work into `main`.

| Checkpoint | Comes after | The owner is shown | The owner decides |
| --- | --- | --- | --- |
| **0. Pre-flight** | Now | Section 11 | The items in section 11, part one |
| **1. Safeguards shown** | Phases 0 and 1, except 0.6b | Each budget failure test with its result; what the isolation checks did and did not show; the role guard refusing each wrong role | The spending limits, and whether to create the model key. **No call to a real model is made before this** |
| **2. Skeleton report** | Phase 3 | Example 1 built from a fixed brief, running, one acceptance check passing, the key shown absent from the container, the cap stopping a build, the export running alone, the measured cost | The stack, from the comparison or from a recorded waiver; the model; **the demo candidate**. The owner's reviewing engineer reads the gateway and the sandbox manager here (decision of 11 Nov 2026) |
| **3. Before the test protocol** | Milestone 6 | The ten answer sheets; a trial run of two examples; the projected cost of the full protocol, worked out from the measured cost of one build | The pass target; whether the cost is acceptable; the second provider's account for milestone 7b |
| **4. Before the demo** | Milestones 7 and 7b, and the candidate's gate runs | The protocol report; the candidate's three runs and two changes; the demo script | The demo server, if not already chosen; the engineer's second review |

## 7. The work queue

### 7.1 What "Depends on" means

A package starts only when everything in its "Depends on" column is true. Other packages are listed by their ID and must be **tested**. The short codes are:

| Code | True when |
| --- | --- |
| **L9** | Each of `lightningcss`, `lightningcss-linux-x64-gnu`, `spdx-exceptions` and `spdx-ranges` is either approved by its exact name in `docs/DECISIONS.md` or removed or replaced, **and** the licence check passes for `builder/` |
| **L11** | `caniuse-lite` is either approved by its exact name in `docs/DECISIONS.md` or removed or replaced, **and** the licence check passes for `templates/next/` |
| **L10** | `psycopg` is approved by its exact name in `docs/DECISIONS.md` for the second stack |
| **Waiver** | The owner has recorded in `docs/DECISIONS.md` that no stack comparison will be made, and which stack stands |
| **Key** | Checkpoint 1 has passed and the owner has set the model key |
| **Stack** | The owner has chosen the stack for generated apps: at checkpoint 2 from package 3.4, or at any earlier moment by recording a waiver |
| **Candidate** | The owner has chosen the demo candidate |
| **Server** | The owner has approved a demo server and it exists |

**Licences.** No code merges while the licence check is red for the component it touches. A decline is not an approval: if the owner declines a package, the code is true only once that package is gone and the check passes. Each code applies only to what it affects: L9 to `builder/`, L11 to the first stack's template in `templates/next/`, L10 to the second stack's template. The packages that can be finished before any of these are the document-only ones: 0.1, 0.2, 1.1 and W4.

**Replacing instead of approving.** Where the owner chose replacement, package R1 does it. R1 is the one code package that may be built while a licence code is still false, because it is what makes the code true. It merges only once the licence check passes for the component it touches.

**If the first stack is ruled out.** If the owner declines L11 and the package cannot be removed, the first stack cannot be used. Section 7.5 gives the path on which the second stack completes the skeleton alone. If L10 is not true either, no stack is available: park and ask the owner.

**Before the stack is decided.** Work under `builder/` is shared and goes ahead. The existing template is a **comparison prototype**: corrections to it are allowed (0.3, 0.5), new product work on it is not. Nothing built on it counts toward milestone 1 until "Stack" is true.

### 7.2 Phase 0: corrections from the owner's review of pull request #2

| ID | Package | Depends on | Done means |
| --- | --- | --- | --- |
| R1 | **Licence replacement, only where the owner chose it.** Remove or replace the named packages and change only what directly uses them. Nothing else is touched | The owner's choice of replacement for the named packages. No licence code | The named packages no longer appear in the component's dependency list. The licence check under the single rule of 0.4 passes for that component. The component's existing tests pass with the replacement |
| 0.1 | **`docs/STATUS.md` rewritten** as one current state. Older entries moved to `docs/log/` | Nothing | No statement in it contradicts another. Under about 120 lines |
| 0.2 | **Evidence claims narrowed.** The second skeleton evidence file says what was run and from where | Nothing | Its title and text claim only that requests sent through the proxy were filtered. It states that the server profile was checked as a configuration file and not run |
| 0.3 | **The role guard stops an unauthorised request itself.** It returns only a permitted user. A wrong role gets a plain "no access" page in both languages. An unrecognised role is refused, not treated as the lowest role. The same guard covers form actions and data routes, not only pages | L11 | A restricted example page with a test for each role. A check that fails the build when a page, action or route has no guard. The existing home page uses the guard the new way |
| 0.4 | **One licence rule for every dependency,** shipped or development: the permitted list, plus packages named one by one in `docs/DECISIONS.md` | L9, L11 | The check passes with no package outside that rule, and fails when a test package outside it is added |
| 0.5 | **App set-up runs in a tools container.** Creating tables and sample users never runs on the machine that hosts the builder. A container receives a named list of settings, never the host's whole environment | L9, L11 | A test whose seed script prints its environment shows none of the builder's own settings. Known gap 29 closed |
| 0.6a | **Isolation checked on the development profile, from inside the workload container:** attempts to connect without the proxy, by address, on other ports, and by name lookup | 0.5 | Each attempt and its result listed. Because this profile shares the host's network, the report says plainly what is not isolated. The server profile is described as "designed, not shown" |
| 0.6b | **The same checks on the server profile,** run on a real server | 0.6a, Server | **Outbound traffic to the outside:** every attempt from inside the app container and the engine container fails, except through the proxy to an allowed host. **Connections inside the project:** the design note lists the ones each container needs, such as the app reaching its own database. Each listed connection is shown to work, and for each container at least one connection not on the list is shown to fail. All results listed. Required before M8, not before checkpoint 1 |
| 0.6c | **The development profile's network boundary:** every project container that will run code a model wrote (the app and tools containers, package 3.1's runner, package 2.2's engine) reaches only what design note 2.5 allows it: its project's database where allowed, and the egress proxy, and through it the gateway and the package registry; nothing else on the machine. *Added 13 Nov 2026 by Claude Code (section 4, "Fixing a reviewer's finding"; known gap 60); `docs/DECISIONS.md`* | 0.6a; question 11 (a) (approved 13 Nov 2026); its design read by an engineer or put to the owner before it is built (how it is done changes design note 2.5: `docs/STATUS.md`, item (xiii)) | 0.6a's probe, run in each of those containers on the development profile, shows each reaching only what 2.5 allows, with every attempt and result listed; a deliberately misconfigured container is shown failing the check |

### 7.3 Phase 1: the budget cap rebuilt to the holds design (a stand-in provider)

| ID | Package | Depends on | Done means |
| --- | --- | --- | --- |
| 1.1 | **Design note 5.5 amended** in five places: (a) a call cut off part-way keeps its full hold and is marked unreconciled, because the output count arrives late in the stream; (b) if the prompt cannot be counted, the call is refused, with no estimate from its size; (c) the hold allows for fast mode and the long-prompt rate when either could apply; (d) a successful answer that cannot be read keeps its full hold; (e) if a finished call cannot be saved, its hold stays open and the project makes no further calls until it is reconciled | Nothing | The amendments are in the note under a dated list, and the proof table in 7.2 has a row for each |
| 1.2 | **Holds stored in the database** under a lock on the project's row: open, settle, expire, and recovery when the gateway starts | 1.1, L9 | Proof rows **B1 to B6 and B15 to B19** of design note 7.2, and only those, each shown from the event log against a stand-in provider. B15 to B19 are one row for each known limit of the hold that 1.2 handles (known gap 41); the row for the margin, B16, shows only that a margin is applied, because whether it is large enough needs a real provider (2.3). Rows B7 (package 1.3), B8 to B13 (1.4) and B14 (1.5) are not part of 1.2. *Amended 13 Nov 2026 by the owner's answer to question 1, as Claude Code reads it (it read "Proof rows B1 to B6 of design note 7.2, and only those"); `docs/DECISIONS.md`* |
| 1.2b | **A recorded way to change a project's cap:** one store function that changes the cap under the project's lock and writes a `cap.changed` event (old and new figures, who asked, who ran it, why, when), run by Claude Code or an engineer when the owner asks; no screen. A cap lowered below spent plus open holds is refused, with nothing changed or written, and the lowest figure allowed is named (the owner's answer to question 14: "a, refuse lowering below spent plus holds"). *Added 13 Nov 2026 by the owner's answer to question 13 ("a, add the cap change after 1.2"); `docs/DECISIONS.md`* | 1.2 | Shown by tests against the database, each failing with its safeguard removed: a change recorded with its event; a lowering to exactly spent plus open holds accepted and the next call refused; a lowering below it refused with nothing written; a raise letting a refused call through; a change and an admission serialised by the lock; invalid figures and an unknown project refused with nothing written |
| 1.3 | **The pre-step check** and the step hold | 1.2, 1.2b | A step refused before it starts when its budget does not fit, with the message shown |
| 1.4 | **Failure tests:** several calls at once against room for one; the gateway killed mid-call; the database refusing a write after the provider answered; a stream cut after output began; an unreadable answer | 1.2, 1.3 | Each passes, and in every one **both** of these hold at every moment: (1) recorded spend plus open holds is never above the approved cap; (2) recorded spend plus open holds is never below what the provider was owed. No settled call costs more than its hold |
| 1.5 | **The unreconciled list.** Holds kept at full value are listed for the owner. A hold is closed only by a recorded owner action that states the actual cost and the evidence for it, such as the provider's usage record. The actual cost is then what is charged | 1.2 | The list shown with one example of each kind, and one reconciliation recorded with its evidence |

→ **Checkpoint 1.**

### 7.4 Phase 2: the engine behind its interface

| ID | Package | Depends on | Done means |
| --- | --- | --- | --- |
| 2.1 | **A scripted engine** behind the build-engine interface: it makes fixed, known changes and calls no model | L9 | Later packages can exercise their own behaviour with no spend. Anything produced by it is labelled "scripted" wherever it appears |
| 2.2 | **The Claude Agent SDK adapter** in its container: allowed and denied actions, a turn limit, the logging hook, a project token and no key. Known gap 18 (the step label) settled or replaced | 2.1, 1.2 | Run against the stand-in provider. The container's settings and files listed, showing no key. Marked as shown against a stand-in only |
| 2.3 | **Two fixed steps of example 1 with a real model** | 2.2, 1.4, 0.5, 0.6a, 0.6c, Key, L11 | The gateway's usage rows match the usage the SDK reports, call by call. This is the first evidence of real-provider and real-engine behaviour |

### 7.5 Phase 3: acceptance, export, and the skeleton report

| ID | Package | Depends on | Done means |
| --- | --- | --- | --- |
| 3.1 | **Acceptance store and runner** to the corrected design (2.7). *Since 13 Nov 2026 (the owner's answer to question 12, option (a)):* tests written in advance by Claude Code, labelled "stand-in test" everywhere, may be used to develop and test the runner only; they show the tests kept apart from the engine, not independent acceptance | 2.1 | All four are shown. (1) A real acceptance run against an app built by the scripted engine passes, with its screenshot. (2) A deliberately broken copy of that app is rejected, with the failed item named. (3) A run that did not execute is reported as not run, never as passed. (4) From inside the engine container, attempts to reach the acceptance store by file path, over the network, through the project's database and through the project's history all fail, each listed with its result; the container's mounts, listed, show no acceptance folder |
| 3.2 | **Exporter** | 3.1, L11 | The app starts from the export with the builder stopped, and the check passes from the exported copy |
| S1a | **Second stack, preparation, only if L10 is true:** a comparison prototype of the second template to the same level as the first (sign-in, three roles, the role guard of 0.3, both languages, set-up in a tools container). No model is called, so this can come before checkpoint 1 | L10 | The second template runs in the sandbox with its own licence check passing, a test for each role, and screenshots in both languages |
| S1b | **Second stack, live runs:** the same two fixed steps of example 1 with a real model, the same acceptance check and the same export | S1a, 2.3, 3.1, 3.2, Key | The evidence of 0.6a, 2.3, 3.1 and 3.2 repeated for the second stack, from live runs |
| 3.2b | **The acceptance writer's first model call.** The acceptance check for example 1's skeleton is written by the acceptance writer through a real model call, not by the engine or by Claude Code, stored by 3.1's store and run by 3.1's runner. *Added 13 Nov 2026 by the owner's answer to question 12, option (a)* | 3.1, 2.3 | The check is written by one real model call, stored, run against the app built in 2.3, and its result reported; the record shows that neither the engine nor Claude Code wrote or edited it |
| 3.3 | **Skeleton report** | 2.3, 3.1, 3.2, 3.2b, and S1b or Waiver | One page per stack built, with cost per step for each model tried, all from live runs |
| 3.4 | **Stack decision pack** | 3.3 | Either both stacks side by side on acceptance result, rule compliance and cost; or, under a waiver, a plain statement that the first stack stands and that no comparison was made |

**When S1a and S1b are waived.** Only when the owner chooses the first stack without a comparison. They are then marked "not applicable: waived" with the decision's date. A waiver naming the second stack does not waive them: it makes them the main path, as follows.

**Alternative path: the second stack alone.** This applies when the first stack is ruled out, L10 is true, and the owner has recorded a waiver naming the second stack. Then:

- S1a comes first and waits for nothing done on the first stack.
- Packages 0.3, 0.4, 0.5, 2.3, 3.1 and 3.2 are done on the second template, with L10 read wherever L11 is written. Package 0.4 checks only the components that are kept.
- Package 2.3 keeps every other dependency it has: Key, 1.4, 0.6a, 0.6c and 2.2. No live run comes before checkpoint 1 on this path either.
- The live results of 2.3, 3.1 and 3.2 on the second template are S1b's evidence. S1b is not run a second time.
- 3.3 reports one stack. 3.4 states that no comparison was made and why.
- The first template is removed, or kept and marked as not used. Record which in `docs/DECISIONS.md`.

→ **Checkpoint 2.**

### 7.6 Phase 4: the milestones in design note section 8

Each is described there. This table adds dependencies and the demo candidate's gate runs.

| ID | Milestone | Depends on | Done means |
| --- | --- | --- | --- |
| M1 | House template on the chosen stack, and the quality gate | Stack, 0.3, 0.4 | Design note section 8, milestone 1; each of the ten rules in specification part B3 has an automated check, shown passing and shown failing on a deliberate breach |
| M2 | Intake: analyst, question bank, spreadsheet upload, app spec | W1, W3, Key | Design note section 8, milestone 2; specification parts B1 and B2 |
| M3 | Plan and step-by-step build in the builder's web interface | M1, M2 | Design note section 8, milestone 3 |
| M4 | Independent acceptance, full checklist | M3, 3.1 | Design note section 8, milestone 4, and section 2.7 |
| C1 | **Demo candidate, first gate runs.** Its cost is projected from one build and shown to the owner first | M4, Candidate | Gate item 3: every acceptance item passes in three runs out of three, each run's result and cost recorded |
| M5 | Changes | M4 | Design note section 8, milestone 5 |
| C2 | **Demo candidate, changes** | M5, C1 | Gate item 4: two change requests applied after the first build, and the full acceptance test passes again after each |
| M6 | Record, cost and export in full | M5 | Design note section 8, milestone 6; gate item 6. Gate item 5 is met only on a clean machine: if a fresh container stood in for one, the evidence says so and gate item 5 stays open until "Server" is true |
| | → **Checkpoint 3** | | |
| M7 | Test protocol. The harness does one build per run and commits each result, so a session ending loses one build at most | M6, W2, the owner's pass target | Design note section 8, milestone 7; specification part B5; gate items 1 and 2 |
| M7b | Second engine, two examples | M7, the owner's yes to the second provider's account and price | Design note section 8, milestone 7b; gate item 9 |
| | → **Checkpoint 4** | | |
| M8 | Demo | C2, M7, 0.6b, Server | Design note section 8, milestone 8; gate item 7 |
| M9 | Gate review | Everything above | Design note section 8, milestone 9; gate items 1 to 9 each marked with its evidence; gate item 8 |

### 7.7 Shared work that can fill a wait

| ID | Package | Depends on | Done means |
| --- | --- | --- | --- |
| W1 | The builder's own web interface shell: sign-in for the single user, the project list, the record view. This is the builder, not a generated app, so it does not wait for "Stack" | L9 | An automated browser run signs in, sees the project list with one scripted project, opens its record and sees its events in order. A visitor who is not signed in gets only the sign-in page. Screenshots kept |
| W2 | The test harness, driven by the scripted engine | 2.1 | Two examples run end to end, one build per run, each result committed. Stopped part-way and started again, it resumes without repeating a finished build. Every result labelled "scripted" |
| W3 | The analyst's and optimiser's instructions, kept as versioned files, and their tests against a stand-in provider replaying fixed answers | L9 | For example 1, the intake produces an app spec that passes the app-spec check; every question asked is in the question bank (specification part B2); the brief carries a "Later" list. Marked as shown against a stand-in only |
| W4 | An Arabic wording list for the owner to read. A document only | Nothing | The list is in `docs/`, with every message in the existing template shown in English beside its Arabic, and a recorded count showing no message is missing from either language |

## 8. Rules that keep long runs honest

1. A package is **tested** only when its "Done means" was run, passed, and has an evidence file. Until then it is **built** or **parked**. It is **accepted** only by the owner.
2. Every safeguard is described with one of three words: **shown** (run, with evidence), **designed** (written, not run), or **not done**. No other wording.
3. **Stand-in results count only for the behaviour actually exercised.** A stand-in provider can show how the gateway handles a failure. It cannot show that the real provider behaves that way. Any claim about the real provider or a real engine needs live evidence of its own, and every report says which kind each result is.
4. A red check stays red and is reported as red.
5. Correcting an overstated report is required. It never turns an unmet "Done means" into a met one (section 3, step 8).
6. `docs/STATUS.md` is rewritten each session, not added to, and is **at most 400 words**: the state in five lines, what is next, what blocks it, and money. No glossary and no history: it links to detail (owner, 13 Nov 2026).
7. After any work with a real model, `docs/STATUS.md` shows the month's spend from the gateway next to the monthly limit.
8. A tested package is reopened when a later package requires a change to it, when a defect is found in it, or when new evidence puts its result in doubt. Reopening sets it back to built and records why. Its evidence is run again before it is tested again, and the packages that depend on it are checked.
9. A change to the design goes into the design note in the same pull request, under a dated list of amendments.
10. Evidence says what was run, on which profile, from which machine or container.
11. **Questions for the owner** are in `docs/QUESTIONS.md`, at most six lines each, with the options and the recommendation; questions that block work come first. Everything "yours to confirm" is one list of one-line items there (owner, 13 Nov 2026).
12. **Review by risk, at most two rounds** (section 3, steps 6 and 7; owner, 13 Nov 2026).
13. **No separate record-update pull requests:** each package's pull request updates the records it affects (section 3, step 10; owner, 13 Nov 2026).
14. **Older records are not rewritten to match rules 6 and 11 to 13.** They apply from 13 November 2026 on (owner, 13 Nov 2026).

## 9. Money

There are two meters, and this plan controls only the second.

1. **The owner's Claude plan.** The sessions doing this work draw on it. Nothing here limits that.
2. **The model key the builder's engine uses.** The monthly limit set in the provider's console is the outer wall. The gateway's cap per project sits inside it. The figures proposed on 11 Nov 2026 are $100 a month and $20 a project; the owner confirms or changes them at checkpoint 1.

No package that runs many builds starts until its cost has been projected from the measured cost of one build and shown to the owner (C1, and checkpoint 3 for M7).

## 10. Progress

Update this table at the end of every package. A date goes in a column only when that state was reached.

| ID | Built | Tested | Accepted by the owner | Pull request | Evidence | Open findings |
| --- | --- | --- | --- | --- | --- | --- |
| Skeleton increments 1, 2, 3a (unapproved starting baseline) | 11 Nov 2026 | In part: 38 tests, run again and passing on 12 Nov 2026 (`evidence/2026-11-12-baseline-tests/run.txt`) | No | #2, closed as superseded 11 Nov 2026 | `evidence/2026-11-11-skeleton-1` to `-3` | Seventeen owner findings in `docs/reviews/2026-11-11-pull-request-2.md`: twelve open, five closed (P-1 and P-2, both about documents; P-4, the licence check; P-3, the template's role guard; P-5, set-up in a tools container, on the development profile only) |
| R1 Remove `sharp` from the TypeScript template (chosen by the owner 12 Nov 2026) | 12 Nov 2026 | | No | #10, merged into `claude/stage-1` on 12 Nov 2026 at `dccfc75` | `evidence/2026-11-12-package-r1/remove-sharp.md` | None blocking at the merge. Not marked tested: "passes under the single rule of 0.4" is shown since 0.4 was merged, and its third condition is offered as a type check, build and demonstration run because the template had no tests when R1 was built, which is the owner's to accept. The last review's non-blocking findings are answered in the record update after the merge |
| 0.1 `docs/STATUS.md` rewritten | 11 Nov 2026; rewritten again 12 Nov 2026 | 12 Nov 2026, at commit `492370c` (reopened earlier that day; the mark of 11 Nov did not stand) | No | #3, then #7, both merged into `claude/stage-1` | `docs/reviews/2026-11-12-integration-e0e22e6.md` | None blocking. Nine non-blocking findings from the last review, answered in the record update after the merge |
| 0.2 Evidence claims narrowed | 11 Nov 2026 | 11 Nov 2026; merged text re-read 12 Nov, no finding | No | #4, merged into `claude/stage-1` | `evidence/2026-11-11-skeleton-2/sandbox-egress.md` | None |
| 0.4 One licence rule for every dependency, in `builder/` and `templates/next/` | 12 Nov 2026 | 12 Nov 2026, at commit `fb93640` | No | #9, merged into `claude/stage-1` on 12 Nov 2026 at `fb93640` | `evidence/2026-11-12-package-0.4/licence-rule.md` | None blocking. What the check does not look at is listed in the evidence file; three wording suggestions from the last re-read are answered in the record update after the merge |
| 0.3 The role guard stops an unauthorised request itself | 12 Nov 2026 | 12 Nov 2026, at commit `7b955d5` | No | #15, merged into `claude/stage-1` on 12 Nov 2026 at `7b955d5` | `evidence/2026-11-12-package-0.3/role-guard.md` | None blocking. What the build check does not read is listed in the evidence file; the last review's six non-blocking points are answered in the record update after the merge or recorded in known gap 48 |
| 0.5 App set-up runs in a tools container | 12 Nov 2026 | 12 Nov 2026, at commit `0b39e4d`, on the development profile only; reopened the same day for one defect found after the mark (a test that failed where `DOCKER_HOST` is set), fixed in pull request #19; tested again 12 Nov 2026, at commit `e8dccc1`, the commit #19's last re-reader and the review bot read | No | #17, merged into `claude/stage-1` on 12 Nov 2026 at `0b39e4d` (merge commit `2bfc8fb`); then #19 (the follow-up and the fix), merged on 12 Nov 2026 at `e8dccc1` (merge commit `5c8b01a`) | `evidence/2026-11-12-package-0.5/tools-container.md` | None on its "Done means". Not shown: the server profile, which needs a server (0.6b). The last re-read's points, none blocking, were answered after the merge: code and measurements in commit `df1af8b`, records in the record update, both merged with #19; the three rounds of review, and the points left as they are, are in `docs/reviews/2026-11-12-package-0.5.md` |
| 0.6a Isolation checked on the development profile | 12 Nov 2026 | 12 Nov 2026, at commit `6295445`, on the development profile only; the commit the last re-reader and the review bot read | No | #22, merged into `claude/stage-1` on 12 Nov 2026 at `6295445` (merge commit `25cd048`) | `evidence/2026-11-12-package-0.6a/isolation-checks.md` | None on its "Done means". What it shows is that the development profile is not isolated (known gaps 1, 2 and 60); gap 60 needs an engineer's judgement before package 2.3's first live run; since 13 Nov 2026 this is read as needing the boundary resolved first (Claude Code's reading, the owner's to confirm: known gap 60; `docs/STATUS.md`, "Yours to confirm", item (xiii)). The server profile is designed, not shown (0.6b); register finding P-6 stays open until 0.6b is tested. The last re-read's three wording notes are answered in the record update after the merge; the review rounds are in `docs/reviews/2026-11-12-package-0.6a.md` |
| 0.6b The same checks on the server profile | Not started. It waits for the server only, since 0.6a was marked tested on 12 Nov 2026 | | | | | |
| 0.6c The development profile's network boundary | 13 Nov 2026, on the branch `claude/pkg-0.6c-network-boundary`, to the owner's choice (a) of 13 Nov (`docs/DECISIONS.md`), after its assumptions were measured (`evidence/2026-11-13-package-0.6c/measurements.md`); the way out is the measurement's option (a′), a door through a Unix socket. *As first written:* not started; its design drafted first, then read by an engineer or put to the owner (the owner chose on 13 Nov; no engineer has read it) | Not yet: its "Done means" ran and passed on the development profile (every project container matched its expected list exactly; both deliberate misconfigurations failed the check), with the whole suite and the controls; one adversarial review, nothing blocking, its notes fixed or recorded (`network-boundary.md`, "After the review"). Tested when its pull request merges with no blocking finding (section 3, step 9) | No | Not opened yet | `evidence/2026-11-13-package-0.6c/network-boundary.md` | Known gaps 118 to 128; gaps 1, 2, 14, 50, 60, 69, 70 and 75 updated. Not shown: the server profile (0.6b), IPv6 (this machine has none), package 2.2's own engine and client. No engineer has read it (question 7) |
| 1.1 Design note 5.5 amended | 11 Nov 2026; corrected 12 Nov 2026 | 12 Nov 2026, at commit `492370c` (reopened earlier that day; the mark of 11 Nov did not stand) | No | #5, then #7, both merged into `claude/stage-1` | `docs/reviews/2026-11-12-integration-e0e22e6.md` | None on its "Done means". Open and recorded: the hold's known limits (gap 41); one question to the owner (expired holds); one point needing an engineer (gap 35) |
| 1.2 Holds stored in the database | 12 Nov 2026 on branch `claude/pkg-1.2-holds`; finished on 13 Nov 2026 to the owner's answer to question 1 ("apply budget cap as long aswe can change it later", read by Claude Code as proof rows B1 to B6 and B15 to B19; `docs/DECISIONS.md`) | 13 Nov 2026, at commit `90484c1`, against a stand-in provider only; the commit the last fresh reader and the review bot read | No | #12, merged into `claude/stage-1` on 13 Nov 2026 at `90484c1` (merge commit `98f280d`) | `evidence/2026-11-12-package-1.2/holds.md` | None on its "Done means": B1 to B6 and B15 to B19 each shown from the event log against a stand-in, B16 only in part (that a margin is applied; whether it is enough needs a real provider, 2.3). The review bot's one finding, on `7ce5a33`, was fixed before the merge (`9dc236d`, control 24). Not shown: the cap limits admission, not the bill (known gaps 41 and 62); a fault stops nothing until 1.4. Register findings C-2, C-6 and C-7 closed against a stand-in only; C-1 and C-3 to C-10 open. The review rounds are in `docs/reviews/2026-11-13-package-1.2.md`; the last reads' notes are answered in the record update after the merge |
| 1.2b A recorded way to change a project's cap | 13 Nov 2026 (the owner's answers to questions 13 and 14) | 13 Nov 2026, at the commit its pull request merges: proof rows B20 to B22 shown against the database and a stand-in, each failing with its safeguard removed; one adversarial review (money; tests) found nothing blocking | No | This pull request | `evidence/2026-11-13-package-1.2b/cap-change.md` | Known gap 66 (review notes, non-blocking); gaps 64 (narrowed) and 65 |
| 1.3 The pre-step check and the step hold | 13 Nov 2026, on the branch `claude/pkg-1.3-step-hold`, to option (a) of the owner's question 16 (proof row B7 in full), before his answer | 13 Nov 2026, at the commit its pull request merges: its "Done means" and B7 ran and passed against the store, the gateway and a stand-in provider and engine, each new test shown failing with its safeguard removed (19 controls); one adversarial review found nothing blocking | No | Not opened yet | `evidence/2026-11-13-package-1.3/step-hold.md` | Known gaps 81 to 86; the review's eight notes, none blocking: gaps 87 to 90 and 85 (extended), gaps 18, 64 and 66 brought up to date |
| 1.4 Failure tests | 13 Nov 2026, on the branch `claude/pkg-1.4-failure-tests`, stacked on 1.3's branch; to its design with every correction of the design's review; known gap 35's proposal built with no engineer's review (B10 rests on an unreviewed design); question 17 built to (b) | 13 Nov 2026, at the commit its pull request merges, after 1.3's: B8 to B13 ran and passed against a stand-in provider, the gateway killed with SIGKILL, and a database made to refuse writes; the invariant checker found no violation in any case; each new test failed with its safeguard removed (27 controls); one adversarial review found nothing blocking; the fixes after it are shown by tests, not reviewed | No | Not opened yet | `evidence/2026-11-13-package-1.4/failure-tests.md` | Known gaps 91 to 97; the review's five notes, none blocking: three fixed with tests, gap 93 extended, figures corrected; gap 35 needs an engineer |
| 1.5 The unreconciled list | 13 Nov 2026, on the branch `claude/pkg-1.5-unreconciled`, stacked on 1.4's branch (pull request #31) | 13 Nov 2026, at the commit its pull request merges, after 1.4's: B14 ran and passed against a stand-in provider, the gateway and the store, each new test failing with its safeguard removed (17 controls); one adversarial review found nothing blocking; the fix after it is shown by a test, not reviewed | No | Not opened yet | `evidence/2026-11-13-package-1.5/unreconciled.md` | Known gaps 99 to 102; the review's ten notes, none blocking: one fixed with a test (C1 control characters in the script's output), gaps 99 to 101 extended, gaps 103 and 104 added; gap 96 closed by it, except gap 100 |
| 2.1 A scripted engine behind the build-engine interface | 12 Nov 2026 | 12 Nov 2026, at commit `4a5248c`, on the development profile | No | #20, merged into `claude/stage-1` on 12 Nov 2026 at `4a5248c` (merge commit `276edc6`) | `evidence/2026-11-12-package-2.1/scripted-engine.md` | None on its "Done means". Its use by later packages (3.1, 3.2, W2) is shown only once they are built. Its known limits are known gaps 50 to 59, most of which matter for package 2.2. Its "Done means" is read as recorded in `docs/DECISIONS.md` (12 Nov), for the owner to confirm. The last re-read's wording notes are answered in the record update after the merge; the five rounds of review are in `docs/reviews/2026-11-12-package-2.1.md` |
| 2.2, 2.3 | Not started. 2.2's dependencies are met since 1.2 was tested on 13 Nov 2026 (2.1 is tested); by the plan's order it comes after 1.2b and 1.3 to 1.5. 2.3 waits for 2.2, 1.4, 0.6c and the key (0.5 and 0.6a are tested). 0.6c was added to its dependencies on 13 Nov 2026 (`docs/DECISIONS.md`): before that, known gap 60 asked for an engineer's judgement before its first live run, and from 13 Nov was read as needing the boundary resolved first (Claude Code's reading, the owner's to confirm: known gap 60; `docs/STATUS.md`, "Yours to confirm", item (xiii)) | | | | | |
| 3.1 Acceptance store and runner | **Built 13 Nov 2026** on branch `claude/pkg-3.1-acceptance`, from `claude/stage-1` at `f6f5007`, after the owner's answers to questions 11 (a), 12 (a) and 15 (a) (`docs/DECISIONS.md`). Its four "Done means" items were each run on the development profile, against example 1's app built by the scripted engine, with a **stand-in test** written in advance by Claude Code (`evidence/2026-11-13-package-3.1/acceptance.md`) | Not yet. One adversarial review (acceptance separation, round 1, at `19d9037`) found one blocking item, two build logs cited as evidence but left out of the branch by `.gitignore`: fixed and tested. The four items were run again after the fixes, at `0b8128b`, with the same results (`evidence/2026-11-13-package-3.1/acceptance.md`, "Review and answers"). Tested when the pull request merges with no blocking finding open (section 3, step 9) | No | Not yet opened | `evidence/2026-11-13-package-3.1/acceptance.md` | None blocking after round 1's fix. Its notes: two fixed (the trace's frames of the screen; the mount rule in the live tests), three recorded in the evidence, four are known gaps 77 to 80. Known gaps 70 to 76 from the build, and 98 from bringing the branch up to date (81 to 97 are kept for packages 1.3 and 1.4, built at the same time). Not shown: tests a model writes (3.2b), checklist items 2 to 6, the server profile, anything about the real engine (2.2) |
| 3.2 to 3.4, S1a, S1b (3.1 has its own row above since 13 Nov 2026; the 3.1 part of this cell is kept as first written) | 3.1: **parked 13 Nov 2026 on the owner's questions 11 and 12** (`docs/STATUS.md`), under section 3, step 4 and section 4's "Always the owner"; nothing built. Its dependency, 2.1, is met, but its runner needs a browser and container images whose licences are not on the permitted list (question 11), and the tests it would first run are written in advance by Claude Code, a change to decision E (question 12). *Since 13 Nov 2026:* question 11 (a) is approved for the builder's internal development and testing (the two sandbox images and the 119 Ubuntu packages; `docs/DECISIONS.md`), so 3.1 now waits for the browser (its terms being read), the runner's two base images (being inventoried) and question 12. *Later on 13 Nov 2026 (the pull request of the pinned images):* question 12 is answered (a), and the browser's terms and the runner's two base images are read (`docs/licences/browser-terms.md`, `docs/licences/runner-base-images.md`), so 3.1 waits only for the owner's question 15. Its design was drafted, read by two independent critics and corrected: `docs/design/package-3.1.md`, a draft, not approved. The others not started: 3.2 waits for 3.1 (L11 is true), and by the plan's order it comes next once 3.1 is tested; 3.3 and 3.4 for what comes before them; S1a for L10, S1b for S1a and the live runs | | | | | |
| M1 to M9, M7b, C1, C2 | Not started | | | | | |
| W1 to W3 | Not started. *Since 13 Nov 2026, when the owner approved question 11 (a) for the builder's internal development and testing (`docs/DECISIONS.md`):* W2 is no longer parked (it builds on the two sandbox images once the pull request that pins them by digest is merged; its own point on acceptance is in `docs/STATUS.md`); W1 stays parked on the browser, whose terms are being read. *Later on 13 Nov 2026:* the two images are pinned by digest (the pull request of the pinned images), so W2's condition is met once that pull request is merged; W1 still waits, since question 15 covers only the runner's browser download, not the development machine's copy W1's screenshots use. As first recorded: W1 and W2 **parked 13 Nov 2026 on the owner's question 11**, under section 3, step 4 and section 4's "Always the owner". W1: its dependency, L9, is met (12 Nov 2026), but its "Done means" needs an automated browser run with screenshots kept, which uses the same browser. W2: its dependency, 2.1, is met (12 Nov 2026), but it runs builds in sandboxes, and every sandbox runs `node:22-alpine` and `postgres:16-alpine`, two of the images question 11 asks about. W3 can start (L9 became true on 12 Nov 2026) and, as read in its row and the code it would use, builds and runs no container and no browser. W3 can fill a wait (section 7.7), as it was to while 1.2 was in review (that review ended with 1.2's merge on 13 Nov 2026); it has not been started. The images have been used by every sandbox since walking skeleton 2 and the browser since walking skeleton increment 3a (both 11 Nov 2026), and the images, Ubuntu packages and browser download measured on 13 Nov 2026 for 3.1's design were pulled and run with no record at the time (known gap 61). They and the two sandbox images were inventoried on 13 Nov 2026 (`docs/licences/runtime-inventory.md`; what was not read there is listed in its section 6; the official Playwright image, not proposed for use, was not inventoried). Until question 11 was answered in part (13 Nov 2026), no new package built on them and no demonstration ran them, and that still holds for the browser and the runner's base images; the live tests in `npm test`, which already build and start the images, keep running before each push: CLAUDE.md asks for `npm test` before every push, and its live tests need the two images; skipping them would weaken a check (hard rule 8). That is Claude Code's reading, for the owner to overrule; plan section 5's "stop the whole run" is read as not met (`docs/DECISIONS.md`, 13 Nov) | | | | | |
| W4 Arabic wording list | 11 Nov 2026 | 11 Nov 2026; merged text re-read 12 Nov, list and counts confirmed, one sentence outside its "Done means" corrected | No | #6, merged into `claude/stage-1` | `docs/arabic-wording-list.md` | None; two wording suggestions wait on the owner |

## 11. Pre-flight: what the owner settles

**Part one: before the run starts.** Without these, only 0.1, 0.2, 1.1 and W4 can be done.

| # | Item | What it unblocks |
| --- | --- | --- |
| 1 | Open decision 9: four development packages under two non-permissive licences. Approve each by name, or say "replace them" | L9: all work under `builder/` |
| 2 | Open decision 11: `caniuse-lite`, a data file the first stack ships in every app. Approve it by name, or decline, which rules out the first stack | L11: all work on the existing template |
| 3 | Make the repository private, and confirm the session can still reach it | The design, evidence and gap list stop being public |

**Part two: by checkpoint 2.**

| # | Item | What it unblocks |
| --- | --- | --- |
| 4 | The second stack. Either approve `psycopg` by name (open decision 10), which schedules packages S1a and S1b and a real comparison; or record a waiver, which settles the stack now with no comparison | L10 or Waiver; when M1 can start |
| 5 | Demo candidate: D1, D2 or D3 | C1, C2, M8 |
| 6 | Reviewing engineer: who | Checkpoint 2 |
| 7 | Whether the page titled "builder: preview test" was shown | Whether live pages can be part of the evidence |

**Part three: when the owner is ready to spend.**

| # | Item | What it unblocks |
| --- | --- | --- |
| 8 | Demo server: yes or no, and which | The server profile being run (0.6b), gate item 5 on a clean machine, M8 |

The model key is deliberately not on this list. It is created at checkpoint 1, with the spending limits.

## 12. The two messages the owner sends

**To start:**

> Read `docs/BUILD-PLAN.md` in full. It is my standing instruction. Do the set-up in section 3, then follow the loop and keep going through the queue. Do not stop to ask me about anything the plan lets you decide. Park what depends on me and carry on. Tell me in three sentences what you are starting with.

**Whenever a session has ended:**

> Continue under `docs/BUILD-PLAN.md`, section 3. First tell me, in a short list: what was tested since my last message, what is built but not tested, what is parked and waiting on me, and the month's model spend.
