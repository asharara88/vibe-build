# Status

**As of:** 13 November 2026. Rules for this file: build plan section 8, rule 6. Open questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, **1.2** and **1.2b** (stand-in provider only), 2.1 and W4. **Built, not tested:** 1.3 and **1.4** (no adversarial review yet). R1 is merged, not tested. Progress: plan section 10.
2. **Budget cap:** a call goes ahead only if spend plus money set aside plus its hold fits the cap; with 1.3, a step starts only if its whole budget fits. With 1.4: a finished call that cannot be recorded stops the gateway until it is, then freezes that project until you record its cost (1.5, not built); a gateway killed mid-call leaves its money held, marked for you. A hold is a reservation from an estimate plus a margin, not a proven ceiling.
3. **Isolation:** on the development profile, project containers can reach the machine's services, the builder's database included (gap 60). Package 0.6c fixes it; no model-written code runs until then.
4. **Licences:** the two sandbox images and 119 Ubuntu packages are approved for internal development and testing (13 Nov). The browser and the runner's base images: a request is being prepared.
5. **Real models:** none called yet. The real-model gate stays closed until 1.4 is tested, 0.6c and the key.

## Next

1. **Adversarial reviews of 1.3 and 1.4**, then their pull requests. Evidence: `evidence/2026-11-13-package-1.3/` and `-1.4/`.
2. **Pin the approved images** by digest, with a check; fix a sandbox test that does not wait for the database.
3. **1.5**, your recorded close of a held call, which also unfreezes a project. 0.6c's design is drafted alongside.
4. **3.1**, the acceptance runner, once the browser and runner images are approved.

## What blocks it

- 3.1: your approval of the browser and runner images (request coming).
- 0.6c: its design read by an engineer or by you (question 7).
- 2.3, the first real-model run: 1.4 tested, 0.6c and the key.
- Proof row B10 rests on a design no engineer has reviewed (known gap 35; question 7).
- Questions 16 and 17 block nothing: each was built to its stated option.

## Money

Model spend through the builder: **$0.00** (no real call made). The hosted prototype agent outside the repository is paused by you (13 Nov). No paid service is in use.
