# Status

Read this first in every session, then `docs/BUILD-PLAN.md` section 3. This file is rewritten each session, not added to; older versions are in `docs/log/`.

**As of:** 12 November 2026, after two reviews by an independent assistant, supplied by the owner (of commits `e0e22e6` and `689da67`). The owner's own approval of the corrections is not yet recorded. Nothing here is a time estimate.

## One-line state

The design note is approved subject to corrections, which are in it. **No safeguard is shown yet.** Code exists on the integration branch `claude/stage-1` (a *branch* is a named line of work in the repository) as an **unapproved starting baseline**, and the product code has not changed since it was declared a baseline, so every finding about how the running system behaves remains open. The baseline holds: a model gateway, meant to be the one door to the AI model, with a spend cap of an earlier kind that is to be rebuilt; an egress proxy, which filters the requests sent through it but is not yet the only way out of a project's containers (a *container* is a sealed box in which a program runs; on the development machine the containers share the machine's own network); a sandbox manager, which creates a project's containers; an app spec, the machine-readable brief; an event log, the record; and a TypeScript house template, the starter a generated app begins from. The builder's own code has 38 passing tests; the template has screenshots, not tests. No app can be built. No real model call has been made; the month's model spend is $0.00 (no key exists).

## Three states, per the plan

| State | What is in it |
| --- | --- |
| **Accepted by the owner (in `main`)** | The handover, the project rules, the specification, the design note as first approved, and the Task 0 documents. Everything since is on `claude/stage-1` and not accepted |
| **Tested** | See the progress table. Document packages only. No code package is tested, and no finding about how the running system behaves is closed |
| **Built, not tested** | The baseline code in `builder/` and `templates/next/`. The owner's findings on it, seventeen in all, are in the findings register `docs/reviews/2026-11-11-pull-request-2.md` |
| **Parked, waiting on the owner** | All code work, on the licence answers below |

## Progress under the plan

A *pull request* is a proposed set of changes that can be read before it is merged. The review record for the four document packages, with the commit each review read, is in `docs/reviews/2026-11-12-integration-e0e22e6.md`.

| Package | State | Where |
| --- | --- | --- |
| 0.1 `docs/STATUS.md` rewritten | **Reopened 12 Nov.** A re-check of the merged text found statements that contradicted each other, so its "Done means" was not met. Rewritten as this file. Built, not tested, until an independent reviewer has read this file's final commit | Pull request #3, then this file |
| 0.2 Evidence claims narrowed | Tested 11 Nov; the re-check of the merged text on 12 Nov found nothing | Pull request #4 |
| 1.1 Design note 5.5 amended | **Reopened 12 Nov.** Its "Done means" was met to the letter, but the re-check found a defect inside amendment (c) (the output part of the hold ignored the long-prompt rate) and changes not listed among the amendments. Corrected in the design note. Built, not tested, until an independent reviewer has read the final commit | Pull request #5, then design note 5.2, 5.5, 7.2 |
| W4 Arabic wording list | Tested 11 Nov; the re-check confirmed the list and counts, and found one overstated sentence outside its "Done means", corrected | Pull request #6 |

What every other package waits for, taken from the plan's "Depends on" column. A *licence code* (L9, L10, L11) is the plan's name for one licence decision.

| Package | Depends on | Not yet met |
| --- | --- | --- |
| 0.3 role guard | L11 | L11 |
| 0.4 one licence rule; 0.5 set-up in a tools container | L9 and L11 | Both |
| 0.6a isolation checks | 0.5 | 0.5 |
| 1.2 holds in the database (proof rows B1 to B6) | 1.1, L9 | L9 |
| 1.3; 1.5 | 1.2 | 1.2 |
| 1.4 failure tests | 1.2, 1.3 | Both |
| 2.1 scripted engine; W1 web shell; W3 analyst instructions | L9 | L9 |
| 2.2 engine adapter, against a stand-in | 2.1, 1.2 | Both |
| 2.3 first real model call | 2.2, 1.4, 0.5, 0.6a, Key, L11 | All |
| 3.1 acceptance store and runner; W2 harness | 2.1 | 2.1 |
| 3.2 exporter | 3.1, L11 | Both |
| S1a second template | L10 | L10 |
| S1b second stack, live | S1a, 2.3, 3.1, 3.2, Key | All |
| 0.6b; M8; gate item 5 on a clean machine | A demo server, among others | Server |
| C1, C2 | The demo candidate, among others | Candidate |

## Waiting on the owner

One decision at a time, in order. Each choice has a recommendation and its reason, except question 7, which is a question of fact. A *licence* is the permission that comes with software someone else wrote; the project's rule is permissive licences only, unless the owner names an exception in writing.

**1. [L9 and L11] The licence exceptions.** An independent assistant's recommendation, which the owner supplied on 12 Nov, is to approve the packages below by name on conditions (`docs/reviews/2026-11-12-licence-recommendation.md`). That is its recommendation; **the owner's own approval is not yet recorded**, so both codes are still false. The packages, at the versions installed: for development only, `lightningcss` 1.33.0 with its per-machine build packages `lightningcss-*` 1.33.0 (MPL-2.0; two are installed here, `-linux-x64-gnu` and `-linux-x64-musl`, and another machine installs a different one, so the approval needs to name the family), `spdx-exceptions` 2.5.0 (CC-BY-3.0), `spdx-ranges` 2.1.1 (MIT AND CC-BY-3.0); and in every generated app, `caniuse-lite` 1.0.30001823 (CC-BY-4.0), a browser-support data file that Next.js, the web framework the template uses, ships.
- (a) **Approve them by name, each for its named use, on the conditions below.** Recommended. Reason: replacing them would add work for no real benefit; the conditions are ones the build can meet and show.
- (b) Approve the development packages only. This rules out Next.js and the existing template.
- (c) Approve none; replace the development packages (package R1).

The conditions under (a): the approval covers these named packages and uses, not every package with the same licence; their licence and attribution notices are kept; a check on each export shows the development packages are not in what a customer receives; each exported app carries a notices file for `caniuse-lite` (its creators, copyright notice, licence notice and link, disclaimer notice, link to the source, and whether it was modified); the licence checks pass. An earlier version of this file called CC-BY "credit required, nothing else"; that was too loose and is corrected here. The plan makes a code true only when the packages are approved **and** the licence check passes; the template's check is red today, so under (a) the names are added to the checks as dated, named exceptions.

**2. [L10 or a waiver] The second stack.** A *stack* is the set of tools an app is written with; the second candidate is Django, a Python web framework, whose database driver `psycopg` is LGPL-3.0. A *waiver* is your recorded decision that no comparison will be made. An earlier version of this file said LGPL lets an app use the driver "as a separate package and stay proprietary"; installing it separately does not by itself show the licence is met, and the LGPL text has not been read in this project.
- If you chose 1(a): (a) **approve `psycopg` by name for the comparison only, with a written LGPL approach required before any customer delivery** (recommended: the stack choice should rest on a measurement); or (b) record a waiver naming the TypeScript stack.
- If you chose 1(b) or 1(c): only Django remains. (a) **approve `psycopg` on the same condition and record a waiver naming Django** (recommended: otherwise no stack remains); or (b) decline both, which leaves no stack and stops the build.

**3. Make the repository private?** Today anyone with the link can read the design, the evidence and the gap list.
- (a) **Yes, now; then confirm this session can still reach it.** Recommended. Reason: nothing in it is meant for the public, and it costs nothing.
- (b) Leave it public for now.

**4. An expired hold: kept open, or settled?** A *hold* is money set aside before a model call. If a call never reports back and its hold passes its deadline:
- (a) **Keep it open at its full amount until you reconcile it.** Recommended. Reason: it matches your package 1.5 ("a hold is closed only by a recorded owner action"). The design note now says this.
- (b) Settle it at its full amount automatically, as the first design did: charged for good, no action by you. Neither choice releases any money.

**5. [Candidate] The demo candidate:** (a) **D3, the commission leak report** (recommended: you can judge every number yourself; it shows rules 8 and 9); (b) D1, the inspection tracker; (c) D2, the cylinder tracking.

**6. The reviewing engineer: who?** When is already decided: at checkpoint 2 (the plan's second meeting point with you), and again before the demo.
- (a) **Name someone you already trust, now.** Recommended. Reason: one design point already needs an engineer's judgement (known gap 35), before package 1.2.
- (b) Name them when the checkpoint 2 pack is ready.

**7. Did the Claude app show you a page titled "builder: preview test"** during the first session? (a) Yes; (b) No; (c) Not sure.

**8. [Server] A demo server**, when you are ready to spend; not needed until package 0.6b and the demo. Prices read on 11 Nov 2026 (`docs/OPEN-DECISIONS.md` item 5): (a) **Hetzner CPX32, €30.49 per month excl. VAT, no UAE location** (recommended: lowest verified price; the server holds made-up data only); (b) Oracle Cloud in Dubai, price to be read in a browser; (c) AWS in the UAE, price to be read in a browser; (d) DigitalOcean, $48.00 per month, no UAE. The chosen option's price is read again on the day you approve.

The model key is not asked for yet. It is created at checkpoint 1, with the spending limits ($100 a month and $20 a project proposed). There is no basis yet to advance to real-model calls.

## Money

| Meter | Figure |
| --- | --- |
| Model key spend this month | $0.00. No key exists; no real model call has been made |
| Monthly limit; per-project cap | Not yet set (proposed $100 and $20) |

## What the next session does

Follow `docs/BUILD-PLAN.md` section 3. A licence code is true only when the named packages are approved in `docs/DECISIONS.md` (or replaced by package R1) **and** the licence check passes for that component. With L9 true: 1.2, 2.1, W1 and W3 can start. With L11 true: 0.3. With both: 0.4 and 0.5. With no answer from the owner, nothing in the queue can be done, and the session says so. Development machine: `CLAUDE.md`, Commands.
