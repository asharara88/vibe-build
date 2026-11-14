# Status

**As of:** 14 November 2026: pull request #51 merged; this one adds 0.6c's check inside the real containers. Questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Before this: `docs/log/2026-11-14-status-before-j2-second-review.md`.

## What you can now do

- **J1:** brief to sign-off and export; simulated build.
- **J3, the live app:** off until your phone test.
- **J2:** the "Simulated build" panel on Projects makes a deliberately broken copy; the checklist reads **Failed**; it is never signed off or exported.
- **J2, a stop mid-step:** stopping the interface marks the project interrupted and removes its containers (sealed boxes a step or the app runs in); after a crash, the next start does. New: a removal counts as done only when Docker, which runs the containers, lists nothing of the project; otherwise its screens show what was left (limits: gap 180).

## State

1. **Tested** (scripted engine or stand-ins; no real model): 0.1 to 0.5, 0.6a (development profile), 1.1 to 1.5 with 1.2b and 1.4b, 2.1, 3.1, W4, J2. Marked on your "Fix it" as Claude Code read it, yours to take back: 3.1, 1.4b, J2 (`docs/reviews/2026-11-14-marks-checked.md`).
2. **Built, not tested:** 1.4c (two points are yours to say), 0.6c (item 4), J3 (no finish criteria written; phone test not run), J1 and 3.1b (item 3), R1, the day's fixes.
3. **J1 and 3.1b were read adversarially** (to break them) by six fresh reviewers: nothing blocking; eight serious points to fix (gaps 187 to 189).
4. **0.6c:** its isolation check (what each container can reach) now ran inside the real app, tools and runner containers; each matched its list. Three fresh reviewers read it; a second round and the whole suite are running. Its fourth container, the real engine, does not exist (question 30).
5. **Last whole-suite run:** 814 of 814, on #51's code (`evidence/2026-11-14-gap-180-removal-checked/merged/`).

## Next

1. Fix gaps 187 to 189, then mark J1 and 3.1b.
2. Package 3.2, the export: the other session (pull request #50).
3. Your phone test.

## What blocks it

- Your answers: questions 19 (where new sessions start), 21 (Vercel) and 30 (0.6c); the first four lines of "Yours to confirm".
- An engineer's reading (gaps 35, 148, 149, 159, 179, 180, 187, 188).
- Package 2.2's engine: not before gaps 187 to 189 are fixed. The real-model gate (2.3): 2.2, the key, 0.6c tested.

## Money

Model spend through the builder: **$0.00**. No paid service in use.
