/**
 * Evidence run for package 0.6a: isolation checked on the development profile, from inside the
 * project's containers.
 *
 * Usage (from builder/): npx tsx scripts/demo-isolation.ts [outDir]
 *
 *  1. A project sandbox on the development profile, with the house template as its app, so that the
 *     app and tools images are the real ones; the database and the egress proxy started.
 *  2. A stand-in listener on the model gateway's address (127.0.0.1:4010) if nothing listens there, so
 *     that an attempt to reach that port shows whether it can be reached. It answers nothing.
 *  3. Read on the machine, read-only, for the probe's group G: the machine's listening TCP sockets with
 *     their addresses (/proc/net/tcp) and the gateway address of Docker's default network (`docker network
 *     inspect`). Each container then tries a TCP connection to that gateway address on each of those ports.
 *  4. The probe (scripts/isolation-probe.mjs, mounted read-only) run in:
 *     - the app service, as Compose starts it on this profile (host network, the hardening, the image's
 *       user, its settings file), with the probe as its command instead of the app's server;
 *     - the tools service, the same way;
 *     - the engine service (no network);
 *     - for comparison only, a container on Docker's default network, which is not a project container.
 *  5. Every attempt per container, a table of all of them, and the egress proxy's own log.
 *  6. Everything removed: containers, network, volume, images, the stand-in listener, the temporary folder.
 *     Each clean-up step runs on its own, so that one failing does not stop the others, and what is left
 *     is always reported.
 *
 * Nothing the probe tests is run on this machine: every attempt is made from inside a container.
 * Development profile only. No model is called. Made-up data only. No setting's value is printed.
 */
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { ANSWER_WORDING, columnCell, gotAnswer, parseProbeOutput, readMachineSide, renderMarkdownTable, renderTable, sessionProxyHostPort, summarise, type Column, type ProbeReport } from "../src/sandbox/isolation.js";
import { composeDocument, composeProjectName, createSandbox, DEFAULT_IMAGES, dockerEnv, HARDENING, sandbox, type Sandbox, type SandboxSpec } from "../src/sandbox/manager.js";

const run = promisify(execFile);
const builderDir = resolve(import.meta.dirname, "..");
const templateDir = resolve(builderDir, "..", "templates", "next");
const probeFile = join(builderDir, "scripts", "isolation-probe.mjs");
const outDir = process.argv[2] ? resolve(process.argv[2]) : null;
const log = (s: string) => console.log(s);
const indent = (s: string, pad = "  ") => s.split("\n").map((l) => pad + l).join("\n");

const PROJECT_DB_PORT = 5562;
const GATEWAY_PORT = 4010;
const EGRESS_PORT = 3128;
const BUILDER_DB_PORT = 5432;
const PROBE_MOUNT = "/probe/isolation-probe.mjs";

const PROJECT_ID = "demo_isolation";
const ALLOW_HOSTS = ["registry.npmjs.org"];

/** The project, on the development profile, in the temporary folder `dir`. */
const projectSpec = (dir: string): SandboxSpec => {
  const workspace = join(dir, "workspace");
  return {
    projectId: PROJECT_ID,
    dir,
    profile: "development-cloud-session",
    allowHosts: ALLOW_HOSTS,
    gatewayUrl: `http://127.0.0.1:${GATEWAY_PORT}`,
    builderDir,
    hostProxy: { url: process.env.HTTPS_PROXY ?? "", caBundlePath: "/root/.ccr/ca-bundle.crt" },
    devDbPort: PROJECT_DB_PORT,
    app: { buildContext: workspace, port: 3131, env: { APP_URL: "http://127.0.0.1:3131" }, writablePaths: ["/app/.next/cache"], toolsEnv: { APP_URL: "http://127.0.0.1:3131" } },
    engine: { workspace, changeSets: join(builderDir, "scripted") },
  };
};

const sessionProxy = sessionProxyHostPort(process.env.HTTPS_PROXY);
/** The probe's settings, completed with what is read on the machine for group G once the project's services are up. */
let settings = "";
const probeSettings = (machine: { bridgeGateway: string | null; machineListeners: string[] }) =>
  JSON.stringify({
    sessionProxy,
    projectDbPort: PROJECT_DB_PORT,
    egressPort: EGRESS_PORT,
    gatewayPort: GATEWAY_PORT,
    builderDbPort: BUILDER_DB_PORT,
    exampleAddress: "93.184.215.14",
    timeoutMs: 5000,
    ...machine,
  });

/** Run the probe in a fresh container of a project service, through the sandbox manager. */
async function probeService(sb: Sandbox, service: string, label: string): Promise<string[]> {
  const lines: string[] = [];
  const r = sandbox.runStreaming(sb, service, ["node", PROBE_MOUNT, settings], {
    container: `${sb.projectName}-isolation-${label}`,
    onLine: (l) => lines.push(l),
    volumes: [`${probeFile}:${PROBE_MOUNT}:ro`],
    timeoutMs: 300_000,
  });
  const end = await r.done;
  if (end.code !== 0) lines.push(JSON.stringify({ kind: "error", reason: `the container ended with code ${end.code}${end.timedOut ? " (time limit)" : ""}: ${end.stderrTail.slice(-500)}` }));
  return lines;
}

const PROJECT_NAME = composeProjectName(PROJECT_ID);
const COMPARISON = `${PROJECT_NAME}-isolation-bridge`;
/** For comparison only: the probe in a container on Docker's default network, with the same hardening. Not a project container. */
async function probeBridge(sb: Sandbox): Promise<string[]> {
  const args = [
    "run", "--rm", "--name", COMPARISON, "--network", "bridge", "--user", "node",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", String(HARDENING.pids_limit), "--memory", HARDENING.mem_limit, "--read-only",
    "--entrypoint", "", "--volume", `${probeFile}:${PROBE_MOUNT}:ro`, DEFAULT_IMAGES.node, "node", PROBE_MOUNT, settings,
  ];
  const child = spawn("docker", args, { env: dockerEnv(sb), stdio: ["ignore", "pipe", "pipe"] });
  const lines: string[] = [];
  createInterface({ input: child.stdout }).on("line", (l) => lines.push(l));
  let err = "";
  child.stderr.on("data", (d: Buffer) => (err = (err + d.toString("utf8")).slice(-2000)));
  const code = await new Promise<number | null>((r) => child.on("close", r));
  if (code !== 0) lines.push(JSON.stringify({ kind: "error", reason: `the container ended with code ${code}: ${err.slice(-500)}` }));
  return lines;
}

/** A listener on the gateway's address that accepts a connection and closes it, saying nothing. */
async function standInGateway(): Promise<net.Server | string> {
  const server = net.createServer((s) => s.destroy());
  return new Promise((r) => {
    server.once("error", (e: NodeJS.ErrnoException) => r(e.code === "EADDRINUSE" ? "something else already listens there; not started by this run" : `could not listen: ${e.code}`));
    server.listen(GATEWAY_PORT, "127.0.0.1", () => r(server));
  });
}

function show(label: string, report: ProbeReport, ownLoopback: boolean) {
  log(`  -- ${label} --`);
  if (ownLoopback) log("  (127.0.0.1 in this container is its own loopback address, not the machine's.)");
  for (const i of report.info) log(`  ${i.name}: ${i.value}`);
  for (const a of report.attempts) {
    log(`  ${a.id.padEnd(6)} ${a.target}  [${a.how}]`);
    log(`         -> ${columnCell({ label, report, ownLoopback }, a)}${a.detail ? `; ${a.detail}` : ""}`);
  }
  const s = summarise(report);
  log(`  ${s.total} attempts; ${s.answered} got an answer (${ANSWER_WORDING}).`);
  for (const [t, v] of Object.entries(s.byToward)) if (v.total) log(`    toward ${t}: ${v.answered} of ${v.total} got an answer`);
  if (report.problems.length) log(`  PROBLEMS: ${report.problems.join(" / ")}`);
  log("");
}

const t0 = Date.now();
let standIn: net.Server | string = "not started";
// Made inside the try, so that the clean-up below removes whatever was made, however far the run got.
let dir: string | undefined;
let sb: Sandbox | undefined;
try {
  dir = mkdtempSync(join(tmpdir(), "builder-isolation-"));
  const spec = projectSpec(dir);
  // A local settings file (.env) is never copied: the app's settings come from the sandbox only.
  cpSync(templateDir, join(dir, "workspace"), { recursive: true, filter: (src) => !/\/(node_modules|\.next|certs|\.env(\.(?!example$)[^/]*)?)(\/|$)/.test(src) });
  // Made-up secrets for this run only; the app never starts, but its settings file is what its container is given.
  const made = createSandbox(spec, randomBytes(18).toString("base64url"), { AUTH_SECRET: randomBytes(32).toString("base64url"), APP_SAMPLE_PASSWORD: "Sample-" + randomBytes(9).toString("base64url") });
  sb = made;
  log("Package 0.6a: isolation checked on the development profile, from inside the project's containers.");
  log(`Compose project ${made.projectName}, profile development-cloud-session. Egress list: ${spec.allowHosts.join(", ")}.`);
  log(`The session proxy, as given to the probe: ${sessionProxy ?? "not set"} (host and port only).`);
  log("");
  log("== 1. The project's services, as the Compose file gives them ==");
  const doc = composeDocument(spec) as { services: Record<string, { network_mode?: string; networks?: string[]; user?: string; read_only?: boolean; cap_drop?: string[] }> };
  for (const [name, svc] of Object.entries(doc.services)) {
    log(`  ${name.padEnd(6)} network: ${svc.network_mode ?? (svc.networks ?? []).join(", ")}; user: ${svc.user ?? "the image's own"}; read-only root: ${svc.read_only}; capabilities dropped: ${(svc.cap_drop ?? []).join(", ")}`);
  }
  log("");
  log("== 2. Images built, database and egress proxy started ==");
  await sandbox.build(made);
  const users = await Promise.all(
    [made.appBuild!.image, made.appBuild!.toolsImage].map(async (image) => (await run("docker", ["image", "inspect", image, "--format", "{{.Config.User}}"], { env: dockerEnv(made) })).stdout.trim()),
  );
  log(`  App image built (user ${users[0]}), tools image built (user ${users[1]}), from the house template, in ${Math.round((Date.now() - t0) / 1000)} s.`);
  await sandbox.up(made, ["db", "egress"]);
  for (let i = 0; i < 40 && !(await sandbox.logs(made, "egress")).includes('"listening"'); i++) await new Promise((r) => setTimeout(r, 500));
  const ps = JSON.parse(`[${(await sandbox.ps(made)).trim().split("\n").join(",")}]`) as Array<{ Service: string; State: string; Health?: string }>;
  for (const p of ps) log(`  Container ${p.Service}: ${p.State}${p.Health ? ` (${p.Health})` : ""}`);
  standIn = await standInGateway();
  log(`  Stand-in listener on the gateway's address 127.0.0.1:${GATEWAY_PORT}: ${typeof standIn === "string" ? standIn : "listening (accepts a connection and closes it; the real gateway is not running)"}`);
  log("");

  log("== 3. Read on the machine for group G (read-only; nothing is connected to here) ==");
  const machine = await readMachineSide(dockerEnv(made));
  settings = probeSettings(machine);
  log(`  Listening TCP sockets on the machine (/proc/net/tcp): ${machine.machineListeners.join(", ") || "none"}`);
  log(`  Gateway address of Docker's default network (docker network inspect bridge): ${machine.bridgeGateway ?? "none found; no G attempts"}`);
  log("");

  log("== 4. The probe in each container ==");
  log("  Each project container is started with `docker compose run` on its own service, so it has that service's network, hardening, user and settings file;");
  log(`  the probe is mounted read-only at ${PROBE_MOUNT} and is its command, in place of the service's own. The comparison container is started with \`docker run\`.`);
  log(`  Settings given to the probe: ${settings}`);
  log("");
  const columns: Column[] = [];
  const raw: Record<string, string[]> = {};
  // In the engine and comparison containers, 127.0.0.1 is the container's own loopback address, not the machine's.
  const plan: Array<[string, string, boolean, () => Promise<string[]>]> = [
    ["app", "app container (host network)", false, () => probeService(made, "app", "app")],
    ["tools", "tools container (host network)", false, () => probeService(made, "tools", "tools")],
    ["engine", "engine container (no network)", true, () => probeService(made, "engine", "engine")],
    ["bridge", "comparison: default network, not a project container", true, () => probeBridge(made)],
  ];
  for (const [key, label, ownLoopback, go] of plan) {
    const lines = await go();
    raw[key] = lines;
    const report = parseProbeOutput(lines);
    columns.push({ label, report, ownLoopback });
    show(label, report, ownLoopback);
  }

  log("== 5. Every attempt, one row each, one column per container ==");
  log(renderTable(columns));
  log("");
  const engine = columns[2]!.report;
  const engineAnswered = engine.attempts.filter((a) => gotAnswer(a.result)).map((a) => a.id);
  log(`Engine container: every attempt failed: ${engine.ended && engine.attempts.length > 0 && engineAnswered.length === 0 ? "yes" : `NO (${engineAnswered.join(", ") || "the probe did not finish"})`}.`);
  log("");

  log("== 6. The project's egress proxy's own log: one line per decision ==");
  const decisions = (await sandbox.logs(made, "egress")).split("\n").filter((l) => l.includes('"decision"')).map((l) => l.replace(/^[^|]*\|\s*/, "  "));
  log(decisions.join("\n") || "  (none)");
  log(`  ${decisions.length} decisions logged. Attempts sent directly or through the session's proxy do not pass through it.`);

  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    for (const [key, lines] of Object.entries(raw)) writeFileSync(join(outDir, `probe-${key}.jsonl`), lines.join("\n") + "\n");
    writeFileSync(join(outDir, "attempts-table.md"), renderMarkdownTable(columns) + "\n");
    log("");
    log("The probe's own lines, one file per container, and the table in Markdown were written to the output folder.");
  }
  const failed = columns.filter((c) => !c.report.ended || c.report.problems.length);
  if (failed.length) throw new Error(`the probe did not finish cleanly in: ${failed.map((c) => c.label).join(", ")}`);
  log("");
  log(`Whole run: ${Math.round((Date.now() - t0) / 1000)} s.`);
} catch (err) {
  const e = err as { stdout?: string; stderr?: string; message?: string };
  log("FAILED: " + (e.message ?? String(err)));
  if (e.stderr) log(e.stderr.slice(-3000));
  process.exitCode = 1;
} finally {
  // Each step on its own: a step that fails is reported and marks the run failed, and the next steps still run.
  const step = async (what: string, f: () => unknown) => {
    try {
      await f();
    } catch (err) {
      log(`Clean-up step failed (${what}): ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  };
  const server = standIn;
  if (typeof server !== "string") await step("closing the stand-in listener", () => new Promise((r) => server.close(r)));
  const made = sb;
  if (made) {
    // `docker rm -f` fails when the container is already gone, as it should be (it runs with --rm); what is left is reported below.
    await step("removing the comparison container", () => run("docker", ["rm", "-f", COMPARISON], { env: dockerEnv(made) }).catch(() => undefined));
    await step("removing the project's containers, network and volume", () => sandbox.destroy(made));
    await step("removing the project's images", () => sandbox.removeImage(made));
  }
  const folder = dir;
  if (folder) await step("removing the temporary folder", () => rmSync(folder, { recursive: true, force: true }));
  await step("reporting what is left", async () => {
    // Docker's settings as the sandbox gives them; its client folder may already be gone, which Docker accepts.
    const env = dockerEnv({ dir: folder ?? join(tmpdir(), "builder-isolation-not-made") });
    const ask = async (args: string[]) => (await run("docker", args, { env })).stdout.trim().split("\n").filter(Boolean).join(", ") || "none";
    const label = `label=com.docker.compose.project=${PROJECT_NAME}`;
    const left = [
      `project containers: ${await ask(["ps", "-a", "--filter", label, "--format", "{{.Names}}"])}`,
      `project networks: ${await ask(["network", "ls", "--filter", label, "--format", "{{.Name}}"])}`,
      `project volumes: ${await ask(["volume", "ls", "--filter", label, "--format", "{{.Name}}"])}`,
      `comparison container: ${await ask(["ps", "-a", "--filter", `name=${COMPARISON}`, "--format", "{{.Names}}"])}`,
      `project images: ${await ask(["images", "--format", "{{.Repository}}", "--filter", `reference=${PROJECT_NAME}*`])}`,
      `temporary folder: ${folder && existsSync(folder) ? "still there" : "none"}`,
    ];
    log("");
    log(`Clean-up: containers, network, volume, images, the stand-in listener and the temporary folder removed. Left behind: ${left.join("; ")}.`);
  });
}
