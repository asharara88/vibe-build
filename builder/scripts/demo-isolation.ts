/**
 * Evidence run for package 0.6c (extending package 0.6a's): the development profile's network boundary,
 * checked from inside every project container and compared, attempt by attempt, with the list design note 2.5
 * allows each one (amendment of 13 Nov 2026).
 *
 * Usage (from builder/): npx tsx scripts/demo-isolation.ts [outDir]
 *
 *  1. A project sandbox on the development profile, written by the sandbox manager: the app, tools, database,
 *     runner and engine (as package 2.2 would place it, `engine.network: "egress"`), the door (`egress`) and the
 *     machine side (`egress-host`). Stand-in images for the app, tools and runner (scripts/isolation-harness.ts):
 *     a container's networks come from the Compose file, not its image. A stand-in gateway on the machine's
 *     loopback address, and the harness's "canary" listener on every address of the machine.
 *  2. Read on the machine, read-only: its listening TCP sockets and every address it holds.
 *  3. The probe (scripts/isolation-probe.mjs, mounted read-only) in each project container, and its attempts
 *     compared with that container's expected list: every row PASS or FAIL.
 *  4. Positive controls: the same settings from a container on the machine's own network and one on Docker's
 *     default network (not project containers), which must reach the canary.
 *  5. Two deliberate misconfigurations, each of which must FAIL its comparison: the app also given an ordinary
 *     bridge (a way out); the data network made internal without the isolated gateway mode.
 *  6. The machine side's and the door's own logs.
 *  7. Everything removed, and what is left listed, with the Docker objects before and after.
 *
 * Nothing the probe tests is run on this machine: every attempt is made from inside a container.
 * Development profile only. No model is called (the gateway is a stand-in). Made-up data only. No setting's
 * value is printed; the session proxy is named by host and port only.
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  ANSWER_WORDING,
  compareWithExpected,
  expectedOnDevelopment,
  expectedPositiveControls,
  gotAnswer,
  parseProbeOutput,
  renderComparison,
  renderMarkdownTable,
  sessionProxyHostPort,
  type Column,
  type Comparison,
  type DevContainer,
  type ProbeReport,
} from "../src/sandbox/isolation.js";
import { composeDocument, createSandbox, dockerEnv, sandbox, socketOwner, toYaml, type Sandbox, type SandboxSpec } from "../src/sandbox/manager.js";
import {
  buildStandIns,
  builderDir,
  devProbeSettings,
  freePort,
  GATEWAY_STAND_IN,
  leftOf,
  probeComparison,
  probeInNetworkOf,
  probeService,
  removeImages,
  runnerStandInImageFor,
  startCanary,
  startGatewayStandIn,
} from "./isolation-harness.js";

const run = promisify(execFile);
const outDir = process.argv[2] ? resolve(process.argv[2]) : null;
const log = (s = "") => console.log(s);
const APP_PORT = 3171;
const t0 = Date.now();

const dockerObjects = async () => {
  const ask = async (args: string[]) => (await run("docker", args)).stdout.trim().split("\n").filter(Boolean).sort().join(", ") || "none";
  return [
    `containers: ${await ask(["ps", "-a", "--format", "{{.Names}}"])}`,
    `networks: ${await ask(["network", "ls", "--format", "{{.Name}}"])}`,
    `volumes: ${await ask(["volume", "ls", "--format", "{{.Name}}"])}`,
    `images: ${await ask(["images", "--format", "{{.Repository}}:{{.Tag}}"])}`,
  ];
};

const made: Array<{ sb: Sandbox; dir: string; images: string[] }> = [];
let gateway: Awaited<ReturnType<typeof startGatewayStandIn>> | undefined;
let canary: Awaited<ReturnType<typeof startCanary>> | undefined;
const files: Record<string, string> = {};
let verdict = true;

async function makeProject(projectId: string, mutate?: (doc: Record<string, unknown>) => void): Promise<{ sb: Sandbox; spec: SandboxSpec }> {
  const dir = mkdtempSync(join(tmpdir(), "builder-iso06c-demo-"));
  const workspace = join(dir, "workspace");
  mkdirSync(workspace, { recursive: true });
  const spec: SandboxSpec = {
    projectId,
    dir,
    profile: "development-cloud-session",
    allowHosts: ["registry.npmjs.org"],
    gatewayUrl: `http://127.0.0.1:${gateway!.port}`,
    builderDir,
    hostProxy: { url: process.env.HTTPS_PROXY ?? "" },
    buildProxyPort: await freePort(),
    app: { buildContext: workspace, port: APP_PORT, env: { APP_URL: `http://app:${APP_PORT}` } },
    engine: { workspace, changeSets: join(builderDir, "scripted"), network: "egress" },
    acceptance: { image: runnerStandInImageFor(projectId), baseUrl: `http://app:${APP_PORT}` },
  };
  const sb = createSandbox(spec, "sample-only-password", { AUTH_SECRET: "made-up-secret", APP_SAMPLE_PASSWORD: "made-up-sample" });
  if (mutate) {
    const doc = composeDocument(spec, socketOwner());
    mutate(doc);
    writeFileSync(sb.composeFile, toYaml(doc));
  }
  made.push({ sb, dir, images: buildStandIns(sb, projectId) });
  return { sb, spec };
}

function show(label: string, report: ProbeReport, c: Comparison) {
  const answered = report.attempts.filter((a) => gotAnswer(a.result));
  const failed = c.rows.filter((r) => !r.pass);
  log(`  -- ${label}: ${report.attempts.length} attempts; ${answered.length} got an answer (${ANSWER_WORDING}); compared with its list: ${c.pass ? "PASS" : "FAIL"} (${c.rows.length - failed.length} rows PASS, ${failed.length} FAIL${c.missing.length ? `, ${c.missing.length} expected answers not tried` : ""})`);
  for (const i of report.info.filter((x) => /route|IPv6|forwarding|interfaces that are up|name servers/.test(x.name))) log(`     ${i.name}: ${i.value}`);
  for (const a of answered) log(`     answered: ${a.id} ${a.target}: ${a.result}${a.detail ? `; ${a.detail}` : ""}`);
  for (const r of failed) log(`     FAIL ${r.id} ${r.target}: expected ${r.expected}; got ${r.actual}`);
  for (const m of c.missing) log(`     FAIL not tried: ${m}`);
  if (report.problems.length) log(`     PROBLEMS: ${report.problems.join(" / ")}`);
}

try {
  log("Package 0.6c: the development profile's network boundary, from inside every project container, compared with design note 2.5's lists.");
  log(`The session proxy, as the machine side is given it: ${sessionProxyHostPort(process.env.HTTPS_PROXY) ?? "not set"} (host and port only).`);
  const before = await dockerObjects();
  files["docker-objects-before.txt"] = before.join("\n") + "\n";
  log("Docker objects before the run (the whole machine, shared with other sessions):");
  for (const l of before) log(`  ${l}`);
  log();

  gateway = await startGatewayStandIn();
  canary = await startCanary();
  log("== 1. The project, as the sandbox manager writes it ==");
  const { sb, spec } = await makeProject("p_iso06c_demo");
  const doc = composeDocument(spec, socketOwner()) as { networks: Record<string, unknown>; services: Record<string, { network_mode?: string; networks?: string[]; user?: string; read_only?: boolean; cap_drop?: string[] }> };
  for (const [name, n] of Object.entries(doc.networks)) log(`  network ${name}: ${JSON.stringify(n)}`);
  for (const [name, svc] of Object.entries(doc.services))
    log(`  ${name.padEnd(11)} network: ${svc.network_mode ?? (svc.networks ?? []).join(", ")}; user: ${svc.user ?? "the image's own"}; read-only root: ${svc.read_only}; capabilities dropped: ${(svc.cap_drop ?? []).join(", ")}`);
  log(`  Stand-in gateway on the machine at 127.0.0.1:${gateway.port} (server: ${GATEWAY_STAND_IN}); the canary on every address of the machine, port ${canary.port}.`);
  await sandbox.up(sb, ["app", "egress"]);
  const ps = JSON.parse(`[${(await sandbox.ps(sb)).trim().split("\n").join(",")}]`) as Array<{ Service: string; State: string; Health?: string }>;
  for (const p of ps) log(`  Container ${p.Service}: ${p.State}${p.Health ? ` (${p.Health})` : ""}`);
  log();

  log("== 2. Read on the machine (read-only; nothing is connected to here) ==");
  const { settings, machineAddresses, machineListeners } = await devProbeSettings(sb, { appPort: APP_PORT, gatewayPort: gateway.port });
  log(`  Every address the machine holds (/proc/net/fib_trie, and /proc/net/if_inet6 where there is IPv6; loopback left out): ${machineAddresses.join(", ")}`);
  log(`  Listening TCP sockets on the machine (/proc/net/tcp): ${machineListeners.join(", ")}`);
  log(`  Settings given to the probe: ${settings}`);
  files["probe-settings.json"] = settings + "\n";
  log();

  log("== 3. The probe in each project container, compared with its list ==");
  const ctx = { appPort: APP_PORT, gatewayServer: new RegExp(`server: ${GATEWAY_STAND_IN}`) };
  const plan: Array<[string, DevContainer, string, () => Promise<string[]>]> = [
    ["app", "app", "app (data, front)", () => probeService(sb, "app", "app", settings)],
    ["tools", "tools", "tools (data)", () => probeService(sb, "tools", "tools", settings)],
    ["db", "db", "db (data; the probe in its network namespace)", () => probeInNetworkOf(sb, "db", "db", settings)],
    ["runner", "runner", "runner (front)", () => probeService(sb, "acceptance", "runner", settings)],
    ["engine", "engine", "engine as package 2.2 would place it (out)", () => probeService(sb, "engine", "engine", settings)],
    ["egress", "egress", "the door, egress (out)", () => probeService(sb, "egress", "door", settings)],
  ];
  const columns: Column[] = [];
  for (const [key, kind, label, go] of plan) {
    const lines = await go();
    files[`probe-${key}.jsonl`] = lines.join("\n") + "\n";
    const report = parseProbeOutput(lines);
    const c = compareWithExpected(report, expectedOnDevelopment(kind, ctx));
    files[`comparison-${key}.md`] = `# ${label}\n\n${renderComparison(label, c)}\n`;
    columns.push({ label, report, ownLoopback: true });
    show(label, report, c);
    if (!c.pass) verdict = false;
  }
  log();

  log("== 4. Positive controls (not project containers): the same settings must reach the canary ==");
  const bridgeAddress = (await run("docker", ["network", "inspect", "bridge", "--format", "{{range .IPAM.Config}}{{.Gateway}}{{end}}"], { env: dockerEnv(sb) })).stdout.trim();
  for (const [key, where, kind, label] of [
    ["control-machine", "host", "machine", "comparison: the machine's own network"],
    ["control-bridge", "bridge", "default-bridge", "comparison: Docker's default network"],
  ] as const) {
    const lines = await probeComparison(sb, where, settings);
    files[`probe-${key}.jsonl`] = lines.join("\n") + "\n";
    const report = parseProbeOutput(lines);
    const c = compareWithExpected(report, expectedPositiveControls(kind, { canaryPort: canary.port, bridgeAddress }), false);
    files[`comparison-${key}.md`] = `# ${label}\n\n${renderComparison(label, c)}\n`;
    columns.push({ label, report, ownLoopback: where === "bridge" });
    show(label, report, c);
    if (!c.pass) verdict = false;
  }
  log();

  log("== 5. Two deliberate misconfigurations: each must FAIL its comparison ==");
  const mis1 = await makeProject("p_iso06c_demo_mis1", (d) => {
    (d.networks as Record<string, unknown>).ext = { enable_ipv6: false };
    (d.services as Record<string, { networks?: string[] }>).app!.networks = ["data", "front", "ext"];
  });
  // The app runs too, so that the only differences from the app's list are the ones the misconfiguration makes.
  await sandbox.up(mis1.sb, ["db", "app"]);
  const s1 = await devProbeSettings(mis1.sb, { appPort: APP_PORT, gatewayPort: gateway.port });
  const l1 = await probeService(mis1.sb, "app", "app-misconfigured", s1.settings);
  files["probe-misconfiguration-1-app-with-a-way-out.jsonl"] = l1.join("\n") + "\n";
  const c1 = compareWithExpected(parseProbeOutput(l1), expectedOnDevelopment("app", ctx));
  files["comparison-misconfiguration-1.md"] = `# Misconfiguration 1: the app also on an ordinary bridge\n\n${renderComparison("app, misconfigured", c1)}\n`;
  show("misconfiguration 1: the app also on an ordinary bridge (a way out)", parseProbeOutput(l1), c1);
  if (c1.pass) verdict = false;
  const mis2 = await makeProject("p_iso06c_demo_mis2", (d) => {
    (d.networks as Record<string, unknown>).data = { internal: true, enable_ipv6: false };
  });
  await sandbox.up(mis2.sb, ["db", "app"]);
  const s2 = await devProbeSettings(mis2.sb, { appPort: APP_PORT, gatewayPort: gateway.port });
  log(`  Machine addresses once the misconfigured data network exists: ${s2.machineAddresses.join(", ")}`);
  const l2 = await probeService(mis2.sb, "tools", "tools-misconfigured", s2.settings);
  files["probe-misconfiguration-2-internal-without-isolated.jsonl"] = l2.join("\n") + "\n";
  const c2 = compareWithExpected(parseProbeOutput(l2), expectedOnDevelopment("tools", ctx));
  files["comparison-misconfiguration-2.md"] = `# Misconfiguration 2: data internal, without the isolated gateway mode\n\n${renderComparison("tools, misconfigured", c2)}\n`;
  show("misconfiguration 2: data internal without the isolated gateway mode", parseProbeOutput(l2), c2);
  if (c2.pass) verdict = false;
  log();

  log("== 6. The machine side's log (the egress proxy's decisions, the gateway forwarder) and the door's ==");
  const hostLog = (await sandbox.logs(sb, "egress-host")).split("\n").map((l) => l.replace(/^[^|]*\|\s*/, "")).filter(Boolean);
  const doorLog = (await sandbox.logs(sb, "egress")).split("\n").map((l) => l.replace(/^[^|]*\|\s*/, "")).filter(Boolean);
  files["egress-host.log"] = hostLog.join("\n") + "\n";
  files["door.log"] = doorLog.join("\n") + "\n";
  for (const l of hostLog.filter((x) => /"decision"|listening|refusedToStart/.test(x))) log(`  egress-host: ${l}`);
  const fromAddresses = [...new Set(doorLog.map((l) => /"from":"([^"]+)"/.exec(l)?.[1]).filter(Boolean))];
  log(`  door: ${doorLog.filter((l) => l.includes('"forwarded"')).length} connections forwarded, from ${fromAddresses.join(", ") || "none"}; ${doorLog.filter((l) => l.includes('"error"')).length} errors.`);
  log();

  log("== 7. Every attempt, one row each, one column per container (results only; the comparisons are in the files) ==");
  const table = renderMarkdownTable(columns);
  files["attempts-table.md"] = table + "\n";
  log(table);
  log();
  log(`RESULT: ${verdict ? "PASS" : "FAIL"}: every project container matched its list, both controls got their answers, and both misconfigurations failed their comparison${verdict ? "" : " (NOT ALL: see above)"}.`);
  if (!verdict) process.exitCode = 1;
} catch (err) {
  const e = err as { stdout?: string; stderr?: string; message?: string };
  log("FAILED: " + (e.message ?? String(err)));
  if (e.stderr) log(e.stderr.slice(-3000));
  process.exitCode = 1;
} finally {
  const step = async (what: string, f: () => unknown) => {
    try {
      await f();
    } catch (err) {
      log(`Clean-up step failed (${what}): ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  };
  for (const m of made) {
    await step(`removing ${m.sb.projectName}`, () => sandbox.destroy(m.sb));
    await step(`removing ${m.sb.projectName}'s images`, () => removeImages(m.sb, m.images));
    await step(`reporting what is left of ${m.sb.projectName}`, async () => log(`Left of ${m.sb.projectName}: ${await leftOf(m.sb)}`));
    await step("removing the temporary folder", () => rmSync(m.dir, { recursive: true, force: true }));
  }
  await step("closing the stand-in gateway and the canary", async () => {
    await gateway?.close();
    await canary?.close();
  });
  await step("listing the Docker objects after the run", async () => {
    const after = await dockerObjects();
    files["docker-objects-after.txt"] = after.join("\n") + "\n";
    log("Docker objects after the run (the whole machine, shared with other sessions):");
    for (const l of after) log(`  ${l}`);
  });
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(outDir, name), text);
    log(`The probe's own lines, the comparisons, the table, the logs and the Docker object lists were written to the output folder (${Object.keys(files).length} files).`);
  }
  log(`Whole run: ${Math.round((Date.now() - t0) / 1000)} s.`);
}
