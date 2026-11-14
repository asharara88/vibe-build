# J1's and J3's automated runs, repeated on today's code (14 November 2026)

Written by Claude Code. Each run is the package's own script, unchanged, run once under the shared lock on the development machine (a cloud session), on commit `835f483` (`builder/` tree `37ae8c2`): `claude/stage-1` with J2 merged, plus pull request #49's fixes. Real Docker, the real interface process, the scripted engine only. No model was called. Made-up data only.

**Why.** A read-only check of the merged packages (`docs/reviews/2026-11-14-state-of-merged-packages.md`) found that J1's "Done means", one automated run, had last passed on a commit two code changes before the one that was merged, and that J3's run had not been repeated after its review, the review bot's findings or the fixes that followed. Since then the code under both has changed again (0.6c's networks, the sign-off fix, J2).

| Run | Script | Result | Before, for comparison |
| --- | --- | --- | --- |
| J1, the owner's journey: sign-in to export on real containers | `scripts/demo-journey.ts` | **54 of 54 checks passed**, 35 of 35 screenshots, exit code 0. Lock held 11:16:05 to 11:17:32 UTC. Nothing of the run left on the machine | 54 of 54 on `f5618c9`, 13 Nov |
| J3, the live preview: the app used live through the preview front, then the checklist | `scripts/demo-journey-j3.ts` | **46 of 46 checks passed**, 20 screenshots (10 by each camera), exit code 0. Lock held 11:17:32 to 11:19:08 UTC | 46 of 46 on `0706ee3`, 13 Nov |

Each folder holds the run's own log (`run-demo.txt`, every check with its detail), the lock lines, every event of the run (`events.json`), the cameras' lines and the interface's output. Of the screenshots, four of J1's and three of J3's are kept here; the others show the same screens as the first runs' folders (`evidence/2026-11-13-journey-j1/screens/`, `evidence/2026-11-13-journey-j3/screens/`) and were not compared with them picture by picture.

**What this shows.** Both packages' automated runs pass on the code as it stands now, on real containers.

**What it does not show.**
- J3's phone test (M1), which is the owner's to run. The live preview stays off behind its setting until then.
- That J1's or J3's last fixes were re-read by a reviewer: they were not.
- Anything about a real engine or a real model.
