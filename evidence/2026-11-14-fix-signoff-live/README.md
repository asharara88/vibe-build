# Sign-off and the live app: no live use after sign-off

## In plain words, for the owner

**What you asked** (independent review of `14787d8`, 14 Nov 2026): "Sign-off integrity: block opening the live app
after sign-off. If a live session is already open, end it before completing sign-off. Test both cases so the
signed-off state cannot subsequently be changed through live preview."

**What was wrong.** After you signed a project off, the preview screen still offered "Open the live app", and it
opened. If a live session was open when you signed off, it stayed open after the sign-off. Either way, the app's data
could change after the sign-off, and nothing on the sign-off said so. This was known gap 161, left for your choice.

**What changes for you.**

1. Once a project is signed off, the preview screen shows no "Open the live app" button. In its place it says, in
   English: "This project is signed off. The live app is not opened after sign-off, so the signed-off app is not
   changed through it." If the request is sent anyway (for example from a page left open earlier), it is refused with
   the same sentence, and nothing is opened or written.
2. If a live session is open when you press "Sign off", the builder ends it first: the live app's page stops working
   in your browser, its connections to the app are cut, and the project's record notes the end of that session (with
   the reason "signed_off") before it notes the sign-off.
3. Two clicks at the same moment cannot get round this: an "Open the live app" pressed while the sign-off is being
   saved waits for it and is then refused; a "Sign off" pressed while the live app is being opened is refused, as it
   already was while any step runs, and works once the opening has finished (and then ends that session first).
4. The export after sign-off is the same as before.

**What was checked, and how.** Seven new automated tests drive the builder's own screens with a stand-in for the app's
sandbox and the real live-preview front. Six of them failed on the code you were reviewing (`14787d8`), which shows
they catch the problem; all seven pass on the fix. One of the seven is a control: before sign-off, "Open the live app"
still works, before and after the fix. Then each safeguard was removed on purpose, one at a time ("controls"): each
time, a named test failed, as it should. The whole test suite, the type check and the licence check were run on the
fix. Results are in the table below.

**What this does not show.** These tests use a stand-in sandbox, not your phone or a real browser on the app; the
phone test is separate. Two smaller points remain, recorded as known gaps: a request the app had already received a
moment before the sign-off may still be carried out just after it (gap 173, not measured); and the live app can still
be used after a passing checklist and before the sign-off, without the sign-off saying so (gap 174, your choice).

| | |
| --- | --- |
| Date | 14 November 2026 |
| Branch | `claude/fix-signoff-live`, from the integration branch `claude/stage-1` at `14787d8` |
| Commits | `d4418b7` the tests (first, failing on 14787d8's source); `8460ed9` the fix; then this evidence and the records |
| Run on | The development machine (a cloud session). PostgreSQL database `builder_test_fxso`, made fresh for each run and dropped at the end; TMPDIR in the session's scratch folder. Stand-in sandbox; no model called; made-up data only |
| Result | Seven new tests: six failed on 14787d8's source, the control passed; seven of seven pass on the fix. 8 of 8 controls failed as they should. The whole suite passed: 29 files, 699 tests, at `8460ed9` (builder/ tree `f2f009b`). Type check and licence check passed |
| State | Built and checked by Claude Code; not yet read by a reviewer who did not write it. Not merged |

## The detail

### The fix (`8460ed9`; line numbers at that commit)

- **The rule** (`builder/src/orchestrator/journey.ts:357-365`): `JOB_RULES.live` returns `LIVE_AFTER_SIGN_OFF`
  (`journey.ts:88`) once `signedOff` is true. The preview screen already offered the button only when this rule gives
  no reason, and shows the reason otherwise (`builder/src/web/pages.ts:718-733`, unchanged). The rule is checked by
  `startJob` under the project's lock before anything is written, so a POST is refused (409) with no event.
- **The order at sign-off** (`journey.ts:811-827`): after the refusals already there (a job running in this process,
  or in the record; the checklist not passed), `await this.liveEnd?.(projectId, "signed_off")` (`:817`), then
  `journey.signed_off`. `liveEnd` is attached by `JourneyJobs.attachPreview` (`builder/src/orchestrator/journey-jobs.ts:134-137`,
  through `Journey.attachLiveEnd`, `journey.ts:929`): it is the live preview's `closeFor`. Without a preview attached
  there is no live session to end.
- **A close already under way** (`builder/src/web/preview.ts:196`, `:431-436`, `:454-472`): `closeCurrent` registers
  each close until its record is written; `closeFor` ends this project's session if it is open and then also waits
  for any close of that project already under way (a pass left unused, "End the live app", a sign-out), so that its
  record comes before what follows. The front is told to end the session and the streams' sockets are cut before
  anything is awaited, as before.
- **Why no new lock:** an open is a `live` job (`journey-jobs.ts`, `openLive`), started only through `startJob`, under
  the same per-project lock as `signOff`. An open asked for while the sign-off holds that lock waits, then reads the
  signed-off record and is refused. Once a live job has started, `signOff` refuses ("A job is running for this
  project"), unchanged.

### What was wrong, reproduced (`new-tests-before-and-after.txt`)

The seven tests (`builder/test/web.test.ts:1790-2100`, marker "after the review of 14787d8") were committed first
(`d4418b7`) and run with `builder/src` checked out at `14787d8`. Six failed, the control passed. Their first failure
lines, as saved:

```
AssertionError: the open button is offered after sign-off (en): expected '<!doctype html>\n<html lang="en" dir=…' not to contain 'data-live-open'
AssertionError: expected '<!doctype html>\n<html lang="en" dir=…' not to contain 'action="/projects/j1-e667208e1489/liv…'
AssertionError: expected '<!doctype html>\n<html lang="en" dir=…' to contain 'data-live-refused'
AssertionError: expected '<!doctype html>\n<html lang="en" dir=…' to contain 'is signed off. The live app is not op…'
AssertionError: the open button is offered after sign-off (?lang=ar): expected '<!doctype html>\n<html lang="ar" dir=…' not to contain 'data-live-open'
AssertionError: ?lang=ar: expected '<!doctype html>\n<html lang="ar" dir=…' not to contain 'action="/projects/j1-e667208e1489/liv…'
AssertionError: ?lang=ar: expected '<!doctype html>\n<html lang="ar" dir=…' to contain 'data-live-refused'
AssertionError: ?lang=ar: expected '<!doctype html>\n<html lang="ar" dir=…' to contain 'is signed off. The live app is not op…'
AssertionError: a pass was shown after sign-off: expected '72JA-4E5S' to be undefined
AssertionError: a live session is open after sign-off: expected { projectId: 'j1-e667208e1489', …(9) } to be null
AssertionError: expected 200 to be 409 // Object.is equality
AssertionError: a live session is open after sign-off: expected { projectId: 'j1-b3474dd615db', …(9) } to be null
AssertionError: the record's order: expected [ 'signed_off' ] to deeply equal [ …(2) ]
AssertionError: the pass shown before sign-off still enters the live app: expected 303 to be 403 // Object.is equality
AssertionError: expected [ { id: '148', …(5) } ] to have a length of +0 but got 1
AssertionError: a live session is open after sign-off: expected { projectId: 'j1-8f0078af921a', …(9) } to be null
AssertionError: streams to the app are open after sign-off: expected 1 to be +0 // Object.is equality
AssertionError: the record's order: expected [ 'signed_off' ] to deeply equal [ …(2) ]
AssertionError: expected undefined to match object { entered: true }
AssertionError: a pass was shown for an open asked for while the sign-off was recorded: expected 'D4KV-BV18' to be undefined
AssertionError: a live session is open after sign-off: expected { projectId: 'j1-04597c687fa2', …(9) } to be null
AssertionError: expected 200 to be 409 // Object.is equality
AssertionError: a live session is open after sign-off: expected { projectId: 'j1-a4ab76d6277b', …(9) } to be null
AssertionError: expected [ 'signed_off' ] to deeply equal [ …(2) ]
AssertionError: the sign-off answered while the live session's close was still being recorded: expected 'answered' to be 'waiting' // Object.is equality
AssertionError: expected [ 'signed_off', …(1) ] to deeply equal [ …(2) ]
Test Files  1 failed (1)
Tests  6 failed | 1 passed | 46 skipped (53)
```

On the fix, seven of seven passed.

### The tests

| Test (web.test.ts) | Shows | Failed on 14787d8 | Controls |
| --- | --- | --- | --- |
| signed off, Open the live app is refused (`:1898`) | No open button and the reason, in English and Arabic pages; a POST is refused 409 with the reason; no pass, no session, no `live_opened`, no new job; the front says there is no live app | yes | SO-C01 |
| a live session open when sign-off is asked, its pass shown and not used (`:1928`) | The session ends; the record holds `live_closed` (reason `signed_off`, that session) then `journey.signed_off`; the pass then gets 403 at the front, nothing entered; the export afterwards finishes and is recorded | yes | SO-C03 |
| a live session entered at the front when sign-off is asked (`:1960`) | The same order, `entered: true`; no stream left open; the front's cookie then gets the "no live app" page, not the app, and no new stream is opened | yes | SO-C04 |
| Open the live app asked for while the sign-off is being recorded (`:1991`) | The `journey.signed_off` write is held; an open asked for then has not answered after 400 ms; once released, it is refused 409 with the reason; no pass, no session, no `live_opened` | yes | SO-C02 |
| a sign-off asked for while Open the live app is in flight (`:2018`) | The open's network check is held; the sign-off is refused 409 ("A job is running for this project"), nothing signed off; once the open is made, a sign-off ends that session first, in the right order | yes (its last part) | SO-C05, SO-C08 |
| a live session whose close (End the live app) is still being recorded when sign-off is asked (`:2050`) | That close's record is held; the sign-off has not answered after 400 ms; once released, the record holds `live_closed` (`ended_on_builder`) then `journey.signed_off` | yes | SO-C06, SO-C07 |
| control: before sign-off, after the checklist passed, Open the live app works (`:2076`) | The button is offered in both languages; the pass is shown, the session opens, `live_opened` is recorded; a sign-off with no session open records no live close | no (passes on both) | — |

### Controls (`controls.txt`, script `controls.py`)

| Control | Safeguard removed | Test run alone | Result |
| --- | --- | --- | --- |
| SO-C01 | the live job's rule no longer refuses a signed-off project (the screen then offers the open button, and a POST opens) (`src/orchestrator/journey.ts`) | "signed off, Open the live app is refused" | FAILED, as it should with the safeguard removed; tree equal to HEAD after: yes |
| SO-C02 | the same rule removed, against the open asked for while the sign-off is being recorded (`src/orchestrator/journey.ts`) | "Open the live app asked for while the sign-off is being recorded" | FAILED, as it should with the safeguard removed; tree equal to HEAD after: yes |
| SO-C03 | the sign-off no longer ends the project's live session before it is recorded (the call removed) (`src/orchestrator/journey.ts`) | "a live session open when sign-off is asked, its pass shown and not used" | FAILED, as it should with the safeguard removed; tree equal to HEAD after: yes |
| SO-C04 | the journey is not given the way to end a live session (the hook not attached with the preview) (`src/orchestrator/journey-jobs.ts`) | "a live session entered at the front when sign-off is asked" | FAILED, as it should with the safeguard removed; tree equal to HEAD after: yes |
| SO-C05 | the sign-off recorded first and the live session ended after it (the order swapped) (`src/orchestrator/journey.ts`) | "a sign-off asked for while Open the live app is in flight" | FAILED, as it should with the safeguard removed; tree equal to HEAD after: yes |
| SO-C06 | closeFor does not wait for a close of the project already under way (`src/web/preview.ts`) | "is still being recorded when sign-off is asked" | FAILED, as it should with the safeguard removed; tree equal to HEAD after: yes |
| SO-C07 | a close under way not registered (closeFor cannot see it) (`src/web/preview.ts`) | "is still being recorded when sign-off is asked" | FAILED, as it should with the safeguard removed; tree equal to HEAD after: yes |
| SO-C08 | the sign-off not refused while a job of the project runs (both checks: the process's running job and the record's) (`src/orchestrator/journey.ts`) | "a sign-off asked for while Open the live app is in flight" | FAILED, as it should with the safeguard removed; tree equal to HEAD after: yes |

8 of 8 failed as they should. After every control, `git diff HEAD -- .` empty (the tree equal to HEAD 8460ed9): yes.

### The whole suite, type check, licence check

- **The whole suite** (`run-tests-full.txt`): `npx vitest run` from `builder/`, under the shared lock, on `8460ed9`
  (builder/ tree `f2f009b`, no uncommitted change), database `builder_test_fxso` made fresh,
  `BUILDER_BROWSER_CACHE` set as in J3's runs: **29 files, 699 tests, all passed** (J3's last run had 692; the seven
  new ones make 699), 1036 s, vitest exit code 0. No container on the machine before or after; no preview folder left
  in /tmp.
- **Type check** (`run-typecheck.txt`): `npm run typecheck`, exit code 0.
- **Licence check** (`run-licences.txt`): `npm run check:licences`, PASSED for `builder` and `builder/runner`, exit
  code 0; no dependency file or image list changed since `14787d8` (no new dependency).

### Files here

- `new-tests-before-and-after.sh` and `.txt`: the seven tests on 14787d8's source and on the fix.
- `controls.py`, `controls.txt`: the eight controls.
- `full-suite.sh`: runs the controls, then the whole suite, as `evidence/2026-11-13-journey-j3/after-bot/full-suite.sh`
  does, then the type check and the licence check; `run-tests-full.txt`, `run-typecheck.txt`, `run-licences.txt`.

### What is assumed, not shown

- That the real front behaves as in these tests on the owner's phone: these tests use the real front on this machine,
  with a stand-in for the app's streams (a stand-in app on the machine's loopback address). The phone test is separate.
- Gap 173 (a request already inside the app when its stream is killed) is a reading of how the streams end, not a
  measurement.
