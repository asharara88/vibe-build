/**
 * J1's automated run (package J1; final design, section 3, "Done means"; build brief, "Automated run").
 *
 * Run it under the lock shared with every other live run on this machine:
 *   flock <scratchpad>/live-tests.lock npx tsx scripts/demo-journey.ts <evidence folder>
 *
 * From a fresh database (builder_j1_<run>) and a fresh data folder it starts the builder's own interface on
 * 127.0.0.1:4020 with a random password, given only to the interface (its environment) and, as a read-only secret
 * file, to the builder camera; the password is never printed or written anywhere else. The builder camera
 * (camera/builder-shots.mjs, in the approved runner image, no video, no trace) walks J1's "Done means" in the
 * browser and photographs each screen. The interface's jobs build the app in the project's sandbox and its app
 * camera photographs the running app.
 *
 * Then: the screenshots are copied into <evidence>/screens/, the downloaded export is checked against its event,
 * every event of the run is written to <evidence>/events.json, the interface is stopped, and everything the run
 * made is removed: J1's containers, images, volumes and networks, the sandbox folders, the data folder, the camera's
 * folder and the database. What was on the machine before and after is listed in <evidence>/run-demo.txt.
 *
 * Made-up data only. No model is called; no gateway is started; the real-model gate stays closed.
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, chownSync, closeSync, constants, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { RUNNER_IMAGE, RUNNER_UID, runnerImageExists } from "../src/acceptance/runner-image.js";
import { sha256 } from "../src/acceptance/store.js";
import { createPool } from "../src/store/db.js";
import { portFree } from "./example-1-sandbox.js";

const run = promisify(execFile);
const builderDir = resolve(import.meta.dirname, "..");
const evidence = resolve(process.argv[2] ?? join(builderDir, "..", "evidence", "2026-11-13-journey-j1"));
const screensDir = join(evidence, "screens");
const UI_PORT = 4020;
const PORTS = [UI_PORT, 3161, 5591];
const runId = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${randomBytes(3).toString("hex")}`;
const dbName = `builder_j1_${runId}`;
const dbUrl = `postgres:///${dbName}?host=/var/run/postgresql`;

const log: string[] = [];
const say = (s: string) => {
  log.push(s);
  console.log(s);
};
const dockerEnv = (): NodeJS.ProcessEnv => ({ PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/root", ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}) });
const sh = async (cmd: string, args: string[]) => (await run(cmd, args, { env: dockerEnv(), maxBuffer: 16 * 1024 * 1024 })).stdout.trim();

/** J1's own things on the machine: Compose projects, images, volumes and networks named builder_j1-, and its camera containers. */
async function j1Leftovers(): Promise<string[]> {
  const out: string[] = [];
  for (const l of (await sh("docker", ["ps", "-a", "--format", '{{.Names}}\t{{.Label "com.docker.compose.project"}}'])).split("\n").filter(Boolean)) {
    const [name, project] = l.split("\t");
    if ((project ?? "").startsWith("builder_j1-") || (name ?? "").startsWith("builder_j1-") || (name ?? "").startsWith("j1-builder-camera")) out.push(`container ${name}`);
  }
  for (const i of (await sh("docker", ["images", "--format", "{{.Repository}}:{{.Tag}}"])).split("\n")) if (i.startsWith("builder_j1-")) out.push(`image ${i}`);
  for (const v of (await sh("docker", ["volume", "ls", "--format", "{{.Name}}"])).split("\n")) if (v.startsWith("builder_j1-")) out.push(`volume ${v}`);
  for (const n of (await sh("docker", ["network", "ls", "--format", "{{.Name}}"])).split("\n")) if (n.startsWith("builder_j1-")) out.push(`network ${n}`);
  return out;
}

/** makeExample1's sandbox folders in the temporary folder (the tests' stand-in folders, "builder-acceptance-standin-", are not the run's). */
const sandboxFolders = () => readdirSync(tmpdir()).filter((f) => f.startsWith("builder-acceptance-") && !f.startsWith("builder-acceptance-standin-")).sort();

/** One PNG from the camera's folder: a plain file (no link followed), at most 30 MB, starting as a PNG does. */
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

async function main(): Promise<number> {
  mkdirSync(screensDir, { recursive: true });
  say(`J1's automated run, ${new Date().toISOString()} (run ${runId}).`);
  say(`Builder tree: ${execFileSync("git", ["-C", builderDir, "write-tree", "--prefix=builder/"], { encoding: "utf8" }).trim()} (git write-tree --prefix=builder/ of the index at the start of the run).`);
  say(`Free disk before: ${execFileSync("df", ["-h", "/"], { encoding: "utf8" }).trim().split("\n").pop()}`);
  say("docker system df before:");
  say(await sh("docker", ["system", "df"]));
  say("Containers on the machine before (every one, running or not; others belong to other sessions):");
  say((await sh("docker", ["ps", "-a", "--format", "{{.Names}} {{.Status}}"])) || "(none)");
  const before = await j1Leftovers();
  say(`J1's containers, images, volumes and networks before: ${before.length ? before.join(", ") : "none"}`);
  const foldersBefore = sandboxFolders();
  if (before.length) {
    say("Refused: J1 has things on the machine already; nothing was started.");
    return 2;
  }
  for (const p of PORTS) if (!(await portFree(p))) {
    say(`Refused: something already listens on 127.0.0.1:${p}; nothing was started.`);
    return 2;
  }
  say(`Ports ${PORTS.join(", ")} on 127.0.0.1: free before the run (checked by a connection attempt, refused).`);
  if (!(await runnerImageExists(dockerEnv()))) {
    say(`Refused: the approved runner image ${RUNNER_IMAGE} is not on this machine (it is built by the acceptance runner's tests); nothing was started.`);
    return 2;
  }
  say(`The approved runner image ${RUNNER_IMAGE} is on the machine (id ${await sh("docker", ["image", "inspect", RUNNER_IMAGE, "--format", "{{.Id}}"])}); this run neither builds nor removes it.`);

  // A fresh database and data folder, and the camera's folders.
  execFileSync("createdb", ["-h", "/var/run/postgresql", dbName]);
  const work = mkdtempSync(join(tmpdir(), "j1-demo-"));
  const dataDir = join(work, "data");
  const cameraOut = join(work, "camera-out");
  const secretDir = join(work, "secret");
  mkdirSync(dataDir, { mode: 0o700 });
  mkdirSync(cameraOut, { mode: 0o700 });
  mkdirSync(secretDir, { mode: 0o700 });
  say(`Fresh database ${dbName}; fresh data folder <run folder>/data.`);
  const uiPassword = `j1-${randomBytes(18).toString("base64url")}`;
  const secretFile = join(secretDir, "ui-password");
  writeFileSync(secretFile, uiPassword, { mode: 0o400 });
  if (process.getuid?.() === 0) {
    chownSync(cameraOut, RUNNER_UID, RUNNER_UID);
    chownSync(secretFile, RUNNER_UID, RUNNER_UID);
  } else {
    chmodSync(cameraOut, 0o777);
    chmodSync(secretFile, 0o444);
  }
  say("A random interface password was made: given to the interface in its environment and to the builder camera as a read-only file (mode 0400). It is not printed or kept.");

  // The free space of the data folder's disk, every 2 s while the run goes on: a measurement for the disk floor (gap 137).
  const free = () => {
    const f = statfsSync(dataDir);
    return Number(f.bavail) * Number(f.bsize);
  };
  const disk = { first: free(), lowest: free(), samples: 0 };
  const sampler = setInterval(() => {
    disk.lowest = Math.min(disk.lowest, free());
    disk.samples++;
  }, 2000);
  let code = 1;
  let iface: ReturnType<typeof spawn> | null = null;
  const ifaceLog: string[] = [];
  const projects: string[] = [];
  const recordedSandboxes: string[] = [];
  try {
    // The interface, with a narrow environment: no model key, no gateway.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: tmpdir(),
      BUILDER_DATABASE_URL: dbUrl,
      BUILDER_DATA_DIR: dataDir,
      BUILDER_UI_PASSWORD: uiPassword,
      BUILDER_UI_PORT: String(UI_PORT),
      NO_COLOR: "1",
    };
    // The image build reaches the package registry through the session's proxy (example-1-sandbox.ts).
    for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "DOCKER_HOST"]) if (process.env[k]) env[k] = process.env[k];
    iface = spawn(join(builderDir, "node_modules", ".bin", "tsx"), ["src/web/main.ts"], { cwd: builderDir, env, stdio: ["ignore", "pipe", "pipe"] });
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
      say("The interface did not start. Its output:");
      say(ifaceLog.join("\n"));
      return 1;
    }
    say(`The interface started: ${ifaceLog.filter((l) => l.startsWith("Interface listening")).join("")}`);

    // The builder camera, in the approved runner image, on the machine's network so that it reaches 127.0.0.1:4020.
    const camName = `j1-builder-camera-${runId}`;
    const camArgs = [
      "run", "--rm", "--name", camName,
      "--network", "host",
      "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", "256", "--memory", "1g",
      "--user", "runner", "--workdir", "/runner", "--entrypoint", "node",
      "--volume", `${join(builderDir, "camera", "builder-shots.mjs")}:/camera/builder-shots.mjs:ro`,
      "--volume", `${cameraOut}:/shots`,
      "--volume", `${secretFile}:/run/secrets/ui-password:ro`,
      RUNNER_IMAGE, "/camera/builder-shots.mjs",
    ];
    say(`The builder camera: docker ${camArgs.join(" ").replace(work, "<run folder>").replace(work, "<run folder>")}`);
    const cam = spawn("docker", camArgs, { env: dockerEnv(), stdio: ["ignore", "pipe", "pipe"] });
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    const shots: Array<{ file: string; path: string; lang: string; width: number }> = [];
    let exportSeen: { sha256: string; bytes: number; file: string } | null = null;
    let camErr = "";
    const lines: string[] = [];
    cam.stdout!.on("data", (d: Buffer) => {
      for (const l of d.toString("utf8").split("\n").filter(Boolean)) {
        lines.push(l);
        let o: Record<string, unknown>;
        try {
          o = JSON.parse(l) as Record<string, unknown>;
        } catch {
          say(`  camera (not JSON): ${l.slice(0, 200)}`);
          continue;
        }
        if (o.kind === "check") {
          checks.push({ name: String(o.name), ok: o.ok === true, detail: String(o.detail ?? "") });
          say(`  ${o.ok === true ? "PASSED" : "FAILED"}: ${String(o.name)}${o.ok === true || !o.detail ? "" : ` (${String(o.detail)})`}`);
        } else if (o.kind === "shot") shots.push(o as never);
        else if (o.kind === "project") {
          projects.push(String(o.id));
          say(`  project ${String(o.id)}: ${String(o.name)}, cap $${String(o.cap)}`);
        } else if (o.kind === "export_downloaded") exportSeen = { sha256: String(o.sha256), bytes: Number(o.bytes), file: String(o.file) };
      }
    });
    cam.stderr!.on("data", (d: Buffer) => (camErr = (camErr + d.toString("utf8")).slice(-4000)));
    const camCode = await new Promise<number | null>((ok) => {
      const timer = setTimeout(() => {
        void run("docker", ["kill", camName], { env: dockerEnv() }).catch(() => undefined);
      }, 3_600_000);
      cam.on("close", (c) => {
        clearTimeout(timer);
        ok(c);
      });
    });
    say(`The builder camera ended with exit code ${camCode}; checks: ${checks.filter((c) => c.ok).length} passed, ${checks.filter((c) => !c.ok).length} failed.`);
    if (camErr.trim()) say(`The camera's error output (end): ${camErr.trim().split("\n").slice(-3).join(" | ")}`);

    // The screenshots, copied as the camera named them.
    let copied = 0;
    for (const s of shots) {
      if (!/^\d{2}-[a-z0-9-]+-(en|ar|phone)\.png$/.test(s.file)) continue;
      const b = readPng(join(cameraOut, s.file));
      if (!b) {
        say(`  screenshot ${s.file}: not a plain PNG; not copied`);
        continue;
      }
      writeFileSync(join(screensDir, s.file), b);
      copied++;
    }
    say(`Screenshots copied into the evidence folder: ${copied} of ${shots.length}.`);

    // The events of the run, and the export downloaded in the browser, against its event.
    const pool = createPool(dbUrl);
    try {
      const ev = await pool.query<{ id: string; project_id: string; at: Date; kind: string; step: string | null; payload: Record<string, unknown> }>(
        "select id, project_id, at, kind, step, payload from events order by id",
      );
      const all = ev.rows.map((e) => ({ ...e, at: e.at.toISOString() }));
      for (const e of ev.rows) if (e.kind === "journey.sandbox.made" && typeof e.payload.dir === "string") recordedSandboxes.push(e.payload.dir);
      const text = JSON.stringify({ run: runId, database: dbName, note: "Every event of the run's database, in id order. Made-up data only. Paths are of this machine's run folders, removed after the run.", events: all }, null, 1);
      if (text.includes(uiPassword)) throw new Error("The events would hold the interface's password; they are not written.");
      writeFileSync(join(evidence, "events.json"), text.replaceAll(work, "<run folder>") + "\n");
      say(`Events written to events.json: ${all.length}, in id order, for ${new Set(all.map((e) => e.project_id)).size} projects.`);
      const exp = ev.rows.find((e) => e.kind === "journey.export.written");
      const file = exp?.payload.file as { path?: string; sha256?: string } | undefined;
      const downloaded = join(cameraOut, "export.tar.gz");
      if (exp && file && existsSync(downloaded) && exportSeen) {
        const got = sha256(readFileSync(downloaded));
        say(`The export downloaded in the browser: ${(exportSeen as { file: string }).file}, ${(exportSeen as { bytes: number }).bytes} bytes, SHA-256 ${got}; its event records ${file.sha256}: ${got === file.sha256 ? "the same" : "DIFFERENT"}.`);
        if (got !== file.sha256) checks.push({ name: "the export downloaded is the one its event records", ok: false, detail: "" });
        const listing = execFileSync("tar", ["-tzvf", downloaded], { encoding: "utf8" });
        writeFileSync(join(evidence, "export-contents.txt"), `The export downloaded by the builder camera: ${(exportSeen as { file: string }).file}, SHA-256 ${got}. Its contents, as tar lists them (tar -tzvf):\n\n${listing}`);
        const names = listing.split("\n").map((l) => l.split(/\s+/).pop() ?? "");
        const id = exp.project_id;
        const want = [`${id}/acceptance/v001/item-01.spec.ts`, `${id}/acceptance/v001/manifest.json`, `${id}/EXPORT-NOTE.txt`, `${id}/.git/HEAD`];
        const missing = want.filter((w) => !names.includes(w));
        const secretish = names.filter((n) => /\/certs\/|\.crt$|\/secrets\/|\/\.env$/.test(n));
        say(`  the archive holds the tests and the note (${missing.length ? `MISSING: ${missing.join(", ")}` : "all four checked paths there"}); files that look like secrets: ${secretish.length ? secretish.join(", ") : "none"}.`);
        if (missing.length || secretish.length) checks.push({ name: "the export holds the tests and no secret", ok: false, detail: "" });
      } else {
        say("The export was not downloaded, or has no event.");
        checks.push({ name: "the export downloaded", ok: false, detail: "" });
      }
    } finally {
      await pool.end();
    }
    writeFileSync(join(evidence, "camera-lines.jsonl"), lines.join("\n") + "\n");
    const failedChecks = checks.filter((c) => !c.ok);
    code = camCode === 0 && failedChecks.length === 0 && copied === shots.length && shots.length > 0 ? 0 : 1;
  } finally {
    // Stop the interface; then remove everything the run made.
    if (iface && iface.exitCode === null) {
      iface.kill("SIGTERM");
      await new Promise((r) => {
        iface!.on("exit", r);
        setTimeout(r, 15_000);
      });
    }
    // The interface's output, with this run's folder and the session proxy's address written as placeholders; never the password.
    let ifaceText = ifaceLog.join("\n").replaceAll(work, "<run folder>");
    for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"]) if (process.env[k]) ifaceText = ifaceText.replaceAll(process.env[k]!, "<session proxy>");
    if (ifaceText.includes(uiPassword)) {
      ifaceText = "(not written: the output held the interface's password)";
      code = 1;
    }
    writeFileSync(join(evidence, "interface-log.txt"), `The interface's own output during the run (stdout and stderr), with this run's folder written <run folder> and the session proxy's address <session proxy>:\n\n${ifaceText}\n`);
    clearInterval(sampler);
    const gb = (b: number) => (b / 1024 ** 3).toFixed(2);
    say(`Free space on the data folder's disk, sampled every 2 s (${disk.samples} samples): ${gb(disk.first)} GB at the start, ${gb(disk.lowest)} GB at the lowest, ${gb(free())} GB at the end, before the clean-up (GB of 1024^3 bytes).`);
    const left = await j1Leftovers();
    say(`J1's containers, images, volumes and networks left when the interface stopped: ${left.length ? left.join(", ") : "none"}`);
    if (left.length) {
      code = 1;
      for (const l of left) {
        const [what, name] = l.split(" ");
        const args = what === "container" ? ["rm", "-f", name!] : what === "image" ? ["image", "rm", "-f", name!] : what === "volume" ? ["volume", "rm", "-f", name!] : ["network", "rm", name!];
        await sh("docker", args).catch(() => "");
      }
      say(`  removed by the run's clean-up; left now: ${(await j1Leftovers()).join(", ") || "none"}`);
    }
    const newFolders = sandboxFolders().filter((f) => !foldersBefore.includes(f));
    const recordedLeft = recordedSandboxes.filter((d) => existsSync(d));
    say(`Sandbox folders the run's events record: ${recordedSandboxes.length}; still there when the interface stopped: ${recordedLeft.length}. Other sandbox folders made during the run and left: ${newFolders.length ? newFolders.join(", ") : "none"}.`);
    for (const d of recordedLeft) rmSync(d, { recursive: true, force: true });
    if (recordedLeft.length) code = 1;
    for (const f of newFolders) rmSync(join(tmpdir(), f), { recursive: true, force: true });
    if (newFolders.length) code = 1;
    rmSync(work, { recursive: true, force: true });
    execFileSync("dropdb", ["-h", "/var/run/postgresql", "--if-exists", dbName]);
    say(`Run folder (data, camera output, password file) removed: ${existsSync(work) ? "NO" : "yes"}. Database ${dbName} dropped.`);
    say(`Containers on the machine after (every one): ${(await sh("docker", ["ps", "-a", "--format", "{{.Names}} {{.Status}}"])) || "(none)"}`);
    say(`J1's containers, images, volumes and networks after: ${(await j1Leftovers()).join(", ") || "none"}`);
    say(`Free disk after: ${execFileSync("df", ["-h", "/"], { encoding: "utf8" }).trim().split("\n").pop()}`);
    say("docker system df after:");
    say(await sh("docker", ["system", "df"]));
    say(`Projects the camera made: ${projects.join(", ") || "none"}.`);
    say(`Result: ${code === 0 ? "every check passed" : "NOT every check passed"} (exit code ${code}).`);
    writeFileSync(join(evidence, "run-demo.txt"), log.join("\n").replaceAll(work, "<run folder>") + "\n");
  }
  return code;
}

process.exitCode = await main();
