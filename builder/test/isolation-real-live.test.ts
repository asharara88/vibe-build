/**
 * Package 0.6c, live, in the REAL containers (14 Nov 2026).
 *
 * The plan's "Done means" for 0.6c asks for the isolation probe "run in each of those containers": the app and tools
 * containers, package 3.1's acceptance runner and package 2.2's engine. On 13 Nov the probe ran in stand-in images
 * placed as those containers are placed (test/isolation.test.ts, kept as it is). Here it runs in the real ones:
 *
 * - a real example-1 project made by the product's own functions (makeExample1, the scripted engine's steps 01 and
 *   02, buildAndStart), with the acceptance runner's real image;
 * - the app, inside the RUNNING container itself: the probe file is written into its own /tmp through
 *   `docker compose exec`, checked against the repository's file, run there, and removed;
 * - the app, tools, runner, live camera, check and the scripted engine, each as a one-off container of its own
 *   service from its real image, which is the only form the tools, runner, check and engine containers ever take.
 *   Docker is asked, while each runs, which image it runs;
 * - the database's network, from a Node container that shares it (its image has no Node).
 *
 * WHAT THIS IS NOT. Package 2.2's engine does not exist, so nothing here runs in it: the engine column is the
 * scripted engine's container (package 2.1), which has no network. No code a model wrote is run: the app is the
 * house template after the scripted engine's two fixed steps. The runner, tools and engine are probed in a
 * container of the real service and image with the probe as its command, not during an acceptance run, a seed or
 * a step. The door is started although the product does not start it for such a project today.
 *
 * These tests start containers and need the approved browser zip (the runner's real image is built from it). They
 * are never skipped: when Docker does not answer or the zip is not in the folder BUILDER_BROWSER_CACHE names, the
 * first test fails, naming what is missing and how to put it right, and every other test here fails with the same
 * words before it starts anything.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { liveAcceptanceProblems } from "../src/acceptance/prerequisites.js";
import { RUNNER_IMAGE, RUNNER_UID, runnerImageProblem } from "../src/acceptance/runner-image.js";
import { cameraNetworkProblem } from "../src/orchestrator/example-1-adapter.js";
import { compareWithExpected, expectedOnDevelopment, expectedPositiveControls, gotAnswer, parseProbeOutput, type Comparison, type DevContainer, type ProbeReport } from "../src/sandbox/isolation.js";
import { dockerEnv, sandbox } from "../src/sandbox/manager.js";
import { cameraSocket } from "../src/web/preview.js";
import type { Example1 } from "../scripts/example-1-sandbox.js";
import { DEFAULT_ROUTE_INFO, INTERFACES_ALL, INTERFACES_UP, parseSettings, planAttempts } from "../scripts/isolation-probe.mjs";
import {
  destroyRealProject,
  devProbeSettings,
  ensureRunnerImage,
  FRONT_STAND_IN,
  IN_PLACE_PATH,
  probeComparison,
  probeInNetworkOf,
  probeInPlace,
  probeServiceSeen,
  REAL_MISCONFIGURATIONS,
  realImageProblemsFrom,
  startCanary,
  startFrontStandIn,
  startRealProject,
  type RealProject,
  type SeenContainer,
} from "../scripts/isolation-harness.js";

const run = promisify(execFile);

// Read once, before any test: Docker answers, and the approved zip is in the folder BUILDER_BROWSER_CACHE names.
const missing = await liveAcceptanceProblems();
const MISSING_WORDS = "This live isolation test runs the probe in the real containers, so it needs Docker and the approved browser zip; it fails (it is never skipped). Missing: ";
/** Every test here starts with this: with a prerequisite missing it fails, in plain words, before it starts anything. */
const needsPrerequisites = () => {
  if (missing.length) throw new Error(MISSING_WORDS + missing.join(" "));
};

describe("isolation: live, the probe inside the real containers of a real example-1 project, each compared with its expected list (package 0.6c, 14 Nov 2026)", () => {
  const PROJECT = "p_iso06c_real";
  /** The app's port inside the project's own networks; nothing on the machine listens on it. */
  const APP_PORT = 3191;
  /** The gateway address makeExample1 gives every project: 127.0.0.1:4010. Nothing listens behind it in this run. */
  const GATEWAY_PORT = 4010;
  const NOTHING_LEFT = "containers: none; named containers: none; networks: none; volumes: none; images: none";
  /** Every project made here, so that whatever fails, afterAll can remove it. */
  const made: Example1[] = [];
  /** What was left of each project once it was removed, by project id. */
  const left: Record<string, string> = {};
  let runnerImageId = "";
  let real: RealProject | undefined;
  let canary: Awaited<ReturnType<typeof startCanary>> | undefined;
  // Package J3: a stand-in for the preview front on 4041, listening before the machine is read, and the camera socket leading to it.
  let front: Awaited<ReturnType<typeof startFrontStandIn>> | undefined;
  let camera: Awaited<ReturnType<typeof cameraSocket>> | undefined;
  const ctx = () => ({ appPort: APP_PORT, gatewayServer: /server: \(no gateway is behind the real project's address in this run\)/, frontServer: new RegExp(`server: ${FRONT_STAND_IN}`) });

  const report = (lines: string[]) => parseProbeOutput(lines);
  const compare = (r: ProbeReport, kind: DevContainer) => compareWithExpected(r, expectedOnDevelopment(kind, ctx()));
  const failing = (c: Comparison) => c.rows.filter((r) => !r.pass).map((r) => `${r.id} ${r.target}: expected ${r.expected}; got ${r.actual}`);
  const failingIds = (c: Comparison) => c.rows.filter((r) => !r.pass).map((r) => r.id);
  const info = (r: ProbeReport, name: string) => r.info.find((i) => i.name === name)?.value;
  const onMade = (x: Example1) => void made.push(x);

  /** The canary, the preview front's stand-in and the camera socket: started once, before the machine's listeners are read. */
  async function listeners() {
    canary ??= await startCanary();
    front ??= await startFrontStandIn(4041);
    camera ??= await cameraSocket(4041);
    return { canary, front, camera };
  }

  /** The real project of L3, or a plain failure saying it is not there. */
  function theProject(): RealProject {
    if (!real) throw new Error("The real project was not made (see the test that makes it); nothing can be probed.");
    return real;
  }

  /** Remove a project now, and keep what was left of it for the last test. */
  async function remove(x: Example1) {
    left[x.projectId] = await destroyRealProject(x);
    if (made.includes(x)) made.splice(made.indexOf(x), 1);
  }

  afterAll(async () => {
    for (const x of [...made]) await destroyRealProject(x).catch(() => undefined);
    await canary?.close();
    await front?.close();
    await camera?.close();
  });

  it("L1: its prerequisites are here: Docker answers, and the folder BUILDER_BROWSER_CACHE names holds the approved browser zip", () => {
    needsPrerequisites();
    expect(missing).toEqual([]);
  });

  it("L2: the acceptance runner's real image is built from the approved zip and carries its label", async () => {
    needsPrerequisites();
    const built = await ensureRunnerImage();
    expect(built.image).toBe(RUNNER_IMAGE);
    expect(built.imageId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await runnerImageProblem(RUNNER_IMAGE, process.env)).toBeNull();
    runnerImageId = built.imageId;
  }, 1_800_000);

  it("L3: a real example-1 project is made by the product's own functions, its images are the real ones, and its app runs", async () => {
    needsPrerequisites();
    real = await startRealProject({ projectId: PROJECT, appPort: APP_PORT, onMade });
    // The app and tools images are the template's build, and the acceptance service's image is the runner's own.
    expect(realImageProblemsFrom(real.images)).toEqual([]);
    expect(real.images.acceptance.id).toBe(runnerImageId);
    // The running app container runs the image the build made.
    expect(real.appContainer?.id).toMatch(/^[0-9a-f]{64}$/);
    expect(real.appContainer?.imageId).toBe(real.images.app.id);
    const ps = JSON.parse(`[${(await sandbox.ps(real.x.sb)).trim().split("\n").join(",")}]`) as Array<{ Service: string; State: string; Health?: string }>;
    expect(Object.fromEntries(ps.map((p) => [p.Service, `${p.State}${p.Health ? ` (${p.Health})` : ""}`]))).toEqual({
      app: "running (healthy)",
      db: "running (healthy)",
      egress: "running (healthy)",
      "egress-host": "running (healthy)",
    });
  }, 2_400_000);

  it("L4: the probe inside each real container reaches exactly what its list allows: the running app in place, and the app, tools, runner, live camera, check and the scripted engine's container each from its real image, and the database's network", async () => {
    needsPrerequisites();
    const { x, images, appContainer } = theProject();
    const { camera } = await listeners();
    const read = await devProbeSettings(x.sb, { appPort: APP_PORT, gatewayPort: GATEWAY_PORT });
    const settings = read.settings;
    expect(read.machineAddresses.length).toBeGreaterThan(0);
    expect(settings).toContain(':4041"');
    const withSocket = JSON.stringify({ ...JSON.parse(settings), sockets: ["/psock/c.sock"] });
    const machineRows = read.machineAddresses.length * new Set((JSON.parse(settings).machineListeners as string[]).map((l) => l.split(":").pop())).size;
    /** Every difference found, by column; all asserted at once at the end, so that a failure shows every column. */
    const problems: Record<string, string[]> = {};
    const userIds: Record<string, number> = {};

    /** What every column must show, as on 13 Nov: no reading problem, no failing or missing row, every machine address tried on every port, no default route. */
    const check = (label: string, kind: DevContainer, lines: string[]) => {
      const r = report(lines);
      const c = compare(r, kind);
      const found = (problems[label] = [...r.problems.map((p) => `reading problem: ${p}`), ...failing(c), ...c.missing.map((m) => `not tried: ${m}`)]);
      const m = r.attempts.filter((a) => a.id.startsWith("M")).length;
      if (m !== machineRows) found.push(`${m} rows toward the machine's addresses, not ${machineRows} (every address on every port)`);
      if (info(r, DEFAULT_ROUTE_INFO) !== "no") found.push(`a default route: ${info(r, DEFAULT_ROUTE_INFO)}`);
      userIds[label] = Number(info(r, "user id"));
      return { r, found };
    };
    /** What Docker must have said about a one-off container while it ran: seen running, and running the real image. */
    const sawRealImage = (found: string[], seen: SeenContainer, image: { name: string; id: string }) => {
      if (!seen.whileRunning) found.push(`the container was not seen running (${seen.problem ?? "no reason given"})`);
      else if (seen.imageId !== image.id) found.push(`the container ran image ${seen.imageId}, which is not ${image.name} as read after the build (${image.id})`);
    };

    // The probes start here.
    // 1. The running app container itself, in place.
    const inPlace = await probeInPlace(x.sb, "app", settings);
    const app = check("app-running", "app-running", inPlace.lines);
    if (inPlace.sha256.inside !== inPlace.sha256.repository) app.found.push(`the file run inside has SHA-256 ${inPlace.sha256.inside}, not the repository's ${inPlace.sha256.repository}`);
    if (inPlace.container.before !== appContainer?.id || inPlace.container.after !== appContainer?.id) app.found.push(`the app's container changed during the probe: ${JSON.stringify(inPlace.container)}, started as ${appContainer?.id}`);
    if (!(info(app.r, "listening TCP ports seen in /proc/net") ?? "").split(", ").includes(`0.0.0.0:${APP_PORT}`)) app.found.push(`the app's own listener 0.0.0.0:${APP_PORT} is not among the listening ports seen inside: ${info(app.r, "listening TCP ports seen in /proc/net")}`);
    if (!inPlace.removed) app.found.push("the probe file was not seen gone after its removal");
    const stillThere = (await sandbox.exec(x.sb, "app", ["node", "-e", "console.log(require('fs').existsSync(process.argv[1]))", IN_PLACE_PATH])).trim();
    if (stillThere !== "false") app.found.push(`asked again, the probe file is still in the running app container (${stillThere})`);

    // 2. Each one-off container of a real service, from its real image.
    const oneOff: Array<[string, DevContainer, string, { name: string; id: string }, string, string[]]> = [
      ["app-real", "app", "app", images.app, settings, []],
      ["tools-real", "tools", "tools", images.tools, settings, []],
      ["runner-real", "runner", "acceptance", images.acceptance, settings, []],
      ["camera-real", "camera", "acceptance", images.acceptance, withSocket, [`${camera.dir}:/psock:ro`]],
      ["check-real", "check", "check", images.node, settings, []],
      ["engine-real", "engine-scripted", "engine", images.node, settings, []],
    ];
    for (const [label, kind, service, image, given, volumes] of oneOff) {
      const p = await probeServiceSeen(x.sb, service, label, given, volumes);
      const { r, found } = check(label, kind, p.lines);
      sawRealImage(found, p.seen, image);
      // The app's one-off container runs the very image the running app container runs.
      if (label === "app-real" && p.seen.whileRunning && p.seen.imageId !== appContainer?.imageId) found.push(`the one-off app container ran image ${p.seen.imageId}, the running app container runs ${appContainer?.imageId}`);
      if (label === "engine-real") {
        // The scripted engine's container has no network at all: Docker says so, only the loopback interface is
        // inside, and nothing listens inside, so the probe adds no attempt of its own.
        if (p.seen.whileRunning && p.seen.networkMode !== "none") found.push(`Docker gives the engine container network mode ${p.seen.networkMode}, not none`);
        if (!/^lo \([^;]*\)$/.test(info(r, INTERFACES_UP) ?? "")) found.push(`interfaces up inside: ${info(r, INTERFACES_UP)}`);
        if (!/^lo \([^,]*\)$/.test(info(r, INTERFACES_ALL) ?? "")) found.push(`interfaces inside: ${info(r, INTERFACES_ALL)}`);
        const planned = planAttempts(parseSettings(given)).map((a) => a.id);
        if (JSON.stringify(r.attempts.map((a) => a.id)) !== JSON.stringify(planned)) found.push(`the attempts made are not exactly the planned ones: ${r.attempts.length} made, ${planned.length} planned`);
      }
    }

    // 3. The database's network, from a Node container that shares it (network namespace only).
    check("db-real", "db", await probeInNetworkOf(x.sb, "db", "db-real", settings));

    // The users the probes ran as: the real images' own, never root for the app or tools; the runner's 1001.
    if (!(userIds["app-running"]! > 0)) problems["app-running"]!.push(`the probe in the running app ran as user id ${userIds["app-running"]}, not an unprivileged user`);
    if (userIds["app-real"] !== userIds["app-running"]) problems["app-real"]!.push(`the one-off app container ran as user id ${userIds["app-real"]}, the running app's probe as ${userIds["app-running"]}`);
    if (!(userIds["tools-real"]! > 0)) problems["tools-real"]!.push(`the tools container ran as user id ${userIds["tools-real"]}, not the image's unprivileged user`);
    for (const label of ["runner-real", "camera-real"]) if (userIds[label] !== RUNNER_UID) problems[label]!.push(`ran as user id ${userIds[label]}, not the runner's ${RUNNER_UID}`);

    // All at once, so that a failure shows every container's differences.
    expect(problems).toEqual({ "app-running": [], "app-real": [], "tools-real": [], "runner-real": [], "camera-real": [], "check-real": [], "engine-real": [], "db-real": [] });
  }, 2_400_000);

  it("L5: the positive controls, with the real project's settings: from the machine's own network and from Docker's default network, the same settings reach the harness's listener (so the targets and ports are right)", async () => {
    needsPrerequisites();
    const { x } = theProject();
    const { canary } = await listeners();
    const { settings } = await devProbeSettings(x.sb, { appPort: APP_PORT, gatewayPort: GATEWAY_PORT });
    const bridgeAddress = (await run("docker", ["network", "inspect", "bridge", "--format", "{{range .IPAM.Config}}{{.Gateway}}{{end}}"], { env: dockerEnv(x.sb) })).stdout.trim();
    const onMachine = report(await probeComparison(x.sb, "host", settings));
    const onBridge = report(await probeComparison(x.sb, "bridge", settings));
    const m = compareWithExpected(onMachine, expectedPositiveControls("machine", { canaryPort: canary.port, bridgeAddress }), false);
    const b = compareWithExpected(onBridge, expectedPositiveControls("default-bridge", { canaryPort: canary.port, bridgeAddress }), false);
    expect({ machine: [...failing(m), ...m.missing], bridge: [...failing(b), ...b.missing] }).toEqual({ machine: [], bridge: [] });
    // And each got more answers than any project container is allowed.
    expect(onMachine.attempts.filter((a) => gotAnswer(a.result)).length).toBeGreaterThan(5);
    expect(onBridge.attempts.filter((a) => gotAnswer(a.result)).length).toBeGreaterThan(1);
  }, 600_000);

  it("L6: deliberate misconfiguration R1 on real containers: the real app also on an ordinary bridge fails the app's comparison, in a one-off container and in the running app itself", async () => {
    needsPrerequisites();
    await listeners();
    const mis = await startRealProject({ projectId: `${PROJECT}_mis1`, appPort: APP_PORT, edits: REAL_MISCONFIGURATIONS.R1.edits, onMade });
    try {
      // The images are the real ones: it is the misconfiguration that must fail the comparison, nothing else.
      expect(realImageProblemsFrom(mis.images)).toEqual([]);
      // Read after the networks exist: the new bridge's address on the machine appears only then.
      const { settings } = await devProbeSettings(mis.x.sb, { appPort: APP_PORT, gatewayPort: GATEWAY_PORT });
      const oneOff = await probeServiceSeen(mis.x.sb, "app", "app-misconfigured", settings);
      expect(oneOff.seen.imageId).toBe(mis.images.app.id);
      const c1 = compare(report(oneOff.lines), "app");
      const inPlace = await probeInPlace(mis.x.sb, "app", settings);
      const c2 = compare(report(inPlace.lines), "app-running");
      expect({ "one-off app container": c1.pass, "the running app, in place": c2.pass }).toEqual({ "one-off app container": false, "the running app, in place": false });
      // What gave it away: answers from outside, or from the machine at its new bridge's address.
      expect(failingIds(c1).filter((id) => /^(A|B|D1|D5|M)/.test(id)).length).toBeGreaterThan(0);
      expect(failingIds(c2).filter((id) => /^(A|B|D1|D5|M)/.test(id)).length).toBeGreaterThan(0);
      expect(inPlace.removed).toBe(true);
    } finally {
      await remove(mis.x);
    }
  }, 2_400_000);

  it("L7: deliberate misconfiguration R2 on real containers: the data network internal without the isolated gateway mode fails the real tools container's comparison (the machine is reached at that network's address)", async () => {
    needsPrerequisites();
    const { canary } = await listeners();
    const mis = await startRealProject({ projectId: `${PROJECT}_mis2`, appPort: APP_PORT, edits: REAL_MISCONFIGURATIONS.R2.edits, onMade });
    try {
      expect(realImageProblemsFrom(mis.images)).toEqual([]);
      // Read after the network exists: its address on the machine appears only then.
      const { settings, machineAddresses } = await devProbeSettings(mis.x.sb, { appPort: APP_PORT, gatewayPort: GATEWAY_PORT });
      const p = await probeServiceSeen(mis.x.sb, "tools", "tools-misconfigured", settings);
      expect(p.seen.imageId).toBe(mis.images.tools.id);
      const c = compare(report(p.lines), "tools");
      expect(c.pass).toBe(false);
      const leaked = c.rows.filter((r) => !r.pass);
      expect(leaked.some((r) => r.id.startsWith("M") && r.id.endsWith(`:${canary.port}`)), JSON.stringify({ leaked, machineAddresses })).toBe(true);
    } finally {
      await remove(mis.x);
    }
  }, 2_400_000);

  it("L8: deliberate misconfiguration R3 on real containers: the real runner also on the data network fails the runner's comparison (it finds and reaches the database), and the builder's own check refuses the file", async () => {
    needsPrerequisites();
    await listeners();
    const mis = await startRealProject({ projectId: `${PROJECT}_mis3`, appPort: APP_PORT, edits: REAL_MISCONFIGURATIONS.R3.edits, onMade });
    try {
      expect(realImageProblemsFrom(mis.images)).toEqual([]);
      // The builder's own check before the camera runs (cameraNetworkProblem): the service must be on front alone.
      expect(await cameraNetworkProblem(mis.x.sb)).toMatch(/^Compose puts the acceptance service on (data, front|front, data), not on the project's front network alone$/);
      const { settings } = await devProbeSettings(mis.x.sb, { appPort: APP_PORT, gatewayPort: GATEWAY_PORT });
      const p = await probeServiceSeen(mis.x.sb, "acceptance", "runner-misconfigured", settings);
      expect(p.seen.imageId).toBe(mis.images.acceptance.id);
      const c = compare(report(p.lines), "runner");
      expect(c.pass).toBe(false);
      expect(failingIds(c)).toEqual(expect.arrayContaining(["D3", "Pdb:5432"]));
    } finally {
      await remove(mis.x);
    }
  }, 2_400_000);

  it("L9: deliberate misconfiguration R4 on real containers: the scripted engine's container given the out network fails its empty list (a name server inside, and the door's two ports answer)", async () => {
    needsPrerequisites();
    await listeners();
    const mis = await startRealProject({ projectId: `${PROJECT}_mis4`, appPort: APP_PORT, edits: REAL_MISCONFIGURATIONS.R4.edits, build: false, onMade });
    try {
      const { settings } = await devProbeSettings(mis.x.sb, { appPort: APP_PORT, gatewayPort: GATEWAY_PORT });
      const p = await probeServiceSeen(mis.x.sb, "engine", "engine-misconfigured", settings);
      expect(p.seen.imageId).toBe(mis.images.node.id);
      expect(p.seen.networkMode).not.toBe("none");
      const c = compare(report(p.lines), "engine-scripted");
      expect(c.pass).toBe(false);
      const ids = failingIds(c);
      expect(ids.filter((id) => id.startsWith("X")).length).toBeGreaterThan(0);
      expect(ids).toEqual(expect.arrayContaining(["Pegress:3128", "Pegress:4010"]));
    } finally {
      await remove(mis.x);
    }
  }, 1_200_000);

  it("L10: everything made is removed, and the shared runner image is still on the machine", async () => {
    needsPrerequisites();
    await remove(theProject().x);
    expect(left).toEqual({ [PROJECT]: NOTHING_LEFT, [`${PROJECT}_mis1`]: NOTHING_LEFT, [`${PROJECT}_mis2`]: NOTHING_LEFT, [`${PROJECT}_mis3`]: NOTHING_LEFT, [`${PROJECT}_mis4`]: NOTHING_LEFT });
    expect(made).toEqual([]);
    // The runner's image is machine-wide and shared: it is never removed here, and it is the one L2 built.
    expect((await run("docker", ["image", "inspect", RUNNER_IMAGE, "--format", "{{.Id}}"])).stdout.trim()).toBe(runnerImageId);
    expect(runnerImageId).toMatch(/^sha256:[0-9a-f]{64}$/);
  }, 600_000);
});
