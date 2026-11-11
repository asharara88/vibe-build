# Status

Read this first in every session. Update it before every session ends. Nothing else carries over between sessions.

**Last updated:** 11 November 2026, after the owner's decisions on the design note.

## Current state

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

1. Merge pull request #1 (the owner, or Claude Code on the owner's word).
2. The owner creates the model key and sets it as `BUILDER_MODEL_API_KEY` on the personal cloud environment (never in the conversation), and confirms the monthly limit and project cap.
3. Then: the walking skeleton (design note, section 7), on both candidate stacks, on its own branch and pull request, with the evidence in the pull request. The non-model parts (template, sandbox manager, gateway, event log) can start before the key exists; the first model call cannot.

## Blocked, and on whom

| What | On whom | Why |
| --- | --- | --- |
| First model call | Owner | Model key not yet set; monthly limit and cap figures to confirm |
| Demo-server decision | Owner | Options with verified prices are in `docs/OPEN-DECISIONS.md` item 5; recommended Hetzner CPX32 at €30.49 per month excl. VAT |
| Demo candidate | Owner | Undecided between D1, D2 and D3; not needed until the intake milestone |
| Second-engine milestone (Codex SDK) | Owner, later | OpenAI account and spend need a separate yes under hard rule 4 when that milestone comes |

## Session log

| Date | What was done |
| --- | --- |
| 11 Nov 2026 (later) | The owner issued an edited handover (Decision F) and then approved the design note and answered its questions. Decisions recorded. Network hosts allowed with the owner's approval. Prices and blocked documentation re-fetched (see the design note, section 4.3 and `docs/SOURCES.md`) |
| 11 Nov 2026 | Repository set up from the empty state. Environment measured. Task 0 documents written. Specification cut from the handover. Stage 1 design note written as a proposal. Draft pull request opened. Preview test started |
