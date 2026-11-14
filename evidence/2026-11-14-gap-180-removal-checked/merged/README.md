# Pull request #51's code, checked as a whole (14 November 2026)

Written by Claude Code. Known gap 180's fix was built and reviewed on a side branch (the files one folder up). There, after the two review rounds, the whole suite and J2's automated run were **not** repeated. This folder holds the checks made once the fix was merged into pull request #51's branch, together with the change to the tests' own database clean-up (known gap 185).

**The code checked:** `builder/` tree `f1a4770`. The checks' script (`checks.sh`) took the commit at its start, `dec6725`. A commit that changes records only, `6f0c5b3`, was made while it ran; J2's, J1's and J3's logs name that one. Both hold the same `builder/` folder. Nothing under `builder/` was changed during the checks except by the controls, which restore each file.

Run on the development machine (a cloud session), development profile, real Docker, the scripted engine, a stand-in test. Every step that starts containers held the machine's shared lock. No model was called. Made-up data only.

| Check | Result | File |
| --- | --- | --- |
| Type check | Passed, exit code 0 | `run-typecheck.txt` |
| Licence check | PASSED, exit code 0. No dependency file is changed | `run-licences.txt` |
| The clean-up helper's own tests (gap 185) | 4 of 4 passed | `run-helper-tests.txt` |
| The same four with the helper's wait taken out | 3 failed (D1, D2, D3), as they should; D4, which does not reach PostgreSQL, passed. The file was restored | `control-helper-wait-removed.txt` |
| `test/web.test.ts` whole, three runs | 78 of 78 each, exit code 0 each | `run-web-whole-run-1.txt` to `-3.txt` |
| `test/journey.test.ts` whole, three runs | 78 of 78 each, exit code 0 each | `run-journey-whole-run-1.txt` to `-3.txt` |
| Every control of the journey's list (87: J2's 53, and 34 for gap 180's fix and its two review rounds) | **87 run; every one made its tests fail with its safeguard removed**, none in a test's own clean-up; the code was as committed after every control | `controls-output.txt`, `controls-stdout.txt` |
| The whole suite, live tests included | **814 of 814 passed, 33 files**, exit code 0. Lock held 16:21:04 to 16:39:22 UTC. No container left | `run-tests-full.txt` |
| J2's automated run (the broken copy rejected; a stop on purpose and a crash mid-step) | **153 of 153 checks passed**, 41 of 41 screenshots, exit code 0. Lock held 16:39:22 to 16:41:54 UTC | `j2/` (the log, the events, the camera's lines, the interface's output, all 41 screenshots) |
| J1's automated run | **54 of 54 checks passed**, 35 screenshots taken, exit code 0. Nothing of the run left | `j1/` (the log, the events, the export's contents, the camera's lines, the interface's output) |
| J3's automated run | **46 of 46 checks passed** by the run's own total (its log prints 45 lines marked PASSED), 20 screenshots taken, exit code 0 | `j3/` (the same files) |

**Why the two test files were run three times each.** Before the helper, the tests' own database clean-up turned three runs red on 14 Nov for a reason outside the code (`../after-review/second-round/clean-up-failures-seen.txt`). Six whole runs with the helper, plus the whole suite, showed neither form again. That is seven runs, not a proof: before the helper, two of six whole runs of `test/web.test.ts` on the side branch were red from it.

**What is not kept.** J1's 35 and J3's 20 screenshots of these runs. The same screens, from the runs on `839be17` earlier the same day, are kept in full in `evidence/2026-11-14-marks-checked/`; the pictures of the two days' runs were not compared.

**What this shows.** On the code this pull request merges: the fix's tests and every control behave as claimed; the whole suite passes; J2's "Done means" run passes after its removal code was changed; J1's and J3's runs pass.

**What it does not show.**

- A removal that fails in a real stop, start or close of a full project: the fix's own tests make it fail with a made-up docker program and, on real Docker, with one labelled network held by another container (`../README.md`).
- That anyone has read the answers to the second review round, or the clean-up helper, before the review bot.
- Anything about a real model, a real engine, the server profile, security or readiness.
