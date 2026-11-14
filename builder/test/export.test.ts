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
 */
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Sandbox, StreamingEnd } from "../src/sandbox/manager.js";

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
    expect(script).toContain("mode:0o444");
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
