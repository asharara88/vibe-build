// Measures what happens to the builder's process when a step's event handler fails asynchronously (an
// async handler whose promise rejects, as one that awaits a failing write to the event store would):
// does the process end, and is the engine container left running? Second review of package 2.1.
//
// Usage, from builder/:  npx tsx ../evidence/2026-11-12-package-2.1/measure-async-handler.mts [<builder src folder>]
// The src folder is the code measured (default: this checkout's builder/src); the template and the change
// sets come from this checkout. The parent makes a scratch project and runs one step in a child process,
// so that the child can end without taking the clean-up with it. The applier runs only in the engine
// container. Made-up data only; no model.
import { execFile, spawnSync } from "node:child_process";
import { chownSync, cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const checkout = resolve(import.meta.dirname, "..", "..");
const mode = process.argv[2] === "child" ? "child" : "parent";
const src = resolve(mode === "child" ? process.argv[3]! : (process.argv[2] ?? join(checkout, "builder", "src")));
const { createSandbox, dockerEnv, sandbox } = await import(join(src, "sandbox", "manager.ts"));
const { ScriptedEngine, TEMPLATE_PROTECTED_PATHS } = await import(join(src, "engine", "scripted.ts"));
const { initProjectRepo, workspaceChanges } = await import(join(src, "engine", "project-repo.ts"));

const spec = (dir: string) => ({
  projectId: "p_measure_async",
  allowHosts: ["registry.npmjs.org"],
  gatewayUrl: "http://gateway:4010",
  builderDir: join(checkout, "builder"),
  hostProxy: { url: process.env.HTTPS_PROXY ?? "http://127.0.0.1:1", caBundlePath: "/root/.ccr/ca-bundle.crt" },
  devDbPort: 5597,
  profile: "development-cloud-session" as const,
  dir,
  app: { buildContext: join(dir, "workspace"), port: 3197 },
  engine: { workspace: join(dir, "workspace"), changeSets: join(checkout, "builder", "scripted") },
});

if (mode === "child") {
  const dir = process.argv[4]!;
  const sb = createSandbox(spec(dir), "sample-only-password");
  const engine = new ScriptedEngine({ sandbox: sb, workspace: join(dir, "workspace"), gitDir: join(dir, "workspace.git"), changeSetsDir: join(checkout, "builder", "scripted"), example: "example-1", delayMsPerWrite: 2000 });
  console.log("child: the step starts (01-data, 2 s before each write; the handler rejects 10 ms after the first write's event)");
  const res = await engine.runStep({ projectId: "p_measure_async", stepId: "01-data", instruction: "", protectedPaths: [...TEMPLATE_PROTECTED_PATHS], maxTurns: 50 }, async (e: { type: string }) => {
    if (e.type === "tool_call") {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("made-up failure in an async event handler");
    }
  });
  console.log(`child: the step ended: ${JSON.stringify({ ok: res.ok, failureReason: res.failureReason, turns: res.turns, changedFiles: res.changedFiles })}`);
  await new Promise((r) => setTimeout(r, 500));
  console.log("child: still running 0.5 s after the step ended; exits normally");
} else {
  console.log(`code measured: ${src === join(checkout, "builder", "src") ? "this checkout's builder/src" : "the folder given (see the evidence file)"}`);
  const dir = mkdtempSync(join(tmpdir(), "builder-measure-async-"));
  // A copy of the template as the demonstrations make it, then the project's sandbox (which puts the session certificate in it).
  cpSync(join(checkout, "templates", "next"), join(dir, "workspace"), { recursive: true, filter: (p) => !/\/(node_modules|\.next|certs|\.env(\.(?!example$)[^/]*)?)(\/|$)/.test(p) });
  const sb = createSandbox(spec(dir), "sample-only-password");
  const containers = async () =>
    (await run("docker", ["ps", "-a", "--filter", `label=com.docker.compose.project=${sb.projectName}`, "--format", "{{.Status}}"], { env: dockerEnv(sb) })).stdout.trim() || "none";
  try {
    // The engine runs as uid 1000 (known gap 57).
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => [join(d, e.name), ...(e.isDirectory() ? walk(join(d, e.name)) : [])]);
    if (process.getuid?.() === 0) for (const f of [join(dir, "workspace"), ...walk(join(dir, "workspace"))]) chownSync(f, 1000, 1000);
    await initProjectRepo({ gitDir: join(dir, "workspace.git"), workTree: join(dir, "workspace") }, "Template copy");
    const t = Date.now();
    const child = spawnSync(process.execPath, [...process.execArgv, import.meta.filename, "child", src, dir], { encoding: "utf8", timeout: 120_000 });
    console.log(`child process: exit code ${child.status} after ${((Date.now() - t) / 1000).toFixed(1)} s`);
    for (const l of child.stdout.trim().split("\n")) console.log(`  ${l}`);
    const err = child.stderr.split("\n").find((l) => /Error/.test(l));
    console.log(`  child's error output, first line naming an error: ${err ? err.trim() : "(none)"}`);
    console.log(`engine containers of the project right after the child ended: ${await containers()}`);
    await new Promise((r) => setTimeout(r, 2000));
    console.log(`engine containers 2 s later: ${await containers()}`);
    console.log(`files differing from the last commit: ${JSON.stringify((await workspaceChanges({ gitDir: join(dir, "workspace.git"), workTree: join(dir, "workspace") })).changed)}`);
  } finally {
    await sandbox.destroy(sb).catch(() => undefined);
    console.log(`after removing the project: containers ${await containers()}`);
    rmSync(dir, { recursive: true, force: true });
    console.log(`scratch folder removed: ${!existsSync(dir)}`);
  }
}
