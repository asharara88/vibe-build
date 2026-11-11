# Evidence: gateway meters calls and stops at the cap

Run on 2026-11-11 on the development machine, against a stand-in model provider (no real key, no real spend). Command: npx tsx builder/scripts/demo-cap.ts

```
Project demo_1794372276908 created with a cap of $2.00.
The engine holds a project token (starts "bpt_demo_..."), not the real key.

Each stand-in call reports 150,000 input tokens and 8,000 output tokens on claude-opus-5-5.
At $4 and $20 per million that is $0.60 + $0.16 = $0.76 per call.

Call 1: allowed. Spent so far $0.76 of $2.00.
Call 2: allowed. Spent so far $1.52 of $2.00.
Call 3: REFUSED with HTTP 402 (budget_reached).
         Message shown to the user: "This project has reached its budget of $2.00 (spent $1.52; the next call was expected to cost about $0.76). Nothing more will be built until the budget is raised."
Call 4: REFUSED with HTTP 402 (budget_reached).
         Message shown to the user: "This project has reached its budget of $2.00 (spent $1.52; the next call was expected to cost about $0.76). Nothing more will be built until the budget is raised."

Event log for the project: 2 model.call events, 2 gateway.refused event.
Every forwarded call carried the real key: yes (2 calls checked).
The project token never reached the provider: correct, it did not.
```

## Test run (npm test)

```
 RUN  v5.1.0 /home/user/vibe-build/builder
 Test Files  3 passed (3)
      Tests  14 passed (14)
   Start at  04:44:37
   Duration  631ms (tests 58%, import 32%, transform 8%, worker 3%)
```

## Licence check (npm run check:licences)

```
├─ MIT: 15
└─ ISC: 2

Licence report written to builder/licences.csv
```
