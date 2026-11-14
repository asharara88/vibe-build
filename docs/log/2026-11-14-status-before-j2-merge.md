# Status

**As of:** 14 November 2026, J2 built and reviewed once. Rules: build plan section 8, rule 6. Questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/` (the one before this: `2026-11-14-status-before-j2-review.md`).

## What you can now do (J2, built, not tested)

- **Watch the checklist reject a broken app.** On Projects, a panel marked "Simulated build" (always there, as you answered) has one button, "Start the broken-copy demonstration". Its project has a third step Claude Code broke on purpose (a new request saved as Approved, not Waiting), and a badge on every page. The checklist reads **Failed** at "sees status waiting". It is never signed off or exported.
- **What that does not show:** that the checklist catches mistakes in general. Claude Code wrote both the mistake and the test.
- **See a stop in the middle of a step.** Stopping the interface on purpose now marks the project interrupted and removes its containers (sealed boxes a step or the app runs in) before it exits; after a crash, at the next start. Nothing is resumed.
- Shown by an automated run (not your instance): 150 of 150 checks, 41 pictures (`evidence/2026-11-13-journey-j2/journey-j2.md`).

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile), 1.1, 1.2, 1.2b, 1.3, 1.4, 1.5 (stand-in only), 2.1, W4.
2. **Built, not tested:** 3.1, 1.4c, 3.1b, 1.4b, 0.6c, J1 and J3 (both merged), **J2** (branch `claude/j2-broken-and-restart`, pushed up to `5a2254d`, later commits not pushed; known gaps 175 to 181).
3. **Checked for J2:** its review found three wrong statements in the records (corrected); one check tightened, two tests added, not re-read. Then: 45 of 45 controls failed with their safeguard removed; the whole suite, 730 of 730 (live tests included); typecheck and licence check passed. **Assumed:** the stop's 30 s, 5 s and 90 s limits (never reached).
4. **Your phone test:** still pending; the live preview stays off until then.
5. **Your 4020 interface:** not checked in this work; last recorded running, on code without J2.

## Next

1. J2's pull request, listing every review finding.
2. 3.2: the exported app starting on its own, with the builder stopped.

## What blocks it

- No engineer has read 0.6c, J3 or J2's stop (gaps 35, 148, 149, 159, 178).
- 2.3, the first real-model run: 2.2, the key, and 0.6c tested.

## Money

Model spend through the builder: **$0.00**. No paid service in use.
