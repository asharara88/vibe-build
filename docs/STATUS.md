# Status

**As of:** 13 November 2026. Rules: build plan section 8, rule 6. Questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, 1.2, 1.2b, 1.3, 1.4 and 1.5 (stand-in only; 1.5 merged), 2.1 and W4. R1: merged, not tested. Progress: plan section 10.
2. **Built, not tested:** 3.1, the acceptance runner (stand-in test, question 12; merged, #29), and **1.4c**.
3. **Budget cap:** a call goes ahead only if spend plus money set aside plus its hold fits the cap; a step starts only if its whole budget fits (1.3). A call whose cost cannot be recorded freezes its project (1.4); you close a kept hold only by recording its actual cost and evidence (1.5). **New, 1.4c (question 17):** a bill above its hold is charged in full and freezes its project in the same step, until you record it. Shown against a stand-in (`builder/test/overrun.test.ts`); it cannot stop the first such bill. A hold is a reservation from an estimate plus a margin, not a proven ceiling.
4. **Isolation:** on the development profile, project containers can reach the machine's services and the builder's database (gaps 60 and 70) until 0.6c; no model-written code runs before it.
5. **Licences and real models:** approved for internal development and testing only (questions 11 and 15); images pinned by digest, checked in `npm test`. No real model called; the gate stays closed until 0.6c and the key.

## Next

1. **1.4c's pull request:** review first. Evidence: `evidence/2026-11-13-package-1.4c/overrun-freeze.md`. Refusal wording yours to confirm (`docs/QUESTIONS.md`).
2. **The third outside review (13 Nov):** 1.4b (an unreadable journal line keeps the gateway closed) and 3.1b (live acceptance tests fail, not skip, without the browser or Docker), being built.
3. **0.6c**: you chose private networks (a); its assumptions measured first.

## What blocks it

- 0.6c: no engineer has read its design (question 7).
- 2.3, the first real-model run: 0.6c and the key.
- Proof row B10 rests on a design no engineer has reviewed (known gap 35; question 7).
- Without the approved browser zip, the live acceptance tests are skipped, never passed (gap 73; 3.1b changes this).
- Question 16 blocks nothing; it is built to (a).

## Money

Model spend through the builder: **$0.00** (no real call made). The hosted prototype agent outside the repository is paused by you (13 Nov). No paid service is in use.
