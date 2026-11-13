"""J1 part 1 controls: remove one safeguard, run the test that guards it, expect it to fail, restore."""
import json, os, subprocess, sys
B = "/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad/j1-06c/ctl-copy/builder"
ENV = dict(os.environ, TMPDIR="/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad/j1-06c-tmp",
           BUILDER_TEST_DATABASE_URL="postgres:///builder_test_j106cctl?host=/var/run/postgresql")
C = [
 ("J1-C1", "the sign-in guard removed", "src/web/app.ts",
  '    if (c.get("signedIn")) return next();\n    return c.redirect("/sign-in", 303);', '    return next();',
  "test/web.test.ts", "every route without a session"),
 ("J1-C2", "csrf() removed", "src/web/app.ts", '  app.use("*", csrf());\n', '',
  "test/web.test.ts", "a cross-origin POST is refused"),
 ("J1-C3", "the content-security-policy removed", "src/web/app.ts",
  'secureHeaders({ contentSecurityPolicy: CONTENT_SECURITY_POLICY })', 'secureHeaders()',
  "test/web.test.ts", "every page has the content-security-policy"),
 ("J1-C4", "the brief shown without escaping (hono's raw)", "src/web/pages.ts",
  '<pre data-brief>${s.brief ?? ""}</pre>', '<pre data-brief>${raw(s.brief ?? "")}</pre>',
  "test/web.test.ts", "the brief is escaped on display"),
 ("J1-C5", "the lock-out check before a sign-in removed", "src/web/app.ts",
  '    if (locked > 0) return c.html(signInPage(lang, { message: "locked", lockedSeconds: Math.ceil(locked / 1000) }), 429);\n', '',
  "test/web.test.ts", "lock-out for the whole server"),
 ("J1-C6", "files: the inside-the-folder check removed", "src/web/files.ts",
  '  if (real === folder || !insideOrEqual(real, folder)) return no;\n', '',
  "test/web.test.ts", "serves only a file an event names"),
 ("J1-C7", "files: the SHA-256 check removed", "src/web/files.ts",
  '    if (sha256(body) !== named.sha256) return no;\n', '',
  "test/web.test.ts", "serves only a file an event names"),
 ("J1-C8", "start check: the database setting not required", "src/web/main.ts",
  '    if (!databaseUrl) throw new Error(', '    if (false as boolean) throw new Error(',
  "test/web.test.ts", "start is refused without each setting"),
 ("J1-C9", "the environment not scrubbed at start", "src/web/main.ts",
  '    for (const k of SCRUBBED) delete env[k];', '    void SCRUBBED;',
  "test/web.test.ts", "taken out of the environment at start"),
 ("J1-C10", "the instance lock not checked", "src/web/main.ts",
  '  if (!r.rows[0]!.got) {', '  if (false as boolean) {',
  "test/web.test.ts", "one interface per database"),
 ("J1-C11", "the first-run digest file written readable by others", "src/web/auth.ts",
  'constants.O_NOFOLLOW, 0o600);', 'constants.O_NOFOLLOW, 0o644);',
  "test/web.test.ts", "first run: the first visitor"),
 ("J1-C12", "a GET that writes an event (the record page)", "src/web/app.ts",
  '  app.get("/projects/:id/record", async (c) => c.html(recordPage(c.get("lang"), await j.state(c.req.param("id")))));',
  '  app.get("/projects/:id/record", async (c) => (await j.pool.query("insert into events(project_id, kind, payload) values ($1, \'control.write\', \'{}\')", [c.req.param("id")]), c.html(recordPage(c.get("lang"), await j.state(c.req.param("id"))))));',
  "test/web.test.ts", "no GET changes anything"),
 ("J1-C13", "a build allowed before both confirmations", "src/orchestrator/journey.ts",
  '  build_step: (s) => (!s.briefConfirmed ?', '  build_step: (s) => null && (!s.briefConfirmed ?',
  "test/journey.test.ts", "a build step is refused at every stage"),
 ("J1-C14", "an export allowed before sign-off", "src/orchestrator/journey.ts",
  '  export: (s) => (s.signedOff ? null', '  export: (s) => (true ? null',
  "test/journey.test.ts", "export is refused before sign-off"),
 ("J1-C15", "the engine wrapper does not wait for the event queue", "src/orchestrator/journey.ts",
  '      } finally {\n        await queue.settled();\n      }', '      } finally {\n        void queue;\n      }',
  "test/journey.test.ts", "step.hold_closed follows the last"),
 ("J1-C16", "recovery looks at every project, not only j1- ones", "src/orchestrator/journey.ts",
  '    for (const r of await listProjects(this.pool, { idPrefix: JOURNEY_PREFIX })) {\n      if (!r.id.startsWith(JOURNEY_PREFIX)) continue;',
  '    for (const r of await listProjects(this.pool)) {',
  "test/journey.test.ts", "recovery at start touches journey projects only"),
 ("J1-C17", "one job at a time not enforced", "src/orchestrator/journey.ts",
  '      if (this.running) throw new JourneyRefused("Another job is running. One job runs at a time.");\n', '',
  "test/journey.test.ts", "one job at a time"),
 ("J1-C25", "the job slot taken only after the started event is written (the race found on re-reading)", "src/orchestrator/journey.ts",
  "      this.running = slot;\n      try {\n        await appendEvent(this.pool, projectId, EV.jobStarted, { job_id: jobId, kind, step: o.step ?? null }, o.step ?? null);\n      } catch (err) {",
  "      try {\n        await appendEvent(this.pool, projectId, EV.jobStarted, { job_id: jobId, kind, step: o.step ?? null }, o.step ?? null);\n        this.running = slot;\n      } catch (err) {",
  "test/journey.test.ts", "exactly one starts"),
 ("J1-C18", "the journey imports the gateway's journal", "src/orchestrator/journey.ts",
  'import type pg from "pg";\n',
  'import type pg from "pg";\nimport "../gateway/journal.js";\n',
  "test/journey.test.ts", "neither the interface nor the journey imports"),
 ("J1-C19", "another engine named in the journey", "src/orchestrator/journey.ts",
  'export function scriptedEngineFor(', 'export const _other = (): unknown => new StandInEngine();\nexport function scriptedEngineFor(',
  "test/journey.test.ts", "the only engine the journey makes"),
 ("J1-C20", "an intake option changed from B2's words", "src/orchestrator/intake/example-1.json",
  '"options": ["Email or chat threads", "A spreadsheet",', '"options": ["Email or chat", "A spreadsheet",',
  "test/intake.test.ts", "shows B2's options word for word"),
 ("J1-C21", "four questions in one turn", "src/orchestrator/intake/example-1.json",
  '    ["q15", "q16", "q17"],\n    ["q18"],', '    ["q15", "q16", "q17", "q18"],',
  "test/intake.test.ts", "at most three questions per turn"),
 ("J1-C22", "an R reason not B2's", "src/orchestrator/intake/example-1.json",
  '"reason": "satisfies rule 6",', '"reason": "most customers choose it",',
  "test/intake.test.ts", "marks R exactly where B2 does"),
 ("J1-C23", "a message missing from Arabic", "src/web/messages/ar.json",
  '  "cost.no_freeze": "لا يوجد تجميد.",\n', '',
  "test/web.test.ts", "English and Arabic have the same keys"),
 ("J1-C24", "the journey-id check on project routes removed", "src/web/app.ts",
  '    if (!isJourneyId(c.req.param("id") ?? "")) return c.html(notFoundPage(c.get("lang"), true), 404);\n', '',
  "test/web.test.ts", "a project id not made by the journey is not found"),
]
only = sys.argv[1:]
results = []
for cid, what, f, old, new, test, name in C:
    if only and cid not in only: continue
    path = os.path.join(B, f)
    src = open(path, encoding="utf-8").read()
    n = src.count(old)
    if n != 1:
        results.append((cid, what, f"PATCH NOT APPLIED (found {n} times)", ""))
        continue
    open(path, "w", encoding="utf-8").write(src.replace(old, new))
    try:
        r = subprocess.run(["npx", "vitest", "run", test, "-t", name], cwd=B, env=ENV, capture_output=True, text=True, timeout=300)
        out = r.stdout + r.stderr
        tail = [l for l in out.splitlines() if "Tests " in l or "Test Files" in l]
        verdict = "FAILED, as it should with the safeguard removed" if r.returncode != 0 and "failed" in out else ("PASSED: the test did not catch it" if r.returncode == 0 else f"ERROR exit {r.returncode}")
        results.append((cid, what, verdict, " | ".join(x.strip() for x in tail)))
    finally:
        open(path, "w", encoding="utf-8").write(src)
for cid, what, v, tail in results:
    print(f"{cid} | {what} | {v} | {tail}")
