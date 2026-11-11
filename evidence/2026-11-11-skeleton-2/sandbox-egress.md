# Evidence: requests sent through the egress proxy were filtered by its allow-list

Run on 2026-11-11 on the development machine, profile `development-cloud-session`. Command: npx tsx builder/scripts/demo-sandbox.ts

**What this run shows, and no more.** Two containers (a project database and the egress proxy) were started by the sandbox manager on the development profile. From the development machine itself, four HTTPS requests were sent *through* the proxy with `curl --proxy`. The two to hosts on the allow-list were tunnelled and answered; the two to hosts not on the list were refused, and the proxy logged each decision. That is all that was exercised.

**What this run does not show.** It does not show that a project's containers are isolated. On the development profile the containers share the host's network, so a process inside them could reach anything the host can reach without going through the proxy. No request was made from inside a workload container, nothing was tried without the proxy, by address, on another port or by name lookup. Those checks are package 0.6a of `docs/BUILD-PLAN.md`. The **server profile**, which is designed to give the containers an internal network with the proxy as the only way out, was checked only as a configuration file (`docker compose config` accepted it, in the test suite); it was **not run**. In the plan's words: the egress filtering is *shown* for requests that use the proxy; the isolation of the development profile is *not done* and is known not to hold (gaps 1 and 2); the isolation of the server profile is *designed, not shown*.

Narrowed on 11 November 2026 under package 0.2 of the build plan (the owner's finding 2 in `docs/reviews/2026-11-11-pull-request-2.md`). The run output below is unchanged.

```
Compose project builder_demo_sandbox written to /tmp/builder-demo-ptbCOQ/compose.yaml
Profile: development-cloud-session (host network, session proxy, session certificate). Allowed hosts: registry.npmjs.org, api.anthropic.com.

Container db: running (healthy)
Container egress: running
Database: /var/run/postgresql:5545 - accepting connections

Through the egress proxy, https://registry.npmjs.org/-/ping answered HTTP 200 (allowed host).
Through the egress proxy, https://api.anthropic.com/v1/models answered HTTP 401 (allowed host; 401 means reached, no key sent).
Through the egress proxy, https://example.com/ answered HTTP 000 (not allowed; 000 means the tunnel was refused).
Through the egress proxy, https://github.com/ answered HTTP 000 (not allowed).

Egress proxy log, one line per decision:
  {"at":"2026-11-11T05:02:04.735Z","method":"CONNECT","host":"registry.npmjs.org","port":443,"decision":"allowed"}
  {"at":"2026-11-11T05:02:05.211Z","method":"CONNECT","host":"api.anthropic.com","port":443,"decision":"allowed"}
  {"at":"2026-11-11T05:02:05.553Z","method":"CONNECT","host":"example.com","port":443,"decision":"refused"}
  {"at":"2026-11-11T05:02:05.561Z","method":"CONNECT","host":"github.com","port":443,"decision":"refused"}

Containers, network and volume removed.
```

## Test run (npm test): app spec, event log, gateway, egress proxy and sandbox manager

```
 RUN  v5.1.0 /home/user/vibe-build/builder
 Test Files  5 passed (5)
      Tests  38 passed (38)
   Start at  05:02:16
   Duration  15.65s (tests 99%, import 1%)
```

## Licence check

```
Production dependencies:
├─ MIT: 15
└─ ISC: 2

All dependencies, development tools included (summary):
├─ MIT: 95
├─ ISC: 59
├─ Apache-2.0: 13
├─ BlueOak-1.0.0: 11
├─ BSD-2-Clause: 2
├─ BSD-3-Clause: 2
├─ MPL-2.0: 2
├─ CC-BY-3.0: 1
├─ CC0-1.0: 1
└─ (MIT AND CC-BY-3.0): 1

Development-only packages whose licence is outside the permitted list:
lightningcss-linux-x64-gnu@1.33.0 | MPL-2.0
lightningcss@1.33.0 | MPL-2.0
spdx-exceptions@2.5.0 | CC-BY-3.0
spdx-ranges@2.1.1 | (MIT AND CC-BY-3.0)
Licence report (every dependency) written to builder/licences.csv
```
