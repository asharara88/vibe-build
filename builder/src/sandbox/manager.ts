/**
 * The sandbox manager: creates, starts and stops one isolated set of containers per project.
 *
 * Interface (design note, section 2.5): create project sandbox, start service, run command,
 * mount path, destroy. Plain Docker Compose sits behind it in Stage 1; gVisor's runtime or E2B
 * could replace it without the rest of the builder noticing.
 *
 * Two profiles:
 * - `server`: the project's containers share an internal Docker network with no route out.
 *   The egress proxy is attached to that network and to the outside, and is the only way out.
 * - `development-cloud-session`: every container except the engine shares the host's network. The
 *   image build runs on the host's network and is given the cloud session's proxy as build
 *   arguments; its certificate is copied into the build stage (`createSandbox`, `build`), so the
 *   tools image, which is that stage, holds a copy. The egress proxy is given the session proxy as
 *   its way out and has the certificate mounted. The app and tools containers are given no proxy
 *   setting, and the app container holds no copy of the certificate (seen in package 0.6a's run,
 *   12 Nov 2026). The session proxy is on the machine's own loopback address, which a container on
 *   Docker's default ("bridge") network could not reach (refused at the machine's address on that
 *   network, attempt G45887). It is not the machine's only way out: in the same run, requests sent
 *   with no proxy got answers, from the app and tools containers and from one on Docker's default
 *   network. On this profile the app and tools containers are not isolated from the machine
 *   (evidence/2026-11-12-package-0.6a/isolation-checks.md). Development only (known gaps 1, 2 and 60).
 * In both, the engine container of package 2.1 (the scripted engine) has no network at all.
 */
import { execFile, spawn } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const run = promisify(execFile);

export type SandboxProfile = "server" | "development-cloud-session";

export interface SandboxSpec {
  projectId: string;
  /** Directory that holds the project's compose file and workspace. */
  dir: string;
  profile: SandboxProfile;
  /** Hosts the project's containers may reach through the egress proxy (server profile). */
  allowHosts: string[];
  /** Where the engine's model calls go: the gateway's address as seen from the containers. */
  gatewayUrl: string;
  /** Pinned images. */
  images?: { postgres?: string; node?: string };
  /** Development profile only: the session proxy and its certificate on the host. */
  hostProxy?: { url: string; caBundlePath: string };
  /** Development profile only: the host port for the project's database (the host's own PostgreSQL uses 5432). */
  devDbPort?: number;
  /** Absolute path of the builder's own source, mounted read-only so the egress proxy can run from it. */
  builderDir: string;
  /** The app container, once the project has an app to run. */
  app?: {
    /** Build context: the project's workspace (the template plus the engine's changes). */
    buildContext: string;
    /** Port the app listens on inside the container (and on the host in the development profile). */
    port: number;
    /** Extra environment for the app. Secrets go through `secrets`, not here. */
    env?: Record<string, string>;
    /** Paths the app must be able to write at run time (everything else is read-only). */
    writablePaths?: string[];
    /**
     * Settings for the tools container (tables and sample users), besides DATABASE_URL and the
     * app's secrets file. Only what is named here reaches it: never the host's environment (package 0.5).
     */
    toolsEnv?: Record<string, string>;
  };
  /**
   * The engine container (package 2.1: the scripted engine). It exists only while a step runs. It
   * has no network, no settings file and no setting of its own, and sees three things: the workspace
   * (read-write), an empty folder over the workspace's `certs` folder (so the session certificate the
   * development build needs is not visible to it), and the scripted engine's change sets (read-only).
   * A step's protected paths are mounted read-only over themselves for each run (`runStreaming`).
   */
  engine?: {
    /** The project's workspace on the host, mounted read-write at /workspace. */
    workspace: string;
    /** The scripted engine's change sets on the host (builder/scripted), mounted read-only at /engine. */
    changeSets: string;
  };
}

export const DEFAULT_IMAGES = {
  postgres: "postgres:16-alpine",
  node: "node:22-alpine",
};

/** The hardening every project container gets. From Anthropic's secure-deployment guide, measured on 11 Nov 2026. */
export const HARDENING = {
  cap_drop: ["ALL"],
  security_opt: ["no-new-privileges:true"],
  pids_limit: 256,
  mem_limit: "1g",
  read_only: true,
};

export function composeProjectName(projectId: string): string {
  return `builder_${projectId.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
}

export function appImageName(projectId: string): string {
  return `${composeProjectName(projectId)}-app:latest`;
}

export function toolsImageName(projectId: string): string {
  return `${composeProjectName(projectId)}-tools:latest`;
}

/**
 * The tools service: the template image's `tools` stage, which has the development tools the app's
 * run-time image does not. It creates the tables and the sample users from inside the project's
 * sandbox, never from the machine that hosts the builder (package 0.5, known gap 29).
 *
 * Its environment is a named list: DATABASE_URL, the names in `toolsEnv`, and the names in the app's
 * secrets file. Every entry has a value written here, so no name is copied from the host's environment.
 * Compose still fills in `${NAME}` inside a value (DATABASE_URL's password, on purpose); it runs with the
 * narrow environment of `dockerEnv`, so that comes from the project's own .env file. It is under the
 * "tools" profile, so it starts only when it is run on purpose.
 */
function toolsService(spec: SandboxSpec, common: Record<string, unknown>, databaseUrl: string) {
  if (!spec.app) return null;
  return {
    image: toolsImageName(spec.projectId),
    pull_policy: "never",
    profiles: ["tools"],
    ...common,
    read_only: true,
    tmpfs: ["/tmp:rw,noexec,nosuid,size=64m"],
    env_file: ["./secrets/app.env"],
    environment: { DATABASE_URL: databaseUrl, ...(spec.app.toolsEnv ?? {}) },
  };
}

/** The empty folder mounted read-only over the workspace's `certs` folder in the engine container. */
export const engineEmptyDir = (sandboxDir: string) => join(sandboxDir, "engine-empty");

/** A bind mount in Compose's long form. A missing host path is an error, never created (`create_host_path: false`). */
const bindMount = (source: string, target: string, readOnly: boolean) => ({
  type: "bind",
  source,
  target,
  read_only: readOnly,
  bind: { create_host_path: false },
});

/**
 * The engine service (package 2.1). The same in both profiles: no network at all, because the
 * scripted engine calls no model and fetches nothing. The real engine (package 2.2) needs a route to
 * the gateway; its network is decided there, and what 3.1 shows from this container about the
 * network does not carry over to it (known gap 50). It runs as the unprivileged user `node`, with the
 * hardening every project container gets, a read-only root, a small `/tmp`, no settings file and no
 * environment entry, and without the base image's start-up script, which would add PWD and SHLVL.
 * Under the "engine" profile, so it starts only when a step is run on purpose; `up` refuses it.
 */
function engineService(spec: SandboxSpec, common: Record<string, unknown>, image: string) {
  if (!spec.engine) return null;
  return {
    image,
    profiles: ["engine"],
    ...common,
    read_only: true,
    tmpfs: ["/tmp:rw,noexec,nosuid,size=16m"],
    user: "node",
    network_mode: "none",
    entrypoint: [],
    working_dir: "/workspace",
    volumes: [
      bindMount(spec.engine.workspace, "/workspace", false),
      bindMount(engineEmptyDir(spec.dir), "/workspace/certs", true),
      bindMount(spec.engine.changeSets, "/engine", true),
    ],
  };
}

/** The app service shared by both profiles, before networking is added. */
function appService(spec: SandboxSpec, common: Record<string, unknown>, databaseUrl: string) {
  if (!spec.app) return null;
  const tmpfs = ["/tmp:rw,noexec,nosuid,size=64m", ...(spec.app.writablePaths ?? []).map((p) => `${p}:rw,nosuid,size=128m`)];
  return {
    // The image is built by `sandbox.build`, not by Compose: in development the build steps must
    // reach the session proxy on the host's loopback address, which needs `docker build --network host`.
    image: appImageName(spec.projectId),
    pull_policy: "never",
    ...common,
    read_only: true,
    tmpfs,
    env_file: ["./secrets/app.env"],
    environment: { PORT: String(spec.app.port), DATABASE_URL: databaseUrl, ...(spec.app.env ?? {}) },
    depends_on: { db: { condition: "service_healthy" } },
    healthcheck: {
      test: ["CMD-SHELL", `wget -q -O /dev/null http://127.0.0.1:${spec.app.port}/en/sign-in || exit 1`],
      interval: "3s",
      retries: 40,
      start_period: "10s",
    },
  };
}

/** Build the Compose document for a project. Returned as an object so tests can inspect it. */
export function composeDocument(spec: SandboxSpec): Record<string, unknown> {
  const images = { ...DEFAULT_IMAGES, ...spec.images };
  const common = {
    cap_drop: HARDENING.cap_drop,
    security_opt: HARDENING.security_opt,
    pids_limit: HARDENING.pids_limit,
    mem_limit: HARDENING.mem_limit,
  };
  const dbEnv = { POSTGRES_USER: "app", POSTGRES_PASSWORD_FILE: "/run/secrets/db_password", POSTGRES_DB: "app" };
  // The official PostgreSQL image starts as root to prepare its data directory and then drops to
  // the postgres user. With every capability dropped it cannot do that, so it gets back the five it
  // needs for that step and nothing else.
  const dbCaps = { cap_add: ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"] };

  if (spec.profile === "server") {
    const app = appService(spec, common, "postgres://app:${DB_PASSWORD}@db:5432/app");
    const tools = toolsService(spec, common, "postgres://app:${DB_PASSWORD}@db:5432/app");
    const engine = engineService(spec, common, images.node);
    return {
      name: composeProjectName(spec.projectId),
      networks: { internal: { internal: true }, egress: {} },
      secrets: { db_password: { file: "./secrets/db_password" } },
      volumes: { dbdata: {} },
      services: {
        ...(app ? { app: { ...app, networks: ["internal"] } } : {}),
        ...(tools ? { tools: { ...tools, networks: ["internal"] } } : {}),
        ...(engine ? { engine } : {}),
        db: {
          image: images.postgres,
          ...common,
          ...dbCaps,
          read_only: false,
          environment: dbEnv,
          secrets: ["db_password"],
          volumes: ["dbdata:/var/lib/postgresql/data"],
          networks: ["internal"],
          healthcheck: { test: ["CMD-SHELL", "pg_isready -U app -d app"], interval: "2s", retries: 30 },
        },
        egress: {
          image: images.node,
          ...common,
          read_only: true,
          tmpfs: ["/tmp:rw,noexec,nosuid,size=32m"],
          user: "node",
          working_dir: "/builder",
          command: ["node", "--import", "tsx", "src/sandbox/egress-main.ts"],
          environment: {
            EGRESS_ALLOW: spec.allowHosts.join(","),
            EGRESS_PORT: "3128",
          },
          volumes: [`${spec.builderDir}:/builder:ro`],
          networks: ["internal", "egress"],
        },
      },
    };
  }

  // development-cloud-session: the host's network for every service but the engine; the session proxy
  // and its certificate for the egress proxy only (and for the image build, in createSandbox).
  if (!spec.hostProxy) throw new Error("The development profile needs the host proxy URL and certificate path.");
  const devPort = spec.devDbPort ?? 5433;
  const app = appService(spec, common, `postgres://app:\${DB_PASSWORD}@127.0.0.1:${devPort}/app`);
  // The tools container is given no proxy setting: it needs the project's database and nothing else.
  const tools = toolsService(spec, common, `postgres://app:\${DB_PASSWORD}@127.0.0.1:${devPort}/app`);
  // The engine is the one project container without the host's network on this profile: it needs none.
  const engine = engineService(spec, common, images.node);
  return {
    name: composeProjectName(spec.projectId),
    secrets: { db_password: { file: "./secrets/db_password" } },
    volumes: { dbdata: {} },
    services: {
      ...(app ? { app: { ...app, network_mode: "host" } } : {}),
      ...(tools ? { tools: { ...tools, network_mode: "host" } } : {}),
      ...(engine ? { engine } : {}),
      db: {
        image: images.postgres,
        ...common,
        ...dbCaps,
        read_only: false,
        network_mode: "host",
        environment: { ...dbEnv, PGPORT: String(devPort) },
        secrets: ["db_password"],
        volumes: ["dbdata:/var/lib/postgresql/data"],
        healthcheck: { test: ["CMD-SHELL", `pg_isready -U app -d app -p ${devPort}`], interval: "2s", retries: 30 },
      },
      egress: {
        image: images.node,
        ...common,
        read_only: true,
        tmpfs: ["/tmp:rw,noexec,nosuid,size=32m"],
        user: "node",
        network_mode: "host",
        working_dir: "/builder",
        command: ["node", "--import", "tsx", "src/sandbox/egress-main.ts"],
        environment: {
          EGRESS_ALLOW: spec.allowHosts.join(","),
          EGRESS_PORT: "3128",
          EGRESS_UPSTREAM_PROXY: spec.hostProxy.url,
          NODE_EXTRA_CA_CERTS: "/certs/session-ca.crt",
        },
        volumes: [`${spec.builderDir}:/builder:ro`, `${spec.hostProxy.caBundlePath}:/certs/session-ca.crt:ro`],
      },
    },
  };
}

/** Minimal YAML writer for the plain objects, arrays and scalars Compose needs. */
export function toYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]\n`;
    return value.map((v) => (isScalar(v) ? `${pad}- ${scalar(v)}\n` : `${pad}-\n${toYaml(v, indent + 2)}`)).join("");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${pad}{}\n`;
    return entries
      .map(([k, v]) => {
        if (isScalar(v)) return `${pad}${k}: ${scalar(v)}\n`;
        if ((Array.isArray(v) && v.length === 0) || (typeof v === "object" && v && Object.keys(v).length === 0))
          return `${pad}${k}: ${Array.isArray(v) ? "[]" : "{}"}\n`;
        return `${pad}${k}:\n${toYaml(v, indent + 2)}`;
      })
      .join("");
  }
  return `${pad}${scalar(value)}\n`;
}
const isScalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
const scalar = (v: unknown) => (typeof v === "string" ? JSON.stringify(v) : String(v));

export interface Sandbox {
  dir: string;
  composeFile: string;
  projectName: string;
  /** How to build the app image and the tools image, when the project has an app. */
  appBuild?: { context: string; image: string; toolsImage: string; hostNetwork: boolean; args: Record<string, string> };
  /** The names, and only the names, of the settings the tools container is given. */
  toolsEnvNames?: string[];
}

/**
 * Write the compose file and the secrets. Does not start anything.
 * `appSecrets` are environment variables the app reads (AUTH_SECRET, APP_SAMPLE_PASSWORD, ...);
 * they are written to secrets/app.env with owner-only permissions, never into the compose file.
 */
export function createSandbox(spec: SandboxSpec, dbPassword: string, appSecrets: Record<string, string> = {}): Sandbox {
  mkdirSync(join(spec.dir, "secrets"), { recursive: true });
  mkdirSync(join(spec.dir, "workspace"), { recursive: true });
  // The project's own Docker client folder: nothing in it but where to find the user's CLI plugins (see dockerEnv).
  const client = join(spec.dir, "docker-client");
  mkdirSync(client, { recursive: true, mode: 0o700 });
  const user = userDockerClient();
  const projectPlugins = join(client, "cli-plugins");
  let linked = false;
  try {
    lstatSync(projectPlugins);
    linked = true;
  } catch {
    /* nothing there yet */
  }
  if (linked && !existsSync(projectPlugins)) {
    unlinkSync(projectPlugins); // a link to a folder that has since gone
    linked = false;
  }
  if (!linked && existsSync(join(user.dir, "cli-plugins"))) symlinkSync(join(user.dir, "cli-plugins"), projectPlugins);
  // Only the list of extra plugin folders is carried over from the user's configuration: never its
  // proxies, sign-ins or anything else.
  writeFileSync(join(client, "config.json"), JSON.stringify(user.pluginDirs.length ? { cliPluginsExtraDirs: user.pluginDirs } : {}) + "\n", { mode: 0o600 });
  writeFileSync(join(spec.dir, "secrets", "db_password"), dbPassword, { mode: 0o600 });
  // DB_PASSWORD is interpolated by Compose into DATABASE_URL from the project's own .env file.
  writeFileSync(join(spec.dir, ".env"), `DB_PASSWORD=${dbPassword}\n`, { mode: 0o600 });
  const appEnv = Object.entries(appSecrets)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  writeFileSync(join(spec.dir, "secrets", "app.env"), appEnv + "\n", { mode: 0o600 });
  if (spec.app && spec.hostProxy) {
    // The development build needs the session certificate inside the build context.
    mkdirSync(join(spec.app.buildContext, "certs"), { recursive: true });
    copyFileSync(spec.hostProxy.caBundlePath, join(spec.app.buildContext, "certs", "session-ca.crt"));
  }
  // The engine sees this empty folder in place of the workspace's certs folder (package 2.1).
  if (spec.engine) mkdirSync(engineEmptyDir(spec.dir), { recursive: true, mode: 0o755 });
  const composeFile = join(spec.dir, "compose.yaml");
  writeFileSync(composeFile, toYaml(composeDocument(spec)));
  const appBuild = spec.app
    ? {
        context: spec.app.buildContext,
        image: appImageName(spec.projectId),
        toolsImage: toolsImageName(spec.projectId),
        hostNetwork: Boolean(spec.hostProxy),
        args: (spec.hostProxy
          ? { HTTPS_PROXY: spec.hostProxy.url, HTTP_PROXY: spec.hostProxy.url, NODE_EXTRA_CA_CERTS: "/certs/session-ca.crt" }
          : {}) as Record<string, string>,
      }
    : undefined;
  const toolsEnvNames = spec.app
    ? [...new Set(["DATABASE_URL", ...Object.keys(spec.app.toolsEnv ?? {}), ...Object.keys(appSecrets)])].sort()
    : undefined;
  return { dir: spec.dir, composeFile, projectName: composeProjectName(spec.projectId), appBuild, toolsEnvNames };
}

/** Settings that only say which Docker daemon to talk to. Passed on, so every command reaches the same daemon. */
export const DOCKER_DAEMON_SETTINGS = ["DOCKER_HOST", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"] as const;

/**
 * The user's own Docker client folder, and the two things the sandbox reads from its configuration:
 * the extra plugin folders it names, and the Docker context it has chosen, if any. Nothing else in
 * it (proxies, registry sign-ins) is read or used.
 */
export function userDockerClient(): { dir: string; pluginDirs: string[]; context: string | null } {
  // An empty DOCKER_CONFIG is treated as not set.
  const dir = process.env.DOCKER_CONFIG || join(process.env.HOME ?? homedir(), ".docker");
  let pluginDirs: string[] = [];
  let context: string | null = null;
  try {
    const cfg = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as { cliPluginsExtraDirs?: unknown; currentContext?: unknown };
    if (Array.isArray(cfg.cliPluginsExtraDirs)) pluginDirs = cfg.cliPluginsExtraDirs.filter((d): d is string => typeof d === "string");
    if (typeof cfg.currentContext === "string" && cfg.currentContext !== "" && cfg.currentContext !== "default") context = cfg.currentContext;
  } catch {
    /* no configuration, or not readable: nothing to carry over */
  }
  return { dir, pluginDirs, context };
}

/**
 * The environment every Docker command of a sandbox runs with: PATH, HOME, the settings that name the
 * Docker daemon, and DOCKER_CONFIG pointed at the project's own Docker client folder, which holds only
 * where to find plugins. Nothing else of the builder's process is there for Compose to copy into a
 * container. The client folder is the project's own because Docker's client configuration can itself
 * add settings to every container (its `proxies` entry adds proxy settings). The user's plugin folder is
 * linked into it, and the extra plugin folders the user's configuration names are copied into its
 * configuration, so that `docker compose` and `docker buildx` are still found. Registry sign-ins in the
 * user's configuration are not used (known gap 5).
 * The sandbox's commands reach the daemon DOCKER_HOST names, or the default one. So that the user's own
 * Docker commands reach the same daemon, these are refused: DOCKER_CONTEXT naming any context but
 * `default`; and, when DOCKER_HOST is not set, a context other than `default` chosen in the user's
 * configuration, which is where `docker context use` records it. When DOCKER_HOST is set, Docker uses it
 * over that choice. Both measured: evidence/2026-11-12-package-0.5/measure-docker-behaviours.sh, item 7.
 */
export function dockerEnv(sb: Pick<Sandbox, "dir">): NodeJS.ProcessEnv {
  if (process.env.DOCKER_CONTEXT && process.env.DOCKER_CONTEXT !== "default") {
    throw new Error(
      "The sandbox names its Docker daemon with DOCKER_HOST; a Docker context chosen with DOCKER_CONTEXT is not supported. Unset DOCKER_CONTEXT, and set DOCKER_HOST if the daemon is not the default one.",
    );
  }
  if (!process.env.DOCKER_HOST && userDockerClient().context) {
    throw new Error(
      "The sandbox names its Docker daemon with DOCKER_HOST; the Docker context chosen in your Docker configuration (with `docker context use`) is not supported. Run `docker context use default`, or set DOCKER_HOST.",
    );
  }
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? homedir(),
    DOCKER_CONFIG: join(sb.dir, "docker-client"),
  };
  for (const k of DOCKER_DAEMON_SETTINGS) if (process.env[k]) env[k] = process.env[k];
  return env;
}

/**
 * The profiles of the services that run one command at a time: tools (package 0.5) and engine
 * (package 2.1). They are named on every command but `up`, so that such a container is seen, and
 * removed with the rest, while `up` never starts one.
 */
const ONE_OFF_PROFILES = ["--profile", "tools", "--profile", "engine"];

async function compose(sb: Sandbox, args: string[], timeoutMs = 180_000, withOneOff = true): Promise<string> {
  const profile = withOneOff ? ONE_OFF_PROFILES : [];
  const { stdout } = await run("docker", ["compose", "-f", sb.composeFile, ...profile, ...args], {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env: dockerEnv(sb),
  });
  return stdout;
}

/** How a streaming run ended (package 2.1). */
export interface StreamingEnd {
  /** The command's exit code; null if it ended by a signal. */
  code: number | null;
  /** The end of what it printed on stderr. */
  stderrTail: string;
  /** True if the run was killed because it went past its time limit. */
  timedOut?: boolean;
  /** Set if the line handler threw: the first error's message. The run was killed when it happened. */
  handlerError?: string;
}

/** A command running in a one-off container, read line by line as it prints (package 2.1). */
export interface StreamingRun {
  /** The container's name, given with `--name`, so that it can be killed by name. */
  container: string;
  /** Settles when the command has ended. It never rejects. */
  done: Promise<StreamingEnd>;
  /** Kill the container, wait for the command to end, and remove the container if anything is left. */
  kill: () => Promise<void>;
}

export interface StreamingOptions {
  /** The container's name. Letters, digits, `_`, `.` and `-`, starting with a letter or digit. */
  container: string;
  /**
   * Called once for each line the command prints on stdout, as it is printed. If it throws, the run
   * is killed, no further line is handed on, and `done` carries the error (`handlerError`).
   */
  onLine: (line: string) => void;
  /** Extra bind mounts for this run only, in `source:target[:ro]` form. Each source must already exist. */
  volumes?: string[];
  /** The container is killed after this long, and `done` says so (`timedOut`). Default ten minutes. */
  timeoutMs?: number;
}

const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait for `p`, or for `ms` at most; the timer is cleared either way, so nothing is left waiting. */
async function waitAtMost(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([p, new Promise((r) => (timer = setTimeout(r, ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a command in a fresh container of a service, as `runOnce` does, but read its output line by
 * line while it runs and keep a handle that can kill it (package 2.1). `runOnce` waits for the end.
 */
function runStreaming(sb: Sandbox, service: string, cmd: string[], opts: StreamingOptions): StreamingRun {
  if (!CONTAINER_NAME.test(opts.container)) throw new Error(`"${opts.container}" is not a container name Docker accepts.`);
  for (const v of opts.volumes ?? []) {
    const source = v.split(":")[0] ?? "";
    // The short form of a mount would create a missing source as an empty folder owned by root.
    if (!source.startsWith("/") || !existsSync(source)) throw new Error(`The mount source "${source}" does not exist; nothing is created for it.`);
  }
  const env = dockerEnv(sb);
  const args = ["compose", "-f", sb.composeFile, ...ONE_OFF_PROFILES, "run", "--rm", "--no-deps", "-T", "--name", opts.container];
  for (const v of opts.volumes ?? []) args.push("--volume", v);
  args.push(service, ...cmd);
  const child = spawn("docker", args, { env, stdio: ["ignore", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  let timedOut = false;
  let handlerError: string | undefined;
  // A handler that throws must not bring the builder down with the container still running: the
  // first error is kept, the run is killed, and later lines are not handed on.
  lines.on("line", (line) => {
    if (handlerError !== undefined) return;
    try {
      opts.onLine(line);
    } catch (err) {
      handlerError = err instanceof Error ? err.message : String(err);
      void kill();
    }
  });
  let stderrTail = "";
  child.stderr.on("data", (d: Buffer) => {
    stderrTail = (stderrTail + d.toString("utf8")).slice(-4000);
  });
  let settled = false;
  const ended = (code: number | null, extra = ""): StreamingEnd => ({
    code,
    stderrTail: stderrTail + extra,
    ...(timedOut ? { timedOut } : {}),
    ...(handlerError !== undefined ? { handlerError } : {}),
  });
  const done = new Promise<StreamingEnd>((resolve) => {
    child.on("error", (err) => {
      settled = true;
      resolve(ended(null, String(err)));
    });
    // "close" comes after stdout has ended, so every line has been handed on by then.
    child.on("close", (code) => {
      settled = true;
      resolve(ended(code));
    });
  });
  let killing: Promise<void> | null = null;
  const kill = () =>
    (killing ??= (async () => {
      // The container may not exist yet if the run is still being prepared: try for a while.
      for (let i = 0; i < 40 && !settled; i++) {
        const killed = await run("docker", ["kill", opts.container], { env }).then(
          () => true,
          () => false,
        );
        if (killed) break;
        await pause(250);
      }
      await waitAtMost(done, 15_000);
      // `--rm` removes a killed container; this removes it if anything was left.
      await run("docker", ["rm", "-f", opts.container], { env }).catch(() => undefined);
      if (!settled) child.kill("SIGKILL");
      await done;
    })());
  const timer = setTimeout(() => {
    timedOut = true;
    void kill();
  }, opts.timeoutMs ?? 600_000);
  void done.then(() => clearTimeout(timer));
  return { container: opts.container, done, kill };
}

export const sandbox = {
  /**
   * Build the app image (the Dockerfile's `run` stage) and the tools image (its `tools` stage) with
   * plain `docker build`, on the host network in development. The second build reuses the first's steps.
   * With `noCache`, the first build uses nothing from Docker's build cache, so every step, the guard
   * check and `next build` included, really runs (package 2.1: identical files would otherwise be
   * taken from the cache of an earlier run, and the evidence would show no build).
   */
  build: async (sb: Sandbox, opts: { noCache?: boolean } = {}): Promise<string> => {
    const b = sb.appBuild;
    if (!b) throw new Error("This sandbox has no app to build.");
    let out = "";
    for (const [target, tag] of [["run", b.image], ["tools", b.toolsImage]] as const) {
      const args = ["build", "--target", target, "--tag", tag, ...(b.hostNetwork ? ["--network", "host"] : [])];
      if (opts.noCache && target === "run") args.push("--no-cache");
      for (const [k, v] of Object.entries(b.args)) args.push("--build-arg", `${k}=${v}`);
      args.push(b.context);
      const { stdout, stderr } = await run("docker", args, { timeout: 1_200_000, maxBuffer: 20 * 1024 * 1024, env: dockerEnv(sb) });
      out += stdout + stderr;
    }
    return out;
  },
  /** Remove the app and tools images after the project's containers are gone. */
  removeImage: async (sb: Sandbox) => {
    if (!sb.appBuild) return;
    for (const image of [sb.appBuild.image, sb.appBuild.toolsImage]) await run("docker", ["image", "rm", "-f", image], { env: dockerEnv(sb) }).catch(() => undefined);
  },
  /** Start services and wait for their health checks. The tools and engine services are never started this way: they are refused by name. */
  up: async (sb: Sandbox, services: string[] = []): Promise<string> => {
    // An async function, so that these refusals are rejected promises like any other failure of up.
    if (services.includes("tools")) throw new Error("The tools service runs one command at a time, through runOnce; it is not started with up.");
    if (services.includes("engine")) throw new Error("The engine service runs one step at a time, through runStreaming; it is not started with up.");
    return compose(sb, ["up", "-d", "--wait", ...services], 600_000, false);
  },
  /** Run a one-off command in a fresh container of a service (for migrations and seeding). */
  runOnce: (sb: Sandbox, service: string, cmd: string[]) => compose(sb, ["run", "--rm", "--no-deps", "-T", service, ...cmd], 600_000),
  /** Run a one-off command in a fresh, named container of a service, reading its output line by line, with a handle to kill it (the engine's steps). */
  runStreaming,
  /** Stop and remove the project's containers, one-off tools and engine containers left by an interrupted run included, and its networks and volumes. */
  destroy: (sb: Sandbox) => compose(sb, ["down", "-v", "--remove-orphans"]),
  /** Run a command inside a running service. */
  exec: (sb: Sandbox, service: string, cmd: string[]) => compose(sb, ["exec", "-T", service, ...cmd]),
  /** Running services, as Compose reports them. */
  ps: (sb: Sandbox) => compose(sb, ["ps", "--format", "json"]),
  logs: (sb: Sandbox, service: string) => compose(sb, ["logs", "--no-color", service]),
};
