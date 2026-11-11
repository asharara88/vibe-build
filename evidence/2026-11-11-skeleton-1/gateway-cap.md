# Evidence: gateway meters calls and stops at the cap

Run on 2026-11-11 on the development machine, against a stand-in model provider (no real key, no real spend). Command: npx tsx builder/scripts/demo-cap.ts

```
Project demo_1794373276052 created with a cap of $2.00.
The engine holds a project token (starts "bpt_demo_..."), not the real key.

Each stand-in call reports 150,000 input tokens and 8,000 output tokens on claude-opus-5-5.
At $4 and $20 per million that is $0.60 + $0.16 = $0.76 per call.

Call 1: allowed. Spent so far $0.76 of $2.00.
Call 2: allowed. Spent so far $1.52 of $2.00.
Call 3: REFUSED with HTTP 402 (budget_reached).
         Message shown to the user: "This project has reached its budget of $2.00 (spent $1.52; the next call was expected to cost about $0.76). The gateway will forward nothing more until the budget is raised."
Call 4: REFUSED with HTTP 402 (budget_reached).
         Message shown to the user: "This project has reached its budget of $2.00 (spent $1.52; the next call was expected to cost about $0.76). The gateway will forward nothing more until the budget is raised."

Event log for the project: 2 model.call events, 2 gateway.refused event.
Every forwarded call carried the real key: yes (2 calls checked).
The project token never reached the provider: correct, it did not.
```

## Test run (npm test)

```
 RUN  v5.1.0 /home/user/vibe-build/builder
 Test Files  5 passed (5)
      Tests  38 passed (38)
   Start at  05:01:16
   Duration  15.49s (tests 99%, import 1%)
```

## Licence check (npm run check:licences)

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
