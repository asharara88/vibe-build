# Status

**As of:** 13 November 2026. Rules for this file: build plan section 8, rule 6. Open questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile only), 1.1, **1.2**, **1.2b** and **1.3** (against a stand-in provider only), 2.1 and W4. R1 is merged, not tested. Progress: build plan section 10.
2. **Built, not tested: 3.1**, the acceptance runner, with a **stand-in test** (question 12): a pass with its screenshot, the broken copy rejected at item 1, runs that did not execute reported "did not run", and every attempt from the engine's container to reach the tests failed. Its review's and the review bot's findings are fixed.
3. **Budget cap and real models:** a call passes only if spend plus money set aside plus its hold fits the cap; a step is refused before it starts unless its whole budget fits (1.3). It limits admission, not the bill; nothing yet stops a project after a fault (1.4). No real model called yet; the gate stays closed until 1.4, 0.6c and the key.
4. **Isolation:** on the development profile, project containers, can reach the machine's services, the builder's database included (known gaps 60 and 70). Package 0.6c is to fix it; no code a model wrote runs before then.
5. **Licences:** approved for internal development and testing only: the sandbox images and the 119 Ubuntu packages (question 11), the runner's two base images and the test browser (question 15). The four images are pinned by digest; a check in `npm test` fails on any other.

## Next

1. **3.1:** its pull request (#29) and merge.
2. **1.4**, the failure tests and the stop after a fault: pull request #31, fixing the review bot's finding. Then 1.5 (being built). 0.6c's design is being drafted.

## What blocks it

- 0.6c: its design read by an engineer or by you (question 7).
- 2.3, the first real-model run: 1.4, 0.6c and the key.
- The live acceptance tests need the approved browser zip on the machine; without it they are skipped, never passed (known gap 73).
- Question 16 (what 1.3 is checked against) blocks nothing: 1.3 was built to option (a).

## Money

Model spend through the builder: **$0.00** (no real call made). The separate hosted prototype agent outside the repository is paused by you (13 Nov). No paid service is in use.
