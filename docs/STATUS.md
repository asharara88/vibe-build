# Status

**As of:** 13 November 2026. Rules for this file: build plan section 8, rule 6. Open questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, **1.2**, **1.2b**, **1.3**, **1.4** and **1.5** (stand-in only; 1.3 to 1.5 once their pull requests merge), 2.1 and W4. R1 is merged, not tested. Progress: plan section 10.
2. **Budget cap:** a call goes ahead only if spend plus money set aside plus its hold fits the cap; with 1.3, a step starts only if its whole budget fits. With 1.4: a finished call that cannot be recorded stops the gateway until it is, then freezes the project until you record its cost; a gateway killed mid-call leaves its money held and marked. With 1.5: kept holds are listed for you and closed only by your recorded actual cost and evidence; that cost is then charged, and a frozen project runs again. A hold reserves an estimate plus a margin, not a proven ceiling.
3. **Isolation:** on the development profile, project containers can reach the machine's services and the builder's database (gap 60), until package 0.6c; no model-written code runs before it.
4. **Licences:** approved for internal development and testing only (questions 11 and 15): the sandbox and runner images, 119 Ubuntu packages and the test browser. The images are pinned by digest, checked in `npm test`.
5. **Real models:** none called yet; the gate stays closed until 1.4 merges, 0.6c and the key.

## Next

1. **The pull requests of 1.3, then 1.4**, brought up to date (gaps 81 to 97). 1.4's post-review fixes: tested, not reviewed. Evidence: `evidence/2026-11-13-package-1.3/` and `-1.4/`.
2. **1.5's pull request**, on 1.4's (#31). Adversarial review: nothing blocking; one fix, tested, not reviewed; gaps 99 to 104. Evidence: `evidence/2026-11-13-package-1.5/`. 0.6c's design alongside.
3. **3.1**, the acceptance runner: being built.

## What blocks it

- 0.6c: its design read by an engineer or by you (question 7).
- 2.3, the first real-model run: 1.4 merged, 0.6c and the key.
- Proof row B10 rests on a design no engineer has reviewed (known gap 35; question 7).
- Questions 16 and 17 block nothing; each is built to an option.

## Money

Model spend through the builder: **$0.00** (no real call made). The hosted prototype agent outside the repository is paused by you (13 Nov). No paid service is in use.
