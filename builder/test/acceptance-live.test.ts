/**
 * Package 3.1, live: the acceptance runner against example 1's app built by the scripted engine, on the
 * development profile, with the stand-in test (written in advance by Claude Code; owner, question 12 (a)).
 *
 * These start containers and need the approved browser zip. They are never skipped (package 3.1b; the
 * third outside review supplied by the owner, item 3): when Docker does not answer, BUILDER_BROWSER_CACHE
 * is not set, or the folder it names does not hold the approved zip, the first test fails, naming what is
 * missing and how to put it right, and every other test here fails with the same words before it starts
 * anything. So `npm test` cannot pass while the browser was not exercised. scripts/demo-acceptance.ts
 * shows the same runs with evidence; scripts/fetch-browser.ts fetches the zip.
 */
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FILE_PROBE, halves, historyCheck, inspectWhileRunning, parseProbe, traceFiles, traceScreenFrames, zipEntryNames, type InspectSeen } from "../src/acceptance/probes.js";
import { liveAcceptanceProblems } from "../src/acceptance/prerequisites.js";
import { buildRunnerImage, RUNNER_IMAGE, runnerImageProblem } from "../src/acceptance/runner-image.js";
import { runAcceptance } from "../src/acceptance/runner.js";
import { exampleChecklist, writeStandInVersion } from "../src/acceptance/stand-in.js";
import { openStore, projectDir, type AcceptanceStore, type WrittenVersion } from "../src/acceptance/store.js";
import { git } from "../src/engine/project-repo.js";
import { DATA_DIR_SETTING, dockerEnv, sandbox, type StreamingRun } from "../src/sandbox/manager.js";
import { listEvents } from "../src/store/events.js";
import { createProject } from "../src/store/projects.js";
import { buildAndStart, destroyExample1, makeExample1, runStep, stageBrokenStep, type Example1 } from "../scripts/example-1-sandbox.js";
import { testPool, uniqueId } from "./helpers.js";

// Read once, before any test: Docker answers, and the approved zip is in the folder BUILDER_BROWSER_CACHE names.
const missing = await liveAcceptanceProblems();
/** Every live test starts with this: with a prerequisite missing it fails, in plain words, before it starts anything. */
const needsPrerequisites = () => {
  if (missing.length) throw new Error(`This live acceptance test cannot exercise the browser, so it fails (it is never skipped). Missing: ${missing.join(" ")}`);
};

describe("acceptance runner: live, development profile, stand-in test", () => {
  const APP_PORT = 3151;
  const DB_PORT = 5581;
  const projectId = uniqueId("p_acc_live");
  let pool: pg.Pool;
  let dataDir: string;
  let store: AcceptanceStore;
  let x: Example1 | null = null;
  let version: WrittenVersion;
  let passTree = "";
  const checklistItems = exampleChecklist("example-1").items.length;
  const go = (timeoutMs?: number) => runAcceptance({ pool, sandbox: x!.sb, store, projectId, version: version.version, appUrl: x!.appUrl, samplePassword: x!.samplePassword, checklistItems, timeoutMs });

  // The engine mount rule reads BUILDER_DATA_DIR (known gap 76): set to this test's data folder, so that the rule
  // is on for every engine run here, as it is in the demonstration (review of 13 Nov 2026).
  const savedDataDir = process.env[DATA_DIR_SETTING];
  beforeAll(async () => {
    pool = await testPool();
    dataDir = mkdtempSync(join(tmpdir(), "builder-acceptance-data-"));
    process.env[DATA_DIR_SETTING] = dataDir;
  });
  afterAll(async () => {
    if (savedDataDir === undefined) delete process.env[DATA_DIR_SETTING];
    else process.env[DATA_DIR_SETTING] = savedDataDir;
    if (x) await destroyExample1(x).catch(() => undefined);
    if (dataDir && existsSync(dataDir)) {
      const open = (d: string) => {
        chmodSync(d, 0o700);
        for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) open(join(d, e.name));
      };
      open(dataDir);
      rmSync(dataDir, { recursive: true, force: true });
    }
    await pool?.end();
  });

  it("its prerequisites are here: Docker answers, and the folder BUILDER_BROWSER_CACHE names holds the approved browser zip", () => {
    needsPrerequisites();
    expect(missing).toEqual([]);
  });

  it("the runner image builds from the cached zip; it holds the base image's packages and exactly the 109 approved ones at their versions", async () => {
    needsPrerequisites();
    const img = await buildRunnerImage({ hostProxy: { url: process.env.HTTPS_PROXY ?? "", caBundlePath: "/root/.ccr/ca-bundle.crt" } });
    expect(img.problems).toEqual([]);
    expect(img.added).toHaveLength(109);
    expect(img.facts["user"]).toBe("1001 runner");
    expect(img.facts["video tool (ffmpeg) installed"]).toBe("0");
    // Package 3.1b: the image carries the approved zip's fingerprint, which a run checks before it starts.
    expect(await runnerImageProblem(RUNNER_IMAGE, process.env)).toBeNull();
  }, 1_800_000);

  it("the stand-in version is written before step 01; steps 01 and 02 run; run A: item 1 passes, with its screenshot and its events", async () => {
    needsPrerequisites();
    x = await makeExample1({ projectId, appPort: APP_PORT, dbPort: DB_PORT, runnerImage: RUNNER_IMAGE });
    store = openStore(dataDir, { refuse: [x.dir] });
    await createProject(pool, { id: projectId, name: "Package 3.1 live test (made-up)", capUsd: 0 });
    version = await writeStandInVersion(pool, store, projectId, "example-1");
    const written = await listEvents(pool, projectId, "acceptance.version.written");
    expect(written).toHaveLength(1);
    expect(written[0]!.payload).toMatchObject({ version: "v001", manifest_sha256: version.manifestSha256, written_by: "stand-in", label: "stand-in test" });
    expect(JSON.stringify(written[0]!.payload)).not.toContain(version.manifest.marker);
    for (const step of ["01-data", "02-submitter-screen"]) expect((await runStep(x, step)).ok, step).toBe(true);
    passTree = (await git(x.repo, ["rev-parse", "HEAD^{tree}"])).trim();
    await buildAndStart(x);
    const r = await go();
    expect(r.refused).toBeNull();
    expect(r.exit?.code).toBe(0);
    expect(r.reading.items).toHaveLength(1);
    expect(r.reading.items[0]).toMatchObject({ number: 1, status: "passed", title: expect.stringContaining("(stand-in test)") });
    expect(r.reading.items[0]!.screenshot?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.reading.summary).toBe("version passed; checklist incomplete (5 of the app spec's 6 checklist items have no test)");
    expect(r.reading.outcome).toBe("passed");
    expect(r.events.at(-1)!.payload.outcome).toBe("passed");
    expect(r.events.map((e) => e.kind)).toEqual(["acceptance.run.started", "acceptance.item", "acceptance.run.finished"]);
    for (const e of r.events) expect(e.payload).toMatchObject({ run_id: r.runId, version: "v001", manifest_sha256: version.manifestSha256, written_by: "stand-in" });
    expect(existsSync(r.runFolder.secretFile)).toBe(false);
    // The trace is kept, without frames of the screen (the owner's condition: no video recorded; review of 13 Nov 2026).
    const traces = traceFiles(r.runFolder.results);
    expect(traces).toHaveLength(1);
    const entries = zipEntryNames(readFileSync(traces[0]!));
    expect(traceScreenFrames(entries)).toEqual([]);
    expect(entries.filter((e) => e.endsWith(".trace")).length).toBeGreaterThan(0);
  }, 1_200_000);

  it("run B, stopped by a half-second time limit: every item 'did not run', never passed", async () => {
    needsPrerequisites();
    const r = await go(500);
    expect(r.exit?.timedOut).toBe(true);
    expect(r.reading.items.map((i) => i.status)).toEqual(["did not run"]);
    expect(r.reading.summary).toMatch(/^did not run: the run went past its time limit/);
    expect(r.reading.outcome).toBe("not passed");
    expect(r.events.find((e) => e.kind === "acceptance.item")?.payload.status).toBe("did not run");
  }, 120_000);

  it("from inside the engine container: every path to the store fails, no readable file holds the marker, a phrase of the test or the run's reason; its mounts hold nothing of the store; the history holds no acceptance file", async () => {
    needsPrerequisites();
    const vdir = join(projectDir(store, projectId), version.version);
    const needles = [
      { label: "marker", text: version.manifest.marker },
      { label: "phrase", text: "the AI assistant building this project), not by the builder's acceptance writer" },
    ];
    // The mount rule is on in this test: an engine run given the store's folder is refused before anything starts.
    expect(process.env[DATA_DIR_SETTING]).toBe(dataDir);
    expect(() => sandbox.runStreaming(x!.sb, "engine", ["true"], { container: `${x!.sb.projectName}-engine-never-started`, volumes: [`${store.root}:/x:ro`], onLine: () => undefined })).toThrow(/The engine run is refused: the mount source .* is the acceptance store's data folder or inside it/);
    const probeDir = mkdtempSync(join(tmpdir(), "builder-acceptance-probe-"));
    // The engine runs as the user node: the probe's folder (made 0700 by mkdtemp) must be readable by it.
  chmodSync(probeDir, 0o755);
  writeFileSync(join(probeDir, "acceptance-probe.mjs"), FILE_PROBE, { mode: 0o644 });
    const paths = [dataDir, store.root, vdir, join(vdir, "item-01.spec.ts"), join(vdir, "manifest.json"), "/acceptance", "/results", "/workspace/.git", x!.repo.gitDir].map((p) => ({ label: p, path: p }));
    const lines: string[] = [];
    const run: StreamingRun = sandbox.runStreaming(x!.sb, "engine", ["node", "/probe/acceptance-probe.mjs", JSON.stringify({ paths, needles: needles.map(halves) })], {
      container: `${x!.sb.projectName}-engine-acc-probe`,
      volumes: [`${probeDir}:/probe:ro`],
      onLine: (l) => lines.push(l),
      timeoutMs: 300_000,
    });
    const seen: InspectSeen = await inspectWhileRunning(run, dockerEnv(x!.sb));
    const end = await run.done;
    rmSync(probeDir, { recursive: true, force: true });
    expect(end.code).toBe(0);
    expect(seen.whileRunning).toBe(true);
    expect(seen.networkMode).toBe("none");
    expect(seen.mounts.filter((m) => (m.Source ?? "").startsWith(dataDir) || ["/acceptance", "/results"].includes(m.Destination ?? ""))).toEqual([]);
    const out = parseProbe(lines);
    const results = out.filter((o) => o.kind === "path").map((o) => String(o.result));
    expect(results).toHaveLength(paths.length);
    for (const r of results) expect(r).toMatch(/^not found/);
    const search = out.find((o) => o.kind === "search") as unknown as { files: number; found: Record<string, string[]> };
    expect(search.files).toBeGreaterThan(100);
    expect(search.found).toEqual({ marker: [], phrase: [] });
    const mountinfo = out.find((o) => o.kind === "mountinfo")?.lines as string[];
    expect(mountinfo.filter((l) => / \/acceptance | \/results /.test(l))).toEqual([]);
    const hist = await historyCheck(x!.repo.gitDir, needles);
    expect(hist.acceptanceFiles).toEqual([]);
    expect(hist.found).toEqual({ marker: 0, phrase: 0 });
  }, 600_000);

  it("run C, with the app stopped: refused before its start, no container, every item 'did not run'", async () => {
    needsPrerequisites();
    await sandbox.stop(x!.sb, ["app"]);
    const r = await go();
    expect(r.exit).toBeNull();
    expect(r.refused).toMatch(/the app did not answer before the start/);
    expect(r.reading.outcome).toBe("not passed");
    expect(r.reading.items.map((i) => i.status)).toEqual(["did not run"]);
    expect(r.events.find((e) => e.kind === "acceptance.run.started")?.payload.container_started).toBe(false);
  }, 120_000);

  it("run D, the deliberately broken copy in a fresh sandbox under the same project id, with the same version: item 1 failed, at step 'sees status waiting'", async () => {
    needsPrerequisites();
    await destroyExample1(x!);
    x = await makeExample1({ projectId, appPort: APP_PORT, dbPort: DB_PORT, runnerImage: RUNNER_IMAGE });
    for (const step of ["01-data", "02-submitter-screen"]) expect((await runStep(x, step)).ok, step).toBe(true);
    expect((await git(x.repo, ["rev-parse", "HEAD^{tree}"])).trim()).toBe(passTree);
    stageBrokenStep(x);
    expect((await runStep(x, "03-wrong-status")).ok).toBe(true);
    await buildAndStart(x);
    const r = await go();
    expect(r.manifestSha256).toBe(version.manifestSha256);
    expect(r.exit?.code).toBe(1);
    expect(r.reading.items[0]).toMatchObject({ number: 1, status: "failed", step: "sees status waiting" });
    expect(r.reading.items[0]!.errorText).toMatch(/Approved/);
    expect(r.reading.summary).toBe('version failed: item 1 failed at step "sees status waiting"');
    expect(r.reading.outcome).toBe("failed");
    const item = r.events.find((e) => e.kind === "acceptance.item")!;
    expect(item.payload).toMatchObject({ status: "failed", step: "sees status waiting", written_by: "stand-in" });
    // The error text, which can quote the test's source, is not in the event: its file's path and fingerprint are.
    expect(JSON.stringify(item.payload)).not.toContain("Received");
    expect((item.payload.failure_file as { sha256: string }).sha256).toMatch(/^[0-9a-f]{64}$/);
  }, 1_200_000);
});
