# Re-check of the merged revisions of packages 0.1, 0.2, 1.1 and W4

| | |
| --- | --- |
| Why | Finding 3 of the independent assistant's review supplied by the owner on 12 November 2026: the recorded reviews of pull requests #3 to #6 covered earlier commits than the ones merged |
| Reviewer | A fresh reviewer agent that did not write the documents and did not see the author's conversation. Read-only; everything read by commit hash at `claude/stage-1` commit `e0e22e6` |
| What it read | For each package, the difference between the reviewed commit and the merged commit, and the final text |
| This file | The reviewer's findings, condensed from its report without changing their sense. Line numbers are those of the files at `e0e22e6` |

## Package 0.1: `docs/STATUS.md`, reviewed `805105f`, merged `d69ebd1`, 87 lines

Items said to be fixed: (1) engine adapter parked on the key: fixed. (2) 0.4 and 0.5 need both L9 and L11: fixed. (3) S1a and S1b: fixed. (4) Questions 3, 6, 8 multiple choice: fixed in form; question 6's options have a problem (finding 3). (5) Terms explained: partly fixed; "container", "stack", "Django", "branch", "pull request", "waiver" and "checkpoint" still unexplained, and one new explanation overclaims (finding 1). (6) The 0.1 row names its evidence: fixed, but there is no evidence file in the repository, and pull request #3 says "90 lines" where the file has 87. (7) "38 passing tests": fixed.

Findings, most important first:

1. Line 9, added by fix 5, states designed safeguards as fact: the egress proxy as "the one way out of a project's containers" and the gateway as "the one door to the AI model, which counts and caps spend". That contradicts line 87 (containers need the host network), the 0.2 evidence file, known gaps 1 and 20, and the plan's rule on "shown, designed, not done".
2. Line 83 misstates when a licence code becomes true. The plan requires the licence check to pass in the approval case too. The template's check is red today; approval alone does not turn it green, and the one package that changes the check (0.4) itself depends on L11. This should go to the owner.
3. Question 6 offers options that overturn a recorded owner decision without saying so (the timing of the engineer's review is already decided; only "who" is open), and one option contradicts "needed by checkpoint 2" in the same question.
4. Line 16 says "the owner's six findings on it are open" while lines 25 and 26 mark 0.1 and 0.2 tested, which answer findings 1 and 2; the findings register still showed all six open.
5. Lines 32 and 33 leave out L11: package 3.2 depends on L11 directly, and "parked on the key" for 2.3 omits L11. Packages 1.4 and 3.2 also wait on 1.3 and 3.1, which sit in the same row, not above.
6. "Parked on L10 or a waiver" is loose: a first-stack waiver removes S1a and S1b; a second-stack waiver still needs L10; S1b also needs the key, 2.3, 3.1 and 3.2.
7. Question 4 assumes answer 2(a). If the owner declines `caniuse-lite`, 4(b) is impossible and 4(a) gives no comparison.
8. The file says each question has a recommendation and its reason; question 7 has none and 6(a) gives no reason.
9. `spdx-ranges` is given as CC-BY-3.0; the check output shows "(MIT AND CC-BY-3.0)".

Checked and correct: the L9, L11 and "both" rows; the "opens up" lists; question 8's prices; the demo candidates' names; the old file kept in `docs/log/`.

Would a careful owner call the "Done means" unmet? The line count is met. "No statement contradicts another" is arguably not met: line 9 against line 87, line 16 against lines 25 and 26, and question 6 against itself.

## Package 0.2: `evidence/2026-11-11-skeleton-2/sandbox-egress.md`, reviewed `1c557ea`, merged `542b68b`

One change confirmed and nothing else: "which gives the containers" became "which is designed to give the containers". No findings. The text matches what was run: the script sends the requests with `curl --proxy` from the host; the server profile is only passed to `docker compose config`; the output block is unchanged.

Would a careful owner call the "Done means" unmet? No.

## Package 1.1: `docs/design/stage-1.md` and `docs/KNOWN-GAPS.md`, reviewed `239efce`, merged `a789551`

Items said to be fixed: (1) a kept hold stays open and counts as an open hold: fixed, though the budget equation still glossed open holds as "calls in flight" and the refusal message said "held for work in progress", both narrower than the new rule. (2) Price table: fixed; all four rows and the factor of 2 match `builder/src/gateway/prices.ts` exactly. (3) Proof row (e) names 1.4 and 1.5: fixed. (4) "Unreconciled" and "raises a fault" explained on first use: fixed.

Findings, most important first:

1. `docs/DECISIONS.md` still says "interrupted and expired holds settled at the full amount", with nothing marking it superseded.
2. The change to expired holds is not in the dated list. Step 4 and the 7.2 row went from "settled at its full amount" to kept open and unreconciled. That is not one of the five amendments, nor are the "kept hold stays open" rule and the additions to 5.2. The DECISIONS row records the old behaviour as the owner's, and changing a recorded decision is the owner's call.
3. The hold table's Output row says only "priced at the output rate". The price table shows Haiku's long-prompt output rate is $2.50 against $0.50. An implementer following the row would hold too little, against "no settled call costs more than its hold".
4. Section 5.2 applies the long-prompt rate "where a model has one"; the Input row adds "and the count could reach it". Two statements of the same rule differ.
5. Section 5.2 says applying the fast-mode factor to every rate "can only over-count". The pricing page states input and output only, so this is an assumption; known gap 23 says "under- or over-counts".
6. The new figures (both cache-write columns, the long-prompt row, fast mode) are not in `docs/SOURCES.md`; by the note's own definition of "verified", the heading does not cover them.
7. The gateway's price table prices a fourth model, `claude-fable-5-2`, which section 5.2 omits. The gateway will accept it.
8. Row (e) now defers to 1.4 and 1.5, but the plan's 1.2 "Done means" is "the rows in design note 7.2, each shown", and 1.4 and 1.5 depend on 1.2. The plan's 1.5 also does not require the reconciled hold to be a frozen project that then runs again. This needs a stated reading before 1.2 starts.
9. Step 5 has the fault written to the owner's unreconciled list and the project marked frozen at the moment the database is refusing writes. The note does not say where either is recorded. This needs an engineer's judgement in 1.2.

Known gap 20 says the same as 5.5 and contradicts nothing. Design note 2.4, 5.5, 6.1, 7.2 and the known-gaps file no longer call an interrupted or expired hold settled.

Would a careful owner call the "Done means" unmet? Met to the letter. The owner could still object that the note changed in more places than the list shows, and that the DECISIONS row contradicts it.

## Package W4: `docs/arabic-wording-list.md` and its script, reviewed `2c029a6`, merged `8016ff9`

The reviewer ran the script's logic in memory against both message files: its output is byte-for-byte identical to the committed document. 33 English and 33 Arabic keys, none missing either way, same order; placeholders match in every row; no value is empty; the document says clearly that the suggestions are not applied; both suggestions are sensible.

Findings:

1. "Every word a user of a generated app would see in the template today" overstates. The seeded names "Sample Employee", "Sample Manager" and "Sample HR Admin" appear on Arabic pages, and the framework's built-in "not found" page is English only.
2. The reason given for "وهمي" says it lacks the overtone of falsehood; the word is also used for fake or bogus things. "غير حقيقي" is more neutral. The owner's call.
3. The Arabic for `app.english` is the word "English", probably deliberately, but the document does not say so. The count compares keys only and would not catch an untranslated or empty value; there is none today.

Would a careful owner call the "Done means" unmet? No. The overclaim is outside it.

## What was done about each finding

In `docs/reviews/2026-11-12-integration-e0e22e6.md`, the table under "Result of the re-check of the final merged revisions".
