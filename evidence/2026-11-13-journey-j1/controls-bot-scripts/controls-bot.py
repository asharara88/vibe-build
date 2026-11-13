"""J1 after the review bot on defb9c4: remove each part of the two fixes in turn (exact replacements) on a copy of the
code at 0f9563d, run the tests that guard it, expect every one of them to fail, restore. Stand-in sandboxes and a
made-up docker program only: no container, no model."""
import os, re, subprocess, sys
S = "/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad"
B = f"{S}/botj1-ctl/ctl-copy/builder"
ENV = dict(os.environ, TMPDIR=f"{S}/botj1-tmp", BUILDER_BROWSER_CACHE=f"{S}/p31-cache",
           BUILDER_TEST_DATABASE_URL="postgres:///builder_test_botj1?host=/var/run/postgresql", NO_COLOR="1", FORCE_COLOR="0")
for k in ("BUILDER_DATA_DIR", "BUILDER_MODEL_API_KEY", "BUILDER_UI_PASSWORD", "BUILDER_DATABASE_URL"):
    ENV.pop(k, None)
MAIN, APP, JOURNEY, JOBS, ADAPTER, PAGES = "src/web/main.ts", "src/web/app.ts", "src/orchestrator/journey.ts", "src/orchestrator/journey-jobs.ts", "src/orchestrator/example-1-adapter.ts", "src/web/pages.ts"
WEB, JT = "test/web.test.ts", "test/journey.test.ts"
# The guarding tests, by a part of their names with no regular-expression characters in it, and their files.
T = {
    "IN": (WEB, "a job is running when PostgreSQL ends the lock"),
    "CHECK": (WEB, "before any job starts, the lock is asked of the database"),
    "STOP": (WEB, "what the interface does once its lock is lost"),
    "REAL": (WEB, "the real interface"),
    "RETRY": (JT, "a preview that failed part-way can be tried again"),
    "ENGINE": (JT, "halted while a step"),
    "CAMERA": (JT, "given a signal that is then aborted"),
}
C = [
 ("J1-C92", "the lock's connection: its error and end no longer tracked (as at defb9c4)",
  [(MAIN, '  c.on("error", lose);\n  c.on("end", lose);\n', '  c.on("error", () => undefined);\n')], ["IN", "REAL"]),
 ("J1-C93", "no 503 once the lock is lost (the interface's guard removed)",
  [(APP, "    if (why !== null) return c.text(why, 503);\n", "")], ["IN"]),
 ("J1-C94", "the halt does not tell the running job to stop (its signal never aborted)",
  [(JOURNEY, "    r.abort.abort(this.haltedWhy);\n", "")], ["IN", "STOP", "ENGINE"]),
 ("J1-C95", "no check of the lock before a job starts",
  [(JOURNEY, "      const notOwned = (await this.o.ownership?.()) ?? null;\n", "      const notOwned: string | null = null;\n")], ["CHECK"]),
 ("J1-C96", "a halted step's engine container not killed",
  [(JOBS, '            signal.addEventListener("abort", () => void engine.stop(), { once: true });\n', "")], ["ENGINE"]),
 ("J1-C97", "the app camera's container not killed when its signal is aborted (the adapter)",
  [(ADAPTER, '      if (a.signal?.aborted) kill();\n      else a.signal?.addEventListener("abort", kill, { once: true });\n', "")], ["CAMERA"]),
 ("J1-C98", "a halted preview stops its app all the same (changes the sandbox after the loss)",
  [(JOBS, "        if (signal.aborted) throw err;\n", "")], ["IN"]),
 ("J1-C99", "a halted step puts its workspace back all the same (changes the sandbox after the loss)",
  [(JOBS, "          // Halted: the workspace is not touched; the next start removes the sandbox.\n          stillOwned(signal);\n", "")], ["ENGINE"]),
 ("J1-C100", "a halted job recorded failed, not interrupted",
  [(JOURNEY, "          if (abort.signal.aborted) {\n", "          if (false as boolean) {\n")], ["ENGINE", "STOP"]),
 ("J1-C101", "actions not refused once halted (the guard on each project's actions removed)",
  [(JOURNEY, "    const guarded = (): Promise<T> => (this.haltedWhy !== null ? Promise.reject(new JourneyRefused(this.haltedWhy)) : fn());\n",
             "    const guarded = (): Promise<T> => fn();\n")], ["ENGINE"]),
 ("J1-C102", "a lock released on purpose reported as lost",
  [(MAIN, "    release: async () => {\n      released = true;\n", "    release: async () => {\n")], ["CHECK"]),
 ("J1-C103", "the real interface does not stop once serving (its handler for the loss does nothing)",
  [(MAIN, "  onLockLost = (why) =>\n    void stopAfterLockLost(why, {", "  onLockLost = (why) =>\n    void ((..._: unknown[]) => undefined)(why, {")], ["REAL"]),
 ("J1-C104", "the screenshots copied into the project's shared shots folder again (no folder per attempt; as at defb9c4)",
  [(JOBS, "      const shotsDir = join(shotsRoot, attempt.jobId);\n      mkdirSync(shotsDir, { mode: 0o700 });\n", "      const shotsDir = shotsRoot;\n")], ["RETRY"]),
 ("J1-C105", "the preview screen shows every attempt's screenshots, not the latest job's",
  [(PAGES, '  const shots = lastPreview ? s.events.filter((e) => e.kind === EV.screenshot && BigInt(e.id) > BigInt(lastPreview.startedEventId)) : [];\n',
           '  const shots = lastPreview ? s.events.filter((e) => e.kind === EV.screenshot) : [];\n')], ["RETRY"]),
]

def run_tests(keys):
    files = sorted({T[k][0] for k in keys})
    pattern = "|".join(T[k][1] for k in keys)
    p = subprocess.run(["npx", "vitest", "run", *files, "-t", pattern, "--reporter=verbose"], cwd=B, env=ENV, capture_output=True, text=True, timeout=900)
    out = p.stdout + p.stderr
    res = {}
    for k in keys:
        name = T[k][1]
        lines = [l for l in out.splitlines() if name in l and (l.lstrip().startswith("✓") or l.lstrip().startswith("×"))]
        res[k] = "passed" if lines and all(l.lstrip().startswith("✓") for l in lines) else ("FAILED" if lines else "not run")
        if res[k] == "FAILED":
            # The first line of the reason vitest gives.
            m = re.search(re.escape(name) + r"[^\n]*\n(?:[^\n]*\n)??((?:AssertionError|Error|TypeError)[^\n]*)", out)
            if m:
                res[k] += f" ({m.group(1)[:300]})"
    return res, p.returncode

only = sys.argv[1:]
if not only or "baseline" in only:
    res, code = run_tests(list(T))
    print(f"Baseline (the copy unchanged): {', '.join(f'{k} {v}' for k, v in res.items())}; vitest exit code {code}")
all_ok = True
for cid, what, patches, keys in C:
    if only and cid not in only:
        continue
    saved = {}
    applied = True
    for f, old, new in patches:
        path = os.path.join(B, f)
        cur = open(path, encoding="utf-8").read()
        saved.setdefault(path, cur)
        if cur.count(old) != 1:
            applied = False
            print(f"{cid}: PATCH NOT APPLIED ({f}: found {cur.count(old)} times)")
            break
        open(path, "w", encoding="utf-8").write(cur.replace(old, new))
    try:
        if applied:
            res, code = run_tests(keys)
            ok = all(v.startswith("FAILED") for v in res.values())
            all_ok &= ok
            print(f"{cid} ({what}): {'as expected, every guarding test failed' if ok else 'NOT AS EXPECTED'}; vitest exit code {code}")
            for k, v in res.items():
                print(f"    {k}: {v}")
        else:
            all_ok = False
    finally:
        for path, text in saved.items():
            open(path, "w", encoding="utf-8").write(text)
print("All controls as expected." if all_ok else "SOME CONTROL NOT AS EXPECTED.")
