# An outside review of integration commit `0e8e1f9`, supplied by the owner

| | |
| --- | --- |
| Supplied | By the owner, Ahmed Sharara, in the working session of 13 November 2026. Who wrote it is not stated; under the working rule of 12 Nov (`docs/DECISIONS.md`) it is recorded as supplied by the owner, and his own approval of anything in it is kept separate |
| What it read | Integration commit `0e8e1f9`, "including source changes and recorded evidence". In its own words: "I did not independently rerun the tests" |
| How it was checked | Read by Claude Code against the repository at `0e8e1f9` (file and line below), and pull request #12's state read from GitHub's API on 13 Nov 2026. Read-only. Not yet re-read by a fresh reviewer |
| This file | The review's text as supplied, then each claim checked, and what was done |

## The review as supplied

> there is real progress—but the repo still cannot build an app from a brief. Its scripted demonstration works; the real engine, spending safeguards and independent acceptance remain unfinished.
>
> I reviewed integration commit `0e8e1f9`, including source changes and recorded evidence. I did not independently rerun the tests.
>
> What improved
>
> * App setup now runs inside a tools container with explicitly selected settings. That closes a meaningful host-execution gap. [PR #17](https://github.com/asharara88/vibe-build/pull/17), [follow-up #19](https://github.com/asharara88/vibe-build/pull/19).
> * The scripted engine applies fixed changes, checks the resulting files and rejects unexpected changes. Useful groundwork, but it is not AI generation. [PR #20](https://github.com/asharara88/vibe-build/pull/20).
> * Isolation testing now measures what containers can actually reach. The reporting is substantially more honest. [PR #22](https://github.com/asharara88/vibe-build/pull/22).
>
> My main challenges
>
> 1. Keep live-model work blocked on isolation. The development app and tools containers can connect to the builder database’s port and the session’s proxy. This does not prove database access, but it proves the intended network boundary is absent. Passing package 0.6a means the investigation succeeded—not that isolation succeeded. Claude records this correctly as gap 60. I recommend resolving the boundary before running generated code. [Evidence and limitations](https://github.com/asharara88/vibe-build/blob/0e8e1f9f36f3f63a813c01d0d6721df8dc48b3e6/docs/KNOWN-GAPS.md).
> 2. Don’t approve the new licence bundle as currently worded. Question 11 asks you to approve some terms and component licences that Claude explicitly says it has not read. Ask for the exact inventory, applicable notices and proposed handling first. A green npm licence check does not cover browser binaries or container contents. [Current approval request](https://github.com/asharara88/vibe-build/blob/0e8e1f9f36f3f63a813c01d0d6721df8dc48b3e6/docs/STATUS.md).
> 3. Allow fixed acceptance tests to develop the runner, but preserve the independent acceptance requirement. Question 12 bundles that useful permission with extending stand-in tests through checkpoint 2. I would approve the fixture work separately and require a live, separately generated acceptance check before the skeleton checkpoint. [Draft proposal](https://github.com/asharara88/vibe-build/blob/0e8e1f9f36f3f63a813c01d0d6721df8dc48b3e6/docs/design/package-3.1.md).
> 4. The budget cap remains unresolved. The holds implementation is still an open draft. It should not be treated as a demonstrated spending safeguard. [PR #12](https://github.com/asharara88/vibe-build/pull/12).
>
> My assessment: the engineering foundation is improving, and Claude is exposing limitations more clearly. The next priority is closing the budget and isolation blockers, then proving one complete live build. More paperwork alone will not move it toward a usable product.

## What the check found

Files and lines are as they stand at `0e8e1f9`.

| Claim | Finding | Done |
| --- | --- | --- |
| No app from a brief; the real engine, spending safeguards and independent acceptance unfinished | **Accurate.** "No app can be built from a brief" (`docs/STATUS.md`:13); 2.2, the real engine, not started (:65); 1.2 not tested (:61); 3.1 parked (:40) | Nothing to correct |
| 1. Set-up runs in a tools container with chosen settings | **Accurate, on the development profile only** (`docs/STATUS.md`:37). The tools container still shares the machine's network (`docs/KNOWN-GAPS.md`:76) | Nothing to correct |
| 2. The scripted engine checks the files and rejects unexpected changes; not AI generation | **Accurate** (`docs/STATUS.md`:38). One limit: the reset after a failed step cannot remove a folder tree deeper than the machine's path limit (`docs/KNOWN-GAPS.md`:74, gap 58) | Nothing to correct |
| 3. Isolation testing measures what containers reach | **Accurate** (`docs/STATUS.md`:39). "More honest" is the review's judgement, not checked | Nothing to correct |
| Challenge 1: app and tools containers connect to the builder's database port and the session's proxy; no database access proved; the intended boundary absent; 0.6a passing is not isolation | **Accurate.** Connections opened to 5432 and to the session's proxy, nothing signed in to (`docs/KNOWN-GAPS.md`:76); the design's boundary is an internal network with the egress proxy as the only way out (`docs/design/stage-1.md`:131); "It does not mean the profile is isolated" (`docs/STATUS.md`:39). The records asked only for an engineer's judgement before package 2.3 (`docs/KNOWN-GAPS.md`:76, `docs/STATUS.md`:67), which could have accepted the gap as it is | Claude Code now reads gap 60 as: the boundary is resolved before any code a model wrote runs (package 2.3 on). Gap 60, the status file and `docs/DECISIONS.md`; the owner confirms ("Yours to confirm", item (xiii)) |
| Challenge 2: question 11 asked approval of terms and licences not read; the npm check does not see browsers or images | **Accurate.** Option (a) was recommended (`docs/STATUS.md`:100) while Google's terms and most Ubuntu packages' licences were "not read" (:104); the npm check "reads npm packages only" (`docs/KNOWN-GAPS.md`:77) | Inventory written: `docs/licences/runtime-inventory.md`. Question 11 now rests on it and recommends approving, for the builder's own use, only items whose licences were read (for the 45 Alpine packages, only their licence names); gap 61 and `docs/SOURCES.md` brought up to date |
| Challenge 3: question 12 bundles stand-in tests for the runner with stand-in tests through checkpoint 2 | **Accurate.** Option (a) covered "3.1 and the skeleton report at checkpoint 2 (package 3.3)" (`docs/STATUS.md`:107) | Question 12 restructured: the recommended option now allows stand-in tests for 3.1 only and requires a live, separately generated check before 3.3, which adds a package to the plan if chosen |
| Challenge 4: the holds are an open draft, not a demonstrated safeguard | **Accurate.** Pull request #12 is open and marked draft (GitHub's API, 13 Nov 2026, head `319ed72`); the records say "not tested" (`docs/STATUS.md`:23, :61) and "No safeguard of the gateway ... is shown as tested" (:13) | Question 1, which is what lets 1.2 be finished and tested, was put to the owner and answered on 13 Nov: "apply budget cap as long aswe can change it later", read by Claude Code as option (a), on the condition that the cap and these finish criteria stay changeable later by a recorded decision (he was told this reading and can correct it). Recorded on the 1.2 branch (commit `c31f909`: its row in `docs/DECISIONS.md`, and proof rows B15 to B19 in design note 7.2 and the plan), which is pull request #12; 1.2 now waits on its review and merge |
| Assessment: budget and isolation first, then one complete live build | **The records partly differ from this order.** The budget cap (package 1.2) is now next, as the review advises: question 1 is answered, and by the plan's order 1.2 comes next, waiting on its review and merge. The isolation boundary is not yet scheduled as work: fixing it means changing the project's containers and running 0.6a's probe in them again, which needs the two sandbox images, on which nothing new is built while question 11 is open (Claude Code's interim reading), and an engineer's reading (question 7); the change itself is the owner's (design note 2.5). Whether to put the boundary to the owner sooner is his to decide. The warning about paperwork stands: this file and the inventory are records, not progress on the builder | Recorded here; the boundary is item (xiii) of "Yours to confirm" in `docs/STATUS.md` |
