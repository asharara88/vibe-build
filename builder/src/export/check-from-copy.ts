/**
 * The check from the exported copy (package 3.2, docs/design/package-3.2.md, section 3): the checklist's tests, as the
 * exported copy holds them, run by package 3.1's runner against the app that the copy's own command started, with the
 * builder that made the export stopped. Run by `scripts/check-export.ts`.
 *
 * It is the builder's own code, run on the machine. It uses package 3.1's code as a library (`verifyVersionAt`,
 * `runnerImageProblem`, `readRun`, the runner's command and the acceptance service's definition) and opens no builder
 * interface, database, gateway or acceptance store. Its four values (the project's id, the version, the manifest's
 * SHA-256 and the checklist count) come from the export's event, `journey.export.written`, recorded before the builder
 * stopped. In order:
 *
 * 1. The version (S25): every check of `verifyVersion`, unchanged, on <copy>/acceptance/<version> (`verifyVersionAt`).
 * 2. The fingerprint: the manifest's SHA-256 equals the one given and the one acceptance/README.txt records. This
 *    stands in for 3.1's `versionMatchesEvent`, which needs the builder's database.
 * 3. The runner image, checked by `runnerImageProblem`. A missing or wrong image means "did not run"; nothing is built or
 *    downloaded (every container here is started with `--pull never`).
 * 4. The right app (S26), found without the sandbox, by Compose's labels and the image's id:
 *    - exactly one container of the service `app` whose Compose project's working folder
 *      (`com.docker.compose.project.working_dir`) is the copy's folder; its project named after the folder, as the
 *      README's command names it; read from the copy's own `compose.yaml` alone (`com.docker.compose.project.config_files`);
 *      running and healthy;
 *    - its image is the one Compose built from the copy: the image named `<project>-app`, compared by id, labelled by
 *      Compose with this project and the service `app`;
 *    - the project's `front` network is internal, in the "isolated" gateway mode, the project's, and holds no container
 *      but the project's `app` and `door` (and, later, the check's own forwarder);
 *    - its sign-in page answers 200, asked from a short-lived approved Node container on `<project>_front` alone;
 *    - the `keys` volume the runner's password comes from is the project's (else `docker run` would make an empty one:
 *      measured).
 * 5. The forwarder (S27): the approved Node image, user `node`, a read-only root, the hardening, on `<project>_front`
 *    alone, listening on its own 127.0.0.1 at the port of the app container's own APP_URL (APP_PORT can change it) and
 *    passing each connection, unread, to `app` at the app's own port. It must answer the sign-in page through its
 *    namespace before the runner starts. There is no fallback: if it does not work, the run is refused and says so.
 * 6. The runner, as 3.1 runs it: its `docker run` arguments are built from 3.1's own service definition
 *    (`acceptanceService`) and `HARDENING` (`runnerRunArgs`; test T8), in the forwarder's namespace
 *    (`--network container:<forwarder>`) with BASE_URL equal to the app's APP_URL, which sign-in requires as the
 *    browser's origin; exactly 3.1's three mounts (the copy's acceptance/<version> read-only; a fresh results folder
 *    outside the copy, given to the runner's user; the `keys` volume's one file `sample_password`, read-only, through
 *    the volume's subpath); RUN_ID and BASE_URL only; 3.1's limit of 600 s, killed after it.
 * 7. The reading: `readRun`, unchanged, with the checklist count given (S31), labelled "stand-in test, not independent
 *    acceptance". Any refusal before the start makes every item "did not run" and the outcome "not passed".
 * 8. Afterwards: the forwarder is removed by its exact name; the copy's file fingerprints and
 *    `git status --porcelain --ignored` must be what they were before the check began.
 *
 * The run folder holds the runner's results (its trace holds the sample password: known gap 72), so it must be outside
 * the copy and outside the repository, and is never put into evidence/ whole.
 */
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, chownSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { readRun, type RunFacts, type RunReading } from "../acceptance/results.js";
import { DEFAULT_RUN_TIMEOUT_MS, RUNNER_COMMAND, RUNNER_MOUNT_TARGETS } from "../acceptance/runner.js";
import { RUNNER_IMAGE, RUNNER_UID, runnerImageProblem } from "../acceptance/runner-image.js";
import { checkProjectId, insideOrEqual, newRunId, REPO_ROOT, sha256, STAND_IN_LABEL, verifyVersionAt, type VersionManifest } from "../acceptance/store.js";
import { acceptanceService, DEFAULT_IMAGES, DOCKER_DAEMON_SETTINGS, HARDENING } from "../sandbox/manager.js";

const run = promisify(execFile);

/** How the reading is labelled (DEC:130): the same words as the journey's label for the stand-in test. */
export const COPY_CHECK_LABEL = `${STAND_IN_LABEL}, not independent acceptance`;
/** The check's own containers are named `<project>-copycheck-<what>-<tag>`. */
export const COPY_CHECK_PART = "copycheck";
/** What the script needs, in the order section 3 gives them. */
export const CHECK_USAGE =
  "Usage: npx tsx scripts/check-export.ts <copy folder> --project-id <id> --version <vNNN> --manifest-sha256 <64 hex> --checklist-items <n> --run-folder <folder>\n" +
  "The four values come from the export's event, journey.export.written (project_id, acceptance_version, manifest_sha256, checklist_items). " +
  "The copy must have been started with its README's command first. The run folder must not exist; it is made outside the copy and outside the repository.";

const VERSION = /^v\d{3}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FLAGS = ["--project-id", "--version", "--manifest-sha256", "--checklist-items", "--run-folder"] as const;

export interface CopyCheckArgs {
  /** The unpacked copy's folder: the Compose project's working folder. */
  copyDir: string;
  projectId: string;
  version: string;
  /** The manifest's SHA-256 as the export's event records it. */
  manifestSha256: string;
  /** How many items the app spec's checklist has, as the export's event records it (S31). */
  checklistItems: number;
  /** A fresh folder for the run, outside the copy and the repository; refused if it exists. */
  runFolder: string;
}

/** The script's values. Every flag is needed, once; nothing else is taken. Throws, naming the flag, otherwise. */
export function parseCheckArgs(argv: string[]): CopyCheckArgs {
  const seen = new Map<string, string>();
  let copy: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      if (!(FLAGS as readonly string[]).includes(a)) throw new Error(`${a} is not a value this script takes.`);
      if (seen.has(a)) throw new Error(`${a} is given twice.`);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value.`);
      seen.set(a, v);
      i++;
    } else if (copy === undefined && i === 0) copy = a;
    else throw new Error(`"${a}" is not expected here; the copy folder comes first, then the flags.`);
  }
  if (!copy) throw new Error("The copy folder is missing: it comes first.");
  for (const f of FLAGS) if (!seen.has(f)) throw new Error(`${f} is missing; the check does not run without it.`);
  const projectId = seen.get("--project-id")!;
  try {
    checkProjectId(projectId);
  } catch {
    throw new Error(`--project-id "${projectId}" is not a project id.`);
  }
  const version = seen.get("--version")!;
  if (!VERSION.test(version)) throw new Error(`--version "${version}" is not a version name (v and three digits).`);
  const manifestSha256 = seen.get("--manifest-sha256")!;
  if (!SHA256.test(manifestSha256)) throw new Error("--manifest-sha256 must be 64 lowercase hexadecimal characters.");
  const n = seen.get("--checklist-items")!;
  if (!/^[1-9][0-9]{0,3}$/.test(n)) throw new Error(`--checklist-items "${n}" must be a whole number of at least 1: the number of items in the app spec's checklist, as the export's event records it.`);
  return { copyDir: resolve(copy), projectId, version, manifestSha256, checklistItems: Number(n), runFolder: resolve(seen.get("--run-folder")!) };
}

/** Item 7: the run, read by 3.1's `readRun`, unchanged, with the checklist count the script was given (S31). */
export function copyReading(args: Pick<CopyCheckArgs, "checklistItems">, facts: Omit<RunFacts, "checklistItems">): RunReading {
  return readRun({ ...facts, checklistItems: args.checklistItems });
}

/** The fields of 3.1's acceptance service that the runner's arguments are built from. */
interface AcceptanceDefinition {
  image: string;
  pull_policy: string;
  cap_drop: string[];
  security_opt: string[];
  pids_limit: number;
  mem_limit: string;
  read_only: boolean;
  tmpfs: string[];
  user: string;
  entrypoint: string[];
  working_dir: string;
  environment: Record<string, string>;
  networks: string[];
}

/** The hardening every project container gets, as the sandbox's compose document gives it to a service. */
const hardeningFields = () => ({ cap_drop: HARDENING.cap_drop, security_opt: HARDENING.security_opt, pids_limit: HARDENING.pids_limit, mem_limit: HARDENING.mem_limit });
/** The hardening as `docker run` flags (the read-only root is given separately). */
const hardeningFlags = () => [
  ...HARDENING.cap_drop.flatMap((x) => ["--cap-drop", x]),
  ...HARDENING.security_opt.flatMap((x) => ["--security-opt", x]),
  "--pids-limit",
  String(HARDENING.pids_limit),
  "--memory",
  HARDENING.mem_limit,
];

/** A path that may go into a `--mount` value: absolute, with no comma (the value's separator) and no line break. */
function mountPath(p: string, what: string): string {
  if (!isAbsolute(p) || /[,\n\r]/.test(p)) throw new Error(`${what} (${p}) cannot be mounted: it must be an absolute path with no comma.`);
  return p;
}

export interface RunnerArgsInput {
  /** The runner's container name. */
  container: string;
  /** The forwarder's container name: the runner shares its network namespace. */
  forwarder: string;
  /** The app's own APP_URL, the browser's address. */
  appUrl: string;
  runId: string;
  /** The copy's acceptance/<version>. */
  versionDir: string;
  /** The fresh results folder. */
  resultsDir: string;
  /** The copy's Compose volume of keys, `<project>_keys`. */
  keysVolume: string;
  image?: string;
}

/**
 * Item 6: the runner's `docker run` arguments, built from package 3.1's own service definition (`acceptanceService`,
 * which takes `HARDENING`), field by field, so that the runner's hardening is not written a second time (test T8). The
 * one difference: 3.1's service is on the sandbox's `front` network; here the runner shares the forwarder's network
 * namespace, which is on the copy's `<project>_front` alone. `profiles` is Compose's own and has no `docker run` flag.
 */
export function runnerRunArgs(o: RunnerArgsInput): string[] {
  const svc = acceptanceService({ acceptance: { image: o.image ?? RUNNER_IMAGE, baseUrl: o.appUrl } }, hardeningFields()) as AcceptanceDefinition | null;
  if (!svc) throw new Error("Package 3.1's acceptance service could not be read.");
  if (svc.entrypoint.length !== 0) throw new Error("Package 3.1's acceptance service names an entrypoint; the check maps only an empty one.");
  return [
    "run",
    "--rm",
    "--name",
    o.container,
    "--pull",
    svc.pull_policy,
    ...svc.cap_drop.flatMap((x) => ["--cap-drop", x]),
    ...svc.security_opt.flatMap((x) => ["--security-opt", x]),
    "--pids-limit",
    String(svc.pids_limit),
    "--memory",
    svc.mem_limit,
    ...(svc.read_only ? ["--read-only"] : []),
    ...svc.tmpfs.flatMap((t) => ["--tmpfs", t]),
    "--user",
    svc.user,
    "--entrypoint",
    "",
    "--workdir",
    svc.working_dir,
    ...Object.entries(svc.environment).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
    "--env",
    `RUN_ID=${o.runId}`,
    "--network",
    `container:${o.forwarder}`,
    "--mount",
    `type=bind,source=${mountPath(o.versionDir, "the version's folder")},target=${RUNNER_MOUNT_TARGETS.tests},readonly`,
    "--mount",
    `type=bind,source=${mountPath(o.resultsDir, "the results folder")},target=${RUNNER_MOUNT_TARGETS.results}`,
    "--mount",
    `type=volume,source=${o.keysVolume},target=${RUNNER_MOUNT_TARGETS.samplePassword},readonly,volume-subpath=sample_password`,
    svc.image,
    ...RUNNER_COMMAND,
  ];
}

/**
 * The forwarder's fixed code: listen on the container's own 127.0.0.1 at the port given first, and pass every
 * connection, unread, to `app` at the port given second, on the project's `front` network (measured, design section 3).
 */
export const FORWARD_SCRIPT =
  "const n=require('net'),p=Number(process.argv[1]),t=Number(process.argv[2]);" +
  "n.createServer((c)=>{const s=n.connect(t,'app');c.pipe(s);s.pipe(c);s.on('error',()=>c.destroy());c.on('error',()=>s.destroy())}).listen(p,'127.0.0.1')";

/** Ask one address for a page and print its HTTP status, or what failed, as one line of JSON (as the sandbox's `askApp`). */
export const ASK_SCRIPT =
  "fetch(process.argv[1],{redirect:'manual',signal:AbortSignal.timeout(10000)})" +
  ".then(async(r)=>{await r.arrayBuffer().catch(()=>{});console.log(JSON.stringify({status:r.status}))})" +
  ".catch((e)=>console.log(JSON.stringify({error:String((e.cause&&e.cause.code)||e.name||e.message)})))";

/** A short-lived or detached container of the approved Node image: the hardening, a read-only root, a small /tmp, user `node`, no mount. */
function nodeContainerArgs(o: { name: string; network: string; detach?: boolean; script: string; args: string[] }): string[] {
  return [
    "run",
    o.detach ? "--detach" : "--rm",
    "--name",
    o.name,
    "--pull",
    "never",
    "--network",
    o.network,
    ...hardeningFlags(),
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=16m",
    "--user",
    "node",
    "--entrypoint",
    "node",
    DEFAULT_IMAGES.node,
    "-e",
    o.script,
    ...o.args,
  ];
}

/** Item 5: the forwarder's `docker run` arguments (detached; removed by its exact name afterwards). */
export function forwarderRunArgs(o: { name: string; network: string; listenPort: number; appPort: number }): string[] {
  return nodeContainerArgs({ name: o.name, network: o.network, detach: true, script: FORWARD_SCRIPT, args: [String(o.listenPort), String(o.appPort)] });
}

/** What the check found about the app, when it found it. */
export interface CopyApp {
  project: string;
  service: "app";
  container: string;
  containerId: string;
  workingDir: string;
  configFiles: string;
  imageName: string;
  imageId: string;
  appUrl: string;
  /** The app's own port inside its container (its PORT setting). */
  appPort: number;
  /** The port of APP_URL, on which the forwarder listens. */
  listenPort: number;
  front: string;
  keysVolume: string;
  door: string[];
}

export interface CopyCheckReport {
  runId: string;
  projectId: string;
  version: string;
  /** The manifest's SHA-256 as found in the copy, when the manifest could be read. */
  manifestSha256: string | null;
  label: string;
  /** Why the run was refused before its start, if it was. */
  refused: string | null;
  appAnswered: true | string;
  app: CopyApp | null;
  forwarder: { name: string; args: string[] } | null;
  runner: { name: string; args: string[] } | null;
  exit: { code: number | null; timedOut: boolean } | null;
  reading: RunReading;
  /** What the runner printed (Playwright's line reporter). */
  output: string[];
  /** Item 8: the copy's files and `git status --porcelain --ignored`, before the check began and after it. */
  copy: { files: number; unchanged: boolean; changes: string[] };
  /** Null when no forwarder was started. */
  forwarderRemoved: boolean | null;
  /** What was found after the run: a forwarder left, the copy changed. */
  afterProblems: string[];
  /** The reading passed, and nothing was found after it. */
  passed: boolean;
}

export interface CopyCheckInput extends CopyCheckArgs {
  runId?: string;
  timeoutMs?: number;
  /** Called once the runner's container has been asked for (the evidence and test L3c inspect it while it runs). */
  onStarted?: (s: { runner: string; forwarder: string; done: Promise<unknown> }) => void;
  /** Each line the runner prints. */
  onLine?: (line: string) => void;
}

/** A plain file, read without following a link, within a size limit; null if it is not one. */
function plainFile(path: string, max = 256 * 1024): Buffer | null {
  const st = lstatSync(path, { throwIfNoEntry: false });
  if (!st?.isFile() || st.size > max) return null;
  return readFileSync(path);
}

/** Every entry under the copy's folder, its own history included, by relative path: a file's SHA-256, a link's target. */
export function copyFingerprints(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      const full = join(dir, p);
      const st = lstatSync(full);
      if (st.isDirectory()) {
        out.set(p, "folder");
        walk(p);
      } else if (st.isFile()) out.set(p, `file ${sha256(readFileSync(full))}`);
      else if (st.isSymbolicLink()) out.set(p, `link ${readlinkSync(full)}`);
      else out.set(p, "other");
    }
  };
  walk("");
  return out;
}

/** `git status --porcelain --ignored` in the copy, without taking the index's lock or writing it, and with no hook. */
async function gitStatus(dir: string): Promise<string> {
  const env = { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME ?? "/root", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
  try {
    const { stdout } = await run("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "status", "--porcelain", "--ignored"], { cwd: dir, env, maxBuffer: 8 * 1024 * 1024, timeout: 120_000 });
    return stdout;
  } catch (err) {
    return `git status could not run: ${(err as Error).message.split("\n")[0]}`;
  }
}

/** The environment of every Docker command here: PATH, HOME, the settings that name the daemon, and an empty client folder of the run's own. */
function dockerEnvFor(clientDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME ?? "/root", DOCKER_CONFIG: clientDir };
  for (const k of DOCKER_DAEMON_SETTINGS) if (process.env[k]) env[k] = process.env[k];
  return env;
}

interface Inspected {
  Id: string;
  Name?: string;
  Image?: string;
  Config?: { Labels?: Record<string, string> | null; Env?: string[] | null; User?: string };
  State?: { Status?: string; Health?: { Status?: string } | null };
  NetworkSettings?: { Networks?: Record<string, unknown> | null };
}

/** Compose's name for a project in a folder, when no name is given: the folder's name, in lower case, with only letters, digits, _ and -. */
export function composeNameOf(folder: string): string {
  return basename(folder)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

const same = (a: string | undefined, b: string) => {
  if (!a) return false;
  try {
    return realpathSync(a) === b;
  } catch {
    return false;
  }
};

/** Item 4: the app the copy's own command started, or why not. Reads Docker only. */
async function findApp(env: NodeJS.ProcessEnv, copyReal: string): Promise<CopyApp | string> {
  const docker = async (args: string[]) => (await run("docker", args, { env, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 })).stdout;
  const ids = (await docker(["ps", "--all", "--no-trunc", "--quiet", "--filter", "label=com.docker.compose.service=app"])).split("\n").filter(Boolean);
  const all = ids.length ? (JSON.parse(await docker(["inspect", ...ids])) as Inspected[]) : [];
  const mine = all.filter((c) => c.Config?.Labels?.["com.docker.compose.oneoff"] !== "True" && same(c.Config?.Labels?.["com.docker.compose.project.working_dir"], copyReal));
  if (mine.length === 0)
    return `no app container was started from this copy: of the ${all.length} containers of a Compose service named app on this machine, none has ${copyReal} as its project's working folder (start the copy with its README's command first)`;
  if (mine.length > 1) return `${mine.length} app containers name this copy's folder as their project's working folder; exactly one is needed`;
  const c = mine[0]!;
  const labels = c.Config?.Labels ?? {};
  const project = labels["com.docker.compose.project"] ?? "";
  const container = (c.Name ?? "").replace(/^\//, "");
  if (project !== composeNameOf(copyReal)) return `the app container ${container} belongs to the Compose project "${project}", not "${composeNameOf(copyReal)}", the name the README's command gives a copy in this folder`;
  const configFiles = labels["com.docker.compose.project.config_files"] ?? "";
  if (configFiles !== join(labels["com.docker.compose.project.working_dir"]!, "compose.yaml"))
    return `the app container ${container} was started from ${configFiles || "no file Compose recorded"}, not from the copy's compose.yaml alone`;
  if (c.State?.Status !== "running" || c.State.Health?.Status !== "healthy") return `the app container ${container} is ${c.State?.Status ?? "in no state"}${c.State?.Health?.Status ? ` (${c.State.Health.Status})` : ""}, not running and healthy`;
  const imageName = `${project}-app`;
  let image: Inspected;
  try {
    image = (JSON.parse(await docker(["image", "inspect", imageName])) as Inspected[])[0]!;
  } catch {
    return `there is no image named ${imageName}, the image Compose builds from the copy for its app`;
  }
  if (c.Image !== image.Id) return `the app container's image is not the image named ${imageName}, which Compose built from the copy (the container runs ${c.Image}; ${imageName} is ${image.Id})`;
  const il = image.Config?.Labels ?? {};
  if (il["com.docker.compose.project"] !== project || il["com.docker.compose.service"] !== "app") return `the image ${imageName} was not built by Compose for this project's app`;
  const env0 = new Map((c.Config?.Env ?? []).map((e) => [e.slice(0, e.indexOf("=")), e.slice(e.indexOf("=") + 1)] as const));
  const appUrl = env0.get("APP_URL") ?? "";
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    return `the app container's APP_URL (${appUrl || "not set"}) is not an address`;
  }
  const listenPort = Number(url.port);
  if (url.protocol !== "http:" || url.hostname !== "localhost" || !/^[0-9]{1,5}$/.test(url.port) || listenPort < 1 || listenPort > 65535 || url.username || url.password || url.pathname !== "/" || url.search || url.hash || appUrl !== `http://localhost:${listenPort}`)
    return `the app container's APP_URL (${appUrl}) is not http://localhost:<port>, the address the copy's compose.yaml gives it`;
  const appPort = Number(env0.get("PORT") ?? "");
  if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65535) return "the app container's PORT setting is not a port";
  const front = `${project}_front`;
  const frontProblem = await frontProblems(env, front, project, copyReal, [c.Id], []);
  if (typeof frontProblem === "string") return frontProblem;
  const keysVolume = `${project}_keys`;
  try {
    const v = (JSON.parse(await docker(["volume", "inspect", keysVolume])) as Array<{ Labels?: Record<string, string> | null }>)[0]!;
    if (v.Labels?.["com.docker.compose.project"] !== project || v.Labels?.["com.docker.compose.volume"] !== "keys") return `the volume ${keysVolume} is not the project's keys volume`;
  } catch {
    return `there is no volume named ${keysVolume}, where the copy's start keeps the sample password`;
  }
  return { project, service: "app", container, containerId: c.Id, workingDir: labels["com.docker.compose.project.working_dir"]!, configFiles, imageName, imageId: image.Id, appUrl, appPort, listenPort, front, keysVolume, door: frontProblem.door };
}

/**
 * The project's `front` network: the project's, internal, in the isolated gateway mode; and on it no container but the
 * app, the project's door (a container of the service `door` started from this copy) and `ours` (the check's own).
 */
async function frontProblems(env: NodeJS.ProcessEnv, front: string, project: string, copyReal: string, appIds: string[], ours: string[]): Promise<{ door: string[] } | string> {
  const docker = async (args: string[]) => (await run("docker", args, { env, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 })).stdout;
  let net: { Internal?: boolean; Options?: Record<string, string> | null; Labels?: Record<string, string> | null; Containers?: Record<string, { Name?: string }> | null };
  try {
    net = (JSON.parse(await docker(["network", "inspect", front])) as (typeof net)[])[0]!;
  } catch {
    return `there is no network named ${front}, the copy's front network`;
  }
  if (net.Labels?.["com.docker.compose.project"] !== project || net.Labels?.["com.docker.compose.network"] !== "front") return `the network ${front} is not the project's front network`;
  if (net.Internal !== true || net.Options?.["com.docker.network.bridge.gateway_mode_ipv4"] !== "isolated") return `the network ${front} is not internal in the isolated gateway mode, as the copy's compose.yaml makes it`;
  const door: string[] = [];
  const others: string[] = [];
  const onIt = Object.entries(net.Containers ?? {});
  const unknown = onIt.filter(([id]) => !appIds.includes(id) && !ours.includes(id));
  const inspected = unknown.length ? (JSON.parse(await docker(["inspect", ...unknown.map(([id]) => id)])) as Inspected[]) : [];
  for (const [id, c] of unknown) {
    const i = inspected.find((x) => x.Id === id);
    const l = i?.Config?.Labels ?? {};
    const name = c.Name ?? id.slice(0, 12);
    if (l["com.docker.compose.project"] === project && l["com.docker.compose.service"] === "door" && l["com.docker.compose.oneoff"] !== "True" && same(l["com.docker.compose.project.working_dir"], copyReal)) door.push(name);
    else others.push(name);
  }
  if (others.length) return `${others.join(", ")} ${others.length > 1 ? "are" : "is"} on ${front}, where nothing but the project's app and door${ours.length ? " and the check's forwarder" : ""} may be`;
  if (!onIt.some(([id]) => appIds.includes(id))) return `the app container is not on ${front}`;
  return { door };
}

/** Ask an address from a short-lived approved Node container on `network`; its HTTP status, or what failed. */
async function ask(env: NodeJS.ProcessEnv, name: string, network: string, url: string): Promise<{ status: number } | { error: string }> {
  try {
    const { stdout } = await run("docker", nodeContainerArgs({ name, network, script: ASK_SCRIPT, args: [url] }), { env, maxBuffer: 1024 * 1024, timeout: 120_000 });
    const r = JSON.parse(stdout.trim().split("\n").pop() ?? "") as { status?: unknown; error?: unknown };
    if (typeof r.status === "number") return { status: r.status };
    return { error: String(r.error ?? "no answer") };
  } catch (err) {
    return { error: `the asking container did not run (${(err as Error).message.split("\n")[0]})` };
  }
}

/** Run the check from the exported copy (see the top of this file). */
export async function checkFromCopy(i: CopyCheckInput): Promise<CopyCheckReport> {
  // The copy and the run folder, before anything else. A run folder that cannot be made is not a refusal: nothing could
  // be recorded, so it throws.
  checkProjectId(i.projectId);
  if (!VERSION.test(i.version)) throw new Error(`"${i.version}" is not a version name.`);
  if (!Number.isInteger(i.checklistItems) || i.checklistItems < 1) throw new Error("The checklist count must be a whole number of at least 1.");
  if (!isAbsolute(i.copyDir) || !lstatSync(i.copyDir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`The copy folder ${i.copyDir} is not a folder (a link is not accepted).`);
  const copyReal = realpathSync(i.copyDir);
  if (!isAbsolute(i.runFolder)) throw new Error(`The run folder ${i.runFolder} must be an absolute path.`);
  if (lstatSync(i.runFolder, { throwIfNoEntry: false })) throw new Error(`The run folder ${i.runFolder} exists; the check needs a fresh one.`);
  const parentReal = realpathSync(dirname(i.runFolder));
  const runReal = join(parentReal, basename(i.runFolder));
  if (insideOrEqual(runReal, copyReal)) throw new Error("The run folder must be outside the copy.");
  if (insideOrEqual(runReal, realpathSync(REPO_ROOT))) throw new Error("The run folder must be outside the repository (its results hold the sample password in the trace: known gap 72).");
  mkdirSync(runReal, { mode: 0o700 });
  const results = join(runReal, "results");
  const clientDir = join(runReal, "docker-client");
  mkdirSync(results, { mode: 0o700 });
  mkdirSync(clientDir, { mode: 0o700 });
  writeFileSync(join(clientDir, "config.json"), "{}\n", { mode: 0o600 });
  const env = dockerEnvFor(clientDir);
  const docker = async (args: string[], timeout = 120_000) => (await run("docker", args, { env, maxBuffer: 32 * 1024 * 1024, timeout })).stdout;

  const runId = i.runId ?? newRunId();
  const tag = randomBytes(4).toString("hex");
  const copyBefore = copyFingerprints(copyReal);
  const statusBefore = await gitStatus(copyReal);
  const output: string[] = [];
  let refused: string | null = null;
  let appAnswered: true | string = "not checked: the run was refused before this check";
  let app: CopyApp | null = null;
  let forwarder: { name: string; args: string[] } | null = null;
  let runner: { name: string; args: string[] } | null = null;
  let exit: { code: number | null; timedOut: boolean } | null = null;
  const versionDir = join(copyReal, "acceptance", i.version);

  // 1. The version (S25).
  const acceptanceSt = lstatSync(join(copyReal, "acceptance"), { throwIfNoEntry: false });
  const check = acceptanceSt?.isDirectory() ? verifyVersionAt(versionDir, i.projectId, i.version) : { ok: false, problems: ["the copy has no acceptance folder (a link is not accepted)"], dir: versionDir };
  if (!check.ok) refused = `the version does not match its manifest: ${check.problems.join("; ")}`;
  const manifestSha256 = "manifestSha256" in check ? (check.manifestSha256 ?? null) : null;
  // 2. The fingerprint: the one given (from the export's event) and the one acceptance/README.txt records.
  if (!refused) {
    const readme = plainFile(join(copyReal, "acceptance", "README.txt"));
    const recorded = readme ? /^Its manifest's SHA-256 when copied: ([0-9a-f]{64})\.$/m.exec(readme.toString("utf8"))?.[1] : undefined;
    if (manifestSha256 !== i.manifestSha256) refused = `the manifest's SHA-256 (${manifestSha256}) is not the one the export's event records (${i.manifestSha256})`;
    else if (recorded !== manifestSha256) refused = `acceptance/README.txt does not record the manifest's SHA-256 (${recorded ? `it records ${recorded}` : "no SHA-256 found"})`;
  }
  // 3. The runner image.
  if (!refused) {
    const problem = await runnerImageProblem(RUNNER_IMAGE, env);
    if (problem) refused = `the runner cannot start: ${problem}`;
  }
  // 4. The right app (S26).
  if (!refused) {
    try {
      const found = await findApp(env, copyReal);
      if (typeof found === "string") refused = `the app is not the one this copy started: ${found}`;
      else app = found;
    } catch (err) {
      refused = `Docker could not be asked about the copy's app (${(err as Error).message.split("\n")[0]})`;
    }
  }
  const forwarderName = app ? `${app.project}-${COPY_CHECK_PART}-forwarder-${tag}` : "";
  const askNames: string[] = [];
  let forwarderRemoved: boolean | null = null;
  try {
    if (!refused && app) {
      const a = `${app.project}-${COPY_CHECK_PART}-ask-${tag}`;
      askNames.push(a);
      const r = await ask(env, a, app.front, `http://app:${app.appPort}/en/sign-in`);
      if ("error" in r) appAnswered = `the app's address did not answer, asked from the project's front network (${r.error})`;
      else if (r.status !== 200) appAnswered = `the app's sign-in page answered ${r.status}`;
      else appAnswered = true;
      if (appAnswered !== true) refused = `the app did not answer before the start: ${appAnswered}`;
    }
    // 5. The forwarder (S27). No fallback: if it does not work, the run is refused and says why.
    if (!refused && app) {
      const args = forwarderRunArgs({ name: forwarderName, network: app.front, listenPort: app.listenPort, appPort: app.appPort });
      forwarder = { name: forwarderName, args: ["docker", ...args] };
      let fwdId = "";
      try {
        fwdId = (await docker(args)).trim();
      } catch (err) {
        refused = `the forwarder did not start (${(err as Error).message.split("\n")[0]}); there is no other way to the app`;
      }
      if (!refused) {
        const seen = (JSON.parse(await docker(["inspect", forwarderName])) as Inspected[])[0]!;
        const nets = Object.keys(seen.NetworkSettings?.Networks ?? {});
        if (nets.length !== 1 || nets[0] !== app.front) refused = `the forwarder is on ${nets.join(", ") || "no network"}, not on ${app.front} alone`;
      }
      if (!refused) {
        let last: { status: number } | { error: string } = { error: "not asked" };
        for (let n = 0; n < 20; n++) {
          const a = `${app.project}-${COPY_CHECK_PART}-ask-${tag}-${n}`;
          askNames.push(a);
          last = await ask(env, a, `container:${forwarderName}`, `${app.appUrl}/en/sign-in`);
          if ("status" in last && last.status === 200) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!("status" in last && last.status === 200)) refused = `the app did not answer through the forwarder at ${app.appUrl} (${"error" in last ? last.error : `HTTP ${last.status}`}); there is no other way to the app`;
      }
      if (!refused) {
        const f = await frontProblems(env, app.front, app.project, copyReal, [app.containerId], [fwdId]);
        if (typeof f === "string") refused = `before the runner started: ${f}`;
      }
    }
    // 6. The runner, as 3.1 runs it.
    if (!refused && app) {
      if (process.getuid?.() === 0) chownSync(results, RUNNER_UID, RUNNER_UID);
      else chmodSync(results, 0o777);
      const name = `${app.project}-${COPY_CHECK_PART}-runner-${tag}`;
      const args = runnerRunArgs({ container: name, forwarder: forwarderName, appUrl: app.appUrl, runId, versionDir, resultsDir: results, keysVolume: app.keysVolume });
      runner = { name, args: ["docker", ...args] };
      const child = spawn("docker", args, { env, stdio: ["ignore", "pipe", "pipe"] });
      createInterface({ input: child.stdout }).on("line", (l) => {
        output.push(l);
        i.onLine?.(l);
      });
      let stderrTail = "";
      child.stderr.on("data", (d: Buffer) => (stderrTail = (stderrTail + d.toString("utf8")).slice(-4000)));
      let timedOut = false;
      const done = new Promise<number | null>((ok) => {
        child.on("error", () => ok(null));
        child.on("close", (code) => ok(code));
      });
      const timer = setTimeout(() => {
        timedOut = true;
        void run("docker", ["kill", name], { env }).catch(() => undefined);
      }, i.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS);
      i.onStarted?.({ runner: name, forwarder: forwarderName, done });
      const code = await done;
      clearTimeout(timer);
      await run("docker", ["rm", "-f", name], { env }).catch(() => undefined);
      exit = { code, timedOut };
      if (code !== 0 && code !== 1 && stderrTail.trim()) output.push(`(the runner's container said: ${stderrTail.trim().split("\n").slice(-3).join(" / ")})`);
    }
  } finally {
    // 8. The forwarder, and any asking container left, removed by exact name.
    for (const a of askNames) await run("docker", ["rm", "-f", a], { env }).catch(() => undefined);
    if (forwarder) {
      await run("docker", ["rm", "-f", forwarderName], { env }).catch(() => undefined);
      forwarderRemoved = await run("docker", ["inspect", forwarderName], { env }).then(
        () => false,
        () => true,
      );
    }
  }

  // 7. The reading, unchanged, with the checklist count given (S31).
  const placeholder: VersionManifest = { version: i.version, project_id: i.projectId, written_by: "stand-in", written_by_note: "", written_at: "", app_spec_sha256: "", marker: "", items: [] };
  const reading = copyReading(i, {
    resultsDir: results,
    runId,
    manifest: ("manifest" in check ? check.manifest : undefined) ?? placeholder,
    manifestSha256: manifestSha256 ?? "",
    refused,
    appAnswered,
    exit,
  });

  // 8. The copy, as it was.
  const copyAfter = copyFingerprints(copyReal);
  const statusAfter = await gitStatus(copyReal);
  const changes: string[] = [];
  for (const [p, v] of copyAfter) if (copyBefore.get(p) !== v) changes.push(copyBefore.has(p) ? `${p} (changed)` : `${p} (added)`);
  for (const p of copyBefore.keys()) if (!copyAfter.has(p)) changes.push(`${p} (removed)`);
  if (statusAfter !== statusBefore) changes.push("git status --porcelain --ignored (changed)");
  const afterProblems: string[] = [];
  if (statusBefore.startsWith("git status could not run")) afterProblems.push(`the copy's git status could not be read, so its history was not compared: ${statusBefore}`);
  if (forwarderRemoved === false) afterProblems.push(`the forwarder ${forwarderName} could not be removed`);
  if (changes.length) afterProblems.push(`the copy changed during the check: ${changes.slice(0, 20).join(", ")}`);

  const report: CopyCheckReport = {
    runId,
    projectId: i.projectId,
    version: i.version,
    manifestSha256,
    label: COPY_CHECK_LABEL,
    refused,
    appAnswered,
    app,
    forwarder,
    runner,
    exit,
    reading,
    output,
    copy: { files: copyBefore.size, unchanged: changes.length === 0, changes },
    forwarderRemoved,
    afterProblems,
    passed: reading.outcome === "passed" && afterProblems.length === 0,
  };
  // The reading, kept in the run folder without Playwright's error texts, which go to files of their own.
  for (const it of reading.items) if (it.errorText) writeFileSync(join(runReal, `item-${String(it.number).padStart(2, "0")}-failure.txt`), it.errorText, { mode: 0o600 });
  writeFileSync(join(runReal, "check-reading.json"), JSON.stringify({ ...report, reading: { ...reading, items: reading.items.map(({ errorText: _e, ...rest }) => rest) } }, null, 2) + "\n", { mode: 0o600 });
  return report;
}
