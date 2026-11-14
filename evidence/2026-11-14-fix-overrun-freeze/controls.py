"""Known gap 145 (14 Nov 2026): each safeguard of the fix removed in turn by an exact replacement in builder's source,
the test that guards it run alone, its verdict, then the source restored with git checkout and the tree checked
unchanged; at the end the tree is compared with HEAD. Each text to replace must occur exactly once in its file, or the
control is reported NOT APPLIED. Run from builder/ (in the style of evidence/2026-11-13-journey-j3/controls-scripts/):
  BUILDER_TEST_DATABASE_URL=... TMPDIR=... python3 ../evidence/2026-11-14-fix-overrun-freeze/controls.py <out file> [ids]
No container is started by these tests; no real provider is called."""
import subprocess, sys, datetime

T = "test/overrun-stop.test.ts"
APP = "src/gateway/app.ts"
HOLDS = "src/store/holds.ts"
CONTROLS = [
 ("FX145-C01", "the figures not looked at for an overrun while the stream is read (no stop at all)", APP,
  [("              if (above !== null) stopProject(above);\n", "")], T, "the delayed stream ending"),
 ("FX145-C02", "the stop not set in the gateway's memory when the figures are read (only written in the database)", APP,
  [("        mine.set(holdId, { holdId, holdUsd: holdAmountUsd, costUsd: usd });\n        readAbove.set(project.id, mine);\n", "")], T, "whose hold was opened before the stop was written"),
 ("FX145-C03", "the gateway's own check just before a metered call is forwarded removed", APP,
  [("    const aboveSince = readAboveHere(project.id);\n", "    const aboveSince = null as ReturnType<typeof readAboveHere>;\n")], T, "whose hold was opened before the stop was written"),
 ("FX145-C04", "the gateway's own check just before a counting call removed", APP,
  [("    const aboveBeforeCount = readAboveHere(project.id);\n", "    const aboveBeforeCount = null as ReturnType<typeof readAboveHere>;\n")], T, "the end marker waits for the stop's write"),
 ("FX145-C05", "the gateway's own check just before a passed-through request removed", APP,
  [("      const aboveBeforePassthrough = readAboveHere(project.id);\n", "      const aboveBeforePassthrough = null as ReturnType<typeof readAboveHere>;\n")], T, "the end marker waits for the stop's write"),
 ("FX145-C06", "the answer's bytes passed on without waiting for the stop's write (the end marker can go first)", APP,
  [("            if (stopping) await stopping;\n            ctrl.enqueue(value);", "            ctrl.enqueue(value);")], T, "the end marker waits for the stop's write"),
 ("FX145-C07", "the stop never written in the database (only in the gateway's memory)", HOLDS,
  [("    if (!cur || cur.state !== \"open\" || cur.read_above_hold_at !== null || cur.kept_reason !== null) return { marked: false, hold: cur ?? null };", "    if (true) return { marked: false, hold: cur ?? null };")], T, "the delayed stream ending"),
 ("FX145-C08", "the gateway's look at the stop in the database before the counting call removed", APP,
  [("    const aboveHold = await holdReadAbove(opts.pool, project.id);\n", "    const aboveHold = null as Awaited<ReturnType<typeof holdReadAbove>>;\n")], T, "the end marker waits for the stop's write"),
 ("FX145-C09", "the check of the stop under the project's lock removed (openHold)", HOLDS,
  [("    const above = await holdReadAboveIn(c, p.projectId);\n    if (above) {", "    const above = null as Hold | null;\n    if (above) {")], T, "concurrent calls"),
 ("FX145-C10", "a stop still applied after its call's ending was recorded (kept_reason not looked at)", HOLDS,
  [("state = 'open' and read_above_hold_at is not null and kept_reason is null order by id limit 1", "state = 'open' and read_above_hold_at is not null order by id limit 1")], T, "can no longer be trusted"),
 ("FX145-C11", "the stop left in the gateway's memory after its call's ending was recorded", APP,
  [("      m.delete(holdId);\n      if (m.size === 0) readAbove.delete(project.id);\n", "")], T, "can no longer be trusted"),
 ("FX145-C12", "the figures priced only at the lower rate (cache writes not split by lifetime at the five-minute rate)", APP,
  [("usageAsPriced(t.usage, t.itemised, oneHourPossible && !(fastHeld && !speedStated))", "usageAsPriced(t.usage, t.itemised, false)")], T, "only at the rate it is settled at"),
 ("FX145-C13", "the stop not carried over when its gateway is found gone (no freeze at the next gateway's start)", HOLDS,
  [("        if (cur.read_above_hold_usd !== null && cur.kept_reason === null) {", "        if (false) {")], T, "the stop outlives its gateway"),
]

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)

out = []
before = run(["git", "diff", "HEAD", "--stat", "--", "."]).stdout
head = run(["git", "rev-parse", "--short", "HEAD"]).stdout.strip()
out.append(f"Known gap 145 controls, {datetime.date.today()}, on HEAD {head} of builder/ (working tree as committed: `git diff HEAD -- .` empty before: {'yes' if before == '' else 'NO'}). Each safeguard removed in turn by exact replacement (each text occurring exactly once), the test that guards it run alone (npx vitest run {T} -t <name>), its verdict, then the file restored with git checkout and the tree checked unchanged.")
out.append("Columns: control | what was removed | verdict | vitest's summary lines | the first failure's reason | tree after restore")
only = sys.argv[2:]
for cid, label, path, reps, test, name in CONTROLS:
    if only and cid not in only:
        continue
    text = open(path).read()
    bad = [old for old, _ in reps if text.count(old) != 1]
    if bad:
        out.append(f"{cid} | {label} | NOT APPLIED (a text to replace occurs {text.count(bad[0])} times, not once) | |")
        print(out[-1], flush=True)
        continue
    for old, new in reps:
        text = text.replace(old, new, 1)
    open(path, "w").write(text)
    r = run(["npx", "vitest", "run", test, "-t", name])
    run(["git", "checkout", "--", path])
    restored = run(["git", "diff", "HEAD", "--stat", "--", "."]).stdout == ""
    summary = " | ".join(l.strip() for l in (r.stdout + r.stderr).splitlines() if l.strip().startswith(("Test Files", "Tests ")))
    verdict = "FAILED, as it should with the safeguard removed" if r.returncode != 0 and "failed" in summary else ("PASSED: the test does not see this safeguard's removal" if r.returncode == 0 else f"ERROR (exit {r.returncode})")
    # The test's own failure, not the noise a failed test can leave when its open streams are closed at the end of the
    # file ("TypeError: terminated", printed by the test's web server).
    lines = [l.strip() for l in (r.stdout + r.stderr).splitlines()]
    why = next((l for l in lines if l.startswith(("AssertionError", "Error:"))), "") or next((l for l in lines if l.startswith("TypeError") and "terminated" not in l), "")
    out.append(f"{cid} | {label} | {verdict} | {summary} | first failure: {why[:220]} | {'restored' if restored else 'NOT RESTORED'}")
    print(out[-1], flush=True)
after = run(["git", "diff", "HEAD", "--stat", "--", "."]).stdout
out.append(f"After every control: `git diff HEAD -- .` empty: {'yes' if after == '' else 'NO: ' + after}")
open(sys.argv[1], "w").write("\n".join(out) + "\n")
