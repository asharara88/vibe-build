# Status

**As of:** 13 November 2026. Rules: build plan section 8, rule 6. Questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, 1.2, 1.2b, 1.3, 1.4 and 1.5 (stand-in only), 2.1 and W4. R1: merged, not tested. Progress: plan section 10.
2. **Built, not tested:** 3.1, the acceptance runner (stand-in test; merged, #29); **1.4c** (merged, #35); **1.4b** (this pull request, #33).
3. **Budget cap:** a call goes ahead only if spend, money set aside and its hold fit the cap; a step, only if its whole budget fits (1.3). An unrecorded call ending freezes its project (1.4); a kept hold closes only when you record its cost and evidence (1.5). 1.4c: a bill above its hold is charged in full and freezes its project until you record it; so does a cut-off call already above it. Stand-in only; the first such bill is not stopped. Holds are estimates with a margin, not proven ceilings.
4. **Isolation:** on the development profile, project containers can reach the machine's services and the builder's database (gaps 60 and 70) until 0.6c; no model-written code runs before it.
5. **Licences and real models:** approved for internal development and testing only (questions 11 and 15); images pinned by digest, checked in `npm test`. The gate stays closed until 0.6c and the key.

## Next

1. **1.4b (#33)**, up to date with 1.4c: an unreadable journal line stops its gateway until an operator sets it aside, freezing the named hold's project until reconciled. Rechecked after the merge (`evidence/2026-11-13-package-1.4b/`).
2. **1.4c:** wording and a new action yours to confirm.
3. **3.1b** (third outside review): live acceptance tests to fail, not skip, without the browser or Docker; being built.
4. **0.6c**: you chose private networks (a); its assumptions measured first.

## What blocks it

- 0.6c: no engineer has read its design (question 7).
- 2.3, the first real-model run: 0.6c and the key.
- Proof row B10 rests on a design no engineer has reviewed (known gap 35; question 7).
- Without the approved browser zip, the live acceptance tests are skipped, never passed (gap 73; 3.1b changes this).
- Question 16 blocks nothing; it is built to (a).

## Money

Model spend through the builder: **$0.00** (no real call made). The hosted prototype agent outside the repository is paused by you. No paid service is in use.
