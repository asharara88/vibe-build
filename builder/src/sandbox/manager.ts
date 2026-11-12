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
 * - `development-cloud-session`: the development machine reaches the internet only through a
 *   proxy on its own loopback address, which containers on a bridge network cannot reach. So the
 *   containers share the host's network, are told about the session proxy, and are given its
 *   certificate. This is development only (known gaps 1 and 2).
 */
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
    return {
      name: composeProjectName(spec.projectId),
      networks: { internal: { internal: true }, egress: {} },
      secrets: { db_password: { file: "./secrets/db_password" } },
      volumes: { dbdata: {} },
      services: {
        ...(app ? { app: { ...app, networks: ["internal"] } } : {}),
        ...(tools ? { tools: { ...tools, networks: ["internal"] } } : {}),
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

  // development-cloud-session: host network, session proxy, session certificate.
  if (!spec.hostProxy) throw new Error("The development profile needs the host proxy URL and certificate path.");
  const devPort = spec.devDbPort ?? 5433;
  const app = appService(spec, common, `postgres://app:\${DB_PASSWORD}@127.0.0.1:${devPort}/app`);
  // The tools container is given no proxy setting: it needs the project's database and nothing else.
  const tools = toolsService(spec, common, `postgres://app:\${DB_PASSWORD}@127.0.0.1:${devPort}/app`);
  return {
    name: composeProjectName(spec.projectId),
    secrets: { db_password: { file: "./secrets/db_password" } },
    volumes: { dbdata: {} },
    services: {
      ...(app ? { app: { ...app, network_mode: "host" } } : {}),
      ...(tools ? { tools: { ...tools, network_mode: "host" } } : {}),
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
  // The project's own Docker client folder, empty but for the user's CLI plugins (see dockerEnv).
  mkdirSync(join(spec.dir, "docker-client"), { recursive: true, mode: 0o700 });
  const userPlugins = join(process.env.DOCKER_CONFIG ?? join(homedir(), ".docker"), "cli-plugins");
  const projectPlugins = join(spec.dir, "docker-client", "cli-plugins");
  if (existsSync(userPlugins) && !existsSync(projectPlugins)) symlinkSync(userPlugins, projectPlugins);
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
export const DOCKER_DAEMON_SETTINGS = ["DOCKER_HOST", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"] as const;

/**
 * The environment every Docker command of a sandbox runs with: PATH, HOME, the settings that name the
 * Docker daemon, and DOCKER_CONFIG pointed at the project's own, empty Docker client folder. Nothing
 * else of the builder's process is there for Compose to copy into a container. The client folder is
 * the project's own because Docker's client configuration can itself add settings to every container
 * (its `proxies` entry adds proxy settings); the user's CLI plugins are linked into it so that
 * `docker compose` and `docker buildx` are still found. A Docker context (DOCKER_CONTEXT, or one chosen
 * in the user's client configuration) is not used: the daemon is the one DOCKER_HOST names, or the
 * default one, for every command alike.
 */
export function dockerEnv(sb: Pick<Sandbox, "dir">): NodeJS.ProcessEnv {
  if (process.env.DOCKER_CONTEXT) {
    throw new Error("The sandbox names its Docker daemon with DOCKER_HOST; a Docker context (DOCKER_CONTEXT) is not supported.");
  }
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? homedir(),
    DOCKER_CONFIG: join(sb.dir, "docker-client"),
  };
  for (const k of DOCKER_DAEMON_SETTINGS) if (process.env[k]) env[k] = process.env[k];
  return env;
}

async function compose(sb: Sandbox, args: string[], timeoutMs = 180_000, withTools = true): Promise<string> {
  // The tools profile is named on every command but `up`, so that a tools container is seen, and
  // removed with the rest, while `up` never starts one.
  const profile = withTools ? ["--profile", "tools"] : [];
  const { stdout } = await run("docker", ["compose", "-f", sb.composeFile, ...profile, ...args], {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env: dockerEnv(sb),
  });
  return stdout;
}

export const sandbox = {
  /**
   * Build the app image (the Dockerfile's `run` stage) and the tools image (its `tools` stage) with
   * plain `docker build`, on the host network in development. The second build reuses the first's steps.
   */
  build: async (sb: Sandbox): Promise<string> => {
    const b = sb.appBuild;
    if (!b) throw new Error("This sandbox has no app to build.");
    let out = "";
    for (const [target, tag] of [["run", b.image], ["tools", b.toolsImage]] as const) {
      const args = ["build", "--target", target, "--tag", tag, ...(b.hostNetwork ? ["--network", "host"] : [])];
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
  /** Start services and wait for their health checks. The tools service is never started this way. */
  up: (sb: Sandbox, services: string[] = []) => compose(sb, ["up", "-d", "--wait", ...services], 600_000, false),
  /** Run a one-off command in a fresh container of a service (for migrations and seeding). */
  runOnce: (sb: Sandbox, service: string, cmd: string[]) => compose(sb, ["run", "--rm", "--no-deps", "-T", service, ...cmd], 600_000),
  /** Stop and remove the project's containers, a one-off tools container left by an interrupted run included, and its networks and volumes. */
  destroy: (sb: Sandbox) => compose(sb, ["down", "-v", "--remove-orphans"]),
  /** Run a command inside a running service. */
  exec: (sb: Sandbox, service: string, cmd: string[]) => compose(sb, ["exec", "-T", service, ...cmd]),
  /** Running services, as Compose reports them. */
  ps: (sb: Sandbox) => compose(sb, ["ps", "--format", "json"]),
  logs: (sb: Sandbox, service: string) => compose(sb, ["logs", "--no-color", service]),
};
