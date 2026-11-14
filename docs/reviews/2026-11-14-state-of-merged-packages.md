# Seven merged packages still recorded "built, not tested": do they meet the plan's conditions? (14 November 2026)

Written by Claude Code from the report of one fresh, read-only reader. It did not write any of the seven packages and saw no author's conversation. It read, for each package: its progress row and "Done means" in `docs/BUILD-PLAN.md`, its evidence file, its gaps in `docs/KNOWN-GAPS.md`, `docs/DECISIONS.md`, and its pull request on GitHub (description, reviews, every review thread, every comment). It ran nothing. Sources were read at `claude/stage-1`, commit `e6bf03d`.

**Why it was asked.** The plan (section 3, steps 6 to 9; section 8, rule 1) says a package is "tested" when its "Done means" was run and passed, an evidence file exists, it was reviewed as the plan requires, and its pull request merged with no open finding that is blocking. Seven packages are merged, and the progress table still says "built, not tested" for each. Package 3.2 depends on 3.1 being tested.

**This file changes no package's state.** It is evidence for whoever marks them, and for the owner. The verdicts marked "inference" are the reader's reading of the plan's words, not something a record says.

## Result

| Package | Pull request | Verdict | The deciding point |
| --- | --- | --- | --- |
| 3.1 Acceptance store and runner | #29 | **Met** | Nothing blocking was open at the merge, or is now |
| 1.4b Unreadable journal line | #33 | **Met** | Measured against the outside review's required fix; it has no "Done means" in plan section 7 |
| 3.1b Browser acceptance required | #34 | **Met** | The same; one clause of its own wording is narrowed by gap 112 |
| 1.4c A bill above its hold freezes the project | #35 | **Not met as merged; arguably met since 14 Nov** (inference) | Gap 145, a further call forwarded before the freeze, was open at the merge. Pull request #42 closed it on 14 Nov |
| 0.6c The development profile's network boundary | #36 | **Not met on the literal wording** (inference) | "Done means" asks for the probe "run in each of those containers". It ran in stand-in images placed as those containers are placed, not inside them |
| J1 The owner's journey | #37 | **Unclear** | Its "Done means" is one automated run. That run was not repeated after the last two code changes, and its own row says "tested once the fixes are re-read"; no record shows them re-read |
| J3 Live preview | #38 | **Unclear** | No "Done means" is written for it anywhere, and the owner's phone test (M1) has not been run |

## Facts that apply to all seven

- Every review thread on all seven pull requests is resolved, and no comment is unanswered.
- No record for any of the seven calls an open finding "blocking" at its merge.
- No automated checks run on GitHub for this repository. "Every required check passes" rests on checks run locally.
- No review file exists under `docs/reviews/` for any of the seven. Each review is known only from its author's summary in the evidence file and the pull request; the reviewers' own reports were not kept.
- A standing rule of 12 Nov (`docs/DECISIONS.md`, Claude Code's) says a package is marked tested only when the last commit an independent reviewer read is the commit that is merged. None of the seven meets it as written: for 3.1, 1.4c and 0.6c only the review bot read the merged commit, and for the other four nothing did. The owner's later rule (13 Nov: at most two review rounds) pulls the other way. **Which rule governs is not recorded. That is the owner's to say.**
- Three packages have no "Done means" in plan section 7: 1.4b, 3.1b and J3.
- Three whole-suite runs are claimed at the merged commits with no kept output: 3.1 (368 of 368), 1.4b (482 of 482) and 3.1b (455 of 455). Later kept runs cover the same code: 749 of 749 on 14 Nov (`evidence/2026-11-14-fix-signoff-live/`), and 744 of 749 with the five failures being known gap 162, then fixed (`evidence/2026-11-14-sandbox-test-tmpdir/after-merge-with-269fdec/`).

## Points worth the owner's or an engineer's eye

1. **0.6c.** Its result line says "each of the six project containers matched its expected list exactly" without saying the probe ran in stand-in images. The record's own reasoning is that a container's network comes from the Compose file, not from its image. That may be right; it is a narrower thing than "Done means" asks, and the plan (section 3, step 8) says a narrower description does not finish a package. Package 2.3, the first real-model run, depends on 0.6c.
2. **1.4c.** Still open after gap 145's fix: gap 146 (one call admitted just before the freeze can be forwarded; no test covers it) and gap 170. "Package 1.5 able to clear it" was built as a separate recorded action, `--overrun`; the owner has not confirmed that reading.
3. **1.4b, gap 107.** With `--no-hold`, an unreadable journal line is set aside with no freeze and no event, so after a restart every project runs again. The evidence says this waits for the owner's yes. No line in `docs/QUESTIONS.md` asks him.
4. **J3 and the phone test.** The design puts the phone test first ("M1. The phone (first; needs the owner)"). J3 was built before it, with the live preview kept off behind a setting, which the owner's decision of 13 Nov allows. No line says whether the phone test is needed for "tested" or only for turning the preview on. Marking J3 tested would mark it tested with its deciding measurement not run.
5. **J1.** The whole suite exercises the journey on stand-in sandboxes. The run on real containers, 54 of 54, was on a commit two code changes before the merged one.

## What the reader could not read

The outside review of `14787d8` itself (only the owner's quoted instructions are in the record); the reviewers' own reports for the seven; the raw outputs of the unkept runs; pull requests #41 to #43 on GitHub (their local evidence was read).
