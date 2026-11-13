/**
 * Evidence run for package 3.1: the acceptance store and runner, against example 1's app built by the
 * scripted engine, with stand-in tests (written in advance by Claude Code; the owner's answer to question
 * 12, option (a)).
 *
 * Usage (from builder/): npx tsx scripts/demo-acceptance.ts <outDir>
 * Settings: BUILDER_DATA_DIR (a folder outside the repository; the store is made there),
 * BUILDER_BROWSER_CACHE (the folder holding the approved browser zip), BUILDER_DATABASE_URL (the
 * builder's database, for the events; default: the local development database), HTTPS_PROXY (the cloud
 * session's proxy, for the image builds).
 *
 *  1. The runner image, built from builder/runner/ with the zip from the cache; its whole package list.
 *  2. A sandbox for example 1; the project's row; the stand-in tests written into the store as a new
 *     version, BEFORE step 01 runs.
 *  3. Steps 01 and 02 by the scripted engine, each container inspected while it runs.
 *  4. The app built and started. Acceptance run A: Done means (1), item 1 passes with its screenshot.
 *  5. Run B1, stopped by a short time limit, and run B2, killed while its test runs: Done means (3),
 *     every item "did not run".
 *  6. Done means (4): attempts from the engine container by file path, over the network, through the
 *     project's database and through the project's history; its mounts; checks on the machine alongside.
 *  7. Run C, with the app stopped: refused before its start, every item "did not run" (Done means (3)).
 *  8. The passing sandbox removed. A fresh sandbox, same project id: steps 01, 02 and the deliberately
 *     broken 03; run D with the same version: Done means (2), item 1 failed, its step named.
 *  9. Everything of the projects removed; the runner image is kept (it is built once per builder).
 *
 * Every attempt is made from inside a container; no browser runs on this machine (known gap 55).
 * Development profile only. No model is called. Made-up data only. No secret's value is printed.
 */
import { execFile } from "node:child_process";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { buildRunnerImage, RUNNER_BASE_IMAGES, RUNNER_IMAGE } from "../src/acceptance/runner-image.js";
import { runAcceptance, type AcceptanceReport } from "../src/acceptance/runner.js";
import { FILE_PROBE, halves, historyCheck, inspectWhileRunning, parseProbe, searchFolders, searchText, type InspectSeen, type Needle } from "../src/acceptance/probes.js";
import { dataDirFromSetting, openStore, projectDir } from "../src/acceptance/store.js";
import { exampleChecklist, writeStandInVersion } from "../src/acceptance/stand-in.js";
import { git } from "../src/engine/project-repo.js";
import { parseProbeOutput, readMachineSide, sessionProxyHostPort } from "../src/sandbox/isolation.js";
import { dockerEnv, engineMountRefusal, sandbox, type StreamingRun } from "../src/sandbox/manager.js";
import { createPool } from "../src/store/db.js";
import { listEvents } from "../src/store/events.js";
import { migrate } from "../src/store/migrate.js";
import { createProject } from "../src/store/projects.js";
import { buildAndStart, builderDir, destroyExample1, makeExample1, runStep, stageBrokenStep, type Example1 } from "./example-1-sandbox.js";

const run = promisify(execFile);
const outArg = process.argv[2];
if (!outArg) {
  console.error("usage: demo-acceptance.ts <outDir>");
  process.exit(1);
}
const outDir = resolve(outArg);
mkdirSync(join(outDir, "screens"), { recursive: true });
const log = (s = "") => console.log(s);
const indent = (s: string, pad = "  ") => s.split("\n").map((l) => pad + l).join("\n");
const freeDisk = () => {
  const s = statfsSync(tmpdir());
  return `${((s.bavail * s.bsize) / 1e9).toFixed(1)} GB free on the folder for temporary files`;
};
const PROJECT_ID = `demo_acc_${Date.now().toString(36)}`;
const APP_PORT = 3141;
const DB_PORT = 5571;
const ISOLATION_PROBE = join(builderDir, "scripts", "isolation-probe.mjs");
const keep: Record<string, unknown> = {};
const table: Array<{ route: string; attempt: string; from: string; result: string; failed: boolean }> = [];
const add = (route: string, attempt: string, from: string, result: string, failed: boolean) => table.push({ route, attempt, from, result, failed });

/** Run steps with every engine container inspected while it runs. */
async function steps(x: Example1, ids: string[], label: string) {
  const seen: Array<{ step: string; inspect: InspectSeen; args: string[]; volumes: string[] }> = [];
  for (const id of ids) {
    if (id === "03-wrong-status") {
      stageBrokenStep(x);
      log(`  The deliberately broken change set 03-wrong-status copied into the sandbox's change sets now, just before its step (from builder/scripted-broken).`);
    }
    let inspecting: Promise<InspectSeen> | null = null;
    let handle: StreamingRun | null = null;
    let vols: string[] = [];
    const res = await runStep(x, id, {
      delayMsPerWrite: 800,
      onContainer: (r, volumes) => {
        handle = r;
        vols = volumes;
        inspecting = inspectWhileRunning(r, dockerEnv(x.sb));
      },
    });
    const ins = await inspecting!;
    if (!res.ok) throw new Error(`step ${id} failed: ${res.failureReason}`);
    const h = handle as StreamingRun | null;
    seen.push({ step: id, inspect: ins, args: h?.args ?? [], volumes: vols });
    log(`  step ${id}: ${res.changedFiles.length} files changed, committed as ${(await git(x.repo, ["log", "-1", "--format=%s"])).trim()}`);
    log(`    docker inspect answered while the container ran: ${ins.whileRunning ? "yes" : "NO"}${ins.problem ? ` (${ins.problem})` : ""}; network: ${ins.networkMode}; user: ${ins.user}`);
    for (const m of ins.mounts) log(`    mount ${m.Destination}  <-  ${m.Source}  (${m.RW ? "read-write" : "read-only"})`);
    if (!ins.whileRunning) throw new Error(`the evidence needs docker inspect to answer while step ${id}'s container ran, and it did not`);
  }
  keep[`engine-mounts-${label}`] = seen;
  return seen;
}

/** The runner's mounts: inspected while the run goes on. */
function inspectRunner(env: NodeJS.ProcessEnv) {
  let p: Promise<InspectSeen> | null = null;
  return { onStarted: (r: StreamingRun) => void (p = inspectWhileRunning(r, env)), seen: () => p };
}

function showRun(name: string, r: AcceptanceReport) {
  log(`  run ${r.runId}, version ${r.version} (manifest ${r.manifestSha256?.slice(0, 12)}…), written by: ${r.writtenBy} (label "stand-in test")`);
  log(`  refused before the start: ${r.refused ?? "no"}; container exit: ${r.exit ? `code ${r.exit.code}${r.exit.timedOut ? ", stopped at its time limit" : ""}` : "no container started"}`);
  for (const it of r.reading.items) log(`  item ${it.number} (${it.file}): ${it.status.toUpperCase()}: ${it.why}${it.step ? `; step: "${it.step}"` : ""}`);
  log(`  result: ${r.reading.summary}`);
  keep[`run-${name}`] = { runId: r.runId, refused: r.refused, appAnswered: r.appAnswered, exit: r.exit && { code: r.exit.code, timedOut: r.exit.timedOut ?? false }, args: r.args, items: r.reading.items.map(({ errorText: _e, ...i }) => i), summary: r.reading.summary, runProblems: r.reading.runProblems, events: r.events.map((e) => ({ id: e.id, kind: e.kind, payload: e.payload })) };
}

const t0 = Date.now();
const pool = createPool();
let x: Example1 | null = null;
let dataDir = "";
try {
  log(`Package 3.1 demonstration, ${new Date().toISOString()}. Development profile, cloud session. No model is called.`);
  log(`Before: ${freeDisk()}.`);
  await migrate(pool);
  dataDir = dataDirFromSetting();

  log("");
  log("== 1. The runner image (builder/runner/), built on this machine and kept here: never pushed ==");
  const img = await buildRunnerImage({ hostProxy: { url: process.env.HTTPS_PROXY ?? "", caBundlePath: "/root/.ccr/ca-bundle.crt" } });
  log(`  Bases: ${RUNNER_BASE_IMAGES.ubuntu}; ${RUNNER_BASE_IMAGES.node}.`);
  log(`  Browser zip from the cache: ${img.zip.bytes} bytes, SHA-256 ${img.zip.sha256} (the approved one; checked before the build and again inside it).`);
  log(`  Image ${img.image} = ${img.imageId}.`);
  const checks = img.buildLog.split("\n").filter((l) => /PACKAGE CHECK|All system dependencies|Missing system|: OK$|newly installed/.test(l)).map((l) => l.replace(/^#\d+ [\d.]+ /, ""));
  if (checks.length) log(indent("from the build's own output (empty when the steps came from Docker's build cache):\n" + checks.join("\n"), "  "));
  log(`  Packages in the image, read from a container of it after the build: ${img.packages.length} = ${img.basePackages.length} of the base image + ${img.added.length} added.`);
  log(`  Added, compared with the approved list of 109 (docs/licences/raw/ubuntu-runner-packages.tsv): ${img.problems.length === 0 ? "exactly the approved packages at the approved versions; no package of the base image changed" : "DIFFERENT: " + img.problems.join("; ")}.`);
  for (const [k, v] of Object.entries(img.facts)) log(`  ${k}: ${v}`);
  writeFileSync(join(outDir, "runner-packages.txt"), [`Runner image ${img.image} ${img.imageId}, read ${new Date().toISOString()}`, `Base: ${RUNNER_BASE_IMAGES.ubuntu}`, "", `Whole image (${img.packages.length}):`, ...img.packages, "", `Of the base image (${img.basePackages.length}):`, ...img.basePackages, "", `Added (${img.added.length}):`, ...img.added, "", `Problems: ${img.problems.length ? img.problems.join("; ") : "none"}`].join("\n") + "\n");
  writeFileSync(join(outDir, "runner-image-build.txt"), img.buildLog);
  if (img.problems.length) throw new Error("the runner image is not as approved");

  log("");
  log("== 2. A sandbox for example 1; the stand-in tests written into the store before step 01 ==");
  x = await makeExample1({ projectId: PROJECT_ID, appPort: APP_PORT, dbPort: DB_PORT, runnerImage: RUNNER_IMAGE });
  const store = openStore(dataDir, { refuse: [x.dir] });
  log(`  Sandbox ${x.sb.projectName} in a temporary folder; the store at $BUILDER_DATA_DIR/acceptance (mode ${(statMode(store.root))}), outside the repository and the sandbox.`);
  for (const source of x.sb.engineMountSources ?? []) log(`  engine mount source ${source}: mount rule ${engineMountRefusal(source) ?? "allows it (not the data folder, not inside it, not above it)"}`);
  await createProject(pool, { id: PROJECT_ID, name: "Package 3.1 demonstration (made-up)", capUsd: 0 });
  const version = await writeStandInVersion(pool, store, PROJECT_ID, "example-1");
  const vdir = join(projectDir(store, PROJECT_ID), version.version);
  log(`  Version ${version.version} written: manifest SHA-256 ${version.manifestSha256}; written_by "${version.manifest.written_by}"; items: ${version.manifest.items.map((i) => `${i.number} (${i.file}, ${i.sha256.slice(0, 12)}…)`).join(", ")}.`);
  log(`  The marker is in the manifest and in each test file's label line; it is not printed here, and the event does not hold it.`);
  const checklist = exampleChecklist("example-1");
  log(`  The app spec's checklist has ${checklist.items.length} items; the version has a test for ${version.manifest.items.length}.`);
  const marker = version.manifest.marker;
  const phrase = "the AI assistant building this project), not by the builder's acceptance writer";

  log("");
  log("== 3. Steps 01 and 02, each in a fresh engine container, inspected while it runs ==");
  const passSteps = await steps(x, ["01-data", "02-submitter-screen"], "passing");
  const passTree = (await git(x.repo, ["rev-parse", "HEAD^{tree}"])).trim();

  log("");
  log("== 4. The app built and started; run A: the stand-in test against it ==");
  await buildAndStart(x, log);
  const ri = inspectRunner(dockerEnv(x.sb));
  const runA = await runAcceptance({ pool, sandbox: x.sb, store, projectId: PROJECT_ID, version: version.version, appUrl: x.appUrl, samplePassword: x.samplePassword, checklistItems: checklist.items.length, onStarted: ri.onStarted });
  showRun("A-pass", runA);
  const runnerSeen = await ri.seen();
  if (runnerSeen) {
    log(`  The runner's container, inspected while it ran (${runnerSeen.whileRunning ? "yes" : "NO"}): network ${runnerSeen.networkMode}, user ${runnerSeen.user}`);
    for (const m of runnerSeen.mounts) log(`    mount ${m.Destination}  <-  ${m.Source}  (${m.RW ? "read-write" : "read-only"})`);
    keep["runner-mounts"] = runnerSeen;
  }
  log(`  The command: ${(runA.args ?? []).map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}`);
  const passItem = runA.reading.items.find((i) => i.number === 1);
  if (passItem?.status !== "passed" || !passItem.screenshot) throw new Error("run A: item 1 did not pass");
  copyFileSync(passItem.screenshot.path, join(outDir, "screens", "01-item-1-passed-stand-in-test.png"));
  log(`  Screenshot kept: screens/01-item-1-passed-stand-in-test.png (SHA-256 ${passItem.screenshot.sha256}).`);
  const reason = `stand-in test run ${runA.runId}`;
  // The runner's own mounts, from inside: a probe in the same service with the version and a fresh folder.
  const probeRes = mkdtempSync(join(tmpdir(), "builder-runner-probe-"));
  const mi: string[] = [];
  await sandbox.runStreaming(x.sb, "acceptance", ["node", "-e", "console.log(require('node:fs').readFileSync('/proc/self/mountinfo','utf8'))"], { container: `${x.sb.projectName}-acceptance-mounts`, volumes: [`${vdir}:/acceptance:ro`, `${probeRes}:/results`], onLine: (l) => mi.push(l) }).done;
  rmSync(probeRes, { recursive: true, force: true });
  keep["runner-mountinfo"] = mi;
  log(`  The runner service's /proc/self/mountinfo, from inside (same service, the version and a fresh results folder): ${mi.length} lines, kept in mounts.json.`);

  log("");
  log("== 5. Runs B1 and B2: a run stopped by a time limit, and a run killed while its test runs ==");
  log("  (A first trial gave run B a 3-second limit; the app was warm by then and the test passed within it, so it was reported passed, correctly. The limit is now half a second, shorter than the container takes to start.)");
  const runB = await runAcceptance({ pool, sandbox: x.sb, store, projectId: PROJECT_ID, version: version.version, appUrl: x.appUrl, samplePassword: x.samplePassword, checklistItems: checklist.items.length, timeoutMs: 500 });
  showRun("B1-time-limit", runB);
  if (runB.reading.items.some((i) => i.status !== "did not run")) throw new Error("run B1: an item is reported as something other than did not run");
  let handleB2: StreamingRun | null = null;
  let killedAfter = "";
  const runB2 = await runAcceptance({
    pool, sandbox: x.sb, store, projectId: PROJECT_ID, version: version.version, appUrl: x.appUrl, samplePassword: x.samplePassword, checklistItems: checklist.items.length,
    onStarted: (r) => (handleB2 = r),
    onLine: (l) => {
      if (!killedAfter && /Running 1 test/.test(l) && handleB2) {
        killedAfter = l.trim();
        void (handleB2 as StreamingRun).kill();
      }
    },
  });
  log(`  B2: killed with docker kill as soon as the runner printed "${killedAfter}".`);
  showRun("B2-killed", runB2);
  if (runB2.reading.items.some((i) => i.status !== "did not run")) throw new Error("run B2: an item is reported as something other than did not run");

  log("");
  log("== 6. From inside the engine container: attempts to reach the store; its mounts; checks on the machine ==");
  const needles: Needle[] = [
    { label: "the version's marker", text: marker },
    { label: "a phrase of the test's source", text: phrase },
    { label: "the run's reason (run A)", text: reason },
  ];
  const probeDir = mkdtempSync(join(tmpdir(), "builder-acceptance-probe-"));
  // The engine runs as the user node: the probe's folder (made 0700 by mkdtemp) must be readable by it.
  chmodSync(probeDir, 0o755);
  writeFileSync(join(probeDir, "acceptance-probe.mjs"), FILE_PROBE, { mode: 0o644 });
  const paths = [
    { label: "the store's data folder", path: dataDir },
    { label: "the store ($BUILDER_DATA_DIR/acceptance)", path: store.root },
    { label: "the project's folder in the store", path: projectDir(store, PROJECT_ID) },
    { label: "the version", path: vdir },
    { label: "a test file of the version", path: join(vdir, "item-01.spec.ts") },
    { label: "the version's manifest", path: join(vdir, "manifest.json") },
    { label: "run A's folder", path: runA.runFolder.dir },
    { label: "the repository's stand-in-acceptance/", path: resolve(builderDir, "..", "stand-in-acceptance") },
    { label: "the repository's evidence/", path: resolve(builderDir, "..", "evidence") },
    { label: "/acceptance (where the runner sees the version)", path: "/acceptance" },
    { label: "/results (where the runner writes)", path: "/results" },
    { label: "/workspace/.git (a history inside the workspace)", path: "/workspace/.git" },
    { label: "the project's history folder, by its path on the machine", path: x.repo.gitDir },
  ];
  const step02Mounts = passSteps[1]!.volumes;
  const fileLines: string[] = [];
  const fileRun = sandbox.runStreaming(x.sb, "engine", ["node", "/probe/acceptance-probe.mjs", JSON.stringify({ paths, needles: needles.map(halves) })], {
    container: `${x.sb.projectName}-engine-acceptance-probe`,
    volumes: [`${probeDir}:/probe:ro`, ...step02Mounts],
    onLine: (l) => fileLines.push(l),
    timeoutMs: 300_000,
  });
  const fileInspect = await inspectWhileRunning(fileRun, dockerEnv(x.sb));
  const fileEnd = await fileRun.done;
  rmSync(probeDir, { recursive: true, force: true });
  const probe = parseProbe(fileLines);
  if (fileEnd.code !== 0 || !probe.some((p) => p.kind === "end")) throw new Error(`the file probe did not finish (exit ${fileEnd.code}): ${fileEnd.stderrTail.slice(-500)}`);
  log(`  The file probe ran in the engine service with step 02's own mounts (the protected paths) and itself at /probe; user ${JSON.stringify(probe.find((p) => p.kind === "who"))}.`);
  for (const p of probe.filter((q) => q.kind === "path")) {
    const failed = /^not found|not readable/.test(String(p.result));
    log(`  by file path: ${p.label}: ${p.path} -> ${p.result}`);
    add("By file path", `${p.label} (${p.path})`, "engine container", String(p.result), failed);
  }
  const search = probe.find((p) => p.kind === "search") as unknown as { files: number; bytes: number; unreadable: number; skippedLarge: number; found: Record<string, string[]> };
  log(`  search of every file it could read: ${search.files} files, ${search.bytes} bytes; ${search.unreadable} not readable; ${search.skippedLarge} larger than 64 MB skipped.`);
  for (const n of needles) {
    const hits = search.found[n.label] ?? [];
    log(`    ${n.label}: found in ${hits.length} files${hits.length ? ": " + hits.join(", ") : ""}`);
    add("By file path", `search every readable file for ${n.label}`, "engine container", `found in ${hits.length} of ${search.files} files`, hits.length === 0);
  }
  const mountinfo = (probe.find((p) => p.kind === "mountinfo")?.lines as string[]) ?? [];
  keep["engine-mountinfo"] = mountinfo;
  keep["engine-probe-inspect"] = fileInspect;
  const accMount = mountinfo.filter((l) => / \/acceptance | \/results /.test(l) || l.includes(store.root));
  log(`  /proc/self/mountinfo inside, unfiltered: ${mountinfo.length} lines (mounts.json); lines naming /acceptance, /results or the store: ${accMount.length}.`);
  add("Mounts", "/proc/self/mountinfo inside the engine container: a mount at /acceptance or /results, or from the store", "engine container", `${accMount.length} of ${mountinfo.length} lines`, accMount.length === 0);
  const allEngineMounts = [...passSteps.flatMap((s) => s.inspect.mounts), ...fileInspect.mounts];
  const fromStore = allEngineMounts.filter((m) => (m.Source ?? "").startsWith(dataDir) || m.Destination === "/acceptance" || m.Destination === "/results");
  add("Mounts", `docker inspect of steps 01 and 02 and of the probe, while each ran: a mount from the store, or at /acceptance or /results`, "the machine (docker inspect)", `${fromStore.length} of ${allEngineMounts.length} mounts`, fromStore.length === 0);

  // Over the network: 0.6a's probe, unchanged, in the engine service.
  const machine = await readMachineSide(dockerEnv(x.sb));
  const settings = JSON.stringify({ sessionProxy: sessionProxyHostPort(process.env.HTTPS_PROXY), projectDbPort: DB_PORT, egressPort: 3128, gatewayPort: 4010, builderDbPort: 5432, exampleAddress: "93.184.215.14", timeoutMs: 5000, ...machine });
  const netLines: string[] = [];
  const netEnd = await sandbox.runStreaming(x.sb, "engine", ["node", "/probe/isolation-probe.mjs", settings], { container: `${x.sb.projectName}-engine-network-probe`, volumes: [`${ISOLATION_PROBE}:/probe/isolation-probe.mjs:ro`], onLine: (l) => netLines.push(l), timeoutMs: 300_000 }).done;
  const net = parseProbeOutput(netLines);
  if (netEnd.code !== 0 || !net.ended) throw new Error(`the network probe did not finish: ${net.problems.join("; ")}`);
  const NOTE = "scripted engine container, no network at all (gap 50); says nothing about 2.2";
  for (const a of net.attempts) {
    const own = a.target.startsWith("127.0.0.1") ? " (127.0.0.1 here is the container's own loopback, not the machine's)" : "";
    const answered = /^(connected|HTTP|proxy answered|found|certificate|secure|connection reset|proxy closed|not an HTTP)/.test(a.result);
    const route = a.id === "C5" || a.id === "C7" ? "Through the database" : "Over the network";
    add(route, `${a.id} ${a.what}: ${a.target} [${a.how}]${own}`, "engine container", `${a.result}; ${NOTE}`, !answered);
  }
  log(`  network probe (0.6a's isolation-probe.mjs, unchanged): ${net.attempts.length} attempts; answered: ${net.attempts.filter((a) => /^(connected|HTTP|proxy answered|found)/.test(a.result)).length}. ${NOTE}.`);
  writeFileSync(join(outDir, "probe-engine-network.jsonl"), netLines.join("\n") + "\n");

  // Through the project's database, from the machine: dumps searched.
  const dump = await sandbox.exec(x.sb, "db", ["pg_dump", "-U", "app", "-d", "app", "-p", String(DB_PORT), "--data-only"]);
  const dumpHits = searchText(dump, needles);
  const evs = await listEvents(pool, PROJECT_ID);
  const evText = evs.map((e) => JSON.stringify(e.payload)).join("\n");
  const evHits = searchText(evText, needles);
  log(`  project database dump (${dump.length} bytes): ${JSON.stringify(dumpHits)}`);
  log(`  the builder's events for the project (${evs.length} rows): ${JSON.stringify(evHits)}`);
  add("Through the database", "a dump of the project's database (pg_dump, data only), searched for the marker and the phrase", "the machine", `marker ${dumpHits[needles[0]!.label]}, phrase ${dumpHits[needles[1]!.label]}; the run's reason ${dumpHits[needles[2]!.label]} (the request run A typed is there by design)`, dumpHits[needles[0]!.label] === 0 && dumpHits[needles[1]!.label] === 0);
  add("Through the database", "the builder's events for the project, searched for the marker and the phrase", "the machine", `marker ${evHits[needles[0]!.label]}, phrase ${evHits[needles[1]!.label]}, reason ${evHits[needles[2]!.label]}`, evHits[needles[0]!.label] === 0 && evHits[needles[1]!.label] === 0);

  // Through the project's history.
  const hist = await historyCheck(x.repo.gitDir, needles);
  log(`  the project's history: ${hist.revisions} revisions, ${hist.fileNames} file names; acceptance files: ${hist.acceptanceFiles.length ? hist.acceptanceFiles.join(", ") : "none"}; ${JSON.stringify(hist.found)}`);
  add("Through the history", "git log --all --name-only: an acceptance file (item-NN.spec.ts, manifest.json, acceptance/)", "the machine (git reads the history; runs nothing)", `${hist.acceptanceFiles.length} of ${hist.fileNames} file names`, hist.acceptanceFiles.length === 0);
  for (const n of needles) add("Through the history", `git grep in every revision (${hist.revisions}) for ${n.label}`, "the machine", `${hist.found[n.label]} files`, hist.found[n.label] === 0);
  // The marker, from the machine, in the source folder of every engine mount.
  // The probe's own folder (/probe) was made for the probe and is already removed; every other source is searched.
  const sources = [...new Set(allEngineMounts.filter((m) => m.Destination !== "/probe").map((m) => m.Source!).filter(Boolean))];
  const hostSearch = searchFolders(sources, needles);
  log(`  the source folders of the engine's mounts (${sources.length}), from the machine: ${hostSearch.files} files; ${JSON.stringify(Object.fromEntries(Object.entries(hostSearch.found).map(([k, v]) => [k, v.length])))}`);
  for (const n of needles) add("By file path", `the source folders of every engine mount (${sources.length}), searched from the machine for ${n.label}`, "the machine", `found in ${hostSearch.found[n.label]!.length} of ${hostSearch.files} files`, hostSearch.found[n.label]!.length === 0);

  log("");
  log("== 7. Run C: the app stopped first ==");
  await sandbox.stop(x.sb, ["app"]);
  const runC = await runAcceptance({ pool, sandbox: x.sb, store, projectId: PROJECT_ID, version: version.version, appUrl: x.appUrl, samplePassword: x.samplePassword, checklistItems: checklist.items.length });
  showRun("C-app-stopped", runC);
  if (runC.exit !== null || runC.reading.items.some((i) => i.status !== "did not run")) throw new Error("run C: a container was started, or an item is not did not run");

  log("");
  log("== 8. The passing sandbox removed; a fresh one, same project id, with the deliberately broken step 03 ==");
  log(`  ${await destroyExample1(x)}`);
  x = await makeExample1({ projectId: PROJECT_ID, appPort: APP_PORT, dbPort: DB_PORT, runnerImage: RUNNER_IMAGE });
  openStore(dataDir, { refuse: [x.dir] });
  await steps(x, ["01-data", "02-submitter-screen", "03-wrong-status"], "broken");
  const brokenStep02Tree = (await git(x.repo, ["rev-parse", "HEAD~1^{tree}"])).trim();
  log(`  step 02's tree in the passing history: ${passTree}; in the broken history (HEAD~1): ${brokenStep02Tree}; the same: ${passTree === brokenStep02Tree ? "yes" : "NO"}`);
  await buildAndStart(x, log);
  const runD = await runAcceptance({ pool, sandbox: x.sb, store, projectId: PROJECT_ID, version: version.version, appUrl: x.appUrl, samplePassword: x.samplePassword, checklistItems: checklist.items.length });
  showRun("D-broken-copy", runD);
  const failItem = runD.reading.items.find((i) => i.number === 1);
  if (failItem?.status !== "failed") throw new Error("run D: item 1 was not reported as failed");
  log(`  the same version as run A: ${runD.manifestSha256 === runA.manifestSha256 ? "yes" : "NO"} (manifest ${runD.manifestSha256})`);
  log(indent(`Playwright's error for item 1 (kept in the run's builder folder; the event holds its path and fingerprint):\n${(failItem.errorText ?? "").split("\n").slice(0, 6).join("\n")}`, "  "));
  if (failItem.screenshot) {
    copyFileSync(failItem.screenshot.path, join(outDir, "screens", "02-item-1-failed-broken-copy-stand-in-test.png"));
    log(`  Screenshot kept: screens/02-item-1-failed-broken-copy-stand-in-test.png (SHA-256 ${failItem.screenshot.sha256}).`);
  }
  keep["tree"] = { passStep02Tree: passTree, brokenStep02Tree };

  log("");
  log("== The attempts, one row each ==");
  const md = ["| # | Route | Attempt | From | Result | Failed, as it should |", "| --- | --- | --- | --- | --- | --- |", ...table.map((r, i) => `| ${i + 1} | ${r.route} | ${r.attempt.replace(/\|/g, "\\|")} | ${r.from} | ${r.result.replace(/\|/g, "\\|")} | ${r.failed ? "yes" : "**NO**"} |`)];
  writeFileSync(join(outDir, "attempts-table.md"), md.join("\n") + "\n");
  for (const r of table) log(`  [${r.failed ? "failed, as it should" : "NOT FAILED"}] ${r.route}: ${r.attempt} -> ${r.result}`);
  const notFailed = table.filter((r) => !r.failed);
  log(`  ${table.length} attempts; ${notFailed.length} did not fail.`);
  const events = await listEvents(pool, PROJECT_ID);
  writeFileSync(join(outDir, "events.json"), JSON.stringify(events.map((e) => ({ id: e.id, at: e.at, kind: e.kind, step: e.step, payload: e.payload })), null, 2) + "\n");
  writeFileSync(join(outDir, "mounts.json"), JSON.stringify(keep, null, 2) + "\n");
  log(`  Event rows for the project: ${events.length} (events.json): ${[...new Set(events.map((e) => e.kind))].join(", ")}.`);
  if (notFailed.length) throw new Error("an attempt to reach the store did not fail");
  log("");
  log(`Whole run: ${Math.round((Date.now() - t0) / 1000)} s.`);
} catch (err) {
  const e = err as { stdout?: string; stderr?: string; message?: string };
  log("FAILED: " + (e.message ?? String(err)));
  if (e.stderr) log(e.stderr.slice(-3000));
  process.exitCode = 1;
} finally {
  if (x) log(`Clean-up: ${await destroyExample1(x)}.`);
  await pool.end();
  log(`After: ${freeDisk()}.`);
}

function statMode(p: string): string {
  return (lstatSync(p).mode & 0o777).toString(8);
}
