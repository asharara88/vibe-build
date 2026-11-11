import { execFile } from "node:child_process";
import type http from "node:http";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEgressProxy, hostAllowed, type EgressRecord } from "../src/sandbox/egress-proxy.js";

const run = promisify(execFile);
const sessionProxy = process.env.HTTPS_PROXY;
const sessionCa = "/root/.ccr/ca-bundle.crt";

let server: http.Server;
let proxyUrl: string;
const records: EgressRecord[] = [];

beforeAll(async () => {
  server = createEgressProxy({
    allow: ["registry.npmjs.org", "*.anthropic.com"],
    upstreamProxy: sessionProxy || undefined,
    log: (r) => records.push(r),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as { port: number };
  proxyUrl = `http://127.0.0.1:${addr.port}`;
});
afterAll(() => server.close());

/** curl through the egress proxy; returns the HTTP status (000 when the tunnel was refused). */
async function viaProxy(url: string): Promise<string> {
  // --noproxy "" stops curl honouring the machine's NO_PROXY list, which would bypass our proxy.
  const args = ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "30", "--noproxy", "", "--proxy", proxyUrl, url];
  if (sessionProxy) args.unshift("--cacert", sessionCa);
  try {
    const { stdout } = await run("curl", args);
    return stdout.trim();
  } catch (e) {
    const err = e as { stdout?: string };
    return (err.stdout ?? "000").trim();
  }
}

describe("egress proxy", () => {
  it("matches exact hosts and wildcard subdomains, nothing else", () => {
    const allow = ["registry.npmjs.org", "*.anthropic.com"];
    expect(hostAllowed("registry.npmjs.org", allow)).toBe(true);
    expect(hostAllowed("api.anthropic.com", allow)).toBe(true);
    expect(hostAllowed("anthropic.com", allow)).toBe(false);
    expect(hostAllowed("evil-registry.npmjs.org.example.com", allow)).toBe(false);
    expect(hostAllowed("example.com", allow)).toBe(false);
  });

  it("lets an allowed HTTPS host through and logs it as allowed", async () => {
    const status = await viaProxy("https://registry.npmjs.org/-/ping");
    expect(status).toBe("200");
    const rec = records.find((r) => r.host === "registry.npmjs.org");
    expect(rec?.decision).toBe("allowed");
    expect(rec?.method).toBe("CONNECT");
  });

  it("reaches the model API host (401 without a key means it was reached)", async () => {
    const status = await viaProxy("https://api.anthropic.com/v1/models");
    expect(status).toBe("401");
  });

  it("refuses a host that is not on the list and logs the refusal", async () => {
    const status = await viaProxy("https://example.com/");
    expect(status).not.toBe("200");
    const rec = records.find((r) => r.host === "example.com");
    expect(rec?.decision).toBe("refused");
  });

  it("refuses a plain HTTP request to a host not on the list", async () => {
    const status = await viaProxy("http://example.com/");
    expect(status).toBe("403");
  });
});
