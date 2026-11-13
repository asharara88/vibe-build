# Status

**As of:** 13 November 2026. Rules: build plan section 8, rule 6. Questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile), 1.1, 1.2, 1.2b, 1.3, 1.4, 1.5 (stand-in only), 2.1, W4. R1: merged, not tested.
2. **Built, not tested, merged:** 3.1, the acceptance runner (#29); 1.4c (#35); 3.1b (#34); 1.4b (#33); **0.6c, private networks (#36)**.
3. **What 0.6c gives:** each project's containers sit on private networks with no route out; the only ways out are the builder's proxy (its list only) and the gateway's port. Nothing on the machine connects to the app: checks and screenshots run in containers beside it. Open: gaps 118 to 128.
4. **What you can do (J1, built, not tested; #37, draft):** on the scripted engine, sign in, create a project, answer the 20 questions, see the proposed app and steps, build and approve each step ($0.00 spent), see the running app's screenshots, run the checklist, sign off, see the cost, export, read the record; English and Arabic. Simulated, labelled: the analyst, the build's changes, the stand-in test. Not yet run on 0.6c's networks.
5. **Budget cap:** a call or step goes ahead only if it fits the cap; an unrecorded ending, a bill above its hold or a set-aside journal line freezes its project until you record it. Stand-in only.
6. **Real models:** none called; no model-written code runs. Licences: internal development and testing only (questions 11, 15).

## Next

1. **J1 on 0.6c:** the journey on the private networks, then a fresh review; then you try it.
2. **1.4c:** wording and a new action yours to confirm.

## What blocks it

- 0.6c: no engineer has read it (question 7); server profile not shown (0.6b).
- 2.3, the first real-model run: 2.2, the key, and 0.6c tested.
- Proof row B10 rests on an unreviewed design (gap 35; question 7).
- Without Docker or the approved browser zip, `npm test` and the checklist fail, never skip (3.1b); a new session must fetch the zip first (gap 110); `CLAUDE.md` should say so (gap 141; yours).
- Disk: a build is refused below 4 GB free, a floor assumed, not measured (gap 137).
- Whether your app can show the interface: unknown (gap 131).

## Money

Model spend through the builder: **$0.00** (no real call). The hosted prototype agent is paused. No paid service in use.
