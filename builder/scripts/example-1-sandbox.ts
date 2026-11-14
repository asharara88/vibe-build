/**
 * Example 1's app, built by the scripted engine in a project sandbox on the development profile, with the
 * acceptance runner's service (package 3.1). Shared by scripts/demo-acceptance.ts and
 * test/acceptance-live.test.ts.
 *
 * The sandbox's engine reads its change sets from a folder of the sandbox's own (engine-change-sets/):
 * the applier and example 1's two fixed steps, copied from builder/scripted. The deliberately broken
 * step 03 (builder/scripted-broken) is copied in only when the broken copy is built, just before step 03
 * runs, so that the containers of steps 01 and 02 never see it.
 *
 * Development profile only. No model is called. Made-up data only.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chownSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { EngineEvent, StepResult } from "../src/engine/interface.js";
import { initProjectRepo, type ProjectRepo } from "../src/engine/project-repo.js";
import { ScriptedEngine, TEMPLATE_PROTECTED_PATHS, type EngineRunner } from "../src/engine/scripted.js";
import { createSandbox, dockerEnv, sandbox, type Sandbox, type StreamingRun } from "../src/sandbox/manager.js";

const run = promisify(execFile);
export const builderDir = resolve(import.meta.dirname, "..");
export const templateDir = resolve(builderDir, "..", "templates", "next");
export const EXAMPLE = "example-1";

export interface Example1 {
  projectId: string;
  dir: string;
  workspace: string;
  changeSets: string;
  repo: ProjectRepo;
  sb: Sandbox;
  appPort: number;
  /** The port on the machine's loopback address where the image build's npm finds the egress proxy (package 0.6c). */
  buildProxyPort: number;
  /** http://app:<port>: the app's address on the project's `front` network, the only place it is reached from (package 0.6c). */
  appUrl: string;
  samplePassword: string;
}

/** True if nothing accepts a connection on 127.0.0.1:port (used for the build proxy's port on the machine, never for the app). */
export function portFree(port: number): Promise<boolean> {
  return new Promise((ok) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => {
      s.destroy();
      ok(false);
    });
    s.once("error", () => ok(true));
  });
}

/** A fresh sandbox for example 1: the template copied into its workspace, its history outside it, the engine's change sets, and the runner's service. */
export async function makeExample1(opts: { projectId: string; appPort: number; buildProxyPort: number; runnerImage: string }): Promise<Example1> {
  if (!(await portFree(opts.buildProxyPort))) throw new Error(`Something already listens on 127.0.0.1:${opts.buildProxyPort}; the build's proxy port must be free.`);
  const dir = mkdtempSync(join(tmpdir(), "builder-acceptance-"));
  const workspace = join(dir, "workspace");
  // A local settings file (.env) is never copied: the app's settings come from the sandbox only.
  cpSync(templateDir, workspace, { recursive: true, filter: (src) => !/\/(node_modules|\.next|certs|\.env(\.(?!example$)[^/]*)?)(\/|$)/.test(src) });
  const changeSets = join(dir, "engine-change-sets");
  mkdirSync(join(changeSets, EXAMPLE), { recursive: true });
  cpSync(join(builderDir, "scripted", "apply.mjs"), join(changeSets, "apply.mjs"));
  for (const step of ["01-data", "02-submitter-screen"]) cpSync(join(builderDir, "scripted", EXAMPLE, step), join(changeSets, EXAMPLE, step), { recursive: true });
  const appUrl = `http://app:${opts.appPort}`;
  const samplePassword = "Sample-" + randomBytes(9).toString("base64url");
  const sb = createSandbox(
    {
      projectId: opts.projectId,
      dir,
      profile: "development-cloud-session",
      allowHosts: ["registry.npmjs.org"],
      gatewayUrl: "http://127.0.0.1:4010",
      builderDir,
      hostProxy: { url: process.env.HTTPS_PROXY ?? "" },
      buildProxyPort: opts.buildProxyPort,
      app: { buildContext: workspace, port: opts.appPort, env: { APP_URL: appUrl }, writablePaths: ["/app/.next/cache"], toolsEnv: { APP_URL: appUrl } },
      engine: { workspace, changeSets },
      acceptance: { image: opts.runnerImage, baseUrl: appUrl },
    },
    randomBytes(18).toString("base64url"),
    { AUTH_SECRET: randomBytes(32).toString("base64url"), APP_SAMPLE_PASSWORD: samplePassword },
  );
  // The engine runs as the image's unprivileged user node (uid 1000): the workspace becomes that user's.
  if (process.getuid?.() === 0) {
    const chownTree = (p: string) => {
      chownSync(p, 1000, 1000);
      for (const e of readdirSync(p, { withFileTypes: true })) {
        if (e.isDirectory()) chownTree(join(p, e.name));
        else chownSync(join(p, e.name), 1000, 1000);
      }
    };
    chownTree(workspace);
  }
  const repo: ProjectRepo = { gitDir: join(dir, "workspace.git"), workTree: workspace };
  await initProjectRepo(repo, "Template copy: templates/next as copied into the project");
  return { projectId: opts.projectId, dir, workspace, changeSets, repo, sb, appPort: opts.appPort, buildProxyPort: opts.buildProxyPort, appUrl, samplePassword };
}

/** Copy the deliberately broken step 03 into the sandbox's change sets, just before it runs. */
export function stageBrokenStep(x: Example1): void {
  const into = join(x.changeSets, EXAMPLE, "03-wrong-status");
  // After the review of pull request #49 (14 Nov 2026): whatever is already at the step's own folder is removed first.
  // A link there, or below it (its files folder, its manifest), is unlinked and never followed, and the copy then
  // writes only into a folder it has just made. Before, the copy followed a link inside an existing folder and wrote
  // through it. A retry of the step stages again from the start, as before.
  rmSync(into, { recursive: true, force: true });
  cpSync(join(builderDir, "scripted-broken", EXAMPLE, "03-wrong-status"), into, { recursive: true });
}

/**
 * Run one fixed step in a fresh engine container. `onContainer` is given the container's handle as soon as
 * it is asked for (the evidence inspects it while it runs); `delayMsPerWrite` keeps it alive long enough.
 */
export async function runStep(
  x: Example1,
  stepId: string,
  opts: { delayMsPerWrite?: number; onContainer?: (run: StreamingRun, volumes: string[]) => void; onEvent?: (e: EngineEvent) => void } = {},
): Promise<StepResult> {
  const runner: EngineRunner = (a) => {
    const r = sandbox.runStreaming(x.sb, "engine", a.cmd, { container: a.container, volumes: a.volumes, onLine: a.onLine, timeoutMs: a.timeoutMs });
    opts.onContainer?.(r, a.volumes);
    return r;
  };
  const engine = new ScriptedEngine({ sandbox: x.sb, workspace: x.workspace, gitDir: x.repo.gitDir, changeSetsDir: x.changeSets, example: EXAMPLE, delayMsPerWrite: opts.delayMsPerWrite, runner });
  return engine.runStep(
    { projectId: x.projectId, stepId, instruction: `Made-up instruction for ${stepId}; the scripted engine does not read it.`, protectedPaths: [...TEMPLATE_PROTECTED_PATHS], maxTurns: 20 },
    (e) => opts.onEvent?.(e),
  );
}

/**
 * Build the images, create the tables and sample users in the tools container, and start the app, after
 * checking, from a container on the project's `front` network, that nothing answers at the app's address yet
 * (only the project's own app can take the name `app` there; known gap 75).
 */
export async function buildAndStart(x: Example1, log: (s: string) => void = () => undefined): Promise<void> {
  await sandbox.build(x.sb);
  log("  App and tools images built (the template's guard check and next build ran in the build).");
  await sandbox.up(x.sb, ["db"]);
  await sandbox.runOnce(x.sb, "tools", ["node_modules/.bin/drizzle-kit", "push", "--force"]);
  const seed = await sandbox.runOnce(x.sb, "tools", ["node", "--import", "tsx", "scripts/seed.ts"]);
  log(`  Tables created and sample users added in the tools container (${seed.trim().split("\n").length} lines from the seed).`);
  const before = await sandbox.askApp(x.sb, `${x.appUrl}/en/sign-in`);
  if (!("error" in before)) throw new Error(`Something already answers at ${x.appUrl} on the project's network (HTTP ${before.status}); the app is not started, so that the runner cannot test another program.`);
  log(`  Before the app was started, nothing answered at ${x.appUrl}, asked from a container on the project's front network (${before.error}).`);
  await sandbox.up(x.sb, ["app"]);
  log("  App container started and healthy.");
}

/** Remove the project's containers, network, volume and images, and its temporary folder. */
export async function destroyExample1(x: Example1): Promise<string> {
  await sandbox.destroy(x.sb).catch(() => undefined);
  await sandbox.removeImage(x.sb).catch(() => undefined);
  const env = dockerEnv(x.sb);
  const left = await run("docker", ["ps", "-a", "--filter", `label=com.docker.compose.project=${x.sb.projectName}`, "--format", "{{.Names}}"], { env }).then((o) => o.stdout.trim());
  rmSync(x.dir, { recursive: true, force: true });
  return `containers of the project left: ${left || "none"}; temporary folder ${existsSync(x.dir) ? "still there" : "removed"}`;
}
