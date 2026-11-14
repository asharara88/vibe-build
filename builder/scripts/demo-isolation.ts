/**
 * Evidence run for package 0.6c (extending package 0.6a's): the development profile's network boundary,
 * checked from inside every project container and compared, attempt by attempt, with the list design note 2.5
 * allows each one (amendments of 13 and 14 Nov 2026). Two parts, in one go:
 *
 * Usage (from builder/): npx tsx scripts/demo-isolation.ts [outDir]
 *
 * It first checks that Docker answers and that the approved browser zip is in the folder BUILDER_BROWSER_CACHE
 * names, and stops in plain words if not. It never falls back to stand-ins.
 *
 * PART A (14 Nov 2026): REAL CONTAINERS OF A REAL EXAMPLE-1 PROJECT.
 *  A1. The acceptance runner's real image, built from the approved browser zip. A real example-1 project made by
 *      the product's own functions (makeExample1, the scripted engine's steps 01 and 02, buildAndStart), with the
 *      door started too (the product does not start it for such a project today). Each image's name, id and
 *      user, and whether it is the real one (`realImageProblemsFrom`).
 *  A2. The probe INSIDE each real container, compared with its list: the running app in place (the probe file
 *      written into its own /tmp through `docker compose exec`, checked against the repository's file, run there,
 *      removed); and the app, tools, runner, live camera, check and the scripted engine, each as a one-off
 *      container of its own service from its real image, with Docker asked which image the container runs; and
 *      the database's network, from a Node container sharing it. For each: where it ran and how the probe got in.
 *  A3. The two positive controls, with the real project's settings.
 *  A4. Four deliberate misconfigurations of real containers (text edits of the Compose file the manager wrote,
 *      before anything starts), each of which must FAIL its comparison: R1 the real app also on an ordinary
 *      bridge; R2 the data network without the isolated gateway mode, probed in the real tools container; R3 the
 *      real runner also on data (also refused by the builder's own check, `cameraNetworkProblem`); R4 the scripted
 *      engine's container given the out network.
 *
 * PART B (as on 13 Nov 2026): PLACEMENT, IN STAND-IN IMAGES. Its checks are unchanged; only its labels say what
 * each column ran in.
 *  1. A project sandbox on the development profile, written by the sandbox manager: the app, tools, database,
 *     runner and engine service (placed as package 2.2 would place it, `engine.network: "egress"`), the door
 *     (`egress`) and the machine side (`egress-host`). Stand-in images for the app, tools and runner
 *     (scripts/isolation-harness.ts): this shows where the Compose file places each container, not the real
 *     containers. A stand-in gateway on the machine's loopback address, and the harness's "canary" listener on
 *     every address of the machine.
 *  2. Read on the machine, read-only: its listening TCP sockets and every address it holds.
 *  3. The probe (scripts/isolation-probe.mjs, mounted read-only) in each of those containers, and its attempts
 *     compared with that container's expected list: every row PASS or FAIL.
 *  4. Positive controls: the same settings from a container on the machine's own network and one on Docker's
 *     default network (not project containers), which must reach the canary.
 *  5. Deliberate misconfigurations, each of which must FAIL its comparison: the app also given an ordinary
 *     bridge (a way out); the data network made internal without the isolated gateway mode; and (package J3) the
 *     stream container (`check`) also on `out`, and on the machine's network, each also refused by the builder's own
 *     check before a live session opens (`streamNetworkProblem`).
 *  6. The machine side's and the door's own logs.
 *  7. Every attempt, one row each.
 * Package J3 added to part B: the live preview's stream container (`check`) and the live camera (the runner's
 * service with the camera socket's folder mounted at /psock), each compared with its own list; a stand-in for the
 * preview front listening on 127.0.0.1:4041 before the machine is read, so that groups G and M try it too (gap 128,
 * point 3); and the camera socket (src/web/preview.ts, `cameraSocket`), which leads only to that port.
 *
 * Then everything is removed, and what is left is listed, with the Docker objects before and after. The
 * acceptance runner's image is machine-wide and shared: nothing here removes it.
 *
 * PACKAGE 2.2's ENGINE DOES NOT EXIST. Nothing here runs in it, and no column is it. Part A's engine column is the
 * scripted engine's container (package 2.1; no network). Part B's is the engine service placed as 2.2's option
 * would place it, in the approved Node image: a placement, not an engine. The last line of the run says so.
 *
 * Nothing the probe tests is run on this machine: every attempt is made from inside a container.
 * Development profile only. No model is called (part B's gateway is a stand-in; nothing is behind part A's gateway
 * address). No code a model wrote is run. Made-up data only. No setting's value is printed; the session proxy is
 * named by host and port only.
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { liveAcceptanceProblems } from "../src/acceptance/prerequisites.js";
import { RUNNER_IMAGE, RUNNER_UID } from "../src/acceptance/runner-image.js";
import {
  ANSWER_WORDING,
  compareWithExpected,
  expectedOnDevelopment,
  expectedPositiveControls,
  gotAnswer,
  parseProbeOutput,
  renderComparison,
  renderMarkdownTable,
  sessionProxyHostPort,
  type Column,
  type Comparison,
  type DevContainer,
  type ProbeReport,
} from "../src/sandbox/isolation.js";
import { composeDocument, createSandbox, DEFAULT_IMAGES, dockerEnv, sandbox, socketOwner, toYaml, type Sandbox, type SandboxSpec } from "../src/sandbox/manager.js";
import { cameraNetworkProblem, streamNetworkProblem } from "../src/orchestrator/example-1-adapter.js";
import { cameraSocket } from "../src/web/preview.js";
import type { Example1 } from "./example-1-sandbox.js";
import { DEFAULT_ROUTE_INFO, INTERFACES_ALL, INTERFACES_UP, parseSettings, planAttempts } from "./isolation-probe.mjs";
import {
  buildStandIns,
  builderDir,
  destroyRealProject,
  devProbeSettings,
  ensureRunnerImage,
  freePort,
  FRONT_STAND_IN,
  GATEWAY_STAND_IN,
  imageFacts,
  IN_PLACE_PATH,
  leftOf,
  probeComparison,
  probeInNetworkOf,
  probeInPlace,
  probeService,
  probeServiceSeen,
  REAL_MISCONFIGURATIONS,
  realImageProblemsFrom,
  removeImages,
  runnerStandInImageFor,
  startCanary,
  startFrontStandIn,
  startGatewayStandIn,
  startRealProject,
  type ImageFacts,
  type SeenContainer,
} from "./isolation-harness.js";

const run = promisify(execFile);
const outDir = process.argv[2] ? resolve(process.argv[2]) : null;
const log = (s = "") => console.log(s);
const APP_PORT = 3171;
/** Part A: the real app's port inside its project's own networks, and the gateway address makeExample1 gives every project. */
const REAL_APP_PORT = 3191;
const REAL_GATEWAY_PORT = 4010;
const REAL_PROJECT = "p_iso06c_real_demo";
/** Below this much free disk the run does not start (the project's floor of 4 GB; itself assumed, not measured). */
const DISK_FLOOR_KB = 4 * 1024 * 1024;
const t0 = Date.now();

const dockerObjects = async () => {
  const ask = async (args: string[]) => (await run("docker", args)).stdout.trim().split("\n").filter(Boolean).sort().join(", ") || "none";
  return [
    `containers: ${await ask(["ps", "-a", "--format", "{{.Names}}"])}`,
    `networks: ${await ask(["network", "ls", "--format", "{{.Name}}"])}`,
    `volumes: ${await ask(["volume", "ls", "--format", "{{.Name}}"])}`,
    `images: ${await ask(["images", "--format", "{{.Repository}}:{{.Tag}}"])}`,
  ];
};

const made: Array<{ sb: Sandbox; dir: string; images: string[] }> = [];
/** Part A's real projects, so that whatever fails, the clean-up removes them. */
const realMade: Example1[] = [];
let gateway: Awaited<ReturnType<typeof startGatewayStandIn>> | undefined;
let canary: Awaited<ReturnType<typeof startCanary>> | undefined;
let front: Awaited<ReturnType<typeof startFrontStandIn>> | undefined;
let camera: Awaited<ReturnType<typeof cameraSocket>> | undefined;
const FRONT_PORT = 4041;
const files: Record<string, string> = {};
/** Part B's verdict (placement, in stand-in images), as on 13 Nov. */
let verdict = true;
/** Part A's verdict (real containers). */
let verdictReal = true;
/** One row of the table "Which is which", for every column of both parts. */
const which: string[][] = [];
const esc = (s: string) => s.replace(/\|/g, "\\|");
const shortId = (id: string | undefined) => (id ? id.replace(/^sha256:/, "").slice(0, 12) : "not seen");

async function makeProject(projectId: string, mutate?: (doc: Record<string, unknown>) => void): Promise<{ sb: Sandbox; spec: SandboxSpec }> {
  const dir = mkdtempSync(join(tmpdir(), "builder-iso06c-demo-"));
  const workspace = join(dir, "workspace");
  mkdirSync(workspace, { recursive: true });
  const spec: SandboxSpec = {
    projectId,
    dir,
    profile: "development-cloud-session",
    allowHosts: ["registry.npmjs.org"],
    gatewayUrl: `http://127.0.0.1:${gateway!.port}`,
    builderDir,
    hostProxy: { url: process.env.HTTPS_PROXY ?? "" },
    buildProxyPort: await freePort(),
    app: { buildContext: workspace, port: APP_PORT, env: { APP_URL: `http://app:${APP_PORT}` } },
    engine: { workspace, changeSets: join(builderDir, "scripted"), network: "egress" },
    acceptance: { image: runnerStandInImageFor(projectId), baseUrl: `http://app:${APP_PORT}` },
  };
  const sb = createSandbox(spec, "sample-only-password", { AUTH_SECRET: "made-up-secret", APP_SAMPLE_PASSWORD: "made-up-sample" });
  if (mutate) {
    const doc = composeDocument(spec, socketOwner());
    mutate(doc);
    writeFileSync(sb.composeFile, toYaml(doc));
  }
  made.push({ sb, dir, images: buildStandIns(sb, projectId) });
  return { sb, spec };
}

function show(label: string, report: ProbeReport, c: Comparison) {
  const answered = report.attempts.filter((a) => gotAnswer(a.result));
  const failed = c.rows.filter((r) => !r.pass);
  log(`  -- ${label}: ${report.attempts.length} attempts; ${answered.length} got an answer (${ANSWER_WORDING}); compared with its list: ${c.pass ? "PASS" : "FAIL"} (${c.rows.length - failed.length} rows PASS, ${failed.length} FAIL${c.missing.length ? `, ${c.missing.length} expected answers not tried` : ""})`);
  for (const i of report.info.filter((x) => /route|IPv6|forwarding|interfaces that are up|name servers/.test(x.name))) log(`     ${i.name}: ${i.value}`);
  for (const a of answered) log(`     answered: ${a.id} ${a.target}: ${a.result}${a.detail ? `; ${a.detail}` : ""}`);
  for (const r of failed) log(`     FAIL ${r.id} ${r.target}: expected ${r.expected}; got ${r.actual}`);
  for (const m of c.missing) log(`     FAIL not tried: ${m}`);
  if (report.problems.length) log(`     PROBLEMS: ${report.problems.join(" / ")}`);
}

const info = (r: ProbeReport, name: string) => r.info.find((i) => i.name === name)?.value;
const counts = (c: Comparison) => `${c.rows.filter((r) => r.pass).length} PASS, ${c.rows.filter((r) => !r.pass).length + c.missing.length} FAIL`;
/** A docker command as it is kept: the probe's settings and the encoded probe are named, not written out. */
const commandWords = (args: string[]) => args.map((a) => (a.length > 300 ? `<${a.length} characters>` : /[\s"'{}]/.test(a) ? JSON.stringify(a) : a)).join(" ");

/** Part A: the probe in the real containers of a real example-1 project. Sets `verdictReal`. */
async function realContainers(): Promise<void> {
  const tA = Date.now();
  log("==== PART A. REAL CONTAINERS OF A REAL EXAMPLE-1 PROJECT (14 Nov 2026) ====");
  log("== A1. The real images and the real project ==");
  const runner = await ensureRunnerImage();
  log(`  The acceptance runner's real image ${runner.image}: built from the approved browser zip by buildRunnerImage (from Docker's build cache when nothing changed); as approved; it carries the zip's label. Id ${runner.imageId}.`);
  const real = await startRealProject({ projectId: REAL_PROJECT, appPort: REAL_APP_PORT, onMade: (x) => void realMade.push(x), log });
  const { x, images, appContainer } = real;
  log(`  The door (egress, with egress-host) was started too; the product does not start it for a scripted-engine project today. Nothing listens behind this project's gateway address (127.0.0.1:${REAL_GATEWAY_PORT}).`);
  const ps = JSON.parse(`[${(await sandbox.ps(x.sb)).trim().split("\n").join(",")}]`) as Array<{ Service: string; State: string; Health?: string }>;
  for (const p of ps) log(`  Container ${p.Service}: ${p.State}${p.Health ? ` (${p.Health})` : ""}`);
  const howMade: Array<[string, ImageFacts, string]> = [
    ["app", images.app, "built in this run by sandbox.build from the project's workspace (the house template after the scripted engine's steps 01 and 02), the Dockerfile's `run` stage"],
    ["tools", images.tools, "built in this run by sandbox.build from the same workspace, the Dockerfile's `tools` stage"],
    ["acceptance runner", images.acceptance, "built by buildRunnerImage from builder/runner and the approved browser zip; machine-wide, never removed here"],
    ["approved Node image (check, engine, door)", images.node, "the approved Node image, by its digest"],
  ];
  const imageLines = howMade.map(([what, i, how]) => `${what}: ${i.name}\n  id: ${i.id || "(not on this machine)"}\n  user: ${JSON.stringify(i.user)}; command: ${JSON.stringify(i.command).slice(0, 120)}; entrypoint: ${JSON.stringify(i.entrypoint)}; working folder: ${JSON.stringify(i.workingDir)}; labels: ${JSON.stringify(i.labels)}\n  how it was made: ${how}`);
  files["real-images.txt"] = `${imageLines.join("\n")}\nThe running app container ${appContainer?.id.slice(0, 12)} runs image ${appContainer?.imageId}.\n`;
  for (const l of imageLines) for (const part of l.split("\n")) log(`  ${part}`);
  const notReal = realImageProblemsFrom(images);
  log(`  Are these the real images (realImageProblemsFrom)? ${notReal.length ? `NO: ${notReal.join("; ")}` : "Yes: no problem found."}`);
  if (notReal.length) verdictReal = false;
  const sameImage = appContainer?.imageId === images.app.id;
  log(`  The running app container runs the image the build made: ${sameImage ? "yes" : "NO"} (${appContainer?.imageId}).`);
  if (!sameImage) verdictReal = false;
  if (images.acceptance.id !== runner.imageId) {
    log(`  NO: the acceptance service's image id ${images.acceptance.id} is not the id the runner's build gave (${runner.imageId}).`);
    verdictReal = false;
  }
  log();

  log("== A2. The probe inside each real container, compared with its list ==");
  const { settings, machineAddresses, machineListeners } = await devProbeSettings(x.sb, { appPort: REAL_APP_PORT, gatewayPort: REAL_GATEWAY_PORT });
  files["real-probe-settings.json"] = settings + "\n";
  log(`  Every address the machine holds: ${machineAddresses.join(", ")}`);
  log(`  Listening TCP sockets on the machine: ${machineListeners.join(", ")}`);
  log(`  Machine listeners given to the probe include the front's port ${FRONT_PORT}: ${settings.includes(`:${FRONT_PORT}"`) ? "yes" : "NO"}.`);
  if (!settings.includes(`:${FRONT_PORT}"`)) verdictReal = false;
  const ctx = { appPort: REAL_APP_PORT, gatewayServer: /server: \(no gateway is behind the real project's address in this run\)/, frontServer: new RegExp(`server: ${FRONT_STAND_IN}`) };
  const withSocket = JSON.stringify({ ...JSON.parse(settings), sockets: ["/psock/c.sock"] });
  const machineRows = machineAddresses.length * new Set(machineListeners.map((l) => l.split(":").pop())).size;
  const columns: Column[] = [];
  const containers: string[] = [];
  const userIds: Record<string, number> = {};
  /** One real column: its files, its comparison, the same conditions the live test asks, and its row of "Which is which". */
  const column = (key: string, kind: DevContainer, label: string, word: string, lines: string[], where: { container: string; image: string; imageId?: string; how: string; dockerUser?: string; networks?: string; commands: string[] }, extra: string[]) => {
    files[`real-probe-${key}.jsonl`] = lines.join("\n") + "\n";
    const report = parseProbeOutput(lines);
    const c = compareWithExpected(report, expectedOnDevelopment(kind, ctx));
    files[`real-comparison-${key}.md`] = `# ${label}\n\n${renderComparison(label, c)}\n`;
    columns.push({ label, report, ownLoopback: true });
    show(label, report, c);
    const m = report.attempts.filter((a) => a.id.startsWith("M")).length;
    if (m !== machineRows) extra.push(`${m} rows toward the machine's addresses, not ${machineRows} (every address on every port)`);
    if (info(report, DEFAULT_ROUTE_INFO) !== "no") extra.push(`a default route: ${info(report, DEFAULT_ROUTE_INFO)}`);
    userIds[key] = Number(info(report, "user id"));
    for (const e of extra) log(`     FAIL ${e}`);
    log(`     where it ran: container ${where.container}; image ${where.image} (${where.imageId ?? "not seen"}); user id ${info(report, "user id")} (the probe's own line)${where.dockerUser !== undefined ? `, Docker's user setting ${JSON.stringify(where.dockerUser)}` : ""}; networks: ${where.networks ?? "not asked"}; how the probe got in: ${where.how}`);
    if (!c.pass || extra.length) verdictReal = false;
    which.push([label, word, `real example-1 (${x.sb.projectName})`, `${where.image} (${shortId(where.imageId)})`, where.container, where.how, info(report, "user id") ?? "?", `\`${kind}\``, counts(c), !c.pass || extra.length ? "FAIL" : "PASS"]);
    containers.push(`### ${label}\n\n- Kind: ${word}\n- Container: ${where.container}\n- Image: ${where.image}, id ${where.imageId ?? "not seen"}\n- User id the probe reported: ${info(report, "user id")}${where.dockerUser !== undefined ? `; Docker's user setting: ${JSON.stringify(where.dockerUser)}` : ""}\n- Networks, as Docker reported them: ${where.networks ?? "not asked"}\n- How the probe got in: ${where.how}\n- Compared with the list \`${kind}\`: ${c.pass && !extra.length ? "PASS" : "FAIL"} (${counts(c)})${extra.length ? `\n- Other conditions not met: ${extra.join("; ")}` : ""}\n- The docker command${where.commands.length > 1 ? "s" : ""}:\n${where.commands.map((cmd) => `  - \`${cmd.replace(/`/g, "'")}\``).join("\n")}\n`);
    return { report, c };
  };
  const seenWords = (seen: SeenContainer) => (seen.whileRunning ? `${seen.networkMode === "none" || seen.networkMode === "host" ? `network mode ${seen.networkMode}` : (seen.networks ?? []).join(", ") || `network mode ${seen.networkMode}`}; read-only root: ${seen.readOnlyRoot}` : `not seen running (${seen.problem})`);
  const realImage = (extra: string[], seen: SeenContainer, image: ImageFacts) => {
    if (!seen.whileRunning) extra.push(`the container was not seen running (${seen.problem ?? "no reason given"})`);
    else if (seen.imageId !== image.id) extra.push(`the container ran image ${seen.imageId}, which is not ${image.name} as read after the build (${image.id})`);
  };

  // The running app container itself, in place.
  const inPlace = await probeInPlace(x.sb, "app", settings);
  const appNetworks = appContainer ? (await run("docker", ["inspect", appContainer.id, "--format", "{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}; user setting {{json .Config.User}}; read-only root: {{.HostConfig.ReadonlyRootfs}}"], { env: dockerEnv(x.sb) })).stdout.trim() : "not asked";
  const inPlaceExtra: string[] = [];
  if (inPlace.sha256.inside !== inPlace.sha256.repository) inPlaceExtra.push(`the file run inside has SHA-256 ${inPlace.sha256.inside}, not the repository's ${inPlace.sha256.repository}`);
  if (inPlace.container.before !== appContainer?.id || inPlace.container.after !== appContainer?.id) inPlaceExtra.push(`the app's container changed during the probe: ${JSON.stringify(inPlace.container)}`);
  if (!inPlace.removed) inPlaceExtra.push("the probe file was not seen gone after its removal");
  const stillThere = (await sandbox.exec(x.sb, "app", ["node", "-e", "console.log(require('fs').existsSync(process.argv[1]))", IN_PLACE_PATH])).trim();
  if (stillThere !== "false") inPlaceExtra.push(`asked again, the probe file is still in the running app container (${stillThere})`);
  const compose = `docker compose -f ${x.sb.composeFile} --profile tools --profile engine --profile acceptance --profile check exec -T app`;
  const ran = column("app-running", "app-running", "app, the running container itself (real container, in place)", "real container, in place", inPlace.lines, {
    container: `${x.sb.projectName}-app-1 (${appContainer?.id.slice(0, 12)}), the one buildAndStart started; the same before and after the probe`,
    image: images.app.name,
    imageId: appContainer?.imageId,
    how: `\`docker compose exec\` in the running container: the probe file written to its own ${IN_PLACE_PATH} from one base64 argument (${inPlace.encodedLength} characters), its SHA-256 read back inside (${inPlace.sha256.inside}; the repository's file: ${inPlace.sha256.repository}), run there, removed (seen gone: ${inPlace.removed})`,
    networks: appNetworks,
    commands: [`${compose} node -e <write the file from one base64 argument> ${IN_PLACE_PATH} <${inPlace.encodedLength} characters>`, `${compose} node -e <print the file's SHA-256> ${IN_PLACE_PATH}`, `${compose} node ${IN_PLACE_PATH} <settings: ${settings.length} characters, in real-probe-settings.json>`, `${compose} node -e <remove the file and say whether it is gone> ${IN_PLACE_PATH}`],
  }, inPlaceExtra);
  const ownListener = `0.0.0.0:${REAL_APP_PORT}`;
  const listening = info(ran.report, "listening TCP ports seen in /proc/net") ?? "";
  log(`     listening TCP ports seen inside the running app: ${listening}; its own listener ${ownListener} among them: ${listening.split(", ").includes(ownListener) ? "yes" : "NO"}`);
  if (!listening.split(", ").includes(ownListener)) verdictReal = false;

  // Each one-off container of a real service, from its real image.
  const oneOff: Array<[string, DevContainer, string, string, ImageFacts, string, string[]]> = [
    ["app", "app", "app", "app, a one-off container of the real image (real image, one-off container)", images.app, settings, []],
    ["tools", "tools", "tools", "tools, a one-off container of the real image (real image, one-off container)", images.tools, settings, []],
    ["runner", "runner", "acceptance", "runner (package 3.1), a one-off container of the real image (real image, one-off container)", images.acceptance, settings, []],
    ["camera", "camera", "acceptance", "the live camera: the runner's service with the camera socket at /psock, the real runner image (real image, one-off container)", images.acceptance, withSocket, [`${camera!.dir}:/psock:ro`]],
    ["check", "check", "check", "a live preview stream, check (real image, one-off container)", images.node, settings, []],
    ["engine-scripted", "engine-scripted", "engine", "the scripted engine's container (package 2.1; no network; NOT package 2.2's engine) (real image, one-off container)", images.node, settings, []],
  ];
  for (const [key, kind, service, label, image, given, volumes] of oneOff) {
    const p = await probeServiceSeen(x.sb, service, `${key}-real`, given, volumes);
    const extra: string[] = [];
    realImage(extra, p.seen, image);
    if (key === "app" && p.seen.whileRunning && p.seen.imageId !== appContainer?.imageId) extra.push(`the one-off app container ran image ${p.seen.imageId}, the running app container runs ${appContainer?.imageId}`);
    const r = parseProbeOutput(p.lines);
    if (key === "engine-scripted") {
      if (p.seen.whileRunning && p.seen.networkMode !== "none") extra.push(`Docker gives the engine container network mode ${p.seen.networkMode}, not none`);
      if (!/^lo \([^;]*\)$/.test(info(r, INTERFACES_UP) ?? "")) extra.push(`interfaces up inside: ${info(r, INTERFACES_UP)}`);
      if (!/^lo \([^,]*\)$/.test(info(r, INTERFACES_ALL) ?? "")) extra.push(`interfaces inside: ${info(r, INTERFACES_ALL)}`);
      const planned = planAttempts(parseSettings(given)).map((a) => a.id);
      if (JSON.stringify(r.attempts.map((a) => a.id)) !== JSON.stringify(planned)) extra.push(`the attempts made are not exactly the planned ones: ${r.attempts.length} made, ${planned.length} planned`);
    }
    column(key, kind, label, "real image, one-off container", p.lines, {
      container: `${p.seen.container}, a one-off container of the ${service} service (\`docker compose run --rm --no-deps\`), removed when the probe ended`,
      image: p.seen.imageName ?? image.name,
      imageId: p.seen.imageId,
      how: `the probe mounted read-only at /probe as the container's command, in place of the service's own`,
      dockerUser: p.seen.user,
      networks: seenWords(p.seen),
      commands: [commandWords(p.command)],
    }, extra);
  }
  // The database's network, from a Node container sharing it.
  const dbLines = await probeInNetworkOf(x.sb, "db", "db-real", settings);
  column("db", "db", "db: the probe in the running database container's network (network namespace only)", "network namespace only", dbLines, {
    container: `${x.sb.projectName}-isolation-db-real, a container of the approved Node image sharing the running database container's network (\`docker run --network container:<db>\`)`,
    image: images.node.name,
    imageId: images.node.id,
    how: "only the network is the database's; the image, user and files are the probe container's (the database's image has no Node)",
    commands: [`docker run --rm --name ${x.sb.projectName}-isolation-db-real --network container:<the running db container> --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 256 --memory 1g --read-only --entrypoint "" --volume <the probe>:/probe/isolation-probe.mjs:ro <the approved Node image> node /probe/isolation-probe.mjs <settings>`],
  }, []);
  // The users the probes ran as.
  const users: string[] = [];
  if (!(userIds["app-running"]! > 0)) users.push(`the probe in the running app ran as user id ${userIds["app-running"]}, not an unprivileged user`);
  if (userIds["app"] !== userIds["app-running"]) users.push(`the one-off app container ran as user id ${userIds["app"]}, the running app's probe as ${userIds["app-running"]}`);
  if (!(userIds["tools"]! > 0)) users.push(`the tools container ran as user id ${userIds["tools"]}, not the image's unprivileged user`);
  for (const key of ["runner", "camera"]) if (userIds[key] !== RUNNER_UID) users.push(`${key} ran as user id ${userIds[key]}, not the runner's ${RUNNER_UID}`);
  log(`  User ids the probes reported: ${Object.entries(userIds).map(([k, v]) => `${k} ${v}`).join("; ")}. As they should be (app and tools unprivileged, in place equal to one-off, runner and camera ${RUNNER_UID}): ${users.length ? `NO: ${users.join("; ")}` : "yes"}.`);
  if (users.length) verdictReal = false;
  log();

  log("== A3. Positive controls (not project containers), with the real project's settings: they must reach the canary ==");
  const bridgeAddress = (await run("docker", ["network", "inspect", "bridge", "--format", "{{range .IPAM.Config}}{{.Gateway}}{{end}}"], { env: dockerEnv(x.sb) })).stdout.trim();
  for (const [key, where, kind, label] of [
    ["control-machine", "host", "machine", "comparison: the machine's own network (real project's settings)"],
    ["control-bridge", "bridge", "default-bridge", "comparison: Docker's default network (real project's settings)"],
  ] as const) {
    const lines = await probeComparison(x.sb, where, settings);
    files[`real-probe-${key}.jsonl`] = lines.join("\n") + "\n";
    const report = parseProbeOutput(lines);
    const c = compareWithExpected(report, expectedPositiveControls(kind, { canaryPort: canary!.port, bridgeAddress }), false);
    files[`real-comparison-${key}.md`] = `# ${label}\n\n${renderComparison(label, c)}\n`;
    columns.push({ label, report, ownLoopback: where === "bridge" });
    show(label, report, c);
    if (!c.pass) verdictReal = false;
  }
  log();

  log("== A4. Four deliberate misconfigurations of real containers: each must FAIL its comparison ==");
  const ids = (c: Comparison) => c.rows.filter((r) => !r.pass).map((r) => r.id);
  const misRow = (label: string, word: string, project: string, image: string, imageId: string | undefined, container: string, how: string, report: ProbeReport, kind: DevContainer, c: Comparison, caught: boolean) =>
    which.push([`${label} (misconfigured on purpose)`, word, `real example-1 (${project}), its Compose file edited before anything started`, `${image} (${shortId(imageId)})`, container, how, info(report, "user id") ?? "?", `\`${kind}\``, counts(c), caught ? "FAIL, as it must" : "PASSED: NOT CAUGHT"]);
  for (const n of [1, 2, 3, 4] as const) {
    const m = REAL_MISCONFIGURATIONS[`R${n}`];
    const tM = Date.now();
    const mis = await startRealProject({ projectId: `${REAL_PROJECT}_mis${n}`, appPort: REAL_APP_PORT, edits: m.edits, build: n !== 4, onMade: (y) => void realMade.push(y) });
    try {
      const project = mis.x.sb.projectName;
      log(`  R${n}: ${m.what} (${project}; made in ${Math.round((Date.now() - tM) / 1000)} s).`);
      if (n !== 4) {
        const p = realImageProblemsFrom(mis.images);
        log(`     its images are the real ones: ${p.length ? `NO: ${p.join("; ")}` : "yes"}`);
        if (p.length) verdictReal = false;
      }
      // Read after the networks exist: an address a misconfigured network puts on the machine appears only then.
      const s = await devProbeSettings(mis.x.sb, { appPort: REAL_APP_PORT, gatewayPort: REAL_GATEWAY_PORT });
      if (n === 2) log(`     Machine addresses once the misconfigured data network exists: ${s.machineAddresses.join(", ")}`);
      if (n === 3) {
        const refused = await cameraNetworkProblem(mis.x.sb);
        log(`     the builder's own check before the camera runs (cameraNetworkProblem): ${refused ?? "NOT REFUSED"}`);
        if (!refused) verdictReal = false;
      }
      const [service, kind, name, image] = ([["app", "app", "app-misconfigured", mis.images.app], ["tools", "tools", "tools-misconfigured", mis.images.tools], ["acceptance", "runner", "runner-misconfigured", mis.images.acceptance], ["engine", "engine-scripted", "engine-misconfigured", mis.images.node]] as const)[n - 1]!;
      const p = await probeServiceSeen(mis.x.sb, service, name, s.settings);
      files[`real-probe-misconfiguration-R${n}.jsonl`] = p.lines.join("\n") + "\n";
      const report = parseProbeOutput(p.lines);
      const c = compareWithExpected(report, expectedOnDevelopment(kind, ctx));
      files[`real-comparison-misconfiguration-R${n}.md`] = `# Misconfiguration R${n}: ${m.what}\n\nThe ${service} service, a one-off container of the real image ${p.seen.imageName ?? image.name} (${p.seen.imageId ?? "not seen"}), compared with the list \`${kind}\`.\n\n${renderComparison(`${service}, misconfigured`, c)}\n`;
      show(`misconfiguration R${n}: ${m.what}; the ${service} service's one-off container, image ${p.seen.imageName ?? image.name}`, report, c);
      const failed = ids(c);
      // What must give each away, as the live test asks it.
      const gaveAway =
        n === 1 ? failed.some((id) => /^(A|B|D1|D5|M)/.test(id))
        : n === 2 ? failed.some((id) => id.startsWith("M") && id.endsWith(`:${canary!.port}`))
        : n === 3 ? failed.includes("D3") && failed.includes("Pdb:5432")
        : failed.some((id) => id.startsWith("X")) && failed.includes("Pegress:3128") && failed.includes("Pegress:4010");
      const realOne = p.seen.whileRunning && p.seen.imageId === image.id;
      log(`     ran in the real image (${p.seen.imageId}, seen while it ran): ${realOne ? "yes" : "NO"}; what must give it away is among the failing rows: ${gaveAway ? "yes" : "NO"}`);
      const caught = !c.pass && gaveAway && realOne;
      if (!caught) verdictReal = false;
      misRow(`R${n}: ${m.what}`, "real image, one-off container", project, p.seen.imageName ?? image.name, p.seen.imageId, `${p.seen.container}, a one-off container of the ${service} service`, "the probe mounted read-only as the container's command", report, kind, c, caught);
      if (n === 1) {
        // The running app itself, misconfigured, probed in place.
        const ip = await probeInPlace(mis.x.sb, "app", s.settings);
        files["real-probe-misconfiguration-R1-in-place.jsonl"] = ip.lines.join("\n") + "\n";
        const r2 = parseProbeOutput(ip.lines);
        const c2 = compareWithExpected(r2, expectedOnDevelopment("app-running", ctx));
        files["real-comparison-misconfiguration-R1-in-place.md"] = `# Misconfiguration R1: ${m.what}; the running app itself, probed in place\n\n${renderComparison("app, misconfigured, in place", c2)}\n`;
        show(`misconfiguration R1: ${m.what}; the running app itself, in place`, r2, c2);
        const caught2 = !c2.pass && ids(c2).some((id) => /^(A|B|D1|D5|M)/.test(id)) && ip.removed && ip.sha256.inside === ip.sha256.repository;
        if (!caught2) verdictReal = false;
        misRow(`R1: ${m.what}; the running app itself`, "real container, in place", project, mis.images.app.name, mis.appContainer?.imageId, `${project}-app-1 (${mis.appContainer?.id.slice(0, 12)}), the running container`, "`docker compose exec` in the running container (as in A2)", r2, "app-running", c2, caught2);
      }
    } finally {
      log(`     Removed. Left of ${mis.x.sb.projectName}: ${await destroyRealProject(mis.x)}`);
      realMade.splice(realMade.indexOf(mis.x), 1);
    }
  }
  log();

  log("== A5. The real project's machine side and door: their own logs ==");
  const hostLog = (await sandbox.logs(x.sb, "egress-host")).split("\n").map((l) => l.replace(/^[^|]*\|\s*/, "")).filter(Boolean);
  const doorLog = (await sandbox.logs(x.sb, "egress")).split("\n").map((l) => l.replace(/^[^|]*\|\s*/, "")).filter(Boolean);
  files["real-egress-host-log.txt"] = hostLog.join("\n") + "\n";
  files["real-door-log.txt"] = doorLog.join("\n") + "\n";
  for (const l of hostLog.filter((y) => /listening|refusedToStart/.test(y))) log(`  egress-host: ${l}`);
  const decisions = hostLog.filter((y) => y.includes('"decision"')).length;
  log(`  egress-host: ${decisions} decisions logged. The image build's install step (npm ci) reaches the registry only through this side's loopback port${decisions === 0 ? "; no request came, so that step fetched nothing in this build (inferred: Docker took it from its build cache)" : ""}.`);
  log(`  door: ${doorLog.filter((l) => l.includes('"forwarded"')).length} connections forwarded (no real container of this project is on the out network); ${doorLog.filter((l) => l.includes('"error"')).length} errors.`);
  log();

  log("== A6. Every attempt in the real containers, one row each, one column per container (results only; the comparisons are in the files) ==");
  const table = renderMarkdownTable(columns);
  files["real-attempts-table.md"] = table + "\n";
  log(table);
  files["real-containers.md"] =
    `# Where each real column ran (part A)\n\nWritten by scripts/demo-isolation.ts from this run. Project ${x.sb.projectName}: a real example-1 project made by makeExample1, the scripted engine's steps 01 and 02, and buildAndStart, with the door started too.\n\n` +
    `## The images\n\n\`\`\`\n${files["real-images.txt"]}\`\`\`\n\nAre these the real images (realImageProblemsFrom)? ${notReal.length ? `No: ${notReal.join("; ")}` : "Yes: no problem found."}\n\n## The columns\n\n${containers.join("\n")}`;
  log();
  log(`Part A took ${Math.round((Date.now() - tA) / 1000)} s.`);
  log();
}

const missing = await liveAcceptanceProblems();
if (missing.length) {
  log(`This run probes the real containers, so it needs Docker and the approved browser zip. It stops here, and it does not fall back to stand-ins. Missing: ${missing.join(" ")}`);
  process.exit(1);
}

try {
  log("Package 0.6c: the development profile's network boundary, from inside every project container, compared with design note 2.5's lists.");
  log("Part A: the real containers of a real example-1 project. Part B: placement, in stand-in images, as on 13 Nov. Package 2.2's engine does not exist and is in neither.");
  log(`The session proxy, as the machine side is given it: ${sessionProxyHostPort(process.env.HTTPS_PROXY) ?? "not set"} (host and port only).`);
  const disk = `$ df -h /\n${(await run("df", ["-h", "/"])).stdout}\n$ docker system df\n${(await run("docker", ["system", "df"])).stdout}`;
  files["disk-before.txt"] = disk;
  const freeKb = Number((await run("df", ["-k", "--output=avail", "/"])).stdout.trim().split("\n").pop());
  log(`Free disk before the run: ${(freeKb / 1024 / 1024).toFixed(1)} GB (df -k /).`);
  if (!(freeKb >= DISK_FLOOR_KB)) throw new Error(`Less than 4 GB of disk is free (${freeKb} KB); the run does not start.`);
  const before = await dockerObjects();
  files["docker-objects-before.txt"] = before.join("\n") + "\n";
  log("Docker objects before the run (the whole machine, shared with other sessions):");
  for (const l of before) log(`  ${l}`);
  log();

  gateway = await startGatewayStandIn();
  canary = await startCanary();
  // Package J3: the preview front's stand-in listens before the machine is read, and the camera socket leads to it.
  front = await startFrontStandIn(FRONT_PORT);
  camera = await cameraSocket(FRONT_PORT);
  log(`Listening on the machine for both parts: the canary on every address of the machine, port ${canary.port}; a stand-in preview front on 127.0.0.1:${FRONT_PORT} (server: ${FRONT_STAND_IN}); a stand-in gateway on 127.0.0.1:${gateway.port} (server: ${GATEWAY_STAND_IN}), used by part B only.`);
  log();

  // Part A. A failure here does not stop part B.
  try {
    await realContainers();
  } catch (err) {
    verdictReal = false;
    const e = err as { stderr?: string; message?: string };
    log("PART A FAILED: " + (e.message ?? String(err)));
    if (e.stderr) log(e.stderr.slice(-3000));
    log();
  }

  // Part B: as on 13 Nov. Its checks are unchanged; its labels say what each column ran in.
  try {
  const tB = Date.now();
  log("==== PART B. PLACEMENT, IN STAND-IN IMAGES (as on 13 Nov 2026) ====");
  log("== 1. The project, as the sandbox manager writes it ==");
  const { sb, spec } = await makeProject("p_iso06c_demo");
  const doc = composeDocument(spec, socketOwner()) as { networks: Record<string, unknown>; services: Record<string, { network_mode?: string; networks?: string[]; user?: string; read_only?: boolean; cap_drop?: string[] }> };
  for (const [name, n] of Object.entries(doc.networks)) log(`  network ${name}: ${JSON.stringify(n)}`);
  for (const [name, svc] of Object.entries(doc.services))
    log(`  ${name.padEnd(11)} network: ${svc.network_mode ?? (svc.networks ?? []).join(", ")}; user: ${svc.user ?? "the image's own"}; read-only root: ${svc.read_only}; capabilities dropped: ${(svc.cap_drop ?? []).join(", ")}`);
  log(`  Stand-in gateway on the machine at 127.0.0.1:${gateway.port} (server: ${GATEWAY_STAND_IN}); the canary on every address of the machine, port ${canary.port}.`);
  log(`  Package J3: a stand-in preview front on 127.0.0.1:${FRONT_PORT} (server: ${FRONT_STAND_IN}), listening before the machine is read; the camera socket's folder (the runner's user, mode 750) leads only to it.`);
  await sandbox.up(sb, ["app", "egress"]);
  const ps = JSON.parse(`[${(await sandbox.ps(sb)).trim().split("\n").join(",")}]`) as Array<{ Service: string; State: string; Health?: string }>;
  for (const p of ps) log(`  Container ${p.Service}: ${p.State}${p.Health ? ` (${p.Health})` : ""}`);
  log();

  log("== 2. Read on the machine (read-only; nothing is connected to here) ==");
  const { settings, machineAddresses, machineListeners } = await devProbeSettings(sb, { appPort: APP_PORT, gatewayPort: gateway.port });
  log(`  Every address the machine holds (/proc/net/fib_trie, and /proc/net/if_inet6 where there is IPv6; loopback left out): ${machineAddresses.join(", ")}`);
  log(`  Listening TCP sockets on the machine (/proc/net/tcp): ${machineListeners.join(", ")}`);
  log(`  Settings given to the probe: ${settings}`);
  files["probe-settings.json"] = settings + "\n";
  log();

  log("== 3. The probe in each container of the stand-in project, compared with its list ==");
  const ctx = { appPort: APP_PORT, gatewayServer: new RegExp(`server: ${GATEWAY_STAND_IN}`), frontServer: new RegExp(`server: ${FRONT_STAND_IN}`) };
  const withSocket = JSON.stringify({ ...JSON.parse(settings), sockets: ["/psock/c.sock"] });
  log(`  Machine listeners given to the probe include the front's port ${FRONT_PORT}: ${settings.includes(`:${FRONT_PORT}"`) ? "yes" : "NO"}.`);
  if (!settings.includes(`:${FRONT_PORT}"`)) verdict = false;
  // For the table "Which is which" only (no check): each stand-in image's id, read from Docker.
  const standIn = { app: await imageFacts(sb, made.at(-1)!.images[0]!), tools: await imageFacts(sb, made.at(-1)!.images[1]!), runner: await imageFacts(sb, made.at(-1)!.images[2]!), node: await imageFacts(sb, DEFAULT_IMAGES.node) };
  const plan: Array<[string, DevContainer, string, () => Promise<string[]>, string, ImageFacts, string]> = [
    ["app", "app", "app (stand-in image) (data, front)", () => probeService(sb, "app", "app", settings), "stand-in image", standIn.app, "a one-off container of the app service"],
    ["tools", "tools", "tools (stand-in image) (data)", () => probeService(sb, "tools", "tools", settings), "stand-in image", standIn.tools, "a one-off container of the tools service"],
    ["db", "db", "db (data; the probe in its network namespace)", () => probeInNetworkOf(sb, "db", "db", settings), "network namespace only", standIn.node, "a Node container sharing the running database container's network"],
    ["runner", "runner", "runner (stand-in image) (front)", () => probeService(sb, "acceptance", "runner", settings), "stand-in image", standIn.runner, "a one-off container of the acceptance service"],
    ["engine", "engine", "engine service placed as package 2.2 would place it (placement only; no such engine exists) (out)", () => probeService(sb, "engine", "engine", settings), "placement only", standIn.node, "a one-off container of the engine service, given the option no engine uses"],
    ["egress", "egress", "the door, egress (out)", () => probeService(sb, "egress", "door", settings), "real image, one-off container", standIn.node, "a one-off container of the egress service, not the running door"],
    ["check", "check", "a live preview stream, check (front)", () => probeService(sb, "check", "check", settings), "real image, one-off container", standIn.node, "a one-off container of the check service"],
    ["camera", "camera", "camera (stand-in runner image): the runner's service with the camera socket at /psock (front)", () => probeService(sb, "acceptance", "camera", withSocket, [`${camera!.dir}:/psock:ro`]), "stand-in image", standIn.runner, "a one-off container of the acceptance service"],
  ];
  const columns: Column[] = [];
  for (const [key, kind, label, go, word, image, container] of plan) {
    const lines = await go();
    files[`probe-${key}.jsonl`] = lines.join("\n") + "\n";
    const report = parseProbeOutput(lines);
    const c = compareWithExpected(report, expectedOnDevelopment(kind, ctx));
    files[`comparison-${key}.md`] = `# ${label}\n\n${renderComparison(label, c)}\n`;
    columns.push({ label, report, ownLoopback: true });
    show(label, report, c);
    if (!c.pass) verdict = false;
    which.push([label, word, `stand-in project (${sb.projectName})`, `${image.name} (${shortId(image.id)})`, container, "the probe mounted read-only as the container's command", info(report, "user id") ?? "?", `\`${kind}\``, counts(c), c.pass ? "PASS" : "FAIL"]);
  }
  log();

  log("== 4. Positive controls (not project containers): the same settings must reach the canary ==");
  const bridgeAddress = (await run("docker", ["network", "inspect", "bridge", "--format", "{{range .IPAM.Config}}{{.Gateway}}{{end}}"], { env: dockerEnv(sb) })).stdout.trim();
  for (const [key, where, kind, label] of [
    ["control-machine", "host", "machine", "comparison: the machine's own network"],
    ["control-bridge", "bridge", "default-bridge", "comparison: Docker's default network"],
  ] as const) {
    const lines = await probeComparison(sb, where, settings);
    files[`probe-${key}.jsonl`] = lines.join("\n") + "\n";
    const report = parseProbeOutput(lines);
    const c = compareWithExpected(report, expectedPositiveControls(kind, { canaryPort: canary.port, bridgeAddress }), false);
    files[`comparison-${key}.md`] = `# ${label}\n\n${renderComparison(label, c)}\n`;
    columns.push({ label, report, ownLoopback: where === "bridge" });
    show(label, report, c);
    if (!c.pass) verdict = false;
  }
  log();

  log("== 5. Four deliberate misconfigurations, in stand-in images: each must FAIL its comparison ==");
  const mis1 = await makeProject("p_iso06c_demo_mis1", (d) => {
    (d.networks as Record<string, unknown>).ext = { enable_ipv6: false };
    (d.services as Record<string, { networks?: string[] }>).app!.networks = ["data", "front", "ext"];
  });
  // The app runs too, so that the only differences from the app's list are the ones the misconfiguration makes.
  await sandbox.up(mis1.sb, ["db", "app"]);
  const s1 = await devProbeSettings(mis1.sb, { appPort: APP_PORT, gatewayPort: gateway.port });
  const l1 = await probeService(mis1.sb, "app", "app-misconfigured", s1.settings);
  files["probe-misconfiguration-1-app-with-a-way-out.jsonl"] = l1.join("\n") + "\n";
  const c1 = compareWithExpected(parseProbeOutput(l1), expectedOnDevelopment("app", ctx));
  files["comparison-misconfiguration-1.md"] = `# Misconfiguration 1: the app (stand-in image) also on an ordinary bridge\n\n${renderComparison("app, misconfigured", c1)}\n`;
  show("misconfiguration 1: the app (stand-in image) also on an ordinary bridge (a way out)", parseProbeOutput(l1), c1);
  if (c1.pass) verdict = false;
  const mis2 = await makeProject("p_iso06c_demo_mis2", (d) => {
    (d.networks as Record<string, unknown>).data = { internal: true, enable_ipv6: false };
  });
  await sandbox.up(mis2.sb, ["db", "app"]);
  const s2 = await devProbeSettings(mis2.sb, { appPort: APP_PORT, gatewayPort: gateway.port });
  log(`  Machine addresses once the misconfigured data network exists: ${s2.machineAddresses.join(", ")}`);
  const l2 = await probeService(mis2.sb, "tools", "tools-misconfigured", s2.settings);
  files["probe-misconfiguration-2-internal-without-isolated.jsonl"] = l2.join("\n") + "\n";
  const c2 = compareWithExpected(parseProbeOutput(l2), expectedOnDevelopment("tools", ctx));
  files["comparison-misconfiguration-2.md"] = `# Misconfiguration 2: data internal, without the isolated gateway mode (tools, stand-in image)\n\n${renderComparison("tools, misconfigured", c2)}\n`;
  show("misconfiguration 2: data internal without the isolated gateway mode (tools, stand-in image)", parseProbeOutput(l2), c2);
  if (c2.pass) verdict = false;
  which.push(["misconfiguration 1: the app (stand-in image) also on an ordinary bridge (misconfigured on purpose)", "stand-in image", `stand-in project (${mis1.sb.projectName})`, `${made.at(-2)!.images[0]}`, "a one-off container of the app service", "the probe mounted read-only as the container's command", parseProbeOutput(l1).info.find((i) => i.name === "user id")?.value ?? "?", "`app`", counts(c1), c1.pass ? "PASSED: NOT CAUGHT" : "FAIL, as it must"]);
  which.push(["misconfiguration 2: data internal without the isolated gateway mode; tools (stand-in image) (misconfigured on purpose)", "stand-in image", `stand-in project (${mis2.sb.projectName})`, `${made.at(-1)!.images[1]}`, "a one-off container of the tools service", "the probe mounted read-only as the container's command", parseProbeOutput(l2).info.find((i) => i.name === "user id")?.value ?? "?", "`tools`", counts(c2), c2.pass ? "PASSED: NOT CAUGHT" : "FAIL, as it must"]);
  // Package J3: the stream container misplaced; each must fail the check's comparison, and be refused by the builder's own check.
  for (const [n, label, mutate] of [
    [3, "the stream container (check) also on out", (d: Record<string, unknown>) => void ((d.services as Record<string, { networks?: string[] }>).check!.networks = ["front", "out"])],
    [4, "the stream container (check) on the machine's network", (d: Record<string, unknown>) => {
      const c = (d.services as Record<string, Record<string, unknown>>).check!;
      delete c.networks;
      c.network_mode = "host";
    }],
  ] as const) {
    const mis = await makeProject(`p_iso06c_demo_mis${n}`, mutate);
    await sandbox.up(mis.sb, n === 3 ? ["app", "egress"] : ["app"]);
    const refused = await streamNetworkProblem(mis.sb);
    log(`  misconfiguration ${n} (${label}): the builder's own check before a live session (streamNetworkProblem): ${refused ?? "NOT REFUSED"}`);
    if (!refused) verdict = false;
    const sm = await devProbeSettings(mis.sb, { appPort: APP_PORT, gatewayPort: gateway.port });
    const lm = await probeService(mis.sb, "check", `check-misconfigured-${n}`, sm.settings);
    files[`probe-misconfiguration-${n}-check.jsonl`] = lm.join("\n") + "\n";
    const cm = compareWithExpected(parseProbeOutput(lm), expectedOnDevelopment("check", ctx));
    files[`comparison-misconfiguration-${n}.md`] = `# Misconfiguration ${n}: ${label}\n\n${renderComparison(`check, misconfigured`, cm)}\n`;
    show(`misconfiguration ${n}: ${label}`, parseProbeOutput(lm), cm);
    if (cm.pass) verdict = false;
    which.push([`misconfiguration ${n}: ${label} (misconfigured on purpose)`, "real image, one-off container", `stand-in project (${mis.sb.projectName})`, `${standIn.node.name} (${shortId(standIn.node.id)})`, "a one-off container of the check service", "the probe mounted read-only as the container's command", parseProbeOutput(lm).info.find((i) => i.name === "user id")?.value ?? "?", "`check`", counts(cm), cm.pass ? "PASSED: NOT CAUGHT" : "FAIL, as it must"]);
  }
  log();

  log("== 6. The machine side's log (the egress proxy's decisions, the gateway forwarder) and the door's ==");
  const hostLog = (await sandbox.logs(sb, "egress-host")).split("\n").map((l) => l.replace(/^[^|]*\|\s*/, "")).filter(Boolean);
  const doorLog = (await sandbox.logs(sb, "egress")).split("\n").map((l) => l.replace(/^[^|]*\|\s*/, "")).filter(Boolean);
  // Kept under names that end in .txt: the repository's .gitignore leaves *.log out, so the 13 Nov run's two logs were never committed.
  files["egress-host-log.txt"] = hostLog.join("\n") + "\n";
  files["door-log.txt"] = doorLog.join("\n") + "\n";
  for (const l of hostLog.filter((x) => /"decision"|listening|refusedToStart/.test(x))) log(`  egress-host: ${l}`);
  const fromAddresses = [...new Set(doorLog.map((l) => /"from":"([^"]+)"/.exec(l)?.[1]).filter(Boolean))];
  log(`  door: ${doorLog.filter((l) => l.includes('"forwarded"')).length} connections forwarded, from ${fromAddresses.join(", ") || "none"}; ${doorLog.filter((l) => l.includes('"error"')).length} errors.`);
  log();

  log("== 7. Every attempt in the stand-in project, one row each, one column per container (results only; the comparisons are in the files) ==");
  const table = renderMarkdownTable(columns);
  files["attempts-table.md"] = table + "\n";
  log(table);
  log();
  log(`Part B took ${Math.round((Date.now() - tB) / 1000)} s.`);
  log();
  } catch (err) {
    verdict = false;
    const e = err as { stdout?: string; stderr?: string; message?: string };
    log("PART B FAILED: " + (e.message ?? String(err)));
    if (e.stderr) log(e.stderr.slice(-3000));
    log();
  }

  files["which-is-which.md"] =
    "| Column | Kind | Project | Image (name and id) | Container | How the probe got in | User id the probe reported | List | Rows | Result |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n" +
    which.map((row) => `| ${row.map(esc).join(" | ")} |`).join("\n") +
    "\n";
  log(`RESULT, real containers: ${verdictReal ? "PASS" : "FAIL"}: the probe ran inside the running app container and in one-off containers of the real app, tools and runner images (and the live camera, check, the scripted engine's container and the database's network); each matched its list, both controls got their answers, and all four misconfigurations of real containers failed their comparison${verdictReal ? "" : " (NOT ALL: see part A above)"}.`);
  log(`RESULT, placement in stand-in images (as on 13 Nov): ${verdict ? "PASS" : "FAIL"}: every container of the stand-in project matched its list (the live preview's stream and camera included), both controls got their answers, and all four misconfigurations failed their comparison${verdict ? "" : " (NOT ALL: see part B above)"}.`);
  log("NOT RUN: package 2.2's engine does not exist; this item of 0.6c's 'Done means' is open.");
  if (!verdict || !verdictReal) process.exitCode = 1;
} catch (err) {
  const e = err as { stdout?: string; stderr?: string; message?: string };
  log("FAILED: " + (e.message ?? String(err)));
  if (e.stderr) log(e.stderr.slice(-3000));
  process.exitCode = 1;
} finally {
  const step = async (what: string, f: () => unknown) => {
    try {
      await f();
    } catch (err) {
      log(`Clean-up step failed (${what}): ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  };
  // Part A's real projects: containers, networks, volume, the project's two images (by name) and its folder. Never the runner's image.
  for (const x of [...realMade]) await step(`removing ${x.sb.projectName}`, async () => log(`Left of ${x.sb.projectName}: ${await destroyRealProject(x)}`));
  for (const m of made) {
    await step(`removing ${m.sb.projectName}`, () => sandbox.destroy(m.sb));
    await step(`removing ${m.sb.projectName}'s images`, () => removeImages(m.sb, m.images));
    await step(`reporting what is left of ${m.sb.projectName}`, async () => log(`Left of ${m.sb.projectName}: ${await leftOf(m.sb)}`));
    await step("removing the temporary folder", () => rmSync(m.dir, { recursive: true, force: true }));
  }
  await step("closing the stand-in gateway, the canary, the front's stand-in and the camera socket", async () => {
    await gateway?.close();
    await canary?.close();
    await front?.close();
    await camera?.close();
  });
  await step("checking the shared runner image is still on the machine", async () => log(`The acceptance runner's image ${RUNNER_IMAGE} is still on the machine: ${(await run("docker", ["image", "inspect", RUNNER_IMAGE, "--format", "{{.Id}}"])).stdout.trim()}`));
  await step("listing the Docker objects after the run", async () => {
    const after = await dockerObjects();
    files["docker-objects-after.txt"] = after.join("\n") + "\n";
    log("Docker objects after the run (the whole machine, shared with other sessions):");
    for (const l of after) log(`  ${l}`);
  });
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(outDir, name), text);
    log(`The probe's own lines, the comparisons, the tables, the logs and the Docker object lists were written to the output folder (${Object.keys(files).length} files).`);
  }
  log(`Whole run: ${Math.round((Date.now() - t0) / 1000)} s.`);
}
