# Project rules

This repository holds **the builder**: a system that turns a plain-language business need into a working internal web app. It controls the outcome through a guided intake, an approved plan, an acceptance test and fixed quality rules.

- Full context: `HANDOVER.md`. Read it in full once. Do not edit it.
- Current state: `docs/STATUS.md`. Read it at the start of every session once it exists.
- Product specification: `docs/spec/`, one file per section. `HANDOVER.md` Part B is the frozen original.
- Design note for Stage 1: `docs/design/stage-1.md`. No product code until the owner has approved it.

## Every session

1. Read `docs/STATUS.md`. If it does not exist yet, read `HANDOVER.md` in full.
2. Before you start, say in two or three plain sentences what you are about to do and what the owner will see at the end.
3. Before you end, update `docs/STATUS.md`: what was done, what was verified and how, what is next, what is blocked and on whom. Nothing else carries over between sessions.

## The owner

Ahmed Sharara is the founder and the only person on the project. He does not read code. He judges by what he can see working. In documents, call him Ahmed Sharara or "the owner".

- Plain language. Explain any technical term in one line the first time you use it.
- One decision at a time, as a multiple choice, with your recommendation and the reason.
- No time estimates unless they rest on something measured. Describe scope: what will be done, what can be verified, what needs him.
- Separate what you checked from what you assume, every time.
- Show results: screenshots or a recording from an automated run, or a link he can open. Not descriptions.
- Never say something is secure, ready, reviewed or needs no engineer unless that has been shown.
- Keep messages short. Put detail in `docs/`.

## Hard rules

1. Independent build. Public documentation and permissively licensed open source only. Never use or look for another vendor's code or non-public material.
2. Record every dependency's licence. Permissive licences only, unless the owner approves otherwise in writing.
3. No secrets in the repository, logs, screenshots or conversation.
4. No paid service or sign-up without the owner's explicit yes. Show the price and its source first.
5. Made-up data only. No real customer data.
6. No claims of security, compliance, readiness, or of being first or only, anywhere.
7. Anything shown as live is live. A check counts as passed only if it ran and passed, with evidence.
8. Never weaken, skip or delete a check to make a build pass.
9. Generated code and the build engine run only in containers. No destructive commands outside this project. No force-push. The main branch always works.
10. No prospect, customer or contact names in the repository.

## Ways of working

- One branch and one pull request per task. Small commits. Plain-language pull request summaries.
- Before you say something works, run it and show the result.
- Before you report a milestone, have a fresh reviewer agent that did not write the code check your claims against the evidence.
- Record decisions in `docs/DECISIONS.md` with the date and who decided.
- Record every shortcut and risk in `docs/KNOWN-GAPS.md` when you take it. Security first.
- Record every outside fact you rely on in `docs/SOURCES.md`, with the link and the date you checked it.
- If a step needs a human engineer's judgement, say so before you take it.
- If you are unsure what the owner wants, ask. Do not guess on anything that costs money or is hard to undo.

## Commands

All run inside `builder/`.

- `bash scripts/dev-db.sh`: create the local databases (development machine only, peer authentication, no password).
- `npm run typecheck`, `npm test`, `npm run check:licences`: the fast checks. Run all three before every push.
- `npm run db:migrate`: apply migrations to the database named by `BUILDER_DATABASE_URL`.
- `npm run gateway`: start the model gateway; needs `BUILDER_MODEL_API_KEY`.
- `npx tsx scripts/demo-cap.ts`: the cap demonstration against a stand-in provider.

- Cloud session set-up: `service docker start`. The Docker daemon is not running when a session begins (measured 11 Nov 2026).
- Containers in a cloud session need `--network host`, the proxy variables and the proxy certificate at `/root/.ccr/ca-bundle.crt` mounted, or they have no internet. See `docs/ENVIRONMENT-CHECK.md`.
