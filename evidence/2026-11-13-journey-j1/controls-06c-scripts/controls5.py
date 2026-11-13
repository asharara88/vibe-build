"""J1 on 0.6c's private networks, and the checklist screen (the last independent check, point c): remove each new safeguard
(exact replacements) on a copy of the code, run the test that guards it, expect it to fail, restore."""
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
AS = "camera/app-shots.mjs"
NC = "scripts/journey-network-checks.ts"
NET = "J1 journey on package 0.6c's private networks"
C = [
 ("J1-C70", "a sandbox made with the build's port in use (the adapter's refusal removed; makeExample1's own error is not shown on the screens)", [
   (AD, """      if (busy) throw new JourneyRefused(busy);
      const x = await makeExample1(""", """      void busy;
      const x = await makeExample1(""")],
  "test/journey.test.ts", "a journey sandbox puts the app on the project's private networks"),
 ("J1-C71", "the app built without checking the build's port", [
   (AD, """    portsBusy: (x) => buildPortRefusal(x.buildProxyPort, "the app's images are not built and the app is not started."),""", """    portsBusy: async () => null,""")],
  "test/journey.test.ts", "a journey sandbox puts the app on the project's private networks"),
 ("J1-C72", "the app camera started without checking its service's network", [
   (JJ, """      const networkProblem = await this.o.sandboxes.cameraNetworkProblem(x);
      if (networkProblem) throw new JourneyRefused(`The app camera did not start: ${networkProblem}. No screenshot was recorded.`);""", """      void 0;""")],
  "test/journey.test.ts", "just before the app camera starts, its service is checked"),
 ("J1-C73", "the camera's network check lets a service on the machine's network (network_mode) through", [
   (AD, """  if (s.network_mode !== undefined) return""", """  if (s.network_mode !== undefined && false) return""")],
  "test/journey.test.ts", "the camera's network check: only a service on the project's front network"),
 ("J1-C74", "the camera's network check lets a service on front and another network through", [
   (AD, """  if (names.length !== 1 || names[0] !== "front") return""", """  if (!names.includes("front")) return""")],
  "test/journey.test.ts", "the camera's network check: only a service on the project's front network"),
 ("J1-C75", "the app camera accepts the machine's loopback address again, as before 0.6c", [
   (AS, """if (!base || !/^http:\\/\\/app:[0-9]{2,5}$/.test(base)) {""", """if (!base || !/^http:\\/\\/(app|127\\.0\\.0\\.1):[0-9]{2,5}$/.test(base)) {""")],
  "test/journey.test.ts", "the app camera loads its browser only for"),
 ("J1-C76", "the app camera loads its browser before its address check, as before", [
   (AS, """const { chromium } = await import("/runner/node_modules/playwright-core/index.mjs");
""", ""),
   (AS, """import { readFileSync } from "node:fs";
""", """import { readFileSync } from "node:fs";
import { chromium } from "/runner/node_modules/playwright-core/index.mjs";
""")],
  "test/journey.test.ts", "the app camera loads its browser only for"),
 ("J1-C77", "the app camera run in another service (here egress-host, on the machine's network)", [
   (AD, """sandbox.runStreaming(x.sb, "acceptance", ["node", "/camera/app-shots.mjs"]""", """sandbox.runStreaming(x.sb, "egress-host", ["node", "/camera/app-shots.mjs"]""")],
  "test/journey.test.ts", "the adapter runs the app camera in the project's acceptance service"),
 ("J1-C78", "the automated run's check that the app camera ran on front alone accepts any network", [
   (NC, """ok: cameras.length > 0 && cameras.every(frontOnly)""", """ok: cameras.length > 0""")],
  "test/journey.test.ts", "the automated run's checks on Docker's list"),
 ("J1-C79", "the automated run's check of published ports removed", [
   (NC, """ok: rows.length > 0 && rows.every((r) => !r.ports.includes("->"))""", """ok: rows.length > 0""")],
  "test/journey.test.ts", "the automated run's checks on Docker's list"),
 ("J1-C80", "the automated run's check of the machine's network accepts any container there", [
   (NC, """ok: onHost.length > 0 && onHost.every((r) => /-egress-host-\\d+$/.test(r.name))""", """ok: onHost.length > 0""")],
  "test/journey.test.ts", "the automated run's checks on Docker's list"),
 ("J1-C81", "an item shown green Passed whatever the run's outcome word, as before", [
   (P, """const shownAs = status === "passed" ? (outcome === "passed" ? "passed" : "passed_provisional") :""", """const shownAs = status === "passed" ? "passed" :""")],
  "test/web.test.ts", "no green Passed for an item when the run's outcome word is not"),
 ("J1-C82", "no run's outcome next to the items of a run that did not pass", [
   (P, """    const runOutcomeNote = runId && outcome !== "passed" ? html""", """    const runOutcomeNote = false ? html""")],
  "test/web.test.ts", "no green Passed for an item when the run's outcome word is not"),
 ("J1-C83", "the run table shows the last run in the record, not the latest checklist job's, as before", [
   (P, """  const finished = ended ? jobRunFinished(s.events, ended) : undefined;""", """  const finished = (void jobRunFinished, ended ? s.events.filter((e) => e.kind === "acceptance.run.finished").at(-1) : undefined);""")],
  "test/web.test.ts", "the run table shows the latest checklist job"),
 ("J1-C84", "a checklist job's run read from any record before its end, not only after its start", [
   (J, """BigInt(e.id) > started && (!end""", """(void started, true) && (!end""")],
  "test/journey.test.ts", "the run a checklist job made is the runner's record"),
 ("J1-C85", "an item whose test is written called untested ('No test written yet') when it has no result", [
   (P, """  const tested = new Set((Array.isArray(""", """  const tested = new Set<number>() ?? new Set((Array.isArray(""")],
  "test/web.test.ts", "the run table shows the latest checklist job"),
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
