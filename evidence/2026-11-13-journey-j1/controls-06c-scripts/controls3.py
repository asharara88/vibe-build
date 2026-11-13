"""J1 after the review: remove one safeguard (exact replacements), run the test that guards it, expect it to fail, restore."""
import os, subprocess, sys
B = "/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad/j1-06c/ctl-copy/builder"
ENV = dict(os.environ, TMPDIR="/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad/j1-06c-tmp",
           BUILDER_TEST_DATABASE_URL="postgres:///builder_test_j106cctl?host=/var/run/postgresql", NO_COLOR="1")
for k in ("BUILDER_DATA_DIR", "BUILDER_MODEL_API_KEY", "BUILDER_UI_PASSWORD"):
    ENV.pop(k, None)
A = "src/web/app.ts"
J = "src/orchestrator/journey.ts"
E = "src/orchestrator/export.ts"
P = "src/web/pages.ts"
C = [
 ("J1-C49", "the lock-out read before the request's body, as before the review (blocking item 1)", [
   (A, '''    const body = await c.req.parseBody();
    const password = typeof body.password === "string" ? body.password : "";
    // The lock-out is read only now''', '''    const locked0 = d.limiter.lockedFor();
    if (locked0 > 0) return c.html(signInPage(lang, { message: "locked", lockedSeconds: Math.ceil(locked0 / 1000) }), 429);
    const body = await c.req.parseBody();
    const password = typeof body.password === "string" ? body.password : "";
    // The lock-out is read only now'''),
   (A, '''    const locked = d.limiter.lockedFor();
    if (locked > 0) return c.html(signInPage(lang, { message: "locked", lockedSeconds: Math.ceil(locked / 1000) }), 429);
    if (!d.password.check(password)) {''', '''    if (!d.password.check(password)) {''')],
  "test/web.test.ts", "the lock-out holds for attempts that arrive at the same moment"),
 ("J1-C50", "bodies that are not forms let through to csrf() and the routes (note 1)", [
   (A, '''    if (c.req.method !== "GET" && c.req.method !== "HEAD" && !FORM_CONTENT_TYPE.test(c.req.header("content-type") ?? "")) return c.text("Only a form from this site is accepted.", 415);
''', "")],
  "test/web.test.ts", "a POST whose body is not a form is refused"),
 ("J1-C51", "step ids not isolated left to right (note 7)", [
   (P, '''export const stepId = (step: string): Html => html`<bdi dir="ltr">${step}</bdi>`;''', '''export const stepId = (step: string): Html => html`${step}`;''')],
  "test/web.test.ts", "step ids such as 01-data are isolated"),
 ("J1-C52", "sign-off judged on the last checklist job that finished, ignoring a later one that failed (note 4)", [
   (J, '''          else if (j.kind === "acceptance") s.acceptanceRun = { jobId: j.jobId, runId: null, summary: null, refused: j.reason ?? `The checklist job was ${j.state}.`, outcome: null };
''', "")],
  "test/journey.test.ts", "sign-off is judged on the last checklist job"),
 ("J1-C53", "the export's checks read the last commit only, as before the review (note 5)", [
   (E, '''  const tracked = [...new Set((await git(i.repo, ["log", "--all", "--root", "-m", "--no-renames", "--format=", "--name-only"])).split("\\n").filter(Boolean))].sort();''',
       '''  const tracked = (await git(i.repo, ["ls-tree", "-r", "--name-only", "HEAD"])).split("\\n").filter(Boolean);''')],
  "test/journey.test.ts", "the export is refused when any commit of the history held"),
 ("J1-C54", "the export cloned locally, copying objects no commit reaches (note 5)", [
   (E, '''["clone", "--quiet", "--no-local", "--no-hardlinks", "--", i.repo.gitDir, top]''', '''["clone", "--quiet", "--no-hardlinks", "--", i.repo.gitDir, top]''')],
  "test/journey.test.ts", "the exported copy holds only what the history reaches"),
 ("J1-C55", "an interrupted step's reservation left open at start (note 3)", [
   (J, '''        if (h.state !== "open" || !steps.has(h.step_id)) continue;''', '''        if (h.state !== "open" || !steps.has(h.step_id) || h) continue;''')],
  "test/journey.test.ts", "at start, the reservation of a step whose job was interrupted"),
 ("J1-C56", "a failed checklist job not shown on the checklist screen (note 4)", [
   (P, '''${lastJob?.state === "failed" || lastJob?.state === "interrupted" ? html`<p class="warn" lang="en" dir="ltr" data-job-failed>${lastJob.reason ?? ""}</p>` : ""}
''', "")],
  "test/web.test.ts", "a checklist job that failed after its run is shown as failed"),
]
only = sys.argv[1:]
results = []
for cid, what, patches, test, name in C:
    if only and cid not in only:
        continue
    saved = {}
    ok = True
    for f, old, new in patches:
        path = os.path.join(B, f)
        if path not in saved:
            saved[path] = open(path, encoding="utf-8").read()
        cur = open(path, encoding="utf-8").read()
        n = cur.count(old)
        if n != 1:
            results.append((cid, what, f"PATCH NOT APPLIED ({f}: found {n} times)", ""))
            ok = False
            break
        open(path, "w", encoding="utf-8").write(cur.replace(old, new))
    try:
        if ok:
            r = subprocess.run(["npx", "vitest", "run", test, "-t", name], cwd=B, env=ENV, capture_output=True, text=True, timeout=600)
            out = r.stdout + r.stderr
            tail = [l for l in out.splitlines() if "Tests " in l or "Test Files" in l]
            verdict = "FAILED, as it should with the safeguard removed" if r.returncode != 0 and " failed" in out else ("PASSED: the test did not catch it" if r.returncode == 0 else f"ERROR exit {r.returncode}")
            results.append((cid, what, verdict, " | ".join(x.strip() for x in tail)))
    finally:
        for path, src in saved.items():
            open(path, "w", encoding="utf-8").write(src)
for cid, what, v, tail in results:
    print(f"{cid} | {what} | {v} | {tail}")
