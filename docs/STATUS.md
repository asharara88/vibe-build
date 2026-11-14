# Status

**As of:** 14 November 2026, J2 merged with the integration branch (`c4f198b`). Rules: build plan section 8, rule 6. Questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Before this: `docs/log/2026-11-14-status-before-j2-merge.md`.

## What you can now do

- **J1 (merged):** brief to sign-off and export; simulated build, made-up data.
- **J3, the live app (merged):** off until your phone test passes.
- **J2, once it merges:** a "Simulated build" button on Projects makes a deliberately broken copy; the checklist reads **Failed**; it is never signed off or exported. Claude Code wrote both mistake and test: this does not show the checklist catches mistakes in general.
- **J2, a stop mid-step:** stopping the interface on purpose marks the project interrupted and removes its containers (sealed boxes a step or the app runs in); after a crash, the next start does. Nothing is resumed.
- **Three review fixes, merged** (each reviewed once, nothing blocking):
  - The phone test's report says "GO ON" only with evidence for every required check.
  - A call read above its spending hold stops its project before the caller sees it end (gap 145).
  - After sign-off the live app is refused; an open live session is ended first.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile), 1.1, 1.2, 1.2b, 1.3, 1.4, 1.5 (stand-in only), 2.1, W4.
2. **Built, not tested:** 3.1, 1.4c, 3.1b, 1.4b, 0.6c, J1, J3, the three fixes (merged); **J2**: reviewed once, one round of fixes, brought up to date; pushed up to `5a2254d` only. Pull request next.
3. **Checked on the merged J2:** typecheck and licence check passed; 53 controls (45 of J2, 8 of the sign-off fix) failed with their safeguard removed, as they should; the whole suite 787 of 787; the automated run 150 of 150 checks. **Assumed:** the stop's time limits (never reached).
4. **Your 4020 interface:** not checked in this work.

## Next

1. J2's pull request, then the review bot.
2. The setup-script pull request (#45).
3. Showing you the builder on your computer.
4. Package 3.2: the exported app starting on its own.

## What blocks it

- Your phone test: needs this session's preview open on a computer.
- An engineer's reading of 0.6c, J3 and J2's stop (gaps 35, 148, 149, 159, 178).
- The real-model gate (2.3): 2.2, the key, and 0.6c tested.

## Money

Model spend through the builder: **$0.00**. No paid service in use.
