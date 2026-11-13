#!/usr/bin/env python3
"""Package 1.4b, after its review: controls X15 to X25.

Each removes one safeguard (X15 to X24: added after the review; X25: package 1.4's queue, whose test's file watcher
was changed after the review), in a scratch copy of the commit (git archive), runs the named test there, expects it
to FAIL, then puts the file back. The working tree is never changed.
Kept as evidence. Run from the repository's root as:
    SCRATCHPAD=<scratch folder> BUILDER_TEST_DATABASE_URL=<test database> python3 evidence/2026-11-13-package-1.4b/controls-after-review.py <commit>
ONLY=<id> (for example ONLY=X15) runs that one control alone. No test here starts a container.
"""
import os
import re
import shutil
import subprocess
import sys

commit = sys.argv[1]
repo = os.getcwd()
ctl = os.path.join(os.environ["SCRATCHPAD"], "p14bfix-ctl")
os.environ["TMPDIR"] = os.path.join(os.environ["SCRATCHPAD"], "p14bfix-tmp")
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
A = "src/gateway/app.ts"
TR = "test/journal-recovery.test.ts"
TF = "test/journal-files.test.ts"
TB = "test/failures.test.ts"

# id, test file, test name pattern, source file, the exact text removed, what replaces it, what the safeguard is
CONTROLS = [
    ("X15", TR, r"\(h\) after", J,
     "return this.serial(() => appendWhole(this.file, line));",
     "return this.serial(async () => { this.checkMayWrite(); await appendWhole(this.file, line); });",
     "the blocking item: a call's ending appended to the journal while the gateway does not hold its folder's lock (here: the append guarded again, as at fa2b38c)"),
    ("X16", TF, r"\(r1\) an append", J,
     "const carriedOver = await this.carryOver(old, read.length);",
     "const carriedOver = 0;",
     "a rewrite carrying over what was appended to the old file after it was read"),
    ("X17", TF, r"\(r2\) an append", J,
     "if (now !== null && now.ino === wroteTo.ino && now.dev === wroteTo.dev) return;",
     "return;",
     "an append writing its line again when its file was replaced while it wrote"),
    ("X18", TF, r"\(r3\) the folder", J,
     "const fh = await open(tmp, \"wx\");",
     "const fh = await open(file, \"wx\");",
     "the folder's id file written under a temporary name and linked into place (here: written under its own name, as at fa2b38c)"),
    ("X19", TF, r"\(r4\) an entry", J,
     "await appendWhole(this.setAsideFile, Buffer.from(JSON.stringify(entry) + \"\\n\"));",
     "await appendSynced(this.setAsideFile, JSON.stringify(entry) + \"\\n\");",
     "a set-aside entry starting on a line of its own after an entry cut short (here: appended as at fa2b38c)"),
    ("X20", TR, r"\(i\) after", R,
     "  return r.rows[0]!.held;\n}",
     "  const c = await pool.connect();\n  try {\n    await c.query(\"begin\");\n    await c.query(`select pg_try_advisory_xact_lock(${journalFolderLockKeySql(\"$1\")})`, [folderId]);\n  } finally {\n    await c.query(\"rollback\").catch(() => undefined);\n    c.release();\n  }\n  return r.rows[0]!.held;\n}",
     "--list reading which locks are held without taking one (here: it also takes the folder's lock for one transaction, as at fa2b38c)"),
    ("X21", TR, r"\(i\) after", R,
     "text: shownText(l.bytes.subarray(0, LISTED_BYTES))",
     "text: shownText(l.bytes)",
     "--list decoding only the start of a long line"),
    ("X22", TR, r"\(e3\) after", R,
     "holdDiffersFromRequest: (mine.hold_id === null ? null : String(mine.hold_id)) !== req.hold",
     "holdDiffersFromRequest: false",
     "a re-run naming another hold than the earlier record's being told so"),
    ("X23", TR, r"\(a\) the review", A,
     "(gate.unreadableLines().length > 0 ? c.json({ ok: false, ...journalUnreadable(\"This is the gateway's health check.\") }, 503) : c.json({ ok: true }))",
     "c.json({ ok: true })",
     "the health check answering 503 while an unreadable line keeps the gateway closed (here: {ok: true} always, as at fa2b38c)"),
    ("X24", TF, r"\(r1b\) a line", J,
     "waited < CARRY_OVER_WAIT_MS;",
     "waited < 0;",
     "a rewrite waiting for a line still being written into the old file to end before carrying it over"),
    ("X25", TB, r"B10 \(9\)", J,
     "return this.serial(() => appendWhole(this.file, line));",
     "return appendWhole(this.file, line);",
     "package 1.4's queue for appends (B10 (9)), whose test's file watcher was changed in this round to see an append opened \"a+\": with the append taken out of the queue, the test still fails"),
]

passed = failed = 0
only = os.environ.get("ONLY")
for cid, test, pattern, path, old, new, what in CONTROLS:
    if only and only != cid:
        continue
    print(f"=== {cid}: {what}")
    print(f"    file: {path}; test: {test} -t '{pattern}'")
    full = os.path.join(builder, path)
    original = open(full, encoding="utf-8").read()
    if original.count(old) != 1:
        print(f"    NOT APPLIED: the text to remove is found {original.count(old)} time(s), not once")
        failed += 1
        continue
    open(full, "w", encoding="utf-8").write(original.replace(old, new))
    for line in old.splitlines():
        print(f"    - {line.strip()}")
    for line in new.splitlines():
        print(f"    + {line.strip()}")
    try:
        run = subprocess.run(["npx", "vitest", "run", test, "-t", pattern], cwd=builder, capture_output=True, text=True, timeout=600)
        out, code = run.stdout + run.stderr, run.returncode
    except subprocess.TimeoutExpired:
        out, code = "timed out after 600 s", -1
    finally:
        open(full, "w", encoding="utf-8").write(original)
    shown = [l for l in out.splitlines() if re.search(r"^\s+(×|✓)|AssertionError|Error:|Tests\s+\d", l)][:6]
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
