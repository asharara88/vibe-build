# Status

**As of:** 13 November 2026. Rules: build plan section 8, rule 6. Questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, 1.2, 1.2b, 1.3, 1.4 and 1.5 (stand-in only), 2.1 and W4. R1: merged, not tested. Progress: plan section 10.
2. **Built, not tested, merged:** 3.1, the acceptance runner (#29); 1.4c, a bill above its hold freezes the project (#35); 3.1b, browser acceptance required (#34); 1.4b, an unreadable journal line keeps the gateway closed (#33).
3. **What you can do (J1, built, not tested; #37, draft):** on the scripted engine, sign in, create a project, answer the 20 questions, see the proposed app and steps, build and approve each step ($0.00 spent), see the running app's screenshots, run the checklist (item 1 passed), sign off, see the cost, export, read the record; English and Arabic. Simulated, labelled: the analyst, the build's changes, the stand-in test. Rechecked after the merge: 46 of 46 automated checks, 556 of 556 tests (`evidence/2026-11-13-journey-j1/`).
4. **Budget cap:** a call or step goes ahead only if it fits the cap. An unrecorded ending, a bill above its hold or a set-aside journal line freezes its project until you record it. Stand-in only; the first such bill is not stopped.
5. **Isolation and real models:** project containers can reach the machine's services and the builder's database (gaps 60, 70) until 0.6c; no model-written code runs, no real model is called. Licences: internal development and testing only (questions 11, 15).

## Next

1. **J1:** a fresh review of the merge; then you try it.
2. **0.6c:** private networks (your answer (a)), next.
3. **1.4c:** wording and a new action yours to confirm.

## What blocks it

- 0.6c: no engineer has read its design (question 7).
- 2.3, the first real-model run: 0.6c and the key.
- Proof row B10 rests on an unreviewed design (gap 35; question 7).
- Without Docker or the approved browser zip, `npm test` and the checklist fail, never skip (3.1b); a new session must fetch the zip first (gap 110); `CLAUDE.md` should say so (gap 141; yours).
- Disk: a build needs 4 GB free (gap 137).
- Whether your app can show the interface is unknown (gap 131).

## Money

Model spend through the builder: **$0.00** (no real call). The hosted prototype agent is paused. No paid service in use.
