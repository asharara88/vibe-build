#!/usr/bin/env python3
"""Package 1.4b, after the review bot on 88e984b: controls X26 to X35.

Each removes one safeguard added for the bot's two findings, in a scratch copy of the commit (git archive), runs the
named test there, expects it to FAIL, then puts the files back. The working tree is never changed. A control may change
more than one place (each must be found exactly once).
Kept as evidence. Run from the repository's root as:
    SCRATCHPAD=<scratch folder> BUILDER_TEST_DATABASE_URL=<test database> python3 evidence/2026-11-13-package-1.4b/controls-after-bot.py <commit>
ONLY=<id> (for example ONLY=X26) runs that one control alone. No test here starts a container.
"""
import os
import re
import shutil
import subprocess
import sys

commit = sys.argv[1]
repo = os.getcwd()
ctl = os.path.join(os.environ["SCRATCHPAD"], "bot14b-ctl")
os.environ.setdefault("TMPDIR", os.path.join(os.environ["SCRATCHPAD"], "bot14b-tmp"))
os.makedirs(os.environ["TMPDIR"], exist_ok=True)
shutil.rmtree(ctl, ignore_errors=True)
os.makedirs(ctl)
archive = subprocess.run(["git", "-C", repo, "archive", commit, "builder"], check=True, capture_output=True).stdout
subprocess.run(["tar", "-x", "-C", ctl], input=archive, check=True)
os.symlink(os.path.join(repo, "builder", "node_modules"), os.path.join(ctl, "builder", "node_modules"))
builder = os.path.join(ctl, "builder")
short = subprocess.run(["git", "-C", repo, "rev-parse", "--short", commit], check=True, capture_output=True, text=True).stdout.strip()
print(f"Scratch copy: git archive {short} builder, with the checkout's node_modules linked in")

J = "src/gateway/journal.ts"
R = "src/gateway/journal-recovery.ts"
TC = "test/journal-crash.test.ts"
TL = "test/journal-recovery-lock.test.ts"

# id, test file, test name pattern, [(source file, the exact text removed, what replaces it)], what the safeguard is
CONTROLS = [
    ("X26", TC, r"\(k1\) the bot", [
        (J, "      await link(this.file, keep);\n      const oldStat = await old.stat();\n      const kept = await stat(keep);",
            "      const oldStat = await old.stat();\n      const kept = oldStat;"),
        (J, "      // (5) Only now is the old file's second name removed.\n      await unlink(keep);\n", ""),
    ], "finding 1: the old journal file kept under a second name until what was appended to it is carried over (here: no second name, as at 88e984b)"),
    ("X27", TC, r"\(k2\) the gateway's move", [
        (J, "      const carriedOver = await this.carryOver(old, read.length);\n      // (5) Only now is the old file's second name removed.\n      await unlink(keep);",
            "      await unlink(keep);\n      const carriedOver = await this.carryOver(old, read.length);"),
    ], "finding 1: the second name removed only after the carry-over is on disk (here: removed before it)"),
    ("X28", TC, r"\(k1\) the bot", [
        (J, "    for (const a of onlyInLeftovers(lines, await this.readLeftovers(), setAside)) {", "    for (const a of onlyInLeftovers(lines, [], setAside)) {"),
        (J, "    if ((await this.o.journal.leftovers()).length > 0) {", "    if (false) {"),
    ], "finding 1: the gateway at start-up reading a leftover beside the journal file (here: it reads the journal file only)"),
    ("X29", TC, r"\(k2\) the gateway's move", [
        (J, "        await this.o.journal.absorbLeftovers(setAside).catch((err: unknown) =>", "        await Promise.resolve().catch((err: unknown) =>"),
    ], "finding 1: the gateway at start-up moving a leftover into the journal file and removing it (here: it reads it and leaves it)"),
    ("X30", TC, r"\(k2\) the recovery script's removal", [
        (J, "      setAside = await setAsideFingerprints(this.o.pool, this.o.journal.folderId).catch(() => null);", "      setAside = new Set<string>();"),
    ], "finding 1: a leftover's line recorded as set aside not counted again (here: the set-asides are not read)"),
    ("X31", TC, r"\(k4\)", [
        (R, "  for (const a of onlyInLeftovers(lines, leftovers, new Set(setAsides.map((r) => r.fingerprint)))) show(a.line, ++next, a.read, a.leftover);\n", ""),
    ], "finding 1: --list showing what a leftover alone holds (here: the journal file only)"),
    ("X32", TC, r"\(k4\)", [
        (R, "      await journal.absorbLeftovers(setAside);", "      void setAside;"),
    ], "finding 1: the recovery script moving a leftover into the journal file before it sets a line aside (here: it does not)"),
    ("X33", TL, r"\(l[123]\)", [
        (R, "    if (!held()) throw new RecoveryStopped(WRITES[w]);\n  };", "  };"),
    ], "finding 2: the check, right before each write, that the run still holds the folder's lock (here: it never stops the run)"),
    ("X34", TL, r"\(l2\)", [
        (R, "      await write(\"record: commit\"); // lost now: the transaction is rolled back, and nothing of it is written\n", ""),
    ], "finding 2: the check inside the set-aside's transaction right before its commit (here: removed)"),
    ("X35", TL, r"\(l1\)", [
        (R, "  lock.on(\"error\", () => (connectionLost = true));\n  lock.on(\"end\", () => (connectionLost = true));", "  lock.on(\"error\", () => undefined);"),
        (R, "        await lock.query(\"select 1\"); // the lock's own session still answers: it still holds the lock\n", ""),
    ], "finding 2: the lock connection's 'error' and 'end' tracked, and a query on it before each write (here: neither, as at 88e984b, the check itself left in place)"),
]

passed = failed = 0
only = os.environ.get("ONLY")
for cid, test, pattern, edits, what in CONTROLS:
    if only and only != cid:
        continue
    print(f"=== {cid}: {what}")
    print(f"    test: {test} -t '{pattern}'")
    originals = {}
    applied = True
    for path, old, new in edits:
        full = os.path.join(builder, path)
        if path not in originals:
            originals[path] = open(full, encoding="utf-8").read()
        current = open(full, encoding="utf-8").read()
        if current.count(old) != 1:
            print(f"    NOT APPLIED: in {path}, the text to remove is found {current.count(old)} time(s), not once")
            applied = False
            break
        open(full, "w", encoding="utf-8").write(current.replace(old, new))
        print(f"    file: {path}")
        for line in old.splitlines():
            print(f"    - {line.strip()}")
        for line in new.splitlines():
            print(f"    + {line.strip()}")
    if not applied:
        for path, text in originals.items():
            open(os.path.join(builder, path), "w", encoding="utf-8").write(text)
        failed += 1
        continue
    try:
        run = subprocess.run(["npx", "vitest", "run", test, "-t", pattern], cwd=builder, capture_output=True, text=True, timeout=600)
        out, code = run.stdout + run.stderr, run.returncode
    except subprocess.TimeoutExpired:
        out, code = "timed out after 600 s", -1
    finally:
        for path, text in originals.items():
            open(os.path.join(builder, path), "w", encoding="utf-8").write(text)
    shown = [l for l in out.splitlines() if re.search(r"^\s+(×|✓)|AssertionError|Error:|Tests\s+\d", l)][:8]
    for l in shown:
        print(f"    | {l.strip()[:300]}")
    if code != 0 and re.search(r"Tests\s+\d+\s+failed", out):
        print(f"    RESULT: the test FAILED, as it should (exit {code})")
        passed += 1
    else:
        print(f"    RESULT: the test did NOT fail (exit {code})")
        failed += 1
print(f"=== controls that failed as they should: {passed}; that did not: {failed}")
shutil.rmtree(ctl, ignore_errors=True)
