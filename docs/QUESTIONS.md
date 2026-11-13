# Questions for the owner

Rules: build plan section 8, rule 11. At most six lines each, with the options and the recommendation; questions that block work come first. Numbers are kept from earlier records. Answered questions are recorded in `docs/DECISIONS.md`; the wording as first asked is in `docs/log/2026-11-13-status-before-rewrite.md`.

## Blocking work

None open right now. The approval request for the browser and the runner's two base images (it holds up 3.1) is being prepared and will be added here.

## Not blocking yet

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

- Proof rows B7 to B14 assigned to packages 1.3 to 1.5 (B7 asks more than 1.3's wording; 1.5 is taken after 1.4).
- Building known gap 35's proposal if no engineer is named by then.
- What "absent from what a customer receives" means for a development package an exported app lists (gap 39).
- Two suggested Arabic wording changes (`docs/arabic-wording-list.md`).
- R1: the type check, build and demonstration standing in for "existing tests pass"; option (a) for L11; merging pull request #10 with two "Done means" unmet (gap 46).
- How the hold's known limits are handled in package 1.2 (`docs/DECISIONS.md`, 12 Nov).
- Whether a bill above its hold should also stop the project's later calls (package 1.4 builds the stop).
- "Worst-case holds" read as the provider's estimate plus an assumed margin and the most output allowed, not a proven ceiling (gap 41).
- Package 2.1 marked tested on the reading recorded in `docs/DECISIONS.md` (12 Nov).
- A correction to `CLAUDE.md` line 64 (your file); the proposed wording is in the old status file, item (x).
- Where hard rule 2 stops: programs of the machine (git, PostgreSQL, Docker, the operating system) are not counted as the builder's dependencies.
- Gap 60: the boundary is fixed (package 0.6c) before code from the builder's own model calls runs; "fixed" means 0.6a's probe shows each such container reaching only what design note 2.5 allows.
- A caller who leaves before the call is forwarded has its hold released (package 1.2; design note 5.5, step 3).
- A hold kept after an error answer is not marked unreconciled, unlike design note 5.5's table (gap 62).
