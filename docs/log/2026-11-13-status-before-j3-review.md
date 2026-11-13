# Status

**As of:** 13 November 2026, after J3 was built. Rules: build plan section 8, rule 6. Questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/` (the one before J3: `2026-11-13-status-before-j3.md`).

## What you can now do (J3, built, not tested, not reviewed)

- **Use the scripted app live, from your phone, once your phone test passes.** On a project's preview screen press "Open the live app": the builder shows a pass once (works once, 2 minutes). Open "app" in your Claude app's preview list and type it; then use example 1's app as it runs: its own sign-in as the made-up employee ("Show the sample sign-in" gives it), My requests, a new request, Arabic, sign-out. Labelled "Simulated build: scripted engine, sample data"; made-up data only.
- **Not yet approved for use:** your two-page phone test comes first (`docs/QUESTIONS.md`, "Yours to confirm").
- Shown by an automated run (46 of 46 checks): `evidence/2026-11-13-journey-j3/live-preview.md`, with 20 photographs in `screens/`.

## What changed in your 0.6c rule (your answer (a))

While you use the live app, its page code runs in your phone's browser, which has the internet: a way out besides the builder's door, for scripted builds only, enforced in code (gaps 148 to 158). The app still has no port on this machine; the builder reaches it only through short-lived containers on its private network. 0.6c's isolation run, with the new containers in its lists, passed.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile), 1.1, 1.2, 1.2b, 1.3, 1.4, 1.5 (stand-in only), 2.1, W4.
2. **Built, not tested:** 3.1, 1.4c, 3.1b, 1.4b, 0.6c, J1 (merged), J3 (branch `claude/j3-live-preview`, not pushed).
3. **Checked for J3:** typecheck; the whole suite, 672 of 672 (live tests included); licences passed; 26 controls; measurements M2, M3, M5, M6. **Assumed:** WebKit (your phone's browser) behaves as Chromium did; the tunnel and your app's pane (M1).

## Next

1. Your phone test, then its result recorded.
2. One adversarial review of J3 as isolation work, by reviewers who did not write it; then the pull request.
3. After J3 merges: a time to restart your 4020 interface from this code. Its start removes your projects' running sandboxes.

## What blocks it

- No engineer has read 0.6c or J3 (gaps 35, 148, 149).
- 2.3, the first real-model run: 2.2, the key, and 0.6c tested.

## Money

Model spend through the builder: **$0.00**. No paid service in use.
