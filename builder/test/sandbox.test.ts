import { execFile, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { composeDocument, createSandbox, DEFAULT_IMAGES, dockerEnv, sandbox, toYaml, type SandboxSpec } from "../src/sandbox/manager.js";

const run = promisify(execFile);
const builderDir = resolve(import.meta.dirname, "..");

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
  allowHosts: ["registry.npmjs.org", "gateway"],
  gatewayUrl: "http://gateway:4010",
  builderDir,
  hostProxy: { url: process.env.HTTPS_PROXY ?? "http://127.0.0.1:1", caBundlePath: "/root/.ccr/ca-bundle.crt" },
  devDbPort: 5543,
};

describe("sandbox manager: compose documents", () => {
  it("server profile: an internal network with no route out, and the egress proxy as the only bridge", () => {
    const doc = composeDocument({ ...base, profile: "server", dir: "/tmp/x" }) as {
      networks: Record<string, { internal?: boolean }>;
      services: Record<string, { networks?: string[]; cap_drop?: string[]; read_only?: boolean; environment?: Record<string, string> }>;
    };
    expect(doc.networks.internal?.internal).toBe(true);
    expect(doc.services.db?.networks).toEqual(["internal"]);
    expect(doc.services.egress?.networks).toEqual(["internal", "egress"]);
    expect(doc.services.egress?.environment?.EGRESS_ALLOW).toBe("registry.npmjs.org,gateway");
    for (const s of Object.values(doc.services)) expect(s.cap_drop).toEqual(["ALL"]);
  });

  it("development profile: host network, session proxy and certificate, database on a non-default port", () => {
    const doc = composeDocument({ ...base, profile: "development-cloud-session", dir: "/tmp/x" }) as {
      services: Record<string, { network_mode?: string; environment?: Record<string, string>; volumes?: string[] }>;
    };
    expect(doc.services.db?.network_mode).toBe("host");
    expect(doc.services.db?.environment?.PGPORT).toBe("5543");
    expect(doc.services.egress?.environment?.EGRESS_UPSTREAM_PROXY).toBe(base.hostProxy!.url);
    expect(doc.services.egress?.volumes?.some((v) => v.endsWith(":/certs/session-ca.crt:ro"))).toBe(true);
  });

  it("package 0.5: a tools service under its own profile, given a named list of settings and nothing from the host", () => {
    for (const profile of ["server", "development-cloud-session"] as const) {
      const doc = composeDocument({
        ...base,
        profile,
        dir: "/tmp/x",
        app: { buildContext: "/tmp/x/workspace", port: 3100, env: { APP_URL: "http://127.0.0.1:3100" }, toolsEnv: { APP_URL: "http://127.0.0.1:3100" } },
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
      if (profile === "server") expect(tools.networks).toEqual(["internal"]);
      else expect(tools.network_mode).toBe("host");
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
  const dir = mkdtempSync(join(tmpdir(), "builder-live-"));
  const sb = createSandbox({ ...base, projectId: "p_live", profile: "development-cloud-session", dir }, "sample-only-password");

  afterAll(async () => {
    await sandbox.destroy(sb).catch(() => undefined);
  });

  it("starts the project's database and egress proxy, and the proxy refuses hosts not on the list", async () => {
    await sandbox.up(sb, ["db", "egress"]);
    // `up --wait` returns once the health check has passed. The database image's start script first runs a
    // temporary server to set the database up, stops it, then starts the real one, and the health check can
    // pass on the temporary one; so the database is asked again until it answers, every 500 ms for up to 30 s.
    const ready = await askUntil(
      () => sandbox.exec(sb, "db", ["pg_isready", "-U", "app", "-d", "app", "-p", "5543"]),
      (answer) => /accepting connections/.test(answer),
      { everyMs: 500, forMs: 30_000 },
    );
    expect(ready).toMatch(/accepting connections/);

    // The egress proxy listens on the host network (development profile) on port 3128.
    const curl = async (url: string) => {
      try {
        const { stdout } = await run("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "30", "--noproxy", "", "--cacert", "/root/.ccr/ca-bundle.crt", "--proxy", "http://127.0.0.1:3128", url]);
        return stdout.trim();
      } catch (e) {
        return ((e as { stdout?: string }).stdout ?? "000").trim();
      }
    };
    // Give the proxy a moment to start listening.
    for (let i = 0; i < 20; i++) {
      const logs = await sandbox.logs(sb, "egress");
      if (logs.includes('"listening"')) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(await curl("https://registry.npmjs.org/-/ping")).toBe("200");
    expect(await curl("https://example.com/")).not.toBe("200");
    const logs = await sandbox.logs(sb, "egress");
    expect(logs).toContain('"host":"example.com"');
    expect(logs).toContain('"decision":"refused"');
  }, 180_000);
});

describe("sandbox manager: live, the tools container (package 0.5)", () => {
  // A small tools image made from the base image the template uses, started without its shell script,
  // as the template's tools stage is. Nothing is fetched: the base image is already on this machine.
  const dir = mkdtempSync(join(tmpdir(), "builder-tools-"));
  // A user's home folder whose Docker client configuration adds made-up proxies to every container.
  const userHome = mkdtempSync(join(tmpdir(), "builder-home-"));
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
      { ...base, projectId: "p_tools_live", profile: "development-cloud-session", dir, devDbPort: 5549, app: { buildContext: join(dir, "workspace"), port: 3119, toolsEnv: { APP_URL: "http://made-up.invalid" } } },
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
