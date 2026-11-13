# Package 1.4b: an unreadable journal line keeps the gateway closed until it is recovered

| | |
| --- | --- |
| Date | 13 November 2026 |
| Package | 1.4b, added on 13 Nov 2026 for the third outside review's item 1 ("An unreadable fault record can let the gateway restart and accept calls"; `docs/reviews/2026-11-13-third-outside-review-supplied-by-the-owner.md`, copied unchanged) |
| Done means | The review's required fix: "unreadable records must block forwarding until recovered; test a truncated journal followed by restart". As set for this package: a line of the journal that cannot be read keeps the gateway closed for every project from its start; every rewrite keeps such lines byte for byte; recovery is a recorded operator action that freezes the project of the hold the line may stand for, cleared by package 1.5's reconciliation of that hold |
| Run on | The development machine (a cloud session), on the host: the builder's store, gateway and scripts, the gateway's own start-up file (`builder/src/gateway/main.ts`) run as a process and killed with SIGKILL, PostgreSQL databases made for this package (`builder_test_p14b` for the tests, `builder_demo_p14b`, made empty, for the demonstration) and a **stand-in provider**. No model was called; the key is made up; nothing was spent; every name, figure and usage record is made up |
| Result | The review's required test and nine more ran and passed (10 of 10); each of the 14 controls failed as it should; the whole suite passed (16 files, 409 tests); the type check and the licence check passed; the demonstration ran with every step as expected. Against a stand-in only |
| State | **Built, not tested.** Its tests ran and passed and its controls failed as they should (below); no adversarial review has read it yet. Tested when its pull request merges with no blocking finding open (build plan section 3) |

A **journal** is the file where the gateway keeps a call's ending while the database refuses it (package 1.4). A **hold** is the money set aside for one call. A **freeze** stops a project's calls until the owner records what a call cost (a **reconciliation**, package 1.5). A **control** is a test run with one safeguard removed, to show the test notices.

## The defect, as it was

At `4e8354a`, the gateway's start-up replay (`builder/src/gateway/journal.ts:213-222` there) reported a line it could not read as a fault message and carried on; the gate then opened for every project. The project that line belonged to was not frozen, though its hold stayed open. A journal file that existed and could not be read stopped start-up only through an unhandled error, which printed its trace (run again at `4e8354a` for this record: a journal file whose name is taken by a folder, error `EISDIR`, exit code 1, with an error trace that names the source file's path and no plain message; `run-before-unreadable-file.txt`). The defect itself (a gateway open after an unreadable line) is shown by control X1: test (a) with the new start-up block removed.

## What was built (branch `claude/pkg-1.4b-journal-recovery`)

- **What "cannot be read" means**, `readLine` (`builder/src/gateway/journal.ts:126-143`): not valid UTF-8; blank (skipped); the file's last line with no line end, even one that reads as a whole record (`:135`; a crash during an append leaves one); not JSON; JSON without every field a freeze is written from, each of its type (`isUnrecordedEnding`, `:99-124`; 1.4's check read two ids only). Lines are split from the file's bytes, each kept exactly (`splitLines`, `:79`).
- **The gate**, `FaultGate` (`:406`): `replay` (`:464`) keeps every unreadable line it finds (`:467`, before anything else is awaited) and still writes the readable records; `closed()` is true while there is one (`:414`); nothing in a running gateway clears it.
- **The refusal**, `builder/src/gateway/app.ts`: `gateway_journal_unreadable`, 503, saying nothing was forwarded and that an operator has to recover the journal with `builder/scripts/journal-recover.ts` and then restart the gateway (`:251-255`); checked first on arrival (`:269`) and first at the re-checks before each forward (`stoppedNow`, `:263`; a counting call already sent releases its hold with the reason, `:562`).
- **Start-up**, `builder/src/gateway/main.ts`: a journal file that exists and cannot be read stops start-up with a plain message (`:41-44`); the number of unreadable lines is printed before the gateway listens (`:46-48`).
- **Rewrites keep what they do not move**: the move to the done file rewrites the file from its lines as they are on disk (`moveToDone`, `:327-339`; `rewrite`, `:342`); an append after a last line with no line end starts with one (`:250-256`, `endsInsideALine`, `:369`).
- **One process per journal folder**: the folder gets an id of its own (the file `journal-folder-id`, `folderIdIn`, `:158`); `main.ts` takes a database lock keyed by it on its liveness lock's connection (`builder/src/store/liveness.ts:37`, `:82-88`; `main.ts:30-35`); a second gateway on the folder stops at its start; the journal writes nothing while the lock is not held (`guardWrites`, `journal.ts:231`; `main.ts:36`).
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
| (g) the folder's lock | A gateway loses its database connection; a recovery takes the folder's lock first; the gateway stays stopped (five of its tries); its journal's append and move are refused (`JOURNAL_FOLDER_NOT_HELD`) and the file is unchanged; once the recovery lets go, the gateway takes its locks back and the move goes through | X13 |

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

- **It is not tested** in the plan's sense: no adversarial review has read it.
- **Which hold a line stands for is the operator's judgement**, written as stated; nothing checks the line names the hold given, or that a `--no-hold` line concerns no open hold (gap 107). A wrong choice leaves the right project unfrozen, though its hold stays counted at its full amount.
- **The folder's lock holds on one database only**; two processes on one folder and different databases are not stopped (gap 106; gaps 93 and 105 brought up to date).
- **Some lines the script refuses** (two identical lines, a line over 1 MiB, an unclear earlier set-aside); an engineer then edits the file by hand, unrecorded; a journal file that cannot be read at all has no tool (gap 108).
- **Designed, not shown:** a set-aside stopped at its other steps; two gateways making a folder's id at once; a journal file the gateway may not read (the tests run as root); that the set-aside file survives a power cut (gap 109; gap 92).
- **While a line cannot be read, every project on that gateway is stopped**, by design, until an operator acts and restarts it; the 503's wording is Claude Code's, for the owner to approve.
- Proof row B10, which this builds on, rests on a design no engineer has reviewed (gap 35).

## What the owner can look at

`run-demo.txt` in this folder: the gateway closed by a cut journal line, the recovery, the restart, the reconciliation, the project running again, each step's output as printed.
