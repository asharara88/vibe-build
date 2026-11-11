> Living specification. Cut unchanged from HANDOVER.md Part B on 11 November 2026. Change only with the owner's agreement, and record the change in docs/DECISIONS.md.

## B5. Test protocol

**Purpose.** Measure how much the control layer improves what the builder produces, and learn what the engine does well and badly. It produces the evidence for the optimiser (B4) and for every "builds reliably" in the question bank (B2).

**The ten examples.** Each is a raw ask a real employee would type.

| # | Raw ask | Pattern | Buyer type |
| --- | --- | --- | --- |
| 1 | I need an app where staff can request leave and managers approve it | Form + approval | Any |
| 2 | A portal for new suppliers to send us their documents | Intake + review queue | Property developer, regulated |
| 3 | Make me a dashboard from our sales sheet | Dashboard over spreadsheet | Property developer |
| 4 | Something to track snagging items per unit before handover | Checklist + status per record | Property developer |
| 5 | A tool to log visitor access requests for the site office | Form + approval + log | Semi-government |
| 6 | Track our marketing spend by channel against budget | Dashboard + data entry | Any |
| 7 | A register of contracts with renewal reminders | Records + dated alerts | Regulated, semi-government |
| 8 | Staff expense claims with receipt upload and finance approval | Form + file + two-step approval | Any |
| 9 | A simple CRM for our sales centre leads | Records + pipeline stages | Property developer |
| 10 | An incident log for the facilities team with escalation | Form + escalation rule + report | Semi-government, regulated |

**Three runs per example.**

1. *Raw.* The raw ask goes to the build engine as written. Accept whatever it builds, without steering.
2. *Brief.* The raw ask goes through the analyst. The confirmed brief is given to the build engine in one piece.
3. *Tuned.* The confirmed brief and plan go through the full pipeline: one step at a time, each with its quality rules and its acceptance item. This is the product.

All three runs of an example are scored against the same acceptance test, the one made from that example's confirmed brief.

The raw and brief runs must begin from the same starting point, so that the brief is the only difference between them. State in the report what that starting point was.

**What to record for every run.**

| Field | What to write |
| --- | --- |
| Example, run type | 1 to 10; raw, brief, tuned |
| Time to first working screen | Minutes, by the clock |
| Turns to finish | Number of instructions sent to the engine before the run stopped |
| Acceptance score | Items in the acceptance test that pass, over total |
| Quality rules met | Count of the ten rules satisfied without being asked |
| Where it drifted | What it built that was not asked for, in one line |
| Where it ignored the instruction | What it skipped or misread, in one line |
| Phrasing that worked | Any wording that made the engine do the right thing first time |
| Phrasing that failed | Any wording it misread |
| Model usage and cost | Tokens and cost for the run, from the model gateway |

**What the results feed.**

- Acceptance score, raw against brief against tuned, is the figure for the pitch: the argument for the control layer in one number.
- "Where it drifted" and "phrasing that worked" become the optimiser's first rules (B4).
- Patterns with a high tuned score earn "builds reliably" in the question bank. The (H) marks come off.
- Patterns with a low tuned score, or a high cost, are candidates for a deterministic generator (section 8.3).

**Stop condition.** Ten examples, three runs each, is thirty builds. Stop early if raw and brief are indistinguishable after five examples. That would mean the brief alone is not the lever and the optimiser matters more than expected. Report it plainly.

**How it runs here.**

- A test harness runs the protocol automatically. Each example carries an answer sheet: the option a realistic customer would pick for each question. A scripted customer answers the analyst from the sheet, so every run can be repeated. The worked mapping in B2 is the answer sheet for example 1.
- The owner reviews the ten answer sheets before the protocol starts. They encode business choices.
- Repeat each tuned run three times to measure how consistent the builder is (proposal).
- The owner walks the chosen demo candidates through by hand as well. Automated checks do not replace that.
