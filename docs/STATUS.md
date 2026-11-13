# Status

**As of:** 13 November 2026. Rules for this file: build plan section 8, rule 6. Open questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, **1.2** and **1.2b** (the budget holds and the cap change, against a stand-in provider only), 2.1 and W4. R1 is merged, not tested. Progress: build plan section 10.
2. **Budget cap:** a call is let through only if spend plus money set aside plus this call's hold fits the cap. It limits admission, not the bill: a bill above its hold is charged in full, and nothing yet stops the project (package 1.4).
3. **Isolation:** on the development profile, project containers can reach the machine's services, including the builder's own database (known gap 60). The fix is scheduled as package 0.6c. No code a model wrote runs before it.
4. **Licences:** approved for internal development and testing only: the two sandbox images and the 119 Ubuntu packages (question 11), and the runner's two base images and the test browser (question 15). The approved images are pinned by digest; a check in `npm test` fails on any other.
5. **Real models:** none called yet. The real-model gate stays closed until 1.4, 0.6c and the key.

## Next

1. **1.2b is done:** a project's cap can be changed by a recorded command, never below what is spent plus held (your answers to questions 13 and 14).
2. **The approved images are pinned** by digest, with a check that fails on any other, and the sandbox test waits for the database (this pull request).
3. **1.3 and 1.4**, the pre-step check and the failure tests with the stop after a fault: being built. Then 1.5. 0.6c's design follows.
4. **3.1**, the acceptance runner (questions 12 and 15 answered): being built.

## What blocks it

- 0.6c: its design read by an engineer or by you (question 7).
- 2.3, the first real-model run: 1.4, 0.6c and the key.

## Money

Model spend through the builder: **$0.00** (no real call made). The separate hosted prototype agent outside the repository is paused by you (13 Nov). No paid service is in use.
