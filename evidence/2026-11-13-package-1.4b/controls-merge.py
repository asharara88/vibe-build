#!/usr/bin/env python3
"""Package 1.4b brought up to date with 1.4c: controls M1 to M10, Z8m to Z10m, Y7m, X2m, X8m and X13m.

M1 to M10 each remove one part of the merge's new freeze kind, 'journal_line_set_aside' (migration 012, the store, the
list, the script), and Z8m to Z10m are 1.4c's controls Z8 to Z10 aimed at migration 012, which now holds the two
checks they removed from migration 010 (012 drops and adds them again, so Z8 to Z10 as written no longer reach them).
Y7m is 1.4c's Y7 on 1.4c's code as merged: 1.4c's review added a third kind to the line Y7 changes, so Y7's text is
not found there, on 1.4c's own commit as on the merge. X2m, X8m and X13m are 1.4b's X2, X8 and X13 (controls.sh) on
1.4b's journal as it stands since its review and the review bot: their text is not found on 1.4b's own commit b1476a6
either, and the merge does not change that file.
Each runs in a scratch copy of the commit (git archive), runs the named test there, expects it to FAIL, then puts the
files back. The working tree is never changed. A control may change more than one place (each must be found exactly
once). A control that changes a migration runs on a database of its own, made empty for it and dropped after
(FRESH_DB), since migrations are applied once per database, by name. Before the controls, the named tests are run on
the unchanged copy and must pass.
Kept as evidence. Run from the repository's root as:
    SCRATCHPAD=<scratch folder> BUILDER_TEST_DATABASE_URL=<test database> FRESH_DB=<name of a database to make and drop> \\
      python3 evidence/2026-11-13-package-1.4b/controls-merge.py <commit>
ONLY=<id> (for example ONLY=M1) runs that one control alone. No test here starts a container.
"""
import os
import re
import shutil
import subprocess
import sys

commit = sys.argv[1]
repo = os.getcwd()
fresh_db = os.environ["FRESH_DB"]
main_db = os.environ["BUILDER_TEST_DATABASE_URL"]
ctl = os.path.join(os.environ["SCRATCHPAD"], "merge14b-ctl")
os.environ.setdefault("TMPDIR", os.path.join(os.environ["SCRATCHPAD"], "merge14b-tmp"))
os.makedirs(os.environ["TMPDIR"], exist_ok=True)
shutil.rmtree(ctl, ignore_errors=True)
os.makedirs(ctl)
archive = subprocess.run(["git", "-C", repo, "archive", commit, "builder"], check=True, capture_output=True).stdout
subprocess.run(["tar", "-x", "-C", ctl], input=archive, check=True)
os.symlink(os.path.join(repo, "builder", "node_modules"), os.path.join(ctl, "builder", "node_modules"))
builder = os.path.join(ctl, "builder")
short = subprocess.run(["git", "-C", repo, "rev-parse", "--short", commit], check=True, capture_output=True, text=True).stdout.strip()
print(f"Scratch copy: git archive {short} builder, with the checkout's node_modules linked in")

R = "src/gateway/journal-recovery.ts"
J = "src/gateway/journal.ts"
F = "src/store/freezes.ts"
RC = "src/store/reconcile.ts"
S = "scripts/reconcile.ts"
M12 = "src/store/migrations/012_journal_set_asides.sql"
TR = "test/journal-recovery.test.ts"
TO = "test/overrun.test.ts"
M = r"\(m\) brought"
G = r"1\.4c \(g\)"

# id, test file, test name pattern, [(source file, the exact text removed, what replaces it)], what the safeguard is, fresh database
CONTROLS = [
    ("M1", TR, M, [
        (R, "insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, record)\n           values ($1, 'journal_line_set_aside', $2, $3, $4, $5, clock_timestamp(), $6, $7) returning *",
            "insert into project_freezes(project_id, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, record)\n           values ($1, $2, $3, $4, $5, clock_timestamp(), $6, $7) returning *"),
    ], "the set-aside's freeze written with its own kind (here: the column's default, 'unrecorded_ending', as 1.4b's insert gives on 1.4c's schema)", False),
    ("M2", TR, M, [
        (R, "{ freeze_id: Number(freeze.id), kind: freeze.kind, journal_id: freeze.journal_id,", "{ freeze_id: Number(freeze.id), journal_id: freeze.journal_id,"),
    ], "the kind named in the set-aside's project.frozen event", False),
    ("M3", TR, M, [
        (M12, "  check (kind <> 'journal_line_set_aside'\n", "  check (true or kind <> 'journal_line_set_aside'\n"),
    ], "migration 012's check of a set-aside freeze (project_freezes_set_aside_line), made always true", True),
    ("M4", TR, M, [
        (M12, "\n             and (record->>'fingerprint') is not null and (record->>'fingerprint') ~ '^[0-9a-f]{64}$'", ""),
    ], "that check's part on the line's fingerprint", True),
    ("M5", TR, M, [
        (M12, "or (hold_id is not null and hold_amount_usd is not null and hold_amount_usd <> 'NaN'::numeric and bill_usd is null\n",
              "or (hold_amount_usd is not null and hold_amount_usd <> 'NaN'::numeric\n"),
    ], "that check's parts on the hold named and on no bill", True),
    ("M6", TR, M, [
        (F, "  if (f.kind === \"journal_line_set_aside\" || f.reason === SET_ASIDE_FREEZE_REASON) {", "  if (false) {"),
    ], "the refusal's own message for a set-aside freeze", False),
    ("M7", TR, M, [
        (RC, "if (freezes.some((f) => f.kind === \"unrecorded_ending\" || f.kind === \"journal_line_set_aside\")) add(\"froze its project\");",
             "if (freezes.some((f) => f.kind === \"unrecorded_ending\")) add(\"froze its project\");"),
    ], "the list's kind for a hold a set-aside froze (\"froze its project\", as on 1.4b's branch)", False),
    ("M8", TR, M, [
        (RC, "  journal_line_set_aside: \"an unreadable line of the gateway's journal was set aside naming it\",\n", ""),
    ], "the words --overrun's refusal uses for this kind (here: none, so the kind's bare name is shown)", False),
    ("M9", TR, M, [
        (S, "      : setAside ? ` (an unreadable journal line set aside as ", "      : false ? ` (an unreadable journal line set aside as "),
    ], "the script's line saying a freeze came from a line set aside", False),
    ("M10", TR, M, [
        (M12, "  on project_freezes(hold_id, kind) where kind not in ('unrecorded_ending', 'journal_line_set_aside');",
              "  on project_freezes(hold_id, kind) where kind <> 'unrecorded_ending';"),
        (F, "on conflict (hold_id, kind) where kind not in ('unrecorded_ending', 'journal_line_set_aside') do nothing",
            "on conflict (hold_id, kind) where kind <> 'unrecorded_ending' do nothing"),
    ], "two lines set aside naming one hold (here: 1.4c's index of one freeze per hold and kind, and the store's clause, as in migration 010)", True),
    ("Z8m", TO, G, [
        (M12, "\n             and bill_usd <> 'NaN'::numeric and hold_amount_usd <> 'NaN'::numeric and bill_usd > hold_amount_usd));", "));"),
    ], "1.4c's Z8 on migration 012: the database's check that a freeze's bill is a number above its hold's amount", True),
    ("Z9m", TO, G, [
        (M12, "and bill_usd <> 'NaN'::numeric and hold_amount_usd <> 'NaN'::numeric and bill_usd > hold_amount_usd));", "and bill_usd > hold_amount_usd));"),
    ], "1.4c's Z9 on migration 012: the same check's refusal of 'NaN' (which PostgreSQL ranks above every number)", True),
    ("Z10m", TO, G, [
        (M12, "create unique index project_freezes_one_overrun_per_hold", "create index project_freezes_one_overrun_per_hold"),
    ], "1.4c's Z10 on migration 012: one freeze per hold and kind (the index made not unique)", True),
    ("Y7m", TO, r"1\.4c \(a1\)", [
        (F, "  if (f.kind === \"bill_above_hold\" || f.kind === \"late_answer_above_hold\" || f.kind === \"kept_above_hold\") {", "  if (false) {"),
    ], "1.4c's Y7 on its code as merged (after 1.4c's review the condition names a third kind, so Y7's text is no longer found): the refusal's message naming the bill, the hold and the difference", False),
    ("X2m", TR, r"\(c\) markDone", [
        (J, "      (lines) => lines.filter(isIt),", "      (lines) => lines.filter((l) => isIt(l) || readLine(l).kind !== \"record\"),"),
    ], "1.4b's X2 on its code since its review (markDone now rewrites through rewriteWithout): markDone keeping the lines it does not move (here: also moving every line that is not a readable record)", False),
    ("X8m", TR, r"\(c\) markDone", [
        (J, "await fh.writeFile(endsInsideALine ? Buffer.concat([NL, data]) : data);", "await fh.writeFile(data);"),
    ], "1.4b's X8 on its code since its review (appends go through appendWhole): an append after a last line with no line end starting on a line of its own", False),
    ("X13m", TR, r"\(g\) the folder", [
        (J, "    if (!this.mayWrite()) {\n      throw Object.assign(", "    if (false) {\n      throw Object.assign("),
    ], "1.4b's X13 on its code since its review (only moves are guarded; an append still goes on, decision of 13 Nov): the journal moving nothing in its file while the gateway does not hold its folder's lock", False),
]


def fresh():
    subprocess.run(["dropdb", "--if-exists", "-h", "/var/run/postgresql", fresh_db], check=True)
    subprocess.run(["createdb", "-h", "/var/run/postgresql", fresh_db], check=True)
    return f"postgres:///{fresh_db}?host=/var/run/postgresql"


def vitest(test, pattern, db):
    env = dict(os.environ, BUILDER_TEST_DATABASE_URL=db)
    try:
        run = subprocess.run(["npx", "vitest", "run", test, "-t", pattern], cwd=builder, capture_output=True, text=True, timeout=600, env=env)
        return run.stdout + run.stderr, run.returncode
    except subprocess.TimeoutExpired:
        return "timed out after 600 s", -1


only = os.environ.get("ONLY")
# The unchanged copy first: the named tests must pass, on a database made empty for it.
if not only:
    for test, pattern in ((TR, M), (TO, G)):
        out, code = vitest(test, pattern, fresh())
        line = next((l.strip() for l in out.splitlines() if re.search(r"Tests\s+\d", l)), "(no count)")
        print(f"=== unchanged copy: {test} -t '{pattern}': {line} (exit {code})")
        if code != 0:
            print("    STOP: the unchanged copy does not pass")
            sys.exit(1)
    subprocess.run(["dropdb", "--if-exists", "-h", "/var/run/postgresql", fresh_db], check=True)

passed = failed = 0
for cid, test, pattern, edits, what, needs_fresh in CONTROLS:
    if only and only != cid:
        continue
    print(f"=== {cid}: {what}")
    print(f"    test: {test} -t '{pattern}'{'; on a database of its own, made empty for it' if needs_fresh else ''}")
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
        out, code = vitest(test, pattern, fresh() if needs_fresh else main_db)
    finally:
        for path, text in originals.items():
            open(os.path.join(builder, path), "w", encoding="utf-8").write(text)
        if needs_fresh:
            subprocess.run(["dropdb", "--if-exists", "-h", "/var/run/postgresql", fresh_db], check=True)
    shown = [l for l in out.splitlines() if re.search(r"^\s+(×|✓)|AssertionError|Error:|error:|Tests\s+\d", l)][:8]
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
