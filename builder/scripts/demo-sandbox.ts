/**
 * Evidence run: one project's containers started by the sandbox manager on the development profile,
 * the egress proxy letting an allowed host through and refusing another, then everything removed.
 * Run from builder/: npx tsx scripts/demo-sandbox.ts
 *
 * Since package 0.6c the egress proxy runs on the machine side (`egress-host`), listening only on the
 * project's socket and, for the image build, on one loopback port with its own list. This demonstration asks
 * through that loopback port, given the project's list here; what the project's containers reach through
 * the door is shown by scripts/demo-isolation.ts.
 */
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createSandbox, sandbox } from "../src/sandbox/manager.js";

const run = promisify(execFile);
const log = (s: string) => console.log(s);
const dir = mkdtempSync(join(tmpdir(), "builder-demo-"));
const sb = createSandbox(
  {
    projectId: "demo_sandbox",
    dir,
    profile: "development-cloud-session",
    allowHosts: ["registry.npmjs.org", "api.anthropic.com"],
    gatewayUrl: "http://127.0.0.1:4010",
    builderDir: resolve(import.meta.dirname, ".."),
    hostProxy: { url: process.env.HTTPS_PROXY ?? "" },
    buildProxyPort: 13145,
    buildAllowHosts: ["registry.npmjs.org", "api.anthropic.com"],
  },
  "sample-only-password",
);
log(`Compose project ${sb.projectName} written to ${sb.composeFile}`);
log("Profile: development-cloud-session (private networks; the egress proxy on the machine side, going out through the session proxy). Allowed hosts: registry.npmjs.org, api.anthropic.com.");
log("");
try {
  await sandbox.up(sb, ["db", "egress"]);
  const ps = JSON.parse(`[${(await sandbox.ps(sb)).trim().split("\n").join(",")}]`) as Array<{ Service: string; State: string; Health?: string }>;
  for (const p of ps) log(`Container ${p.Service}: ${p.State}${p.Health ? ` (${p.Health})` : ""}`);
  const ready = await sandbox.exec(sb, "db", ["pg_isready", "-h", "127.0.0.1", "-p", "5432", "-U", "app", "-d", "app"]);
  log(`Database: ${ready.trim()}`);
  for (let i = 0; i < 20 && !(await sandbox.logs(sb, "egress-host")).includes("127.0.0.1:13145"); i++) await new Promise((r) => setTimeout(r, 500));
  const curl = async (url: string) => {
    try {
      const { stdout } = await run("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "30", "--noproxy", "", "--cacert", "/root/.ccr/ca-bundle.crt", "--proxy", "http://127.0.0.1:13145", url]);
      return stdout.trim();
    } catch (e) {
      return ((e as { stdout?: string }).stdout ?? "000").trim();
    }
  };
  log("");
  log(`Through the egress proxy, https://registry.npmjs.org/-/ping answered HTTP ${await curl("https://registry.npmjs.org/-/ping")} (allowed host).`);
  log(`Through the egress proxy, https://api.anthropic.com/v1/models answered HTTP ${await curl("https://api.anthropic.com/v1/models")} (allowed host; 401 means reached, no key sent).`);
  log(`Through the egress proxy, https://example.com/ answered HTTP ${await curl("https://example.com/")} (not allowed; 000 means the tunnel was refused).`);
  log(`Through the egress proxy, https://github.com/ answered HTTP ${await curl("https://github.com/")} (not allowed).`);
  log("");
  log("Egress proxy log, one line per decision:");
  const lines = (await sandbox.logs(sb, "egress-host")).split("\n").filter((l) => l.includes('"decision"')).map((l) => l.replace(/^[^|]*\|\s*/, "  "));
  for (const l of lines) log(l);
} finally {
  await sandbox.destroy(sb);
  log("");
  log("Containers, network and volume removed.");
}
