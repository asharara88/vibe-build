# Status

**As of:** 13 November 2026. Rules for this file: build plan section 8, rule 6. Open questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, **1.2**, **1.2b**, **1.3** and **1.4** (stand-in provider only; 1.4 merged with #31), 2.1 and W4. R1 is merged, not tested. Progress: plan section 10.
2. **Built, not tested: 3.1**, the acceptance runner, with a **stand-in test** (question 12), merged with pull request #29; **3.1b**, browser acceptance required, in this pull request.
3. **Budget cap:** a call goes ahead only if spend plus money set aside plus its hold fits the cap; a step starts only if its whole budget fits (1.3). With 1.4, a call whose cost cannot be recorded freezes its project until you record it (1.5); a killed gateway's holds stay counted. A hold is a reservation from an estimate plus a margin, not a proven ceiling.
4. **Isolation:** on the development profile, project containers can reach the machine's services and the builder's database (gaps 60 and 70), until package 0.6c; no model-written code runs before it.
5. **Licences and real models:** approved for internal development and testing only (questions 11 and 15); the images are pinned by digest and checked in `npm test`. No real model called yet; the gate stays closed until 0.6c and the key.

## Next

1. **3.1b**: reviewed once, nothing blocking; notes fixed or recorded (gaps 112, 130, 131). Next: merge `b52e041` in, then the review bot.
2. **1.5**, your recorded close of a held call, which unfreezes a project: merged (#32). 0.6c's design is being drafted.

## What blocks it

- 0.6c: its design read by an engineer or by you (question 7).
- 2.3, the first real-model run: 0.6c and the key.
- Proof row B10 rests on a design no engineer has reviewed (gap 35; question 7).
- Without Docker or the approved browser zip, the live acceptance tests and `npm test` now fail, never skip (3.1b). A new session must fetch the zip first, which its network may refuse (gap 110). `CLAUDE.md` should say so (gap 131; yours).
- Questions 16 and 17 block nothing; each is built to a stated option.

## Money

Model spend through the builder: **$0.00** (no real call made). The hosted prototype agent outside the repository is paused by you (13 Nov). No paid service is in use.
