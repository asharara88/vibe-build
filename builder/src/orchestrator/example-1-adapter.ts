/**
 * The thin adapter between the journey and example 1's sandbox (package J1; final design, section 4,
 * "Sandboxes"). It calls `makeExample1`, `buildAndStart`, `destroyExample1` and `portFree` from
 * scripts/example-1-sandbox.ts unchanged, and the sandbox manager's `runStreaming`, `destroy` and
 * `removeImage`. Since package 0.6c it uses 0.6c's development-profile sandbox as it is:
 *
 * - The project's containers sit on its private networks (`data`, `front`, `out`), with no route to the machine
 *   and no port on it. The app listens on 3161 inside its container and is reached only at http://app:3161, from
 *   containers on `front`: the check that nothing answers there before the app starts and the "right app
 *   answers" check before a checklist run (0.6c's `askApp`), the acceptance runner and the app camera. Nothing
 *   this process runs on the machine connects to the app or its database.
 * - The image build goes through the door's machine side: npm through its port on the machine's loopback address,
 *   127.0.0.1:13161 (the package registry only), every step that runs the workspace's code with no network
 *   (templates/next/Dockerfile). That port is the project's one port on the machine, held while its machine side
 *   runs (known gap 121), so it is checked free before a sandbox is made and before the app is built
 *   (`buildPortRefusal`); one project's app runs at a time (journey-jobs.ts).
 * - Project ids start "j1-", so Compose names start "builder_j1-". Nothing here removes a Compose project, an
 *   image or a folder of another name (`checkJourneyId`, `recordedSandboxRefusal`).
 * - The app camera (camera/app-shots.mjs) runs in the project's own `acceptance` service, on `front` only: the
 *   approved runner image, its unprivileged user, its read-only root and its hardening; the script read-only, one
 *   output folder, the sample password as one read-only file. No video and no trace: the script records neither.
 *   It loads only http://app:<port>, the address the service gives it. Before it starts, the image the service
 *   names is checked with package 3.1b's `runnerImageProblem` (`cameraImageProblem`), and Compose's own reading of
 *   the service is checked to put it on the project's `front` network and nothing else (`cameraNetworkProblem`);
 *   journey-jobs.ts asks both first.
 *
 * Development profile only (the server profile is 0.6b's).
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { runAcceptance, type AcceptanceReport, type AcceptanceRunInput } from "../acceptance/runner.js";
import { RUNNER_IMAGE, runnerImageProblem } from "../acceptance/runner-image.js";
import type { EngineRunner } from "../engine/scripted.js";
import { appImageName, composeProjectName, dockerEnv, sandbox, toolsImageName, type Sandbox, type StreamingEnd } from "../sandbox/manager.js";
import { buildAndStart, destroyExample1, makeExample1, portFree, type Example1 } from "../../scripts/example-1-sandbox.js";
import { JourneyRefused, type SandboxRecord } from "./journey.js";

const run = promisify(execFile);

/** The port the app listens on inside its container: it is reached at http://app:3161, never on the machine. */
export const J1_APP_PORT = 3161;
/** The image build's port on the machine's loopback address (package 0.6c's machine side, `buildProxyPort`). No other script or test uses it. */
export const J1_BUILD_PROXY_PORT = 13161;
/** The folder of the two cameras' scripts. */
export const CAMERA_DIR = resolve(import.meta.dirname, "..", "..", "camera");
/** The app camera's time limit. */
export const APP_CAMERA_TIMEOUT_MS = 240_000;

/** A project's sandbox, as this process holds it. */
export interface ProjectSandbox extends Example1 {
  /** The app was started by this process and not stopped since. */
  appStarted: boolean;
}

/** What the journey's jobs need from a sandbox. The tests give a stand-in with no container. */
export interface Sandboxes {
  /** A fresh sandbox: the template copied, its history made, the compose file and secrets written. No container. */
  make(projectId: string): Promise<ProjectSandbox>;
  /** How the engine's container is started; undefined for the sandbox manager's own (`runStreaming`, service `engine`). */
  engineRunner(x: ProjectSandbox): EngineRunner | undefined;
  /** Why the app's images cannot be built now (the build's port on the machine already in use), or null. */
  portsBusy(x: ProjectSandbox): Promise<string | null>;
  /** Build the images, make the tables and sample users in the tools container, start the app. */
  buildAndStart(x: ProjectSandbox, log: (line: string) => void): Promise<void>;
  /**
   * Why the app camera cannot use the runner image the project's `acceptance` service names, or null (package 3.1b's
   * `runnerImageProblem`: Docker must answer, and the image must be on this machine, labelled with the approved
   * browser zip's fingerprint). Asked before the app is built and again just before the camera starts.
   */
  cameraImageProblem(x: ProjectSandbox): Promise<string | null>;
  /**
   * Why the app camera may not run in the project's `acceptance` service, or null: Compose's own reading of that
   * service must put it on the project's `front` network and on no other (package 0.6c), so that no page of the
   * app is ever loaded on the machine's network. Asked just before the camera starts.
   */
  cameraNetworkProblem(x: ProjectSandbox): Promise<string | null>;
  /** Run the app camera in the project's `acceptance` service. */
  appCamera(x: ProjectSandbox, a: { outDir: string; secretFile: string; onLine: (line: string) => void }): Promise<StreamingEnd>;
  /** One acceptance run (package 3.1's `runAcceptance`). */
  runAcceptance(input: AcceptanceRunInput): Promise<AcceptanceReport>;
  /** Stop and remove the project's containers and images; keep its folder (a preview that failed). */
  stopApp(x: ProjectSandbox): Promise<void>;
  /** Remove the project's containers, images and folder. */
  destroy(x: ProjectSandbox): Promise<string>;
  /** The same, for a sandbox this process holds no handle to (left by an interface that stopped). */
  destroyRecorded(projectId: string, rec: SandboxRecord): Promise<string>;
}

/** Only a journey project's id: "j1-" and 12 hexadecimal characters, so its Compose name starts "builder_j1-". */
export function checkJourneyId(projectId: string): void {
  if (!/^j1-[0-9a-f]{12}$/.test(projectId) || !composeProjectName(projectId).startsWith("builder_j1-")) {
    throw new Error(`"${projectId}" is not a journey project's id; nothing is made or removed for it here.`);
  }
}

/**
 * Why a recorded sandbox folder may not be removed, or null: it must be an absolute path whose last part
 * starts "builder-acceptance-" (as `makeExample1` names it), not a link, and hold a compose file naming this
 * project's Compose project.
 */
export function recordedSandboxRefusal(projectId: string, dir: string): string | null {
  if (!isAbsolute(dir) || resolve(dir) !== dir) return "the recorded folder is not an absolute, plain path";
  if (!basename(dir).startsWith("builder-acceptance-")) return "the recorded folder is not one makeExample1 makes";
  const st = lstatSync(dir, { throwIfNoEntry: false });
  if (!st) return null; // gone already: only the containers and images are left to remove
  if (!st.isDirectory()) return "the recorded folder is not a folder";
  const compose = join(dir, "compose.yaml");
  if (!existsSync(compose)) return "the recorded folder holds no compose file";
  const first = readFileSync(compose, "utf8").split("\n").find((l) => l.startsWith("name:"));
  if (first !== `name: ${JSON.stringify(composeProjectName(projectId))}`) return "the recorded folder's compose file names another project";
  return null;
}

/** The narrow environment for a Docker command with no sandbox folder (the daemon's settings only). */
function plainDockerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME ?? "/root" };
  for (const k of ["DOCKER_HOST", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) if (process.env[k]) env[k] = process.env[k];
  return env;
}

/**
 * Why a camera cannot use the runner image a sandbox's `acceptance` service names, or null: package 3.1b's
 * `runnerImageProblem`, asked with the sandbox's own Docker settings, as an acceptance run asks it (runner.ts, step 2).
 */
export async function cameraImageProblem(sb: Pick<Sandbox, "dir" | "acceptanceImage">): Promise<string | null> {
  if (!sb.acceptanceImage) return "the sandbox has no acceptance service";
  try {
    return await runnerImageProblem(sb.acceptanceImage, dockerEnv(sb));
  } catch (err) {
    return `Docker's settings could not be used (${(err as Error).message.split("\n")[0]})`;
  }
}

/**
 * Why the build's port on the machine cannot be used, or null: something already listens on 127.0.0.1:`port` (another
 * project's machine side, which holds it while that project runs, or another program). `then` says what was not done.
 */
export async function buildPortRefusal(port: number, then: string): Promise<string | null> {
  if (await portFree(port)) return null;
  return `Something already listens on 127.0.0.1:${port}, the port this machine gives a project's image build (another project's running sandbox, or another program); ${then}`;
}

/**
 * Why a service, as Compose reads it (`docker compose config --format json`), is not on the project's `front`
 * network and on nothing else, or null. Compose names a service's networks by their key in the file (`front`) and
 * gives `network_mode` for the machine's network ("host") or none.
 */
export function frontOnlyProblem(config: unknown, service: string): string | null {
  const s = (config as { services?: Record<string, { networks?: Record<string, unknown> | string[]; network_mode?: string }> } | null)?.services?.[service];
  if (!s) return `Compose's reading of the sandbox has no ${service} service`;
  if (s.network_mode !== undefined) return `Compose puts the ${service} service on network_mode "${s.network_mode}", not on the project's front network`;
  const names = Array.isArray(s.networks) ? s.networks : Object.keys(s.networks ?? {});
  if (names.length !== 1 || names[0] !== "front") return `Compose puts the ${service} service on ${names.length ? names.join(", ") : "no named network"}, not on the project's front network alone`;
  return null;
}

/**
 * Why the app camera may not run in a sandbox's `acceptance` service, or null: Compose's own reading of the sandbox's
 * compose file, with the service's profile on, must put the service on `front` and nothing else (`frontOnlyProblem`).
 */
export async function cameraNetworkProblem(sb: Pick<Sandbox, "dir" | "composeFile">): Promise<string | null> {
  let config: unknown;
  try {
    const { stdout } = await run("docker", ["compose", "-f", sb.composeFile, "--profile", "acceptance", "config", "--format", "json"], { env: dockerEnv(sb), maxBuffer: 4 * 1024 * 1024, timeout: 60_000 });
    config = JSON.parse(stdout);
  } catch (err) {
    return `Compose could not read the sandbox's services (${(err as Error).message.split("\n")[0]})`;
  }
  return frontOnlyProblem(config, "acceptance");
}

/** The real sandboxes: Docker, on the development profile, through example-1-sandbox.ts. */
export function example1Sandboxes(o: { runnerImage?: string; buildProxyPort?: number } = {}): Sandboxes {
  const runnerImage = o.runnerImage ?? RUNNER_IMAGE;
  const buildProxyPort = o.buildProxyPort ?? J1_BUILD_PROXY_PORT;
  return {
    async make(projectId) {
      checkJourneyId(projectId);
      // makeExample1 refuses a port in use too, but with an error the screens do not show; this says why, first.
      const busy = await buildPortRefusal(buildProxyPort, "the sandbox was not made. Close the other project, then try again.");
      if (busy) throw new JourneyRefused(busy);
      const x = await makeExample1({ projectId, appPort: J1_APP_PORT, buildProxyPort, runnerImage });
      return { ...x, appStarted: false };
    },
    engineRunner: () => undefined,
    portsBusy: (x) => buildPortRefusal(x.buildProxyPort, "the app's images are not built and the app is not started."),
    buildAndStart: (x, log) => buildAndStart(x, log),
    cameraImageProblem: (x) => cameraImageProblem(x.sb),
    cameraNetworkProblem: (x) => cameraNetworkProblem(x.sb),
    async appCamera(x, a) {
      const r = sandbox.runStreaming(x.sb, "acceptance", ["node", "/camera/app-shots.mjs"], {
        container: `${x.sb.projectName}-app-camera-${randomBytes(3).toString("hex")}`.slice(0, 120),
        volumes: [`${join(CAMERA_DIR, "app-shots.mjs")}:/camera/app-shots.mjs:ro`, `${a.outDir}:/shots`, `${a.secretFile}:/run/secrets/sample-password:ro`],
        onLine: a.onLine,
        timeoutMs: APP_CAMERA_TIMEOUT_MS,
      });
      return r.done;
    },
    runAcceptance: (input) => runAcceptance(input),
    async stopApp(x) {
      checkJourneyId(x.projectId);
      await sandbox.destroy(x.sb).catch(() => undefined);
      await sandbox.removeImage(x.sb).catch(() => undefined);
      x.appStarted = false;
    },
    async destroy(x) {
      checkJourneyId(x.projectId);
      x.appStarted = false;
      return destroyExample1(x);
    },
    async destroyRecorded(projectId, rec) {
      checkJourneyId(projectId);
      const why = recordedSandboxRefusal(projectId, rec.dir);
      if (why) throw new Error(`The sandbox of ${projectId} was not removed: ${why}.`);
      const name = composeProjectName(projectId);
      if (existsSync(join(rec.dir, "compose.yaml"))) {
        const sb: Sandbox = {
          dir: rec.dir,
          composeFile: join(rec.dir, "compose.yaml"),
          projectName: name,
          appBuild: { context: join(rec.dir, "workspace"), image: appImageName(projectId), toolsImage: toolsImageName(projectId), hostNetwork: true, args: {}, before: ["egress-host"] },
        };
        await sandbox.destroy(sb).catch(() => undefined);
        await sandbox.removeImage(sb).catch(() => undefined);
      }
      // Whatever is left of the Compose project (its folder may be gone), by its label, then its two images.
      const env = plainDockerEnv();
      const list = async (what: string[]) => (await run("docker", what, { env }).catch(() => ({ stdout: "" }))).stdout.split("\n").filter(Boolean);
      const label = `label=com.docker.compose.project=${name}`;
      const ids = await list(["ps", "-aq", "--filter", label]);
      if (ids.length) await run("docker", ["rm", "-f", ...ids], { env }).catch(() => undefined);
      const volumes = await list(["volume", "ls", "-q", "--filter", label]);
      if (volumes.length) await run("docker", ["volume", "rm", "-f", ...volumes], { env }).catch(() => undefined);
      const networks = await list(["network", "ls", "-q", "--filter", label]);
      if (networks.length) await run("docker", ["network", "rm", ...networks], { env }).catch(() => undefined);
      for (const image of [appImageName(projectId), toolsImageName(projectId)]) await run("docker", ["image", "rm", "-f", image], { env }).catch(() => undefined);
      rmSync(rec.dir, { recursive: true, force: true });
      return `containers removed: ${ids.length}; folder ${existsSync(rec.dir) ? "still there" : "removed"}`;
    },
  };
}
