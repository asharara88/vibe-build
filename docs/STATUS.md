# Status

**As of:** 13 November 2026. Rules: build plan section 8, rule 6. Questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, **1.2**, **1.2b**, **1.3**, **1.4** and **1.5** (stand-in only; 1.5 once merged), 2.1 and W4. R1: merged, not tested. Progress: plan section 10.
2. **Built, not tested: 3.1**, the acceptance runner, with a **stand-in test** (question 12); merged with pull request #29.
3. **Budget cap:** a call goes ahead only if spend plus money set aside plus its hold fits the cap; a step starts only if its whole budget fits (1.3). With 1.4, a call whose cost cannot be recorded freezes its project; a killed gateway's holds stay counted. With 1.5, you close a kept hold only by recording its actual cost and evidence; that clears its freeze. A hold is a reservation from an estimate plus a margin, not a proven ceiling.
4. **Isolation:** on the development profile, project containers can reach the machine's services and the builder's database (gaps 60 and 70) until 0.6c; no model-written code runs before it.
5. **Licences and real models:** approved for internal development and testing only (questions 11 and 15); images pinned by digest, checked in `npm test`. No real model called; the gate stays closed until 0.6c and the key.

## Next

1. **1.5's pull request.** Review: nothing blocking; notes fixed or known gaps 99 to 104. Evidence: `evidence/2026-11-13-package-1.5/`.
2. **The third outside review (13 Nov):** an unreadable journal line to keep the gateway closed until recovered (1.4b); the live acceptance test to fail, not skip, without the browser or Docker (3.1b); question 17 asked again.
3. **0.6c's design**, then to you as one question.

## What blocks it

- 0.6c: its design read by an engineer or by you (question 7).
- 2.3, the first real-model run: 0.6c and the key.
- Proof row B10 rests on a design no engineer has reviewed (known gap 35; question 7).
- The live acceptance tests need the approved browser zip on the machine; without it they are skipped, never passed (known gap 73; 3.1b changes this).
- Questions 16 and 17 block nothing; each is built to a stated option.

## Money

Model spend through the builder: **$0.00** (no real call made). The hosted prototype agent outside the repository is paused by you (13 Nov). No paid service is in use.
