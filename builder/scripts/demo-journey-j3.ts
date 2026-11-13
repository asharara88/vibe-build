/**
 * Package J3's automated run (final design, build brief, "Automated run"):
 *
 *   flock <scratchpad>/live-tests.lock npx tsx scripts/demo-journey-j3.ts <evidence folder>
 *
 * From a fresh database and data folder it starts the builder's own interface on 127.0.0.1:4021, with its live preview
 * front on 127.0.0.1:4041, and a random password given only to the interface and, as a read-only file, to the builder
 * camera. J1's builder camera (camera/builder-shots.mjs, BUILDER_CAMERA_WALK=j3; the approved runner image on the
 * machine's network, loading only 127.0.0.1:4021) builds example 1 through the screens, presses "Open the live app" and
 * "Show" exactly as the owner would, and writes the pass and the sample password into its folder as read-only files.
 * This run hands them to the live camera (camera/live-shots.mjs: the approved runner image, in the project's own
 * `acceptance` service, on the project's `front` network alone, no video, no trace; its browser loads only
 * 127.0.0.1:4030 inside its container, which the camera socket leads to the front). The live camera signs in as the
 * made-up employee, adds a request and photographs each page. Then the builder camera runs the checklist, which ends a
 * live session first and says the app was used live, and closes the project.
 *
 * While the cameras run, Docker's list of the project's containers is read every second: none may publish a port; only
 * the door's machine side may be on the machine's network; the app camera, the runner, the live camera and every
 * stream to the app on the project's `front` network alone (journey-network-checks.ts).
 *
 * Before anything starts, 127.0.0.1:13161 (the image build's port of journey sandboxes), 4021 and 4041 must be free:
 * the run waits for them (the owner's project may hold 13161) and never stops anything. Everything it made is removed
 * after; what was there before and after is in <evidence>/run-demo.txt. Made-up data only. No model is called.
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, chownSync, closeSync, constants, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { BROWSER_ZIP_LABEL, RUNNER_IMAGE, RUNNER_UID, runnerImageProblem } from "../src/acceptance/runner-image.js";
import { J1_BUILD_PROXY_PORT, liveCamera } from "../src/orchestrator/example-1-adapter.js";
import { composeProjectName, type Sandbox } from "../src/sandbox/manager.js";
import { createPool } from "../src/store/db.js";
import { cameraSocket } from "../src/web/preview.js";
import { portFree } from "./example-1-sandbox.js";
import { liveNetworkChecks, networkChecks } from "./journey-network-checks.js";

const run = promisify(execFile);
const builderDir = resolve(import.meta.dirname, "..");
const evidence = resolve(process.argv[2] ?? join(builderDir, "..", "evidence", "2026-11-13-journey-j3"));
const screensDir = join(evidence, "screens");
const UI_PORT = 4021;
const FRONT_PORT = 4041;
const runId = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${randomBytes(3).toString("hex")}`;
const dbName = `builder_j3_${runId}`;
const dbUrl = `postgres:///${dbName}?host=/var/run/postgresql`;
const log: string[] = [];
const say = (s: string) => {
  log.push(s);
  console.log(s);
};
const dockerEnv = (): NodeJS.ProcessEnv => ({ PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/root", ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}) });
const sh = async (cmd: string, args: string[]) => (await run(cmd, args, { env: dockerEnv(), maxBuffer: 16 * 1024 * 1024 })).stdout.trim();

async function journeyLeftovers(): Promise<string[]> {
  const out: string[] = [];
  for (const l of (await sh("docker", ["ps", "-a", "--format", '{{.Names}}\t{{.Label "com.docker.compose.project"}}'])).split("\n").filter(Boolean)) {
    const [name, project] = l.split("\t");
    if ((project ?? "").startsWith("builder_j1-") || (name ?? "").startsWith("builder_j1-") || (name ?? "").startsWith("j3-builder-camera")) out.push(`container ${name}`);
  }
  for (const i of (await sh("docker", ["images", "--format", "{{.Repository}}:{{.Tag}}"])).split("\n")) if (i.startsWith("builder_j1-")) out.push(`image ${i}`);
  for (const v of (await sh("docker", ["volume", "ls", "--format", "{{.Name}}"])).split("\n")) if (v.startsWith("builder_j1-")) out.push(`volume ${v}`);
  for (const n of (await sh("docker", ["network", "ls", "--format", "{{.Name}}"])).split("\n")) if (n.startsWith("builder_j1-")) out.push(`network ${n}`);
  return out;
}

async function journeyContainers(): Promise<Array<{ name: string; networks: string; ports: string }>> {
  const out = await sh("docker", ["ps", "--format", "{{.Names}}\t{{.Networks}}\t{{.Ports}}"]).catch(() => "");
  return out
    .split("\n")
    .map((l) => l.split("\t"))
    .filter(([name]) => (name ?? "").startsWith("builder_j1-"))
    .map(([name, networks, ports]) => ({ name: name!, networks: (networks ?? "").split(",").filter(Boolean).sort().join(","), ports: ports ?? "" }));
}

function readPng(path: string): Buffer | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size < 8 || st.size > 30 * 1024 * 1024) return null;
    const b = Buffer.alloc(st.size);
    let n = 0;
    while (n < st.size) {
      const r = readSync(fd, b, n, st.size - n, n);
      if (r === 0) break;
      n += r;
    }
    return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? b : null;
  } finally {
    closeSync(fd);
  }
}

/** A secret the builder camera wrote: a plain file of at most 200 bytes, read once and removed. */
function takeSecret(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size < 1 || st.size > 200) return null;
    const b = Buffer.alloc(st.size);
    readSync(fd, b, 0, st.size, 0);
    return b.toString("utf8").trim();
  } finally {
    closeSync(fd);
    rmSync(path, { force: true });
  }
}

async function waitFree(port: number, label: string): Promise<void> {
  const end = Date.now() + 30 * 60_000;
  let said = false;
  while (!(await portFree(port))) {
    if (Date.now() > end) throw new Error(`127.0.0.1:${port} (${label}) stayed in use for 30 minutes.`);
    if (!said) say(`Waiting: 127.0.0.1:${port} (${label}) is in use; nothing is stopped, the run waits.`);
    said = true;
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

async function main(): Promise<number> {
  mkdirSync(screensDir, { recursive: true });
  say(`J3's automated run, ${new Date().toISOString()} (run ${runId}).`);
  const imageProblem = await runnerImageProblem(RUNNER_IMAGE, dockerEnv());
  if (imageProblem) {
    say(`Refused: ${imageProblem}. Nothing was started.`);
    return 2;
  }
  say(`The approved runner image ${RUNNER_IMAGE} is on the machine, labelled ${BROWSER_ZIP_LABEL} with the approved browser zip's fingerprint (runnerImageProblem); this run neither builds nor removes it.`);
  say(`Builder tree: ${execFileSync("git", ["-C", builderDir, "write-tree", "--prefix=builder/"], { encoding: "utf8" }).trim()} (git write-tree --prefix=builder/ of the index at the start of the run).`);
  say(`Free disk before: ${execFileSync("df", ["-h", "/"], { encoding: "utf8" }).trim().split("\n").pop()}`);
  say("Containers on the machine before (every one; others belong to other sessions):");
  say((await sh("docker", ["ps", "-a", "--format", "{{.Names}} {{.Status}}"])) || "(none)");
  const before = await journeyLeftovers();
  say(`Journey containers, images, volumes and networks before: ${before.length ? before.join(", ") : "none"}`);
  if (before.length) {
    say("Refused: journey things are on the machine already; nothing was started.");
    return 2;
  }
  await waitFree(J1_BUILD_PROXY_PORT, "the image build's port of journey sandboxes; the owner's project may hold it");
  await waitFree(UI_PORT, "this run's interface");
  await waitFree(FRONT_PORT, "this run's preview front");
  say(`Ports ${J1_BUILD_PROXY_PORT}, ${UI_PORT} and ${FRONT_PORT} on 127.0.0.1 free before the run. The owner's interface on 4020 is not touched.`);

  execFileSync("createdb", ["-h", "/var/run/postgresql", dbName]);
  const work = mkdtempSync(join(tmpdir(), "j3-demo-"));
  const dataDir = join(work, "data");
  const cameraOut = join(work, "camera-out");
  const secretDir = join(work, "secret");
  const live = join(work, "live");
  for (const d of [dataDir, cameraOut, secretDir, live]) mkdirSync(d, { mode: 0o700 });
  const liveOut = join(live, "out");
  const passDir = join(live, "passes");
  mkdirSync(liveOut, { mode: 0o700 });
  mkdirSync(passDir, { mode: 0o500 });
  const uiPassword = `j3-${randomBytes(18).toString("base64url")}`;
  const secretFile = join(secretDir, "ui-password");
  writeFileSync(secretFile, uiPassword, { mode: 0o400 });
  for (const p of [cameraOut, secretFile, liveOut, passDir]) chownSync(p, RUNNER_UID, RUNNER_UID);
  say(`Fresh database ${dbName}; fresh data folder. A random interface password, given to the interface in its environment and to the builder camera as a read-only file; not printed or kept.`);

  let code = 1;
  let iface: ReturnType<typeof spawn> | null = null;
  const ifaceLog: string[] = [];
  const allChecks: Array<{ name: string; ok: boolean; detail: string }> = [];
  let camSock: Awaited<ReturnType<typeof cameraSocket>> | null = null;
  const secrets: string[] = [uiPassword];
  try {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: tmpdir(),
      BUILDER_DATABASE_URL: dbUrl,
      BUILDER_DATA_DIR: dataDir,
      BUILDER_UI_PASSWORD: uiPassword,
      BUILDER_UI_PORT: String(UI_PORT),
      BUILDER_PREVIEW_PORT: String(FRONT_PORT),
      NO_COLOR: "1",
    };
    for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "DOCKER_HOST"]) if (process.env[k]) env[k] = process.env[k];
    iface = spawn(process.execPath, ["--import", "tsx", "src/web/main.ts"], { cwd: builderDir, env, stdio: ["ignore", "pipe", "pipe"] });
    const started = new Promise<boolean>((ok) => {
      const onData = (d: Buffer) => {
        for (const l of d.toString("utf8").split("\n").filter(Boolean)) {
          ifaceLog.push(l);
          if (l.startsWith("Interface listening on")) ok(true);
        }
      };
      iface!.stdout!.on("data", onData);
      iface!.stderr!.on("data", onData);
      iface!.on("exit", () => ok(false));
      setTimeout(() => ok(false), 60_000);
    });
    if (!(await started)) {
      say(`The interface did not start. Its output:\n${ifaceLog.join("\n")}`);
      return 1;
    }
    say(`The interface started: ${ifaceLog.filter((l) => l.startsWith("Interface listening") || l.startsWith("Live preview front")).join(" ")}`);
    camSock = await cameraSocket(FRONT_PORT);
    say("The camera socket (preview.ts, cameraSocket): a folder of the runner's user (mode 750), one socket (mode 600), passed byte for byte to 127.0.0.1:4041.");

    const camName = `j3-builder-camera-${runId}`;
    const camArgs = [
      "run", "--rm", "--name", camName, "--network", "host",
      "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", "256", "--memory", "1g",
      "--user", "runner", "--workdir", "/runner", "--entrypoint", "node",
      "--env", `BUILDER_CAMERA_BASE=http://127.0.0.1:${UI_PORT}`, "--env", "BUILDER_CAMERA_WALK=j3",
      "--volume", `${join(builderDir, "camera", "builder-shots.mjs")}:/camera/builder-shots.mjs:ro`,
      "--volume", `${cameraOut}:/shots`,
      "--volume", `${secretFile}:/run/secrets/ui-password:ro`,
      RUNNER_IMAGE, "/camera/builder-shots.mjs",
    ];
    say(`The builder camera: docker ${camArgs.join(" ").replaceAll(work, "<run folder>")}`);
    const cam = spawn("docker", camArgs, { env: dockerEnv(), stdio: ["ignore", "pipe", "pipe"] });
    const seen = new Map<string, { networks: string; ports: string }>();
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        for (const r of await journeyContainers()) seen.set(r.name, { networks: r.networks, ports: r.ports });
        await new Promise((r) => setTimeout(r, 1000));
      }
    })();
    const shots: Array<{ file: string }> = [];
    let projectId = "";
    const camLines: string[] = [];
    let liveDone: Promise<void> | null = null;
    const liveShots: string[] = [];
    const liveLines: string[] = [];
    cam.stdout!.on("data", (d: Buffer) => {
      for (const l of d.toString("utf8").split("\n").filter(Boolean)) {
        camLines.push(l);
        let o: Record<string, unknown>;
        try {
          o = JSON.parse(l) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (o.kind === "check") {
          allChecks.push({ name: `builder camera: ${String(o.name)}`, ok: o.ok === true, detail: String(o.detail ?? "") });
          say(`  ${o.ok === true ? "PASSED" : "FAILED"}: builder camera: ${String(o.name)}${o.ok === true || !o.detail ? "" : ` (${String(o.detail).slice(0, 300)})`}`);
        } else if (o.kind === "shot") shots.push(o as { file: string });
        else if (o.kind === "project") projectId = String(o.id);
        else if (o.kind === "live_ready" && !liveDone) liveDone = runLiveCamera();
      }
    });
    let camErr = "";
    cam.stderr!.on("data", (d: Buffer) => (camErr = (camErr + d.toString("utf8")).slice(-4000)));

    /** The pass and the sample password, from the builder camera's folder, handed to the live camera; then its walk. */
    async function runLiveCamera(): Promise<void> {
      try {
        const pass = takeSecret(join(cameraOut, "pass-1"));
        const sample = takeSecret(join(cameraOut, "sample-password"));
        if (!pass || !sample) throw new Error("the builder camera did not leave the pass and the sample password");
        secrets.push(pass, sample, pass.replace("-", ""));
        writeFileSync(join(passDir, "pass-1"), pass, { mode: 0o400 });
        chownSync(join(passDir, "pass-1"), RUNNER_UID, RUNNER_UID);
        const sampleFile = join(live, "sample-password");
        writeFileSync(sampleFile, sample, { mode: 0o400 });
        chownSync(sampleFile, RUNNER_UID, RUNNER_UID);
        say("The pass and the sample password were taken from the builder camera's folder (and removed there) and given to the live camera as read-only files.");
        const pool = createPool(dbUrl);
        let dir = "";
        try {
          const r = await pool.query<{ payload: { dir?: string } }>("select payload from events where project_id = $1 and kind = 'journey.sandbox.made' order by id desc limit 1", [projectId]);
          dir = r.rows[0]?.payload.dir ?? "";
        } finally {
          await pool.end();
        }
        if (!dir) throw new Error("the project's sandbox folder is not recorded");
        const sb: Sandbox = { dir, composeFile: join(dir, "compose.yaml"), projectName: composeProjectName(projectId), acceptanceImage: RUNNER_IMAGE };
        const t0 = Date.now();
        const end = await liveCamera(sb, {
          cameraDir: camSock!.dir,
          outDir: liveOut,
          passDir,
          sampleFile,
          env: { WALK: "owner" },
          onLine: (l) => {
            liveLines.push(l);
            let o: Record<string, unknown>;
            try {
              o = JSON.parse(l) as Record<string, unknown>;
            } catch {
              return;
            }
            if (o.kind === "check") {
              allChecks.push({ name: `live camera: ${String(o.name)}`, ok: o.ok === true, detail: String(o.detail ?? "") });
              say(`  ${o.ok === true ? "PASSED" : "FAILED"}: live camera: ${String(o.name)}${o.ok === true || !o.detail ? "" : ` (${String(o.detail).slice(0, 300)})`}`);
            } else if (o.kind === "shot") liveShots.push(String(o.file));
            else if (["fact", "timing", "answers", "csp", "blocked"].includes(String(o.kind))) say(`  live camera: ${l.slice(0, 600)}`);
          },
        });
        say(`The live camera ended with exit code ${end.code} after ${Math.round((Date.now() - t0) / 1000)} s.`);
        if (end.code !== 0) allChecks.push({ name: "the live camera ended with exit code 0", ok: false, detail: end.stderrTail.split("\n").filter((x) => !/^\s+at /.test(x)).join(" | ").slice(0, 600) });
      } catch (err) {
        allChecks.push({ name: "the live camera ran", ok: false, detail: err instanceof Error ? err.message : String(err) });
        say(`The live camera did not run: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        writeFileSync(join(cameraOut, "live-done"), "done\n");
        chownSync(join(cameraOut, "live-done"), RUNNER_UID, RUNNER_UID);
      }
    }

    const camCode = await new Promise<number | null>((ok) => {
      const timer = setTimeout(() => void run("docker", ["kill", camName], { env: dockerEnv() }).catch(() => undefined), 3_600_000);
      cam.on("close", (c) => {
        clearTimeout(timer);
        ok(c);
      });
    });
    if (liveDone) await liveDone;
    sampling = false;
    await sampler;
    say(`The builder camera ended with exit code ${camCode}.`);
    if (camErr.trim()) say(`The builder camera's error output (end): ${camErr.trim().split("\n").slice(-3).join(" | ")}`);
    say(`Journey containers Docker listed while the cameras ran (sampled every second; name [networks], published ports if any): ${seen.size}`);
    for (const [name, v] of seen) say(`  ${name} [${v.networks}]${v.ports ? ` ports: ${v.ports}` : ""}`);
    for (const c of [...networkChecks(seen), ...liveNetworkChecks(seen)]) {
      allChecks.push(c);
      say(`  ${c.ok ? "PASSED" : "FAILED"}: ${c.name}${c.ok ? "" : ` (${c.detail})`}`);
    }

    let copied = 0;
    for (const s of shots) {
      if (!/^\d{2}-[a-z0-9-]+-(en|ar|phone)\.png$/.test(s.file)) continue;
      const b = readPng(join(cameraOut, s.file));
      if (b) {
        writeFileSync(join(screensDir, `builder-${s.file}`), b);
        copied++;
      }
    }
    for (const f of liveShots) {
      if (!/^\d{2}-[a-z0-9-]+\.png$/.test(f)) continue;
      const b = readPng(join(liveOut, f));
      if (b) {
        writeFileSync(join(screensDir, `live-${f}`), b);
        copied++;
      }
    }
    say(`Screenshots copied into the evidence folder: ${copied} (builder camera ${shots.length}, live camera ${liveShots.length}).`);

    const pool = createPool(dbUrl);
    try {
      const ev = await pool.query<{ id: string; project_id: string; at: Date; kind: string; step: string | null; payload: Record<string, unknown> }>("select id, project_id, at, kind, step, payload from events order by id");
      const all = ev.rows.map((e) => ({ ...e, at: e.at.toISOString() }));
      const text = JSON.stringify({ run: runId, database: dbName, note: "Every event of the run's database, in id order. Made-up data only. Paths are of this machine's run folders, removed after the run.", events: all }, null, 1);
      if (secrets.some((x) => text.includes(x))) throw new Error("The events would hold a password or a pass; they are not written.");
      writeFileSync(join(evidence, "events.json"), text.replaceAll(work, "<run folder>") + "\n");
      const kinds = all.map((e) => e.kind);
      say(`Events written to events.json: ${all.length}, in id order. live_opened ${kinds.filter((k) => k === "journey.preview.live_opened").length}, live_entered ${kinds.filter((k) => k === "journey.preview.live_entered").length}, live_closed ${kinds.filter((k) => k === "journey.preview.live_closed").length} (reasons: ${all.filter((e) => e.kind === "journey.preview.live_closed").map((e) => String(e.payload.reason)).join(", ")}).`);
      const ok = ["journey.preview.live_opened", "journey.preview.live_entered", "journey.preview.live_closed"].every((k) => kinds.includes(k));
      allChecks.push({ name: "the record holds live_opened, live_entered and live_closed, and neither the pass nor a password", ok, detail: "" });
    } finally {
      await pool.end();
    }
    const camText = [...camLines, ...liveLines].join("\n");
    writeFileSync(join(evidence, "camera-lines.jsonl"), secrets.some((x) => camText.includes(x)) ? "(not written: a line held a secret)\n" : camText + "\n");
    const failed = allChecks.filter((c) => !c.ok);
    code = camCode === 0 && failed.length === 0 && copied > 0 && liveShots.length === 10 ? 0 : 1;
  } finally {
    if (iface && iface.exitCode === null) {
      iface.kill("SIGTERM");
      await new Promise((r) => {
        iface!.on("exit", r);
        setTimeout(r, 15_000);
      });
    }
    await camSock?.close().catch(() => undefined);
    let ifaceText = ifaceLog.join("\n").replaceAll(work, "<run folder>");
    for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"]) if (process.env[k]) ifaceText = ifaceText.replaceAll(process.env[k]!, "<session proxy>");
    if (secrets.some((x) => ifaceText.includes(x))) {
      ifaceText = "(not written: the output held a secret)";
      code = 1;
    }
    writeFileSync(join(evidence, "interface-log.txt"), `The interface's own output during the run (stdout and stderr), with this run's folder written <run folder>:\n\n${ifaceText}\n`);
    const left = await journeyLeftovers();
    say(`Journey containers, images, volumes and networks left when the interface stopped: ${left.length ? left.join(", ") : "none"}`);
    if (left.length) {
      code = 1;
      for (const l of left) {
        const [what, name] = l.split(" ");
        const args = what === "container" ? ["rm", "-f", name!] : what === "image" ? ["image", "rm", "-f", name!] : what === "volume" ? ["volume", "rm", "-f", name!] : ["network", "rm", name!];
        await sh("docker", args).catch(() => "");
      }
      say(`  removed by the run's clean-up; left now: ${(await journeyLeftovers()).join(", ") || "none"}`);
    }
    const folders = readdirSync(tmpdir()).filter((f) => f.startsWith("builder-acceptance-") && !f.startsWith("builder-acceptance-standin-"));
    for (const f of folders) rmSync(join(tmpdir(), f), { recursive: true, force: true });
    const stale = readdirSync("/tmp").filter((f) => /^bp[vc]-/.test(f));
    say(`Sandbox folders left in the temporary folder, removed: ${folders.length ? folders.join(", ") : "none"}. Short folders of previews in /tmp after the stop: ${stale.length ? stale.join(", ") : "none"}.`);
    rmSync(work, { recursive: true, force: true });
    execFileSync("dropdb", ["-h", "/var/run/postgresql", "--if-exists", dbName]);
    say(`Run folder removed: ${existsSync(work) ? "NO" : "yes"}. Database ${dbName} dropped.`);
    say(`Containers on the machine after (every one): ${(await sh("docker", ["ps", "-a", "--format", "{{.Names}} {{.Status}}"])) || "(none)"}`);
    say(`Ports after: 4021 ${(await portFree(UI_PORT)) ? "free" : "IN USE"}, 4041 ${(await portFree(FRONT_PORT)) ? "free" : "IN USE"}, 13161 ${(await portFree(J1_BUILD_PROXY_PORT)) ? "free" : "IN USE"}.`);
    say(`Free disk after: ${execFileSync("df", ["-h", "/"], { encoding: "utf8" }).trim().split("\n").pop()}`);
    say(`Checks in all (both cameras', the record's and Docker's list): ${allChecks.filter((c) => c.ok).length} passed, ${allChecks.filter((c) => !c.ok).length} failed.`);
    say(`Result: ${code === 0 ? "every check passed" : "NOT every check passed"} (exit code ${code}).`);
    writeFileSync(join(evidence, "run-demo.txt"), log.join("\n").replaceAll(work, "<run folder>") + "\n");
  }
  return code;
}

process.exitCode = await main();
