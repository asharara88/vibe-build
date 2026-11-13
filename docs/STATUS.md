# Status

**As of:** 13 November 2026. Rules for this file: build plan section 8, rule 6. Open questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, **1.2** and **1.2b** (the budget holds and the cap change, against a stand-in provider only), 2.1 and W4. R1 is merged, not tested. Progress: build plan section 10.
2. **Built, not tested: 3.1**, the acceptance runner, with a **stand-in test** written in advance by Claude Code (question 12). Its four "Done means" items ran on the development profile: a pass with its screenshot, the broken copy rejected at item 1, runs that did not execute reported "did not run", every attempt from the engine's container to reach the tests failed. One review's blocking item is fixed; all four were run again. Its branch now holds `claude/stage-1`; its gaps are renumbered 70 to 80. Evidence: `evidence/2026-11-13-package-3.1/acceptance.md`.
3. **Budget cap and real models:** a call passes only if spend plus open holds plus its hold fits the cap. It limits admission, not the bill; nothing yet stops a project (1.4). No real model called yet; the gate stays closed until 1.4, 0.6c and the key.
4. **Isolation:** on the development profile, project containers, the runner among them, can reach the machine's services, the builder's database included (known gaps 60 and 70). Package 0.6c is to fix it; no code a model wrote runs before then.
5. **Licences:** approved for internal development and testing only: the sandbox images and the 119 Ubuntu packages (question 11), the runner's two base images and the test browser (question 15). The four images are pinned by digest; a check in `npm test` fails on any other.

## Next

1. **3.1:** its pull request and merge.
2. **1.3 and 1.4**, the pre-step check and the failure tests with the stop after a fault: being built. Then 1.5. 0.6c's design follows.

## What blocks it

- 0.6c: its design read by an engineer or by you (question 7).
- 2.3, the first real-model run: 1.4, 0.6c and the key.
- The live acceptance tests need the approved browser zip on the machine; without it they are skipped, never passed (known gap 73).

## Money

Model spend through the builder: **$0.00** (no real call made). The separate hosted prototype agent outside the repository is paused by you (13 Nov). No paid service is in use.
