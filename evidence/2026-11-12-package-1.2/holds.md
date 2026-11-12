# Package 1.2: holds stored in the database

| | |
| --- | --- |
| Date | 12 November 2026 |
| Package | 1.2 of `docs/BUILD-PLAN.md`: "Holds stored in the database under a lock on the project's row: open, settle, expire, and recovery when the gateway starts" |
| Done means (plan, as amended 12 Nov) | "Proof rows B1 to B6 of design note 7.2, and only those, each shown from the event log against a stand-in provider." What finishes this package is also a question to the owner (`docs/STATUS.md`), so it is **not marked tested** on this evidence alone |
| Run on | The development machine (a cloud session), directly on the host: the builder's own gateway code, a local PostgreSQL database, and a **stand-in provider** in the same process. No real provider was called, no key exists, nothing was spent. No generated code and no engine ran |
| What a stand-in can and cannot show | It shows what the gateway does with the answers it is given. It shows nothing about how the real provider counts, bills or fails (plan section 8, rule 3) |
| State | **Built, not tested.** Two independent reviews so far, each told to break the cap. The first (of `ebbcca5`) found three blocking defects and nine others; the second (of `15586fa`) confirmed all twelve fixed and found one more blocking defect, one overstated sentence and seven smaller points. Each review and its answers is below. The answers to the second have not yet been read by an independent reviewer |

## What was built

- **A holds table in the database** (`builder/src/store/migrations/003_holds.sql`) and the functions that open, settle, keep, expire and find holds (`builder/src/store/holds.ts`). Every change to a hold made by the gateway is also written to the append-only event log.
- **The worst-case amount of a hold** (`builder/src/gateway/hold.ts`): the prompt as counted by the provider's own counting call, plus a margin, at the dearest input rate that could apply; the request's `max_tokens` at the dearest output rate that could apply; doubled where fast mode could apply.
- **Check-and-hold as one step** (`builder/src/gateway/app.ts`): the budget equation, spent plus open holds plus this hold against the cap, is checked and the hold is written inside one database transaction that locks the project's row. The gateway's old in-memory reservations and its estimate from the last three calls are gone.
- **Two ways out of the equation, and no others:** a hold is settled to the actual cost when the call ended with usage figures that were read and could be trusted (every count a whole number that is not negative, and no list of separate attempts); or it is settled at nothing when the provider's own error, in the provider's own error shape, says the request was turned away before any work. A streamed answer counts as read only if the provider's end-of-message marker arrived and no error event did. Every other ending leaves the hold open at its full amount: a server error, any other error answer, a redirect, a stream cut part-way, the caller going away, an answer with no usage or with usage that cannot be trusted, an answer from a model with no price, the time limit, a database error while settling.
- **Refusals for what a hold cannot bound** (the "known limits" of design note 5.5): a prompt that cannot be counted; `max_tokens` missing or above the profile's ceiling; `inference_geo` other than the default; tools the provider runs itself, and tool servers; fast mode where the profile does not allow it or the model has no listed fast-mode price; **any request field outside a fixed list, and any beta feature not on the gateway's list** (added after the review).
- **On a metered call the body is forwarded as the gateway read it**, written out again, never the raw bytes; only a fixed list of request headers is passed on, and nothing after a "?" in the address. The token-counting pass-through, which costs nothing, still forwards the caller's body as sent.
- **The real key is kept out of what the gateway stores and passes back** in the places an answer could echo it: everything written to the event log for a call is searched after parsing; response headers carrying it are dropped; error bodies, the pass-through's body and a plain answer's body have it removed. **Not covered:** the body of a streamed answer is passed to the caller as it comes.

## The six proof rows

| Row | Claim | Where it is shown | Result |
| --- | --- | --- | --- |
| B1 | A hold is opened before every forwarded call and settled to the actual cost | Demonstration, section B1; test "B1" | Shown, against a stand-in |
| B2 | A call whose hold does not fit is refused at the call | Demonstration, section B2; tests "B2" (one of them with six calls arriving together through two gateway instances: one admitted) | Shown, against a stand-in. The two instances in the test share one process and one set of database connections; the reviewer separately ran two real gateway processes with 40 calls at once and reported one admitted each time, which is the reviewer's run and is not saved here |
| B3 | A prompt that cannot be counted is refused | Demonstration, section B3; test "B3" | Shown, against a stand-in |
| B4 | The hold covers the long-prompt rate and fast mode when either could apply | Demonstration, section B4, two cases; tests "B4 (1)" and "B4 (2)" | Shown, against a stand-in |
| B5 | A hold past its deadline is kept, not released | Demonstration, section B5; test "B5" | Shown, against a stand-in, for the kept-open reading the design note is written for (the owner's question on expired holds is open) |
| B6 | Holds are database rows that survive the gateway stopping | Demonstration, section B6; test "B6" | Shown in this form: a call is in flight when its caller is cut off; the first gateway records that it keeps the hold and its server is then closed; a second gateway started on the same database finds the hold. Both run inside one process. A gateway process killed outright is package 1.4 (row B9); the reviewer reported doing that by hand with the same result, which is not saved here |

## Run 1: the demonstration (`npx tsx scripts/demo-cap.ts`, from `builder/`)

Everything below "event" is read back from the event log; "the hold's row" is read from the holds table.

```text
Stand-in provider only: no real provider is called and nothing is spent.
Prices used: Claude Opus 5.5 input $4, one-hour cache write $8, output $20 per million tokens; Claude Haiku 5.5 one-hour cache write $0.20 and output $0.50, or $1.00 and $2.50 over 100,000 prompt tokens.

== B1. A hold is opened before every forwarded call and settled to the actual cost ==
  call 1: HTTP 200
  call 2: HTTP 200
  event hold.opened: hold #3252 for $0.125600
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.085600
      max_tokens 2000 at $20 per million = $0.040000; fast-mode factor 1; both parts include the factor
  event model.call: status 200, billed 10000 input and 1000 output tokens, actual cost $0.060000
  event hold.settled: hold #3252 of $0.125600 settled at $0.060000; $0.065600 returned to the budget
  event hold.opened: hold #3253 for $0.125600
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.085600
      max_tokens 2000 at $20 per million = $0.040000; fast-mode factor 1; both parts include the factor
  event model.call: status 200, billed 10000 input and 1000 output tokens, actual cost $0.060000
  event hold.settled: hold #3253 of $0.125600 settled at $0.060000; $0.065600 returned to the budget
  budget afterwards: cap $1.000000 | spent $0.120000 | open holds $0.000000 (0) | spent + open holds = $0.120000
  actual cost never above the hold: yes

== B2. A call whose hold does not fit is refused at the call ==
  call 1: HTTP 200
  budget before call 2: cap $0.150000 | spent $0.060000 | open holds $0.000000 (0) | spent + open holds = $0.060000
  call 2: HTTP 402 (budget_reached)
  message shown: "This project has reached its budget of $0.15 (spent $0.06, with $0.00 held for work in progress or awaiting reconciliation; this call needed up to $0.13). The gateway will forward nothing more until the budget is raised."
  calls that reached the provider during call 2: 0
  event hold.opened: hold #3254 for $0.125600
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.085600
      max_tokens 2000 at $20 per million = $0.040000; fast-mode factor 1; both parts include the factor
  event model.call: status 200, billed 10000 input and 1000 output tokens, actual cost $0.060000
  event hold.settled: hold #3254 of $0.125600 settled at $0.060000; $0.065600 returned to the budget
  event gateway.refused: reason budget_reached; spent $0.060000 + open holds $0.000000 + this hold $0.125600 > cap $0.150000
  holds in the database for this project: 1 (one, from call 1; none for the refused call)

== B3. A prompt that cannot be counted is refused (amendment b) ==
  call: HTTP 502 (prompt_not_counted)
  message shown: "The prompt could not be counted by the provider, so the most this call could cost is not known. The gateway did not forward it."
  calls that reached the provider: 0
  event gateway.refused: reason prompt_not_counted
  holds in the database for this project: 0

== B4. The hold covers the long-prompt rate and fast mode when either could apply (amendment c) ==
  (1) Claude Haiku 5.5, prompt counted at 99,900 tokens, just under the 100,000 threshold:
  call: HTTP 200
  event hold.opened: hold #3255 for $0.107595
      prompt counted 99900 tokens + margin 5195 = 105095 at $1 per million (one-hour cache write, long-prompt price) = $0.105095
      max_tokens 1000 at $2.5 per million = $0.002500; fast-mode factor 1; both parts include the factor
  event model.call: status 200, billed 99900 input and 500 output tokens, actual cost $0.010240
  event hold.settled: hold #3255 of $0.107595 settled at $0.010240; $0.097355 returned to the budget
  the same model with a prompt counted at 1,000 tokens, for comparison:
  event hold.opened: hold #3256 for $0.000750
      prompt counted 1000 tokens + margin 250 = 1250 at $0.2 per million (one-hour cache write) = $0.000250
      max_tokens 1000 at $0.5 per million = $0.000500; fast-mode factor 1; both parts include the factor
  event model.call: status 200, billed 1000 input and 500 output tokens, actual cost $0.000350
  event hold.settled: hold #3256 of $0.000750 settled at $0.000350; $0.000400 returned to the budget
  (2) Claude Opus 5.5 on a profile that allows fast mode (the request does not ask for it):
  call: HTTP 200
  event hold.opened: hold #3257 for $0.251200
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.171200
      max_tokens 2000 at $20 per million = $0.080000; fast-mode factor 2 (the profile allows it); both parts include the factor
  event model.call: status 200, billed 10000 input and 1000 output tokens, actual cost $0.060000
  event hold.settled: hold #3257 of $0.251200 settled at $0.060000; $0.191200 returned to the budget

== B5. A hold past its deadline is kept, not released ==
  this gateway cuts a call off after 0.2 seconds and gives its hold a deadline 0.2 seconds later; the stand-in does not answer in time
  call: HTTP 502
  budget after the cut-off: cap $0.200000 | spent $0.000000 | open holds $0.125600 (1) | spent + open holds = $0.125600
  holds marked expired once the deadline had passed: 1
  the hold's row: state open, amount $0.125600, expired true, unreconciled true, actual cost not known
  event hold.opened: hold #3258 for $0.125600
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.085600
      max_tokens 2000 at $20 per million = $0.040000; fast-mode factor 1; both parts include the factor
  event hold.kept: hold #3258 of $0.125600 kept open; reason: the call reached its time limit
  event hold.expired: hold #3258 of $0.125600; kept true, unreconciled true, still open true
  budget after expiry: cap $0.200000 | spent $0.000000 | open holds $0.125600 (1) | spent + open holds = $0.125600
  a further call, to show the expired hold still counts: HTTP 402

== B6. Holds are database rows that survive the gateway stopping ==
  a call is in flight through gateway gw_demo_first; the gateway is now stopped
  budget with the first gateway stopped: cap $0.200000 | spent $0.000000 | open holds $0.125600 (1) | spent + open holds = $0.125600
  a second gateway, gw_demo_second, starts on the same database and looks for open holds
  the hold's row: state open, amount $0.125600, opened by gw_demo_first
  event hold.opened: hold #3259 for $0.125600
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.085600
      max_tokens 2000 at $20 per million = $0.040000; fast-mode factor 1; both parts include the factor
  event hold.kept: hold #3259 of $0.125600 kept open; reason: the caller disconnected before the answer arrived
  event hold.found_at_startup: hold #3259 of $0.125600, opened by gw_demo_first, found by gw_demo_second; kept true, still open true
  budget after the second gateway started: cap $0.200000 | spent $0.000000 | open holds $0.125600 (1) | spent + open holds = $0.125600
  spent + open holds the same before and after: yes
  a call through the second gateway, to show the hold still counts: HTTP 402

Every call that reached the provider carried the gateway's key, never a project token: yes (8 calls).
```

## Run 2: the type check and every test, by name

```text
$ npm run typecheck
exit code: 0

$ npx vitest run --reporter=verbose   (the whole suite; same tests as npm test)
 ✓ test/sandbox.test.ts > sandbox manager: compose documents > server profile: an internal network with no route out, and the egress proxy as the only bridge
 ✓ test/sandbox.test.ts > sandbox manager: compose documents > development profile: host network, session proxy and certificate, database on a non-default port
 ✓ test/sandbox.test.ts > sandbox manager: compose documents > writes YAML that Docker Compose accepts
 ✓ test/sandbox.test.ts > sandbox manager: compose documents > round-trips a small document through the YAML writer
 ✓ test/sandbox.test.ts > sandbox manager: live, development profile > starts the project's database and egress proxy, and the proxy refuses hosts not on the list
 ✓ test/gateway.test.ts > model gateway: key and metering > forwards with the real key, keeps the key out of the client's view, and records usage and cost
 ✓ test/gateway.test.ts > model gateway: key and metering > relays a streamed response byte for byte and meters it from the stream's events
 ✓ test/gateway.test.ts > model gateway: key and metering > prices one-hour cache writes and fast mode from the response
 ✓ test/gateway.test.ts > model gateway: key and metering > prices by the model that served the answer when it differs from the one requested
 ✓ test/gateway.test.ts > model gateway: key and metering > settles at nothing when the provider rejects the request before doing any work
 ✓ test/gateway.test.ts > model gateway: key and metering > does not follow a redirect from the provider, so the key goes nowhere else
 ✓ test/gateway.test.ts > model gateway: key and metering > answers 502, forwards nothing and opens no hold when the provider cannot be reached at all
 ✓ test/gateway.test.ts > holds: a call that ends without readable usage keeps its hold open > a server error from the provider
 ✓ test/gateway.test.ts > holds: a call that ends without readable usage keeps its hold open > a stream the client abandoned part-way: the usage seen is written down and releases nothing
 ✓ test/gateway.test.ts > holds: a call that ends without readable usage keeps its hold open > a successful answer with no usage block
 ✓ test/gateway.test.ts > holds: a call that ends without readable usage keeps its hold open > a stream that ends cleanly without usage figures
 ✓ test/gateway.test.ts > holds: a call that ends without readable usage keeps its hold open > the provider reachable for counting but not for the call itself
 ✓ test/gateway.test.ts > holds: proof rows B1 to B6 of the design note > B1: a hold is opened before the call is forwarded and settled to the actual cost
 ✓ test/gateway.test.ts > holds: proof rows B1 to B6 of the design note > B2: a call whose hold does not fit is refused at the call: no hold, nothing forwarded
 ✓ test/gateway.test.ts > holds: proof rows B1 to B6 of the design note > B2: with calls arriving together against room for one hold, one is admitted, through one gateway or two
 ✓ test/gateway.test.ts > holds: proof rows B1 to B6 of the design note > B3: a prompt that cannot be counted is refused, with the reason named
 ✓ test/gateway.test.ts > holds: proof rows B1 to B6 of the design note > B4 (1): a model with a long-prompt rate is held at that rate when the prompt is at or near the threshold
 ✓ test/gateway.test.ts > holds: proof rows B1 to B6 of the design note > B4 (2): on a profile that allows fast mode, a model with a fast-mode price is held at twice the standard rates
 ✓ test/gateway.test.ts > holds: proof rows B1 to B6 of the design note > B5: a hold past its deadline is kept at its full amount, marked expired and unreconciled, and still counts
 ✓ test/gateway.test.ts > holds: proof rows B1 to B6 of the design note > B6: holds are database rows: a gateway that starts finds the hold an earlier one left open, and keeps it
 ✓ test/gateway.test.ts > holds: found by review, and kept fixed > a usage block with one field that is not a count releases nothing: text, a negative number, a fraction
 ✓ test/gateway.test.ts > holds: found by review, and kept fixed > a usage block that itemises several attempts is not taken as the whole bill
 ✓ test/gateway.test.ts > holds: found by review, and kept fixed > an answer from a model with no price keeps the hold
 ✓ test/gateway.test.ts > holds: found by review, and kept fixed > an error answer settles at nothing only when it is the provider's own rejection before work
 ✓ test/gateway.test.ts > holds: found by review, and kept fixed > refuses request fields outside its list, and beta features it was not told to allow
 ✓ test/gateway.test.ts > holds: found by review, and kept fixed > forwards the body as it read it: a repeated key cannot show the gateway one value and the provider another
 ✓ test/gateway.test.ts > holds: found by review, and kept fixed > never stores or relays the real key, even when the provider's error echoes it
 ✓ test/gateway.test.ts > holds: found by review, and kept fixed > a bill above the hold is charged in full, recorded as a breach, and raises a fault
 ✓ test/gateway.test.ts > holds: found by review, and kept fixed > a streamed call that reaches the time limit keeps its hold
 ✓ test/gateway.test.ts > holds: found by review, and kept fixed > marking overdue holds while calls are being admitted does not deadlock
 ✓ test/gateway.test.ts > holds: found by review, and kept fixed > refuses a cost that is not a real, non-negative amount at the database as well
 ✓ test/gateway.test.ts > holds: found by the second review, and kept fixed > a stream is settled only when the provider's end-of-message marker was seen and no error event was
 ✓ test/gateway.test.ts > holds: found by the second review, and kept fixed > a stream whose figures cannot both be right keeps its hold: two starts, or a running total that falls
 ✓ test/gateway.test.ts > holds: found by the second review, and kept fixed > usage that points to a charge outside the token rates, or cannot be right, keeps the hold
 ✓ test/gateway.test.ts > holds: found by the second review, and kept fixed > the lock holds whatever the database's default isolation level: 30 calls at once, room for one hold
 ✓ test/gateway.test.ts > holds: found by the second review, and kept fixed > the store refuses to settle at an amount that is not a real, non-negative number, and does not settle a kept hold
 ✓ test/gateway.test.ts > holds: found by the second review, and kept fixed > the budget does not count as spent a call whose hold is open, or a cost that is not a real amount
 ✓ test/gateway.test.ts > holds: found by the second review, and kept fixed > forwards a fixed list of headers and nothing after a question mark in the address
 ✓ test/gateway.test.ts > holds: found by the second review, and kept fixed > keeps the key out of the log and out of what is passed back, wherever an answer echoes it
 ✓ test/gateway.test.ts > holds: found by the second review, and kept fixed > gives a project with an unknown or odd profile name no limits by accident
 ✓ test/gateway.test.ts > holds: what a hold cannot bound is refused before anything is forwarded > no max_tokens, or more than the profile's ceiling
 ✓ test/gateway.test.ts > holds: what a hold cannot bound is refused before anything is forwarded > routing that changes the price of every token
 ✓ test/gateway.test.ts > holds: what a hold cannot bound is refused before anything is forwarded > tools the provider runs itself, and tool servers
 ✓ test/gateway.test.ts > holds: what a hold cannot bound is refused before anything is forwarded > fast mode where the profile does not allow it, or the model has no fast-mode price
 ✓ test/gateway.test.ts > holds: what a hold cannot bound is refused before anything is forwarded > lets the caller's own tools through
 ✓ test/gateway.test.ts > holds: what a hold cannot bound is refused before anything is forwarded > the arithmetic of a hold, on its own
 ✓ test/gateway.test.ts > model gateway: what is refused > refuses a model that is not in the price table
 ✓ test/gateway.test.ts > model gateway: what is refused > refuses to be configured with a model that has no price
 ✓ test/gateway.test.ts > model gateway: what is refused > refuses an unknown token and never forwards it
 ✓ test/gateway.test.ts > model gateway: what is refused > refuses a non-JSON body
 ✓ test/gateway.test.ts > model gateway: what is refused > refuses paid paths it does not know, such as batches, and percent-encoded disguises
 ✓ test/gateway.test.ts > model gateway: what is refused > refuses methods other than POST
 ✓ test/gateway.test.ts > model gateway: what is refused > passes token counting through, logged and unmetered
 ✓ test/gateway.test.ts > model gateway: what is refused > raised no faults during this run
 ✓ test/egress.test.ts > egress proxy > matches exact hosts and wildcard subdomains, nothing else
 ✓ test/egress.test.ts > egress proxy > lets an allowed HTTPS host through and logs it as allowed
 ✓ test/egress.test.ts > egress proxy > reaches the model API host (401 without a key means it was reached)
 ✓ test/egress.test.ts > egress proxy > refuses a host that is not on the list and logs the refusal
 ✓ test/egress.test.ts > egress proxy > refuses a plain HTTP request to a host not on the list
 ✓ test/events.test.ts > event log > appends and lists events in order
 ✓ test/events.test.ts > event log > refuses to update an event
 ✓ test/events.test.ts > event log > refuses to truncate the event log
 ✓ test/events.test.ts > event log > refuses to delete an event
 ✓ test/app-spec.test.ts > app spec > accepts the fixed brief for test example 1 (leave request)
 ✓ test/app-spec.test.ts > app spec > names the problem in plain words when a screen is for an unknown role
 ✓ test/app-spec.test.ts > app spec > refuses a choice field with no choices
 ✓ test/app-spec.test.ts > app spec > refuses more than five core actions
 Test Files  5 passed (5)
      Tests  72 passed (72)
exit code: 0
```

## Run 3: the licence check committed for `builder/` (`npm run check:licences`)

No dependency was added or removed by this package.

```text
Production dependencies:
├─ MIT: 15
└─ ISC: 2

All dependencies, development tools included (summary):
├─ MIT: 96
├─ ISC: 59
├─ Apache-2.0: 15
├─ BlueOak-1.0.0: 11
├─ MPL-2.0: 3
├─ BSD-2-Clause: 2
├─ BSD-3-Clause: 2
├─ CC-BY-3.0: 1
├─ CC0-1.0: 1
└─ (MIT AND CC-BY-3.0): 1

Development-only packages whose licence is outside the permitted list:
lightningcss-linux-x64-gnu@1.33.0 | MPL-2.0
lightningcss-linux-x64-musl@1.33.0 | MPL-2.0
lightningcss@1.33.0 | MPL-2.0
spdx-exceptions@2.5.0 | CC-BY-3.0
spdx-ranges@2.1.1 | (MIT AND CC-BY-3.0)
Licence report (every dependency) written to builder/licences.csv
exit code: 0
```

## The first review (commit `ebbcca5`) and what was done

A fresh reviewer agent, told to break the cap, read `ebbcca5`, ran the tests and the demonstration, and wrote its own attack scripts. **What held:** the lock and the budget equation, under every attack it ran, including two real gateway processes with 40 calls arriving at once (one admitted, 39 refused, five rounds), a hold exactly equal to the room left, a cap of nothing, two settles of one hold at once, and a gateway process stopped and killed mid-call. It found no pre-existing check weakened. **What did not hold:**

| # | Finding | Blocking | Done |
| --- | --- | --- | --- |
| 1 | An answer whose usage had one field that was not a number (or a negative count) released the hold and charged nothing: three calls in a row went through with the budget still reading zero | Yes | Usage is taken as read only if every count is a whole number that is not negative; otherwise the hold is kept. Settling refuses an amount that is not a real, non-negative number, and so does the database. Each of the three has a test (the store's own refusal since the second review) |
| 2 | Request fields and beta features that can change the cost, or add prompt content the count never saw, were forwarded unexamined | Yes | The gateway forwards only a fixed list of request fields and only the beta features on its own list (none by default); the rest is refused. An answer that itemises several attempts keeps its hold. Tested. That the provider bills more for those fields rests on its documentation, not on a run |
| 3 | The plan's progress table and the status file on this branch still said package 1.2 was not started | Yes (records) | Those two files were corrected in the record update (pull request #11), merged on 12 Nov and taken into this branch |
| 4 | Any answer in the 400s settled the hold at nothing | No | Now only the provider's own error, of a known type with its matching status; anything else is kept. Tested |
| 5 | The gateway checked the body it parsed but forwarded the raw bytes, so a repeated key could show it one value and the provider another | No | The body is forwarded as read. Tested |
| 6 | An answer from a model with no price was silently priced as the model asked for | No | The hold is kept. Tested |
| 7 | Test B5 could fail when the shared test database held another overdue hold | No | The test looks at its own project only |
| 8 | Marking overdue holds could deadlock with a call being admitted (seen once in three runs) | No | Holds are now marked one project at a time under that project's lock. Tested |
| 9 | "Found at start-up" was written again at every start for every open hold | No | Written once per hold. Tested |
| 10 | An error body from upstream was stored and passed back as it came; a body echoing the key would have put the key in the log | No | The key is removed from error text before it is stored or passed back. Tested |
| 11 | This file overstated in three places (B6, "two gateways", "one way out"), and four behaviours had no test | No | The three corrected above. Tests added for a bill above a hold and for the time limit on a stream. Still without a test: a database error while settling, and the start-up code in `main.ts` |
| 12 | Small: the deadline was counted from before the counting call; a stream cut by the time limit was given the wrong reason; a kept hold could be settled by the store; the tool check matched by prefix; hold parts were rounded to nearest | No | Each corrected; a hold is now rounded up |

## The second review (commit `15586fa`) and what was done

A second fresh reviewer, also told to break the cap, attacked each of the twelve fixes again and the package as a whole. **All twelve earlier findings: fixed** (one, the key redaction, only in part). **What held again:** two real gateway processes with 40 calls at once over nine rounds; the boundary now that holds are rounded up (a hold equal to the room admitted, one millionth more refused); 96 shapes of untrustworthy usage, each kept open or settled at the exact cost; 1,920 calls racing sweeps and start-ups with no error; a gateway killed mid-call and restarted twice. **What it found:**

| # | Finding | Blocking | Done |
| --- | --- | --- | --- |
| N1 | A streamed answer that stopped without the provider's end-of-message marker, or carried an error event, was settled on the partial figures seen so far (present since the first version) | Yes | A stream is settled only if the marker arrived and no error event did; otherwise the hold is kept. Tested, both cases |
| N2 | The key was removed only from the raw text of a metered error body; it could still reach the log or the caller through response headers, an escaped spelling, the served-model field, or the pass-through's error body. The record said more than the code did | Yes (the record) | Everything stored for a call is searched after parsing; headers carrying the key are dropped; the pass-through's body and a plain answer's body have it removed. Tested. The body of a streamed answer is still passed on as it comes; the sentence above says so, and known gap 45 |
| N3 | The lock was sound only at the database's default isolation level, which the code did not state. With "repeatable read" as the default, 10 of 30 calls were admitted against room for one | No | Every budget transaction now states "read committed". Tested with a connection whose default is "repeatable read": one admitted, 29 refused |
| N4 | The migration that reopens a hold settled at an invalid amount left the old negative cost counting as spent, and wrote no event | No (test data only) | The budget counts as spent only a cost that is a real, non-negative amount whose hold is settled; a hold that is open again is counted once, as an open hold. The reopening is written to the log. Tested |
| N5 | Usage could still be trusted when it should not be: an unknown speed, cache-write items that do not add up, signs of charges outside the token rates, two starts in one stream, a running total that falls, all zeros | No | Each now keeps the hold. Tested |
| N6 | Request headers and the query string were passed through unexamined | No | A fixed list of five headers is passed on; a request with anything after "?" in the address is refused. Tested |
| N7 | This file said "tested" of two store behaviours that had no test, and two sentences were true of the metered path only | No | Tests added; the sentences corrected above |
| N8 | Small: a profile named like a built-in word got no limits; a cost of $100 million or more overflowed the column; actual costs were rounded to nearest | No | The profile look-up is exact; such a cost keeps the hold; costs are rounded up. Tested, except the overflow |
| N9 | The committed licence report for `builder/` lacked four packages that are installed | No | Regenerated and committed. It is specific to this machine |

Recorded by the reviewer and left as they are, in known gap 45: something between the gateway and the provider that sends the provider's exact error shape cannot be told apart from it; whether the provider ever returns a rejection after generating is unchecked; a "thinking" budget larger than `max_tokens` is forwarded on the assumption that the provider bounds thinking by `max_tokens`; if the real provider answers with dated model names not in the price table, every call's hold will be kept until the table has them.

## What this does not show

- **Nothing about the real provider.** Whether its token count is close enough for the margin, whether its bills match the gateway's arithmetic, how it fails: all untested until package 2.3.
- **The margin on the count is an assumption** (5% of the count plus 200 tokens), not a measurement. So is the list of tools the gateway lets through. Both are in `docs/KNOWN-GAPS.md`.
- **"No settled call costs more than its hold" is checked, not guaranteed.** If the provider bills above a hold, the gateway records a `hold.exceeded` event and raises a fault; the actual cost is still what is charged, and it can take a project over its cap. A test shows this happening with a stand-in that serves fast mode unasked.
- **A database error while settling, and the gateway's start-up code,** have no test. By reading, the first leaves the hold open.
- **The list of request fields the gateway forwards is a first guess.** It is deliberately short; package 2.2 will show what the engine really sends, and each addition needs a reason.
- **Kept holds are not yet marked for the owner or closable.** This package keeps the money; the marking of cut-off and unreadable calls and the freeze after a failed save are package 1.4, and the owner's list and the reconciliation are package 1.5. Until then a kept hold stays open with nothing that can close it.
- **The pre-step check** (package 1.3) and **the failure tests with the two invariants traced at every moment** (package 1.4) are not built.
- **A real stop of the gateway.** See row B6 above.
- That the gateway is the only route to the model, or that a project's containers cannot reach the provider another way: not part of this package, and not shown anywhere yet.
