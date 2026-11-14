#!/usr/bin/env python3
"""Package 0.6c, the run in real containers (14 Nov 2026): controls RC1 to RC10.

Each control removes ONE safeguard by exact text replacement on a scratch copy of the commit, runs the test that
covers it (expected: FAIL), restores the file, and checks that the copy's tree is byte for byte what it was. For the
unit controls the test is then run again on the restored copy (expected: pass). The live controls (RC5, RC6's live
companion, RC7) start containers: the whole script is run under the lock shared with other sessions, and each live
control lists and removes whatever its run left of this change's own projects (builder_p_iso06c_real*), by name.
RC9 starts no container but, with its safeguard removed, the test under it opens a listener on the machine's port
4041 for a moment, which is why it too runs under the lock.

The copy is made by checks/make-run-copy.sh (git archive of the commit, with node_modules as real folders): the
door's containers mount builder/ and cannot follow the worktree's link to node_modules (measurements/M0).

Usage: controls-real.py <worktree> <commit> <work-dir> <out-file> <test-database-name> [only-ids...]
Run with TMPDIR, BUILDER_BROWSER_CACHE and NO_COLOR set as for every other run of this change."""
import datetime, hashlib, os, subprocess, sys

wt, commit, work, out, dbname = sys.argv[1:6]
only = set(sys.argv[6:])
HERE = os.path.dirname(os.path.abspath(__file__))
copy = os.path.join(work, "copy")
if not os.path.isdir(copy):
    subprocess.run([os.path.join(HERE, "make-run-copy.sh"), wt, commit, copy], check=True, capture_output=True)

ISO = "builder/src/sandbox/isolation.ts"
HARNESS = "builder/scripts/isolation-harness.ts"
LIVE = "builder/test/isolation-real-live.test.ts"
UNIT = "test/isolation.test.ts"
GATE = "test/acceptance-gate.test.ts"
LIVE_TEST = "test/isolation-real-live.test.ts"
PROJECT = "builder_p_iso06c_real"

# Added to the live test file's imports by the two live controls that need a function the file does not use.
IMPORT_OLD = 'import { afterAll, describe, expect, it } from "vitest";\n'
IMPORT_RC5 = IMPORT_OLD + 'import { spawnSync as controlSpawnSync } from "node:child_process";\nimport { buildStandIns as controlBuildStandIns } from "../scripts/isolation-harness.js";\n'
IMPORT_RC7 = IMPORT_OLD + 'import { probeService as controlProbeService } from "../scripts/isolation-harness.js";\n'

CONTROLS = [
    # id, what is removed, [(file, old text, new text), ...], [(test file, test name filter), ...], words the failing output must hold, live?
    ("RC1", "the target check: an entry's target must match the address the attempt was aimed at",
     [(ISO, "      const atTarget = !e.target || e.target.test(a.target);\n", "      const atTarget = true;\n")],
     [(UNIT, "an entry's target, when given"), (UNIT, "the running app's list")], [], False),
    ("RC2", "the running app's own-listener entry in the list app-running",
     [(ISO, '        { ids: new RegExp(`^X${ctx.appPort}$`), result: /^connected$/, target: new RegExp(`^127\\\\.0\\\\.0\\\\.1:${ctx.appPort}$`), why: "the app itself, listening inside its own container" },\n', "")],
     [(UNIT, "the running app's list")], [], False),
    ("RC3", "the scripted engine's list is empty (made to allow a name server instead)",
     [(ISO, '    case "engine-scripted":\n      return [];\n', '    case "engine-scripted":\n      return [dns];\n')],
     [(UNIT, "the scripted engine's list is empty")], [], False),
    ("RC4", "a Compose edit must be found exactly once",
     [(HARNESS, "    if (found !== 1) throw new Error(`A Compose edit is refused: its text was found ${found} times, not once, in ${e.service ? `the ${e.service} service` : \"the file\"}: ${JSON.stringify(e.from).slice(0, 160)}`);\n", "")],
     [(UNIT, "each real misconfiguration's edits")], [], False),
    ("RC5", "each one-off container's image is the one the build made (live): after the image ids are read and before the probes, stand-in images are tagged back under the app and tools names",
     [(LIVE, IMPORT_OLD, IMPORT_RC5),
      (LIVE, "    // The probes start here.\n",
       "    // CONTROL RC5: the real images are kept under names of this project (so that nothing is left without a name), then stand-ins take the app and tools names.\n"
       "    for (const n of [\"app\", \"tools\"]) controlSpawnSync(\"docker\", [\"tag\", `${x.sb.projectName}-${n}:latest`, `${x.sb.projectName}-rc5kept-${n}:latest`]);\n"
       "    controlBuildStandIns(x.sb, PROJECT);\n")],
     [(LIVE_TEST, "L[1234]:")],
     ["which is not builder_p_iso06c_real-app:latest as read after the build", "which is not builder_p_iso06c_real-tools:latest as read after the build", "the tools container ran as user id 0, not the image's unprivileged user"], True),
    ("RC6", "the realness check: realImageProblemsFrom made to find nothing",
     [(HARNESS, "  return imageProblems;\n", "  return [];\n")],
     [(UNIT, "realImageProblemsFrom")], [], False),
    ("RC6-live", "the real runner image in the real project (live): makeExample1 given the stand-in runner's image name",
     [(HARNESS, "runnerImage: RUNNER_IMAGE });\n  o.onMade?.(x);\n", "runnerImage: runnerStandInImageFor(o.projectId) });\n  o.onMade?.(x);\n")],
     [(LIVE_TEST, "L[123]:")],
     ["the acceptance service's image is builder_p_iso06c_real-runner-standin:latest, not builder-acceptance-runner:local: it is not the acceptance runner's real image"], True),
    ("RC7", "the app is probed in place (live): a one-off container of the app service is probed instead of the running one",
     [(LIVE, IMPORT_OLD, IMPORT_RC7),
      (LIVE, '    const inPlace = await probeInPlace(x.sb, "app", settings);\n',
       '    const inPlace = { lines: await controlProbeService(x.sb, "app", "app-rc7", settings), sha256: { repository: "not checked in this control", inside: "not checked in this control" }, container: { before: appContainer!.id, after: appContainer!.id }, removed: true, encodedLength: 0 }; // CONTROL RC7\n')],
     [(LIVE_TEST, "L[1234]:")],
     ["not tried: ^X3191$: the app itself, listening inside its own container"], True),
    ("RC8", "the file run in place is the repository's probe: the fingerprint comparison",
     [(HARNESS, "    if (inside !== repository) throw new Error(`The file written into the running ${service} container has SHA-256 ${inside || \"(nothing read)\"}, not the repository's probe (${repository}); it was not run.`);\n", "")],
     [(UNIT, "probeInPlace does not run a file")], [], False),
    ("RC9", "never skipped: the live file's prerequisite check made to return silently",
     [(LIVE, '  if (missing.length) throw new Error(MISSING_WORDS + missing.join(" "));\n', "  if (missing.length) return;\n")],
     [(GATE, "the live isolation test file for the real containers")], [], False),
    ("RC10", "the harness never removes an image that is not its own project's",
     [(HARNESS, "  const notOurs = images.filter((image) => !image.startsWith(`${sb.projectName}-`));\n  if (notOurs.length) throw new Error(`The isolation harness removes only images of its own project (${sb.projectName}-...); refused: ${notOurs.join(\", \")}.`);\n", "")],
     [(UNIT, "removeImages refuses a name")], [], False),
]
if only:
    CONTROLS = [c for c in CONTROLS if c[0] in only]

env = dict(os.environ, NO_COLOR="1", FORCE_COLOR="0", BUILDER_TEST_DATABASE_URL=f"postgres:///{dbname}?host=/var/run/postgresql")
for k in ("BUILDER_DATA_DIR", "BUILDER_MODEL_API_KEY", "BUILDER_UI_PASSWORD", "BUILDER_DATABASE_URL"):
    env.pop(k, None)


def vitest(test, name, timeout):
    return subprocess.run(["node", "node_modules/vitest/vitest.mjs", "run", test, "-t", name], cwd=os.path.join(copy, "builder"), env=env, capture_output=True, text=True, timeout=timeout)


def summary(r, n=16):
    keep = ("Test Files", "Tests ", "FAIL", "×", "AssertionError", "Error:", "- Expected", "+ Received")
    return [l.strip()[:400] for l in (r.stdout + r.stderr).splitlines() if l.strip().startswith(keep)][:n]


def counts(r):
    return " / ".join(l for l in summary(r, 60) if l.startswith(("Test Files", "Tests ")))


def tree_hash():
    """One fingerprint of every file of the copy (its node_modules left out): path, then content."""
    h = hashlib.sha256()
    for root, dirs, names in os.walk(copy):
        dirs[:] = sorted(d for d in dirs if d != "node_modules")
        for name in sorted(names):
            p = os.path.join(root, name)
            h.update(os.path.relpath(p, copy).encode() + b"\0")
            if os.path.islink(p):
                h.update(os.readlink(p).encode())
            else:
                with open(p, "rb") as f:
                    h.update(f.read())
    return h.hexdigest()


def q(*a):
    return subprocess.run(list(a), capture_output=True, text=True).stdout.split()


def left_and_removed():
    """What a live control's run left of this change's own projects, listed and removed (images by name only)."""
    names = []
    for c in q("docker", "ps", "-a", "--filter", f"name={PROJECT}", "--format", "{{.Names}}"):
        names.append(f"container {c}")
        subprocess.run(["docker", "rm", "-f", c], capture_output=True)
    for kind in ("network", "volume"):
        for n in q("docker", kind, "ls", "--filter", f"name={PROJECT}", "--format", "{{.Name}}"):
            names.append(f"{kind} {n}")
            subprocess.run(["docker", kind, "rm", n], capture_output=True)
    for i in q("docker", "images", "--filter", f"reference={PROJECT}*", "--format", "{{.Repository}}:{{.Tag}}"):
        names.append(f"image {i}")
        subprocess.run(["docker", "image", "rm", "-f", i], capture_output=True)
    return names


def dangling():
    return set(q("docker", "images", "--filter", "dangling=true", "--quiet", "--no-trunc"))


caught = missed = notrun = 0
before_all = tree_hash()
with open(out, "a") as f:
    f.write(f"# Package 0.6c, the run in real containers: controls RC1 to RC10, {datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')},\n")
    f.write(f"# on a copy of commit {commit} made with git archive (node_modules as real folders); test database {dbname}.\n")
    f.write("# Each control removes one safeguard by exact replacement, runs the test that covers it (expected: FAIL), restores the file,\n")
    f.write("# and checks the copy's tree is what it was. Unit controls: the test is then run again (expected: pass). Live controls: under the shared lock.\n")
    f.write(f"# The copy's tree before any control: sha256 {before_all}\n\n")
    for cid, what, changes, tests, must_say, live in CONTROLS:
        originals, problem = {}, None
        for path, old, new in changes:
            text = originals.get(path) or open(os.path.join(copy, path)).read()
            originals.setdefault(path, text)
        edited = dict(originals)
        for path, old, new in changes:
            n = edited[path].count(old)
            if n != 1:
                problem = f"the text to change was found {n} times in {path}"
                break
            edited[path] = edited[path].replace(old, new)
        if problem:
            f.write(f"## {cid} NOT RUN: {problem}\n\n")
            notrun += 1
            continue
        dangling_before = dangling() if live else set()
        tmp_before = set(os.listdir(os.environ.get("TMPDIR", "/tmp"))) if os.path.isdir(os.environ.get("TMPDIR", "/tmp")) else set()
        for path, text in edited.items():
            open(os.path.join(copy, path), "w").write(text)
        try:
            runs = [(test, name, vitest(test, name, 3600 if live else 900)) for test, name in tests]
        finally:
            for path, text in originals.items():
                open(os.path.join(copy, path), "w").write(text)
        unchanged = tree_hash() == before_all
        failed = all(r.returncode != 0 for _, _, r in runs)
        output = "\n".join(r.stdout + r.stderr for _, _, r in runs)
        said = [w for w in must_say if w in output]
        ok = failed and len(said) == len(must_say)
        caught += ok
        missed += not ok
        f.write(f"## {cid}: {what}\nChanged in {', '.join(sorted(originals))}\n")
        for test, name, r in runs:
            verdict = "FAILED with the safeguard removed, as it should" if r.returncode != 0 else "PASSED WITH THE SAFEGUARD REMOVED (control did not catch it)"
            f.write(f"Test {test} -t \"{name}\": exit {r.returncode}: {verdict}\n")
            f.write("\n".join("    " + l for l in summary(r)) + "\n")
        if must_say:
            f.write(f"The failing output must name what was removed: {len(said)} of {len(must_say)} expected texts found\n")
            for w in must_say:
                line = next((l.strip()[:300] for l in output.splitlines() if w in l), None)
                f.write(f"    {'found' if w in said else 'NOT FOUND'}: {w}\n" + (f"        in: {line}\n" if line else ""))
        f.write(f"Restored; the copy's tree is unchanged: {'yes' if unchanged else 'NO'}\n")
        if not live:
            for test, name in tests:
                r2 = vitest(test, name, 900)
                f.write(f"Restored, test {test} -t \"{name}\": exit {r2.returncode}: {counts(r2)}\n")
            if cid == "RC9":
                # With the check silenced and no Docker, the live file's tests make project folders they cannot then remove.
                tmp = os.environ.get("TMPDIR", "/tmp")
                stray = sorted(set(os.listdir(tmp)) - tmp_before) if os.path.isdir(tmp) else []
                for name in stray:
                    if name.startswith(("builder-acceptance-", "bpc-")):
                        subprocess.run(["rm", "-rf", os.path.join(tmp, name)])
                f.write(f"Left in the temporary folder by the run with the check silenced, and removed: {', '.join(n for n in stray if n.startswith(('builder-acceptance-', 'bpc-'))) or 'nothing'}\n")
        else:
            f.write("Restored, the same tests: not run again here; the whole live file on the unchanged code is kept as run-isolation-real-live.txt\n")
            f.write(f"Left by the run of this change's own projects and removed here (images by name): {', '.join(left_and_removed()) or 'nothing'}\n")
            new_dangling = dangling() - dangling_before
            f.write(f"Images left without a name by the run: {', '.join(sorted(new_dangling)) or 'none'}\n")
        f.write("\n")
        f.flush()
    f.write(f"# Summary: {len(CONTROLS)} controls; {caught} failed with their safeguard removed, as they should; {missed} passed with it or did not name what was removed; {notrun} not run.\n")
    f.write(f"# The copy's tree after all controls: sha256 {tree_hash()} ({'unchanged' if tree_hash() == before_all else 'CHANGED'})\n")
print(f"done: {caught} caught, {missed} missed, {notrun} not run")
