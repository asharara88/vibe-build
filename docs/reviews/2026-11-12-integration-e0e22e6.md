# Independent assistant review of the integration branch at commit `e0e22e6`, supplied by the owner

| | |
| --- | --- |
| Reviewed | Branch `claude/stage-1` at commit `e0e22e6`, after pull requests #3 to #6 were merged into it |
| Reviewer | **An independent assistant, not Claude Code and not the owner.** Its review was supplied by the owner, Ahmed Sharara, on 12 November 2026. The assistant inspected source, diffs and review records; it did not rerun the runtime tests or change the repository. An earlier version of this file named the owner as the reviewer; that was wrong and is corrected here |
| The owner's approval | **Not recorded.** The owner passed the review on and Claude Code acted on its three findings. He has not separately approved the review's conclusions or the corrections made in answer to it; that approval is his to give and is kept apart from the review |
| Outcome | Useful progress; the safeguards are still unimplemented. The changes were documentation and a wording-list generator; the product code is unchanged. Three tracking and execution issues to correct, then continue once the licence decisions unblock implementation. No basis to advance to real-model calls |

## What the reviewing assistant found to check out

| Pull request | The reviewing assistant's words, in short |
| --- | --- |
| #3 Status clean-up | The current state is substantially clearer |
| #4 Isolation evidence | The report now distinguishes proxy filtering from actual container isolation |
| #5 Budget design | The amendments retain uncertain holds, refuse uncountable prompts and freeze further calls after a failed accounting write. **These are design corrections, not demonstrated runtime controls** |
| #6 Arabic list | Compared independently against the source files: all 33 entries in each language match, including placeholders |

## Findings

| # | Finding | What answers it | State |
| --- | --- | --- | --- |
| 1 | The findings register (`docs/reviews/2026-11-11-pull-request-2.md`) was incomplete and stale: it still marked the completed documentation corrections open, and it held only the Phase 0 findings, leaving the earlier budget-control findings outside it | The register rewritten: every finding has a state and the evidence for it; the budget-control findings added as B-1 to B-10, each linked to packages 1.2 to 1.5 and to its proof rows; a finding is closed only where evidence supports it | Answered in the pull request that adds this file; see the register |
| 2 | Package 1.2's "Done means" was too broad: it required the rows of the design note's proof table, including rows that belong to later packages which themselves depend on 1.2 being tested | Design note 7.2: the budget rows split into B1 to B14, each assigned to exactly one package. Build plan, package 1.2: done means is now "proof rows B1 to B6, and only those" | Answered in the same pull request. The assignment of rows to packages was written by Claude Code and is the owner's to change or approve |
| 3 | The bot reviews do not cover the final merged revisions: the recorded bot reviews on pull requests #3 to #6 reference earlier commits, so "the bot found nothing" cannot stand for changes added afterwards | The table below, which says for each pull request which commit each review covered. The same was true of the reviewer agents, so the changes made after review were re-checked by a fresh reviewer agent on 12 November. A working rule is recorded in `docs/DECISIONS.md` | Answered; see below |

## Which commit each review covered (finding 3)

Times are from the commits and the review bot's own records, 11 November 2026, UTC.

| Pull request | Package | Commit the review bot read | Commit the reviewer agent read | Commit merged | Changed after both reviews, and so read by neither at merge |
| --- | --- | --- | --- | --- | --- |
| #3 | 0.1 | `805105f` (one finding, fixed) | `805105f` | `d69ebd1` | Three commits: the S1a and S1b wording; the licence-gate paragraph; the fixes for the reviewer's seven findings, which rewrote most of the file |
| #4 | 0.2 | `1c557ea` (no findings) | `1c557ea` | `542b68b` | One commit: one sentence reworded |
| #5 | 1.1 | `239efce` (no findings) | `239efce` | `a789551` | One commit: kept holds stay open; the price table in 5.2 extended; proof row (e) reworded; two terms explained; known gap 20 reworded |
| #6 | W4 | `2c029a6` (no findings) | `2c029a6` | `8016ff9` | One commit: the generator script added; a "Suggested changes" section added |

**What this means, stated plainly.** For all four pull requests, "the review bot found nothing" and "the reviewer's findings were fixed" were true of the commit that was reviewed, not of the commit that was merged. The pull request descriptions said "Open findings: none" without saying that the fixes themselves had not been read by anyone independent. That was an overstatement of what the reviews covered. On 12 November a correction was first posted as a comment on each of #3 to #6; an earlier version of this file said the descriptions themselves had been corrected, which was not yet true. The four descriptions were then edited the same day: each now opens with a dated correction naming the commit each review read and the result of the re-check, with the original text kept beneath it.

**The re-check of the final revisions.** A fresh reviewer agent, which did not write the documents, read exactly what changed between the reviewed commit and the merged commit for each package, and the final text. Its result is recorded in the next section. The review bot was not asked to review again: it reviews when a pull request is opened or marked ready, and these four are merged.

**The working rule from now on** (`docs/DECISIONS.md`, 12 November 2026): a package is marked tested only when the last commit an independent reviewer read is the commit that is merged. If anything changes after a review, the change is re-read by a reviewer before the merge, and the pull request names the commit each review covered.

## Result of the re-check of the final merged revisions

A fresh reviewer agent read, by commit, what changed between the reviewed commit and the merged commit for each package, and the final text. In short:

| Package | "Said to be fixed" items | New findings on the merged text | Would a careful owner call the "Done means" unmet? | Consequence |
| --- | --- | --- | --- | --- |
| 0.1 `docs/STATUS.md` at `d69ebd1` | Five of seven fixed; one fixed in form only (question 6); one partly fixed (terms) | Nine. The most serious: a sentence added by a fix described designed safeguards as fact ("the one way out of a project's containers", "which counts and caps spend"), contradicting the same file's note that containers share the host's network; "six findings open" beside two packages marked tested; question 6 offered options that overturned a recorded decision and contradicted itself; the statement of when a licence code becomes true left out that the licence check must also pass, and the template's check is red; the dependency rows left out L11 for packages 3.2 and 2.3 | **Yes, arguably:** "no statement contradicts another" was not met | **Package 0.1 reopened** (build plan section 8, rule 8). The file was rewritten on 12 Nov with each of the nine findings answered |
| 0.2 evidence file at `542b68b` | The one change confirmed, nothing else changed | None | No | Stays tested. Finding P-2 closed |
| 1.1 design note and known gaps at `a789551` | All four fixed; the price figures match the gateway's table exactly | Nine. The most serious: the hold's output part said only "the output rate", which would hold too little for a model with a long-prompt output rate, against amendment (c); the change of an expired hold from "settled" to "kept open" was not one of the five amendments, was not in the dated list, and contradicted a row in `docs/DECISIONS.md`; the note had the gateway writing a fault and a freeze to the database at the moment the database refuses writes; "can only over-count" was an assumption stated as fact; the new price figures were not in `docs/SOURCES.md` | Met to the letter; the owner could object that the note changed in more places than the list showed | **Package 1.1 reopened** for the defect inside amendment (c). Corrected on 12 Nov: the output rate; a dated list of every change beyond the five; the expired-hold change marked as awaiting the owner; the database-failure point recorded as needing an engineer (known gap 35); the price figures re-read from the saved page and recorded |
| W4 wording list at `8016ff9` | The script's output is identical to the committed document, byte for byte; 33 and 33, none missing | Three, all outside its "Done means": "every word a user would see" overstated (sample names and the framework's not-found page are English and not in the message files); one suggested Arabic word has a drawback of its own; the count compared keys only | No | Stays tested. The sentence corrected, the uncovered items listed and recorded as known gap 36, a second suggestion added, and the script now also counts empty and untranslated values |

The reviewer's findings are recorded in full in `docs/reviews/2026-11-12-recheck-of-merged-revisions.md`. Two of four packages that had been reported as tested with no open findings were not sound at the commit that was merged. That is what finding 3 warned of.

## Second review, of the work-in-progress commit `689da67`

| | |
| --- | --- |
| Reviewed | Branch `claude/tracking-corrections` at commit `689da67`, a work-in-progress commit |
| Reviewer | The same independent assistant; supplied by the owner on 12 November 2026 |
| The owner's approval | Not recorded; kept apart from the review, as above |
| Its assessment | The corrections are moving in the right direction. Finish the evidence and accurate status reporting before merging. No further broad plan rewrite is needed. Product code is unchanged, so the original runtime findings remain open |

| # | Finding | Answer |
| --- | --- | --- |
| 1 | The register contained placeholders (`STATE-P1`, `STATE-P2`, `COUNT-CLOSED`, `COUNT-OPEN`); the documentation findings lacked their closure decisions and evidence | True of `689da67`. The placeholders were filled in the next commit, `4b81c8d`: P-1 open (reopened), P-2 closed with its evidence, the count stated. No placeholder remains in `docs/` |
| 2 | Review completion was claimed ahead of its evidence: finding 3 was marked "Answered" and a re-check was said to have been done while the results section said "To be filled"; and the file said the earlier pull request descriptions had been corrected when they had not | True of `689da67`. The results section was filled in `4b81c8d`. The sentence about the descriptions was still wrong at `4b81c8d`: comments had been posted, the descriptions had not been edited. The descriptions have since been edited and the sentence corrected (above) |
| 3 | Review authorship was misattributed: the file said the owner inspected the source and independently checked the translations. Those checks were the assistant's, relayed through the owner | Corrected in this file, in the findings register, in `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/BUILD-PLAN.md` and the design note: the review is recorded as an independent assistant review, supplied by the owner, and the owner's approval is recorded separately as not yet given |

**What went wrong on Claude Code's side, plainly.** Commit `689da67` was pushed part-way through the work, with placeholders in it and with statements written ahead of the checks they described. A pushed commit can be read by anyone at any moment, and this one was. The working rule added to `docs/DECISIONS.md` on 12 November: nothing is pushed that contains a placeholder or that states a check as done before its result is in the same commit; unfinished work is pushed only when every unfinished part says "not yet done" in plain words.
