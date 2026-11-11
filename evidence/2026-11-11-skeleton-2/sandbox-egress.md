# Evidence: one project's containers, with the egress proxy as the only way out

Run on 2026-11-11 on the development machine (profile development-cloud-session). Command: npx tsx builder/scripts/demo-sandbox.ts

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
