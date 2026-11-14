/**
 * Package 3.2: the exporter (docs/design/package-3.2.md). Fast tests: no Docker, no database, no model.
 *
 * Part A, the template and the tables (design sections 1 and 2):
 * - T1 (safeguard S21): the checklist's tests kept out of the type check and out of both images;
 * - T2 (S22): templates/next/compose.yaml is the generated text, and the rules of the generated document;
 * - T3 (S23): the protected paths extended, and the names Compose reads without being told (S29);
 * - T5: the exported app's README (the one command under "Start it", the password command);
 * - T6: the Dockerfile (the notices file in the run stage, the install step's cache mount, the tools stage's comment);
 * - T7 (S24): the tables made by `drizzle-kit migrate` through one helper, and the drift check, against a stand-in
 *   for the tools container. Its live proof (L4) comes with a later part of the package.
 * The code under test is loaded inside each test, so that before the package each test fails on its own.
 * The step's own refusal of S29's names is tested in test/scripted-engine.test.ts, with the engine's other checks.
 *
 * Part B, the exporter (design sections 1 "Also changed in the export", 4 and 5): E1 to E10, E12 to E16, E20 and E21
 * (E11 is not in the design; E17 is part C's). The refusals of the history and of the copy are tested on
 * `writeExport` itself, with a made-up project's history (the template and example 1's two fixed steps, committed as
 * the scripted engine commits them) and a stand-in version in a made-up acceptance store, no database. The export job's
 * own rules (S9, one export per project, the event, the label and the screen, scripted only) are tested through the
 * journey with the stand-in sandboxes of test/journey-stand-ins.ts, on the test database, as test/journey.test.ts does;
 * the stand-in's `checkExport` records the call and answers as the Docker checks would (their live proof is L1).
 * No Docker, no model.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { exampleChecklist, standInSources } from "../src/acceptance/stand-in.js";
import { openStore, sha256, writeVersion, type AcceptanceStore } from "../src/acceptance/store.js";
import { commitAll, git, initProjectRepo, type ProjectRepo } from "../src/engine/project-repo.js";
import { readManifest } from "../src/engine/scripted.js";
import { JourneyJobs } from "../src/orchestrator/journey-jobs.js";
import { EV, EXPORT_LABEL, JOB_RULES, Journey } from "../src/orchestrator/journey.js";
import type { Sandbox, StreamingEnd } from "../src/sandbox/manager.js";
import { appendEvent, listEvents } from "../src/store/events.js";
import { journeyFolder } from "../src/web/files.js";
import { exportPage, t } from "../src/web/pages.js";
import { testPool } from "./helpers.js";
import { StandInSandboxes } from "./journey-stand-ins.js";

const builderDir = resolve(import.meta.dirname, "..");
const repo = resolve(builderDir, "..");
const templateDir = join(repo, "templates", "next");
const tpl = (p: string) => readFileSync(join(templateDir, p), "utf8");
const approved = (JSON.parse(readFileSync(join(builderDir, "approved-images.json"), "utf8")) as { images: Array<{ image: string; digest: string }> }).images.map((e) => `${e.image}@${e.digest}`);

const folders: string[] = [];
const folder = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  folders.push(d);
  return d;
};
afterEach(() => {
  for (const d of folders.splice(0)) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------
describe("T1 (S21): the checklist's tests are kept out of the type check and out of both images", () => {
  it("tsconfig.json still takes in every .ts file and excludes the acceptance folder", () => {
    const ts = JSON.parse(tpl("tsconfig.json")) as { include: string[]; exclude: string[] };
    expect(ts.include).toContain("**/*.ts");
    expect(ts.exclude).toContain("acceptance");
  });

  it(".dockerignore lists acceptance and .git, each on a line of its own, and no exception puts either back", () => {
    const lines = tpl(".dockerignore")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
    expect(lines).toContain("acceptance");
    expect(lines).toContain(".git");
    expect(lines.filter((l) => l.startsWith("!"))).toEqual(["!.env.example"]);
  });
});

// ---------------------------------------------------------------------------------------------------
type Mount = { type: string; source: string; target: string; read_only?: boolean; volume?: { subpath?: string } };
type Svc = {
  image?: string;
  build?: { context: string; target: string };
  pull_policy?: string;
  cap_drop?: string[];
  cap_add?: string[];
  security_opt?: string[];
  pids_limit?: number;
  mem_limit?: string;
  read_only?: boolean;
  privileged?: boolean;
  network_mode?: string;
  networks?: string[];
  ports?: Array<{ target: number; published: string; host_ip: string; protocol: string }>;
  expose?: unknown;
  volumes?: Array<Mount | string>;
  secrets?: unknown;
  env_file?: unknown;
  environment?: Record<string, string>;
  depends_on?: Record<string, { condition: string }>;
  tmpfs?: string[];
  user?: string;
  command?: string[];
  [k: string]: unknown;
};
type Doc = { name?: string; networks: Record<string, unknown>; volumes: Record<string, unknown>; services: Record<string, Svc> };
const ISOLATED = { internal: true, enable_ipv6: false, driver_opts: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" } };
const SERVICES = ["keys", "db", "setup", "app", "door"];

async function compose() {
  const m = await import("../src/export/app-compose.js");
  return { m, doc: m.appComposeDocument() as Doc };
}

describe("T2 (S22): the exported app's compose file", () => {
  it("templates/next/compose.yaml is the generated text, byte for byte (builder/src/export/app-compose.ts)", async () => {
    const { m } = await compose();
    expect(existsSync(join(templateDir, "compose.yaml"))).toBe(true);
    expect(tpl("compose.yaml")).toBe(m.appComposeYaml());
  });

  it("no project name, so Compose names the project after its folder (never builder_<id>); exactly the five services", async () => {
    const { doc } = await compose();
    expect(doc.name).toBeUndefined();
    expect(tpl("compose.yaml")).not.toMatch(/^name:/m);
    expect(Object.keys(doc.services)).toEqual(SERVICES);
    expect(Object.keys(doc.volumes).sort()).toEqual(["dbdata", "keys"]);
  });

  it("the networks: data and front exactly the sandbox's private network (internal, isolated gateway mode, IPv6 off); edge ordinary with IPv6 off; nothing else", async () => {
    const { doc } = await compose();
    expect(doc.networks).toEqual({ data: ISOLATED, front: ISOLATED, edge: { enable_ipv6: false } });
  });

  it("app, db and setup on the internal networks only; keys with no network; the door on front and edge; no service on the machine's network", async () => {
    const { doc } = await compose();
    const nets = Object.fromEntries(Object.entries(doc.services).map(([n, s]) => [n, s.networks ?? s.network_mode]));
    expect(nets).toEqual({ keys: "none", db: ["data"], setup: ["data"], app: ["data", "front"], door: ["front", "edge"] });
    for (const [n, s] of Object.entries(doc.services)) {
      expect(s.network_mode === undefined || s.network_mode === "none", n).toBe(true);
      if (s.network_mode === "none") expect(s.networks, n).toBeUndefined();
      for (const net of s.networks ?? []) if (net !== "edge") expect(doc.networks[net], `${n} ${net}`).toEqual(ISOLATED);
    }
  });

  it("the door is the only service with a port: one, on the machine's loopback address only, to the app's port, 3000 unless APP_PORT says otherwise", async () => {
    const { doc } = await compose();
    for (const n of SERVICES.filter((x) => x !== "door")) {
      expect(doc.services[n]!.ports, n).toBeUndefined();
      expect(doc.services[n]!.expose, n).toBeUndefined();
    }
    expect(doc.services.door!.ports).toEqual([{ target: 3000, published: "${APP_PORT:-3000}", host_ip: "127.0.0.1", protocol: "tcp" }]);
    expect(doc.services.door!.command!.at(-1)).toContain("n.connect(3000,'app')");
  });

  it("every service has the sandbox's hardening: every capability dropped (the database gets back its five), no new privileges, 256 processes, 1 GB, a read-only root but the database's; nothing privileged", async () => {
    const { doc } = await compose();
    for (const [n, s] of Object.entries(doc.services)) {
      expect(s.cap_drop, n).toEqual(["ALL"]);
      expect(s.security_opt, n).toEqual(["no-new-privileges:true"]);
      expect(s.pids_limit, n).toBe(256);
      expect(s.mem_limit, n).toBe("1g");
      expect(s.read_only, n).toBe(n !== "db");
      expect(s.cap_add ?? [], n).toEqual(n === "db" ? ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"] : []);
      for (const k of ["privileged", "devices", "pid", "ipc", "userns_mode", "cgroup", "sysctls", "extra_hosts", "dns"]) expect(s[k], `${n} ${k}`).toBeUndefined();
      for (const t of s.tmpfs ?? []) expect(t.startsWith("/tmp:") ? t.includes("noexec") : true, `${n} ${t}`).toBe(true);
    }
    expect(doc.services.door!.user).toBe("node");
  });

  it("only approved images, written tag@digest; the app and setup are built from the copy's own Dockerfile, its run and tools stages", async () => {
    const { doc } = await compose();
    const { DEFAULT_IMAGES } = await import("../src/sandbox/manager.js");
    expect({ keys: doc.services.keys!.image, db: doc.services.db!.image, door: doc.services.door!.image }).toEqual({ keys: DEFAULT_IMAGES.node, db: DEFAULT_IMAGES.postgres, door: DEFAULT_IMAGES.node });
    for (const n of ["keys", "db", "door"]) expect(approved, n).toContain(doc.services[n]!.image);
    expect({ app: doc.services.app!.build, setup: doc.services.setup!.build }).toEqual({ app: { context: ".", target: "run" }, setup: { context: ".", target: "tools" } });
    for (const n of ["app", "setup"]) {
      expect(doc.services[n]!.image, n).toBeUndefined();
      expect(doc.services[n]!.pull_policy, n).toBeUndefined();
    }
    for (const n of ["keys", "db", "door"]) expect(doc.services[n]!.build, n).toBeUndefined();
  });

  it("each service is given only its own key files, each alone and read-only through the volume's subpath; only keys holds the whole volume; no bind mount, secrets file or settings file", async () => {
    const { doc } = await compose();
    const keyFiles = (s: Svc) =>
      (s.volumes ?? [])
        .filter((v): v is Mount => typeof v !== "string" && v.source === "keys")
        .map((v) => {
          expect(v).toEqual({ type: "volume", source: "keys", target: `/run/secrets/${v.volume?.subpath}`, read_only: true, volume: { subpath: v.volume?.subpath } });
          return v.volume!.subpath!;
        });
    const given = Object.fromEntries(SERVICES.filter((n) => n !== "keys").map((n) => [n, keyFiles(doc.services[n]!)]));
    expect(given).toEqual({ db: ["db_password"], setup: ["db_password", "auth_secret", "sample_password"], app: ["db_password", "auth_secret"], door: [] });
    expect(doc.services.keys!.volumes).toEqual([{ type: "volume", source: "keys", target: "/keys" }]);
    expect(doc.services.db!.volumes![0]).toEqual({ type: "volume", source: "dbdata", target: "/var/lib/postgresql/data" });
    for (const [n, s] of Object.entries(doc.services)) {
      for (const v of s.volumes ?? []) expect(typeof v === "string" ? "short form" : v.type, n).toBe("volume");
      expect(s.secrets, n).toBeUndefined();
      expect(s.env_file, n).toBeUndefined();
      // No secret is written into the file: every service reads its secrets from its own files.
      expect(JSON.stringify(s.environment ?? {}), n).not.toMatch(/PASSWORD=|SECRET=|postgres:\/\/app:[^$]/);
    }
    expect(doc.services.db!.environment).toEqual({ POSTGRES_USER: "app", POSTGRES_PASSWORD_FILE: "/run/secrets/db_password", POSTGRES_DB: "app" });
  });

  it("the keys service makes exactly the three files, mode 0444, keeps one that is there, and has no network; the start's order: keys, db, setup, app, door", async () => {
    const { doc, m } = await compose();
    const script = doc.services.keys!.command!.at(-1)!;
    expect(doc.services.keys!.command).toEqual(["node", "-e", m.KEYS_SCRIPT]);
    expect(script).toContain("['db_password',18,''],['auth_secret',32,''],['sample_password',12,'Sample-']");
    expect(script).toContain("{mode: 0o444}");
    expect(script).toContain("console.log('kept '+n);continue");
    expect(Object.fromEntries(SERVICES.map((n) => [n, doc.services[n]!.depends_on ?? null]))).toEqual({
      keys: null,
      db: { keys: { condition: "service_completed_successfully" } },
      setup: { db: { condition: "service_healthy" } },
      app: { setup: { condition: "service_completed_successfully" } },
      door: { app: { condition: "service_healthy" } },
    });
    // The browser's address is the app's own APP_URL (sign-in accepts only that origin).
    expect(doc.services.app!.environment).toEqual({ PORT: "3000", APP_URL: "http://localhost:${APP_PORT:-3000}" });
    expect(doc.services.setup!.environment).toEqual({ APP_URL: "http://localhost:${APP_PORT:-3000}" });
  });
});

// ---------------------------------------------------------------------------------------------------
const NEW_PROTECTED = [
  "compose.yaml",
  "README.md",
  "drizzle/0000_template.sql",
  "drizzle/meta/0000_snapshot.json",
  "THIRD-PARTY-NOTICES.md",
  "licence-rule.json",
  "scripts/licence/check.ts",
  "scripts/licence/rule.ts",
  "scripts/check-licences.sh",
  "scripts/check-lock.mjs",
];

describe("T3 (S23): the protected paths, and the names Compose and the image build read without being told (S29)", () => {
  it("the protected paths hold the start files, the template's own first migration and the six licence files, each a plain file of the template; not the journal, which the data step replaces", async () => {
    const { TEMPLATE_PROTECTED_PATHS } = await import("../src/engine/scripted.js");
    for (const p of NEW_PROTECTED) {
      expect(TEMPLATE_PROTECTED_PATHS, p).toContain(p);
      expect(lstatSync(join(templateDir, p), { throwIfNoEntry: false })?.isFile(), p).toBe(true);
    }
    expect(TEMPLATE_PROTECTED_PATHS).not.toContain("drizzle/meta/_journal.json");
    expect(TEMPLATE_PROTECTED_PATHS).not.toContain("drizzle");
  });

  it("S29's names: the four override files and the three other main files at any depth, and any *.dockerignore but the root one; never compose.yaml or the root .dockerignore", async () => {
    const { readWithoutBeingTold, COMPOSE_READ_NAMES } = await import("../src/export/app-compose.js");
    expect([...COMPOSE_READ_NAMES]).toEqual(["compose.override.yaml", "compose.override.yml", "docker-compose.override.yaml", "docker-compose.override.yml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"]);
    for (const n of COMPOSE_READ_NAMES) for (const p of [n, `deploy/${n}`, `a/b/${n}`, n.toUpperCase()]) expect(readWithoutBeingTold(p), p).toBe(true);
    for (const p of ["Dockerfile.dockerignore", "run.Dockerfile.dockerignore", "src/.dockerignore", "x.dockerignore", ".DOCKERIGNORE"]) expect(readWithoutBeingTold(p), p).toBe(true);
    for (const p of ["compose.yaml", ".dockerignore", "src/compose.yaml.txt", "docs/compose.override.yaml.md", "Dockerfile", "README.md", "drizzle/meta/_journal.json"])
      expect(readWithoutBeingTold(p), p).toBe(false);
    // The template itself holds none of them.
    const walk = (dir: string, rel = ""): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) return ["node_modules", ".next"].includes(e.name) ? [] : walk(join(dir, e.name), p);
        return [p];
      });
    expect(walk(templateDir).filter(readWithoutBeingTold)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
/** The text under a level-2 heading of a Markdown file, up to the next level-2 heading. */
function section(md: string, heading: string): string {
  const start = md.indexOf(`\n## ${heading}\n`);
  if (start < 0) return "";
  const rest = md.slice(start + heading.length + 5);
  const next = rest.indexOf("\n## ");
  return next < 0 ? rest : rest.slice(0, next);
}
const codeBlocks = (md: string) => [...md.matchAll(/^```[^\n]*\n([\s\S]*?)^```$/gm)].map((m) => m[1]!.trim());

describe("T5: the exported app's README", () => {
  const md = () => tpl("README.md");

  it('"Start it" holds exactly one code block, the one command: docker compose up --build', () => {
    expect(codeBlocks(section(md(), "Start it"))).toEqual(["docker compose up --build"]);
  });

  it("says to open http://localhost:3000, not 127.0.0.1, and how APP_PORT changes the port", () => {
    const start = section(md(), "Start it");
    expect(start).toContain("http://localhost:3000");
    expect(start).toContain("not 127.0.0.1: sign-in accepts only the address it was given");
    expect(start).toContain("APP_PORT");
  });

  it("the three made-up users and how to see their password, made at the first start and written nowhere in the folder; the command matches the keys service", async () => {
    const text = md();
    expect(text).not.toContain("the sample password the builder gave you");
    for (const u of ["employee@example.test", "manager@example.test", "hr.admin@example.test"]) expect(text).toContain(u);
    expect(text).toContain("written nowhere in this folder");
    const cmd = "docker compose run --rm --no-deps keys cat /keys/sample_password";
    expect(codeBlocks(section(text, "The made-up users"))).toEqual([cmd]);
    // The command reads the file the keys service makes, where that service mounts the whole volume.
    const { doc, m } = await compose();
    expect(doc.services.keys!.volumes).toEqual([{ type: "volume", source: "keys", target: "/keys" }]);
    expect(m.KEY_FILES).toContain("sample_password");
  });

  it("internal only, not for customers, with why; how to stop and remove everything; the checklist's tests and why the runner is not included", () => {
    const text = md();
    expect(text).toContain("**Internal only, not for customers.**");
    expect(text).toContain("approved for the builder's internal development and testing only");
    expect(section(text, "Stop it")).toContain("`docker compose down`");
    expect(section(text, "Stop it")).toContain("`docker compose down --volumes`");
    const tests = section(text, "The checklist's tests");
    expect(tests).toContain("`acceptance/`");
    expect(tests).toContain("never given to anyone");
  });

  it("the template's own sections stay: the ten rules, the role guard, sharp", () => {
    const text = md();
    for (const h of ["What the template guarantees (the ten quality rules)", "The role guard (rule 5)", "The image library `sharp` is not installed"]) expect(section(text, h), h).not.toBe("");
  });
});

// ---------------------------------------------------------------------------------------------------
/** A Dockerfile's instructions, by stage: comment lines dropped, continued lines joined (as test/sandbox.test.ts reads it). */
function stages(text: string): Array<{ from: string; lines: string[] }> {
  const out: Array<{ from: string; lines: string[] }> = [];
  let current = "";
  const push = (i: string) => {
    if (/^FROM\s/i.test(i)) out.push({ from: i, lines: [] });
    else out.at(-1)?.lines.push(i);
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#") || (!current && line === "")) continue;
    const continued = line.endsWith("\\");
    const part = continued ? line.slice(0, -1).trim() : line;
    current = current ? `${current} ${part}`.trim() : part;
    if (!continued) {
      push(current.replace(/^(\S+)/, (k) => k.toUpperCase()));
      current = "";
    }
  }
  return out;
}

describe("T6: the template's Dockerfile", () => {
  const df = () => tpl("Dockerfile");

  it("the run stage copies the notices file into /app", () => {
    const run = stages(df()).find((s) => / AS run$/i.test(s.from))!;
    expect(run.lines).toContain("WORKDIR /app");
    expect(run.lines.filter((l) => /^COPY\s/.test(l) && l.includes("THIRD-PARTY-NOTICES.md"))).toEqual(["COPY --from=build /app/THIRD-PARTY-NOTICES.md ./THIRD-PARTY-NOTICES.md"]);
  });

  it("the install step keeps npm's downloads in a cache mount and uses them first, with install scripts still off", () => {
    const build = stages(df()).find((s) => / AS build$/i.test(s.from))!;
    expect(build.lines.filter((l) => /npm ci/.test(l))).toEqual(["RUN --mount=type=cache,id=house-template-npm,target=/root/.npm npm ci --prefer-offline --ignore-scripts --no-fund --no-audit"]);
  });

  it("the tools stage's comment says it runs at each start of an exported copy, as the setup service, and no longer that it is never shipped", () => {
    expect(df()).not.toContain("is not shipped to anyone");
    expect(df()).toMatch(/in an exported copy it runs at each start as the `setup` service/);
  });
});

// ---------------------------------------------------------------------------------------------------
const SCRIPTS = ["scripts/example-1-sandbox.ts", "scripts/demo-scripted.ts", "scripts/demo-template.ts"];
const fakeSb = { dir: "/nowhere", composeFile: "/nowhere/compose.yaml", projectName: "builder_p_unit" } as Sandbox;

/** A stand-in for the tools container: records each call; the drift check's run does what `behaviour` says to the mounted copy. */
function standIn(behaviour: (copy: string) => { lines: string[]; stderr?: string; code: number }) {
  const calls: Array<{ kind: "once" | "streaming"; service: string; cmd: string[]; volumes?: string[]; copySeen?: Record<string, string>; timeoutMs?: number; container?: string }> = [];
  const snapshot = (dir: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const walk = (d: string, rel: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(join(d, e.name), p);
        else out[p] = readFileSync(join(d, e.name), "utf8");
      }
    };
    walk(dir, "");
    return out;
  };
  const runner = {
    runOnce: async (_sb: Sandbox, service: string, cmd: string[]) => {
      calls.push({ kind: "once", service, cmd });
      return "[✓] migrations applied successfully!\n";
    },
    runStreaming: (_sb: Sandbox, service: string, cmd: string[], opts: { container: string; volumes: string[]; onLine: (l: string) => void; timeoutMs: number }) => {
      const copy = opts.volumes[0]!.split(":")[0]!;
      calls.push({ kind: "streaming", service, cmd, volumes: opts.volumes, copySeen: snapshot(copy), timeoutMs: opts.timeoutMs, container: opts.container });
      const r = behaviour(copy);
      for (const l of r.lines) opts.onLine(l);
      return { container: opts.container, done: Promise.resolve<StreamingEnd>({ code: r.code, stderrTail: r.stderr ?? "" }), kill: async () => undefined };
    },
  };
  return { calls, runner };
}

/** A workspace as step 01 leaves it: the template's drizzle/ folder with step 01's migration files over it. */
function workspaceAfterStep01(): string {
  const ws = folder("x32-ws-");
  cpSync(join(templateDir, "drizzle"), join(ws, "drizzle"), { recursive: true });
  cpSync(join(builderDir, "scripted", "example-1", "01-data", "files", "drizzle"), join(ws, "drizzle"), { recursive: true });
  return ws;
}
const NO_CHANGE = ["No config path provided, using default 'drizzle.config.ts'", "Reading config file '/app/drizzle.config.ts'", "", "No schema changes, nothing to migrate 😴"];

describe("T7 (S24): the tables, made by drizzle-kit migrate through one helper, and the drift check", () => {
  it("the builder's sandbox and the two demonstration scripts make the tables with the one helper; nothing in the builder pushes the schema", () => {
    for (const s of SCRIPTS) {
      const text = readFileSync(join(builderDir, s), "utf8");
      expect(text, s).toContain('from "../src/sandbox/tables.js"');
      expect(text, s).toMatch(/await makeTables\(/);
    }
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(ts|mts|mjs)$/.test(e.name) ? [join(dir, e.name)] : []));
    const pushing = [...files(join(builderDir, "src")), ...files(join(builderDir, "scripts"))].filter((f) => /drizzle-kit["'`]\s*,\s*["'`]push|["'`]push["'`]\s*,\s*["'`]--force/.test(readFileSync(f, "utf8")));
    expect(pushing.map((f) => f.slice(builderDir.length + 1))).toEqual([]);
  });

  it("makeTables: drizzle-kit migrate in the tools container, then drizzle-kit generate with a temporary copy of drizzle/ mounted over the image's; it passes on \"No schema changes\" with nothing written; the copy is removed, the workspace untouched", async () => {
    const { makeTables, MIGRATE_COMMAND, DRIFT_COMMAND } = await import("../src/sandbox/tables.js");
    expect([...MIGRATE_COMMAND]).toEqual(["node_modules/.bin/drizzle-kit", "migrate"]);
    expect([...DRIFT_COMMAND]).toEqual(["node_modules/.bin/drizzle-kit", "generate", "--name=drift_check"]);
    const ws = workspaceAfterStep01();
    const scratch = folder("x32-scratch-");
    const before = readdirSync(join(ws, "drizzle", "meta")).sort();
    const s = standIn(() => ({ lines: NO_CHANGE, code: 0 }));
    const r = await makeTables(fakeSb, { workspace: ws, scratchDir: scratch }, s.runner);
    expect(s.calls.map((c) => [c.kind, c.service, c.cmd])).toEqual([
      ["once", "tools", ["node_modules/.bin/drizzle-kit", "migrate"]],
      ["streaming", "tools", ["node_modules/.bin/drizzle-kit", "generate", "--name=drift_check"]],
    ]);
    const drift = s.calls[1]!;
    const [source, target, extra] = drift.volumes![0]!.split(":");
    expect(drift.volumes).toHaveLength(1);
    expect([target, extra]).toEqual(["/app/drizzle", undefined]);
    expect(source!.startsWith(scratch + "/")).toBe(true);
    expect(source).not.toBe(join(ws, "drizzle"));
    // The copy held exactly the workspace's migrations.
    expect(Object.keys(drift.copySeen!).sort()).toEqual(["0000_template.sql", "0001_leave_request.sql", "meta/0000_snapshot.json", "meta/0001_snapshot.json", "meta/_journal.json"]);
    expect(drift.copySeen!["meta/_journal.json"]).toBe(readFileSync(join(ws, "drizzle", "meta", "_journal.json"), "utf8"));
    expect(drift.container).toMatch(/^builder_p_unit-drift-check-[0-9a-f]{6}$/);
    expect(drift.timeoutMs).toBeGreaterThan(0);
    expect(r.drift).toMatchObject({ ok: true, exitCode: 0, added: [], changed: [], removed: [] });
    expect(r.drift.output).toContain("No schema changes, nothing to migrate");
    expect(r.migrate).toContain("migrations applied successfully");
    expect(readdirSync(scratch)).toEqual([]);
    expect(readdirSync(join(ws, "drizzle", "meta")).sort()).toEqual(before);
  });

  it("the drift check fails, naming what generate wrote, when generate writes a migration and exits 0 (measured: a schema change with no migration)", async () => {
    const { makeTables, driftCheck } = await import("../src/sandbox/tables.js");
    const ws = workspaceAfterStep01();
    const scratch = folder("x32-scratch-");
    const writes = (copy: string) => {
      writeFileSync(join(copy, "0002_drift_check.sql"), 'ALTER TABLE "leave_request" ADD COLUMN "note" text;');
      writeFileSync(join(copy, "meta", "0002_snapshot.json"), "{}\n");
      writeFileSync(join(copy, "meta", "_journal.json"), "{}\n");
      return { lines: ["[✓] Your SQL migration file ➜ drizzle/0002_drift_check.sql 🚀"], code: 0 };
    };
    const d = await driftCheck(fakeSb, ws, scratch, standIn(writes).runner);
    expect(d).toMatchObject({ ok: false, exitCode: 0, added: ["0002_drift_check.sql", "meta/0002_snapshot.json"], changed: ["meta/_journal.json"], removed: [] });
    expect(d.reason).toMatch(/did not say "No schema changes, nothing to migrate", and it wrote 0002_drift_check\.sql \(added\), meta\/0002_snapshot\.json \(added\), meta\/_journal\.json \(changed\)/);
    await expect(makeTables(fakeSb, { workspace: ws, scratchDir: scratch }, standIn(writes).runner)).rejects.toThrow(/drift check did not pass: .*0002_drift_check\.sql/);
    expect(readdirSync(scratch)).toEqual([]);
    expect(existsSync(join(ws, "drizzle", "0002_drift_check.sql"))).toBe(false);
  });

  it("the drift check fails when generate does not say \"No schema changes\", whatever its exit code (measured: a write refused, exit 0)", async () => {
    const { driftCheck } = await import("../src/sandbox/tables.js");
    const ws = workspaceAfterStep01();
    for (const code of [0, 1, null]) {
      const d = await driftCheck(fakeSb, ws, folder("x32-scratch-"), standIn(() => ({ lines: ["  code: 'EROFS',", "  syscall: 'open',"], code: code as number })).runner);
      expect(d, String(code)).toMatchObject({ ok: false, exitCode: code, added: [], changed: [], removed: [] });
      expect(d.reason).toMatch(/did not say "No schema changes, nothing to migrate"/);
    }
  });

  it("the drift check fails when generate says \"No schema changes\" but the copy changed: a file added, changed or removed", async () => {
    const { driftCheck } = await import("../src/sandbox/tables.js");
    const ws = workspaceAfterStep01();
    const cases: Array<[string, (copy: string) => void, Record<string, string[]>]> = [
      ["added", (c) => writeFileSync(join(c, "0002_x.sql"), "select 1;"), { added: ["0002_x.sql"], changed: [], removed: [] }],
      ["changed", (c) => writeFileSync(join(c, "meta", "_journal.json"), "{}\n"), { added: [], changed: ["meta/_journal.json"], removed: [] }],
      ["removed", (c) => rmSync(join(c, "0001_leave_request.sql")), { added: [], changed: [], removed: ["0001_leave_request.sql"] }],
    ];
    for (const [name, change, want] of cases) {
      const d = await driftCheck(fakeSb, ws, folder("x32-scratch-"), standIn((c) => (change(c), { lines: NO_CHANGE, code: 0 })).runner);
      expect(d, name).toMatchObject({ ok: false, ...want });
      expect(d.reason, name).toMatch(/said "No schema changes, nothing to migrate" but the migrations folder changed/);
    }
  });

  it("the drift check refuses a drizzle/ folder that holds a link, or none at all, before any container is asked for", async () => {
    const { driftCheck } = await import("../src/sandbox/tables.js");
    const ws = workspaceAfterStep01();
    const outside = folder("x32-outside-");
    writeFileSync(join(outside, "x.sql"), "select 1;");
    symlinkSync(join(outside, "x.sql"), join(ws, "drizzle", "0002_link.sql"));
    const s = standIn(() => ({ lines: NO_CHANGE, code: 0 }));
    await expect(driftCheck(fakeSb, ws, folder("x32-scratch-"), s.runner)).rejects.toThrow(/drizzle\/ holds something other than plain files and folders: 0002_link\.sql/);
    const empty = folder("x32-ws-");
    mkdirSync(join(empty, "src"));
    await expect(driftCheck(fakeSb, empty, folder("x32-scratch-"), s.runner)).rejects.toThrow(/no drizzle\/ folder/);
    expect(s.calls).toEqual([]);
  });

  it("the exported app's setup service makes the tables the same way, drizzle-kit migrate, then the seed; it never pushes", async () => {
    const { doc } = await compose();
    const cmd = doc.services.setup!.command!;
    expect(cmd.slice(0, 2)).toEqual(["sh", "-c"]);
    expect(cmd[2]).toMatch(/; node_modules\/\.bin\/drizzle-kit migrate; exec node --import tsx scripts\/seed\.ts$/);
    expect(cmd[2]).toMatch(/^set -eu; /);
    expect(cmd[2]).not.toMatch(/push/);
  });
});

// ===================================================================================================
// Part B: the exporter (design sections 1 "Also changed in the export", 4 and 5)
// ===================================================================================================

const SCRIPTED = join(builderDir, "scripted");
/** The development-only names of the licence approval of 12 Nov 2026 (DEC:45; templates/next/licence-rule.json). */
const FOURTEEN = [
  "lightningcss",
  "lightningcss-android-arm64",
  "lightningcss-darwin-arm64",
  "lightningcss-darwin-x64",
  "lightningcss-freebsd-x64",
  "lightningcss-linux-arm-gnueabihf",
  "lightningcss-linux-arm64-gnu",
  "lightningcss-linux-arm64-musl",
  "lightningcss-linux-x64-gnu",
  "lightningcss-linux-x64-musl",
  "lightningcss-win32-arm64-msvc",
  "lightningcss-win32-x64-msvc",
  "spdx-exceptions",
  "spdx-ranges",
];
/** S13: the files an exported copy must hold exactly as the builder's own template copies. */
const FIXED = [
  "compose.yaml",
  "README.md",
  "Dockerfile",
  ".dockerignore",
  "tsconfig.json",
  "package.json",
  "package-lock.json",
  "THIRD-PARTY-NOTICES.md",
  "licence-rule.json",
  "scripts/licence/check.ts",
  "scripts/licence/rule.ts",
  "scripts/check-licences.sh",
  "scripts/check-lock.mjs",
  "drizzle/0000_template.sql",
  "drizzle/meta/0000_snapshot.json",
];
/** Section 4's checks, in order: items 1 and 2 on the machine, reading only; items 3 to 7 through `checkExport`. */
const CHECK_IDS = ["archive_contents", "fixed_files", "images_built", "compose_config", "run_image_packages", "run_image_notices", "tools_image_packages", "licence_check"];
const DOCKER_CHECK_IDS = CHECK_IDS.slice(2);
const passingDockerChecks = () => DOCKER_CHECK_IDS.map((id) => ({ id, passed: true, summary: `made-up ${id} (the test's stand-in: no Docker)` }));

interface Made {
  root: string;
  repo: ProjectRepo;
  store: AcceptanceStore;
  projectId: string;
  version: string;
  manifestSha256: string;
  exportsDir: string;
  /** A file outside every copy, for the link probes. */
  outside: string;
}

/**
 * A made-up project as the journey leaves it at sign-off: the template copied as the sandbox copies it, its history
 * made, example 1's two fixed steps written and committed as the scripted engine commits them; and its tests, a
 * stand-in version written to a made-up acceptance store. No database, no container.
 */
async function madeProject(): Promise<Made> {
  const root = folder("x32b-");
  const workspace = join(root, "workspace");
  cpSync(templateDir, workspace, { recursive: true, filter: (src) => !/\/(node_modules|\.next|certs|\.env(\.(?!example$)[^/]*)?)(\/|$)/.test(src) });
  const repo = { gitDir: join(root, "workspace.git"), workTree: workspace };
  await initProjectRepo(repo, "Template copy (made-up project of the export tests)");
  for (const step of ["01-data", "02-submitter-screen"]) {
    for (const f of readManifest(SCRIPTED, "example-1", step).files) {
      mkdirSync(dirname(join(workspace, f.path)), { recursive: true });
      copyFileSync(join(SCRIPTED, "example-1", step, "files", f.path), join(workspace, f.path));
    }
    await commitAll(repo, "Scripted engine <scripted-engine@example.invalid>", `[scripted] example-1 ${step}`);
  }
  const projectId = `j1-${randomBytes(6).toString("hex")}`;
  mkdirSync(join(root, "data"));
  const store = openStore(join(root, "data"));
  const written = writeVersion(store, projectId, {
    writtenBy: "stand-in",
    appSpecSha256: exampleChecklist("example-1").sha256,
    items: standInSources("example-1").map((s) => ({ ...s, checklist: "made-up checklist line of the export tests" })),
  });
  const outside = join(root, "outside.txt");
  writeFileSync(outside, "made-up file outside the copy: never written by the exporter\n");
  return { root, repo, store, projectId, version: written.version, manifestSha256: written.manifestSha256, exportsDir: join(root, "data", "journey", projectId, "exports"), outside };
}

type ExportModule = typeof import("../src/orchestrator/export.js");
const exporter = (): Promise<ExportModule> => import("../src/orchestrator/export.js");

/** writeExport on a made-up project, with the Docker checks stood in for; `extra` overrides any field. */
async function exportOf(p: Made, extra: Record<string, unknown> = {}) {
  const { writeExport } = await exporter();
  return writeExport({ repo: p.repo, store: p.store, projectId: p.projectId, version: p.version, exportsDir: p.exportsDir, runManifestSha256: p.manifestSha256, check: async () => passingDockerChecks(), ...extra } as Parameters<ExportModule["writeExport"]>[0]);
}

/** Commit in the made-up project's history, as a step with file or shell tools could (the test, not the engine). */
async function commitInHistory(p: Made, message: string, change: (ws: string) => void | Promise<void>): Promise<void> {
  await change(p.repo.workTree);
  await git(p.repo, ["add", "--all"]);
  await git(p.repo, ["commit", "--quiet", "--no-verify", "-m", message]);
}

/** Nothing in the exports folder: no archive, no part-written file, no staging folder. */
const leftInExports = (p: Made) => (existsSync(p.exportsDir) ? readdirSync(p.exportsDir) : []);
const finalPath = (p: Made) => join(p.exportsDir, `${p.projectId}-export.tar.gz`);

describe("Part B, writeExport: a made-up project's export, with the Docker checks stood in for (no database, no container)", () => {
  it("a made-up project exports, with the checks of section 4 in order (items 1 and 2 on the machine, 3 to 7 from checkExport, given the packed archive before it is placed), and the README's command", async () => {
    const p = await madeProject();
    const seen: Array<{ path: string; sha256: string; existed: boolean; finalExisted: boolean; unpackDir: string }> = [];
    const r = await exportOf(p, {
      check: async (a: { path: string; sha256: string; unpackDir: string }) => {
        seen.push({ path: a.path, sha256: a.sha256, existed: existsSync(a.path), finalExisted: existsSync(finalPath(p)), unpackDir: a.unpackDir });
        return passingDockerChecks();
      },
    });
    expect(r.path).toBe(finalPath(p));
    expect(sha256(readFileSync(r.path))).toBe(r.sha256);
    expect(statSync(r.path).mode & 0o777).toBe(0o600);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ sha256: r.sha256, existed: true, finalExisted: false });
    expect(seen[0]!.path).not.toBe(r.path);
    expect(seen[0]!.unpackDir.startsWith(p.exportsDir + "/")).toBe(true);
    expect(r.checks.map((c: { id: string; passed: boolean }) => [c.id, c.passed])).toEqual(CHECK_IDS.map((id) => [id, true]));
    expect(r.readmeCommand).toBe("docker compose up --build");
    expect(r.manifestSha256).toBe(p.manifestSha256);
    expect(r.items.map((i: { number: number; file: string }) => [i.number, i.file])).toEqual([[1, "item-01.spec.ts"]]);
    expect(leftInExports(p)).toEqual([`${p.projectId}-export.tar.gz`]);
    // The clone took an empty template: git's sample hooks are not shipped.
    const listing = execFileSync("tar", ["-tzf", r.path], { encoding: "utf8" }).split("\n");
    expect(listing.filter((l) => l.includes("/.git/hooks/"))).toEqual([]);
    expect(listing).toContain(`${p.projectId}/compose.yaml`);
  });

  it("E1 (S1): a history in which any commit holds a symbolic link is refused, the link named; F1's probe (EXPORT-NOTE.txt a link to a file outside) leaves the outside file unchanged; no archive is written", async () => {
    const p = await madeProject();
    await commitInHistory(p, "a made-up link to a file outside the copy", (ws) => symlinkSync(p.outside, join(ws, "public", "made-up-link.txt")));
    await commitInHistory(p, "the made-up link removed again", (ws) => rmSync(join(ws, "public", "made-up-link.txt")));
    await expect(exportOf(p)).rejects.toThrow("The project's history holds a symbolic link or a submodule (public/made-up-link.txt (a symbolic link)); the export is refused.");
    expect(leftInExports(p)).toEqual([]);
    const f1 = await madeProject();
    const before = readFileSync(f1.outside, "utf8");
    await commitInHistory(f1, "F1's probe: EXPORT-NOTE.txt a link to a file outside the copy", (ws) => symlinkSync(f1.outside, join(ws, "EXPORT-NOTE.txt")));
    await expect(exportOf(f1)).rejects.toThrow(/EXPORT-NOTE\.txt/);
    expect(readFileSync(f1.outside, "utf8")).toBe(before);
    expect(leftInExports(f1)).toEqual([]);
  });

  it("E1b (S2): the exporter's own files are created exclusively, never through a link: a link planted at EXPORT-NOTE.txt after the clone and its checks is refused, and the file outside is unchanged", async () => {
    const p = await madeProject();
    const before = readFileSync(p.outside, "utf8");
    await expect(exportOf(p, { hooks: { beforeWrites: (top: string) => symlinkSync(p.outside, join(top, "EXPORT-NOTE.txt")) } })).rejects.toThrow(
      /The exporter could not create EXPORT-NOTE\.txt as a new plain file .*; the export is refused\./,
    );
    expect(readFileSync(p.outside, "utf8")).toBe(before);
    expect(leftInExports(p)).toEqual([]);
  });

  it("E2 (S1): a history holding a submodule is refused, the submodule named", async () => {
    const p = await madeProject();
    const head = (await git(p.repo, ["rev-parse", "HEAD"])).trim();
    await git(p.repo, ["update-index", "--add", "--cacheinfo", `160000,${head},lib/made-up-submodule`]);
    await git(p.repo, ["commit", "--quiet", "--no-verify", "-m", "a made-up submodule"]);
    await expect(exportOf(p)).rejects.toThrow("The project's history holds a symbolic link or a submodule (lib/made-up-submodule (a submodule)); the export is refused.");
    expect(leftInExports(p)).toEqual([]);
  });

  it("E3 (S3): EXPORT-NOTE.txt in any commit (a plain file, removed again later) is refused, not overwritten", async () => {
    const p = await madeProject();
    await commitInHistory(p, "a made-up EXPORT-NOTE.txt", (ws) => writeFileSync(join(ws, "EXPORT-NOTE.txt"), "made-up note, not the exporter's\n"));
    await commitInHistory(p, "removed again", (ws) => rmSync(join(ws, "EXPORT-NOTE.txt")));
    await expect(exportOf(p)).rejects.toThrow("The project's history holds EXPORT-NOTE.txt, which only the exporter writes; the export is refused.");
    expect(leftInExports(p)).toEqual([]);
  });

  it("E4 (S4): the export commit must add exactly the intended files: one more file in the acceptance folder before the commit is refused", async () => {
    const p = await madeProject();
    const hooks = { beforeCommit: (top: string) => writeFileSync(join(top, "acceptance", p.version, "extra.txt"), "made-up extra file\n") };
    await expect(exportOf(p, { hooks })).rejects.toThrow(/The export commit does not add exactly the intended files as plain files with the intended content \(.*acceptance\/v001\/extra\.txt.*\); the export is refused\./);
    expect(leftInExports(p)).toEqual([]);
  });

  it("E5 (S5): a checkout whose bytes differ from what the history holds (a .gitattributes turning line ends into CRLF) is refused", async () => {
    const p = await madeProject();
    await commitInHistory(p, "a made-up .gitattributes", (ws) => writeFileSync(join(ws, ".gitattributes"), "* text eol=crlf\n"));
    await expect(exportOf(p)).rejects.toThrow(/The exported copy's checkout is not byte for byte what its history holds \(.*\); the export is refused\./);
    expect(leftInExports(p)).toEqual([]);
  });

  it("E6 (S6, a regression guard): an acceptance folder anywhere in the history is refused", async () => {
    const p = await madeProject();
    await commitInHistory(p, "a made-up acceptance folder", (ws) => {
      mkdirSync(join(ws, "acceptance"));
      writeFileSync(join(ws, "acceptance", "made-up.txt"), "made-up\n");
    });
    await commitInHistory(p, "removed again", (ws) => rmSync(join(ws, "acceptance"), { recursive: true }));
    await expect(exportOf(p)).rejects.toThrow("The workspace history holds an acceptance folder, which it must never hold; the export is refused.");
    expect(leftInExports(p)).toEqual([]);
  });

  it("E7 (S8, a regression guard): a version that does not match its manifest is refused", async () => {
    const p = await madeProject();
    const item = join(p.store.root, p.projectId, p.version, "item-01.spec.ts");
    writeFileSync(item, `${readFileSync(item, "utf8")}// made-up line added after the version was written\n`);
    await expect(exportOf(p)).rejects.toThrow(/The acceptance version v001 does not match its manifest \(item-01\.spec\.ts does not match its fingerprint in the manifest\); the export is refused\./);
    expect(leftInExports(p)).toEqual([]);
  });

  it("E8 (S10, a regression guard): the workspace history moved while the export was made (a hook commits in it) is refused", async () => {
    const p = await madeProject();
    const hooks = { afterCommit: () => commitInHistory(p, "made-up commit while the export is made", (ws) => writeFileSync(join(ws, "public", "moved.txt"), "made-up\n")) };
    await expect(exportOf(p, { hooks })).rejects.toThrow("The workspace history changed while the export was made; the export is refused.");
    expect(leftInExports(p)).toEqual([]);
  });

  it("S9 in writeExport: the version's manifest must be the one the passing run checked", async () => {
    const p = await madeProject();
    const other = "0".repeat(64);
    await expect(exportOf(p, { runManifestSha256: other })).rejects.toThrow(`The acceptance version's manifest (SHA-256 ${p.manifestSha256}) is not the one the passing run checked (${other}); the export is refused.`);
    expect(leftInExports(p)).toEqual([]);
  });

  it("E10 (S12): one export per project in writeExport: refused when the archive exists, which is left as it was; the archive is moved into place only if none has appeared meanwhile; a failed export leaves no file", async () => {
    const p = await madeProject();
    const first = await exportOf(p);
    const body = readFileSync(first.path);
    await expect(exportOf(p)).rejects.toThrow(`An export of this project exists already (${p.projectId}-export.tar.gz); one export per project, so the export is refused.`);
    expect(readFileSync(first.path).equals(body)).toBe(true);
    expect(leftInExports(p)).toEqual([`${p.projectId}-export.tar.gz`]);
    // A file appears at the final name while the export is made: the archive is not moved over it.
    const q = await madeProject();
    const planted = "made-up file put at the archive's name while the export was made\n";
    await expect(exportOf(q, { beforePlace: () => writeFileSync(finalPath(q), planted) })).rejects.toThrow(/An export of this project exists already/);
    expect(readFileSync(finalPath(q), "utf8")).toBe(planted);
    expect(leftInExports(q)).toEqual([`${q.projectId}-export.tar.gz`]);
    // A Docker check that did not pass: refused, naming it, and nothing is left in the exports folder.
    const r = await madeProject();
    const failing = passingDockerChecks().map((c) => (c.id === "licence_check" ? { ...c, passed: false, summary: "made-up licence check that did not pass" } : c));
    await expect(exportOf(r, { check: async () => failing })).rejects.toThrow('The export check "made-up licence check that did not pass" did not pass; the export is refused.');
    expect(leftInExports(r)).toEqual([]);
    // A check that reports fewer than the six checks of items 3 to 7 is refused too.
    await expect(exportOf(r, { check: async () => passingDockerChecks().slice(1) })).rejects.toThrow("The export checks did not report images_built; the export is refused.");
    expect(leftInExports(r)).toEqual([]);
  });

  it("E12 (S14): the drizzle/ folder must match its journal: a missing file, an extra file, no folder", async () => {
    const cases: Array<[string, (ws: string) => void, RegExp]> = [
      ["a missing file", (ws) => rmSync(join(ws, "drizzle", "0001_leave_request.sql")), /drizzle\/0001_leave_request\.sql is missing/],
      ["an extra file", (ws) => writeFileSync(join(ws, "drizzle", "0002_made_up.sql"), "select 1;\n"), /drizzle\/0002_made_up\.sql is not in the journal/],
      ["no folder", (ws) => rmSync(join(ws, "drizzle"), { recursive: true }), /there is no drizzle\/ folder/],
    ];
    for (const [what, change, why] of cases) {
      const p = await madeProject();
      await commitInHistory(p, `made-up change to drizzle/: ${what}`, change);
      const err = await exportOf(p).then(
        () => null,
        (e: Error) => e.message,
      );
      expect(err, what).toMatch(/^The exported copy's drizzle\/ folder does not match its journal \(/);
      expect(err, what).toMatch(why);
      expect(leftInExports(p), what).toEqual([]);
    }
  });

  it("E13 (S13): each fixed file changed in turn is refused, the file named: the start files, the build files, the six licence files and the template's first migration", async () => {
    const p = await madeProject();
    const base = (await git(p.repo, ["rev-parse", "HEAD"])).trim();
    for (const f of FIXED) {
      await commitInHistory(p, `made-up change to ${f}`, (ws) => writeFileSync(join(ws, f), `${readFileSync(join(ws, f), "utf8")}\n`));
      await expect(exportOf(p), f).rejects.toThrow(`The exported copy's fixed files differ from the builder's own template copies (${f}); the export is refused.`);
      await git(p.repo, ["reset", "--quiet", "--hard", base]);
    }
    await commitInHistory(p, "made-up removal of the compose file", (ws) => rmSync(join(ws, "compose.yaml")));
    await expect(exportOf(p)).rejects.toThrow("The exported copy's fixed files differ from the builder's own template copies (compose.yaml (missing)); the export is refused.");
    expect(leftInExports(p)).toEqual([]);
  });

  it("E21 (S29): each name Docker Compose or the image build reads without being told, in an earlier commit, is refused, the file named", async () => {
    const names = ["compose.override.yaml", "compose.override.yml", "docker-compose.override.yaml", "docker-compose.override.yml", "compose.yml", "docker-compose.yaml", "docker-compose.yml", "Dockerfile.dockerignore", "src/made-up.dockerignore", "deploy/compose.override.yaml"];
    const p = await madeProject();
    const base = (await git(p.repo, ["rev-parse", "HEAD"])).trim();
    for (const n of names) {
      await commitInHistory(p, `made-up ${n}`, (ws) => {
        mkdirSync(dirname(join(ws, n)), { recursive: true });
        writeFileSync(join(ws, n), "services: {}\n");
      });
      await commitInHistory(p, `${n} removed again`, (ws) => rmSync(join(ws, n)));
      await expect(exportOf(p), n).rejects.toThrow(`The project's history holds files that Docker Compose or the image build would read without being told (${n}); the export is refused.`);
      await git(p.repo, ["reset", "--quiet", "--hard", base]);
    }
    expect(leftInExports(p)).toEqual([]);
  });

  it("E20 (S20, a regression guard): the archive holds no node_modules folder and no path named like any of the 14 development-only packages; made-up archives with one are named", async () => {
    const { archivePathProblems, listArchive } = await exporter();
    const { devOnlyNames } = await import("../src/export/export-check.js");
    expect(devOnlyNames()).toEqual(FOURTEEN);
    const made = (paths: string[]) => {
      const d = folder("x32b-archive-");
      for (const rel of paths) {
        mkdirSync(dirname(join(d, "j1-made-up", rel)), { recursive: true });
        writeFileSync(join(d, "j1-made-up", rel), "made-up\n");
      }
      execFileSync("tar", ["--create", "--gzip", "--file", join(d, "a.tar.gz"), "--directory", d, "j1-made-up"]);
      return join(d, "a.tar.gz");
    };
    const clean = await listArchive(made(["src/app/page.tsx", "README.md"]));
    expect(clean).toEqual(expect.arrayContaining(["j1-made-up/src/app/page.tsx", "j1-made-up/README.md"]));
    expect(archivePathProblems(clean, FOURTEEN)).toEqual([]);
    expect(archivePathProblems(await listArchive(made(["node_modules/made-up/index.js"])), FOURTEEN)).toEqual(["j1-made-up/node_modules/"]);
    expect(archivePathProblems(await listArchive(made(["src/spdx-ranges/index.ts"])), FOURTEEN)).toEqual(["j1-made-up/src/spdx-ranges/"]);
    expect(archivePathProblems(await listArchive(made(["vendor/LightningCSS-linux-x64-musl"])), FOURTEEN)).toEqual(["j1-made-up/vendor/LightningCSS-linux-x64-musl"]);
    // A real export of the made-up project passes, and records the check.
    const p = await madeProject();
    const r = await exportOf(p);
    expect(archivePathProblems(await listArchive(r.path), FOURTEEN)).toEqual([]);
    expect(r.checks[0]).toMatchObject({ id: "archive_contents", passed: true });
  });

  it("S9's reading of the record: the run journey.signed_off names, its one acceptance.run.finished, passed, of the version, with a manifest SHA-256", async () => {
    const { signedOffRun } = await exporter();
    const sha = "a".repeat(64);
    const ev = (id: number, kind: string, payload: Record<string, unknown>) => ({ id: String(id), projectId: "j1-000000000000", at: new Date(), kind, step: null, payload });
    const finished = (run: string, extra: Record<string, unknown> = {}) => ev(2, "acceptance.run.finished", { run_id: run, version: "v001", outcome: "passed", manifest_sha256: sha, ...extra });
    const signed = (run: unknown) => ev(3, "journey.signed_off", { acceptance_run: run });
    expect(signedOffRun([finished("run-a"), signed("run-a")] as never, "v001")).toEqual({ runId: "run-a", manifestSha256: sha });
    expect(signedOffRun([finished("run-a")] as never, "v001")).toBe("the project's record holds no sign-off");
    expect(signedOffRun([finished("run-a"), signed(null)] as never, "v001")).toBe("its sign-off names no checklist run");
    expect(signedOffRun([finished("run-a"), finished("run-a"), signed("run-a")] as never, "v001")).toBe("the record holds 2 ends of run run-a, the run its sign-off names, not one");
    expect(signedOffRun([finished("run-a", { outcome: "failed" }), signed("run-a")] as never, "v001")).toBe("run run-a, the run its sign-off names, did not pass");
    expect(signedOffRun([finished("run-a", { version: "v002" }), signed("run-a")] as never, "v001")).toBe("run run-a, the run its sign-off names, checked version v002, not v001");
    expect(signedOffRun([finished("run-a", { manifest_sha256: undefined }), signed("run-a")] as never, "v001")).toBe("run run-a, the run its sign-off names, records no manifest SHA-256");
  });
});

describe("Part B, the export checks' verdicts (section 4 items 4 to 7), on made-up readings; their live proof is L1 and L2b", () => {
  it("S17 under question 26 (a): none of the 14 under /app of the run image; outside it only the base image's own npm copy of spdx-exceptions 2.5.0; every copy listed; reported as checked under this reading, never as met", async () => {
    const { runImageVerdict, KNOWN_BASE_COPY } = await import("../src/export/export-check.js");
    expect(KNOWN_BASE_COPY).toEqual({ path: "/usr/local/lib/node_modules/npm/node_modules/spdx-exceptions", name: "spdx-exceptions", version: "2.5.0" });
    const ordinary = [
      { path: "/app/node_modules/next", name: "next", version: "16.4.6" },
      { path: KNOWN_BASE_COPY.path, name: "spdx-exceptions", version: "2.5.0" },
    ];
    const ok = runImageVerdict(ordinary, FOURTEEN);
    expect(ok).toMatchObject({ passed: true, listed: [{ path: KNOWN_BASE_COPY.path, name: "spdx-exceptions", version: "2.5.0" }] });
    expect(ok.reading).toMatch(/checked under this reading \(question 26 \(a\)\)/);
    expect(JSON.stringify(ok)).not.toMatch(/\b(is|are|was|been) met\b/);
    const underApp = runImageVerdict([...ordinary, { path: "/app/node_modules/lightningcss", name: "lightningcss", version: "1.33.0" }], FOURTEEN);
    expect(underApp.passed).toBe(false);
    expect(underApp.problems).toEqual(["lightningcss 1.33.0 at /app/node_modules/lightningcss, under /app"]);
    const second = runImageVerdict([...ordinary, { path: "/usr/lib/node_modules/spdx-ranges", name: "spdx-ranges", version: "2.1.1" }], FOURTEEN);
    expect(second.passed).toBe(false);
    expect(second.problems).toEqual(["spdx-ranges 2.1.1 at /usr/lib/node_modules/spdx-ranges, outside /app but not the base image's own npm copy that is allowed"]);
    const otherVersion = runImageVerdict([{ path: KNOWN_BASE_COPY.path, name: "spdx-exceptions", version: "2.5.1" }], FOURTEEN);
    expect(otherVersion.passed).toBe(false);
  });

  it("S18: the notices file in the run image, byte-equal to the copy's", async () => {
    const { noticesVerdict } = await import("../src/export/export-check.js");
    const sha = sha256("made-up notices\n");
    expect(noticesVerdict({ sha256: sha, bytes: 16 }, sha).passed).toBe(true);
    expect(noticesVerdict(null, sha)).toMatchObject({ passed: false, summary: "The image the app runs from has no /app/THIRD-PARTY-NOTICES.md." });
    expect(noticesVerdict({ sha256: "b".repeat(64), bytes: 16 }, sha).passed).toBe(false);
  });

  it("S19: the template's licence check passes only on exit code 0 with \"RESULT: PASSED\" twice and the notices line", async () => {
    const { licenceCheckVerdict } = await import("../src/export/export-check.js");
    const good = "Lock file check\nRESULT: PASSED\nLicence check for app\nNotices file THIRD-PARTY-NOTICES.md is up to date.\nRESULT: PASSED\n";
    expect(licenceCheckVerdict(0, good).passed).toBe(true);
    expect(licenceCheckVerdict(1, good).passed).toBe(false);
    expect(licenceCheckVerdict(0, good.replace("RESULT: PASSED\nLicence", "Licence")).passed).toBe(false);
    expect(licenceCheckVerdict(0, good.replace("Notices file THIRD-PARTY-NOTICES.md is up to date.", "PROBLEM: the notices file is not up to date")).passed).toBe(false);
    expect(licenceCheckVerdict(null, good).passed).toBe(false);
  });

  it("S30: what Compose reads from the copy equals what it reads from the template's file alone, once the two folders' paths are set aside; a difference is named", async () => {
    const { composeConfigVerdict } = await import("../src/export/export-check.js");
    const doc = (dir: string, door: Record<string, unknown> = {}) => JSON.stringify({ name: "j1-made-up", services: { app: { build: { context: dir } }, door: { image: "made-up", ...door } } });
    expect(composeConfigVerdict(doc("/x/copy/j1-made-up"), doc("/x/template/j1-made-up"), "/x/copy/j1-made-up", "/x/template/j1-made-up")).toMatchObject({ passed: true });
    const v = composeConfigVerdict(doc("/x/copy/j1-made-up", { privileged: true }), doc("/x/template/j1-made-up"), "/x/copy/j1-made-up", "/x/template/j1-made-up");
    expect(v.passed).toBe(false);
    expect(v.summary).toContain("services.door.privileged");
  });

  it("the containers of the checks carry the sandbox's hardening (every capability dropped, no new privileges, 256 processes, 1 GB, a read-only root), a /tmp of 64 MB with no programs run from it, no network, and an unprivileged user", async () => {
    const { checkContainerArgs } = await import("../src/export/export-check.js");
    const { HARDENING } = await import("../src/sandbox/manager.js");
    const args = checkContainerArgs({ name: "builder_j1-made-up-exportcheck-list", image: "builder_j1-made-up-exportcheck-run:latest", user: "nobody", entrypoint: "node", cmd: ["-e", "0"] });
    expect(args.slice(0, 3)).toEqual(["run", "--rm", "--name"]);
    const pairs = (flag: string) => args.flatMap((a: string, i: number) => (a === flag ? [args[i + 1]] : []));
    expect(pairs("--cap-drop")).toEqual(HARDENING.cap_drop);
    expect(pairs("--security-opt")).toEqual(HARDENING.security_opt);
    expect(pairs("--pids-limit")).toEqual([String(HARDENING.pids_limit)]);
    expect(pairs("--memory")).toEqual([HARDENING.mem_limit]);
    expect(args).toContain("--read-only");
    expect(pairs("--tmpfs")).toEqual(["/tmp:rw,noexec,nosuid,size=64m"]);
    expect(pairs("--network")).toEqual(["none"]);
    expect(pairs("--user")).toEqual(["nobody"]);
    expect(args).not.toContain("--privileged");
    expect(args.slice(-3)).toEqual(["builder_j1-made-up-exportcheck-run:latest", "-e", "0"]);
  });

  it("the export check's two images are named builder_<id>-exportcheck-run and -tools, and are on the project's removal list beside the app's two", async () => {
    const { exportCheckImageNames, projectImageNames, appImageName, toolsImageName } = await import("../src/sandbox/manager.js");
    expect(exportCheckImageNames("j1-0123456789ab")).toEqual(["builder_j1-0123456789ab-exportcheck-run:latest", "builder_j1-0123456789ab-exportcheck-tools:latest"]);
    expect(projectImageNames("builder_j1-0123456789ab", { image: appImageName("j1-0123456789ab"), toolsImage: toolsImageName("j1-0123456789ab") })).toEqual([
      "builder_j1-0123456789ab-app:latest",
      "builder_j1-0123456789ab-tools:latest",
      "builder_j1-0123456789ab-exportcheck-run:latest",
      "builder_j1-0123456789ab-exportcheck-tools:latest",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
const NEW_LABEL =
  "Internal only, not for customers. The two container images it names are approved for the builder's internal development and testing only; its development-only packages are approved for development use only, never in what a customer receives. Made-up data only.";

describe("Part B, the export job: one export per project, the passing run's manifest, the event, the label and the screen, scripted only (stand-in sandboxes, test database)", () => {
  let pool: pg.Pool;
  let dataDir: string;
  let sandboxes: StandInSandboxes;
  beforeAll(async () => {
    pool = await testPool();
    dataDir = openStore(mkdtempSync(join(tmpdir(), "x32b-journey-"))).dataDir;
    sandboxes = new StandInSandboxes(pool);
  });
  afterAll(async () => {
    sandboxes.removeAll();
    await pool.end();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const make = () => {
    const box: { jobs?: JourneyJobs } = {};
    const j = new Journey({ pool, dataDir, cleanupProject: (id, rec) => box.jobs!.cleanup(id, rec) });
    box.jobs = new JourneyJobs({ journey: j, sandboxes, measureFree: () => 50 * 1024 ** 3 });
    return { j, jobs: box.jobs };
  };
  /** A project built, previewed, checked and signed off, on the stand-in sandboxes. */
  const signedOff = async (j: Journey, jobs: JourneyJobs) => {
    const id = await j.createProject({ name: "Leave requests (made-up, export tests)", cap: "5", brief: "I need an app where staff can request leave and managers approve it" });
    await j.continueWithExample(id);
    await j.answerRestFromSheet(id);
    await j.confirmBrief(id);
    await j.confirmPlan(id);
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    await jobs.approve(id, "01-data");
    await j.waitForJob();
    await jobs.approve(id, "02-submitter-screen");
    await j.waitForJob();
    await jobs.acceptance(id);
    await j.waitForJob();
    await j.signOff(id);
    return id;
  };
  const exportsOf = (id: string) => {
    const d = journeyFolder(dataDir, id, "exports");
    return existsSync(d) ? readdirSync(d) : [];
  };

  it("E14: journey.export.written records the project's id, the manifest's SHA-256 and its items' fingerprints, the checklist count, the passing run's id, the export checks' results and the README's command; the stand-in's checkExport was given the packed archive before it was placed", async () => {
    const { j, jobs } = make();
    const id = await signedOff(j, jobs);
    const calls = sandboxes.exportCheckCalls.length;
    await jobs.exportProject(id);
    await j.waitForJob();
    expect((await j.state(id)).jobs.at(-1)).toMatchObject({ kind: "export", state: "finished" });
    const ev = (await listEvents(pool, id, EV.exportWritten))[0]!;
    const version = (await listEvents(pool, id, "acceptance.version.written"))[0]!;
    const signed = (await listEvents(pool, id, EV.signedOff))[0]!;
    const run = (await listEvents(pool, id, "acceptance.run.finished")).find((e) => e.payload.run_id === signed.payload.acceptance_run)!;
    expect(ev.payload).toMatchObject({
      project_id: id,
      manifest_sha256: version.payload.manifest_sha256,
      items: version.payload.items,
      checklist_items: 6,
      acceptance_run: signed.payload.acceptance_run,
      readme_command: "docker compose up --build",
      label: NEW_LABEL,
      acceptance_version: "v001",
      acceptance_in_exported_copy_only: true,
    });
    expect(run.payload.manifest_sha256).toBe(ev.payload.manifest_sha256);
    const checks = ev.payload.export_checks as Array<{ id: string; passed: boolean; summary: string }>;
    expect(checks.map((c) => [c.id, c.passed])).toEqual(CHECK_IDS.map((c) => [c, true]));
    for (const c of checks) expect(typeof c.summary === "string" && c.summary.length > 0, c.id).toBe(true);
    const f = ev.payload.file as { path: string; sha256: string };
    expect(sandboxes.exportCheckCalls.slice(calls)).toEqual([expect.objectContaining({ projectId: id, sha256: f.sha256, archiveExisted: true, sha256OfFile: f.sha256 })]);
    expect(sandboxes.exportCheckCalls.at(-1)!.archive).not.toBe(f.path);
    expect(exportsOf(id)).toEqual([`${id}-export.tar.gz`]);
    // The screen lists the checks the event records as passed, in English and Arabic; the package listing is "checked under this reading".
    for (const lang of ["en", "ar"] as const) {
      const html = String(await exportPage(lang, await j.state(id)));
      expect(html, lang).toContain("data-export-checks");
      for (const c of CHECK_IDS) expect(html, `${lang} ${c}`).toMatch(new RegExp(`<li data-check="${c}" data-passed>`));
      expect(html, lang).toContain(t(lang, "export.check_reading"));
      expect(html, lang).toContain(t(lang, "export.label").replace(/'/g, "&#39;"));
    }
    await j.closeProject(id);
  });

  it("E10 (S12): one export per project: a second is refused by the job's rule and the first archive is left as it was; a failed export leaves no file and records nothing, and a later one may then be made", async () => {
    const { j, jobs } = make();
    const id = await signedOff(j, jobs);
    await jobs.exportProject(id);
    await j.waitForJob();
    const f = (await listEvents(pool, id, EV.exportWritten))[0]!.payload.file as { path: string; sha256: string };
    expect(JOB_RULES.export(await j.state(id))).toBe("This project is exported already: one export per project. The archive recorded is the one offered.");
    await expect(jobs.exportProject(id)).rejects.toThrow("This project is exported already: one export per project. The archive recorded is the one offered.");
    expect(sha256(readFileSync(f.path))).toBe(f.sha256);
    expect(await listEvents(pool, id, EV.exportWritten)).toHaveLength(1);
    await j.closeProject(id);
    // A failed export: a Docker check that did not pass.
    const k = await signedOff(j, jobs);
    sandboxes.exportCheckResult = passingDockerChecks().map((c) => (c.id === "run_image_notices" ? { ...c, passed: false, summary: "made-up notices check that did not pass" } : c));
    try {
      await jobs.exportProject(k);
      await j.waitForJob();
    } finally {
      sandboxes.exportCheckResult = null;
    }
    expect((await j.state(k)).jobs.at(-1)).toMatchObject({ kind: "export", state: "failed", reason: 'The export check "made-up notices check that did not pass" did not pass; the export is refused.' });
    expect(await listEvents(pool, k, EV.exportWritten)).toEqual([]);
    expect(exportsOf(k)).toEqual([]);
    await jobs.exportProject(k);
    await j.waitForJob();
    expect((await j.state(k)).jobs.at(-1)).toMatchObject({ kind: "export", state: "finished" });
    expect(exportsOf(k)).toEqual([`${k}-export.tar.gz`]);
    await j.closeProject(k);
  });

  it("E9 (S9): the export is refused unless the version's manifest is the one checked by the run journey.signed_off names: the manifest rewritten after that run, or a run whose record names no manifest", async () => {
    const { j, jobs } = make();
    const id = await signedOff(j, jobs);
    const manifest = join(dataDir, "acceptance", id, "v001", "manifest.json");
    const recorded = sha256(readFileSync(manifest));
    // The same manifest, written again with other spacing: still a valid version, but not the bytes the run checked.
    writeFileSync(manifest, JSON.stringify(JSON.parse(readFileSync(manifest, "utf8")), null, 4) + "\n");
    const now = sha256(readFileSync(manifest));
    await jobs.exportProject(id);
    await j.waitForJob();
    expect((await j.state(id)).jobs.at(-1)).toMatchObject({ kind: "export", state: "failed", reason: `The acceptance version's manifest (SHA-256 ${now}) is not the one the passing run checked (${recorded}); the export is refused.` });
    expect(await listEvents(pool, id, EV.exportWritten)).toEqual([]);
    expect(exportsOf(id)).toEqual([]);
    await j.closeProject(id);
    // A passing run whose record names no manifest.
    sandboxes.runManifest = "absent";
    let k: string;
    try {
      k = await signedOff(j, jobs);
    } finally {
      sandboxes.runManifest = null;
    }
    await jobs.exportProject(k);
    await j.waitForJob();
    const run = (await listEvents(pool, k, EV.signedOff))[0]!.payload.acceptance_run as string;
    expect((await j.state(k)).jobs.at(-1)).toMatchObject({ kind: "export", state: "failed", reason: `The export is refused: run ${run}, the run its sign-off names, records no manifest SHA-256.` });
    expect(exportsOf(k)).toEqual([]);
    await j.closeProject(k);
  });

  it("E16 (S15): only a project the scripted engine built is exported: a record holding a model call is refused before anything is made", async () => {
    const { j, jobs } = make();
    const id = await signedOff(j, jobs);
    await appendEvent(pool, id, "model.call", { note: "made-up model call, written by the test" });
    const calls = sandboxes.exportCheckCalls.length;
    await jobs.exportProject(id);
    await j.waitForJob();
    expect((await j.state(id)).jobs.at(-1)).toMatchObject({
      kind: "export",
      state: "failed",
      reason: "Only a project the scripted engine built is exported, since its note says no AI model was called: This project's record holds a model call: only an app built by the scripted engine may be used live.",
    });
    expect(await listEvents(pool, id, EV.exportWritten)).toEqual([]);
    expect(exportsOf(id)).toEqual([]);
    expect(sandboxes.exportCheckCalls.length).toBe(calls);
    await j.closeProject(id);
  });

  it("E15 (S28): the new label, in English (equal to EXPORT_LABEL, and the note's first line) and in Arabic; the words \"no notices file\" are gone", async () => {
    expect(EXPORT_LABEL).toBe(NEW_LABEL);
    expect(t("en", "export.label")).toBe(EXPORT_LABEL);
    const ar = t("ar", "export.label");
    expect(ar).not.toBe(EXPORT_LABEL);
    expect(ar).toMatch(/[؀-ۿ]/);
    for (const l of ["en", "ar"]) {
      const raw = readFileSync(join(builderDir, "src", "web", "messages", `${l}.json`), "utf8");
      expect(raw, l).not.toMatch(/no notices file|Not yet shown to start without the builder/);
      expect(raw, l).not.toContain("ولا يحتوي على ملف الإشعارات");
    }
    const { j, jobs } = make();
    const id = await signedOff(j, jobs);
    await jobs.exportProject(id);
    await j.waitForJob();
    const f = (await listEvents(pool, id, EV.exportWritten))[0]!.payload.file as { path: string };
    const out = folder("x32b-note-");
    execFileSync("tar", ["-xzf", f.path, "-C", out, `${id}/EXPORT-NOTE.txt`]);
    expect(readFileSync(join(out, id, "EXPORT-NOTE.txt"), "utf8").split("\n")[0]).toBe(NEW_LABEL);
    await j.closeProject(id);
  });
});
