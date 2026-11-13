# Status

**As of:** 13 November 2026. Rules: plan section 8, rule 6. Questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, 1.2, 1.2b, 1.3, 1.4, 1.5 (stand-in only), 2.1, W4. R1: merged, not tested. Progress: plan section 10.
2. **Built, not tested: 3.1**, the acceptance runner, with a stand-in test (question 12); merged (#29).
3. **Your journey (J1), built, not tested:** the whole journey works in an automated browser run (45 checks passed; 35 screenshots, retaken after review: `evidence/2026-11-13-journey-j1/screens/`): sign in, a project, the 20 questions as a chat, the proposed app and steps, each step built and approved ($0.00 spent), screenshots of the running app, the checklist (item 1 passed), sign-off, cost, export, record; English and Arabic. Simulated, labelled: the analyst, the build's changes, the stand-in test. Review: one blocking fault (simultaneous sign-in attempts passed the lock-out), fixed.
4. **Budget cap:** a step starts only if its whole budget fits (1.3); a call whose cost cannot be recorded freezes its project (1.4); recording the actual cost clears it (1.5). A hold is an estimate, not a proven ceiling.
5. **Isolation:** on the development profile, project containers can reach the machine's services and the builder's database (gaps 60, 70) until 0.6c; no model-written code runs before it.
6. **Licences and real models:** approved for internal development and testing only (questions 11, 15). No real model called; the gate stays closed until 0.6c and the key.

## Next

1. **J1:** the review's fixes re-read; then you can try it yourself.
2. **The third outside review:** 1.4b (gateway closed after an unreadable journal line); 3.1b (live acceptance fails, not skips, without the browser or Docker); 1.4c (your answer (a): an overrun freezes the project).
3. **0.6c:** private networks (your answer (a)), measured first.

## What blocks it

- 0.6c: no engineer has read its design (question 7).
- 2.3, the first real-model run: 0.6c, the key.
- Proof row B10 rests on a design no engineer reviewed (gap 35; question 7).
- Disk: a build needs 4 GB free (assumed floor, gap 137); twice refused today.
- Your own use of the interface: whether your app can show it is unknown (gap 131).

## Money

Model spend through the builder: **$0.00** (no real call). The hosted prototype agent outside the repository is paused by you (13 Nov). No paid service in use.
