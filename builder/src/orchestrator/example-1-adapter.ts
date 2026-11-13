/**
 * The thin adapter between the journey and example 1's sandbox (package J1; final design, section 4,
 * "Sandboxes"). It calls `makeExample1`, `buildAndStart`, `destroyExample1` and `portFree` from
 * scripts/example-1-sandbox.ts unchanged, and the sandbox manager's `runStreaming`, `destroy` and
 * `removeImage`. It moves into src only after package 0.6c rewrites those (0.6c's measurements change what
 * example-1-sandbox.ts does).
 *
 * - One project with live containers at a time, on fixed ports: the app on 3161, its database on 5591, each
 *   checked free first. No other script or test uses them.
 * - Project ids start "j1-", so Compose names start "builder_j1-". Nothing here removes a Compose project, an
 *   image or a folder of another name (`checkJourneyId`, `recordedSandboxRefusal`).
 * - The app camera (camera/app-shots.mjs) runs in the project's own `acceptance` service: the approved runner
 *   image, its unprivileged user, its read-only root and its hardening; the script read-only, one output
 *   folder, the sample password as one read-only file. No video and no trace: the script records neither.
 *
 * Development profile only: the app and runner containers share the machine's network (known gaps 1 and 60).
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { runAcceptance, type AcceptanceReport, type AcceptanceRunInput } from "../acceptance/runner.js";
import { RUNNER_IMAGE } from "../acceptance/runner-image.js";
import type { EngineRunner } from "../engine/scripted.js";
import { appImageName, composeProjectName, sandbox, toolsImageName, type Sandbox, type StreamingEnd } from "../sandbox/manager.js";
import { buildAndStart, destroyExample1, makeExample1, portFree, type Example1 } from "../../scripts/example-1-sandbox.js";
import type { SandboxRecord } from "./journey.js";

const run = promisify(execFile);

export const J1_APP_PORT = 3161;
export const J1_DB_PORT = 5591;
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
  /** Why the app cannot be started now (a port already in use), or null. */
  portsBusy(x: ProjectSandbox): Promise<string | null>;
  /** Build the images, make the tables and sample users in the tools container, start the app. */
  buildAndStart(x: ProjectSandbox, log: (line: string) => void): Promise<void>;
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

/** The real sandboxes: Docker, on the development profile, through example-1-sandbox.ts. */
export function example1Sandboxes(o: { runnerImage?: string } = {}): Sandboxes {
  const runnerImage = o.runnerImage ?? RUNNER_IMAGE;
  return {
    async make(projectId) {
      checkJourneyId(projectId);
      const x = await makeExample1({ projectId, appPort: J1_APP_PORT, dbPort: J1_DB_PORT, runnerImage });
      return { ...x, appStarted: false };
    },
    engineRunner: () => undefined,
    async portsBusy(x) {
      const busy: string[] = [];
      for (const p of [x.appPort, x.dbPort]) if (!(await portFree(p))) busy.push(String(p));
      return busy.length ? `Something already listens on 127.0.0.1 port ${busy.join(" and ")}; the app is not started.` : null;
    },
    buildAndStart: (x, log) => buildAndStart(x, log),
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
          appBuild: { context: join(rec.dir, "workspace"), image: appImageName(projectId), toolsImage: toolsImageName(projectId), hostNetwork: true, args: {} },
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
