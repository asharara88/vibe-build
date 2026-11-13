#!/usr/bin/env python3
"""Package 0.6c, after its review: the controls for the safeguards and test changes the review led to. Each control
changes one thing on a scratch copy of the commit (git archive), runs the test that covers it (expected: FAIL), then
restores the file and runs the test again (expected: pass). For the image-build test's new reading, the same change is
also made on a copy of the commit the review read, to show what the old test let through (expected there: pass).
None of these tests starts a container. Usage: controls-3.py <commit> <reviewed-commit> <work-dir> <out-file>"""
import datetime, os, subprocess, sys

commit, reviewed, work, out = sys.argv[1:5]
WT = "/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad/wt-06c"


def copy_of(c):
    d = os.path.join(work, f"copy-{c}")
    if not os.path.isdir(d):
        os.makedirs(d)
        subprocess.run(f"git -C {WT} archive {c} | tar -x -C {d}", shell=True, check=True)
        os.symlink(f"{WT}/builder/node_modules", f"{d}/builder/node_modules")
    return d


S = "builder/src/sandbox/"
DF = "templates/next/Dockerfile"
CONTROLS = [
    # id, what is removed or added, file, old text, new text, test file, test name filter, also on the reviewed commit
    ("C34", "a tunnel only to port 443", S + "egress-proxy.ts",
     "    if (port !== TUNNEL_PORT) {", "    if (false) {",
     "test/door.test.ts", "a tunnel to port 443 only", False),
    ("C35", "plain HTTP only to an http:// address on port 80", S + "egress-proxy.ts",
     '    if (target.protocol !== "http:" || port !== PLAIN_HTTP_PORT) {', "    if (false) {",
     "test/door.test.ts", "a tunnel to port 443 only", False),
    ("C36", "the machine side's project proxy given its upstream (without it, it would go out directly)", S + "egress-machine.ts",
     "const proxy = createEgressProxy({ allow, upstreamProxy: upstream.href });", "const proxy = createEgressProxy({ allow });",
     "test/door.test.ts", "two proxies go out through its upstream", False),
    ("C37", "the machine side's image-build proxy given its upstream", S + "egress-machine.ts",
     "const b = createEgressProxy({ allow: buildAllow, upstreamProxy: upstream.href, log:", "const b = createEgressProxy({ allow: buildAllow, log:",
     "test/door.test.ts", "two proxies go out through its upstream", False),
    ("C38", "the machine side's sockets only in its socket folder", S + "egress-machine.ts",
     "if (!egressSocket.startsWith(socketFolder) || !gatewaySocket.startsWith(socketFolder)) throw", "if (false) throw",
     "test/door.test.ts", "two proxies go out through its upstream", False),
    ("C39", "ADDED: a lower-case `run npm run build`, with the network, after `COPY . .` (the review's example)", DF,
     "COPY . .\n", "COPY . .\nrun npm run build\n",
     "test/sandbox.test.ts", "image build", True),
    ("C40", "ADDED: a `# Syntax=` parser directive written with a capital letter (it would fetch a build front end)", DF,
     "# House template, TypeScript candidate.", "# Syntax=docker/dockerfile:1\n# House template, TypeScript candidate.",
     "test/sandbox.test.ts", "image build", True),
    ("C41", "ADDED: an `# escape=` parser directive (it would change how lines are joined)", DF,
     "# House template, TypeScript candidate.", "# escape=`\n# House template, TypeScript candidate.",
     "test/sandbox.test.ts", "image build", True),
]

env = dict(os.environ, NO_COLOR="1", BUILDER_TEST_DATABASE_URL="postgres:///builder_test_f06c?host=/var/run/postgresql")


def vitest(copy, test, name, tmp):
    os.makedirs(tmp, exist_ok=True)
    return subprocess.run(["npx", "vitest", "run", test, "-t", name], cwd=os.path.join(copy, "builder"), env=dict(env, TMPDIR=tmp), capture_output=True, text=True, timeout=600)


def summary(r, n=14):
    txt = r.stdout + r.stderr
    keep = ("Test Files", "Tests ", "FAIL", "×", "AssertionError", "Error:", "- Expected", "+ Received")
    return [l.strip() for l in txt.splitlines() if l.strip().startswith(keep)][:n]


new, old = copy_of(commit), copy_of(reviewed)
tmp = os.path.join(work, "tmp")
with open(out, "a") as f:
    f.write(f"# Package 0.6c controls after its review, {datetime.datetime.utcnow().isoformat(timespec='seconds')}Z, on a copy of commit {commit} made with git archive;\n")
    f.write(f"# for C39 to C41 also on a copy of {reviewed}, the commit the review read.\n")
    f.write("# Each control changes one thing, runs the test that covers it (expected: FAIL), then restores the file and runs it again (expected: pass).\n\n")
    for cid, what, path, before, after, test, name, also_old in CONTROLS:
        full = os.path.join(new, path)
        orig = open(full).read()
        if orig.count(before) != 1:
            f.write(f"## {cid} NOT RUN: the text to change was found {orig.count(before)} times in {path}\n\n")
            continue
        open(full, "w").write(orig.replace(before, after, 1))
        r = vitest(new, test, name, tmp)
        open(full, "w").write(orig)
        r2 = vitest(new, test, name, tmp)
        verdict = "FAILED with the change, as it should" if r.returncode != 0 else "PASSED WITH THE CHANGE (control did not catch it)"
        f.write(f"## {cid}: {what}\nChanged in {path}; test {test} -t \"{name}\"\nWith the change: exit {r.returncode}: {verdict}\n")
        f.write("\n".join("    " + l for l in summary(r)) + "\n")
        f.write(f"Restored: exit {r2.returncode}: " + " / ".join(l for l in summary(r2) if l.startswith(("Test Files", "Tests "))) + "\n")
        # With C38's check removed, the test's second machine side starts at the path outside its folder and leaves a socket there.
        stray = "/tmp/m06c-elsewhere.sock"
        if os.path.exists(stray):
            os.remove(stray)
            f.write(f"Left by the test run and removed: {stray}\n")
        if also_old:
            fo = os.path.join(old, path)
            o = open(fo).read()
            open(fo, "w").write(o.replace(before, after, 1))
            r3 = vitest(old, test, name, tmp)
            open(fo, "w").write(o)
            said = "passed: the old test let it through" if r3.returncode == 0 else "failed"
            f.write(f"The same change under the test as the review read it ({reviewed}): exit {r3.returncode}, {said}: " + " / ".join(l for l in summary(r3) if l.startswith(("Test Files", "Tests "))) + "\n")
        f.write("\n")
        f.flush()

    # The review's housekeeping note: a run that leaves the live blocks out made folders in the temporary folder.
    f.write("## Housekeeping: what a run that leaves the live blocks out leaves in its temporary folder\n")
    f.write("Command: npx vitest run test/sandbox.test.ts -t \"askApp\", with an empty temporary folder of its own (Node's compile cache not listed)\n")
    for label, copy in ((f"as the review read it ({reviewed})", old), (f"after the review ({commit})", new)):
        t = os.path.join(work, f"tmp-housekeeping-{os.path.basename(copy)}")
        os.makedirs(t, exist_ok=True)
        r = vitest(copy, "test/sandbox.test.ts", "askApp", t)
        left = sorted(x for x in os.listdir(t) if x != "node-compile-cache")
        f.write(f"  {label}: exit {r.returncode}; " + " / ".join(l for l in summary(r) if l.startswith(("Test Files", "Tests "))) + f"; left: {', '.join(left) or 'nothing'}\n")
    f.write("\n")
print("done")
