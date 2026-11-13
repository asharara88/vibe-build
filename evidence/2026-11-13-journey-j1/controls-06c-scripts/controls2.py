"""J1 part 2 controls: remove one safeguard (one or more exact replacements), run the test that guards it, expect it to fail, restore."""
import os, subprocess, sys
B = "/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad/j1-06c/ctl-copy/builder"
ENV = dict(os.environ, TMPDIR="/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad/j1-06c-tmp",
           BUILDER_TEST_DATABASE_URL="postgres:///builder_test_j106cctl?host=/var/run/postgresql", NO_COLOR="1")
ENV.pop("BUILDER_DATA_DIR", None)
J = "src/orchestrator/journey-jobs.ts"
C = [
 ("J1-C26", "the build job's engine not behind the ordering wrapper (events written without waiting)", [
   (J, "            scriptedEngineFor(\n              {", "            unorderedEngine(\n              {"),
   (J, "/** Read one camera file:", "function unorderedEngine(o: ScriptedEngineOptions, _q: unknown) {\n  return new ScriptedEngine(o);\n}\n\n/** Read one camera file:"),
   (J, 'import { readManifest, TEMPLATE_PROTECTED_PATHS } from "../engine/scripted.js";', 'import { readManifest, ScriptedEngine, TEMPLATE_PROTECTED_PATHS, type ScriptedEngineOptions } from "../engine/scripted.js";')],
  "test/journey.test.ts", "step 1 runs through the step hold"),
 ("J1-C27", "the build job calls the engine directly, not through the step hold (package 1.3)", [
   (J, "const r = await runBudgetedStep({", "const r = await (async (o: Parameters<typeof runBudgetedStep>[0]) => o.engineFor({ gatewayUrl: o.gatewayUrl, token: \"none\" }).runStep(o.step, o.onEvent))({")],
  "test/journey.test.ts", "step 1 is refused before the engine is made"),
 ("J1-C28", "no reset after a failed step", [
   (J, "const reset = await resetToLastCommit(sandboxNow.repo);", "const reset = { removedIgnored: [], removedNotAllowed: [], unrestorable: [] } as Awaited<ReturnType<typeof resetToLastCommit>>;")],
  "test/journey.test.ts", "a step that fails leaves nothing behind"),
 ("J1-C29", "the disk check removed from the build job", [
   (J, "async ({ queue, state }) => {\n        this.disk();", "async ({ queue, state }) => {\n        void 0;")],
  "test/journey.test.ts", "the disk check: below the floor"),
 ("J1-C30", "a step allowed before the one before it is approved", [
   ("src/orchestrator/journey.ts", "    if (!s.approved.has(earlier)) return `Step ${earlier} must be built and approved first.`;", "    void earlier;")],
  "test/journey.test.ts", "step 1 runs through the step hold"),
 ("J1-C31", "a step approved before it is built", [
   ("src/orchestrator/journey.ts", '  if (s.stepJobs.get(step)?.state !== "finished") return "This step is not built yet. A step is approved only once it has run to the end.";\n', "")],
  "test/journey.test.ts", "step 1 runs through the step hold"),
 ("J1-C32", "a camera file recorded without the PNG check", [
   (J, "if (read !== st.size || !body.subarray(0, 8).equals(PNG)) throw", "if (read !== st.size) throw")],
  "test/journey.test.ts", "a camera file that is not a PNG"),
 ("J1-C33", "two projects' apps at a time", [
   (J, "        if (other !== projectId && h.appStarted) throw new JourneyRefused(", "        if (false as boolean) throw new JourneyRefused(")],
  "test/journey.test.ts", "one project's app at a time"),
 ("J1-C34", "the app started with its port in use", [
   (J, "      if (busy) throw new JourneyRefused(busy);\n", "")],
  "test/journey.test.ts", "one project's app at a time"),
 ("J1-C35", "the camera's folder (and its password file) left after the run", [
   (J, "    } finally {\n      rmSync(runDir, { recursive: true, force: true });\n    }", "    } finally {\n      void runDir;\n    }")],
  "test/journey.test.ts", "the preview: after the last approval"),
 ("J1-C36", "sign-off allowed on a checklist run that did not pass", [
   ("src/orchestrator/journey.ts", '  if (r.refused || r.outcome !== "passed") return "The last checklist run did not pass, so there is nothing to sign off.";\n', "")],
  "test/journey.test.ts", "the checklist, sign-off and export in order"),
 ("J1-C37", "the export's tests written into the workspace instead of the exported copy", [
   ("src/orchestrator/export.ts", 'const dest = join(top, "acceptance", i.version);', 'const dest = join(i.repo.workTree, "acceptance", i.version);')],
  "test/journey.test.ts", "the export: a .tar.gz"),
 ("J1-C38", "the export's check for files that look like secrets removed", [
   ("src/orchestrator/export.ts", "  if (secretLike.length) throw new Error(", "  if (false as boolean) throw new Error(")],
  "test/journey.test.ts", "the export is refused when"),
 ("J1-C39", "recovery at start ignores a sandbox left by an interface that stopped", [
   ("src/orchestrator/journey.ts", '      const leftSandbox = s.stage !== "closed" ? s.sandbox : null;', "      const leftSandbox = null as SandboxRecord | null;")],
  "test/journey.test.ts", "at start, a sandbox left by an interface"),
 ("J1-C40", "the adapter removes a recorded folder whose compose file names another project", [
   ("src/orchestrator/example-1-adapter.ts", '  if (first !== `name: ${JSON.stringify(composeProjectName(projectId))}`) return "the recorded folder\'s compose file names another project";\n', "")],
  "test/journey.test.ts", "the adapter removes only journey sandboxes"),
 ("J1-C41", "the adapter accepts a project id that is not a journey project's", [
   ("src/orchestrator/example-1-adapter.ts", "  if (!/^j1-[0-9a-f]{12}$/.test(projectId) || !composeProjectName(projectId).startsWith(\"builder_j1-\")) {", "  if (false as boolean) {")],
  "test/journey.test.ts", "the adapter removes only journey sandboxes"),
 ("J1-C42", "the refused step's sentence not shown on the build screen", [
   ("src/web/pages.ts", '<p class="warn">${t(lang, "build.refusal_extra")}</p>${englishToo(lang, REFUSAL_EXTRA)}', "")],
  "test/web.test.ts", "the build screen shows step 1 refused"),
 ("J1-C43", "an item with no test shown as passed", [
   ("src/web/pages.ts", '    const status = ev ? String(ev.payload.status) : "did not run";', '    const status = ev ? String(ev.payload.status) : "passed";')],
  "test/web.test.ts", "the whole journey through the screens"),
 ("J1-C44", "the stand-in label removed from the checklist screen", [
   ("src/web/pages.ts", '<p><span class="label" data-label>${t(lang, "acceptance.label")}</span></p>${englishToo(lang, JOURNEY_STAND_IN_LABEL)}', "")],
  "test/web.test.ts", "the whole journey through the screens"),
 ("J1-C45", "the export screen offers the export before sign-off", [
   ("src/web/pages.ts", '  if (!s.signedOff) return projectPage(lang, s, "export", t(lang, "export.title"), panel(lang, "real", t(lang, "export.title"), html`<p data-export-not-offered>${t(lang, "export.not_yet")}</p>`));\n', "")],
  "test/web.test.ts", "the whole journey through the screens"),
 ("J1-C46", "a GET of the build screen that writes an event", [
   ("src/web/app.ts", '  app.get("/projects/:id/build", async (c) => c.html(buildPage(c.get("lang"), await j.state(c.req.param("id")), j)));',
    '  app.get("/projects/:id/build", async (c) => (await j.pool.query("insert into events(project_id, kind, payload) values ($1, \'control.write\', \'{}\')", [c.req.param("id")]), c.html(buildPage(c.get("lang"), await j.state(c.req.param("id")), j))));')],
  "test/web.test.ts", "the whole journey through the screens"),
 ("J1-C47", "the jobs' gate: part 2's module names another engine", [
   (J, "/** Read one camera file:", "export const _other = (): unknown => new StandInEngine();\n\n/** Read one camera file:")],
  "test/journey.test.ts", "the only engine the journey makes"),
 ("J1-C48", "part 2's jobs import the gateway's journal", [
   (J, 'import { runBudgetedStep } from "./steps.js";', 'import { runBudgetedStep } from "./steps.js";\nimport "../gateway/journal.js";')],
  "test/journey.test.ts", "neither the interface nor the journey imports"),
]
only = sys.argv[1:]
results = []
for cid, what, patches, test, name in C:
    if only and cid not in only: continue
    saved = {}
    ok = True
    for f, old, new in patches:
        path = os.path.join(B, f)
        if path not in saved: saved[path] = open(path, encoding="utf-8").read()
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
