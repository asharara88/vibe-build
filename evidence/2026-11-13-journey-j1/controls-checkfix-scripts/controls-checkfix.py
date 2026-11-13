"""J1 after the independent check of b228d94: remove each new safeguard (exact replacements) on a copy of the code at
9c2da4d, run the tests that guard it, expect each to fail, restore. Points 3 (the camera's network check reads front
itself) and 4 (the camera test checks that the runner's playwright is absent before the script runs).
No container: `docker compose config` only reads a file."""
import os, re, subprocess, sys
S = "/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad"
B = f"{S}/fixj1-ctl/ctl-copy/builder"
TMP = f"{S}/fixj1-tmp"
ENV = dict(os.environ, TMPDIR=TMP, BUILDER_TEST_DATABASE_URL="postgres:///builder_test_fixj1?host=/var/run/postgresql", NO_COLOR="1", FORCE_COLOR="0")
for k in ("BUILDER_DATA_DIR", "BUILDER_MODEL_API_KEY", "BUILDER_UI_PASSWORD", "BUILDER_DATABASE_URL"):
    ENV.pop(k, None)
AD = "src/orchestrator/example-1-adapter.ts"
AS = "camera/app-shots.mjs"
T = "test/journey.test.ts"
READINGS = "the camera's network check: only a service on the project's front network"
REAL = "a journey sandbox puts the app on the project's private networks"
CAMERA = "the app camera loads its browser only for"

# A stand-in for the runner's playwright, in the controls' own temporary folder (never at /runner on this machine):
# loading it writes a marker file and gives no browser.
RUNNER_PATH = "/runner/node_modules/playwright-core/index.mjs"
STANDIN_DIR = f"{TMP}/standin-runner/node_modules/playwright-core"
STANDIN = f"{STANDIN_DIR}/index.mjs"
MARKER = f"{STANDIN_DIR}/loaded"
os.makedirs(STANDIN_DIR, exist_ok=True)
with open(STANDIN, "w", encoding="utf-8") as f:
    f.write('import { writeFileSync } from "node:fs";\n'
            'writeFileSync(new URL("./loaded", import.meta.url), "the stand-in playwright was loaded\\n");\n'
            'export const chromium = { launch() { throw new Error("stand-in playwright: no browser here"); } };\n')
POINT_AT_STANDIN = [(AS, RUNNER_PATH, STANDIN, "all"), (T, RUNNER_PATH, STANDIN, "all")]
NEW_CHECK = """    for (const path of [browserImports[0]!, dirname(browserImports[0]!)]) expect(lstatSync(path, { throwIfNoEntry: false }), `${path} is on this machine`).toBeUndefined();
"""

C = [
 ("J1-C86", "the camera's network check does not ask whether front is internal", [
   (AD, """  if (front.internal !== true) return "Compose reads the project's front network as not internal: Docker would give it a route out";
""", "", "one")],
  [READINGS, REAL], None),
 ("J1-C87", "the camera's network check does not ask for 0.6c's isolated gateway option on front", [
   (AD, """  if (!isolated || front.driver_opts?.[GATEWAY_MODE_OPTION] !== isolated)
    return""", """  if (false)
    return""", "one")],
  [READINGS, REAL], None),
 ("J1-C88", "the whole new check removed: front itself not read, as at b228d94", [
   (AD, """  const front = c?.networks?.front;
  if (!front) return "Compose's reading of the sandbox has no front network";
  if (front.internal !== true) return "Compose reads the project's front network as not internal: Docker would give it a route out";
  const isolated: string | undefined = PROJECT_NETWORK.driver_opts[GATEWAY_MODE_OPTION];
  if (!isolated || front.driver_opts?.[GATEWAY_MODE_OPTION] !== isolated)
    return `Compose reads the project's front network without ${GATEWAY_MODE_OPTION} "${isolated}": Docker would put an address of the machine on it`;
""", "", "one")],
  [READINGS, REAL], None),
 ("J1-C89", "the option read under another name than the one 0.6c's manager writes (the IPv6 one)", [
   (AD, """const GATEWAY_MODE_OPTION = "com.docker.network.bridge.gateway_mode_ipv4" satisfies keyof typeof PROJECT_NETWORK.driver_opts;""",
        """const GATEWAY_MODE_OPTION = "com.docker.network.bridge.gateway_mode_ipv6" as "com.docker.network.bridge.gateway_mode_ipv4";""", "one")],
  [READINGS, REAL], None),
 ("J1-C90", "the runner's playwright present at the path the script imports from (a stand-in, script and test pointed at it): the test must fail before the script runs", POINT_AT_STANDIN, [CAMERA], "marker absent"),
 ("J1-C91", "the same, with the new check removed (counter-control: what the check prevents)", POINT_AT_STANDIN + [(T, NEW_CHECK, "", "one")], [CAMERA], "marker present"),
]

only = sys.argv[1:]
results = []
for cid, what, patches, tests, marker_rule in C:
    if only and cid not in only:
        continue
    saved = {}
    ok = True
    for f, old, new, how in patches:
        path = os.path.join(B, f)
        if path not in saved:
            saved[path] = open(path, encoding="utf-8").read()
        cur = open(path, encoding="utf-8").read()
        n = cur.count(old)
        if (how == "one" and n != 1) or n == 0:
            results.append((cid, what, f"PATCH NOT APPLIED ({f}: found {n} times)", ""))
            ok = False
            break
        open(path, "w", encoding="utf-8").write(cur.replace(old, new))
    try:
        if ok:
            if os.path.exists(MARKER):
                os.remove(MARKER)
            for name in tests:
                r = subprocess.run(["npx", "vitest", "run", "test/journey.test.ts", "-t", name], cwd=B, env=ENV, capture_output=True, text=True, timeout=600)
                out = r.stdout + r.stderr
                tail = [l.strip() for l in out.splitlines() if "Tests " in l or "Test Files" in l]
                # The first failing assertion's message, as vitest prints it.
                why = next((l.strip() for l in out.splitlines() if re.match(r"\s*(AssertionError|Error):", l)), "")
                verdict = "FAILED, as it should with the safeguard removed" if r.returncode != 0 and " failed" in out else ("PASSED: the test did not catch it" if r.returncode == 0 else f"ERROR exit {r.returncode}")
                extra = ""
                if marker_rule:
                    loaded = os.path.exists(MARKER)
                    extra = f" | stand-in playwright loaded: {'yes' if loaded else 'no'} (expected: {'no' if marker_rule == 'marker absent' else 'yes'})"
                    if (marker_rule == "marker absent") == loaded:
                        verdict = "UNEXPECTED: " + verdict
                results.append((cid, f"{what} [test: {name}]", verdict, " | ".join(tail) + f" | first failure: {why}" + extra))
    finally:
        for path, src in saved.items():
            open(path, "w", encoding="utf-8").write(src)
        if os.path.exists(MARKER):
            os.remove(MARKER)
for cid, what, v, tail in results:
    print(f"{cid} | {what} | {v} | {tail}")
