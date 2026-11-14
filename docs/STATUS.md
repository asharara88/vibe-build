# Status

> ## Stop: this file is out of date. Read this box first (added 14 November 2026)
>
> **Everything below this box says "nothing is built". That is true of the `main` branch only.** A branch is a named line of history in the repository; `main` is the one a new session starts from.
>
> The work done since 11 November is on a different branch, **`claude/stage-1`**. It is 445 commits ahead of `main` (at commit `bdfd911`, last changed 14 November 2026, 05:05 UTC) and has never been merged into `main`. It has its own `docs/STATUS.md`, `docs/BUILD-PLAN.md` and `docs/QUESTIONS.md`, and those are the current ones.
>
> **What went wrong.** A session that starts from `main` reads this file, is told nothing is built, and is sent to start work that already exists. That happened twice on 14 November 2026: in the session behind pull request #44, and in this one, which was asked to "start the walking skeleton".
>
> **What this session did.** It wrote no product code. It compared the task it was given with `claude/stage-1`, wrote this box, and asked the owner which line of work to continue.
>
> **The four parts this session was asked to start, and where they already are on `claude/stage-1`:**
>
> | Part asked for | On `claude/stage-1` | Its own record says |
> | --- | --- | --- |
> | Starter app, Next.js, English and Arabic | Exists: `templates/next/` (57 files, `messages/en.json` and `messages/ar.json`) | Role guard, licence rule and Arabic wording list marked tested |
> | Starter app, Django | **Not built.** Waiting on the owner: its database driver `psycopg` is under the LGPL-3.0 licence, which is not permissive (that branch's question 3) | Parked |
> | Sandbox manager, two profiles | Exists: `builder/src/sandbox/`, both profiles named in `manager.ts` | Development profile tested. Server profile not started: it waits for a server |
> | Model gateway with meter and cap | Exists: `builder/src/gateway/`, the cap built as "holds" (money set aside before each call) | Tested against a stand-in provider only. No real model call. Spend $0.00 |
> | Project store and append-only event log, PostgreSQL | Exists: `builder/src/store/`, twelve migrations; updates and deletes of events are refused by the database | Tested |
>
> That branch also holds work beyond today's task: a scripted stand-in for the build engine, an acceptance runner, the builder's own screens and a live preview. Its record says 692 of 692 tests passed on 13 November.
>
> **Checked by this session, and how:** the branch's file list, its migrations, its `manager.ts` and its documents were read at `bdfd911`. Its type check was run and passed. The open pull requests were listed: #39, #42, #43 and #45 point at `claude/stage-1`; #44 points at `main`.
>
> **Not checked by this session:** its tests. They were started and cut off after seven minutes without a result, and the containers and folders they left were removed. Its licence check was run and reported "FAILED", giving as its reason that packages in a sub-folder were not installed; this session had not done that set-up and did not look further, so this is not evidence for or against the check. Everything in the right-hand column of the table is that branch's own claim, not this session's finding.
>
> **Also not on `claude/stage-1` yet:** the decision of 14 November 2026 on connectors (no other vendor's app builder; the Supabase, Vercel, Render, HubSpot and Gmail connectors not used). It is only in pull request #44, against `main`.
>
> **Waiting on the owner:** which line of work continues. Until that is answered, do not start product code from `main`.

Read this first in every session. Update it before every session ends. Nothing else carries over between sessions.

**Last updated:** 14 November 2026, after the decision on connectors and the screens mock-up.

## Current state

- **Nothing is built.** No product code exists. The repository holds the handover, the project rules, the specification, the Stage 1 design note and the working documents.
- **Task 0 (set up the repository): done.** Environment checked and recorded in `docs/ENVIRONMENT-CHECK.md`. `README.md`, `LICENSE`, `.gitignore`, `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/OPEN-DECISIONS.md`, `docs/KNOWN-GAPS.md`, `docs/SOURCES.md` and `docs/spec/` created. `HANDOVER.md` left as supplied. Merged into `main` as pull request #1 (checked 14 November 2026: the merge is the latest entry on `main`).
- **Task 1 (design note): done and approved.** The owner approved `docs/design/stage-1.md` as written on 11 November 2026 and answered the questions in section 9; the answers are in `docs/DECISIONS.md`. Still open: the demo candidate, the monthly spending limit figure, the model key.
- **Network change: done.** The owner asked for the research sites to be allowed. Nineteen hosts were added to the personal Default cloud environment's allowed list with the owner's approval (list in `docs/OPEN-DECISIONS.md`). Verified reachable afterwards: Hetzner, DigitalOcean, AWS, PostgreSQL, Django docs, OpenAI developer docs, Core42. Oracle's site answers 403 to this session's requests, which is Oracle refusing automated requests, not the network policy.
- **Prices and blocked documentation: read.** Hetzner and DigitalOcean prices read from their pages; Oracle, AWS and Azure UAE regions confirmed from their pages, but their price tables are drawn by a script and were not readable here. Django, PostgreSQL, Bedrock, Core42 Compass and the Codex SDK documentation read and recorded in `docs/SOURCES.md`. Still unread: the law-firm note on the UAE data law (site blocks automated requests) and OpenAI's API terms.

- **Connectors and plugins: decided, 14 November 2026.** The owner asked which connectors (links that let Claude Code act inside another service) would help. Answer: none need adding. GitHub, the built-in browser and the review skills cover the walking skeleton. The owner then asked to use Lovable, chose "mock-up only", and afterwards told Claude Code to lead. Decision: no other vendor's app builder is used for this project in any form, and the list of connectors not to use here is in `docs/DECISIONS.md`. Nothing was built in Lovable and no build message was sent; Claude Code read the list of the owner's Lovable workspaces once, which is a read and spends no credits.
- **Screens mock-up: made, 14 November 2026. Not product code.** The owner agreed to the connector decision and asked for a preview. A mock-up of the builder's own screens was made on a design canvas in the owner's Claude account: https://claude.ai/artifact/5aamHqk33hMYv8PJNcMsgn (private to the owner). Nine screens: the journey in English (ask, questions, brief, plan with the acceptance checklist, build, acceptance run, record with cost and export) and two of them in Arabic, right to left (questions, acceptance run). The content is test example 1, the leave-request app, with made-up names. Every screen carries a banner saying it is a mock-up and that nothing on it has been built or run. Money figures are left as `[COST]` and `[CAP]` because nothing is measured. It was made by Claude Code with Anthropic's design canvas, not with another vendor's app builder. The mock-up's files are not in this repository; the canvas holds them. Limits are in `docs/KNOWN-GAPS.md`, gap 17.

## What was verified, and how

- Development machine: containers run, Compose runs PostgreSQL 16, hardened container flags work, and containers reach the npm registry, PyPI and the Anthropic API when given the host network, the session proxy and its certificate. Run and recorded in `docs/ENVIRONMENT-CHECK.md`.
- Anthropic documentation for the Agent SDK (overview, hosting, secure deployment, permissions), the cloud sessions, the memory page, model prices and the plan's API credits: read on 11 November 2026 and recorded in `docs/SOURCES.md`.
- The owner's four new facts for Decision F: the LLM-gateway statement and OpenRouter's regions were re-read today and confirmed; the Core42 and OpenAI pages are not reachable from this session and are carried as the owner's verification. OpenAI's Codex repository was read and is Apache-2.0.
- Licences and current versions of every candidate component: read from each project's own repository or package index and recorded in `docs/SOURCES.md`.
- **Not verified:** any cloud provider's price from its own page (hosts blocked by the session's network policy); Django's documentation; PostgreSQL's licence page; Bedrock, Azure and Core42 pages on in-country model processing. All marked as assumptions or search results in the design note.

## Preview test

At the end of the session a one-page test server was started inside the session on port 8080 and the port was reported to the Claude app. Whether the owner could open it is not known to this session. **Owner: say whether a page titled "builder: preview test" was shown to you.** If yes, the open question "can a service inside a cloud session be opened from outside" is answered yes, and milestone evidence can include a live page as well as screenshots. If no, screenshots and recordings remain the only way until a demo server exists. The server does not survive the session pausing.

## Next step

1. The owner creates the model key and sets it as `BUILDER_MODEL_API_KEY` on the personal cloud environment (never in the conversation), and confirms the monthly limit and project cap.
2. The walking skeleton (design note, section 7), on both candidate stacks, on its own branch and pull request, with the evidence in the pull request. The non-model parts (template, sandbox manager, gateway, event log) can start before the key exists; the first model call cannot.

## Blocked, and on whom

| What | On whom | Why |
| --- | --- | --- |
| First model call | Owner | Model key not yet set; monthly limit and cap figures to confirm |
| Demo-server decision | Owner | Options with verified prices are in `docs/OPEN-DECISIONS.md` item 5; recommended Hetzner CPX32 at €30.49 per month excl. VAT |
| Demo candidate | Owner | Undecided between D1, D2 and D3; not needed until the intake milestone |
| Mock-up feedback | Owner | Open the link, say whether every screen shows and what to change. Claude Code could not look at the rendered page |
| Connectors switched off | Owner | Written rule only until he switches them off; `docs/OPEN-DECISIONS.md` item 11, gap 16 |
| Second-engine milestone (Codex SDK) | Owner, later | OpenAI account and spend need a separate yes under hard rule 4 when that milestone comes |

## Session log

| Date | What was done |
| --- | --- |
| 14 Nov 2026 | Listed the connectors on the owner's account (36 installed, about 22 connected) and recommended adding none. Recorded the decision not to use other vendors' app builders or the connectors holding real contact data. Confirmed pull request #1 is merged. Made the screens mock-up on a design canvas at the owner's request. No product code written |
| 11 Nov 2026 (later) | The owner issued an edited handover (Decision F) and then approved the design note and answered its questions. Decisions recorded. Network hosts allowed with the owner's approval. Prices and blocked documentation re-fetched (see the design note, section 4.3 and `docs/SOURCES.md`) |
| 11 Nov 2026 | Repository set up from the empty state. Environment measured. Task 0 documents written. Specification cut from the handover. Stage 1 design note written as a proposal. Draft pull request opened. Preview test started |
