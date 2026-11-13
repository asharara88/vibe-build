# J3: the owner's live preview of the scripted app (final design)

*Status:* written by Claude Code on 13 Nov 2026 from the draft and one isolation critique (section 7). Not approved. Read at origin/claude/stage-1 `ee36b3c`, plus next 16.4.6 and better-auth 1.7.20 in templates/next/node_modules (the template's versions). Nothing was edited or run except reads and `stat`. R = read at the line cited; I = inference or proposal; M = to measure (section 6). Keys: NB, MS = evidence/2026-11-13-package-0.6c/network-boundary.md, measurements.md; KG, DEC, DN, BP, Q = docs/KNOWN-GAPS, DECISIONS, design/stage-1, BUILD-PLAN, QUESTIONS. Paths are under builder/ unless they start with templates/.

*Added to the repository with package J3, 13 Nov 2026. The owner answered (a), "Live, scripted only", on 13 Nov (`docs/DECISIONS.md`). What was built and measured, and where the build departs from this design (the front run from copies of its files by Node's own type stripping; the stream's script and the ending of streams, from M2; the policy's sandbox value on and the gate's pages without a referrer rule, from M3; the live camera started by the automated run's and the live test's own process; known gap 158), is in `evidence/2026-11-13-journey-j3/live-preview.md` and `docs/DECISIONS.md` (package J3).*

## 1. What the owner gets
- A second entry, "app", in his Claude app's preview list. While one project's app runs, he presses "Open the live app" on the builder's preview screen and gets a one-time pass. He types it into the "app" page and then uses example 1's app as it runs: its own sign-in as the made-up employee (email and password shown on the builder after "Show"), My requests, add a request, see it listed, Arabic, sign out (I).
- Labels on the button, the pass and the gate: "Simulated build: scripted engine, sample data" and "Made-up data only. No customer or personal details. Removed when the project closes." (R en.json:62; `down -v`, manager.ts:919). The app's own banner says it is sample data (R templates/next/src/app/[locale]/layout.tsx:28). The builder rewrites none of the app's pages.
- Only while that project's app runs, one project at a time (R journey-jobs.ts:179). Scripted builds only, enforced in code (4.6).

## 2. Constraints (R)
- The app answers only at http://app:3161, and only to containers on `front` (example-1-adapter.ts:44, :7-11): `check` through `askApp` (manager.ts:297-308, :897-913), the runner and the app camera. Nothing on the machine connects to it (NB:37; DN:153 point 5; DEC:127 point 6). The owner's 0.6c choice: "a proxy the builder runs is their only way out" (DEC:119).
- The app's sign-in trusts only APP_URL, http://app:3161 (templates/next/src/auth.ts:19-20). better-auth checks Origin (or Referer if Origin is missing) and Sec-Fetch-* (origin-check.mjs:100-152). A server action's Origin must equal X-Forwarded-Host or Host; an action with no Origin passes with a warning (next action-handler.js:424-455). Next.js fills X-Forwarded-Host from Host (base-server.js:601). The app's session cookie is HttpOnly, SameSite Lax, not Secure (MS:27).
- The builder listens on 127.0.0.1:4020 and runs as root (KG 135). Its cookie is SameSite Strict (app.ts:87), it uses csrf() (app.ts:114) and allows no script (app.ts:77-85). The approved browser may photograph "the scripted app in the project's runner container" (DEC:129). The runner's user is uid 1001 (KG 127).
- Not known: whether the phone's pane shows a reported port, at what origin, and whether it frames the page (Q:42; KG 131).

## 3. Options
- **Rejected:**
  - The app under 4020's origin through a reverse proxy. Its scripts would get the builder's origin and authority, and Next.js would need a basePath, which makes a different app from the one tested.
  - An app port on the machine: it breaks 0.6c.
  - APP_URL set to the phone's origin: that origin is not known in advance, and it changes the tested app.
- **(A) Chosen, subject to the owner's answer:** a builder preview front on 127.0.0.1:4030. It reaches the app only through `check` containers on `front`, as `askApp` does.
- **(B) The alternative put to the owner:** a click-through driven by the builder. The preview screen offers the app's actions. Each one is run by the app camera in the project's runner container and shown as a fresh screenshot. There is no new listener and nothing new leaves the sandbox, but it is not live.

## 4. Design (A)
**4.1 The chain** (I):
- phone → tunnel → 127.0.0.1:4030 → the *preview front* (an unprivileged child process) → a Unix *pump socket* → the interface process (bytes only, never parsed) → `docker compose run --rm --no-deps -T --name <n> check node -e <PIPE> app 3161` → the app.
- The machine opens no TCP connection to the app.

**4.2 Streams** (critique S1):
- `sandbox.appStream(sb)` in manager.ts, built as `askApp` is (R :897-905). It uses the `check` service unchanged: `front` only, the approved Node image, the hardening, user node, no mount (R :297-308). That service is already in ONE_OFF_PROFILES (:700) and is removed by `down` (:919).
- PIPE is a few lines of `node -e`: connect to the host and port given as arguments, pipe stdin and stdout both ways, exit when either side ends.
- The target is only `app:<port>`, taken from the sandbox's settings and checked with askApp's pattern (:898).
- Before the first stream, `frontOnlyProblem(config, "check")` is asked (R example-1-adapter.ts:163), reading the configuration as `cameraNetworkProblem` does (:187).
- The front keeps up to 6 streams alive and reuses them.
- **Fallback, only if M2 fails S1:** a `window` service that the builder execs into. It keeps the pids limit of 256 from HARDENING (R manager.ts:142) and runs `node -e` with no mount. It stays separate from the app because exec into a container the app controls has been an escape route (CVE-2019-5736, I).

**4.3 The preview front** (I):
- `src/web/preview-front.ts`, started with `fork` under a uid of its own: `BUILDER_PREVIEW_UID`, default 1990. That uid is refused if it is 0, 1000 or 1001 or is named in /etc/passwd. If the builder is not root, the front runs as the builder's own user, and this is recorded.
- Its environment holds only its port and the pump socket's path: no database URL, password digest, sessions or Docker.
- It listens on 127.0.0.1:`BUILDER_PREVIEW_PORT` (4030 for the owner's instance, 4041 for the automated run; checked free) for as long as the interface runs. With no session open, it answers "No live app now".
- The pump socket: the interface listens on it in a short folder it creates (at most 107 bytes, R forwarder.ts:65; `listenOnSocket` :62), then gives it to the front's uid with mode 600. The interface streams only while a live session is open.
- Messages over the fork channel have fixed JSON shapes, checked at both ends. To the front: pass, revoke, stop. From it: entered, refused, closed.

**4.4 Pass and session** (I):
- "Open the live app" and "Show" are POSTs on 4020, behind sign-in and csrf(). "Show" reveals the sample email and password (R example-1-sandbox.ts:69; templates/next/scripts/seed.ts:18-22). They never appear in a GET page or a log, and are masked in screenshots.
- The pass: 8 characters from 32 that cannot be confused (40 bits). It is single use, valid 2 minutes, one at a time, and bound to that builder session, that project and that app start. Only its hash reaches the front.
- Five wrong passes void it and lock the gate, with a lock-out that doubles. The counter is separate from 4020's.
- The gate refuses a POST whose Origin is "null", or that has no Origin and no `Sec-Fetch-Site: same-origin`. It stores only a serialised scheme://host[:port] as the preview's origin.
- It then sets `builder_preview` (32 random bytes, HttpOnly, SameSite=Strict, Path=/) together with `Clear-Site-Data: "cache", "storage"`, which is hygiene only.
- Only "enter" and "leave" live under /__builder/. The path is matched after decoding and removing dot segments; %2F, %5F and ".." forms are refused.
- Every `builder_preview` value is read, and any valid one is accepted.
- A session ends on leave, app stop, project close, builder sign-out or expiry, the checklist (4.7), a halt or a lost lock (R journey.ts:752; main.ts:155), or after 8 hours.
- Opening is a `live` job, so no other journey job runs beside it.

**4.5 Requests** (I):
- **Refused before any stream opens:**
  - any method with `Sec-Fetch-Site` cross-site or same-site;
  - a POST with neither `Sec-Fetch-Site: same-origin` nor an Origin equal to the stored one (if neither header ever comes, every POST is refused);
  - methods other than GET, HEAD and POST;
  - a body over 1 MB, or headers over 16 KB.
- **Forwarded headers, an allowlist:** Accept*, Content-Type, Content-Length, User-Agent, Cache-Control, Pragma, If-*, Range, Sec-Fetch-*, RSC, Next-Action, Next-Router-State-Tree, Next-Router-Prefetch, Next-Router-Segment-Prefetch, Next-Url.
- **Mapped:** Host becomes `app:3161` and Origin becomes `http://app:3161`. Referer has its origin replaced if that is the stored origin; otherwise it is dropped.
- **Cookies:** only those carrying this session's prefix (`bp<8 hex>_`) are sent, with the prefix removed.

**4.6 Responses** (I):
- Only the front reads headers. Bodies are streamed unread and never decompressed, and app header values are never logged.
- **Set-Cookie** goes through a strict scanner. It is dropped if it has a Domain, a `__Host-` or `__Secure-` name or a `builder_` name, or cannot be read. Otherwise it is renamed with the session prefix.
- **Location** is kept if it starts with exactly one "/". If it starts with `http://app:3161/`, it is cut to its path. Anything else gets the front's own page: "The app tried to send you to another site".
- **Dropped:** Refresh, Link, Report-To, Reporting-Endpoints, NEL, Content-Security-Policy(-Report-Only), Clear-Site-Data, Strict-Transport-Security, Access-Control-*, Alt-Svc, Service-Worker-Allowed, Content-Location.
- **Refused:** `Content-Disposition: attachment`, and content types other than html, css, javascript, json, text/x-component, image/*, font/* and text/plain.
- **Set by the front:**
  - `Cache-Control: private, no-store`.
  - A content-security-policy: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'; worker-src 'none'; object-src 'none'; base-uri 'self'`. Plus `sandbox allow-scripts allow-forms allow-same-origin` if M3 shows the app works with it.
  - Permissions-Policy denying camera, microphone, geolocation, payment, usb, serial and bluetooth.
  - COOP same-origin, Referrer-Policy same-origin, nosniff.
- **Time limits:** the app's headers within 30 s, and 60 s at most with nothing sent.
- **Scripted only:** the interface refuses a live session unless the project's step events show only the scripted engine's fixed change sets. The journey creates no other engine (J1 §6).

**4.7 Acceptance separation** (I): "Run the checklist" first ends any open live session (`live_closed`, reason "checklist"). The run's record and its screen say that the app was used live and its data changed.

**4.8 The live camera** (I):
- The project's own `acceptance` service, started through `runStreaming` as the app camera is (R example-1-adapter.ts:216-219), plus one read-only mount: the camera socket folder at /psock.
- It is the approved runner image, uid 1001, on `front` only (`cameraNetworkProblem`), with no video and no trace.
- Its script forwards 127.0.0.1:4030 inside the container to /psock/p.sock. On the machine, the interface's byte forwarder (`createForwarder`, forwarder.ts:34) passes that socket to the front's port. The folder belongs to uid 1001 with mode 750; the socket is given to uid 1001 with mode 600.
- The browser loads only 127.0.0.1:4030. Other addresses are refused inside the browser and counted.
- This stays within DEC:129 and DN:153 point 5.

**4.9 Records and texts** (I):
- Events: `journey.preview.live_opened` (no pass recorded), `.live_entered` (whether Sec-Fetch-Site came; no origin) and `.live_closed` (with the reason).
- `journey.app.started` gets `live_view: true` (R journey-jobs.ts:193).
- Rewritten in English and Arabic: preview.app_running and preview.not_live (R en.json:209, :212). Also rewritten: `APP_REACHED_FROM` (journey-jobs.ts:61), the adapter's header (example-1-adapter.ts:7-11) and gap 136.

## 5. What changes in 0.6c, and new gaps
- **Unchanged:** the three networks, the door and every list. The app has no port on the machine, and the machine opens no TCP connection to it (I).
- **Changed, needing the owner** (DEC:119; DN:153 point 5; DEC:127 point 6):
  - The builder exchanges HTTP with the app through `check` containers, and an unprivileged process on the machine parses it.
  - During a live session, the app's page code runs in the owner's browser, which has his phone's internet. That is a way out besides the door.
- **Gaps from 148** (I):
  - **148.** The app's page code runs in the owner's browser. The content-security-policy keeps fetches, forms, frames, workers and images to the preview, but navigation, new windows, meta refresh and WebRTC stay open. Scripted builds only, enforced. An engineer reads this before any model-written app is previewed.
  - **149.** The front parses the app's headers with the machine's network: loopback services, the session proxy and 4020's sign-in. It holds no database, digest, sessions or Docker. Whether to move it into a container with no network is that engineer's call.
  - **150.** The app's own origin checks see only the mapped origin; the front's check is the real one.
  - **151.** Whoever sees a pass on screen within its 2 minutes can use it once.
  - **152.** The preview may be a secure context and `http://app` is not (KG 118).
  - **153.** The app's script, or a stranger if the address is public (M1 ix), can lock the gate. This is a denial of service only.
  - **154.** The live camera's runner container gets a socket to the front beside its own route to the app. That it loads only 127.0.0.1:4030 is enforced inside the browser.
  - **155.** Clear-Site-Data is hygiene only: it works on secure origins only, and WebKit is not measured.
  - **156.** The owner's use changes the data the checklist then checks. This is recorded on the run.
  - **157.** Whatever M1 shows that the go-on rows accept: a shared host, a same-site pane, an unreported port that answers, a tunnel that caches.

## 6. Measure first
- **M1. The phone (first; needs the owner).**
  - Script-free builder probe pages run on 4032 and 4033 and are reported as "probe-a" and "probe-b". Port 4020 is not touched.
  - Recorded:
    - (i) Host, and the Origin of a POST to itself;
    - (ii) a link and a form POST from a to b, with the Sec-Fetch-Site that b sees;
    - (iii) each probe's own Lax and Strict cookie round trip;
    - (iv) Sec-Fetch-Dest;
    - (v) every request header name and cookie name, values masked;
    - (vi) whether an unreported port, 4034, answers at the matching address (a link the probe builds from its own Host);
    - (vii) an answer marked `public, max-age=60` with a counter;
    - (viii) the User-Agent;
    - (ix) if he can, whether the address opens when signed out.
  - Decision:
    - same origin: stop;
    - framed cross-site (the Lax cookie does not come back, or Dest is iframe with Site cross-site): stop, and use (B);
    - same host on another port, or same-site: go on, with 4.5's cookie prefix, every-value cookie reads on 4020 too, and gap 157;
    - cross-site: go on.
- **M2. Streams** (example 1 in a throwaway sandbox, under the lock):
  - First byte and whole page, cold and warm.
  - A 2 MB answer, and a POST body holding all 256 byte values (Ctrl-P and Ctrl-Q included), each checked byte for byte by SHA-256.
  - Six streams at once.
  - A client leaving mid-answer, an app that never closes, and the builder killed (SIGKILL). After each, no `check` container, `docker compose` client or pipe is left (`docker ps`, `ps`).
  - `compose run` against `exec`. S1 stays unless it fails a check.
- **M3. The real app through the whole chain, in the live camera:**
  - The pass, sign-in, My requests, add a request, Arabic and sign-out.
  - Every status, Location and Set-Cookie name is logged. Every body is searched for "app:3161". Content-security-policy violations are counted; none are expected.
  - Each mapping is turned off in turn (Host, Origin, Referer, Sec-Fetch-*, the cookie prefix). This shows which ones the app needs, and that its own check then refuses.
  - The content-security-policy `sandbox` value is tried.
  - Chromium only: fetches to app:3161, 127.0.0.1:4020 and an outside name are blocked by the policy; a service worker is refused; WebRTC is recorded as not blocked; storage is gone after a new entry.
- **M5. 0.6c's probe:**
  - `check` streams reach only app:3161 and Docker's name server.
  - A container with the camera's socket mount reaches only the front.
  - Group M runs with 4041 already listening (KG 128 point 3).
  - Two deliberate misconfigurations (the stream container also on `out`; on the machine's network) must each fail the comparison.
- **M6. The front process:**
  - Its uid, the names in its environment, and its open files.
  - As its uid, each of these is refused: the Docker socket, the data folder, the door sockets and PostgreSQL's socket.
  - The loopback ports it reaches are listed (gap 149).

## 7. The critique: taken, changed, not taken
- **Taken:**
  - Items 2 to 7 and 9 to 16 as written.
  - S1 as the stream, and D as option (B).
  - O1 (a), the app's own sign-in, as Claude Code's choice for the owner to overrule; no question is needed.
- **Changed:**
  - Item 1: the live camera is the project's own runner container on `front` (DN:153 point 5) with one read-only socket mount, not a container with no network. Its browser then stays inside DEC:129.
  - Item 2: the front is an unprivileged child process for now, not yet a container with no network (gap 149).
  - Item 8: not needed. Every browser use stays in the runner container, and M4's checks run on the scripted app inside M3.
- **Not taken:** item 13's "listen only while the app runs". A front that answers "No live app now" gives the reported entry a plain page instead of an error, and its port is already set per instance.

## 8. Checked and assumed
- **Checked (R):**
  - the lines cited, at `ee36b3c`;
  - next's action-handler.js:424-455 and base-server.js:601, and better-auth's origin-check.mjs, at the template's versions;
  - that the builder's folders are mode 755, so the front's uid can read them (`stat`).
- **Assumed (I), measured in section 6:**
  - that Docker carries stdin byte for byte with `-T` and leaves no client process after a kill;
  - Chromium's behaviour (WebKit's is not measured);
  - the tunnel and the pane;
  - that 40 bits with a lock-out is enough for a pass shown on one screen.

## Build brief
- **Order:**
  1. The owner's answer, and M1.
  2. Branch `claude/j3-live-preview` from `claude/stage-1`.
  3. M2 and M6.
  4. Build.
  5. M3 and M5.
  6. Tests, controls, the automated run.
  7. One adversarial review as isolation work, by reviewers who did not write it (R BP:47).
  - Stop and report if M1 says stop, or if M2 fails both S1 and the window.
- **Create:**
  - `src/web/preview-rules.ts`: pure functions for the allowlist and mapping, the cookie scanner and prefix, Location, content types, the header lists and the path check.
  - `src/web/preview-front.ts`: the child process (listener, gate, keep-alive agent over the pump socket).
  - `src/web/preview.ts`: the parent side (fork with the uid, passes and revokes, pump socket, camera socket forwarder, events).
  - `camera/live-shots.mjs`, `scripts/probe-phone.ts` (M1), `scripts/demo-journey-j3.ts`, and the English and Arabic messages.
- **Change:**
  - manager.ts gains `appStream` beside `askApp`.
  - journey-jobs.ts gains the `live` job, "Show", the checklist closing a live session first, and `live_view: true`.
  - example-1-adapter.ts gains `streamNetworkProblem` and `liveCamera` (as `appCamera`, :216-219, plus `<camera folder>:/psock:ro`).
  - app.ts and pages.ts gain the button, pass and Show screens.
  - main.ts starts the front with the interface and stops it in `stopAfterLockLost` (:155).
- **Reuse:**
  - manager.ts: `askApp` :897-905; `check` :297; ONE_OFF_PROFILES :700; `destroy` :919; `runStreaming` volumes :744, :786-787; `socketOwner` :170, as the pattern for uid 1001.
  - forwarder.ts: `createForwarder` :34; `listenOnSocket` :62.
  - `frontOnlyProblem` example-1-adapter.ts:163; `cameraImageProblem` journey-jobs.ts:184; `halt` journey.ts:752; `startJob` as at journey-jobs.ts:175.
- **Tests without containers:**
  - `test/preview-rules.test.ts`: every rule of 4.5 and 4.6; each dropped or refused header; %2F, %5F and ".." paths; a null origin; cross-site and same-site; the prefix and the Domain drop.
  - `test/preview.test.ts`, with the forked front and a stand-in upstream on the pump socket:
    - a visitor without a session gets only the gate;
    - a pass works once, and is refused after 2 minutes, after the app stops, after the project closes, after builder sign-out and after 8 hours;
    - the lock-out is separate from 4020's;
    - a refused POST opens no stream;
    - the size and time limits; nothing listens except on 127.0.0.1;
    - the child's uid and environment; bad fork messages are ignored;
    - a halt or a lost lock closes every stream.
  - `test/sandbox.test.ts`: `appStream`'s exact docker arguments (no --privileged, --user, --env or --volume; only app:<port>).
  - `test/journey.test.ts`: refused with a non-scripted step record or with no app running; the checklist closes the session and records it; Show only by POST; the events.
- **Controls**, as 0.6c's: each safeguard removed in turn, its test shown failing, then restored. The safeguards:
  - the pass's single use and expiry, and the lock-out;
  - the cross-site refusal, each mapping and the allowlist;
  - the cookie scanner and prefix, and the Location check;
  - the content-security-policy and Permissions-Policy, and the content-type refusal;
  - the scripted-only check, `check` on `front` alone, and the uid drop.
- **Live** (under `flock <scratchpad>/live-tests.lock` from builder/, with BUILDER_BROWSER_CACHE set, and its own database and TMPDIR, both removed after):
  - `test/preview-live.test.ts`: M3's click-through, plus the refusals: no pass; a crafted cross-site POST to 4041, which opens no stream; after the app stops.
  - 0.6c's isolation live test, with the camera mount in its lists.
  - Each run first checks that 127.0.0.1:13161 and 4041 are free, and waits otherwise. It never stops the owner's project or touches 4020.
- **Automated run**, `scripts/demo-journey-j3.ts`:
  - J1's builder camera, on 4021, presses "Open the live app" and puts the pass in a file with mode 0400.
  - The live camera (the approved browser, in the runner container, no video, no trace) photographs the gate, sign-in, My requests, new request, the list, Arabic and the 390 px view into `evidence/<date>-journey-j3/screens/`.
  - The pass and the password are masked. Everything is removed after.
- **Evidence**, in `evidence/<date>-journey-j3/`:
  - `live-preview.md`: what the owner can now do, what is Real and what is Simulated, each check with its file, and what was checked and what is assumed.
  - `m1/` (his screenshots) to `m6/`.
  - `run-typecheck.txt`, `run-tests-full.txt`, `run-licences.txt`, `run-demo.txt`, `events.json`.
- **Records:**
  - DEC: the owner's answer; Claude Code's choices (S1, the child process, O1 (a), the ports).
  - DN:153 point 5 and DEC:127 point 6, amended only as he answers.
  - A BP row for J3; KG 148 to 157, and gap 136 updated; ST; docs/arabic-wording-list.md.
  - `npm run typecheck`, `npm test` and `npm run check:licences` before every push. No new dependency and no new image.
- **Needs him, not a choice:**
  - The M1 looks.
  - Once J3 merges, a time to restart his 4020 interface. Its start removes his projects' running sandboxes (R journey.ts:843; KG 139).