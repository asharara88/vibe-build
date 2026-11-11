# Decisions

Record every decision here with the date and who decided. **Owner** means Ahmed Sharara decided. **Claude Code** means a working session decided and the owner has not yet confirmed; the owner can overturn it. If this file and the owner disagree, the owner decides.

| Date | Decision | Standing |
| --- | --- | --- |
| 5 Nov 2026 | Output is controlled at four points: intake brief, approved plan built step by step, acceptance test from "Done means", fixed quality rules | Owner |
| 5 Nov 2026 | Two mechanisms: a business analyst in front, an optimiser behind | Owner |
| 5 Nov 2026 | Intake is a chat with closed-choice questions. Not a form, not free text | Owner |
| 5 Nov 2026 | The control layer does not defend the business on its own. The accumulated data does | Owner |
| 9 Nov 2026 | Build independently, from public sources only | Owner |
| 10 Nov 2026 | The product is the builder. Individual apps are examples of what it produces | Owner |
| 10 Nov 2026 | Markets in view: business groups with operating companies, property developers, car dealerships. None is fixed | Owner |
| 10 Nov 2026 | Build with Claude Code, starting from this handover | Owner |
| 10 Nov 2026 | Portable from the start. Hosting inside the UAE is built when a buyer requires it | Proposed in planning; confirm |
| 10 Nov 2026 | First use is a live demonstration to a group-level decision-maker | Proposed in planning; confirm |
| 10 Nov 2026 | `builder` is the working name in code and documents until a name is chosen | Owner (handover, section 2) |
| 11 Nov 2026 | `HANDOVER.md` is frozen as the record of the starting point. `docs/spec/` is the living specification, cut from Part B without change of substance | Owner (handover, Task 0); done by Claude Code |
| 11 Nov 2026 | The repository was empty, so a `main` branch was created holding only `HANDOVER.md` and `CLAUDE.md`, the two files the handover describes as the starting point. All Task 0 and Task 1 work is on a separate branch with a pull request against `main` | Claude Code; owner to confirm. Reason: a pull request needs a base branch, and the handover asks for one |
| 11 Nov 2026 | The copyright notice is "© 2026 Ahmed Sharara, all rights reserved", in `LICENSE` and `README.md`. Legal owner to be revisited when a company exists | Owner (handover, Task 0 and section 14.9) |
| 11 Nov 2026 | The Stage 1 design note is written as a proposal and no product code is written until the owner approves it | Owner (handover, Task 1) |
| 11 Nov 2026 | The owner issued an edited `HANDOVER.md` the same day: gate item 9 (two test examples built with a second build engine), Decision F (staying adaptable: model source and build engine as two seams, profiles, certification per profile) and four new verified facts. Task 1 now covers decisions A to F. The edited file replaces the first in the repository; Part B is unchanged | Owner |
| 11 Nov 2026 | The Stage 1 design note (`docs/design/stage-1.md`) is approved as written. The walking skeleton is the next task | Owner |
| 11 Nov 2026 | Licence exception under hard rule 2: the Claude Agent SDK, governed by Anthropic's Commercial Terms of Service, may be used as the build engine, behind an interface of our own so it can be replaced | Owner, in writing in the session chat |
| 11 Nov 2026 | The websites needed for pricing and documentation research are to be allowed in the cloud environment's network settings "for now". The exact list is in `docs/OPEN-DECISIONS.md` item 11 | Owner |
| 11 Nov 2026 | English and Arabic from the first version. The template is built with translation and right-to-left layout from the start, and both candidate stacks are judged on it | Owner |
| 11 Nov 2026 | Step approval stays the default. A run-through mode is offered only in a rehearsed demonstration and is labelled as such on screen | Owner |
| 11 Nov 2026 | The owner's Claude plan is Ultra, which includes $200 of API credits per month (verified 11 Nov 2026). The monthly spending limit and the default project cap are still to be set; proposed $100 and $20 | Owner (plan); limit to confirm |
| 11 Nov 2026 | A reviewing engineer reads the gateway and the sandbox manager after the walking skeleton, and reviews again before the demo | Owner |
| 11 Nov 2026 | Confirmed: portable from the start, with hosting inside the UAE built when a buyer requires it. Confirmed: the first use is a live demonstration to a group-level decision-maker | Owner |
| 11 Nov 2026 | The `main` branch created by Claude Code with the two starting files stands | Owner (no objection) |
| 11 Nov 2026 | The second build engine for gate item 9 is OpenAI's Codex SDK, driven through the same build-engine interface as the Claude Agent SDK. Its repository is Apache-2.0 (verified); the OpenAI account, key and spend it needs are a separate approval under hard rule 4 when that milestone comes | Owner |
| 11 Nov 2026 | Pull request #1 merged into `main` on the owner's instruction to lead the project forward. The walking skeleton proceeds on its own branch and pull request, one increment at a time | Owner ("lead the way"); done by Claude Code |
| 11 Nov 2026 | The builder itself is written in TypeScript on Node.js 22. Reason: both engine SDKs (Claude Agent SDK, Codex SDK) and Playwright are TypeScript-first, so one reviewer can cover the builder and the TypeScript candidate stack. If the Django candidate wins Decision D, the generated apps are Python and the builder stays TypeScript | Claude Code; owner may overturn |
| 11 Nov 2026 | The engine's container never holds the model key. It holds a project token issued by the builder; the gateway maps the token to the project and substitutes the real key. Only the token's hash is stored | Claude Code (design note 2.4 made concrete) |
| 11 Nov 2026 | The gateway refuses any model not in the price table, so no call can go unmetered. The price table carries its source and date | Claude Code |

