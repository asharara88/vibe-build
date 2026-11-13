#!/usr/bin/env python3
"""Package 0.6c brought up to date with the integration branch (13 Nov 2026): its controls, and package 3.1b's
controls that touch the runner, run again on a scratch copy of the merged code (git archive of a tree).

The 0.6c controls are read unchanged from checks/controls.py (C1 to C33) and checks/controls-3.py (C34 to C41): the
same text removed or added, the same test and name filter. 3.1b's controls C1, C3, C3b, C4 and C5 are written here
from the changes shown in evidence/2026-11-13-package-3.1b/run-controls.txt. Each control changes one thing, runs the
test that covers it (expected: FAIL), then restores the file and runs it again (expected: pass). Run under the lock
shared with other sessions: some of these tests can start a container when their safeguard is removed.

Usage: controls-merge.py <tree-ish> <work-dir> <out-file> <test-database-name> [only-ids...]"""
import ast, datetime, os, subprocess, sys

tree, work, out, dbname = sys.argv[1:5]
only = set(sys.argv[5:])
HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
S = "builder/src/sandbox/"
DF = "templates/next/Dockerfile"


def controls_from(script):
    """The CONTROLS list of an earlier controls script, evaluated with its own S and DF, nothing else run."""
    mod = ast.parse(open(os.path.join(HERE, script)).read())
    for node in mod.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "CONTROLS" for t in node.targets):
            return eval(compile(ast.Expression(node.value), script, "eval"), {"S": S, "DF": DF})
    raise SystemExit(f"no CONTROLS in {script}")


A = "builder/src/acceptance/"
P31B = [
    ("3.1b-C1", "the skip put back on the live acceptance tests (describe.skipIf when a prerequisite is missing)", "builder/test/acceptance-live.test.ts",
     'describe("acceptance runner: live, development profile, stand-in test", () => {',
     'describe.skipIf(missing.length > 0)("acceptance runner: live, development profile, stand-in test", () => {',
     "test/acceptance-gate.test.ts", None),
    ("3.1b-C3", "the store's reader lets a run with no test pass (the no-test guard in readRun removed)", A + "results.ts",
     '  if (f.manifest.items.length === 0) return allDidNotRun("the version names no test, so no browser test ran");\n', "",
     "test/acceptance.test.ts", "no browser test ran"),
    ("3.1b-C3b", "the store's check before a run lets a version with no test through (verifyVersion's 'names no test' removed)", A + "store.ts",
     '  if (manifest.items.length === 0) problems.push("the manifest names no test");\n', "",
     "test/acceptance.test.ts", "names no test is refused"),
    ("3.1b-C4", "the runner image check before a run removed (runner.ts)", A + "runner.ts",
     "    if (imageProblem) refused = `the runner cannot start: ${imageProblem}`;\n", "",
     "test/acceptance.test.ts", "runner cannot start"),
    ("3.1b-C5", "the label check accepts any image (runnerImageLabelProblem always null)", A + "runner-image.ts",
     "  if (found === BROWSER_ZIP_SHA256) return null;", "  return null;",
     "test/acceptance.test.ts", "runner cannot start"),
]

# C12's text left egress-machine-main.ts at 0.6c's own commit dcfebcf (after its review, before this merge): the machine
# side's start-up moved into egress-machine.ts. C12b makes the same change at the code's new place.
C12B = ("C12b", "the machine side refuses \"direct\" (C12's change, where the code is since dcfebcf)", S + "egress-machine.ts",
        "parseUpstream(env.EGRESS_UPSTREAM_PROXY, { allowDirect: false })!",
        "(parseUpstream(env.EGRESS_UPSTREAM_PROXY, { allowDirect: true }) ?? new URL(\"http://127.0.0.1:9\"))",
        "test/door.test.ts", "machine side refuses to start")

ALL = []
for c in controls_from("controls.py"):
    ALL.append((c[0], c[1], c[2], c[3], c[4], c[5], c[6]))
    if c[0] == "C12":
        ALL.append(C12B)
ALL += [(c[0], c[1], c[2], c[3], c[4], c[5], c[6]) for c in controls_from("controls-3.py")]
ALL += P31B
if only:
    ALL = [c for c in ALL if c[0] in only]

copy = os.path.join(work, "copy")
if not os.path.isdir(copy):
    os.makedirs(copy)
    subprocess.run(f"git -C {WT} archive {tree} | tar -x -C {copy}", shell=True, check=True)
    os.symlink(f"{WT}/builder/node_modules", f"{copy}/builder/node_modules")
tmp = os.path.join(work, "tmp")
empty_cache = os.path.join(work, "empty-cache")
os.makedirs(empty_cache, exist_ok=True)
env = dict(os.environ, NO_COLOR="1", BUILDER_TEST_DATABASE_URL=f"postgres:///{dbname}?host=/var/run/postgresql")


def vitest(test, name, extra=None):
    os.makedirs(tmp, exist_ok=True)
    args = ["npx", "vitest", "run", test] + (["-t", name] if name else [])
    return subprocess.run(args, cwd=os.path.join(copy, "builder"), env=dict(env, TMPDIR=tmp, **(extra or {})), capture_output=True, text=True, timeout=900)


def summary(r, n=14):
    keep = ("Test Files", "Tests ", "FAIL", "×", "AssertionError", "Error:", "- Expected", "+ Received")
    return [l.strip() for l in (r.stdout + r.stderr).splitlines() if l.strip().startswith(keep)][:n]


def counts(r):
    return " / ".join(l for l in summary(r, 40) if l.startswith(("Test Files", "Tests ")))


def left_by_test():
    """What a control's test left of the test's own Compose project (builder_p_test), listed and removed."""
    lbl = "label=com.docker.compose.project=builder_p_test"
    q = lambda *a: subprocess.run(list(a), capture_output=True, text=True).stdout.split()
    names = q("docker", "ps", "-a", "--filter", lbl, "--format", "{{.Names}}") + q("docker", "network", "ls", "--filter", lbl, "--format", "{{.Name}}")
    for c in q("docker", "ps", "-aq", "--filter", lbl):
        subprocess.run(["docker", "rm", "-f", c], capture_output=True)
    for n in q("docker", "network", "ls", "-q", "--filter", lbl):
        subprocess.run(["docker", "network", "rm", n], capture_output=True)
    stray = "/tmp/m06c-elsewhere.sock"
    if os.path.exists(stray):
        os.remove(stray)
        names.append(stray)
    return names


caught = missed = notrun = 0
with open(out, "a") as f:
    f.write(f"# Package 0.6c brought up to date with the integration branch: controls, {datetime.datetime.utcnow().isoformat(timespec='seconds')}Z,\n")
    f.write(f"# on a copy of tree {tree} (the merged code before its commit) made with git archive; builder/node_modules linked from the worktree; test database {dbname}.\n")
    f.write("# 0.6c's C1 to C41 as in checks/controls.py and checks/controls-3.py; 3.1b's C1, C3, C3b, C4, C5 as in evidence/2026-11-13-package-3.1b/run-controls.txt.\n")
    f.write("# Each control changes one thing, runs the test that covers it (expected: FAIL), then restores the file and runs it again (expected: pass).\n\n")
    for cid, what, path, before, after, test, name in ALL:
        full = os.path.join(copy, path)
        orig = open(full).read()
        if orig.count(before) != 1:
            f.write(f"## {cid} NOT RUN: the text to change was found {orig.count(before)} times in {path}\n\n")
            notrun += 1
            continue
        open(full, "w").write(orig.replace(before, after, 1))
        r = vitest(test, name)
        extra = None
        if cid == "3.1b-C1":
            # What npm test would have done without the gate: the live file alone, with an empty cache folder.
            extra = vitest("test/acceptance-live.test.ts", None, {"BUILDER_BROWSER_CACHE": empty_cache})
        open(full, "w").write(orig)
        r2 = vitest(test, name)
        ok = r.returncode != 0
        caught += ok
        missed += not ok
        verdict = "FAILED with the change, as it should" if ok else "PASSED WITH THE CHANGE (control did not catch it)"
        f.write(f"## {cid}: {what}\nChanged in {path}; test {test}" + (f" -t \"{name}\"" if name else "") + f"\nWith the change: exit {r.returncode}: {verdict}\n")
        f.write("\n".join("    " + l for l in summary(r)) + "\n")
        if extra is not None:
            f.write(f"The live file alone with that change, BUILDER_BROWSER_CACHE an empty folder: exit {extra.returncode}: {counts(extra)}\n")
        f.write(f"Restored: exit {r2.returncode}: {counts(r2)}\n")
        f.write(f"Left by the test runs and removed: {', '.join(left_by_test()) or 'nothing'}\n\n")
        f.flush()
    f.write(f"# Summary: {len(ALL)} controls; {caught} failed with their change, as they should; {missed} passed with it; {notrun} not run.\n")
print(f"done: {caught} caught, {missed} missed, {notrun} not run")
