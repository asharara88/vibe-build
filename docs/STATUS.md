# Status

**As of:** 14 November 2026, the sandbox tests' leftover folders measured and fixed. Rules: build plan section 8, rule 6. Questions: [`docs/QUESTIONS.md`](QUESTIONS.md). Earlier versions: `docs/log/` (the one before this: `2026-11-14-status-before-tmpdir-cleanup.md`).

## This session (14 Nov): the temporary folder

- **Measured:** one test file (`sandbox.test.ts`) left seven folders after every run, 168 KB in all; no other file left any in a finished run. These cannot explain the 3.2 GB freed on 13 Nov (gap 137), still unexplained.
- **Fixed, with controls:** each test now removes its folders when it ends, also when it fails; the same run then left none. Whole suite after the fix: 692 of 692, no test folder left. One fresh review: the code confirmed; eight corrections, all made (one small code change, checked again: 692 of 692). Evidence: `evidence/2026-11-14-sandbox-test-tmpdir/README.md`; [pull request #39](https://github.com/asharara88/vibe-build/pull/39), into `claude/stage-1`.
- **Found, not fixed:** on a fresh machine the first full run fails J3's five live preview tests (the browser image they need was missing), and a long temporary-folder path breaks the suite's scripts (gap 170).

## J3, the live preview (built, reviewed once, not tested)

- Use the scripted app live from your phone, after your two-page phone test (`docs/QUESTIONS.md`, "Yours to confirm"); off until then. Labelled "Simulated build"; made-up data only. Evidence: `evidence/2026-11-13-journey-j3/live-preview.md`.

## State

1. **Tested:** 0.1 to 0.5, 0.6a (development profile), 1.1, 1.2, 1.2b, 1.3, 1.4, 1.5 (stand-in only), 2.1, W4.
2. **Built, not tested:** 3.1, 1.4c, 3.1b, 1.4b, 0.6c, J1, J3 (all merged).
3. **Checked today, on a fresh machine:** the whole suite before the fix (687 of 692, gap 170) and after (692 of 692); 0.6c's isolation run not repeated. **Assumed:** your phone's browser behaves as Chromium did (M1).
4. **Your 4020 interface:** stopped at 19:24 UTC on 13 Nov; not restarted since.

## Next

1. Your phone test, then its result recorded and the live preview turned on.
2. J2: the broken copy rejected by the checklist; a restart mid-build shown (designed on its own branch, not merged); then 3.2, the export that starts on its own.
3. Gap 170 (1): the preview test builds the image it needs.

## What blocks it

- No engineer has read 0.6c or J3 (gaps 35, 148, 149, 159).
- 2.3, the first real-model run: 2.2, the key, and 0.6c tested.

## Money

Model spend through the builder: **$0.00**. No paid service in use.
