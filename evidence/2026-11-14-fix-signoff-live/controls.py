"""Sign-off and the live app (after the review of 14787d8, known gap 161): controls. Each safeguard removed in turn by an
exact replacement in builder's source (each text to replace must occur exactly once in its file, or the control is not
applied), the test that guards it run alone (npx vitest run <file> -t <name>), its verdict, then the files restored with
git checkout and the tree compared with HEAD; at the end, the tree is compared with HEAD once more. In the style of
evidence/2026-11-13-journey-j3/controls-scripts/controls.py. Run from builder/:
  BUILDER_TEST_DATABASE_URL=... TMPDIR=... python3 ../evidence/2026-11-14-fix-signoff-live/controls.py <out file> [ids]
No container is started by these tests (stand-in sandbox, the real preview front)."""
import subprocess, sys, datetime

WEB = "test/web.test.ts"
CONTROLS = [
 ("SO-C01", "the live job's rule no longer refuses a signed-off project (the screen then offers the open button, and a POST opens)", "src/orchestrator/journey.ts",
  [("      : s.signedOff\n        ? LIVE_AFTER_SIGN_OFF\n", "      : false\n        ? LIVE_AFTER_SIGN_OFF\n")], WEB, "signed off, Open the live app is refused"),
 ("SO-C02", "the same rule removed, against the open asked for while the sign-off is being recorded", "src/orchestrator/journey.ts",
  [("      : s.signedOff\n        ? LIVE_AFTER_SIGN_OFF\n", "      : false\n        ? LIVE_AFTER_SIGN_OFF\n")], WEB, "Open the live app asked for while the sign-off is being recorded"),
 ("SO-C03", "the sign-off no longer ends the project's live session before it is recorded (the call removed)", "src/orchestrator/journey.ts",
  [("      await this.liveEnd?.(projectId, LIVE_CLOSED_BY_SIGN_OFF);\n", "")], WEB, "a live session open when sign-off is asked, its pass shown and not used"),
 ("SO-C04", "the journey is not given the way to end a live session (the hook not attached with the preview)", "src/orchestrator/journey-jobs.ts",
  [("    this.j.attachLiveEnd((projectId, reason) => p.closeFor(projectId, reason));\n", "")], WEB, "a live session entered at the front when sign-off is asked"),
 ("SO-C05", "the sign-off recorded first and the live session ended after it (the order swapped)", "src/orchestrator/journey.ts",
  [("      await this.liveEnd?.(projectId, LIVE_CLOSED_BY_SIGN_OFF);\n      await appendEvent(this.pool, projectId, EV.signedOff, {\n", "      await appendEvent(this.pool, projectId, EV.signedOff, {\n"),
   ("        acceptance_label: JOURNEY_STAND_IN_LABEL,\n      });\n    });\n", "        acceptance_label: JOURNEY_STAND_IN_LABEL,\n      });\n      await this.liveEnd?.(projectId, LIVE_CLOSED_BY_SIGN_OFF);\n    });\n")], WEB, "a sign-off asked for while Open the live app is in flight"),
 ("SO-C06", "closeFor does not wait for a close of the project already under way", "src/web/preview.ts",
  [("    await Promise.all([...this.closing].filter((x) => x.projectId === projectId).map((x) => x.done));\n", "")], WEB, "is still being recorded when sign-off is asked"),
 ("SO-C07", "a close under way not registered (closeFor cannot see it)", "src/web/preview.ts",
  [("    this.closing.add(under);\n", "")], WEB, "is still being recorded when sign-off is asked"),
 ("SO-C08", "the sign-off not refused while a job of the project runs (both checks: the process's running job and the record's)", "src/orchestrator/journey.ts",
  [('      if (this.running?.projectId === projectId) throw new JourneyRefused("A job is running for this project; wait for it to end.");\n      const why = signOffRefusal(s);\n', "      const why = signOffRefusal(s);\n"),
   ('  if (s.signedOff) return "This project is already signed off.";\n  if (s.runningJob) return "A job of this project is running; wait for it to end.";\n', '  if (s.signedOff) return "This project is already signed off.";\n')], WEB, "a sign-off asked for while Open the live app is in flight"),
]

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)

def clean():
    return run(["git", "diff", "HEAD", "--stat", "--", "."]).stdout == ""

out = []
head = run(["git", "rev-parse", "--short", "HEAD"]).stdout.strip()
tree = run(["git", "rev-parse", "--short", "HEAD:builder"]).stdout.strip()
out.append(f"Sign-off and the live app, controls, {datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}, on HEAD {head} (builder/ tree {tree}); `git diff HEAD -- .` empty before: {'yes' if clean() else 'NO'}. Each safeguard removed in turn by exact replacement (each text to replace occurs exactly once in its file), the test that guards it run alone (npx vitest run <file> -t <name>), its verdict, then the file restored with git checkout and the tree compared with HEAD.")
out.append("Columns: control | what was removed | file(s) | test | verdict | vitest's summary lines | tree equal to HEAD after restoring")
only = sys.argv[2:]
for cid, label, path, reps, test, name in CONTROLS:
    if only and cid not in only:
        continue
    paths = path if isinstance(path, list) else [path] * len(reps)
    texts = {p: open(p).read() for p in set(paths)}
    problem = None
    for p, (old, new) in zip(paths, reps):
        n = texts[p].count(old)
        if n != 1:
            problem = f"the text to replace occurs {n} times in {p}, not once"
            break
        texts[p] = texts[p].replace(old, new, 1)
    if problem:
        out.append(f"{cid} | {label} | {', '.join(sorted(set(paths)))} | {name} | NOT APPLIED ({problem}) | | {'yes' if clean() else 'NO'}")
        print(out[-1], flush=True)
        continue
    for p, t in texts.items():
        open(p, "w").write(t)
    r = run(["npx", "vitest", "run", test, "-t", name])
    run(["git", "checkout", "--", *texts.keys()])
    summary = " | ".join(l.strip() for l in (r.stdout + r.stderr).splitlines() if l.strip().startswith(("Test Files", "Tests ")))
    verdict = "FAILED, as it should with the safeguard removed" if r.returncode != 0 and "failed" in summary else ("PASSED: the test does not see this safeguard's removal" if r.returncode == 0 else f"ERROR (exit {r.returncode})")
    out.append(f"{cid} | {label} | {', '.join(sorted(set(paths)))} | {name} | {verdict} | {summary} | {'yes' if clean() else 'NO'}")
    print(out[-1], flush=True)
out.append(f"After every control: `git diff HEAD -- .` empty (the tree equal to HEAD {head}): {'yes' if clean() else 'NO: ' + run(['git', 'diff', 'HEAD', '--stat', '--', '.']).stdout}")
open(sys.argv[1], "w").write("\n".join(out) + "\n")
