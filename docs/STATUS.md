# Status

Read this first in every session. Update it before every session ends. Nothing else carries over between sessions.

**Last updated:** 11 November 2026, walking skeleton increment 1 (gateway, event log, app spec).

## Current state

- **Walking skeleton, increment 1: built and tested.** Branch `claude/walking-skeleton`. In `builder/`: the app spec (the machine-readable brief) with test example 1 written out in full; the project store and append-only event log in PostgreSQL (updates and deletes are refused by the database); the model gateway, which holds the real key, gives the engine a project token instead, meters every call from the provider's usage figures and the dated price table, and refuses a call that would cross the project's cap, in plain words. 14 tests pass. Licence check passes (17 production packages, MIT and ISC). Evidence: `evidence/2026-11-11-skeleton-1/gateway-cap.md`.
- **Walking skeleton, increment 2: built and tested.** The egress proxy (a project's only way out: allowed hosts pass, everything else is refused and logged) and the sandbox manager (one set of containers per project, hardened, in two profiles: `server` with an internal network and the egress proxy as the only bridge, and `development-cloud-session` for this machine). A live test starts a project's database and egress proxy, shows an allowed host answering and a refused host blocked, and removes everything. A fresh reviewer's findings on the gateway were fixed: parallel calls are held to the cap, abandoned streams are recorded, only two paths are forwarded, redirects are not followed, TRUNCATE is refused, one-hour cache writes and fast mode are priced, and the served model is priced rather than the requested one. 38 tests pass. Evidence: `evidence/2026-11-11-skeleton-2/sandbox-egress.md`.
- **Walking skeleton, increment 3, part one: the TypeScript house template, built and running.** `templates/next/`: Next.js 16 with sign-in by email and password through a maintained library, three sample roles, a role check before every page, who-and-when stamps for every app table, English and Arabic with right-to-left layout, validated forms with plain-words messages, an empty state, a sample-data banner, settings from the environment only, and a two-stage container image. The sandbox manager now builds the app image and runs the app next to the project's database. Evidence with seven browser screenshots: `evidence/2026-11-11-skeleton-3/next-template.md`. Whole run (build, tables, seed, start, screenshots) about 17 seconds after the first build.
- **Increment 3, part two: the Django template is waiting on the owner.** Django's PostgreSQL driver is LGPL-3.0, which hard rule 2 does not allow without the owner's written exception (`docs/OPEN-DECISIONS.md`, item 10). Nothing LGPL has been installed.
- **Not yet built:** the engine adapter, the acceptance runner, the exporter, the harness, any app screen beyond sign-in and home. No app can be built yet.

- **Nothing is built.** No product code exists. The repository holds the handover, the project rules, the specification, the Stage 1 design note and the working documents.
- **Task 0 (set up the repository): done.** Environment checked and recorded in `docs/ENVIRONMENT-CHECK.md`. `README.md`, `LICENSE`, `.gitignore`, `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/OPEN-DECISIONS.md`, `docs/KNOWN-GAPS.md`, `docs/SOURCES.md` and `docs/spec/` created. `HANDOVER.md` left as supplied. Work is on branch `claude/new-session-ftnls6`; draft pull request: https://github.com/asharara88/vibe-build/pull/1
- **Task 1 (design note): done and approved.** The owner approved `docs/design/stage-1.md` as written on 11 November 2026 and answered the questions in section 9; the answers are in `docs/DECISIONS.md`. Still open: the demo candidate, the monthly spending limit figure, the model key.
- **Network change: done.** The owner asked for the research sites to be allowed. Nineteen hosts were added to the personal Default cloud environment's allowed list with the owner's approval (list in `docs/OPEN-DECISIONS.md`). Verified reachable afterwards: Hetzner, DigitalOcean, AWS, PostgreSQL, Django docs, OpenAI developer docs, Core42. Oracle's site answers 403 to this session's requests, which is Oracle refusing automated requests, not the network policy.
- **Prices and blocked documentation: read.** Hetzner and DigitalOcean prices read from their pages; Oracle, AWS and Azure UAE regions confirmed from their pages, but their price tables are drawn by a script and were not readable here. Django, PostgreSQL, Bedrock, Core42 Compass and the Codex SDK documentation read and recorded in `docs/SOURCES.md`. Still unread: the law-firm note on the UAE data law (site blocks automated requests) and OpenAI's API terms.

## What was verified, and how

- Development machine: containers run, Compose runs PostgreSQL 16, hardened container flags work, and containers reach the npm registry, PyPI and the Anthropic API when given the host network, the session proxy and its certificate. Run and recorded in `docs/ENVIRONMENT-CHECK.md`.
- Anthropic documentation for the Agent SDK (overview, hosting, secure deployment, permissions), the cloud sessions, the memory page, model prices and the plan's API credits: read on 11 November 2026 and recorded in `docs/SOURCES.md`.
- The owner's four new facts for Decision F: the LLM-gateway statement and OpenRouter's regions were re-read today and confirmed; the Core42 and OpenAI pages are not reachable from this session and are carried as the owner's verification. OpenAI's Codex repository was read and is Apache-2.0.
- Licences and current versions of every candidate component: read from each project's own repository or package index and recorded in `docs/SOURCES.md`.
- **Not verified:** any cloud provider's price from its own page (hosts blocked by the session's network policy); Django's documentation; PostgreSQL's licence page; Bedrock, Azure and Core42 pages on in-country model processing. All marked as assumptions or search results in the design note.

## Preview test

At the end of the session a one-page test server was started inside the session on port 8080 and the port was reported to the Claude app. Whether the owner could open it is not known to this session. **Owner: say whether a page titled "builder: preview test" was shown to you.** If yes, the open question "can a service inside a cloud session be opened from outside" is answered yes, and milestone evidence can include a live page as well as screenshots. If no, screenshots and recordings remain the only way until a demo server exists. The server does not survive the session pausing.

## Next step

1. Increment 3, part two: the Django template, once the owner answers the LGPL question (`docs/OPEN-DECISIONS.md` item 10). If declined, Decision D is settled on the TypeScript candidate without a measurement, and the design note says so.
2. Increment 4: the engine adapter for the Claude Agent SDK, driving the two fixed steps for example 1 through the gateway, on the TypeScript template. **Needs the model key.** Until the key exists, the adapter and its hooks can be written and tested against a stand-in.
3. Increment 5: the acceptance runner (Playwright in its own container), the export check, and the skeleton report.

## Blocked, and on whom

| What | On whom | Why |
| --- | --- | --- |
| Increment 4 (engine adapter) | Owner | Model key not yet set as `BUILDER_MODEL_API_KEY`; monthly limit and cap figures to confirm |
| Demo-server decision | Owner | Options with verified prices are in `docs/OPEN-DECISIONS.md` item 5; recommended Hetzner CPX32 at €30.49 per month excl. VAT |
| Demo candidate | Owner | Undecided between D1, D2 and D3; not needed until the intake milestone |
| Second-engine milestone (Codex SDK) | Owner, later | OpenAI account and spend need a separate yes under hard rule 4 when that milestone comes |

## Session log

| Date | What was done |
| --- | --- |
| 11 Nov 2026 (skeleton 3a) | TypeScript house template built and run in the sandbox with screenshots. Django template held pending the LGPL exception. Known gaps 28 to 31 |
| 11 Nov 2026 (skeleton 2) | Reviewer's gateway findings fixed. Egress proxy and sandbox manager built with tests and a live run. Known gaps 20 to 26 added. Pull request #2 updated |
| 11 Nov 2026 (skeleton 1) | Pull request #1 merged. Builder project created in TypeScript. App spec, event log and gateway built with tests and evidence. Pull request #2 opened |
| 11 Nov 2026 (later) | The owner issued an edited handover (Decision F) and then approved the design note and answered its questions. Decisions recorded. Network hosts allowed with the owner's approval. Prices and blocked documentation re-fetched (see the design note, section 4.3 and `docs/SOURCES.md`) |
| 11 Nov 2026 | Repository set up from the empty state. Environment measured. Task 0 documents written. Specification cut from the handover. Stage 1 design note written as a proposal. Draft pull request opened. Preview test started |
