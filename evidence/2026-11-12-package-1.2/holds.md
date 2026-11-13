# Package 1.2: holds stored in the database

| | |
| --- | --- |
| Date | 12 November 2026; finished to the owner's answer to his question 1 on 13 November 2026 (the section "Finished to the owner's answer to question 1"); the review of 13 November answered the same day (the last section) |
| Package | 1.2 of `docs/BUILD-PLAN.md`: "Holds stored in the database under a lock on the project's row: open, settle, expire, and recovery when the gateway starts" |
| Done means (plan, as amended 13 Nov) | "Proof rows B1 to B6 and B15 to B19 of design note 7.2, and only those, each shown from the event log against a stand-in provider." Rows B15 to B19 were added on 13 Nov 2026 by the owner's answer to his question 1 ("apply budget cap as long aswe can change it later", read by Claude Code as option (a); `docs/DECISIONS.md`). Until then the plan read "B1 to B6 ..., and only those" |
| Run on | The development machine (a cloud session), directly on the host: the builder's own gateway code, a local PostgreSQL database, and a **stand-in provider** in the same process. No model was called, no key exists, nothing was spent. (Three earlier tests in the suite send requests off the machine: one, of the egress proxy, sends a single request with no key to the provider's address and expects the refusal it gets; two check that the npm package registry can be reached. Nothing else in this package's runs leaves the machine.) No generated code and no engine ran |
| What a stand-in can and cannot show | It shows what the gateway does with the answers it is given. It shows nothing about how the real provider counts, bills or fails (plan section 8, rule 3) |
| State | **Built; not marked tested in this file.** On 13 Nov 2026 all eleven proof rows were run and passed against a stand-in, each by a named test and in the demonstration, and each row's test was shown to fail with its safeguard removed ("The eleven proof rows", below). Whether the package is tested is recorded in the plan's progress table, not here, and it is not marked tested there yet. Independent reviews are set out below with their answers, each under the commit it read: seven by a fresh reviewer told to break the cap, of `ebbcca5`, `15586fa`, `1fb2c87`, `cedaced`, `583c689`, `83443c9` and `f25c0e8` (the answers to the seventh read again twice, at `bdb4c28` and `f5d0a4b`); and, on 13 Nov 2026, a review of `592ed73` by three fresh reviewers (money, the merge, the records), each finding checked by two more ("The review of 13 Nov 2026 (commit `592ed73`) and its answers", the last section). In the last five of the seven (`1fb2c87` to `f25c0e8`) and in the money review of 13 Nov, no attack run was admitted past the cap (the limit checked when a call is admitted); the seven's blocking findings were about the key and the records, not the cap, and the review of 13 Nov found nothing blocking. None of that shows that a bill stays within its hold: see "What the cap enforces, and what it does not", below. The answers to the review of 13 Nov (commits `ac18aa8` onwards) have not yet been read by a fresh reviewer |

## What was built

- **A holds table in the database** (`builder/src/store/migrations/003_holds.sql`) and the functions that open, settle, keep, expire and find holds (`builder/src/store/holds.ts`). Every change to a hold made by the gateway is also written to the append-only event log.
- **The amount of a hold** (`builder/src/gateway/hold.ts`), a reservation worked out from the request, not a proven ceiling on the bill: the prompt as counted by the provider's own counting call (which the provider calls an estimate), plus an assumed margin of 5% plus 200 tokens (not measured), at the dearest input rate for that figure; the request's `max_tokens` (the most output the request allows) at the dearest output rate that could apply; doubled where fast mode could apply; rounded up.
- **Check-and-hold as one step** (`builder/src/gateway/app.ts`): the budget equation, spent plus open holds plus this hold against the cap, is checked and the hold is written inside one database transaction that locks the project's row. This is the limit the gateway enforces, and it is checked when a call is admitted. The gateway's old in-memory reservations and its estimate from the last three calls are gone.
- **Three ways out of the equation, and no others** (the third added after the review of 13 Nov): a hold is settled to the actual cost when the call ended with usage figures that were read and could be trusted (every count a whole number that is not negative, no list of separate attempts, no field the meter does not know, and the model that served it named as text); or it is settled at nothing when the provider's own error, in the provider's own error shape, says the request was turned away before any work; or it is settled at nothing, with the reason "the caller left before anything was sent to the provider" and no `model.call` event, when the caller has gone at the moment the gateway is about to forward the call (no wait stands between that check and the forward). Since the review of 13 Nov, a hold that allowed for fast mode is not settled on usage that leaves the speed out, and cache writes that an answer does not split into five-minute and one-hour are priced at the one-hour rate unless no `cache_control` in the request asks for a lifetime other than five minutes. A streamed answer counts as read only if the provider's end-of-message marker arrived, no error event did, no figure fell from one frame to the next, and every frame was framed as the provider frames it (at most one name; a named frame carries data; data is JSON; the name matches the type inside). A frame with no name and no data, such as a comment line, is passed over. Every other ending leaves the hold open at its full amount: a server error, any other error answer, a redirect, a stream cut part-way, the caller going away once the call may have been sent, a forward that fails (recorded as "the provider could not be reached" only when no connection was made, otherwise as "the connection failed after the request was sent, or may have been sent; the provider may have billed it"), an answer with no usage or with usage that cannot be trusted, an answer from a model with no price, the time limit, a database error while settling.
- **Refusals for what a hold cannot bound** (the "known limits" of design note 5.5): a prompt that cannot be counted; `max_tokens` missing or above the profile's ceiling; `inference_geo` other than the default; tools the provider runs itself, and tool servers; fast mode where the profile does not allow it or the model has no listed fast-mode price; **any request field outside a fixed list, and any beta feature not on the gateway's list** (added after the review).
- **On a metered call the body is forwarded as the gateway read it**, written out again, never the raw bytes; only a fixed list of request headers is passed on, and nothing after a "?" in the address. The token-counting pass-through, which costs nothing, still forwards the caller's body as sent.
- **Looking for the real key in what the gateway returns and stores.** Before an answer body from the provider that is not streamed goes back to the caller, and before a record of a forwarded call (which holds what the provider sent back) is written to the event log, its text is searched by one reader (`builder/src/gateway/key-reader.ts`) that asks: can the key be read out of this text by these three rules, in any mixture? (1) A character is taken as it is. (2) A backslash is ignored. (3) After a backslash, `uHHHH` or `xHH` may also be read as the character it names, and if that character is a backslash it counts as one. Where rules 2 and 3 both fit, both readings are followed. That covers the key written plainly, written inside JSON by a writer that escapes as `JSON.stringify` does, and such JSON written inside JSON again to any depth. **If the key is not found, the text the gateway read goes back as it is**, whatever its size up to the limit below, its nesting or its backslashes. (That text is not always the provider's exact bytes: the body is read as UTF-8 text, so a leading byte-order mark is dropped and a byte that is not valid UTF-8 is replaced.) **If the key is found**, a JSON body is parsed, each text in it cleaned, and written out again (which can change how a very long number is written, drops a repeated name, and cuts off anything nested more than 200 levels deep); any other body has the plain spelling cut out. The result is searched again, and if the key is still found the body is withheld: the caller gets a short error body in its place, with the provider's status. In practice, a good answer that carries the key is JSON, so it is cleaned, written out again and settled at the cost its usage figures give; a body that is withheld is one that is not JSON, whose usage cannot be read, so its hold is kept. A stored record in which the key is still found after cleaning is cut down to its plain fields. Response headers out of whose name or value the key can be read, in any letter case, are dropped. A body of more than 8 million characters is not searched and not passed on (on a metered call its hold is kept); the limit bounds the search, not the reading. **What the reader does not read, so that nobody takes this for more than it is:** an escape whose own letter or digits are themselves written as escapes or separated by backslashes; any other form of writing the key (base64, percent-encoding, HTML entities, UTF-16, `\u{2d}`, octal, `\U0000002d`); the body of a streamed answer, which is passed to the caller as it comes; and the text the database gives back, which is not character for character the text that was searched (it adds spaces, reorders names and rewrites numbers, so a key made only of digits, or one containing a colon and a space, could reappear there; a key of the usual shape was not seen to). The key is assumed to hold no backslash and no control character (tab, new line and the like): a key holding a tab, new line, carriage return, backspace or form feed, written into JSON, is not read (other control characters are written as `\u00XX` and are read). **Not searched at all:** the records the gateway writes when it refuses a request before forwarding it. They hold only what the caller sent (the requested model, the address, a beta-feature name, a field name, the step label), never anything from the provider; the step label is also stored, unsearched, beside the records of forwarded calls, for the same reason; the caller is the engine's container, which is given no key. **How long the search takes depends on the key:** about one second on 8 million hostile characters for a key of the usual random shape (under one second on the eight texts in `run-key-reader-timing.txt`; a reviewer measured up to 1.2 seconds for the reader and 2.7 for a whole call), but a reviewer measured about 18 seconds for a made-up key of 108 identical letters against a text built to match it.

## What the cap enforces, and what it does not

*Added on 13 Nov 2026, when this branch was brought up to date with the integration branch, after the outside review the owner supplied on 12 Nov (`docs/reviews/2026-11-12-outside-review-supplied-by-the-owner.md`, challenges 1 and 2).*

- **Enforced, at admission:** a call is forwarded only if the gateway's own priced spend, plus all open holds, plus this call's hold, is within the cap. It is checked when the hold is opened, in the locked transaction above. Spend is the gateway's own ledger, priced from its own table; it is not the provider's invoice. Shown against a stand-in by the demonstration, section B2, and the tests "B2".
- **Not enforced: that a bill stays within its hold.** A settled bill above its hold is charged in full, recorded as a `hold.exceeded` event, and raises a fault, which is a message written to the error output. **Shown against a stand-in** by the test "a bill above the hold is charged in full, recorded as a breach, and raises a fault", as extended on 13 Nov 2026 (Run 11): with a cap that had room for the one hold and no more, one bill above its hold took spend above the cap, and the next call was refused at admission; on a project with room left, the call after such a bill was admitted as usual, so the fault itself stops no later call while room remains (known gap 35). **Read in the plan, not shown:** the stop for a call that cannot be saved is package 1.4 (proof row B10); no package or proof row yet stops a project after a bill above its hold.
- **Not enforced: late answers.** An answer that arrives for a hold already kept or expired is written down with its cost, but not compared with the hold, and raises nothing.
- **The long-prompt rate** is held only when the counted prompt plus the margin reaches 100,000 tokens. A prompt counted below that but billed above it costs five times as much per token for Claude Haiku 5.5, by the gateway's price table.
- **The margin is assumed, not measured** (5% of the count plus 200 tokens). Tests show the arithmetic is applied; neither tests nor live runs can show that it always covers the bill.

So the hold is a reservation worked out from the provider's estimate plus an assumed margin, not a proven ceiling on the bill (known gaps 41 and 62).

## What this is and is not

In plain words, as of 13 Nov 2026:

- **It is a limit when a call is admitted.** The gateway forwards a call only if its own recorded spend, plus every open hold, plus this call's hold, is within the cap. Shown against a stand-in by rows B1, B2 and B6 below.
- **It is not a proven ceiling on the bill.** A hold is a reservation worked out from the provider's estimate plus an assumed margin. A bill above its hold is charged in full, and one such bill can take a project's spend above its cap (shown against a stand-in by the test "a bill above the hold is charged in full, recorded as a breach, and raises a fault", as extended on 13 Nov 2026).
- **Nothing stops a project after a fault yet.** A fault is a message written to the error output; the same test shows the next call admitted as usual after one, while room remains (shown against a stand-in). Read in the plan, not shown: the stop for a call that cannot be saved is package 1.4 (row B10); nothing in any package yet stops a project after a bill above its hold (known gap 35; whether something should is the owner's to decide).
- **Expired holds are kept open, as built.** A hold past its deadline stays open at its full amount until the owner reconciles it. Whether it should instead be settled at its full amount is the owner's question 5, still open; rows B5 and B6 are written for the kept-open reading.
- **"Shown" means run against a stand-in provider, with the run kept in this folder.** Nothing here shows how the real provider counts, bills or fails (plan section 8, rule 3).
- **Assumed, not shown:** the size of the margin, the list of tools let through, the list of request fields forwarded, that output never exceeds `max_tokens`, and that an error in the provider's own shape means nothing was billed (known gaps 41 and 62).

## The eleven proof rows

Rows B1 to B6, and B15 to B19 (added 13 Nov 2026: one for each case of known gap 41 that this package handles, named as gap 41 names it). Every test named here is in `builder/test/gateway.test.ts`. Runs, all in this folder and all from commit `94b800c`: the demonstration, `run-2026-11-13-demonstration.txt` (one section per row); the eleven rows' tests on their own, `run-2026-11-13-proof-row-tests.txt` (13 tests, all passed); and the controls, `run-tests-with-fixes-removed.txt` (each row's test run once with its safeguard removed; every one failed; listed in Run 6 below). Each row's result is **shown, against a stand-in**. After the review of 13 Nov the demonstration was run again (Run 8, `run-2026-11-13-after-review-demonstration.txt`) and every row's test ran in the whole suite (Run 11); what changed is said in the rows B6 and B18 below.

| Row | What it shows | The test, the demonstration section, the control | What it does not show |
| --- | --- | --- | --- |
| B1 | When each of two calls reaches the stand-in, its hold is already open in the database. `hold.opened` carries the arithmetic (prompt count, margin, `max_tokens`, rates); `hold.settled` gives the actual cost, never above the hold in these calls, and the difference goes back to the budget | Test "B1: a hold is opened before the call is forwarded and settled to the actual cost"; demonstration, section B1; controls 1 and 2 | That a real bill equals the stand-in's. "Actual cost never above the hold" is checked on these calls, not enforced |
| B2 | A call whose hold does not fit is refused at admission: 402, the message shown, a `gateway.refused` event, no hold, nothing forwarded. Six calls arriving together through two gateway instances, against room for one hold: one admitted | Tests "B2: a call whose hold does not fit is refused at the call: no hold, nothing forwarded" and "B2: with calls arriving together against room for one hold, one is admitted, through one gateway or two"; section B2; control 3 | Two gateway processes: the test's two instances share one process (a reviewer's run of two processes is not saved here). That spend stays within the cap after admission: a bill above its hold can take it over |
| B3 | A prompt that cannot be counted is refused with the reason named; no hold, nothing forwarded | Test "B3: a prompt that cannot be counted is refused, with the reason named"; section B3; control 4 | How the real counting call fails |
| B4 | (1) Claude Haiku 5.5 with a prompt counted just under 100,000 tokens is held at the long-prompt rates, because the count plus the margin reaches the threshold. (2) Claude Opus 5.5 on a profile that allows fast mode is held at twice the standard rates, though the request does not ask for it | Tests "B4 (1): a model with a long-prompt rate is held at that rate when the prompt is at or near the threshold" and "B4 (2): on a profile that allows fast mode, a model with a fast-mode price is held at twice the standard rates"; section B4; controls 5 and 6 | A prompt counted below the threshold by more than the margin but billed above it (known gap 41) |
| B5 | A hold past its deadline is kept open at its full amount, marked expired and unreconciled, and still counted: a further call is refused | Test "B5: a hold past its deadline is kept at its full amount, marked expired and unreconciled, and still counts"; section B5; control 7 | The other answer to the owner's question 5 (settle it at its full amount), which is not built |
| B6 | A gateway that starts finds the hold an earlier gateway instance left open, keeps it at its full amount and still counts it; spend plus open holds reads the same before and after | Test "B6: holds are database rows: a gateway that starts finds the hold an earlier one left open, and keeps it"; section B6; control 8 | **A gateway that has stopped.** The first gateway is not stopped: its server is closed, but both gateways run in one process, and its request handler writes the call's ending (`hold.kept`) before or after the second gateway's start-up scan, as the timing falls: after it in Run 4, before it in Run 1 and Run 8. So the hold found may be one the first gateway is still ending. The demonstration said "the gateway is now stopped" in Runs 1 and 4; since Run 8 it says what is done and prints the order. A gateway process killed outright is package 1.4, row B9 |
| B15 | Known gap 41, "`inference_geo` "us" (1.1 times every rate)": a request with `inference_geo` "us" is refused before anything is forwarded (reason `inference_geo_not_allowed`, message shown, `gateway.refused`, no hold); the same request without it is forwarded | Test "B15: inference_geo "us" (1.1 times every rate): a request that sets it is refused before anything is forwarded"; section B15; control 9 | The provider's price for "us", which comes from its pricing page, not from a run |
| B16 | Known gap 41, "the token count being an estimate": every hold carries the margin, checked by its own figures (5% of the count rounded up, plus 200 tokens: 42 counted, 203 added; 10,000 counted, 700 added). A stand-in bill 4% above the count, all at the dearest input rate and with all of `max_tokens`, is settled within the hold; by arithmetic, a hold without the margin would have been below that bill | Test "B16: the token count being an estimate: a margin is added to the counted prompt, and a bill a little above the count stays within the hold"; section B16; control 10 | **Only that a margin is applied.** Whether it is large enough for the real provider's count needs a real provider (package 2.3); its size is an assumption |
| B17 | Known gap 41, "server-side tools billed on top of tokens": a request with a tool the provider runs itself (a web search type; a code execution type) and one asking for tool servers (`mcp_servers`) are each refused before anything is forwarded (reason `server_tool_not_allowed`, message shown, `gateway.refused`, no hold); the caller's own tools are forwarded | Test "B17: server-side tools billed on top of tokens: a request that includes one, or asks for tool servers, is refused before anything is forwarded"; section B17; controls 11 and 12 | That the tool types let through (`bash_` and `text_editor_` with a date, and the caller's own) are all run by the caller, or are what the engine sends (package 2.2) |
| B18 | Known gap 41, "fast mode on a model whose price is assumed": on a profile that allows fast mode, fast mode asked for Claude Sonnet 5.5 or Claude Haiku 5.5 (no listed fast-mode price) is refused before anything is forwarded (reason `fast_mode_not_priced`, message shown, `gateway.refused`, no hold); asked for Claude Opus 5.5 (listed) it is forwarded and held at twice the standard rates. In Run 4 that call was settled at the standard price ($0.06), because the stand-in's usage left the speed out and the gateway read that as standard; since the review of 13 Nov such usage keeps the hold, and in Run 8 the stand-in states the speed and the call is settled at the fast-mode price ($0.12) | Test "B18: fast mode on a model whose price is assumed: a request for it is refused before anything is forwarded, even where the profile allows fast mode"; section B18; control 13 | The provider serving fast mode when it was not asked for: that is seen only after the call (known gap 62) |
| B19 | Known gap 41, "What happens to a hold after an error answer was not defined": the provider's own rejection before work (a 400 `invalid_request_error`; in the test also a 429 `rate_limit_error`) settles the hold at nothing. A 500, a 529 (overloaded), a 408 and a 400 not in the provider's error shape each keep the hold open at its full amount, with the reason in a `hold.kept` event, still counted: a further call that would not fit beside it is refused | Test "B19: what happens to a hold after an error answer: released only when the provider's own answer shows the request was rejected before any work, kept in every other case"; section B19; control 14 | Whether the real provider ever bills a request it rejected; something between the gateway and the provider that sends the provider's exact error shape cannot be told apart from it (known gap 62). **The kept hold is not marked unreconciled** in this package, though design note 5.5's table of known limits says "kept, unreconciled" (known gap 62) |

## Run 1 (12 Nov 2026, rows B1 to B6, before the merge): the demonstration (`npx tsx scripts/demo-cap.ts`, from `builder/`)

The run of 13 Nov, with all eleven rows, is `run-2026-11-13-demonstration.txt` (Run 4, at the end of this file).

Everything below "event" is read back from the event log; "the hold's row" is read from the holds table.

```text
Stand-in provider only: no real provider is called and nothing is spent.
Prices used: Claude Opus 5.5 input $4, one-hour cache write $8, output $20 per million tokens; Claude Haiku 5.5 one-hour cache write $0.20 and output $0.50, or $1.00 and $2.50 over 100,000 prompt tokens.

== B1. A hold is opened before every forwarded call and settled to the actual cost ==
  call 1: HTTP 200
  call 2: HTTP 200
  event hold.opened: hold #126084 for $0.125600
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.085600
      max_tokens 2000 at $20 per million = $0.040000; fast-mode factor 1; both parts include the factor
  event model.call: status 200, billed 10000 input and 1000 output tokens, actual cost $0.060000
  event hold.settled: hold #126084 of $0.125600 settled at $0.060000; $0.065600 returned to the budget
  event hold.opened: hold #126085 for $0.125600
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.085600
      max_tokens 2000 at $20 per million = $0.040000; fast-mode factor 1; both parts include the factor
  event model.call: status 200, billed 10000 input and 1000 output tokens, actual cost $0.060000
  event hold.settled: hold #126085 of $0.125600 settled at $0.060000; $0.065600 returned to the budget
  budget afterwards: cap $1.000000 | spent $0.120000 | open holds $0.000000 (0) | spent + open holds = $0.120000
  actual cost never above the hold: yes

== B2. A call whose hold does not fit is refused at the call ==
  call 1: HTTP 200
  budget before call 2: cap $0.150000 | spent $0.060000 | open holds $0.000000 (0) | spent + open holds = $0.060000
  call 2: HTTP 402 (budget_reached)
  message shown: "This project has reached its budget of $0.15 (spent $0.06, with $0.00 held for work in progress or awaiting reconciliation; this call needed up to $0.13). The gateway will forward nothing more until the budget is raised."
  calls that reached the provider during call 2: 0
  event hold.opened: hold #126086 for $0.125600
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.085600
      max_tokens 2000 at $20 per million = $0.040000; fast-mode factor 1; both parts include the factor
  event model.call: status 200, billed 10000 input and 1000 output tokens, actual cost $0.060000
  event hold.settled: hold #126086 of $0.125600 settled at $0.060000; $0.065600 returned to the budget
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
  event hold.opened: hold #126087 for $0.107595
      prompt counted 99900 tokens + margin 5195 = 105095 at $1 per million (one-hour cache write, long-prompt price) = $0.105095
      max_tokens 1000 at $2.5 per million = $0.002500; fast-mode factor 1; both parts include the factor
  event model.call: status 200, billed 99900 input and 500 output tokens, actual cost $0.010240
  event hold.settled: hold #126087 of $0.107595 settled at $0.010240; $0.097355 returned to the budget
  the same model with a prompt counted at 1,000 tokens, for comparison:
  event hold.opened: hold #126088 for $0.000750
      prompt counted 1000 tokens + margin 250 = 1250 at $0.2 per million (one-hour cache write) = $0.000250
      max_tokens 1000 at $0.5 per million = $0.000500; fast-mode factor 1; both parts include the factor
  event model.call: status 200, billed 1000 input and 500 output tokens, actual cost $0.000350
  event hold.settled: hold #126088 of $0.000750 settled at $0.000350; $0.000400 returned to the budget
  (2) Claude Opus 5.5 on a profile that allows fast mode (the request does not ask for it):
  call: HTTP 200
  event hold.opened: hold #126089 for $0.251200
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.171200
      max_tokens 2000 at $20 per million = $0.080000; fast-mode factor 2 (the profile allows it); both parts include the factor
  event model.call: status 200, billed 10000 input and 1000 output tokens, actual cost $0.060000
  event hold.settled: hold #126089 of $0.251200 settled at $0.060000; $0.191200 returned to the budget

== B5. A hold past its deadline is kept, not released ==
  this gateway cuts a call off after 0.2 seconds and gives its hold a deadline 0.2 seconds later; the stand-in does not answer in time
  call: HTTP 502
  budget after the cut-off: cap $0.200000 | spent $0.000000 | open holds $0.125600 (1) | spent + open holds = $0.125600
  holds marked expired once the deadline had passed: 1
  the hold's row: state open, amount $0.125600, expired true, unreconciled true, actual cost not known
  event hold.opened: hold #126090 for $0.125600
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.085600
      max_tokens 2000 at $20 per million = $0.040000; fast-mode factor 1; both parts include the factor
  event hold.kept: hold #126090 of $0.125600 kept open; reason: the call reached its time limit
  event hold.expired: hold #126090 of $0.125600; kept true, unreconciled true, still open true
  budget after expiry: cap $0.200000 | spent $0.000000 | open holds $0.125600 (1) | spent + open holds = $0.125600
  a further call, to show the expired hold still counts: HTTP 402

== B6. Holds are database rows that survive the gateway stopping ==
  a call is in flight through gateway gw_demo_first; the gateway is now stopped
  budget with the first gateway stopped: cap $0.200000 | spent $0.000000 | open holds $0.125600 (1) | spent + open holds = $0.125600
  a second gateway, gw_demo_second, starts on the same database and looks for open holds
  the hold's row: state open, amount $0.125600, opened by gw_demo_first
  event hold.opened: hold #126091 for $0.125600
      prompt counted 10000 tokens + margin 700 = 10700 at $8 per million (one-hour cache write) = $0.085600
      max_tokens 2000 at $20 per million = $0.040000; fast-mode factor 1; both parts include the factor
  event hold.kept: hold #126091 of $0.125600 kept open; reason: the caller disconnected before the answer arrived
  event hold.found_at_startup: hold #126091 of $0.125600, opened by gw_demo_first, found by gw_demo_second; kept true, still open true
  budget after the second gateway started: cap $0.200000 | spent $0.000000 | open holds $0.125600 (1) | spent + open holds = $0.125600
  spent + open holds the same before and after: yes
  a call through the second gateway, to show the hold still counts: HTTP 402

Every call that reached the provider carried the gateway's key, never a project token: yes (8 calls).
```

"Actual cost never above the hold: yes" is a check on the two calls of section B1, against a stand-in that bills what it is told to; it says nothing about the real provider's bills. The B3 message above is the code's text at the time of this run; on 13 Nov it was reworded ("Brought up to date with the integration branch", below).

Note on the B2 message (13 Nov 2026): "this call needed up to $0.13" is the approved wording (design note 5.5, "What the user sees"), which, like 5.5's sentence "The hold is meant to be the most this call can cost", describes the hold as the most a call can cost; these records say it is a reservation, not a proven ceiling. The wording is kept as approved; changing it is the owner's (known gap 62). Note on B6: "the gateway is now stopped" is not what was done; see row B6.

## Run 2 (12 Nov 2026): the type check and every test, by name

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
 ✓ test/gateway.test.ts > holds: found by review, and kept fixed > does not store or relay the real key when the provider's error echoes it
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
 ✓ test/gateway.test.ts > holds: found by the third review, and kept fixed > an answer nested very deeply does not make the call fail: its hold is kept with a note in the log
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
 ✓ test/gateway.test.ts > holds: found by the fifth review, and kept fixed > an answer with 30,000 backslashes in a row and no key in it goes back exactly as it was read
 ✓ test/gateway.test.ts > holds: found by the fifth review, and kept fixed > an answer holding half of a surrogate pair, which the database refuses, still gets its ending written down
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
 ✓ test/egress.test.ts > egress proxy > matches exact hosts and wildcard subdomains, nothing else
 ✓ test/egress.test.ts > egress proxy > lets an allowed HTTPS host through and logs it as allowed
 ✓ test/egress.test.ts > egress proxy > reaches the model API host (401 without a key means it was reached)
 ✓ test/egress.test.ts > egress proxy > refuses a host that is not on the list and logs the refusal
 ✓ test/egress.test.ts > egress proxy > refuses a plain HTTP request to a host not on the list
 ✓ test/key-reader.test.ts > the key reader > finds the key written plainly, and nothing in a text without it
 ✓ test/key-reader.test.ts > the key reader > ignores backslashes, one or many, anywhere in the key
 ✓ test/key-reader.test.ts > the key reader > reads \\uHHHH and \\xHH as the character they name, in either letter case of the digits
 ✓ test/key-reader.test.ts > the key reader > follows both readings where a backslash stands before a u or an x that is part of the key
 ✓ test/key-reader.test.ts > the key reader > reads an escape whose backslash is itself written as an escape, and escapes inside escapes
 ✓ test/key-reader.test.ts > the key reader > does not take a text for the key when the escapes name other characters
 ✓ test/key-reader.test.ts > the key reader > does not read an escape whose own letter or digits are themselves escaped: the stated limit
 ✓ test/key-reader.test.ts > the key reader > finds the key however it is written within the three rules: 3,000 random keys, every character spelt at random
 ✓ test/events.test.ts > event log > appends and lists events in order
 ✓ test/events.test.ts > event log > refuses to update an event
 ✓ test/events.test.ts > event log > refuses to truncate the event log
 ✓ test/events.test.ts > event log > refuses to delete an event
 ✓ test/app-spec.test.ts > app spec > accepts the fixed brief for test example 1 (leave request)
 ✓ test/app-spec.test.ts > app spec > names the problem in plain words when a screen is for an unknown role
 ✓ test/app-spec.test.ts > app spec > refuses a choice field with no choices
 ✓ test/app-spec.test.ts > app spec > refuses more than five core actions
 Test Files  6 passed (6)
      Tests  100 passed (100)
exit code: 0
```

## Run 3 (12 Nov 2026): the licence check committed for `builder/` (`npm run check:licences`)

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
| N2 | The key was removed only from the raw text of a metered error body; it could still reach the log or the caller through response headers, an escaped spelling, the served-model field, or the pass-through's error body. The record said more than the code did | Yes (the record) | Everything stored for a call is searched after parsing; headers carrying the key are dropped; the pass-through's body and a plain answer's body have it removed. Tested. The body of a streamed answer is still passed on as it comes; the sentence above says so, and known gap 62 |
| N3 | The lock was sound only at the database's default isolation level, which the code did not state. With "repeatable read" as the default, 10 of 30 calls were admitted against room for one | No | Every budget transaction now states "read committed". Tested with a connection whose default is "repeatable read": one admitted, 29 refused |
| N4 | The migration that reopens a hold settled at an invalid amount left the old negative cost counting as spent, and wrote no event | No (test data only) | The budget counts as spent only a cost that is a real, non-negative amount whose hold is settled; a hold that is open again is counted once, as an open hold. The reopening is written to the log. Tested |
| N5 | Usage could still be trusted when it should not be: an unknown speed, cache-write items that do not add up, signs of charges outside the token rates, two starts in one stream, a running total that falls, all zeros | No | Each now keeps the hold. Tested |
| N6 | Request headers and the query string were passed through unexamined | No | A fixed list of five headers is passed on; a request with anything after "?" in the address is refused. Tested |
| N7 | This file said "tested" of two store behaviours that had no test, and two sentences were true of the metered path only | No | Tests added; the sentences corrected above |
| N8 | Small: a profile named like a built-in word got no limits; a cost of $100 million or more overflowed the column; actual costs were rounded to nearest | No | The profile look-up is exact; such a cost keeps the hold; costs are rounded up. Tested, except the overflow |
| N9 | The committed licence report for `builder/` lacked four packages that are installed | No | Regenerated and committed. It is specific to this machine |

Recorded by the reviewer and left as they are, in known gap 62: something between the gateway and the provider that sends the provider's exact error shape cannot be told apart from it; whether the provider ever returns a rejection after generating is unchecked; a "thinking" budget larger than `max_tokens` is forwarded on the assumption that the provider bounds thinking by `max_tokens`; if the real provider answers with dated model names not in the price table, every call's hold will be kept until the table has them.

## The third review (commit `1fb2c87`) and what was done

A third fresh reviewer, told to break the cap, went through the second review's nine findings again and attacked the package as a whole. **N1, N3, N5 (as listed), N6, N7, N8 and N9: fixed. N4: fixed for everything the gateway writes. N2: fixed in part** (finding 1 below). **What held:** 49 ways of ending a stream, none releasing a hold on partial figures; two real gateway processes with 40 calls at once at three isolation levels, one admitted every round (the same attack on the earlier commit `15586fa` at "repeatable read" admitted 9 of 30); 1,200,000 random costs, none above its hold and none under-recorded; a hold exactly equal to the room left admitted and one millionth more refused; 720 calls racing the deadline and start-up sweeps with no inconsistency; a gateway process stopped, and one killed, mid-call, with the hold found by the next process. It reported rows **B1 to B6 shown**, no pre-existing check weakened, and no way found to be admitted past the cap or to release money on a guess. Those runs are the reviewer's; their output is not saved here.

| # | Finding | Blocking | Done |
| --- | --- | --- | --- |
| 1 | A body that spelt the key with backslash escapes was passed to the caller unchanged: the raw text did not contain the key, but the caller's own JSON reader would produce it. The record said bodies "have it removed" and that an escaped spelling was tested; the test looked at the raw text only | Yes (the key reaching the caller, and the record) | A JSON body is cleaned as the caller will read it and written out again; a body that is not JSON and carries such a spelling is withheld. The pass-through is covered. Tests now parse what the caller receives, on five metered answers and two pass-through answers. The record above says what is and is not covered |
| 2 | An event not written by the gateway could make the budget unreadable (a hold number that is not a whole number) or wrong (a hold that does not exist or belongs to another project was not counted) | No | A new view (`006_budget_view_guards.sql`): such a hold number no longer stops the view, and a cost is left out of "spent" only when it names an open hold of the same project. Tested; the earlier view shown failing on the same event. Still as they were: two events for one settled hold both count (over-counting); a cost written as text is not counted. The gateway writes neither |
| 3 | Stream figures that contradict each other could still be settled: a frame named "error" with other data; an input or cache figure that falls; a first frame with more output than the last; a model given as a list | No | Each now keeps the hold: a frame named "error" is an error whatever its data; no figure may fall from one frame to the next and fast mode may not be taken back; a model must be text. Tested, six cases |
| 4 | Usage carrying a field the meter does not know was read and settled at token rates | No | Usage is read only if every field in it is one the provider's reference lists (`docs/SOURCES.md`); an unknown field, or an unknown kind of cache write, keeps the hold. The documented breakdown of output tokens is accepted, and tested not to stop a call settling. **Consequence:** if the provider adds a usage field, every call's hold is kept until the list has it |
| 5 | A response header named after the key reached the caller in lower case; broken JSON in an error body was stored with an escaped spelling in it | No | Headers are compared without regard to letter case; text that carries an escaped spelling is withheld before it is stored. Tested for the header |
| 6 | Records: known gap 62 said the first review's corrections awaited review; the reopening event written by migration 005 has no test; the plan's table said "the first review" | No | The two records are reworded. The reopening event still has no automated test: the reviewer ran it by hand (one event, written once) |
| 7 | An assumption to record: beta features and anything after "?" fail loudly, but other headers are dropped silently, which package 2.2 will meet | No | The names, never the values, of headers not passed on are now written into the call's event. Tested. Recorded in known gap 62 |

Also reported and left as it is: reading the budget takes longer as a project's calls grow, inside the project lock (the reviewer measured about 37 ms at 20,000 settled calls and about 145 ms at 100,000). Recorded in known gap 62.

## The fourth review (commit `cedaced`) and what was done

A fourth fresh reviewer read only the changes made after the third review, and attacked each. **No way was found to be admitted past the cap** (the limit at admission) or to release money on a guess, against a provider that keeps to its documented format. Findings 2 to 7 of the third review: done as stated (375 hand-written events against the budget view with no error, no under-count and no over-count against the stated rule; 42 streams; the list of usage fields compared with the provider's live reference, nothing documented missing). **Finding 1, the key in a body: not done**, and the fix for it had opened a new hole.

| # | Finding | Blocking | Done |
| --- | --- | --- | --- |
| F1 | **Introduced by the previous fix.** A JSON body was judged only after parsing. A JSON reader keeps the second of two members with the same name and drops the first; with nothing found in the parsed value, the provider's raw bytes went back, the dropped member included. So the key in its plain spelling, in a repeated member, reached the caller, where the commit before had cut it. 240 of the reviewer's 1,008 bodies leaked this way; the event log stayed clean in all | Yes | The raw bytes go back only if the raw text is clean as well as the parsed value; otherwise the cleaned value is written out. Tested for a plain and an escaped spelling in a repeated member, on an error answer and a good one; the tests fail on `cedaced` |
| F2 | Record sentences made false by F1, and "goes back byte for byte" was absolute though a text with 32 backslashes in a row was replaced | Yes (records) | The sentences above now say what is done and name the exceptions; the rounds were moved from 6 to 16. A body with 80 backslashes in a row, and one with 30,000, are tested to come back as read. (This cell first said "65,536 in a row"; the fifth review measured 32,768) |
| F3 | A stream framed otherwise than the provider frames it could be settled at the lower of two figures: a frame behind a "blank line" of LF then CR LF, or of CR alone; an unnamed frame with broken JSON; two names in one frame; a name that disagrees with the type inside; a start frame with no message | No | Each now keeps the hold: lines end as the event-stream format allows, a frame has at most one name, its data must be JSON, and its name must match its type. Tested, eight cases, with fast mode taken back among them |
| F4 | A model given as empty text was accepted; on a plain answer a missing model was priced as the model asked for | No | An answer must name the model that served it, as text that is not empty, or its hold is kept. Tested |
| F5 | A body nested about 5,000 levels deep made the gateway fail: the caller got a bare error, no note was written for the kept hold, and the call's timer was left running | No | Nothing is walked deeper than 200 levels; a body that cannot be written out again is withheld; the timer is stopped first. Tested with 20,000 levels: the hold is kept with its note |
| F6 | The earlier view was "shown failing" with no output saved; a comment in the new migration said "made safe" | No | Output saved in `run-earlier-view.txt`; the comment reworded |
| F7 | Row 4 of the third review read as if every unknown usage field keeps the hold | No | Said exactly here: an unknown field at the top of the usage block, or an unknown kind of cache write, keeps the hold. An unknown member inside the breakdown of output tokens is accepted if it is a count no larger than the output total; an unknown member inside the provider-run tools block is accepted only at zero |

Left as they are and recorded in known gap 62: a repeated name inside a usage block or a frame is read as a JSON reader reads it, the last one winning, so a provider that sent two different figures under one name would be settled on the second; a body that carries the key is written out again whole, which can change how a very long number is written; two events with costs near the largest number the database holds stop the budget view, which then refuses everything for that project; a cost that is not a number is not counted; the names of request headers are the caller's own text and are logged as sent, except that a name containing the gateway's key is replaced.

## The fifth review (commit `583c689`) and what was done

A fifth fresh reviewer read only the changes made after the fourth review. **No way was found to be admitted past the cap** (the limit at admission) or to release money on a guess. The repeated-name hole (F1) was closed, and hold handling was right in every one of its cases: kept or settled as the status requires, one ending event, the timer stopped. 996 hostile streams, none settled below what a standard reader adds up; 23 real-shaped streams all settled at the exact cost; nothing weakened in the tests. **Three blocking findings**, all about the key and the record.

| # | Finding | Blocking | Done |
| --- | --- | --- | --- |
| G1 | With one backslash in front of the key, a key that begins with b, f, n, r or t still went back to the caller and into the event log: a JSON reader takes the backslash and the first letter as a tab or the like, so the parsed value looked clean, and writing it out again spelt the key. Present since `cedaced`; the commit before that cut it | Yes | The text about to be returned or stored is itself searched, last of all, and does not go out if the key is in it; and a text is also judged as it will be written into JSON. Tested on an error answer, a good answer and the token-counting pass-through, reading the log as the database stores it; the test fails on `583c689` |
| G2 | A backslash before `u` or `x` was never undone, so for a key containing either letter "a backslash before a character" was not covered. The suite's key has neither, so no test could see it | Yes | Escapes are undone in one pass that takes a backslash before any character. Tested with a key that has both letters, in a body that is JSON, one that is not, and a response header |
| G3 | Record sentences false: "65,536 backslashes" (measured 32,768); "byte for byte, with one exception" (there are more: the byte-order mark, invalid UTF-8, nesting); two of the items said to be in known gap 62 were not; and the sentences made false by G1 and G2 | Yes (records) | The paragraph on the key above is rewritten around the one last test and lists every exception found; the figure is given as tested and as measured; known gap 62 has the missing items |
| G4 | A named frame with empty data was passed over, so "every frame carries JSON data" was not exact | No | A named frame with no data keeps the hold; a frame with no name and no data is passed over. Tested both ways |
| G5 | An answer holding a NUL character, which the database's JSON type refuses, left its hold open with no note in the log | No | The character is written as `[NUL]` in what is stored. Tested |
| G6 | A served model named `constructor` or `__proto__` passed the price look-up and was stopped only by the store | No | The price look-ups ask only for the table's own entries. Tested |
| G7 | No limit on the size of a body searched: 16 MB of hostile text held the gateway for up to 8 seconds, 48 MB for up to 28 | No | A body of more than 8 million characters is not searched and not passed on; on a metered call the hold is kept. Tested. Below that size a hostile body can still hold the gateway for some seconds |
| G8 | Comments in the code that said "never" of the key, and one that described the earlier judging | No | Reworded |

Also reported and left as they are, recorded in known gap 62: an unknown usage field whose value is null is accepted as absent; two frames printed in the provider's streaming page are not valid JSON as printed (a stray brace, and "..." for brevity) and would keep the hold if a provider sent them so; a line ending of CR alone and a `data: [DONE]` frame keep the hold; a provider answer of status 204, or one with a `Trailer` header, gives the caller an error from the gateway (not part of this package's changes); how a mid-stream change of model is priced was not checked.

**Note on the rows above that are about the key** (third review, row 1; fourth review, F1 and F2; fifth review, G1, G2, G3 and G7): they describe what was done at the time, by undoing escapes in rounds, with the figures of the time. That way of looking was replaced after the sixth review, below; the paragraph on the key near the top of this file describes what the code does now.

## The sixth review (commit `83443c9`) and what was done

A sixth fresh reviewer read only the changes made after the fifth review: 94,736 calls with 16 keys. **No call was admitted past the cap; B1 to B6 still shown; nothing weakened in the tests; no path returns or stores the provider's text outside the three cleaning functions, apart from the streamed body.** For 15 of its 16 keys nothing got through. **Three blocking findings:**

| # | Finding | Blocking | Done |
| --- | --- | --- | --- |
| H1 | A key that itself contains `u` followed by four hex digits, or `x` followed by two, still got through with a backslash put in front of that spot: undoing escapes read `\x41` as "A", never as the key's own "x41". About one random key in five has such a spot | Yes | The way of looking was replaced. Instead of undoing escapes in rounds, one reader goes through the text once and follows both readings wherever both fit (the three rules in the paragraph on the key, above). Tested with the reviewer's key, and by a test that writes 3,000 random keys with every character spelt at random within the rules |
| H2 | "30,000 backslashes tested to pass; limit 32,768" was false: the last change had halved the limit to 16,384, and above it a clean body was written out again or replaced; the test could not see it | Yes (records) | There is no such limit any more: a body in which the key is not found goes back as read, whatever its backslashes. The test now compares the whole body, character for character, with a long number and odd spacing in it |
| H3 | A hostile body under the size limit held the gateway for about 17 seconds, against under 1 before the last change | Left to the author | The one-pass reader took under one second on each of eight hostile texts of 8 million characters, the reviewer's among them (`run-key-reader-timing.txt`, one run on this machine) |
| | Half of a surrogate pair in what is stored was refused by the database, like the NUL character: the hold stayed open with no note | No | Replaced by a visible mark in what is stored. Tested |
| | A clean body nested more than 200 levels deep was changed | No | A body in which the key is not found is no longer touched. Tested; **one earlier assertion was changed for this**: the fourth review's test expected a deeply nested answer to be withheld, and it now expects it back as read, with a second half for a deeply nested answer that does carry the key, which comes back with the key cut out and its nesting cut at 200 levels (this cell first said "withheld"; the seventh review found it rewritten, as the paragraph on the key describes) |
| | Not said: what happens to a good answer that carries the key; UTF-16 and the database's own rewriting of the stored text are not covered; the size limit bounds searching, not reading | No | Said in the paragraph on the key, above (the sentence on a good answer was corrected after the seventh review) |
| | Absolute wording about the key in a test title and three comments | No | Reworded |
| | The test suite includes an earlier test of the egress proxy that sends one request with no key to the provider's address and expects it to be refused; "no real provider was called" was not exact | No | Said in the "Run on" row at the top of this file |

**A trade made in this round, for the owner and the reviewing engineer to confirm.** The round-by-round undoing of escapes, now removed, happened to catch some writings that the one-pass reader does not: an escape whose own letter or digits were escaped again by a further layer. The reader is exact about what it reads, has no size or count limits of its own, follows both readings where two fit, and is fast for a key of the usual shape; the price is that class, which is now listed as not read. (An example quoted here after the seventh review turned out, when tested, to be read by the reader after all, so it is removed: the class is shown by the comparison that follows, not by an example.) In 7.5 million random texts that reviewer compared, the earlier approach caught 43 that the reader missed, each holding a `\u` or `\x` whose own letter or digits are interrupted by a backslash; the reader caught 112 that the earlier approach missed. Nothing merged is changed by this (the package is on its own branch), and no test was removed. Recorded in `docs/DECISIONS.md` and known gap 62.

## The seventh review (commit `f25c0e8`) and what was done

A seventh fresh reviewer read the changes since `83443c9` with the claim stated as "the key cannot be read out of what goes out, by the three rules". **The reader matches its three rules:** no disagreement with two reference readers of its own over 19.2 million random texts and 243 million exhaustive comparisons. **The wiring holds:** 66,104 real calls with 10 keys, every status path, about 45 body and header shapes; no key readable in any returned body, response header or stored record, and none of 7,282 key-carrying headers passed on; every call had exactly one ending and every hold matched the reviewer's own sums. **No call was admitted past the cap; B1 to B6 still shown; nothing in the tests weakened.** A body without the key came back character for character in every case, up to 8,000,000 characters. Three sentences in this file were false; nothing in the code was blocking.

| # | Finding | Blocking | Done |
| --- | --- | --- | --- |
| K1 | "That is the only request that leaves the machine": two more tests of the suite reach the npm package registry | Yes (records) | Corrected in the "Run on" row |
| K2 | A deeply nested answer carrying the key was said to be "withheld"; it is rewritten with the key cut out. A comment in the test said the same | Yes (records) | Corrected in the sixth-review table and in the test's comment; the test's assertions were already true of what happens |
| K3 | "Before a record is written to the event log, its text is searched" was false for the records of refused requests, which hold the caller's own text unsearched (a model name equal to the key is stored as sent) | Yes (records) | The paragraph on the key now says which records are searched, and says that refusal records are not, and why: they hold only what the caller sent, and the caller is the engine's container, which has no key |
| | A key holding a control character (a tab, a new line) is not read once written into JSON | No | Added to the assumptions in the paragraph on the key |
| | "A withheld good answer arrives as status 200 … and its hold is settled" could not be produced: a good answer carrying the key is JSON, so it is rewritten and settled; what is withheld is not JSON, so its hold is kept | No | Reworded in the paragraph on the key |
| | The trade was described abstractly | No | An example and the reviewer's comparison added to the trade paragraph |
| | The reader's speed depends on the key: about 18 seconds for a made-up key of 108 identical letters against a text built to match | No | Said in the paragraph on the key and in known gap 62 |
| | The reader's tests catch a reader that misses the key, not one that reads too much (which would withhold innocent bodies, not leak) | No | Left as it is; recorded here |
| | A comment described a branch of the code that the reviewer could not reach; known gap 62 said the "very text" stored is searched, though the store adds the hold's own fields around it | No | The comment and the gap reworded |

## The re-reads after the seventh review

The seventh reviewer read the answers to its findings twice more. Of `bdb4c28` (the three false sentences corrected): all three true as written; one new blocking item, the example added to the trade paragraph, which was wrong as written. Of `f5d0a4b` (the example removed, the 43/112 comparison kept, three sentences reworded): "nothing blocking left; every sentence you asked about is true as written". No change to what the code does was made after `f25c0e8`.

## What this does not show

- **Nothing about the real provider.** Whether its token count is close enough for the margin, whether its bills match the gateway's arithmetic, how it fails: all untested until package 2.3.
- **The margin on the count is an assumption** (5% of the count plus 200 tokens), not a measurement. So is the list of tools the gateway lets through. Both are in `docs/KNOWN-GAPS.md`. Row B16 shows only that the margin is applied.
- **A hold kept after an error answer is not marked unreconciled** (row B19); only expiry sets that mark in this package. Which package marks it is not yet said (known gap 62).
- **"No settled call costs more than its hold" is checked after the call, not enforced.** If the provider bills above a hold, the gateway records a `hold.exceeded` event and raises a fault; the actual cost is still what is charged, and one such bill can take a project's spend above its cap. The test "a bill above the hold is charged in full, recorded as a breach, and raises a fault" shows this with a stand-in that serves fast mode unasked, and, since 13 Nov, shows spend going above the cap and the fault stopping no later call.
- **A database error while settling, and the gateway's start-up code,** have no test. By reading, the first leaves the hold open.
- **The list of request fields the gateway forwards is a first guess.** It is deliberately short; package 2.2 will show what the engine really sends, and each addition needs a reason.
- **Kept holds are not yet marked for the owner or closable.** This package keeps the money; the marking of cut-off and unreadable calls and the freeze after a failed save are package 1.4, and the owner's list and the reconciliation are package 1.5. Until then a kept hold stays open with nothing that can close it.
- **The pre-step check** (package 1.3) and **the failure tests with the two invariants traced at every moment** (package 1.4) are not built.
- **A real stop of the gateway.** See row B6 above.
- That the gateway is the only route to the model, or that a project's containers cannot reach the provider another way: not part of this package, and not shown anywhere yet.

## Brought up to date with the integration branch (13 Nov 2026)

The integration branch, `claude/stage-1` at `0e8e1f9`, was merged into this branch as a merge commit (no rebase, nothing rewritten). The conflicts were in records only: the committed licence report, the plan's progress table, `docs/DECISIONS.md`, `docs/SOURCES.md` and `docs/KNOWN-GAPS.md`. Both sides' rows are kept; the licence report and the plan's progress table are the integration branch's. The integration branch's known gaps run to 61, so this branch's gap 45 is now **gap 62**, and every reference to it, here and in `docs/DECISIONS.md`, is changed with it (no code, test or other evidence file named it). No code file conflicted. No migration number collides: the integration branch adds no migration (its last is `002`); this branch's are `003` to `006`.

Changed in the same commit:
- **The wording on what the cap does**, after the outside review the owner supplied on 12 Nov: the section "What the cap enforces, and what it does not" above; the State row; the reviews' "the cap held", now "no way was found to be admitted past the cap"; known gap 62; this package's row in `docs/DECISIONS.md` and in the design note's list of changes.
- **Two refusal messages reworded**, nothing else in what the code does: a prompt that cannot be counted now reads "so this call's hold cannot be worked out" (was "so the most this call could cost is not known"; the B3 message in Run 1 above is the earlier text), and a request with a field not forwarded reads "A call's hold is worked out from a fixed list of fields" (was "The most a call can cost is worked out ..."). The tests check the reason and the words "could not be counted", which are unchanged.
- **Comments:** the opening comment of `builder/src/gateway/hold.ts`, and one comment in `builder/test/gateway.test.ts` that said "guarantees".

Checks on the merged tree, run before this commit, in `builder/` after `npm ci`:

| Check | Result | Output |
| --- | --- | --- |
| Type check (`npm run typecheck`) | Exit code 0 | `run-after-merge-typecheck.txt` |
| Every test except the live ones (`npx vitest run -t '^(?!.*: live, ).*$'`), against a test database of its own | 204 passed; the 19 live tests, which start containers, were not run in this step | `run-after-merge-tests-not-live.txt` |
| Licence check (`npm run check:licences`), now package 0.4's single rule | Passed, exit code 0 | `run-after-merge-licences.txt` |

The demonstration was not run again; Run 1 above is from before the merge.

## Finished to the owner's answer to question 1 (13 Nov 2026)

The owner, asked his question 1 ("What finishes package 1.2?"), wrote: "apply budget cap as long aswe can change it later". Claude Code reads this as option (a): B1 to B6, plus one proof row for each of the five cases of known gap 41 that the package handles, on the condition that the cap and these finish criteria stay changeable later by a recorded decision. The owner has been told this reading and can correct it (`docs/DECISIONS.md`, 13 Nov).

*Added 13 Nov 2026, after that day's review:* question 1, as put to him, also said that choosing (a) accepts B1 to B6 as rewritten on 12 Nov (B4 split in two; B1, B2, B5 and B6 say more) and package 1.2's narrowing to them; by the same reading, his answer accepts those too (`docs/DECISIONS.md`, notes of 13 Nov). What can be changed later, as built (read in the code, not shown by any run): the finish rows and the design, by a recorded decision; and a project's cap, which is one number in the database, set when the project is created, that nothing in the builder changes yet and no package in the plan adds a way to change (known gap 64), so that changing it now means a hand edit of the database, which has not been shown and would not be written to the event log.

Changed:
- **Design note 7.2:** rows B15 to B19 added, each case named as known gap 41 names it, with a dated amendment; 5.5's table of known limits names each row, and its error-answer row now says the kept hold is not marked unreconciled in this package (a correction).
- **The plan's 1.2 row** now reads "Proof rows B1 to B6 and B15 to B19 of design note 7.2, and only those"; the plan's header records the amendment, and its progress table names the eleven rows.
- **Tests** (`builder/test/gateway.test.ts`): B1 now has the stand-in look in the database when each of two calls reaches it; five new tests, B15 to B19. The stand-in gained three behaviours for them: a bill 4% above the count, an overloaded answer (529), and a note of the open holds at the moment of forwarding. No test was removed or weakened.
- **Demonstration** (`builder/scripts/demo-cap.ts`): the same addition to B1, and sections B15 to B19.
- **Two texts in the code** that called the hold the most a call can cost: the opening comment of `builder/src/gateway/app.ts`, and the refusal message for a request without `max_tokens` (reason `max_tokens_missing`, unchanged), which now reads "so its hold cannot be worked out". Nothing else in what the gateway does changed.

### Run 4: the demonstration of the eleven rows

`run-2026-11-13-demonstration.txt`, commit `94b800c`, against the stand-in and the database `builder_test_pkg12`; exit code 0. Sections B1 to B6 show what Run 1 showed, with one line added to B1 for each call (*corrected 13 Nov 2026, after that day's review:* not in every line. In B6 the first gateway's `hold.kept` comes after the second gateway's `hold.found_at_startup`, where Run 1 had it before: both gateways run in one process, and the first one's request handler was still ending the call after its server was closed, so "the gateway is now stopped" is not what the run shows. The B3 refusal event also prints more fields than in Run 1) ("when call 1 reached the stand-in provider, the database held 1 open hold(s) for this project"; the same for call 2). Sections B15 to B19 show, for each request refused, the status, the message shown, "calls that reached the provider: 0", the `gateway.refused` event with its reason, and "holds in the database for this project: 0", then a request that is let through; for B16 the hold's arithmetic, the bill and the arithmetic without the margin; for B19 each error answer's events, the hold's row and the budget, then a further call (200 after the provider's own rejection; 402 after each of the three kept holds). The last line: "Every call that reached the provider carried the gateway's key, never a project token: yes (17 calls)." The key there is a made-up text held by the stand-in run; no real key exists.

### Run 5: the eleven rows' tests on their own

`run-2026-11-13-proof-row-tests.txt`, commit `94b800c`: `npx vitest run test/gateway.test.ts -t 'proof rows' --reporter=verbose`; 13 tests (B2 and B4 have two each), all passed, exit code 0.

### Run 6: each row's test with its safeguard removed (controls)

`run-tests-with-fixes-removed.txt`, commit `94b800c`. For each control, one safeguard was removed by an exact text change (shown in the file as `git diff` shows it), the row's test was run, the file was restored with `git checkout --`, and `git diff --exit-code` was run: clean after every control, and no tracked file changed after the last. No control was committed.

| Control | Row | Safeguard removed | The test failed at |
| --- | --- | --- | --- |
| 1 | B1 | A call forwarded before its hold is opened | Open holds seen when each call reached the stand-in: 0, 1, 0, 1, where 1, 1 is expected |
| 2 | B1 | A call settled at its hold's amount, not its actual cost | The settled amount is not the actual cost |
| 3 | B2 | The budget equation not checked | The third call answered 200, not 402; six calls arriving together all admitted, not one |
| 4 | B3 | A prompt that cannot be counted estimated from the request's size | The call answered 200, not 502 |
| 5 | B4 (1) | The long-prompt rate judged on the count alone, without the margin | The hold near the threshold not at the long-prompt rates |
| 6 | B4 (2) | A profile that allows fast mode no longer doubles the hold | Fast-mode factor not 2 |
| 7 | B5 | A hold past its deadline closed at nothing | The hold's row not open |
| 8 | B6 | A gateway that starts closes, at nothing, the holds another left open | No open hold found at start-up |
| 9 | B15 | `inference_geo` not checked | The request answered 200, not 400 |
| 10 | B16 | No margin on the count | The margin is not 203 tokens on a count of 42 |
| 11 | B17 | Every tool let through, whatever its type | The web search request answered 200, not 400 |
| 12 | B17 | Tool servers (`mcp_servers`) let through | The tool-servers request answered 200, not 400 |
| 13 | B18 | Fast mode let through on a model with no listed fast-mode price | The request answered 200, not 400 |
| 14 | B19 | Every error answer settles its hold at nothing | After a server error the log shows the hold settled, where it should be kept |

Every one of the 14 failed, each at the check named. This shows that each test sees its safeguard missing; it does not show that the tests catch every way the safeguard could be broken.

### Run 7: the checks at the end

Run at commit `c31f909` (the code is that of `94b800c`; `c31f909` changed records and evidence only), on the development machine, in `builder/`, with the test database `builder_test_pkg12`.

| Check | Result | Output |
| --- | --- | --- |
| Type check (`npm run typecheck`) | Exit code 0 | `run-2026-11-13-typecheck.txt` |
| The whole test suite, live tests included, run once (`flock <lock> npx vitest run --reporter=verbose`; the lock keeps it from overlapping another session's live tests on this machine) | 9 files, 228 tests, all passed, none skipped; exit code 0. The live tests started containers from `node:22-alpine` and `postgres:16-alpine`; the digests Docker gave for them after the run are at the end of the file. No listing of the machine's containers was kept for this run, so whether one was left running is not shown here (*corrected 13 Nov 2026*: this cell first said "No container was left running"; Run 11 keeps a listing before and after) | `run-2026-11-13-tests-full.txt` |
| Licence check (`npm run check:licences`) | RESULT: PASSED, exit code 0; the notices file up to date; `builder/licences.csv` unchanged. No dependency was added or removed | `run-2026-11-13-licences.txt` |

The outputs were searched for key-like text and none was found. The keys in the tests and the demonstration are made-up texts; no real key exists in this package's runs, no model was called and nothing was spent.

## The review of 13 Nov 2026 (commit `592ed73`) and its answers

Three fresh reviewers read `592ed73`, each from one side: **money** (told to break the cap, with its own copy of the code, its own database and stand-in providers only), **the merge** of the integration branch, and **the records**. Each finding was then checked by two more reviewers, who tried to show it wrong; a finding counts as confirmed when at least one of them could not.

**What held, as the reviewers reported it** (their runs are in their own working folders, not kept here): the 14 controls of Run 6, applied again, each failed at the stated check; a control the evidence does not have (the lock on the project's row removed) made both lock tests fail, three runs out of three; three gateway instances with their own database connections, sending 90 calls in bursts, with 430 samples taken during the run: spent plus open holds never above the cap, seven calls admitted and seven received by the provider; the demonstration, run again, matched Run 4 line for line. No way was found to be admitted past the cap, to settle a hold twice, to forward a call with no hold, to lower a hold through the arithmetic, or to settle a stream on partial figures. The merge reviewer found nothing lost from either side and ran the type check (exit 0), the tests without the live ones (209 passed, 19 skipped) and the licence check (passed). The records reviewer read only. Nothing was found blocking.

| # | Side | Finding | The two checkers | Done |
| --- | --- | --- | --- | --- |
| 1 | Money | A forward that failed after the provider had the whole request (the connection dropped, or no answer within 300 seconds) was recorded as "the provider could not be reached", and the caller was told the same; the records said a plain call is cut after 10 minutes, but Node's fetch cuts it at about 300 seconds | Both: real, should-fix | **Code** (`ac18aa8`): only a failure to connect (ECONNREFUSED, ENOTFOUND, UND_ERR_CONNECT_TIMEOUT) is "could not be reached"; any other failure, an unknown code or none included, is "the connection failed after the request was sent, or may have been sent; the provider may have billed it", with a caller's message that does not say unreachable; the hold is kept either way. New test "a provider that reads the whole request and then drops the connection ..."; control 15. The codes are measured in `run-2026-11-13-fetch-error-codes.txt` and sourced in `docs/SOURCES.md` (13 Nov). **Records** (`9f38879`): the 300 seconds is not changed in the code (that needs a new dependency); it is written down instead, in a dated note on the 12 Nov decision row, a dated correction to the design note's "As built" row, and known gap 63; the reviewer's measured run is kept as `run-2026-11-13-reviewer-plain-call-300s.txt` |
| 2 | Money | A call whose hold carried the fast-mode factor was settled at standard rates when the answer's usage left the speed out; the demonstration showed a fast call costed at half its price | Both: real, should-fix | **Code** (`96a84f2`): such usage is not read; the hold is kept, on the plain and the stream path. Tests "fast mode: a plain answer ..." and "fast mode: the same on a stream", on the "fast" profile; controls 16 and 17. The demonstration's stand-in now states the speed (`867cebd`); row B18 above |
| 3 | Money (note) | Cache writes not split into five-minute and one-hour were all priced at the cheaper five-minute rate | Not checked (a note) | **Code** (`7e04522`): such writes are priced at the one-hour rate unless no `cache_control` in the request asks for a lifetime other than five minutes (the provider's default; `docs/SOURCES.md`, 13 Nov). The `model.call` event says how many were not split and at which rate they were priced; the usage is recorded as given. Test "cache writes the answer does not split ..." (seven requests); control 18. Gap 23 has a dated note |
| 4 | Money (note) | A caller that left before anything was forwarded still had its hold opened and kept open, as if the call had been sent | Not checked (a note) | **Code** (`35bd6ff`): if the caller has gone when the gateway is about to forward, with no wait between that check and the forward, the hold is settled at nothing with "the caller left before anything was sent to the provider" and no `model.call` event (`releaseUnsentHold` in `builder/src/store/holds.ts`). Once the forward has begun, any ending keeps the hold, as before. Test "a caller that leaves before anything is forwarded ..." (a plain and a streamed call); control 19 |
| 5 | Money (note) | The budget-reached message rounded each figure to the cent, so the figures could appear to fit the cap | Not checked (a note) | **Code** (`a1d8345`): what is needed, spent and held is rounded up to the cent and the cap down, so the room the figures imply is rounded down; the wording, "this call needed up to" included, is unchanged. Test "the budget-reached message rounds so that its figures never appear to fit the cap"; control 20 |
| 6 | Money (note) | B6's "the gateway is now stopped" is contradicted by its own run: the first gateway wrote `hold.kept` after the second gateway's start-up scan | Not checked (a note) | The demonstration says what is done and prints the order of the two events (`867cebd`); the test's comment says the same (`4f6fe7e`); row B6 and Run 4 above are corrected. In Run 8 the order fell the other way (before), as in Run 1 |
| 7 | Money (note) | A cap can be changed only by a hand edit of the database, which the event log does not show | Not checked (a note) | With records finding 10 below: known gap 64 |
| 8 | Merge (note) | `docs/STATUS.md` on this branch still asks question 1 and holds 1.3 to 2.2 on it | Not checked (a note) | Not done here: this branch does not edit `docs/STATUS.md`; it is for the record update |
| 9 | Merge (note) | The pull request's description still names gap 45 and B1 to B6 only | Not checked (a note) | Not done here: nothing was pushed from this work; the description is for the push |
| 10 | Records | The owner's approval of B15 to B19 stated without the reading in the plan's progress row and in the design note | One: not real (a note); one: real, should-fix | Each place now says it is his answer as Claude Code reads it, with his words quoted nearby: the plan's progress row and 1.2 row, the design note's status row, 5.5's paragraph after the table of known limits, the 13 Nov change-log row and 7.2's amendment, and gap 41's note (`af07490`); the test's comment too (`4f6fe7e`) |
| 11 | Records | The reading stops at B15 to B19, though question 1 told him that choosing (a) accepts B1 to B6 as rewritten on 12 Nov and the narrowing to them | Both: real, should-fix | Dated notes of 13 Nov, nothing rewritten: the 13 Nov and 12 Nov decision rows, the plan's "Amended" row (his approval now recorded, by this reading), the design note's status row and its rows for the B4 split and for the B1, B2, B5 and B6 rewrites (`af07490`). B7, B8 and the assignment of B7 to B14 stay his to approve |
| 12 | Records | His condition "as long as we can change it later" is repeated, but nothing says what can be changed or how | One: not real (a note); one: real (a note) | One sentence, kept apart from what was shown, in the 13 Nov decision row and in "Finished to the owner's answer to question 1" above; the plan has no package that adds a way to change a cap, so known gap 64 says so (`af07490`) |
| 13 | Records | "Can take a project over its cap" was called shown by a test that did not show it | Both: real, should-fix | The test "a bill above the hold is charged in full, recorded as a breach, and raises a fault" now runs on a cap with room for the one hold: spend goes above the cap and the next call is refused; and on a project with room left, the call after such a bill is admitted, so the fault stops nothing (`4f6fe7e`). The sentences in "What the cap enforces", "What this is and is not", "What this does not show" and gap 62 now say what the test shows and what is read in the plan |
| 14 | Records | The records of his decision do not say a fault stops nothing | Both: not real (a note) | Not confirmed, so no change for it alone; the 13 Nov decision row already points to gaps 41 and 62, and gap 62 now says the fault stops no later call, shown by the test in row 13 |
| 15 | Records | The approved message "this call needed up to $W" and 5.5's sentence "The hold is meant to be the most this call can cost" are an open wording point kept in no record | One: real (a note); one: real, should-fix | Recorded in gap 62 and in a note under the B2 message after Run 1 (and under Run 8 below); the wording is unchanged, and changing it is the owner's (`af07490` and this commit) |
| 16 | Records (note) | "No container was left running" was cited to a file that does not show it | Not checked (a note) | Run 7's cell now says no listing was kept; Run 11 keeps the machine's containers listed before and after the whole suite (none either time) |
| 17 | Records (note) | Run 4 "shows what Run 1 showed" for B6, though its order of events differs | Not checked (a note) | Corrected in Run 4's description, with row 6 above |
| 18 | Records (note) | In 5.5's table of known limits, "(proof row B19)" read as if B19 were package 1.4's | Not checked (a note) | Moved to the row's own sentence, "(proof row B19, package 1.2)" (`af07490`) |
| 19 | Records (note) | The State row left out the seventh review and sent the reader to a stale pull request description | Not checked (a note) | The State row names every review and its commit, this one included, and no longer points to the description |

### The new tests

All in `builder/test/gateway.test.ts`; each ran and passed in Run 11, and the test of each fix failed with that fix removed (Run 9).

| Test | Shows, against a stand-in |
| --- | --- |
| "the provider reachable for counting but not for the call itself: nothing was sent, and the record says so" (reworked) | The call itself sent, through Node's own fetch, to a port where nothing listens: 502 "could not reach", reason "the provider could not be reached", code ECONNREFUSED, the hold kept at its full amount. (Port 9, used before, is one fetch refuses to use at all, without a code; both unreachable tests now use a closed port) |
| "a provider that reads the whole request and then drops the connection: ..." | The stand-in received the whole call once; 502 with a message that does not say unreachable; reason "the connection failed after the request was sent, or may have been sent; the provider may have billed it"; code UND_ERR_SOCKET; the hold kept at its full amount; nothing charged |
| "fast mode: a plain answer whose usage leaves the speed out keeps a hold that allowed for fast mode; ..." | On the "fast" profile: asked for, and allowed by the profile, each hold kept with the reason named; the same answers stating "fast" or "standard" settled at that speed's rates; on the standard profile, settled as before |
| "fast mode: the same on a stream" | A stream on Claude Opus 5.5 with fast mode asked for: kept without the speed, settled at the fast-mode price with it |
| "cache writes the answer does not split into five-minute and one-hour are priced at the one-hour rate, ..." | Seven requests: a `ttl` of "1h" on a message block or a tool, or an unknown `ttl`, prices 10,000 unsplit writes at the one-hour rate; "5m", no `ttl` or no `cache_control` at the five-minute rate; writes the answer does split are priced as split |
| "a caller that leaves before anything is forwarded: ..." | With the count delayed and the caller gone at 100 ms: events `hold.opened` then `hold.settled` (at nothing, `forwarded: false`, the reason named), nothing reached the provider, nothing open, nothing spent; for a plain and a streamed call |
| "the budget-reached message rounds so that its figures never appear to fit the cap" | Spent $0.02142, held $0.02142, cap $0.0509, this call $0.00996: the message reads $0.05, $0.03, $0.03 and $0.01, whose sum is above the cap, in the approved wording; the exact figures are in the log |
| "a bill above the hold is charged in full, recorded as a breach, and raises a fault" (extended) | See row 13 of the table above |

### Run 8: the demonstration, run again

`run-2026-11-13-after-review-demonstration.txt`, commit `af07490` (its code and script are those of `867cebd`), against the stand-in and the database `builder_test_pkg12`; exit code 0; 17 calls reached the stand-in, each with the gateway's key, never a project token (a made-up text; no real key exists). Compared with Run 4, line by line with the hold numbers set aside, these differ and nothing else: B6's title and two lines say what is done ("the caller now leaves, and the first gateway's server is closed"; "both gateways run in this one process, so the first gateway is not stopped"); in B6 the first gateway's `hold.kept` comes before the second gateway's `hold.found_at_startup` this time (after it in Run 4, before it in Run 1), and a new line prints that order; and B18's fast-mode call is settled at $0.120000, not $0.060000, because the stand-in now states the speed.

Note on the B2 message in this run, as under Run 1: "this call needed up to $0.13" is the approved wording, which describes the hold as the most a call can cost; changing it is the owner's (known gap 62). Its figures ($0.15 cap; $0.06 spent; $0.00 held; $0.13 needed) are the same under the new rounding, and do not appear to fit.

### Run 9: each fix of this review removed in turn (controls 15 to 20)

Appended to `run-tests-with-fixes-removed.txt`, commit `867cebd`, by the same method as Run 6: one fix removed by an exact text change, shown as `git diff` shows it; its test run; the file restored with `git checkout --`; `git diff --exit-code` clean after each, and no tracked file changed after the last. No control was committed.

| Control | Finding | Fix removed | The test failed at |
| --- | --- | --- | --- |
| 15 | 1 | Every failure of the forward taken to mean nothing was sent | The caller's message said "could not reach" where it should say the request may have been sent |
| 16 | 2 (plain) | A plain answer's speed not required | No `hold.kept` event: the hold was settled |
| 17 | 2 (stream) | A stream's speed not required | No `hold.kept` event: the hold was settled |
| 18 | 3 | Unsplit cache writes always priced at the five-minute rate | The cost was $0.03 below the one-hour price |
| 19 | 4 | The caller's leaving not checked before forwarding | No `hold.settled` event: the hold was kept |
| 20 | 5 | Each figure rounded to the nearest cent | The message was not the one expected |

All six failed. As with Run 6, this shows that each test sees its fix missing, not that the tests catch every way the fix could be broken. The extended test of row 13 is a test of what is built, not of a fix, and has no control.

### Run 10: two measurements kept

- `run-2026-11-13-fetch-error-codes.txt`: what Node's own fetch (Node v22.23.4, undici 6.29.1) reports on this machine when a request fails: a closed port gives ECONNREFUSED; a name that does not exist gives ENOTFOUND; a stand-in that reads the whole request and then closes or resets the connection gives UND_ERR_SOCKET or ECONNRESET, each after the stand-in had received the request; port 9 is refused by fetch itself with no code. The script is in the file. UND_ERR_CONNECT_TIMEOUT was not produced; it rests on undici's documentation.
- `run-2026-11-13-reviewer-plain-call-300s.txt`: the reviewer's run, copied with a header and not run again here: a plain call answered after 310 seconds was cut at 300,805 ms with UND_ERR_HEADERS_TIMEOUT (known gap 63).

### Run 11: the checks at the end

Run at commit `af07490`, whose code is that of `867cebd` (the commits after `867cebd` change records and evidence only), on the development machine, in `builder/`, with the test database `builder_test_pkg12`.

| Check | Result | Output |
| --- | --- | --- |
| Type check (`npm run typecheck`), and `scripts/demo-cap.ts` type-checked on its own (the command line of the evidence of packages 0.6a and 2.1) | Exit code 0, and exit code 0 | `run-2026-11-13-after-review-typecheck.txt` |
| Every test except the live ones (`npx vitest run -t '^(?!.*: live, ).*$'`) | 215 passed, 19 skipped (each skipped test is a live one), 234 in all; exit code 0 | `run-2026-11-13-after-review-tests-not-live.txt` |
| The whole test suite, live tests included, run once (`flock <lock> npx vitest run --reporter=verbose`) | 9 files, 234 tests, all passed, none skipped; exit code 0. The machine's containers are listed before and after the run: none either time, so none was left running. The image digests Docker gave after the run are at the end of the file, the same as in Run 7 | `run-2026-11-13-after-review-tests-full.txt` |
| Licence check (`npm run check:licences`) | RESULT: PASSED, exit code 0; the notices file up to date; `builder/licences.csv` unchanged. No dependency was added or removed | `run-2026-11-13-after-review-licences.txt` |

The outputs were searched for key-like text and none was found. No real provider was called, no real key exists in these runs, and nothing was spent. Not run again here: Run 5's proof-row tests on their own (they ran within the whole suite).
