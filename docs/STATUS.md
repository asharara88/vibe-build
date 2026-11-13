# Status

**As of:** 13 November 2026. Rules: build plan section 8, rule 6. Questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, **1.2**, **1.2b**, **1.3**, **1.4** and **1.5** (stand-in only; 1.5 once merged), 2.1 and W4. R1: merged, not tested. Progress: plan section 10.
2. **Built, not tested: 3.1**, the acceptance runner, with a **stand-in test** (question 12), merged (#29); **0.6c**, on its branch.
3. **Budget cap:** a call goes ahead only if spend plus money set aside plus its hold fits the cap; a step starts only if its whole budget fits (1.3). With 1.4, a call whose cost cannot be recorded freezes its project; a killed gateway's holds stay counted. With 1.5, you close a kept hold only by recording its actual cost and evidence; that clears its freeze. A hold is a reservation from an estimate plus a margin, not a proven ceiling.
4. **Isolation (0.6c, built):** project containers sit on private networks, no route out; ways out: the builder's proxy (through the session's proxy) and the gateway's port. Each reached only its list; two deliberate misconfigurations failed. Open: gaps 118 to 128 (and 60, 70 until merged).
5. **Licences and real models:** approved for internal development and testing only (questions 11 and 15); images pinned by digest, checked in `npm test`. No real model called; the gate stays closed until 0.6c and the key.

## Next

1. **The third outside review (13 Nov):** an unreadable journal line to keep the gateway closed until recovered (1.4b); the live acceptance test to fail, not skip, without the browser or Docker (3.1b); question 17: you chose (a), freeze after an overrun (1.4c, next).
2. **0.6c's pull request**: its review found nothing blocking. `evidence/2026-11-13-package-0.6c/network-boundary.md`.

## What blocks it

- 0.6c: no engineer has read it (question 7); server profile not shown (0.6b).
- 2.3, the first real-model run: 0.6c and the key.
- Proof row B10 rests on a design no engineer has reviewed (known gap 35; question 7).
- Without the approved browser zip, the live acceptance tests are skipped, never passed (gap 73; 3.1b changes this).
- Question 16 blocks nothing; it is built to (a).

## Money

Model spend through the builder: **$0.00** (no real call made). The hosted prototype agent outside the repository is paused by you (13 Nov). No paid service is in use.
