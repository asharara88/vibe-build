# J3: your live preview of the scripted app

*Written by Claude Code on 13 Nov 2026, branch `claude/j3-live-preview` from `claude/stage-1` at `ee36b3c`. Built, not tested, not reviewed. **Not yet approved for use: your two-page phone test comes first** (below).*

## What you can now do

On the builder's preview screen, while a project's app runs, press **"Open the live app"**. The builder shows a pass once (8 characters, works once, for 2 minutes). Open **"app"** in your Claude app's preview list (this machine's port 4030), type the pass, and use example 1's app as it runs: its own sign-in as the made-up employee (press **"Show the sample sign-in"** on the builder for the email and password), My requests, a new request, the list, Arabic, sign-out. "Leave the live app" (at `/__builder/leave`) or "End the live app" on the builder ends it; so do signing out of the builder, running the checklist, closing the project, the app stopping, and 8 hours.

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

- **New tests, without containers:** `test/preview-rules.test.ts` (24: every rule of sections 4.4 to 4.6); `test/preview.test.ts` (25, the forked front with a stand-in upstream on the pump socket: the gate, single use, expiry, the lock-out apart from 4020's, refused requests opening no stream, the pump refusing a stream before the pass is used, size and time limits, 127.0.0.1 only, the front's user and environment, bad fork messages ignored, every way a session ends); `test/journey.test.ts` (6: the live job's rules, scripted builds only, the stream network check, the checklist closing the session and saying so, project close, app stop); `test/web.test.ts` (1: Open and Show by POST only, nothing on a GET page or in the record, every value of the sign-in cookie read, sign-out ending the session); `test/sandbox.test.ts` (1: `appStream`'s exact docker arguments); `test/isolation.test.ts` (1 unit: group U).
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
- **The adversarial review** of J3 as isolation work, by reviewers who did not write it (design, build brief step 7). Not marked tested before it.
- **The pull request.** Branch committed, not pushed.
- Your 4020 interface still runs an older copy; it gets the live app only when restarted from this code after the merge (its start removes your projects' running sandboxes).
- **Found by Claude Code's own reading, then changed before the last suite run:** (1) a browser that left before the app's headers came did not stop the request to the app at once; it now does (test; control J3-C26). (2) A front that stopped after it had started was started again a second later with no limit; it is now started again at most five times in one interface's life, then the live app stays off until the interface restarts (no test).
