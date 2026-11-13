/**
 * Run one of the evidence browser scripts (screenshot.ts, guard-checks.ts, screenshot-scripted.ts) inside the
 * project's acceptance runner container, on the project's `front` network, never on the machine (package
 * 0.6c). Until 0.6c these scripts started a browser on the machine and loaded the app from there, which would
 * have run the app's page code on the machine's network.
 *
 * The script is mounted read-only at /runner/evidence/<name>.mts, where the runner image's Playwright is found
 * and Node strips its types; the output folder at /out; the sample password in a file at
 * /run/secrets/sample-password, read-only, removed afterwards. It runs as the runner image's user, with the
 * hardening every project container gets. The sandbox must have the acceptance service (`spec.acceptance`).
 */
import { chmodSync, chownSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { RUNNER_UID } from "../src/acceptance/runner-image.js";
import { sandbox, type Sandbox } from "../src/sandbox/manager.js";

export async function runBrowserScript(sb: Sandbox, script: string, baseUrl: string, outDir: string, samplePassword: string): Promise<{ code: number | null; lines: string[]; stderrTail: string }> {
  const out = resolve(outDir);
  mkdirSync(out, { recursive: true });
  const secretDir = mkdtempSync(join(tmpdir(), "builder-browser-secret-"));
  const secret = join(secretDir, "sample-password");
  writeFileSync(secret, samplePassword, { mode: 0o400 });
  if (process.getuid?.() === 0) {
    chownSync(out, RUNNER_UID, RUNNER_UID);
    chownSync(secret, RUNNER_UID, RUNNER_UID);
  } else {
    // Not root: the runner's user cannot be given the files, so they are opened to every user (development machine only).
    chmodSync(out, 0o777);
    chmodSync(secret, 0o444);
  }
  chmodSync(secretDir, 0o755);
  const name = basename(script).replace(/\.ts$/, "");
  const lines: string[] = [];
  try {
    const r = sandbox.runStreaming(sb, "acceptance", ["node", `/runner/evidence/${name}.mts`, baseUrl, "/out", "/run/secrets/sample-password"], {
      container: `${sb.projectName}-browser-${name}`.slice(0, 120),
      volumes: [`${resolve(script)}:/runner/evidence/${name}.mts:ro`, `${out}:/out`, `${secret}:/run/secrets/sample-password:ro`],
      onLine: (l) => lines.push(l),
      timeoutMs: 600_000,
    });
    const end = await r.done;
    return { code: end.code, lines, stderrTail: end.stderrTail };
  } finally {
    rmSync(secretDir, { recursive: true, force: true });
  }
}
