# Package 1.4b: an unreadable journal line keeps the gateway closed until it is recovered

| | |
| --- | --- |
| Date | 13 November 2026 |
| Package | 1.4b, added on 13 Nov 2026 for the third outside review's item 1 ("An unreadable fault record can let the gateway restart and accept calls"; `docs/reviews/2026-11-13-third-outside-review-supplied-by-the-owner.md`, copied unchanged) |
| Done means | The review's required fix: "unreadable records must block forwarding until recovered; test a truncated journal followed by restart". As set for this package: a line of the journal that cannot be read keeps the gateway closed for every project from its start; every rewrite keeps such lines byte for byte; recovery is a recorded operator action that freezes the project of the hold the line may stand for, cleared by package 1.5's reconciliation of that hold |
| Run on | The development machine (a cloud session), on the host: the builder's store, gateway and scripts, the gateway's own start-up file (`builder/src/gateway/main.ts`) run as a process and killed with SIGKILL, PostgreSQL databases made for this package (`builder_test_p14b` for the tests, `builder_demo_p14b`, made empty, for the demonstration) and a **stand-in provider**. No model was called; the key is made up; nothing was spent; every name, figure and usage record is made up |
| Result | The review's required test and nine more ran and passed (10 of 10); each of the 14 controls failed as it should; the whole suite passed (16 files, 409 tests); the type check and the licence check passed; the demonstration ran with every step as expected. Against a stand-in only. **After its review** (below): its one blocking item fixed; the package's 18 tests (13 and the new file's 5) and the whole suite (17 files, 417 tests) passed; 11 more controls failed as they should |
| State | **Built, not tested.** Its tests ran and passed and its controls failed as they should (below); one adversarial review read it and found one blocking item, fixed after it ("After the review"). Tested when its pull request merges with no blocking finding open (build plan section 3) |

A **journal** is the file where the gateway keeps a call's ending while the database refuses it (package 1.4). A **hold** is the money set aside for one call. A **freeze** stops a project's calls until the owner records what a call cost (a **reconciliation**, package 1.5). A **control** is a test run with one safeguard removed, to show the test notices.

## The defect, as it was

At `4e8354a`, the gateway's start-up replay (`builder/src/gateway/journal.ts:213-222` there) reported a line it could not read as a fault message and carried on; the gate then opened for every project. The project that line belonged to was not frozen, though its hold stayed open. A journal file that existed and could not be read stopped start-up only through an unhandled error, which printed its trace (run again at `4e8354a` for this record: a journal file whose name is taken by a folder, error `EISDIR`, exit code 1, with an error trace that names the source file's path and no plain message; `run-before-unreadable-file.txt`). The defect itself (a gateway open after an unreadable line) is shown by control X1: test (a) with the new start-up block removed.

## What was built (branch `claude/pkg-1.4b-journal-recovery`)

- **What "cannot be read" means**, `readLine` (`builder/src/gateway/journal.ts:126-143`): not valid UTF-8; blank (skipped); the file's last line with no line end, even one that reads as a whole record (`:135`; a crash during an append leaves one); not JSON; JSON without every field a freeze is written from, each of its type (`isUnrecordedEnding`, `:99-124`; 1.4's check read two ids only). Lines are split from the file's bytes, each kept exactly (`splitLines`, `:79`).
- **The gate**, `FaultGate` (`:406`): `replay` (`:464`) keeps every unreadable line it finds (`:467`, before anything else is awaited) and still writes the readable records; `closed()` is true while there is one (`:414`); nothing in a running gateway clears it.
- **The refusal**, `builder/src/gateway/app.ts`: `gateway_journal_unreadable`, 503, saying nothing was forwarded and that an operator has to recover the journal with `builder/scripts/journal-recover.ts` and then restart the gateway (`:251-255`); checked first on arrival (`:269`) and first at the re-checks before each forward (`stoppedNow`, `:263`; a counting call already sent releases its hold with the reason, `:562`).
- **Start-up**, `builder/src/gateway/main.ts`: a journal file that exists and cannot be read stops start-up with a plain message (`:41-44`); the number of unreadable lines is printed before the gateway listens (`:46-48`).
- **Rewrites keep what they do not move**: the move to the done file rewrites the file from its lines as they are on disk (`moveToDone`, `:327-339`; `rewrite`, `:342`); an append after a last line with no line end starts with one (`:250-256`, `endsInsideALine`, `:369`).
- **One process per journal folder**: the folder gets an id of its own (the file `journal-folder-id`, `folderIdIn`, `:158`); `main.ts` takes a database lock keyed by it on its liveness lock's connection (`builder/src/store/liveness.ts:37`, `:82-88`; `main.ts:30-35`); a second gateway on the folder stops at its start; the journal writes nothing while the lock is not held (`guardWrites`, `journal.ts:231`; `main.ts:36`). *Changed after the review: it still appends a call's ending then ("After the review").*
- **The recovery**, `builder/src/gateway/journal-recovery.ts` and `builder/scripts/journal-recover.ts` (modelled on `scripts/reconcile.ts`: exit 0 done, 1 misuse, 2 refused, 3 not completed; the database's name only; control characters printed as spaces, `printable`, `:72`).
  - `--list` (`listJournal`, `:176`): each unreadable line's number, length in bytes, why, fingerprint (SHA-256 of its bytes) and text (at most 2,000 characters printed); the readable records waiting; the **candidates**, open holds kept because the gateway that opened them was found gone, which no freeze names (`candidateHolds`, `:156`); the set-asides recorded before; whether a process holds the folder's lock.
  - `--set-aside --line N --fingerprint F --hold H --by NAME --reason TEXT` (`setAsideLine`, `:286`): takes the folder's lock for the whole run and refuses without it (`:296-306`); checks the line, its fingerprint and the hold; then, in one transaction under the project's lock (`:417-495`), a freeze of the hold's project naming the hold (`:441-464`; reason `SET_ASIDE_FREEZE_REASON`, `builder/src/store/freezes.ts:63`, with its own refusal message, `:85-90`), a `journal_set_asides` row (migration `010_journal_set_asides.sql`; never changed except marked moved, once, by trigger), and the events `gateway.journal_line_set_aside` (the line's text and bytes, fingerprint, who, why) and `project.frozen`; then the line is written to the folder's set-aside file (forced to disk), removed from the journal file, and the row marked moved (`:498-501`).
  - `--no-hold` in place of `--hold H`: the row only; no freeze, no event (the event log holds a project's events only).
  - Refused, each with its own code and nothing changed for the line: a line out of range, blank or readable; a fingerprint that differs; two lines with the same bytes; a line over 1 MiB; a hold unknown, not open (`:421`), not kept at its full amount (`:424`) or with a cost recorded (`:437`); a running gateway (`folder_in_use`); a line set aside already (`already_set_aside`, by its fingerprint, `:362`). A run cut short after its record is finished by the same command run again, writing nothing twice (`finishEarlier`, `:261`).
  - 1.5's script shows a set-aside freeze for what it is (`builder/scripts/reconcile.ts:101`).
- **What a journal record holds** (checked in `builder/src/store/freezes.ts:22-40` and `builder/src/gateway/app.ts:483`, `:489-507`): its id, the gateway's id, the project's id, the hold's id, the step, when the call ended, which write failed, why the hold was kept, the cost as read, and the call's record as the gateway would have stored it (model, served model, priced as, path, status, stream, token counts, duration, names of headers not forwarded, and for an error answer the provider's error body), passed through the same key scrub as the event log (`storable`, `app.ts:211`), and the database error's name and code. It holds no request body and no answer text; the model key is taken out by that scrub, the one the event log's records pass through (its tests are the gateway's, not this package's). What `--list` prints of an unreadable line is whatever bytes the file holds, with control characters as spaces.
- **The tests**, `builder/test/journal-recovery.test.ts`, one describe block named for the review's item. **The controls** are run by `controls.sh` in this folder. **The demonstration**, `builder/scripts/demo-journal-recovery.ts`.

## Test by test (`run-tests-journal-recovery.txt`: 10 passed, at `236c70a`; controls in `run-controls.txt`: 14 of 14 failed as they should, at `236c70a`)

| Test | Shows | Controls |
| --- | --- | --- |
| (a) the review's required test | The real gateway (`main.ts` as a process, as B10 (3)) writes a call's ending to its journal while a test-only trigger refuses that project's writes, and is killed (SIGKILL); the record is cut in half, with no line end. Restarted, it prints "journal lines that could not be read at start-up: 1" before it listens; a metered call and a counting request of another project, and of the record's own project, are each refused 503 `gateway_journal_unreadable`, "Nothing was forwarded.", with the message saying what to do; the stand-in receives nothing (neither call nor counting call); no hold is opened, no event written; the cut line is left byte for byte | X1 |
| (a2) the re-checks before each forward | A metered call and a counting request pass the arrival checks and wait for their token (the token table held); the replay then finds a line that is not JSON; both are refused 503 `gateway_journal_unreadable`; nothing reaches the stand-in; no event | X4 |
| (b) a line that is not JSON between two readable records | Both records are written (each project frozen, naming its record); the gate stays closed for every project, an unrelated one included, and stays closed after another drain; the readable records move to the done file; the unreadable line stays, byte for byte | X14 |
| (b2) each kind | Not JSON; a record of two ids only (1.4's check took it); a record whose hold id is a number; bytes not valid UTF-8; a whole record that is the last line with no line end: each found, each closes the gate; blank lines are skipped; the whole record with no line end freezes nothing | X6, X7 |
| (c) markDone keeps what it does not move | Two records moved to the done file; a line not UTF-8, a blank line, a line not JSON and a last line with no line end stay byte for byte; an append after that last line starts on a line of its own; the script's removal keeps the others too | X2, X8 |
| (d) the recovery, end to end | A set-aside is refused while the restarted gateway runs (`folder_in_use`, exit 2); with it killed, `--list` shows the line (number, length, why, fingerprint, text) and the killed gateway's hold as the one candidate; `--set-aside` naming that hold writes the freeze, the row, `gateway.journal_line_set_aside` and `project.frozen`, and moves the line's exact bytes to the set-aside file; no database address and no key in any output. Restarted: no unreadable line; the named project is refused 402 `project_frozen` (nothing forwarded, not even its counting call); another project's call is forwarded and settled. 1.5's `scripts/reconcile.ts` reconciles the hold and clears the freeze; the project's next call is forwarded and settled; the invariant checker finds no violation on either project | (X1, X3) |
| (e) the script's refusals | A missing reason (exit 1); a line out of range, a fingerprint that differs, a readable line, a hold not open, a hold still in flight, a running gateway, and a second set-aside of the same line (exit 2): the journal file, the rows, the freezes and the events are unchanged after each. `--no-hold` writes the row only: no freeze, no event | X3, X9, X10 |
| (e2) a set-aside cut short | A made-up disk error after the database record: the project is frozen, the row not marked moved, the line still in the journal file (a gateway reading it stays closed). The same request again finishes it: one row, marked moved; one freeze; one event; the journal file empty | X11 |
| (f) a journal that cannot be read; a folder in use | A journal file whose name is taken by a folder: `main.ts` exits 1 with "The gateway's journal file cannot be read ... the gateway does not start", and never listens. A second gateway on a folder a running gateway holds exits 1 with "Another process is using the gateway's journal folder" | X5, X12 |
| (g) the folder's lock | A gateway loses its database connection; a recovery takes the folder's lock first; the gateway stays stopped (five of its tries); its journal's append and move are refused (`JOURNAL_FOLDER_NOT_HELD`) and the file is unchanged; once the recovery lets go, the gateway takes its locks back and the move goes through. *Changed after the review: the append goes through; the rewrites and the set-aside file's append are refused* | X13 |

**Controls X9 and X10.** With either check removed, the state is still unchanged, because a later check refuses the same request with another code: without the fingerprint check (X9), the second set-aside is refused as a line out of range, the line being gone; without the open-hold check (X10), a settled hold is refused as not kept at its full amount. Each control fails on the code and its message. They show that the named check is the one that answers; the later checks are a second line, not shown alone.

**Controls X1 and X5, X12.** Without the start-up block (X1), the four requests of test (a) no longer get the refusal (the comparison of their answers fails). Without the stop on a journal file that cannot be read (X5), or without the folder's lock (X12), the gateway that must not start is still running 30 seconds later.

**Required by the brief:** the start-up block (X1), the keep in markDone (X2) and the running-gateway refusal (X3); the others were chosen here.

## Checks, at `236c70a` (the code as committed; only records changed after it)

Type check: passed (`run-typecheck.txt`). Whole suite, live tests included, on `builder_test_p14b` under the shared lock: 16 files, 409 tests passed, none skipped (`run-tests-full.txt`). Licence check: passed (`run-licences.txt`). No package dependency added. The package's own file again, test by test: 10 passed (`run-tests-journal-recovery.txt`).

## The demonstration (`run-demo.txt`, at `236c70a`, on `builder_demo_p14b` made empty for the run)

Run with `npx tsx scripts/demo-journal-recovery.ts`; the gateway is `main.ts` as a process. The checkout's path and the journal folder are printed as `<checkout>` and `<journal folder>`; the database's name only. Its key lines:

```
== 3. The gateway started again: it forwards nothing, for any project ==
  | journal lines that could not be read at start-up: 1; this gateway forwards nothing, for any project, until an operator recovers them (scripts/journal-recover.ts) and restarts it
  project b's call: HTTP 503: This gateway forwards nothing, for any project: when it started, 1 line(s) of its journal file could not be read. [...] Nothing was forwarded.
  project b's counting request (passed through): HTTP 503
  project a's call: HTTP 503
  reached the stand-in since the restart: 0 calls, 0 counting calls; holds opened for project b: 0
== 4. The recovery: the line listed, then set aside naming the hold it stands for ==
    hold:        1 of project demo14b_mweuwy1m_a, $0.009960 held: the project is FROZEN (freeze 2) until the owner reconciles that hold (scripts/reconcile.ts)
== 5. The gateway started again ==
  | journal lines that could not be read at start-up: 0
  project a's call: HTTP 402: This project is stopped: a line of the gateway's journal that could not be read was set aside at [...]
  forwarded to the stand-in for it: nothing, not even its counting call
  project b's call: HTTP 200; forwarded: yes
== 6. The owner's reconciliation of the named hold (package 1.5) ==
    freezes:       cleared 2; the project is not frozen
== 7. Project a runs again ==
  project a's call: HTTP 200; forwarded to the stand-in: yes
Every step as expected.
```

## What this does not show

- **It is not tested** in the plan's sense: one adversarial review has read it ("After the review"); the review bot is next.
- **Which hold a line stands for is the operator's judgement**, written as stated; nothing checks the line names the hold given, or that a `--no-hold` line concerns no open hold (gap 107). A wrong choice leaves the right project unfrozen, though its hold stays counted at its full amount.
- **The folder's lock holds on one database only**; two processes on one folder and different databases are not stopped (gap 106; gaps 93 and 105 brought up to date).
- **Some lines the script refuses** (two identical lines, a line over 1 MiB, an unclear earlier set-aside); an engineer then edits the file by hand, unrecorded; a journal file that cannot be read at all has no tool (gap 108).
- **Designed, not shown:** a set-aside stopped at its other steps; two gateways making a folder's id at once; a journal file the gateway may not read (the tests run as root); that the set-aside file survives a power cut (gap 109; gap 92).
- **While a line cannot be read, every project on that gateway is stopped**, by design, until an operator acts and restarts it; the 503's wording is Claude Code's, for the owner to approve.
- Proof row B10, which this builds on, rests on a design no engineer has reviewed (gap 35).

## What the owner can look at

`run-demo.txt` in this folder: the gateway closed by a cut journal line, the recovery, the restart, the reconciliation, the project running again, each step's output as printed.

## After the review (13 Nov 2026)

One adversarial review read the branch at `fa2b38c`, on its own copy, database and stand-in provider. It ran the type check, the package's tests, the failure tests, the whole suite and control X1 again, then probes of its own. It found **one blocking item**, thirteen notes, and a list of what it checked and found fine. Line numbers above this section are at `236c70a`; below, at `d448a09`, the code after the review.

### The blocking item: a call's ending lost if the gateway stopped while its database was out of reach

**Found.** The folder's lock lives on the gateway's database connection, and the journal refused every write while the gateway did not hold it (decision (5)). So while that connection was down, which is when the database may be out of reach and the journal is needed (design note 5.5 step 5), a call's ending was not written to the journal file: it lived in memory only. A gateway stopped then restarted with the project not frozen and forwarded its calls. The review showed it with a probe: at `fa2b38c` no journal file, 0 lines replayed, the project not frozen, its next call forwarded (HTTP 200); at `1ac0867`, before this package, the line on disk, the project frozen, its next call refused 402.

**Done** (`builder/src/gateway/journal.ts`).
- The lock guards only rewrites now: the move to the done file, the script's removal of a line, and the set-aside file's appends. A call's ending is always appended (`append`, `:282`).
- The recovery script may now rewrite the journal file while a gateway that lost its lock appends to it. So a rewrite reads the file through one open handle and, after its rename, copies to the new file whatever was appended to the old one after it read it, waiting up to a second for a line still being written (`rewriteWithout`, `:381`; `carryOver`, `:424`). An append checks after writing that the file at that name is still the one it wrote to, and writes its line again into the new one if not (`appendWhole`, `:468`). A line can appear twice, which is harmless (a record is known by its id); it is not lost.
- The review's other suggestion, an operating-system file lock held by the gateway, is not built: Node has no built-in call for one, and this package adds no dependency (`docs/SOURCES.md`).

**Shown.**
- **Test (h)** (`builder/test/journal-recovery.test.ts`), the review's probe as a test. The real `main.ts`, run as a process, forwards a call for project P. The test ends the gateway's lock connection and takes its lock, so the gateway cannot take it back (in place of a database it cannot reach). The database then refuses the call's ending, and the gateway is killed with SIGKILL. The ending is in the journal file, and the fault "could not be written to the gateway's journal file either" was not raised. Restarted: 1 line replayed; P frozen, naming that record; its hold open and unreconciled; P's next call refused 402 `project_frozen`, with nothing reaching the stand-in; another project's call forwarded. **Control X15** (the append guarded again, as at `fa2b38c`): the test fails.
- **Tests (r1), (r1b), (r2)** (a new file, `builder/test/journal-files.test.ts`): an append landing in the old file after a rewrite read it and before its rename; a line half written when the file is replaced and finished 200 ms later; an append that opened the old file before the rename and writes after it. Each line ends up whole in the new file. Two journal objects in one process stand for the two processes, with the file system's functions wrapped to fix the order; no second process runs. **Controls X16, X24, X17.**
- **Test (g), changed**: with the lock lost, the append goes through; the move to the done file, the script's removal and the set-aside file's append are refused (`JOURNAL_FOLDER_NOT_HELD`).

### The notes

| Note | What was done | Test, control |
| --- | --- | --- |
| `--no-hold` writes no event; nothing checks it when candidate holds exist; the status file did not say it freezes nothing | Recorded (gap 107); the status file now says "or none"; decision (8) waits for the owner's yes | — |
| The start-up order | Found sound; nothing to do | — |
| A running gateway never reads its journal again | Recorded (gap 142) | — |
| The closure covers one gateway process only | Recorded (gap 143); the status file says "every project on its gateway" | — |
| A set-aside entry after one cut short is joined to it | Fixed: written on a line of its own | (r4), X19 |
| An id file left empty by a crash stops every later start | Fixed: written whole under a temporary name, forced to disk, then linked to its name (`folderIdIn`, `journal.ts:168`) | (r3), X18 |
| `--list` briefly takes the folder's lock | Fixed: it reads PostgreSQL's list of locks held (`folderInUse`, `journal-recovery.ts:87`) | (i), X20 |
| A run cut short and run again naming another hold silently returns the earlier record | Fixed: the script says the earlier record stands and nothing was written for the hold named now | (e3), X22 |
| The health check answers ok while every request is refused | Fixed: 503 with the same message while an unreadable line keeps the gateway closed (`app.ts:269`). A gate closed for an unrecorded ending, or a lost lock, is not reported there: each clears without a restart, and a restart while an ending is only in memory would lose it | (a), (d), X23 |
| The fault message on a refused write sounds like a disk failure | Gone with the fix: an append is no longer refused for the lock | (h) |
| A line of hundreds of megabytes makes `--list` fail | Fixed: only a line's first 8 KiB are decoded for display, with its length printed; shown with a 3 MiB line only | (i), X21 |
| Decision (5): an operating-system file lock leaves no stale lock | Decision (5) corrected | — |
| The plan's row for 1.5 still says "Not opened yet" | Not this package's row (1.3's and 1.4's say the same); left for the record update after the open packages merge, so as not to clash with their rows | — |
| Checked and fine (secrets, dependencies, names, claims, the copied review, decision (7)) | — | — |

Gaps 91 and 105 to 109 are brought up to date with what remains, and gaps 142 and 143 are new: two rewrites at the same moment can still bring back a removed line or drop an appended one (gap 105).

### Package 1.4's test B10 (9), changed

The first whole-suite run after the fix failed one test, B10 (9) (`run-tests-full-after-review-first.txt`). Its file watcher counted an append only when the journal file was opened with the flag `a`; an append now opens it `a+`, to read the file's last byte through the same handle. The watcher so saw no append, and the order it recorded was short. The test's other checks passed. The watcher now counts both flags; the order it expects is unchanged. **Control X25** (the append taken out of the journal's queue): B10 (9) still fails.

### Runs

- **Before the fix** (`run-before-fix-after-review.txt`): the code at `fa2b38c`, with this round's two test files copied in: 10 of the 18 tests failed (every new or changed one: (a), (g), (e3), (h), (i), (r1), (r1b), (r2), (r3), (r4)), each on its own check; the 8 unchanged ones passed.
- **Controls** (`run-controls-after-review.txt`, run by `controls-after-review.py` on a copy made with git archive of a scratch commit whose `builder` folder is the same tree as `d448a09`'s, `70e93853`): 11 of 11 failed as they should, X15 to X25.
- **Checks**, on the code committed as `711c00d` and `d448a09` (the same `builder` tree, `70e93853`): type check passed (`run-typecheck-after-review.txt`); whole suite under the shared lock, 17 files and 417 tests passed, none skipped (`run-tests-full-after-review.txt`; the first run, before B10 (9)'s watcher was changed, is `run-tests-full-after-review-first.txt`); licence check passed (`run-licences-after-review.txt`). No package dependency added.

### What this still does not show

- **Not tested** in the plan's sense: the review bot reads it next.
- **No test races two real processes** on one folder; the order is fixed by wrapping the file system in one process. The review's own race of real processes (six rounds) is the review's run, not repeated here.
- Two rewrites at the same moment (gap 105); a running gateway never reads its journal again (gap 142); more than one gateway (gap 143).

## After the review bot on 88e984b (13 Nov 2026)

The review bot read the branch at `88e984b` and reported two findings. Each was checked against the code, reproduced by a test that fails at `88e984b`, then fixed. Line numbers in this section are at `e1c3d46`. A **leftover** is the old journal file kept under a second name by a rewrite cut short.

### Finding 1 (P1): a call's ending lost when a rewrite stops between its rename and its carry-over

**Found, and confirmed in the code.** A rewrite of the journal file (the gateway's move to the done file, the script's removal of a set-aside line) read the file, renamed a new file over it, and only then copied over what had been appended to the old file meanwhile. A gateway that has lost its lock still appends; an append to the old file after the read and before the rename returned once forced to disk. If the rewrite stopped after the rename and before that copy (a kill, a crash, an I/O error), the line was only in the old file, which no name reached any more: lost.

**Reproduced** (`run-bot-before.txt`: the code at `88e984b` with the two new test files). Test (k1): the script's set-aside stopped right after its rename, then the gateway started (`main.ts` as a process): "journal lines replayed at start-up: 0", the project not frozen, its next call forwarded (HTTP 200; 2 requests reached the stand-in). Test (k2), both rewrites: stopped after the rename (its steps 5 and 6) the line was nowhere on disk and the project not frozen; the steps the fix adds (1, 2, 7, 8) did not exist then.

**Done** (`builder/src/gateway/journal.ts`). The shape the task suggested. An append-only journal was not chosen: the existing tests (b), (c), (d), (e), (e2) and (g) expect the journal file to lose a moved line, and they are not to be changed to make a fix pass.
- A rewrite first gives the old file a second name in the folder (a hard link, `unrecorded-endings.jsonl.prev-<id>`), checks it names the file it read, and forces the folder to disk; writes the new file and forces it; renames it into place and forces the folder; carries over what was appended to the old file and forces it; only then removes the second name (`rewriteWithout`, `:512`: the link `:533`, the rename `:551`, the carry-over `:561`, the removal `:563`). An error before the rename removes the second name again (the journal file still names the old file); one after it leaves it.
- What a leftover alone holds (`onlyInLeftovers`, `:124`): a record whose journal id the journal file does not hold; an unreadable line whose fingerprint it does not hold, unless `journal_set_asides` records that fingerprint for the folder (the line was set aside; the leftover is the file as it was before the removal). When the set-asides cannot be read, every unreadable line of a leftover counts: it fails closed.
- The gateway at start-up, when a leftover exists, reads the set-asides, moves into the journal file what the leftover alone holds (forced to disk) and removes it (`replay`, `:727`; `absorbLeftovers`, `:376`). It reads leftovers in any case (`pending`, `:360`, `:464`), so a leftover it could not move in still counts. `--list` shows such lines, marked, at the line they will be in the journal file (`journal-recovery.ts:250`); `--set-aside` moves leftovers in first (`journal-recovery.ts:412`).

**Shown** (`builder/test/journal-crash.test.ts`; the file system's functions wrapped so each step is reached in the same order every time; a stop is a file operation that never returns, so nothing after it runs).
- **(k1)** the bot's case, with `main.ts` as a process: 1 line replayed, the project frozen naming that record, its next call refused 402 `project_frozen` with nothing reaching the stand-in, no leftover left. **Controls X26** (no second name, as at `88e984b`) and **X28** (start-up reads the journal file only).
- **(k2)** both rewrites, stopped at each of their 8 steps, and once not stopped: at every step the ending is on disk, `--list` shows it waiting, and the gateway started afterwards freezes its project and leaves no leftover. A set-aside line comes back only while its removal had not reached the rename; it is then still in the journal file, the gateway stays closed, and the same set-aside run again finishes it. **Controls X27** (the second name removed before the carry-over), **X29** (a leftover read but not moved in), **X30** (the set-asides not read: the set-aside line comes back after the rename).
- **(k3)** fails closed: while the set-asides cannot be read, a leftover's unreadable line counts and the leftover is kept; a leftover's unreadable line never set aside closes the gateway, is moved into the journal file, and is set aside as any other.
- **(k4)** `--list`, and the script's printed list, number a leftover's lines as they will be in the journal file and leave out one set aside already; the script moves the leftover in first, so a line set aside at its listed number is the right one; a record only the leftover held is replayed. **Controls X31, X32.**

### Finding 2 (P2): the recovery went on writing after its lock connection was lost

**Found, and confirmed in the code.** The script took the folder's lock on a connection of its own and ignored that connection's errors (`lock.on("error", () => undefined)` at `88e984b`). If that connection ended, PostgreSQL released the lock, yet the run went on recording the set-aside and changing the folder's files through other connections, while a gateway or another run could take the lock.

**Reproduced** (`run-bot-before.txt`). (l1) the lock connection ended right after the lock was taken, and another process then took the lock: the run completed and wrote its row, freeze, events and files. (l2) the script as a process, its connection ended while its transaction waited for the project's lock: exit code 0, everything written.

**Done** (`builder/src/gateway/journal-recovery.ts`). The connection's 'error' and 'end' are tracked (`:380`, `:381`). Right before each write, the run checks it still holds the lock, by that flag and then by a query on that same connection (`:386` to `:396`), and inside the set-aside's transaction again right before its commit (`:635`); the journal's own rewrites in the run check the same flag (`:408`). Once the lock is lost the run writes nothing more and throws `RecoveryStopped` (`:80`); the script prints "Stopped (folder_lock_lost): ..." and exits with code 4 (`builder/scripts/journal-recover.ts:198`).

**Shown** (`builder/test/journal-recovery-lock.test.ts`). **(l1)** the bot's case: nothing written, every file in the folder byte for byte as before, `RecoveryStopped`. **(l2)** the script as a process: exit code 4, the plain message, its transaction rolled back, nothing written. **(l3)** the lock lost right before each of the 10 writes a set-aside can make: from there on nothing is written, and the same set-aside run again finishes it. **Controls X33** (the check never stops the run), **X34** (no check before the commit), **X35** (neither the connection's events nor the query, as at `88e984b`).

### Runs

- **Before the fix** (`run-bot-before.txt`): the code at `88e984b` with the two new test files: 8 of 8 tests failed, each on its own check.
- **Controls** (`run-bot-controls.txt`, run by `controls-after-bot.py` on a copy of `e1c3d46` made with git archive): 10 of 10 failed as they should, X26 to X35.
- **Checks** on `e1c3d46`: type check passed (`run-bot-typecheck.txt`); whole suite under the shared lock, 19 files and 425 tests passed, none skipped (`run-bot-tests-full.txt`; its lines "Closing file descriptor ... on garbage collection" are the stopped rewrites' handles, which a stopped operation never closes); licence check passed (`run-bot-licences.txt`). No dependency added.

### What this still does not show

- **No real crash.** A stop here is an operation that never returns, in one process: no process is killed part-way through a rewrite, and no power is cut. That a line forced to disk, and the folder's entries, survive a power cut rests on fsync doing what the operating system documents (the folder's is best effort).
- **Two rewrites at the same moment** (gap 105): narrowed (a rewrite whose file was replaced after it opened it now stops before its rename), not closed.
- **The recovery's check and its write are two steps** (gap 106): the lock can be lost between them, as for the gateway's own guard. A connection that stops answering without closing makes the run wait, not write.
- Leftovers are moved in only at a gateway's start and by the script, not by a running gateway; a temporary file left by a stop before the rename is not removed (it holds nothing the journal file does not).

## Brought up to date with 1.4c (13 Nov 2026)

The integration branch `claude/stage-1` at `8c50522`, where pull request #35 merged package 1.4c ("a bill above its hold freezes the project until the owner records it"), was merged into this branch with `git merge --no-ff origin/claude/stage-1`: merge commit `64e67b5`. What each package does is kept; no check of either was removed or loosened. Line numbers below are in `64e67b5`.

### What the merge changes

- **1.4b's migration is renumbered 012.** Both packages had added a migration numbered 010. 1.4b's `010_journal_set_asides.sql` is now `builder/src/store/migrations/012_journal_set_asides.sql`, after 1.4c's `010_overrun_freezes.sql` and `011_kept_above_hold.sql`; its table and triggers are unchanged (`:1-63`).
- **A set-aside's freeze is a kind of its own, `journal_line_set_aside`** (`012_journal_set_asides.sql:65-100`). On 1.4c's schema, the insert as this branch wrote it would have taken the column's default, `unrecorded_ending`. Migration 012 now: adds the kind to `project_freezes_kind_known` (`:82-84`); leaves it out of `project_freezes_overrun_figures`, as `unrecorded_ending` is (it has no bill; `:85-90`); adds `project_freezes_set_aside_line`, which requires such a freeze to name its hold and the hold's amount, to have no bill, to carry the set-aside's id in its record with its journal id `set-aside:` and that id, and to carry the line's fingerprint, 64 hex digits (`:91-97`); and recreates 1.4c's index `project_freezes_one_overrun_per_hold` leaving this kind out, as it leaves out `unrecorded_ending` (`:98-100`), so two lines may still be set aside naming one hold, as on this branch before (each freeze is one line's, by its unique journal id). The store's `on conflict` clause names the index's new condition (`builder/src/store/freezes.ts:189`). For 1.4c's four kinds every check is as it was.
- **Every place that writes or reads a freeze's kind** (searched in `src`, `scripts` and `test` on both sides for `project_freezes`, `.kind`, `FreezeKind` and the set-aside's reason):
  - `builder/src/gateway/journal-recovery.ts:587-588` writes the kind; `:635` names it in the `project.frozen` event, as 1.4's and 1.4c's freezes do.
  - `builder/src/store/freezes.ts:39` (the kind's type), `:150` (the refusal's own message for a set-aside freeze, as on this branch; read by its kind, and by its reason too, for a set-aside freeze written by this branch's code on a database that had not run 1.4c's migrations, which keeps the kind `unrecorded_ending`).
  - `builder/src/gateway/app.ts`: the refusal uses that message and writes the freeze's kind in its `gateway.refused` event (`:366`, unchanged); its header says so (`:32-37`).
  - `builder/src/store/reconcile.ts:198`: the list shows the hold as "froze its project", as this branch did; `:510`: `--overrun`'s refusal names what froze it. `reconcileHold` clears every freeze of its hold (unchanged), so the owner's reconciliation of the named hold clears this one, as for `unrecorded_ending`; `listUnreconciled`'s two other queries need no change.
  - `builder/scripts/reconcile.ts:118-130`: the freeze's line says it came from a line set aside (by its kind, or its journal id), beside 1.4c's labels for its kinds.
  - Read and left as they are: `builder/src/store/holds.ts` (passes the kind into its refusal events), `builder/test/invariants.ts` (rule 3 reads only `bill_above_hold`; rule 4 reads every `project.frozen` by its freeze id), and the recovery's candidates (a hold any freeze names is not one).

### Each conflict, and how it was resolved

| File (lines in `64e67b5`) | Resolution |
| --- | --- |
| `builder/scripts/reconcile.ts:118-130` | 1.4c's labels by kind kept; this branch's line for a set-aside freeze folded in, by kind or journal id (1.4c's code allows a freeze with no journal id, so this branch's `journalId.startsWith` became a guarded check) |
| `builder/src/gateway/app.ts:25-37` (header comment) | 1.4c's two paragraphs, then this branch's, with one sentence on the new kind |
| `builder/src/store/freezes.ts:85-101` | 1.4c's three reasons, then this branch's, its comment naming the kind |
| `builder/src/store/freezes.ts:121-157` (`frozenMessage`) | 1.4c's messages for its three kinds first, then this branch's set-aside message (by kind or reason), then package 1.4's |
| `docs/BUILD-PLAN.md:290-291` | Both progress rows, 1.4b's then 1.4c's; 1.4b's row says it was brought up to date at `8c50522` and that pull request #33 is open |
| `docs/DECISIONS.md:120-125` | 1.4c's three rows (merged first), then this branch's two, then one new row for this merge's decisions; this branch's first row notes the renumbering |
| `docs/KNOWN-GAPS.md:121-135` | In number order: 105 (this branch's text, which is 1.4c's with this branch's notes added), 106 to 109, 114 to 117, 142, 143, 144 to 147; gap 109 gains a note on the new kind |
| `docs/STATUS.md` | Written again from both, 399 words: 1.4c merged, 1.4b this pull request |
| The two migrations numbered 010 (no text conflict) | This branch's renamed 012 and brought onto 1.4c's schema, as above |

### Tests

None of either package's tests changed: against `b1476a6`, `builder/test/journal-recovery.test.ts` only gains lines; against `8c50522`, `overrun.test.ts`, `invariants.ts`, `gateway.test.ts` and `reconcile.test.ts` are the same, and `failures.test.ts` carries this branch's one change. One test was added, **"(m) brought up to date with 1.4c"** (`builder/test/journal-recovery.test.ts:874`): two lines set aside naming one hold give two freezes of kind `journal_line_set_aside`, each with its journal id, no bill and its line's fingerprint, and each `project.frozen` event names the kind; the project's next call is refused 402 `project_frozen` with the set-aside's own message and nothing reaches the stand-in, the `gateway.refused` event naming the kind; the list shows the hold as "froze its project" with both freezes, and `scripts/reconcile.ts --list` prints each freeze's set-aside line; the database refuses such a freeze with no hold, no fingerprint, a fingerprint not of 64 hex digits, or a bill; `recordOverrun` refuses it (`no_overrun_freeze`), naming what froze the project, and nothing changes; the hold's reconciliation clears both freezes, and the project's next call is forwarded and settled; the invariant checker finds nothing.

### Runs (outputs kept as `run-merge-*.txt`)

- **The migration chain** (`run-merge-migrations.txt`; the checks in `migration-checks-merge.sql`). On an empty database, 001 to 012 applied, then "Nothing to apply". On that database, made-up rows: two set-aside freezes on one hold accepted; seven malformed ones refused by `project_freezes_set_aside_line` (code 23514: no hold, no fingerprint, a fingerprint not hex, another journal id, no journal id, a bill, no hold amount); 1.4c's kinds still refused by their own checks (`project_freezes_overrun_figures`, `project_freezes_one_overrun_per_hold` with 23505, `project_freezes_kind_known`); the store's `on conflict` clause still finds its index. On a database as this branch alone left it (`b1476a6`'s chain, with a set-aside freeze written as this branch wrote it): 010, 011 and 012 applied; that freeze keeps the kind `unrecorded_ending`.
- **Type check** passed (`run-merge-typecheck.txt`). **Licence check** passed (`run-merge-licences.txt`). No dependency added.
- **The whole suite**, under the shared lock, on the merge's code: 20 files, 444 tests passed, none skipped (`run-merge-tests-full.txt`). That is this branch's 19 files and 425 tests, plus 1.4c's `overrun.test.ts` and its 18 tests, plus "(m)" (1.4c's own last run: 16 files, 417 tests; the base both started from: 15 files, 399 tests, by the same sum).
- **Controls**, each on a git-archive copy of `64e67b5`, each set on a test database of its own; the two `.sh` sets of each package were run as copies with only their database names changed (`builder_test_p14b`, `builder_test_p14c`, `builder_test_f14c` and `builder_test_f14c_ctl` to this run's own).
  - **The merge's own** (`controls-merge.py`, `run-merge-controls-merge.txt`): the two tests they use passed first on the unchanged copy; then **17 of 17 failed as they should**. M1 to M10 each take one part of the new kind away: the kind written (M1), the kind in `project.frozen` (M2), migration 012's check made always true (M3), its fingerprint part (M4), its hold and no-bill parts (M5), the refusal's own message (M6), the list's "froze its project" (M7), `--overrun`'s words for it (M8), the script's set-aside line (M9), and two lines naming one hold (M10: 1.4c's index and clause as in migration 010). Z8m, Z9m, Z10m, Y7m, X2m, X8m and X13m are the controls below that no longer reach their safeguard, aimed at where it now is.
  - **This branch's 1.4b sets.** `controls.sh` (`run-merge-controls-1.4b.txt`): 11 of 14 failed as they should; X2, X8 and X13 were not applied: their text left `builder/src/gateway/journal.ts` with this branch's own review and review-bot fixes (it is not found at `b1476a6` either; the merge does not change that file), and X2m, X8m and X13m above, the same safeguards on the code as it stands, failed as they should. `controls-after-review.py` (`run-merge-controls-1.4b-after-review.txt`): 11 of 11. `controls-after-bot.py` (`run-merge-controls-1.4b-after-bot.txt`): 10 of 10.
  - **1.4c's sets.** `controls.sh` (`run-merge-controls-1.4c.txt`): 16 of 17 failed as they should; Y7 was not applied: 1.4c's review added a third kind to the line it changes (not found at `8c50522` either), and Y7m above failed as it should. `controls-after-review.sh` (`run-merge-controls-1.4c-after-review.txt`): 9 of 12 failed as they should; **Z8, Z9 and Z10 did not**: they change migration 010, and migration 012 now drops and adds again the two things they change (the bill-above-hold check and the one-per-hold index), so a change to 010 alone no longer reaches the database. Z8m, Z9m and Z10m make the same changes in migration 012 and each failed as it should. Expected from the merge's design, not a check removed; but a reader of 1.4c's evidence should know Z8 to Z10 now need 012.

### What this still does not show

- The database checks that a set-aside freeze names a hold and carries a fingerprint, not that they are those of its `journal_set_asides` row (both are written in one transaction; gap 109's note).
- A set-aside freeze written by this branch's code on a database that had not run 1.4c's migrations keeps the kind `unrecorded_ending`; its message is then chosen by its reason, which no test shows (the migration run shows the row's kind only). Only a development or test database can hold one.
- The demonstration (`run-demo.txt`) was not run again.
- No engineer has reviewed the merge; a fresh reviewer's check of these claims is next.
