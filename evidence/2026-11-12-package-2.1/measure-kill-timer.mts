// Measures how long a process that kills a streaming run lives after its work is done (review note:
// kill() used to leave a 15-second timer pending). Made-up data only; the container runs `sleep`-like node.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const wt = process.argv[2]!;
const { createSandbox, sandbox } = await import(join(wt, "builder/src/sandbox/manager.ts"));
const t0 = Date.now();
const dir = mkdtempSync(join(tmpdir(), "builder-measure-kill-"));
mkdirSync(join(dir, "workspace"));
mkdirSync(join(dir, "sets"));
const sb = createSandbox(
  {
    projectId: "p_measure_kill",
    dir,
    profile: "development-cloud-session",
    allowHosts: ["registry.npmjs.org"],
    gatewayUrl: "http://127.0.0.1:4010",
    builderDir: join(wt, "builder"),
    hostProxy: { url: process.env.HTTPS_PROXY ?? "", caBundlePath: "/root/.ccr/ca-bundle.crt" },
    devDbPort: 5599,
    engine: { workspace: join(dir, "workspace"), changeSets: join(dir, "sets") },
  },
  "sample-only-password",
);
const r = sandbox.runStreaming(sb, "engine", ["node", "-e", "console.log('running'); setTimeout(() => {}, 60000)"], {
  container: `${sb.projectName}-measure`,
  onLine: (l: string) => console.log(`line: ${l}`),
});
await new Promise((res) => setTimeout(res, 1500));
await r.kill();
const end = await r.done;
await sandbox.destroy(sb);
rmSync(dir, { recursive: true, force: true });
console.log(`run ended with code ${end.code}; all work done ${((Date.now() - t0) / 1000).toFixed(1)} s after the start`);
process.on("exit", () => console.log(`process exits ${((Date.now() - t0) / 1000).toFixed(1)} s after the start`));
