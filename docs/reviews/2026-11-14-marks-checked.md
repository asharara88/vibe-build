# The marks of the merged packages, checked before they were written (14 November 2026)

Written by Claude Code from the reports of nine fresh readers. Their own reports, as returned, are kept in `evidence/2026-11-14-marks-checked/readers-reports.json`.

**Why it was asked.** On 14 Nov the owner answered "Fix it" to a status message that listed, among other things, the question of which rule decides when a package is "tested". Claude Code read that as his taking the recommended option, the plan's own rule (`docs/DECISIONS.md`, 14 Nov), and drafted new marks for the eight merged packages still recorded "built, not tested": six tested (3.1, 3.1b, 1.4b, 1.4c, J1, J2), two kept as built (0.6c, J3). A mark of "tested" that the record does not support breaks hard rule 7, so the draft was given to fresh readers to refute before it was committed.

**Who read, and how.** Nine fresh readers, one per row and one for the status, questions and decisions files. None wrote any of the packages and none saw an author's conversation. Each was told to try to refute, and to count a sentence as unsupported when it could not be traced to a file. They read files and git history at `839be17`, with the draft as uncommitted edits. **They ran nothing**, and they did not read the pull requests on GitHub.

**Result: the draft was withdrawn.** Two of its six marks did not hold, one sentence in a third row was false, and every row had wording that said more than its file.

## Row by row

| Row | Draft mark | Reader's verdict | What was done |
| --- | --- | --- | --- |
| 3.1 | Tested | Supported. The demonstration of its four "Done means" items had not been run since `0b8128b`, before later changes to the runner and the script | **Marked tested.** The demonstration was run again on the merged code first: all four items, and 65 attempts to reach the tests, none of which got through (`evidence/2026-11-14-marks-checked/package-3.1/`) |
| 3.1b | Tested | Supported, but on three readings that are Claude Code's. The weakest: that one fresh review is enough, because 3.1b is "other code" and not "acceptance separation", although it changes when an acceptance run counts as passed | **Not marked yet.** An adversarial reading of that change was started the same day; the mark waits for it |
| 1.4b | Tested | Supported. One judgement is left to the owner or an engineer: whether known gap 107 (`--no-hold`) leaves the outside review's point unmet | **Marked tested**, with that point stated in the row and in `docs/QUESTIONS.md` |
| 1.4c | Tested, "as of 14 Nov" | **Not supported.** Gap 145 was open at its merge, so the rule as quoted gives "not tested"; counting a gap closed by a later pull request was a further reading. And "package 1.5 able to clear it" is met only on a reading the owner has not confirmed (`--overrun`) | **Kept built, not tested.** Both points are put to the owner under "Yours to confirm" |
| 0.6c | Stays built | Supported. The draft said the real-container run was "in a pull request of its own"; no such pull request existed | Kept built. Wording corrected |
| J1 | Tested | **Not supported.** J1's own design asks for the export's copy of tests and the cameras' mounts to be reviewed adversarially. The record shows one fresh review, an independent check and the review bot; nothing says any reading was adversarial | **Kept built, not tested.** Those two adversarial readings were started the same day. Its automated run was repeated on the merged code: 54 of 54 (`evidence/2026-11-14-marks-checked/j1/`) |
| J3 | Stays built | Supported. The draft counted 20 screenshots in a folder holding 3, and called `835f483` "today's code" | Kept built. Its run was repeated on the merged code, 46 of 46, with all 20 screenshots kept (`evidence/2026-11-14-marks-checked/j3/`) |
| J2 | Tested | Supported, with one false sentence: the draft cited a check by the first reader, whose file does not cover J2. It also said the automated run was "on the merged code" (it was on `abe41e5`, which differs by four lines of one test) and that the other session had agreed to the mark, which no file shows | **Marked tested.** The false sentence and the two overstatements removed; the row now gives the commit of each figure and what no reviewer read |

## What the readers found in every row

1. **The rule was presented as the owner's.** He wrote two words. The rule is Claude Code's reading of them, and it sets aside part of a rule recorded in `docs/DECISIONS.md`, which the plan (section 4) lists among the things that are always the owner's. *Done:* one note above the progress table says whose reading it is, that the owner has not confirmed it, and what it sets aside; every mark points to it. It is the first item under "Yours to confirm".
2. **"The whole suite passed on the integration branch."** It passed on `51a68d3`, the last code commit of pull request #49. The integration branch at `839be17` holds the same `builder/` folder, so the code is the same; the place was wrong. The first run that day, which was red, was left out. *Done:* the note gives the commit, the reason the code is the same, and the red run.
3. **"Checked by a fresh, read-only reader."** True for seven packages, with limits the rows left out: that reader ran nothing, read at `e6bf03d`, and Claude Code wrote its file. *Done:* stated in the note.
4. **Stale cells in the same rows.** The pull requests of 3.1b, 1.4b, 1.4c and 0.6c were still shown as open or not opened; J2's as opened; 1.4c's, J1's and J3's open findings were out of date. *Done:* each corrected, with the merge commit and the earlier text kept.
5. **Reviews known only from their authors' summaries.** For every package marked before 14 Nov, the reviewers' own reports were not kept. *Done:* stated in the note. This file's readers' reports are kept.

## What the reader of the shared records found

- The status file contradicted itself on the two pieces of work on side branches ("being built" and "built, in review"), and neither was pushed. *Done:* reworded to what is true.
- The status file's "Checked on pull request #49 (`51a68d3`)" covered five figures, of which one was measured on that commit. *Done:* each figure now has its commit.
- "Built, not tested" left out R1 and the day's fixes. *Done:* both are back.
- The "Tested" list gave no word on what kind of result 3.1 and the journeys are (scripted engine, stand-in test). *Done.*
- "A 'Simulated build' button": that is the panel's title; the button reads "Start the broken-copy demonstration". *Done.*
- Questions 20 and 22 were removed from `docs/QUESTIONS.md` with their options kept nowhere. *Done:* the options are quoted in the decision row.
- The plan's section 8, rule 13 rules out a pull request for records alone. *Done:* these records ride in the pull request of known gap 180's fix.

## Not acted on, and why

- **Older evidence files that still say "State: Built, not tested"** (1.4b, 1.4c, 3.1b, 0.6c) and gap texts written before a merge. The plan's section 8, rule 14 says older records are not rewritten; the progress table is the place that states a package's state.
- **A third review round for the packages marked.** The plan allows two. What the record did not show at all, J1's adversarial readings, is being done; nothing else was re-reviewed.

## Limits of this check

The nine readers ran nothing and read nothing on GitHub: that every review thread is resolved rests on the first reader's file. That the owner said "Fix it" rests on the decision row; the status message he answered is not in the repository. One reader saved a listing of the remote's branches to a scratch file outside the repository, against its brief; nothing in the repository was changed.
