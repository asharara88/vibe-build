/**
 * The thin adapter between the journey and example 1's sandbox (package J1; final design, section 4,
 * "Sandboxes"). It calls `makeExample1`, `buildAndStart` and `portFree` from
 * scripts/example-1-sandbox.ts unchanged, and the sandbox manager's `runStreaming`, `destroy` and
 * `removeImage`. Since package 0.6c it uses 0.6c's development-profile sandbox as it is:
 *
 * - The project's containers sit on its private networks (`data`, `front`, `out`), with no route to the machine
 *   and no port on it. The app listens on 3161 inside its container and is reached only at http://app:3161, from
 *   containers on `front`: the check that nothing answers there before the app starts and the "right app
 *   answers" check before a checklist run (0.6c's `askApp`), the acceptance runner, the app camera, and (package J3)
 *   the live preview's streams, each a short-lived `check` container whose standard input and output carry one
 *   connection to the app (`appStream`; manager.ts). Nothing this process runs on the machine opens a TCP connection
 *   to the app or its database: the live preview's front reads the HTTP those streams carry (src/web/preview.ts).
 *   Before the first stream, Compose's own reading of the sandbox must put `check` on `front` alone
 *   (`streamNetworkProblem`). The live camera (`liveCamera`) is the app camera's service with one more mount: the
 *   camera socket's folder, read-only, at /psock.
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
 *   the sandbox is checked to put the service on the project's `front` network and nothing else, with `front`
 *   internal and in 0.6c's "isolated" gateway mode (`cameraNetworkProblem`); journey-jobs.ts asks both first.
 *
 * - Package J2 (a): `stageBrokenStep` copies the deliberately broken step 03 into the sandbox's own change-set folder,
 *   through scripts/example-1-sandbox.ts's `stageBrokenStep` unchanged, after `checkJourneyId` and the same target check
 *   as the job's (`brokenStageTargetProblem`): never into builder/scripted or any folder but the sandbox's own.
 *
 * Development profile only (the server profile is 0.6b's).
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { runAcceptance, type AcceptanceReport, type AcceptanceRunInput } from "../acceptance/runner.js";
import { RUNNER_IMAGE, runnerImageProblem } from "../acceptance/runner-image.js";
import type { EngineRunner } from "../engine/scripted.js";
import { appImageName, composeProjectName, dockerEnv, PROJECT_NETWORK, sandbox, toolsImageName, type Sandbox, type StreamingEnd } from "../sandbox/manager.js";
import { buildAndStart, makeExample1, portFree, stageBrokenStep as stageBrokenStepInto, type Example1 } from "../../scripts/example-1-sandbox.js";
import { projectLeftovers } from "../../scripts/journey-restart-checks.js";
import { brokenStageTargetProblem, DOCKER_NOT_ASKED, JourneyRefused, SandboxNotRemoved, type SandboxRecord } from "./journey.js";
import type { AppStream } from "../sandbox/manager.js";

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
  /**
   * Package J2 (a): copy the deliberately broken step 03 (builder/scripted-broken) into the sandbox's own change-set
   * folder, and nowhere else. The job calls it just before step 3's engine is made.
   */
  stageBrokenStep(x: ProjectSandbox): Promise<void>;
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
  /**
   * Run the app camera in the project's `acceptance` service. Once `signal` is aborted (the interface lost its instance
   * lock: review bot on defb9c4), its container is killed by name at once.
   */
  appCamera(x: ProjectSandbox, a: { outDir: string; secretFile: string; onLine: (line: string) => void; signal?: AbortSignal }): Promise<StreamingEnd>;
  /** One acceptance run (package 3.1's `runAcceptance`). */
  runAcceptance(input: AcceptanceRunInput): Promise<AcceptanceReport>;
  /**
   * Package J3: why the live preview's streams may not run in the project's `check` service, or null: Compose's own
   * reading of that service must put it on the project's `front` network alone, a private one (`frontOnlyProblem`).
   * Asked before a live session opens.
   */
  streamNetworkProblem(x: ProjectSandbox): Promise<string | null>;
  /** Package J3: one stream to the running app (manager.ts, `appStream`). */
  appStream(x: ProjectSandbox): AppStream;
  /** Stop and remove the project's containers and images; keep its folder (a preview that failed). */
  stopApp(x: ProjectSandbox): Promise<void>;
  /** Remove the project's containers, images and folder. */
  destroy(x: ProjectSandbox): Promise<string>;
  /** The same, for a sandbox this process holds no handle to (left by an interface that stopped). */
  destroyRecorded(projectId: string, rec: SandboxRecord): Promise<string>;
}

export { DOCKER_NOT_ASKED };
/** The time limit of each Docker command of a removal's sweep and check. Chosen, not measured. */
export const REMOVAL_DOCKER_TIMEOUT_MS = 60_000;

/**
 * The form the check asks Docker's lists in (after the review of known gap 180's fix): one JSON object a line, holding
 * the name and the Compose project label, each written by Docker's own `json`. A tab or a line break in a name is
 * written as JSON writes it, inside the name, so no name can shift the label out of sight or pass for a second line.
 */
const NAME_AND_PROJECT = (name: "Names" | "Name") => `{"name":{{json .${name}}},"project":{{json (.Label "com.docker.compose.project")}}}`;
const REPOSITORY_AND_TAG = '{"repository":{{json .Repository}},"tag":{{json .Tag}}}';

/** One of Docker's lists, printed one JSON object a line: each line's two named texts. A line that is not such an object throws: it is never passed over. */
function jsonLines<A extends string, B extends string>(out: string, a: A, b: B, what: string): Array<Record<A | B, string>> {
  return out
    .split("\n")
    .filter((l) => l.trim() !== "")
    .flatMap((l) => {
      let o: unknown;
      try {
        o = JSON.parse(l);
      } catch {
        o = null;
      }
      const r = (typeof o === "object" && o !== null ? o : {}) as Record<string, unknown>;
      if (typeof r[a] !== "string" || typeof r[b] !== "string") throw new Error(`a line of Docker's list of ${what} could not be read`);
      return [{ [a]: r[a], [b]: r[b] } as Record<A | B, string>];
    });
}

/**
 * Why a Docker command gave no answer, in Docker's own words (after the review of known gap 180's fix): past its time
 * limit, that; else the last non-empty line the docker program wrote on its error output; else the error's own message
 * (the program not found, a list that could not be read). Never the command line, which is what Node puts first in the
 * message of a command that failed.
 */
export function dockerSaid(err: unknown, timeoutMs: number): string {
  const e = (typeof err === "object" && err !== null ? err : {}) as { killed?: unknown; code?: unknown; stderr?: unknown };
  if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return "its answer was longer than the builder reads";
  if (e.killed === true) return `no answer within ${timeoutMs / 1000} s`;
  const said = typeof e.stderr === "string" ? e.stderr.split("\n").map((l) => l.trim()).filter((l) => l !== "") : [];
  const last = said.at(-1);
  if (last !== undefined) return last.slice(0, 300);
  const message = (err instanceof Error ? err.message : String(err)).split("\n")[0]!;
  return (message.startsWith("Command failed:") ? `the docker program ended with exit code ${String(e.code)} and said nothing` : message).slice(0, 300);
}

/** A folder that does not exist, and that only the machine's administrator could make: the place of a Docker client folder when none may be read. */
const NO_DOCKER_CLIENT = "/nonexistent/builder-removal";

/**
 * The settings every Docker command of a removal runs with (after the review of known gap 180's fix): the sandbox's own
 * (manager.ts, `dockerEnv`), so that the sweep and the check ask the daemon the sandbox's commands asked, and a Docker
 * context the sandbox refuses is refused here too. `clientDir` is the sandbox's folder, whose own Docker client folder
 * the commands read as the sandbox's do (if the folder is gone, there is none to read); null when the folder may not be
 * read (`recordedSandboxRefusal`): Docker's client is then pointed at a client folder that does not exist, so it reads
 * no configuration and reaches the daemon DOCKER_HOST names, or the default one. Throws what `dockerEnv` throws.
 */
function removalDockerEnv(clientDir: string | null): NodeJS.ProcessEnv {
  return dockerEnv({ dir: clientDir ?? NO_DOCKER_CLIENT });
}

/**
 * What Docker still lists of a journey project: its containers, volumes and networks (by the Compose project's name
 * or label) and its images, matched by the rule J2's automated run uses (`projectLeftovers`, rule N, without the
 * processes and the folder). A control character in a name is shown as JSON writes it (a tab as \t). If Docker cannot be
 * asked (its settings refused, the docker program missing or failing, no answer within `timeoutMs`, a line that cannot
 * be read), that is said as one line starting `DOCKER_NOT_ASKED`, with Docker's own words: a list that could not be
 * read is not read as "nothing left". `env`: the Docker settings to ask with; the sandbox's, with no client folder,
 * when none is given.
 */
export async function dockerLeftovers(projectId: string, env?: NodeJS.ProcessEnv, o: { timeoutMs?: number } = {}): Promise<string[]> {
  checkJourneyId(projectId);
  const timeoutMs = o.timeoutMs ?? REMOVAL_DOCKER_TIMEOUT_MS;
  try {
    const ask = { env: env ?? removalDockerEnv(null), timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 };
    const [containers, volumes, networks, images] = await Promise.all([
      run("docker", ["ps", "-a", "--format", NAME_AND_PROJECT("Names")], ask),
      run("docker", ["volume", "ls", "--format", NAME_AND_PROJECT("Name")], ask),
      run("docker", ["network", "ls", "--format", NAME_AND_PROJECT("Name")], ask),
      run("docker", ["image", "ls", "--format", REPOSITORY_AND_TAG], ask),
    ]);
    const named = (out: string, what: string) => jsonLines(out, "name", "project", what).map((x) => ({ name: x.name, composeProject: x.project }));
    const seen = { containers: named(containers.stdout, "containers"), volumes: named(volumes.stdout, "volumes"), networks: named(networks.stdout, "networks"), images: jsonLines(images.stdout, "repository", "tag", "images") };
    return projectLeftovers(projectId, seen, [], { path: null, exists: false }).map((line) => line.replace(/[\u0000-\u001f\u007f]/g, (c) => JSON.stringify(c).slice(1, -1)));
  } catch (err) {
    return [`${DOCKER_NOT_ASKED} (${dockerSaid(err, timeoutMs)})`];
  }
}

/**
 * The end of every removal of a journey project's sandbox (known gap 180's fix, 14 Nov 2026): whatever is left of its
 * Compose project is removed by its label, then its two images; then Docker's own lists are read. Only if they hold
 * nothing of the project is its folder removed. Otherwise the folder is kept and `SandboxNotRemoved` is thrown, naming
 * what is left: the caller records `removed: false`, and a later start, or a second "Close project", tries again.
 *
 * After the fix's review: `env` is the sandbox's own Docker settings (`removalDockerEnv`), and each command has a time
 * limit. `leave` is why the recorded folder may not be touched (`recordedSandboxRefusal`), or null: with a reason, the
 * sweep and the check are made all the same (they need no folder), the folder is left exactly as it is, and
 * `SandboxNotRemoved` names it, with the reason, after whatever Docker still lists.
 */
async function sweepAndCheck(projectId: string, dir: string, env: NodeJS.ProcessEnv, leave: string | null = null): Promise<string> {
  checkJourneyId(projectId);
  const name = composeProjectName(projectId);
  const quiet = (what: string[]) => run("docker", what, { env, timeout: REMOVAL_DOCKER_TIMEOUT_MS }).catch(() => ({ stdout: "" }));
  const list = async (what: string[]) => (await quiet(what)).stdout.split("\n").filter(Boolean);
  const label = `label=com.docker.compose.project=${name}`;
  const ids = await list(["ps", "-aq", "--filter", label]);
  if (ids.length) await quiet(["rm", "-f", ...ids]);
  const volumes = await list(["volume", "ls", "-q", "--filter", label]);
  if (volumes.length) await quiet(["volume", "rm", "-f", ...volumes]);
  const networks = await list(["network", "ls", "-q", "--filter", label]);
  if (networks.length) await quiet(["network", "rm", ...networks]);
  for (const image of [appImageName(projectId), toolsImageName(projectId)]) await quiet(["image", "rm", "-f", image]);
  const left = await dockerLeftovers(projectId, env);
  if (leave !== null) throw new SandboxNotRemoved(projectId, [...left, `folder ${dir} (left as it is: ${leave})`], `The sandbox of ${projectId} was not removed: ${leave}.`);
  if (left.length) throw new SandboxNotRemoved(projectId, left);
  removeSandboxFolder(projectId, dir);
  return `containers removed by the sweep: ${ids.length}; nothing of the project left in Docker's lists; folder removed`;
}

/**
 * Remove a sandbox's folder, once Docker lists nothing of its project (after the review of known gap 180's fix).
 * Everything in it but its compose file goes first, each entry tried even if one before it could not be removed; the
 * compose file and the folder itself go last, and only if all the rest went. So a removal cut off part-way, or an
 * entry that cannot be removed, leaves a folder that still passes `recordedSandboxRefusal`, and the next attempt runs
 * in full. What cannot be removed is said as `SandboxNotRemoved`, naming the folder and the error's code
 * (`removalErrorCode`): never as a plain error, which "Close project" would show as "Something went wrong" and record
 * nothing of.
 */
function removeSandboxFolder(projectId: string, dir: string): void {
  const errors: unknown[] = [];
  const attempt = (f: () => void) => {
    try {
      f();
    } catch (err) {
      errors.push(err);
    }
  };
  if (lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    let entries: string[] = [];
    attempt(() => (entries = readdirSync(dir)));
    for (const entry of entries.filter((e) => e !== "compose.yaml")) attempt(() => rmSync(join(dir, entry), { recursive: true, force: true }));
  }
  if (errors.length === 0) attempt(() => rmSync(dir, { recursive: true, force: true }));
  if (errors.length === 0 && existsSync(dir)) errors.push(new Error("still there"));
  if (errors.length === 0) return;
  const first = errors[0];
  const code = removalErrorCode(first);
  throw new SandboxNotRemoved(projectId, [`folder ${dir} (not removed: ${code})`]);
}

/**
 * The code of an error from removing a file or a folder. For a file it could not remove, Node's recursive removal
 * reports ENOTDIR (it goes on to try the file as a folder; measured on Node 22.23.4, 14 Nov 2026), which is not why the
 * file stayed. So for that code the file itself is asked once more, and its own code is given (EPERM for a file that
 * may not be removed).
 */
function removalErrorCode(err: unknown): string {
  const e = (typeof err === "object" && err !== null ? err : {}) as NodeJS.ErrnoException;
  if (e.code === "ENOTDIR" && typeof e.path === "string" && lstatSync(e.path, { throwIfNoEntry: false })?.isFile()) {
    try {
      unlinkSync(e.path);
    } catch (own) {
      return (own as NodeJS.ErrnoException).code ?? "ENOTDIR";
    }
  }
  return e.code ?? (err instanceof Error ? err.message : String(err));
}

/**
 * `removalDockerEnv`, for a removal: settings the sandbox refuses (a Docker context it does not support) mean Docker
 * cannot be asked, so nothing is removed and the removal is reported as not done, with the refusal's own words.
 */
function removalEnvOrNotRemoved(projectId: string, clientDir: string | null): NodeJS.ProcessEnv {
  try {
    return removalDockerEnv(clientDir);
  } catch (err) {
    throw new SandboxNotRemoved(projectId, [`${DOCKER_NOT_ASKED} (${(err instanceof Error ? err.message : String(err)).slice(0, 300)})`]);
  }
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
 * 0.6c's gateway option on every project network, by the name the sandbox manager writes it (`PROJECT_NETWORK`):
 * with it "isolated", Docker puts no address of the machine on the network. Typed against the manager's own
 * constant, so a change of its name there does not typecheck here.
 */
const GATEWAY_MODE_OPTION = "com.docker.network.bridge.gateway_mode_ipv4" satisfies keyof typeof PROJECT_NETWORK.driver_opts;

/**
 * Why a service, as Compose reads it (`docker compose config --format json`), is not on the project's `front`
 * network and on nothing else, or that network is not one of 0.6c's private networks, or null. Compose names a
 * service's networks by their key in the file (`front`) and gives `network_mode` for the machine's network ("host")
 * or none. In the same reading, the top-level `networks.front` must be `internal` (no route out) and carry 0.6c's
 * gateway option "isolated" (no address of the machine on it), as the sandbox manager writes every project network.
 */
export function frontOnlyProblem(config: unknown, service: string): string | null {
  const c = config as {
    services?: Record<string, { networks?: Record<string, unknown> | string[]; network_mode?: string }>;
    networks?: Record<string, { internal?: unknown; driver_opts?: Record<string, unknown> } | null>;
  } | null;
  const s = c?.services?.[service];
  if (!s) return `Compose's reading of the sandbox has no ${service} service`;
  if (s.network_mode !== undefined) return `Compose puts the ${service} service on network_mode "${s.network_mode}", not on the project's front network`;
  const names = Array.isArray(s.networks) ? s.networks : Object.keys(s.networks ?? {});
  if (names.length !== 1 || names[0] !== "front") return `Compose puts the ${service} service on ${names.length ? names.join(", ") : "no named network"}, not on the project's front network alone`;
  const front = c?.networks?.front;
  if (!front) return "Compose's reading of the sandbox has no front network";
  if (front.internal !== true) return "Compose reads the project's front network as not internal: Docker would give it a route out";
  const isolated: string | undefined = PROJECT_NETWORK.driver_opts[GATEWAY_MODE_OPTION];
  if (!isolated || front.driver_opts?.[GATEWAY_MODE_OPTION] !== isolated)
    return `Compose reads the project's front network without ${GATEWAY_MODE_OPTION} "${isolated}": Docker would put an address of the machine on it`;
  return null;
}

/**
 * Why the app camera may not run in a sandbox's `acceptance` service, or null: Compose's own reading of the sandbox's
 * compose file, with the service's profile on, must put the service on `front` and nothing else, and read `front`
 * as internal with the "isolated" gateway option (`frontOnlyProblem`).
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

/**
 * Package J3: why the live preview's streams may not run in a sandbox's `check` service, or null: Compose's own reading
 * of the sandbox's compose file, with the service's profile on, must put the service on `front` and nothing else, and
 * read `front` as internal with the "isolated" gateway option (`frontOnlyProblem`), as `cameraNetworkProblem` reads it.
 */
export async function streamNetworkProblem(sb: Pick<Sandbox, "dir" | "composeFile">): Promise<string | null> {
  let config: unknown;
  try {
    const { stdout } = await run("docker", ["compose", "-f", sb.composeFile, "--profile", "check", "config", "--format", "json"], { env: dockerEnv(sb), maxBuffer: 4 * 1024 * 1024, timeout: 60_000 });
    config = JSON.parse(stdout);
  } catch (err) {
    return `Compose could not read the sandbox's services (${(err as Error).message.split("\n")[0]})`;
  }
  return frontOnlyProblem(config, "check");
}

/** The live camera's time limit. */
export const LIVE_CAMERA_TIMEOUT_MS = 300_000;

/**
 * Package J3 (final design, section 4.8): the live camera, in a sandbox's own `acceptance` service, started as the app
 * camera is (`runStreaming`): the approved runner image, its user 1001, `front` only, no video and no trace. Its
 * mounts: the script (read-only), one output folder, a folder of passes (pass-1, and pass-2 when a walk asks for a new
 * entry) and the sample password, read-only, and the camera socket's folder read-only at /psock. Its script loads only http://127.0.0.1:4030 inside its own container,
 * which it forwards to /psock/c.sock; on the machine that socket leads to the preview front (preview.ts,
 * `cameraSocket`). Before it starts, the image is checked (`cameraImageProblem`) and the service's networks
 * (`cameraNetworkProblem`). `env` names the walk (the live test's refusals use their own).
 */
export async function liveCamera(
  sb: Sandbox,
  a: { cameraDir: string; outDir: string; passDir: string; sampleFile: string; onLine: (line: string) => void; env?: Record<string, string>; signal?: AbortSignal },
): Promise<StreamingEnd> {
  const image = await cameraImageProblem(sb);
  if (image) throw new JourneyRefused(`The live camera did not start: ${image}.`);
  const network = await cameraNetworkProblem(sb);
  if (network) throw new JourneyRefused(`The live camera did not start: ${network}.`);
  const r = sandbox.runStreaming(sb, "acceptance", ["node", "/camera/live-shots.mjs"], {
    container: `${sb.projectName}-live-camera-${randomBytes(3).toString("hex")}`.slice(0, 120),
    volumes: [
      `${join(CAMERA_DIR, "live-shots.mjs")}:/camera/live-shots.mjs:ro`,
      `${a.outDir}:/shots`,
      `${a.passDir}:/run/secrets/live:ro`,
      `${a.sampleFile}:/run/secrets/sample-password:ro`,
      `${a.cameraDir}:/psock:ro`,
    ],
    onLine: a.onLine,
    timeoutMs: LIVE_CAMERA_TIMEOUT_MS,
    env: a.env,
  });
  const kill = () => void r.kill();
  if (a.signal?.aborted) kill();
  else a.signal?.addEventListener("abort", kill, { once: true });
  try {
    return await r.done;
  } finally {
    a.signal?.removeEventListener("abort", kill);
  }
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
    async stageBrokenStep(x) {
      checkJourneyId(x.projectId);
      const why = brokenStageTargetProblem(x);
      if (why) throw new JourneyRefused(`The broken step was not staged: ${why}.`);
      stageBrokenStepInto(x);
    },
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
      const kill = () => void r.kill();
      if (a.signal?.aborted) kill();
      else a.signal?.addEventListener("abort", kill, { once: true });
      try {
        return await r.done;
      } finally {
        a.signal?.removeEventListener("abort", kill);
      }
    },
    runAcceptance: (input) => runAcceptance(input),
    streamNetworkProblem: (x) => streamNetworkProblem(x.sb),
    appStream: (x) => sandbox.appStream(x.sb, `app:${x.appPort}`, { container: `${x.sb.projectName}-live-${randomBytes(4).toString("hex")}` }),
    async stopApp(x) {
      checkJourneyId(x.projectId);
      await sandbox.destroy(x.sb).catch(() => undefined);
      await sandbox.removeImage(x.sb).catch(() => undefined);
      x.appStarted = false;
    },
    async destroy(x) {
      checkJourneyId(x.projectId);
      x.appStarted = false;
      // After the fix's review: the sandbox's own Docker settings, asked for before anything is removed, so that a
      // Docker context the sandbox refuses is said by name and not swallowed with Compose's errors below.
      const env = removalEnvOrNotRemoved(x.projectId, x.dir);
      // Known gap 180's fix (14 Nov 2026): Compose's own removal, as before, then the same sweep and the same check as
      // for a recorded sandbox. Before, this path removed the folder and returned whatever Docker had said.
      await sandbox.destroy(x.sb).catch(() => undefined);
      await sandbox.removeImage(x.sb).catch(() => undefined);
      return sweepAndCheck(x.projectId, x.dir, env);
    },
    async destroyRecorded(projectId, rec) {
      checkJourneyId(projectId);
      // After the fix's review: a recorded folder that fails its own check is left exactly as it is, and never read;
      // Docker's side is removed and checked all the same, and the removal is reported as not done, naming the folder.
      const why = recordedSandboxRefusal(projectId, rec.dir);
      const env = removalEnvOrNotRemoved(projectId, why === null ? rec.dir : null);
      const name = composeProjectName(projectId);
      if (why === null && existsSync(join(rec.dir, "compose.yaml"))) {
        const sb: Sandbox = {
          dir: rec.dir,
          composeFile: join(rec.dir, "compose.yaml"),
          projectName: name,
          appBuild: { context: join(rec.dir, "workspace"), image: appImageName(projectId), toolsImage: toolsImageName(projectId), hostNetwork: true, args: {}, before: ["egress-host"] },
        };
        await sandbox.destroy(sb).catch(() => undefined);
        await sandbox.removeImage(sb).catch(() => undefined);
      }
      return sweepAndCheck(projectId, rec.dir, env, why);
    },
  };
}
