/**
 * Evidence run for package 2.1: the scripted engine builds example 1's two fixed steps on the house
 * template, in the project's engine container, and the result runs.
 *
 * Usage (from builder/): npx tsx scripts/demo-scripted.ts <templateDir> <outDir>
 *
 *  1. A fresh workspace copied from the template; its history kept outside it (workspace.git).
 *  2. Both steps through ScriptedEngine, each in a fresh engine container, with every event printed,
 *     the files git saw changed, and the commit.
 *  3. A probe in the same engine service: a write to a protected file, its mounts, its network
 *     interfaces, its settings.
 *  4. sandbox.build: the image build runs the template's guard check and `next build`.
 *  5. The tables (drizzle-kit push) and the sample users (seed) in the tools container; the table read
 *     back from the database; the app started.
 *  6. scripts/screenshot-scripted.ts signs in as the sample employee and records the screens, in the
 *     project's acceptance runner container on the project's `front` network (package 0.6c), never on
 *     this machine; the runner image is built first from Docker's cache (BUILDER_BROWSER_CACHE).
 *  7. The project's history, then every container, image and temporary folder removed.
 *
 * Development profile only. No model is called. Made-up data only.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chownSync, cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { EngineEvent } from "../src/engine/interface.js";
import { describeNotAllowed, entriesGitCannotSee, git, initProjectRepo, type ProjectRepo } from "../src/engine/project-repo.js";
import { listSteps, ScriptedEngine, TEMPLATE_PROTECTED_PATHS } from "../src/engine/scripted.js";
import { buildRunnerImage, RUNNER_IMAGE } from "../src/acceptance/runner-image.js";
import { createSandbox, dockerEnv, sandbox } from "../src/sandbox/manager.js";
import { runBrowserScript } from "./browser-in-project.js";

const run = promisify(execFile);
const [templateDirArg, outDirArg] = process.argv.slice(2);
if (!templateDirArg || !outDirArg) {
  console.error("usage: demo-scripted.ts <templateDir> <outDir>");
  process.exit(1);
}
const templateDir = resolve(templateDirArg);
const outDir = resolve(outDirArg);
const builderDir = resolve(import.meta.dirname, "..");
const changeSets = join(builderDir, "scripted");
const log = (s: string) => console.log(s);
// Terminal colour and cursor codes (drizzle-kit prints them) are taken out of what is kept.
const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const indent = (s: string, pad = "  ") => plain(s).trim().split("\n").map((l) => pad + l).join("\n");

const dir = mkdtempSync(join(tmpdir(), "builder-scripted-"));
const workspace = join(dir, "workspace");
// A local settings file (.env) is never copied: the app's settings come from the sandbox only.
cpSync(templateDir, workspace, { recursive: true, filter: (src) => !/\/(node_modules|\.next|certs|\.env(\.(?!example$)[^/]*)?)(\/|$)/.test(src) });
log(`Template copied from ${templateDir} to the project workspace.`);

const dbPassword = randomBytes(18).toString("base64url");
const authSecret = randomBytes(32).toString("base64url");
const samplePassword = "Sample-" + randomBytes(9).toString("base64url");
const appPort = 3127;
// The port on the machine's loopback address where the image build's npm finds the egress proxy (package 0.6c).
const buildProxyPort = 13157;
// The app's address on the project's `front` network, the only place it is reached from (package 0.6c).
const appUrl = `http://app:${appPort}`;

const sb = createSandbox(
  {
    projectId: "demo_scripted",
    dir,
    profile: "development-cloud-session",
    allowHosts: ["registry.npmjs.org"],
    gatewayUrl: "http://127.0.0.1:4010",
    builderDir,
    hostProxy: { url: process.env.HTTPS_PROXY ?? "" },
    buildProxyPort,
    app: {
      buildContext: workspace,
      port: appPort,
      env: { APP_URL: appUrl },
      writablePaths: ["/app/.next/cache"],
      toolsEnv: { APP_URL: appUrl },
    },
    engine: { workspace, changeSets },
    acceptance: { image: RUNNER_IMAGE, baseUrl: appUrl },
  },
  dbPassword,
  { AUTH_SECRET: authSecret, APP_SAMPLE_PASSWORD: samplePassword },
);
log(`Compose project ${sb.projectName}: db, egress, app, tools, and engine for one step at a time. Secrets written to the sandbox's secrets folder only.`);

// The engine runs as the image's unprivileged user node (uid 1000): the workspace becomes that user's.
function chownTree(p: string) {
  chownSync(p, 1000, 1000);
  for (const e of readdirSync(p, { withFileTypes: true })) {
    if (e.isDirectory()) chownTree(join(p, e.name));
    else chownSync(join(p, e.name), 1000, 1000);
  }
}
if (process.getuid?.() === 0) {
  chownTree(workspace);
  log("Workspace handed to the engine's user (uid 1000).");
}

const repo: ProjectRepo = { gitDir: join(dir, "workspace.git"), workTree: workspace };
const t0 = Date.now();
try {
  log("");
  log("== 1. The project's history, kept outside the workspace ==");
  const first = await initProjectRepo(repo, "Template copy: templates/next as copied into the project");
  log(`  git --git-dir=<sandbox>/workspace.git --work-tree=<sandbox>/workspace: first commit ${first.slice(0, 7)} (the template copy).`);
  log(`  The repository folder holds: ${readdirSync(repo.gitDir).sort().join(", ")}`);
  log(`  The workspace holds no .git: ${readdirSync(workspace).includes(".git") ? "NO, it does" : "true"}`);
  const unseen = () => describeNotAllowed(entriesGitCannotSee(workspace)) || "none";
  log(`  Entries git cannot see (anything named .git at any depth, pipes, sockets, devices), from a walk of the workspace: ${unseen()}`);

  log("");
  log("== 2. The two fixed steps, each in a fresh engine container ==");
  const engine = new ScriptedEngine({ sandbox: sb, workspace, gitDir: repo.gitDir, changeSetsDir: changeSets, example: "example-1" });
  log(`  Engine: ${engine.name}. Steps of example-1: ${listSteps(changeSets, "example-1").join(", ")}.`);
  log(`  Protected paths, each mounted read-only over itself (${TEMPLATE_PROTECTED_PATHS.length}): ${TEMPLATE_PROTECTED_PATHS.join(", ")}`);
  for (const stepId of listSteps(changeSets, "example-1")) {
    log("");
    log(`  -- step ${stepId} --`);
    const events: EngineEvent[] = [];
    const res = await engine.runStep(
      {
        projectId: "demo_scripted",
        stepId,
        instruction: `Made-up instruction for ${stepId}; the scripted engine does not read it.`,
        protectedPaths: [...TEMPLATE_PROTECTED_PATHS],
        maxTurns: 20,
      },
      (e) => {
        events.push(e);
        const what = e.type === "tool_call" ? `${e.tool} ${JSON.stringify(e.input)}` : e.type === "text" ? e.text : e.type === "finished" ? "" : e.reason;
        log(`  event ${e.type}${what ? ": " + what : ""}`);
      },
    );
    log(`  result: ok=${res.ok}, turns=${res.turns}, usage=${JSON.stringify(res.usage)}${res.failureReason ? `, failure: ${res.failureReason}` : ""}`);
    log(`  files git saw changed (${res.changedFiles.length}): ${res.changedFiles.join(", ")}`);
    log(`  entries git cannot see, after the step: ${unseen()}`);
    log(`  commit: ${(await git(repo, ["log", "-1", "--format=%h %an <%ae>, committed by %cn: %s"])).trim()}`);
    if (!res.ok) throw new Error(`step ${stepId} did not finish: ${res.failureReason}`);
  }

  log("");
  log("== 3. A probe in the engine service, with the same mounts as a step ==");
  const netProbe = [
    "require('node:dns').lookup('registry.npmjs.org', (e) => console.log('name lookup of registry.npmjs.org: ' + (e ? 'failed (' + e.code + ')' : 'ANSWERED')));",
    "const s = require('node:net').connect(5432, 'db'); s.on('connect', () => { console.log('connect to db:5432: CONNECTED'); s.destroy(); }); s.on('error', (e) => console.log('connect to db:5432 (the project database, by its name on the project network): failed (' + e.code + ')'));",
  ].join("\n");
  const probe = [
    "const fs = require('node:fs'); const os = require('node:os');",
    "console.log('user id: ' + process.getuid());",
    "for (const p of ['/workspace/src/auth.ts', '/workspace/src/lib/roles.tsx', '/workspace/certs/planted.crt', '/engine/planted.txt']) {",
    "  try { fs.writeFileSync(p, 'x'); console.log('write ' + p + ': WRITTEN'); } catch (e) { console.log('write ' + p + ': refused (' + e.code + ')'); } }",
    "console.log('certs folder as the engine sees it: [' + fs.readdirSync('/workspace/certs').join(', ') + ']');",
    "const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\\n').map((l) => l.split(' ')).filter((f) => f.length > 5 && (f[4].startsWith('/workspace') || f[4] === '/engine' || f[4] === '/' || f[4] === '/tmp'));",
    "for (const f of mounts) console.log('mount ' + f[4] + ' ' + (f[5].split(',').includes('ro') ? 'read-only' : 'read-write'));",
    "console.log('network interfaces: ' + Object.keys(os.networkInterfaces()).join(', '));",
    "console.log('settings inside (names only): ' + Object.keys(process.env).sort().join(', '));",
    netProbe,
  ].join("\n");
  const lines: string[] = [];
  const volumes = TEMPLATE_PROTECTED_PATHS.map((p) => `${join(workspace, p)}:/workspace/${p}:ro`);
  const probeRun = sandbox.runStreaming(sb, "engine", ["node", "-e", probe], { container: `${sb.projectName}-engine-probe`, onLine: (l) => lines.push(l), volumes });
  const probeEnd = await probeRun.done;
  log(indent(lines.join("\n")));
  log(`  probe exit code ${probeEnd.code}`);
  // The database is not running yet at this point; it is started below, and the same connection is tried again then.

  log("");
  log("== 4. The image build: the template's guard check, then next build ==");
  // Nothing from Docker's build cache: identical files from an earlier run would otherwise skip the check and the build.
  await buildRunnerImage({ hostProxy: { url: process.env.HTTPS_PROXY ?? "", caBundlePath: "/root/.ccr/ca-bundle.crt" } });
  const built = await sandbox.build(sb, { noCache: true });
  const guardLines = built.split("\n").filter((l) => /Guard check|^\s*#\d+ [\d.]+\s+(page|action|route) |RESULT: |PROBLEMS:/.test(l));
  log(indent(guardLines.map((l) => l.replace(/^#\d+ [\d.]+\s+/, "")).join("\n")));
  if (!guardLines.some((l) => l.includes("RESULT: PASSED"))) throw new Error("the guard check's result was not seen in the image build's output");
  // The output holds the two builds one after the other, each starting with BuildKit's "#0 building with" line.
  const [appBuild = "", toolsBuild = ""] = built.split(/^#0 building with/m).slice(1);
  // A step taken from the cache prints "#N CACHED"; its name is on the line "#N [stage n/m] ..." before it.
  const cached = (s: string) => {
    const ls = s.split("\n");
    return ls
      .filter((l) => /^#\d+ CACHED/.test(l))
      .map((l) => ls.find((x) => x.startsWith(l.split(" ")[0]! + " [")) ?? l)
      .map((l) => l.replace(/^#\d+ /, ""));
  };
  const appCached = cached(appBuild);
  const toolsCached = cached(toolsBuild);
  log(`  Steps taken from Docker's build cache, app image (built with --no-cache): ${appCached.length}${appCached.length ? ": " + appCached.join("; ") : ""}`);
  log(`  Steps taken from Docker's build cache, tools image (it reuses the steps the app build has just made): ${toolsCached.length}`);
  const routes = built.split("\n").filter((l) => /my-requests|\/\[locale\]\/home/.test(l) && /[├└┌]/.test(l));
  if (routes.length) log(indent("next build listed:\n" + routes.map((l) => l.replace(/^#\d+ [\d.]+\s+/, "")).join("\n")));
  log(`  Images built in ${Math.round((Date.now() - t0) / 1000)} s from the start of the run.`);

  log("");
  log("== 5. Tables and sample users in the tools container; the table read back; the app started ==");
  await sandbox.up(sb, ["db"]);
  const push = await sandbox.runOnce(sb, "tools", ["node_modules/.bin/drizzle-kit", "push", "--force"]);
  log(indent("drizzle-kit push (last lines):\n" + push.trim().split("\n").slice(-4).join("\n")));
  const seed = await sandbox.runOnce(sb, "tools", ["node", "--import", "tsx", "scripts/seed.ts"]);
  log(indent(seed));
  const psql = (sql: string) => sandbox.exec(sb, "db", ["psql", "-U", "app", "-d", "app", "-X", "-A", "-F", " | ", "-c", sql]);
  log(indent("columns of leave_request:\n" + (await psql("select column_name, data_type, is_nullable, coalesce(column_default, '') as column_default from information_schema.columns where table_name = 'leave_request' order by ordinal_position"))));
  log(indent("checks and links of leave_request:\n" + (await psql("select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'leave_request'::regclass order by conname"))));
  const reprobe: string[] = [];
  await sandbox.runStreaming(sb, "engine", ["node", "-e", netProbe], { container: `${sb.projectName}-engine-probe-2`, onLine: (l) => reprobe.push(l) }).done;
  log(indent(`With the database now running on the project's network, from the engine container again:\n${reprobe.join("\n")}`));
  log("  Starting the app container and waiting for it to answer...");
  await sandbox.up(sb, ["app"]);
  const ps = JSON.parse(`[${(await sandbox.ps(sb)).trim().split("\n").join(",")}]`) as Array<{ Service: string; State: string; Health?: string }>;
  for (const p of ps) log(`  Container ${p.Service}: ${p.State}${p.Health ? ` (${p.Health})` : ""}`);

  log("");
  log("== 6. The screens, as the sample employee sees them (scripts/screenshot-scripted.ts, in the runner's container on the project's front network) ==");
  const shots = await runBrowserScript(sb, join(builderDir, "scripts", "screenshot-scripted.ts"), appUrl, outDir, samplePassword);
  log(indent(shots.lines.join("\n")));
  if (shots.code !== 0) throw new Error(`the screen checks did not all pass (exit ${shots.code}): ${shots.stderrTail.slice(-1500)}`);
  log(
    indent(
      "the request as stored:\n" +
        (await psql(
          "select u.email, r.start_date, r.end_date, r.days, r.status, r.created_by = r.employee as created_by_is_employee, r.updated_by = r.employee as updated_by_is_employee from leave_request r join \"user\" u on u.id = r.employee",
        )),
    ),
  );

  log("");
  log("== 7. The project's history ==");
  log(indent(await git(repo, ["log", "--format=%h  %an <%ae>  %s"])));
  for (const c of (await git(repo, ["log", "--format=%h", "-2"])).trim().split("\n")) {
    log(indent(`files in ${c}:\n` + (await git(repo, ["show", "--name-status", "--format=", c])).trim(), "    "));
  }
  log("");
  log(`Whole run: ${Math.round((Date.now() - t0) / 1000)} s.`);
} catch (err) {
  const e = err as { stdout?: string; stderr?: string; message?: string };
  log("FAILED: " + (e.message ?? String(err)));
  if (e.stdout) log(e.stdout.slice(-6000));
  if (e.stderr) log(e.stderr.slice(-3000));
  try {
    log((await sandbox.logs(sb, "app")).slice(-3000));
  } catch {
    /* the app may not have started */
  }
  process.exitCode = 1;
} finally {
  await sandbox.destroy(sb);
  await sandbox.removeImage(sb);
  // The temporary folder holds this run's generated secrets: it goes too.
  rmSync(dir, { recursive: true, force: true });
  const left = await run("docker", ["ps", "-a", "--filter", `label=com.docker.compose.project=${sb.projectName}`, "--format", "{{.Names}}"], { env: dockerEnv(sb) });
  const images = await run("docker", ["images", "--format", "{{.Repository}}", "--filter", `reference=${sb.projectName}*`], { env: dockerEnv(sb) });
  log(`Removed: containers, network, volume, images and the temporary folder. Containers of the project left: ${left.stdout.trim() || "none"}. Images of the project left: ${images.stdout.trim() || "none"}.`);
}
