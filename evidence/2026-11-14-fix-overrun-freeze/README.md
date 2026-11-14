# Known gap 145: a call that goes over its reserved money now stops its project before the caller sees it finish

14 November 2026. Branch `claude/fix-overrun-freeze-timing`, from `claude/stage-1` at `14787d8`. Code and tests: commit `9b2c29c`.

## In plain words

**What this is about.** Before the builder lets a model call go out, the gateway (the one door between the builder and the model provider) sets aside money for it: its "hold". Since 13 November, a call whose bill comes in above its hold freezes its project until you record that bill. Some answers arrive as a stream, word by word, and end with a "finished" signal (the end marker).

**What was wrong.** For a streamed answer, the freeze was written only when the provider closed its connection, and that can be later than the "finished" signal the caller sees. In between, the project's next call could still go out. The independent review of `14787d8` showed it with a provider that waits 1.5 seconds after "finished": the next call, sent as soon as "finished" arrived, was forwarded.

**Your instruction (14 Nov):** "Ensure a detected overrun blocks further forwarding for that project before completion is exposed." This had been recorded as an engineer's choice (gap 145). The change follows your instruction, and it stays on the reviewing engineer's reading list (question 7 in `docs/QUESTIONS.md`), with gap 114.

**What changed.** As soon as the figures inside the answer show the call is above its hold, the gateway:

1. stops the project at once in its own memory, so nothing more of that project goes out through it;
2. writes the stop into the database, so every gateway refuses the project, and so does a gateway started after a crash;
3. only then passes the rest of the answer on, "finished" included.

An answer that is not above its hold is passed on exactly as before, with no wait. Once the call's ending is recorded, the freeze of 13 November takes over unchanged, and you clear it the same two ways as before.

**What you can see.** The table "Before and after" below, from `new-tests-before-and-after.txt`: on the old code the project's next call went out (status 200); on the new code it is refused (status 402) and nothing reaches the provider.

**What I checked, and how.** Listed under "What was run". Everything here was run against a stand-in provider on this machine: no real model was called, no key was used, nothing was spent, and all figures and names are made up.

**What I assume, not checked.** That a real provider sends its last usage figures before its "finished" signal, as the stand-in does; the provider's documentation was not read again in this session. If it sent them after, "finished" would go first (gap 170, point 2). That one gateway runs, as today; with two, one call can still slip past (gap 170, point 1).

**What this does not do.** It does not stop the first bill above its hold (it is known only when it is read), nor calls already sent when the figures arrive (gap 114). What the change leaves is listed in known gap 170.

## Detail

### The fix (commit `9b2c29c`)

| What | Where |
| --- | --- |
| The figures priced as a settlement prices them, compared with the hold, on every piece of a streamed answer; above it, the stop | `builder/src/gateway/app.ts:811` (`aboveHoldNow`), `:825` (`stopProject`), `:872` |
| The rest of the answer waits for the stop's write | `builder/src/gateway/app.ts:874` |
| The stop in the gateway's memory, set before anything is awaited | `builder/src/gateway/app.ts:288`, `:825` |
| Checked with no await just before each forward: a passed-through request, a counting call, a metered call (whose hold, already opened, is given back as never sent) | `builder/src/gateway/app.ts:403`, `:433`, `:682` |
| The database's stop looked at before the counting call | `builder/src/gateway/app.ts:391` |
| The ending waits for the stop's write; the memory is cleared once the ending is recorded | `builder/src/gateway/app.ts:524`, `:526`, `:574`, `:629` |
| The stop written on the hold, one transaction under the project's lock, with a `hold.read_above_hold` event | `builder/src/store/holds.ts:172` (`markReadAboveHold`); migration `builder/src/store/migrations/013_read_above_hold.sql` |
| Refused under the project's lock while the hold is open and its call's ending not recorded | `builder/src/store/holds.ts:136` (`holdReadAboveIn`), `:245` (`openHold`) |
| The caller's message (Claude Code's wording, for you to confirm) | `builder/src/store/holds.ts:155` |
| A stopped hold of a gateway found gone: kept and frozen (`kept_above_hold`) at the next gateway's start | `builder/src/store/holds.ts:609` (`recoverHolds`) |

Not changed: package 1.4c's freeze kinds and the transactions they are written in, the reservation and settlement arithmetic, the journal (1.4, 1.4b), the reconciliation (1.5), and every existing test.

### The new tests (`builder/test/overrun-stop.test.ts`)

Against a stand-in provider written in the test (a plain Node server) and gateways in the test's own process. The stand-in bills each call $0.012284 against its hold of $0.009960 (it says fast mode served the call, which was not asked for), or $0.006142 when it is below its hold.

| Test | What it shows |
| --- | --- |
| gap 145: the arithmetic | The rates the figures above rest on (the first model of the gateway's price table) |
| (1) the delayed stream ending | **The review's case.** The provider sends "finished", then ends its connection 1.5 s later. The project's next call, sent the moment the caller sees "finished", is refused (402) with no counting call and nothing forwarded; a look at the database started at that same moment finds the stop written; another project's call sent at that moment is forwarded; "finished" was not held for the 1.5 s. Then the call is settled and the project frozen exactly as on 13 Nov; once the bill is recorded, the next call goes out |
| (2) concurrent calls | **Concurrent requests.** Same project: 2 calls answered just before the figures; 3 through the same gateway and 2 through a second gateway (same database) whose counting calls the stand-in holds back until the figures arrive or until "finished" is seen; 3 + 2 more sent the moment "finished" is seen. None is forwarded after the gateway was handed the figures (the instant measured inside the test's process); all 10 later calls are refused; another project's 2 calls at that moment go out |
| (3) a hold opened before the stop was written | A call whose hold is opened (slowed on purpose to 0.8 s inside the database) while the figures arrive: the gateway's own check just before forwarding stops it, and its hold is given back as never sent |
| (4) control: no overrun | **Behaviour kept.** A stream below its hold is not held back: "finished" reaches the caller while the provider's connection is still open, nothing is written on its hold, and the next call goes out. Passes on the old code and the new |
| (5) above only at the rate it is settled at | Cache writes the answer does not split by lifetime, settled at the one-hour rate: $0.010922 against $0.009960 (the five-minute rate would give $0.009122): stopped too |
| (6) the stop outlives its gateway | A stopped hold whose gateway is gone: the next gateway's start keeps it and freezes the project (kind `kept_above_hold`); your reconciliation of the hold clears it |
| (7) the database's own check | The database refuses a stop that is not above its hold, is not a number, or is half written |
| (8) "finished" waits for the stop's write | With that write slowed to 0.5 s on purpose: "finished" reaches the caller only after it; meanwhile the same gateway refuses the project's call and its passed-through request before anything goes to the provider; once written, a second gateway refuses the project's call before its counting call |
| (9) figures that stop being trusted | A stop whose call then ends with a figure that falls freezes nothing, as on 13 Nov (package 1.4c's rule), and the project's next call then goes out |

Test-only database objects (created by the test file, dropped at its end, never a migration): a trigger that slows the insert of a hold (test 3), and one that slows the write of a stop (test 8), each for one chosen project.

### Before and after

From `new-tests-before-and-after.txt` (each run on a fresh database, under the shared lock):

| Test | On `14787d8` (before) | On `9b2c29c` (after) |
| --- | --- | --- |
| arithmetic | passed | passed |
| (1) the delayed stream ending | **failed**: the next call was forwarded (status 200; 2 calls and 2 counting calls reached the provider) | passed: refused (402), 1 call and 1 counting call; the stop already in the database when "finished" was seen |
| (2) concurrent calls | **failed**: all 10 later calls forwarded (13 calls of the project reached the provider) | passed: all 10 refused, 3 forwarded (the call above its hold and the 2 sent before), none after the figures were handed over |
| (3) a hold opened before the stop | **failed**: forwarded (200) | passed: refused (402), its hold given back |
| (4) control: no overrun | passed | passed |
| (5) the one-hour rate | **failed**: forwarded (200) | passed: refused (402) |
| (6) after a gateway is gone | **failed** (no stop exists) | passed |
| (7) the database's check | **failed** (no such field) | passed |
| (8) "finished" waits for the write | **failed**: no stop was ever written (the test timed out waiting for it) | passed |
| (9) figures that stop being trusted | **failed** (no stop exists) | passed |
| **Total** | **8 failed, 2 passed** | **10 passed** |

Measured in those runs (milliseconds, from the provider writing "finished" to the caller reading it, on this machine): with no overrun, 6.1 before and 1.3 after; above its hold, 5.6 before (the next call then went out) and 10.1 after (the stop's write in between); with that write slowed to 0.5 s on purpose, 511. In test (2), after the fix, the last call forwarded went out 70.4 ms before the gateway was handed the figures, and "finished" was seen 33.4 ms after it was handed the figures.

The first run, before any fix was written (`run-new-tests-first-on-unfixed.txt`, tests (1) to (7) and the arithmetic check), failed the same way: 6 failed, 2 passed (the arithmetic check and the control).

### Controls (each safeguard removed in turn)

From `controls.txt` (`controls.py`, run from `builder/` under the shared lock on a fresh database). Each safeguard is removed by an exact replacement in the source (each text to replace must occur exactly once, or the control is reported as not applied), the test that guards it is run alone, and the file is restored with `git checkout`; at the end the tree is compared with the commit.

| Control | Safeguard removed | Test that must fail |
| --- | --- | --- |
| FX145-C01 | The figures not looked at while the stream is read (no stop at all) | (1) |
| FX145-C02 | The stop not set in the gateway's memory (only written to the database) | (3) |
| FX145-C03 | The check just before a metered call is forwarded | (3) |
| FX145-C04 | The check just before a counting call | (8) |
| FX145-C05 | The check just before a passed-through request | (8) |
| FX145-C06 | The answer's bytes passed on without waiting for the stop's write | (8) |
| FX145-C07 | The stop never written to the database | (1) |
| FX145-C08 | The look at the database's stop before the counting call | (8) |
| FX145-C09 | The check under the project's lock (`openHold`) | (2) |
| FX145-C10 | A stop still applied after its call's ending was recorded | (9) |
| FX145-C11 | The stop left in the gateway's memory after the ending was recorded | (9) |
| FX145-C12 | The figures priced only at the lower rate | (5) |
| FX145-C13 | The stop not carried over when its gateway is found gone | (6) |

**Result: all 13 made their test fail, as they should with the safeguard removed, and the tree was restored after each and found equal to the commit at the end.** The reason each test gave is in `controls.txt` (for example C06, the wait removed: "expected 10.03 to be greater than or equal to 450", that is, "finished" reached the caller 10 ms after the provider sent it, while the stop's slowed write still had most of its 0.5 s to run).

### What was run

All from `builder/`, on this machine (Node v22.23.4, PostgreSQL 16.15), each test run on a fresh database made for it and dropped after, under the shared lock (`<scratchpad>/live-tests.lock`), with TMPDIR inside the scratchpad.

| Check | Result | File |
| --- | --- | --- |
| The new tests, first, on the old code, before the fix was written | 6 failed, 2 passed (the arithmetic check and the control) | `run-new-tests-first-on-unfixed.txt` |
| The new tests on `14787d8`'s source and on `9b2c29c` | before: 8 failed, 2 passed; after: 10 passed | `new-tests-before-and-after.txt` |
| The 13 controls | 13 of 13 made their test fail; the tree restored after each and equal to the commit at the end | `controls.txt` |
| The whole suite, live tests included (`npx vitest run`, `BUILDER_BROWSER_CACHE=<scratchpad>/p31-cache`) | **30 test files, 702 tests, all passed** (vitest exit code 0; 1,036 s; no container left) | `run-tests-full.txt` |
| `npm run typecheck` | exit code 0 | `run-typecheck.txt` |
| `npm run check:licences` | RESULT: PASSED, exit code 0; no dependency file and no image list changed since `14787d8` (no new dependency) | `run-licences.txt` |

**The whole suite's first run, and why it was run again.** At 03:29 UTC, during this work, this worktree's `node_modules` link was replaced (not by this work) with a folder named `node_modules.real` and a link to it, and that name was added to the repository's local exclude list. Vitest, and the repository's own image scan (`builder/test/gate-scan.ts:39`), skip only folders named exactly `node_modules`, so the first whole-suite run in the worktree also ran the installed packages' own test files (234 files in all against the repository's 30; 11 of the packages' files cannot run outside their packages and failed), and the image scan read the packages' files: of the repository's tests, 1 failed (`test/approved-images.test.ts`, "finds no image reference that is not tag@digest of an approved entry", with 984 references found, the scan walking `node_modules.real`) and every other one passed (`run-tests-full-in-worktree.txt`). That folder was left as it was. The whole suite was then run again, unchanged, in a fresh local clone of this branch. In a first clone, `node_modules` were links to the same installed packages: the 11 live tests that start containers failed there, because the door's machine-side container mounts the builder folder and runs from it, and a link pointing outside that folder does not exist inside the container (`run-tests-full-in-clone-with-links.txt`; every other test passed, and nothing of those runs was left in Docker). The clone used for `run-tests-full.txt` holds a full copy of the installed packages instead (`full-suite.sh`, step 2).

The suite was run on the code commit `9b2c29c` (`builder/` tree `4ff3417`); the commit that adds this folder and the records changes nothing under `builder/`, and no test reads the records changed (`docs/KNOWN-GAPS.md`, `docs/DECISIONS.md`, `docs/SOURCES.md`).

**Tests unchanged.** No existing test was changed, skipped or removed (`git diff 14787d8 --stat -- builder/test` lists only the new file). The title of test "1.4c (a2)" in `builder/test/overrun.test.ts` still names gap 145 ("its last bytes reach the caller first"): that is still how the settlement is timed; what changed is the stop written before those bytes.

**Records.** `docs/KNOWN-GAPS.md`: gap 145 closed with a dated note, gap 114 given a dated cross-reference, gap 170 added (what the change leaves). `docs/DECISIONS.md`: the owner's instruction, word for word, and how it was built (each point the owner's to overrule). `docs/SOURCES.md`: three behaviours this change rests on, seen in runs, not read (the pages could not be reached from this session).

**Not done here.** `docs/STATUS.md` and `docs/BUILD-PLAN.md` are left to the lead, at merge. Nothing was pushed. No independent reviewer has checked this change yet.

### Files here

| File | What it is |
| --- | --- |
| `run-new-tests-first-on-unfixed.txt` | The first run of the new tests (1) to (7), on the old code, before the fix was written |
| `new-tests-before-and-after.sh`, `new-tests-before-and-after.txt` | All ten new tests on the old code and on the fixed code |
| `controls.py`, `controls.txt` | The 13 controls |
| `full-suite.sh`, `run-tests-full.txt`, `run-typecheck.txt`, `run-licences.txt` | The whole suite, the typecheck and the licence check, on the committed code |
| `run-tests-full-in-worktree.txt`, `run-tests-full-in-clone-with-links.txt` | The two earlier whole-suite runs, kept as they came out (see "What was run") |

## Notes from the review

*Added 14 Nov 2026 by Claude Code.* One adversarial reviewer who did not write the fix read the claims, the evidence and the code. It reran the ten new tests on the branch (10 of 10) and on the old code in a scratch copy (8 failed, 2 passed, the same failures as saved). **Nothing blocking:** the requirement holds for one gateway, today's set-up. Recorded in gap 170, items (8) to (10):
- the one-hour price for cache writes at the stop against the five-minute floor at a keep: a caller that cancels after the end marker can lift the stop, as before this fix;
- a hold already marked as kept by another gateway: the stop then holds only in memory until settlement's freeze;
- frames ended by carriage returns alone are not read (today's provider uses line feeds).

Also corrected: `docs/SOURCES.md` said "the two behaviours below" above three rows. Item (1) of gap 170, a second gateway's call admitted before the stop, stays as the author wrote it; one gateway runs today.

