# An outside review of integration commit `3259e1e` and pull request #12, supplied by the owner

| | |
| --- | --- |
| Supplied | By the owner, Ahmed Sharara, in the working session of 12 November 2026. Who wrote it is not stated; under the working rule of 12 Nov (`docs/DECISIONS.md`) it is recorded as supplied by the owner, and his own approval of anything in it is kept separate |
| What it read | Integration commit `3259e1e`, the code and evidence there, and pull request #12 (package 1.2, unmerged). In its own words: "This review examined code and recorded evidence; I did not independently rerun the runtime tests. No repository changes made" |
| How it was checked | Three reader agents, one per challenge, each read the code and records with file and line references; a fourth agent per challenge then tried to refute the reader. Read-only. Package 1.2 read at `319ed72`, the integration branch at `51dde60` |
| This file | The review's text as supplied (links that did not survive copying are left out), then what the check found and what was done |

## The review as supplied

> It's heading toward a controlled prototype of an AI app builder. The intended journey is clear: describe a business need → clarify requirements → approve a plan → build in steps → independently test → export a standalone app.
>
> Based on the revisions I just reviewed, my assessment is:
>
> - The engineering direction is sensible. Budget controls, isolated execution, role enforcement and independent acceptance address real weaknesses we found.
> - The reporting is becoming more honest. Claude now distinguishes written designs from demonstrated controls. That makes progress easier to judge.
> - The product itself is still early. The latest work improved plans and review records; it did not advance the working builder.
> - The main execution risk is spending too long refining the process. The safeguards need implementation, but another round of document polishing will not demonstrate that the builder can produce a useful app.
>
> The next meaningful achievement should be a complete, narrow journey: a fixed brief produces a running app, the independent check catches a deliberately broken version, spending stays within the cap, and the export works without the builder. That will tell us much more than additional planning.
>
> Commercially, the question remains open: does this produce useful business apps reliably enough that someone would choose it over their existing approach? Good engineering alone cannot answer that. Your prospective buyer and their actual workflow need to shape the demonstration.
>
> My advice: approve the narrowly scoped licence exceptions, let Claude implement the queued safeguards, and judge progress by working demonstrations. Keep the alternative-stack comparison bounded so it serves a decision rather than becoming a second product.
>
> I'm positive about the direction, but we don't yet have evidence of a dependable product—or buyer demand.
>
> There is real implementation progress now. The biggest remaining risk is still the budget guarantee—not the documentation.
>
> I reviewed integration commit 3259e1e, the new code and evidence, and the unmerged budget work in PR #12.
>
> **What has improved**
>
> - The role guard now stops requests itself. Protected page, action and route callbacks execute only after permission succeeds. Unknown roles are refused, and newly registered accounts receive no recognised role. This addresses the original implementation defect. The build checker also catches missing guards, although layouts and certain special files remain outside its coverage. PR #15
> - The licence checker is materially stronger. Development and shipped dependencies follow the same rule; exceptions match named packages and versions; installed packages are cross-checked against the lock file. Passing this check still does not establish licence compliance. PR #9
> - The previous tracking corrections have landed. Attribution and review coverage are corrected, and runtime budget findings remain open. PR #7
>
> **My remaining challenges**
>
> 1. The proposed hold is not yet a proven upper bound. The implementation adds an explicitly assumed 5% plus 200 tokens to the provider's token estimate. Tests can demonstrate that this calculation is applied; they cannot establish that the margin always covers the bill. Even successful live examples would validate those examples, not prove a universal guarantee. Before real spending, Claude must distinguish the enforced reservation limit from the assumptions about provider charges.
> 2. A fault still does not automatically stop further spending. In the draft gateway, an accounting-write failure or a bill exceeding its hold calls the fault handler. It does not itself freeze the project. This is acknowledged as later work, so it is not grounds to reject the partial package—but it remains a blocker for real-model use.
> 3. Approval records remain unnecessarily ambiguous. The status file treats licence permissions as active while repeatedly saying the interpretation of your "a0 approved" is unconfirmed. Resolve the exact package names and scope in one decision entry. Likewise, the expired-hold question should reconcile the earlier decision with the later plan, which explicitly keeps those holds open.
>
> My advice: continue with container-only app setup and the remaining budget failure controls. Keep PR #12 unmerged until its completion criteria, integration conflicts and final review are settled. Avoid another broad planning cycle.
>
> This review examined code and recorded evidence; I did not independently rerun the runtime tests. No repository changes made.

## What the check found

| Challenge | Finding of the check | Done |
| --- | --- | --- |
| 1. The hold is not a proven upper bound | **Accurate.** The hold is the provider's token estimate plus an assumed margin, at the rates that apply to that count. What package 1.2's code enforces is a limit when a call is admitted: the gateway's own priced spend, plus open holds, plus this hold, within the cap. It does not enforce that a bill stays within its hold. Also found: an answer for a hold already kept or expired is written down but not compared with the hold; and a prompt counted just under the long-prompt threshold but billed over it costs five times as much per token for Claude Haiku 5.5 (by the gateway's price table). Several sentences claimed more: "the most a call can cost", "no way was found to exceed the cap", "the margin is set from measurement" | Pull request #12's description corrected on 12 Nov. The design note, known gaps 20 and 41 and the status file corrected in the records pull request that adds this file. The same wording on the 1.2 branch is corrected when that branch is brought up to date |
| 2. A fault does not stop further spending | **Partly accurate.** True of package 1.2's code: a fault is a warning message. The stop for a call that cannot be saved is already approved (amendment e) and is built in package 1.4 (proof row B10). For a bill above its hold, no package or proof row stops the project | Recorded in known gap 35 and the status file. Whether a bill above its hold should also stop the project is put to the owner (status file, "Yours to confirm", item vii) |
| 3. Approval records ambiguous | **Partly accurate.** The licence exceptions were recorded across several rows, and one row standing as the owner's held Claude Code's reading of "a0 approved". Gaps 8, 27 and 32 were stale. The expired-hold question did not say that package 1.2's code already builds the kept-open reading, or that the plan's wording is later than the decision it contradicts | One new row in `docs/DECISIONS.md` lists every exception as entered, with its version, and separates the owner's words from Claude Code's reading; question 10 in the status file asks the owner to confirm it; gaps 8, 27 and 32 corrected; question 5 (expired holds) given the three facts |

The review's advice on what comes next agrees with the plan's order. Package 0.5 (set-up in a tools container) is built and in review. The narrow journey it describes is packages 2.1 (a scripted engine that calls no model), 3.1 (the acceptance check, including a deliberately broken copy rejected) and 3.2 (export, started with the builder stopped); none of them needs the model key.
