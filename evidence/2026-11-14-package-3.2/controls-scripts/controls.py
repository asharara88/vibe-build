"""Package 3.2 controls (docs/design/package-3.2.md, section 5): each safeguard S1 to S31, and each safeguard the
builders added that a test names (design section 13), removed in turn by exact replacement (each text to replace must
occur exactly once in its file when it is replaced), the test or tests that guard it run, the verdict of each, then the
files restored with `git checkout HEAD --` and the tree checked unchanged. Written in the style of J2's controls.py
(evidence/2026-11-13-journey-j2/controls-scripts/controls.py); the replacements of parts A, B and C (part-a-controls.txt,
part-b-controls.txt, part-c-controls.txt) are gathered here, with the safeguards those parts had not controlled (S7,
S11, S16, and S21's live case) added.

Before the controls, every named fast test is run once on the tree as committed, where it must pass, and the live file
is run once in full, where all its tests must pass.

Fast tests: `npx vitest run <file> -t <name>`; the named test must be reported failed (vitest's JSON report).
Live tests (test/export-live.test.ts): the whole file under the shared lock, since each live test needs the ones before
it (the export, the started copy); the named test must be reported failed.

After the controls of section 5, a second list: checks the builders added (design section 13, C3 and C4) that no test
names. Each is removed in the same way and the live file run, to find out whether any test sees the removal. Their
results are reported apart and do not count toward the controls' result.

Run from builder/:
  BUILDER_TEST_DATABASE_URL=... TMPDIR=... BUILDER_BROWSER_CACHE=... \
    python3 ../evidence/2026-11-14-package-3.2/controls-scripts/controls.py <out file> [--check] [control ids]
--check only counts each text to replace and runs nothing."""
import json, os, re, subprocess, sys, datetime, time

S = "/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad"
LOCK = S + "/live-tests.lock"
WT = os.path.abspath(os.path.join(os.getcwd(), ".."))
JSON_OUT = os.path.join(os.environ.get("TMPDIR", "/tmp"), "x32-controls-report.json")
RAW = S + "/x32d-controls-raw"

EX = "builder/src/orchestrator/export.ts"
JJ = "builder/src/orchestrator/journey-jobs.ts"
JO = "builder/src/orchestrator/journey.ts"
CK = "builder/src/export/export-check.ts"
CF = "builder/src/export/check-from-copy.ts"
AC = "builder/src/export/app-compose.ts"
TB = "builder/src/sandbox/tables.ts"
MG = "builder/src/sandbox/manager.ts"
SE = "builder/src/engine/scripted.ts"
EN = "builder/src/web/messages/en.json"
TPL = "templates/next"
E = "test/export.test.ts"
J = "test/journey.test.ts"
W = "test/web.test.ts"
SC = "test/scripted-engine.test.ts"
LIVE = "live"

L1 = "L1: a real export of example 1"
L1R = "L1: the image checks refuse"
L2 = "L2: the copy's own start"
L2B = "L2b (S30)"
L3 = "L3 (S25, S26, S27, S31) and L3c"
L3T = "L3 (S25): a test in the copy loosened"
L3B = "L3b (S26)"
L4 = "L4 (S24)"

# (id, safeguard, what was removed, [(file, old, new), ...], compose.yaml written again from app-compose.ts,
#  [(test file or LIVE, -t name (fast) or None (live), the test that must fail: a substring of its full name)])
CONTROLS = [
 # ------------------------------------------------------------------ S1 to S16: the exporter (part B; S7, S11, S16 added)
 ("S01", "S1", "links and submodules in any commit not refused", [(EX, "if (special.size) refuse(", "if (special.size && false) refuse(")], False,
  [(E, "E1 (S1)", "E1 (S1)"), (E, "E2 (S1)", "E2 (S1)")]),
 ("S02", "S2", "the exporter's files created without O_EXCL and O_NOFOLLOW (truncating, following a link)",
  [(EX, "constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW", "constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC")], False,
  [(E, "E1b (S2)", "E1b (S2)")]),
 ("S03", "S3", "EXPORT-NOTE.txt in the history not refused",
  [(EX, "if (tracked.some((f) => f.toLowerCase() === EXPORT_NOTE.toLowerCase())) refuse(", "if (false) refuse(")], False,
  [(E, "E3 (S3)", "E3 (S3)")]),
 ("S04", "S4", "the export commit's contents not checked", [(EX, "if (commitProblems.length) refuse(", "if (commitProblems.length && false) refuse(")], False,
  [(E, "E4 (S4)", "E4 (S4)")]),
 ("S05", "S5", "the checkout's bytes not compared with the history", [(EX, "if (differ.length) refuse(", "if (differ.length && false) refuse(")], False,
  [(E, "E5 (S5)", "E5 (S5)")]),
 ("S06", "S6", "an acceptance folder in the history not refused",
  [(EX, 'if (tracked.some((f) => f === "acceptance" || f.startsWith("acceptance/"))) refuse(', "if (false) refuse(")], False,
  [(E, "E6 (S6", "E6 (S6")]),
 ("S07", "S7", "secret-like paths in the history not refused", [(EX, "if (secretLike.length) refuse(", "if (secretLike.length && false) refuse(")], False,
  [(J, "the export is refused when the project's history holds a file that looks like a secret", "the export is refused when the project's history holds a file that looks like a secret"),
   (J, "the export is refused when any commit of the history held a file that looks like a secret", "the export is refused when any commit of the history held a file that looks like a secret")]),
 ("S08", "S8", "a version that does not match its manifest accepted",
  [(EX, "if (!v.ok || !v.manifest || !v.manifestSha256) return refuse(", "if (!v.manifest || !v.manifestSha256) return refuse(")], False,
  [(E, "E7 (S8", "E7 (S8")]),
 ("S09a", "S9", "the version's manifest not compared with the passing run's",
  [(EX, "if (v.manifestSha256 !== i.runManifestSha256) refuse(", "if (false) refuse(")], False,
  [(E, "S9 in writeExport", "S9 in writeExport"), (E, "E9 (S9)", "E9 (S9)")]),
 ("S09b", "S9", "the run's record read without its manifest SHA-256",
  [(EX, 'if (typeof p.manifest_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(p.manifest_sha256)) return', "if (false) return")], False,
  [(E, "S9's reading of the record", "S9's reading of the record"), (E, "E9 (S9)", "E9 (S9)")]),
 ("S10", "S10", "the workspace history's head not compared after the export commit",
  [(EX, 'if ((await git(i.repo, ["rev-parse", "HEAD"])).trim() !== workspaceHead) refuse(', "if (false) refuse(")], False,
  [(E, "E8 (S10", "E8 (S10")]),
 ("S11a", "S11", "the clone made locally (--no-local removed: objects no commit reaches are copied)",
  [(EX, '["clone", "--quiet", "--no-local", "--no-hardlinks",', '["clone", "--quiet", "--no-hardlinks",')], False,
  [(J, "the exported copy holds only what the history reaches", "the exported copy holds only what the history reaches")]),
 ("S11b", "S11", "the copy's remote kept (it points back at the machine's folder)",
  [(EX, '    await gitIn(top, ["remote", "remove", "origin"]);\n', "")], False,
  [(J, "the export: a .tar.gz of the project's history", "the export: a .tar.gz of the project's history")]),
 ("S12a", "S12", "the job's rule: one export per project", [(JO, ": s.exportEventId ? EXPORT_ONCE : null),", ": null),")], False,
  [(E, "E10 (S12): one export per project: a second", "E10 (S12): one export per project: a second")]),
 ("S12b", "S12", "the archive placed although one exists (removed first, then placed)",
  [(EX, "if (lstatSync(path, { throwIfNoEntry: false })) exists();\n", ""),
   (EX, "      linkSync(packed, path);", "      rmSync(path, { force: true });\n      linkSync(packed, path);")], False,
  [(E, "E10 (S12): one export per project in writeExport", "E10 (S12): one export per project in writeExport")]),
 ("S12c", "S12", "a failed export leaves its staging folder (and the archive in it)",
  [(EX, "  } finally {\n    rmSync(staging, { recursive: true, force: true });\n  }", "  } finally {\n  }")], False,
  [(E, "E10 (S12): one export per project in writeExport", "E10 (S12): one export per project in writeExport")]),
 ("S13", "S13", "the fixed files not compared with the builder's template copies", [(EX, "if (fixed.length) refuse(", "if (fixed.length && false) refuse(")], False,
  [(E, "E13 (S13)", "E13 (S13)")]),
 ("S14", "S14", "drizzle/ not compared with its journal", [(EX, "if (migrations.length) refuse(", "if (migrations.length && false) refuse(")], False,
  [(E, "E12 (S14)", "E12 (S14)")]),
 ("S15", "S15", "a project the scripted engine did not build exported",
  [(JJ, "if (notScripted) throw new JourneyRefused(", "if (notScripted && false) throw new JourneyRefused(")], False,
  [(E, "E16 (S15)", "E16 (S15)")]),
 ("S16a", "S16", "export before sign-off allowed (the sign-off rule of JOB_RULES.export)",
  [(JO, 'export: (s) => (!s.signedOff ? "The project is not signed off yet.', 'export: (s) => (false ? "The project is not signed off yet.')], False,
  [(J, "export is refused before sign-off, and allowed after it", "export is refused before sign-off, and allowed after it"),
   (J, "the checklist, sign-off and export in order", "the checklist, sign-off and export in order")]),
 ("S16b", "S16", "a broken copy's export allowed (the broken-copy rule of JOB_RULES.export)",
  [(JO, " : s.brokenTrace ? BROKEN_COPY_REFUSAL : s.exportEventId ? EXPORT_ONCE : null),", " : s.exportEventId ? EXPORT_ONCE : null),")], False,
  [(J, "A6:", "A6:"), (W, "A6:", "A6:"), (J, "A6b:", "A6b:")]),
 # ------------------------------------------------------------------ S17 to S19: the image checks (parts B and C)
 ("S17a", "S17", "verdict: a development-only package under /app of the run image allowed",
  [(CK, '    if (c.path === "/app" || c.path.startsWith("/app/")) problems.push(', "    if (false) problems.push(")], False,
  [(E, "S17 under question 26", "S17 under question 26")]),
 ("S17b", "S17", "live: a development-only package under /app of the run image allowed",
  [(CK, '    if (c.path === "/app" || c.path.startsWith("/app/")) problems.push(', "    if (false) problems.push(")], False,
  [(LIVE, None, L1R)]),
 ("S17c", "S17", "live: any copy outside /app of the run image allowed",
  [(CK, "    else if (!(c.path === KNOWN_BASE_COPY.path && c.name === KNOWN_BASE_COPY.name && c.version === KNOWN_BASE_COPY.version))", "    else if (false)")], False,
  [(LIVE, None, L1R)]),
 ("S18a", "S18", "verdict: the notices file in the run image not compared", [(CK, "if (inImage.sha256 !== copySha256) return", "if (false) return")], False,
  [(E, "S18: the notices file", "S18: the notices file")]),
 ("S18b", "S18", "live: no notices file in the run image allowed",
  [(CK, '  if (!inImage) return { passed: false, summary: "The image the app runs from has no /app/THIRD-PARTY-NOTICES.md." };',
    '  if (!inImage) return { passed: true, summary: "made-up control: not checked" };')], False,
  [(LIVE, None, L1R)]),
 ("S19a", "S19", "verdict: the licence check read from its exit code alone", [(CK, "const passed = code === 0 && results === 2 && notices;", "const passed = code === 0;")], False,
  [(E, "S19: the template's licence check", "S19: the template's licence check")]),
 ("S19b", "S19", "live: the licence check read as passed whatever it said", [(CK, "const passed = code === 0 && results === 2 && notices;", "const passed = true;")], False,
  [(LIVE, None, L1R)]),
 # ------------------------------------------------------------------ S20 to S24: the archive, the template, the steps, the tables (parts A and B)
 ("S20", "S20", "node_modules and the 14 names allowed in the archive",
  [(EX, 'const bad = new Set(["node_modules", ...devNames.map((n) => n.toLowerCase())]);', "const bad = new Set<string>();")], False,
  [(E, "E20 (S20", "E20 (S20")]),
 ("S21a", "S21", "tsconfig.json no longer excludes acceptance", [(TPL + "/tsconfig.json", '    "node_modules",\n    "acceptance"\n', '    "node_modules"\n')], False,
  [(E, "T1 (S21)", "excludes the acceptance folder")]),
 ("S21b", "S21", ".dockerignore no longer lists acceptance", [(TPL + "/.dockerignore", "\nacceptance\n", "\n")], False,
  [(E, "T1 (S21)", ".dockerignore lists acceptance and .git")]),
 ("S21c", "S21", ".dockerignore no longer lists .git", [(TPL + "/.dockerignore", "\n.git\n", "\n")], False,
  [(E, "T1 (S21)", ".dockerignore lists acceptance and .git")]),
 ("S21d", "S21", "live: both removed (the checklist's test reaches the image build and its type check)",
  [(TPL + "/tsconfig.json", '    "node_modules",\n    "acceptance"\n', '    "node_modules"\n'), (TPL + "/.dockerignore", "\nacceptance\n", "\n")], False,
  [(LIVE, None, L1)]),
 ("S22a", "S22", "data not internal",
  [(AC, "networks: { data: PROJECT_NETWORK, front: PROJECT_NETWORK, edge: { enable_ipv6: false } },", "networks: { data: { ...PROJECT_NETWORK, internal: false }, front: PROJECT_NETWORK, edge: { enable_ipv6: false } },")], True,
  [(E, "T2 (S22)", "the networks: data and front")]),
 ("S22b", "S22", "the app also on edge", [(AC, 'networks: ["data", "front"],\n        depends_on: { setup:', 'networks: ["data", "front", "edge"],\n        depends_on: { setup:')], True,
  [(E, "T2 (S22)", "app, db and setup on the internal networks only")]),
 ("S22c", "S22", "keys on data", [(AC, 'network_mode: "none",', 'networks: ["data"],')], True,
  [(E, "T2 (S22)", "app, db and setup on the internal networks only")]),
 ("S22d", "S22", "the door's port on every address", [(AC, 'host_ip: "127.0.0.1"', 'host_ip: "0.0.0.0"')], True,
  [(E, "T2 (S22)", "the door is the only service with a port")]),
 ("S22e", "S22", "the app publishes a port too",
  [(AC, 'networks: ["data", "front"],\n        depends_on: { setup:', 'networks: ["data", "front"],\n        ports: [{ target: 3000, published: "3001", host_ip: "127.0.0.1", protocol: "tcp" }],\n        depends_on: { setup:')], True,
  [(E, "T2 (S22)", "the door is the only service with a port")]),
 ("S22f", "S22", "the door on the machine's network", [(AC, 'networks: ["front", "edge"],', 'network_mode: "host",')], True,
  [(E, "T2 (S22)", "app, db and setup on the internal networks only")]),
 ("S22g", "S22", "no-new-privileges dropped", [(AC, "security_opt: HARDENING.security_opt, ", "")], True,
  [(E, "T2 (S22)", "every service has the sandbox's hardening")]),
 ("S22h", "S22", "setup's root writable",
  [(AC, 'read_only: true,\n        tmpfs: ["/tmp:rw,noexec,nosuid,size=64m"],\n        environment: { APP_URL: APP_URL_VALUE },', 'read_only: false,\n        tmpfs: ["/tmp:rw,noexec,nosuid,size=64m"],\n        environment: { APP_URL: APP_URL_VALUE },')], True,
  [(E, "T2 (S22)", "every service has the sandbox's hardening")]),
 ("S22i", "S22", "the door's image by tag alone",
  [(AC, 'user: "node",\n        entrypoint: [],\n        networks: ["front", "edge"],', 'user: "node",\n        image: DEFAULT_IMAGES.node.split("@")[0],\n        entrypoint: [],\n        networks: ["front", "edge"],')], True,
  [(E, "T2 (S22)", "only approved images")]),
 ("S22j", "S22", "the app also given the sample password", [(AC, 'app: ["db_password", "auth_secret"],', 'app: ["db_password", "auth_secret", "sample_password"],')], True,
  [(E, "T2 (S22)", "each service is given only its own key files")]),
 ("S22k", "S22", "the app given the whole keys volume", [(AC, "volumes: KEYS_GIVEN.app!.map(keyMount),", 'volumes: [{ type: "volume", source: "keys", target: "/keys" }],')], True,
  [(E, "T2 (S22)", "each service is given only its own key files")]),
 ("S22l", "S22", "compose.yaml edited by hand (no longer the generated text)", [(TPL + "/compose.yaml", 'host_ip: "127.0.0.1"', 'host_ip: "0.0.0.0"')], False,
  [(E, "T2 (S22)", "is the generated text, byte for byte")]),
 ("S23a", "S23", "compose.yaml not protected", [(SE, '  "compose.yaml",\n', "")], False,
  [(SC, "S23", "a step that writes compose.yaml fails")]),
 ("S23b", "S23", "a step that adds one of S29's names does not fail", [(SE, "    if (readUntold.length) return fail(", "    if (readUntold.length && false) return fail(")], False,
  [(SC, "S23", "a step that adds compose.override.yaml")]),
 ("S23c", "S23", "README.md not protected (T3)", [(SE, '  "README.md",\n', "")], False,
  [(E, "T3 (S23)", "the protected paths hold the start files")]),
 ("S24a", "S24", "tables by push --force instead of migrate",
  [(TB, 'export const MIGRATE_COMMAND = ["node_modules/.bin/drizzle-kit", "migrate"] as const;', 'export const MIGRATE_COMMAND = ["node_modules/.bin/drizzle-kit", "push", "--force"] as const;')], False,
  [(E, "T7 (S24)", "makeTables: drizzle-kit migrate")]),
 ("S24b", "S24", "the drift check's output not read", [(TB, "const said = output.includes(NO_DRIFT);", "const said = true;")], False,
  [(E, "T7 (S24)", 'does not say "No schema changes"')]),
 ("S24c", "S24", "the files the drift check wrote not compared", [(TB, "if (said && touched.length === 0) return", "if (said) return")], False,
  [(E, "T7 (S24)", "but the copy changed")]),
 ("S24d", "S24", "a drift does not refuse (fast)", [(TB, "  if (!drift.ok) throw new Error(", "  if (!drift.ok && false) throw new Error(")], False,
  [(E, "T7 (S24)", "when generate writes a migration")]),
 ("S24e", "S24", "a link in drizzle/ not refused before the drift check", [(TB, "  if (other.length) throw new Error(", "  if (other.length && false) throw new Error(")], False,
  [(E, "T7 (S24)", "holds a link")]),
 ("S24f", "S24", "live: a drift does not refuse the start", [(TB, "  if (!drift.ok) throw new Error(", "  if (false) throw new Error(")], False,
  [(LIVE, None, L4)]),
 # ------------------------------------------------------------------ S25 to S27: the check from the copy (part C)
 ("S25", "S25", "live: the version check before the start removed",
  [(CF, '  if (!check.ok) refused = `the version does not match its manifest: ${check.problems.join("; ")}`;', "")], False,
  [(LIVE, None, L3T)]),
 ("S26a", "S26", "live: the app not chosen by its project's working folder",
  [(CF, ' && same(c.Config?.Labels?.["com.docker.compose.project.working_dir"], copyReal));', ");")], False,
  [(LIVE, None, L3B)]),
 ("S26b", "S26", "live: the app container's image not compared by id",
  [(CF, "  if (c.Image !== image.Id) return `the app container's image", "  if (false) return `the app container's image")], False,
  [(LIVE, None, L3B)]),
 ("S26c", "S26", "live: other containers on the project's front network allowed", [(CF, "  if (others.length) return `", "  if (false) return `")], False,
  [(LIVE, None, L3B)]),
 ("S27a", "S27", "the runner not in the forwarder's namespace (fast, T8)", [(CF, "    `container:${o.forwarder}`,", '    "none",')], False,
  [(E, "T8:", "T8:")]),
 ("S27b", "S27", "live: the runner not in the forwarder's namespace", [(CF, "    `container:${o.forwarder}`,", '    "none",')], False,
  [(LIVE, None, L3)]),
 ("S27c", "S27", "live: the forwarder made on the project's data network, its own network check removed",
  [(CF, "forwarderRunArgs({ name: forwarderName, network: app.front,", "forwarderRunArgs({ name: forwarderName, network: `${app.project}_data`,"),
   (CF, "        if (nets.length !== 1 || nets[0] !== app.front) refused =", "        if (false) refused =")], False,
  [(LIVE, None, L3)]),
 # ------------------------------------------------------------------ S28 to S31 (parts B and C)
 ("S28", "S28", "the old label (\"no notices file\") back in English",
  [(EN, '"export.label": "Internal only, not for customers. The two container images', '"export.label": "Internal only, not for customers. Not yet shown to start without the builder (package 3.2): its tables are made by the builder\'s tools container, and it has no notices file. The two container images')], False,
  [(E, "E15 (S28)", "E15 (S28)")]),
 ("S29", "S29", "files Compose or the image build reads untold not refused in the history", [(EX, "if (composeRead.length) refuse(", "if (composeRead.length && false) refuse(")], False,
  [(E, "E21 (S29)", "E21 (S29)")]),
 ("S30a", "S30", "verdict: Compose's two readings no longer compared", [(CK, '  differences(a, b, "", diffs, 20);\n', "")], False,
  [(E, "S30: what Compose reads", "S30: what Compose reads")]),
 ("S30b", "S30", "live: Compose's two readings no longer compared", [(CK, '  differences(a, b, "", diffs, 20);\n', "")], False,
  [(LIVE, None, L2B)]),
 ("S31a", "S31", "--checklist-items made optional (a default of 6)",
  [(CF, "  for (const f of FLAGS) if (!seen.has(f)) throw", '  for (const f of FLAGS) if (!seen.has(f) && f !== "--checklist-items") throw'),
   (CF, '  const n = seen.get("--checklist-items")!;', '  const n = seen.get("--checklist-items") ?? "6";')], False,
  [(E, "E17 (S31)", "the script's values"), (E, "E17 (S31)", "the script itself refuses to run without --checklist-items")]),
 ("S31b", "S31", "the reading takes the manifest's item count, not the count given",
  [(CF, "checklistItems: args.checklistItems });", "checklistItems: facts.manifest.items.length });")], False,
  [(E, "E17 (S31)", "a made-up results folder, read with the count given")]),
 # ------------------------------------------------------------------ added by the builders, each with a test of its own (design section 13)
 ("B-chk1", "B1 (section 4 items 3-7)", "a Docker check reported not passed does not refuse",
  [(EX, "const failed = docker.find((c) => c.passed !== true);", "const failed = undefined as ExportCheck | undefined;")], False,
  [(E, "E10 (S12): one export per project in writeExport", "E10 (S12): one export per project in writeExport"), (E, "E10 (S12): one export per project: a second", "E10 (S12): one export per project: a second")]),
 ("B-chk2", "B1 (section 4 items 3-7)", "the six Docker checks need not each be reported once",
  [(EX, "const missing = DOCKER_CHECK_IDS.filter((id) => docker.filter((c) => c.id === id).length !== 1);", "const missing: string[] = [];")], False,
  [(E, "E10 (S12): one export per project in writeExport", "E10 (S12): one export per project in writeExport")]),
 ("B-hard", "section 4 (the checks' containers)", "the check containers' read-only root dropped", [(CK, '...(HARDENING.read_only ? ["--read-only"] : []),', "")], False,
  [(E, "the containers of the checks carry", "the containers of the checks carry")]),
 ("B-rm", "B2 (removal list)", "the check's two images not on the project's removal list",
  [(MG, "return [appBuild.image, appBuild.toolsImage, `${projectName}-exportcheck-run:latest`, `${projectName}-exportcheck-tools:latest`];", "return [appBuild.image, appBuild.toolsImage];")], False,
  [(E, "are on the project's removal list", "are on the project's removal list")]),
 ("A-T5a", "T5 (README)", "a second code block under \"Start it\"",
  [(TPL + "/README.md", "```\ndocker compose up --build\n```\n", "```\ndocker compose up --build\n```\n\n```\nAPP_PORT=3100 docker compose up --build\n```\n")], False,
  [(E, "T5:", "holds exactly one code block")]),
 ("A-T5b", "T5 (README)", "the role guard's section of the template removed", [(TPL + "/README.md", "## The role guard (rule 5)\n", "## Rule 5\n")], False,
  [(E, "T5:", "the template's own sections stay")]),
 ("A-T6", "T6 (Dockerfile)", "the notices file not copied into the run stage", [(TPL + "/Dockerfile", "COPY --from=build /app/THIRD-PARTY-NOTICES.md ./THIRD-PARTY-NOTICES.md\n", "")], False,
  [(E, "T6:", "copies the notices file into /app")]),
 ("C-T8", "T8 (C1)", "the runner's read-only root dropped", [(CF, '    ...(svc.read_only ? ["--read-only"] : []),\n', "")], False,
  [(E, "T8:", "T8:")]),
]

# Checks the builders added (design section 13, C3 and C4) that no test names: removed to see whether any test sees it.
PROBES = [
 ("P1", "C4", "the app container need not have been started from the copy's compose.yaml alone (config_files)",
  [(CF, '  if (configFiles !== join(labels["com.docker.compose.project.working_dir"]!, "compose.yaml"))\n    return', "  if (false)\n    return")]),
 ("P2", "C3", "the keys volume need not carry Compose's labels for this project",
  [(CF, 'if (v.Labels?.["com.docker.compose.project"] !== project || v.Labels?.["com.docker.compose.volume"] !== "keys") return', "if (false) return")]),
 ("P3", "C4", "the front network need not be internal in the isolated gateway mode",
  [(CF, 'if (net.Internal !== true || net.Options?.["com.docker.network.bridge.gateway_mode_ipv4"] !== "isolated") return', "if (false) return")]),
 ("P4", "C4", "the app's APP_URL need not be http://localhost:<port>",
  [(CF, "    return `the app container's APP_URL (${appUrl}) is not http://localhost:<port>", "    void `the app container's APP_URL (${appUrl}) is not http://localhost:<port>")]),
 ("P5", "C4", "a one-off container of the service app may be taken for the app",
  [(CF, 'c.Config?.Labels?.["com.docker.compose.oneoff"] !== "True" && same(', "same(")]),
]

def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)

def scrub(t):
    return t.replace(S, "<scratchpad>")

def vitest(test_file, name, live):
    """(exit code, {full name: status}, the summary line, seconds, raw output)."""
    try:
        os.remove(JSON_OUT)
    except FileNotFoundError:
        pass
    cmd = ["npx", "vitest", "run", test_file, "--reporter=default", "--reporter=json", f"--outputFile.json={JSON_OUT}"]
    if name:
        cmd += ["-t", re.escape(name)]
    if live:
        cmd = ["flock", LOCK] + cmd
    t0 = time.time()
    r = run(cmd, timeout=3600)
    statuses = {}
    try:
        d = json.load(open(JSON_OUT))
        for f in d["testResults"]:
            for a in f["assertionResults"]:
                statuses[a["fullName"]] = a["status"]
    except Exception as err:
        statuses = {"(no JSON report: " + str(err) + ")": "none"}
    out = r.stdout + r.stderr
    summary = " | ".join(l.strip() for l in out.splitlines() if re.match(r"\s*(Test Files|Tests)\s", l))
    return r.returncode, statuses, summary, int(time.time() - t0), out

def named(statuses, part):
    return {k: v for k, v in statuses.items() if part in k}

def first_error(out):
    for l in out.splitlines():
        l = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", l).strip()
        if re.match(r"(AssertionError|TypeError|Error|SyntaxError):", l) and "[x32]" not in l:
            return scrub(l)[:260]
    return ""

def apply(reps):
    texts = {}
    for f, old, new in reps:
        p = os.path.join(WT, f)
        if p not in texts:
            texts[p] = open(p, encoding="utf8").read()
        n = texts[p].count(old)
        if n != 1:
            return None, f"the text to replace occurs {n} times in {f}, not once"
        texts[p] = texts[p].replace(old, new, 1)
    return texts, None

def docker_lists():
    out = {}
    for what, cmd in [("containers", ["docker", "ps", "-a", "--format", "{{.Names}}"]), ("images", ["docker", "images", "--format", "{{.Repository}}:{{.Tag}} {{.ID}}"]),
                      ("volumes", ["docker", "volume", "ls", "--format", "{{.Name}}"]), ("networks", ["docker", "network", "ls", "--format", "{{.Name}}"])]:
        out[what] = sorted(set(run(cmd).stdout.split("\n")) - {""})
    return out

if __name__ == "__main__":
    args = [a for a in sys.argv[2:] if a != "--check"]
    check_only = "--check" in sys.argv[2:]
    chosen = [c for c in CONTROLS if not args or c[0] in args]
    probes = [p for p in PROBES if not args or p[0] in args]
    if check_only:
        bad = 0
        for c in chosen:
            _, problem = apply(c[3])
            print(c[0], "ok" if not problem else problem)
            bad += bool(problem)
        for p in probes:
            _, problem = apply(p[3])
            print(p[0], "ok" if not problem else problem)
            bad += bool(problem)
        sys.exit(1 if bad else 0)

    os.makedirs(RAW, exist_ok=True)
    out = []
    def say(s=""):
        print(s, flush=True)
        out.append(s)
        open(sys.argv[1], "w").write("\n".join(out) + "\n")
    scope = ["builder", "templates"]
    before = run(["git", "-C", WT, "status", "--porcelain", "--", *scope]).stdout
    head = run(["git", "-C", WT, "rev-parse", "--short", "HEAD"]).stdout.strip()
    say(f"Package 3.2 controls, {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}, on HEAD {head}. builder/ and templates/ as committed (`git status --porcelain -- builder templates` empty before: {'yes' if before == '' else 'NO'}).")
    say("Each safeguard removed in turn by exact replacement (each text to replace occurring exactly once in its file), compose.yaml written")
    say("again from app-compose.ts where the safeguard is there (so that only the rule's own test can catch it), the test or tests that guard")
    say("it run, then the files put back with `git checkout HEAD --` and checked unchanged. Fast tests: `npx vitest run <file> -t <name>`, the")
    say("named test reported failed in vitest's JSON report. Live tests: the whole of test/export-live.test.ts under the shared lock (each")
    say("live test needs the ones before it); the named test reported failed. Paths under the session's scratch folder are written <scratchpad>.")
    docker_start = docker_lists()

    # 1. Baseline.
    say("")
    say("1. Baseline, on the tree as committed: each named fast test passes, and the live file passes in full.")
    baseline_ok = True
    fast = sorted({(t[0], t[1]) for c in chosen for t in c[5] if t[0] != LIVE})
    for f, name in fast:
        code, st, summary, secs, _ = vitest(f, name, False)
        targets = [t[2] for c in chosen for t in c[5] if t[0] == f and t[1] == name]
        ran = {k: v for k, v in st.items() if v in ("passed", "failed")}
        ok = code == 0 and ran and all(v == "passed" for v in ran.values()) and all(named(ran, t) for t in targets)
        baseline_ok &= bool(ok)
        say(f"  {f} -t \"{name}\": {'passed' if ok else 'NOT AS EXPECTED (exit ' + str(code) + ')'} ({len(ran)} test(s) ran, {secs} s) | {summary}")
    if any(t[0] == LIVE for c in chosen for t in c[5]) or probes:
        code, st, summary, secs, raw = vitest("test/export-live.test.ts", None, True)
        open(f"{RAW}/baseline-live.txt", "w").write(raw)
        ok = code == 0 and len(st) == 10 and all(v == "passed" for v in st.values())
        baseline_ok &= ok
        say(f"  test/export-live.test.ts, in full, under the lock: {'all ' + str(len(st)) + ' passed' if ok else 'NOT AS EXPECTED (exit ' + str(code) + ')'} ({secs} s) | {summary}")

    # 2. The controls.
    say("")
    say("2. The controls of section 5 (S1 to S31) and of the safeguards the builders added with a test of their own.")
    all_failed = True
    results = []
    for cid, sg, label, reps, regen, tests in chosen:
        texts, problem = apply(reps)
        if problem:
            all_failed = False
            say(f"{cid} ({sg}) {label}: NOT APPLIED ({problem})")
            results.append((cid, False))
            continue
        for p, t in texts.items():
            open(p, "w", encoding="utf8").write(t)
        lines = []
        every = True
        try:
            if regen:
                g = run(["npx", "tsx", "scripts/app-compose.ts"])
                lines.append(f"    compose.yaml written again from app-compose.ts: exit {g.returncode}")
            for f, name, target in tests:
                live = f == LIVE
                code, st, summary, secs, raw = vitest("test/export-live.test.ts" if live else f, name, live)
                open(f"{RAW}/{cid}{'-live' if live else ''}.txt", "a").write(raw)
                hit = named(st, target)
                failed_target = bool(hit) and all(v == "failed" for v in hit.values())
                ok = code != 0 and failed_target
                every &= ok
                where = "test/export-live.test.ts (live, in full, under the lock)" if live else f"{f} -t \"{name}\""
                lines.append(f"    {where}: exit {code}, {secs} s; the test \"{target}\": {'FAILED, as it must' if ok else 'DID NOT FAIL'} | {summary}")
                for k, v in st.items():
                    if v == "failed":
                        lines.append(f"      failed: {k.split(' > ')[-1][:150]}")
                e = first_error(raw)
                if e:
                    lines.append(f"      first error line: {e}")
        finally:
            run(["git", "-C", WT, "checkout", "HEAD", "--", *[os.path.relpath(p, WT) for p in texts], TPL + "/compose.yaml"])
        restored = run(["git", "-C", WT, "status", "--porcelain", "--", *scope]).stdout == ""
        all_failed &= every and restored
        results.append((cid, every and restored))
        say(f"{cid} ({sg}) {label}: {'FAILED, as it should with the safeguard removed' if every else 'NOT AS EXPECTED: a test did not fail'}{'' if restored else '; TREE NOT RESTORED'}")
        for f, old, new in reps:
            say(f"    in {f}: {old.strip()[:140]!r} -> {new.strip()[:140]!r}")
        for l in lines:
            say(l)

    # 3. The probes.
    probe_results = []
    if probes:
        say("")
        say("3. Checks the builders added (design section 13, C3 and C4) that no test names: each removed, the live file run in full, to see")
        say("   whether any test sees the removal. Reported apart; not counted in the controls' result.")
        for pid, note, label, reps in probes:
            texts, problem = apply(reps)
            if problem:
                say(f"{pid} ({note}) {label}: NOT APPLIED ({problem})")
                continue
            for p, t in texts.items():
                open(p, "w", encoding="utf8").write(t)
            try:
                code, st, summary, secs, raw = vitest("test/export-live.test.ts", None, True)
                open(f"{RAW}/{pid}-live.txt", "w").write(raw)
            finally:
                run(["git", "-C", WT, "checkout", "HEAD", "--", *[os.path.relpath(p, WT) for p in texts]])
            restored = run(["git", "-C", WT, "status", "--porcelain", "--", *scope]).stdout == ""
            failed = [k.split(" > ")[-1][:150] for k, v in st.items() if v == "failed"]
            probe_results.append((pid, bool(failed)))
            say(f"{pid} ({note}) {label}: {'a test failed' if failed else 'NO TEST FAILED: no test sees this removal'}{'' if restored else '; TREE NOT RESTORED'} (exit {code}, {secs} s) | {summary}")
            for f, old, new in reps:
                say(f"    in {f}: {old.strip()[:140]!r} -> {new.strip()[:140]!r}")
            for l in failed:
                say(f"      failed: {l}")

    after = run(["git", "-C", WT, "status", "--porcelain", "--", *scope]).stdout
    docker_end = docker_lists()
    say("")
    say(f"After every control: `git status --porcelain -- builder templates` empty: {'yes' if after == '' else 'NO: ' + after}")
    say(f"`git diff HEAD --stat -- builder templates`: {run(['git', '-C', WT, 'diff', 'HEAD', '--stat', '--', *scope]).stdout.strip() or '(empty)'}")
    for what in docker_start:
        new = sorted(set(docker_end[what]) - set(docker_start[what]))
        gone = sorted(set(docker_start[what]) - set(docker_end[what]))
        say(f"Docker {what}: {len(docker_start[what])} before, {len(docker_end[what])} after; new: {new or 'none'}; gone: {gone or 'none'}")
    n_ok = sum(1 for _, ok in results if ok)
    say(f"Result: baseline {'every named test passed' if baseline_ok else 'NOT AS EXPECTED'}; controls: {len(results)} run, {n_ok} failed their tests as they should"
        + ("" if n_ok == len(results) else f"; NOT as expected: {', '.join(c for c, ok in results if not ok)}") + ".")
    if probes:
        say(f"Probes: {len(probe_results)} run; a test saw the removal in {sum(1 for _, f in probe_results if f)}; no test saw it in {', '.join(p for p, f in probe_results if not f) or 'none'}.")
