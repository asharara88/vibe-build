/**
 * The exported app's compose file (package 3.2, design section 1): the file of the one documented command,
 * `docker compose up --build`, run from an exported copy's folder.
 *
 * It is generated here from one object and written with the sandbox manager's own YAML writer, reusing the
 * sandbox's hardening (`HARDENING`), its private network (`PROJECT_NETWORK`) and its two approved images
 * (`DEFAULT_IMAGES`). templates/next/compose.yaml is this output, byte for byte; test/export.test.ts holds the
 * file to it and tests its rules on the object (safeguard S22), as test/sandbox.test.ts does for the sandbox.
 * To write the file again after a change here: `npx tsx scripts/app-compose.ts` (from builder/).
 *
 * The services:
 * - `keys`: one-shot, no network. Makes the app's three secrets once, on the machine where it first starts,
 *   into the `keys` volume, each mode 0444; on a later start it prints "kept" for each. Nothing is written in
 *   the folder.
 * - `db`: the approved PostgreSQL image, on `data` only, no port; given the one file `db_password`.
 * - `setup`: one-shot, the copy's own tools stage, on `data` only; given the three files. It makes the tables
 *   with `drizzle-kit migrate` from the fixed migration files, then the made-up sample users with the seed.
 * - `app`: the copy's own run stage, on `data` and `front`; given `db_password` and `auth_secret`, read through
 *   a `sh` wrapper; `APP_URL` is http://localhost:<port>; it starts only once `setup` has succeeded.
 * - `door`: fixed forwarding code in the approved Node image, user `node`, no key, on `front` and `edge`. The
 *   only published port, on the machine's loopback address only: Docker publishes no port for a container whose
 *   only networks are internal (measured, design section 1).
 * Each service is given only its own key files, each mounted alone and read-only through Docker's volume
 * subpath. `data` and `front` are exactly the sandbox's private network; `edge` is an ordinary network with
 * IPv6 off, for the door alone. Every service has the sandbox's hardening; the database alone gets back the
 * five capabilities its image needs to start, and alone has a writable root, as in the sandbox.
 *
 * No `name:` is set: Compose then names the project after its folder, which is the project's id, so nothing
 * here is ever named `builder_<id>`, which the builder's own removal deletes (design section 1, "Names").
 */
import { DEFAULT_IMAGES, HARDENING, PROJECT_NETWORK, toYaml } from "../sandbox/manager.js";

/** The port the app listens on inside its container, and the door inside its own. */
export const APP_INTERNAL_PORT = 3000;
/** The port on the machine's loopback address: 3000, unless the setting APP_PORT names another (Compose fills it in). */
export const APP_PORT_ON_MACHINE = "${APP_PORT:-3000}";
/** The app's address as a person's browser uses it; sign-in accepts only this origin (design section 1). */
export const APP_URL_VALUE = `http://localhost:${APP_PORT_ON_MACHINE}`;
/** The three secrets the `keys` service makes, and the services each one is given to. */
export const KEY_FILES = ["db_password", "auth_secret", "sample_password"] as const;
export type KeyFile = (typeof KEY_FILES)[number];
export const KEYS_GIVEN: Record<string, readonly KeyFile[]> = {
  db: ["db_password"],
  setup: ["db_password", "auth_secret", "sample_password"],
  app: ["db_password", "auth_secret"],
  door: [],
};
/** Where a service finds a key file it is given. */
export const keyPath = (name: KeyFile) => `/run/secrets/${name}`;

/**
 * The `keys` service's script: for each secret, keep it if its file is there; otherwise write a fresh random value
 * to a temporary name, mode 0444, and move it into place, so that a start cut off part-way never leaves an empty
 * file to be kept. The sample password starts "Sample-" and is longer than the app's minimum of 12 characters.
 */
export const KEYS_SCRIPT =
  "const fs=require('fs'),c=require('crypto');" +
  "for(const[n,b,p]of[['db_password',18,''],['auth_secret',32,''],['sample_password',12,'Sample-']]){" +
  "const f='/keys/'+n;if(fs.existsSync(f)){console.log('kept '+n);continue}" +
  "fs.rmSync(f+'.tmp',{force:true});fs.writeFileSync(f+'.tmp',p+c.randomBytes(b).toString('base64url'),{mode:0o444});" +
  "fs.renameSync(f+'.tmp',f);console.log('made '+n)}";

/** The database's address, with the password read from its file. `$$` is Compose's way of writing one `$`. */
const DATABASE_URL_FROM_FILE = `postgres://app:$$db@db:5432/app`;
const readKey = (variable: string, name: KeyFile) => `${variable}=$$(cat ${keyPath(name)})`;

/** The `setup` service's command: the tables from the fixed migration files, then the made-up sample users. */
export const SETUP_SCRIPT =
  `set -eu; ${readKey("db", "db_password")}; ${readKey("as", "auth_secret")}; ${readKey("sp", "sample_password")}; ` +
  `export DATABASE_URL="${DATABASE_URL_FROM_FILE}" AUTH_SECRET="$$as" APP_SAMPLE_PASSWORD="$$sp"; ` +
  "node_modules/.bin/drizzle-kit migrate; exec node --import tsx scripts/seed.ts";

/** The `app` service's command: its two secrets read from their files, then the app itself. */
export const APP_SCRIPT =
  `set -eu; ${readKey("db", "db_password")}; ${readKey("as", "auth_secret")}; ` + `export DATABASE_URL="${DATABASE_URL_FROM_FILE}" AUTH_SECRET="$$as"; exec node server.js`;

/** The door's fixed code: every connection to its port is passed on, unread, to the app on `front`. */
export const DOOR_SCRIPT =
  "const n=require('net');n.createServer((c)=>{const s=n.connect(" +
  APP_INTERNAL_PORT +
  ",'app');c.pipe(s);s.pipe(c);s.on('error',()=>c.destroy());c.on('error',()=>s.destroy())}).listen(" +
  APP_INTERNAL_PORT +
  ",'0.0.0.0')";

/** One key file of the `keys` volume, mounted alone and read-only (Docker's volume subpath). */
const keyMount = (name: KeyFile) => ({ type: "volume", source: "keys", target: keyPath(name), read_only: true, volume: { subpath: name } });

/** The compose document of an exported app. Returned as an object so that the tests can read its rules. */
export function appComposeDocument(): Record<string, unknown> {
  const hardening = { cap_drop: HARDENING.cap_drop, security_opt: HARDENING.security_opt, pids_limit: HARDENING.pids_limit, mem_limit: HARDENING.mem_limit };
  return {
    networks: { data: PROJECT_NETWORK, front: PROJECT_NETWORK, edge: { enable_ipv6: false } },
    volumes: { keys: {}, dbdata: {} },
    services: {
      keys: {
        image: DEFAULT_IMAGES.node,
        ...hardening,
        read_only: true,
        network_mode: "none",
        entrypoint: [],
        volumes: [{ type: "volume", source: "keys", target: "/keys" }],
        command: ["node", "-e", KEYS_SCRIPT],
      },
      db: {
        image: DEFAULT_IMAGES.postgres,
        ...hardening,
        // As in the sandbox (manager.ts): the official image starts as root to prepare its data folder, then drops to
        // its own user; it gets back the five capabilities that step needs and nothing else.
        cap_add: ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"],
        read_only: false,
        environment: { POSTGRES_USER: "app", POSTGRES_PASSWORD_FILE: keyPath("db_password"), POSTGRES_DB: "app" },
        volumes: [{ type: "volume", source: "dbdata", target: "/var/lib/postgresql/data" }, ...KEYS_GIVEN.db!.map(keyMount)],
        networks: ["data"],
        depends_on: { keys: { condition: "service_completed_successfully" } },
        healthcheck: { test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -p 5432 -U app -d app"], interval: "2s", retries: 30 },
      },
      setup: {
        build: { context: ".", target: "tools" },
        ...hardening,
        read_only: true,
        tmpfs: ["/tmp:rw,noexec,nosuid,size=64m"],
        environment: { APP_URL: APP_URL_VALUE },
        volumes: KEYS_GIVEN.setup!.map(keyMount),
        networks: ["data"],
        depends_on: { db: { condition: "service_healthy" } },
        command: ["sh", "-c", SETUP_SCRIPT],
      },
      app: {
        build: { context: ".", target: "run" },
        ...hardening,
        read_only: true,
        tmpfs: ["/tmp:rw,noexec,nosuid,size=64m", "/app/.next/cache:rw,nosuid,size=128m"],
        environment: { PORT: String(APP_INTERNAL_PORT), APP_URL: APP_URL_VALUE },
        volumes: KEYS_GIVEN.app!.map(keyMount),
        networks: ["data", "front"],
        depends_on: { setup: { condition: "service_completed_successfully" } },
        entrypoint: [],
        command: ["sh", "-c", APP_SCRIPT],
        healthcheck: {
          test: ["CMD-SHELL", `wget -q -O /dev/null http://127.0.0.1:${APP_INTERNAL_PORT}/en/sign-in || exit 1`],
          interval: "3s",
          retries: 40,
          start_period: "10s",
        },
      },
      door: {
        image: DEFAULT_IMAGES.node,
        ...hardening,
        read_only: true,
        user: "node",
        entrypoint: [],
        networks: ["front", "edge"],
        ports: [{ target: APP_INTERNAL_PORT, published: APP_PORT_ON_MACHINE, host_ip: "127.0.0.1", protocol: "tcp" }],
        depends_on: { app: { condition: "service_healthy" } },
        command: ["node", "-e", DOOR_SCRIPT],
      },
    },
  };
}

/** The first lines of the file, before the document. */
export const APP_COMPOSE_HEADER = [
  "# The exported app's one command, from this folder: docker compose up --build (see README.md).",
  "# Generated by the builder from one object (builder/src/export/app-compose.ts) and held to it by a test:",
  "# not to be edited by hand. The build engine may not change it.",
  "",
].join("\n");

/** The text of templates/next/compose.yaml. */
export function appComposeYaml(): string {
  return APP_COMPOSE_HEADER + toYaml(appComposeDocument());
}

/**
 * Safeguard S29 (design section 1, "What Compose and the image build read beside the fixed files"): the names that
 * `docker compose` or the image build read without being told, beside `compose.yaml` and the root `.dockerignore`.
 * Each of the four override files is merged into what `docker compose up` runs; a second main file is read when
 * `compose.yaml` is missing; and `<Dockerfile name>.dockerignore` is used instead of `.dockerignore` (all measured).
 */
export const COMPOSE_READ_NAMES = [
  "compose.override.yaml",
  "compose.override.yml",
  "docker-compose.override.yaml",
  "docker-compose.override.yml",
  "compose.yml",
  "docker-compose.yaml",
  "docker-compose.yml",
] as const;

/**
 * True for a path (relative, `/`-separated) that S29 refuses: one of COMPOSE_READ_NAMES at any depth, or any file
 * whose name ends in `.dockerignore` other than the root `.dockerignore`. Names are compared without regard to case,
 * since a copy may be unpacked on a file system that does not tell cases apart.
 */
export function readWithoutBeingTold(path: string): boolean {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() ?? "";
  if ((COMPOSE_READ_NAMES as readonly string[]).includes(base)) return true;
  return base.endsWith(".dockerignore") && path !== ".dockerignore";
}
