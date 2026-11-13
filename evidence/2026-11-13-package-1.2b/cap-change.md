# Package 1.2b: a recorded way to change a project's cap

| | |
| --- | --- |
| Date | 13 November 2026 |
| Package | 1.2b, added by the owner's answer to his question 13 on 13 November 2026: "a, add the cap change after 1.2" (option (a): "a recorded way to change a project's cap, shown by a test", run by Claude Code or an engineer when he asks; one function in the builder's store that changes the cap while holding the project's lock and writes a `cap.changed` event with the old and new figures, who changed it and when) |
| Done means (as the plan is to read) | "Proof rows B20 to B22 of design note 7.2, and only those, each shown from the event log against a stand-in provider." **The 1.2b row is not in `docs/BUILD-PLAN.md` on this branch:** it arrives with the record update after package 1.2, written on a separate branch, and this line is to be checked against that row when both are merged. Rows B20 to B22 are in design note 7.2 on this branch, with a dated amendment: B20 and B21 are Claude Code's reading of the owner's answer; B22 is Claude Code's addition |
| Run on | The development machine (a cloud session), directly on the host: the builder's own store and gateway code, a local PostgreSQL 16.15 database (the test database `builder_test_pkg12b`, made for this package), and a **stand-in provider** in the same process as the tests. No model was called, no key exists, nothing was spent. The whole suite's live tests, run once at the end, start containers on the two sandbox images (digests in `run-tests-full.txt`); nothing of this package runs in a container |
| What a stand-in can and cannot show | It shows what the gateway and the store do with the answers they are given. It shows nothing about how the real provider counts, bills or fails (plan section 8, rule 3) |
| State | **Built, not tested.** Each of rows B20 to B22 ran and passed against the store and a stand-in provider, each by named tests, and each row's tests were shown failing with a safeguard removed (six controls, all failed as they should). No fresh reviewer has read this package yet (plan section 3, step 6). Whether the package is tested is recorded in the plan's progress table, not here, and it is not marked tested there |

**Reader.** The owner: "What was built" and "What it is and is not", then the excerpt of the event log under "What the owner can look at". An incoming engineer: everything.

Words used once and explained here: a **transaction** is a group of database changes saved together or not at all; a **lock on the project's row** makes every other change to that project wait until the holder finishes; **NaN** ("not a number") is a special value the database's number type accepts; a **control** is a test run with one safeguard deliberately removed, to show the test would notice; an **exit code** is the number a program ends with (0 means it did what was asked).

## What was built

All in `builder/`, on the branch `claude/pkg-1.2b-cap-change`, commits `549d704` (the store), `ebbae0e` (the script) and `0972784` (the tests); the records are `43e8eb4`.

- **`changeCap`, one function in the store** (`src/store/holds.ts:426-477`; the comment that introduces it, `:314-327`). It checks the figure and the names first (`:430-433`), then, in one transaction that holds the same lock on the project's row that every admission takes (`inTransaction`, `:69-86`, the lock at `:76`): it finds the project (`:436-437`), reads the budget, refuses "no change" (`:439`) and a lowering below spent plus open holds (`:440`), updates the cap and reads the database's clock under the lock (`:441-444`), compares the stored figure with the one given (`:446-449`), and writes the `cap.changed` event (`:462`). Its payload: `old_cap_usd`, `new_cap_usd`, `asked_by`, `changed_by`, `reason`, `changed_at`, `spent_usd`, `open_holds_usd`, `open_holds` (`:451-461`).
- **Each refusal has its own reason code** (`:330-339`, the class `CapChangeRefused` at `:342-352`), and nothing is changed or written:
  - the figure (`checkCapFigure`, `:382-393`): `cap_not_a_number` (not a number, or not finite), `cap_below_zero`, `cap_too_large` ($100,000,000 or more, the bound used when a hold is settled), `cap_more_than_4_decimals` (what the column keeps; checked by the round trip through `toFixed(4)`, because a critic measured that multiplying by 10,000 refuses valid figures such as 0.0003);
  - who asked, who ran it and the reason (`checkText`, `:396-404`): `<field>_missing` (missing, not text, or empty after trimming), `<field>_too_long` (over 500 characters), `<field>_not_storable` (a NUL character or half of a surrogate pair, which the event log's JSON type refuses), for each of `asked_by`, `changed_by` and `reason`;
  - `unknown_project`; `no_change` (equal to the current cap);
  - `below_spent_plus_open_holds` (`belowCommitted`, `:407-416`): a lowering below what the project has already spent plus its open holds. **Refused by default** (Claude Code's choice, pending the owner's question 14), so the invariant "recorded spend plus open holds is never above the approved cap" stays true as worded. The refusal names the lowest figure allowed at that moment: spent plus open holds, rounded up to the cap's 4 decimals;
  - `stored_figure_differs`: a second check after the update (`:446-449`); the tests assert the first reason, so this one cannot make a test pass.
- **The event writer returns the new event's id** (`:65-67`, still three lines, so no line cited by package 1.2's evidence moved).
- **The comment on which clock is read** (`:16-18`), carried from the last review of 1.2: settlement, release and admission read the gateway's clock once the project's lock is held; the 30-second pass reads it once, at its start.
- **A cap must be a real number.** Migration 007 (`src/store/migrations/007_project_cap_checks.sql`): a step that stops the migration and names any project whose cap is already NaN (`:11-19`), then the check `projects_cap_is_a_number` (`:21-22`). `createProject` refuses a cap that is not a real number, is below 0, or is $100,000,000 or more (`src/store/projects.ts:13-18`); decimals beyond the fourth are still rounded by the database, as package 1.2's tests need. Why: the database's check `cap_usd >= 0` lets NaN in, and a NaN cap would refuse no call (`docs/DECISIONS.md`, 13 Nov).
- **The script, `scripts/change-cap.ts`**, run by Claude Code or an engineer when the owner asks: `npx tsx scripts/change-cap.ts --project <id> --cap <dollars> --asked-by "<who asked>" --by "<who ran it>" --reason "<why>"`. It reads its arguments with Node's built-in `util.parseArgs` (no new dependency; `:44-50`), refuses an option given twice (`:52-54`) or missing or empty (`:56-58`), checks `--cap` as text against `^\d{1,8}(\.\d{1,4})?$` before it becomes a number (`:59-60`), opens the database with `createPool()` (`:65`), prints the database's name and never its address (`:67-68`), and prints the project, the old and new cap, spent, open holds, who asked, who ran it, the reason, the event's id and `changed_at`. Exit codes: 0 changed; 1 misuse, nothing sent to the database; 2 refused by the store (`:81-83`); 3 any other error, printing only the error's short code (`codeOf`, `:38-42`; `:84-87`), never its message, which can carry the database's address.
- **The tests**, in `test/gateway.test.ts:1775-2068`, after every test of package 1.2 (whose lines did not move).

## What it is and is not

In plain words:

- **It is** a recorded way to change a project's cap: the new figure and a `cap.changed` event are saved together, with the old and new figures, who asked, who ran it, the reason and the time. Shown against the store and a stand-in by the tests of rows B20 and B22.
- **It is** judged one at a time with the calls of the same project, through the same lock. Shown by the tests of row B21, with the lock held by a third session.
- **It is not a screen.** The owner asks; Claude Code or an engineer runs the script. No package in the plan gives him a screen for it (known gap 64).
- **It does not check who asked.** Who asked and who ran it are written as the person running the script types them (known gap 64).
- **It refuses a lowering below what is already spent plus held** (the owner's question 14 asks whether to accept such lowerings instead). A lowering is not a way to stop a project; stopping is package 1.4.
- **It does not record or block a hand edit of the database.** The builder's database role can still change a cap directly, with no record (known gaps 22 and 64).
- **A project's first cap is not in the event log**, because creating a project writes no event (known gap 64).
- **Two changes at the same moment** are both recorded, one after the other; the later one stands. Nothing checks that the cap was still the figure the second person saw (known gap 64).
- **An event's own time (`at`) is when its transaction began**, which can be before it waited for the lock; the order of events under a project's lock is the order of their ids, and `cap.changed` carries `changed_at` from the database's clock under the lock (known gap 65).

## What the owner can look at

From the script run against the test database (`run-change-cap-script.txt`, section 7), read back from the event log. Made-up project; role names only. The project had a cap of $5, $0.25 spent and one hold of $0.75 open:

```text
 672 | cap.changed  | {"reason": "evidence run of package 1.2b: a raise", "asked_by": "the owner", "spent_usd": 0.25, "changed_at": "2026-11-13T06:31:30.757Z", "changed_by": "Claude Code", "open_holds": 1, "new_cap_usd": 20, "old_cap_usd": 5, "open_holds_usd": 0.75}
 673 | cap.changed  | {"reason": "evidence run of package 1.2b: lowered to spent plus open holds", "asked_by": "the owner", "spent_usd": 0.25, "changed_at": "2026-11-13T06:31:31.601Z", "changed_by": "Claude Code", "open_holds": 1, "new_cap_usd": 1, "old_cap_usd": 20, "open_holds_usd": 0.75}
```

Between the two, a lowering to $0.50 was refused, with nothing written:

```text
Refused by the store (below_spent_plus_open_holds): The new cap $0.5000 is below what this project has already spent plus its open holds ($0.250000 spent + $0.750000 held in 1 open hold(s) = $1.000000). The lowest cap allowed now is $1.0000. Nothing was changed and nothing was written.
exit code: 2
```

## The three proof rows

Every test named here is in `builder/test/gateway.test.ts`. Runs, all in this folder: the tests of the cap change on their own, `run-proof-row-tests.txt` (11 tests, all passed); the controls, `run-tests-with-fixes-removed.txt` (six, every one failed, listed below); the script, `run-change-cap-script.txt`; and the checks at the end. The code of every run is that of commit `0972784`.

| Row | What it shows | The tests, the control | What it does not show |
| --- | --- | --- | --- |
| B20 | A raise: a call refused at a cap of $0.005 (402; nothing forwarded; `gateway.refused` carries `cap_usd` 0.005); then exactly one `cap.changed` event, every field checked, with spent and open holds the same before and after; then the same call let through (200), its `hold.opened` carrying `budget_before.cap_usd` 0.05; the log in order: `gateway.refused`, `cap.changed`, `hold.opened`, `model.call`, `hold.settled`. A lowering to exactly spent plus open holds ($0.0025 + $0.0075 = $0.01): accepted and recorded; the next call refused (402, nothing forwarded, `gateway.refused` with `cap_usd` 0.01); spent plus open holds not above the cap; the open hold untouched. The edges 0, 0.0003 and 99999999.9999 accepted as written | "B20: a raise is recorded with its event, and the next call is judged against the new cap"; "B20: a lowering to exactly spent plus open holds is accepted and recorded, and the next call is refused"; "B20: the figures at the edges of what is allowed are accepted as written: 0, 0.0003 and 99999999.9999". Control 1 (the event write removed): all three fail | That the names are true; a change made through anything but `changeCap` |
| B21 | A third database session takes the project's row lock and keeps it. Two changes (20 to 30 and 20 to 40), each on a connection pool of its own with a session name, are both seen waiting for a lock (`pg_blocking_pids`, the database's list of the sessions a session is waiting for, is not empty for each); no `cap.changed` is written while the lock is held; once it is released, the second event's old figure equals the first event's new figure, whichever ran first, and the cap is the second's new figure. The same with one change (1 to 2) and one admission (a $0.01 hold), in two rounds started in opposite orders: whichever was judged second saw the result of the first (the admission's `budget_before.cap_usd` is the new cap and the change saw no open hold, or the admission's cap is the old one and the change saw the hold) | "B21: two changes to one project are judged one at a time: the second starts from the figure the first left"; "B21: a change and an admission are judged one at a time, and their events agree in the order they were written". Control 2 (the lock removed from `inTransaction`): both fail (both changes read 20; the change and the admission disagree) | The order in which the database hands the lock to the sessions waiting for it: not asserted. Both orders happened across the runs kept here (the lines starting "B21," in `run-proof-row-tests.txt`, `run-tests-not-live.txt` and `run-tests-full.txt`). Two gateway processes: the admission here is the store's `openHold` on its own pool, in the test's process |
| B22 | Every refusal, with its reason code asserted (so a database error cannot pass for it), the cap unchanged after each and the project's number of events unchanged at the end: NaN, Infinity, minus Infinity and the text "30" (`cap_not_a_number`); -1 and -0.0001 (`cap_below_zero`); 1e8 and 1e21 (`cap_too_large`); 0.00001 and 20.12345 (`cap_more_than_4_decimals`); for each of who asked, who ran it and the reason: left out, empty, spaces only, a number (`_missing`), 501 characters (`_too_long`), a NUL character, half of a surrogate pair (`_not_storable`), and exactly 500 characters with spaces around them accepted, trimmed; an unknown project (`unknown_project`); 20 when the cap is 20 (`no_change`); lowerings to 0.0099, 0.005 and 0 when spent plus open holds is $0.01 (`below_spent_plus_open_holds`, lowest allowed $0.0100), and to 0.0061 when $0.006142 is spent (lowest allowed rounded up to $0.0062, which is then accepted) | "B22: a figure that is not a number of dollars, 0 or more, below $100,000,000 with at most 4 decimals is refused: nothing changed, nothing written"; "B22: a name or reason that is missing, empty, longer than 500 characters, or holds a character the log cannot store is refused: nothing changed, nothing written"; "B22: an unknown project, or a figure equal to the current cap, is refused: nothing changed, nothing written"; "B22: a lowering below spent plus open holds is refused, naming the lowest figure allowed now: nothing changed, nothing written". Controls 3, 4 and 5: each makes its test fail | That nothing else can change a cap (a hand edit still can, known gap 22) |

Also: "the cap change: a cap that is not a number is refused by the database (migration 007) and by createProject" (a direct update and a direct insert of NaN refused by `projects_cap_is_a_number`; `createProject` refuses NaN, Infinity, -1 and 1e8 and creates nothing; 0.017264 is still taken and stored as 0.0173). Control 6. And "the cap change raised no faults".

## Run 1: the tests of the cap change on their own

`run-proof-row-tests.txt`: `npx vitest run test/gateway.test.ts -t 'the cap change' --reporter=verbose`, at commit `43e8eb4` (code of `0972784`): 11 passed, exit code 0.

## Run 2: each row's tests with a safeguard removed (controls)

`run-tests-with-fixes-removed.txt`, at commit `0972784`. Each control is one exact text change, shown as `git diff` shows it; the row's tests run (expected to fail); the file restored with `git checkout --`; `git diff --exit-code` run (clean after every one). No control was committed. Control 6 used a fresh test database, `builder_test_pkg12b_control6`, created for it and dropped after it, because a migration is applied to a database only once.

| Control | Safeguard removed | Tests run | Result |
| --- | --- | --- | --- |
| 1 | The `cap.changed` event write in `changeCap` | `-t 'B20: '` | 3 of 3 failed ("expected [] to have a length of 1") |
| 2 | The lock: `select id from projects where id = $1 for update` in `inTransaction` | `-t 'B21: '` | 2 of 2 failed (two changes: "expected 20 to be 30", both read the old figure; change and admission: their figures disagree) |
| 3 | The figure check in `changeCap` (the database's own checks and the stored-figure comparison stay) | `-t 'B22: '` | the figure test failed: NaN reached the database, whose refusal (`projects_cap_is_a_number`) is not the reason the test asserts; the other three B22 tests passed |
| 4 | The check of who asked, who ran it and the reason | `-t 'B22: '` | the names test failed ("expected the change to be refused, but it was made"); the other three passed |
| 5 | The refusal of a lowering below spent plus open holds | `-t 'B22: '` | the lowering test failed ("expected the change to be refused, but it was made"); the other three passed |
| 6 | The check `projects_cap_is_a_number` in migration 007 | `-t 'migration 007'` | failed: the direct update to NaN was accepted |

Six of six failed with their safeguard removed.

## Run 3: the script, against the test database

`run-change-cap-script.txt`, at commit `0972784`, with `BUILDER_DATABASE_URL` naming the test database `builder_test_pkg12b` (local socket, no password). The set-up made one project with made-up figures, using the store's own functions; it is not part of the package, and is kept here as run:

```ts
// Set-up for the evidence run of scripts/change-cap.ts (package 1.2b). Made-up data only: one project in
// the database named by BUILDER_DATABASE_URL, with a cap of $5, $0.25 spent (a hold of $0.50 settled at
// $0.25) and one hold of $0.75 left open. No provider is called. Prints the project's id and its budget.
import { createPool } from "./wt-cap/builder/src/store/db.js";
import { getBudget, openHold, settleHold } from "./wt-cap/builder/src/store/holds.js";
import { createProject } from "./wt-cap/builder/src/store/projects.js";

const pool = createPool();
const id = `capdemo_${Date.now()}`;
await createProject(pool, { id, name: "cap change demonstration", capUsd: 5 });
const hold = (amountUsd: number) =>
  openHold(pool, { projectId: id, step: null, amountUsd, deadline: new Date(Date.now() + 3_600_000), gateway: "gw_demo_setup", arithmetic: {}, path: "/v1/messages" });
const first = await hold(0.5);
if (!first.ok) throw new Error("hold not opened");
await settleHold(pool, { projectId: id, holdId: first.hold.id, step: null, actualUsd: 0.25, call: { note: "a made-up call for this demonstration" } });
if (!(await hold(0.75)).ok) throw new Error("hold not opened");
const b = await getBudget(pool, id);
console.log(`project ${id}: cap $${b.cap.toFixed(4)}, spent $${b.spent.toFixed(6)}, open holds $${b.openHolds.toFixed(6)} (${b.openHoldCount})`);
console.log(`ID=${id}`);
await pool.end();
```

| Section | What was run | Result |
| --- | --- | --- |
| 1 | `--reason` left out | "Refused: --reason is missing or empty. Nothing was sent to the database."; exit code 1; events 4 before and after; cap $5 |
| 2 | `--cap 20.12345` | refused by the text check; exit code 1; nothing written |
| 3 | `--cap` given twice | "Refused: --cap was given more than once."; exit code 1; nothing written |
| 4 | A raise, $5 to $20 | printed: the database's name, old cap $5.0000, new cap $20.0000, spent $0.250000, open holds $0.750000 (1), the names, the reason, event id 672, `changed_at`; exit code 0; events 5; cap $20 |
| 5 | A lowering to $0.50, below $0.25 spent + $0.75 held | refused, naming $1.0000 as the lowest cap allowed now; exit code 2; events still 5; cap still $20 |
| 6 | A lowering to $1, the lowest allowed | accepted; event id 673; exit code 0; cap $1 |
| 7 | The project's events read back with `psql` | the four set-up events, then the two `cap.changed` events quoted above |
| 8 | A malformed database address holding a made-up password (`MADE-UP-NOT-A-SECRET`) | "The change could not be completed (error code ERR_INVALID_URL) ..."; exit code 3; the made-up password appears 0 times in the output |
| 9 | A well-formed address with the same made-up password, where nothing listens | error code ECONNREFUSED; exit code 3; neither the password nor the address appears in the output; events and cap unchanged |

## Run 4: the database facts relied on

`run-postgres-facts.txt`: constant-only queries on the test database, PostgreSQL 16.15, no table read or written. NaN is at least 0, equals itself, and is above every number; `numeric(12,4)` keeps 20.12345 as 20.1235 and 0.00001 as 0.0000, keeps 99999999.9999, refuses 100000000 and Infinity, and keeps NaN; `now()` is the transaction's start while `clock_timestamp()` moves on. The same facts in the PostgreSQL 16 manual, read on 13 Nov 2026: `docs/SOURCES.md`, the section for package 1.2b. Also counted read-only on 13 Nov: the shared local test database `builder_test` holds 7,724 projects, none with a NaN cap, so migration 007 would apply there; `builder_dev` has no tables yet.

## Run 5: the checks at the end

At commit `43e8eb4` (the records), whose code is that of `0972784`:

| Check | File | Result |
| --- | --- | --- |
| `npm run typecheck`, and the script type-checked on its own with the same options (it is outside `tsconfig.json`'s "include") | `run-typecheck.txt` | exit code 0, twice |
| Every test except the live ones: `npx vitest run -t '^(?!.*: live, ).*$'` | `run-tests-not-live.txt` | 9 files; 229 passed, 19 skipped (the live ones); exit code 0 |
| `npm run check:licences` (no dependency added or changed: `package.json`, `package-lock.json`, `licences.csv` and the notices file unchanged since `98f280d`) | `run-licences.txt` | RESULT: PASSED; exit code 0 |
| The whole suite once, live tests included, under the lock shared with other sessions (`flock`) | `run-tests-full.txt` | 9 files; 248 passed; exit code 0; no container on the machine before or after the run |

## What this does not show

- **No fresh reviewer has read this package** (plan section 3, step 6). Nothing here says it is ready.
- **That the person named as asking really asked**, or that the owner's request was recorded before the change was made. The names are written as typed.
- **How the database orders sessions waiting for the same lock.** B21 does not assert an order; it asserts that whichever was judged second saw the first. A reviewing engineer may want to read the B21 method (a third session holding the lock, and `pg_blocking_pids` to see the waiting) at checkpoint 2; it is not a condition of this package.
- **What exit code 3 means when the connection breaks after the change was saved.** The change may then have been made; the script's message says to look in the event log for a `cap.changed` event before trying again. Not shown by a run.
- **A change and an admission in two separate processes.** In B21 the admission is the store's `openHold`, on its own pool, in the test's process; the script ran one change at a time.
- **What a cap change does to a step hold.** Package 1.3 is not built; its design has to say.
- **For the engineer, inferred from the manual and not run:** this package adds the first update of a `projects` row. A future transaction that locks that row under a stricter isolation level than read committed would fail with a serialization error after a concurrent cap change; `inTransaction` states read committed (`src/store/holds.ts:72-74`), so package 1.2's code is not affected.
- **Anything about the real provider.** Every call here went to a stand-in.
