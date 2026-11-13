/**
 * Shared by the live isolation test (test/isolation.test.ts) and its demonstration (scripts/demo-isolation.ts),
 * package 0.6c: the stand-ins and the ways of running the isolation probe in each container.
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
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { readMachineAddresses, readMachineSide, sessionProxyHostPort } from "../src/sandbox/isolation.js";
import { appImageName, composeProjectName, DEFAULT_IMAGES, dockerEnv, HARDENING, sandbox, toolsImageName, type Sandbox } from "../src/sandbox/manager.js";

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

export async function removeImages(sb: Sandbox, images: string[]): Promise<void> {
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

/** The probe in a fresh one-off container of a project service, through the sandbox manager. */
export async function probeService(sb: Sandbox, service: string, label: string, settings: string): Promise<string[]> {
  const lines: string[] = [];
  const r = sandbox.runStreaming(sb, service, ["node", PROBE_MOUNT, settings], {
    container: `${sb.projectName}-isolation-${label}`,
    onLine: (l) => lines.push(l),
    volumes: [`${PROBE_FILE}:${PROBE_MOUNT}:ro`],
    timeoutMs: 600_000,
  });
  const end = await r.done;
  if (end.code !== 0) lines.push(JSON.stringify({ kind: "error", reason: `the container ended with code ${end.code}${end.timedOut ? " (time limit)" : ""}: ${end.stderrTail.slice(-500)}` }));
  return lines;
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
