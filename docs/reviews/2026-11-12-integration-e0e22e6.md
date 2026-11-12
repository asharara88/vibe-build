# Owner's review of the integration branch at commit `e0e22e6`

| | |
| --- | --- |
| Reviewed | Branch `claude/stage-1` at commit `e0e22e6`, after pull requests #3 to #6 were merged into it |
| Reviewer | The owner, Ahmed Sharara, 12 November 2026. He inspected source, diffs and review records; he did not rerun the runtime tests or change the repository |
| Outcome | Useful progress; the safeguards are still unimplemented. The changes were documentation and a wording-list generator; the product code is unchanged. Three tracking and execution issues to correct, then continue once the licence decisions unblock implementation. No basis to advance to real-model calls |

## What the owner found to check out

| Pull request | The owner's words, in short |
| --- | --- |
| #3 Status clean-up | The current state is substantially clearer |
| #4 Isolation evidence | The report now distinguishes proxy filtering from actual container isolation |
| #5 Budget design | The amendments retain uncertain holds, refuse uncountable prompts and freeze further calls after a failed accounting write. **These are design corrections, not demonstrated runtime controls** |
| #6 Arabic list | Compared independently against the source files: all 33 entries in each language match, including placeholders |

## Findings

| # | Finding | What answers it | State |
| --- | --- | --- | --- |
| 1 | The findings register (`docs/reviews/2026-11-11-pull-request-2.md`) was incomplete and stale: it still marked the completed documentation corrections open, and it held only the Phase 0 findings, leaving the earlier budget-control findings outside it | The register rewritten: every finding has a state and the evidence for it; the budget-control findings added as B-1 to B-10, each linked to packages 1.2 to 1.5 and to its proof rows; a finding is closed only where evidence supports it | Answered in the pull request that adds this file; see the register |
| 2 | Package 1.2's "Done means" was too broad: it required the rows of the design note's proof table, including rows that belong to later packages which themselves depend on 1.2 being tested | Design note 7.2: the budget rows split into B1 to B14, each assigned to exactly one package. Build plan, package 1.2: done means is now "proof rows B1 to B6, and only those" | Answered in the same pull request. The assignment of rows to packages was written by Claude Code and is the owner's to change |
| 3 | The bot reviews do not cover the final merged revisions: the recorded bot reviews on pull requests #3 to #6 reference earlier commits, so "the bot found nothing" cannot stand for changes added afterwards | The table below, which says for each pull request which commit each review covered. The same was true of the reviewer agents, so the changes made after review were re-checked by a fresh reviewer agent on 12 November. A working rule is recorded in `docs/DECISIONS.md` | Answered; see below |

## Which commit each review covered (finding 3)

Times are from the commits and the review bot's own records, 11 November 2026, UTC.

| Pull request | Package | Commit the review bot read | Commit the reviewer agent read | Commit merged | Changed after both reviews, and so read by neither at merge |
| --- | --- | --- | --- | --- | --- |
| #3 | 0.1 | `805105f` (one finding, fixed) | `805105f` | `d69ebd1` | Three commits: the S1a and S1b wording; the licence-gate paragraph; the fixes for the reviewer's seven findings, which rewrote most of the file |
| #4 | 0.2 | `1c557ea` (no findings) | `1c557ea` | `542b68b` | One commit: one sentence reworded |
| #5 | 1.1 | `239efce` (no findings) | `239efce` | `a789551` | One commit: kept holds stay open; the price table in 5.2 extended; proof row (e) reworded; two terms explained; known gap 20 reworded |
| #6 | W4 | `2c029a6` (no findings) | `2c029a6` | `8016ff9` | One commit: the generator script added; a "Suggested changes" section added |

**What this means, stated plainly.** For all four pull requests, "the review bot found nothing" and "the reviewer's findings were fixed" were true of the commit that was reviewed, not of the commit that was merged. The pull request descriptions said "Open findings: none" without saying that the fixes themselves had not been read by anyone independent. That was an overstatement of what the reviews covered. The descriptions of #3 to #6 have been corrected to name the commit each review read.

**The re-check of the final revisions.** A fresh reviewer agent, which did not write the documents, read exactly what changed between the reviewed commit and the merged commit for each package, and the final text. Its result is recorded in the next section. The review bot was not asked to review again: it reviews when a pull request is opened or marked ready, and these four are merged.

**The working rule from now on** (`docs/DECISIONS.md`, 12 November 2026): a package is marked tested only when the last commit an independent reviewer read is the commit that is merged. If anything changes after a review, the change is re-read by a reviewer before the merge, and the pull request names the commit each review covered.

## Result of the re-check of the final merged revisions

To be filled from the reviewer's report before this file is merged.
