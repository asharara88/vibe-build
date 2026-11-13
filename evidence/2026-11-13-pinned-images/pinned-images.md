# The approved images pinned by digest, with a check; the sandbox test's readiness wait

| | |
| --- | --- |
| Date | 13 November 2026 |
| Why | (1) The owner approved question 11 (a) for the builder's internal development and testing only: `node:22-alpine` at `sha256:0e1754758c2d…` and `postgres:16-alpine` at `sha256:aa6cb33cf4c1…`, and asked for "the approved versions" to be pinned (`docs/DECISIONS.md`, the row "Question 11, option (a), approved"). (2) An outside reviewer's finding the owner passed on: "the test asks the database if it is ready once, without waiting, so it can fail on a slow start" |
| Package | None in the plan's table; recorded in `docs/DECISIONS.md` (13 Nov), as the plan's rules allow |
| Run on | The development machine (a cloud session): host Docker 29.9.2 with the containerd image store, Node 22.23.4. The live tests start containers on the host's Docker (development profile), under the lock shared with other sessions |
| Result | Both shown, with the limits below. The check is a unit test; it reads files and starts nothing |

## 1. Every image reference changed

| Before (at `f6f5007`) | After |
| --- | --- |
| `builder/src/sandbox/manager.ts:87` `postgres: "postgres:16-alpine"` | `:93` `"postgres:16-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139"` |
| `builder/src/sandbox/manager.ts:88` `node: "node:22-alpine"` | `:94` `"node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202"` |
| `builder/scripts/demo-isolation.ts:109` `"node:22-alpine"` (a `docker run` argument) | `:109` `DEFAULT_IMAGES.node` |
| `builder/test/sandbox.test.ts:306` `"FROM node:22-alpine\nENTRYPOINT []\n"` (an inline build file) | `:332` `` `FROM ${DEFAULT_IMAGES.node}\nENTRYPOINT []\n` `` |
| `builder/test/scripted-engine.test.ts:192` `image: "node:22-alpine"` (an expected compose field) | `:192` `image: DEFAULT_IMAGES.node` |
| `builder/test/scripted-engine.test.ts:618` "Needs Docker and node:22-alpine." (a comment) | `:618` "Needs Docker and the approved Node image (DEFAULT_IMAGES.node)." |
| `builder/test/scripted-engine.test.ts:926` `"node:22-alpine"` (a `docker run` argument) | `:926` `DEFAULT_IMAGES.node` |
| `templates/next/Dockerfile:2` `FROM node:22-alpine AS build` | `:4` `FROM node:22-alpine@sha256:0e1754758c2d… AS build` (full digest in the file) |
| `templates/next/Dockerfile:37` `FROM node:22-alpine AS run` | `:39` `FROM node:22-alpine@sha256:0e1754758c2d… AS run` |

The one place is the sandbox manager's table, `DEFAULT_IMAGES`; the tests and the script import it. A Dockerfile cannot import it, so the template names the digest itself, and the check holds it to the list. The list of approved images is `builder/approved-images.json` (image, digest, date approved, approved by, scope "internal development and testing only", the decision's row, the inventory's section). The scan's full listing, before and after: `run-scan-references.txt`.

**Docker accepts the form** (`run-docker-accepts-the-form.txt`): `docker image inspect` of both references; `docker pull` of both by tag@digest ("Image is up to date"; the database image's pull got Docker Hub's rate limit, HTTP 429, and succeeded at the second try); `docker build --check` of the template ("Check complete, no warnings found"); and a build file made of the template's own `FROM` lines with no `RUN` step, built to its `run` and its `tools` stages, both resolving the pinned reference from the machine's store. Control: the Node tag with the database image's digest is refused ("No such image"). The full template image was not built here (its build installs packages from the network); the live tests built the inline image and ran both images by digest (section 4).

## 2. The check

`builder/test/approved-images.test.ts`, with the scan in `builder/src/licence/approved-images.ts`, in `npm test`. It scans `builder/src`, `builder/scripts`, `builder/test`, `builder/scripted` (added to the four folders asked for) and `templates/` (skipping `node_modules`, `.next`, `.git`, `dist`, lock files and binary files) for: Dockerfile `FROM` lines (every one in a file named Dockerfile; in other files, at the start of a string, or at the start of a line when the operand looks like an image); `image:` fields with a written-out value; and words shaped like `name:tag` (tag starting with a version number or a common tag word, a number alone after a common image name, or a name with a `/`) or `name@digest`. Each must be exactly `<image>@<digest>` of an approved entry. Also let through: `${DEFAULT_IMAGES.<key>}` in a string, a `FROM` naming a stage its own file declares, and the builder's own images built from the template (`builder_<project>-app:latest`, `-tools:latest`). Its unit cases show each kind refused (unpinned, another digest, digest alone, a mistyped digest, an image not on the list, a computed `FROM`, YAML and registry images) and what it leaves alone (URLs, addresses, host and port, counts, times, Node's own modules, Tailwind classes, SQL, mounts). What it cannot see is known gap 67.

**The control** (`run-check-control.txt`): the template's `run` stage set back to `FROM node:22-alpine AS run`; the check failed, naming `templates/next/Dockerfile:39 FROM node:22-alpine (not pinned by digest: write the approved tag@digest)`; the change undone with `git checkout`; the check passed again (10 of 10).

## 3. The readiness wait

`builder/test/sandbox.test.ts` asked `pg_isready` once after `up --wait`. The database image's start script, read from the approved image without starting it (`read-database-start-script.txt`), starts a temporary server over the local socket to set the database up, stops it, then starts the real one; the sandbox's health check, `pg_isready` over the same socket, can pass on the temporary server. The test now asks every 500 ms for up to 30 s until the answer is "accepting connections" and keeps the same assertion. No other test asks once whether something is ready: the egress proxy's start is already waited for (up to 20 times 500 ms); `builder/scripts/demo-sandbox.ts` asks once, but it is a demonstration that prints the answer, not a test, and was left as is.

**Five runs** of the whole file, in a row, under the lock (`run-readiness-five-runs.txt`): 13 of 13 tests passed each time; the live database test took 3.2 to 3.7 s; no container left before or after. **Not shown:** whether any of these runs needed a second question (not recorded), so these runs show the wait does no harm, not that it catches a slow start.

## 4. The checks run

| Check | Where | Result | File |
| --- | --- | --- | --- |
| `npm run typecheck` | `builder/` | Passed | `run-typecheck.txt` |
| `npx vitest run` (the whole suite, live tests included, under the lock) | `builder/` | 247 of 247 passed, 10 files, twice: before and after the template's reinstall | `run-tests-full.txt`, `run-tests-full-2.txt` |
| `npm run check:licences` | `builder/` | Passed | `run-licences.txt` |
| `npm run check:licences`, `check:guards`, `npm test` | `templates/next/` | **First run: licence check failed**, guard check and tests passed. The worktree's installed packages dated from 11 Nov, before R1 took `sharp` out (the real `sharp` 0.35.5 was installed). Reinstalled from the lock file with `npm ci --ignore-scripts` (no package added; `package.json` and the lock unchanged); **second run: all three passed**, 39 of 39 tests | `run-template-checks-1-stale-install.txt`, `run-template-reinstall.txt`, `run-template-checks-2.txt` |
| Does anything use `python:3.13-slim`? | the repository | No: named only in `docs/ENVIRONMENT-CHECK.md`, known gap 61 and an old evidence listing; the environment was not changed | `run-python-image-grep.txt` |

## 5. Not done, or not shown

- No reviewer read this pull request's code before these runs (the plan's section 3, step 6: one fresh review for code that is not the gateway and cap, isolation, acceptance separation or key handling).
- The template's full image build with the pinned `FROM` lines (only its `FROM` lines were built, and Docker's own check of the file was run).
- That the check catches every way an image can be named (known gap 67).
- That the readiness wait was ever needed in these runs (section 3).
