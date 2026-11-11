# Owner's review of pull request #2 (walking skeleton 1 to 3a)

| | |
| --- | --- |
| Reviewed | Pull request #2, branch `claude/walking-skeleton` at commit `6fca006`, 11 November 2026 |
| Reviewer | The owner, Ahmed Sharara |
| Outcome | The code is an **unapproved starting baseline**: built, partly tested, not accepted. Pull request #2 closed as superseded by `docs/BUILD-PLAN.md` |
| Source of this file | The owner's review reached the project as the Phase 0 packages of `docs/BUILD-PLAN.md` (section 7.2), written by the owner. No separate review text was posted on the pull request. The findings below are those packages, one per row, in the owner's terms |

## Findings

| # | Finding | What was wrong | Package that answers it | State |
| --- | --- | --- | --- | --- |
| 1 | `docs/STATUS.md` had been added to session after session and no longer read as one current state; some statements contradicted others | A reader could not tell the current state from the history | 0.1 | Open |
| 2 | The second skeleton evidence file overstated what was shown: it read as if the project's isolation had been demonstrated, when only requests sent through the egress proxy were filtered, and the server profile was checked only as a configuration file, never run | An evidence file must claim only what was run, from where | 0.2 | Open |
| 3 | The template's role guard did not stop an unauthorised request by itself: it returned a "denied" flag for the page to handle, treated an unrecognised role as the lowest role, and covered pages only, not form actions or data routes | Rule 5 says every screen checks the role before showing anything; a guard that can be forgotten or misread is not a guard | 0.3 | Open |
| 4 | The licence check applied one rule to shipped dependencies and a weaker one to development tools | Hard rule 2 names no such split: every dependency is permissive, or named one by one in `docs/DECISIONS.md` | 0.4 | Open |
| 5 | Creating the app's tables and sample users ran on the machine that hosts the builder, with the host's whole environment | Hard rule 9: generated code and the engine run only in containers; set-up must not leak the builder's settings | 0.5 | Open |
| 6 | Isolation was asserted from the design, not checked from inside a workload container; the development profile shares the host's network and the report did not say plainly what is not isolated | A safeguard is "shown", "designed" or "not done", never implied | 0.6a (development profile), 0.6b (server profile, when a server exists) | Open |

Each row is closed only when its package is **tested** under `docs/BUILD-PLAN.md` section 3, with its evidence file and a fresh reviewer's findings closed.
