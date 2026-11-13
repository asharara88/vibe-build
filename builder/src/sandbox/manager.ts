/**
 * The sandbox manager: creates, starts and stops one isolated set of containers per project.
 *
 * Interface (design note, section 2.5): create project sandbox, start service, run command,
 * mount path, destroy. Plain Docker Compose sits behind it in Stage 1; gVisor's runtime or E2B
 * could replace it without the rest of the builder noticing.
 *
 * Both profiles give the project's containers the same private networks (package 0.6c; design note 2.5,
 * amendment of 13 Nov 2026), each `internal` (no route out), with Docker's "isolated" gateway mode (no
 * address of the machine on it) and no IPv6:
 * - `data`: the database, the app, and the tools container (tables and sample users);
 * - `front`: the app, the acceptance runner, and the short-lived `check` container that asks the app for
 *   its sign-in page before a run;
 * - `out`: the way out, `egress`, and package 2.2's engine when it is given a network (`engine.network`).
 * The engine of package 2.1 (the scripted engine) has no network at all.
 *
 * How `egress` leads out differs:
 * - `server`: `egress` is the builder's egress proxy itself, on `out` and on an ordinary bridge (`ext`),
 *   going out directly (designed, not shown: package 0.6b).
 * - `development-cloud-session`: `egress` is a door. It forwards its port 3128 to the builder's egress
 *   proxy and its port 4010 to the model gateway, each through a Unix socket in the project's socket folder
 *   on the machine (owner uid 1000, mode 750; each socket mode 600). The proxy and the gateway forwarder run
 *   in the `egress-host` service, on the machine's network, listening only on those sockets and, for the
 *   image build, on one port of the machine's loopback address. The proxy goes out only through the cloud
 *   session's proxy and refuses to start without one. The image build runs on the machine's network with
 *   that loopback port as its proxy, for npm only, with install scripts off; every step that runs the
 *   workspace's code (the guard check, `next build`) has no network at all (templates/next/Dockerfile).
 *   No project container and no build step is given the cloud session's certificate.
 * Measured before it was built: evidence/2026-11-13-package-0.6c/measurements.md. As built and run:
 * evidence/2026-11-13-package-0.6c/network-boundary.md.
 *
 * Package 3.1 adds the acceptance runner's container (`acceptance`), started one run at a time, and a
 * rule: no engine container is given a mount of the acceptance store's data folder, of a folder inside
 * it, or of a folder that holds it (`runStreaming`, `createSandbox`).
 */
import { execFile, spawn } from "node:child_process";
import { chmodSync, chownSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const run = promisify(execFile);

export type SandboxProfile = "server" | "development-cloud-session";

export interface SandboxSpec {
  projectId: string;
  /** Directory that holds the project's compose file and workspace. */
  dir: string;
  profile: SandboxProfile;
  /** Hosts the project's containers may reach through the egress proxy. */
  allowHosts: string[];
  /**
   * Where the engine's model calls go: the gateway's address. On the development profile, its address on the
   * machine, which must be on the loopback address (the gateway listens on 127.0.0.1 by default); containers
   * reach it at the door, http://egress:4010.
   */
  gatewayUrl: string;
  /** Images to use instead of DEFAULT_IMAGES. Nothing sets this today; a value given here at run time is not seen by the approved-images check. */
  images?: { postgres?: string; node?: string };
  /**
   * Development profile only: the cloud session's proxy, the egress proxy's only way out. Only its host and
   * port are used (a user name or password in it is dropped); no certificate is given to anything.
   */
  hostProxy?: { url: string };
  /**
   * Development profile, when the project has an app: the port on the machine's loopback address where the
   * image build's npm finds the egress proxy (its list: `buildAllowHosts`). It must be free on the machine.
   */
  buildProxyPort?: number;
  /** The hosts the image build may reach through `buildProxyPort`. Default: the package registry only. */
  buildAllowHosts?: string[];
  /** Absolute path of the builder's own source, mounted read-only so the egress proxy can run from it. */
  builderDir: string;
  /** The app container, once the project has an app to run. */
  app?: {
    /** Build context: the project's workspace (the template plus the engine's changes). */
    buildContext: string;
    /** Port the app listens on inside its container. Other project containers reach it at http://app:<port>. */
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
    /**
     * Package 2.2's option, not used by any engine yet: "egress" puts the engine on the `out` network only,
     * with the proxy settings pointing at the door (http://egress:3128, NO_PROXY=egress) and the gateway at
     * http://egress:4010 (development profile). Default "none": no network at all (the scripted engine).
     */
    network?: "none" | "egress";
  };
  /**
   * The acceptance runner's container (package 3.1). It exists only while a run goes on, started through
   * `runStreaming` with the run's own mounts: the version of the tests at /acceptance (read-only), a fresh
   * run folder at /results, and the sample password at /run/secrets/sample-password. It has the hardening
   * every project container gets, a 512 MB /tmp, the runner image's unprivileged user, no settings file,
   * and one setting of its own here, BASE_URL (RUN_ID is given per run). It is on the project's `front`
   * network only, with the app (package 0.6c).
   */
  acceptance?: {
    /** The runner image, built on this machine by builder/src/acceptance/runner-image.ts and never pushed. */
    image: string;
    /** The app's address as the runner reaches it, http://app:<port>: the app's own APP_URL. */
    baseUrl: string;
  };
}

/**
 * The two images every sandbox runs, each pinned to the one digest the owner approved for the builder's
 * internal development and testing only (13 Nov 2026, question 11 (a); builder/approved-images.json).
 * Tests and scripts take them from here. test/approved-images.test.ts fails on any image reference in the
 * code, scripts, tests or templates that is not one of these, written tag@digest.
 */
export const DEFAULT_IMAGES = {
  postgres: "postgres:16-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139",
  node: "node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202",
};

/** The hardening every project container gets. From Anthropic's secure-deployment guide, measured on 11 Nov 2026. */
export const HARDENING = {
  cap_drop: ["ALL"],
  security_opt: ["no-new-privileges:true"],
  pids_limit: 256,
  mem_limit: "1g",
  read_only: true,
};

/**
 * Every project network (package 0.6c): `internal` (Docker gives it no route out), the "isolated" gateway
 * mode (Docker puts no address of the machine on it, so nothing listening on the machine can be reached
 * from it; Docker Engine 28.0.0 and later accept it on internal networks only) and no IPv6. No gateway
 * address is set: on such a network the first container can be given the `.1` address.
 */
export const PROJECT_NETWORK = {
  internal: true,
  enable_ipv6: false,
  driver_opts: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" },
} as const;

/** The door's two ports on the `out` network (development profile): the egress proxy and the gateway. */
export const DOOR_PORTS = { proxy: 3128, gateway: 4010 } as const;

/** The project's socket folder on the machine (development profile): the egress proxy's and the gateway forwarder's sockets. */
export const socketDir = (sandboxDir: string) => join(sandboxDir, "egress-sockets");

/**
 * Who owns the socket folder and runs the door and the machine side (development profile): the user `node`
 * of the approved Node image (1000:1000) when the builder runs as root, which then gives the folder to that
 * user; otherwise the builder's own user, since it cannot give the folder away.
 */
export function socketOwner(): { uid: number; gid: number } {
  const uid = process.getuid?.() ?? 0;
  return uid === 0 ? { uid: 1000, gid: 1000 } : { uid, gid: process.getgid?.() ?? uid };
}

/** The gateway's address on the machine, host and port, from `gatewayUrl`; it must be a loopback address (development profile). */
export function gatewayOnMachine(gatewayUrl: string): string {
  let u: URL;
  try {
    u = new URL(gatewayUrl);
  } catch {
    throw new Error(`The gateway's address is not an address: ${gatewayUrl}`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(host) || !u.port)
    throw new Error("On the development profile the gateway must be on the machine's loopback address, with its port (for example http://127.0.0.1:4010): the door forwards only there.");
  return `${host === "::1" ? "[::1]" : host}:${u.port}`;
}

/** The session proxy as http://host:port, with any user name or password dropped. */
function proxyHostPort(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    // Passed on as given: the machine side refuses it and says why (egress-proxy.ts, parseUpstream).
    return url;
  }
  return u.protocol === "http:" && u.hostname && u.port ? `http://${u.host}` : url;
}

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
 * The engine service (package 2.1). The scripted engine has no network at all, because it calls no model
 * and fetches nothing. Package 2.2's engine needs the gateway (design note 2.4, 2.5); `engine.network:
 * "egress"` is that arrangement, built and probed in package 0.6c but not used by any engine yet (known
 * gap 50): the `out` network only, the proxy settings pointing at the door, and the gateway's address. It
 * runs as the unprivileged user `node`, with the hardening every project container gets, a read-only root,
 * a small `/tmp`, no settings file, and without the base image's start-up script, which would add PWD and
 * SHLVL. Under the "engine" profile, so it starts only when a step is run on purpose; `up` refuses it.
 */
function engineService(spec: SandboxSpec, common: Record<string, unknown>, image: string) {
  if (!spec.engine) return null;
  const network =
    spec.engine.network === "egress"
      ? {
          networks: ["out"],
          environment: {
            HTTPS_PROXY: `http://egress:${DOOR_PORTS.proxy}`,
            HTTP_PROXY: `http://egress:${DOOR_PORTS.proxy}`,
            NO_PROXY: "egress",
            ANTHROPIC_BASE_URL: spec.profile === "server" ? spec.gatewayUrl : `http://egress:${DOOR_PORTS.gateway}`,
          },
        }
      : { network_mode: "none" };
  return {
    image,
    profiles: ["engine"],
    ...common,
    read_only: true,
    tmpfs: ["/tmp:rw,noexec,nosuid,size=16m"],
    user: "node",
    ...network,
    entrypoint: [],
    working_dir: "/workspace",
    volumes: [
      bindMount(spec.engine.workspace, "/workspace", false),
      bindMount(engineEmptyDir(spec.dir), "/workspace/certs", true),
      bindMount(spec.engine.changeSets, "/engine", true),
    ],
  };
}

/**
 * The `check` service (package 0.6c): a short-lived container on the `front` network, the runner's, that
 * asks the app for a page (`sandbox.askApp`), so that the builder never connects to the app from the
 * machine. The approved Node image, the hardening, the user `node`, no settings and no mount. Under the
 * "check" profile, so it starts only when it is run on purpose; `up` refuses it.
 */
function checkService(spec: SandboxSpec, common: Record<string, unknown>, image: string) {
  if (!spec.app) return null;
  return {
    image,
    profiles: ["check"],
    ...common,
    read_only: true,
    tmpfs: ["/tmp:rw,noexec,nosuid,size=16m"],
    user: "node",
    entrypoint: [],
    networks: ["front"],
  };
}

/**
 * The acceptance runner's service (package 3.1). The same in both profiles: on the `front` network only
 * (package 0.6c). Under the "acceptance" profile, so it starts only when a run is started on purpose; `up`
 * refuses it.
 */
function acceptanceService(spec: SandboxSpec, common: Record<string, unknown>) {
  if (!spec.acceptance) return null;
  return {
    image: spec.acceptance.image,
    pull_policy: "never",
    profiles: ["acceptance"],
    ...common,
    read_only: true,
    tmpfs: ["/tmp:rw,noexec,nosuid,size=512m"],
    user: "runner",
    entrypoint: [],
    working_dir: "/runner",
    environment: { BASE_URL: spec.acceptance.baseUrl },
    networks: ["front"],
  };
}

/** The app service shared by both profiles, before networking is added. */
function appService(spec: SandboxSpec, common: Record<string, unknown>, databaseUrl: string) {
  if (!spec.app) return null;
  const tmpfs = ["/tmp:rw,noexec,nosuid,size=64m", ...(spec.app.writablePaths ?? []).map((p) => `${p}:rw,nosuid,size=128m`)];
  return {
    // The image is built by `sandbox.build`, not by Compose: in development npm must reach the egress
    // proxy's build port on the machine's loopback address, which needs `docker build --network host`.
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
    // Both: its database on `data`, and the runner and the check on `front`. No way out.
    networks: ["data", "front"],
  };
}

/**
 * A health check's script: it passes once `port` listens on the address `addressHex` (as /proc/net/tcp writes
 * it: 00000000 for every address, 0100007F for 127.0.0.1), read from /proc/net/tcp; it opens no connection.
 */
const listeningCheck = (addressHex: string, port: number) =>
  `process.exit(require('fs').readFileSync('/proc/net/tcp','utf8').includes(' ${addressHex}:${port.toString(16).toUpperCase().padStart(4, "0")} 00000000:0000 0A')?0:1)`;

/** Build the Compose document for a project. Returned as an object so tests can inspect it. */
export function composeDocument(spec: SandboxSpec, owner: { uid: number; gid: number } = { uid: 1000, gid: 1000 }): Record<string, unknown> {
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
  // The same in both profiles: the database on `data` only, reached as db:5432, with no port on the machine.
  const databaseUrl = "postgres://app:${DB_PASSWORD}@db:5432/app";
  const app = appService(spec, common, databaseUrl);
  const tools = toolsService(spec, common, databaseUrl);
  const engine = engineService(spec, common, images.node);
  const acceptance = acceptanceService(spec, common);
  const check = checkService(spec, common, images.node);
  const db = {
    image: images.postgres,
    ...common,
    ...dbCaps,
    read_only: false,
    environment: dbEnv,
    secrets: ["db_password"],
    volumes: ["dbdata:/var/lib/postgresql/data"],
    networks: ["data"],
    // Over TCP, so that it passes only once the real server listens on its network port, not on the image's
    // temporary set-up server, which listens on its local socket only (known gap 69).
    healthcheck: { test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -p 5432 -U app -d app"], interval: "2s", retries: 30 },
  };
  const projectServices = {
    ...(app ? { app } : {}),
    // The tools container needs the project's database and nothing else.
    ...(tools ? { tools: { ...tools, networks: ["data"] } } : {}),
    ...(engine ? { engine } : {}),
    ...(acceptance ? { acceptance } : {}),
    ...(check ? { check } : {}),
    db,
  };
  const egressBase = {
    image: images.node,
    ...common,
    read_only: true,
    tmpfs: ["/tmp:rw,noexec,nosuid,size=32m"],
    working_dir: "/builder",
  };

  if (spec.profile === "server") {
    return {
      name: composeProjectName(spec.projectId),
      networks: { data: PROJECT_NETWORK, front: PROJECT_NETWORK, out: PROJECT_NETWORK, ext: { enable_ipv6: false } },
      secrets: { db_password: { file: "./secrets/db_password" } },
      volumes: { dbdata: {} },
      services: {
        ...projectServices,
        egress: {
          ...egressBase,
          user: "node",
          command: ["node", "--import", "tsx", "src/sandbox/egress-main.ts"],
          environment: {
            EGRESS_ALLOW: spec.allowHosts.join(","),
            EGRESS_PORT: String(DOOR_PORTS.proxy),
            // Said explicitly: the egress proxy refuses to start with this setting empty or missing.
            EGRESS_UPSTREAM_PROXY: "direct",
          },
          volumes: [`${spec.builderDir}:/builder:ro`],
          networks: ["out", "ext"],
        },
      },
    };
  }

  // development-cloud-session: the door on `out`, and the egress proxy and the gateway forwarder on the
  // machine's network behind two Unix sockets.
  if (!spec.hostProxy) throw new Error("The development profile needs the cloud session's proxy (hostProxy): the egress proxy goes out only through it.");
  const gateway = gatewayOnMachine(spec.gatewayUrl);
  const user = `${owner.uid}:${owner.gid}`;
  const buildEnv = spec.buildProxyPort
    ? { EGRESS_BUILD_PORT: String(spec.buildProxyPort), EGRESS_BUILD_ALLOW: (spec.buildAllowHosts ?? ["registry.npmjs.org"]).join(",") }
    : {};
  const sockCheck = "const fs=require('fs');for(const p of ['/sock/egress.sock','/sock/gateway.sock'])if(!fs.statSync(p,{throwIfNoEntry:false})?.isSocket())process.exit(1);";
  const buildCheck = spec.buildProxyPort ? listeningCheck("0100007F", spec.buildProxyPort) : "process.exit(0)";
  return {
    name: composeProjectName(spec.projectId),
    networks: { data: PROJECT_NETWORK, front: PROJECT_NETWORK, out: PROJECT_NETWORK },
    secrets: { db_password: { file: "./secrets/db_password" } },
    volumes: { dbdata: {} },
    services: {
      ...projectServices,
      egress: {
        ...egressBase,
        user,
        command: ["node", "--import", "tsx", "src/sandbox/door-main.ts"],
        environment: { DOOR_ROUTES: `${DOOR_PORTS.proxy}=/sock/egress.sock,${DOOR_PORTS.gateway}=/sock/gateway.sock` },
        volumes: [bindMount(spec.builderDir, "/builder", true), bindMount(socketDir(spec.dir), "/sock", true)],
        networks: ["out"],
        depends_on: { "egress-host": { condition: "service_healthy" } },
        healthcheck: { test: ["CMD", "node", "-e", listeningCheck("00000000", DOOR_PORTS.proxy)], interval: "60s", start_period: "60s", start_interval: "1s" },
      },
      "egress-host": {
        ...egressBase,
        user,
        network_mode: "host",
        command: ["node", "--import", "tsx", "src/sandbox/egress-machine-main.ts"],
        environment: {
          EGRESS_ALLOW: spec.allowHosts.join(","),
          EGRESS_UPSTREAM_PROXY: proxyHostPort(spec.hostProxy.url),
          EGRESS_SOCKET: "/sock/egress.sock",
          GATEWAY_SOCKET: "/sock/gateway.sock",
          GATEWAY_TARGET: gateway,
          ...buildEnv,
        },
        volumes: [bindMount(spec.builderDir, "/builder", true), bindMount(socketDir(spec.dir), "/sock", false)],
        healthcheck: { test: ["CMD", "node", "-e", sockCheck + buildCheck], interval: "60s", start_period: "60s", start_interval: "1s" },
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
  /**
   * How to build the app image and the tools image, when the project has an app. `before`: services started
   * before the build (development profile: `egress-host`, whose loopback port the build's npm uses).
   */
  appBuild?: { context: string; image: string; toolsImage: string; hostNetwork: boolean; args: Record<string, string>; before: string[] };
  /** The names, and only the names, of the settings the tools container is given. */
  toolsEnvNames?: string[];
  /** The host folders the engine service mounts in every run (package 3.1's mount rule checks them too). */
  engineMountSources?: string[];
  /** The image of the acceptance service, when there is one (package 3.1b: a run checks it before it starts). */
  acceptanceImage?: string;
}

/** The setting that names the acceptance store's data folder (package 3.1; builder/src/acceptance/store.ts). */
export const DATA_DIR_SETTING = "BUILDER_DATA_DIR";

/** A path with its links resolved as far as it exists; the rest is added as written. */
function realpathAsFar(p: string): string {
  let head = resolve(p);
  const tail: string[] = [];
  while (!existsSync(head)) {
    const parent = dirname(head);
    if (parent === head) break;
    tail.unshift(head.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    head = parent;
  }
  return join(realpathSync(head), ...tail);
}

/**
 * Package 3.1's mount rule for the engine service: a mount source that is the acceptance store's data
 * folder, inside it, or a folder that holds it is refused. Both sides are compared with their links
 * resolved. With no data folder set there is no store to keep out, and nothing is refused.
 * Returns the reason for a refusal, or null.
 */
export function engineMountRefusal(source: string, dataDir: string | undefined = process.env[DATA_DIR_SETTING]): string | null {
  if (!dataDir) return null;
  if (!isAbsolute(dataDir)) return `${DATA_DIR_SETTING} is not an absolute path, so no engine mount can be checked against it`;
  const d = realpathAsFar(dataDir);
  const s = realpathAsFar(source);
  const within = (a: string, b: string) => a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
  if (within(s, d)) return `the mount source ${source} is the acceptance store's data folder or inside it`;
  if (within(d, s)) return `the mount source ${source} holds the acceptance store's data folder`;
  return null;
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
  const dev = spec.profile === "development-cloud-session";
  if (dev && spec.app && !spec.buildProxyPort) throw new Error("The development profile needs buildProxyPort for a project with an app: the image build's npm reaches the egress proxy there.");
  const owner = socketOwner();
  if (dev) {
    // The socket folder: the door (read-only) and the machine side (read-write) run as its owner; nobody else may enter it.
    const sockets = socketDir(spec.dir);
    mkdirSync(sockets, { recursive: true, mode: 0o750 });
    chmodSync(sockets, 0o750);
    if (process.getuid?.() === 0) chownSync(sockets, owner.uid, owner.gid);
  }
  // The engine sees this empty folder in place of the workspace's certs folder (package 2.1).
  if (spec.engine) mkdirSync(engineEmptyDir(spec.dir), { recursive: true, mode: 0o755 });
  const engineMountSources = spec.engine ? [spec.engine.workspace, engineEmptyDir(spec.dir), spec.engine.changeSets] : undefined;
  // Package 3.1: no engine mount may reach the acceptance store's data folder.
  for (const source of engineMountSources ?? []) {
    const refusal = engineMountRefusal(source);
    if (refusal) throw new Error(`The engine service is refused: ${refusal}.`);
  }
  const composeFile = join(spec.dir, "compose.yaml");
  writeFileSync(composeFile, toYaml(composeDocument(spec, owner)));
  // Development profile: the build's npm goes to the egress proxy's build port on the machine's loopback
  // address (the registry only), never to the cloud session's proxy directly; no certificate is given.
  const buildProxy = `http://127.0.0.1:${spec.buildProxyPort}`;
  const appBuild = spec.app
    ? {
        context: spec.app.buildContext,
        image: appImageName(spec.projectId),
        toolsImage: toolsImageName(spec.projectId),
        hostNetwork: dev,
        args: (dev ? { HTTPS_PROXY: buildProxy, HTTP_PROXY: buildProxy } : {}) as Record<string, string>,
        before: dev ? ["egress-host"] : [],
      }
    : undefined;
  const toolsEnvNames = spec.app
    ? [...new Set(["DATABASE_URL", ...Object.keys(spec.app.toolsEnv ?? {}), ...Object.keys(appSecrets)])].sort()
    : undefined;
  return { dir: spec.dir, composeFile, projectName: composeProjectName(spec.projectId), appBuild, toolsEnvNames, engineMountSources, acceptanceImage: spec.acceptance?.image };
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
 * The profiles of the services that run one command at a time: tools (package 0.5), engine
 * (package 2.1), acceptance (package 3.1) and check (package 0.6c). They are named on every command but `up`, so that such a
 * container is seen, and removed with the rest, while `up` never starts one.
 */
const ONE_OFF_PROFILES = ["--profile", "tools", "--profile", "engine", "--profile", "acceptance", "--profile", "check"];

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
  /** The exact arguments given to `docker` (package 3.1: the evidence lists them). Set by `runStreaming`. */
  args?: string[];
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
  /** Settings for this run only (package 3.1: the acceptance run's RUN_ID). Names in capitals, digits and _. */
  env?: Record<string, string>;
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
  // Package 3.1: an engine container is never given a mount of the acceptance store's data folder, of a
  // folder inside it, or of one that holds it; this run's mounts and the service's own are checked.
  if (service === "engine") {
    for (const source of [...(opts.volumes ?? []).map((v) => v.split(":")[0] ?? ""), ...(sb.engineMountSources ?? [])]) {
      const refusal = engineMountRefusal(source);
      if (refusal) throw new Error(`The engine run is refused: ${refusal}.`);
    }
  }
  for (const k of Object.keys(opts.env ?? {})) if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(k)) throw new Error(`"${k}" is not a setting name this runner passes on.`);
  const env = dockerEnv(sb);
  const args = ["compose", "-f", sb.composeFile, ...ONE_OFF_PROFILES, "run", "--rm", "--no-deps", "-T", "--name", opts.container];
  for (const v of opts.volumes ?? []) args.push("--volume", v);
  for (const [k, v] of Object.entries(opts.env ?? {})) args.push("--env", `${k}=${v}`);
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
  return { container: opts.container, done, kill, args: ["docker", ...args] };
}

/**
 * The script a stream's `check` container runs (package J3; final design, section 4.2): connect to the host and port
 * given as its two arguments, and pass standard input to that connection and the connection's bytes to standard
 * output, both ways, unread. Node's own modules only. It ends (measurement M2):
 * - when the app closes the connection, once everything the app sent has been written to standard output (exiting
 *   before that lost the end of a 2 MB answer once in four runs);
 * - 2 s after its standard input ends;
 * - after 70 s with no byte either way (the front's own limit is 60 s);
 * - at once, with code 1, if the app cannot be reached.
 * Ending the docker client's standard input does not reach the container (M2), so the interface ends a stream the
 * front has closed by killing its container (`appStream`'s `kill`).
 */
export const STREAM_SCRIPT =
  "let up=false;const bye=(c)=>process.stdout.write('',()=>process.exit(c));" +
  "const s=require('net').connect(Number(process.argv[2]),process.argv[1]);" +
  "s.on('connect',()=>{up=true;process.stdin.pipe(s);s.pipe(process.stdout,{end:false})});" +
  "s.on('error',()=>{if(!up)process.exit(1)});" +
  "s.on('close',()=>bye(0));" +
  "process.stdin.on('end',()=>setTimeout(()=>process.exit(0),2000));" +
  "process.stdout.on('error',()=>process.exit(0));" +
  "s.setTimeout(70000,()=>process.exit(0))";

/** A stream to the app (package J3): one connection to http://app:<port>, through a short-lived `check` container. */
export interface AppStream {
  /** The container's name, given with `--name`, so that it can be killed by name. */
  container: string;
  /** Bytes to the app. Ending it ends the connection's sending side. */
  stdin: NodeJS.WritableStream;
  /** Bytes from the app. */
  stdout: NodeJS.ReadableStream;
  /** Settles when the container's command has ended. It never rejects. */
  done: Promise<StreamingEnd>;
  /** Kill the container, wait for the command to end, and remove the container if anything is left. */
  kill: () => Promise<void>;
  /** The exact arguments given to `docker`. */
  args: string[];
}

/** The only target a stream takes: the app, by its name on the project's `front` network, and its port. */
export const STREAM_TARGET = /^app:(\d{1,5})$/;

/**
 * Open one stream to the app (package J3; final design, section 4.2), built as `askApp` is: a fresh container of the
 * `check` service (the `front` network only, the approved Node image, the hardening, the user `node`, no settings, no
 * mount), run with `docker compose run --rm --no-deps -T`, whose standard input and output are the stream. Nothing
 * is added to the service: no `--volume`, `--env`, `--user` or `--privileged`. The target is only `app:<port>`.
 */
/** The exact arguments `appStream` gives `docker` (the tests read them): nothing added to the `check` service. */
export function appStreamArgs(sb: Pick<Sandbox, "composeFile">, target: string, container: string): string[] {
  const m = STREAM_TARGET.exec(target);
  const port = m ? Number(m[1]) : 0;
  if (!m || port < 1 || port > 65535) throw new Error(`appStream takes app:<port>, nothing else: ${target}`);
  if (!CONTAINER_NAME.test(container)) throw new Error(`"${container}" is not a container name Docker accepts.`);
  return ["compose", "-f", sb.composeFile, ...ONE_OFF_PROFILES, "run", "--rm", "--no-deps", "-T", "--name", container, "check", "node", "-e", STREAM_SCRIPT, "app", String(port)];
}

function appStream(sb: Sandbox, target: string, o: { container: string }): AppStream {
  const args = appStreamArgs(sb, target, o.container);
  const env = dockerEnv(sb);
  // Its own process group, so that the docker client and its compose plugin can be killed together (measurement M2:
  // killing the client alone left the plugin running).
  const child = spawn("docker", args, { env, stdio: ["pipe", "pipe", "pipe"], detached: true });
  let stderrTail = "";
  child.stderr.on("data", (d: Buffer) => {
    stderrTail = (stderrTail + d.toString("utf8")).slice(-2000);
  });
  child.stdin.on("error", () => undefined);
  child.stdout.on("error", () => undefined);
  let settled = false;
  const done = new Promise<StreamingEnd>((resolve) => {
    child.on("error", (err) => {
      settled = true;
      resolve({ code: null, stderrTail: stderrTail + String(err) });
    });
    child.on("close", (code) => {
      settled = true;
      resolve({ code, stderrTail });
    });
  });
  let killing: Promise<void> | null = null;
  const kill = () =>
    (killing ??= (async () => {
      child.stdin.end();
      // What the app still sends is read and dropped, so the client is never left blocked on a full pipe (measurement
      // M2: a stream whose reader had gone kept its client, and its container, after it was killed).
      child.stdout.resume();
      // Ended already: `--rm` has removed its container.
      if (settled) return;
      for (let i = 0; i < 20 && !settled; i++) {
        const killed = await run("docker", ["kill", o.container], { env }).then(
          () => true,
          () => false,
        );
        if (killed) break;
        await pause(250);
      }
      await waitAtMost(done, 15_000);
      await run("docker", ["rm", "-f", o.container], { env }).catch(() => undefined);
      if (!settled && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      await done;
    })());
  return { container: o.container, stdin: child.stdin, stdout: child.stdout, done, kill, args: ["docker", ...args] };
}

export const sandbox = {
  /**
   * Build the app image (the Dockerfile's `run` stage) and the tools image (its `tools` stage) with
   * plain `docker build`, on the host network in development, after starting `egress-host`, whose loopback
   * port is the build's proxy. The second build reuses the first's steps.
   * With `noCache`, the first build uses nothing from Docker's build cache, so every step, the guard
   * check and `next build` included, really runs (package 2.1: identical files would otherwise be
   * taken from the cache of an earlier run, and the evidence would show no build).
   */
  build: async (sb: Sandbox, opts: { noCache?: boolean } = {}): Promise<string> => {
    const b = sb.appBuild;
    if (!b) throw new Error("This sandbox has no app to build.");
    if (b.before.length) await compose(sb, ["up", "-d", "--wait", ...b.before], 180_000, false);
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
  /** Start services and wait for their health checks. The tools, engine and acceptance services are never started this way: they are refused by name. */
  up: async (sb: Sandbox, services: string[] = []): Promise<string> => {
    // An async function, so that these refusals are rejected promises like any other failure of up.
    if (services.includes("tools")) throw new Error("The tools service runs one command at a time, through runOnce; it is not started with up.");
    if (services.includes("engine")) throw new Error("The engine service runs one step at a time, through runStreaming; it is not started with up.");
    if (services.includes("acceptance")) throw new Error("The acceptance service runs one acceptance run at a time, through runStreaming; it is not started with up.");
    if (services.includes("check")) throw new Error("The check service asks the app one question at a time, through askApp; it is not started with up.");
    return compose(sb, ["up", "-d", "--wait", ...services], 600_000, false);
  },
  /**
   * Ask the app for a page from a short-lived container of the `check` service, on the project's `front`
   * network (package 0.6c): the builder never connects to the app from the machine. `url` is the app's
   * address as the runner uses it, such as http://app:3000/en/sign-in. Gives the HTTP status, or what failed
   * (a name not found, a connection refused, a time limit of 10 s).
   */
  askApp: async (sb: Sandbox, url: string): Promise<{ status: number } | { error: string }> => {
    if (!/^http:\/\/[a-z][a-z0-9-]{0,62}:\d{1,5}\/[A-Za-z0-9/_.-]*$/.test(url)) throw new Error(`askApp takes http://<service>:<port>/<path>, nothing else: ${url}`);
    const script =
      "fetch(process.argv[1],{redirect:'manual',signal:AbortSignal.timeout(10000)})" +
      ".then(async(r)=>{await r.arrayBuffer().catch(()=>{});console.log(JSON.stringify({status:r.status}))})" +
      ".catch((e)=>console.log(JSON.stringify({error:String((e.cause&&e.cause.code)||e.name||e.message)})))";
    const out = await compose(sb, ["run", "--rm", "--no-deps", "-T", "check", "node", "-e", script, url], 120_000);
    const last = out.trim().split("\n").pop() ?? "";
    try {
      const r = JSON.parse(last) as { status?: unknown; error?: unknown };
      if (typeof r.status === "number") return { status: r.status };
      if (typeof r.error === "string") return { error: r.error };
    } catch {
      /* not the script's line */
    }
    return { error: `the check printed something else: ${last.slice(0, 200)}` };
  },
  /** One stream to the app, through a short-lived `check` container on the project's `front` network (package J3). */
  appStream,
  /** Run a one-off command in a fresh container of a service (for migrations and seeding). */
  runOnce: (sb: Sandbox, service: string, cmd: string[]) => compose(sb, ["run", "--rm", "--no-deps", "-T", service, ...cmd], 600_000),
  /** Run a one-off command in a fresh, named container of a service, reading its output line by line, with a handle to kill it (the engine's steps). */
  runStreaming,
  /** Stop and remove the project's containers, one-off tools, engine and acceptance containers left by an interrupted run included, and its networks and volumes. */
  destroy: (sb: Sandbox) => compose(sb, ["down", "-v", "--remove-orphans"]),
  /** Run a command inside a running service. */
  exec: (sb: Sandbox, service: string, cmd: string[]) => compose(sb, ["exec", "-T", service, ...cmd]),
  /** Running services, as Compose reports them. */
  ps: (sb: Sandbox) => compose(sb, ["ps", "--format", "json"]),
  /** Stop services without removing them (package 3.1: the app stopped, to show a run refused before its start). */
  stop: (sb: Sandbox, services: string[]) => compose(sb, ["stop", ...services]),
  logs: (sb: Sandbox, service: string) => compose(sb, ["logs", "--no-color", service]),
};
