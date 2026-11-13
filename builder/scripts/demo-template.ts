/**
 * Evidence run for a house template: copy it into a project sandbox, build its image, start the
 * database and the app, create the tables and the sample users, take screenshots, remove everything.
 *
 * Usage (from builder/): npx tsx scripts/demo-template.ts <templateDir> <outDir> [--guard]
 * With --guard, the role guard is also tried by each kind of visitor (package 0.3).
 * Development profile only. The tables and the sample users are created in the project's tools
 * container (the template image's `tools` stage), never on this machine (package 0.5). Before that,
 * a stand-in seed step run in the same way reports the names in its environment and a fingerprint of
 * each value, and the run fails unless they are exactly the settings given, with the values given, and
 * none of the builder's own settings (scripts/tools-env-check.ts).
 * Since package 0.6c the screenshots and the role guard's checks run in the project's acceptance runner
 * container, on the project's `front` network (scripts/browser-in-project.ts), never on this machine; the
 * runner image is built first from Docker's cache (it needs the approved browser zip, BUILDER_BROWSER_CACHE).
 */
import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildRunnerImage, RUNNER_IMAGE } from "../src/acceptance/runner-image.js";
import { createSandbox, sandbox } from "../src/sandbox/manager.js";
import { runBrowserScript } from "./browser-in-project.js";
import { checkToolsEnv } from "./tools-env-check.js";

const [templateDirArg, outDirArg] = process.argv.slice(2);
if (!templateDirArg || !outDirArg) {
  console.error("usage: demo-template.ts <templateDir> <outDir> [--guard]");
  process.exit(1);
}
const templateDir = resolve(templateDirArg);
const outDir = resolve(outDirArg);
const log = (s: string) => console.log(s);

const dir = mkdtempSync(join(tmpdir(), "builder-tpl-"));
const workspace = join(dir, "workspace");
// A local settings file (.env) is never copied: the app's settings come from the sandbox only.
cpSync(templateDir, workspace, { recursive: true, filter: (src) => !/\/(node_modules|\.next|certs|\.env(\.(?!example$)[^/]*)?)(\/|$)/.test(src) });
log(`Template copied from ${templateDir} to the project workspace.`);

const dbPassword = randomBytes(18).toString("base64url");
const authSecret = randomBytes(32).toString("base64url");
const samplePassword = "Sample-" + randomBytes(9).toString("base64url");
const appPort = 3100;
// The port on the machine's loopback address where the image build's npm finds the egress proxy (package 0.6c).
const buildProxyPort = 13146;
// The app's address on the project's `front` network, the only place it is reached from (package 0.6c).
const appUrl = `http://app:${appPort}`;

const sb = createSandbox(
  {
    projectId: "demo_template",
    dir,
    profile: "development-cloud-session",
    allowHosts: ["registry.npmjs.org"],
    gatewayUrl: "http://127.0.0.1:4010",
    builderDir: resolve(import.meta.dirname, ".."),
    hostProxy: { url: process.env.HTTPS_PROXY ?? "" },
    buildProxyPort,
    app: {
      buildContext: workspace,
      port: appPort,
      env: { APP_URL: appUrl },
      writablePaths: ["/app/.next/cache"],
      toolsEnv: { APP_URL: appUrl },
    },
    acceptance: { image: RUNNER_IMAGE, baseUrl: appUrl },
  },
  dbPassword,
  { AUTH_SECRET: authSecret, APP_SAMPLE_PASSWORD: samplePassword },
);
log(`Compose project ${sb.projectName}: db, egress (the door) and egress-host, app, tools for one-off set-up commands, and the runner's container for the browser. Secrets written to the sandbox's secrets folder only.`);

const t0 = Date.now();
try {
  log("The acceptance runner's image, for the browser, built from Docker's cache (scripts/browser-in-project.ts)...");
  await buildRunnerImage({ hostProxy: { url: process.env.HTTPS_PROXY ?? "", caBundlePath: "/root/.ccr/ca-bundle.crt" } });
  log("Building the app image and the tools image inside Docker (development profile: npm through the project's egress proxy, every other step with no network)...");
  await sandbox.build(sb);
  log(`Image built in ${Math.round((Date.now() - t0) / 1000)} s.`);
  await sandbox.up(sb, ["db"]);
  log("");
  log("The tools container's environment, printed by a stand-in seed step run as the seed is run (scripts/tools-env-check.ts):");
  const envCheck = await checkToolsEnv(sb, {
    DATABASE_URL: `postgres://app:${dbPassword}@db:5432/app`,
    APP_URL: appUrl,
    AUTH_SECRET: authSecret,
    APP_SAMPLE_PASSWORD: samplePassword,
  });
  log(envCheck.lines.map((l) => "  " + l).join("\n"));
  if (!envCheck.passed) throw new Error("the tools container was given a setting it should not have");
  log("");
  log("Creating the tables (drizzle-kit push) and the three sample users (seed), in the tools container...");
  const push = await sandbox.runOnce(sb, "tools", ["node_modules/.bin/drizzle-kit", "push", "--force"]);
  log(`  drizzle-kit push: done (${push.trim().split("\n").length} lines of output, not shown)`);
  const seed = await sandbox.runOnce(sb, "tools", ["node", "--import", "tsx", "scripts/seed.ts"]);
  log(seed.trim().split("\n").map((l) => "  " + l).join("\n"));
  log("Starting the app container and waiting for it to answer...");
  await sandbox.up(sb, ["app"]);
  const ps = JSON.parse(`[${(await sandbox.ps(sb)).trim().split("\n").join(",")}]`) as Array<{ Service: string; State: string; Health?: string }>;
  for (const p of ps) log(`  Container ${p.Service}: ${p.State}${p.Health ? ` (${p.Health})` : ""}`);
  log("");
  log("Screenshots, taken by a browser in the runner's container on the project's front network, as a person would see the pages:");
  const scripts = resolve(import.meta.dirname);
  const shots = await runBrowserScript(sb, join(scripts, "screenshot.ts"), appUrl, outDir, samplePassword);
  log(shots.lines.map((l) => "  " + l).join("\n"));
  if (shots.code !== 0) throw new Error(`the screenshots did not finish (exit ${shots.code}): ${shots.stderrTail.slice(-1500)}`);
  if (process.argv.includes("--guard")) {
    log("");
    log("The role guard, tried by each kind of visitor (scripts/guard-checks.ts), in the same way:");
    const g = await runBrowserScript(sb, join(scripts, "guard-checks.ts"), appUrl, join(outDir, "guard"), samplePassword);
    log(g.lines.map((l) => "  " + l).join("\n"));
    if (g.code !== 0) throw new Error(`the role guard checks did not all pass (exit ${g.code}): ${g.stderrTail.slice(-1500)}`);
  }
  log("");
  log(`Whole run: ${Math.round((Date.now() - t0) / 1000)} s.`);
} catch (err) {
  const e = err as { stdout?: string; stderr?: string; message?: string };
  log("FAILED: " + (e.message ?? String(err)));
  if (e.stderr) log(e.stderr.slice(-3000));
  try {
    log((await sandbox.logs(sb, "app")).slice(-3000));
  } catch {
    /* app may not have started */
  }
  process.exitCode = 1;
} finally {
  await sandbox.destroy(sb);
  await sandbox.removeImage(sb);
  // The temporary folder holds this run's generated secrets: it goes too.
  rmSync(dir, { recursive: true, force: true });
  log("Containers, network, volume, image and the temporary folder removed.");
}
