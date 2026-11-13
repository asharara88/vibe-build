# Status

**As of:** 13 November 2026. Rules for this file: build plan section 8, rule 6. Open questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, **1.2** and **1.2b** (against a stand-in provider only), 2.1 and W4. **1.3 is built, not tested:** its adversarial review has not run. R1 is merged, not tested. Progress: build plan section 10.
2. **Budget cap:** a call is let through only if spend plus money set aside plus this call's hold fits the cap. With 1.3, a step is refused before it starts unless its whole budget fits; its calls draw from that reservation, and the unused part is released at its end. A hold is a reservation from an estimate plus a margin, not a proven ceiling. Nothing yet stops a project after a fault (1.4).
3. **Isolation:** on the development profile, project containers can reach the machine's services, including the builder's own database (known gap 60). The fix is package 0.6c. No code a model wrote runs before it.
4. **Licences:** the two sandbox images and the 119 Ubuntu packages are approved for internal development and testing only (13 Nov). The browser and the runner's two base images: an approval request is being prepared.
5. **Real models:** none called yet. The real-model gate stays closed until 1.4, 0.6c and the key.

## Next

1. **1.3's adversarial review**, then its pull request. Evidence: `evidence/2026-11-13-package-1.3/step-hold.md`.
2. **Pin the approved images** by digest, with a check, and fix a sandbox test that asks the database once whether it is ready instead of waiting.
3. **1.4 and 1.5**, the rest of the budget controls. 0.6c's design is drafted alongside.
4. **3.1**, the acceptance runner, once the browser and runner images are approved.

## What blocks it

- 3.1: your approval of the browser and the runner's two base images (request coming).
- 0.6c: its design read by an engineer or by you (question 7).
- 2.3, the first real-model run: 1.4, 0.6c and the key.
- Nothing waits on question 16 (what 1.3 is checked against); 1.3 was built to its recommended option.

## Money

Model spend through the builder: **$0.00** (no real call made). The separate hosted prototype agent outside the repository is paused by you (13 Nov). No paid service is in use.
