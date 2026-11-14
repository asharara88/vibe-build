/**
 * Package J2's automated run (docs/design/journey-j2.md, section 7, with section 2 in full and rule N):
 *
 *   flock <scratchpad>/live-tests.lock npx tsx scripts/demo-journey-j2.ts <evidence folder>
 *
 * From a fresh database (builder_j2_<run>) and a fresh data folder it starts the builder's own interface on
 * 127.0.0.1:4022, the live preview off, four times, with a random password given only to the interface (its
 * environment) and, as a read-only file, to the builder camera (camera/builder-shots.mjs, in the approved runner image,
 * no video, no trace, loading only 127.0.0.1:4022). Nothing is signalled while a camera walk runs.
 *
 * 1. `node --import tsx`, no setting. Walk `j2a`: the broken-copy demonstration, from the Projects screen's button to the
 *    checklist's rejection, then "Close project". The run checks the record (journey-restart-checks.ts,
 *    `brokenCopyRecordChecks`), J1's six network checks on the app's containers, and that nothing of the project is
 *    left (N). SIGTERM: exit 0, "removed at the stop: 0".
 * 2. `node_modules/.bin/tsx`, as `npm run web` starts it, with BUILDER_DEMO_STEP_PAUSE_MS=4000. Walk `j2c-run`: P1 to
 *    step 2 running, photographed. The run checks T1 (the record holds 1 to 7 of step 2's 8 writes, Docker lists the
 *    step's engine container), then sends SIGTERM to the wrapper's process id only. T2 (exit 0 within 120 s, the stop's
 *    lines), T3 (nothing of P1 left, before any restart), T4 (the record).
 * 3. `node --import tsx`, the pause on. T5 (the start line "…: 0."). Walk `j2c-after` for P1 (T6, T7). Walk `j2c-run`
 *    for P2; K1; then SIGKILL to this node process itself. K2: what is left of P2 is recorded; its folder must be there.
 * 4. `node --import tsx`, no setting, retried for at most 30 s while the lock is still held. K3 (the start line "…: 1.",
 *    the record), K4 (nothing of P2 left, after the recovery and again once no process names it). Walk `j2c-after` for
 *    P2 (K5, K6). SIGTERM: exit 0, "removed at the stop: 0".
 *
 * Before anything starts: the runner image is checked (`runnerImageProblem`); the run refuses if anything named
 * `builder_j1-` exists; it waits up to 30 minutes for 127.0.0.1:13161 (the image build's port of journey sandboxes, which
 * the owner's project may hold) and 4022 to be free, and never stops anything. Clean-up runs in `finally`, by the run's
 * exact project ids (N) and its cameras' exact names: never by a machine-wide prefix, never a process by its name.
 * Signals go only to the process ids this run started. Every check is counted; "Checks in all: N passed, M failed".
 * Made-up data only. No model is called; no gateway is started.
 */
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chownSync, closeSync, constants, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { BROWSER_ZIP_LABEL, RUNNER_IMAGE, RUNNER_UID, runnerImageProblem } from "../src/acceptance/runner-image.js";
import { J1_BUILD_PROXY_PORT } from "../src/orchestrator/example-1-adapter.js";
import { createPool } from "../src/store/db.js";
import { portFree } from "./example-1-sandbox.js";
import { networkChecks } from "./journey-network-checks.js";
import {
  brokenCopyRecordChecks,
  cleanStopRecordChecks,
  crashRestartRecordChecks,
  midStepChecks,
  parseImages,
  parseNameLabel,
  parseProcesses,
  projectLeftovers,
  type Check,
  type DockerSeen,
  type EventSeen,
  type ProcessSeen,
} from "./journey-restart-checks.js";

const run = promisify(execFile);
const builderDir = resolve(import.meta.dirname, "..");
const repoDir = resolve(builderDir, "..");
const evidence = resolve(process.argv[2] ?? join(repoDir, "evidence", "2026-11-13-journey-j2"));
const screensDir = join(evidence, "screens");
const UI_PORT = 4022;
/** The demonstration pause of starts 2 and 3 (section 4.2): step 2's 8 writes then take about 32 s. */
const PAUSE_MS = 4000;
const STEP2 = "02-submitter-screen";
const STEP2_FILES = 8;
const runId = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${randomBytes(3).toString("hex")}`;
const dbName = `builder_j2_${runId}`;
const dbUrl = `postgres:///${dbName}?host=/var/run/postgresql`;
const START_LINE = "Projects with a job or a sandbox left by an interface that stopped, marked interrupted and removed at start:";
const STOP_LINE = "Projects with a sandbox, marked interrupted and removed at the stop:";

const log: string[] = [];
const say = (s: string) => {
  log.push(s);
  console.log(s);
};
const dockerEnv = (): NodeJS.ProcessEnv => ({ PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/root", ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}) });
const sh = async (cmd: string, args: string[]) => (await run(cmd, args, { env: dockerEnv(), maxBuffer: 32 * 1024 * 1024 })).stdout.trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A wait that does not keep the process alive once everything else has ended (a bound raced against an exit). */
const bound = (ms: number) => new Promise<null>((r) => setTimeout(() => r(null), ms).unref());
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const allChecks: Check[] = [];
/** Count one check, under the part of the design it belongs to, and print it. */
function count(part: string, c: Check): boolean {
  allChecks.push({ name: `${part}: ${c.name}`, ok: c.ok, detail: c.detail });
  say(`  ${c.ok ? "PASSED" : "FAILED"}: ${part}: ${c.name}${c.detail ? ` (${c.detail.slice(0, 700)})` : ""}`);
  return c.ok;
}

/* ------------------------------------------------------------------ the machine's lists (N) */

async function machine(): Promise<{ seen: DockerSeen; procs: ProcessSeen[] }> {
  const label = '{{.Label "com.docker.compose.project"}}';
  const [containers, volumes, networks, images, ps] = await Promise.all([
    sh("docker", ["ps", "-a", "--format", `{{.Names}}\t${label}`]),
    sh("docker", ["volume", "ls", "--format", `{{.Name}}\t${label}`]),
    sh("docker", ["network", "ls", "--format", `{{.Name}}\t${label}`]),
    sh("docker", ["image", "ls", "--format", "{{.Repository}}:{{.Tag}}"]),
    sh("ps", ["-eo", "pid,args"]),
  ]);
  return {
    seen: { containers: parseNameLabel(containers), volumes: parseNameLabel(volumes), networks: parseNameLabel(networks), images: parseImages(images) },
    procs: parseProcesses(ps).filter((p) => p.pid !== process.pid),
  };
}

/** Anything named builder_j1- (J1's prefix, which every journey project's sandbox carries), or a camera of this run. */
async function journeyThings(): Promise<string[]> {
  const { seen } = await machine();
  return [
    ...seen.containers.filter((c) => c.name.startsWith("builder_j1-") || c.composeProject.startsWith("builder_j1-") || c.name.startsWith(`j2-builder-camera-${runId}`)).map((c) => `container ${c.name}`),
    ...seen.volumes.filter((v) => v.name.startsWith("builder_j1-") || v.composeProject.startsWith("builder_j1-")).map((v) => `volume ${v.name}`),
    ...seen.networks.filter((n) => n.name.startsWith("builder_j1-") || n.composeProject.startsWith("builder_j1-")).map((n) => `network ${n.name}`),
    ...seen.images.filter((i) => i.repository.startsWith("builder_j1-")).map((i) => `image ${i.repository}:${i.tag}`),
  ];
}

/* ------------------------------------------------------------------ files */

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

/** A file the run reads for a check (item 1's failure file): a plain file of at most 1 MB, no link followed. */
function readSmall(path: string): Buffer | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > 1024 * 1024) return null;
    const b = Buffer.alloc(st.size);
    if (st.size > 0) readSync(fd, b, 0, st.size, 0);
    return b;
  } finally {
    closeSync(fd);
  }
}

async function waitFree(port: number, label: string): Promise<void> {
  const end = Date.now() + 30 * 60_000;
  let said = false;
  while (!(await portFree(port))) {
    if (Date.now() > end) throw new Error(`127.0.0.1:${port} (${label}) stayed in use for 30 minutes.`);
    if (!said) say(`Waiting: 127.0.0.1:${port} (${label}) is in use; nothing is stopped, the run waits.`);
    said = true;
    await sleep(15_000);
  }
}

async function main(): Promise<number> {
  mkdirSync(screensDir, { recursive: true });
  say(`J2's automated run, ${new Date().toISOString()} (run ${runId}).`);
  const imageProblem = await runnerImageProblem(RUNNER_IMAGE, dockerEnv());
  if (imageProblem) {
    say(`Refused: ${imageProblem}. Nothing was started.`);
    return 2;
  }
  say(`The approved runner image ${RUNNER_IMAGE} is on the machine, labelled ${BROWSER_ZIP_LABEL} with the approved browser zip's fingerprint (runnerImageProblem); this run neither builds nor removes it.`);
  say(`Builder tree: ${execFileSync("git", ["-C", builderDir, "write-tree", "--prefix=builder/"], { encoding: "utf8" }).trim()} (git write-tree --prefix=builder/ of the index at the start of the run); commit ${execFileSync("git", ["-C", builderDir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()}.`);
  say(`Free disk before: ${execFileSync("df", ["-h", "/"], { encoding: "utf8" }).trim().split("\n").pop()}`);
  say("Containers on the machine before (every one, running or not; others belong to other sessions):");
  say((await sh("docker", ["ps", "-a", "--format", "{{.Names}} {{.Status}}"])) || "(none)");
  const before = await journeyThings();
  say(`Anything named builder_j1- before (containers, volumes, networks, images): ${before.length ? before.join(", ") : "none"}`);
  if (before.length) {
    say("Refused: something named builder_j1- is on the machine already; nothing was started.");
    return 2;
  }
  await waitFree(J1_BUILD_PROXY_PORT, "the image build's port of journey sandboxes; the owner's project may hold it");
  await waitFree(UI_PORT, "this run's interface");
  say(`Ports ${J1_BUILD_PROXY_PORT} and ${UI_PORT} on 127.0.0.1 free before the run. The owner's interface on 4020 and the phone-test pages are not touched.`);

  // A fresh database, data folder, camera folder and temporary folder (the sandboxes are made in it), all in one run folder.
  execFileSync("createdb", ["-h", "/var/run/postgresql", dbName]);
  const work = mkdtempSync(join(tmpdir(), "j2-demo-"));
  const dataDir = join(work, "data");
  const cameraOut = join(work, "camera-out");
  const secretDir = join(work, "secret");
  const ifaceTmp = join(work, "tmp");
  for (const d of [dataDir, cameraOut, secretDir, ifaceTmp]) mkdirSync(d, { mode: 0o700 });
  const uiPassword = `j2-${randomBytes(18).toString("base64url")}`;
  const secretFile = join(secretDir, "ui-password");
  writeFileSync(secretFile, uiPassword, { mode: 0o400 });
  chownSync(cameraOut, RUNNER_UID, RUNNER_UID);
  chownSync(secretFile, RUNNER_UID, RUNNER_UID);
  say(`Fresh database ${dbName}; fresh data folder <run folder>/data; the interface's temporary folder (its sandboxes) <run folder>/tmp. A random interface password, given to the interface in its environment and to the builder camera as a read-only file (mode 0400); not printed or kept.`);

  const free = () => {
    const f = statfsSync(dataDir);
    return Number(f.bavail) * Number(f.bsize);
  };
  const disk = { first: free(), lowest: free(), samples: 0 };
  const diskSampler = setInterval(() => {
    disk.lowest = Math.min(disk.lowest, free());
    disk.samples++;
  }, 2000);

  let code = 1;
  const ifaceLog: string[] = [];
  const camLines: string[] = [];
  const projects: Array<{ id: string; name: string; walk: string }> = [];
  const camNames: string[] = [];
  const ifaces: Iface[] = [];
  let camerasOk = true;
  let shotsWanted = 0;
  let shotsCopied = 0;
  const pool = createPool(dbUrl);

  interface Iface {
    n: number;
    how: "node" | "tsx";
    proc: ChildProcess;
    lines: string[];
    exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
    done: boolean;
  }

  /** Start the interface: `node --import tsx` (the process is the interface) or tsx's wrapper (as `npm run web`). */
  async function startIface(n: number, how: "node" | "tsx", pauseMs: number): Promise<{ iface: Iface; started: boolean }> {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: ifaceTmp,
      BUILDER_DATABASE_URL: dbUrl,
      BUILDER_DATA_DIR: dataDir,
      BUILDER_UI_PASSWORD: uiPassword,
      BUILDER_UI_PORT: String(UI_PORT),
      NO_COLOR: "1",
      ...(pauseMs > 0 ? { BUILDER_DEMO_STEP_PAUSE_MS: String(pauseMs) } : {}),
    };
    for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "DOCKER_HOST"]) if (process.env[k]) env[k] = process.env[k];
    const proc =
      how === "tsx"
        ? spawn(join(builderDir, "node_modules", ".bin", "tsx"), ["src/web/main.ts"], { cwd: builderDir, env, stdio: ["ignore", "pipe", "pipe"] })
        : spawn(process.execPath, ["--import", "tsx", "src/web/main.ts"], { cwd: builderDir, env, stdio: ["ignore", "pipe", "pipe"] });
    const iface: Iface = { n, how, proc, lines: [], exited: new Promise((ok) => proc.on("exit", (code, signal) => ok({ code, signal }))), done: false };
    void iface.exited.then(() => (iface.done = true));
    ifaces.push(iface);
    const started = await new Promise<boolean>((ok) => {
      const onData = (d: Buffer) => {
        for (const l of d.toString("utf8").split("\n").filter(Boolean)) {
          iface.lines.push(l);
          ifaceLog.push(`[start ${n}] ${l}`);
          if (l.startsWith("Interface listening on")) ok(true);
        }
      };
      proc.stdout!.on("data", onData);
      proc.stderr!.on("data", onData);
      void iface.exited.then(() => ok(false));
      setTimeout(() => ok(false), 90_000).unref();
    });
    say(
      `Start ${n} (${how === "tsx" ? "node_modules/.bin/tsx src/web/main.ts, as npm run web starts it" : "node --import tsx src/web/main.ts"}${pauseMs > 0 ? `, BUILDER_DEMO_STEP_PAUSE_MS=${pauseMs}` : ""}): process ${proc.pid}, ${started ? "listening" : "NOT started"}. Its lines: ${iface.lines.map((l) => l.replaceAll(work, "<run folder>")).join(" | ")}`,
    );
    return { iface, started };
  }

  /** Send one signal to the exact process this run started, and wait for it to exit (at most `ms`). */
  async function signalAndWait(i: Iface, sig: "SIGTERM" | "SIGKILL", ms: number): Promise<{ code: number | null; signal: NodeJS.Signals | null; seconds: number } | null> {
    const t0 = Date.now();
    if (!i.done) process.kill(i.proc.pid!, sig);
    const r = await Promise.race([i.exited, bound(ms)]);
    if (r) await sleep(200); // the last lines of its pipes
    return r ? { ...r, seconds: (Date.now() - t0) / 1000 } : null;
  }

  async function eventsOf(projectId: string | null): Promise<EventSeen[]> {
    const r = await pool.query<{ id: string; kind: string; step: string | null; payload: Record<string, unknown> }>(
      projectId === null ? "select id::text as id, kind, step, payload from events order by events.id" : "select id::text as id, kind, step, payload from events where project_id = $1 order by events.id",
      projectId === null ? [] : [projectId],
    );
    return r.rows;
  }

  const sandboxDir = async (projectId: string): Promise<string | null> => {
    const made = (await eventsOf(projectId)).filter((e) => e.kind === "journey.sandbox.made");
    const dir = made.at(-1)?.payload.dir;
    return typeof dir === "string" ? dir : null;
  };

  /** N for one project: what Docker and the machine still hold of it, and its sandbox folder while it exists. */
  async function leftOf(projectId: string, m?: { seen: DockerSeen; procs: ProcessSeen[] }): Promise<string[]> {
    const lists = m ?? (await machine());
    const dir = await sandboxDir(projectId);
    return projectLeftovers(projectId, lists.seen, lists.procs, { path: dir, exists: dir !== null && existsSync(dir) });
  }
  const shown = (xs: string[]) => (xs.length ? xs.join("; ").replaceAll(work, "<run folder>") : "nothing");

  /** One walk of the builder camera, in the approved runner image; its checks are counted under `part`. */
  async function camera(part: string, walk: string, env: Record<string, string>, during?: () => Promise<void>): Promise<{ code: number | null; lines: Array<Record<string, unknown>> }> {
    const name = `j2-builder-camera-${runId}-${camNames.length + 1}`;
    camNames.push(name);
    const args = [
      "run", "--rm", "--name", name, "--network", "host",
      "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", "256", "--memory", "1g",
      "--user", "runner", "--workdir", "/runner", "--entrypoint", "node",
      "--env", `BUILDER_CAMERA_BASE=http://127.0.0.1:${UI_PORT}`, "--env", `BUILDER_CAMERA_WALK=${walk}`,
      ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
      "--volume", `${join(builderDir, "camera", "builder-shots.mjs")}:/camera/builder-shots.mjs:ro`,
      "--volume", `${cameraOut}:/shots`,
      "--volume", `${secretFile}:/run/secrets/ui-password:ro`,
      RUNNER_IMAGE, "/camera/builder-shots.mjs",
    ];
    say(`${part}: the builder camera, walk ${walk}: docker ${args.join(" ").replaceAll(work, "<run folder>")}`);
    camLines.push(JSON.stringify({ kind: "walk", walk, part, camera: name, env }));
    const t0 = Date.now();
    const cam = spawn("docker", args, { env: dockerEnv(), stdio: ["ignore", "pipe", "pipe"] });
    const parsed: Array<Record<string, unknown>> = [];
    let buf = "";
    cam.stdout!.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const l of parts.filter(Boolean)) {
        camLines.push(l);
        let o: Record<string, unknown>;
        try {
          o = JSON.parse(l) as Record<string, unknown>;
        } catch {
          say(`  camera (not JSON): ${l.slice(0, 200)}`);
          continue;
        }
        parsed.push(o);
        if (o.kind === "check") count(`${part}, camera`, { name: String(o.name), ok: o.ok === true, detail: o.ok === true ? "" : String(o.detail ?? "") });
        else if (o.kind === "project") {
          // After J2's review: an id is used below in Docker names and clean-up, so it must be a journey id, exactly.
          if (!/^j1-[0-9a-f]{12}$/.test(String(o.id))) throw new Error(`the builder camera named a project whose id is not a journey id: ${String(o.id).slice(0, 80)}`);
          projects.push({ id: String(o.id), name: String(o.name), walk });
          say(`  project ${String(o.id)}: ${String(o.name)}, cap $${String(o.cap)}`);
        } else if (o.kind === "shot") shotsWanted++;
      }
    });
    let camErr = "";
    cam.stderr!.on("data", (d: Buffer) => (camErr = (camErr + d.toString("utf8")).slice(-4000)));
    const ended = new Promise<number | null>((ok) => {
      const timer = setTimeout(() => void run("docker", ["kill", name], { env: dockerEnv() }).catch(() => undefined), 3_600_000);
      cam.on("close", (c) => {
        clearTimeout(timer);
        ok(c);
      });
    });
    let stopDuring = false;
    const sideTask = during ? (async () => {
      while (!stopDuring) {
        await during().catch(() => undefined);
        await sleep(500);
      }
    })() : Promise.resolve();
    const code = await ended;
    stopDuring = true;
    await sideTask;
    if (buf.trim()) camLines.push(buf.trim());
    say(`${part}: the builder camera ended with exit code ${code} after ${Math.round((Date.now() - t0) / 1000)} s.${camErr.trim() ? ` Its error output (end): ${camErr.trim().split("\n").slice(-3).join(" | ")}` : ""}`);
    count(part, { name: `the camera walk ${walk} exited with code 0`, ok: code === 0, detail: `exit code ${code}` });
    if (code !== 0) camerasOk = false;
    // Its screenshots, copied as the camera named them.
    for (const o of parsed.filter((x) => x.kind === "shot")) {
      const file = String(o.file);
      if (!/^\d{2}-[a-z0-9-]+-(en|ar|phone)\.png$/.test(file)) continue;
      const b = readPng(join(cameraOut, file));
      if (!b) {
        say(`  screenshot ${file}: not a plain PNG; not copied`);
        continue;
      }
      writeFileSync(join(screensDir, file), b);
      shotsCopied++;
    }
    return { code, lines: parsed };
  }

  const linesSince = (i: Iface, from: number) => i.lines.slice(from);
  const startLine = (i: Iface) => i.lines.find((l) => l.startsWith(START_LINE)) ?? "";

  /** The end of a start: SIGTERM to the exact process, exit 0 within 120 s, and "removed at the stop: <n>". */
  async function stopClean(part: string, i: Iface, removed: number, more: (after: string[]) => Check[] = () => []): Promise<void> {
    const from = i.lines.length;
    say(`${part}: SIGTERM to process ${i.proc.pid} (${i.how === "tsx" ? "tsx's wrapper, which passes it on to the interface" : "the interface itself"}).`);
    const r = await signalAndWait(i, "SIGTERM", 120_000);
    const after = linesSince(i, from);
    say(`${part}: ${r ? `exited after ${r.seconds.toFixed(1)} s with code ${r.code}${r.signal ? `, signal ${r.signal}` : ""}` : "NOT exited within 120 s"}. Its lines after the signal: ${after.map((l) => l.replaceAll(work, "<run folder>")).join(" | ")}`);
    count(part, { name: "the process exits with code 0 within 120 s of SIGTERM", ok: r !== null && r.code === 0, detail: r ? `code ${r.code}, ${r.seconds.toFixed(1)} s` : "not exited" });
    count(part, { name: `the interface says "${STOP_LINE} ${removed}."`, ok: after.includes(`${STOP_LINE} ${removed}.`), detail: after.filter((l) => l.startsWith(STOP_LINE)).join(" | ") || "no such line" });
    count(part, { name: "the interface's own last line gives exit code 0, the code the process exited with", ok: after.at(-1) === "[interface stopped] Lock released. Exit code 0." && r?.code === 0, detail: after.at(-1) ?? "no line" });
    for (const c of more(after)) count(part, c);
  }

  /** Read Docker's list of the project's engine containers and its step-2 writes while a j2c-run walk runs. */
  function midStepSampler(label: string): { during: () => Promise<void>; report: () => void } {
    const known = projects.length;
    const engines = new Map<string, number>();
    const writes: Array<{ at: number; n: number }> = [];
    const t0 = Date.now();
    return {
      during: async () => {
        const names = (await sh("docker", ["ps", "--format", "{{.Names}}"])).split("\n").filter((n) => /^builder_j1-[0-9a-f]{12}-engine-/.test(n));
        for (const n of names) if (!engines.has(n)) engines.set(n, Date.now() - t0);
        // Only the project this walk made, once the camera has named it.
        const p = projects.length > known ? projects.at(-1) : undefined;
        if (p && p.walk === "j2c-run") {
          const r = await pool.query<{ n: string }>("select count(*)::text as n from events where project_id = $1 and kind = 'engine.event' and step = $2 and payload->>'type' = 'tool_call' and payload->>'tool' = 'scripted.write'", [p.id, STEP2]);
          const n = Number(r.rows[0]?.n ?? 0);
          if (writes.at(-1)?.n !== n) writes.push({ at: Date.now() - t0, n });
        }
      },
      report: () => {
        say(`${label}: engine containers Docker listed while the walk ran (every 0.5 s; first seen, seconds after the walk began): ${[...engines].map(([n, at]) => `${n} at ${(at / 1000).toFixed(1)}`).join(", ") || "none"}`);
        say(`${label}: step 2's scripted.write events in the record while the walk ran (count, seconds after the walk began): ${writes.map((w) => `${w.n} at ${(w.at / 1000).toFixed(1)}`).join(", ") || "none"}`);
      },
    };
  }

  /** T1 and K1: the camera ended; then the record and Docker's list, before any signal. */
  async function midStep(part: string, projectId: string): Promise<string | null> {
    const ev = await eventsOf(projectId);
    const running = (await sh("docker", ["ps", "--format", "{{.Names}}"])).split("\n").filter(Boolean);
    for (const c of midStepChecks(ev, STEP2, STEP2_FILES, running, projectId)) count(part, c);
    const job = ev.filter((e) => e.kind === "journey.job.started" && e.payload.kind === "build_step" && e.step === STEP2).at(-1);
    const paused = ev.filter((e) => e.kind === "journey.step.paused_for_demonstration" && e.step === STEP2).at(-1);
    say(`${part}: step 2's build job ${job ? String(job.payload.job_id) : "NOT FOUND"}; journey.step.paused_for_demonstration recorded first in it: ${paused ? JSON.stringify(paused.payload) : "no"}.`);
    return job ? String(job.payload.job_id) : null;
  }

  /** Record what N matches for each of the run's projects, between the stops and the starts. */
  async function listsBetween(label: string): Promise<void> {
    const m = await machine();
    say(`${label}: Docker lists ${m.seen.containers.length} containers, ${m.seen.volumes.length} volumes, ${m.seen.networks.length} networks, ${m.seen.images.length} images; the machine ${m.procs.length} processes. What N matches of each of the run's projects:`);
    for (const p of projects) say(`  ${p.id} (${p.name}): ${shown(await leftOf(p.id, m))}`);
  }

  try {
    /* ---------------------------------------------------------------- start 1: J2 (a) */
    say("");
    say("== Start 1: J2 (a), the broken copy rejected ==");
    const s1 = await startIface(1, "node", 0);
    if (!s1.started) {
      count("start 1", { name: "the interface starts", ok: false, detail: s1.iface.lines.join(" | ") });
      return 1;
    }
    const seen = new Map<string, { networks: string; ports: string }>();
    const j2a = await camera("J2 (a)", "j2a", {}, async () => {
      const out = await sh("docker", ["ps", "--format", "{{.Names}}\t{{.Networks}}\t{{.Ports}}"]);
      for (const [name, networks, ports] of out.split("\n").map((l) => l.split("\t"))) {
        if ((name ?? "").startsWith("builder_j1-")) seen.set(name!, { networks: (networks ?? "").split(",").filter(Boolean).sort().join(","), ports: ports ?? "" });
      }
    });
    say(`J2 (a): the project's containers Docker listed while the camera ran (every 0.5 s; name [networks], published ports if any): ${seen.size}`);
    for (const [name, v] of seen) say(`  ${name} [${v.networks}]${v.ports ? ` ports: ${v.ports}` : ""}`);
    for (const c of networkChecks(seen)) count("J2 (a), J1's network checks on the app's containers", c);
    const broken = projects.find((p) => p.walk === "j2a");
    if (broken) {
      const manifestFile = join(builderDir, "scripted-broken", "example-1", "03-wrong-status", "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { label: string };
      const banner = (lang: string) => (JSON.parse(readFileSync(join(builderDir, "scripted-broken", "example-1", "03-wrong-status", "files", "messages", `${lang}.json`), "utf8")) as { app: { sample_banner: string } }).app.sample_banner;
      const sentence = { en: "This is a deliberately broken copy, made to be rejected by the acceptance check.", ar: "هذه نسخة معطّلة عمداً، صُنعت ليرفضها فحص القبول." };
      count("J2 (a), item 5", { name: "the broken copy's own message files hold the two banner sentences the run looks for", ok: banner("en").includes(sentence.en) && banner("ar").includes(sentence.ar), detail: "" });
      const row = (await pool.query<{ name: string; cap_usd: string }>("select name, cap_usd::text from projects where id = $1", [broken.id])).rows[0];
      const named = (await pool.query<{ n: string }>("select count(*)::text as n from projects where name = $1", ["Deliberately broken copy (made-up)"])).rows[0]?.n;
      count("J2 (a), item 2", { name: 'the button made one project, "Deliberately broken copy (made-up)", with a $5.00 cap', ok: row?.name === "Deliberately broken copy (made-up)" && Number(row.cap_usd) === 5 && named === "1", detail: JSON.stringify({ ...row, projects_of_that_name: named }) });
      const checks = brokenCopyRecordChecks(
        await eventsOf(broken.id),
        {
          step: "03-wrong-status",
          source: "builder/scripted-broken/example-1/03-wrong-status",
          label: manifest.label,
          manifestSha256: sha256(readFileSync(manifestFile)),
          steps: ["01-data", "02-submitter-screen", "03-wrong-status"],
          reservations: [1.5552, 3.1104, 1.1664],
          bannerEn: sentence.en,
          bannerAr: sentence.ar,
        },
        readSmall,
        sha256,
      );
      for (const c of checks) count("J2 (a), the record", c);
      count("J2 (a), item 9", { name: "after Close project, nothing of the project is left on the machine (N)", ok: (await leftOf(broken.id)).length === 0, detail: shown(await leftOf(broken.id)) });
    } else count("J2 (a)", { name: "the walk made the broken copy", ok: false, detail: `camera exit ${j2a.code}` });
    await stopClean("J2 (a), start 1's stop", s1.iface, 0);
    await listsBetween("After start 1");

    /* ---------------------------------------------------------------- start 2: path T, the clean stop */
    say("");
    say("== Start 2: path T, the clean stop (SIGTERM to tsx's wrapper) ==");
    const s2 = await startIface(2, "tsx", PAUSE_MS);
    if (!s2.started) {
      count("start 2", { name: "the interface starts", ok: false, detail: s2.iface.lines.join(" | ") });
      return 1;
    }
    count("T, start 2", { name: "the interface prints the demonstration setting at start", ok: s2.iface.lines.some((l) => l.startsWith(`Demonstration setting: the scripted engine pauses ${PAUSE_MS} ms before each write`)), detail: "" });
    const sampT = midStepSampler("T1");
    await camera("T1", "j2c-run", { BUILDER_CAMERA_PATH: "t", BUILDER_CAMERA_PAUSE_MS: String(PAUSE_MS) }, sampT.during);
    sampT.report();
    const p1 = projects.find((p) => p.walk === "j2c-run" && p.name === "Restart: clean stop (made-up)");
    if (!p1) {
      count("T1", { name: "the walk made P1", ok: false, detail: "" });
      return 1;
    }
    const job1 = await midStep("T1", p1.id);
    await stopClean("T2", s2.iface, 1, (after) => [
      { name: `the interface's lines name the job it stopped (${job1}) and its project`, ok: job1 !== null && after.some((l) => l.includes(`Its running job (${job1}, project ${p1.id}) is being stopped first.`)), detail: "" },
      { name: "the interface's lines name the sandbox it removed", ok: after.some((l) => l.includes(`Project ${p1.id}: its sandbox (`) && l.includes("was removed at the stop")), detail: "" },
    ]);
    const t3 = await leftOf(p1.id);
    count("T3", { name: "right after the exit, before any restart: nothing of P1 is left (N): no container, volume, network, image or process, and the folder gone", ok: t3.length === 0, detail: shown(t3) });
    // After J2's review: a job not found is a failed check of T4, never T4's record checks left uncounted.
    count("T4", { name: "step 2's build job was found in the record, so its record checks below are made", ok: job1 !== null, detail: job1 ?? "no journey.job.started of step 2" });
    if (job1) for (const c of cleanStopRecordChecks(await eventsOf(p1.id), job1, STEP2)) count("T4", c);
    await listsBetween("After start 2's stop");

    /* ---------------------------------------------------------------- start 3: T5 to T7, then path K's crash */
    say("");
    say("== Start 3: the restart after the clean stop; then path K, the crash (SIGKILL to the interface) ==");
    const s3 = await startIface(3, "node", PAUSE_MS);
    if (!s3.started) {
      count("start 3", { name: "the interface starts", ok: false, detail: s3.iface.lines.join(" | ") });
      return 1;
    }
    count("T5", { name: `the restart takes the lock and prints "${START_LINE} 0."`, ok: startLine(s3.iface) === `${START_LINE} 0.`, detail: startLine(s3.iface) || "no such line" });
    await camera("T6 and T7", "j2c-after", { BUILDER_CAMERA_PATH: "t", BUILDER_CAMERA_PROJECT: p1.id, BUILDER_CAMERA_HOLD_REASON: "step_ended" });
    const sampK = midStepSampler("K1");
    await camera("K1", "j2c-run", { BUILDER_CAMERA_PATH: "k", BUILDER_CAMERA_PAUSE_MS: String(PAUSE_MS) }, sampK.during);
    sampK.report();
    const p2 = projects.find((p) => p.walk === "j2c-run" && p.name === "Restart: crash (made-up)");
    if (!p2) {
      count("K1", { name: "the walk made P2", ok: false, detail: "" });
      return 1;
    }
    const job2 = await midStep("K1", p2.id);
    say(`K2: SIGKILL to process ${s3.iface.proc.pid} (the interface itself, started with node --import tsx).`);
    const k = await signalAndWait(s3.iface, "SIGKILL", 30_000);
    say(`K2: ${k ? `ended after ${k.seconds.toFixed(1)} s, signal ${k.signal}` : "NOT ended within 30 s"}.`);
    const k2 = await leftOf(p2.id);
    say(`K2: what is left of P2 right after the kill (N), recorded as found: ${shown(k2)}`);
    const dir2 = await sandboxDir(p2.id);
    count("K2", { name: "right after the kill, P2's sandbox folder is still there (the crash path is real)", ok: dir2 !== null && existsSync(dir2), detail: dir2 ? dir2.replaceAll(work, "<run folder>") : "no folder recorded" });
    await listsBetween("After the kill, before start 4");

    /* ---------------------------------------------------------------- start 4: K3 to K6 */
    say("");
    say("== Start 4: the restart after the crash ==");
    let s4: { iface: Iface; started: boolean } | null = null;
    const tryUntil = Date.now() + 30_000;
    for (let attempt = 1; ; attempt++) {
      s4 = await startIface(4, "node", 0);
      if (s4.started) break;
      const held = s4.iface.lines.some((l) => l.includes("Another interface is running on this database"));
      say(`Start 4, attempt ${attempt}: not started${held ? " (the instance lock is still held)" : ""}.`);
      if (!held || Date.now() > tryUntil) break;
      await sleep(2000);
    }
    if (!s4?.started) {
      count("K3", { name: "the interface starts within 30 s of retries", ok: false, detail: s4?.iface.lines.join(" | ") ?? "" });
      return 1;
    }
    count("K3", { name: `the restart prints "${START_LINE} 1."`, ok: startLine(s4.iface) === `${START_LINE} 1.`, detail: startLine(s4.iface) || "no such line" });
    count("K3", { name: "step 2's build job was found in the record, so its record checks below are made", ok: job2 !== null, detail: job2 ?? "no journey.job.started of step 2" });
    if (job2) for (const c of crashRestartRecordChecks(await eventsOf(p2.id), job2, STEP2)) count("K3", c);
    const left4a = await leftOf(p2.id);
    count("K4", { name: "after the restart's recovery: nothing of P2 is left (N)", ok: left4a.length === 0, detail: shown(left4a) });
    const waitUntil = Date.now() + 60_000;
    let procsLeft = left4a.filter((l) => l.startsWith("process "));
    while (procsLeft.length && Date.now() < waitUntil) {
      await sleep(1000);
      procsLeft = (await leftOf(p2.id)).filter((l) => l.startsWith("process "));
    }
    const left4b = await leftOf(p2.id);
    count("K4", { name: `again once no process names builder_${p2.id} (the run waits at most 60 s): nothing of P2 is left (N)`, ok: left4b.length === 0, detail: `${shown(left4b)}; waited ${procsLeft.length ? "60 s, a process still named it" : "until no process named it"}` });
    await camera("K5 and K6", "j2c-after", { BUILDER_CAMERA_PATH: "k", BUILDER_CAMERA_PROJECT: p2.id, BUILDER_CAMERA_HOLD_REASON: "job_interrupted" });
    await stopClean("Start 4's stop", s4.iface, 0);
    await listsBetween("After start 4's stop");

    /* ---------------------------------------------------------------- the whole run */
    say("");
    say("== The whole run ==");
    const all = await eventsOf(null);
    const stagedBy = new Set((await pool.query<{ project_id: string }>("select distinct project_id from events where kind = 'journey.broken_step_staged'")).rows.map((r) => r.project_id));
    count("J2 (a), item 4", { name: "no other project of the run has a journey.broken_step_staged", ok: broken !== undefined && stagedBy.size === 1 && stagedBy.has(broken.id), detail: [...stagedBy].join(", ") });
    count("J2 (c)", { name: "the record of the run holds no journey.signed_off and no journey.export.written", ok: !all.some((e) => e.kind === "journey.signed_off" || e.kind === "journey.export.written"), detail: "" });
    code = 0;
  } catch (err) {
    say(`The run stopped part-way: ${err instanceof Error ? err.message : String(err)}`);
    count("the run", { name: "ran to its end without an error", ok: false, detail: err instanceof Error ? err.message : String(err) });
  } finally {
    // Any interface of the run still running: SIGTERM to its exact process, then SIGKILL after 120 s.
    for (const i of ifaces) {
      if (i.done) continue;
      say(`Clean-up: start ${i.n}'s process ${i.proc.pid} is still running; SIGTERM to it.`);
      if (!(await signalAndWait(i, "SIGTERM", 120_000))) await signalAndWait(i, "SIGKILL", 30_000);
      code = 1;
    }
    let ifaceText = ifaceLog.join("\n").replaceAll(work, "<run folder>");
    for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"]) if (process.env[k]) ifaceText = ifaceText.replaceAll(process.env[k]!, "<session proxy>");
    if (ifaceText.includes(uiPassword)) {
      ifaceText = "(not written: the output held the interface's password)";
      code = 1;
    }
    writeFileSync(join(evidence, "interface-log.txt"), `The interface's own output during the run (stdout and stderr), each line marked with its start (1 to 4), with this run's folder written <run folder> and the session proxy's address <session proxy>:\n\n${ifaceText}\n`);
    const camText = camLines.join("\n");
    writeFileSync(join(evidence, "camera-lines.jsonl"), camText.includes(uiPassword) ? "(not written: a line held the interface's password)\n" : camText.replaceAll(work, "<run folder>") + "\n");
    clearInterval(diskSampler);
    const gb = (b: number) => (b / 1024 ** 3).toFixed(2);
    say(`Free space on the data folder's disk, sampled every 2 s (${disk.samples} samples): ${gb(disk.first)} GB at the start, ${gb(disk.lowest)} GB at the lowest, ${gb(free())} GB at the end, before the clean-up (GB of 1024^3 bytes).`);

    // Every event of the run, whether or not it ran to its end; never with the interface's password.
    try {
      const evRows = await pool.query<{ id: string; project_id: string; at: Date; kind: string; step: string | null; payload: Record<string, unknown> }>("select id::text as id, project_id, at, kind, step, payload from events order by events.id");
      const text = JSON.stringify({ run: runId, database: dbName, note: "Every event of the run's database, in id order. Made-up data only. Paths are of this machine's run folder, removed after the run.", events: evRows.rows.map((e) => ({ ...e, at: e.at.toISOString() })) }, null, 1);
      if (text.includes(uiPassword)) throw new Error("the events would hold the interface's password");
      writeFileSync(join(evidence, "events.json"), text.replaceAll(work, "<run folder>") + "\n");
      say(`Events written to events.json: ${evRows.rows.length}, in id order, for ${new Set(evRows.rows.map((e) => e.project_id)).size} projects.`);
    } catch (err) {
      say(`The events were not written: ${err instanceof Error ? err.message : String(err)}.`);
      code = 1;
    }

    // Rule N for the whole run: nothing of its projects left; no camera of the run. Removed by exact names if found.
    const m = await machine().catch(() => null);
    for (const p of projects) {
      const left = m ? await leftOf(p.id, m).catch(() => ["(could not be listed)"]) : ["(could not be listed)"];
      count("The whole run", { name: `at the end, nothing of ${p.id} (${p.name}) is left (N)`, ok: left.length === 0, detail: shown(left) });
      if (!left.length || !m) continue;
      const c = `builder_${p.id}`;
      for (const x of m.seen.containers.filter((x) => x.name.startsWith(`${c}-`) || x.composeProject === c)) await sh("docker", ["rm", "-f", x.name]).catch(() => "");
      for (const x of m.seen.volumes.filter((x) => x.name.startsWith(`${c}_`) || x.composeProject === c)) await sh("docker", ["volume", "rm", "-f", x.name]).catch(() => "");
      for (const x of m.seen.networks.filter((x) => x.name.startsWith(`${c}_`) || x.composeProject === c)) await sh("docker", ["network", "rm", x.name]).catch(() => "");
      for (const x of m.seen.images.filter((x) => x.repository.startsWith(`${c}-`))) await sh("docker", ["image", "rm", "-f", `${x.repository}:${x.tag}`]).catch(() => "");
      const dir = await sandboxDir(p.id).catch(() => null);
      if (dir && existsSync(dir) && resolve(dir).startsWith(`${resolve(work)}/`)) rmSync(dir, { recursive: true, force: true });
      say(`  removed by the run's clean-up, by exact name; left now: ${shown(await leftOf(p.id).catch(() => ["(could not be listed)"]))}`);
    }
    const cams = m ? m.seen.containers.filter((c) => camNames.includes(c.name)) : [];
    count("The whole run", { name: "no container of the run's builder camera (j2-builder-camera-*) is left", ok: m !== null && cams.length === 0, detail: cams.map((c) => c.name).join(", ") || "none" });
    for (const c of cams) await sh("docker", ["rm", "-f", c.name]).catch(() => "");
    await pool.end().catch(() => undefined);
    rmSync(work, { recursive: true, force: true });
    execFileSync("dropdb", ["-h", "/var/run/postgresql", "--if-exists", dbName]);
    const dbLeft = execFileSync("psql", ["-h", "/var/run/postgresql", "-d", "postgres", "-Atc", `select count(*) from pg_database where datname = '${dbName}'`], { encoding: "utf8" }).trim();
    count("The whole run", { name: "the run folder removed and the database dropped", ok: !existsSync(work) && dbLeft === "0", detail: `folder ${existsSync(work) ? "still there" : "removed"}; database ${dbLeft === "0" ? "dropped" : "still there"}` });
    say(`Containers on the machine after (every one): ${(await sh("docker", ["ps", "-a", "--format", "{{.Names}} {{.Status}}"])) || "(none)"}`);
    say(`Anything named builder_j1- after: ${(await journeyThings()).join(", ") || "none"}`);
    say(`Ports after: ${UI_PORT} ${(await portFree(UI_PORT)) ? "free" : "IN USE"}, ${J1_BUILD_PROXY_PORT} ${(await portFree(J1_BUILD_PROXY_PORT)) ? "free" : "IN USE"}.`);
    say(`Free disk after: ${execFileSync("df", ["-h", "/"], { encoding: "utf8" }).trim().split("\n").pop()}`);
    say(`Projects the run made: ${projects.map((p) => `${p.id} (${p.name})`).join(", ") || "none"}.`);
    say(`Screenshots copied into the evidence folder: ${shotsCopied} of ${shotsWanted}.`);
    const failed = allChecks.filter((c) => !c.ok);
    if (failed.length || !camerasOk || shotsCopied !== shotsWanted || shotsWanted === 0) code = 1;
    say(`Checks in all: ${allChecks.length - failed.length} passed, ${failed.length} failed (${allChecks.length} counted: the builder camera's, the record's, Docker's and the machine's lists, the interface's lines and exit codes).`);
    for (const c of failed) say(`  FAILED: ${c.name}${c.detail ? ` (${c.detail.slice(0, 500)})` : ""}`);
    say(`Result: ${code === 0 ? "every check passed" : "NOT every check passed"} (exit code ${code}).`);
    const logText = log.join("\n");
    if (logText.includes(uiPassword)) {
      writeFileSync(join(evidence, "run-demo.txt"), "The run's log is not written: it would hold the interface's password.\n");
      code = 1;
    } else writeFileSync(join(evidence, "run-demo.txt"), logText.replaceAll(work, "<run folder>") + "\n");
  }
  return code;
}

process.exitCode = await main();
