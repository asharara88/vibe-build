import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { composeDocument, createSandbox, sandbox, toYaml, type SandboxSpec } from "../src/sandbox/manager.js";

const run = promisify(execFile);
const builderDir = resolve(import.meta.dirname, "..");

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
    const ready = await sandbox.exec(sb, "db", ["pg_isready", "-U", "app", "-d", "app", "-p", "5543"]);
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
