# The marks of the merged packages, checked before they were written (14 November 2026)

Written by Claude Code from the reports of nine fresh readers. Their own reports, as returned, are kept in `evidence/2026-11-14-marks-checked/readers-reports.json`.

**Why it was asked.** On 14 Nov the owner answered "Fix it" to a status message that listed, among other things, the question of which rule decides when a package is "tested". Claude Code read that as his taking the recommended option, the plan's own rule (`docs/DECISIONS.md`, 14 Nov), and drafted new marks for the eight merged packages still recorded "built, not tested": six tested (3.1, 3.1b, 1.4b, 1.4c, J1, J2), two kept as built (0.6c, J3). A mark of "tested" that the record does not support breaks hard rule 7, so the draft was given to fresh readers to refute before it was committed.

**Who read, and how.** Nine fresh readers, one per row and one for the status, questions and decisions files. None wrote any of the packages and none saw an author's conversation. Each was told to try to refute, and to count a sentence as unsupported when it could not be traced to a file. They read files and git history at `839be17`, with the draft as uncommitted edits. **They ran nothing**, and they did not read the pull requests on GitHub.

**Result: the draft was withdrawn.** Two of its six marks did not hold, one sentence in a third row was false, and every row had wording that said more than its file.

## Row by row

| Row | Draft mark | Reader's verdict | What was done |
| --- | --- | --- | --- |
| 3.1 | Tested | Supported. The demonstration of its four "Done means" items had not been run since `0b8128b`, before later changes to the runner and the script | **Marked tested.** The demonstration was run again on the merged code first: all four items, and 65 attempts and checks, 55 from inside the engine container and 10 on the machine, none of which reached the tests (`evidence/2026-11-14-marks-checked/package-3.1/`) |
| 3.1b | Tested | Supported, but on three readings that are Claude Code's. The weakest: that one fresh review is enough, because 3.1b is "other code" and not "acceptance separation", although it changes when an acceptance run counts as passed | **Not marked yet.** Two fresh reviewers read that change adversarially the same day and found nothing blocking (`docs/reviews/2026-11-14-adversarial-readings-j1-3.1b.md`); the mark waits for the fix of its one serious point |
| 1.4b | Tested | Supported. One judgement is left to the owner or an engineer: whether known gap 107 (`--no-hold`) leaves the outside review's point unmet | **Marked tested**, with that point stated in the row and in `docs/QUESTIONS.md` |
| 1.4c | Tested, "as of 14 Nov" | **Not supported.** Gap 145 was open at its merge, so the rule as quoted gives "not tested"; counting a gap closed by a later pull request was a further reading. And "package 1.5 able to clear it" is met only on a reading the owner has not confirmed (`--overrun`) | **Kept built, not tested.** Both points are put to the owner under "Yours to confirm" |
| 0.6c | Stays built | Supported. The draft said the real-container run was "in a pull request of its own"; no such pull request existed | Kept built. Wording corrected |
| J1 | Tested | **Not supported.** J1's own design asks for the export's copy of tests and the cameras' mounts to be reviewed adversarially. The record shows one fresh review, an independent check and the review bot; nothing says any reading was adversarial | **Kept built, not tested.** Four fresh reviewers made those two adversarial readings the same day and found nothing blocking (the same file); the mark waits for the fixes of their serious points. Its automated run was repeated on the merged code: 54 of 54 (`evidence/2026-11-14-marks-checked/j1/`) |
| J3 | Stays built | Supported. The draft counted 20 screenshots in a folder holding 3, and called `835f483` "today's code" | Kept built. Its run was repeated on the merged code, 46 of 46 by the run's own total (its log prints 45 lines marked PASSED), with all 20 screenshots kept (`evidence/2026-11-14-marks-checked/j3/`) |
| J2 | Tested | Supported, with one false sentence: the draft cited a check by the first reader, whose file does not cover J2. It also said the automated run was "on the merged code" (it was on `abe41e5`, which differs by four lines of one test) and that the other session had agreed to the mark, which no file shows | **Marked tested**, after its automated run and controls were repeated on pull request #51's own code, which changes its removal of containers. The false sentence and the two overstatements removed; the row now gives the commit of each figure and what no reviewer read |

## What the readers found in every row

1. **The rule was presented as the owner's.** He wrote two words. The rule is Claude Code's reading of them, and it sets aside part of a rule recorded in `docs/DECISIONS.md`, which the plan (section 4) lists among the things that are always the owner's. *Done:* one note above the progress table says whose reading it is, that the owner has not confirmed it, and what it sets aside; every mark points to it. It is the first item under "Yours to confirm".
2. **"The whole suite passed on the integration branch."** It passed on `51a68d3`, the last code commit of pull request #49. The integration branch at `839be17` holds the same `builder/` folder, so the code is the same; the place was wrong. The first run that day, which was red, was left out. *Done:* the note gives the commit, the reason the code is the same, and the red run.
3. **"Checked by a fresh, read-only reader."** True for seven packages, with limits the rows left out: that reader ran nothing, read at `e6bf03d`, and Claude Code wrote its file. *Done:* stated in the note.
4. **Stale cells in the same rows.** The pull requests of 3.1b, 1.4b, 1.4c and 0.6c were still shown as open or not opened; J2's as opened; 1.4c's, J1's and J3's open findings were out of date. *Done:* each corrected, with the merge commit; the earlier text is kept beside it except in J1's and J3's open-findings cells, which were rewritten.
5. **Reviews known only from their authors' summaries.** For every package marked before 14 Nov, the reviewers' own reports were not kept. *Done:* stated in the note. This file's readers' reports are kept.

## What the reader of the shared records found

- The status file contradicted itself on the two pieces of work on side branches ("being built" and "built, in review"), and neither was pushed. *Done:* reworded to what is true.
- The status file's "Checked on pull request #49 (`51a68d3`)" covered five figures, of which one was measured on that commit. *Done:* each figure now has its commit.
- "Built, not tested" left out R1 and the day's fixes. *Done:* both are back.
- The "Tested" list gave no word on what kind of result 3.1 and the journeys are (scripted engine, stand-in test). *Done.*
- "A 'Simulated build' button": that is the panel's title; the button reads "Start the broken-copy demonstration". *Done.*
- Questions 20 and 22 were removed from `docs/QUESTIONS.md` with their options kept nowhere. *Done:* the options are given in short in the decision row; word for word they are in `docs/QUESTIONS.md` at commit `839be17`.
- The plan's section 8, rule 13 rules out a pull request for records alone. *Done:* these records ride in the pull request of known gap 180's fix.

## A second check, of the rewritten records

Two more fresh readers read the rewritten records as first committed (`6f0c5b3`), one the progress table, one everything else. They ran nothing. Every figure, commit and pull request number they traced matched its kept output or git. They found 19 more points they called blocking and 17 smaller ones; all were about what a sentence claims; no count of a run was wrong. The ones that mattered:

- **The three marks rest on one more reading.** The plan's words for an adversarial review are "fresh reviewers, each serious finding challenged by others". For 3.1, 1.4b and J2 the blocking findings were accepted and fixed; none was challenged by a second reviewer. *Done:* stated in the note above the table as Claude Code's reading, in the decision row, and put to the owner under "Yours to confirm".
- **J2 was marked in the pull request that changes J2's own removal code** (the plan's section 8, rule 8). *Done:* its automated run and all its controls were repeated on that code before the mark; the row gives the result.
- **The note called the whole rule "the plan's own".** Its last clause, fixes shown by tests, is Claude Code's wording. *Done:* reworded, with exactly which sentences of the rule of 12 Nov are set aside.
- **"Every serious point needs something today's builder does not have"** was false for three of the eight, and one can happen today (J3's automated run removes every sandbox folder in its temporary folder). *Done:* corrected in the review file and gap 188; a decision row sets how that run is started until it is fixed.
- **Row 185 still said "Not done"** although the same pull request changed the tests' database clean-up. *Done.*
- Smaller: where the 65 attempts were made from; "two marks not made" (it was three); gap 73 called closed; the builder camera's mounts called "shown" though it was not started; "eight" ways where the challenger corrected to seven; a time limit stated for every removal command; question 28's "every screen says what is left". *Done*, each where it stood.

## Not acted on, and why

- **Older evidence files that still say "State: Built, not tested"** (1.4b, 1.4c, 3.1b, 0.6c) and gap texts written before a merge. The plan's section 8, rule 14 says older records are not rewritten; the progress table is the place that states a package's state.
- **A third review round for the packages marked.** The plan allows two. What the record did not show, J1's two adversarial readings and one of 3.1b, was done the same day (`docs/reviews/2026-11-14-adversarial-readings-j1-3.1b.md`); nothing else was re-reviewed.
- **A challenged adversarial reading of 3.1, 1.4b and J2.** Not made: it would be a third round for each. The reading the marks rest on instead is stated and put to the owner.
- **Explaining "controls", "type check" and "the real-model gate" in the status file.** It is at its 400-word limit; each is explained in the plan.
- **Naming an engineer in rows 187 and 188.** The status file lists them for an engineer's reading because they are security gaps; the rows say "fix planned".

## Limits of this check

The eleven readers ran nothing and read nothing on GitHub: that every review thread is resolved rests on the first reader's file. That the owner said "Fix it" rests on the decision row; the status message he answered is not in the repository. One reader saved a listing of the remote's branches to a scratch file outside the repository, against its brief; nothing in the repository was changed.
