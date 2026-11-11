# Status

Read this first in every session. Update it before every session ends. Nothing else carries over between sessions.

**Last updated:** 11 November 2026, end of the first session (Task 0 and Task 1).

## Current state

- **Nothing is built.** No product code exists. The repository holds the handover, the project rules, the specification, the Stage 1 design note and the working documents.
- **Task 0 (set up the repository): done.** Environment checked and recorded in `docs/ENVIRONMENT-CHECK.md`. `README.md`, `LICENSE`, `.gitignore`, `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/OPEN-DECISIONS.md`, `docs/KNOWN-GAPS.md`, `docs/SOURCES.md` and `docs/spec/` created. `HANDOVER.md` left as supplied. Work is on branch `claude/new-session-ftnls6` with a draft pull request against `main`.
- **Task 1 (design note): done as a proposal.** `docs/design/stage-1.md`, awaiting the owner's approval. No product code until then.

## What was verified, and how

- Development machine: containers run, Compose runs PostgreSQL 16, hardened container flags work, and containers reach the npm registry, PyPI and the Anthropic API when given the host network, the session proxy and its certificate. Run and recorded in `docs/ENVIRONMENT-CHECK.md`.
- Anthropic documentation for the Agent SDK (overview, hosting, secure deployment, permissions), the cloud sessions, the memory page, model prices and the plan's API credits: read on 11 November 2026 and recorded in `docs/SOURCES.md`.
- Licences and current versions of every candidate component: read from each project's own repository or package index and recorded in `docs/SOURCES.md`.
- **Not verified:** any cloud provider's price from its own page (hosts blocked by the session's network policy); Django's documentation; PostgreSQL's licence page; Bedrock, Azure and Core42 pages on in-country model processing. All marked as assumptions or search results in the design note.

## Preview test

At the end of the session a one-page test server was started inside the session on port 8080 and the port was reported to the Claude app. Whether the owner could open it is not known to this session. **Owner: say whether a page titled "builder: preview test" was shown to you.** If yes, the open question "can a service inside a cloud session be opened from outside" is answered yes, and milestone evidence can include a live page as well as screenshots. If no, screenshots and recordings remain the only way until a demo server exists. The server does not survive the session pausing.

## Next step

1. The owner answers the decisions in `docs/design/stage-1.md` section 9, in order. The first two unblock the walking skeleton.
2. The owner creates the model key and sets it as `BUILDER_MODEL_API_KEY` on their personal cloud environment (never in the conversation).
3. Then: the walking skeleton (design note, section 7), on both candidate stacks, with the evidence in a pull request.

## Blocked, and on whom

| What | On whom | Why |
| --- | --- | --- |
| Any product code | Owner | Design note not yet approved |
| Licence exception for the Claude Agent SDK | Owner | Hard rule 2; see `docs/OPEN-DECISIONS.md` item 12 |
| Demo-server prices from provider pages | Owner | Session network policy blocks the hosts; see `docs/OPEN-DECISIONS.md` item 11 |
| First model call | Owner | Model key not yet set |

## Session log

| Date | What was done |
| --- | --- |
| 11 Nov 2026 | Repository set up from the empty state. Environment measured. Task 0 documents written. Specification cut from the handover. Stage 1 design note written as a proposal. Draft pull request opened. Preview test started |
