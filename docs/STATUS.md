# Status

Read this first in every session, then `docs/BUILD-PLAN.md` section 3. This file is rewritten each session, not added to; older versions are in `docs/log/`.

**As of:** 11 November 2026, first session under the build plan. Nothing here is a time estimate.

## One-line state

The design note is approved subject to three corrections, which are made. Code exists on branch `claude/stage-1` as an **unapproved starting baseline**: the model gateway, the egress proxy, the sandbox manager, the app spec, the event log and the TypeScript house template, with 38 passing tests and three evidence folders. No app can be built yet. No real model call has been made; the month's model spend is $0.00 (no key exists).

## Three states, per the plan

| State | What is in it |
| --- | --- |
| **Accepted by the owner (in `main`)** | The handover, the project rules, the specification, the approved design note (with the three corrections on this branch, not yet in `main`), and the Task 0 documents |
| **Tested** (done means run and passed, evidence written, reviewer's findings closed) | Nothing yet under the plan's definition. The baseline's 38 tests pass, but the owner's six findings on it are open |
| **Built, not tested** | Baseline: `builder/` (gateway with an estimate-based cap, egress proxy, sandbox manager, event log, app spec); `templates/next/` (sign-in, three roles, Arabic and English). Each is listed with what is wrong in `docs/reviews/2026-11-11-pull-request-2.md` |
| **Parked, waiting on the owner** | Everything under `builder/` and `templates/next/` until the licence answers below (L9, L11). The Django template until L10 or a waiver. The engine adapter until checkpoint 1 and the key. The demo server until chosen |

## Progress under the plan

| Package | State | Where |
| --- | --- | --- |
| Set-up (section 3) | Done this session: `claude/stage-1` created from `claude/walking-skeleton`; pull request #2 closed as superseded; review file written; baseline decision recorded; `CLAUDE.md` line added | `docs/reviews/2026-11-11-pull-request-2.md`, `docs/DECISIONS.md` |
| 0.1 `docs/STATUS.md` rewritten | This file. Built; tested once a fresh reviewer confirms no statement contradicts another | This pull request |
| 0.2 Evidence claims narrowed | Next | `evidence/2026-11-11-skeleton-2/` |
| 1.1 Design note 5.5 amended | Next | `docs/design/stage-1.md` |
| W4 Arabic wording list | Next | `docs/` |
| 0.3, 0.4, 0.5, 0.6a, 1.2 to 1.5, 2.1, 2.2, W1, W2, W3 | Parked on L9 or L11 (below) | |
| 2.3, M2 | Parked on the key (checkpoint 1) | |
| S1a, S1b | Parked on L10 or a waiver. S1a (the second template, no model) can run before checkpoint 1 once L10 is true | |
| 0.6b, M8, gate item 5 on a clean machine | Parked on a demo server | |
| C1, C2 | Parked on the demo candidate | |

## Waiting on the owner

Answer in order. One decision at a time; each has a recommendation and its reason. The plan's codes are in brackets.

**1. [L9] Four development-only packages outside the permitted licences** (`lightningcss`, `lightningcss-linux-x64-gnu`: MPL-2.0; `spdx-exceptions`, `spdx-ranges`: CC-BY-3.0). None ships to a customer.
- (a) **Approve all four by name.** Recommended. Reason: they are tools used only while building; MPL-2.0 asks that changes to its own files be published, CC-BY-3.0 asks for credit; neither touches what customers receive.
- (b) Replace them (package R1). Means changing the test runner and the licence checker.
Until answered, no work under `builder/` can be finished.

**2. [L11] `caniuse-lite`, a browser-support data file that Next.js ships in every app** (CC-BY-4.0: credit required, nothing else).
- (a) **Approve by name, with the credit carried in each app's licence report.** Recommended. Reason: every Next.js app carries it; the obligation is one line of credit.
- (b) Decline. Rules out Next.js and the existing template; the second stack would have to complete the skeleton alone.
Until answered, no work on the template can be finished.

**3. Make the repository private** (pre-flight item 3), then confirm this session can still reach it. Nothing in it should be public: the design, the evidence and the gap list are all there.

**4. [L10 or Waiver] The second stack.** Django's PostgreSQL driver `psycopg` is LGPL-3.0.
- (a) **Approve `psycopg` by name**, which schedules packages S1a and S1b and a real comparison, as the design note says. Recommended. Reason: the stack choice should rest on a measurement.
- (b) Record a waiver: no comparison; the TypeScript stack stands.

**5. [Candidate] The demo candidate:** (a) **D3, the commission leak report** (recommended: you can judge every number yourself; shows rules 8 and 9); (b) D1; (c) D2.

**6. The reviewing engineer: who.** Needed by checkpoint 2.

**7. Did the Claude app show you a page titled "builder: preview test"** during the first session? Yes or no. It decides whether live pages can be part of the evidence.

**8. [Server] A demo server**, when you are ready to spend. Verified prices are in design note 4.3; recommended Hetzner CPX32 at €30.49 per month excl. VAT, re-read on the day you approve. Not needed until 0.6b and the demo.

The model key is not asked for yet. It is created at checkpoint 1, with the spending limits ($100 a month and $20 a project proposed).

## Money

| Meter | Figure |
| --- | --- |
| Model key spend this month | $0.00. No key exists; no real model call has been made |
| Monthly limit | Not yet set (proposed $100) |
| Per-project cap | Not yet set (proposed $20) |

## What the next session does

Follow `docs/BUILD-PLAN.md` section 3: take the first package in section 7 that is not tested and whose dependencies are met. With no owner answers, that is 0.2, then 1.1, then W4. With L9 answered, 0.4 and 1.2 open up; with L11, 0.3 and 0.5.

## How the development machine is started

`CLAUDE.md`, Commands. In short: start the Docker daemon directly, start PostgreSQL, run the database script in `builder/`. Measured on 11 Nov 2026: 4 processors, 15 GiB memory, 30 GB disk; containers need the host network and the session proxy's certificate (`docs/ENVIRONMENT-CHECK.md`).
