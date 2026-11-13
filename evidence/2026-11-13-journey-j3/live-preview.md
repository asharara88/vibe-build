# J3: your live preview of the scripted app

*Written by Claude Code on 13 Nov 2026, branch `claude/j3-live-preview` from `claude/stage-1` at `ee36b3c`. Built, not tested. One adversarial review found nothing blocking; its notes are answered in "After the review" at the end. **Not yet approved for use: your two-page phone test comes first** (below), and since the review the live preview is off until it is turned on (`BUILDER_LIVE_PREVIEW=1`), which is done only after that test.*

## What you can now do

Once the live preview is turned on (after your phone test; since the review it is off until then), on the builder's preview screen, while a project's app runs, press **"Open the live app"**. The builder shows a pass once (8 characters, works once, for 2 minutes). Open **"app"** in your Claude app's preview list (this machine's port 4030), type the pass, and use example 1's app as it runs: its own sign-in as the made-up employee (press **"Show the sample sign-in"** on the builder for the email and password), My requests, a new request, the list, Arabic, sign-out. "Leave the live app" (at `/__builder/leave`) or "End the live app" on the builder ends it; so do signing out of the builder, running the checklist, closing the project, the app stopping, and 8 hours.

| Part | Real or Simulated |
| --- | --- |
| The app you use | **Simulated build**: written by the scripted engine, Claude Code's fixed changes, no AI model. Labelled "Simulated build: scripted engine, sample data" on the button, the pass and the gate. The app's own banner says it is sample data |
| Its data | Made-up only ("Made-up data only. No customer or personal details. Removed when the project closes.") |
| The app running, the streams, the front, the pass, the sign-in | **Real** |
| Only scripted builds | Enforced in code: the live app is refused unless the project's record shows only the scripted engine's fixed changes (test; control J3-C15) |

## How it works, in one paragraph

Your phone's browser talks to the builder's **preview front** (a small program on this machine, run as a user of its own with no access to Docker, the database, the builder's files or its passwords: M6). The front checks every request (another site's request, an unknown method, a body over 1 MB: refused before anything reaches the app), keeps only a short list of headers, and passes the request on through the builder to a **short-lived container on the project's own private network** (`check`, as package 0.6c made it), which holds one connection to the app. Nothing on this machine opens a connection to the app itself; the app still has no port on the machine. Answers come back the same way; the front checks them (cookies renamed, redirects kept on the preview, anything but web pages, scripts, styles, images and fonts refused) and adds its own rules (no fetch, form, frame or worker to anywhere else).

**What changes in your 0.6c rule (your answer (a), 13 Nov):** while you use the live app, its page code runs in your phone's browser, which has the internet: a way out besides the builder's door, for scripted builds only (known gap 148).

## Your phone test

Two test pages with no data, which this session starts when you say "phone test" and adds to your preview list as "probe-a" and "probe-b":

1. Open **probe-a**. Press its steps in order: 1 (send a form to this page), 2 (open this page again), 3 (go to probe B by a link), 4 (send a form to probe B), 5 (try a port that was not shared), 6 (the cached page, twice). If step 3 or 4 says the address could not be built, open probe-b from the list instead.
2. Open **probe-b** and press its steps.
3. Say "done". If you can, also say whether probe-a opens in a private window when you are signed out of Claude.

The pages record each request's address, what kind of page sent it, and the names (not values) of its headers and cookies (`builder/scripts/probe-phone.ts`). Claude Code then reads them and applies the design's table: same origin for both pages, or a pane that frames them from another site, **stops** the live preview (option (b), guided clicks, instead); the same host on another port, same-site, or cross-site **goes on**, with what it shows added to known gap 157. Tried on this machine with `curl` only; not yet on your phone.

## What was measured first, and what it changed

| | What | Result | File |
| --- | --- | --- | --- |
| M1 | Your phone (two pages) | **Not run yet: yours** (above). Prepared and tried on this machine with `curl` only | `builder/scripts/probe-phone.ts` |
| M2 | Streams through `check` containers (a stand-in app, under the shared lock) | Run six: every check passed. A new stream's first byte about 0.3 to 0.5 s, a kept-alive stream's 1 to 2 ms; a 2 MB answer byte for byte five times out of five; a POST body of every byte value 0 to 255 (Ctrl-P and Ctrl-Q included) byte for byte both ways; six streams at once; nothing left after a client leaves part-way, after a page that never ends is left, after the session ends, or after the interface is killed with SIGKILL. Kept `compose run` (S1) over `exec` (exec's first byte about 0.16 s, but it runs inside a container the app controls) | `m2/m2-streams.txt` |
| M2, earlier runs | What M2 found before it passed | (1) a stream whose reader had gone blocked its docker client and its container, which then could not be killed (fixed: what is left is read and dropped, and the client's whole process group is killed); (2) the measurement's own SIGKILL had hit `tsx`'s wrapper, not the interface (fixed in the script); (3) a stream for a page that never ends outlived a killed interface (fixed: idle limits in the stream's script); (4) once in four runs, a 2 MB answer lost its last 53 KB when the container exited at the app's close (fixed: it writes everything out first); (5) ending the docker client's input does not reach the container (so a stream is ended by killing its container) | `m2/earlier-run-1.txt` to `-5-stopped.txt` |
| M3 | The real app (example 1) through the whole chain, in the live camera (`test/preview-live.test.ts`) | The owner's walk: 19 of 19 checks (gate, pass, the app's sign-in, a request saved and listed, Arabic right to left, 390 px, sign-out, leave; fetches from the app's page to `app:3161`, to the builder's 4020 and to an outside name refused by the policy before any request; a service worker refused; the walk itself drew no policy refusal; no answer names `app:3161`; every cookie prefixed; no redirect off the preview). Sign-in under a second; the whole walk 12 to 14 s. WebRTC present (not blocked: gap 148). Storage cleared on a new entry (Chromium). Each mapping turned off: without Host the app's own server action refused (500); without Origin its own sign-in refused (403); Referer, Sec-Fetch-* and the cookie prefix not needed by the app. The policy's `sandbox` value works, so it is on. Found and fixed: the gate's pages had `no-referrer`, so Chromium sent `Origin: null`, which the gate refused | `m3/m3-measurements.txt`, `m3/screens/` |
| M5 | 0.6c's isolation run, with the stream container and the live camera in its lists, and the front's port 4041 listening first | PASS: every project container matched its list (app, tools, db, runner, engine as 2.2 would place it, the door, a stream, the live camera); through the camera socket only the front's stand-in answered; both positive controls answered; all four deliberate misconfigurations failed their comparison, and the two new ones (the stream container also on `out`; on the machine's network) were also refused by the builder's own check (`streamNetworkProblem`). Nothing left. 456 s | `isolation/run-isolation.txt` and its files |
| M6 | The front's process | User 1990, no capability, no supplementary group; its environment: its port and the pump socket's path (and the two names Node's fork adds). As that user: Docker's socket, a data folder like the interface's, a door socket like 0.6c's and the builder's files refused; PostgreSQL refuses its sign-in (peer over the socket; a password asked over TCP). It reaches every port on the loopback address (gap 149) | `m6/m6-front.txt` |

## Tests and controls

- **New tests, without containers** (counts as on `c8c4b23`; the review's tests are in "After the review"): `test/preview-rules.test.ts` (24: every rule of sections 4.4 to 4.6); `test/preview.test.ts` (26, the forked front with a stand-in upstream on the pump socket: the gate, single use, expiry, the lock-out apart from 4020's, refused requests opening no stream, the pump refusing a stream before the pass is used, size and time limits, 127.0.0.1 only, the front's user and environment, bad fork messages ignored, every way a session ends); `test/journey.test.ts` (6: the live job's rules, scripted builds only, the stream network check, the checklist closing the session and saying so, project close, app stop); `test/web.test.ts` (1: Open and Show by POST only, nothing on a GET page or in the record, every value of the sign-in cookie read, sign-out ending the session); `test/sandbox.test.ts` (1: `appStream`'s exact docker arguments); `test/isolation.test.ts` (1 unit: group U).
- **New live test:** `test/preview-live.test.ts` (6: M3, plus the refusals: no pass, a crafted cross-site POST opening no stream, after the project closes). `test/isolation.test.ts`'s live test now also probes the stream container and the live camera.
- **Controls:** 26, each safeguard removed in turn and its test shown failing, then restored, on `c8c4b23` (`controls.txt`). In the first run J3-C25 (the pump taking a stream before the pass is used) was not seen by any test, and J3-C15 was written for one file when it needs two; a test was added and the script fixed (`controls-first-run.txt`).

## The checks

| Check | Result | File |
| --- | --- | --- |
| `npm run typecheck` | Passed on `c8c4b23` (exit 0) | `run-typecheck.txt` |
| `npm test`, the whole suite, live tests included, under the shared lock | **Passed on `c8c4b23`: 672 of 672**, 29 files, 951 s; nothing left (no container, no short folder). On `0706ee3` it had failed 2 of 671: a J1 test still expecting J1's words for where the app is reached from (rewritten by J3, as the design asks), and the approved-images scan, which reads CSS written `property:value` as an image name; both fixed (`8604f2e`, `c8c4b23`) | `run-tests-full.txt`; the first run, `run-tests-full-0706ee3.txt` |
| `npm run check:licences` | Passed on `c8c4b23`: no dependency added, no lock file or image list changed | `run-licences.txt` |

## The automated run

`builder/scripts/demo-journey-j3.ts`, run on `0706ee3` (before the last fixes, which change the front's CSS spacing, a request stopped when the browser leaves, and a restart cap), under the shared lock, from a fresh database and data folder: the interface on 127.0.0.1:4021 with its front on 4041. J1's builder camera (on the machine's network, loading only 4021) built example 1 through the screens, pressed "Open the live app" and "Show" as you would, and wrote the pass and the sample password as read-only files; the run handed them to the live camera (in the project's own runner container on `front`, its browser loading only 127.0.0.1:4030 inside its container). **46 of 46 checks passed** (`run-demo.txt`): the builder camera's 18, the live camera's 19, the record's 1, and 8 on Docker's list of the project's containers, sampled every second (no published port; only the door's machine side on the machine's network; the app camera, the runner, the live camera and every stream on `front` alone). Nothing of the run was left (containers, images, volumes, networks, folders, the database; ports 4021, 4041 and 13161 free after). 87 events in `events.json` (live_opened 2, live_entered 1, live_closed 2: leave, checklist); neither the pass nor a password in them.

Screenshots, `screens/` (the pass and the sample password masked):

| File | What |
| --- | --- |
| `builder-01-preview-live-panel-en.png`, `-ar.png`, `-phone.png` | The preview screen's live panel: labels, "not yet approved for use", Open, Show |
| `builder-02-live-pass-en.png` | The pass, shown once (masked) |
| `builder-03-live-sample-sign-in-en.png` | "Show": the made-up employee (password masked) |
| `live-01-gate.png` | The gate, both languages, before the pass |
| `live-02-app-sign-in.png` | The app's own sign-in, through the preview |
| `live-03-app-home.png` | Signed in as the made-up employee |
| `live-04-app-my-requests.png` | My requests |
| `live-05-app-new-request.png` | A new request, filled in |
| `live-06-app-request-listed.png` | Saved, and listed |
| `live-07-app-my-requests-ar.png` | Arabic, right to left |
| `live-08-app-my-requests-phone.png` | At 390 px wide |
| `live-09-app-signed-out.png` | Signed out of the app |
| `live-10-left.png` | Left the live app |
| `builder-04-preview-after-live-en.png`, `-ar.png` | The preview screen after: "closed (leave)" |
| `builder-05-checklist-after-live-en.png`, `-ar.png` | The checklist run after live use: "The app was used live before this run; its data changed." |
| `builder-06-record-en.png` | The record, with live_opened, live_entered, live_closed |

## Checked and assumed

- **Checked (run, with its file):** each measurement above; the tests and controls; the automated run; the isolation run; the typecheck, the suite and the licence check.
- **Assumed, not measured:** that your phone's browser (WebKit, if an iPhone) treats the policy, the cookies and Clear-Site-Data as Chromium did (gaps 152, 155); the tunnel and your app's pane (M1, gap 157); that 40 bits with a lock-out is enough for a pass shown on one screen (gap 151).

## Not done

- **M1, your phone test.** The live app stays "not yet approved for use".
- ~~The adversarial review~~: done; see "After the review". J3 is not marked tested before its pull request merges.
- **The pull request.** Branch committed, not pushed.
- Your 4020 interface (an older copy) gets the live app only when started from this code after the merge, with the live preview turned on (`BUILDER_LIVE_PREVIEW=1`, after your phone test); its start removes your projects' running sandboxes. **Found at the end of this work, 20:11 UTC:** it was not running (no process; 4020 not listening). It was listening when the work began and when the isolation run read the machine's listeners (about 19:13 UTC). Claude Code did not knowingly stop it: every process stopped in this work was one of its own runs, by its process number or by a pattern naming that run; the one suite test that ends an interface's lock session ends only its own database's; PostgreSQL's log has no line for your interface's database; its log file ends at its last start (17:24 UTC) with no stop line. Its files, database and lock were not touched (its log file was read). Cause not known.
- **Found by Claude Code's own reading, then changed before the last suite run:** (1) a browser that left before the app's headers came did not stop the request to the app at once; it now does (test; control J3-C26). (2) A front that stopped after it had started was started again a second later with no limit; it is now started again at most five times in one interface's life, then the live app stays off until the interface restarts (no test).

## After the review

**The review.** One adversarial review, by a reviewer that did not write the code, read `bc7b637` on 13 Nov 2026 (its `builder/` tree the same as `c8c4b23`'s). Its verdict: may be merged as it stands; nothing blocking. On an exact copy it ran the typecheck; under the shared lock, the preview, rules, web, journey and sandbox tests (159 of 159) and the live test against the real example 1 (6 of 6; the owner's walk 19 of 19); and 24 hostile probes of the real forked front with a raw stand-in app. It read the whole diff, the records and the evidence. It left nothing behind and did not touch 4020, `j1owner` or `builder_owner_j1`.

**What was done with each of its notes** (fixes in `f16a64a`, one test rewritten in `a792e52`; each new test failed on the code before the fix and passes after: `after-review/new-tests-before-and-after.txt`):

| The review's note | What was done | Shown by |
| --- | --- | --- |
| The live preview has no switch: the front starts on 4030 whenever the interface starts, so if 4020 were restarted from this code before your phone test, only "nobody reports port 4030" would keep the live app from you | **Fixed.** The interface starts the front only with `BUILDER_LIVE_PREVIEW=1`; off (the default), nothing listens on its port and "Open the live app" is refused ("This interface was started without the live preview."); any other value refuses the start. It is turned on only after your phone test (`docs/DECISIONS.md`, 13 Nov; gap 160). The automated run's script turns it on | `test/web.test.ts`: the real interface started both ways on its own database, and the settings test; controls J3-C35, J3-C36 |
| A raw client with a valid session could send a GET with a Content-Length: the front passed the header on but never the body, so the app could read the next request on that kept-alive stream as the body, with headers not on the allowlist | **Fixed.** A GET or HEAD is sent to the app with no Content-Length (`preview-rules.ts`, `upstreamHeaders`, which now takes the method). A POST keeps its own | `test/preview-rules.test.ts`; `test/preview.test.ts`: a raw client's GET and HEAD stating a body, then a plain GET on the same connection, each reach the stand-in app as a request of its own with no Content-Length; control J3-C27 |
| Answer headers not on the drop list pass: Speculation-Rules, X-DNS-Prefetch-Control, SourceMap, X-SourceMap, Accept-CH, Critical-CH, Set-Login and Supports-Loading-Mode reached the browser; gap 148 omits quiet requests made without navigating, and says new windows stay open though the sandbox has no `allow-popups` | **Fixed:** those headers, Origin-Trial and Attribution-Reporting-* are dropped. **Recorded:** gap 148 now lists the quiet requests the page itself can still ask for (`dns-prefetch`, `preconnect`, inline speculation rules) and says new windows are expected to be blocked, not measured; gap 159: the answer's headers are a drop list, not an allowlist (an engineer's choice) | `test/preview-rules.test.ts`; controls J3-C28, J3-C29 |
| The other hostile answers held (Location in many forms, Set-Cookie with Domain or a reserved name, Early Hints, a smuggled second answer, a 101, an Upgrade request); status 999 and bytes outside ASCII in a header passed through | Nothing to change for those that held; the two that passed are in gap 159 | the review's probes |
| Gap 149's "two others" include 127.0.0.1:40405, this cloud session's own proxy, so a flaw in the front would also reach the internet | **Recorded** in gap 149 (the port checked again on 13 Nov against `HTTPS_PROXY`, which holds no user name) | — |
| A live session outlived the builder sign-in session that opened it: at its expiry (8 h after sign-in), and when you sign in again (that ended the old sign-in session without ending the live one) | **Fixed.** The live session ends no later than its sign-in session expires (`builder_session_expired`), and a new sign-in in the same browser ends it (`signed_in_again`), as the design's "builder sign-out or expiry" says | `test/preview.test.ts` (the expiry, with the front's own end); `test/web.test.ts` (the interface passes the expiry; a new sign-in ends the live session); controls J3-C30, J3-C31, J3-C32 |
| (a) The front's restart cap had no test | **Test added:** five restarts, each ending the open session, then none; Open is refused after | `test/preview.test.ts`; control J3-C33 (the cap removed: the test fails) |
| (b) Run as root, a stale camera folder (given to the runner's user) was never removed | **Fixed** (`removeStaleFolders`); a stale folder of another user is still left alone | `test/preview.test.ts`; control J3-C34 |
| (c) If 4030 is taken, the whole interface refuses to start | **Recorded:** gap 160. Off by default now, the interface does not touch that port; turned on, a taken port still stops it, saying why | — |
| (d) The live app can be opened after sign-off, so data can change after the last checklist with nothing on the sign-off | **Recorded:** gap 161, your choice after the phone test (refuse the live app after sign-off, or note it on the sign-off and the export) | — |
| Records: the plan's row said both 26 and 25 controls; this file said `preview.test.ts` had 25 tests (26); the plan and the status gave 46 of 46 without its commit | **Corrected:** 26 controls; 26 tests (as on `c8c4b23`); 46 of 46 on `0706ee3` | — |
| Your 4020 interface was still not running (20:19 to 20:35 UTC); nothing in J3 found that could have stopped it | Not touched. Checked again at the end of this work: see below. Whether, when and from which code it is restarted is yours; started from this code, the live preview stays off unless it is turned on | — |

**The checks after the review** (files in `after-review/`):

| Check | Result | File |
| --- | --- | --- |
| The new tests on the code before and after the fixes | Before: 8 of the 9 failed; the restart cap's passed, as expected (the cap was already in the code, only its test was missing). After: 9 of 9 passed. The camera-folder test, rewritten (below), failed before and passed after | `new-tests-before-and-after.txt` |
| Controls | **36 of 36** failed with their safeguard removed (the 26 earlier ones again, on `f16a64a`, and J3-C27 to J3-C36 for the review's fixes); the tree unchanged after each. J3-C34 again on `a792e52`: failed, as it should | `controls-after-review.txt`, `controls-after-review-C34-again.txt`; the script, `../controls-scripts/controls.py` |
| `npm run typecheck` | Passed on `a792e52` (exit 0) | `run-typecheck.txt` |
| `npm run check:licences` | Passed on `a792e52`; no dependency file or image list changed since `ee36b3c` | `run-licences.txt` |
| `npm test`, the whole suite, live tests included, under the shared lock | First run, on `f16a64a`: 679 of 680. The one failure was the suite's own gate: the new camera-folder test was written `it.skipIf(not root)`, and the gate refuses a test that runs only if something holds. The test was rewritten to run always, the root-only parts guarded inside it (`a792e52`). Second run, on `a792e52`: **680 of 680 passed**, 29 files, 949 s, the owner's walk with the real example 1 among them (19 checks passed, 0 failed, 14 s); nothing left (no container, no short folder) | `run-tests-full-first-red.txt`, `run-tests-full.txt` |
| 0.6c's isolation run (M5) | **Not repeated.** No container, network, Compose service or stream changed: the fixes are in the front's header rules, when the front starts, when a live session ends, and the removal of stale folders on the machine | — |
| The automated run | **Not repeated.** None of the fixes changes a screen it photographs (the run turns the live preview on); the live test with the real example 1 (`test/preview-live.test.ts`, the owner's walk) ran in the whole suite above | — |

**Your 4020 interface:** still not running at the end of this work (21:25 UTC: nothing answers on 127.0.0.1:4020; at 20:45 UTC this machine's listening ports were 2024, 5432, 35237 and 40405). Its files, database, lock and projects were not touched. Whether, and from which code, it is restarted is yours; started from this branch's code, the live preview stays off unless `BUILDER_LIVE_PREVIEW=1` is set.
