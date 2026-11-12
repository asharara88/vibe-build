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
| 1 | The findings register (`docs/reviews/2026-11-11-pull-request-2.md`) was incomplete and stale: it still marked the completed documentation corrections open, and it held only the Phase 0 findings, leaving the earlier budget-control findings outside it | The register rewritten: every finding has a state and the evidence for it; the budget-control findings added as C-1 to C-10, each linked to packages 1.2 to 1.5 and to its proof rows; a finding is closed only where evidence supports it | Answered in the pull request that adds this file; see the register |
| 2 | Package 1.2's "Done means" was too broad: it required the rows of the design note's proof table, including rows that belong to later packages which themselves depend on 1.2 being tested | Design note 7.2: the budget rows split into B1 to B14, each assigned to exactly one package. Build plan, package 1.2: done means is now "proof rows B1 to B6, and only those" | Answered in the same pull request. The assignment of rows to packages was written by Claude Code and is the owner's to change or approve |
| 3 | The bot reviews do not cover the final merged revisions: the recorded bot reviews on pull requests #3 to #6 reference earlier commits, so "the bot found nothing" cannot stand for changes added afterwards | The table below, which says for each pull request which commit each review covered. The same was true of the reviewer agents, so the changes made after review were re-checked by a fresh reviewer agent on 12 November. A working rule is recorded in `docs/DECISIONS.md` | Answered; see below |

## Which commit each review covered (finding 3)

The commits are from the repository. Which commit the review bot read is from the bot's own records on GitHub and cannot be checked from the repository.

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
| 0.1 `docs/STATUS.md` at `d69ebd1` | Five of seven fixed; one fixed in form only (question 6); one partly fixed (terms) | Nine. The most serious: a sentence added by a fix described designed safeguards as fact ("the one way out of a project's containers", "which counts and caps spend"), contradicting the same file's note that containers share the host's network; "six findings open" beside two packages marked tested; question 6 offered options that overturned a recorded decision and contradicted itself; the statement of when a licence code becomes true left out that the licence check must also pass, and the template's check is red; the dependency rows left out L11 for packages 3.2 and 2.3 | **Yes, arguably:** "no statement contradicts another" was not met | **Package 0.1 reopened** (build plan section 8, rule 8). The file was rewritten on 12 Nov. Eight of the nine findings were answered in it; the ninth (that the plan's licence codes can never become true by approval alone while the check that would pass depends on them) should have gone to the owner and was instead settled by a reading of Claude Code's, since withdrawn (see the review of `612d281` below) |
| 0.2 evidence file at `542b68b` | The one change confirmed, nothing else changed | None | No | Stays tested. Finding P-2 closed |
| 1.1 design note and known gaps at `a789551` | All four fixed; the price figures match the gateway's table exactly | Nine. The most serious: the hold's output part said only "the output rate", which would hold too little for a model with a long-prompt output rate, against amendment (c); the change of an expired hold from "settled" to "kept open" was not one of the five amendments, was not in the dated list, and contradicted a row in `docs/DECISIONS.md`; the note had the gateway writing a fault and a freeze to the database at the moment the database refuses writes; "can only over-count" was an assumption stated as fact; the new price figures were not in `docs/SOURCES.md` | Met to the letter; the owner could object that the note changed in more places than the list showed | **Package 1.1 reopened** for the defect inside amendment (c). Corrected on 12 Nov: the output rate; a dated list of the changes beyond the five (completed after the review of `612d281`, which found it short); the expired-hold change marked as awaiting the owner; the database-failure point recorded as needing an engineer (known gap 35); the price figures re-read and recorded (from a copy saved in the session, not kept in the repository; read again from the live page on 12 Nov) |
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

## Third review: a fresh reviewer agent on commit `612d281`

| | |
| --- | --- |
| Reviewed | Branch `claude/tracking-corrections` at commit `612d281`, everything changed since `e0e22e6`, read by commit |
| Reviewer | A fresh reviewer agent started by Claude Code under the build plan, section 3, step 6. It did not write the documents and did not see the author's conversation. Not the owner, and not the independent assistant of the two reviews above |
| Verdict | **Not ready to merge.** Seven blocking findings. Package 0.1's "Done means" unmet; finding P-1 cannot close. Package 1.1's "Done means" met to the letter, but one of its files still carried the defect that reopened it |
| What it confirmed | The register's count and each C- finding's proof rows; the closure of P-2; the proof-row assignment, consistent across five files; every commit in the table above; that no placeholder remains; the licence clauses and version table; that nothing outside `docs/` changed; that no file attributes the two reviews above to the owner |
| Not checkable from the repository | The comments and edited descriptions on pull requests #3 to #6; which commits the review bot read; the owner's words "a0 approved" |

| # | Finding | Blocking | Answer in the commit after `612d281` |
| --- | --- | --- | --- |
| 1 | LGPL packages in the template's shipped dependencies (`sharp`), recorded nowhere; four records wrongly said `caniuse-lite` was the only exception | Yes | Known gap 40; question 1 to the owner; gaps 27 and 32, `docs/OPEN-DECISIONS.md` and `docs/SOURCES.md` corrected |
| 2 | The register said package 1.1 "is tested" | Yes | Corrected: reopened, built, not tested |
| 3 | Package 0.4 started with its dependencies false, on Claude Code's authority | Yes | The reading is withdrawn in `docs/DECISIONS.md`; known gap 42; question 2 to the owner; 0.4 shown as parked; pull request #9 not merged |
| 4 | "The checks do not pass yet" was untrue of the builder's committed check, and no run was in the commit | Yes | `evidence/2026-11-12-licence-checks-as-committed/checks.md` holds the runs: the builder's check passes; the template's fails |
| 5 | Known gap 20 still said "`max_tokens` at the output rate" and treated expired holds as decided | Yes | Gap 20 corrected |
| 6 | Records stale after the approval of 12 Nov | Yes | Gaps 27, 32 and 39, `docs/OPEN-DECISIONS.md` and the plan's progress table updated |
| 7 | "B-1 to B-10" for the register's C- findings | Yes | Corrected |
| 8 | The hold is not a true worst case: `inference_geo`, the count being an estimate, server-side tools, unlisted fast mode; an error answer undefined | No | Design note 5.5, "Known limits of the hold"; known gap 41; the facts in `docs/SOURCES.md`; the handling recorded in `docs/DECISIONS.md` |
| 9 | B5 leaned on package 1.5; B7 exceeds the plan's wording for 1.3; B14 needs 1.4; no package named for amendments (a), (d), (e) | No | B5 reworded; B7 flagged; 1.5 taken after 1.4; 1.4 builds (a), (d), (e). The plan's dependency for 1.5 is listed for the owner |
| 10 | Two statements on whether package 1.2 waits for an engineer | No | One statement: it does not; gap 35 belongs to 1.4 and is read by the engineer at checkpoint 2 |
| 11 | Approvals that other files call the owner's were not asked in the status file | No | Listed in `docs/STATUS.md` under "Yours to confirm" |
| 12 | "Approved subject to corrections, which are in it" overstated | No | The status file and the design note's header now say what is and is not covered by the approval |
| 13 | Changes beyond the five amendments missing from the dated list; "one phrase" understated; "superseded" too broad | No | List completed; wording corrected; the decisions row narrowed |
| 14 | The approval row: a name pattern, not names; options not quoted; version binding; "absent from export" undefined | No | The eleven names listed and the options quoted; the two open points listed for the owner and in gap 39 |
| 15 | The commit subject of `4b81c8d` still says "the owner's review" | No | History is not rewritten. Recorded here: that subject is wrong; the review was the independent assistant's. Wherever those two reviews are cited in the repository, the owner's own approval of the corrections is not recorded |
| 16 | Terms explained late or not at all; "every other package"; "38 passing tests" stated without a run | No | The status file rewritten; the 38 tests were run on 12 Nov and passed |
| 17 | Small items: a table said to carry times; a "saved copy" not in the repository; install commands under the wrong heading; a heading dated 11 Nov; gaps "closed by rule"; a date in the Arabic list | No | Each corrected. One left as it is and recorded: the Arabic list's script states "on purpose" for any key whose two values are identical, which is true of the one such key today |

The reviewer's closing answers: package 0.1's "Done means" unmet at `612d281` (yes, unmet); package 1.1's unmet (no, met to the letter, but not to be marked tested until finding 5 was fixed); the evidence supports closing P-1 (no); nothing outside `docs/` changed. **This review read `612d281`. The commit that answers it has not been read by anyone independent when it is made**; under the working rule it is re-read before any merge.

## Fourth review: the re-read of commit `5e12c88`

| | |
| --- | --- |
| Reviewed | Branch `claude/tracking-corrections` at commit `5e12c88`, the answer to the third review, read by commit |
| Reviewer | Another fresh reviewer agent, started by Claude Code under the build plan and the working rule on reviews. It did not write the documents |
| Verdict | **Not ready to merge.** Of the seven earlier blocking findings, four answered and three partly. Five new blocking findings, all in records. Package 0.1's "Done means" still unmet; P-1 cannot close. Package 1.1's "Done means" met, but not to be marked tested while its findings 6 and 7 were open |
| What it confirmed | The licence-check runs, by re-running them; fourteen LGPL `@img` packages in the template's lock file, none development-only, three installed; the eleven `lightningcss` names; the Arabic list regenerated byte for byte; nothing outside `docs/` and `evidence/` changed; no placeholder, secret, time estimate or claim of security or compliance |
| Not read | Commit `ed36012` (the owner's decision on the hosted prototype agent), which was added while it worked |

| # | Finding | Blocking | Answer in the commit after `ed36012` |
| --- | --- | --- | --- |
| 1 | Package 0.4 was shown as parked while its defects were "being corrected on that branch"; work had continued after the reading was withdrawn | Yes | True. Two blocking defects were corrected on that branch on 12 Nov, after the withdrawal. Recorded in known gap 42 and the status file. **Work on pull request #9 is stopped** until the owner answers question 2 |
| 2 | `docs/OPEN-DECISIONS.md` item 10 still said "nothing LGPL is installed" and still recommended approving `psycopg` | Yes | Sentence removed; the item points to the status file's question 4 |
| 3 | "38 tests were run on 12 November and passed" had no output in the commit | Yes | `evidence/2026-11-12-baseline-tests/run.txt`: type check passed, 38 of 38 tests passed |
| 4 | The status file and known gap 32 gave the LGPL packages as the cause of the template's red check; the committed script refuses `caniuse-lite` first, so removing `sharp` alone cannot make L11 true; and that circularity had still not gone to the owner | Yes | Both sentences corrected; the evidence file rewritten with the commands exactly as in the scripts; the circularity is question 2 to the owner |
| 5 | The plan's progress table still said "Parked (L9)" for packages that can start, and "nine found, answered"; register row P-5 the same | Yes | Rows corrected |
| 6 | Proof row B4 could not be shown as written: no model has both a long-prompt rate and a listed fast-mode price | No | B4 split into two cases; listed among the changes at the end of 5.5 |
| 7 | The known limits of the hold have no proof rows; "a cut connection" was given to two packages; "settled in package 1.2" overstated | No | The note now says no proof row exists and that adding them is the owner's decision; the cut connection belongs to 1.4; the sentence reworded |
| 8 | "L9: True" stated flat | No | The row now says it rests on an unconfirmed reading of the owner's words and that the approval's conditions are not implemented |
| 9 | Five decisions bundled without choices; the handling of the known limits not listed | No | The handling is added to the list; the file says each is put as a question with choices when it becomes the next thing that holds work up. They remain a list for now |
| 10 | The note and the status file implied the unlisted changes were approved | No | Both now say none of the changes since the approval has the owner's recorded approval |
| 11 | Terms unexplained in the status file | No | Added to "Words used here" and to the licence rows |
| 12 | The evidence file abbreviated the commands and dropped one of the script's options | No | Rewritten with the commands in full; the code state named |
| 13 | Small items | No | Corrected: the model-key item in `docs/OPEN-DECISIONS.md`; "it costs nothing"; the other `@img` packages named; two lock-file rows moved out of the "live page" section of `docs/SOURCES.md`; "five closing answers"; known gap 39; the design note's "permissive licences: Both" and "added below"; two additions to 5.5 that were missing from the list |

**This review read `5e12c88`. The commits after it have not been read by anyone independent when they are made**; they are re-read before any merge.

## Fifth review: the re-read of commit `2c9cd7f`

| | |
| --- | --- |
| Reviewed | Branch `claude/tracking-corrections` at commit `2c9cd7f`, read by commit; it also read `ed36012` |
| Reviewer | Another fresh reviewer agent, started by Claude Code under the build plan and the working rule on reviews. It did not write the documents |
| Verdict | **Not ready to merge.** Of the fourth review's thirteen findings, ten answered and three partly. Three new blocking findings, all in records. Package 0.1's "Done means" still unmet; P-1 cannot close. Package 1.1: "Done means" met, and no remaining reason in the note's content not to mark it tested, once the commit read is the commit merged |
| What it confirmed | The licence-check runs, by re-running them; the lock-file counts; the type check; that package 0.4 and pull request #9 read the same everywhere (parked, stopped, not merged, with the owner); that nothing outside `docs/` and `evidence/` changed; no secret, placeholder, time estimate or claim of security, readiness or compliance |

| # | Finding | Blocking | Answer in the commit after `2c9cd7f` |
| --- | --- | --- | --- |
| 1 | The template's committed licence check skips every package whose name begins with `@` (175 of 267 read), so it never examined the LGPL packages; the evidence file gave a different, wrong explanation; recorded nowhere | Yes | Reproduced. The evidence file rewritten with the counts and the runs with and without the faulty option; known gap 43; known gap 40's sentence corrected; the status file's L11 row, the plan's progress row, register row P-4 and the decisions row now give all the causes |
| 2 | The status file's new list of words said "the gateway is the one door to the AI model", against "no safeguard is shown" and "meant to be the one door" four lines later | Yes | Reworded: "the part meant to be the one door"; "the part that filters the requests sent through it" |
| 3 | The status file said "two reviews in a row" and "the third version" after a fourth review | Yes | The counts are removed; the row points to this record |
| 4 | Single-cause wording for L11 in four other places | No | Corrected with finding 1 |
| 5 | The question to the owner about the licence codes was not a fair choice: a narrower option was missing, and one option asked him to "say how" | No | Rewritten as three options. The recommended one is the narrower option: enter the approved name in the template's existing check, which the approval's own conditions already call for |
| 6 | One change to the design note (the comparison table under decision D) was not in the dated list; the line above it still said every component is permissive | No | Row added; the sentence corrected |
| 7 | The hosted-agent row carried, under the owner's name, a sentence that was Claude Code's; it did not mention made-up data or what "no real model call" covers | No | The sentence removed; the notes marked as Claude Code's; the status file says "by this project" |
| 8 | The split of proof row B4 was labelled a correction although it changes what finishes package 1.2 | No | Relabelled as the owner's to approve or change |
| 9 | Small items: a pointer to the wrong item in `docs/OPEN-DECISIONS.md`; "the outcome is recorded in the status file" when it was not; "the rest are corrections"; a plan progress row; "a timeout" given to the wrong package; three terms unexplained | No | Corrected |

Left as they are and said here: the list "Yours to confirm" in the status file is still a list, not separate questions with choices; the saved test run holds summary lines, not the full output; four lines of the status file are long.

**This review read `2c9cd7f`. The commit that answers it also brings in the record of the owner's decision to remove `sharp` (package R1, on its own branch). It has not been read by anyone independent when it is made**; it is re-read before any merge.

## Sixth review: the re-read of commit `07a953a`

A fresh reviewer agent read `07a953a` by commit and re-ran the licence commands. **Verdict: not ready to merge**, for two one-sentence points; it also made eleven non-blocking findings and confirmed the rest. Fifth-review findings: seven answered, two partly.

| # | Finding | Blocking | Answer in the commit after `07a953a` |
| --- | --- | --- | --- |
| 1 | The status file's question on the second stack gave as its reason "nothing in the queue waits on it", against the same file's table, where package S1a waits on exactly that | Yes | The reason now says what waits on it and that nothing able to start today is held up |
| 2 | The plan's progress row for 0.1 said "three reviews" | Yes | The count is removed from the plan's row and from the status file's opening line |
| 3 | The recommended option of the question on the template's licence condition left out three consequences, and claimed a step more than the record shows | No | The three consequences are stated in the option; the wording is "as recorded" and names the unconfirmed reading it rests on |
| 4 | R1's evidence was cited as if present on this branch | No | The plan's row and known gap 40 name the branch and the pull request |
| 5 to 13 | Known gap 32's "two reasons"; stale pointers; the exact-name weakness of the development-tools rule not in the gaps file; Claude Code's readings in the owner's `sharp` row; "carried" where the integration branch still carries; `sharp` and "lock file" unexplained; a caveat on "L9 is true" in the evidence file; "a sealed box"; the order of the next packages | No | Each corrected. Not changed: two counts in the evidence file are shown without the command that produced them |

Earlier answers in this file cite the status file's questions by the numbers they had at the time; the numbers have since shifted as questions were answered.

**This review read `07a953a`. The commit that answers it is re-read before any merge.**

## Seventh review: the re-read of commit `492370c`, and the merge

A fresh reviewer agent read the diff `07a953a..492370c` line by line and then the whole status file once more, all by commit. **Verdict: no blocking finding; `492370c` may be merged as read.** Its answers: both blocking findings of the sixth review answered; package 0.1's "Done means" met (113 lines, no contradicting pair); package 1.1's met, with no remaining reason not to mark it tested; the evidence supports closing register finding P-1, each provided `492370c` is the commit merged.

**Pull request #7 was merged into `claude/stage-1` on 12 November 2026 at `492370c`** (merge commit `6c22782`; the merged content is identical to `492370c`). Packages 0.1 and 1.1 are tested again as of that commit, and P-1 is closed.

Its nine non-blocking findings, answered in the record update made after the merge (a separate pull request, read by a reviewer before it is merged):

| # | Finding | Answer |
| --- | --- | --- |
| 1 | The status file said `VIBEBUILD_KEY` is on the "Default" environment; read after the commit, it is on "vibe-build" and not on "Default" | When the file was written the variable was on "Default": Claude Code read the environment that morning and its name was listed there. Later the same day its name was seen on "vibe-build" and no longer on "Default"; who moved it is not recorded. Read again after the merge: on "vibe-build" only. The status file's question and its Money row are corrected |
| 2 | "Nothing in the queue needs a key" beside a table row where package 2.3 needs the key | Reworded: nothing that can start before checkpoint 1 needs a key |
| 3 | The order of the next packages after 2.1 was not the plan's | The next-session paragraph now follows the plan's order |
| 4 | Whether the demonstration run may stand in for R1's "existing tests" was called the owner's but asked nowhere | Added to "Yours to confirm", and named in the option that would merge R1 |
| 5 | "The lock file now lists no LGPL package" beside "the template carries LGPL packages" | "On that branch" added |
| 6 | Pull request #7's description was three reviews behind | Brought up to date before the merge; it names the commit each review read |
| 7 | A review result (of R1) was pushed four minutes before it was on record anywhere | True. Recorded in known gap 38, which stays open |
| 8 | "At the latest with the checkpoint 2 pack" beside packages that cannot start until the owner decides | Reworded: at the latest before package 3.3 can start |
| 9 | Wording in this file: "everything else confirmed" above eleven findings; "here" for another file | Corrected |

Also noted by the reviewer: a set-up script on both cloud environments, `openrouter.ai` among the allowed hosts, and three variables on "Default" that are not this project's. The script on "vibe-build" was put there by another session of this project with the owner's approval (pull request #8, open, not merged); the rest was not looked into. The reviewer read the repository as public.

**On "no contradicting pair".** Three of the nine findings are worded "X beside Y" (2, 5 and 8). The reviewer judged that none was an actual contradiction: in each case the two statements were true together once read in full, and the wording was loose. The reviewer's own report is not saved in the repository; this section is Claude Code's summary of it.

**The review bot.** Pull request #7 was marked ready for review at 08:58 UTC and merged at 08:58:55. The review bot read `492370c` and finished at 08:59:49 with no findings, 54 seconds **after** the merge. The commit it read is the commit merged, but the merge did not wait for it. From now on a pull request is not merged until the bot's review of its head has finished.

## Review of the record update (commit `ba17011`, pull request #11)

A fresh reviewer agent read `ba17011` against the integration branch. It verified that the merged content of pull request #7 is identical to `492370c`, and answered: packages 0.1 and 1.1 are rightly marked tested as of `492370c`; P-1 is rightly closed, on the qualification now written into the P-1 row. **It said `ba17011` should not be merged as it stood**, for three one-sentence points:

| # | Finding | Blocking | Answer in the next commit |
| --- | --- | --- | --- |
| 1 | The register's introduction to Part 2 still said package 1.1 is "built, not tested" | Yes | Corrected; the register's header updated |
| 2 | "Not set by this work: a set-up script on both environments" was contradicted by the project's own pull request #8, from another session | Yes | The status file and this record now say where the "vibe-build" script came from and what was not looked into |
| 3 | "Whether it is public was not re-checked" beside "the reviewer read the repository as public" | Yes | The question now says it was read as public |
| 4 | For 0.1 and P-1, "findings closed" is met by the record update, not at `492370c` alone | No | Said in the P-1 row and the status file's 0.1 row |
| 5 | The tested marks rest on Claude Code's summary of the seventh review; three findings were worded as pairs | No | A paragraph above says why the reviewer did not count them as contradictions |
| 6 | The recommendation on `VIBEBUILD_KEY` had flipped to "leave it", leaving out three reasons against | No | The recommendation is "remove it until checkpoint 1" again, with the three reasons; "only its name has been seen" |
| 7 | Known gap 37 was closed although the pull request's description had no row for the review bot | No | The bot's row is in pull request #7's description (it was added on 12 Nov after the re-read of this update found it still missing, although an earlier version of this row said it was there); the paragraph above records that the merge came before the bot's result. Gap 37's closing text is corrected |
| 8 | "First in the plan's order whose dependencies are met" was not literally true (R1 comes earlier) | No | Reworded |
| 9 | What finishes package 1.2 was listed for the owner, not asked | No | It is now question 2, to be answered before 1.2 is marked tested |
| 10 | The status file named the prefix of variables belonging to the owner's other work, in a public repository | No | Removed from the status file and this record. It remains in the history of commit `ba17011`, which is not rewritten |
| 11 | With status updates going through their own pull request, a session could start on a stale status file | No | The decisions row now says which branch to read |

**The re-read of `350bfe7`.** A second fresh reviewer read `350bfe7`. The three blocking findings above: all answered. It found two new blocking points, both answered in the next commit: the plan's progress row still said package 1.2 was "not started" while the status file said work on it had begun (package 1.2 is now built on its own branch, pull request #12, and both say so); and this record said the review bot's row had been added to pull request #7's description when it had not (it has been now). Its non-blocking findings, also answered: two sentences spoke of this update's merge in the past tense; "first in the plan's order" survived in one place; the next-session order ignored that packages needing 1.2 tested wait on the owner; the question on what finishes 1.2 was loose in four places; one place still said the owner moved the variable. Left as it is and said here: the rule on which branch a new session reads does not yet reach a session through `CLAUDE.md`, which is the owner's file; the open pull requests' descriptions say what comes next.
