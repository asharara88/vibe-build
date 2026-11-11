# builder

© 2026 Ahmed Sharara. All rights reserved. This code is proprietary. See `LICENSE`.

**What this project is.** This is a builder that turns a plain-language business need into a working internal web application. A business analyst, run by an AI model, interviews the user with closed-choice questions and writes a brief, a build plan and an acceptance test, and nothing is built until the user confirms them. The app is then built one step at a time, each step is checked against fixed quality rules, and the finished app must pass the acceptance test that was agreed before building started. The user is a non-technical employee, and the result is an ordinary codebase that the customer owns and can run on any cloud. `builder` is a working name until the owner chooses one.

**State: the walking skeleton is being built.** The design note (`docs/design/stage-1.md`) was approved on 11 November 2026. The first pieces of the builder exist in `builder/`: the app spec, the append-only event log and the model gateway with its cost meter and cap, each with tests. Nothing can yet build an app; no demonstration exists yet. `docs/STATUS.md` has the current state.

## Where to look

| File | What it is |
| --- | --- |
| `HANDOVER.md` | The starting point. Read once. Not edited after 10 November 2026 |
| `CLAUDE.md` | Rules for every working session |
| `docs/STATUS.md` | Current state, next step, what is blocked and on whom |
| `docs/design/stage-1.md` | The Stage 1 design note, awaiting the owner's approval |
| `docs/spec/` | The living specification of the control layer |
| `docs/DECISIONS.md` | Decisions, with date and who decided |
| `docs/OPEN-DECISIONS.md` | Decisions the owner still has to make |
| `docs/KNOWN-GAPS.md` | Shortcuts, risks, and what a reviewing engineer should look at first |
| `docs/SOURCES.md` | Every outside fact relied on, with link and date checked |
| `docs/ENVIRONMENT-CHECK.md` | What the development machine can and cannot do, measured |
| `builder/` | The builder's code (TypeScript). `npm test` runs its tests |
| `evidence/` | Output of automated runs, dated, referenced from pull requests |
