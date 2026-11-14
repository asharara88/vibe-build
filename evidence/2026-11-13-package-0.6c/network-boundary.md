# Package 0.6c: the development profile's network boundary, as built and run

| | |
| --- | --- |
| Date | 13 November 2026 |
| Package | 0.6c, the development profile's network boundary (build plan section 7.2; known gap 60), to the owner's choice (a) of 13 Nov 2026, "Private networks" (`docs/DECISIONS.md`) |
| Done means | 0.6a's probe, run in each project container that will run code a model wrote (the app and tools containers, package 3.1's runner, package 2.2's engine) on the development profile, shows each reaching only what design note 2.5 allows, with every attempt and result listed; a deliberately misconfigured container is shown failing the check (build plan section 7.2) |
| Run on | This cloud session's machine (Docker 29.9.2, Docker Compose 5.6.1, Node 22.23.4), development profile; the code at commit `d6db9bf` (branch `claude/pkg-0.6c-network-boundary`). Every attempt was made from inside a container; nothing a model wrote was run; no model was called (the gateway was a stand-in); made-up data only |
| Result | Each of the six project containers matched its expected list exactly, attempt by attempt, who answered included (`demo/run-2/`). The two comparison containers reached the harness's own listener, so the addresses and ports tried were right. Both deliberate misconfigurations failed the check. The whole suite (431 tests, live tests included), the typecheck and the licence check passed; each new safeguard's test failed with the safeguard removed (`checks/`) |
| State | **Built, not tested.** One adversarial review read it and found nothing blocking; its notes are answered in "After the review" at the end. No engineer has read it (question 7). Tested only when its pull request merges with no blocking finding (build plan section 3, step 9) |

**Correction, 14 November 2026** (by Claude Code; the text above and the tables below are left as first written). The "Result" row above, and three tables below ("What each container reached, and did not"; "What each container reported of itself"; and the isolation run's table in the last section), name the columns "app", "tools" and "runner" and do not say what those columns ran in. They ran in **stand-in images** made from the approved Node image, the app's and the tools' given the real images' names, the runner's under a name of its own (`<project>-runner-standin`), which that project's Compose file named in place of the real runner image: a one-line server for the app, the bare image for tools, the bare image with the runner's user for the runner (`builder/scripts/isolation-harness.ts`, `buildStandIns`). *(This sentence was corrected the same day, after the review of 14 Nov 2026: as first written it said all three were "given the real images' names".)* The probe was not run inside the real app, tools or runner containers. That is narrower than "Done means" asks ("run in each of those containers"). This file said so only further down, under "What this does not show". The "engine" column was the engine service placed as package 2.2's option would place it, in the approved Node image: a placement, not package 2.2's engine, which does not exist. What these runs do show is where the sandbox manager's Compose file places each container. On 14 Nov 2026 the probe was run inside the real app, tools and runner containers of a real example-1 project: `evidence/2026-11-14-package-0.6c-real-containers/network-boundary-real-containers.md`. **This correction does not turn the unmet item into a met one:** the results of 13 Nov stay what they were, results in stand-in images, and the item of "Done means" that names package 2.2's engine is still open.

Measured before it was built: `measurements.md` in this folder (the design's assumptions, items 1 to 9). This file is what was built on those measurements and what its runs showed.

## In plain words

Before this package, on the development profile, the app, tools, database and runner containers shared the machine's own network: they could reach every service on the machine, the builder's own database and the cloud session's proxy among them (known gap 60, measured by package 0.6a).

Now each project's containers sit on three private Docker networks with no way out and no address of the machine on them. The only way out is a small "door" container, which hands each connection, through a socket file in the project's own folder, to the builder's own proxy on the machine. That proxy lets through only the hosts on the project's list (here the package registry), and only through the cloud session's proxy; it refuses to start without it. The model gateway is reached at a fixed port of the door. Nothing the builder runs on the machine connects to the app or its database any more: those checks and the screenshots run in containers on the project's networks.

What this does not do is listed under "What is still not isolated" below; each item is a known gap.

## What was built

Words used: **bridge**, a private network Docker makes on the machine; **internal**, Docker's setting for a bridge with no way out; **"isolated" mode**, Docker's option that also gives the machine no address on that bridge; **door**, a small forwarder container inside the project's network that hands each connection to the builder's proxy through a file-like socket (a "Unix socket") on the machine.

| Part | What it does | Where |
| --- | --- | --- |
| Three private networks per project | `data` (database, app, tools), `front` (app, acceptance runner, the short-lived `check` container), `out` (the door; package 2.2's engine when it is given a network). Each is `internal`, in the "isolated" mode, with IPv6 off and no gateway address set. Both profiles | `builder/src/sandbox/manager.ts:153` (`PROJECT_NETWORK`), services from `:259` to `:357`, the document from `:367` |
| No project container on the machine's network | Only `egress-host`, the builder's own machine side, is on it | `manager.ts:469` |
| The database by name only | `postgres://app:…@db:5432/app`; no port on the machine; health check over TCP (gap 69) | `manager.ts:381`, `:398` |
| The door | The `egress` service on `out`, as uid 1000, read-only root, the socket folder read-only; forwards 3128 and 4010 to two sockets | `manager.ts:460`; `builder/src/sandbox/door-main.ts`; `builder/src/sandbox/forwarder.ts:34` |
| The machine side | The `egress-host` service: the egress proxy on `/sock/egress.sock`, the gateway forwarder on `/sock/gateway.sock` (loopback targets only), and a second proxy for the image build on `127.0.0.1:<port>` with the registry only; refuses to start without a valid session proxy | `manager.ts:469`; `builder/src/sandbox/egress-machine-main.ts:28`; `forwarder.ts:62` (socket mode 600), `:83` (loopback only) |
| The socket folder | `<project>/egress-sockets`, mode 750, owned by uid 1000 when the builder runs as root | `manager.ts:599` |
| The egress proxy fails closed | An empty, missing, malformed or (on this profile) "direct" way out is refused; a tunnel that fails before it opens gets the proxy's own 502, or 504 after 30 s | `builder/src/sandbox/egress-proxy.ts:48`, `:157`, `:165` |
| The gateway at a fixed door port | `ANTHROPIC_BASE_URL=http://egress:4010`, `NO_PROXY=egress` for package 2.2's engine option (`engine.network: "egress"`), used by no engine yet | `manager.ts:259` |
| The image build | `npm ci --ignore-scripts` through the build's loopback port; the guard check and `next build` under `RUN --network=none`; no certificate; no `# syntax=` line; `vendor/` protected | `templates/next/Dockerfile:17`, `:22`; `manager.ts:618`, `:860`; `builder/src/engine/scripted.ts:61` |
| Nothing on the machine connects to the app | The "right app answers" check asks from a `check` container on `front`; before the app starts, the builder checks from there that nothing answers at its address; the evidence browser scripts run in the runner's container on `front`, reading the sample password from a file | `manager.ts:895` (`askApp`); `builder/src/acceptance/runner.ts:86`; `builder/scripts/example-1-sandbox.ts:141`; `builder/scripts/browser-in-project.ts:18` |
| The probe and its comparison | Group M: every machine address, read on the machine, crossed with every listening port; group P: the project's services by name; W1: the gateway at the door; routes, forwarding and IPv6 state printed. Each container's attempts compared exactly with its expected list, who answered included; positive controls for the comparison containers | `builder/scripts/isolation-probe.mjs:344`, `:372`, `:697`; `builder/src/sandbox/isolation.ts:270`, `:343`, `:390`, `:428`; `builder/scripts/isolation-harness.ts` |

## What each container reached, and did not

The demonstration, `builder/scripts/demo-isolation.ts`, run once at commit `d6db9bf` under the lock shared with other sessions (`demo/run-2/demo-isolation.txt`; started 13:12 UTC, 305 s). Its files: each container's probe lines (`probe-*.jsonl`), its comparison with its list, row by row, with what was expected and what came (`comparison-*.md`), every attempt in one table, one column per container (`attempts-table.md`), the probe's settings (`probe-settings.json`), and the two logs.

**What the probe tried, from every container (53 attempts each):** the internet directly (A, B: names and addresses, ports 80 and 443, the cloud's metadata address); the container's own loopback (C) and any port listening inside it (X); **every address the machine holds** (`172.17.0.1` and `192.0.2.2`, read on the machine from the kernel's tables) **on every port listening on the machine** (seven, read from `/proc/net/tcp`: 2024 and the canary on every address; the session's proxy, the builder's database, the stand-in gateway, the build's proxy port, and one more whose owner was not identified, on 127.0.0.1 only) (M); name lookups, outside and the project's own (D); the door's proxy (E); the gateway at the door's port (W); the project's services by name (P); and the cloud session's proxy, bypassing ours (F).

*Read with the correction of 14 Nov 2026 at the top of this file: the app, tools and runner rows ran in stand-in images, and the engine row is a placement in the approved Node image.*

| Container | Networks | Attempts | Got an answer (each on its list) | Compared with its list |
| --- | --- | --- | --- | --- |
| app | `data`, `front` | 53 | X41373 connected; D3 found 1 address; Pdb:5432 connected; Papp:3171 connected | PASS: 53 rows PASS, 0 FAIL |
| tools | `data` | 53 | X44469 connected; D3 found 1 address; Pdb:5432 connected; Papp:3171 connected | PASS: 53 rows PASS, 0 FAIL |
| database (the probe in its network namespace) | `data` | 53 | C5 connected; C7 connected; X35605 connected; D3 found 1 address; Pdb:5432 connected; Papp:3171 connected | PASS: 53 rows PASS, 0 FAIL |
| runner | `front` | 53 | X33845 connected; Papp:3171 connected | PASS: 53 rows PASS, 0 FAIL |
| engine, as package 2.2 would place it | `out` | 53 | X33281 connected; E1 proxy answered 200; E2 HTTP 200 (the registry, inside the tunnel); E3 proxy answered 403 ("egress refused: example.com is not an allowed host"); E4 HTTP 405 (the cloud session's proxy: it takes tunnels only); E5 HTTP 403 ("egress refused: example.com is not an allowed host"); W1 HTTP 200 (the stand-in gateway); Pegress:3128 connected; Pegress:4010 connected | PASS: 53 rows PASS, 0 FAIL |
| the door (a one-off container of its service) | `out` | 53 | X42401 connected; E1 proxy answered 200; E2 HTTP 200 (the registry, inside the tunnel); E3 proxy answered 403 ("egress refused: example.com is not an allowed host"); E4 HTTP 405 (the cloud session's proxy: it takes tunnels only); E5 HTTP 403 ("egress refused: example.com is not an allowed host"); W1 HTTP 200 (the stand-in gateway); Pegress:3128 connected; Pegress:4010 connected | PASS: 53 rows PASS, 0 FAIL |

Every other attempt, in every project container, got no answer. Nothing reached the machine at any of its addresses, nothing outside, no outside name, and not the cloud session's proxy directly. The "X" port in each row is Docker's own name server inside that container.

What each container reported of itself:

*Read with the correction of 14 Nov 2026 at the top of this file: the app, tools and runner rows ran in stand-in images, and the engine row is a placement in the approved Node image.*

| Container | Routes (/proc/net/route) | A way to any address | Proxy settings (names) | Session certificate inside | IPv6 | User id |
| --- | --- | --- | --- | --- | --- | --- |
| app | to 172.18.0.0/16 via 0.0.0.0 on eth0; to 172.19.0.0/16 via 0.0.0.0 on eth1 | no | none | none | absent: this kernel has no IPv6 here | 1000 |
| tools | to 172.19.0.0/16 via 0.0.0.0 on eth0 | no | none | none | absent: this kernel has no IPv6 here | 0 |
| database (the probe in its network namespace) | to 172.19.0.0/16 via 0.0.0.0 on eth0 | no | none | none | absent: this kernel has no IPv6 here | 1000 |
| runner | to 172.18.0.0/16 via 0.0.0.0 on eth0 | no | none | none | absent: this kernel has no IPv6 here | 1001 |
| engine, as package 2.2 would place it | to 172.20.0.0/16 via 0.0.0.0 on eth0 | no | HTTPS_PROXY, HTTP_PROXY, NO_PROXY | none | absent: this kernel has no IPv6 here | 1000 |
| the door (a one-off container of its service) | to 172.20.0.0/16 via 0.0.0.0 on eth0 | no | none | none | absent: this kernel has no IPv6 here | 1000 |
| comparison: the machine's own network | to 0.0.0.0/0 via 192.0.2.1 on eth0; to 172.17.0.0/16 via 0.0.0.0 on docker0; to 192.0.2.0/24 via 0.0.0.0 on eth0 | yes | none | none | absent: this kernel has no IPv6 here | 1000 |
| comparison: Docker's default network | to 0.0.0.0/0 via 172.17.0.1 on eth0; to 172.17.0.0/16 via 0.0.0.0 on eth0 | yes | none | none | absent: this kernel has no IPv6 here | 1000 |

The database's row is the probe container sharing the database container's network (its image has no Node), so its user id is the probe's. The tools stand-in runs as root with every capability dropped; the real tools image's user is set by the template's Dockerfile. Packet forwarding read 1 in every container (the kernel's default); see "What is still not isolated".

## The lists each container is compared with

Design note 2.5, as amended on 13 Nov 2026 for this package (`docs/design/stage-1.md`), gives each container what it may reach. The harness writes those lists as code (`builder/src/sandbox/isolation.ts:390`, `expectedOnDevelopment`). Every attempt not on a container's list must get **no answer**: refused, timed out, name not found, no name server, or network unreachable. An "error" the probe cannot name fails too.

- **Every container:** Docker's own name server inside the container (127.0.0.11, an X attempt), which answers only for the project's own names.
- **On `data`** (app, tools, database): the name `db` is found; the database and the app answer by name. The tools and database containers reach the app because the app listens on every address of its own container (known gap 119).
- **Database:** also itself, at its own loopback address (C5, C7).
- **Runner, on `front` only:** the app by name.
- **On `out`** (the door, and the engine as package 2.2 would place it): through the door's proxy, a tunnel to the registry (E1) and an answer from the registry inside it (E2); the proxy's own refusal of example.com, in its own words (E3, E5); a plain-HTTP request to an allowed host passed on to the session's proxy, which answers (E4); the stand-in gateway at the door's port 4010 (W1); the door's two ports by name.

"Who answered" is compared, not only that something did: E3 and E5 must carry the egress proxy's own words, E4 must not, and W1 must carry the stand-in gateway's name.

## The positive controls

The same probe settings, run from two containers that are not project containers, must reach the harness's own listener (the "canary", on every address of the machine, port chosen at the run), so that a wrong address or port cannot pass as "isolated":
- from the machine's own network: the canary at every machine address;
- from Docker's default network: the canary at that network's address on the machine.

Both did (table above, and `demo/run-2/comparison-control-machine.md`, `comparison-control-bridge.md`). Their other attempts are listed but not compared: they show what an ordinary container here reaches (the internet through the session's filter, the machine's open port 2024, outside names).

## The two deliberate misconfigurations

Each is the sandbox manager's own Compose file with one change, made before anything starts. Each must **fail** its comparison, and did:

1. **The app also on an ordinary bridge (a way out).** The app's probe got answers from outside (A1, A2, A5, B1 to B4), outside names (D1, D5), and the machine's open port 2024 and the canary at every machine address (M rows). It now has a default route. 15 rows failed, each of them one of those; every other row passed.
2. **`data` made internal without the "isolated" mode.** The tools container's probe reached the machine's port 2024 and the canary at the address the machine holds on that network (two M rows), and nothing else. That is the reason the "isolated" mode is set on every project network: without it, every service listening on all of the machine's addresses is in reach.

Files: `demo/run-2/comparison-misconfiguration-1.md`, `comparison-misconfiguration-2.md`, and the probes' own lines.

## The machine side's and the door's logs

`demo/run-2/egress-host.log`: the egress proxy listening on its socket with the project's list (`registry.npmjs.org`) and the session proxy as its only way out (named by host and port only), the gateway forwarder listening on its socket, the build's proxy on one loopback port; then one line per decision: the registry allowed, example.com refused, for each of the two containers on `out`. `demo/run-2/door.log`: every connection the door passed on, with the address it came from on `out`.

*Correction, 14 November 2026:* the two files named above, `demo/run-2/egress-host.log` and `demo/run-2/door.log`, are not in the repository and never were. The repository's `.gitignore` leaves out every file whose name ends in `.log`, so they were written by the run and not committed; no copy was kept. What this section says of them cannot be checked against a kept file. Since 14 Nov the demonstration writes them as `egress-host-log.txt` and `door-log.txt`, which are kept (`evidence/2026-11-14-package-0.6c-real-containers/demo/`).

## The other live runs

- **The acceptance runner at `http://app:<port>`** (`builder/test/acceptance-live.test.ts`, in each full suite run): example 1 built by the scripted engine on the development profile, with the new networks and the image build (install scripts off, `next build` with no network); the "right app answers" check from the `check` container; the runner on `front` signed in and its stand-in test passed (run A); with the app stopped, the run was refused before it started (run C); and the deliberately broken copy failed at its step (run D). It is the template's real image, not a stand-in. With install scripts off, none was needed for the build, the start, sign-in and the stand-in test; the template's other paths were not exercised (wording corrected after the review).
- **The screenshots and the role guard's checks in the runner's container** (`demo/template/demo-template.txt`, run once on the working tree that became `56f2a79`): the browser ran in the runner's container on the project's `front` network, not on the machine; seven screenshots, and 26 role-guard checks, all passed (`demo/template/*.png`, `demo/template/guard/*.png`).
- **The builder's check that the right app answers** (live test "the builder's check that the right app answers (package 3.1) asks from a container on `front`"): it got the app; the machine's own process could not even look the name `app` up.

## Tests and controls

New or changed tests (`builder/test/`):
- `sandbox.test.ts`: every project network internal, isolated, IPv6 off, no gateway address, both profiles; each service's networks; tools on `data` only; no published port; every capability dropped; only `egress-host` on the machine's network; the database by name and its TCP health check; no certificate anywhere; the door and the machine side (environment, mounts, users, health checks); the session proxy by host and port only; 2.2's engine option on `out` only; refusals without the session proxy or with a gateway off the loopback address; the socket folder's mode and owner; the template's image build (install scripts off, `--network=none`, no certificate, no `# syntax=`); `askApp`'s form; Docker Compose accepting the whole file; live: the door lets the registry through and refuses example.com, from a container on `out`.
- `door.test.ts` (new): the egress proxy's way out fails closed (empty, missing, malformed, "direct" refused; 502 and 504 of its own; the machine side exits with code 2, saying why); the door's routes and the gateway's target checked; sockets mode 600; end to end over a loopback port, the door's forwarder, a socket, the egress proxy and a made-up upstream.
- `isolation.test.ts`: the probe's new groups and readings; the exact comparison; the positive controls; live: every project container compared with its list, the right-app check, the positive controls, both misconfigurations, and nothing left.
- `acceptance.test.ts`, `acceptance-live.test.ts`, `scripted-engine.test.ts`: the runner on `front`; `http://app:<port>`; `vendor/` protected; no certificate copied into the workspace.

**Controls** (`checks/controls-2.txt`, on a scratch copy of commit `d6db9bf` made with `git archive`, under the shared lock): each new safeguard removed in turn, its test run (expected: fail), the file restored and the test run again (expected: pass). All 33 failed with their safeguard removed, and all 33 passed again once it was restored: C1 the isolated gateway mode on every project network; C2 internal: true on every project network; C3 IPv6 off on every project network; C4 the tools container on the database's network only; C5 the runner on the front network only; C6 no project container on the machine's network (the app given network_mode host); C7 the database's health check over TCP (gap 69); C8 every capability dropped; C9 an empty upstream refused (the proxy would go out directly); C10 502 when the upstream closes before it answers; C11 504 when the upstream says nothing within the limit; C12 the machine side refuses "direct"; C13 the gateway forwarder only to a loopback address; C14 each socket mode 600; C15 a socket path too long refused; C16 the door's routes only to sockets under /sock/; C17 vendor/ among the protected paths; C18 install scripts off in the image build; C19 no network for the guard check and next build; C20 no certificate for the machine side; C21 the session proxy given by host and port only; C22 the build's npm through the machine side's loopback port, no certificate; C23 every attempt not on the list must get no answer; C24 who answered compared, not only that something did; C25 the positive control's address matched exactly; C26 askApp takes only http://<service>:<port>/<path>; C27 package 2.2's engine option on `out` only; C28 the development profile's gateway only on the loopback address; C29 up refuses the check service; C30 the check container on the front network only; C31 the door on the out network only; C32 no port of the database published on the machine; C33 the probe's group M: every machine address crossed with every listening port.

The first run of the controls (`checks/controls-1.txt`, on `56f2a79`) found one safeguard whose test did **not** fail when it was removed: C25, the positive control's address and port matched exactly. The test had no case of an answer on another port. It was given one (commit `d6db9bf`), and C25 now fails as it should. That first run was also made without the shared lock, and two of its controls (C26, C29, which remove a refusal) let their tests start a `check` container and its network, named after the test's own project (`builder_p_test`); they were seen in the demonstration's list of Docker objects afterwards (`demo/run-1/docker-objects-after.txt`) and removed by hand. The controls script now removes whatever a control's test leaves, and says so in its output.

Not controlled by removal: the live tests' own safeguards (the networks a real container gets, the right-app check from `front`), which only a live run shows; they are shown by the live tests and the demonstration, not by a removal.

## The checks

| Check | Run on | Result | File |
| --- | --- | --- | --- |
| `npm run typecheck` | working tree that became `56f2a79`; again for `d6db9bf` | passed (exit 0) | `checks/typecheck.txt`, `checks/typecheck-3.txt` |
| The whole suite, live tests included, under the shared lock | first run, working tree before the commits | **failed**: 15 tests of the scripted engine's live test, whose set-up gave the development profile no build port and expected the certificate to be copied | `checks/tests-full-1.txt` |
| The same | second run, after that test was corrected; the working tree that became `56f2a79` (files' fingerprints in `tests-full-2-files.txt`, the same as committed) | passed: 16 files, 431 tests, none skipped | `checks/tests-full-2.txt` |
| The same | third run, the working tree that became `d6db9bf` | passed: 16 files, 431 tests, none skipped | `checks/tests-full-3.txt` |
| `npm run check:licences` | both | passed; no package dependency added | `checks/licences.txt`, `checks/licences-3.txt` |
| Each intermediate commit's typecheck | `a58c67b`, `513401a`, on scratch copies | passed | (run in this session; output not kept beyond "exit 0") |

## What is still not isolated

Each is a known gap (`docs/KNOWN-GAPS.md`):
- **118**: a page that needs a secure context fails in acceptance at `http://app` (measured: not a secure context, also with Chromium's flag).
- **119**: the tools and database containers can reach the app's port over `data`.
- **120**: the door's machine side runs on the machine's network, with a direct route out; only its code keeps it to the session's proxy.
- **121**: the image build's install step runs on the machine's network (only npm's traffic goes through the build's proxy); the build's loopback port is open to the machine while the project runs.
- **122**: the session proxy's port is read once; after a session restart a running project's way out stays closed (502) until its machine side is restarted.
- **123**: every project's door and machine side run as the same user (uid 1000).
- **124**: IPv6 is off by setting, not shown (this kernel has none).
- **125**: the server profile's networks are designed, not shown.
- **126**: everything on `out` shares one list and the gateway port.
- Gap 70's other half: the runner's browser still runs without Chromium's own sandbox.
- Packet forwarding is on in every container (the kernel's default); no container can change its routes, since every capability is dropped (measured with and without, `measure/02e-route-change-without-capabilities.txt`; tested by "every capability dropped" and control C8).

## What this does not show

- **The real app, tools and runner images in the probe.** The isolation probe ran in stand-in images (the approved Node image with a small server, or with the runner's user), because the networks a container gets come from the Compose file, not from its image. The real images ran in the acceptance live test on the same networks (the image build, the tables and users, sign-in and the runner's test all worked), but the probe was not run inside them.
- **The door, probed in place.** The door's column is a one-off container of the door's service (same image, networks, user and mounts), not the running door itself.
- **Package 2.2's real engine and client.** The engine's column is the approved Node image placed as 2.2's option would place it; the Claude Agent SDK's own client was not tried (gap 50).
- **UDP, other than name lookups.** The probe tries TCP connections and name lookups only.
- **IPv6** (gap 124), **the server profile** (gap 125), **Docker Desktop**.
- **A model's code.** Nothing a model wrote was run; whether the boundary holds against code that tries to break it is not shown by a probe that asks politely.
- **Security.** This shows what each container reached in these runs. It is not a claim that the boundary is secure; no engineer has read it.

## The server profile: what changed, and what 0.6b must show

What changed (read in the code; not run): the server profile gets the same three private networks, `internal`, isolated, IPv6 off; the database by name with no port and its TCP health check; tools on `data` only; the runner and `check` on `front`. Its egress proxy is still the `egress` container itself, on `out` and on an ordinary bridge `ext`, going out directly (`EGRESS_UPSTREAM_PROXY=direct`, said explicitly; an empty value now stops it).

What 0.6b must show, on a server: the same probe and lists in every container; the egress container's own reach on `ext`, which on the development machine reached the machine's open port 2024 (`measurements.md`, item 2); `ext`'s subnet against the server's own routes (Docker accepted an overlap with the machine's network, item 6); IPv6 where the kernel has it; or that the server profile takes the development profile's door instead.

## Docker objects and clean-up

Every object a run made was named after the sandbox's own Compose project (`builder_<project id>`) and removed at its end; each run lists what is left of its projects ("Left of …") and the machine's Docker objects before and after (`demo/run-2/docker-objects-before.txt`, `docker-objects-after.txt`). The machine's Docker is shared with other sessions: an object in those lists that is not named after one of this package's projects is another session's.

Before this sitting, an earlier trial run of the demonstration was stopped part-way at about 11:35 UTC, when the work was interrupted; afterwards the Docker daemon and PostgreSQL were not running (inferred: the session's machine restarted), and both were started as `CLAUDE.md` describes. The trial's containers, networks, volumes and images (`builder_p_iso06c_demo`, `_mis1`, `_mis2`) and its temporary folders were found then and removed by hand; its output is not kept as evidence. That is gap 60's old limit of the demonstration: stopped from outside, it skips its clean-up. It still holds.

The cloud session's proxy moved again across that interruption: the trial run gave the machine side 127.0.0.1:36339, the runs after it 127.0.0.1:40405 (host and port only; known gap 122).

Docker's shared build cache was not removed: other sessions use it.

## After the review

**The review.** One adversarial review, by a reviewer that did not write the code, read commit `103badd` on 13 Nov 2026 (the owner's rule: at most two review rounds per package; the review bot on the pull request is the second). Its verdict: may be merged as it stands; nothing blocking. On an exact copy of `103badd` it ran the typecheck, the licence check and the unit tests that need no Docker, and the probe live under the shared lock: two projects side by side and an extra ordinary bridge, every container compared with its list (all PASS; the running door, probed in its own namespace, is in gap 128), its own extra attempts (every Docker gateway address, the other project's door, app and database, the cloud metadata address, Docker's name server, socket paths: only the container's own project answered), tricks through the door's proxy (each refused, by the door's proxy or by the session's), and two more misconfigurations of its own (the tools container also on `out`; `out` without the "isolated" mode), each failing its comparison. It did not run this repository's full suite or the live acceptance test (they make Docker objects not named after its run), the probe inside the real images, or IPv6.

**What was done with each of its notes:**

| The review's note | What was done | Shown by |
| --- | --- | --- |
| The egress list checks hosts, not ports: through the door, a tunnel to the registry on port 22 or 5432 was passed on (200 from the session's proxy) | **Fixed.** The egress proxy opens a tunnel to port 443 only, and plain HTTP to an `http://` address on port 80 only; any other gets the proxy's own 403 (`builder/src/sandbox/egress-proxy.ts`, `TUNNEL_PORT`, `PLAIN_HTTP_PORT`; `docs/DECISIONS.md`, 0.6c's row, point 8) | `builder/test/door.test.ts`, "an allowed host gets a tunnel to port 443 only…"; controls C34, C35 |
| If the machine side stopped giving its proxy the upstream, the proxy would go out directly and no unit test would fail | **Fixed.** The machine side's start-up moved into `builder/src/sandbox/egress-machine.ts` (`startMachineSide`); `egress-machine-main.ts` is now only its entry point. A test starts it against a made-up upstream and checks that both of its tunnels, from the project's socket and from the image build's port, arrive there | `door.test.ts`, "the machine side's two proxies go out through its upstream…"; controls C36, C37, C38 |
| The image-build test looked only at lines starting with an upper-case `RUN `; a lower-case `run npm run build` after `COPY . .` would have passed | **Fixed.** The test reads the Dockerfile as Docker does: the keyword in any case, leading space ignored, continued lines joined, comment lines dropped (Docker's reference: `docs/SOURCES.md`). It also refuses a `# syntax=` or `# escape=` line written in any case | `builder/test/sandbox.test.ts`, the image-build test and "the Dockerfile reading used above"; controls C39, C40, C41, each also run under the test as the review read it, which let each one through |
| "No package of the template needed its install script" says more than was exercised | **Reworded**, in "The other live runs" above and in `docs/DECISIONS.md`: none was needed for the build, the start, sign-in and the stand-in test | — |
| `docs/STATUS.md` named one way out; the door's gateway port is a second | **Reworded:** two ways out, the builder's proxy and the gateway's port | — |
| `isolation.ts`'s header said the machine's addresses are read with `ip`; the code reads `/proc/net/fib_trie` | **Corrected** | — |
| Probed in its own namespace, the running door also answers on its own listeners; its E1 and E2 got no answer within 3 s once | **Recorded:** known gap 128, point (2) | the review's run |
| The machine's listening ports are read once, so group M is a snapshot | **Recorded:** gap 128, point (3); the real images not probed, point (1) | the review's run |
| Not as root, `browser-in-project.ts` makes the sample-password file readable, and the output folder writable, by every user | **Recorded:** gap 127 | read in the code |
| The door and `egress-host` mount the whole builder folder; a `builder/.env` holding a key would be readable inside them | **Recorded:** gap 120, extended | read in the code |
| The server profile still goes out directly; package 2.2's engine option is designed, not shown | **Already recorded:** gaps 125 and 50; unchanged | — |
| The live development-profile test block made its folder when the file was read, so a run that left the block out left the folder behind | **Fixed:** the folder is made when the block runs and removed after it. The package 0.5 tools block next to it, whose two folders every run left, is made the same way | `checks/controls-3.txt`, "Housekeeping" |
| The request relayed to the review, for the J1 screenshots | **Not part of this package:** 0.6c made no J1 screenshots; its only screenshots are the template's, in `demo/template/`. Since 0.6c, the evidence browser scripts run in the runner's container, through `builder/scripts/browser-in-project.ts` | — |

The line references in "What was built" above are to commit `d6db9bf`; the machine side's code is now in `egress-machine.ts`.

**The checks after the changes** (code commits `dcfebcf` and `791c2c6`):

| Check | Run on | Result | File |
| --- | --- | --- | --- |
| The whole suite, live tests included, under the shared lock | fourth run, the working tree before the code commits | **failed**: 1 of 434. The image check (`approved-images.test.ts`) found `FROM x`, an image name that is not pinned, in the made-up Dockerfile text of the new test of the Dockerfile reading. That text was changed to `WORKDIR /app`; the image check was not changed | `checks/tests-full-4.txt` |
| The same | fifth run, the working tree that became `791c2c6` (each code and test file's fingerprint in the file's header, the same as committed) | passed: 16 files, 434 tests, none skipped; among them the live isolation test, which compared every project container with its list again with the one-port rule in place | `checks/tests-full-5.txt` |
| `npm run typecheck` | the trees of both runs; `dcfebcf` alone on a scratch copy | passed (exit 0) | `checks/typecheck-4.txt`, `checks/typecheck-5.txt`; `dcfebcf` alone: run in this session, output not kept beyond "exit 0" |
| `npm run check:licences` | the trees of both runs | passed; no package dependency added | `checks/licences-4.txt`, `checks/licences-5.txt` |
| Controls C34 to C41, and the housekeeping check | a scratch copy of `791c2c6` made with `git archive`; for C39 to C41 and the housekeeping check, also a copy of `103badd` | each of the eight failed with its change and passed again once restored. C39 to C41 each passed under the test as the review read it: the old test let them through. A run that leaves the live blocks out left three folders at `103badd` and none at `791c2c6` | `checks/controls-3.txt`, `checks/controls-3.py` |

About the controls: C36 shows the 502 the proxy gives when, with no upstream, it tries to reach the made-up name `registry.example.test` directly (a reserved name that no name server answers; the lookup was made). For C38, with the folder check removed, the test's second start of the machine side went ahead, made a socket outside its folder (`/tmp/m06c-elsewhere.sock`, removed by the script) and failed only later, on the image build's port, which the first start held; the test failed because the refusal it expects never came. None of these tests starts a container.

Seen in passing, not changed: some unit tests in `sandbox.test.ts`, most of them package 0.5's tests of the Docker client's settings, still leave small folders of made-up settings in the temporary folder; after the fifth run: four `builder-sb-…`, two `builder-user-docker-…` and one `builder-home-…`.

## Brought up to date with the integration branch (13 November 2026)

**What was merged.** The integration branch `claude/stage-1` at `c6f4056` was merged into this branch at `44329ca` (`git merge --no-ff`). Since this package's base (`b52e041`) it had gained three packages, all merged there: **1.4c** (pull request #35: a bill above its hold freezes the project; migrations 010 and 011), **3.1b** (#34: the live acceptance tests fail, never skip, without Docker or the browser; a scan of the test suite for skips; the browser fetch; the runner image checked before a run; one outcome word per run) and **1.4b** (#33: an unreadable journal line keeps the gateway closed until it is recovered; migration 012). The merge commit is the one that adds this section; its parents are `44329ca` and `c6f4056`.

**Where the two sides met, and what was kept.** Both sides' behaviour is kept in every conflict.

| File | Conflict | Resolution |
| --- | --- | --- |
| `builder/src/acceptance/runner.ts`, header comment, lines 4 to 11 | 0.6c: the "right app answers" check asks from a short-lived container on `front`. 3.1b: before a run, Docker must answer and the runner image must carry the approved zip's fingerprint; a refused run's outcome is "not passed" | One comment naming both checks in the order the code runs them: the version, then the runner image (3.1b), then the app asked from `front` (0.6c). The code merged without conflict: `runnerImageProblem` (3.1b, line 131) runs before `appAnswers`, which asks through `askApp` (0.6c, line 88); the run's event carries `outcome` (3.1b, line 226) |
| `builder/test/acceptance-live.test.ts`, lines 91 to 92 | 0.6c: `makeExample1` takes the build's proxy port, not a database port. 3.1b: every live test starts with `needsPrerequisites()` | Both: `needsPrerequisites();` then `makeExample1({ …, buildProxyPort: BUILD_PROXY_PORT, … })`. No skip came back: the file has no skip, and the gate's scan passed (below) |
| `docs/DECISIONS.md`, rows at lines 120 to 127 | Both sides added rows after the same row | Both kept, all dated 13 Nov: the integration branch's seven rows (1.4c, 3.1b, 1.4b) first, in the order they were merged there, then 0.6c's "built as follows" |
| `docs/KNOWN-GAPS.md`, lines 121 to 152 | 0.6c added gaps 118 to 128; the integration branch added 106 to 117 and 140 to 147, and extended gap 105 | Every row kept, in number order: 105 (the integration branch's extended text; 0.6c had not changed it), 106 to 117, 118 to 128, 140 to 147. No number is used twice |
| `docs/SOURCES.md`, lines 282 to 311 | Both sides added a section after the same one | Both kept: 1.4b's "after its review" section, then 0.6c's |
| `docs/STATUS.md` | Both sides rewrote "State" and "Next" | Rewritten from both, 398 words in all: 1.4b, 1.4c and 3.1b merged; 0.6c this pull request (#36) |

**What merged without a conflict.** Every file that 1.4b and 1.4c changed (the gateway, the store, migrations 010 to 012, the recovery and reconciliation scripts, their tests), and every file of 3.1b that this package did not touch (the browser fetch, the prerequisites, the results reader, the runner image, the gate's scan and its test), is byte for byte the integration branch's. The two code files both sides changed without a conflict, `builder/src/sandbox/manager.ts` (3.1b: the sandbox records its runner image) and `builder/test/acceptance.test.ts`, each hold exactly the integration branch's lines plus exactly this package's (compared line by line in this session).

**The checks, on the merged code before its commit** (the tree of `builder/` was `a5e262a…`, of `templates/` `10ae560…`, the same as in the merge commit; nothing under them unstaged):

| Check | Result | File |
| --- | --- | --- |
| `npm run typecheck` | Passed, exit code 0 | `checks/merge-typecheck.txt` |
| The whole suite, live tests included, under the shared lock, with the approved zip (`BUILDER_BROWSER_CACHE` set) | **23 files, 517 tests, 517 passed, none skipped**, exit code 0 (14:28 to 14:38 UTC). Among them: the gate's tests, the scan of the whole suite for skips included (3.1b); the 7 live acceptance tests; this package's live isolation tests. No container before the run or after it | `checks/merge-tests-full.txt` |
| `npm run check:licences` | Passed; no package dependency added | `checks/merge-licences.txt` |
| The live acceptance test file alone, **with** the approved zip | **7 of 7 passed**, exit code 0: the runner image built and carries the zip's fingerprint; run A passed, B stopped by its limit, C refused with the app stopped, D failed at its step; the right-app check from `front` | `checks/merge-live-with-zip.txt` |
| The same file **without** the zip (`BUILDER_BROWSER_CACHE` an empty folder of this run's own) | **7 of 7 failed**, none skipped, exit code 1, each naming the missing zip and how to put it right; under half a second; no container before or after | `checks/merge-live-without-zip.txt` |

**The isolation run** (`scripts/demo-isolation.ts`, as this package's evidence ran it, under the shared lock, 14:39 to 14:44 UTC, 302 s; `checks/merge-isolation.txt`; its probe lines, comparisons and table in `demo/run-merge/`). Every container matched its expected list, attempt by attempt, who answered included:

*Read with the correction of 14 Nov 2026 at the top of this file: the app, tools and runner rows ran in stand-in images, and the engine row is a placement in the approved Node image.*

| Container | Attempts | Got an answer (each on its list) | Compared with its list |
| --- | --- | --- | --- |
| app (`data`, `front`) | 55 | Docker's name server; `db` found; the database and the app by name | PASS: 55 rows PASS, 0 FAIL |
| tools (`data`) | 55 | the same four | PASS: 55 rows PASS, 0 FAIL |
| database (the probe in its network namespace) | 55 | its own loopback (C5, C7), and the same four | PASS: 55 rows PASS, 0 FAIL |
| runner (`front`) | 55 | Docker's name server; the app by name | PASS: 55 rows PASS, 0 FAIL |
| engine, as package 2.2 would place it (`out`) | 55 | the registry through the door's proxy (200, and 200 inside the tunnel); example.com refused in the proxy's own words (403, twice); plain HTTP to the registry passed on to the session's proxy (405); the stand-in gateway at the door's port (200); the door's two ports by name | PASS: 55 rows PASS, 0 FAIL |
| the door (a one-off container of its service, `out`) | 55 | the same nine | PASS: 55 rows PASS, 0 FAIL |
| comparison: the machine's own network | 59 | the canary at every machine address, and what an ordinary container reaches | PASS: its answers came |
| comparison: Docker's default network | 54 | the canary at that network's address on the machine | PASS: its answers came |
| misconfiguration 1: the app also on an ordinary bridge | 63 | outside hosts and names, the machine's port 2024 and the canary | **FAIL, as it must:** 15 rows |
| misconfiguration 2: `data` internal without the "isolated" mode | 71 | the machine's port 2024 and the canary, at the machine's address on that network | **FAIL, as it must:** 2 rows |

Each project container made 55 attempts, not 53 as in `demo/run-2`: the machine had one more listening port at this run, 127.0.0.1:4020, so group M crossed it with both machine addresses; neither attempt got an answer. That port is the owner's own builder interface, running from another folder of this session. The comparison container on the machine's own network opened a connection to it, as it does to every port listening on the machine (`checks/merge-isolation.txt`, "X4020"); nothing was sent to it. Nothing was left of the run's three projects; the machine's Docker objects after the run were the same as before.

**The controls, on a copy of the merged code** (`checks/controls-merge.py`, run under the shared lock on a `git archive` copy of the merged tree; output `checks/merge-controls.txt`). 0.6c's controls are read unchanged from `checks/controls.py` and `checks/controls-3.py`; 3.1b's controls that touch the runner and the live tests (its C1, C3, C3b, C4 and C5) are written from the changes in `evidence/2026-11-13-package-3.1b/run-controls.txt`.

| Controls | Result |
| --- | --- |
| 0.6c C1 to C11, C13 to C41 (40 controls) | Each **failed** with its safeguard removed, and passed again once restored. C26 and C29 let their test start a `check` container or network of the test's own project (`builder_p_test`), removed by the script; C38 left a socket at `/tmp/m06c-elsewhere.sock`, removed |
| 0.6c C12, as written | **Not run:** its text is no longer in `egress-machine-main.ts`. This package's own commit `dcfebcf` (after its review, before this merge) moved the machine side's start-up into `egress-machine.ts`; `checks/controls-3.txt` did not run C12 again |
| C12b: C12's change made where the code now is (`egress-machine.ts`) | **Passed with the change: the control did not catch it.** Found by this run; not caused by the merge (next paragraph) |
| 3.1b C1 (the skip put back on the live tests), C3, C3b, C4 (the runner image check removed), C5 (the label check accepts any image) | Each **failed** with its change and passed once restored. With C1's skip, the live file alone and an empty cache folder **passed with 7 skipped**, exit code 0: what `npm test` would do without the gate |

**C12b, explained.** With "direct" accepted, the machine side went on and stopped only when it could not open its socket under `/sock/` (which exists only inside its container), with the same exit code 2 and the same `refusedToStart` line, only with another reason: "listen EACCES: permission denied /sock/egress.sock" (run by hand in this session on the control's copy; with the safeguard in place it says that "direct" is not allowed). The test checks the exit code and that line, not its reason, so it cannot tell the two apart. Before `dcfebcf`, a socket that could not be opened ended the program with exit code 1, so the test did tell them apart (C12 failed in `checks/controls-2.txt`). The machine side still refuses "direct" (the run with the safeguard in place, above, and the isolation run's machine side going out only through the session's proxy); what was weak is the test. It is made to check the reason in the commit after this one, and C12b is run again there.

**The test made to check the reason (the commit after the merge, `e614e80`).** `builder/test/door.test.ts`, the test "the machine side refuses to start without a valid upstream": for each bad way out (missing, empty, "direct", not an address, no port) it now requires the `refusedToStart` line to begin "The egress proxy's way out", the words of every refusal of the way out, not only exit code 2 and a `refusedToStart` line. Nothing else changed; no check was weakened.

| Check, on the working tree that became that commit (the tree of `builder/` was `2c338fc…`, the commit's; nothing unstaged) | Result | File |
| --- | --- | --- |
| `npm run typecheck` | Passed, exit code 0 | `checks/merge-fix-typecheck.txt` |
| The door test's controls again: C9 to C11, C12b, C13 to C16, C34 to C38 (on a `git archive` copy, under the shared lock) | **C12b now fails with its change:** "direct: expected { status: 2, said: false } to deeply equal { status: 2, said: true }". The other 12 failed with theirs, as before; every one passed once restored. C12 as written: not run, as above | `checks/merge-fix-controls.txt` |
| The whole suite, live tests included, under the shared lock, with the approved zip | **23 files, 517 tests, 517 passed, none skipped**, exit code 0 (14:57 to 15:07 UTC); no container before or after | `checks/merge-fix-tests-full.txt` |
| `npm run check:licences` | Passed; no package dependency added | `checks/merge-fix-licences.txt` |

**Not run again after the fix,** because it changed one test's check and no code: the isolation run, the live acceptance test alone with and without the zip (the whole suite above ran it with the zip), and the controls outside `door.test.ts`.

**What this does not show.** As before this merge: no engineer has read this package (question 7); the server profile (0.6b), IPv6 and package 2.2's own engine are not shown; nothing a model wrote was run. The merge was not read by a fresh reviewer.
