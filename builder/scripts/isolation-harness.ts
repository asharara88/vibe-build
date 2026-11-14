/**
 * Shared by the live isolation tests (test/isolation.test.ts and test/isolation-real-live.test.ts) and their
 * demonstration (scripts/demo-isolation.ts), package 0.6c: the ways of running the isolation probe in each
 * container, in stand-in images and, since 14 Nov 2026, in the real ones.
 *
 * WHICH FUNCTIONS MAKE STAND-INS, AND WHICH USE THE REAL IMAGES
 * - Stand-ins: `buildStandIns` (images), `startGatewayStandIn`, `startFrontStandIn`. A project made with
 *   `buildStandIns` shows where the Compose file PLACES a container; it is not the real container, and a run in
 *   it does not count as "run in each of those containers" (build plan, package 0.6c, "Done means").
 * - Real: `ensureRunnerImage` (the acceptance runner's image, from the approved browser zip), `startRealProject`
 *   (example 1 made by the product's own functions: makeExample1, the scripted engine's steps 01 and 02,
 *   buildAndStart; the app and tools images are the template's build), `imageFacts` and `realImageProblemsFrom`
 *   (is each image the real one), `probeServiceSeen` (the probe in a one-off container of a service, with Docker
 *   asked which image the container runs), `probeInPlace` (the probe inside a RUNNING container, through
 *   `sandbox.exec`), `editCompose` (a deliberate misconfiguration, as a text edit of the Compose file the manager
 *   wrote, before anything starts) and `destroyRealProject`.
 * - Either: `probeService`, `probeInNetworkOf`, `probeComparison`, `devProbeSettings`, `startCanary`, `leftOf`,
 *   `removeImages` (which refuses any image that is not the sandbox's own project's).
 * Nothing here is package 2.2's engine: that engine does not exist. The scripted engine's container (package 2.1)
 * and the engine service placed as 2.2's option would place it are each named for what they are.
 *
 * - Stand-in images for the app, tools and runner services, made from the approved Node image with no network:
 *   the app stand-in answers every request with 200 and `server: app-stand-in`; the runner stand-in adds the
 *   runner's user (uid 1001). The network a container gets comes from the project's Compose file, not from its
 *   image, so the stand-ins show the same networks as the real images (which acceptance-live.test.ts runs).
 * - A stand-in gateway on the machine's loopback address, answering 200 with `server: gateway-stand-in`.
 * - A "canary": a listener the harness keeps on every address of the machine (0.0.0.0) during the run. It
 *   accepts a connection and closes it, saying nothing. A project container must not reach it at any machine
 *   address; a comparison container must (the positive control), and so must a container on a network
 *   created without the isolated gateway mode (the second deliberate misconfiguration).
 * - The probe in a one-off container of a project service (its networks, hardening, user and mounts as
 *   Compose gives them), in the network namespace of a running container (the database's image has no
 *   Node), or in a comparison container on the machine's own network or on Docker's default network.
 *
 * Every Docker object made here is named after the sandbox's own Compose project (builder_<project id>).
 * Nothing the probe tests runs on the machine: every attempt is made from inside a container.
 */
import { execFile, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { buildRunnerImage, RUNNER_IMAGE, runnerImageLabelProblem, runnerImageProblem } from "../src/acceptance/runner-image.js";
import { readMachineAddresses, readMachineSide, sessionProxyHostPort } from "../src/sandbox/isolation.js";
import { appImageName, composeProjectName, DEFAULT_IMAGES, dockerEnv, HARDENING, sandbox, toolsImageName, type Sandbox, type StreamingRun } from "../src/sandbox/manager.js";
import { buildAndStart, destroyExample1, makeExample1, runStep, type Example1 } from "./example-1-sandbox.js";

const run = promisify(execFile);
export const builderDir = resolve(import.meta.dirname, "..");
export const PROBE_FILE = join(builderDir, "scripts", "isolation-probe.mjs");
export const PROBE_MOUNT = "/probe/isolation-probe.mjs";
/** What the app stand-in and the gateway stand-in put in their `server` header. */
export const APP_STAND_IN = "app-stand-in";
export const GATEWAY_STAND_IN = "gateway-stand-in";

/** The runner stand-in's image name: the sandbox's own Compose project's prefix. */
export const runnerStandInImage = (sb: Pick<Sandbox, "projectName">) => `${sb.projectName}-runner-standin:latest`;
export const runnerStandInImageFor = (projectId: string) => runnerStandInImage({ projectName: composeProjectName(projectId) });

/** Build one image from a Dockerfile given on standard input, with no network and no build context. */
function buildFromText(sb: Sandbox, tag: string, dockerfile: string): void {
  const r = spawnSync("docker", ["build", "--network", "none", "-t", tag, "-"], { input: dockerfile, env: dockerEnv(sb) });
  if (r.status !== 0) throw new Error(`the stand-in image ${tag} did not build: ${r.stderr?.toString().slice(-1500)}`);
}

/** The app, tools and runner stand-ins for this sandbox's project (images named after its Compose project). */
export function buildStandIns(sb: Sandbox, projectId: string): string[] {
  const server = `require('http').createServer((q,s)=>{s.writeHead(200,{server:'${APP_STAND_IN}','content-type':'text/plain'});s.end('stand-in app')}).listen(Number(process.env.PORT),'0.0.0.0')`;
  const images = [appImageName(projectId), toolsImageName(projectId), runnerStandInImage(sb)];
  buildFromText(sb, images[0]!, `FROM ${DEFAULT_IMAGES.node}\nUSER node\nENTRYPOINT []\nCMD ${JSON.stringify(["node", "-e", server])}\n`);
  buildFromText(sb, images[1]!, `FROM ${DEFAULT_IMAGES.node}\nENTRYPOINT []\n`);
  buildFromText(sb, images[2]!, `FROM ${DEFAULT_IMAGES.node}\nRUN adduser -D -u 1001 runner\nENTRYPOINT []\n`);
  return images;
}

/**
 * Remove images of the sandbox's own project, by name. Any other name is refused before Docker is asked anything
 * (14 Nov 2026): the acceptance runner's image is machine-wide and shared with other sessions, and must never be
 * removed from here. Removal is by name only, never by id: two projects built from the same files can share one id.
 */
export async function removeImages(sb: Sandbox, images: string[]): Promise<void> {
  const notOurs = images.filter((image) => !image.startsWith(`${sb.projectName}-`));
  if (notOurs.length) throw new Error(`The isolation harness removes only images of its own project (${sb.projectName}-...); refused: ${notOurs.join(", ")}.`);
  for (const image of images) await run("docker", ["image", "rm", "-f", image], { env: dockerEnv(sb) }).catch(() => undefined);
}

/** A port on 127.0.0.1 that nothing listened on a moment ago (the system's choice). */
export async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  await new Promise((r) => server.close(r));
  return port;
}

/** What the preview front's stand-in puts in its `server` header (package J3). */
export const FRONT_STAND_IN = "preview-front-stand-in";

/** Package J3: a stand-in for the preview front on 127.0.0.1:`port` (4041, the automated run's), so that it is listening while the machine's listeners are read for group M. */
export async function startFrontStandIn(port: number): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => res.writeHead(200, { server: FRONT_STAND_IN, "content-type": "text/plain" }).end("stand-in preview front"));
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return { port, close: () => new Promise((r) => server.close(() => r())) };
}

/** A stand-in gateway on 127.0.0.1, on a port the system chooses. */
export async function startGatewayStandIn(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => res.writeHead(200, { server: GATEWAY_STAND_IN, "content-type": "text/plain" }).end("stand-in gateway"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { port: (server.address() as AddressInfo).port, close: () => new Promise((r) => server.close(() => r())) };
}

/** The canary: a listener on every address of the machine that accepts a connection and closes it at once. */
export async function startCanary(): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.on("error", () => undefined);
    s.destroy();
  });
  await new Promise<void>((r) => server.listen(0, "0.0.0.0", r));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}

export interface ProjectProbeContext {
  appPort: number;
  /** The stand-in gateway's port on the machine (C6 aims at it, at the container's own loopback address). */
  gatewayPort: number;
}

/**
 * The probe's settings for the development profile's project containers, with what is read on the machine
 * now: every listening TCP socket (/proc/net/tcp) and every address the machine holds (/proc/net/fib_trie).
 * Read again after a network is made, since its address on the machine, if it has one, appears only then.
 */
export async function devProbeSettings(sb: Sandbox, ctx: ProjectProbeContext): Promise<{ settings: string; machineAddresses: string[]; machineListeners: string[] }> {
  const { machineListeners } = await readMachineSide(dockerEnv(sb));
  const machineAddresses = readMachineAddresses();
  const settings = JSON.stringify({
    sessionProxy: sessionProxyHostPort(process.env.HTTPS_PROXY),
    projectDbPort: 5432,
    egressPort: 3128,
    gatewayPort: ctx.gatewayPort,
    builderDbPort: 5432,
    exampleAddress: "93.184.215.14",
    timeoutMs: 3000,
    bridgeGateway: null,
    machineListeners,
    machineAddresses,
    egressHost: "egress",
    gatewayVia: "egress:4010",
    peers: ["db:5432", `app:${ctx.appPort}`, "egress:3128", "egress:4010"],
  });
  return { settings, machineAddresses, machineListeners };
}

/** Start the probe in a fresh one-off container of a project service, through the sandbox manager: its handle, and its lines once it has ended. */
function startProbe(sb: Sandbox, service: string, label: string, settings: string, extraVolumes: string[]): { handle: StreamingRun; lines: Promise<string[]> } {
  const lines: string[] = [];
  const r = sandbox.runStreaming(sb, service, ["node", PROBE_MOUNT, settings], {
    container: `${sb.projectName}-isolation-${label}`,
    onLine: (l) => lines.push(l),
    volumes: [`${PROBE_FILE}:${PROBE_MOUNT}:ro`, ...extraVolumes],
    timeoutMs: 600_000,
  });
  const ended = r.done.then((end) => {
    if (end.code !== 0) lines.push(JSON.stringify({ kind: "error", reason: `the container ended with code ${end.code}${end.timedOut ? " (time limit)" : ""}: ${end.stderrTail.slice(-500)}` }));
    return lines;
  });
  return { handle: r, lines: ended };
}

/** The probe in a fresh one-off container of a project service, through the sandbox manager. */
export async function probeService(sb: Sandbox, service: string, label: string, settings: string, extraVolumes: string[] = []): Promise<string[]> {
  return startProbe(sb, service, label, settings, extraVolumes).lines;
}

/** What Docker said about a one-off container while it ran (`docker inspect`). */
export interface SeenContainer {
  container: string;
  /** True if Docker answered with the container running, before its run ended. Evidence that relies on what was seen fails if it did not. */
  whileRunning: boolean;
  /** The id of the image the container runs (`.Image`), and the name it was started from (`.Config.Image`). */
  imageId?: string;
  imageName?: string;
  user?: string;
  networkMode?: string;
  networks?: string[];
  readOnlyRoot?: boolean;
  mounts?: Array<{ type?: string; source?: string; destination?: string; readWrite?: boolean }>;
  problem?: string;
}

export interface SeenProbe {
  lines: string[];
  seen: SeenContainer;
  /** The exact arguments given to `docker` (the sandbox manager's own: `StreamingRun.args`). */
  command: string[];
}

/**
 * Ask Docker about a one-off container until it is seen running, or its run has ended (no fixed wait). It asks
 * again 20 ms after each answer: the probe in the real runner image ends about 0.2 s after its container starts
 * (measured 14 Nov 2026: evidence/2026-11-14-package-0.6c-real-containers/measurements/M6-seen-while-running.txt),
 * so a slower rhythm could miss it. A container that is missed is reported as not seen, never guessed at.
 */
async function seeWhileRunning(handle: StreamingRun, env: NodeJS.ProcessEnv): Promise<SeenContainer> {
  let ended = false;
  void handle.done.then(() => (ended = true));
  while (!ended) {
    try {
      const { stdout } = await run("docker", ["inspect", handle.container, "--format", "{{json .}}"], { env, maxBuffer: 8 * 1024 * 1024 });
      const i = JSON.parse(stdout) as {
        Image?: string;
        State?: { Running?: boolean };
        Config?: { Image?: string; User?: string };
        HostConfig?: { NetworkMode?: string; ReadonlyRootfs?: boolean };
        NetworkSettings?: { Networks?: Record<string, unknown> | null };
        Mounts?: Array<{ Type?: string; Source?: string; Destination?: string; RW?: boolean }>;
      };
      if (i.State?.Running) {
        return {
          container: handle.container,
          whileRunning: !ended,
          imageId: i.Image,
          imageName: i.Config?.Image,
          user: i.Config?.User,
          networkMode: i.HostConfig?.NetworkMode,
          networks: Object.keys(i.NetworkSettings?.Networks ?? {}).sort(),
          readOnlyRoot: i.HostConfig?.ReadonlyRootfs,
          mounts: (i.Mounts ?? []).map((m) => ({ type: m.Type, source: m.Source, destination: m.Destination, readWrite: m.RW })),
        };
      }
    } catch {
      /* not created yet, or gone already */
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  return { container: handle.container, whileRunning: false, problem: "the container ended before docker inspect saw it running" };
}

/**
 * As `probeService`, and Docker is asked about the container while it runs: the image it runs (id and name), its
 * user, its networks, whether its root is read-only, and its mounts. So "it ran in the real image" is checked from
 * Docker's own answer, not assumed from the Compose file. Also gives the exact docker command.
 */
export async function probeServiceSeen(sb: Sandbox, service: string, label: string, settings: string, extraVolumes: string[] = []): Promise<SeenProbe> {
  const p = startProbe(sb, service, label, settings, extraVolumes);
  const seen = await seeWhileRunning(p.handle, dockerEnv(sb));
  return { lines: await p.lines, seen, command: p.handle.args ?? [] };
}

/** `docker run` of the probe in the approved Node image, hardened as a project container, on the network given. */
async function probeDockerRun(sb: Sandbox, name: string, network: string, settings: string): Promise<string[]> {
  const args = [
    "run", "--rm", "--name", name, "--network", network, "--user", "1000:1000",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", String(HARDENING.pids_limit), "--memory", HARDENING.mem_limit, "--read-only",
    "--entrypoint", "", "--volume", `${PROBE_FILE}:${PROBE_MOUNT}:ro`, DEFAULT_IMAGES.node, "node", PROBE_MOUNT, settings,
  ];
  const child = spawn("docker", args, { env: dockerEnv(sb), stdio: ["ignore", "pipe", "pipe"] });
  const lines: string[] = [];
  createInterface({ input: child.stdout }).on("line", (l) => lines.push(l));
  let err = "";
  child.stderr.on("data", (d: Buffer) => (err = (err + d.toString("utf8")).slice(-2000)));
  const code = await new Promise<number | null>((r) => child.on("close", r));
  if (code !== 0) lines.push(JSON.stringify({ kind: "error", reason: `the container ended with code ${code}: ${err.slice(-500)}` }));
  return lines;
}

/** The probe in the network namespace of a running service's container (the database: its image has no Node). */
export async function probeInNetworkOf(sb: Sandbox, service: string, label: string, settings: string): Promise<string[]> {
  const id = (await run("docker", ["compose", "-f", sb.composeFile, "ps", "-q", service], { env: dockerEnv(sb) })).stdout.trim();
  if (!id) throw new Error(`the ${service} service has no running container to probe from`);
  return probeDockerRun(sb, `${sb.projectName}-isolation-${label}`, `container:${id}`, settings);
}

/** For comparison only, not a project container: the probe on the machine's own network, or on Docker's default network. */
export function probeComparison(sb: Sandbox, where: "host" | "bridge", settings: string): Promise<string[]> {
  return probeDockerRun(sb, `${sb.projectName}-isolation-control-${where}`, where, settings);
}

/** What is left of a Compose project, by its label, and of the images named after it. */
export async function leftOf(sb: Sandbox): Promise<string> {
  const env = dockerEnv(sb);
  const ask = async (args: string[]) => (await run("docker", args, { env })).stdout.trim().split("\n").filter(Boolean).join(", ") || "none";
  const label = `label=com.docker.compose.project=${sb.projectName}`;
  return [
    `containers: ${await ask(["ps", "-a", "--filter", label, "--format", "{{.Names}}"])}`,
    `named containers: ${await ask(["ps", "-a", "--filter", `name=${sb.projectName}-`, "--format", "{{.Names}}"])}`,
    `networks: ${await ask(["network", "ls", "--filter", label, "--format", "{{.Name}}"])}`,
    `volumes: ${await ask(["volume", "ls", "--filter", label, "--format", "{{.Name}}"])}`,
    // Every image made here is named `<project>-<name>`; the dash keeps another project whose name starts the same out.
    `images: ${await ask(["images", "--format", "{{.Repository}}:{{.Tag}}", "--filter", `reference=${sb.projectName}-*`])}`,
  ].join("; ");
}

// ---------------------------------------------------------------------------------------------------------------
// The run in real containers (14 Nov 2026). Everything below uses the real images and the product's own functions.
// ---------------------------------------------------------------------------------------------------------------

/**
 * The acceptance runner's real image, built from the approved browser zip as test/acceptance-live.test.ts builds it
 * (from Docker's build cache when nothing changed). It must be as approved and carry the zip's label. Returns the
 * image's id. The image has one machine-wide name, shared with other sessions: nothing here ever removes it.
 */
export async function ensureRunnerImage(): Promise<{ image: string; imageId: string }> {
  const img = await buildRunnerImage({ hostProxy: { url: process.env.HTTPS_PROXY ?? "", caBundlePath: "/root/.ccr/ca-bundle.crt" } });
  if (img.problems.length) throw new Error(`The runner image ${RUNNER_IMAGE} is not as approved: ${img.problems.join("; ")}`);
  const problem = await runnerImageProblem(RUNNER_IMAGE, process.env);
  if (problem) throw new Error(`The runner image cannot be used: ${problem}`);
  return { image: RUNNER_IMAGE, imageId: img.imageId };
}

/** What `docker image inspect` says about an image: enough to tell the template's build from a stand-in. */
export interface ImageFacts {
  name: string;
  /** Empty when the image is not on this machine. */
  id: string;
  user: string;
  command: string[];
  entrypoint: string[];
  workingDir: string;
  labels: Record<string, string>;
  /** Set when Docker could not show the image: its own first line. */
  missing?: string;
}

export async function imageFacts(sb: Pick<Sandbox, "dir">, image: string): Promise<ImageFacts> {
  try {
    const { stdout } = await run("docker", ["image", "inspect", image, "--format", "{{json .}}"], { env: dockerEnv(sb), maxBuffer: 8 * 1024 * 1024 });
    const i = JSON.parse(stdout) as { Id?: string; Config?: { User?: string; Cmd?: string[] | null; Entrypoint?: string[] | null; WorkingDir?: string; Labels?: Record<string, string> | null } };
    return { name: image, id: i.Id ?? "", user: i.Config?.User ?? "", command: i.Config?.Cmd ?? [], entrypoint: i.Config?.Entrypoint ?? [], workingDir: i.Config?.WorkingDir ?? "", labels: i.Config?.Labels ?? {} };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return { name: image, id: "", user: "", command: [], entrypoint: [], workingDir: "", labels: {}, missing: ((e.stderr || e.message || "no answer").trim().split("\n")[0] ?? "").slice(0, 200) };
  }
}

/** The four images a real project's containers run: the app and tools images, the acceptance service's image, and the approved Node image. */
export interface RealImages {
  app: ImageFacts;
  tools: ImageFacts;
  acceptance: ImageFacts;
  node: ImageFacts;
}

/**
 * Why these are not the real images, one plain sentence per problem; empty when they are. A plain function: it
 * asks Docker nothing. The app image must be the template's `run` stage (user "app", command node server.js),
 * the tools image its `tools` stage (user "node", working folder /app), neither may be the approved Node image
 * under another name, and the acceptance service's image must be the runner's own, carrying the approved zip's
 * label. The stand-in images of 13 Nov (`buildStandIns`) fail each of these.
 */
export function realImageProblemsFrom(f: RealImages): string[] {
  const imageProblems: string[] = [];
  for (const [what, i] of [["app", f.app], ["tools", f.tools], ["acceptance service's", f.acceptance], ["approved Node", f.node]] as const)
    if (i.missing || !i.id) imageProblems.push(`the ${what} image ${i.name} is not on this machine${i.missing ? ` (${i.missing})` : ""}`);
  if (f.app.user !== "app") imageProblems.push(`the app image ${f.app.name} runs as user "${f.app.user}", not "app" as the template's Dockerfile sets it: it is not the template's build`);
  if (JSON.stringify(f.app.command) !== JSON.stringify(["node", "server.js"])) imageProblems.push(`the app image ${f.app.name} starts ${JSON.stringify(f.app.command).slice(0, 80)}, not ["node","server.js"]: it is not the template's build`);
  if (f.tools.user !== "node") imageProblems.push(`the tools image ${f.tools.name} runs as user "${f.tools.user}", not "node" as the template's Dockerfile sets it: it is not the template's tools stage`);
  if (f.tools.workingDir !== "/app") imageProblems.push(`the tools image ${f.tools.name} works in "${f.tools.workingDir}", not "/app": it is not the template's tools stage`);
  for (const i of [f.app, f.tools]) if (i.id && i.id === f.node.id) imageProblems.push(`the image ${i.name} is the approved Node image itself under another name (id ${i.id}): a stand-in, not the template's build`);
  if (f.acceptance.name !== RUNNER_IMAGE) imageProblems.push(`the acceptance service's image is ${f.acceptance.name}, not ${RUNNER_IMAGE}: it is not the acceptance runner's real image`);
  const label = runnerImageLabelProblem(f.acceptance.name, JSON.stringify(f.acceptance.labels));
  if (label) imageProblems.push(label);
  return imageProblems;
}

/** One text edit of a Compose file: `from` must occur exactly once, in the named service's block or, with no service, in the whole file. */
export interface ComposeEdit {
  service?: string;
  from: string;
  to: string;
}

/** Where a service's block is in the Compose text the sandbox manager writes: from its own line under `services:` to the next service, or the section's end. */
function serviceBlock(text: string, service: string): { start: number; end: number } {
  const top = /^services:\n/m.exec(text);
  if (!top) throw new Error("The Compose file has no services section.");
  const sectionStart = top.index + top[0].length;
  const after = text.slice(sectionStart);
  const section = after.slice(0, /^\S/m.exec(after)?.index ?? after.length);
  const head = new RegExp(`^  ${service.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}:\\n`, "m").exec(section);
  if (!head) throw new Error(`The Compose file has no ${service} service.`);
  const bodyStart = head.index + head[0].length;
  const next = /^  \S/m.exec(section.slice(bodyStart));
  return { start: sectionStart + head.index, end: sectionStart + (next ? bodyStart + next.index : section.length) };
}

/**
 * Apply text edits to a Compose file's text, in order. Each `from` must be found exactly once where it is looked
 * for; found no times, or more than once, the edit is refused. So a deliberate misconfiguration can never silently
 * not apply (for example after the sandbox manager's wording of the file has changed).
 */
export function editComposeText(text: string, edits: ComposeEdit[]): string {
  let out = text;
  for (const e of edits) {
    const { start, end } = e.service ? serviceBlock(out, e.service) : { start: 0, end: out.length };
    const block = out.slice(start, end);
    const found = block.split(e.from).length - 1;
    if (found !== 1) throw new Error(`A Compose edit is refused: its text was found ${found} times, not once, in ${e.service ? `the ${e.service} service` : "the file"}: ${JSON.stringify(e.from).slice(0, 160)}`);
    out = out.slice(0, start) + block.replace(e.from, () => e.to) + out.slice(end);
  }
  return out;
}

/** Edit the Compose file the sandbox manager wrote for this sandbox, before anything starts (`editComposeText`). */
export function editCompose(sb: Pick<Sandbox, "composeFile">, edits: ComposeEdit[]): void {
  writeFileSync(sb.composeFile, editComposeText(readFileSync(sb.composeFile, "utf8"), edits));
}

/** One edit inside one service's block of the sandbox's Compose file. */
export function editComposeService(sb: Pick<Sandbox, "composeFile">, service: string, from: string, to: string): void {
  editCompose(sb, [{ service, from, to }]);
}

/**
 * The four deliberate misconfigurations of real containers (14 Nov 2026), each as text edits of the Compose file
 * the manager writes for a real example-1 project. Each must make its container FAIL the comparison with its list.
 */
export const REAL_MISCONFIGURATIONS = {
  R1: {
    what: "the real app also on an ordinary bridge (a way out)",
    edits: [
      { from: "\nsecrets:\n", to: "\n  ext:\n    enable_ipv6: false\nsecrets:\n" },
      { service: "app", from: '    networks:\n      - "data"\n      - "front"\n', to: '    networks:\n      - "data"\n      - "front"\n      - "ext"\n' },
    ],
  },
  R2: {
    what: "the data network internal, but without the isolated gateway mode",
    edits: [{ from: '  data:\n    internal: true\n    enable_ipv6: false\n    driver_opts:\n      com.docker.network.bridge.gateway_mode_ipv4: "isolated"\n', to: "  data:\n    internal: true\n    enable_ipv6: false\n" }],
  },
  R3: {
    what: "the real runner also on the data network",
    edits: [{ service: "acceptance", from: '    networks:\n      - "front"\n', to: '    networks:\n      - "front"\n      - "data"\n' }],
  },
  R4: {
    what: "the scripted engine's container given the out network",
    edits: [{ service: "engine", from: '    network_mode: "none"\n', to: '    networks:\n      - "out"\n' }],
  },
} satisfies Record<string, { what: string; edits: ComposeEdit[] }>;

/** The scripted engine's two fixed steps of example 1, as the product runs them. */
export const REAL_STEPS = ["01-data", "02-submitter-screen"] as const;

/** A real example-1 project, as `startRealProject` leaves it. */
export interface RealProject {
  x: Example1;
  /** The images' facts, read from Docker after the build (an image that is not there has an empty id). */
  images: RealImages;
  /** The running app container's id and the id of the image it runs, as Docker reports them; null when nothing was built. */
  appContainer: { id: string; imageId: string } | null;
}

/** The id of a service's running container (`docker compose ps -q`), or "" when it has none. */
export async function runningContainerId(sb: Sandbox, service: string): Promise<string> {
  return (await run("docker", ["compose", "-f", sb.composeFile, "ps", "-q", service], { env: dockerEnv(sb) })).stdout.trim();
}

/**
 * A real example-1 project, made by the product's own functions, unchanged: `makeExample1` with the real runner
 * image, the scripted engine's steps 01 and 02 (`runStep`), then `buildAndStart` (the app and tools images built
 * from the template, tables and sample users made in the tools container, the app started and healthy). One
 * addition, which the product does not make for a scripted-engine project today: the door (`egress`) is started
 * too, so that a listening door is there to be NOT reached. `edits` change the Compose file before anything
 * starts (a deliberate misconfiguration). With `build: false`: the project, the edits and the door only.
 * `onMade` is called as soon as the project's folder exists, so that the caller can remove it whatever happens next.
 */
export async function startRealProject(o: { projectId: string; appPort: number; edits?: ComposeEdit[]; build?: boolean; onMade?: (x: Example1) => void; log?: (s: string) => void }): Promise<RealProject> {
  const x = await makeExample1({ projectId: o.projectId, appPort: o.appPort, buildProxyPort: await freePort(), runnerImage: RUNNER_IMAGE });
  o.onMade?.(x);
  if (o.edits?.length) editCompose(x.sb, o.edits);
  if (o.build !== false) {
    for (const step of REAL_STEPS) {
      const r = await runStep(x, step);
      if (!r.ok) throw new Error(`The scripted engine's step ${step} did not end ok in ${x.sb.projectName}: ${JSON.stringify(r).slice(0, 400)}`);
    }
    await buildAndStart(x, o.log);
  }
  await sandbox.up(x.sb, ["egress"]);
  const images: RealImages = {
    app: await imageFacts(x.sb, appImageName(o.projectId)),
    tools: await imageFacts(x.sb, toolsImageName(o.projectId)),
    acceptance: await imageFacts(x.sb, x.sb.acceptanceImage ?? "(the sandbox has no acceptance service)"),
    node: await imageFacts(x.sb, DEFAULT_IMAGES.node),
  };
  let appContainer: RealProject["appContainer"] = null;
  if (o.build !== false) {
    const id = await runningContainerId(x.sb, "app");
    const imageId = id ? (await run("docker", ["inspect", id, "--format", "{{.Image}}"], { env: dockerEnv(x.sb) })).stdout.trim() : "";
    appContainer = { id, imageId };
  }
  return { x, images, appContainer };
}

/** Where the probe is put inside a running container: its own /tmp, which every project service has as a small tmpfs. */
export const IN_PLACE_PATH = "/tmp/isolation-probe.mjs";
/** The most characters the encoded probe may have to be handed over as one command argument (the kernel's limit for one argument is 131,071 here; measured 14 Nov 2026). */
export const IN_PLACE_MAX_ENCODED = 100_000;
// Each runs inside the container with `node -e`: write the file from one base64 argument (flag "wx": nothing already
// there is overwritten), print its SHA-256, remove it and say whether it is gone.
const IN_PLACE_WRITE = "const fs=require('fs');const p=process.argv[1];fs.writeFileSync(p,Buffer.from(process.argv[2],'base64'),{flag:'wx',mode: 0o600});console.log('written '+fs.statSync(p).size)";
const IN_PLACE_HASH = "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))";
const IN_PLACE_REMOVE = "const fs=require('fs');fs.rmSync(process.argv[1],{force:true});console.log(fs.existsSync(process.argv[1])?'still there':'gone')";

/** A command run inside a running service's container; `sandbox.exec` is the real one. */
export type ExecInService = (sb: Sandbox, service: string, cmd: string[]) => Promise<string>;

export interface InPlaceProbe {
  lines: string[];
  /** SHA-256 of the repository's probe file, and of the file as read back inside the container before it was run. */
  sha256: { repository: string; inside: string };
  /** The running container's id before the probe and after it (`docker compose ps -q`): the same container throughout. */
  container: { before: string; after: string };
  /** True once the file was removed and seen gone. */
  removed: boolean;
  /** How many characters the probe was as one base64 argument. */
  encodedLength: number;
}

/**
 * The probe INSIDE a running service's container (14 Nov 2026), through the sandbox manager's own `exec`
 * (`docker compose exec -T <service>`): it runs in the container that is already running, in its own namespaces and
 * as its own user, beside the service's process. Four commands, each a `node` inside the container:
 * 1. the probe file is written to the container's own /tmp from one base64 argument (refused here, before anything
 *    is sent, if it is over IN_PLACE_MAX_ENCODED characters; nothing already at that place is overwritten);
 * 2. its SHA-256 is read back inside and must equal the repository file's, or the probe is NOT run;
 * 3. it is run there: `node /tmp/isolation-probe.mjs <settings>`. A non-zero end becomes an error line, with the
 *    lines printed so far kept;
 * 4. the file is removed, always, and seen gone.
 * `o.exec`, `o.containerId` and `o.probeFile` are for the unit tests, which use no Docker.
 */
export async function probeInPlace(sb: Sandbox, service: string, settings: string, o: { exec?: ExecInService; containerId?: (sb: Sandbox, service: string) => Promise<string>; probeFile?: string } = {}): Promise<InPlaceProbe> {
  const exec = o.exec ?? sandbox.exec;
  const idOf = o.containerId ?? runningContainerId;
  const bytes = readFileSync(o.probeFile ?? PROBE_FILE);
  const encoded = bytes.toString("base64");
  if (encoded.length > IN_PLACE_MAX_ENCODED)
    throw new Error(`The probe file is ${encoded.length} characters once encoded, over the ${IN_PLACE_MAX_ENCODED} that can be handed to a running container as one argument; nothing was sent.`);
  const repository = createHash("sha256").update(bytes).digest("hex");
  const before = await idOf(sb, service);
  if (!before) throw new Error(`The ${service} service has no running container to probe in place.`);
  const split = (text: string) => text.split("\n").filter(Boolean);
  try {
    await exec(sb, service, ["node", "-e", IN_PLACE_WRITE, IN_PLACE_PATH, encoded]);
  } catch (err) {
    const said = String((err as { stderr?: string }).stderr || (err as Error).message);
    // Something is already at that place: it was not overwritten, and it is not removed, since this run did not put it there.
    if (/EEXIST/.test(said)) throw new Error(`Something is already at ${IN_PLACE_PATH} in the running ${service} container; it was not overwritten and not removed, and the probe was not run.`);
    await exec(sb, service, ["node", "-e", IN_PLACE_REMOVE, IN_PLACE_PATH]).catch(() => undefined);
    throw new Error(`The probe file could not be written into the running ${service} container: ${said.slice(-600)}`);
  }
  let inside = "";
  let lines: string[] = [];
  let removed = false;
  try {
    inside = (await exec(sb, service, ["node", "-e", IN_PLACE_HASH, IN_PLACE_PATH])).trim();
    if (inside !== repository) throw new Error(`The file written into the running ${service} container has SHA-256 ${inside || "(nothing read)"}, not the repository's probe (${repository}); it was not run.`);
    lines = await exec(sb, service, ["node", IN_PLACE_PATH, settings]).then(split, (err: { stdout?: string; stderr?: string; message?: string }) => [
      ...split(err.stdout ?? ""),
      JSON.stringify({ kind: "error", reason: `the probe run in place ended with an error: ${(err.stderr || err.message || "").slice(-500)}` }),
    ]);
  } finally {
    // Always, whatever happened above: the file is removed, and seen gone.
    removed = (await exec(sb, service, ["node", "-e", IN_PLACE_REMOVE, IN_PLACE_PATH]).then((said) => said.trim(), () => "")) === "gone";
  }
  return { lines, sha256: { repository, inside }, container: { before, after: await idOf(sb, service) }, removed, encodedLength: encoded.length };
}

/**
 * Remove a real project: any probe container a failed run left, then the project's containers, networks, volume,
 * its two images (by name) and its folder (`destroyExample1`). Returns what is left, as `leftOf` reads it. The
 * acceptance runner's image is not the project's and is never touched.
 */
export async function destroyRealProject(x: Example1): Promise<string> {
  const env = dockerEnv(x.sb);
  const left = await run("docker", ["ps", "-aq", "--filter", `name=${x.sb.projectName}-`], { env }).catch(() => ({ stdout: "" }));
  for (const id of left.stdout.split("\n").filter(Boolean)) await run("docker", ["rm", "-f", id], { env }).catch(() => undefined);
  await destroyExample1(x);
  return leftOf(x.sb);
}
