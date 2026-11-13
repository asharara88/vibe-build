# Status

**As of:** 13 November 2026. Rules for this file: build plan section 8, rule 6. Open questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, 1.2 (against a stand-in provider only), 2.1 and W4. R1 is merged, not tested. Progress: build plan section 10.
2. **Built, not tested: 3.1**, the acceptance store and runner, on its own pull request, with a **stand-in test** (written in advance by Claude Code, your answer to question 12). Its four "Done means" items were run on the development profile: a pass with its screenshot, the broken copy rejected at item 1, runs that did not execute reported "did not run", every attempt from the engine's container to reach the tests failed. One adversarial review found one blocking item (two build logs cited but not in the branch), now fixed; the trace no longer records frames of the screen. All four items were run again after the fixes and held. Evidence: `evidence/2026-11-13-package-3.1/acceptance.md`.
3. **Budget cap:** limits admission, not the bill; nothing yet stops a project (1.4).
4. **Isolation:** on the development profile, project containers, the new runner among them, can reach the machine's services (known gaps 60 and 66). Fixed by package 0.6c. No code a model wrote runs before it.
5. **Licences:** the sandbox images, the runner's two base images, the 119 Ubuntu packages and the browser are approved for internal development and testing only (questions 11 and 15). Google's browser terms are still unread.
6. **Real models:** none called. The gate stays closed until 1.4, 0.6c and the key.

## Next

1. 3.1: bring its branch up to date with `claude/stage-1`, which has moved on; known-gap numbers 66 to 69 are taken there, so this branch's gaps 66 to 76 are renumbered. Then its merge.
2. 1.3, 1.4, 1.5; 0.6c's design alongside.

## What blocks it

- 0.6c: its design read by an engineer or by you (question 7).
- 2.3, the first real-model run: 1.4, 0.6c and the key.
- The live acceptance tests need the approved browser zip on the machine; without it they are skipped, never passed (known gap 69).

## Money

Model spend through the builder: **$0.00** (no real call made). No paid service is in use.
