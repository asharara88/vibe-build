import { execFile, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { RUNNER_IMAGE } from "../src/acceptance/runner-image.js";
import { appStreamArgs, composeDocument, createSandbox, DEFAULT_IMAGES, dockerEnv, sandbox, STREAM_SCRIPT, toYaml, type SandboxSpec } from "../src/sandbox/manager.js";

const run = promisify(execFile);
const builderDir = resolve(import.meta.dirname, "..");

/**
 * A Dockerfile's instructions as Docker reads them (its reference, "Format"): comment lines dropped, also inside a
 * continued step; a line ending in a backslash joined to the next; leading space ignored; the keyword, which Docker
 * reads in any case, given in capitals. Assumes the default escape character, which the test checks.
 */
function dockerfileInstructions(text: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#") || (!current && line === "")) continue;
    const continued = line.endsWith("\\");
    const part = continued ? line.slice(0, -1).trim() : line;
    current = current ? `${current} ${part}`.trim() : part;
    if (!continued) {
      out.push(current);
      current = "";
    }
  }
  if (current) out.push(current);
  return out.map((i) => i.replace(/^(\S+)/, (k) => k.toUpperCase()));
}

/**
 * Ask until the answer is the one wanted, every `everyMs`, for at most `forMs`; returns the last answer.
 * A command that fails (pg_isready exits 1 or 2 while the server is not ready) counts as an answer: its output.
 */
async function askUntil(ask: () => Promise<string>, wanted: (answer: string) => boolean, { everyMs, forMs }: { everyMs: number; forMs: number }): Promise<string> {
  const until = Date.now() + forMs;
  for (;;) {
    let answer: string;
    try {
      answer = await ask();
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      answer = `${err.stdout ?? ""}${err.stderr ?? ""}` || String(err.message);
    }
    if (wanted(answer) || Date.now() >= until) return answer;
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

const base: Omit<SandboxSpec, "profile" | "dir"> = {
  projectId: "p_test",
  allowHosts: ["registry.npmjs.org"],
  gatewayUrl: "http://127.0.0.1:4010",
  builderDir,
  hostProxy: { url: process.env.HTTPS_PROXY ?? "http://127.0.0.1:1" },
};

describe("sandbox manager: compose documents", () => {
  // Package 0.6c: the same private networks in both profiles. A project container is any service but the
  // development profile's machine side, `egress-host`, which runs the builder's own code.
  type Svc = {
    networks?: string[];
    network_mode?: string;
    cap_drop?: string[];
    cap_add?: string[];
    security_opt?: string[];
    read_only?: boolean;
    environment?: Record<string, string>;
    volumes?: Array<string | { source: string; target: string; read_only: boolean }>;
    ports?: unknown;
    privileged?: unknown;
    user?: string;
    depends_on?: Record<string, unknown>;
    healthcheck?: { test: string[] };
    command?: string[];
  };
  type Doc = { networks: Record<string, Record<string, unknown>>; services: Record<string, Svc> };
  const full = (profile: SandboxSpec["profile"], over: Partial<SandboxSpec> = {}) =>
    composeDocument({
      ...base,
      profile,
      dir: "/tmp/x",
      buildProxyPort: 13150,
      app: { buildContext: "/tmp/x/workspace", port: 3100, env: { APP_URL: "http://app:3100" }, toolsEnv: { APP_URL: "http://app:3100" } },
      engine: { workspace: "/tmp/x/workspace", changeSets: "/tmp/x/sets" },
      acceptance: { image: RUNNER_IMAGE, baseUrl: "http://app:3100" },
      ...over,
    }) as Doc;
  const ISOLATED = { internal: true, enable_ipv6: false, driver_opts: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" } };

  it("both profiles (package 0.6c): every project network internal, with the isolated gateway mode, IPv6 off and no gateway address set", () => {
    for (const profile of ["server", "development-cloud-session"] as const) {
      const doc = full(profile);
      for (const n of ["data", "front", "out"]) expect(doc.networks[n], `${profile} ${n}`).toEqual(ISOLATED);
      // The server profile's egress proxy has one ordinary bridge of its own; the development profile none.
      expect(Object.keys(doc.networks).sort(), profile).toEqual(profile === "server" ? ["data", "ext", "front", "out"] : ["data", "front", "out"]);
      if (profile === "server") expect(doc.networks.ext).toEqual({ enable_ipv6: false });
      expect(JSON.stringify(doc.networks), profile).not.toMatch(/ipam|gateway"/);
    }
  });

  it("both profiles (package 0.6c): each service's networks; tools on the database's network only; no published port; every capability dropped", () => {
    for (const profile of ["server", "development-cloud-session"] as const) {
      const doc = full(profile);
      const nets = Object.fromEntries(Object.entries(doc.services).map(([name, svc]) => [name, svc.networks ?? svc.network_mode]));
      expect(nets, profile).toEqual({
        app: ["data", "front"],
        tools: ["data"],
        engine: "none",
        acceptance: ["front"],
        check: ["front"],
        db: ["data"],
        egress: profile === "server" ? ["out", "ext"] : ["out"],
        ...(profile === "server" ? {} : { "egress-host": "host" }),
      });
      for (const [name, svc] of Object.entries(doc.services)) {
        expect(svc.cap_drop, `${profile} ${name}`).toEqual(["ALL"]);
        expect(svc.security_opt, `${profile} ${name}`).toEqual(["no-new-privileges:true"]);
        expect(svc.ports, `${profile} ${name}`).toBeUndefined();
        expect(svc.privileged, `${profile} ${name}`).toBeUndefined();
        expect(svc.cap_add ?? [], `${profile} ${name}`).toEqual(name === "db" ? ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"] : []);
        expect(svc.read_only, `${profile} ${name}`).toBe(name !== "db");
        // Only the development profile's machine side is on the machine's network; no project container is.
        expect(svc.network_mode === "host", `${profile} ${name}`).toBe(name === "egress-host");
      }
      // The database is reached by its name on `data`, never at a port on the machine; its health check asks over TCP (gap 69).
      for (const name of ["app", "tools"]) expect(doc.services[name]?.environment?.DATABASE_URL, `${profile} ${name}`).toBe("postgres://app:${DB_PASSWORD}@db:5432/app");
      expect(doc.services.db?.environment?.PGPORT, profile).toBeUndefined();
      expect(doc.services.db?.healthcheck?.test, profile).toEqual(["CMD-SHELL", "pg_isready -h 127.0.0.1 -p 5432 -U app -d app"]);
      // No certificate anywhere.
      expect(JSON.stringify(doc), profile).not.toMatch(/ca-bundle|session-ca|NODE_EXTRA_CA_CERTS|\/certs\/session/);
    }
  });

  it("server profile: the egress proxy goes out directly, said explicitly, with the project's list", () => {
    const doc = full("server");
    expect(doc.services.egress?.environment).toEqual({ EGRESS_ALLOW: "registry.npmjs.org", EGRESS_PORT: "3128", EGRESS_UPSTREAM_PROXY: "direct" });
    expect(doc.services.egress?.command).toEqual(["node", "--import", "tsx", "src/sandbox/egress-main.ts"]);
  });

  it("development profile (package 0.6c): the door on `out`, and the egress proxy and gateway forwarder behind two sockets on the machine side, going out only through the session proxy", () => {
    const doc = full("development-cloud-session", { hostProxy: { url: "http://made-up-user:made-up-pass@127.0.0.1:3999" } });
    const door = doc.services.egress!;
    const host = doc.services["egress-host"]!;
    expect(door.command).toEqual(["node", "--import", "tsx", "src/sandbox/door-main.ts"]);
    expect(door.environment).toEqual({ DOOR_ROUTES: "3128=/sock/egress.sock,4010=/sock/gateway.sock" });
    expect(door.depends_on).toEqual({ "egress-host": { condition: "service_healthy" } });
    expect(host.command).toEqual(["node", "--import", "tsx", "src/sandbox/egress-machine-main.ts"]);
    // Host and port only: the made-up user name and password are dropped.
    expect(host.environment).toEqual({
      EGRESS_ALLOW: "registry.npmjs.org",
      EGRESS_UPSTREAM_PROXY: "http://127.0.0.1:3999",
      EGRESS_SOCKET: "/sock/egress.sock",
      GATEWAY_SOCKET: "/sock/gateway.sock",
      GATEWAY_TARGET: "127.0.0.1:4010",
      EGRESS_BUILD_PORT: "13150",
      EGRESS_BUILD_ALLOW: "registry.npmjs.org",
    });
    expect(JSON.stringify(doc)).not.toContain("made-up-pass");
    // The socket folder: read-only at the door, read-write on the machine side; the builder's code read-only in both.
    const mounts = (svc: Svc) => (svc.volumes ?? []).map((v) => (typeof v === "string" ? v : `${v.source}:${v.target}:${v.read_only ? "ro" : "rw"}`));
    expect(mounts(door)).toEqual([`${builderDir}:/builder:ro`, "/tmp/x/egress-sockets:/sock:ro"]);
    expect(mounts(host)).toEqual([`${builderDir}:/builder:ro`, "/tmp/x/egress-sockets:/sock:rw"]);
    // Both run as the socket folder's owner (1000:1000 unless the builder is not root).
    expect([door.user, host.user]).toEqual(["1000:1000", "1000:1000"]);
    expect(full("development-cloud-session").services.egress?.user).toBe("1000:1000");
    // The health checks read the kernel's lists; they open no connection.
    expect(door.healthcheck?.test.join(" ")).toContain("/proc/net/tcp");
    expect(host.healthcheck?.test.join(" ")).toContain("/sock/egress.sock");
  });

  it("development profile (package 0.6c): package 2.2's engine option puts the engine on `out` only, pointed at the door", () => {
    const doc = full("development-cloud-session", { engine: { workspace: "/tmp/x/workspace", changeSets: "/tmp/x/sets", network: "egress" } });
    const engine = doc.services.engine!;
    expect(engine.networks).toEqual(["out"]);
    expect(engine.network_mode).toBeUndefined();
    expect(engine.environment).toEqual({ HTTPS_PROXY: "http://egress:3128", HTTP_PROXY: "http://egress:3128", NO_PROXY: "egress", ANTHROPIC_BASE_URL: "http://egress:4010" });
    expect(engine.cap_drop).toEqual(["ALL"]);
  });

  it("development profile (package 0.6c): refused without the session proxy, or with a gateway that is not on the machine's loopback address", () => {
    expect(() => full("development-cloud-session", { hostProxy: undefined })).toThrow(/needs the cloud session's proxy/);
    for (const gatewayUrl of ["http://gateway:4010", "http://10.0.0.5:4010", "http://127.0.0.1", "not a url"])
      expect(() => full("development-cloud-session", { gatewayUrl }), gatewayUrl).toThrow(/gateway/);
    expect(() => full("server", { gatewayUrl: "http://gateway:4010" })).not.toThrow();
  });

  it("development profile (package 0.6c): createSandbox makes the socket folder (mode 750, owned by the door's user), copies no certificate, and points the build's npm at the machine side's loopback port", () => {
    const dir = mkdtempSync(join(tmpdir(), "builder-sb-dev-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, "workspace", "certs"), { recursive: true });
    const spec: SandboxSpec = { ...base, profile: "development-cloud-session", dir, app: { buildContext: join(dir, "workspace"), port: 3100 } };
    expect(() => createSandbox(spec, "sample-only-password")).toThrow(/buildProxyPort/);
    const sb = createSandbox({ ...spec, buildProxyPort: 13150 }, "sample-only-password");
    const st = statSync(join(dir, "egress-sockets"));
    expect((st.mode & 0o777).toString(8)).toBe("750");
    if (process.getuid?.() === 0) expect([st.uid, st.gid]).toEqual([1000, 1000]);
    expect(existsSync(join(dir, "workspace", "certs", "session-ca.crt"))).toBe(false);
    expect(sb.appBuild).toMatchObject({ hostNetwork: true, args: { HTTPS_PROXY: "http://127.0.0.1:13150", HTTP_PROXY: "http://127.0.0.1:13150" }, before: ["egress-host"] });
    expect(Object.keys(sb.appBuild!.args).sort()).toEqual(["HTTPS_PROXY", "HTTP_PROXY"]);
  });

  it("the template's image build (package 0.6c): install scripts off, the workspace's code with no network, no certificate, no build front end fetched", () => {
    const df = readFileSync(resolve(builderDir, "..", "templates", "next", "Dockerfile"), "utf8");
    // Read as Docker reads it (after the review): an instruction's keyword in any case, with any leading space, and
    // a step continued over several lines, so that `run npm run build` cannot pass unseen.
    const runs = dockerfileInstructions(df).filter((l) => /^RUN\s/.test(l));
    // npm ci is the one step with the network (through the project's egress proxy, registry only), with install scripts off.
    expect(runs.filter((l) => /npm ci/.test(l))).toEqual(["RUN npm ci --ignore-scripts --no-fund --no-audit"]);
    // Every other step of the build stage that runs code has no network at all: the guard check and next build.
    expect(runs.filter((l) => /npm run build/.test(l)).every((l) => l.startsWith("RUN --network=none "))).toBe(true);
    expect(runs.filter((l) => /npm run build/.test(l)).length).toBe(1);
    // No step but npm ci and the run stage's user set-up runs without --network=none.
    expect(runs.filter((l) => !l.startsWith("RUN --network=none ") && !/npm ci/.test(l))).toEqual(["RUN addgroup -S app && adduser -S app -G app"]);
    // No certificate copied or configured; no "# syntax=" line (it would fetch a build front end that is not approved),
    // and no "# escape=" line (it would change how the lines above are joined); Docker reads these in any case.
    expect(df).not.toMatch(/certs\/|cafile|NODE_EXTRA_CA_CERTS/);
    expect(df).not.toMatch(/^\s*#\s*(syntax|escape)\s*=/im);
  });

  it("the Dockerfile reading used above (after the review): keywords in any case, leading space, continued lines, comment lines dropped", () => {
    expect(dockerfileInstructions("WORKDIR /app\n  run npm run build\nRun --network=none a \\\n# a comment inside\n  b\n# RUN not this\nCOPY . .\n")).toEqual([
      "WORKDIR /app",
      "RUN npm run build",
      "RUN --network=none a b",
      "COPY . .",
    ]);
  });

  it("askApp (package 0.6c) takes only http://<service>:<port>/<path>; up refuses the check service", async () => {
    const dir = mkdtempSync(join(tmpdir(), "builder-sb-dev-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const sb = createSandbox({ ...base, profile: "server", dir, app: { buildContext: join(dir, "workspace"), port: 3100 } }, "sample-only-password");
    for (const bad of ["http://127.0.0.1:3100/en/sign-in", "https://app:3100/", "http://app/en/sign-in", "http://app:3100/x?y=1", "http://APP:3100/", "http://app:3100/a b"])
      await expect(sandbox.askApp(sb, bad), bad).rejects.toThrow(/askApp takes/);
    await expect(sandbox.up(sb, ["check"])).rejects.toThrow(/not started with up/);
  });

  it("appStream (package J3): docker compose run of the check service as it is, to app:<port> only; nothing added (no --privileged, --user, --env or --volume)", () => {
    const sb = { composeFile: "/made-up/compose.yaml" };
    expect(appStreamArgs(sb, "app:3161", "builder_j1-0123456789ab-live-0a1b2c3d")).toEqual([
      "compose", "-f", "/made-up/compose.yaml",
      "--profile", "tools", "--profile", "engine", "--profile", "acceptance", "--profile", "check",
      "run", "--rm", "--no-deps", "-T", "--name", "builder_j1-0123456789ab-live-0a1b2c3d",
      "check", "node", "-e", STREAM_SCRIPT, "app", "3161",
    ]);
    const args = appStreamArgs(sb, "app:3161", "x1");
    for (const flag of ["--privileged", "--user", "-u", "--env", "-e=", "--volume", "-v", "--network", "--cap-add", "--entrypoint", "--publish", "-p", "--service-ports"]) expect(args.slice(0, args.indexOf("check")), flag).not.toContain(flag);
    for (const bad of ["db:5432", "app", "app:0", "app:70000", "127.0.0.1:3161", "app:3161/x", "egress:3128", "APP:3161", "app: 3161"]) expect(() => appStreamArgs(sb, bad, "x1"), bad).toThrow(/appStream takes app:<port>/);
    expect(() => appStreamArgs(sb, "app:3161", "-bad name")).toThrow(/container name/);
    // The script itself uses Node's own modules only.
    expect(STREAM_SCRIPT.match(/require\('([^']+)'\)/g)).toEqual(["require('net')"]);
  });

  it("development profile (package 0.6c): Docker Compose accepts the whole file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "builder-sb-dev-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, "workspace"), { recursive: true });
    const sb = createSandbox(
      { ...base, profile: "development-cloud-session", dir, buildProxyPort: 13150, app: { buildContext: join(dir, "workspace"), port: 3100 }, engine: { workspace: join(dir, "workspace"), changeSets: join(builderDir, "scripted"), network: "egress" }, acceptance: { image: RUNNER_IMAGE, baseUrl: "http://app:3100" } },
      "sample-only-password",
    );
    const { stdout } = await run("docker", ["compose", "-f", sb.composeFile, "--profile", "tools", "--profile", "engine", "--profile", "acceptance", "--profile", "check", "config", "--quiet"], { env: dockerEnv(sb) });
    expect(stdout).toBe("");
  });

  it("package 0.5: a tools service under its own profile, given a named list of settings and nothing from the host", () => {
    for (const profile of ["server", "development-cloud-session"] as const) {
      const doc = composeDocument({
        ...base,
        profile,
        dir: "/tmp/x",
        app: { buildContext: "/tmp/x/workspace", port: 3100, env: { APP_URL: "http://app:3100" }, toolsEnv: { APP_URL: "http://app:3100" } },
      }) as {
        services: Record<
          string,
          { image?: string; profiles?: string[]; environment?: Record<string, unknown>; env_file?: string[]; read_only?: boolean; cap_drop?: string[]; network_mode?: string; networks?: string[] }
        >;
      };
      const tools = doc.services.tools!;
      expect(tools.image).toBe("builder_p_test-tools:latest");
      expect(tools.profiles).toEqual(["tools"]);
      expect(Object.keys(tools.environment ?? {}).sort()).toEqual(["APP_URL", "DATABASE_URL"]);
      // Every entry has a value: a bare name would make Compose copy it from the host.
      for (const v of Object.values(tools.environment ?? {})) expect(typeof v).toBe("string");
      expect(tools.env_file).toEqual(["./secrets/app.env"]);
      expect(tools.read_only).toBe(true);
      expect(tools.cap_drop).toEqual(["ALL"]);
      // No proxy setting: the tools container needs the project's database and nothing else.
      expect(JSON.stringify(tools)).not.toMatch(/PROXY|EGRESS|BUILDER_/);
      // Package 0.6c: on the database's network only, in both profiles.
      expect(tools.networks).toEqual(["data"]);
      expect(tools.network_mode).toBeUndefined();
    }
  });

  it("package 0.5: the sandbox records the names given to the tools container, and Docker runs with a narrow environment and its own client folder", () => {
    // Independent of the machine's own Docker settings: an empty user configuration, no context, no DOCKER_HOST.
    const saved = { DOCKER_CONFIG: process.env.DOCKER_CONFIG, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONTEXT: process.env.DOCKER_CONTEXT };
    process.env.DOCKER_CONFIG = mkdtempSync(join(tmpdir(), "builder-user-docker-"));
    delete process.env.DOCKER_HOST;
    delete process.env.DOCKER_CONTEXT;
    onTestFinished(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
    const dir = mkdtempSync(join(tmpdir(), "builder-sb-"));
    const sb = createSandbox(
      { ...base, profile: "server", dir, app: { buildContext: join(dir, "workspace"), port: 3100, toolsEnv: { APP_URL: "http://x" } } },
      "sample-only-password",
      { AUTH_SECRET: "made-up", APP_SAMPLE_PASSWORD: "made-up-sample" },
    );
    expect(sb.toolsEnvNames).toEqual(["APP_SAMPLE_PASSWORD", "APP_URL", "AUTH_SECRET", "DATABASE_URL"]);
    expect(sb.appBuild?.toolsImage).toBe("builder_p_test-tools:latest");
    const env = dockerEnv(sb);
    expect(Object.keys(env).filter((k) => !["DOCKER_HOST", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"].includes(k)).sort()).toEqual(["DOCKER_CONFIG", "HOME", "PATH"]);
    expect(env.DOCKER_CONFIG).toBe(join(dir, "docker-client"));
    expect(existsSync(join(dir, "docker-client"))).toBe(true);
  });

  it("package 0.5: only the user's extra plugin folders are carried into the project's Docker client folder; a chosen context is refused; up refuses the tools service", async () => {
    const saved = { DOCKER_CONFIG: process.env.DOCKER_CONFIG, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONTEXT: process.env.DOCKER_CONTEXT };
    const userDir = mkdtempSync(join(tmpdir(), "builder-user-docker-"));
    try {
      process.env.DOCKER_CONFIG = userDir;
      // The refusal of a chosen context depends on DOCKER_HOST, so neither may come from the machine running the test.
      delete process.env.DOCKER_HOST;
      delete process.env.DOCKER_CONTEXT;
      // Made-up values only.
      writeFileSync(
        join(userDir, "config.json"),
        JSON.stringify({
          proxies: { default: { httpProxy: "http://made-up-proxy.invalid:3128" } },
          auths: { "registry.invalid": { auth: "bWFkZS11cDptYWRlLXVw" } },
          credsStore: "made-up-store",
          cliPluginsExtraDirs: ["/made-up/plugins"],
          currentContext: "default",
        }),
      );
      const dir = mkdtempSync(join(tmpdir(), "builder-sb-"));
      const sb = createSandbox({ ...base, profile: "server", dir, app: { buildContext: join(dir, "workspace"), port: 3100 } }, "sample-only-password");
      expect(JSON.parse(readFileSync(join(dir, "docker-client", "config.json"), "utf8"))).toEqual({ cliPluginsExtraDirs: ["/made-up/plugins"] });
      expect(() => dockerEnv(sb)).not.toThrow();
      // Called without await inside a function: a refusal thrown before the promise would fail here.
      await expect(sandbox.up(sb, ["tools"])).rejects.toThrow(/not started with up/);
      writeFileSync(join(userDir, "config.json"), JSON.stringify({ currentContext: "made-up-context" }));
      expect(() => dockerEnv(sb)).toThrow(/docker context use default`, or set DOCKER_HOST/);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("package 0.5: an empty DOCKER_CONFIG counts as not set, so the user's own folder under HOME is read", () => {
    const saved = { DOCKER_CONFIG: process.env.DOCKER_CONFIG, HOME: process.env.HOME };
    const home = mkdtempSync(join(tmpdir(), "builder-home-"));
    const dir = mkdtempSync(join(tmpdir(), "builder-sb-"));
    try {
      mkdirSync(join(home, ".docker"));
      writeFileSync(join(home, ".docker", "config.json"), JSON.stringify({ cliPluginsExtraDirs: ["/made-up/home-plugins"] }));
      process.env.HOME = home;
      process.env.DOCKER_CONFIG = "";
      createSandbox({ ...base, profile: "server", dir }, "sample-only-password");
      expect(JSON.parse(readFileSync(join(dir, "docker-client", "config.json"), "utf8"))).toEqual({ cliPluginsExtraDirs: ["/made-up/home-plugins"] });
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("package 0.5: a context chosen in the configuration is accepted when DOCKER_HOST is set; DOCKER_CONTEXT=default is accepted, any other DOCKER_CONTEXT refused", () => {
    const saved = { DOCKER_CONFIG: process.env.DOCKER_CONFIG, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONTEXT: process.env.DOCKER_CONTEXT };
    const userDir = mkdtempSync(join(tmpdir(), "builder-user-docker-"));
    const dir = mkdtempSync(join(tmpdir(), "builder-sb-"));
    try {
      process.env.DOCKER_CONFIG = userDir;
      delete process.env.DOCKER_HOST;
      delete process.env.DOCKER_CONTEXT;
      // Made-up values only. dockerEnv reads them; nothing here talks to a daemon.
      writeFileSync(join(userDir, "config.json"), JSON.stringify({ currentContext: "made-up-context" }));
      const sb = createSandbox({ ...base, profile: "server", dir }, "sample-only-password");
      expect(() => dockerEnv(sb)).toThrow(/context/);
      process.env.DOCKER_HOST = "tcp://made-up-daemon.invalid:2375";
      expect(dockerEnv(sb).DOCKER_HOST).toBe("tcp://made-up-daemon.invalid:2375");
      delete process.env.DOCKER_HOST;
      writeFileSync(join(userDir, "config.json"), "{}");
      process.env.DOCKER_CONTEXT = "default";
      expect(() => dockerEnv(sb)).not.toThrow();
      expect(dockerEnv(sb).DOCKER_CONTEXT).toBeUndefined();
      process.env.DOCKER_CONTEXT = "made-up-context";
      expect(() => dockerEnv(sb)).toThrow(/DOCKER_CONTEXT/);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(userDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("package 0.5: a plugin link to a folder that has since gone is replaced, or removed, without error", () => {
    const saved = process.env.DOCKER_CONFIG;
    const first = mkdtempSync(join(tmpdir(), "builder-user-docker-"));
    const second = mkdtempSync(join(tmpdir(), "builder-user-docker-"));
    const dir = mkdtempSync(join(tmpdir(), "builder-sb-"));
    const spec: SandboxSpec = { ...base, profile: "server", dir };
    const link = join(dir, "docker-client", "cli-plugins");
    try {
      mkdirSync(join(first, "cli-plugins"));
      process.env.DOCKER_CONFIG = first;
      createSandbox(spec, "sample-only-password");
      expect(readlinkSync(link)).toBe(join(first, "cli-plugins"));
      // The folder the link points to goes: the link is now dangling.
      rmSync(first, { recursive: true, force: true });
      expect(existsSync(link)).toBe(false);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      mkdirSync(join(second, "cli-plugins"));
      process.env.DOCKER_CONFIG = second;
      expect(() => createSandbox(spec, "sample-only-password")).not.toThrow();
      expect(readlinkSync(link)).toBe(join(second, "cli-plugins"));
      // Dangling again, and this time there is no plugin folder to link to: the link is removed.
      rmSync(second, { recursive: true, force: true });
      expect(() => createSandbox(spec, "sample-only-password")).not.toThrow();
      expect(() => lstatSync(link)).toThrow();
    } finally {
      if (saved === undefined) delete process.env.DOCKER_CONFIG;
      else process.env.DOCKER_CONFIG = saved;
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes YAML that Docker Compose accepts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "builder-sb-"));
    const sb = createSandbox({ ...base, profile: "server", dir }, "sample-only-password");
    expect(existsSync(sb.composeFile)).toBe(true);
    expect(readFileSync(join(dir, "secrets", "db_password"), "utf8")).toBe("sample-only-password");
    const { stdout } = await run("docker", ["compose", "-f", sb.composeFile, "config", "--quiet"]);
    expect(stdout).toBe("");
  });

  it("round-trips a small document through the YAML writer", async () => {
    const doc = { a: 1, b: "two", c: [1, "x"], d: { e: true, f: [] }, g: {} };
    const yaml = toYaml(doc);
    expect(yaml).toContain('b: "two"');
    expect(yaml).toContain("f: []");
    expect(yaml).toContain("g: {}");
  });
});

describe("sandbox manager: live, development profile", () => {
  // Made when the block runs, not when the file is read, so that a run that leaves this block out leaves no folder.
  let dir = "";
  let sb: ReturnType<typeof createSandbox> | undefined;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "builder-live-"));
    sb = createSandbox({ ...base, projectId: "p_live", profile: "development-cloud-session", dir }, "sample-only-password");
  });
  afterAll(async () => {
    if (sb) await sandbox.destroy(sb).catch(() => undefined);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("starts the project's database and its door; from a container on `out`, the egress proxy behind the door lets the registry through and refuses a host not on the list (package 0.6c)", async () => {
    await sandbox.up(sb!, ["db", "egress"]);
    // `up --wait` returns once the health checks have passed; the database's asks over TCP, so the real
    // server listens on its network port by then (known gap 69). It is asked once more, the same way.
    const ready = await askUntil(
      () => sandbox.exec(sb!, "db", ["pg_isready", "-h", "127.0.0.1", "-p", "5432", "-U", "app", "-d", "app"]),
      (answer) => /accepting connections/.test(answer),
      { everyMs: 500, forMs: 30_000 },
    );
    expect(ready).toMatch(/accepting connections/);
    // A one-off container of the door's own service: on `out` only. It asks egress:3128 for two tunnels and
    // prints the first line of each answer. Node's own modules only; nothing is sent inside a tunnel.
    const ask =
      "const net=require('net');const one=(t)=>new Promise((r)=>{const s=net.connect(3128,'egress',()=>s.write('CONNECT '+t+' HTTP/1.1\\r\\nHost: '+t+'\\r\\n\\r\\n'));" +
      "let b='';s.on('data',(d)=>{b+=d;if(b.includes('\\r\\n')){r(t+' '+b.split('\\r\\n')[0]);s.destroy();}});s.on('error',(e)=>r(t+' '+e.code));setTimeout(()=>{r(t+' no answer');s.destroy()},20000);});" +
      "(async()=>{for(const t of ['registry.npmjs.org:443','example.com:443'])console.log(await one(t));})();";
    const out = (await sandbox.runOnce(sb!, "egress", ["node", "-e", ask])).trim().split("\n");
    expect(out).toEqual(["registry.npmjs.org:443 HTTP/1.1 200 Connection Established", "example.com:443 HTTP/1.1 403 Forbidden"]);
    const logs = await sandbox.logs(sb!, "egress-host");
    expect(logs).toContain('"host":"example.com"');
    expect(logs).toContain('"decision":"refused"');
    expect(logs).toContain('"host":"registry.npmjs.org","port":443,"decision":"allowed"');
  }, 180_000);
});

describe("sandbox manager: live, the tools container (package 0.5)", () => {
  // A small tools image made from the base image the template uses, started without its shell script,
  // as the template's tools stage is. Nothing is fetched: the base image is already on this machine.
  // Both folders are made when the block runs and removed after it (package 0.6c, after its review: before, a run
  // left them behind, and a run that left this block out made them too).
  let dir = "";
  // A user's home folder whose Docker client configuration adds made-up proxies to every container.
  let userHome = "";
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "builder-tools-"));
    userHome = mkdtempSync(join(tmpdir(), "builder-home-"));
  });
  const savedHome = process.env.HOME;
  let sb: ReturnType<typeof createSandbox>;
  const names = 'console.log(JSON.stringify(Object.keys(process.env).sort()))';

  afterAll(async () => {
    if (sb) {
      await sandbox.destroy(sb).catch(() => undefined);
      // If a test failed part-way, a container of this project may be left: it goes before its image.
      const left = await run("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${sb.projectName}`], { env: dockerEnv(sb) }).catch(() => ({ stdout: "" }));
      for (const id of left.stdout.split("\n").filter(Boolean)) await run("docker", ["rm", "-f", id], { env: dockerEnv(sb) }).catch(() => undefined);
      await sandbox.removeImage(sb);
    }
    process.env.HOME = savedHome;
    for (const d of [dir, userHome]) if (d) rmSync(d, { recursive: true, force: true });
  });

  it("a Docker client configuration that adds proxy settings to containers does not reach the tools container", async () => {
    // Docker reads its client configuration from $HOME/.docker unless told otherwise, and adds its proxies to every container it starts.
    mkdirSync(join(userHome, ".docker"), { recursive: true });
    writeFileSync(
      join(userHome, ".docker", "config.json"),
      JSON.stringify({ proxies: { default: { httpProxy: "http://made-up-proxy.invalid:3128", httpsProxy: "http://made-up-proxy.invalid:3128" } } }),
    );
    process.env.HOME = userHome;
    mkdirSync(join(dir, "workspace"), { recursive: true });
    sb = createSandbox(
      { ...base, projectId: "p_tools_live", profile: "development-cloud-session", dir, buildProxyPort: 13149, app: { buildContext: join(dir, "workspace"), port: 3119, toolsEnv: { APP_URL: "http://made-up.invalid" } } },
      "sample-only-password",
      { AUTH_SECRET: "made-up-secret", APP_SAMPLE_PASSWORD: "made-up-sample" },
    );
    const built = spawnSync("docker", ["build", "-t", sb.appBuild!.toolsImage, "-"], { input: `FROM ${DEFAULT_IMAGES.node}\nENTRYPOINT []\n`, env: dockerEnv(sb) });
    expect(built.status, built.stderr?.toString()).toBe(0);

    // The control: the same command through Compose with the user's configuration does get the proxies.
    const { DOCKER_CONFIG: _projectClient, ...withoutProjectClient } = dockerEnv(sb);
    const control = await run("docker", ["compose", "-f", sb.composeFile, "--profile", "tools", "run", "--rm", "--no-deps", "-T", "tools", "node", "-e", names], {
      env: { ...withoutProjectClient, HOME: userHome },
    });
    expect(JSON.parse(control.stdout.trim().split("\n").pop()!)).toContain("HTTP_PROXY");

    // Through the sandbox: exactly the named list, the image's own settings, and what Docker sets.
    const seen = JSON.parse((await sandbox.runOnce(sb, "tools", ["node", "-e", names])).trim().split("\n").pop()!) as string[];
    expect(seen).toEqual(["APP_SAMPLE_PASSWORD", "APP_URL", "AUTH_SECRET", "DATABASE_URL", "HOME", "HOSTNAME", "NODE_VERSION", "PATH", "YARN_VERSION"]);
  }, 180_000);

  it("removing the project also removes a tools container whose run was cut off", async () => {
    // A tools run left behind, as when the builder is stopped while a set-up command runs.
    await run("docker", ["compose", "-f", sb.composeFile, "--profile", "tools", "run", "-d", "--no-deps", "tools", "node", "-e", "setTimeout(() => {}, 120000)"], { env: dockerEnv(sb) });
    const filter = ["ps", "-a", "--filter", `label=com.docker.compose.project=${sb.projectName}`, "--format", "{{.Names}}"];
    expect((await run("docker", filter, { env: dockerEnv(sb) })).stdout.trim()).not.toBe("");
    await sandbox.destroy(sb);
    expect((await run("docker", filter, { env: dockerEnv(sb) })).stdout.trim()).toBe("");
  }, 180_000);
});
