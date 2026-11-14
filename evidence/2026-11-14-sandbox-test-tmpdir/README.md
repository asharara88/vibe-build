# The sandbox tests' folders in the temporary folder (14 Nov 2026)

**Why:** on 13 Nov, package J1 ran the whole suite with a `TMPDIR` of its own and found `builder-sb-*`, `builder-live-*`, `builder-home-*`, `builder-tools-*` and `builder-user-docker-*` folders left in it; removing that `TMPDIR` went with free disk rising from 2.6 GB to 5.8 GB (known gap 137). The folders' own sizes were not measured then.

**Where it ran:** this session's cloud machine, started fresh at 02:52 UTC on 14 Nov: Docker 29.9.2 and PostgreSQL 16 started by this session, the approved browser zip fetched (`scripts/fetch-browser.ts`, exit 0), `npm ci` in `builder/` and, for the licence check, in `builder/runner/` (gap 77). Not the machine J1 measured on. No other session's folder was under `/tmp/claude-0/` (listed at the start), so the lock (`flock <scratchpad>/live-tests.lock`) had no other holder here; it was taken all the same, for every run that starts containers.

**How:** every run below had a new, empty `TMPDIR` of its own, made by the script, and listed what was left in it afterwards, with `du -sh` for each entry. Scripts: `scripts/run-sandbox-file.sh` (one file) and `scripts/run-full-suite.sh` (the whole suite, on a test database made new for the run). The scratchpad's path is written `<scratchpad>` in the outputs.

## What was run, and what it showed

| Run | Code | Result | Left in `TMPDIR` | File |
| --- | --- | --- | --- | --- |
| `npx vitest run test/sandbox.test.ts`, before the fix | `14787d8`, test file blob `4133afc` (as committed) | 23 of 23 passed, exit 0 | **Seven folders of the tests:** four `builder-sb-*` (36 KB each), one `builder-home-*` (12 KB), two `builder-user-docker-*` (8 KB and 4 KB): **168 KB** in all (the sum of the seven `du -sh` figures; the commit message of `67dcea7` rounds it to "about 200 KB"). All owned by root, modes 700 and 755; no file of uid 1000, no read-only folder. Also `node-compile-cache` (2.6 MB), which no test makes (below) | `run-before.txt` |
| The same, first attempt, with a longer `TMPDIR` name | the same | 23 of 23 passed | The same seven folders and sizes | `run-before-first-long-tmpdir.txt` |
| The same command, after the fix | `67dcea7`'s test file, blob `e6f6cb3` (run before that commit, on the working tree that became it) | 23 of 23 passed, exit 0 | **No folder of the tests.** Only `node-compile-cache` (2.6 MB) | `run-after.txt` |
| After the fix, vitest started without npm (`node node_modules/vitest/vitest.mjs run test/sandbox.test.ts`) | the same | 23 of 23 passed, exit 0 | **Nothing: `TMPDIR` empty** | `run-after-without-npx.txt` |
| Who makes `node-compile-cache`: six commands, each with an empty `TMPDIR`, no test run | `14787d8` | `npm --version`, `npx vitest --version` and `npx tsc --version` leave it; `node -e 0`, and vitest or tsc started with `node`, leave nothing | — | `compile-cache-probe.txt` |
| The whole suite, before the fix | `14787d8`, builder/ tree `1035be8` | **687 of 692 passed, 5 failed**, exit 1 (below) | The same seven folders of `sandbox.test.ts` and **nothing from any other test file**; plus `node-compile-cache` (2.6 MB, npm's) and `tsx-0` (356 KB, made by tsx, which the suite's scripts run under). 3.1 MB in all | `run-full-suite-before.txt` |
| The whole suite, first attempt, stopped by hand after 12 minutes | `14787d8` | Failures in seven files: six from a `TMPDIR` path too long for tsx, one (`preview-live`) as in the next run (below); stopped, not counted | A stopped run leaves more: `builder-runner-build-*` (115 MB, the runner image's build folder) and `builder-acceptance-data-*` (4 KB), besides the seven | `run-full-suite-long-tmpdir-stopped.txt` |
| The whole suite, after the fix | `67dcea7`, builder/ tree `19bf82a` | **692 of 692 passed**, exit 0, 1,027 s; lock held 03:31:31 to 03:48:39 UTC; no container on the machine before or after. J3's live preview tests passed this time: the runner image was on the machine since the run before | **No folder of any test.** Only `node-compile-cache` (2.6 MB) and `tsx-0` (356 KB), the tools' caches; 2.9 MB in all | `run-full-suite-after.txt` |
| The failure control: one test ("writes YAML that Docker Compose accepts") made to fail on purpose after it has made and filled its folder, run alone (`-t`), vitest started without npm, once on each version of the file; the file put back as committed afterwards | `67dcea7` and `14787d8` | The test failed both times, on the line added (exit 1) | **After the fix: nothing, `TMPDIR` empty. Before the fix: its `builder-sb-*` folder (36 KB) left** | `failure-control.txt` |
| `npm run typecheck` | `14787d8` with the fix in the working tree | exit 0 | — | `run-typecheck.txt` |
| `npm run check:licences` | `14787d8` | Passed for `builder/` and `builder/runner/`, exit 0, after `npm ci --ignore-scripts` in `builder/runner/`; failed before that install, as gap 77 says it does on a fresh checkout | — | `run-licences.txt`, `run-licences-before-runner-install.txt` |

## The fix

`builder/test/sandbox.test.ts` only (commit `67dcea7`):

- `testFolder(prefix)` makes the folder and registers its removal with vitest's `onTestFinished`, which runs when the test ends, passed or failed. Every test in the file that makes a folder now makes it this way: the four that left theirs (seven folders between them), and the five that already removed theirs (three with `onTestFinished`, two in a `finally`), so that one rule covers all.
- `removeFolder(dir)` opens every folder below `dir` (mode 700; links are neither followed nor changed) and then removes `dir`, as `test/acceptance-live.test.ts` does in its `afterAll`; a folder already gone is not an error. As root this opening is not needed (root removes folders of any owner and mode); it is there for a run as another user and for the socket folder, which `createSandbox` gives to 1000:1000 with mode 750.
- The two live blocks (`builder-live-*`; `builder-tools-*` and `builder-home-*`) already removed their folders in `afterAll`, and did so in every run here. They now do it in a `finally`: before, an error from removing the tools image ended that `afterAll` before its folders were removed.
- **No check changed:** 23 tests and 106 `expect(` calls before and after, no `skip`, `only`, `todo`, `skipIf` or `runIf` in either, and no changed line holds an `expect(` (counted with `grep` on both versions).

## What this shows, and what it does not

- **Shown:** `sandbox.test.ts` left seven folders, 168 KB, after each run; after the fix it leaves none, with the same command, and a run that does not go through npm leaves `TMPDIR` empty.
- **Shown:** on this machine, at `14787d8`, those seven were the only folders the whole suite's tests left after a run that ran to its end.
- **Not explained:** the 3.2 GB of 13 Nov. The folders measured here are far too small to account for it. J1 also named `builder-live-*` and `builder-tools-*`, which a run that reaches its end removes; a run stopped part-way is one way to leave them, and here a stopped run also left the runner image's build folder, 115 MB (*inferred, not shown*, for 13 Nov). Other sessions freeing space at the same moment remain possible, as the task said.
- **Shown:** a test that fails still removes its folder (the failure control), where the same failure before the fix left it.
- **Designed, not shown:** the live blocks' removal when removing the tools image fails; no run made it fail.
- **Not done:** `node-compile-cache` and `tsx-0` are left; they are the tools' caches, made whether or not a test runs, and reused by later runs. Folders other test files leave when a run is stopped part-way (such as `builder-runner-build-*`) are not removed by anything.

## Two things found on the way (gap 170)

1. **On a fresh machine the first whole-suite run fails J3's live preview tests.** `test/preview-live.test.ts` needs the runner image `builder-acceptance-runner:local`, which `test/acceptance-live.test.ts` builds. The suite runs one file at a time (`fileParallelism: false`); with no record of earlier runs, vitest runs larger files first, and `preview-live.test.ts` (16,281 bytes) is larger than `acceptance-live.test.ts` (13,580 bytes), so it ran first and its five tests failed: "the runner image builder-acceptance-runner:local is not on this machine". The image was on the machine after that run (`docker images`). Nothing here was changed for it.
2. **A long `TMPDIR` breaks the suite's tsx scripts.** tsx makes a socket at `$TMPDIR/tsx-<uid>/<pid>.pipe`, and Linux takes at most 107 bytes for a socket's path. With `TMPDIR=<scratchpad>/tmpdir-full-before` (102 bytes) such a path is at least 119 bytes; tsx failed with `EADDRINUSE` on such a path (twice in the output), and 37 tests failed in six files that run scripts under tsx (overrun, journal-recovery, licence-rule, reconcile, journal-crash, journal-recovery-lock). With `<scratchpad>/fb` (86 bytes) every test in those six files passed. That the path's length caused all 37 is *inferred* from that difference and the two errors, not shown test by test. Both scripts here now refuse a `TMPDIR` too long for that path.
