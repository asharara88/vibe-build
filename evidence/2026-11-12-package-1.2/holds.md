# Package 1.2: holds stored in the database

| | |
| --- | --- |
| Date | 12 November 2026 |
| Package | 1.2 of `docs/BUILD-PLAN.md`: "Holds stored in the database under a lock on the project's row: open, settle, expire, and recovery when the gateway starts" |
| Done means (plan, as amended 12 Nov) | "Proof rows B1 to B6 of design note 7.2, and only those, each shown from the event log against a stand-in provider." What finishes this package is also a question to the owner (`docs/STATUS.md`), so it is **not marked tested** on this evidence alone |
| Run on | The development machine (a cloud session), directly on the host: the builder's own gateway code, a local PostgreSQL database, and a **stand-in provider** in the same process. No real provider was called, no key exists, nothing was spent. No generated code and no engine ran |
| What a stand-in can and cannot show | It shows what the gateway does with the answers it is given. It shows nothing about how the real provider counts, bills or fails (plan section 8, rule 3) |
| State | **Built, not tested.** Independent reviews, each by a fresh reviewer told to break the cap, are set out below with their answers: of `ebbcca5`, of `15586fa`, of `1fb2c87`, of `cedaced` and of `583c689`. In the last three, the cap held under every attack run and rows B1 to B6 were shown; their blocking findings were about the key and the records, not the cap. Which commit each review read, and whether the latest answers have been read again, is in the pull request's description |

## What was built

- **A holds table in the database** (`builder/src/store/migrations/003_holds.sql`) and the functions that open, settle, keep, expire and find holds (`builder/src/store/holds.ts`). Every change to a hold made by the gateway is also written to the append-only event log.
- **The worst-case amount of a hold** (`builder/src/gateway/hold.ts`): the prompt as counted by the provider's own counting call, plus a margin, at the dearest input rate that could apply; the request's `max_tokens` at the dearest output rate that could apply; doubled where fast mode could apply.
- **Check-and-hold as one step** (`builder/src/gateway/app.ts`): the budget equation, spent plus open holds plus this hold against the cap, is checked and the hold is written inside one database transaction that locks the project's row. The gateway's old in-memory reservations and its estimate from the last three calls are gone.
- **Two ways out of the equation, and no others:** a hold is settled to the actual cost when the call ended with usage figures that were read and could be trusted (every count a whole number that is not negative, no list of separate attempts, no field the meter does not know, and the model that served it named as text); or it is settled at nothing when the provider's own error, in the provider's own error shape, says the request was turned away before any work. A streamed answer counts as read only if the provider's end-of-message marker arrived, no error event did, no figure fell from one frame to the next, and every frame was framed as the provider frames it (at most one name; a named frame carries data; data is JSON; the name matches the type inside). A frame with no name and no data, such as a comment line, is passed over. Every other ending leaves the hold open at its full amount: a server error, any other error answer, a redirect, a stream cut part-way, the caller going away, an answer with no usage or with usage that cannot be trusted, an answer from a model with no price, the time limit, a database error while settling.
- **Refusals for what a hold cannot bound** (the "known limits" of design note 5.5): a prompt that cannot be counted; `max_tokens` missing or above the profile's ceiling; `inference_geo` other than the default; tools the provider runs itself, and tool servers; fast mode where the profile does not allow it or the model has no listed fast-mode price; **any request field outside a fixed list, and any beta feature not on the gateway's list** (added after the review).
- **On a metered call the body is forwarded as the gateway read it**, written out again, never the raw bytes; only a fixed list of request headers is passed on, and nothing after a "?" in the address. The token-counting pass-through, which costs nothing, still forwards the caller's body as sent.
- **The real key is kept out of what the gateway stores and passes back**, in the places an answer could echo it, by one test applied last: the text about to be returned, and the text about to be stored, is itself searched for the key, in its plain spelling and behind three backslash forms (`\uXXXX`, `\xXX`, and a backslash before any character), undone up to 16 times over. If the key is found, that text does not go out: a returned body is withheld and replaced by a short error body, and a stored record is cut down to its plain fields. Before that last test, a JSON body is cleaned part by part (as raw text and as parsed, so a key in a member that a JSON reader would drop is found too) and written out again, so that most answers that carry the key still reach the caller with the key cut out. Response headers that carry the key in a name or a value, in any letter case or behind those escapes, are dropped. **A body in which nothing is found goes back as the text the gateway read.** That is not always the provider's exact bytes: the body is read as text, so a leading byte-order mark is dropped and a byte that is not valid UTF-8 is replaced; a text whose backslash escapes are still coming undone after 16 rounds is treated as carrying the key (30,000 backslashes in a row are tested to pass; a reviewer measured the limit at 32,768); a value nested more than 200 levels deep is cut off there when a body has to be written out again, and a body that cannot be written out is withheld; a body of more than 8 million characters is not searched and not passed on, and on a metered call its hold is kept. **Not covered:** the body of a streamed answer is passed to the caller as it comes; and a key written in some other form is not looked for anywhere: base64, percent-encoding, HTML entities, or backslash forms other than the three named.

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
  event hold.opened: hold #125208 for $0.125600
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.085600
      max_tokens 2000 at $20 per million = $0.040000; fast-mode factor 1; both parts include the factor
  event model.call: status 200, billed 10000 input and 1000 output tokens, actual cost $0.060000
  event hold.settled: hold #125208 of $0.125600 settled at $0.060000; $0.065600 returned to the budget
  event hold.opened: hold #125209 for $0.125600
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.085600
      max_tokens 2000 at $20 per million = $0.040000; fast-mode factor 1; both parts include the factor
  event model.call: status 200, billed 10000 input and 1000 output tokens, actual cost $0.060000
  event hold.settled: hold #125209 of $0.125600 settled at $0.060000; $0.065600 returned to the budget
  budget afterwards: cap $1.000000 | spent $0.120000 | open holds $0.000000 (0) | spent + open holds = $0.120000
  actual cost never above the hold: yes

== B2. A call whose hold does not fit is refused at the call ==
  call 1: HTTP 200
  budget before call 2: cap $0.150000 | spent $0.060000 | open holds $0.000000 (0) | spent + open holds = $0.060000
  call 2: HTTP 402 (budget_reached)
  message shown: "This project has reached its budget of $0.15 (spent $0.06, with $0.00 held for work in progress or awaiting reconciliation; this call needed up to $0.13). The gateway will forward nothing more until the budget is raised."
  calls that reached the provider during call 2: 0
  event hold.opened: hold #125210 for $0.125600
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.085600
      max_tokens 2000 at $20 per million = $0.040000; fast-mode factor 1; both parts include the factor
  event model.call: status 200, billed 10000 input and 1000 output tokens, actual cost $0.060000
  event hold.settled: hold #125210 of $0.125600 settled at $0.060000; $0.065600 returned to the budget
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
  event hold.opened: hold #125211 for $0.107595
      prompt counted 99900 tokens + margin 5195 = 105095 at $1 per million (one-hour cache write, long-prompt price) = $0.105095
      max_tokens 1000 at $2.5 per million = $0.002500; fast-mode factor 1; both parts include the factor
  event model.call: status 200, billed 99900 input and 500 output tokens, actual cost $0.010240
  event hold.settled: hold #125211 of $0.107595 settled at $0.010240; $0.097355 returned to the budget
  the same model with a prompt counted at 1,000 tokens, for comparison:
  event hold.opened: hold #125212 for $0.000750
      prompt counted 1000 tokens + margin 250 = 1250 at $0.2 per million (one-hour cache write) = $0.000250
      max_tokens 1000 at $0.5 per million = $0.000500; fast-mode factor 1; both parts include the factor
  event model.call: status 200, billed 1000 input and 500 output tokens, actual cost $0.000350
  event hold.settled: hold #125212 of $0.000750 settled at $0.000350; $0.000400 returned to the budget
  (2) Claude Opus 5.5 on a profile that allows fast mode (the request does not ask for it):
  call: HTTP 200
  event hold.opened: hold #125213 for $0.251200
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.171200
      max_tokens 2000 at $20 per million = $0.080000; fast-mode factor 2 (the profile allows it); both parts include the factor
  event model.call: status 200, billed 10000 input and 1000 output tokens, actual cost $0.060000
  event hold.settled: hold #125213 of $0.251200 settled at $0.060000; $0.191200 returned to the budget

== B5. A hold past its deadline is kept, not released ==
  this gateway cuts a call off after 0.2 seconds and gives its hold a deadline 0.2 seconds later; the stand-in does not answer in time
  call: HTTP 502
  budget after the cut-off: cap $0.200000 | spent $0.000000 | open holds $0.125600 (1) | spent + open holds = $0.125600
  holds marked expired once the deadline had passed: 1
  the hold's row: state open, amount $0.125600, expired true, unreconciled true, actual cost not known
  event hold.opened: hold #125214 for $0.125600
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.085600
      max_tokens 2000 at $20 per million = $0.040000; fast-mode factor 1; both parts include the factor
  event hold.kept: hold #125214 of $0.125600 kept open; reason: the call reached its time limit
  event hold.expired: hold #125214 of $0.125600; kept true, unreconciled true, still open true
  budget after expiry: cap $0.200000 | spent $0.000000 | open holds $0.125600 (1) | spent + open holds = $0.125600
  a further call, to show the expired hold still counts: HTTP 402

== B6. Holds are database rows that survive the gateway stopping ==
  a call is in flight through gateway gw_demo_first; the gateway is now stopped
  budget with the first gateway stopped: cap $0.200000 | spent $0.000000 | open holds $0.125600 (1) | spent + open holds = $0.125600
  a second gateway, gw_demo_second, starts on the same database and looks for open holds
  the hold's row: state open, amount $0.125600, opened by gw_demo_first
  event hold.opened: hold #125215 for $0.125600
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.085600
      max_tokens 2000 at $20 per million = $0.040000; fast-mode factor 1; both parts include the factor
  event hold.kept: hold #125215 of $0.125600 kept open; reason: the caller disconnected before the answer arrived
  event hold.found_at_startup: hold #125215 of $0.125600, opened by gw_demo_first, found by gw_demo_second; kept true, still open true
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
 ✓ test/gateway.test.ts > holds: found by the third review, and kept fixed > a body that spells the key with escapes is cleaned before the caller gets it, as the caller would read it
 ✓ test/gateway.test.ts > holds: found by the third review, and kept fixed > the same holds on the token-counting pass-through, for a good answer and for an error
 ✓ test/gateway.test.ts > holds: found by the third review, and kept fixed > an answer that does not carry the key goes back byte for byte
 ✓ test/gateway.test.ts > holds: found by the third review, and kept fixed > the key in a member that a JSON reader would drop (the same name twice) is not passed back either
 ✓ test/gateway.test.ts > holds: found by the third review, and kept fixed > an answer nested too deeply to check is withheld, and its hold is kept with a note in the log
 ✓ test/gateway.test.ts > holds: found by the third review, and kept fixed > an answer that does not name the model that served it keeps its hold
 ✓ test/gateway.test.ts > holds: found by the third review, and kept fixed > a stream that is not framed the way the provider frames it keeps its hold
 ✓ test/gateway.test.ts > holds: found by the third review, and kept fixed > a response header named after the key is not passed back, whatever the letter case of the key
 ✓ test/gateway.test.ts > holds: found by the third review, and kept fixed > a stream whose figures contradict each other, or whose model is not a name, keeps its hold
 ✓ test/gateway.test.ts > holds: found by the third review, and kept fixed > usage with a field the meter does not know, or a model that is not a name, keeps the hold
 ✓ test/gateway.test.ts > holds: found by the third review, and kept fixed > the breakdown of output tokens that the provider documents does not stop a call being settled
 ✓ test/gateway.test.ts > holds: found by the third review, and kept fixed > an event the gateway did not write cannot make the budget unreadable or smaller
 ✓ test/gateway.test.ts > holds: found by the third review, and kept fixed > writes down the names of the headers it did not pass on, never their values
 ✓ test/gateway.test.ts > holds: found by the fifth review, and kept fixed > what goes back and what is stored is judged once more as text: one backslash in front of the key does not carry it through
 ✓ test/gateway.test.ts > holds: found by the fifth review, and kept fixed > a backslash in front of a u or an x of the key is undone like one in front of any other character
 ✓ test/gateway.test.ts > holds: found by the fifth review, and kept fixed > an answer with 30,000 backslashes in a row and no key in it goes back as it was read
 ✓ test/gateway.test.ts > holds: found by the fifth review, and kept fixed > an answer holding a character the database refuses still gets its ending written down
 ✓ test/gateway.test.ts > holds: found by the fifth review, and kept fixed > a served model named like a built-in word has no price, and an answer too large to search is not passed on
 ✓ test/gateway.test.ts > holds: found by the fifth review, and kept fixed > a named stream frame with no data keeps the hold; comment lines and keep-alives do not
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
 ✓ test/sandbox.test.ts > sandbox manager: compose documents > server profile: an internal network with no route out, and the egress proxy as the only bridge
 ✓ test/sandbox.test.ts > sandbox manager: compose documents > development profile: host network, session proxy and certificate, database on a non-default port
 ✓ test/sandbox.test.ts > sandbox manager: compose documents > writes YAML that Docker Compose accepts
 ✓ test/sandbox.test.ts > sandbox manager: compose documents > round-trips a small document through the YAML writer
 ✓ test/sandbox.test.ts > sandbox manager: live, development profile > starts the project's database and egress proxy, and the proxy refuses hosts not on the list
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
      Tests  91 passed (91)
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

## The third review (commit `1fb2c87`) and what was done

A third fresh reviewer, told to break the cap, went through the second review's nine findings again and attacked the package as a whole. **N1, N3, N5 (as listed), N6, N7, N8 and N9: fixed. N4: fixed for everything the gateway writes. N2: fixed in part** (finding 1 below). **What held:** 49 ways of ending a stream, none releasing a hold on partial figures; two real gateway processes with 40 calls at once at three isolation levels, one admitted every round (the same attack on the earlier commit `15586fa` at "repeatable read" admitted 9 of 30); 1,200,000 random costs, none above its hold and none under-recorded; a hold exactly equal to the room left admitted and one millionth more refused; 720 calls racing the deadline and start-up sweeps with no inconsistency; a gateway process stopped, and one killed, mid-call, with the hold found by the next process. It reported rows **B1 to B6 shown**, no pre-existing check weakened, and no way found to exceed the cap or release money on a guess. Those runs are the reviewer's; their output is not saved here.

| # | Finding | Blocking | Done |
| --- | --- | --- | --- |
| 1 | A body that spelt the key with backslash escapes was passed to the caller unchanged: the raw text did not contain the key, but the caller's own JSON reader would produce it. The record said bodies "have it removed" and that an escaped spelling was tested; the test looked at the raw text only | Yes (the key reaching the caller, and the record) | A JSON body is cleaned as the caller will read it and written out again; a body that is not JSON and carries such a spelling is withheld. The pass-through is covered. Tests now parse what the caller receives, on five metered answers and two pass-through answers. The record above says what is and is not covered |
| 2 | An event not written by the gateway could make the budget unreadable (a hold number that is not a whole number) or wrong (a hold that does not exist or belongs to another project was not counted) | No | A new view (`006_budget_view_guards.sql`): such a hold number no longer stops the view, and a cost is left out of "spent" only when it names an open hold of the same project. Tested; the earlier view shown failing on the same event. Still as they were: two events for one settled hold both count (over-counting); a cost written as text is not counted. The gateway writes neither |
| 3 | Stream figures that contradict each other could still be settled: a frame named "error" with other data; an input or cache figure that falls; a first frame with more output than the last; a model given as a list | No | Each now keeps the hold: a frame named "error" is an error whatever its data; no figure may fall from one frame to the next and fast mode may not be taken back; a model must be text. Tested, six cases |
| 4 | Usage carrying a field the meter does not know was read and settled at token rates | No | Usage is read only if every field in it is one the provider's reference lists (`docs/SOURCES.md`); an unknown field, or an unknown kind of cache write, keeps the hold. The documented breakdown of output tokens is accepted, and tested not to stop a call settling. **Consequence:** if the provider adds a usage field, every call's hold is kept until the list has it |
| 5 | A response header named after the key reached the caller in lower case; broken JSON in an error body was stored with an escaped spelling in it | No | Headers are compared without regard to letter case; text that carries an escaped spelling is withheld before it is stored. Tested for the header |
| 6 | Records: known gap 45 said the first review's corrections awaited review; the reopening event written by migration 005 has no test; the plan's table said "the first review" | No | The two records are reworded. The reopening event still has no automated test: the reviewer ran it by hand (one event, written once) |
| 7 | An assumption to record: beta features and anything after "?" fail loudly, but other headers are dropped silently, which package 2.2 will meet | No | The names, never the values, of headers not passed on are now written into the call's event. Tested. Recorded in known gap 45 |

Also reported and left as it is: reading the budget takes longer as a project's calls grow, inside the project lock (the reviewer measured about 37 ms at 20,000 settled calls and about 145 ms at 100,000). Recorded in known gap 45.

## The fourth review (commit `cedaced`) and what was done

A fourth fresh reviewer read only the changes made after the third review, and attacked each. **The cap held:** it found no way to exceed it or to release money on a guess against a provider that keeps to its documented format. Findings 2 to 7 of the third review: done as stated (375 hand-written events against the budget view with no error, no under-count and no over-count against the stated rule; 42 streams; the list of usage fields compared with the provider's live reference, nothing documented missing). **Finding 1, the key in a body: not done**, and the fix for it had opened a new hole.

| # | Finding | Blocking | Done |
| --- | --- | --- | --- |
| F1 | **Introduced by the previous fix.** A JSON body was judged only after parsing. A JSON reader keeps the second of two members with the same name and drops the first; with nothing found in the parsed value, the provider's raw bytes went back, the dropped member included. So the key in its plain spelling, in a repeated member, reached the caller, where the commit before had cut it. 240 of the reviewer's 1,008 bodies leaked this way; the event log stayed clean in all | Yes | The raw bytes go back only if the raw text is clean as well as the parsed value; otherwise the cleaned value is written out. Tested for a plain and an escaped spelling in a repeated member, on an error answer and a good one; the tests fail on `cedaced` |
| F2 | Record sentences made false by F1, and "goes back byte for byte" was absolute though a text with 32 backslashes in a row was replaced | Yes (records) | The sentences above now say what is done and name the exceptions; the rounds were moved from 6 to 16. A body with 80 backslashes in a row, and one with 30,000, are tested to come back as read. (This cell first said "65,536 in a row"; the fifth review measured 32,768) |
| F3 | A stream framed otherwise than the provider frames it could be settled at the lower of two figures: a frame behind a "blank line" of LF then CR LF, or of CR alone; an unnamed frame with broken JSON; two names in one frame; a name that disagrees with the type inside; a start frame with no message | No | Each now keeps the hold: lines end as the event-stream format allows, a frame has at most one name, its data must be JSON, and its name must match its type. Tested, eight cases, with fast mode taken back among them |
| F4 | A model given as empty text was accepted; on a plain answer a missing model was priced as the model asked for | No | An answer must name the model that served it, as text that is not empty, or its hold is kept. Tested |
| F5 | A body nested about 5,000 levels deep made the gateway fail: the caller got a bare error, no note was written for the kept hold, and the call's timer was left running | No | Nothing is walked deeper than 200 levels; a body that cannot be written out again is withheld; the timer is stopped first. Tested with 20,000 levels: the hold is kept with its note |
| F6 | The earlier view was "shown failing" with no output saved; a comment in the new migration said "made safe" | No | Output saved in `run-earlier-view.txt`; the comment reworded |
| F7 | Row 4 of the third review read as if every unknown usage field keeps the hold | No | Said exactly here: an unknown field at the top of the usage block, or an unknown kind of cache write, keeps the hold. An unknown member inside the breakdown of output tokens is accepted if it is a count no larger than the output total; an unknown member inside the provider-run tools block is accepted only at zero |

Left as they are and recorded in known gap 45: a repeated name inside a usage block or a frame is read as a JSON reader reads it, the last one winning, so a provider that sent two different figures under one name would be settled on the second; a body that carries the key is written out again whole, which can change how a very long number is written; two events with costs near the largest number the database holds stop the budget view, which then refuses everything for that project; a cost that is not a number is not counted; the names of request headers are the caller's own text and are logged as sent, except that a name containing the gateway's key is replaced.

## The fifth review (commit `583c689`) and what was done

A fifth fresh reviewer read only the changes made after the fourth review. **The cap held:** it found no way to exceed it or to release money on a guess. The repeated-name hole (F1) was closed, and hold handling was right in every one of its cases: kept or settled as the status requires, one ending event, the timer stopped. 996 hostile streams, none settled below what a standard reader adds up; 23 real-shaped streams all settled at the exact cost; nothing weakened in the tests. **Three blocking findings**, all about the key and the record.

| # | Finding | Blocking | Done |
| --- | --- | --- | --- |
| G1 | With one backslash in front of the key, a key that begins with b, f, n, r or t still went back to the caller and into the event log: a JSON reader takes the backslash and the first letter as a tab or the like, so the parsed value looked clean, and writing it out again spelt the key. Present since `cedaced`; the commit before that cut it | Yes | The text about to be returned or stored is itself searched, last of all, and does not go out if the key is in it; and a text is also judged as it will be written into JSON. Tested on an error answer, a good answer and the token-counting pass-through, reading the log as the database stores it; the test fails on `583c689` |
| G2 | A backslash before `u` or `x` was never undone, so for a key containing either letter "a backslash before a character" was not covered. The suite's key has neither, so no test could see it | Yes | Escapes are undone in one pass that takes a backslash before any character. Tested with a key that has both letters, in a body that is JSON, one that is not, and a response header |
| G3 | Record sentences false: "65,536 backslashes" (measured 32,768); "byte for byte, with one exception" (there are more: the byte-order mark, invalid UTF-8, nesting); two of the items said to be in known gap 45 were not; and the sentences made false by G1 and G2 | Yes (records) | The paragraph on the key above is rewritten around the one last test and lists every exception found; the figure is given as tested and as measured; known gap 45 has the missing items |
| G4 | A named frame with empty data was passed over, so "every frame carries JSON data" was not exact | No | A named frame with no data keeps the hold; a frame with no name and no data is passed over. Tested both ways |
| G5 | An answer holding a NUL character, which the database's JSON type refuses, left its hold open with no note in the log | No | The character is written as `[NUL]` in what is stored. Tested |
| G6 | A served model named `constructor` or `__proto__` passed the price look-up and was stopped only by the store | No | The price look-ups ask only for the table's own entries. Tested |
| G7 | No limit on the size of a body searched: 16 MB of hostile text held the gateway for up to 8 seconds, 48 MB for up to 28 | No | A body of more than 8 million characters is not searched and not passed on; on a metered call the hold is kept. Tested. Below that size a hostile body can still hold the gateway for some seconds |
| G8 | Comments in the code that said "never" of the key, and one that described the earlier judging | No | Reworded |

Also reported and left as they are, recorded in known gap 45: an unknown usage field whose value is null is accepted as absent; two frames printed in the provider's streaming page are not valid JSON as printed (a stray brace, and "..." for brevity) and would keep the hold if a provider sent them so; a line ending of CR alone and a `data: [DONE]` frame keep the hold; a provider answer of status 204, or one with a `Trailer` header, gives the caller an error from the gateway (not part of this package's changes); how a mid-stream change of model is priced was not checked.

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
