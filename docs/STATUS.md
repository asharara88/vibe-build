# Status

**As of:** 13 November 2026. Rules: build plan section 8, rule 6. Questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, 1.2, 1.2b, 1.3, 1.4 and 1.5 (stand-in only), 2.1 and W4. R1: merged, not tested. Progress: plan section 10.
2. **Built, not tested:** 3.1, the acceptance runner (stand-in test, question 12; merged, #29); **1.4c** (merged, #35); **3.1b**, browser acceptance required, in this pull request.
3. **Budget cap:** a call goes ahead only if spend, money set aside and its hold fit the cap; a step, only if its whole budget fits (1.3). A call whose ending goes unrecorded freezes its project (1.4); a kept hold closes only when you record its cost and evidence (1.5). **1.4c (question 17):** a bill above its hold is charged in full and freezes its project until you record it. Stand-in only; it cannot stop the first such bill. Holds are estimates plus a margin, not ceilings.
4. **Isolation:** on the development profile, project containers can reach the machine's services and the builder's database (gaps 60 and 70) until 0.6c; no model-written code runs before it.
5. **Licences and real models:** approved for internal development and testing only (questions 11 and 15); images pinned by digest, checked in `npm test`. The gate stays closed until 0.6c and the key.

## Next

1. **3.1b** (this pull request): both reviews done; findings fixed or recorded (gaps 112, 140, 141).
2. **1.4b** (an unreadable journal line keeps the gateway closed): the review bot's findings being fixed.
3. **0.6c**: you chose private networks (a); being built. **J1**, your journey on the scripted engine, being built.

## What blocks it

- 0.6c: no engineer has read its design (question 7).
- 2.3, the first real-model run: 0.6c and the key.
- Proof row B10 rests on a design no engineer has reviewed (gap 35; question 7).
- Without Docker or the approved browser zip, the live acceptance tests and `npm test` now fail, never skip (3.1b). A new session must fetch the zip first, which its network may refuse (gap 110). `CLAUDE.md` should say so (gap 141; yours).
- Question 16 blocks nothing; it is built to (a).

## Money

Model spend through the builder: **$0.00** (no real call made). The hosted prototype agent outside the repository is paused by you. No paid service is in use.
