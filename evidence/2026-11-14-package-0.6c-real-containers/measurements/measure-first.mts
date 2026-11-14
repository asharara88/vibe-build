/**
 * Package 0.6c, the run in real containers: the measurements the design asks for BEFORE any product code is
 * written (design, "checks the implementer must run", item 3). Nothing here is a test: it only records what
 * this machine's Docker does, so that the code is written to what was measured.
 *
 * CORRECTION, 14 Nov 2026, after the review of that day; the words above are left as first written. That is what
 * the design asked for, not what happened. This script was STARTED first (it waited for the shared lock from
 * 12:03:02 UTC), but the numbers that are kept come from its fourth try (12:25:13 to 12:29:54 UTC), and the code was
 * written while it waited and while its first three tries were repaired: the two new lists at 12:03:55, the new
 * unit tests at 12:12:32, the new live test file at 12:17:11, the controls script at 12:24:34 (the reviewer's reading
 * of the files' times). M6 (measure-seen.mts, 12:31:20) was measured WITH the new harness function it is about.
 * What holds: every measurement was finished before the new tests were first run (12:33:21) and before the first
 * commit (12:32:46).
 *
 * Usage (from builder/ of a copy made by checks/make-run-copy.sh, under the shared lock):
 *   npx tsx ../evidence/2026-11-14-package-0.6c-real-containers/measurements/measure-first.mts <output folder> [<the worktree's builder folder>]
 *
 * The first try of this script, from the worktree itself, stopped when the machine side of the door did not start
 * (summary-first-try.txt). M0 below shows why, and why the live runs are started from a copy:
 *   M0  in a container with the builder's folder mounted at /builder, `node --import tsx` loads from the copy
 *       (node_modules a real folder) and not from the worktree (node_modules a link to a folder outside it);
 *
 * It makes one real example-1 project (p_iso06c_real_m) with the product's own functions (makeExample1, the
 * scripted engine's steps 01 and 02, buildAndStart), starts the door, and measures:
 *   M1  `docker compose exec -T app node -e ...` with the probe as ONE base64 argument writes the probe into the
 *       running app container's /tmp, and the fingerprint read back inside equals the repository file's;
 *   M2  the user id the probe reports when run in place, against a one-off container of the app service;
 *   M3  whether Docker reports a container's image id (`docker inspect`, .Image) and the tag's id
 *       (`docker image inspect`, .Id) in the same form;
 *   M4  the probe in the real Ubuntu-based runner image: does any row read "error";
 *   M5  whether leftOf still answers after destroyExample1 has removed the project's folder.
 * And, since the project is there anyway: what listens inside the running app, how long each probe takes, and
 * each real column's raw lines (tools, check, the scripted engine, the database's network).
 *
 * Every attempt of the probe is made from inside a container (hard rule 9). Made-up data only. No model is called.
 * No setting's value is printed.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { buildRunnerImage, RUNNER_IMAGE, runnerImageProblem } from "../../../builder/src/acceptance/runner-image.js";
import { gotAnswer, parseProbeOutput } from "../../../builder/src/sandbox/isolation.js";
import { appImageName, DEFAULT_IMAGES, dockerEnv, sandbox, toolsImageName } from "../../../builder/src/sandbox/manager.js";
import { buildAndStart, destroyExample1, makeExample1, runStep, type Example1 } from "../../../builder/scripts/example-1-sandbox.js";
import { builderDir, devProbeSettings, freePort, leftOf, PROBE_FILE, PROBE_MOUNT, probeInNetworkOf } from "../../../builder/scripts/isolation-harness.js";
import { DEFAULT_ROUTE_INFO } from "../../../builder/scripts/isolation-probe.mjs";

const run = promisify(execFile);
const out = resolve(process.argv[2] ?? ".");
const worktreeBuilder = process.argv[3] ? resolve(process.argv[3]) : null;
mkdirSync(out, { recursive: true });
const PROJECT = "p_iso06c_real_m";
const APP_PORT = 3191;
const IN_PLACE = "/tmp/isolation-probe.mjs";
const summary: string[] = [];
const say = (s: string) => {
  console.log(s);
  summary.push(s);
};
const keep = (name: string, text: string) => writeFileSync(join(out, name), text.endsWith("\n") ? text : text + "\n");
const secs = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)} s`;
const sh = async (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => (await run(cmd, args, { env, maxBuffer: 16 * 1024 * 1024 })).stdout.trim();

let x: Example1 | null = null;
try {
  say(`Measurements before the code, package 0.6c in real containers. Started ${new Date().toISOString()}.`);
  keep("00-disk-before.txt", `$ df -h /\n${await sh("df", ["-h", "/"])}\n\n$ docker system df\n${await sh("docker", ["system", "df"])}\n\n$ docker version --format (client, server)\n${await sh("docker", ["version", "--format", "{{.Client.Version}} {{.Server.Version}}"])}\n\n$ docker info --format (storage driver)\n${await sh("docker", ["info", "--format", "{{.Driver}} {{json .DriverStatus}}"])}\n\n$ docker compose version\n${await sh("docker", ["compose", "version"])}`);

  // M0: does `node --import tsx` load inside a container from each folder, mounted as the door's containers mount it?
  const m0: string[] = ["M0: the builder's folder mounted read-only at /builder in a container of the approved Node image (no network, user 1000, read-only root), then `node --import tsx -e ...`, as the door's containers start."];
  for (const [label, dir] of [["this copy (node_modules a real folder)", builderDir], ...(worktreeBuilder ? [["the worktree (node_modules a link to a folder outside it)", worktreeBuilder]] : [])] as const) {
    const r = await run("docker", ["run", "--rm", "--name", `builder_${PROJECT}-m0`, "--network", "none", "--user", "1000:1000", "--read-only", "--tmpfs", "/tmp", "--entrypoint", "", "--volume", `${dir}:/builder:ro`, "--workdir", "/builder", DEFAULT_IMAGES.node, "node", "--import", "tsx", "-e", "console.log('tsx loaded')"]).then(
      (o) => `exit 0: ${o.stdout.trim()}`,
      (e: { code?: number; stderr?: string }) => `exit ${e.code}: ${(e.stderr ?? "").split("\n").filter((l) => /Error|Cannot find|ERR_/.test(l)).slice(0, 2).join(" / ").slice(0, 300)}`,
    );
    m0.push(`${label}: ${r}`);
  }
  for (const l of m0) say(l);
  keep("M0-why-a-copy.txt", m0.join("\n"));

  // The real runner image, built as test/acceptance-live.test.ts builds it (from the approved zip; machine-wide; never removed here).
  let t = Date.now();
  const idBefore = await sh("docker", ["image", "inspect", RUNNER_IMAGE, "--format", "{{.Id}}"]).catch(() => "not on this machine");
  const img = await buildRunnerImage({ hostProxy: { url: process.env.HTTPS_PROXY ?? "", caBundlePath: "/root/.ccr/ca-bundle.crt" } });
  say(`Runner image ${RUNNER_IMAGE}: built in ${secs(t)}; id before the build ${idBefore}; id after ${img.imageId}; problems ${JSON.stringify(img.problems)}; label problem ${JSON.stringify(await runnerImageProblem(RUNNER_IMAGE, process.env))}; user "${img.facts["user"]}".`);

  // A real example-1 project, by the product's own functions.
  t = Date.now();
  x = await makeExample1({ projectId: PROJECT, appPort: APP_PORT, buildProxyPort: await freePort(), runnerImage: RUNNER_IMAGE });
  for (const step of ["01-data", "02-submitter-screen"]) {
    const r = await runStep(x, step);
    say(`Scripted engine, step ${step}: ${r.ok ? "ok" : `NOT ok: ${JSON.stringify(r).slice(0, 300)}`}`);
  }
  await buildAndStart(x, (s) => say(s));
  await sandbox.up(x.sb, ["egress"]);
  say(`Real project ${x.sb.projectName} made, built and started, the door too, in ${secs(t)}.`);
  const env = dockerEnv(x.sb);
  keep("compose-as-the-manager-wrote-it.yaml", readFileSync(x.sb.composeFile, "utf8"));

  // M3, first half: the tags' ids and the running app container's image id.
  const tagId = (image: string) => sh("docker", ["image", "inspect", image, "--format", "{{.Id}}"], env);
  // The whole answer is read and the fields picked here: a Go template naming `.Config.Labels` fails on an image
  // that has no label at all ("map has no entry for key Labels": measured in this script's third try).
  const facts = async (image: string) => {
    const i = JSON.parse(await sh("docker", ["image", "inspect", image, "--format", "{{json .}}"], env)) as { Id?: string; RepoDigests?: string[]; Config?: { User?: string; Cmd?: string[]; Entrypoint?: string[]; WorkingDir?: string; Labels?: Record<string, string> } };
    return `id=${i.Id} user=${JSON.stringify(i.Config?.User)} cmd=${JSON.stringify(i.Config?.Cmd)?.slice(0, 120)} entrypoint=${JSON.stringify(i.Config?.Entrypoint)} workdir=${JSON.stringify(i.Config?.WorkingDir)} repoDigests=${JSON.stringify(i.RepoDigests)} labels=${JSON.stringify(i.Config?.Labels)}`;
  };
  const ids = { app: await tagId(appImageName(PROJECT)), tools: await tagId(toolsImageName(PROJECT)), runner: await tagId(RUNNER_IMAGE), node: await tagId(DEFAULT_IMAGES.node) };
  const appContainer = await sh("docker", ["compose", "-f", x.sb.composeFile, "ps", "-q", "app"], env);
  const runningAppImage = await sh("docker", ["inspect", appContainer, "--format", "{{.Image}}"], env);
  const m3: string[] = [
    "M3: how Docker reports image ids on this machine.",
    `app tag:    ${await facts(appImageName(PROJECT))}`,
    `tools tag:  ${await facts(toolsImageName(PROJECT))}`,
    `runner tag: ${await facts(RUNNER_IMAGE)}`,
    `node tag:   ${await facts(DEFAULT_IMAGES.node)}`,
    `running app container ${appContainer.slice(0, 12)}: .Image=${runningAppImage} .Config.Image=${await sh("docker", ["inspect", appContainer, "--format", "{{.Config.Image}}"], env)} .Config.User=${await sh("docker", ["inspect", appContainer, "--format", "{{json .Config.User}}"], env)}`,
    `running app container's .Image equals the app tag's .Id: ${runningAppImage === ids.app}`,
  ];

  const { settings, machineAddresses, machineListeners } = await devProbeSettings(x.sb, { appPort: APP_PORT, gatewayPort: 4010 });
  keep("probe-settings.json", settings);
  say(`Read on the machine: ${machineAddresses.length} addresses, ${machineListeners.length} listening sockets.`);

  /** The probe in a one-off container of a service, with Docker asked about the container while it runs. */
  const oneOff = async (service: string, label: string) => {
    const lines: string[] = [];
    const started = Date.now();
    const r = sandbox.runStreaming(x!.sb, service, ["node", PROBE_MOUNT, settings], { container: `${x!.sb.projectName}-isolation-${label}`, onLine: (l) => lines.push(l), volumes: [`${PROBE_FILE}:${PROBE_MOUNT}:ro`], timeoutMs: 600_000 });
    let ended = false;
    void r.done.then(() => (ended = true));
    let seen: string | null = null;
    while (!ended && !seen) {
      seen = await sh("docker", ["inspect", r.container, "--format", "running={{.State.Running}} image={{.Image}} configImage={{.Config.Image}} user={{json .Config.User}} networkMode={{.HostConfig.NetworkMode}} networks={{json .NetworkSettings.Networks}} readOnly={{.HostConfig.ReadonlyRootfs}}"], env).then((s) => (s.startsWith("running=true") ? s : null), () => null);
      if (!seen) await new Promise((res) => setTimeout(res, 100));
    }
    const end = await r.done;
    return { lines, end, seen, took: secs(started), args: r.args };
  };
  const describe = (label: string, lines: string[]) => {
    const rep = parseProbeOutput(lines);
    const info = (name: string) => rep.info.find((i) => i.name === name)?.value ?? "(no such line)";
    const errors = rep.attempts.filter((a) => a.result === "error");
    const answered = rep.attempts.filter((a) => gotAnswer(a.result));
    const words = new Map<string, number>();
    for (const a of rep.attempts) words.set(a.result, (words.get(a.result) ?? 0) + 1);
    return [
      `${label}: ${rep.attempts.length} attempts; ended ${rep.ended}; reading problems ${JSON.stringify(rep.problems)}`,
      `  user id: ${info("user id")}; listening TCP ports seen: ${info("listening TCP ports seen in /proc/net")}; default route: ${info(DEFAULT_ROUTE_INFO)}`,
      `  results by word: ${[...words].map(([w, n]) => `${w} x${n}`).join("; ")}`,
      `  rows reading "error": ${errors.length ? errors.map((a) => `${a.id} ${a.target} (${a.code})`).join("; ") : "none"}`,
      `  answered: ${answered.map((a) => `${a.id} ${a.target}: ${a.result}`).join("; ") || "none"}`,
    ];
  };

  // M1: hand the probe to the running app as one argument of `docker compose exec`, and read its fingerprint back.
  const probeBytes = readFileSync(PROBE_FILE);
  const b64 = probeBytes.toString("base64");
  const localSha = createHash("sha256").update(probeBytes).digest("hex");
  const m1: string[] = [`M1: the probe file is ${probeBytes.length} bytes; as base64 ${b64.length} characters, given as ONE argument; SHA-256 of the repository's file ${localSha}.`];
  const WRITE = "const fs=require('fs');const p=process.argv[1];fs.writeFileSync(p,Buffer.from(process.argv[2],'base64'),{flag:'wx',mode: 0o600});console.log('written '+fs.statSync(p).size+' bytes')";
  const HASH = "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))";
  const REMOVE = "const fs=require('fs');fs.rmSync(process.argv[1],{force:true});console.log(fs.existsSync(process.argv[1])?'still there':'gone')";
  let inPlaceLines: string[] = [];
  try {
    t = Date.now();
    m1.push(`write through sandbox.exec (docker compose exec -T app node -e <script> ${IN_PLACE} <base64>): ${(await sandbox.exec(x.sb, "app", ["node", "-e", WRITE, IN_PLACE, b64])).trim()} in ${secs(t)}`);
    const inside = (await sandbox.exec(x.sb, "app", ["node", "-e", HASH, IN_PLACE])).trim();
    m1.push(`SHA-256 read back inside the running app container: ${inside}`);
    m1.push(`equal to the repository file's: ${inside === localSha}`);
    // A second write must be refused (flag 'wx'): nothing already there is overwritten.
    m1.push(`a second write to the same place: ${await sandbox.exec(x.sb, "app", ["node", "-e", WRITE, IN_PLACE, b64]).then(() => "ACCEPTED (unexpected)", (e: { stderr?: string }) => `refused (${(e.stderr ?? "").split("\n").find((l) => /EEXIST|Error/.test(l))?.trim().slice(0, 160)})`)}`);
    // M2: run it in place.
    t = Date.now();
    const got = await sandbox.exec(x.sb, "app", ["node", IN_PLACE, settings]).then((o) => ({ out: o, err: "" }), (e: { stdout?: string; stderr?: string; message?: string }) => ({ out: e.stdout ?? "", err: (e.stderr || e.message || "").slice(-600) }));
    inPlaceLines = got.out.split("\n").filter(Boolean);
    m1.push(`run in place (docker compose exec -T app node ${IN_PLACE} <settings>): ${inPlaceLines.length} lines in ${secs(t)}${got.err ? `; error: ${got.err}` : ""}`);
    keep("probe-app-in-place.jsonl", inPlaceLines.join("\n"));
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    m1.push(`FAILED: ${(e.stderr || e.message || String(err)).slice(-1500)}`);
  } finally {
    m1.push(`removed afterwards: ${await sandbox.exec(x.sb, "app", ["node", "-e", REMOVE, IN_PLACE]).then((o) => o.trim(), (e: { message?: string }) => `FAILED: ${e.message?.slice(-300)}`)}`);
    const after = await sh("docker", ["compose", "-f", x.sb.composeFile, "ps", "-q", "app"], env);
    m1.push(`the running app container's id before ${appContainer.slice(0, 12)} and after ${after.slice(0, 12)}: ${after === appContainer ? "the same" : "DIFFERENT"}`);
  }
  for (const l of m1) say(l);
  keep("M1-exec-hand-over.txt", m1.join("\n"));

  // M2 and the other real columns, each a one-off container of its service, with its image id seen while it runs.
  const m2: string[] = ["M2: the user id the probe reports, in place and in one-off containers; M4: the runner image.", ...describe("app, in place (the running container)", inPlaceLines)];
  for (const [service, label, tagKey] of [
    ["app", "app-real", "app"],
    ["tools", "tools-real", "tools"],
    ["acceptance", "runner-real", "runner"],
    ["check", "check-real", "node"],
    ["engine", "engine-real", "node"],
  ] as const) {
    const r = await oneOff(service, label);
    keep(`probe-${label}.jsonl`, r.lines.join("\n"));
    m2.push(...describe(`${service} service, one-off container (${label}), ${r.took}, exit code ${r.end.code}${r.end.code === 0 ? "" : `, stderr: ${r.end.stderrTail.slice(-300)}`}`, r.lines));
    m2.push(`  the exact docker command: ${(r.args ?? []).map((a) => (a.length > 120 ? `<${a.length} characters>` : a)).join(" ")}`);
    m2.push(`  seen while running: ${r.seen ?? "NOT SEEN RUNNING"}`);
    const seenImage = /image=(\S+)/.exec(r.seen ?? "")?.[1];
    const tagAfter = await tagId(tagKey === "app" ? appImageName(PROJECT) : tagKey === "tools" ? toolsImageName(PROJECT) : tagKey === "runner" ? RUNNER_IMAGE : DEFAULT_IMAGES.node);
    m3.push(`one-off ${service} container: .Image=${seenImage}; the tag's .Id before ${ids[tagKey]} and after ${tagAfter}; container's .Image equals the tag's .Id: ${seenImage === ids[tagKey]}`);
  }
  t = Date.now();
  const dbLines = await probeInNetworkOf(x.sb, "db", "db-real", settings);
  keep("probe-db-real.jsonl", dbLines.join("\n"));
  m2.push(...describe(`the database's network namespace (a Node container sharing it), ${secs(t)}`, dbLines));
  for (const l of [...m2, ...m3]) say(l);
  keep("M2-M4-user-ids-and-columns.txt", m2.join("\n"));
  keep("M3-image-ids.txt", m3.join("\n"));
} catch (err) {
  const e = err as { stderr?: string; message?: string; stack?: string };
  say(`FAILED: ${e.message ?? String(err)}\n${(e.stderr ?? "").slice(-3000)}\n${e.stack ?? ""}`);
  process.exitCode = 1;
} finally {
  if (x) {
    // M5: does leftOf still answer once the project's folder, and its Docker client folder with it, has gone?
    const m5: string[] = ["M5: leftOf after destroyExample1 (the project's folder, with its Docker client folder, is removed by then)."];
    m5.push(`leftOf before: ${await leftOf(x.sb).catch((e: Error) => `FAILED: ${e.message.slice(0, 500)}`)}`);
    m5.push(`destroyExample1: ${await destroyExample1(x).catch((e: Error) => `FAILED: ${e.message.slice(0, 500)}`)}`);
    m5.push(`leftOf after: ${await leftOf(x.sb).catch((e: Error) => `FAILED: ${e.message.slice(0, 500)}`)}`);
    m5.push(`the runner image is still on the machine: ${await sh("docker", ["image", "inspect", RUNNER_IMAGE, "--format", "{{.Id}}"]).catch(() => "NO")}`);
    for (const l of m5) say(l);
    keep("M5-leftOf-after-destroy.txt", m5.join("\n"));
  }
  keep("99-disk-after.txt", `$ df -h /\n${await sh("df", ["-h", "/"])}\n\n$ docker system df\n${await sh("docker", ["system", "df"])}\n\n$ docker ps -a (names)\n${await sh("docker", ["ps", "-a", "--format", "{{.Names}}"])}`);
  say(`Finished ${new Date().toISOString()}.`);
  keep("summary.txt", summary.join("\n"));
}
