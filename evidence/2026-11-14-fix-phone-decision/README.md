# The phone test's decision: GO ON only when every check has its evidence

*Written by Claude Code on 14 Nov 2026, branch `claude/fix-phone-test-decision` from `claude/stage-1` at `14787d8`. It answers the first finding of the independent review of `14787d8`. Not yet checked by a reviewer who did not write it. Not pushed.*

## In plain words

- **What was wrong.** The small program that reads your phone test's record (`builder/scripts/probe-phone.ts`, "the report") said **"GO ON"** as soon as both test pages had been opened once, even if none of their steps had been pressed. Shown below on a made-up record of two page openings and nothing else.
- **What it does now.** It lists each of the design's nine checks, (i) to (ix), as **done** or **MISSING**. It says GO ON only when all of them are done. Otherwise it says **"not decided"** and names what is missing. It still says **STOP** as soon as the record shows a reason to stop.
- **Three things the record cannot show, so you are asked them after the test.** Your answers are printed with the result:
  1. Step 5 on probe-a: did a page saying "Port 4034 answered" open? (Asked only if nothing reached that port.)
  2. Step 6 on probe-a: when you opened the cached page the second time, did its number stay the same? (Asked only if the record shows the page reached the test program once.)
  3. Does probe-a open in a private window when you are signed out of Claude? "Could not try" is an answer.
- **The live preview stays off.** The report changes no setting. The live preview is turned on only by hand, with `BUILDER_LIVE_PREVIEW=1` for your interface, and only after a GO ON is recorded with you.
- **What was checked:** 40 new tests (32 failed on the old version, all 40 pass now; 8 that check unchanged behaviour passed on both); 23 controls (each check removed in turn made its test fail); the whole suite, 732 of 732, live tests included; the typecheck and the licence check passed.
- **What is assumed, not checked:** how a phone's browser behaves (three facts from web standards that could not be re-read from this session, `docs/SOURCES.md`); nothing here has run on your phone yet.

## What it looks like (made-up records, `made-up-logs/`)

Before (the report as at `14787d8`), two page openings and nothing else:

```
DECISION: GO ON: same-site (with the cookie prefix, every-value cookie reads on 4020 too, and gap 157)
```

After, the same record:

```
  MISSING (i) probe-a: step 1 on probe-a (a form sent to this page) not done
  MISSING (i) probe-b: step 1 on probe-b (a form sent to this page) not done
  MISSING (ii) probe-a to probe-b, link: step 3 on probe-a (a link to probe B) not done
  ... (every item; (v) and (viii) are done, since every request records them)
The owner's answers: --port-4034 not given; --cached-number not given; --signed-out not given
DECISION: not decided: missing (i) probe-a; (i) probe-b; (ii) probe-a to probe-b, link; ... (vi); (vii); (ix)
This report changes no setting: the live preview stays off until BUILDER_LIVE_PREVIEW=1 is set by hand ...
```

After, a whole run with your answers: every item `done`, then `DECISION: GO ON: same-site (...)`. All of it is in `before-and-after.txt`, part 1.

## Detail

### The items and what counts as their evidence

| Item (design section 6, M1) | Done when |
| --- | --- |
| (i) probe-a, probe-b | The page was reached at one address (one Host), and its form to itself (step 1, `POST /self`) came with an Origin other than `null` |
| (ii) four items: each page's link (step 3, `GET /from-a` or `/from-b`) and form (step 4, `POST /from-a-form` or `/from-b-form`) to the other | The other page received it, with a Sec-Fetch-Site of same-origin, same-site or cross-site |
| (iii) probe-a, probe-b | The page's step 2 (`GET /again`) was received; whether its own Lax and Strict cookies came back is printed |
| (iv) probe-a, probe-b | That step 2 carried a Sec-Fetch-Dest |
| (v) | Both pages opened (every request records its header and cookie names) |
| (vi) | A request reached 4034, or step 5 was offered (probe-a's address shows 4032) and the owner answers `--port-4034=did-not-open` |
| (vii) | The cached page reached the probe twice, or once with the owner's answer `--cached-number=same` (a cache on the way: gap 157) |
| (viii) | Each page's requests carry a User-Agent |
| (ix) | The owner's answer `--signed-out=opened`, `did-not-open` or `could-not-try` ("opened" adds gaps 153 and 157) |

An answer the record contradicts (`--port-4034=answered` with nothing reaching 4034; `--cached-number=changed` with one request) leaves its item missing. A word that is not one of an answer's words, or an unknown option, is refused with exit code 2 and no decision.

### The decision, in order (`decide`, `builder/scripts/probe-phone.ts:164-283`)

1. **STOP**, whatever else is missing, on: the same Host on both pages (as before); the same Origin on both pages' forms to themselves (new); Sec-Fetch-Site same-origin on a request from the other page (new); a page whose **own** Lax cookie did not come back on its step 2 (before: any page's Lax cookie was enough, and a host shared by both pages sends both pages' cookies); framed and cross-site (as before).
2. **Not decided** if a page was never opened, or any item is missing; each missing item is named.
3. **GO ON**, by the design's rows as before: the same host on another port, same-site, or cross-site.

The old rule for a cache on the way (two requests with the same number) could never be met, since every request that reaches the probe gets a new number; it is replaced by the owner's answer.

### Nothing turns the live preview on from this report

- The report reads its log and prints; it writes no file and sets nothing (`builder/scripts/probe-phone.ts:291-318`).
- `BUILDER_LIVE_PREVIEW` is read only from the interface's environment, and only "1" turns the front on (`builder/src/web/main.ts:83-86`; the front starts at `main.ts:232`, and says it is off at `main.ts:252`). The only other place that sets it is the automated run, for its own throwaway interface on port 4021 (`builder/scripts/demo-journey-j3.ts:189`).

### Changed files

- `builder/scripts/probe-phone.ts`: the guard so a test can import it (commit `6c3bdd5`: the command runs only when the file is started as a script; before, importing it with no argument set the process's exit code to 2); the decision, the owner's answers and the printed item list (commit `6db89da`). The pages themselves are unchanged, so a record made by the pages already running is read the same way.
- `builder/test/probe-phone.test.ts` (new, 40 tests; it imports the script, so the typecheck now covers the script too).

### Tests (`builder/test/probe-phone.test.ts`)

- The review's case: both pages opened and nothing else: not decided, every item but (v) and (viii) named.
- A whole run without each item in turn (20 cases): not decided, naming exactly what is missing; plus pages whose address does not show their port (steps 3 to 5 cannot be offered).
- The three GO ON rows on a whole run; every item listed as done.
- STOP rows unchanged, including on the two page openings alone; a page never opened; an unreported port that answered.
- The three new STOP cases; the cache and the signed-out answers adding their gaps.
- The command itself, run with `tsx`: every item printed done or MISSING, the answers printed, the "changes no setting" line; a bad answer refused.

Before and after (`before-and-after.txt`, part 2; before = the decision as at `14787d8` with only the guard added): **32 failed and 8 passed before; 40 of 40 passed after.** The 8 that passed both times are the behaviour controls (the three GO ON rows on a whole run, the STOP rows, a page never opened, an unreported port that answered).

### Controls (`controls.txt`, script `scripts/controls.py`)

23 controls, PF-C01 to PF-C23: each check removed in turn by an exact replacement in the script (each text found exactly once), the test that guards it run alone. **23 of 23 failed, as they should;** the file was restored after each, and `git diff HEAD` was empty at the end.

### The checks

| Check | Result | File |
| --- | --- | --- |
| `npm test`, the whole suite, live tests included, under the shared lock, as `evidence/2026-11-13-journey-j3/after-bot/full-suite.sh` runs it | **Passed on `6db89da`: 732 of 732**, 30 files (the 692 before, plus the 40 new), 1038 s; nothing left (no container, no short folder; the test database dropped) | `run-tests-full.txt` |
| The whole suite, first try | 11 of 732 failed, all where a container that mounts `builder/` starts (`egress-host` "exited (1)"). Cause: this worktree's `node_modules` folders were links to another worktree's, which a container cannot follow (shown alone in `linked-node-modules-check.txt`). Replaced by real copies (kept out of git, as the links were); nothing in the code or tests changed; then the run above | `run-tests-full-first-run.txt`, `linked-node-modules-check.txt` |
| The new file is run and scanned | In the test runner's list (30 files); the gate's scan finds nothing that leaves a test out | `suite-picks-up-new-file.txt` |
| `npm run typecheck` | Passed on `6db89da` (exit 0); it now covers `scripts/probe-phone.ts`, which the new test imports | `run-typecheck.txt` |
| `npm run check:licences` | Passed on `6db89da`; no dependency added, no lock file or image list changed | `run-licences.txt` |

### Files here

| File | What |
| --- | --- |
| `before-and-after.txt` | The report as a command, before and after, on the made-up records; the new tests before and after the fix |
| `controls.txt` | The 23 controls |
| `run-tests-full.txt`, `run-typecheck.txt`, `run-licences.txt` | The whole suite, the typecheck, the licence check |
| `run-tests-full-first-run.txt`, `linked-node-modules-check.txt` | The first try of the whole suite, and why 11 tests failed in it |
| `suite-picks-up-new-file.txt` | The new file in the runner's list and the gate's scan |
| `made-up-logs/two-pages.jsonl`, `whole-run.jsonl` | The made-up records (reserved `.test` addresses, a made-up browser name) |
| `scripts/before-and-after.sh`, `scripts/controls.py`, `scripts/full-suite.sh` | How each was run |

### Checked and assumed

- **Checked:** the old report's GO ON on two page openings (run); each new test before and after; each control; the typecheck; the licence check; that nothing but the interface's own environment turns the live preview on (read, lines above).
- **Assumed, not checked:** three browser behaviours the new STOP cases rest on (Sec-Fetch-Site same-origin, the Origin of a form, cookies shared across ports), from web standards that could not be reached from this session; each only adds a STOP (`docs/SOURCES.md`, 14 Nov 2026). How your phone's browser and the Claude app behave is what the test itself measures.
- **Not done:** the phone test itself. The instructions you were given (`docs/QUESTIONS.md`, "J3's phone test") do not yet ask the step 5 and step 6 questions above; they are left for the next update of that file. What the report cannot decide is known gap 168.
