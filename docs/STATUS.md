# Status

**As of:** 13 November 2026. Rules for this file: build plan section 8, rule 6. Open questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, **1.2**, **1.2b** and **1.3** (against a stand-in provider only; 1.3 when its pull request merges: its review found nothing blocking), 2.1 and W4. R1 is merged, not tested. Progress: build plan section 10.
2. **Budget cap:** a call is let through only if spend plus money set aside plus this call's hold fits the cap. With 1.3, a step is refused before it starts unless its whole budget fits; its calls draw from that reservation, and the unused part is released at its end. A hold is a reservation from an estimate plus a margin, not a proven ceiling. Nothing yet stops a project after a fault (1.4).
3. **Isolation:** on the development profile, project containers can reach the machine's services, including the builder's own database (known gap 60). The fix is package 0.6c. No code a model wrote runs before it.
4. **Licences:** approved for internal development and testing only: the two sandbox images and the 119 Ubuntu packages (question 11), and the runner's two base images and the test browser (question 15). The approved images are pinned by digest; a check in `npm test` fails on any other.
5. **Real models:** none called yet. The real-model gate stays closed until 1.4, 0.6c and the key.

## Next

1. **1.3's pull request**, up to date with the integration branch; its known gaps renumbered 81 to 90 (the review's notes: 85, 87 to 90). Evidence: `evidence/2026-11-13-package-1.3/step-hold.md`.
2. **The approved images are pinned** (State, item 4), and the sandbox test waits for the database: pull request #28, merged.
3. **1.4**, the failure tests and the stop after a fault: being built. Then 1.5. 0.6c's design follows.
4. **3.1**, the acceptance runner (questions 12 and 15 answered): being built.

## What blocks it

- 0.6c: its design read by an engineer or by you (question 7).
- 2.3, the first real-model run: 1.4, 0.6c and the key.
- Question 16 (what 1.3 is checked against) blocks nothing: 1.3 was built to option (a).

## Money

Model spend through the builder: **$0.00** (no real call made). The separate hosted prototype agent outside the repository is paused by you (13 Nov). No paid service is in use.
