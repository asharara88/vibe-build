# The marks of merged packages, checked before they were written (14 November 2026)

Written by Claude Code. This folder holds what was read and run on 14 November 2026 to decide which merged packages can be marked "tested" in the progress table of `docs/BUILD-PLAN.md`. The summary of the readers' findings, and what was done with each, is `docs/reviews/2026-11-14-marks-checked.md`.

Run on the development machine (a cloud session), development profile, real Docker, the scripted engine (fixed changes, no AI model), a stand-in test written by Claude Code. No model was called. Made-up data only.

## 1. Nine fresh readers tried to refute a first draft of the marks

A first draft marked six packages tested (3.1, 3.1b, 1.4b, 1.4c, J1, J2) and kept two as built (0.6c, J3). Before it was committed, nine fresh readers were each given one row, or the three shared record files, and asked to refute it. None wrote any of the packages or saw an author's conversation. They read files and git history only; they ran nothing.

Their own reports, as returned, are in `readers-reports.json` (one entry per reader: the verdict, every sentence found unsupported with the reason and a truer wording, and the facts each traced to a file).

| Row | Mark in the draft | Reader's verdict | Sentences to correct | Of those, blocking |
| --- | --- | --- | --- | --- |
| 3.1 | tested | supported | 6 | 0 |
| 3.1b | tested | supported, on three readings that are Claude Code's | 5 | 0 |
| 1.4b | tested | supported | 5 | 0 |
| 1.4c | tested | **not supported** | 9 | 1 |
| 0.6c | stays built | supported | 4 | 0 |
| J1 | tested | **not supported** | 6 | 1 |
| J3 | stays built | supported | 5 | 0 |
| J2 | tested | supported; one sentence false | 7 | 1 |
| The status, questions and decisions files | | not consistent | 13 | 4 |

The draft was withdrawn. What the readers found, in short:

- **1.4c** does not meet the rule the draft itself quoted: gap 145 was open when it merged. Calling it tested "as of 14 Nov", after pull request #42 closed that gap, was a further reading that nobody but Claude Code had made.
- **J1**'s own design asks for two parts to be reviewed adversarially (the export's copy of tests; the cameras' mounts). The record shows one fresh review, and nothing that says any reading was adversarial.
- **J2**'s row cited a check by a reader whose file does not cover J2, said the automated run was on the merged code when it was on `abe41e5`, and said the other session had agreed to the mark, which no file shows.
- **Every row** presented the rule as the owner's. He wrote two words; the rule is Claude Code's reading of them.
- **Every row** said the whole suite passed "on the integration branch". It passed on `51a68d3`, the last code commit of pull request #49, whose `builder/` folder is the same as the integration branch's.
- **Runs called "on today's code"** were on `835f483`, one code commit before the merged code. Screenshots were counted that had not been kept.
- **Stale cells** in the same rows: four pull requests still shown as open or not opened, although merged.
- **The status file** contradicted itself on the two pieces of work still on side branches, and left R1 and the day's fixes out of "built, not tested".

## 2. Three runs repeated on the merged code

Each is the package's own script, unchanged, run once under the shared lock, on commit `839be17` (`builder/` tree `b737641`): the integration branch `claude/stage-1` after pull request #49. The working tree of `builder/` had no changed file.

| Run | Script | Result | Kept here |
| --- | --- | --- | --- |
| Package 3.1's demonstration: its four "Done means" items | `scripts/demo-acceptance.ts` | Exit code 0. Item 1 passed with its screenshot (run A); a run past its time limit and a run killed part-way each gave "did not run" (B1, B2); a run with the app stopped was refused before its start (C); the deliberately broken copy failed at the step "sees status waiting" (D); **65 attempts to reach the tests from the engine container, 0 did not fail**. Lock held 14:03:39 to 14:06:22 UTC. Nothing of the project left | `package-3.1/`: the run's log (`run-demo.txt`), the attempts one row each, the mounts, the network probe's lines, the events, the runner image's build and package list, both screenshots |
| J1, the owner's journey: sign-in to export on real containers | `scripts/demo-journey.ts` | **54 of 54 checks passed**, 35 of 35 screenshots, exit code 0. Lock held 14:06:22 to 14:07:48 UTC. Nothing of the run left | `j1/`: the run's log, the camera's lines, the events, the export's contents, the interface's output, **all 35 screenshots** |
| J3, the live preview: the app used live, then the checklist | `scripts/demo-journey-j3.ts` | **46 of 46 checks passed** by the run's own total; 20 screenshots, exit code 0. Lock held 14:07:48 to 14:09:16 UTC | `j3/`: the same files, **all 20 screenshots** |

Before, for comparison: 3.1's demonstration was last run at `0b8128b` on 13 Nov, before the review bot's fix and before packages 3.1b and 0.6c changed the runner and the script. J1's and J3's runs were repeated earlier on 14 Nov on `835f483` (`evidence/2026-11-14-runs-repeated/`), one code commit before the merged code, and most of those screenshots were not kept.

Small points:

- J3's log prints 45 lines marked PASSED; its total says 46. The 46th, the check of the record, is counted without a printed line. The first run's log of 13 Nov is the same.
- In 3.1's demonstration every network attempt is made from a container with no network at all (known gap 50). Those rows say nothing about package 2.2's engine, which will have one.
- The screenshots were not compared picture by picture with the first runs'.

## What this shows, and what it does not

**Shown:** on the merged code, package 3.1's four "Done means" items, J1's automated run and J3's automated run each pass again, on real containers. The whole suite's last kept run is 790 of 790 on `51a68d3`, which holds the same `builder/` folder (`evidence/2026-11-14-journey-j2-second-review/`).

**Not shown:**

- Anything about a real model or a real engine. Every result here is on the scripted engine, with a stand-in test.
- Independent acceptance. The stand-in test and the planted defect have the same author (known gap 177).
- That any of these packages is secure or ready. "Tested" is a state in the plan's table, nothing more.
- J3's phone test, which is the owner's to run.
- The server profile.
