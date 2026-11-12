# Findings register: the owner's findings on the baseline (pull request #2 and the design behind it)

| | |
| --- | --- |
| Covers | Pull request #2, branch `claude/walking-skeleton` at commit `6fca006`, and the design note as it stood when that code was written |
| Reviewer | The owner, Ahmed Sharara, 11 November 2026 |
| Outcome | The code is an **unapproved starting baseline**: built, partly tested, not accepted. Pull request #2 closed as superseded by `docs/BUILD-PLAN.md` |
| Last brought up to date | 12 November 2026, after an independent assistant's review of commit `e0e22e6`, supplied by the owner, found this register incomplete and stale (`docs/reviews/2026-11-12-integration-e0e22e6.md`, finding 1) |

## How to read the states

A finding is **closed** only when the package that answers it is tested under `docs/BUILD-PLAN.md` (its "Done means" run and passed, an evidence file, an independent reviewer's findings closed on the commit that was merged) and the evidence named here supports closing it. Otherwise it is **open**. For a safeguard, three words and no others say how far it has got: **shown** (run, with evidence), **designed** (written, not run), **not done**. A design correction on paper never closes a finding about how the running system behaves.

## Where the findings came from

The owner's findings on the baseline reached the project in three places, all on 11 November 2026. None was posted as review text on the pull request. This register gathers them so that there is one audit trail.

1. **The owner's three corrections to the design note**, sent before the build plan. Correction 1 (acceptance tests) is finding A-1 below; correction 2 (the budget cap) is findings C-1 to C-4; correction 3 (the second engine) was a decision, not a finding, and is in `docs/DECISIONS.md`.
2. **Phase 0 of the build plan** (section 7.2), written by the owner: findings P-1 to P-6.
3. **Package 1.1 and package 1.5 of the build plan**, the owner's five amendments to the holds design and the unreconciled list: findings C-5 to C-10.

The first version of this file held only the Phase 0 findings, numbered 1 to 6. They are P-1 to P-6 here, in the same order.

## Part 1: Phase 0 findings

| # | Finding | What was wrong | Answered by | State, and the evidence |
| --- | --- | --- | --- | --- |
| P-1 | `docs/STATUS.md` had been added to session after session and no longer read as one current state; some statements contradicted others | A reader could not tell the current state from the history | Package 0.1 | **Open (reopened 12 Nov 2026).** Package 0.1 was marked tested on 11 Nov on a review of commit `805105f`; the merged commit `d69ebd1` had changed most of the file after that review. A re-check of the merged text on 12 Nov found statements that contradicted each other (designed safeguards stated as fact against the same file's note on host networking; "six findings open" beside two packages marked tested; a question that contradicted itself). `docs/STATUS.md` was rewritten again on 12 Nov. Closes when an independent reviewer has read the final commit of that rewrite and found no contradiction |
| P-2 | The second skeleton evidence file overstated what was shown: it read as if the project's isolation had been demonstrated, when only requests sent through the egress proxy were filtered, and the server profile was checked only as a configuration file, never run | An evidence file must claim only what was run, from where | Package 0.2 | **Closed 12 Nov 2026.** Evidence: `evidence/2026-11-11-skeleton-2/sandbox-egress.md` as merged at `542b68b`. Its title and text claim only that requests sent through the proxy were filtered, and it states that the server profile was checked as a configuration file and not run. A reviewer agent checked the text against the script and the test at `1c557ea`; the one sentence changed after that was re-read on 12 Nov with no finding; the independent assistant's review of `e0e22e6`, supplied by the owner, found that the report now distinguishes proxy filtering from container isolation. This closes the finding about the report's wording only. The isolation checks themselves are finding P-6, which is open |
| P-3 | The template's role guard did not stop an unauthorised request by itself: it returned a "denied" flag for the page to handle, treated an unrecognised role as the lowest role, and covered pages only, not form actions or data routes | Rule 5 says every screen checks the role before showing anything; a guard that can be forgotten or misread is not a guard | Package 0.3 | **Open.** Not done. Parked on L11 |
| P-4 | The licence check applied one rule to shipped dependencies and a weaker one to development tools | Hard rule 2 names no such split: every dependency is permissive, or named one by one in `docs/DECISIONS.md` | Package 0.4 | **Open.** Not done on the integration branch. Package 0.4 needs L9 and L11; L9 is true since 12 Nov, L11 is not (known gap 40). The `builder/` half was built on a branch ahead of that (pull request #9, not merged; known gap 42) |
| P-5 | Creating the app's tables and sample users ran on the machine that hosts the builder, with the host's whole environment | Hard rule 9: generated code and the engine run only in containers; set-up must not leak the builder's settings | Package 0.5 | **Open.** Not done. Package 0.5 needs L9 and L11; L9 is true since 12 Nov, L11 is not. Known gap 29 |
| P-6 | Isolation was asserted from the design, not checked from inside a workload container; the development profile shares the host's network and the report did not say plainly what is not isolated | A safeguard is shown, designed or not done, never implied | Package 0.6a (development profile); package 0.6b (server profile, when a server exists) | **Open.** The report's wording was corrected by package 0.2; the checks themselves are not done. Isolation on the development profile: not done and known not to hold (gaps 1 and 2). Isolation on the server profile: designed |

## Part 2: budget-control findings

The baseline's gateway has a working cap of an earlier kind: it sums what has been spent and estimates the next call from recent history. Every finding below is about that cap or about the holds design that replaces it. **For all ten, the design is corrected on paper and the running control is not done.** Package 1.1, which amended the design note, was reopened on 12 November and is built, not tested; even when it is tested again that closes nothing here, because each finding is about what the gateway does, and the gateway's code has not changed. The proof rows B1 to B14 are in design note 7.2.

| # | Finding | Source | Design: where it is corrected | Runtime control | Answered by, and its proof rows | State |
| --- | --- | --- | --- | --- | --- | --- |
| C-1 | Summing recorded cost before a call does not show that the next call fits. The cap must hold the worst-case cost of a call before it is forwarded, and refuse when spend plus open holds plus this hold exceeds the cap | Correction 2 | Designed: design note 5.5, the budget equation and the hold table | Not done. The baseline estimates from the last three calls (known gap 20) | Package 1.2: B1, B2 | **Open** |
| C-2 | A hold must be settled to the actual cost when the call completes | Correction 2 | Designed: 5.5, step 2 | Not done | Package 1.2: B1 | **Open** |
| C-3 | The cap must be safe for calls in flight at the same time. The baseline keeps its reservations in the gateway's memory, which does not survive a restart or hold across two gateway processes | Correction 2 | Designed: 5.5, steps 1 and 6 (one locked database transaction; holds as rows) | Not done as designed. The baseline serialises the check inside one process only (known gap 21) | Package 1.2: B6. Package 1.4: B8, B9, B13 | **Open** |
| C-4 | What happens to interrupted calls and expired holds was not defined; and a step could start without room to finish | Correction 2 | Designed: 5.5, steps 3 and 4, and "The pre-step check" | Not done | Package 1.2: B5. Package 1.3: B7. Package 1.4: B11 | **Open** |
| C-5 | A call cut off part-way must keep its full hold and be marked unreconciled. The first holds design settled it with the usage seen so far, which releases money on a guess, because the output count arrives late in the stream | Build plan 1.1, amendment (a) | Designed: 5.5, step 3 | Not done. The baseline records an abandoned stream with the usage seen | Package 1.4: B11, B13 | **Open** |
| C-6 | If the prompt cannot be counted, the call must be refused. The first holds design estimated from the request's size | Build plan 1.1, amendment (b) | Designed: 5.5, the hold table, "Input" | Not done | Package 1.2: B3 | **Open** |
| C-7 | The hold must allow for fast mode and the long-prompt rate whenever either could apply, not only when the request asks | Build plan 1.1, amendment (c) | Designed: 5.5, the hold table; the rates are in 5.2 | Not done. The baseline prices these after the fact, from the answer (known gap 23) | Package 1.2: B4 | **Open** |
| C-8 | A successful answer whose usage cannot be read must keep its full hold | Build plan 1.1, amendment (d) | Designed: 5.5, step 2 | Not done. The baseline records such a call at zero usage (known gap 16) | Package 1.4: B12, B13 | **Open** |
| C-9 | If a finished call cannot be saved, its hold must stay open and the project must make no further calls until it is reconciled | Build plan 1.1, amendment (e) | Designed: 5.5, step 5 | Not done. The baseline raises a fault and carries on | Package 1.4: B10, B13. Package 1.5: B14 | **Open** |
| C-10 | Holds kept at full value must be listed for the owner and closed only by his recorded action stating the actual cost and its evidence | Build plan, package 1.5 | Designed: 5.5, step 3 | Not done | Package 1.5: B14 | **Open** |

Related, and not the owner's findings: the fresh reviewer agent's findings on the baseline gateway of 11 November, which were fixed in the baseline's code at the time or recorded as known gaps 16, 17 and 20 to 24. They are in `docs/KNOWN-GAPS.md` and in the closed pull request #2. They are not repeated here because the gateway's cap is rebuilt by packages 1.2 to 1.5, whose reviews start from those gaps.

## Part 3: the acceptance-test finding

| # | Finding | Source | Design: where it is corrected | Runtime control | Answered by | State |
| --- | --- | --- | --- | --- | --- | --- |
| A-1 | The design said the engine never sees the acceptance tests, yet mounted them read-only in the engine's container. Read-only does not prevent reading. The tests must never be present in the engine's container, nor in the project's working copy or its git history; only the acceptance runner sees them; they join the app at export | Correction 1 | Designed: design note 2.4, 2.5, 2.7, 6.1 | Not done. No acceptance code exists (known gap 34) | Package 3.1 (all four parts of its "Done means"); package 3.2 for the export | **Open** |

## Count

Seventeen findings. Closed: one (P-2, a finding about a report's wording). Open: sixteen. No finding about how the running system behaves is closed.
