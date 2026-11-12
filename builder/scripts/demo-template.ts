/**
 * Evidence run for a house template: copy it into a project sandbox, build its image, start the
 * database and the app, create the tables and the sample users, take screenshots, remove everything.
 *
 * Usage (from builder/): npx tsx scripts/demo-template.ts <templateDir> <outDir> [--guard]
 * With --guard, the role guard is also tried by each kind of visitor (package 0.3).
 * Development profile only. Schema push and seeding run from this machine against the project's
 * database because the run-time image carries no development tools (docs/KNOWN-GAPS.md, gap 29).
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createSandbox, sandbox } from "../src/sandbox/manager.js";

const run = promisify(execFile);
const [templateDirArg, outDirArg] = process.argv.slice(2);
if (!templateDirArg || !outDirArg) {
  console.error("usage: demo-template.ts <templateDir> <outDir>");
  process.exit(1);
}
const templateDir = resolve(templateDirArg);
const outDir = resolve(outDirArg);
const log = (s: string) => console.log(s);

const dir = mkdtempSync(join(tmpdir(), "builder-tpl-"));
const workspace = join(dir, "workspace");
cpSync(templateDir, workspace, { recursive: true, filter: (src) => !/\/(node_modules|\.next|certs)(\/|$)/.test(src) });
log(`Template copied from ${templateDir} to the project workspace.`);

const dbPassword = randomBytes(18).toString("base64url");
const authSecret = randomBytes(32).toString("base64url");
const samplePassword = "Sample-" + randomBytes(9).toString("base64url");
const appPort = 3100;
const dbPort = 5546;
const appUrl = `http://127.0.0.1:${appPort}`;

const sb = createSandbox(
  {
    projectId: "demo_template",
    dir,
    profile: "development-cloud-session",
    allowHosts: ["registry.npmjs.org"],
    gatewayUrl: "http://127.0.0.1:4010",
    builderDir: resolve(import.meta.dirname, ".."),
    hostProxy: { url: process.env.HTTPS_PROXY ?? "", caBundlePath: "/root/.ccr/ca-bundle.crt" },
    devDbPort: dbPort,
    app: { buildContext: workspace, port: appPort, env: { APP_URL: appUrl }, writablePaths: ["/app/.next/cache"] },
  },
  dbPassword,
  { AUTH_SECRET: authSecret, APP_SAMPLE_PASSWORD: samplePassword },
);
log(`Compose project ${sb.projectName}: db, egress, app. Secrets written to the sandbox's secrets folder only.`);

const t0 = Date.now();
try {
  log("Building the app image inside Docker (development profile: build steps use the session proxy)...");
  await sandbox.build(sb);
  log(`Image built in ${Math.round((Date.now() - t0) / 1000)} s.`);
  await sandbox.up(sb, ["db"]);
  const dbUrl = `postgres://app:${dbPassword}@127.0.0.1:${dbPort}/app`;
  log("Creating the tables (drizzle-kit push) and the three sample users (seed)...");
  await run("npx", ["drizzle-kit", "push", "--force"], { cwd: templateDir, env: { ...process.env, DATABASE_URL: dbUrl }, timeout: 180_000 });
  const seed = await run("node", ["--import", "tsx", "scripts/seed.ts"], {
    cwd: templateDir,
    env: { ...process.env, DATABASE_URL: dbUrl, AUTH_SECRET: authSecret, APP_URL: appUrl, APP_SAMPLE_PASSWORD: samplePassword },
    timeout: 180_000,
  });
  log(seed.stdout.trim().split("\n").map((l) => "  " + l).join("\n"));
  log("Starting the app container and waiting for it to answer...");
  await sandbox.up(sb, ["app"]);
  const ps = JSON.parse(`[${(await sandbox.ps(sb)).trim().split("\n").join(",")}]`) as Array<{ Service: string; State: string; Health?: string }>;
  for (const p of ps) log(`  Container ${p.Service}: ${p.State}${p.Health ? ` (${p.Health})` : ""}`);
  log("");
  log("Screenshots, taken by a browser as a person would see the pages:");
  const shots = await run("node", ["--import", "tsx", "scripts/screenshot.ts", appUrl, outDir, samplePassword], { cwd: resolve(import.meta.dirname, ".."), timeout: 300_000 });
  log(shots.stdout.trim().split("\n").map((l) => "  " + l).join("\n"));
  if (process.argv.includes("--guard")) {
    log("");
    log("The role guard, tried by each kind of visitor (scripts/guard-checks.ts):");
    try {
      const g = await run("node", ["--import", "tsx", "scripts/guard-checks.ts", appUrl, join(outDir, "guard"), samplePassword], { cwd: resolve(import.meta.dirname, ".."), timeout: 300_000 });
      log(g.stdout.trim().split("\n").map((l) => "  " + l).join("\n"));
    } catch (err) {
      log(((err as { stdout?: string }).stdout ?? "").trim().split("\n").map((l) => "  " + l).join("\n"));
      throw new Error("the role guard checks did not all pass");
    }
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
  log("Containers, network, volume and image removed.");
}
