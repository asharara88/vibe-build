"""J1 brought up to date with 3.1b, 1.4c and 1.4b: remove each new safeguard (exact replacements) on a copy of the code,
run the test that guards it, expect it to fail, restore."""
import os, subprocess, sys
B = "/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad/j1-06c/ctl-copy/builder"
ENV = dict(os.environ, TMPDIR="/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad/j1-06c-tmp",
           BUILDER_TEST_DATABASE_URL="postgres:///builder_test_j106cctl?host=/var/run/postgresql", NO_COLOR="1")
for k in ("BUILDER_DATA_DIR", "BUILDER_MODEL_API_KEY", "BUILDER_UI_PASSWORD"):
    ENV.pop(k, None)
J = "src/orchestrator/journey.ts"
JJ = "src/orchestrator/journey-jobs.ts"
AD = "src/orchestrator/example-1-adapter.ts"
P = "src/web/pages.ts"
A = "src/web/app.ts"
D = "scripts/demo-journey.ts"
C = [
 ("J1-C57", "sign-off judged on the summary's text again, as before the merge (3.1b: the outcome word)", [
   (J, '''  if (r.refused || r.outcome !== "passed") return''', '''  if (r.refused || !(r.summary ?? "").startsWith("version passed")) return''')],
  "test/journey.test.ts", "sign-off reads the outcome word"),
 ("J1-C58", "the journey's state reads no outcome word from the run's record (left null)", [
   (J, '''  if (s.acceptanceRun?.runId) s.acceptanceRun.outcome = runOutcome(events, s.acceptanceRun.runId);''', '''  void runOutcome;''')],
  "test/journey.test.ts", "sign-off reads the outcome word"),
 ("J1-C59", "any value taken as the outcome word (not only the three words)", [
   (J, '''  return typeof word === "string" && (RUN_OUTCOMES as readonly string[]).includes(word) ? (word as RunOutcome) : null;''',
       '''  void RUN_OUTCOMES;\n  return typeof word === "string" ? (word as RunOutcome) : null;''')],
  "test/journey.test.ts", "a run's outcome word is read only from one"),
 ("J1-C60", "a run with two endings read by its first", [
   (J, '''  if (finished.length !== 1) return null;''', '''  if (finished.length === 0) return null;''')],
  "test/journey.test.ts", "a run's outcome word is read only from one"),
 ("J1-C61", "the checklist screen's outcome worked out from the summary's text", [
   (P, '''  const outcome = runId ? runOutcome(s.events, runId) : null;''',
       '''  const outcome = finished && String(finished.payload.summary ?? "").startsWith("version passed") ? ("passed" as const) : runId ? runOutcome(s.events, "none") : null;''')],
  "test/web.test.ts", "the checklist screen shows the run's outcome word"),
 ("J1-C62", "the preview builds the app without checking the camera's image first", [
   (JJ, '''      const imageProblem = await this.o.sandboxes.cameraImageProblem(x);
      if (imageProblem) throw new JourneyRefused(`The app camera cannot start, so the app was not built: ${imageProblem}.`);''', '''      void 0;''')],
  "test/journey.test.ts", "the preview checks the camera's runner image first"),
 ("J1-C63", "the camera started without checking its image again after the build", [
   (JJ, '''      const imageProblem = await this.o.sandboxes.cameraImageProblem(x);
      if (imageProblem) throw new JourneyRefused(`The app camera did not start: ${imageProblem}. No screenshot was recorded.`);''', '''      void 0;''')],
  "test/journey.test.ts", "the preview checks the camera's runner image first"),
 ("J1-C64", "the adapter's camera check does not ask runnerImageProblem (any image passes)", [
   (AD, '''    return await runnerImageProblem(sb.acceptanceImage, dockerEnv(sb));''', '''    return (void runnerImageProblem, void dockerEnv, null);''')],
  "test/journey.test.ts", "the app camera: the adapter asks runnerImageProblem"),
 ("J1-C65", "the automated run's image check removed (the builder camera)", [
   (D, '''  const imageProblem = await runnerImageProblem(RUNNER_IMAGE, dockerEnv());''', '''  const imageProblem = (void runnerImageProblem, null as string | null);''')],
  "test/journey.test.ts", "the builder camera: the automated run checks the runner image"),
 ("J1-C66", "the cost panel shows only the oldest freeze not cleared, as before the merge", [
   (A, '''    const freezes = (await listFreezes(j.pool, id)).filter((f) => f.cleared_at === null);''', '''    const freezes = (await listFreezes(j.pool, id)).filter((f) => f.cleared_at === null).slice(0, 1);''')],
  "test/web.test.ts", "the cost panel shows every freeze not cleared"),
 ("J1-C67", "a set-aside freeze written before 1.4c's migration shown under its stored kind", [
   (P, '''  return f.kind === "unrecorded_ending" && f.reason === SET_ASIDE_FREEZE_REASON ? "journal_line_set_aside" : f.kind;''', '''  return (void SET_ASIDE_FREEZE_REASON, f.kind);''')],
  "test/web.test.ts", "the cost panel shows every freeze not cleared"),
 ("J1-C68", "a bill above its hold left out of the unreconciled list's emptiness check, as before the merge", [
   (P, '''    un.holds.length === 0 && un.freezesWithNoOpenHold.length === 0 && un.overrunFreezes.length === 0''', '''    un.holds.length === 0 && un.freezesWithNoOpenHold.length === 0''')],
  "test/web.test.ts", "the cost panel shows every freeze not cleared"),
 ("J1-C69", "a bill above its hold not listed in the unreconciled list", [
   (P, '''${un.overrunFreezes.map((o) => html`''', '''${[].map((o: (typeof un.overrunFreezes)[number]) => html`''')],
  "test/web.test.ts", "the cost panel shows every freeze not cleared"),
]
only = sys.argv[1:]
results = []
for cid, what, patches, test, name in C:
    if only and cid not in only:
        continue
    saved = {}
    ok = True
    for f, old, new in patches:
        path = os.path.join(B, f)
        if path not in saved:
            saved[path] = open(path, encoding="utf-8").read()
        cur = open(path, encoding="utf-8").read()
        n = cur.count(old)
        if n != 1:
            results.append((cid, what, f"PATCH NOT APPLIED ({f}: found {n} times)", ""))
            ok = False
            break
        open(path, "w", encoding="utf-8").write(cur.replace(old, new))
    try:
        if ok:
            r = subprocess.run(["npx", "vitest", "run", test, "-t", name], cwd=B, env=ENV, capture_output=True, text=True, timeout=600)
            out = r.stdout + r.stderr
            tail = [l for l in out.splitlines() if "Tests " in l or "Test Files" in l]
            verdict = "FAILED, as it should with the safeguard removed" if r.returncode != 0 and " failed" in out else ("PASSED: the test did not catch it" if r.returncode == 0 else f"ERROR exit {r.returncode}")
            results.append((cid, what, verdict, " | ".join(x.strip() for x in tail)))
    finally:
        for path, src in saved.items():
            open(path, "w", encoding="utf-8").write(src)
for cid, what, v, tail in results:
    print(f"{cid} | {what} | {v} | {tail}")
