# Status

Read this first in every session, then `docs/BUILD-PLAN.md` section 3. This file is rewritten each session, not added to. The version before the first rewrite is in `docs/log/`.

**As of:** 12 November 2026, after the owner left the choice of how licence code L11 is met to Claude Code, which chose to enter the approved name in the template's check inside the R1 pull request. Nothing here is a time estimate.

## Words used here

A *branch* is a named line of work in the repository; a *commit* is one saved step on it; a *pull request* is a proposed set of changes that can be read before it is merged. The *integration branch* `claude/stage-1` is where tested work is gathered; `main` is changed only by the owner. A *container* is a separate box in which a program runs. A *stack* is the set of tools an app is written with (the first candidate is TypeScript with Next.js, a web framework; the second is Django, a Python web framework). A *licence* is the permission that comes with software someone else wrote; *LGPL* and *MPL* are licences that carry duties when the software is passed on. A *licence code* (L9, L10, L11) is the plan's name for one licence condition. A *waiver* is the owner's recorded decision that no stack comparison will be made. A *checkpoint* is one of the plan's five meeting points with the owner (0 to 4). A *hold* is money set aside before a model call; to *reconcile* a hold is for the owner to record what the call really cost. A *stand-in* is a fake provider used for tests, which costs nothing. A *proof row* is one line of the design note's table of things that must be shown. The *head* of a branch is its latest commit. *Development-only* packages are tools used while building, as opposed to *shipped* packages, which run inside the finished program. In the baseline: the *gateway* is the part meant to be the one door to the AI model; the *egress proxy* is the part that filters the requests sent through it; the *sandbox manager* creates a project's containers; the *app spec* is the machine-readable brief; the *event log* is the record of what happened; the *template* is the starter a generated app begins from; the *exporter* (not built) hands a finished app over. An *environment variable* is a named setting given to a session by its *cloud environment*, the saved set-up a session runs in. A *provider* is the company whose AI model is called; the *engine* is the part that asks the model to write code; the *model key* is the secret that lets the builder call the provider and be billed. `psycopg` is the database driver Django needs. A *lock file* is the full list of exact packages an install uses, for every kind of computer. In the plan's tables, *Key* means the model key is set (after checkpoint 1), *Candidate* that the demo candidate is chosen, *Server* that a demo server exists.

## One-line state

**No safeguard is shown on the integration branch.** The code there is an unapproved starting baseline, unchanged since it was declared one: a model gateway meant to be the one door to the AI model, with a spend cap of an earlier kind that is to be rebuilt; an egress proxy that filters the requests sent through it but is not yet the only way out of a project's containers (on the development machine the containers share the machine's own network); a sandbox manager; an app spec; an event log; and a TypeScript house template. Its 38 tests were run on 12 November and passed (`evidence/2026-11-12-baseline-tests/run.txt`); the template has screenshots, not tests. No app can be built. No real model call has been made by this project.

**The design note:** the owner approved it on 11 November subject to three corrections, which are in it, and approved five amendments through the build plan. Changes made since are listed at the end of its section 5.5. **None of those has the owner's recorded approval**; some are marked there as awaiting his decision.

## Three states, per the plan

| State | What is in it |
| --- | --- |
| **Accepted by the owner (in `main`)** | The handover, the project rules, the specification, the design note as first approved, the Task 0 documents |
| **Tested** | Packages 0.1, 0.2, 1.1 and W4, all documents. No code package is tested. No finding about how the running system behaves is closed: fifteen of seventeen findings are open (`docs/reviews/2026-11-11-pull-request-2.md`) |
| **Built, not tested** | The baseline code. Package 1.2, on a branch. R1, on a branch. The `builder/` half of package 0.4, on a branch, with work on it stopped |
| **Waiting on the owner** | The questions below |

## Progress under the plan

| Package | State |
| --- | --- |
| 0.1 `docs/STATUS.md` rewritten | **Tested again 12 Nov.** Reopened that day; an independent reviewer then read the final commit (`492370c`), found no statement contradicting another, and that commit is the one merged. That review's non-blocking findings on this file are closed in the record update that follows; that update is read by a reviewer before it is merged. This file is updated after every package, as the plan requires; the review of `492370c` covers it as it stood then |
| 0.2 Evidence claims narrowed | Tested 11 Nov; the merged text re-read 12 Nov, no finding |
| 1.1 Design note 5.5 amended | **Tested again 12 Nov** at `492370c`: the five amendments are under a dated list and each has a proof row. Tested means the document says what the plan asked. **Nothing in it is on the integration branch**; package 1.2 builds part of it on a branch, not tested. Still open and recorded: the hold's known limits (known gap 41), one point for an engineer (known gap 35), the expired-hold question |
| W4 Arabic wording list | Tested 11 Nov; re-read 12 Nov, list and counts confirmed |
| R1 `sharp` removed from the template | **Built 12 Nov on a branch (pull request #10), not tested.** The owner chose removal. On that branch the template's lock file lists no LGPL package, it builds, and its demonstration run gives the same results (`evidence/2026-11-12-package-r1/remove-sharp.md`). The approved name `caniuse-lite` is now entered in the template's existing licence check there, at its exact version, and that check passes; a new check, added beyond R1's scope to answer a review finding, fails if `sharp` returns. Still open on its "Done means": "passes under the single rule of 0.4" can only be shown when package 0.4 is done; and the template has no automated tests, so the type check, the build and the demonstration run were repeated in their place; whether that may stand in for "existing tests pass" is the owner's to say (listed under "Yours to confirm"). It is merged once an independent reviewer and the review bot have read its head and found nothing blocking, as the choice of 12 Nov provides. One practical effect: apps built from the template get no automatic image resizing |
| 0.4 One licence rule | **Parked** (needs L9 and L11). Its `builder/` half was built on 12 Nov on a branch (pull request #9) **before its dependencies were met**, which was Claude Code's error (known gap 42). An independent reviewer found two blocking defects in it, and those were corrected on the branch the same day. That too was work on a parked package. **Work on it stays stopped until L11 is true**, that is until R1 is merged; package 0.4 then follows in the plan's order for both components (pull request #9 for `builder/`, re-reviewed; the template's half still to build) |

The review record, with the commit each review read, is `docs/reviews/2026-11-12-integration-e0e22e6.md`. Pull request #7 held these corrections and was merged on 12 Nov at `492370c`, the commit its last review read.

## The licence codes today

| Code | State | Why |
| --- | --- | --- |
| L9 (`builder/`) | **True since 12 Nov**, on the reading that "a0 approved" meant option (a), which the owner has not yet confirmed | The owner approved the named development packages (`lightningcss`, a tool that processes page styling, with its build packages, and `spdx-exceptions` and `spdx-ranges`, two lists of licence names), and the licence check committed for `builder/` passes (`evidence/2026-11-12-licence-checks-as-committed/checks.md`). That check still has a weaker rule for development tools, and the conditions of the approval are not implemented (known gap 39) |
| L11 (`templates/next/`) | **Not true yet; true when R1 is merged** | On the integration branch the template's check still refuses `caniuse-lite`, skips every package whose name begins with `@` (known gap 43) and the template carries LGPL packages (known gap 40). On the R1 branch all three are dealt with: the LGPL packages are gone, the approved name is entered in the check at its exact version, and the check reads every installed package except that one and the template's own two private ones (261 of 264) and passes. Two limits stay until package 0.4 replaces that check: the weaker rule for development tools, and a rule for shipped packages that accepts a licence if a permitted name appears anywhere in its text (known gap 43) |
| L10 (second stack) | **Not true** | `psycopg` is not approved. Question 3 |

## What each package waits for

The packages that could come next; later ones are in the plan, section 7.

| Package | Depends on | Not yet met |
| --- | --- | --- |
| 2.1 scripted engine; W1 web shell; W3 analyst instructions | L9 | **Nothing. These can start** |
| 1.2 holds in the database (proof rows B1 to B6) | 1.1, L9 | Nothing. **Built 12 Nov on its own branch (pull request #12, not merged), not tested.** Two reviews have found defects, corrected on that branch; a third is reading the corrections. It is not marked tested before a review is clean and question 1 is answered; question 5 could also change two of its proof rows |
| 1.3 the pre-step check | 1.2 | 1.2 tested, which waits on question 1 |
| 1.4 failure tests | 1.2, 1.3 | Both, so it too waits on question 1. It also builds the part flagged for an engineer (known gap 35) |
| 1.5 unreconciled list | 1.2 | 1.2 tested (question 1); and it is taken after 1.4, because its proof row needs 1.4's cases |
| 2.2 engine adapter, against a stand-in | 2.1, 1.2 | Both; 1.2 tested waits on question 1 |
| 3.1 acceptance store and runner; W2 harness | 2.1 | 2.1 |
| 0.3 role guard | L11 | L11 |
| 0.4 one licence rule; 0.5 set-up in a tools container | L9 and L11 | L11 |
| 0.6a isolation checks | 0.5 | 0.5 |
| 3.2 exporter | 3.1, L11 | Both |
| 2.3 first real model call | 2.2, 1.4, 0.5, 0.6a, Key, L11 | All |
| S1a second template | L10 | L10 |
| S1b second stack, live | S1a, 2.3, 3.1, 3.2, Key | All |
| 0.6b; M8 | A demo server, among others | Server |
| C1, C2 | The demo candidate, among others | Candidate |

## Waiting on the owner

One decision at a time, in this order. Each has a recommendation and its reason, except question 8, which is a question of fact.

**1. What finishes package 1.2?** The plan first said "the rows in design note 7.2". On 12 Nov that was narrowed to proof rows B1 to B6, in answer to a review you passed on; your own approval of that is not recorded. The rows themselves were also rewritten that day (B4 is split in two; B1, B2, B5 and B6 say more), so choosing (a) or (b) accepts them as they now read. Review also found four ways the hold could fall short and one case that was not defined (known gap 41). Package 1.2 handles them by refusing the request, by keeping the hold, or by a margin on the token count; none has a proof row.
- (a) **B1 to B6, plus a proof row for each of those five.** Recommended. Reason: they are built in 1.2, so what finishes 1.2 should include showing them. It adds five rows to the design note and changes the plan's "and only those". The row for the margin can show only that a margin is applied; whether it is large enough needs a real provider (package 2.3).
- (b) B1 to B6 only, as the plan now reads.
- (c) The plan's first wording. Package 1.2 could then not be finished before 1.3, 1.4 and 1.5, which depend on it.

**2. The variable `VIBEBUILD_KEY`: is it gone?** The owner wrote on 12 Nov that he removed the key. Read straight afterwards, the name was still on the "vibe-build" environment's list of variables. Only its name has ever been seen here.
- (a) **If the key itself was deleted at the provider, also delete the leftover entry on "vibe-build" (the environment menu, then Edit).** Recommended. Reason: a leftover name invites someone to rely on it.
- (b) If it was the entry that was meant to be removed and it is still there, remove it the same way.

**3. [L10 or a waiver] The second stack.** Django's database driver `psycopg` is LGPL-3.0.
- (a) Approve `psycopg` by name for the comparison only, with a written LGPL approach before any customer delivery.
- (b) Record a waiver naming one stack: no comparison.
- (c) **Decide later, at the latest before package 3.3 can start (in the plan, that is before checkpoint 2).** Recommended. Reason: nothing that can start today is held up, and the LGPL text should be read first. What does wait on it: the second template (S1a), its live runs (S1b) and the comparison in packages 3.3 and 3.4, none of which can start until you decide.

**4. Make the repository private?** (a) **Yes, now; then confirm this session can still reach it.** Recommended: nothing in it is meant for the public. (b) Leave it as it is. Two reviewers read it as public on 12 Nov.

**5. An expired hold: kept open, or settled?** If a call never reports back and its hold passes its deadline: (a) **keep it open at its full amount until the owner reconciles it** (recommended: it matches package 1.5, "a hold is closed only by a recorded owner action"; the design note is written this way); (b) settle it at its full amount automatically, as the decision recorded on 11 Nov says. Neither releases any money. Until answered, the 11 Nov decision stands on record and the note differs from it.

**6. [Candidate] The demo candidate:** (a) **D3, the commission leak report** (recommended: the owner can judge every number himself); (b) D1, the inspection tracker; (c) D2, the cylinder tracking.

**7. The reviewing engineer: who?** When is decided: at checkpoint 2 and again before the demo. (a) **Name someone now** (recommended: known gaps 35, 39 and 41 hold points for an engineer, and one for a lawyer); (b) name them when the checkpoint 2 pack is ready.

**8. Did the Claude app show a page titled "builder: preview test"** in the first session? (a) Yes; (b) No; (c) Not sure.

**9. [Server] A demo server**, when ready to spend; not needed before package 0.6b. Prices read on 11 Nov 2026 (`docs/OPEN-DECISIONS.md` item 5): (a) **Hetzner CPX32, €30.49 per month excl. VAT, no UAE location** (recommended: lowest verified price; made-up data only); (b) Oracle Cloud in Dubai; (c) AWS in the UAE; (d) DigitalOcean, $48.00 per month, no UAE. Prices for (b) and (c) could not be read. The chosen price is read again on the day of approval.

**Yours to confirm, in your own time.** These are recorded as Claude Code's readings or work, not as your decisions: (i) that "a0 approved" meant option (a), covers the eleven `lightningcss` build-package names listed in `docs/DECISIONS.md`, and holds across version upgrades while each licence is unchanged; (ii) the corrections made in answer to the two reviews you passed on, including the assignment of proof rows B7 to B14 to packages 1.3 to 1.5 (B7 asks more than the plan's wording for 1.3; 1.5 is taken after 1.4); what finishes package 1.2 is now question 1; (iii) building the proposal of known gap 35 if no engineer is named by then; (iv) what "absent from what a customer receives" means for a development package that an exported app's own list names (known gap 39); (v) the two suggested Arabic wording changes in `docs/arabic-wording-list.md`; (vi) whether the template's demonstration run may stand in for "existing tests pass" in package R1, since the template has no automated tests, and the choice of option (a) for L11 that Claude Code made when you left it to it (`docs/DECISIONS.md`, 12 Nov; you can reverse it), together with two things added in that pull request beyond what option (a) said: a check that fails if `sharp` returns to the template, and the approved package entered at its exact version, so that an update of it is refused until looked at; (vii) how the known limits of the hold are handled in package 1.2 (`docs/DECISIONS.md`, the row of 12 Nov on how the cap is built). Each of these is put to you as a question with choices when it becomes the next thing that holds work up.

## Money

| Meter | Figure |
| --- | --- |
| Model spend this month | $0.00 through the builder. No real model call has been made by this project. Not counted here: a separate hosted prototype agent the owner is setting up outside the repository (`docs/DECISIONS.md`, 12 Nov), which spends on his own account and is not capped by the builder |
| The model key | Not set up under the plan. A variable named `VIBEBUILD_KEY` is on the owner's "vibe-build" cloud environment (question 2); only its name has been seen |
| Monthly limit; per-project cap | Not yet set ($100 and $20 proposed); decided at checkpoint 1 |
| The cloud environments, as seen on 12 Nov | The "vibe-build" environment and its set-up script (it starts Docker and fetches three base images) were made by another session of this project with the owner's approval; that session's record is pull request #8, open, not merged, and aimed at `main`, so its decision row is not yet in `docs/DECISIONS.md` on this branch. Not looked into: the same script on "Default"; `openrouter.ai` among the allowed hosts; three variables on "Default" that are not this project's. |

## What the next session does

Follow `docs/BUILD-PLAN.md` section 3; development machine set-up is in `CLAUDE.md`, Commands. In order: (1) package 1.2, the holds in the database, against a stand-in provider: built on its own branch (pull request #12); answer its review, and do not mark it tested before question 1 is answered. (2) While question 1 is open, nothing that needs 1.2 tested can start (1.3, 1.4, 1.5, 2.2); take 2.1, then 3.1, W1, W2 and W3. Once 1.2 is tested: 1.3, 1.4, 1.5, then 2.2. (3) R1 (pull request #10): have its head read by an independent reviewer and the review bot; merge it when nothing blocking is found. L11 is then true. (4) Then package 0.4 in the plan's order: re-review pull request #9 (the `builder/` half) and build the template's half, which also closes known gaps 43 and 44 for good; then 0.3 and 0.5. (5) Start nothing that needs L10, the key, the candidate or the server, and nothing that needs L11 before R1 is merged.
