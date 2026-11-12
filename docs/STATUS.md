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
| **Licences** | On 12 Nov the owner approved, by name and on conditions, the development packages (the `lightningcss` family, `spdx-exceptions`, `spdx-ranges`) and `caniuse-lite` (`docs/DECISIONS.md`). `psycopg` is not approved. L9 and L11 become true only when the licence checks also pass. The builder's check now passes on the branch of package 0.4a (not yet reviewed or merged). The template's cannot pass: it carries LGPL packages nobody had reported (question 1) |
| **Parked, waiting on the owner** | The second stack (L10 or a waiver); the first real model call (the key, at checkpoint 1); the demo candidate; the demo server |

## Progress under the plan

A *pull request* is a proposed set of changes that can be read before it is merged. The review record for the four document packages, with the commit each review read, is in `docs/reviews/2026-11-12-integration-e0e22e6.md`.

| Package | State | Where |
| --- | --- | --- |
| 0.1 `docs/STATUS.md` rewritten | **Reopened 12 Nov.** A re-check of the merged text found statements that contradicted each other, so its "Done means" was not met. Rewritten as this file. Built, not tested, until an independent reviewer has read this file's final commit | Pull request #3, then this file |
| 0.2 Evidence claims narrowed | Tested 11 Nov; the re-check of the merged text on 12 Nov found nothing | Pull request #4 |
| 1.1 Design note 5.5 amended | **Reopened 12 Nov.** Its "Done means" was met to the letter, but the re-check found a defect inside amendment (c) (the output part of the hold ignored the long-prompt rate) and changes not listed among the amendments. Corrected in the design note. Built, not tested, until an independent reviewer has read the final commit | Pull request #5, then design note 5.2, 5.5, 7.2 |
| W4 Arabic wording list | Tested 11 Nov; the re-check confirmed the list and counts, and found one overstated sentence outside its "Done means", corrected | Pull request #6 |
| 0.4a One licence rule, `builder/` | **Built 12 Nov, not tested** until an independent reviewer has read its final commit. The check passes on `builder/` and fails when a test package outside the rule is added | `evidence/2026-11-12-package-0.4a/licence-rule.md` |
| 0.4b One licence rule, `templates/next/` | **Parked on the owner** (question 1): the new rule found LGPL packages in the template | Known gap 40 |

What every other package waits for, taken from the plan's "Depends on" column. A *licence code* (L9, L10, L11) is the plan's name for one licence decision.

| Package | Depends on | Not yet met |
| --- | --- | --- |
| 0.3 role guard | L11 | L11: `caniuse-lite` is approved, but the template also carries LGPL packages (question 1), so its check cannot pass yet |
| 0.4 one licence rule | L9 and L11 | Split on 12 Nov (`docs/DECISIONS.md`): 0.4a for `builder/` is built; 0.4b for the template waits on question 1 |
| 0.5 set-up in a tools container | L9 and L11 | L9: 0.4a tested and merged. L11: question 1 |
| 0.6a isolation checks | 0.5 | 0.5 |
| 1.2 holds in the database (proof rows B1 to B6) | 1.1, L9 | 1.1 tested again; L9 (0.4a tested and merged); and known gap 35 needs an engineer's judgement |
| 1.3; 1.5 | 1.2 | 1.2 |
| 1.4 failure tests | 1.2, 1.3 | Both |
| 2.1 scripted engine; W1 web shell; W3 analyst instructions | L9 | L9 (0.4a tested and merged) |
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

**1. [L11] The template carries an image library under LGPL, found on 12 Nov.** Next.js, the web framework the template uses, installs `sharp`, an image-processing library, as an optional extra. Its packages `@img/sharp-libvips-*` are LGPL-3.0-or-later, a licence outside the permitted list, and two are among the packages a generated app would carry. The earlier check missed them (known gap 40). Your approval of 12 Nov does not cover them. The template does not process images today.
- (a) **Remove `sharp` from the template (package R1).** Recommended. Reason: nothing in the template needs it, and it keeps LGPL out of every generated app. Not yet shown: that it can be removed cleanly; R1 would show it or report back.
- (b) Approve the `sharp` packages by name for generated apps, with a written LGPL approach required before any customer delivery.
- (c) Give up the Next.js stack; only Django would remain, which itself needs `psycopg` (LGPL).

**2. [L10 or a waiver] The second stack.** A *stack* is the set of tools an app is written with; the second candidate is Django, a Python web framework, whose database driver `psycopg` is LGPL-3.0. A *waiver* is your recorded decision that no comparison will be made. An earlier version of this file said LGPL lets an app use the driver "as a separate package and stay proprietary"; installing it separately does not by itself show the licence is met, and the LGPL text has not been read in this project.
- (a) **Approve `psycopg` by name for the comparison only, with a written LGPL approach required before any customer delivery.** Recommended. Reason: the stack choice should then rest on a measurement.
- (b) Record a waiver naming the TypeScript stack: no comparison, and packages S1a and S1b are not done.

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

Follow `docs/BUILD-PLAN.md` section 3. A licence code is true only when the named packages are approved in `docs/DECISIONS.md` **and** the licence check passes for that component. The approval is recorded (12 Nov). First: an independent reviewer reads the head of pull request #7 (tracking corrections), then of package 0.4a; each is merged only when the commit reviewed is the commit merged. With 0.4a merged, L9 is true: 2.1, W1 and W3 can start, and 1.2 once package 1.1 is tested again and known gap 35 has an engineer's answer. Everything that needs L11 waits on question 1. Development machine: `CLAUDE.md`, Commands.
