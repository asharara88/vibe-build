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
import { mkdirSync, writeFileSync } from "node:fs";
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
    return {
      name: composeProjectName(spec.projectId),
      networks: { internal: { internal: true }, egress: {} },
      secrets: { db_password: { file: "./secrets/db_password" } },
      volumes: { dbdata: {} },
      services: {
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
  return {
    name: composeProjectName(spec.projectId),
    secrets: { db_password: { file: "./secrets/db_password" } },
    volumes: { dbdata: {} },
    services: {
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
}

/** Write the compose file and the database secret. Does not start anything. */
export function createSandbox(spec: SandboxSpec, dbPassword: string): Sandbox {
  mkdirSync(join(spec.dir, "secrets"), { recursive: true });
  mkdirSync(join(spec.dir, "workspace"), { recursive: true });
  writeFileSync(join(spec.dir, "secrets", "db_password"), dbPassword, { mode: 0o600 });
  const composeFile = join(spec.dir, "compose.yaml");
  writeFileSync(composeFile, toYaml(composeDocument(spec)));
  return { dir: spec.dir, composeFile, projectName: composeProjectName(spec.projectId) };
}

async function compose(sb: Sandbox, args: string[], timeoutMs = 180_000): Promise<string> {
  const { stdout } = await run("docker", ["compose", "-f", sb.composeFile, ...args], { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

export const sandbox = {
  /** Start services and wait for their health checks. */
  up: (sb: Sandbox, services: string[] = []) => compose(sb, ["up", "-d", "--wait", ...services]),
  /** Stop and remove the project's containers, networks and volumes. */
  destroy: (sb: Sandbox) => compose(sb, ["down", "-v", "--remove-orphans"]),
  /** Run a command inside a running service. */
  exec: (sb: Sandbox, service: string, cmd: string[]) => compose(sb, ["exec", "-T", service, ...cmd]),
  /** Running services, as Compose reports them. */
  ps: (sb: Sandbox) => compose(sb, ["ps", "--format", "json"]),
  logs: (sb: Sandbox, service: string) => compose(sb, ["logs", "--no-color", service]),
};
