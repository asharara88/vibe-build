# Status

**As of:** 13 November 2026. Rules: build plan section 8, rule 6. Questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, 1.2, 1.2b, 1.3, 1.4 and 1.5 (stand-in only), 2.1 and W4. R1: merged, not tested. Progress: plan section 10.
2. **Built, not tested:** 3.1, the acceptance runner (stand-in test, question 12; #29); **1.4c** (#35), **3.1b** (#34), and **1.4b** (#33), all merged; **0.6c**, this pull request (#36).
3. **Budget cap:** a call goes ahead only if spend, money set aside and its hold fit the cap; a step, only if its whole budget fits. An unrecorded call ending, or a bill above its hold (1.4c), freezes its project until you record it (1.5); an unreadable journal line keeps the gateway closed until it is set aside (1.4b). Stand-in only; the first such bill is not stopped. Holds are estimates plus a margin, not ceilings.
4. **Isolation (0.6c):** project containers sit on private networks, no route out; ways out: the builder's proxy (through the session's proxy) and the gateway's port. Each reached only its list; two deliberate misconfigurations failed. Open: gaps 118 to 128 (and 60, 70 until merged).
5. **Licences and real models:** approved for internal development and testing only (questions 11 and 15); images pinned by digest, checked in `npm test`. The gate stays closed until 0.6c and the key.

## Next

1. **0.6c (#36):** review found nothing blocking; brought up to date with 1.4b, 1.4c and 3.1b and checked again. `evidence/2026-11-13-package-0.6c/network-boundary.md`.
2. **1.4c:** wording and a new action yours to confirm.
3. **J1**, your journey on the scripted engine, being built.

## What blocks it

- 0.6c: no engineer has read it (question 7); server profile not shown (0.6b).
- 2.3, the first real-model run: 0.6c and the key.
- Proof row B10 rests on a design no engineer has reviewed (gap 35; question 7).
- Without Docker or the approved browser zip, the live acceptance tests and `npm test` now fail, never skip (3.1b). A new session must fetch the zip first, which its network may refuse (gap 110). `CLAUDE.md` should say so (gap 141; yours).
- Question 16 blocks nothing; it is built to (a).

## Money

Model spend through the builder: **$0.00** (no real call made). The hosted prototype agent outside the repository is paused by you. No paid service is in use.
