# Stand-in acceptance tests

**Stand-in tests, written in advance by Claude Code (the AI assistant building this project), not by the builder's acceptance writer.** The builder makes no model call for them.

The owner allowed them on 13 November 2026 (his answer to question 12, option (a), `docs/DECISIONS.md`) **only to develop and test the acceptance runner** (package 3.1). They show that the tests are kept apart from the engine. They are not independent acceptance: the same author wrote the scripted app's changes and these tests, knowing the app. The acceptance check at the skeleton report is written by the acceptance writer through a real model call (package 3.2b).

Why this folder is here, at the top of the repository: no container mounts it. The engine's container mounts `builder/scripted` and the project's workspace; the egress container mounts `builder/`. The builder copies these files into its acceptance store (outside the repository, under the folder named by the setting `BUILDER_DATA_DIR`), putting a fresh random marker into each file's label line, and the runner reads them from there.

- `example-1/item-01.spec.ts`: example 1, acceptance item 1. An employee signs in, submits a five-day request, and sees it in their list with status "waiting".
