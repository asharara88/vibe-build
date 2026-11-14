"""Package J2 controls (docs/design/journey-j2.md, section 6): each safeguard removed in turn by exact replacement in
builder's code (each text to replace must occur exactly once in its file when it is replaced), the test or tests that
guard it run alone, the verdict of each, then the files restored with git checkout and the tree checked unchanged.
Before the controls, every named test is run once on the tree as committed, where it must pass, alone (so that each
name matches exactly one test). Run from builder/, holding the machine's shared lock for live tests (the script takes
no lock itself):
  BUILDER_TEST_DATABASE_URL=... TMPDIR=... flock <the live tests' lock file> python3 ../evidence/2026-11-13-journey-j2/controls-scripts/controls.py <out file> [control ids]
Most of these tests start no container (stand-in sandboxes, or a made-up docker program). Not so the tests of
test/removal-live.test.ts, which six controls of known gap 180 name (J2-C54, J2-C59, J2-C61 to J2-C63 and J2-C78): they
need real Docker and the approved Node image, and each run of one, in the baseline and again in its control, makes
Docker networks (one test a volume too) and starts small containers of its own, removed when it ends; one of them needs
chattr. C5 starts the real interface process on ports the system gives and signals only the processes it started.
Written in the style of J3's controls.py. (Header corrected 14 Nov 2026, after the review of known gap 180's fix: it
said that no container is started, and its usage line took no lock.)
Since the second review round of known gap 180 (14 Nov 2026), seven controls name tests of test/removal-live.test.ts
(J2-C82 too), and the script keeps, on a line of its own under each control, the first failure vitest printed for each
of its tests: its message and the first place in a test file it names. Before, it kept only vitest's two summary lines,
so a verdict said that the test failed, not why. A test that failed in its own clean-up (the drop of the database it
made: known gap 185) no longer counts: a line under the control says "NOT AS EXPECTED: ... run this control again", and
the result at the end is then "NOT every one failed as it should". Nothing of the verdict rule that was there before
is changed: these lines are added after it, and can only take a "failed, as it should" away.
  python3 controls.py --read <file of vitest output>   prints what the script reads from that output, and runs nothing."""
import re, subprocess, sys, datetime

J = "test/journey.test.ts"
W = "test/web.test.ts"
JOURNEY = "src/orchestrator/journey.ts"
JOBS = "src/orchestrator/journey-jobs.ts"
PAGES = "src/web/pages.ts"
MAIN = "src/web/main.ts"
ADAPTER = "src/orchestrator/example-1-adapter.ts"
LIVE = "test/removal-live.test.ts"

# (id, what was removed, file or list of files (one per replacement), replacements, tests that must then fail).
CONTROLS = [
 # ---------------------------------------------------------------- J2 (a): section 6's controls table
 ("J2-C01", "the plan check in buildStepRefusal (a step not of the plan accepted)", JOURNEY,
  [('  if (!step || !s.plan.includes(step)) return "That step is not one of the plan\'s.";', '  if (!step) return "That step is not one of the plan\'s.";')],
  [(W, "A1b")]),
 ("J2-C02", "the choice honoured on any intake.brief_entered, not only the project's first event", JOURNEY,
  [("  const first = events[0];\n", '  const first = events.find((e) => e.kind === EV.briefEntered && "broken_copy" in e.payload) ?? events[0];\n')],
  [(W, "A1b"), (J, "A3: the choice is honoured only on")]),
 ("J2-C03", "the transaction (the project row and its first event written separately, on the pool)", JOURNEY,
  [("    await inTransaction(this.pool, id, async (c) => {\n      await createProject(c, { id, name: BROKEN_COPY_NAME, capUsd: BROKEN_COPY_CAP_USD });\n      await event(c, id, EV.briefEntered, { text: brief, characters: brief.length, given_to_engine: false, broken_copy: choice }, null);\n    });\n",
    "    await createProject(this.pool, { id, name: BROKEN_COPY_NAME, capUsd: BROKEN_COPY_CAP_USD });\n    await appendEvent(this.pool, id, EV.briefEntered, { text: brief, characters: brief.length, given_to_engine: false, broken_copy: choice });\n")],
  [(J, "A2: the project row and its first event are written in one transaction")]),
 ("J2-C04", "the name refusal on the New project form", JOURNEY,
  [('    if (name.replace(/\\s+/g, " ").toLowerCase().startsWith(BROKEN_COPY_NAME_PREFIX.toLowerCase())) {', "    if (false) {")],
  [(W, "A2b")]),
 ("J2-C05", "the state check before staging (brokenStageRefusal not asked in the job: every build step stages)", JOBS,
  [("        const stageRefused = brokenStageRefusal(state, step);", "        const stageRefused = null as string | null;")],
  [(J, "A1 \\(regression guard\\)"), (J, "A4: the job checks the state again before staging")]),
 ("J2-C06", "\"just before step 3\": the broken step staged when the sandbox is made (at step 1) instead", JOBS,
  [("          this.handles.set(projectId, x);\n", "          this.handles.set(projectId, x);\n          if (state.brokenCopy) await this.stageBroken(projectId, x, state, BROKEN_STEP);\n"),
   ("        if (stageRefused === null) await this.stageBroken(projectId, sandboxNow, state, step);\n", "        if (stageRefused === null) {\n          // staged when the sandbox was made\n        }\n")],
  [(J, "A4: step 3 is staged once, just before its engine")]),
 ("J2-C07", "the job's target check before staging (a change-set folder outside the sandbox's own accepted)", JOBS,
  [("    const target = brokenStageTargetProblem(x);", "    const target = null as string | null;")],
  [(J, "A4: a sandbox whose change-set folder is outside its own folder")]),
 ("J2-C08", "the read-back of the staged manifest (its SHA-256 read from builder/scripted-broken, not the sandbox's copy)", JOBS,
  [('    const body = readFileSync(join(x.changeSets, EXAMPLE, step, "manifest.json"));', '    const body = readFileSync(join(changeSetsFor(step), EXAMPLE, step, "manifest.json"));')],
  [(J, "A4: a staged manifest whose SHA-256 is not the one chosen")]),
 ("J2-C09", "changeSetsFor (every step, the broken one too, read from builder/scripted)", JOURNEY,
  [("  return step === BROKEN_STEP ? BROKEN_CHANGE_SETS_DIR : CHANGE_SETS_DIR;", "  return CHANGE_SETS_DIR;")],
  [(J, "A2: the demonstration makes one project")]),
 ("J2-C10", "the broken-copy rule in signOffRefusal", JOURNEY,
  [("  if (s.brokenTrace) return BROKEN_COPY_REFUSAL;\n", "")],
  [(J, "A6:"), (W, "A6:")]),
 ("J2-C11", "the broken-copy rule in JOB_RULES.export", JOURNEY,
  [(" : s.brokenTrace ? BROKEN_COPY_REFUSAL : null),", " : null),")],
  [(J, "A6:"), (W, "A6:")]),
 ("J2-C12", "the refusals on any trace of the broken copy (brokenTrace read from the honoured choice alone)", JOURNEY,
  [("  s.brokenTrace = s.plan.includes(BROKEN_STEP) || events.some(isBrokenTrace);", "  s.brokenTrace = s.brokenCopy !== null;")],
  [(J, "A6:"), (W, "A6:")]),
 ("J2-C13", "the warning when a broken copy's checklist run reads \"passed\"", PAGES,
  [('${s.brokenTrace && outcome === "passed" ? html`<p class="warn" data-broken-passed>', '${false ? html`<p class="warn" data-broken-passed>')],
  [(W, "A6:")]),
 ("J2-C14", "the live refusal for a broken copy (JOB_RULES.live goes straight to the scripted-only check)", JOURNEY,
  # Updated on 14 Nov 2026 after the merge of the integration branch at c4f198b: the sign-off fix put its own refusal
  # (LIVE_AFTER_SIGN_OFF) before "the app is not running", so the same three lines now sit two spaces deeper.
  [("          : s.brokenTrace\n            ? BROKEN_LIVE_REFUSAL\n            : scriptedOnlyProblem(s),", "          : scriptedOnlyProblem(s),")],
  [(J, "A7:"), (W, "A7:")]),
 ("J2-C15", "the badge helper (no badge drawn)", PAGES,
  [("  return s.brokenTrace ? html` <span class=\"label\" data-broken-badge>", "  return false ? html` <span class=\"label\" data-broken-badge>")],
  [(W, "A2 and A8")]),
 ("J2-C16", "the banner line in the app camera", "camera/app-shots.mjs",
  [('    console.log(JSON.stringify({ kind: "banner", name: s.name, text }));\n', "")],
  [(J, "A8b")]),
 ("J2-C17", "s.interrupted in signOffRefusal", JOURNEY,
  [('  if (s.interrupted) return "This project was interrupted when the interface stopped, so it is not signed off. Close the project, or start a new one.";\n', "")],
  [(J, "A9:"), (W, "A9:")]),
 # ---------------------------------------------------------------- J2 (c): section 6's controls table
 ("J2-C18", "the halt in stopOnSignal (the journey not halted; the running job not told to stop)", MAIN,
  # Text as it stands since the second review's reordering (the halt before the live preview's stop).
  [("    const halting = o.journey.halt(why);\n", "    const halting: Promise<void> = Promise.resolve();\n")],
  [(W, "C1: stopOnSignal")]),
 ("J2-C19", "removal before release (the lock released before the removal)", MAIN,
  [("    // 4 and 5. The removal, asking the lock of the database before each project, each ask bounded.\n", "    await o.lock.release().catch(() => undefined);\n    // 4 and 5. The removal, asking the lock of the database before each project, each ask bounded.\n"),
   ("    // 6. The lock released only now, so that no other interface on this database runs its recovery meanwhile.\n    await o.lock.release().catch(() => undefined);\n", "    // 6.\n")],
  [(W, "C1: stopOnSignal")]),
 ("J2-C20", "the closed-project check in the stop's removal (a closed project whose record names a sandbox removed)", JOURNEY,
  [('      const leftSandbox = s.stage !== "closed" ? s.sandbox : null;', "      const leftSandbox = s.sandbox;")],
  [(W, "C2: at a stop on SIGINT")]),
 ("J2-C21", "the \"j1-\" filter, in both the query and the loop", JOURNEY,
  [("    for (const r of await listProjects(this.pool, { idPrefix: JOURNEY_PREFIX })) {\n      if (!r.id.startsWith(JOURNEY_PREFIX)) continue;\n", "    for (const r of await listProjects(this.pool, {})) {\n")],
  [(W, "C2: at a stop on SIGINT")]),
 ("J2-C22", "the lock check before each removal (mayRemove not asked)", JOURNEY,
  [("      const refused = o.mayRemove ? await o.mayRemove() : null;", "      const refused = null as string | null;")],
  [(W, "C3: the lock found lost")]),
 ("J2-C23", "the bound on the lock check (the stop waits for the database's answer however long)", MAIN,
  [("        const asked = await within(o.lock.check(), lockCheckMs);", "        const asked = { done: true as const, value: await o.lock.check() };")],
  [(W, "C3: the lock found lost")]),
 ("J2-C24", "the bounded wait: the project of a job still running is removed (not left)", JOURNEY,
  [("      if (this.running?.projectId === r.id) {\n        if (at === \"stop\") out.left.push({ projectId: r.id, why: `its job ${this.running.jobId} had not ended when the wait ended` });\n        continue;\n      }\n", "")],
  [(W, "C4: a job that has not ended within the wait")]),
 ("J2-C25", "the second-signal handler (a second signal starts a second stop)", MAIN,
  [("    if (stopping) {", "    if (false) {")],
  [(W, "C4b: a second stop signal")]),
 ("J2-C26", "the pause only when set (the engine always given a pause)", JOBS,
  [("                ...(pause > 0 ? { delayMsPerWrite: pause } : {}),", "                delayMsPerWrite: pause || 4000,")],
  [(J, "C6: the demonstration pause: with stepPauseMs set")]),
 ("J2-C27", "the second wording of the interrupted panel (always \"A job of this project was interrupted\")", PAGES,
  [('${t(lang, jobInterrupted ? "interrupted.message" : "interrupted.no_job")}', '${t(lang, "interrupted.message")}')],
  [(W, "C7: the interrupted panel")]),
 ("J2-C28", "the cost screen's note on a reservation of a step stopped part-way", PAGES,
  [('${h.state === "closed" && partWay.has(String(h.id)) ? html`<br>', '${false ? html`<br>')],
  [(W, "C7: the interrupted panel")]),
 ("J2-C29", "the stopping flag in unavailable (the 503 hook reads only a lost lock)", MAIN,
  [("  return () => lock.lost() ?? flag.why;", "  return () => lock.lost();")],
  [(W, "C9: from the stop signal on")]),
 ("J2-C30", "the wait on each project's chain of actions at the stop", JOURNEY,
  [("        const chain = this.locks.get(r.id);", "        const chain = undefined as Promise<unknown> | undefined;")],
  [(J, "C10: a Close project in progress")]),
 ("J2-C31", "the stop's last bound (90 s; here given 0.8 s by the test) never fires", MAIN,
  [("  deadline = setTimeout(() => {\n    if (exited) return;\n", "  deadline = setTimeout(() => {\n    return;\n    if (exited) return;\n")],
  [(W, "C11: the stop")]),
 # ---------------------------------------------------------------- safeguards the builders added (section 13), each with its test
 ("J2-C32", "the name refusal's folding of case and spacing (only the exact prefix refused)", JOURNEY,
  [('name.replace(/\\s+/g, " ").toLowerCase().startsWith(BROKEN_COPY_NAME_PREFIX.toLowerCase())', "name.startsWith(BROKEN_COPY_NAME_PREFIX)")],
  [(W, "A2b")]),
 ("J2-C33", "the job's refusal of the broken step when staging is refused (it runs unstaged instead)", JOBS,
  [("        else if (step === BROKEN_STEP) throw new JourneyRefused(stageRefused);\n", "")],
  [(J, "A4: the job checks the state again before staging")]),
 ("J2-C34", "the SHA-256 comparison of the staged manifest with the one chosen", JOBS,
  [("    if (digest !== chosen) {", "    if (false) {")],
  [(J, "A4: a staged manifest whose SHA-256 is not the one chosen")]),
 ("J2-C35", "the target check's \"not under builder/\" part", JOURNEY,
  [("  if (insideOrEqual(own, resolve(BUILDER_DIR)) || insideOrEqual(realpathAsFar(own), builder))", "  if (false)")],
  [(J, "A4: a sandbox whose change-set folder is outside its own folder")]),
 ("J2-C36", "the stop signal not set at the stop (stopOnSignal does not set the flag)", MAIN,
  [("    o.flag.set();\n", "")],
  [(W, "C9: from the stop signal on")]),
 ("J2-C37", "the wait for the running job not bounded (the stop waits for the halt however long)", MAIN,
  [("    const halted = await within(halting, waitUntil - Date.now());", "    const halted = { done: true as const, value: await halting };")],
  [(W, "C4: a job that has not ended within the wait")]),
 ("J2-C38", "the removal loop does not stop once the process has exited (goOn not read)", JOURNEY,
  [("      if (o.goOn && !o.goOn()) break;\n", "")],
  [(W, "C11: the stop")]),
 ("J2-C39", "the pause setting's upper bound (more than 10,000 ms accepted)", MAIN,
  [(" || Number(pause) > MAX_DEMO_STEP_PAUSE_MS)", ")")],
  [(W, "C6: the demonstration pause: BUILDER_DEMO_STEP_PAUSE_MS")]),
 ("J2-C40", "the pause not recorded (no journey.step.paused_for_demonstration)", JOBS,
  [("        if (pause > 0) await appendEvent(this.j.pool, projectId, EV.stepPaused,", "        if (false) await appendEvent(this.j.pool, projectId, EV.stepPaused,")],
  [(J, "C6: the demonstration pause: with stepPauseMs set")]),
 ("J2-C41", "the build screen does not say the pause is on", PAGES,
  [('${o.stepPauseMs ? html`<p class="warn" data-step-pause=', '${false ? html`<p class="warn" data-step-pause=')],
  [(W, "C6: the demonstration pause: BUILDER_DEMO_STEP_PAUSE_MS")]),
 ("J2-C42", "the clean stop not installed on SIGTERM in the real process (the old handler's place left empty)", MAIN,
  [('  process.on("SIGTERM", () => void onStop("SIGTERM"));\n', "")],
  [(W, "C5: the real interface")]),
 # ---------------------------------------------------------------- after the review of 14 Nov 2026 (journey-j2.md, "After the review")
 ("J2-C43", "the trace rule for a journey.plan_confirmed that lists step 03 (isBrokenTrace)", JOURNEY,
  [('  if (e.kind === EV.planConfirmed) return Array.isArray(e.payload.steps) && e.payload.steps.some((st: unknown) => st === BROKEN_STEP || (typeof st === "object" && st !== null && (st as { step?: unknown }).step === BROKEN_STEP));\n', "")],
  [(J, "A6b")]),
 ("J2-C44", "the target check's real-path half (only the path as written compared with builder/)", JOURNEY,
  [("  if (insideOrEqual(own, resolve(BUILDER_DIR)) || insideOrEqual(realpathAsFar(own), builder))", "  if (insideOrEqual(own, resolve(BUILDER_DIR)))")],
  [(J, "A4b")]),
 ("J2-C45", "the real path read as far as the path exists (back to: the path itself when it does not exist yet)", JOURNEY,
  [("      if (up === head) return whole;\n", "      if (up === head || true) return whole;\n")],
  [(J, "A4b")]),
 # ---------------------------------------------------------------- after J2's second review (14 Nov 2026, pull request #49)
 ("J2-C46", "second review: approval of a step of an interrupted project not refused", JOURNEY,
  [("  if (s.interrupted) return APPROVE_INTERRUPTED;\n", "")],
  [(W, "C12 \\(after J2's second review\\)")]),
 ("J2-C47", "second review: the live preview stopped before the journey is halted, as before that review", MAIN,
  [("    const halting = o.journey.halt(why);\n    halting.catch(() => undefined);\n    await o.preview?.stop().catch(() => undefined);\n",
    "    await o.preview?.stop().catch(() => undefined);\n    const halting = o.journey.halt(why);\n    halting.catch(() => undefined);\n")],
  [(W, "C12 \\(after J2's second review\\)")]),
 ("J2-C48", "second review: the target check does not look for a link at the folders the copy goes through", JOURNEY,
  [("    if (seen?.isSymbolicLink()) return", "    if (false) return")],
  [(J, "A4c \\(after J2's second review\\)")]),
 ("J2-C49", "second review: the real adapter's own target check before the copy (stageBrokenStep copies whatever it is given)", "src/orchestrator/example-1-adapter.ts",
  [("      const why = brokenStageTargetProblem(x);\n      if (why) throw new JourneyRefused(`The broken step was not staged: ${why}.`);\n      stageBrokenStepInto(x);", "      stageBrokenStepInto(x);")],
  [(J, "A4c \\(after J2's second review\\)")]),
 ("J2-C50", "second review: N's process rule matches the Compose name only, not the sandbox's folder", "scripts/journey-restart-checks.ts",
  [("if (p.args.includes(compose) || (folder.path !== null && p.args.includes(folder.path))) out.push(", "if (p.args.includes(compose)) out.push(")],
  [(J, "C8 \\(regression guard\\)")]),
 ("J2-C51", "second review: the demonstration's limit not shown on the panel or on the checklist screen", PAGES,
  [('<p class="note" data-demo-limit>${t(lang, "demo.limit")}</p><div class="actions">', '<div class="actions">'),
   ('<p class="note" data-demo-limit>${t(lang, "demo.limit")}</p>` : ""}`,', '` : ""}`,')],
  [(W, "A2 and A8:"), (W, "A8: the broken copy through the screens")]),
 # ---------------------------------------------------------------- after the fresh review of pull request #49 itself
 ("J2-C52", "review of #49: the copy does not first remove what is at the step's own folder (a link inside it is followed)", "scripts/example-1-sandbox.ts",
  [("  rmSync(into, { recursive: true, force: true });\n", "")],
  [(J, "A4c \\(after J2's second review\\)")]),
 ("J2-C53", "review of #49: the wait for the job starts again after the live preview's stop, instead of counting from the halt", MAIN,
  [("    const halted = await within(halting, waitUntil - Date.now());", "    const halted = await within(halting, waitMs);")],
  [(W, "C13 \\(after the review of pull request #49\\)")]),
 # ---------------------------------------------------------------- known gap 180's fix (14 Nov 2026): a removal is checked
 # J2-C54 and J2-C55: their texts updated on 14 Nov 2026, after the fix's review moved them (what they remove is the same).
 ("J2-C54", "gap 180: the end of a removal does not read Docker's lists (whatever is left, it reports the removal as done)", ADAPTER,
  [("  const left = await dockerLeftovers(projectId, env);\n", "  const left: string[] = [];\n")],
  [(LIVE, "a network of the project that Docker will not remove")]),
 ("J2-C55", "gap 180: Docker's lists that cannot be read are read as nothing left", ADAPTER,
  [("    return [`${DOCKER_NOT_ASKED} (${dockerSaid(err, timeoutMs)})`];", "    return [];")],
  [(J, "C16 \\(known gap 180's fix\\)")]),
 ("J2-C56", "gap 180: Close project closes the project although its removal left something", JOURNEY,
  [("        throw new JourneyRefused(closeNotRemovedRefusal(err.left));\n", "")],
  [(W, "C15 \\(known gap 180's fix\\)")]),
 ("J2-C57", "gap 180: at a stop or a start, what a removal left is not written in its record", JOURNEY,
  [("        if (err instanceof SandboxNotRemoved) leftBehind = err.left;\n", "")],
  [(W, "C14 \\(known gap 180's fix\\)")]),
 ("J2-C58", "gap 180: the screen does not say that a removal left something", PAGES,
  [("  if (!s.removalLeft) return \"\";\n", "  if (s.removalLeft || !s.removalLeft) return \"\";\n")],
  [(W, "C14 \\(known gap 180's fix\\)"), (W, "C15 \\(known gap 180's fix\\)")]),
 # ---------------------------------------------------------------- after the review of known gap 180's fix (14 Nov 2026): one control for each new safeguard
 ("J2-C59", "gap 180 review, item 1: Docker's lists asked and read as tab-separated text again, not one JSON object a line (a tab in a name shifts its label out of sight)", ADAPTER,
  [('`{"name":{{json .${name}}},"project":{{json (.Label "com.docker.compose.project")}}}`;', '`{{.${name}}}\\t{{.Label "com.docker.compose.project"}}`;'),
   ('    const named = (out: string, what: string) => jsonLines(out, "name", "project", what).map((x) => ({ name: x.name, composeProject: x.project }));',
    '    const named = (out: string, _what: string) => out.split("\\n").filter((l) => l.trim() !== "").map((l) => ({ name: (l.split("\\t")[0] ?? "").trim(), composeProject: (l.split("\\t")[1] ?? "").trim() }));')],
  [(LIVE, "with a tab in its name")]),
 ("J2-C60", "gap 180 review, item 1: a line of Docker's list that cannot be read is passed over, not reported", ADAPTER,
  [("      if (typeof r[a] !== \"string\" || typeof r[b] !== \"string\") throw new Error(`a line of Docker's list of ${what} could not be read`);", "      if (typeof r[a] !== \"string\" || typeof r[b] !== \"string\") return [];")],
  [(J, "C21 \\(known gap 180, after its review\\)")]),
 ("J2-C61", "gap 180 review, item 2 (a): a folder that cannot be removed gives a plain error again, not SandboxNotRemoved", ADAPTER,
  [("  throw new SandboxNotRemoved(projectId, [`folder ${dir} (not removed: ${code})`]);", "  throw first;")],
  [(LIVE, "a folder that cannot be removed in full")]),
 ("J2-C62", "gap 180 review, item 2 (b): the compose file is not kept for last when the folder is removed", ADAPTER,
  [("    for (const entry of entries.filter((e) => e !== \"compose.yaml\")) attempt(", "    for (const entry of entries) attempt(")],
  [(LIVE, "a folder that cannot be removed in full")]),
 ("J2-C63", "gap 180 review, item 2 (c): a recorded folder that fails its own check stops the removal before Docker is asked, with a plain error, as before", ADAPTER,
  [("      const why = recordedSandboxRefusal(projectId, rec.dir);\n", "      const why = recordedSandboxRefusal(projectId, rec.dir);\n      if (why) throw new Error(`The sandbox of ${projectId} was not removed: ${why}.`);\n")],
  [(LIVE, "a recorded folder that fails its own check")]),
 ("J2-C64", "gap 180 review, item 3: the start's count line counts every project looked at, also one whose removal left something", MAIN,
  [("${r.touched.filter((id) => !left.has(id)).length}.`,", "${r.touched.length}.`,")],
  [(W, "C14 \\(known gap 180's fix\\)")]),
 ("J2-C65", "gap 180 review, item 3: no line at start names a project left", MAIN,
  [("    ...r.left.map((x) => `[interface starting] ${leftForNextStart(x)}`),\n", "")],
  [(W, "C14 \\(known gap 180's fix\\)")]),
 ("J2-C66", "gap 180 review, item 4: the refusal of Close project says again that nothing else was changed", JOURNEY,
  # Its text updated on 14 Nov 2026, second review round: the sentence it replaces was corrected (it said "its app is stopped").
  [('      : "After the removal, Docker\'s lists were read: they hold nothing more of this project than what is named as left. A container named there may still be running."', '      : "Nothing else was changed."')],
  [(W, "C15 \\(known gap 180's fix\\)")]),
 ("J2-C67", "gap 180 review, item 5: a job is started for a project whose removal is not finished", JOURNEY,
  [("      if (removalNotFinished(s)) throw new JourneyRefused(REMOVAL_NOT_FINISHED);\n", "")],
  [(W, "C17 \\(known gap 180, after its review\\)"), (W, "C19 \\(known gap 180, after its review\\)")]),
 ("J2-C68", "gap 180 review, item 5: a project whose removal is not finished can be signed off", JOURNEY,
  [("  // After the review of known gap 180's fix: a project whose removal is not finished is not signed off (its app is gone).\n  if (removalNotFinished(s)) return REMOVAL_NOT_FINISHED;\n", "")],
  [(W, "C17 \\(known gap 180, after its review\\)")]),
 ("J2-C69", "gap 180 review, item 5: a step's approval is not refused for a removal not finished (it gets the step's ordinary answer)", JOURNEY,
  [("  // After the review of known gap 180's fix: nothing of a project whose removal is not finished is approved.\n  if (removalNotFinished(s)) return REMOVAL_NOT_FINISHED;\n", "")],
  [(W, "C17 \\(known gap 180, after its review\\)")]),
 ("J2-C70", "gap 180 review, item 5: the pages of a project whose removal is not finished go on offering its next action", PAGES,
  [("const noMoreWork = (s: JourneyState): boolean => s.interrupted || removalNotFinished(s);", "const noMoreWork = (s: JourneyState): boolean => s.interrupted;")],
  [(W, "C17 \\(known gap 180, after its review\\)"), (W, "C19 \\(known gap 180, after its review\\)")]),
 ("J2-C71", "gap 180 review, item 5: no panel says that the removal is not finished, with Close project and New project", PAGES,
  [('${!s.interrupted && removalNotFinished(s) ? removalNotFinishedPanel(lang, s) : ""}', '${""}')],
  [(W, "C17 \\(known gap 180, after its review\\)"), (W, "C19 \\(known gap 180, after its review\\)")]),
 ("J2-C72", "gap 180 review, item 6: the stop's reason for a removal that left something holds \"removed at the stop\" again", JOURNEY,
  [('export const NOT_REMOVED_AT_STOP = "The interface was stopped on purpose; the removal of this project\'s sandbox did not finish at the stop: something of it is left. The next start tries again. It is not resumed.";',
    'export const NOT_REMOVED_AT_STOP = "The interface was stopped on purpose; not everything of this project could be removed at the stop. The next start tries again. It is not resumed.";')],
  [(J, "C20 \\(known gap 180, after its review\\)")]),
 ("J2-C73", "gap 180 review, item 7: what was left is written into the sentence with no left-to-right span of its own", PAGES,
  [('html`<span lang="en" dir="ltr">${left}</span>${a}`)}</p>`;', 'html`${left}${a}`)}</p>`;')],
  [(W, "C14 \\(known gap 180's fix\\)"), (W, "C15 \\(known gap 180's fix\\)")]),
 ("J2-C74", "gap 180 review, item 7: the four list commands have no time limit", ADAPTER,
  [("    const ask = { env: env ?? removalDockerEnv(null), timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 };", "    const ask = { env: env ?? removalDockerEnv(null), maxBuffer: 16 * 1024 * 1024 };")],
  [(J, "C21 \\(known gap 180, after its review\\)")]),
 ("J2-C75", "gap 180 review, item 7: Docker's own words are not read from its error output (the error's message is used)", ADAPTER,
  [("  if (last !== undefined) return last.slice(0, 300);\n", "")],
  [(J, "C21 \\(known gap 180, after its review\\)")]),
 ("J2-C76", "gap 180 review, item 7: on an interrupted project the note names Close project in other words than the button beside it (they differ in Arabic)", PAGES,
  [('${removalLeftNote(lang, s, t(lang, "interrupted.close"))}', '${removalLeftNote(lang, s, t(lang, "close.button"))}')],
  [(W, "C14 \\(known gap 180's fix\\)")]),
 ("J2-C77", "gap 180 review, item 8: a removal asks Docker with settings of its own, not the sandbox's (a Docker context the sandbox refuses is not refused)", ADAPTER,
  [("    return removalDockerEnv(clientDir);\n", "    return { PATH: process.env.PATH ?? \"\", HOME: process.env.HOME ?? \"/root\", DOCKER_CONFIG: join(clientDir ?? NO_DOCKER_CLIENT, \"docker-client\") };\n")],
  [(J, "C22 \\(known gap 180, after its review\\)")]),
 ("J2-C78", "gap 180 review, item 9: the removal with a handle removes the folder with no sweep and no check, as before the fix", ADAPTER,
  [("      return sweepAndCheck(x.projectId, x.dir, env);\n", "      rmSync(x.dir, { recursive: true, force: true });\n      return \"removed with no check, as before the fix\";\n")],
  [(LIVE, "the removal with a handle")]),
 ("J2-C79", "gap 180 review, item 10: the stop's loop ends at the first project whose removal leaves something (the projects after it are not removed)", JOURNEY,
  [("        removed = false;\n", "        removed = false;\n        o.goOn = () => false;\n")],
  [(W, "C18 \\(known gap 180, after its review\\)")]),
 # ---------------------------------------------------------------- second review round of known gap 180's fix (14 Nov 2026)
 ("J2-C80", "gap 180, second round: a recorded folder that failed its own check has its Docker client folder used all the same", ADAPTER,
  [("      const env = removalEnvOrNotRemoved(projectId, why === null ? rec.dir : null);\n", "      const env = removalEnvOrNotRemoved(projectId, rec.dir);\n")],
  [(J, "C23 \\(known gap 180, second review round\\)")]),
 ("J2-C81", "gap 180, second round: Compose's own removal is run on a recorded folder that failed its own check (it would act on whatever project the folder's compose file names)", ADAPTER,
  [("      if (why === null && existsSync(join(rec.dir, \"compose.yaml\"))) {", "      if (existsSync(join(rec.dir, \"compose.yaml\"))) {")],
  [(J, "C23 \\(known gap 180, second review round\\)")]),
 ("J2-C82", "gap 180, second round: the folder's own removal is not asked for before its compose file is removed (a folder that cannot itself be removed is left empty, with no compose file)", ADAPTER,
  [("    if (errors.length === 0) attempt(() => folderItselfCanGo(dir));\n", "")],
  [(LIVE, "second review round: the folder itself cannot be removed")]),
 ("J2-C83", "gap 180, second round: the removal looks at the folder outside its own error handling (a folder that cannot be looked at gives a plain error again)", ADAPTER,
  [("  attempt(() => (isFolder = lstatSync(dir, { throwIfNoEntry: false })?.isDirectory() === true));", "  isFolder = lstatSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;")],
  [(J, "C24 \\(known gap 180, second review round\\)")]),
 ("J2-C84", "gap 180, second round: the recorded folder's own check throws a plain error for a folder that cannot be looked at", ADAPTER,
  [("    return `the recorded folder could not be looked at (${(err as NodeJS.ErrnoException).code ?? \"an error with no code\"})`;", "    throw err;")],
  [(J, "C24 \\(known gap 180, second review round\\)")]),
 ("J2-C85", "gap 180, second round: a refused Close project is recorded only when the record names a sandbox", JOURNEY,
  [("        await appendEvent(this.pool, projectId, EV.sandboxRemoved, { reason: CLOSE_NOT_REMOVED, interrupted: false, removed: false, left: err.left });",
    "        if (s.sandbox) await appendEvent(this.pool, projectId, EV.sandboxRemoved, { reason: CLOSE_NOT_REMOVED, interrupted: false, removed: false, left: err.left });")],
  [(J, "C25 \\(known gap 180, second review round\\)")]),
 ("J2-C86", "gap 180, second round: the preview screen says \"The app is not running any more\" also while the project's removal is not finished", PAGES,
  [(" : s.previewFinished && !removalNotFinished(s) ? html`<p class=\"note\">", " : s.previewFinished ? html`<p class=\"note\">")],
  [(W, "C17 \\(known gap 180, after its review\\)")]),
 ("J2-C87", "gap 180, second round: the handle's flag is cleared before Docker's settings are asked for (it says the app is not started although nothing was asked or removed)", ADAPTER,
  [("      const env = removalEnvOrNotRemoved(x.projectId, x.dir);\n", "      x.appStarted = false;\n      const env = removalEnvOrNotRemoved(x.projectId, x.dir);\n")],
  [(J, "C22 \\(known gap 180, after its review\\)")]),
]

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)

COUNTS = re.compile(r"Tests\s+(.*?)\s*\(\d+\)")
def counts(summary):
    """{'failed': n, 'passed': n, 'skipped': n} from vitest's "Tests" summary line."""
    m = COUNTS.search(summary)
    out = {}
    if m:
        for part in m.group(1).split("|"):
            n, _, word = part.strip().partition(" ")
            if n.isdigit():
                out[word.strip()] = int(n)
    return out

LAST = {"text": ""}  # everything the last vitest run printed (second review round of known gap 180)
def vitest(test_file, name):
    r = run(["npx", "vitest", "run", test_file, "-t", name])
    summary = " | ".join(l.strip() for l in (r.stdout + r.stderr).splitlines() if l.strip().startswith(("Test Files", "Tests ")))
    LAST["text"] = r.stdout + r.stderr
    return r.returncode, summary, counts(summary)

# Second review round of known gap 180: why a test failed, read from vitest's own output.
PLACE = re.compile(r"((?:test|src|scripts)/[\w./-]+\.(?:ts|mjs):\d+:\d+)")
CLEAN_UP = re.compile(r"permission denied to terminate process|terminating connection due to administrator command")
DROP_FRAME = re.compile(r"❯\s+(?:\S+\.)?drop\s+\S*test/")  # a frame inside the tests' own `drop` (freshDb)
def first_failure(text):
    """(what, in_clean_up) for one vitest run. `what`: the first failure it printed, as "<message> at <the first place in a
    test file it names>"; or the first unhandled error; or "none printed". `in_clean_up`: that failure is the test's own
    clean-up (the drop of the database it made, or what that drop does to a connection: known gap 185), not an assertion."""
    lines = text.splitlines()
    start = next((i for i, l in enumerate(lines) if l.strip().startswith("FAIL ")), None)
    if start is None:
        i = next((i for i, l in enumerate(lines) if "Uncaught Exception" in l or "Unhandled Rejection" in l), None)
        if i is None:
            return "none printed", False
        message = next((l.strip() for l in lines[i + 1:] if l.strip()), "")
        return f"an unhandled error, no failed test: {message[:200]}", bool(CLEAN_UP.search(message))
    block = []
    for l in lines[start + 1:]:
        if l.strip().startswith("FAIL ") or re.match(r"\s*⎯{10,}", l):
            break
        block.append(l)
    message = next((l.strip() for l in block if l.strip()), "")
    places = [m.group(1) for l in block if "❯" in l for m in [PLACE.search(l)] if m]
    tests = [x for x in places if x.startswith("test/")]
    place = (tests or places or ["no place named"])[0]
    return f"{message[:200]} at {place}", bool(CLEAN_UP.search(message)) or any(DROP_FRAME.search(l) for l in block)

if sys.argv[1:2] == ["--read"]:
    what, in_clean_up = first_failure(open(sys.argv[2]).read())
    print(f"first failure: {what}")
    print(f"in the test's own clean-up (known gap 185): {'yes' if in_clean_up else 'no'}")
    sys.exit(0)

out = []
before = run(["git", "diff", "HEAD", "--stat", "--", "."]).stdout
head = run(["git", "rev-parse", "--short", "HEAD"]).stdout.strip()
out.append(f"J2 controls, {datetime.date.today()}, on HEAD {head} of builder/ (working tree as committed: `git diff HEAD -- .` empty before: {'yes' if before == '' else 'NO'}). Each safeguard removed in turn by exact replacement (each text to replace occurring exactly once in its file), the test or tests that guard it run alone (npx vitest run <file> -t <name>), the verdict of each, then the files restored with git checkout and the tree checked unchanged.")
only = sys.argv[2:]  # control ids to run; all when none is named
chosen = [c for c in CONTROLS if not only or c[0] in only]

# 1. Each named test, on the tree as committed: it must pass, and be the only test its name selects.
out.append("")
out.append("1. Baseline: each named test on the tree as committed (it must pass, alone).")
out.append("Columns: file | name given to -t | verdict | vitest's summary lines")
baseline_ok = True
for f, name in sorted({t for c in chosen for t in c[4]}):
    code, summary, n = vitest(f, name)
    ok = code == 0 and n.get("passed") == 1 and n.get("failed", 0) == 0
    baseline_ok &= ok
    out.append(f"{f} | {name} | {'passed, alone' if ok else 'NOT AS EXPECTED (exit ' + str(code) + ')'} | {summary}")
    print(out[-1], flush=True)
    if not ok:  # added in the second review round of known gap 180: why
        out.append(f"    first failure: {first_failure(LAST['text'])[0]}")
        print(out[-1], flush=True)

# 2. The controls.
out.append("")
out.append("2. The controls.")
out.append("Columns: control | what was removed | verdict | for each test: file, name, vitest's summary lines")
out.append("Under each control, since the second review round of known gap 180, one line for each of its tests: control | file, name | the first failure vitest printed (its message, and the first place in a test file it names).")
all_failed = True
for cid, label, path, reps, tests in chosen:
    paths = path if isinstance(path, list) else [path] * len(reps)
    texts = {p: open(p).read() for p in set(paths)}
    problem = None
    for p, (old, new) in zip(paths, reps):
        n = texts[p].count(old)
        if n != 1:
            problem = f"the text to replace occurs {n} times in {p}, not once"
            break
        texts[p] = texts[p].replace(old, new, 1)
    if problem:
        all_failed = False
        out.append(f"{cid} | {label} | NOT APPLIED ({problem}) |")
        print(out[-1], flush=True)
        continue
    for p, t in texts.items():
        open(p, "w").write(t)
    results = []
    reasons = []    # added in the second review round of known gap 180
    clean_ups = []  # the same
    try:
        for f, name in tests:
            code, summary, n = vitest(f, name)
            failed = code != 0 and n.get("failed", 0) == 1 and n.get("passed", 0) == 0
            results.append((failed, f"{f} -t \"{name}\": {'failed' if failed else 'DID NOT FAIL (exit ' + str(code) + ')'}: {summary}"))
            # Added in the second review round of known gap 180: why it failed; a failure in the test's own clean-up
            # says nothing of the safeguard.
            what, in_clean_up = first_failure(LAST["text"])
            reasons.append(f"    {cid} | {f} -t \"{name}\" | first failure: {what}")
            clean_ups.append(failed and in_clean_up)
    finally:
        run(["git", "checkout", "--", *texts.keys()])
    restored = run(["git", "diff", "HEAD", "--stat", "--", *texts.keys()]).stdout == ""
    every = all(r[0] for r in results)
    all_failed &= every and restored
    verdict = ("FAILED, as it should with the safeguard removed" if every else "PASSED: a test does not see this safeguard's removal") + ("" if restored else "; FILE NOT RESTORED")
    out.append(f"{cid} | {label} | {verdict} | " + " || ".join(r[1] for r in results))
    print(out[-1], flush=True)
    # Added in the second review round of known gap 180, after the verdict rule above, which is as it was.
    for line in reasons:
        out.append(line)
        print(line, flush=True)
    if any(clean_ups):
        all_failed = False
        out.append(f"    {cid} | NOT AS EXPECTED: a test of this control failed in its own clean-up, not at an assertion (known gap 185). The verdict above does not count; run this control again.")
        print(out[-1], flush=True)

after = run(["git", "diff", "HEAD", "--stat", "--", "."]).stdout
out.append("")
out.append(f"After every control: `git diff HEAD -- .` empty: {'yes' if after == '' else 'NO: ' + after}")
out.append(f"Result: baseline {'every named test passed, alone' if baseline_ok else 'NOT AS EXPECTED'}; controls: {len(chosen)} run, {'every one failed its tests, as it should' if all_failed else 'NOT every one failed as it should'}.")
open(sys.argv[1], "w").write("\n".join(out) + "\n")
