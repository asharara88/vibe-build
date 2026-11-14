# Packages 2.1 and 0.5, reopened by package 3.2: their evidence run again

Package 3.2 changes two packages that were already marked tested (design `docs/design/package-3.2.md`, section 6;
build plan section 8, rule 8). Each is set back to "built" on 3.2's branch, `claude/pkg-3.2-exporter`, and its
evidence was run again there on 14 Nov 2026. Both passed. Run by `rerun.sh` (this folder), from `builder/`, under the
shared lock, with the scripted engine only, made-up data only, and no model called. The run is on commit `7c0c9c9`;
`builder/` is the same there as at `8e8e198`, where the controls ran (tree `f412c73`).

## What changed in each

- **2.1, the scripted engine:** step 01 (the data step) now writes 7 files, not 4: it adds its migration files
  (`drizzle/0001_leave_request.sql` and its snapshot) and replaces the migration journal, with new fingerprints. The
  engine protects more paths (23, among them `compose.yaml`, `README.md`, the template's first migration and the
  licence files), and a step that adds a file Docker Compose or the image build reads without being told fails.
- **0.5, set-up in a tools container:** the tables are made by `drizzle-kit migrate` from the fixed migration files,
  no longer `push`, then a drift check; the template's `.dockerignore` and its tools-stage comment changed.

## What was run, and the result

| Package | What was run | Result | File |
| --- | --- | --- | --- |
| 2.1 | Its demonstration, `npx tsx scripts/demo-scripted.ts ../templates/next <this folder>/package-2.1/screens` | **Exit code 0, 102 s.** Step 01: 7 `scripted.write` events, 7 turns, no usage, exactly the 7 files changed and committed. Step 02: 8 events, exactly its 8 files. The engine's probe: protected files refused (read-only), no network, only Docker's own settings. The guard check "RESULT: PASSED"; `next build` listed the two new pages. The tables by `drizzle-kit migrate` ("migrations applied successfully"), the drift check passed (the script stops otherwise), the three made-up users made, the table's 12 columns, 3 checks and 3 links read back. The screens: 20 checks, all "PASS", "RESULT: PASSED". Everything of the run removed | `package-2.1/run-demo-scripted.txt`, `package-2.1/screens/` |
| 0.5 | Its "Done means" demonstration, `npx tsx scripts/demo-template.ts ../templates/next <this folder>/package-0.5/screens --guard` | **Exit code 0, 115 s.** The stand-in seed step, run as the seed is run, saw exactly the named list, the image's own settings and Docker's two: no builder setting among the names, and no value equal to one of the builder's settings (checked twice, the second time with Compose given this process's whole environment plus made-up values for the builder's 11 settings: none of the 13 made-up values found inside). "PASSED" each time. Then the tables by `drizzle-kit migrate` and the drift check ("drift check passed"), the three users, the app healthy, the screenshots, and the role guard's 26 checks, "RESULT: PASSED". Everything removed | `package-0.5/run-demo-template.txt`, `package-0.5/screens/` |
| 0.5 | Its tests in `test/sandbox.test.ts` (the tools service and its named list; Docker's narrow environment and own client folder; a client configuration that adds proxy settings does not reach the tools container; a cut-off tools run removed with the project) | **8 passed**, exit code 0 (the file's other 15 tests left out by the name filter) | `package-0.5/run-tests-0.5.txt` |

Docker's lists were the same before and after each demonstration (no container; 8 images, 4 volumes, 3 networks).

## Checked by reading, not run

- 0.6a, which depends on 0.5: its scripts (`builder/scripts/demo-isolation.ts`, `builder/scripts/isolation-harness.ts`)
  name neither `makeTables` nor `drizzle-kit`, so the change to the tables does not touch them.
- 3.1, which depends on 2.1: its tests ran in the whole suite on the same code (`../run-tests-full.txt`). 2.2 is not built.

## What these runs do not show

- That 2.1 and 0.5 are tested again: that comes only with 3.2's merge and review (build plan section 10, their rows).
- In the 2.1 run, the two lines the script prints from the drift check are Docker Compose's own lines about the
  check's container, not drizzle-kit's; that the check passed is shown by the run going on (it stops on a drift).
- The guard check's printed text for the scripted pages is still wrong (known gap 52); its result is not affected.

## The pictures

Taken by the demonstrations, in the runner's container on the project's own network. Of 2.1's eight, six were looked
at (01, 03, 04, 05, 06, 07); of 0.5's fourteen, two (the wrong-password sign-in, where the password shows as dots, and
the "no access" page). Those looked at show only made-up data. The others are pages of the same made-up app, taken in
the same way as in packages 2.1's and 0.5's own evidence.
