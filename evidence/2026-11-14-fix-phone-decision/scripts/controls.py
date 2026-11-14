"""The phone test's decision after the review of 14787d8: controls. Each safeguard removed in turn (an exact
replacement in builder/scripts/probe-phone.ts, each text occurring exactly once), the test that guards it run alone,
its verdict, then the file restored with git checkout and the tree compared with HEAD at the end. Run from builder/:
  TMPDIR=... python3 ../evidence/2026-11-14-fix-phone-decision/scripts/controls.py <out file> [control ids]
No container, database or port is used by these tests: the pages are not served."""
import subprocess, sys, datetime

F = "scripts/probe-phone.ts"
T = "test/probe-phone.test.ts"
CONTROLS = [
 ("PF-C01", "GO ON with mandatory items missing (the completeness rule removed: the review's finding)",
  [("  else if (missing.length) decision = `not decided: missing ${missing.join(\"; \")}`;\n", "")], "both pages opened and nothing else is not decided"),
 ("PF-C02", "(i) a page's form to itself not required (its one Host enough)",
  [("      hosts.length === 1 && origin !== undefined,\n", "      hosts.length === 1,\n")], "without probe-b's step 1"),
 ("PF-C03", "(i) the Origin of the form to itself not required (none, or null, accepted)",
  [("    const origin = posts.map((l) => l.kept.origin ?? \"\").find((o) => o !== \"\" && o !== \"null\");\n", "    const origin = posts.map((l) => l.kept.origin ?? \"(none)\")[0];\n")], "without an Origin other than null on probe-b"),
 ("PF-C04", "(i) one address per page not required (a second Host accepted)",
  [("      hosts.length === 1 && origin !== undefined,\n", "      hosts.length >= 1 && origin !== undefined,\n")], "without one address for probe-a"),
 ("PF-C05", "(ii) the link and the form between the pages not required",
  [("        site !== undefined,\n", "        true,\n")], "without probe-a's step 3"),
 ("PF-C06", "(ii) the Sec-Fetch-Site of a request between the pages not required (the request alone enough)",
  [("      const site = seen.map((l) => l.kept[\"sec-fetch-site\"] ?? \"\").find((s) => SITES.includes(s));\n", "      const site = seen.map((l) => l.kept[\"sec-fetch-site\"] ?? \"(none)\")[0];\n")], "without the Sec-Fetch-Site of probe-b's form"),
 ("PF-C07", "(ii) one direction only (probe-b's link and form to probe-a not required)",
  [("  for (const p of [\"a\", \"b\"] as const) {\n    const q = p === \"a\" ? \"b\" : \"a\";\n", "  for (const p of [\"a\"] as const) {\n    const q = p === \"a\" ? \"b\" : \"a\";\n")], "without probe-b's step 3"),
 ("PF-C08", "(iii) a page's step 2 not required",
  [("    item(`(iii) probe-${p}`, again.length > 0,", "    item(`(iii) probe-${p}`, true,")], "without probe-a's step 2"),
 ("PF-C09", "(iv) the Sec-Fetch-Dest of step 2 not required",
  [("    item(`(iv) probe-${p}`, dest !== undefined,", "    item(`(iv) probe-${p}`, again.length > 0,")], "without the Sec-Fetch-Dest of probe-b's step 2"),
 ("PF-C10", "(vi) the owner's answer on step 5 not required when no request reached 4034",
  [("    cAnswered || (cOffered && answers.port4034 === \"did-not-open\"),\n", "    cAnswered || cOffered,\n")], "without the owner's answer on step 5"),
 ("PF-C11", "(vi) an answer the log contradicts accepted (it answered, yet no request reached 4034)",
  [("    cAnswered || (cOffered && answers.port4034 === \"did-not-open\"),\n", "    cAnswered || (cOffered && answers.port4034 !== undefined),\n")], "an answer on step 5 that the log contradicts"),
 ("PF-C12", "(vi) step 5 counted as done although it could not be offered (no 4032 in probe-a's address)",
  [("    cAnswered || (cOffered && answers.port4034 === \"did-not-open\"),\n", "    cAnswered || answers.port4034 === \"did-not-open\",\n")], "pages whose address does not show their port"),
 ("PF-C13", "(vii) the cached page reaching the probe once taken as done, with no answer",
  [("    counters.length >= 2 || cacheSeen,\n", "    counters.length >= 1 || cacheSeen,\n")], "the cached page's second open reaching the probe"),
 ("PF-C14", "(vii) an answer the log contradicts accepted (the number changed, yet one request reached the probe)",
  [("    counters.length >= 2 || cacheSeen,\n", "    counters.length >= 2 || cacheSeen || answers.cachedNumber === \"changed\",\n")], "an answer on the cached number that the log contradicts"),
 ("PF-C15", "(vii) the cache on the way read by the old rule again (two requests with the same number), which cannot happen",
  [("  const cacheSeen = answers.cachedNumber === \"same\" && counters.length >= 1;\n", "  const cacheSeen = counters.length >= 2 && new Set(counters).size < counters.length;\n")], "a cache on the way: the cached page reached the probe once"),
 ("PF-C16", "(viii) the User-Agent not required",
  [("  item(\"(viii)\", uaOn(\"a\") && uaOn(\"b\"),", "  item(\"(viii)\", true,")], "without the User-Agent on probe-b"),
 ("PF-C17", "(ix) the owner's answer on the signed-out window not required",
  [("  item(\"(ix)\", answers.signedOut !== undefined,", "  item(\"(ix)\", true,")], "without the owner's answer on the signed-out window"),
 ("PF-C18", "(ix) a page that opened when signed out not reported (gaps 153 and 157)",
  [("  if (answers.signedOut === \"opened\") decision +=", "  if (false) decision +=")], "probe-a opened when signed out"),
 ("PF-C19", "STOP on the same Origin of both pages' forms to themselves removed",
  [("  else if (selfOrigin.a !== undefined && selfOrigin.a === selfOrigin.b) decision =", "  else if (false) decision =")], "the same Origin on both pages' forms"),
 ("PF-C20", "STOP on Sec-Fetch-Site same-origin from the other page removed",
  [("  else if (sameOriginCross) decision =", "  else if (false && sameOriginCross) decision =")], "Sec-Fetch-Site same-origin on a request from the other page"),
 ("PF-C21", "the Lax rule back to any page's Lax cookie, not each page's own",
  [("    const own = (kind: string) => again.some((l) => l.cookie_names.includes(`probe_${p}_${kind}`));\n", "    const own = (kind: string) => again.some((l) => l.cookie_names.some((n) => n.endsWith(`_${kind}`)));\n")], "own Lax cookie not back on its step 2"),
 ("PF-C22", "the command does not pass the owner's answers to the decision",
  [("    const r = decide(lines, answers);\n", "    const r = decide(lines);\n")], "a whole run with the owner's answers: every item done"),
 ("PF-C23", "the command takes an answer that is not one of its words",
  [("    if (v !== undefined && !(words as readonly string[]).includes(v)) throw", "    if (false) throw")], "an answer that is not one of its words"),
]

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)

out = []
before = run(["git", "diff", "HEAD", "--stat", "--", "."]).stdout
head = run(["git", "rev-parse", "--short", "HEAD"]).stdout.strip()
out.append(f"Phone-test decision controls, {datetime.date.today()}, on HEAD {head} of builder/ (working tree as committed: `git diff HEAD -- .` empty before: {'yes' if before == '' else 'NO'}). Each safeguard removed in turn by exact replacement in {F} (each text found exactly once, checked), the test that guards it run alone (npx vitest run {T} -t <name>), its verdict, then the file restored with git checkout.")
out.append("Columns: control | what was removed | verdict | vitest's summary lines")
only = sys.argv[2:]
for cid, label, reps, name in CONTROLS:
    if only and cid not in only:
        continue
    text = open(F).read()
    ok = True
    for old, new in reps:
        if text.count(old) != 1:
            ok = False
            out.append(f"{cid} | {label} | NOT APPLIED (the text to replace occurs {text.count(old)} times, not once) |")
            break
        text = text.replace(old, new, 1)
    if not ok:
        print(out[-1], flush=True)
        continue
    open(F, "w").write(text)
    r = run(["npx", "vitest", "run", T, "-t", name])
    run(["git", "checkout", "--", F])
    summary = " | ".join(l.strip() for l in (r.stdout + r.stderr).splitlines() if l.strip().startswith(("Test Files", "Tests ")))
    verdict = "FAILED, as it should with the safeguard removed" if r.returncode != 0 and "failed" in summary else ("PASSED: the test does not see this safeguard's removal" if r.returncode == 0 else f"ERROR (exit {r.returncode})")
    out.append(f"{cid} | {label} | {verdict} | {summary}")
    print(out[-1], flush=True)
after = run(["git", "diff", "HEAD", "--stat", "--", "."]).stdout
out.append(f"After every control: `git diff HEAD -- .` empty: {'yes' if after == '' else 'NO: ' + after}")
open(sys.argv[1], "w").write("\n".join(out) + "\n")
