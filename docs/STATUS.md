# Status

Read this first in every session, then `docs/BUILD-PLAN.md` section 3. This file is rewritten each session, not added to. The version before the first rewrite is in `docs/log/`.

**As of:** 12 November 2026, after the owner's licence approval and two reports from fresh reviewer agents. Nothing here is a time estimate.

## Words used here

A *branch* is a named line of work in the repository; a *commit* is one saved step on it; a *pull request* is a proposed set of changes that can be read before it is merged. The *integration branch* `claude/stage-1` is where tested work is gathered; `main` is changed only by the owner. A *container* is a sealed box in which a program runs. A *stack* is the set of tools an app is written with (the first candidate is TypeScript with Next.js, a web framework; the second is Django, a Python web framework). A *licence* is the permission that comes with software someone else wrote; *LGPL* and *MPL* are licences that carry duties when the software is passed on. A *licence code* (L9, L10, L11) is the plan's name for one licence condition. A *waiver* is the owner's recorded decision that no stack comparison will be made. A *checkpoint* is one of the plan's five meeting points with the owner (0 to 4). A *hold* is money set aside before a model call; to *reconcile* a hold is for the owner to record what the call really cost. A *stand-in* is a fake provider used for tests, which costs nothing. A *proof row* is one line of the design note's table of things that must be shown.

## One-line state

**No safeguard is shown on the integration branch.** The code there is an unapproved starting baseline, unchanged since it was declared one: a model gateway meant to be the one door to the AI model, with a spend cap of an earlier kind that is to be rebuilt; an egress proxy that filters the requests sent through it but is not yet the only way out of a project's containers (on the development machine the containers share the machine's own network); a sandbox manager; an app spec; an event log; and a TypeScript house template. Its 38 tests were run on 12 November and passed; the template has screenshots, not tests. No app can be built. No real model call has been made.

**The design note:** the owner approved it on 11 November subject to three corrections, which are in it, and approved five amendments through the build plan. Changes made since are listed at the end of its section 5.5; some of them await the owner and are not approved.

## Three states, per the plan

| State | What is in it |
| --- | --- |
| **Accepted by the owner (in `main`)** | The handover, the project rules, the specification, the design note as first approved, the Task 0 documents |
| **Tested** | Packages 0.2 and W4 (documents). No code package is tested. No finding about how the running system behaves is closed: sixteen of seventeen are open (`docs/reviews/2026-11-11-pull-request-2.md`) |
| **Built, not tested** | The baseline code. Packages 0.1 and 1.1 (reopened). The `builder/` half of package 0.4, on a branch |
| **Waiting on the owner** | The questions below |

## Progress under the plan

| Package | State |
| --- | --- |
| 0.1 `docs/STATUS.md` rewritten | **Reopened 12 Nov; built, not tested.** Two reviews in a row found statements that contradicted each other. This file is the third version. It is tested only when an independent reviewer has read its final commit and found none |
| 0.2 Evidence claims narrowed | Tested 11 Nov; the merged text re-read 12 Nov, no finding |
| 1.1 Design note 5.5 amended | **Reopened 12 Nov; built, not tested.** Its "Done means" is met to the letter; review found the hold could still fall short of a call's cost (known gap 41). Tested only when an independent reviewer has read the final commit |
| W4 Arabic wording list | Tested 11 Nov; re-read 12 Nov, list and counts confirmed |
| 0.4 One licence rule | **Parked** (needs L9 and L11). Its `builder/` half was built on 12 Nov on a branch (pull request #9) **before its dependencies were met**, which was Claude Code's error (known gap 42). It is not merged. An independent reviewer found two blocking defects in it; they are being corrected on that branch. Question 2 below |

The review record, with the commit each review read, is `docs/reviews/2026-11-12-integration-e0e22e6.md`. Pull request #7 holds these corrections; it is merged only when the commit reviewed is the commit merged.

## The licence codes today

| Code | State | Why |
| --- | --- | --- |
| L9 (`builder/`) | **True since 12 Nov** | The owner approved the named development packages (`docs/DECISIONS.md`), and the licence check committed for `builder/` passes (`evidence/2026-11-12-licence-checks-as-committed/checks.md`). That check still has a weaker rule for development tools; package 0.4 replaces it |
| L11 (`templates/next/`) | **Not true** | `caniuse-lite` is approved, but the template also carries LGPL packages that nobody had recorded (known gap 40), so its check fails. Question 1 |
| L10 (second stack) | **Not true** | `psycopg` is not approved. Question 4 |

## What each package waits for

The packages that could come next; later ones are in the plan, section 7.

| Package | Depends on | Not yet met |
| --- | --- | --- |
| 2.1 scripted engine; W1 web shell; W3 analyst instructions | L9 | **Nothing. These can start** once pull request #7 is merged |
| 1.2 holds in the database (proof rows B1 to B6) | 1.1, L9 | 1.1 tested again |
| 1.3 | 1.2 | 1.2 |
| 1.4 failure tests | 1.2, 1.3 | Both. It also builds the part flagged for an engineer (known gap 35) |
| 1.5 unreconciled list | 1.2 | 1.2; and it is taken after 1.4, because its proof row needs 1.4's cases |
| 2.2 engine adapter, against a stand-in | 2.1, 1.2 | Both |
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

One decision at a time, in this order. Each has a recommendation and its reason, except question 9, which is a question of fact.

**1. [L11] The template carries an image library under LGPL.** Next.js installs `sharp`, an image-processing library, as an optional extra. Its packages `@img/sharp-libvips-*` are LGPL-3.0-or-later, outside the permitted list. Three are installed on this machine and none is a development-only package; another machine installs differently named ones. No exporter exists, so whether a generated app would carry them is not shown; nothing today prevents it. The owner's approval of 12 Nov does not cover them. The template does not process images.
- (a) **Remove `sharp` from the template (package R1).** Recommended. Reason: nothing in the template needs it, and it keeps LGPL out of generated apps. Not yet shown: that it can be removed cleanly, since it comes with Next.js and not from the template's own list; R1 would show it or report back.
- (b) Approve the `sharp` packages by name for generated apps, with a written LGPL approach before any customer delivery. The approval would have to cover every machine's package names. The LGPL text has not been read in this project.
- (c) Give up the Next.js stack. Only Django would remain, and it needs `psycopg`, also LGPL.

**2. The licence check for `builder/`, built early.** May the `builder/` half of package 0.4 be merged once its review is clean, although the plan gives 0.4 both L9 and L11 as dependencies and L11 is not true?
- (a) **Yes: treat 0.4 as two halves, each with its own code.** Recommended. Reason: it replaces a weaker check with a stricter one for `builder/` and touches nothing in the template.
- (b) No: keep it unmerged until L11 is true.

**3. The variable `VIBEBUILD_KEY`,** which the owner added to the "Default" cloud environment on 12 Nov. It has not been read or used. The builder reads `BUILDER_MODEL_API_KEY`, and the plan creates the model key at checkpoint 1.
- (a) **Remove it for now; add it at checkpoint 1 as `BUILDER_MODEL_API_KEY` on the "vibe-build" environment, with a monthly limit set in the provider's console first.** Recommended. Reason: nothing in the queue needs a key, and "Default" is shared by all the owner's projects.
- (b) Leave it; it stays unused until checkpoint 1.
- (c) A real model call before checkpoint 1. The owner's to decide; advised against until the cap is rebuilt.

**4. [L10 or a waiver] The second stack.** Django's database driver `psycopg` is LGPL-3.0.
- (a) Approve `psycopg` by name for the comparison only, with a written LGPL approach before any customer delivery.
- (b) Record a waiver naming one stack: no comparison.
- (c) **Decide after question 1.** Recommended. Reason: the answer to question 1 changes what a comparison would compare, and the LGPL text should be read first.

**5. Make the repository private?** (a) **Yes, now; then confirm this session can still reach it.** Recommended: nothing in it is meant for the public, and it costs nothing. (b) Leave it as it is. Whether it is public today was not re-checked on 12 Nov.

**6. An expired hold: kept open, or settled?** If a call never reports back and its hold passes its deadline: (a) **keep it open at its full amount until the owner reconciles it** (recommended: it matches package 1.5, "a hold is closed only by a recorded owner action"; the design note is written this way); (b) settle it at its full amount automatically, as the decision recorded on 11 Nov says. Neither releases any money. Until answered, the 11 Nov decision stands on record and the note differs from it.

**7. [Candidate] The demo candidate:** (a) **D3, the commission leak report** (recommended: the owner can judge every number himself); (b) D1, the inspection tracker; (c) D2, the cylinder tracking.

**8. The reviewing engineer: who?** When is decided: at checkpoint 2 and again before the demo. (a) **Name someone now** (recommended: known gaps 35, 39 and 41 hold points for an engineer, and one for a lawyer); (b) name them when the checkpoint 2 pack is ready.

**9. Did the Claude app show a page titled "builder: preview test"** in the first session? (a) Yes; (b) No; (c) Not sure.

**10. [Server] A demo server**, when ready to spend; not needed before package 0.6b. Prices read on 11 Nov 2026 (`docs/OPEN-DECISIONS.md` item 5): (a) **Hetzner CPX32, €30.49 per month excl. VAT, no UAE location** (recommended: lowest verified price; made-up data only); (b) Oracle Cloud in Dubai; (c) AWS in the UAE; (d) DigitalOcean, $48.00 per month, no UAE. Prices for (b) and (c) could not be read. The chosen price is read again on the day of approval.

**Yours to confirm, in your own time.** These are recorded as Claude Code's readings or work, not as your decisions: (i) that "a0 approved" meant option (a), covers the eleven `lightningcss` build-package names listed in `docs/DECISIONS.md`, and holds across version upgrades while each licence is unchanged; (ii) the corrections made in answer to the two reviews you passed on, including the edit to your plan's package 1.2 and the assignment of proof rows B1 to B14 (B7 asks more than the plan's wording for 1.3; 1.5 is taken after 1.4); (iii) building the proposal of known gap 35 if no engineer is named by then; (iv) what "absent from what a customer receives" means for a development package that an exported app's own list names (known gap 39); (v) the two suggested Arabic wording changes in `docs/arabic-wording-list.md`.

## Money

| Meter | Figure |
| --- | --- |
| Model spend this month | $0.00 through the builder. No real model call has been made by this project. Not counted here: a separate hosted prototype agent the owner is setting up outside the repository (`docs/DECISIONS.md`, 12 Nov), which spends on his own account and is not capped by the builder |
| The model key | Not set up under the plan. A variable named `VIBEBUILD_KEY` exists on the owner's "Default" cloud environment since 12 Nov (question 3); unread and unused |
| Monthly limit; per-project cap | Not yet set ($100 and $20 proposed); decided at checkpoint 1 |

## What the next session does

Follow `docs/BUILD-PLAN.md` section 3; development machine set-up is in `CLAUDE.md`, Commands. In order: (1) have an independent reviewer read the head of pull request #7 and merge it only if the commit read is the commit merged; that also decides whether packages 0.1 and 1.1 are tested again. (2) With L9 true, start the first package whose dependencies are met: 2.1, then W1 and W3; 1.2 once 1.1 is tested. (3) Leave pull request #9 unmerged until the owner answers question 2. (4) Start nothing that needs L11, L10, the key, the candidate or the server.
