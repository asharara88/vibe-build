# The adversarial readings of 14 November 2026: the reviewers' and challengers' own reports

Written by Claude Code. `reviewers-and-challengers-reports.json` holds, as returned, the reports of six fresh reviewers (two each on J1's export, J1's cameras and package 3.1b's guard) and of the fifteen fresh challengers who each tried to refute one finding a reviewer had called serious. The summary, and what follows from it, is `docs/reviews/2026-11-14-adversarial-readings-j1-3.1b.md`.

They read commit `839be17` in a working copy of its own, on the development machine (a cloud session), development profile. Probes and single tests were run under the machine's shared lock; the code was not edited. No model was called. Made-up data only.

Each entry of the file: the area and the angle; the reviewer's findings (severity, where, what, the scenario and whether it was run or only read, the known gap that covers it if any, a suggested fix); what the reviewer tried that held; what it did not look at; and, for each serious finding, the challenger's verdict and reasoning.

**Result:** nothing blocking. Eleven distinct serious points were reported; the challengers confirmed the facts of all eleven, kept eight as serious and lowered three to minor. They are known gaps 187, 188 and 189. Nothing is fixed here.

The reviewers' probe scripts and their outputs were written to scratch folders outside the repository and are not kept; the reports quote what each probe did and returned. Machine paths in the file are replaced by `<scratchpad>`.
