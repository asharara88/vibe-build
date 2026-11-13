"""Package J3 controls: each safeguard removed in turn (exact replacements in builder's source), the test that guards it
run alone, its verdict, then the source restored and the tree checked unchanged. Run from builder/:
  BUILDER_TEST_DATABASE_URL=... TMPDIR=... python3 ../evidence/2026-11-13-journey-j3/controls-scripts/controls.py <out file>
No container is started by these tests."""
import subprocess, sys, datetime

CONTROLS = [
 ("J3-C01", "the pass is not used up when it lets the browser in (single use removed)", "src/web/preview-front.ts",
  [("  // The right pass: used once.\n  pass = null;\n", "  // The right pass: used once.\n")], "test/preview.test.ts", "a pass works once"),
 ("J3-C02", "the pass's 2 minutes not checked", "src/web/preview-front.ts",
  [("if (!p || Date.now() >= p.expiresAt) {", "if (!p) {")], "test/preview.test.ts", "refused after its time"),
 ("J3-C03", "no lock-out after five wrong passes", "src/web/preview-front.ts",
  [("    if (lock.wrong >= PASS_TRIES) {", "    if (lock.wrong >= 1000) {")], "test/preview.test.ts", "five wrong passes"),
 ("J3-C04", "a request from another site not refused (Sec-Fetch-Site cross-site or same-site)", "src/web/preview-rules.ts",
  [('  if (site === "cross-site" || site === "same-site") return `a request from another site (Sec-Fetch-Site: ${site})`;\n', "")], "test/preview.test.ts", "a refused request opens no stream"),
 ("J3-C05", "Host not mapped to app:3161", "src/web/preview-rules.ts",
  [("  out.host = c.host ? one(headers.host) : `app:${o.appPort}`;", "  out.host = one(headers.host);")], "test/preview-rules.test.ts", "passes only the allowlist"),
 ("J3-C06", "Origin not mapped to http://app:3161", "src/web/preview-rules.ts",
  [("  if (origin !== \"\") out.origin = c.origin ? origin : app;", "  if (origin !== \"\") out.origin = origin;")], "test/preview-rules.test.ts", "passes only the allowlist"),
 ("J3-C07", "a Referer from another origin passed on", "src/web/preview-rules.ts",
  [("    if (c.referer) out.referer = referer;", "    if (true) out.referer = referer;")], "test/preview-rules.test.ts", "a Referer from another origin is dropped"),
 ("J3-C08", "the request header allowlist removed (every header passed on)", "src/web/preview-rules.ts",
  [("  return FORWARDED_EXACT.has(n) || n.startsWith(\"accept\") || n.startsWith(\"if-\") || n.startsWith(\"sec-fetch-\");", "  return n !== \"cookie\" && n !== \"host\" && n !== \"origin\" && n !== \"referer\";")], "test/preview-rules.test.ts", "passes only the allowlist"),
 ("J3-C09", "the cookie scanner keeps a cookie with a Domain", "src/web/preview-rules.ts",
  [('    if (an === "domain") return null;', '    if (an === "domain-never") return null;')], "test/preview-rules.test.ts", "Set-Cookie: renamed with the prefix"),
 ("J3-C10", "every cookie passed to the app, not only this session's prefix", "src/web/preview-rules.ts",
  [("    if (name.startsWith(prefix) && name.length > prefix.length) out.push(`${name.slice(prefix.length)}${kv.slice(eq)}`);", "    out.push(kv);")], "test/preview-rules.test.ts", "cookies: only this session's prefix"),
 ("J3-C11", "Location passed as the app sent it", "src/web/preview-rules.ts",
  [("  if (!/^\\/(?![/\\\\])/.test(v)) return null;", "  if (v === \"\") return null;")], "test/preview-rules.test.ts", "Location: kept if it starts with exactly one /"),
 ("J3-C12", "the content-security-policy lets the app's page connect anywhere", "src/web/preview-rules.ts",
  [("connect-src 'self'; form-action", "connect-src *; form-action")], "test/preview-rules.test.ts", "the front's own headers"),
 ("J3-C13", "Permissions-Policy no longer denies the camera", "src/web/preview-rules.ts",
  [('export const PERMISSIONS_POLICY = "camera=(), ', 'export const PERMISSIONS_POLICY = "')], "test/preview-rules.test.ts", "the front's own headers"),
 ("J3-C14", "every content type passed on", "src/web/preview-rules.ts",
  [("  const t = contentType.split(\";\")[0]!.trim().toLowerCase();\n  if (t === \"\") return false;", "  const t = contentType.split(\";\")[0]!.trim().toLowerCase();\n  return true;\n  if (t === \"\") return false;")], "test/preview-rules.test.ts", "content types"),
 ("J3-C15", "the live app opened for a record that is not the scripted engine's alone (the rule and the job's own re-check both removed)", ["src/orchestrator/journey.ts", "src/orchestrator/journey-jobs.ts"],
  [(" : !s.appRunning ? \"The app is not running: make the preview first. The live app is offered only while it runs.\" : scriptedOnlyProblem(s)),", " : !s.appRunning ? \"The app is not running: make the preview first. The live app is offered only while it runs.\" : null),"),
   ("        const why = scriptedOnlyProblem(state);\n        if (why) throw new JourneyRefused(why);\n", "")], "test/journey.test.ts", "is refused for a record that does not show"),
 ("J3-C16", "the live app opened without the check service read as on front alone", "src/orchestrator/journey-jobs.ts",
  [("        if (network) throw new JourneyRefused(`The live app was not opened: ${network}.`);", "")], "test/journey.test.ts", "is refused when Compose does not read the check service"),
 ("J3-C17", "the front not given a user of its own (runs as root)", "src/web/preview.ts",
  [("      ...(root ? { uid: this.uid(), gid: this.uid() } : {}),", "")], "test/preview.test.ts", "runs as its own user"),
 ("J3-C18", "the checklist does not end the live session first", "src/orchestrator/journey-jobs.ts",
  [('      const closed = (await this.live?.closeFor(projectId, "checklist")) ?? false;', "      const closed = false;")], "test/journey.test.ts", "the checklist ends the live session first"),
 ("J3-C19", "the builder's sign-out does not end the live session", "src/web/app.ts",
  [('    await d.preview?.signedOut(c.get("session") ?? undefined);\n', "")], "test/web.test.ts", "Open the live app and Show are POSTs only"),
 ("J3-C20", "the pass written into the record", "src/orchestrator/journey-jobs.ts",
  [("            pass_recorded: false,", "            pass_recorded: r.shown,")], "test/journey.test.ts", "records live_opened without the pass"),
 ("J3-C21", "a refused POST still sent to the app", "src/web/preview-front.ts",
  [("  if (refused) {\n    req.resume();\n    return page(res,", "  if (refused) {\n    forward(req, res, s);\n    return;\n    return page(res,")], "test/preview.test.ts", "a refused request opens no stream"),
 ("J3-C22", "the gate takes a POST with an Origin of null", "src/web/preview-rules.ts",
  [('  if (origin === "null") return "from a page with no origin";\n', "")], "test/preview-rules.test.ts", "the gate's POSTs"),
 ("J3-C23", "the 1 MB body limit raised to 1 GB", "src/web/preview-rules.ts",
  [("export const MAX_BODY_BYTES = 1024 * 1024;", "export const MAX_BODY_BYTES = 1024 * 1024 * 1024;")], "test/preview.test.ts", "a refused request opens no stream"),
 ("J3-C24", "a stream may target any service, not only app:<port>", "src/sandbox/manager.ts",
  [("export const STREAM_TARGET = /^app:(\\d{1,5})$/;", "export const STREAM_TARGET = /^[a-z0-9.]+:(\\d{1,5})$/;")], "test/sandbox.test.ts", "appStream"),
 ("J3-C25", "the pump takes a stream before the pass is used", "src/web/preview.ts",
  [("    if (!c || !c.entered || Date.now() >= c.endsAt) {", "    if (!c || Date.now() >= c.endsAt) {")], "test/preview.test.ts", "the pump socket takes a stream only once the pass has been used"),
 ("J3-C26", "a browser that leaves before the app's answer does not stop the request to the app", "src/web/preview-front.ts",
  [("    if (!answered) up.destroy();", "    if (false) up.destroy();")], "test/preview.test.ts", "a browser that leaves before the app's answer comes"),
 # After J3's review (added 13 Nov 2026).
 ("J3-C27", "a GET or HEAD sent to the app with the Content-Length it stated (review: request desynchronisation)", "src/web/preview-rules.ts",
  [('    if (bodiless && name === "content-length") continue;\n', "")], "test/preview.test.ts", "a GET or HEAD that says it has a body"),
 ("J3-C28", "Speculation-Rules passed on to the browser", "src/web/preview-rules.ts",
  [('  "speculation-rules",\n', "")], "test/preview-rules.test.ts", "headers that make the browser fetch or prepare other addresses"),
 ("J3-C29", "Attribution-Reporting-* passed on to the browser", "src/web/preview-rules.ts",
  [(' || n.startsWith("attribution-reporting-");', ";")], "test/preview-rules.test.ts", "headers that make the browser fetch or prepare other addresses"),
 ("J3-C30", "a live session not bounded by the builder sign-in session's expiry", "src/web/preview.ts",
  [('    const bound = typeof o.builderSessionEndsAt === "number" && o.builderSessionEndsAt < now + sessionMs;', "    const bound = false;")], "test/preview.test.ts", "the session ends when the builder sign-in session that opened it expires"),
 ("J3-C31", "the interface does not give the live session its sign-in session's expiry", "src/web/app.ts",
  [("    const r = await jobs().openLive(id, session, d.sessions.expiresAt(session));", "    const r = await jobs().openLive(id, session);")], "test/web.test.ts", "a live session ends no later than the builder sign-in session"),
 ("J3-C32", "a new sign-in in the same browser does not end the live session of the sign-in it replaces", "src/web/app.ts",
  [('      await d.preview?.signedOut(v, "signed_in_again");\n', "")], "test/web.test.ts", "a live session ends no later than the builder sign-in session"),
 ("J3-C33", "the front started again with no limit", "src/web/preview.ts",
  [("        if (!this.stopping && this.restarts >= MAX_FRONT_RESTARTS) {", "        if (false) {")], "test/preview.test.ts", "a front that stops is started again at most"),
 ("J3-C34", "a stale camera folder of the runner's user left behind (root)", "src/web/preview.ts",
  [('      const owned = st.uid === me || (me === 0 && m[1] === "bpc" && st.uid === RUNNER_UID);', "      const owned = st.uid === me;")], "test/preview.test.ts", "also removes a stale camera folder"),
 ("J3-C35", "the live preview front started whether or not it is turned on", "src/web/main.ts",
  [("  if (s.livePreview) {", "  if (true) {")], "test/web.test.ts", "starts no live preview front unless BUILDER_LIVE_PREVIEW=1"),
 ("J3-C36", "the live preview's setting not read (always off)", "src/web/main.ts",
  [('livePreview: live === "1" };', "livePreview: false };")], "test/web.test.ts", "start is refused without each setting"),
]

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)

def tree():
    return run(["git", "write-tree", "--prefix=builder/"]).stdout.strip() if False else run(["git", "diff", "--stat"]).stdout

out = []
before = run(["git", "diff", "HEAD", "--stat", "--", "."]).stdout
head = run(["git", "rev-parse", "--short", "HEAD"]).stdout.strip()
out.append(f"J3 controls, {datetime.date.today()}, on HEAD {head} of builder/ (working tree as committed: `git diff HEAD -- .` empty before: {'yes' if before == '' else 'NO'}). Each safeguard removed in turn by exact replacement, the test that guards it run alone (npx vitest run <file> -t <name>), its verdict, then the file restored with git checkout and the tree checked unchanged.")
out.append("Columns: control | what was removed | verdict | vitest's summary lines")
only = sys.argv[2:]  # control ids to run; all when none is named
for cid, label, path, reps, test, name in CONTROLS:
    if only and cid not in only:
        continue
    # One file for every replacement, or one file per replacement (a list of paths, in the replacements' order).
    paths = path if isinstance(path, list) else [path] * len(reps)
    texts = {p: open(p).read() for p in set(paths)}
    ok = True
    for p, (old, new) in zip(paths, reps):
        if old not in texts[p]:
            ok = False
            break
        texts[p] = texts[p].replace(old, new, 1)
    if not ok:
        out.append(f"{cid} | {label} | NOT APPLIED (the text to replace was not found) |")
        continue
    for p, t in texts.items():
        open(p, "w").write(t)
    r = run(["npx", "vitest", "run", test, "-t", name])
    run(["git", "checkout", "--", *texts.keys()])
    summary = " | ".join(l.strip() for l in (r.stdout + r.stderr).splitlines() if l.strip().startswith(("Test Files", "Tests ")))
    verdict = "FAILED, as it should with the safeguard removed" if r.returncode != 0 and "failed" in summary else ("PASSED: the test does not see this safeguard's removal" if r.returncode == 0 else f"ERROR (exit {r.returncode})")
    out.append(f"{cid} | {label} | {verdict} | {summary}")
    print(out[-1], flush=True)
after = run(["git", "diff", "HEAD", "--stat", "--", "."]).stdout
out.append(f"After every control: `git diff HEAD -- .` empty: {'yes' if after == '' else 'NO: ' + after}")
open(sys.argv[1], "w").write("\n".join(out) + "\n")
