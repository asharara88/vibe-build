/**
 * Package 3.2, live (docs/design/package-3.2.md, section 6): the export's checks with Docker, the exported copy's own
 * start, and the check from the exported copy, on a real export of example 1 built by the scripted engine, on the
 * development profile. Made-up data only; no model is called.
 *
 * - L1: the export job's image checks (`Sandboxes.checkExport` of the real adapter, through `writeExport`), on a real
 *   export of example 1; and their refusals, on made-up images made from the checked images (S17, S18, S19).
 * - L2: the copy's own start, by its README's one command, in the unpacked folder, with only PATH, HOME and APP_PORT
 *   set: the build, the keys, the migrations, the made-up users, the app healthy, the tests in neither image; a second
 *   start; `docker compose down --volumes` leaving nothing. L2b: S30's comparison, and its refusal.
 * - L3, L3b, L3c: the check from the copy (src/export/check-from-copy.ts) against the app the copy started: it passes;
 *   a tampered copy is refused before the start (S25); an app container not started from this copy, or a container
 *   that is not the project's on its front network, is refused (S26); the runner shares the forwarder's namespace,
 *   on the project's front network alone (S27).
 * - L4: the drift check: a schema change with no migration refuses the start, naming the drift (S24).
 *
 * These start containers and need the runner image. They are never skipped (package 3.1b; known gap 73): when Docker
 * does not answer, the runner image is missing, or anything else they need is missing, the first test fails, naming
 * it, and every other test here fails with the same words before it starts anything. Run under the shared lock.
 * Everything they make is removed by exact name at the end.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dockerProblem } from "../src/acceptance/prerequisites.js";
import { RUNNER_IMAGE, runnerImageProblem } from "../src/acceptance/runner-image.js";
import { exampleChecklist, standInSources } from "../src/acceptance/stand-in.js";
import { openStore, writeVersion, type AcceptanceStore, type WrittenVersion } from "../src/acceptance/store.js";
import { example1Sandboxes, type ProjectSandbox, type Sandboxes } from "../src/orchestrator/example-1-adapter.js";
import { startItCommand, writeExport, type ExportResult } from "../src/orchestrator/export.js";
import { JOURNEY_STAND_IN_LABEL } from "../src/orchestrator/journey.js";
import { DEFAULT_IMAGES, exportCheckImageNames, sandbox } from "../src/sandbox/manager.js";
import { portFree, runStep } from "../scripts/example-1-sandbox.js";

const run = promisify(execFile);
/** A journey project's id ("j1-" and 12 hexadecimal characters), new for each run of this file. */
const PROJECT = `j1-${randomBytes(6).toString("hex")}`;
/** The image build's port on the machine's loopback address (package 0.6c), used by no other test or script. */
const BUILD_PROXY_PORT = 13191;
/** The exported app's port on the machine's loopback address: APP_PORT, so that the check reads the port from APP_URL. */
const APP_PORT = 3191;
const CHECKLIST_ITEMS = exampleChecklist("example-1").items.length;
const plainEnv = () => ({ PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME ?? "/root" });
/** The copy's own environment: a person's PATH and HOME, and the port setting the README names. */
const copyEnv = () => ({ ...plainEnv(), APP_PORT: String(APP_PORT) });
const docker = async (args: string[], o: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}) =>
  (await run("docker", args, { env: o.env ?? plainEnv(), cwd: o.cwd, maxBuffer: 32 * 1024 * 1024, timeout: o.timeout ?? 300_000 })).stdout;
/** What a test saw, printed for the evidence (the session's temporary folder written <tmp>); never a secret: the tests read none. */
const note = (...lines: string[]) => {
  for (const l of lines) console.log(`[x32] ${l.split(tmpdir()).join("<tmp>")}`);
};
const gone = (args: string[]) => docker(args).then(
  () => false,
  () => true,
);

/** What these tests need, each named with how to put it right; empty when all is here. */
async function prerequisites(): Promise<string[]> {
  const d = await dockerProblem();
  if (d) return [d];
  const out: string[] = [];
  const r = await runnerImageProblem(RUNNER_IMAGE, process.env);
  if (r) out.push(`The check from the copy cannot run: ${r}.`);
  for (const image of [DEFAULT_IMAGES.node, DEFAULT_IMAGES.postgres]) {
    if (await gone(["image", "inspect", image])) out.push(`The approved image ${image} is not on this machine; the exported app and the check use it, and nothing here downloads it.`);
  }
  if (!process.env.HTTPS_PROXY) out.push("HTTPS_PROXY is not set: the sandbox's image build goes out through the cloud session's proxy (package 0.6c).");
  if (!(await portFree(BUILD_PROXY_PORT))) out.push(`Something listens on 127.0.0.1:${BUILD_PROXY_PORT}, the image build's port for these tests; stop it first.`);
  if (!(await portFree(APP_PORT))) out.push(`Something listens on 127.0.0.1:${APP_PORT}, the exported app's port for these tests; stop it first.`);
  return out;
}

const missing = await prerequisites();
/** Every live test starts with this: with a prerequisite missing it fails, in plain words, before it starts anything. */
const needsPrerequisites = () => {
  if (missing.length) throw new Error(`This live export test cannot run, so it fails (it is never skipped). Missing: ${missing.join(" ")}`);
};

/** The copy's containers, as Compose lists them in its folder. */
async function composePs(dir: string): Promise<Array<{ Service?: string; State?: string; Health?: string; Name?: string; Publishers?: Array<{ URL?: string; TargetPort?: number; PublishedPort?: number; Protocol?: string }> }>> {
  const out = (await docker(["compose", "ps", "--all", "--format", "json"], { cwd: dir, env: copyEnv() })).trim();
  return out ? out.split("\n").map((l) => JSON.parse(l)) : [];
}

interface Started {
  child: ChildProcess;
  output: string[];
  ended: Promise<number | null>;
}

/** The README's one command, run as a person runs it, in the folder, attached; its output is kept. */
function startCopy(dir: string, command: string): Started {
  const argv = command.split(" ");
  const child = spawn(argv[0]!, argv.slice(1), { cwd: dir, env: copyEnv(), stdio: ["ignore", "pipe", "pipe"] });
  const output: string[] = [];
  const keep = (d: Buffer) => output.push(...d.toString("utf8").split("\n").filter((l) => l.trim() !== ""));
  child.stdout!.on("data", keep);
  child.stderr!.on("data", keep);
  const ended = new Promise<number | null>((ok) => child.on("close", (code) => ok(code)));
  return { child, output, ended };
}

/** Wait for the copy's app to be healthy by Compose (up to 10 min), failing at once if the command ends. */
async function waitHealthy(dir: string, s: Started): Promise<void> {
  let ended = false;
  void s.ended.then(() => (ended = true));
  const until = Date.now() + 600_000;
  while (Date.now() < until) {
    if (ended) throw new Error(`The README's command ended before the app was healthy. Its last lines:\n${s.output.slice(-40).join("\n")}`);
    const app = (await composePs(dir).catch(() => [])).find((c) => c.Service === "app");
    if (app?.State === "running" && app.Health === "healthy") return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`The app was not healthy after 10 minutes. The command's last lines:\n${s.output.slice(-40).join("\n")}`);
}

/** One query in the copy's database, through Compose, as its user `app`. */
const sql = (dir: string, q: string) => docker(["compose", "exec", "-T", "db", "psql", "-U", "app", "-d", "app", "-tAc", q], { cwd: dir, env: copyEnv() }).then((s) => s.trim());

/** Make a made-up image from `from`, changed by one shell command run as root with no network, committed under `name`. */
async function madeUpImage(from: string, name: string, script: string): Promise<void> {
  const c = `${name}-making`;
  try {
    await docker(["run", "--name", c, "--network", "none", "--user", "0", "--entrypoint", "sh", from, "-c", script]);
    await docker(["commit", c, name]);
  } finally {
    await docker(["rm", "-f", c]).catch(() => undefined);
  }
}

describe("package 3.2, live: the export's checks, the exported copy's own start, and the check from the copy", () => {
  let work: string;
  let store: AcceptanceStore;
  let sbx: Sandboxes;
  let x: ProjectSandbox | null = null;
  let version: WrittenVersion;
  let out: ExportResult;
  /** The unpacked copy the README's command starts: its folder is named after the project, as the archive's top folder. */
  let copyDir = "";
  let started: Started | null = null;
  const madeImages: string[] = [];
  const containers: string[] = [];
  const copyFolders: string[] = [];

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "x32-live-"));
    sbx = example1Sandboxes({ buildProxyPort: BUILD_PROXY_PORT });
  });

  afterAll(async () => {
    // By exact name only: what these tests made.
    for (const c of containers) await docker(["rm", "-f", c]).catch(() => undefined);
    for (const dir of copyFolders) {
      if (existsSync(join(dir, "compose.yaml"))) await docker(["compose", "down", "--volumes", "--remove-orphans"], { cwd: dir, env: copyEnv(), timeout: 180_000 }).catch(() => undefined);
    }
    if (started && started.child.exitCode === null) started.child.kill("SIGTERM");
    if (x) await sbx.destroy(x).catch(() => undefined);
    // Named here, not through the code under test, so that this clean-up runs the same before and after the package.
    const checkImages = [`builder_${PROJECT}-exportcheck-run`, `builder_${PROJECT}-exportcheck-tools`];
    for (const image of [...madeImages, `${PROJECT}-app`, `${PROJECT}-setup`, ...checkImages]) await docker(["image", "rm", "-f", image]).catch(() => undefined);
    if (work) rmSync(work, { recursive: true, force: true });
  }, 600_000);

  it("its prerequisites are here: Docker answers, the runner image, the two approved images, the session's proxy, two free ports", () => {
    needsPrerequisites();
    expect(missing).toEqual([]);
  });

  it("L1: a real export of example 1 (the scripted engine's two steps, the stand-in version), checked with Docker by the export job's own checks: all eight checks passed, in order; the run image holds only the base image's npm copy of a development-only package; no check image is left", async () => {
    needsPrerequisites();
    x = await sbx.make(PROJECT);
    for (const step of ["01-data", "02-submitter-screen"]) expect((await runStep(x, step)).ok, step).toBe(true);
    mkdirSync(join(work, "data"));
    store = openStore(join(work, "data"), { refuse: [x.dir] });
    const spec = exampleChecklist("example-1");
    version = writeVersion(store, PROJECT, {
      writtenBy: "stand-in",
      appSpecSha256: spec.sha256,
      items: standInSources("example-1").map((s) => {
        const c = spec.items.find((i) => i.number === s.number)!;
        return { ...s, checklist: `As ${c.as_role}: ${c.does} Sees: ${c.sees}` };
      }),
    });
    const x1 = x;
    out = await writeExport({
      repo: x1.repo,
      store,
      projectId: PROJECT,
      version: version.version,
      exportsDir: join(work, "data", "journey", PROJECT, "exports"),
      runManifestSha256: version.manifestSha256,
      check: (p) => sbx.checkExport(x1, p),
    });
    for (const c of out.checks) note(`L1 check ${c.id}: ${c.passed ? "passed" : "NOT passed"}: ${c.summary}`);
    note(`L1 the copy's build, install step lines: ${JSON.stringify(out.checks.find((c) => c.id === "images_built")?.install_step ?? [])}`);
    note(`L1 export: ${out.files.length} files, ${out.commits} commits, ${out.bytes} bytes, manifest SHA-256 ${out.manifestSha256}`);
    expect(out.checks.map((c) => [c.id, c.passed])).toEqual(
      ["archive_contents", "fixed_files", "images_built", "compose_config", "run_image_packages", "run_image_notices", "tools_image_packages", "licence_check"].map((id) => [id, true]),
    );
    const runPkgs = out.checks.find((c) => c.id === "run_image_packages")!;
    expect(runPkgs.listed).toEqual([{ path: "/usr/local/lib/node_modules/npm/node_modules/spdx-exceptions", name: "spdx-exceptions", version: "2.5.0" }]);
    expect(String(runPkgs.reading)).toMatch(/^checked under this reading \(question 26 \(a\)\)/);
    const tools = out.checks.find((c) => c.id === "tools_image_packages")!;
    expect((tools.listed as Array<{ path: string }>).length).toBeGreaterThan(0);
    expect(out.readmeCommand).toBe("docker compose up --build");
    for (const image of exportCheckImageNames(PROJECT)) expect(await gone(["image", "inspect", image]), image).toBe(true);
  }, 1_200_000);

  it("L1: the image checks refuse, on made-up images made from the checked ones: lightningcss under /app (S17), a second spdx-ranges outside /app (S17), no notices file in the run image (S18), and the tools image of a copy whose notices file has one line more (S19)", async () => {
    needsPrerequisites();
    const ec = await import("../src/export/export-check.js");
    // The checked images, built again from the archive through the sandbox's own build path (from the build cache).
    const top = join(work, "l1-copy");
    mkdirSync(top);
    await run("tar", ["--extract", "--gzip", "--file", out.path, "--directory", top, "--no-same-owner"]);
    const copy = join(top, PROJECT);
    const [runImage, toolsImage] = exportCheckImageNames(PROJECT);
    await sandbox.build({ ...x!.sb, appBuild: { ...x!.sb.appBuild!, context: copy, image: runImage, toolsImage } });
    const env = plainEnv();
    const devNames = ec.devOnlyNames();
    const notices = (await import("../src/acceptance/store.js")).sha256(readFileSync(join(copy, "THIRD-PARTY-NOTICES.md")));
    const tag = randomBytes(3).toString("hex");
    const name = (what: string) => `${x!.sb.projectName}-exportcheck-${what}-${tag}`;
    const runChecks = (image: string) => ec.runImageChecks(env, { image, container: name("list"), copyNoticesSha256: notices, devNames });
    const toolsChecks = (image: string) => ec.toolsImageChecks(env, { image, listContainer: name("list"), licenceContainer: name("licences"), devNames });
    // The checked images themselves pass.
    expect((await runChecks(runImage)).map((c) => [c.id, c.passed])).toEqual([["run_image_packages", true], ["run_image_notices", true]]);
    expect((await toolsChecks(toolsImage)).map((c) => [c.id, c.passed])).toEqual([["tools_image_packages", true], ["licence_check", true]]);

    const lightning = `${x!.sb.projectName}-exportcheck-madeup-lightningcss`;
    const ranges = `${x!.sb.projectName}-exportcheck-madeup-spdx-ranges`;
    const noNotices = `${x!.sb.projectName}-exportcheck-madeup-no-notices`;
    const longer = `${x!.sb.projectName}-exportcheck-madeup-notices-longer`;
    madeImages.push(lightning, ranges, noNotices, longer);
    await madeUpImage(runImage, lightning, `mkdir -p /app/node_modules/lightningcss && printf '%s' '{"name":"lightningcss","version":"1.30.1"}' > /app/node_modules/lightningcss/package.json`);
    await madeUpImage(runImage, ranges, `mkdir -p /opt/made-up/node_modules/spdx-ranges && printf '%s' '{"name":"spdx-ranges","version":"2.1.1"}' > /opt/made-up/node_modules/spdx-ranges/package.json`);
    await madeUpImage(runImage, noNotices, "rm /app/THIRD-PARTY-NOTICES.md");
    await madeUpImage(toolsImage, longer, "printf '%s\\n' 'Made-up line added after export.' >> /app/THIRD-PARTY-NOTICES.md");

    const a = await runChecks(lightning);
    const b0 = await runChecks(ranges);
    const c0 = await runChecks(noNotices);
    const d0 = await toolsChecks(longer);
    for (const [what, r] of [["lightningcss under /app", a], ["second spdx-ranges outside /app", b0], ["no notices file", c0], ["notices file one line longer", d0]] as const)
      for (const k of r) note(`L1 made-up image (${what}): ${k.id} ${k.passed ? "passed" : "NOT passed"}: ${k.summary}`);
    expect(a[0]).toMatchObject({ id: "run_image_packages", passed: false });
    expect(a[0]!.summary).toContain("lightningcss 1.30.1 at /app/node_modules/lightningcss, under /app");
    const b = b0;
    expect(b[0]).toMatchObject({ id: "run_image_packages", passed: false });
    expect(b[0]!.summary).toContain("spdx-ranges 2.1.1 at /opt/made-up/node_modules/spdx-ranges, outside /app but not the base image's own npm copy that is allowed");
    const c = c0;
    expect(c.map((k) => [k.id, k.passed])).toEqual([["run_image_packages", true], ["run_image_notices", false]]);
    expect(c[1]!.summary).toBe("The image the app runs from has no /app/THIRD-PARTY-NOTICES.md.");
    const d = d0;
    expect(d.map((k) => [k.id, k.passed])).toEqual([["tools_image_packages", true], ["licence_check", false]]);
    expect(d[1]!.summary).toMatch(/^The template's own licence check did not pass from the copy: exit code [1-9]/);
    for (const image of [lightning, ranges, noNotices, longer, runImage, toolsImage]) await docker(["image", "rm", "-f", image]);
  }, 1_200_000);

  it("L2: the copy's own start, by its README's one command in the unpacked folder (PATH, HOME and APP_PORT only): it builds, makes its three keys, applies both migrations, adds the three made-up users, and the app is healthy; one port, on the machine's loopback address; the tests are in neither image", async () => {
    needsPrerequisites();
    const top = join(work, "delivered");
    mkdirSync(top);
    await run("tar", ["--extract", "--gzip", "--file", out.path, "--directory", top, "--no-same-owner"]);
    copyDir = join(top, PROJECT);
    copyFolders.push(copyDir);
    const command = startItCommand(readFileSync(join(copyDir, "README.md"), "utf8"));
    expect(command).toBe("docker compose up --build");
    const t0 = Date.now();
    started = startCopy(copyDir, command!);
    await waitHealthy(copyDir, started);
    note(`L2 first start: the README's command "${command}" ran in <tmp>/x32-live-.../delivered/${PROJECT}; the app healthy after ${Math.round((Date.now() - t0) / 1000)} s`);
    // The install step's own lines (whether npm ran, or the step came from an earlier layer), then the keys and the users.
    const steps = new Set(started.output.filter((l) => /npm ci/.test(l)).map((l) => /^(#\d+) /.exec(l.trim())?.[1]).filter(Boolean));
    const installLines = started.output.filter((l) => steps.has(/^(#\d+) /.exec(l.trim())?.[1] ?? "") || /added \d+ packages/.test(l));
    for (const l of [...installLines.slice(0, 30), ...started.output.filter((l) => /keys-1 +\||setup-1 +\|.*(created|exists): /.test(l)).slice(0, 20)]) note(`L2 first start | ${l.trim().slice(0, 240)}`);
    const said = started.output.join("\n");
    for (const k of ["db_password", "auth_secret", "sample_password"]) expect(said, k).toMatch(new RegExp(`keys-1 +\\| made ${k}`));
    for (const u of ["employee@example.test", "manager@example.test", "hr.admin@example.test"]) expect(said, u).toContain(`created: ${u}`);
    expect(await sql(copyDir, "select count(*) from drizzle.__drizzle_migrations")).toBe("2");
    expect(await sql(copyDir, 'select count(*) from "user"')).toBe("3");
    const ps = await composePs(copyDir);
    const published = ps.flatMap((c) => (c.Publishers ?? []).filter((p) => p.PublishedPort).map((p) => ({ service: c.Service, ...p })));
    note(`L2 published ports: ${JSON.stringify(published)}; migrations recorded: 2; users: 3`);
    expect(published).toEqual([{ service: "door", URL: "127.0.0.1", TargetPort: 3000, PublishedPort: APP_PORT, Protocol: "tcp" }]);
    // The person's way in, from the machine: the door.
    const page = await fetch(`http://127.0.0.1:${APP_PORT}/en/sign-in`);
    expect(page.status).toBe(200);
    // S21: the checklist's tests and the history reach neither image the copy built.
    for (const [image, user] of [[`${PROJECT}-setup`, "node"], [`${PROJECT}-app`, "app"]] as const) {
      const seen = await docker(["run", "--rm", "--network", "none", "--read-only", "--user", user, "--entrypoint", "sh", image, "-c", "for p in /app/acceptance /app/.git; do test -e $p && echo present $p; done; echo checked"]);
      expect(seen.trim(), image).toBe("checked");
    }
  }, 900_000);

  it("L2b (S30): what Compose reads from an unpacked copy, with only PATH and HOME set, equals what it reads from the template's compose.yaml alone; a compose.override.yaml put beside it after export fails the comparison, naming the door's privileged", async () => {
    needsPrerequisites();
    const ec = await import("../src/export/export-check.js");
    const top = join(work, "s30");
    mkdirSync(top);
    await run("tar", ["--extract", "--gzip", "--file", out.path, "--directory", top, "--no-same-owner"]);
    const other = join(top, PROJECT);
    const ok = await ec.composeConfigCheck(other, mkdtempSync(join(work, "s30-scratch-")));
    expect(ok).toMatchObject({ id: "compose_config", passed: true });
    const override = join(other, "compose.override.yaml");
    writeFileSync(override, "services:\n  door:\n    privileged: true\n");
    const bad = await ec.composeConfigCheck(other, mkdtempSync(join(work, "s30-scratch-")));
    note(`L2b plain copy: ${ok.summary}`, `L2b with compose.override.yaml: ${bad.summary}`);
    expect(bad).toMatchObject({ id: "compose_config", passed: false });
    expect(bad.differences).toContain("services.door.privileged");
    expect(bad.summary).toContain("services.door.privileged");
    rmSync(override);
  }, 300_000);

  it("L3 (S25, S26, S27, S31) and L3c: the check from the copy, against the app the copy's own command started: version passed, checklist incomplete (5 of 6), labelled as the stand-in; the runner, inspected while it runs, shares the forwarder's namespace, which is on the project's front network alone; the forwarder is removed; the copy is unchanged", async () => {
    needsPrerequisites();
    const c = await import("../src/export/check-from-copy.js");
    let inspected: Promise<Record<string, unknown>> | null = null;
    const runFolder = join(work, "check-1");
    const report = await c.checkFromCopy({
      copyDir,
      projectId: PROJECT,
      version: version.version,
      manifestSha256: out.manifestSha256,
      checklistItems: CHECKLIST_ITEMS,
      runFolder,
      onStarted: (s) => {
        containers.push(s.forwarder, s.runner);
        inspected = (async () => {
          let ended = false;
          void s.done.then(() => (ended = true));
          while (!ended) {
            const info = await docker(["inspect", s.runner]).then((o) => JSON.parse(o)[0], () => null);
            if (info?.State?.Running) {
              const fwd = JSON.parse(await docker(["inspect", s.forwarder]))[0];
              return { runner: info, forwarder: fwd, whileRunning: !ended };
            }
            await new Promise((r) => setTimeout(r, 100));
          }
          return { problem: "the runner ended before it was seen running" };
        })();
      },
    });
    note(
      `L3 reading: ${report.reading.outcome}; ${report.reading.summary}; label "${report.label}"; run ${report.runId}`,
      `L3 the app found: ${JSON.stringify(report.app)}`,
      `L3 the forwarder: ${JSON.stringify(report.forwarder)}`,
      `L3 the runner: ${JSON.stringify(report.runner)}; exit ${JSON.stringify(report.exit)}`,
      `L3 the copy: ${JSON.stringify(report.copy)}; forwarder removed: ${report.forwarderRemoved}; after: ${JSON.stringify(report.afterProblems)}`,
      ...report.output.map((l) => `L3 runner | ${l}`),
    );
    expect(report.refused, JSON.stringify(report.reading)).toBeNull();
    expect(report.exit).toEqual({ code: 0, timedOut: false });
    expect(report.reading.outcome).toBe("passed");
    expect(report.reading.summary).toBe("version passed; checklist incomplete (5 of the app spec's 6 checklist items have no test)");
    expect(report.reading.items).toHaveLength(1);
    expect(report.reading.items[0]).toMatchObject({ number: 1, status: "passed" });
    expect(report.reading.items[0]!.screenshot!.path.startsWith(runFolder + "/")).toBe(true);
    expect(report.label).toBe(JOURNEY_STAND_IN_LABEL);
    expect(report.manifestSha256).toBe(out.manifestSha256);
    expect(report.app).toMatchObject({ project: PROJECT, service: "app", appUrl: `http://localhost:${APP_PORT}`, appPort: 3000 });
    expect(report.app!.workingDir).toBe(copyDir);
    expect(report.app!.imageId).toBe((await docker(["image", "inspect", "--format", "{{.Id}}", `${PROJECT}-app`])).trim());
    expect(report.copy).toMatchObject({ unchanged: true, changes: [] });
    expect(report.copy.files).toBeGreaterThan(100);
    expect(report.forwarderRemoved).toBe(true);
    expect(report.passed).toBe(true);
    expect(await gone(["inspect", report.forwarder!.name])).toBe(true);
    // L3c (S27), as the runner ran.
    const seen = (await inspected!) as { runner: Record<string, any>; forwarder: Record<string, any>; whileRunning: boolean; problem?: string };
    note(
      `L3c the forwarder while the runner ran: networks ${JSON.stringify(Object.keys(seen.forwarder?.NetworkSettings?.Networks ?? {}))}, user ${seen.forwarder?.Config?.User}, read-only ${seen.forwarder?.HostConfig?.ReadonlyRootfs}, image ${seen.forwarder?.Config?.Image}`,
      `L3c the runner while it ran: network mode ${seen.runner?.HostConfig?.NetworkMode} (the forwarder is ${seen.forwarder?.Id}), user ${seen.runner?.Config?.User}, read-only ${seen.runner?.HostConfig?.ReadonlyRootfs}, cap drop ${JSON.stringify(seen.runner?.HostConfig?.CapDrop)}, security ${JSON.stringify(seen.runner?.HostConfig?.SecurityOpt)}, tmpfs ${JSON.stringify(seen.runner?.HostConfig?.Tmpfs)}`,
      `L3c the runner's mounts: ${JSON.stringify((seen.runner?.Mounts ?? []).map((m: Record<string, unknown>) => ({ Type: m.Type, Name: m.Name, Source: m.Type === "volume" ? undefined : m.Source, Destination: m.Destination, RW: m.RW })))}`,
    );
    expect(seen.problem).toBeUndefined();
    expect(seen.whileRunning).toBe(true);
    expect(Object.keys(seen.forwarder.NetworkSettings.Networks)).toEqual([`${PROJECT}_front`]);
    expect(seen.forwarder.Config.User).toBe("node");
    expect(seen.forwarder.HostConfig.ReadonlyRootfs).toBe(true);
    expect(seen.forwarder.Config.Image).toBe(DEFAULT_IMAGES.node);
    expect(seen.runner.HostConfig.NetworkMode).toBe(`container:${seen.forwarder.Id}`);
    expect(seen.runner.Config.User).toBe("runner");
    expect(seen.runner.HostConfig.ReadonlyRootfs).toBe(true);
    expect(seen.runner.HostConfig.CapDrop).toEqual(["ALL"]);
    expect(seen.runner.HostConfig.SecurityOpt).toEqual(["no-new-privileges:true"]);
    const mounts = (seen.runner.Mounts as Array<{ Type: string; Destination: string; RW: boolean; Name?: string; Source?: string }>).map((m) => [m.Type, m.Destination, m.RW]).sort();
    expect(mounts).toEqual([
      ["bind", "/acceptance", false],
      ["bind", "/results", true],
      ["volume", "/run/secrets/sample-password", false],
    ]);
    const env = (seen.runner.Config.Env as string[]).filter((e) => /^(BASE_URL|RUN_ID)=/.test(e)).sort();
    expect(env).toEqual([`BASE_URL=http://localhost:${APP_PORT}`, `RUN_ID=${report.runId}`]);
  }, 900_000);

  it("L3 (S25): a test in the copy loosened after export (/waiting/i made /./): refused before the start, the file named; every item 'did not run', 'not passed'; no forwarder or runner is started", async () => {
    needsPrerequisites();
    const c = await import("../src/export/check-from-copy.js");
    const f = join(copyDir, "acceptance", version.version, "item-01.spec.ts");
    const original = readFileSync(f);
    const loosened = original.toString("utf8").replace("toContainText(/waiting/i)", "toContainText(/./)");
    expect(loosened).not.toBe(original.toString("utf8"));
    try {
      writeFileSync(f, loosened);
      const r = await c.checkFromCopy({ copyDir, projectId: PROJECT, version: version.version, manifestSha256: out.manifestSha256, checklistItems: CHECKLIST_ITEMS, runFolder: join(work, "check-tampered") });
      note(`L3 tampered copy: refused: ${r.refused}; ${r.reading.summary}`);
      expect(r.refused).toMatch(/item-01\.spec\.ts does not match its fingerprint in the manifest/);
      expect(r.reading.items.map((i) => i.status)).toEqual(["did not run"]);
      expect(r.reading.outcome).toBe("not passed");
      expect(r.forwarder).toBeNull();
      expect(r.runner).toBeNull();
      expect(r.exit).toBeNull();
      expect(r.passed).toBe(false);
    } finally {
      writeFileSync(f, original);
    }
  }, 300_000);

  it("L3b (S26): refused before the start when the app is not the one this copy started: a second copy in a folder of the same name; the image named <project>-app not the one the container runs; a container that is not the project's on its front network", async () => {
    needsPrerequisites();
    const c = await import("../src/export/check-from-copy.js");
    const check = (dir: string, folder: string) =>
      c.checkFromCopy({ copyDir: dir, projectId: PROJECT, version: version.version, manifestSha256: out.manifestSha256, checklistItems: CHECKLIST_ITEMS, runFolder: join(work, folder) });
    const notStarted = (r: Awaited<ReturnType<typeof check>>) => {
      expect(r.reading.items.map((i) => i.status)).toEqual(["did not run"]);
      expect(r.reading.outcome).toBe("not passed");
      expect(r.runner).toBeNull();
      expect(r.passed).toBe(false);
    };
    // 1. Another unpacked copy, in a folder of the same name (L2b's): its Compose project would have the same name.
    const other = join(work, "s30", PROJECT);
    const a = await check(other, "check-other-copy");
    note(`L3b another copy of the same name: refused: ${a.refused}`);
    expect(a.refused).toMatch(/no app container was started from this copy/);
    notStarted(a);
    // 2. The image named <project>-app is not the one the app container runs.
    const appId = (await docker(["image", "inspect", "--format", "{{.Id}}", `${PROJECT}-app`])).trim();
    try {
      await docker(["tag", `${PROJECT}-setup`, `${PROJECT}-app`]);
      const b = await check(copyDir, "check-other-image");
      note(`L3b the image named ${PROJECT}-app moved: refused: ${b.refused}`);
      expect(b.refused).toMatch(new RegExp(`the app container's image is not the image named ${PROJECT}-app`));
      notStarted(b);
    } finally {
      await docker(["tag", appId, `${PROJECT}-app`]);
    }
    expect((await docker(["image", "inspect", "--format", "{{.Id}}", `${PROJECT}-app`])).trim()).toBe(appId);
    // 3. A container that is not the project's, on the project's front network.
    const guest = `${PROJECT}-made-up-guest`;
    containers.push(guest);
    await docker(["run", "-d", "--name", guest, "--network", `${PROJECT}_front`, "--read-only", "--user", "node", "--entrypoint", "node", DEFAULT_IMAGES.node, "-e", "setInterval(()=>{},1000)"]);
    try {
      const g = await check(copyDir, "check-guest");
      note(`L3b a container not the project's on its front network: refused: ${g.refused}`);
      expect(g.refused).toMatch(new RegExp(`${guest}.*is on ${PROJECT}_front`));
      notStarted(g);
      expect(g.forwarder).toBeNull();
    } finally {
      await docker(["rm", "-f", guest]);
    }
  }, 600_000);

  it("L2: a second start keeps the keys, applies no migration again and adds no user, and the app is healthy; then `docker compose down --volumes` leaves no container, volume or network of the copy", async () => {
    needsPrerequisites();
    await docker(["compose", "down"], { cwd: copyDir, env: copyEnv(), timeout: 180_000 });
    expect(await started!.ended).not.toBeUndefined();
    const t1 = Date.now();
    started = startCopy(copyDir, "docker compose up --build");
    await waitHealthy(copyDir, started);
    note(`L2 second start: the app healthy after ${Math.round((Date.now() - t1) / 1000)} s`);
    for (const l of started.output.filter((l) => /keys-1 +\||setup-1 +\|.*(created|exists): /.test(l)).slice(0, 20)) note(`L2 second start | ${l.trim().slice(0, 240)}`);
    const said = started.output.join("\n");
    for (const k of ["db_password", "auth_secret", "sample_password"]) expect(said, k).toMatch(new RegExp(`keys-1 +\\| kept ${k}`));
    for (const u of ["employee@example.test", "manager@example.test", "hr.admin@example.test"]) expect(said, u).toContain(`exists: ${u}`);
    expect(said).not.toMatch(/created: /);
    expect(await sql(copyDir, "select count(*) from drizzle.__drizzle_migrations")).toBe("2");
    expect(await sql(copyDir, 'select count(*) from "user"')).toBe("3");
    await docker(["compose", "down", "--volumes"], { cwd: copyDir, env: copyEnv(), timeout: 180_000 });
    await started.ended;
    const label = `label=com.docker.compose.project=${PROJECT}`;
    expect((await docker(["ps", "--all", "--quiet", "--filter", label])).trim()).toBe("");
    expect((await docker(["volume", "ls", "--quiet", "--filter", label])).trim()).toBe("");
    expect((await docker(["network", "ls", "--quiet", "--filter", label])).trim()).toBe("");
  }, 900_000);

  it("L4 (S24): a schema change with no migration: the start is refused by the drift check after the tables were made by drizzle-kit migrate, naming what generate wrote; the app is not started", async () => {
    needsPrerequisites();
    const schema = join(x!.workspace, "src", "db", "app-schema.ts");
    const before = readFileSync(schema, "utf8");
    expect(before).toContain('    reason: text("reason"),\n');
    writeFileSync(schema, before.replace('    reason: text("reason"),\n', '    reason: text("reason"),\n    /** A made-up column, added with no migration (live test L4). */\n    note: text("note"),\n'));
    const lines: string[] = [];
    let err: Error | null = null;
    await sbx.buildAndStart(x!, (l) => lines.push(l)).catch((e: Error) => (err = e));
    note(`L4 the start: ${err ? `refused: ${(err as Error).message}` : "not refused"}`, ...lines.map((l) => `L4 log | ${l}`));
    expect(err).not.toBeNull();
    const message = (err as unknown as Error).message;
    expect(message).toMatch(/^The tables were made, but the drift check did not pass: drizzle-kit generate did not say "No schema changes, nothing to migrate", and it wrote /);
    expect(message).toContain("0002_drift_check.sql (added)");
    expect(message).toContain("meta/_journal.json (changed)");
    const ps = (await sandbox.ps(x!.sb)).trim();
    const services = ps ? ps.split("\n").map((l) => (JSON.parse(l) as { Service?: string }).Service) : [];
    expect(services).not.toContain("app");
    expect(services).toContain("db");
  }, 900_000);
});
