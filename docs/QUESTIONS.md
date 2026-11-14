# Questions for the owner

Rules: build plan section 8, rule 11. At most six lines each, with the options and the recommendation; questions that block work come first. Numbers are kept from earlier records. Answered questions are recorded in `docs/DECISIONS.md`; the wording as first asked is in `docs/log/2026-11-13-status-before-rewrite.md`.

## Blocking work

None open right now. Question 15, the browser and the runner's two base images, was answered on 13 Nov 2026, "15 (a), approve both" (`docs/DECISIONS.md`); package 3.1 was then built.

## Not blocking yet

**22. Two of your sessions are working at once. Which one builds package 3.2, the export?** You told one "Then build the export, 3.2"; the other had begun 3.2's design at 10:25 UTC on 14 Nov and asked not to be doubled. Neither will start a second exporter.
(a) **The session that began the design builds it; the other stops after pull request #49** (recommended: its design is under way, and two exporters would repeat the J2 doubling).
(b) The session you told builds it, and the other stops its design.
(c) One designs, then the build is split between them.

**20. Which rule decides when a package is "tested"?** A rule of 12 Nov (Claude Code's) says: only when the commit a reviewer last read is the commit that is merged. Your rule of 13 Nov says: at most two review rounds. Fixes made after the last round are then merged unread, so the two pull apart. Seven merged packages and J2 are held at "built, not tested" on this (`docs/reviews/2026-11-14-state-of-merged-packages.md`).
(a) **Your two-round rule decides: a package is tested when its "Done means" ran and passed, it had its reviews, and nothing blocking was open at the merge; fixes after the last round are shown by tests** (recommended: it is your later rule, and it is what the plan's section 3 says).
(b) The 12 Nov rule decides: every fix is re-read before a package is called tested, whatever the number of rounds.
(c) (a) for most code; (b) for the gateway and the cap, isolation, acceptance separation and key handling.

**21. Is Vercel now allowed for a phone link?** A decision of 14 Nov, made in a session that started from `main`, says the Vercel connector is not used (outside the approved design; it can create paid resources). The status file of the session that merged J2 lists "a phone link through Vercel" as waiting on you. Both cannot stand.
(a) **Not allowed until a price and its source are shown to you and you say yes** (recommended: hard rule 4).
(b) Allowed for the phone link only; you have already said so to the other session.
(c) Not allowed at all; the phone test is done from a computer.

**19. New sessions start from `main`, which holds none of the work. How should that end?** Three sessions on 14 Nov started from `main`'s out-of-date record. Since pull request #46, `main` carries a notice that sends a session here; the work itself is still only on `claude/stage-1`.
(a) **You make `claude/stage-1` the repository's default branch in GitHub's settings** (recommended: new sessions then start on the work, and `main` keeps meaning "accepted by you").
(b) Merge `claude/stage-1` into `main` now, marked "built, not accepted".
(c) Leave it: the notice on `main` is enough until checkpoint 1.

**16. What is package 1.3 checked against?** Built to (a); the build does not wait on your answer.
(a) **Proof row B7 in full: a step refused before it starts, and a step that starts has its calls drawn from its reserved budget, the unused part released at its end.** Recommended: a running step cannot be starved by other spending or by a cap lowering.
Its cost: while a step runs, its whole reservation stops the cap being lowered, there is no command to stop a running step, and a cap raise does not top up a running step.
(b) The plan's wording only: the refusal before the step starts. The drawing and release would be extras, and B7's drawing part would move to 2.2, when a real engine carries the step's token.

**4. Make the repository private?** It is public today, and two outside reviewers have noted it.
(a) **Yes, now** (you change it in GitHub's settings; then Claude Code checks this session can still reach it). Recommended: nothing in it is meant for the public.
(b) Leave it public.

**7. The reviewing engineer: who?** Known gaps 35, 39, 41, 55 and 60 have points for an engineer, and 0.6c's design is to be read by one or by you.
(a) **Name someone now.** Recommended: 0.6c comes soon.
(b) Name them when the checkpoint 2 pack is ready.

**10. Your licence approval of 12 Nov ("a0 approved"): exactly what does it cover?** The exceptions are listed in `docs/DECISIONS.md` (12 Nov, "Licence exceptions approved"); the rule files accept each only at the version read then.
(a) **Confirm exactly those, each at its version; any version change is shown to you first.** Recommended: the narrowest reading.
(b) Same names; Claude Code may accept a newer version when its licence is unchanged.
(c) You name what to drop.

**3. The second stack (L10 or a waiver).** Django's database driver `psycopg` is LGPL-3.0. Holds up S1a, S1b and the comparison in 3.3 and 3.4.
(a) Approve `psycopg` for the comparison only. (b) Waive the comparison: one stack.
(c) **Decide later, at the latest before 3.3.** Recommended: nothing that can start today waits on it.

**6. The demo candidate.** (a) **D3, the commission leak report** (recommended: you can check every number yourself); (b) D1, the inspection tracker; (c) D2, the cylinder tracking.

**9. A demo server**, when you are ready to spend; not needed before package 0.6b. Prices read 11 Nov (`docs/OPEN-DECISIONS.md`, item 5).
(a) **Hetzner CPX32, €30.49 a month excluding VAT, no UAE location.** Recommended: lowest price read. (b) Oracle Cloud, Dubai. (c) AWS, UAE. (d) DigitalOcean, $48.00 a month. Prices for (b) and (c) could not be read.

**8. Did the Claude app show a page titled "builder: preview test" in the first session?** (a) Yes; (b) No; (c) Not sure.

## Yours to confirm, in your own time

Claude Code's readings and work, recorded as such, not as your decisions. Detail: `docs/log/2026-11-13-status-before-rewrite.md`, "Yours to confirm".

- **J2's second review (pull request #49):** Claude Code's choices in `docs/DECISIONS.md` (14 Nov, "J2's second review, built as follows"), among them the new screen sentence on what the broken-copy demonstration shows and does not show, in English and Arabic (`docs/arabic-wording-list.md`), and that a step of an interrupted project is no longer approved.
- The reading of your words of 14 Nov ("Fix it and build properly. Merge what needs to be merged."): pull request #46 merged into `main` (documents only); `claude/stage-1` itself **not** merged into `main` (question 19).
- **Gap 107, never put to you before:** with `--no-hold`, the journal recovery sets an unreadable line aside with no freeze and no event, so after a restart every project runs again. Package 1.4b's evidence says this "waits for the owner's yes".
- **J3's phone test, yours to run (two test pages, no data):** tell Claude Code "phone test"; it starts the two pages and adds "probe-a" and "probe-b" to your Claude app's preview list. Open probe-a and press its steps 1 to 6 in order (step 6 twice); open probe-b and press its steps; then say "done" and give three answers the report needs (since the fix after the review of 14787d8, 14 Nov 2026): what step 5 showed (a page saying "Port 4034 answered", or an error), whether the cached page's number stayed the same the second time, and whether probe-a opened in a private window where you are not signed in (or that you could not try). Without all three, or with a step missing, the report says "not decided" and names what to redo. *14 Nov 2026:* the Claude app on the owner's phone showed no preview list; the test is being tried from a computer at claude.ai/code instead. Claude Code reads what the pages recorded and says what the design's table decides. The live app stays "not yet approved for use" until then, and, since J3's review, off: it is turned on (`BUILDER_LIVE_PREVIEW=1`) only once the test is recorded (`evidence/2026-11-13-journey-j3/live-preview.md`, "Your phone test"; `builder/scripts/probe-phone.ts`).
- Proof rows B7 to B14 assigned to packages 1.3 to 1.5 (B7's extra over 1.3's wording is now question 16; 1.5 is taken after 1.4).
- The message a refused step shows, reworded from design note 5.5 for a step (package 1.3; the note of 13 Nov there).
- Known gap 35's proposal built in package 1.4 with no engineer named: proof row B10 rests on a design no engineer has reviewed.
- The messages of package 1.4: a frozen project's refusal, and the two 503 refusals (the gateway stopped after a fault; its database not usable). Wording Claude Code's.
- What "absent from what a customer receives" means for a development package an exported app lists (gap 39).
- Two suggested Arabic wording changes (`docs/arabic-wording-list.md`).
- R1: the type check, build and demonstration standing in for "existing tests pass"; option (a) for L11; merging pull request #10 with two "Done means" unmet (gap 46).
- How the hold's known limits are handled in package 1.2 (`docs/DECISIONS.md`, 12 Nov).
- "Worst-case holds" read as the provider's estimate plus an assumed margin and the most output allowed, not a proven ceiling (gap 41).
- Package 2.1 marked tested on the reading recorded in `docs/DECISIONS.md` (12 Nov).
- A correction to `CLAUDE.md` line 64 (your file); the proposed wording is in the old status file, item (x).
- Where hard rule 2 stops: programs of the machine (git, PostgreSQL, Docker, the operating system) are not counted as the builder's dependencies.
- Gap 60: the boundary is fixed (package 0.6c) before code from the builder's own model calls runs; "fixed" means 0.6a's probe shows each such container reaching only what design note 2.5 allows.
- A caller who leaves before the call is forwarded has its hold released (package 1.2; design note 5.5, step 3).
- Every kept hold is now marked unreconciled, as design note 5.5 says, including after an error answer (package 1.4; this changes how 1.2 behaved for proof row B19).
- Package 1.5: the actual cost you give is charged as given, above the hold too, with who asked and the evidence written as stated (gaps 97, 99); `docs/DECISIONS.md`, 13 Nov.
- Package 1.4c: the message a project frozen after a bill above its hold shows ("This project is stopped: a model call that ended at [time] was billed $[bill], more than its hold of $[hold] (above it by $[difference]). That bill is charged in full. The gateway forwarded nothing, and no further call will be made for this project until the owner records that bill."), and the one after a late answer above its hold; figures to the millionth of a dollar, not the cent. Wording Claude Code's; also that a late answer above its hold freezes and your own reconciliation above it does not (`docs/DECISIONS.md`, 13 Nov).
- Package 1.4c: question 17, which you answered (a), said package 1.5 would clear the freeze. 1.5's reconciliation records a cost for a hold still open, and a settled bill's hold is closed, so 1.4c adds to 1.5's script a separate recorded action, `scripts/reconcile.ts --overrun`: it records who asked, why and the evidence, clears that one freeze, and takes no cost, because the bill was already charged (gap 115).
- Package 1.4c, after its review: a call cut off or left part-way whose usage, as read before it ended, already shows it above its hold now freezes its project too, until you reconcile that hold; its message: "This project is stopped: a model call that ended at [time], without a bill the gateway could settle, had already used at least $[cost] by the usage figures read before it ended, more than its hold of $[hold] (above it by $[difference]). The hold stays counted at its full amount. The gateway forwarded nothing, and no further call will be made for this project until the owner records what that call cost." Wording and reading Claude Code's (gap 144).
- The approved-images check lets the builder's own images (`builder_<project>-app` and `-tools`, built from the template, never pulled) go without a digest (gap 68).
- The counting rules for the runner's base images: "and/or" not split; both keyring packages counted as copyleft (`docs/licences/runner-base-images.md`, section 3).
- `CLAUDE.md` line 63 (your file): Claude Code's sentence on Docker failing to start on 12 Nov, its fix and a pointer to a second failure, merged with pull request #8 at your request; keep, change or remove.
- Package 3.1: the runner's Ubuntu packages are installed by exact version, and the build fails on any other, rather than by name through Playwright's installer (`docs/DECISIONS.md`, 13 Nov).
- Package 3.1: where the approved browser zip is not on the machine, the live acceptance tests are skipped (reported as skipped), not failed (gap 73).
- Package 3.1: the runner's trace is kept without its screencast, so no frames of the screen are recorded; read as what "no video recorded" asks (`docs/DECISIONS.md`, 13 Nov, after the review).
- Package 3.1: a line for `CLAUDE.md`'s Commands: "in `builder/runner/`, run `npm ci --ignore-scripts` once before `npm run check:licences`" (gap 77). Say yes and Claude Code adds it.
- Package J1: on a first run, the first visitor to reach the interface chooses its password (12 characters or more; only its digest is kept, mode 0600); only this machine and the session's preview can reach it, and a project container can too until 0.6c (gap 131).
- Package J1: the builder's own sign-in is written by hand with Node's scrypt, for one user, until an engineer reads it (gap 130).
- Package J1: the question bank shown word for word, its three inconsistencies as written (gap 133); where B2's mapping for example 1 is silent, the answer sheet follows the app spec.
- Package J1: the builder's own screens in English and Arabic, wording Claude Code's (`docs/arabic-wording-list.md`; gap 134).
- Package J1: the two cameras as built under your answer A (a): the builder camera in a container of its own on this machine's network, the app camera in the project's runner container; no video, no trace (gap 138).
- Package J1, after its review: every request to the interface but a GET or HEAD must be a form; sign-off judged on the last checklist job; an interrupted step's reservation closed at start (`docs/DECISIONS.md`, 13 Nov).
- Package J1: sign-off offered only after a checklist run that passed, and labelled as a sign-off on a simulated build checked by a stand-in test of item 1 only.
- Package J1: the export holds the project's history and, in the exported copy only, the stand-in tests and a note; labelled internal only.
- Package J1: a build refused below 4 GB of free disk, a floor assumed, not measured (gap 137).
- Package J2: Claude Code's choices, each yours to overrule (`docs/DECISIONS.md`, 14 Nov): a broken copy never exported rather than labelled; sign-off and export refused on any trace of it; a stop on purpose removes your open projects' containers at the stop; the stop's limits of 30 s, 5 s and 90 s (chosen, not measured, gap 179); a demonstration pause setting, off by default (gap 181); after its review, names that only look like the demonstration's recorded, not refused (gap 182). Your answer on where the demonstration's button lives ("Always on Projects") is recorded there word for word.
