/**
 * Package 3.2's automated run (docs/design/package-3.2.md, section 7): the export made with the builder running, then
 * the builder that made it stopped and its data gone, then the exported copy started on its own by its README's one
 * command, and the checklist's test run from that copy.
 *
 *   flock <scratchpad>/live-tests.lock npx tsx scripts/demo-export.ts <evidence folder>
 *
 * Before: the runner image is checked (`runnerImageProblem`); free disk and Docker's lists (containers, images, volumes,
 * networks, and the build cache's records) are recorded; nothing is refused for other people's names (the owner's own
 * builder makes `builder_j1-` projects): the run's project id is new and random, and the run checks that none of its
 * own exact names existed at the start; it waits up to 30 minutes for 127.0.0.1:4025, 3000 and 13161 to be free and
 * never stops anything; a fresh database `builder_x32_<run>`, data folder and camera folder; a random interface
 * password, given to the camera as a 0400 file and never printed.
 *
 * A. The builder running: the interface on 127.0.0.1:4025 (`node --import tsx src/web/main.ts`), the live preview off.
 *    The builder camera (camera/builder-shots.mjs, walk x32, in the approved runner image) walks J1's path to the
 *    export, its screen in English, Arabic and at 390 px, the download, and "Close project". The run checks the event
 *    and the archive against it.
 * B. The builder stopped: events saved, SIGTERM to the interface's exact process (exit code 0 within 120 s, "removed at
 *    the stop: 0"); then 1 to 7 of section 7 B: the process gone and 4025 free; no process naming the run's data
 *    folder, database or the interface; nothing of the project in Docker (rule N, the check's images too); no gateway
 *    (what listens on 4010 recorded); the database dropped, the archive and events copied out, the data folder deleted
 *    and no container mounting it; 4020, 4032 and 4033 recorded, not touched; npm's cache mount and the base images
 *    recorded.
 * C. The export alone: copied into a fresh folder, checked against the event, unpacked; its history; before the start
 *    (the files the event lists, the four start files equal to the template's, none of S29's names, S30's
 *    comparison); the README's "Start it" block run exactly, in the folder, with only PATH and HOME; the app healthy;
 *    the person's way in; no way back to the machine (a listener of the run's own); the tables.
 * D. Section 4's items 4 to 7 on the images the copy's own command built.
 * E. scripts/check-export.ts, as a command, with the event's values; the runner inspected while it runs.
 * F. A second start. G. The copy unchanged. H. Clean-up in `finally`, by exact names; Docker's lists compared with the
 *    start.
 *
 * Then the run's record page (written from the check's reading and the stop record, photographed by the run's camera,
 * camera/record-shot.mjs, with no network), the evidence files, and the search of every evidence file for the four
 * secrets the run handles. Every check is counted: "Checks in all: N passed, M failed"; exit code 0 only if every check
 * passed, every picture was copied, the secret search found nothing and nothing new of the run was left.
 *
 * Signals go only to the process ids this run started; Docker objects are removed only by the exact names this run
 * made. Made-up data only. No model is called; no gateway is started.
 */
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chownSync, closeSync, constants, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { BROWSER_ZIP_LABEL, RUNNER_IMAGE, RUNNER_UID, runnerImageProblem } from "../src/acceptance/runner-image.js";
import { readWithoutBeingTold } from "../src/export/app-compose.js";
import { copyFingerprints } from "../src/export/check-from-copy.js";
import { composeConfigCheck, devOnlyNames, runImageChecks, TEMPLATE_DIR, toolsImageChecks, type ExportCheck } from "../src/export/export-check.js";
import { J1_BUILD_PROXY_PORT } from "../src/orchestrator/example-1-adapter.js";
import { startItCommand } from "../src/orchestrator/export.js";
import { DEFAULT_IMAGES, HARDENING } from "../src/sandbox/manager.js";
import { createPool } from "../src/store/db.js";
import { portFree } from "./example-1-sandbox.js";
import { networkChecks } from "./journey-network-checks.js";
import { parseImages, parseNameLabel, parseProcesses, projectLeftovers, type Check, type DockerSeen, type ProcessSeen } from "./journey-restart-checks.js";

const run = promisify(execFile);
const builderDir = resolve(import.meta.dirname, "..");
const repoDir = resolve(builderDir, "..");
const evidence = resolve(process.argv[2] ?? join(repoDir, "evidence", "2026-11-14-package-3.2"));
const screensDir = join(evidence, "screens");
const UI_PORT = 4025;
const APP_PORT = 3000;
const GATEWAY_PORT = 4010;
const OWNER_PORTS = [4020, 4032, 4033];
const runId = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${randomBytes(3).toString("hex")}`;
const dbName = `builder_x32_${runId}`;
const dbUrl = `postgres:///${dbName}?host=/var/run/postgresql`;
const STOP_LINE = "Projects with a sandbox, marked interrupted and removed at the stop:";
const SUMMARY = "version passed; checklist incomplete (5 of the app spec's 6 checklist items have no test)";
const STAND_IN = "stand-in test, not independent acceptance";
const EXPORT_CHECK_IDS = ["archive_contents", "fixed_files", "images_built", "compose_config", "run_image_packages", "run_image_notices", "tools_image_packages", "licence_check"];
const USERS = ["employee@example.test", "hr.admin@example.test", "manager@example.test"];
const START_FILES = ["compose.yaml", "README.md", "Dockerfile", ".dockerignore"];
/** npm's cache mount, as the template's Dockerfile names it (design section 1, "The build on this machine"). */
const NPM_CACHE_ID = "house-template-npm";
/** The evidence files this run writes (design section 7, "Files"). */
const OWN_FILES = ["run-demo.txt", "events.json", "interface-log.txt", "compose-output.txt", "npm-build-lines.txt", "check-reading.json", "export-contents.txt", "docker-after.txt", "run-secret-search.txt"];

const log: string[] = [];
const say = (s: string) => {
  log.push(s);
  console.log(s);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bound = (ms: number) => new Promise<null>((r) => setTimeout(() => r(null), ms).unref());
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const iso = (t: number) => new Date(t).toISOString();

const allChecks: Check[] = [];
/** Count one check, under the part of the design it belongs to, and print it. */
function count(part: string, c: Check): boolean {
  allChecks.push({ name: `${part}: ${c.name}`, ok: c.ok, detail: c.detail });
  say(`  ${c.ok ? "PASSED" : "FAILED"}: ${part}: ${c.name}${c.detail ? ` (${c.detail.slice(0, 900)})` : ""}`);
  return c.ok;
}

/** The run's own Docker commands: PATH, HOME and the daemon's address only. */
const dockerEnv = (): NodeJS.ProcessEnv => ({ PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/root", ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}) });
/**
 * A person's plain environment for the exported copy: PATH and HOME only (no proxy setting, nothing of the builder's).
 * PATH is the machine's own, without the folders npx puts in front of it for the run itself (node_modules/.bin).
 */
const personEnv = (): NodeJS.ProcessEnv => ({
  PATH: (process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin")
    .split(":")
    .filter((p) => p && !p.includes("node_modules"))
    .join(":"),
  HOME: process.env.HOME ?? "/root",
});
const sh = async (cmd: string, args: string[], o: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}) =>
  (await run(cmd, args, { cwd: o.cwd, env: o.env ?? dockerEnv(), maxBuffer: 64 * 1024 * 1024, timeout: o.timeout ?? 300_000 })).stdout.trim();

/* ------------------------------------------------------------------ files */

/** A plain file (no link followed), at most `max` bytes; null otherwise. */
function readPlain(path: string, max: number): Buffer | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > max) return null;
    const b = Buffer.alloc(st.size);
    let n = 0;
    while (n < st.size) {
      const r = readSync(fd, b, n, st.size - n, n);
      if (r === 0) break;
      n += r;
    }
    return b.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const readPng = (path: string): Buffer | null => {
  const b = readPlain(path, 30 * 1024 * 1024);
  return b && b.length >= 8 && b.subarray(0, 8).equals(PNG) ? b : null;
};
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/* ------------------------------------------------------------------ the machine */

interface Lists {
  containers: Array<{ name: string; project: string }>;
  images: Array<{ ref: string; id: string }>;
  volumes: Array<{ name: string; project: string }>;
  networks: Array<{ name: string; project: string }>;
  cache: string[];
}

/** Docker's four lists, and the build cache's record ids. */
async function dockerLists(): Promise<Lists> {
  const label = '{{.Label "com.docker.compose.project"}}';
  const [c, i, v, n, du] = await Promise.all([
    sh("docker", ["ps", "-a", "--format", `{{.Names}}\t${label}`]),
    sh("docker", ["image", "ls", "--all", "--no-trunc", "--format", "{{.Repository}}:{{.Tag}}\t{{.ID}}"]),
    sh("docker", ["volume", "ls", "--format", `{{.Name}}\t${label}`]),
    sh("docker", ["network", "ls", "--format", `{{.Name}}\t${label}`]),
    sh("docker", ["buildx", "du", "--verbose"]),
  ]);
  const pairs = (s: string) =>
    s
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => l.split("\t"))
      .map(([a, b]) => ({ name: (a ?? "").trim(), project: (b ?? "").trim() }));
  return {
    containers: pairs(c),
    images: pairs(i).map((p) => ({ ref: p.name, id: p.project })),
    volumes: pairs(v),
    networks: pairs(n),
    cache: [...du.matchAll(/^ID:\s+(\S+)$/gm)].map((m) => m[1]!),
  };
}

/** Docker's lists in J2's shape, and the machine's processes (rule N). */
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

/** The machine's processes with their parents: `ps -eo pid,ppid,args`. */
async function processesWithParents(): Promise<Array<{ pid: number; ppid: number; args: string }>> {
  const out = await sh("ps", ["-eo", "pid=,ppid=,args="]);
  return out
    .split("\n")
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3]! }));
}

/** What listens on a TCP port of this machine (IPv4), read from /proc/net/tcp: the local addresses. */
function listening(port: number): string[] {
  const out: string[] = [];
  for (const f of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text = "";
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4 || cols[3] !== "0A") continue;
      const [hexIp, hexPort] = (cols[1] ?? "").split(":");
      if (parseInt(hexPort ?? "", 16) !== port) continue;
      if (hexIp && hexIp.length === 8) out.push(`${[3, 2, 1, 0].map((k) => parseInt(hexIp.slice(k * 2, k * 2 + 2), 16)).join(".")}:${port}`);
      else out.push(`[ipv6]:${port}`);
    }
  }
  return [...new Set(out)];
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

/** One `docker buildx du --verbose` record per blank-line block, as key/value pairs. */
function cacheRecords(du: string): Array<Record<string, string>> {
  return du
    .split(/\n\s*\n/)
    .map((block) => {
      const r: Record<string, string> = {};
      for (const l of block.split("\n")) {
        const m = /^([A-Za-z ]+):\s*(.*)$/.exec(l);
        if (m) r[m[1]!.trim()] = m[2]!.trim();
      }
      return r;
    })
    .filter((r) => r.ID);
}

/** npm's cache mount, as Docker's build cache lists it: size, last used, usage count. */
async function npmCacheMount(): Promise<Array<Record<string, string>>> {
  const du = await sh("docker", ["buildx", "du", "--verbose"]);
  return cacheRecords(du).filter((r) => r.Type === "exec.cachemount" && (r.Description ?? "").includes(`with id "/${NPM_CACHE_ID}"`));
}

/** A GET or POST from the machine to http://localhost:<port>, as a browser would come (IPv4 localhost). Only the status is kept. */
function askLocal(o: { method: "GET" | "POST"; path: string; headers?: Record<string, string>; body?: string }): Promise<number | string> {
  return new Promise((ok) => {
    const req = http.request({ host: "localhost", family: 4, port: APP_PORT, method: o.method, path: o.path, headers: o.headers, timeout: 15_000 }, (res) => {
      res.resume();
      res.on("end", () => ok(res.statusCode ?? 0));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => ok(String((e as NodeJS.ErrnoException).code ?? e.message)));
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}

/* ------------------------------------------------------------------ the copy */

interface ComposeRow {
  Service?: string;
  State?: string;
  Health?: string;
  Name?: string;
  Publishers?: Array<{ URL?: string; TargetPort?: number; PublishedPort?: number; Protocol?: string }>;
}

async function composePs(dir: string): Promise<ComposeRow[]> {
  const out = await sh("docker", ["compose", "ps", "--all", "--format", "json"], { cwd: dir, env: personEnv() });
  return out ? out.split("\n").map((l) => JSON.parse(l) as ComposeRow) : [];
}

interface Started {
  child: ChildProcess;
  output: string[];
  ended: Promise<number | null>;
  done: boolean;
  t0: number;
}

/** A code block of the README, run exactly as a person runs it: `sh -c <block>`, in the folder, with only PATH and HOME. */
function startBlock(dir: string, block: string): Started {
  const child = spawn("sh", ["-c", block], { cwd: dir, env: personEnv(), stdio: ["ignore", "pipe", "pipe"] });
  const s: Started = { child, output: [], ended: Promise.resolve(null), done: false, t0: Date.now() };
  const keep = (d: Buffer) => s.output.push(...d.toString("utf8").split("\n").filter((l) => l.trim() !== ""));
  child.stdout!.on("data", keep);
  child.stderr!.on("data", keep);
  s.ended = new Promise<number | null>((ok) => child.on("close", (code) => ok(code)));
  void s.ended.then(() => (s.done = true));
  return s;
}

/** Wait (up to 10 min) for `app` healthy and `door` running; null when reached, else why not. */
async function waitHealthy(dir: string, s: Started): Promise<string | null> {
  const until = Date.now() + 600_000;
  while (Date.now() < until) {
    if (s.done) return `the README's command ended before the app was healthy (exit code ${s.child.exitCode})`;
    const ps = await composePs(dir).catch(() => []);
    const app = ps.find((c) => c.Service === "app");
    const door = ps.find((c) => c.Service === "door");
    if (app?.State === "running" && app.Health === "healthy" && door?.State === "running") return null;
    await sleep(2000);
  }
  return "the app was not healthy after 10 minutes";
}

/** The steps of a build whose command runs `npm ci`, with every line of each (whether npm ran, or the layer was reused). */
function installLines(output: string[]): string[] {
  const steps = new Set(output.map((l) => /^(#\d+) .*npm ci/.exec(l.trim())?.[1]).filter((x): x is string => Boolean(x)));
  return output.filter((l) => steps.has(/^(#\d+) /.exec(l.trim())?.[1] ?? ""));
}

/** git in the unpacked copy, read-only: no hooks, no file-system monitor, no optional locks, no outside config. */
async function gitCopy(dir: string, args: string[]): Promise<string> {
  const env = { PATH: personEnv().PATH, HOME: process.env.HOME ?? "/root", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
  return (await run("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: dir, env, maxBuffer: 32 * 1024 * 1024 })).stdout;
}

/** Every file under the copy, relative, without its top `.git`; and anything that is not a file or a folder. */
function filesOf(dir: string): { files: string[]; other: string[] } {
  const files: string[] = [];
  const other: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && e.name === ".git") continue;
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) files.push(p);
      else other.push(p);
    }
  };
  walk("");
  return { files: files.sort(), other };
}

/**
 * The probe of "no way back to the machine": a short-lived approved Node container joined to `target`'s network
 * namespace tries each address and port, 3 s each, and prints what happened; a connection reads what the listener
 * says (the run's token), so that a connection to the run's own listener is told apart from any other.
 */
const PROBE_SCRIPT =
  "const n=require('net'),t=JSON.parse(process.argv[1]);let left=t.length;const out=[];" +
  "for(const [h,p] of t){const s=n.connect({host:h,port:p});let got='',done=false,up=false;const end=(r)=>{if(done)return;done=true;s.destroy();out.push({host:h,port:p,result:up?'connected':r,said:got.slice(0,64)});if(--left===0)console.log(JSON.stringify(out))};" +
  "s.setTimeout(3000,()=>end('timeout'));s.on('connect',()=>{up=true;setTimeout(()=>end('connected'),800)});s.on('data',(d)=>{got+=d});s.on('error',(e)=>end(e.code||e.message))}";

async function probeFrom(target: string, name: string, targets: Array<[string, number]>): Promise<Array<{ host: string; port: number; result: string; said: string }> | string> {
  const args = [
    "run", "--rm", "--name", name, "--pull", "never", "--network", `container:${target}`,
    ...HARDENING.cap_drop.flatMap((x) => ["--cap-drop", x]),
    ...HARDENING.security_opt.flatMap((x) => ["--security-opt", x]),
    "--pids-limit", String(HARDENING.pids_limit), "--memory", HARDENING.mem_limit,
    "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m", "--user", "node", "--entrypoint", "node",
    DEFAULT_IMAGES.node, "-e", PROBE_SCRIPT, JSON.stringify(targets),
  ];
  try {
    return JSON.parse((await sh("docker", args, { timeout: 120_000 })).split("\n").pop() ?? "") as Array<{ host: string; port: number; result: string; said: string }>;
  } catch (err) {
    return `the probe did not run (${(err as Error).message.split("\n")[0]})`;
  }
}

/* ------------------------------------------------------------------ the run */

async function main(): Promise<number> {
  mkdirSync(screensDir, { recursive: true });
  say(`Package 3.2's automated run, ${new Date().toISOString()} (run ${runId}).`);
  say(`Commit ${execFileSync("git", ["-C", builderDir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()}; builder tree ${execFileSync("git", ["-C", builderDir, "write-tree", "--prefix=builder/"], { encoding: "utf8" }).trim()} (git write-tree --prefix=builder/ of the index at the start); templates/next tree ${execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD:templates/next"], { encoding: "utf8" }).trim()}.`);

  /* ---------------------------------------------------------------- before */
  say("");
  say("== Before ==");
  const imageProblem = await runnerImageProblem(RUNNER_IMAGE, dockerEnv());
  if (imageProblem) {
    say(`Refused: ${imageProblem}. Nothing was started.`);
    return 2;
  }
  say(`The approved runner image ${RUNNER_IMAGE} is on the machine, labelled ${BROWSER_ZIP_LABEL} with the approved browser zip's fingerprint (runnerImageProblem); this run neither builds nor removes it.`);
  // This run's own evidence files, by their exact names, and its pictures, so that nothing of an earlier run is mixed in.
  for (const f of OWN_FILES) rmSync(join(evidence, f), { force: true });
  for (const f of readdirSync(screensDir)) if (/^\d{2}-[a-z0-9-]+-(en|ar|phone)\.png$/.test(f)) rmSync(join(screensDir, f), { force: true });
  for (const image of [DEFAULT_IMAGES.node, DEFAULT_IMAGES.postgres]) {
    const id = await sh("docker", ["image", "inspect", "--format", "{{.Id}}", image]).catch(() => "");
    if (!id) {
      say(`Refused: the approved image ${image} is not on this machine; the exported copy's start would download it. Nothing was started.`);
      return 2;
    }
  }
  say(`Free disk before: ${execFileSync("df", ["-h", "/"], { encoding: "utf8" }).trim().split("\n").pop()}`);
  const before = await dockerLists();
  say(`Docker's lists before: ${before.containers.length} containers, ${before.images.length} images, ${before.volumes.length} volumes, ${before.networks.length} networks; ${before.cache.length} build cache records.`);
  say(`Containers before (every one, running or not; others belong to other sessions): ${before.containers.map((c) => c.name).join(", ") || "(none)"}`);
  say(`Images before: ${before.images.map((i) => i.ref).join(", ")}`);
  say(`Volumes before: ${before.volumes.map((v) => v.name).join(", ") || "(none)"}`);
  say(`Networks before: ${before.networks.map((n) => n.name).join(", ")}`);
  const mine = (name: string) => name.includes(runId);
  count("Before", { name: "none of the run's own exact names (its cameras' and probes', which carry the run's id) exists at the start", ok: ![...before.containers, ...before.volumes, ...before.networks].some((x) => mine(x.name)) && !before.images.some((i) => mine(i.ref)), detail: "" });
  await waitFree(J1_BUILD_PROXY_PORT, "the image build's port of journey sandboxes; the owner's project may hold it");
  await waitFree(UI_PORT, "this run's interface");
  await waitFree(APP_PORT, "the exported app's door");
  say(`Ports ${UI_PORT}, ${APP_PORT} and ${J1_BUILD_PROXY_PORT} on 127.0.0.1 are free. The owner's interface on 4020 and the phone-test pages on 4032 and 4033 are not touched: listening now, 4020 ${listening(4020).join(" ") || "no"}, 4032 ${listening(4032).join(" ") || "no"}, 4033 ${listening(4033).join(" ") || "no"}.`);

  execFileSync("createdb", ["-h", "/var/run/postgresql", dbName]);
  const work = mkdtempSync(join(tmpdir(), "x32-demo-"));
  const dataDir = join(work, "data");
  const ifaceTmp = join(work, "tmp");
  const cameraOut = join(work, "camera-out");
  const secretDir = join(work, "secret");
  const kept = join(work, "kept");
  for (const d of [dataDir, ifaceTmp, cameraOut, secretDir, kept]) mkdirSync(d, { mode: 0o700 });
  const uiPassword = `x32-${randomBytes(18).toString("base64url")}`;
  const secretFile = join(secretDir, "ui-password");
  writeFileSync(secretFile, uiPassword, { mode: 0o400 });
  chownSync(cameraOut, RUNNER_UID, RUNNER_UID);
  chownSync(secretFile, RUNNER_UID, RUNNER_UID);
  say(`Fresh database ${dbName}; fresh data folder <run folder>/data; the interface's temporary folder (its sandbox folders) <run folder>/tmp; the camera's folder. A random interface password, given to the interface in its environment and to the builder camera as a read-only file (mode 0400); not printed or kept.`);
  const hide = (s: string) => s.split(work).join("<run folder>");

  const free = () => {
    const f = statfsSync(work);
    return Number(f.bavail) * Number(f.bsize);
  };
  const disk = { first: free(), lowest: free() };
  const diskSampler = setInterval(() => (disk.lowest = Math.min(disk.lowest, free())), 2000);

  let code = 1;
  const ifaceLog: string[] = [];
  const camLines: string[] = [];
  const camNames: string[] = [];
  let shotsWanted = 0;
  let shotsCopied = 0;
  let projectId = null as string | null;
  let ifaceProc: ChildProcess | null = null;
  let ifaceDone = false;
  let pool: ReturnType<typeof createPool> | null = createPool(dbUrl);
  let dbDropped = false;
  let copyDir = "";
  let copyName = "";
  let startA: Started | null = null;
  let startB: Started | null = null;
  const madeContainers: string[] = [];
  const secrets: Record<string, string> = { "the interface password": uiPassword };
  const composeOut: string[] = [];
  const npmLines: string[] = [];
  const times: Record<string, string> = {};
  let checkReading = null as Record<string, any> | null;
  let listenerLo: net.Server | null = null;
  let listenerAll: net.Server | null = null;
  const stop: Record<string, unknown> = {};

  /** One walk of a camera in the approved runner image; its checks are counted under `part`. */
  async function camera(part: string, o: { script: string; network: "host" | "none"; env: Record<string, string>; mounts: string[]; during?: () => Promise<void> }): Promise<{ code: number | null; lines: Array<Record<string, unknown>> }> {
    const name = `x32-camera-${runId}-${camNames.length + 1}`;
    camNames.push(name);
    const args = [
      "run", "--rm", "--name", name, "--pull", "never", "--network", o.network,
      "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", "256", "--memory", "1g",
      "--user", "runner", "--workdir", "/runner", "--entrypoint", "node",
      ...Object.entries(o.env).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
      "--volume", `${join(builderDir, "camera", o.script)}:/camera/${o.script}:ro`,
      "--volume", `${cameraOut}:/shots`,
      ...o.mounts.flatMap((m) => ["--volume", m]),
      RUNNER_IMAGE, `/camera/${o.script}`,
    ];
    say(`${part}: the camera ${o.script}: docker ${hide(args.join(" "))}`);
    const t0 = Date.now();
    const cam = spawn("docker", args, { env: dockerEnv(), stdio: ["ignore", "pipe", "pipe"] });
    const parsed: Array<Record<string, unknown>> = [];
    let buf = "";
    let badId = "";
    cam.stdout!.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const l of parts.filter(Boolean)) {
        camLines.push(l);
        let x: Record<string, unknown>;
        try {
          x = JSON.parse(l) as Record<string, unknown>;
        } catch {
          say(`  camera (not JSON): ${l.slice(0, 200)}`);
          continue;
        }
        parsed.push(x);
        if (x.kind === "check") count(`${part}, camera`, { name: String(x.name), ok: x.ok === true, detail: x.ok === true ? "" : String(x.detail ?? "") });
        else if (x.kind === "project") {
          if (!/^j1-[0-9a-f]{12}$/.test(String(x.id))) badId = String(x.id).slice(0, 80);
          else {
            projectId = String(x.id);
            say(`  project ${projectId}: ${String(x.name)}, cap $${String(x.cap)}`);
          }
        } else if (x.kind === "shot") shotsWanted++;
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
    const side = o.during
      ? (async () => {
          while (!stopDuring) {
            await o.during!().catch(() => undefined);
            await sleep(1000);
          }
        })()
      : Promise.resolve();
    const c = await ended;
    stopDuring = true;
    await side;
    if (badId) throw new Error(`the builder camera named a project whose id is not a journey id: ${badId}`);
    say(`${part}: the camera ended with exit code ${c} after ${Math.round((Date.now() - t0) / 1000)} s.${camErr.trim() ? ` Its error output (end): ${camErr.trim().split("\n").slice(-3).join(" | ")}` : ""}`);
    count(part, { name: `the camera (${o.script}) exited with code 0`, ok: c === 0, detail: `exit code ${c}` });
    for (const x of parsed.filter((y) => y.kind === "shot")) {
      const file = String(x.file);
      if (!/^\d{2}-[a-z0-9-]+-(en|ar|phone)\.png$/.test(file)) continue;
      const b = readPng(join(cameraOut, file));
      if (!b) {
        say(`  screenshot ${file}: not a plain PNG; not copied`);
        continue;
      }
      writeFileSync(join(screensDir, file), b);
      shotsCopied++;
    }
    return { code: c, lines: parsed };
  }

  try {
    /* ---------------------------------------------------------------- A */
    say("");
    say("== A. With the builder running ==");
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: ifaceTmp,
      BUILDER_DATABASE_URL: dbUrl,
      BUILDER_DATA_DIR: dataDir,
      BUILDER_UI_PASSWORD: uiPassword,
      BUILDER_UI_PORT: String(UI_PORT),
      BUILDER_LIVE_PREVIEW: "0",
      NO_COLOR: "1",
    };
    // The sandbox's machine side goes out only through the session's proxy (package 0.6c).
    for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "DOCKER_HOST"]) if (process.env[k]) env[k] = process.env[k];
    count("A", { name: "the interface's environment holds no model key and no gateway setting (a scripted run calls no model)", ok: !Object.keys(env).some((k) => /MODEL|GATEWAY|ANTHROPIC|VIBEBUILD/.test(k)), detail: Object.keys(env).sort().join(", ") });
    const proc = spawn(process.execPath, ["--import", "tsx", "src/web/main.ts"], { cwd: builderDir, env, stdio: ["ignore", "pipe", "pipe"] });
    ifaceProc = proc;
    const ifaceExited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((ok) => proc.on("exit", (c, s) => ok({ code: c, signal: s })));
    void ifaceExited.then(() => (ifaceDone = true));
    const started = await new Promise<boolean>((ok) => {
      const onData = (d: Buffer) => {
        for (const l of d.toString("utf8").split("\n").filter(Boolean)) {
          ifaceLog.push(l);
          if (l.startsWith("Interface listening on")) ok(true);
        }
      };
      proc.stdout!.on("data", onData);
      proc.stderr!.on("data", onData);
      void ifaceExited.then(() => ok(false));
      setTimeout(() => ok(false), 90_000).unref();
    });
    times.ifaceStarted = iso(Date.now());
    say(`The interface (node --import tsx src/web/main.ts): process ${proc.pid}, ${started ? "listening" : "NOT started"}. Its lines: ${hide(ifaceLog.join(" | "))}`);
    if (!count("A", { name: `the interface listens on 127.0.0.1:${UI_PORT}, the live preview off`, ok: started && ifaceLog.some((l) => l.startsWith(`Interface listening on http://127.0.0.1:${UI_PORT} `)) && ifaceLog.some((l) => l.startsWith("Live preview: off")), detail: hide(ifaceLog.join(" | ")) })) return 1;

    // The builder camera; Docker's list of the project's containers, every second while it walks (package 0.6c).
    const seen = new Map<string, { networks: string; ports: string }>();
    await camera("A", {
      script: "builder-shots.mjs",
      network: "host",
      env: { BUILDER_CAMERA_BASE: `http://127.0.0.1:${UI_PORT}`, BUILDER_CAMERA_WALK: "x32" },
      mounts: [`${secretFile}:/run/secrets/ui-password:ro`],
      during: async () => {
        if (!projectId) return;
        const out = await sh("docker", ["ps", "--format", "{{.Names}}\t{{.Networks}}\t{{.Ports}}"]);
        for (const [name, networks, ports] of out.split("\n").map((l) => l.split("\t"))) {
          if ((name ?? "").startsWith(`builder_${projectId}-`)) seen.set(name!, { networks: (networks ?? "").split(",").filter(Boolean).sort().join(","), ports: ports ?? "" });
        }
      },
    });
    if (!projectId) {
      count("A", { name: "the camera made the project", ok: false, detail: "" });
      return 1;
    }
    const id: string = projectId;
    copyName = id;
    count("Before", {
      name: `nothing named builder_${id} or ${id} (the project's sandbox, the export check's images, the exported copy's Compose project) existed at the start`,
      ok: ![...before.containers, ...before.volumes, ...before.networks].some((x) => x.name.includes(id) || x.project.includes(id)) && !before.images.some((i) => i.ref.includes(id)),
      detail: "",
    });
    say(`A: the project's containers Docker listed while the camera walked (every second; name [networks], ports if any): ${seen.size}`);
    for (const [name, v] of seen) say(`  ${name} [${v.networks}]${v.ports ? ` ports: ${v.ports}` : ""}`);
    for (const c of networkChecks(seen)) count("A, J1's network checks on the sandbox's containers (0.6c)", c);

    // The event, and the archive downloaded in the browser against it.
    const ev = await pool.query<{ id: string; at: Date; kind: string; step: string | null; payload: Record<string, any> }>("select id::text as id, at, kind, step, payload from events where project_id = $1 order by events.id", [id]);
    const exp = ev.rows.filter((e) => e.kind === "journey.export.written");
    const signed = ev.rows.filter((e) => e.kind === "journey.signed_off").at(-1);
    const passingRun = signed ? String(signed.payload.acceptance_run ?? "") : "";
    const finished = ev.rows.find((e) => e.kind === "acceptance.run.finished" && e.payload.run_id === passingRun);
    count("A, the event", { name: "exactly one journey.export.written", ok: exp.length === 1, detail: `${exp.length}` });
    const p = (exp[0]?.payload ?? {}) as Record<string, any>;
    count("A, the event", { name: "it records the project's id", ok: p.project_id === id, detail: String(p.project_id) });
    count("A, the event", { name: "it records the version's manifest SHA-256, the one the passing run recorded", ok: /^[0-9a-f]{64}$/.test(String(p.manifest_sha256)) && finished?.payload.manifest_sha256 === p.manifest_sha256, detail: `${p.manifest_sha256} / run's ${finished?.payload.manifest_sha256}` });
    count("A, the event", { name: "it records the version's items with their fingerprints (item 1, item-01.spec.ts)", ok: Array.isArray(p.items) && p.items.length === 1 && p.items[0].number === 1 && p.items[0].file === "item-01.spec.ts" && /^[0-9a-f]{64}$/.test(String(p.items[0].sha256)), detail: JSON.stringify(p.items) });
    count("A, the event", { name: "it records the checklist count, 6", ok: p.checklist_items === 6, detail: String(p.checklist_items) });
    count("A, the event", { name: "it records the passing run's id, the one the sign-off names, whose outcome is passed", ok: typeof p.acceptance_run === "string" && p.acceptance_run === passingRun && finished?.payload.outcome === "passed", detail: `${p.acceptance_run} / signed off ${passingRun} / ${finished?.payload.outcome}` });
    const checks = (Array.isArray(p.export_checks) ? p.export_checks : []) as ExportCheck[];
    count("A, the event", { name: "it records the export's checks, items 1 to 7, in order, each passed", ok: JSON.stringify(checks.map((c) => [c.id, c.passed])) === JSON.stringify(EXPORT_CHECK_IDS.map((x) => [x, true])), detail: JSON.stringify(checks.map((c) => [c.id, c.passed])) });
    for (const c of checks) say(`  export check ${c.id}: ${c.passed ? "passed" : "NOT passed"}: ${c.summary}`);
    count("A, the event", { name: 'it records the README\'s command, "docker compose up --build"', ok: p.readme_command === "docker compose up --build", detail: String(p.readme_command) });
    const downloaded = join(cameraOut, "export.tar.gz");
    const body = readPlain(downloaded, 200 * 1024 * 1024);
    const dsha = body ? sha256(body) : "";
    say(`A: the archive downloaded by the camera: ${body ? `${body.length} bytes, SHA-256 ${dsha}` : "not there"}; the event records ${p.file?.sha256}.`);
    count("A", { name: "the downloaded archive's SHA-256 equals the event's", ok: body !== null && dsha === p.file?.sha256, detail: `${dsha} / ${p.file?.sha256}` });
    const placed = typeof p.file?.path === "string" ? readPlain(p.file.path, 200 * 1024 * 1024) : null;
    count("A", { name: "the archive the event names, in the data folder, is the same file", ok: placed !== null && sha256(placed) === p.file?.sha256, detail: hide(String(p.file?.path)) });
    if (body) {
      const listing = execFileSync("tar", ["-tzvf", downloaded], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      writeFileSync(join(evidence, "export-contents.txt"), `The export downloaded by the builder camera in package 3.2's automated run (run ${runId}): ${p.file?.path ? String(p.file.path).split("/").pop() : ""}, ${body.length} bytes, SHA-256 ${dsha}. Its contents, as tar lists them (tar -tzvf):\n\n${listing}`);
    }

    /* ---------------------------------------------------------------- B */
    say("");
    say("== B. The builder stopped ==");
    const evAll = async () => (await pool!.query<{ id: string; project_id: string; at: Date; kind: string; step: string | null; payload: Record<string, unknown> }>("select id::text as id, project_id, at, kind, step, payload from events order by events.id")).rows;
    const writeEvents = (rows: Awaited<ReturnType<typeof evAll>>, note: string) => {
      const text = JSON.stringify({ run: runId, database: dbName, note, events: rows.map((e) => ({ ...e, at: e.at.toISOString() })) }, null, 1);
      if (text.includes(uiPassword)) throw new Error("the events would hold the interface's password; they are not written");
      writeFileSync(join(evidence, "events.json"), hide(text) + "\n");
      copyFileSync(join(evidence, "events.json"), join(kept, "events.json"));
    };
    const rows1 = await evAll();
    writeEvents(rows1, "Every event of the run's database, in id order, saved before the interface was stopped. Made-up data only. Paths are of this machine's run folder, removed after the run.");
    say(`B: events saved to events.json before the stop: ${rows1.length}.`);
    copyFileSync(downloaded, join(kept, "export.tar.gz"));
    say("B: the downloaded archive copied out of the camera's folder, to <run folder>/kept/export.tar.gz.");
    const pid = proc.pid!;
    const t0 = Date.now();
    times.builderSigterm = iso(t0);
    const from = ifaceLog.length;
    process.kill(pid, "SIGTERM");
    const r = await Promise.race([ifaceExited, bound(120_000)]);
    if (r) await sleep(300);
    times.builderStopped = iso(Date.now());
    const after = ifaceLog.slice(from);
    stop.pid = pid;
    stop.exit = r;
    stop.seconds = (Date.now() - t0) / 1000;
    say(`B: SIGTERM to process ${pid} (the interface itself): ${r ? `exited after ${((Date.now() - t0) / 1000).toFixed(1)} s with code ${r.code}${r.signal ? `, signal ${r.signal}` : ""}` : "NOT exited within 120 s"}. Its lines after the signal: ${hide(after.join(" | "))}`);
    count("B", { name: "the interface exits with code 0 within 120 s of SIGTERM", ok: r !== null && r.code === 0, detail: r ? `code ${r.code}` : "not exited" });
    count("B", { name: `the interface says "${STOP_LINE} 0." (the project is closed)`, ok: after.includes(`${STOP_LINE} 0.`), detail: after.filter((l) => l.startsWith(STOP_LINE)).join(" | ") || "no such line" });
    count("B", { name: "the interface's own last line gives exit code 0", ok: after.at(-1) === "[interface stopped] Lock released. Exit code 0.", detail: after.at(-1) ?? "no line" });
    // 1.
    count("B.1", { name: `the interface's process ${pid}, recorded at its start, has exited`, ok: ifaceDone && proc.exitCode !== null, detail: `exit code ${proc.exitCode}` });
    count("B.1", { name: `nothing listens on 127.0.0.1:${UI_PORT}`, ok: (await portFree(UI_PORT)) && listening(UI_PORT).length === 0, detail: listening(UI_PORT).join(" ") });
    // 2.
    const procs = await processesWithParents();
    const naming = procs.filter((x) => x.pid !== process.pid && (x.args.includes(dataDir) || x.args.includes(ifaceTmp) || x.args.includes(dbName) || x.ppid === pid || new RegExp(`(^|[\\s=:,/])${pid}($|[\\s,/])`).test(x.args)));
    count("B.2", { name: "no process on the machine has the run's data folder, its sandbox folder, its database's name or the interface's process id in its command line, or the interface as its parent (ps)", ok: naming.length === 0, detail: hide(naming.map((x) => `${x.pid} ${x.args}`).join("; ")) || `${procs.length} processes read` });
    // 3.
    const sandboxDirs = rows1.filter((e) => e.kind === "journey.sandbox.made").map((e) => String(e.payload.dir ?? "")).filter(Boolean);
    const m = await machine();
    const left = projectLeftovers(id, m.seen, m.procs, { path: sandboxDirs.at(-1) ?? null, exists: sandboxDirs.some((d) => existsSync(d)) });
    count("B.3", { name: `Docker holds nothing of the project by J2's rule N: no container, volume, network or image of builder_${id}, no process naming it, its sandbox folder gone`, ok: left.length === 0, detail: hide(left.join("; ")) });
    const checkImgs = m.seen.images.filter((i) => i.repository.startsWith(`builder_${id}-exportcheck-`));
    count("B.3", { name: `no builder_${id}-exportcheck-* image`, ok: checkImgs.length === 0, detail: checkImgs.map((i) => `${i.repository}:${i.tag}`).join(", ") });
    // 4.
    stop.gateway = listening(GATEWAY_PORT);
    say(`B.4: the run never started a gateway (no model key or gateway setting was given to its interface; a scripted run calls no model). What listens on ${GATEWAY_PORT}, recorded, not touched: ${listening(GATEWAY_PORT).join(" ") || "nothing"}.`);
    const gw = procs.filter((x) => (x.ppid === pid || x.ppid === process.pid) && /gateway/i.test(x.args));
    count("B.4", { name: "the run started no gateway: no process whose command line names a gateway is a child of the run or of its interface", ok: gw.length === 0, detail: gw.map((x) => `${x.pid} ${x.args}`).join("; ") });
    // 5.
    const rows2 = await evAll();
    if (rows2.length !== rows1.length) {
      writeEvents(rows2, `Every event of the run's database, in id order: ${rows1.length} saved before the interface was stopped, and ${rows2.length - rows1.length} written during its stop, saved after it. Made-up data only. Paths are of this machine's run folder, removed after the run.`);
      say(`B.5: ${rows2.length - rows1.length} events written during the stop were added to events.json (${rows2.length} in all).`);
    } else say(`B.5: no event was written during the stop; events.json holds the ${rows1.length} saved before it.`);
    await pool.end();
    pool = null;
    execFileSync("dropdb", ["-h", "/var/run/postgresql", "--if-exists", dbName]);
    dbDropped = true;
    times.dbDropped = iso(Date.now());
    const dbLeft = execFileSync("psql", ["-h", "/var/run/postgresql", "-d", "postgres", "-Atc", `select count(*) from pg_database where datname = '${dbName}'`], { encoding: "utf8" }).trim();
    count("B.5", { name: `the run's database ${dbName} is dropped`, ok: dbLeft === "0", detail: dbLeft });
    count("B.5", { name: "the archive and the events were copied out before the data folder was deleted", ok: existsSync(join(kept, "export.tar.gz")) && existsSync(join(kept, "events.json")) && sha256(readFileSync(join(kept, "export.tar.gz"))) === p.file?.sha256, detail: "" });
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(ifaceTmp, { recursive: true, force: true });
    times.dataDeleted = iso(Date.now());
    count("B.5", { name: "the run's data folder (the acceptance store, the exports folder) and its sandbox folders are deleted", ok: !existsSync(dataDir) && !existsSync(ifaceTmp), detail: "" });
    const ids = (await sh("docker", ["ps", "-a", "-q", "--no-trunc"])).split("\n").filter(Boolean);
    const inspected = ids.length ? (JSON.parse(await sh("docker", ["inspect", ...ids])) as Array<{ Name?: string; Mounts?: Array<{ Source?: string }> }>) : [];
    const mounting = inspected.filter((c) => (c.Mounts ?? []).some((mt) => (mt.Source ?? "").startsWith(dataDir) || (mt.Source ?? "").startsWith(ifaceTmp)));
    count("B.5", { name: "docker ps -a with docker inspect: no container mounts any path under the data folder or the sandbox folders", ok: mounting.length === 0, detail: mounting.map((c) => c.Name).join(", ") || `${inspected.length} containers inspected` });
    // 6.
    stop.owner = Object.fromEntries(OWNER_PORTS.map((x) => [x, listening(x)]));
    say(`B.6: listening, recorded, not touched: 4020 ${listening(4020).join(" ") || "no"}; 4032 ${listening(4032).join(" ") || "no"}; 4033 ${listening(4033).join(" ") || "no"}.`);
    // 7.
    const cm = await npmCacheMount();
    say(`B.7: what the builder leaves that the copy's start will use: npm's cache mount (docker buildx du --verbose): ${cm.map((x) => `id ${x.ID}, size ${x.Size}, last used ${x["Last used"]}, usage count ${x["Usage count"]}, created ${x["Created at"]}`).join("; ") || "NOT FOUND"}.`);
    for (const image of [DEFAULT_IMAGES.node, DEFAULT_IMAGES.postgres]) say(`B.7: the base image ${image}: id ${await sh("docker", ["image", "inspect", "--format", "{{.Id}}", image])}.`);
    say("B.7: the builder's own built steps are not reused by the copy's build, which runs on another network (design section 1); its install step may be taken from an earlier layer built on Docker's default network (design section 13, C14).");
    count("B.7", { name: "npm's cache mount is recorded", ok: cm.length >= 1, detail: `${cm.length}` });

    /* ---------------------------------------------------------------- C */
    say("");
    say("== C. The export, alone ==");
    const delivered = join(work, "delivered");
    mkdirSync(delivered, { mode: 0o700 });
    copyFileSync(join(kept, "export.tar.gz"), join(delivered, "export.tar.gz"));
    count("C", { name: "the archive copied into a fresh <run folder>/delivered/ has the event's SHA-256", ok: sha256(readFileSync(join(delivered, "export.tar.gz"))) === p.file?.sha256, detail: "" });
    execFileSync("tar", ["--extract", "--gzip", "--file", join(delivered, "export.tar.gz"), "--directory", delivered, "--no-same-owner"], { env: { PATH: personEnv().PATH, LC_ALL: "C" } });
    rmSync(join(delivered, "export.tar.gz"));
    copyDir = join(delivered, id);
    count("C", { name: `the archive unpacks to one folder, named ${id}`, ok: JSON.stringify(readdirSync(delivered)) === JSON.stringify([id]) && lstatSync(copyDir).isDirectory(), detail: readdirSync(delivered).join(", ") });
    const fpUnpacked = copyFingerprints(copyDir);
    // The history.
    const head = (await gitCopy(copyDir, ["rev-parse", "HEAD"])).trim();
    const parent = (await gitCopy(copyDir, ["rev-parse", "HEAD^"])).trim();
    const commits = (await gitCopy(copyDir, ["rev-list", "--all"])).split("\n").filter(Boolean);
    const withAcceptance: string[] = [];
    for (const c of commits) if ((await gitCopy(copyDir, ["ls-tree", "--name-only", c, "acceptance"])).trim()) withAcceptance.push(c);
    count("C, the history", { name: "its last commit is the event's export commit, and its parent the event's workspace head", ok: head === p.export_commit && parent === p.workspace_head, detail: `${head} / ${parent}` });
    count("C, the history", { name: "acceptance/ first appears in the last commit: no other commit of any branch holds it", ok: withAcceptance.length === 1 && withAcceptance[0] === head, detail: `${commits.length} commits; with acceptance/: ${withAcceptance.join(", ")}` });
    count("C, the history", { name: `the copy holds ${p.commits} commits, as the event records`, ok: Number(p.commits) === Number((await gitCopy(copyDir, ["rev-list", "--count", "HEAD"])).trim()), detail: "" });
    const status0 = await gitCopy(copyDir, ["status", "--porcelain", "--ignored"]);
    count("C, the history", { name: "git status --porcelain --ignored is empty", ok: status0 === "", detail: status0.slice(0, 300) });
    // Before the start.
    const { files, other } = filesOf(copyDir);
    const listed = (Array.isArray(p.paths) ? (p.paths as string[]) : []).slice().sort();
    count("C, before the start", { name: `the folder holds exactly the files the event lists (${listed.length})`, ok: other.length === 0 && JSON.stringify(files) === JSON.stringify(listed), detail: `${files.length} files; not listed: ${files.filter((f) => !listed.includes(f)).join(", ") || "none"}; listed, missing: ${listed.filter((f) => !files.includes(f)).join(", ") || "none"}; neither file nor folder: ${other.join(", ") || "none"}` });
    for (const f of START_FILES) count("C, before the start", { name: `${f} is byte-equal to the builder's own template copy`, ok: sha256(readFileSync(join(copyDir, f))) === sha256(readFileSync(join(TEMPLATE_DIR, f))), detail: "" });
    const s29 = files.filter((f) => readWithoutBeingTold(f));
    count("C, before the start", { name: "none of S29's names is present (override files, other main files, other .dockerignore files)", ok: s29.length === 0, detail: s29.join(", ") });
    const s30 = await composeConfigCheck(copyDir, mkdtempSync(join(work, "s30-")));
    count("C, before the start", { name: "S30: what Compose reads from the copy, with only PATH and HOME set, equals what it reads from the template's compose.yaml alone", ok: s30.passed, detail: s30.summary });
    const theirs = [...before.containers, ...before.volumes, ...before.networks].filter((x) => x.project === id || x.name.startsWith(`${id}-`) || x.name.startsWith(`${id}_`));
    const nowLists = await dockerLists();
    const existing = [...nowLists.containers, ...nowLists.volumes, ...nowLists.networks].filter((x) => x.project === id || x.name.startsWith(`${id}-`) || x.name.startsWith(`${id}_`)).map((x) => x.name);
    const existingImages = nowLists.images.filter((i) => i.ref.startsWith(`${id}-`)).map((i) => i.ref);
    count("C, before the start", { name: `nothing of the copy's own names (Compose project ${id}: its containers, volumes, networks and images) exists when they are made`, ok: theirs.length === 0 && existing.length === 0 && existingImages.length === 0, detail: [...existing, ...existingImages].join(", ") });
    // The README's "Start it" block, run exactly, with only PATH and HOME.
    const readme = readFileSync(join(copyDir, "README.md"), "utf8");
    const block = startItCommand(readme);
    say(`C: the code block under the README's "Start it" heading: ${JSON.stringify(block)}. Run as sh -c <block>, in <run folder>/delivered/${id}, with only PATH (${personEnv().PATH}) and HOME set.`);
    if (!count("C", { name: 'the README\'s "Start it" section holds one code block, "docker compose up --build"', ok: block === "docker compose up --build", detail: String(block) })) return 1;
    times.appStarted = iso(Date.now());
    startA = startBlock(copyDir, block!);
    const waitA = await waitHealthy(copyDir, startA);
    times.appHealthy = iso(Date.now());
    composeOut.push(`== The first start: sh -c "${block}" in the unpacked copy, with only PATH and HOME set; started ${times.appStarted}; the app healthy ${waitA ? "NOT reached" : times.appHealthy} ==`, ...startA.output);
    say(`C: the first start: ${waitA ?? `the app healthy and the door running after ${Math.round((Date.parse(times.appHealthy) - Date.parse(times.appStarted)) / 1000)} s`}.`);
    if (!count("C", { name: "the app is healthy (docker compose ps) within 10 minutes, the door running", ok: waitA === null, detail: waitA ?? "" })) return 1;
    const inst1 = installLines(startA.output);
    npmLines.push(`== The first start (${times.appStarted}): every line of the build steps that run npm ci ==`, ...inst1);
    for (const l of inst1) say(`  install step | ${l.slice(0, 300)}`);
    const npmRan = inst1.some((l) => /added \d+ packages/.test(l));
    const npmCached = inst1.some((l) => /^#\d+ CACHED$/.test(l.trim()));
    count("C", { name: "the build's lines for the install step are kept, and say whether npm ran or the step was taken from an earlier layer", ok: inst1.length > 0 && (npmRan || npmCached), detail: npmRan ? "npm ran" : npmCached ? "taken from an earlier layer (CACHED)" : "neither seen" });
    const cmAfter = await npmCacheMount();
    say(`C: npm's cache mount after the first start: ${cmAfter.map((x) => `size ${x.Size}, last used ${x["Last used"]}, usage count ${x["Usage count"]}`).join("; ") || "not found"}.`);
    npmLines.push(`npm's cache mount before the start (B.7): ${cm.map((x) => `id ${x.ID}, size ${x.Size}, last used ${x["Last used"]}, usage count ${x["Usage count"]}, created ${x["Created at"]}`).join("; ")}`, `npm's cache mount after the first start: ${cmAfter.map((x) => `id ${x.ID}, size ${x.Size}, last used ${x["Last used"]}, usage count ${x["Usage count"]}`).join("; ")}`);
    // What runs.
    const ps1 = await composePs(copyDir);
    const imgIds = Object.fromEntries(await Promise.all([`${id}-app`, `${id}-setup`].map(async (n) => [n, await sh("docker", ["image", "inspect", "--format", "{{.Id}}", n]).catch(() => "")] as const)));
    say(`C: the images the copy's command built: ${Object.entries(imgIds).map(([n, i]) => `${n} ${i}`).join("; ")}.`);
    count("C", { name: `the copy's command built ${id}-app and ${id}-setup`, ok: Object.values(imgIds).every((x) => /^sha256:[0-9a-f]{64}$/.test(x)), detail: "" });
    const contInfo = JSON.parse(await sh("docker", ["inspect", ...ps1.map((c) => c.Name!).filter(Boolean)])) as Array<{ Name: string; Id: string; State?: { Status?: string }; NetworkSettings?: { Networks?: Record<string, { Gateway?: string }> } }>;
    for (const c of contInfo) say(`C: container ${c.Name.replace(/^\//, "")} (${c.State?.Status}): networks ${Object.keys(c.NetworkSettings?.Networks ?? {}).sort().join(", ")}`);
    const pub = ps1.flatMap((c) => (c.Publishers ?? []).filter((x) => x.PublishedPort).map((x) => ({ service: c.Service, url: x.URL, target: x.TargetPort, published: x.PublishedPort, protocol: x.Protocol })));
    say(`C: published ports: ${JSON.stringify(pub)}.`);
    count("C", { name: "one published port: the door's, on 127.0.0.1:3000", ok: JSON.stringify(pub) === JSON.stringify([{ service: "door", url: "127.0.0.1", target: 3000, published: APP_PORT, protocol: "tcp" }]), detail: JSON.stringify(pub) });
    const netsOf = (svc: string) => Object.keys(contInfo.find((c) => c.Name === `/${id}-${svc}-1`)?.NetworkSettings?.Networks ?? {}).sort().join(",");
    count("C", { name: "the app on the data and front networks alone; the database on data alone; the door on front and edge", ok: netsOf("app") === `${id}_data,${id}_front` && netsOf("db") === `${id}_data` && netsOf("door") === `${id}_edge,${id}_front`, detail: `app ${netsOf("app")}; db ${netsOf("db")}; door ${netsOf("door")}` });

    // The person's way in.
    const usersBlock = (() => {
      const at = readme.indexOf("\n## The made-up users\n");
      const rest = at < 0 ? "" : readme.slice(at + 1);
      const next = rest.indexOf("\n## ", 3);
      const section = next < 0 ? rest : rest.slice(0, next);
      const blocks = [...section.matchAll(/^```[^\n]*\n([\s\S]*?)^```$/gm)].map((x) => x[1]!.trim());
      return blocks.length === 1 ? blocks[0]! : null;
    })();
    count("C, the person's way in", { name: "the README shows how to see the sample password: one code block, docker compose run --rm --no-deps keys cat /keys/sample_password", ok: usersBlock === "docker compose run --rm --no-deps keys cat /keys/sample_password", detail: String(usersBlock) });
    const readKey = async (cmd: string) => (await run("sh", ["-c", cmd], { cwd: copyDir, env: personEnv(), maxBuffer: 1024 * 1024, timeout: 120_000 })).stdout.trim();
    const sample = usersBlock ? await readKey(usersBlock).catch(() => "") : "";
    secrets["the sample password"] = sample;
    count("C, the person's way in", { name: "the sample password is read with the README's own command, into memory only (not printed or written)", ok: /^Sample-[A-Za-z0-9_-]{16}$/.test(sample), detail: `${sample.length} characters` });
    const db = await readKey("docker compose run --rm --no-deps keys cat /keys/db_password").catch(() => "");
    const auth = await readKey("docker compose run --rm --no-deps keys cat /keys/auth_secret").catch(() => "");
    secrets["the exported app's db_password"] = db;
    secrets["the exported app's auth_secret"] = auth;
    count("C, the person's way in", { name: "db_password and auth_secret read from the keys volume with the README's kind of command, into memory only, for the evidence search", ok: /^[A-Za-z0-9_-]{24}$/.test(db) && /^[A-Za-z0-9_-]{43}$/.test(auth), detail: `${db.length} and ${auth.length} characters` });
    const page = await askLocal({ method: "GET", path: "/en/sign-in" });
    count("C, the person's way in", { name: "the sign-in page at http://localhost:3000 answers 200", ok: page === 200, detail: String(page) });
    const signIn = (origin: string) => askLocal({ method: "POST", path: "/api/auth/sign-in/email", headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(JSON.stringify({ email: USERS[0], password: sample }))), origin }, body: JSON.stringify({ email: USERS[0], password: sample }) });
    const good = await signIn(`http://localhost:${APP_PORT}`);
    const bad = await signIn(`http://127.0.0.1:${APP_PORT}`);
    count("C, the person's way in", { name: `sign-in as ${USERS[0]} with the origin http://localhost:3000 answers 200`, ok: good === 200, detail: String(good) });
    count("C, the person's way in", { name: "the same sign-in with the origin http://127.0.0.1:3000 answers 403", ok: bad === 403, detail: String(bad) });

    // No way back to the machine: a listener of the run's own, on 127.0.0.1 and on every address.
    const token = `x32-listener-${randomBytes(6).toString("hex")}`;
    const listen = (host: string) =>
      new Promise<net.Server>((ok, no) => {
        const srv = net.createServer((c) => c.end(`${token}\n`));
        srv.once("error", no);
        srv.listen(0, host, () => ok(srv));
      });
    listenerLo = await listen("127.0.0.1");
    listenerAll = await listen("0.0.0.0");
    const portLo = (listenerLo.address() as net.AddressInfo).port;
    const portAll = (listenerAll.address() as net.AddressInfo).port;
    say(`C, no way back: the run's own listeners on the machine: 127.0.0.1:${portLo} and 0.0.0.0:${portAll} (every address); each answers a connection with the run's token.`);
    const bridgeGw = (await sh("docker", ["network", "inspect", "bridge", "--format", "{{range .IPAM.Config}}{{.Gateway}} {{end}}"])).trim().split(/\s+/).filter(Boolean);
    const gwOf = async (netName: string) => (await sh("docker", ["network", "inspect", netName, "--format", "{{range .IPAM.Config}}{{.Gateway}} {{end}}"])).trim().split(/\s+/).filter(Boolean);
    const probeTag = randomBytes(3).toString("hex");
    for (const svc of ["app", "door"]) {
      const c = contInfo.find((x) => x.Name === `/${id}-${svc}-1`);
      if (!c) {
        count("C, no way back", { name: `the ${svc} container was found`, ok: false, detail: "" });
        continue;
      }
      const addresses: Array<{ host: string; what: string }> = [{ host: "127.0.0.1", what: "127.0.0.1" }];
      for (const n of Object.keys(c.NetworkSettings?.Networks ?? {}).sort()) for (const g of await gwOf(n)) addresses.push({ host: g, what: `the gateway address of ${n}` });
      for (const g of bridgeGw) addresses.push({ host: g, what: "Docker's default bridge address" });
      const targets: Array<[string, number]> = addresses.flatMap((a) => [[a.host, portLo] as [string, number], [a.host, portAll] as [string, number]]);
      // A control first: from this namespace a connection that should work does (the app on its own port).
      const control: [string, number] = svc === "app" ? ["127.0.0.1", 3000] : ["app", 3000];
      const name = `x32-probe-${runId}-${svc}-${probeTag}`;
      madeContainers.push(name);
      const res = await probeFrom(c.Id, name, [control, ...targets]);
      if (typeof res === "string") {
        count("C, no way back", { name: `the probe ran in the ${svc}'s network namespace`, ok: false, detail: res });
        continue;
      }
      say(`C, no way back, from the ${svc}'s namespace (a short-lived approved node container joined to it): ${JSON.stringify(res.map((x) => ({ host: x.host, port: x.port, result: x.result, run_token: x.said.trim() === token })))}`);
      const ctl = res.find((x) => x.host === control[0] && x.port === control[1]);
      count("C, no way back", { name: `control: from the ${svc}'s namespace, ${control[0]}:${control[1]} (the app) can be reached, so a failed connection below is not the probe's fault`, ok: ctl?.result === "connected", detail: ctl?.result ?? "no result" });
      for (const a of addresses) {
        for (const [port, which] of [[portLo, "127.0.0.1"], [portAll, "every address"]] as const) {
          const x = res.find((y) => y.host === a.host && y.port === port);
          count("C, no way back", { name: `from the ${svc}'s namespace, ${a.host}:${port} (${a.what}; the run's listener on ${which}) cannot be reached`, ok: x !== undefined && x.result !== "connected", detail: x ? `${x.result}${x.said.trim() === token ? ", the run's own listener answered" : ""}` : "no result" });
        }
      }
    }
    listenerLo.close();
    listenerAll.close();
    listenerLo = listenerAll = null;
    // The tables.
    const sql = (q: string) => sh("docker", ["compose", "exec", "-T", "db", "psql", "-U", "app", "-d", "app", "-tAc", q], { cwd: copyDir, env: personEnv() });
    const migrations = await sql("select count(*) from drizzle.__drizzle_migrations").catch((e: Error) => e.message.split("\n")[0]!);
    const users = await sql('select email from "user" order by email').catch((e: Error) => e.message.split("\n")[0]!);
    count("C, the tables", { name: "drizzle.__drizzle_migrations holds 2 rows (docker compose exec db psql)", ok: migrations === "2", detail: migrations });
    count("C, the tables", { name: "the three made-up users exist", ok: users.split("\n").join(",") === USERS.join(","), detail: users.split("\n").join(", ") });

    /* ---------------------------------------------------------------- D */
    say("");
    say("== D. The licence checks on what the copy's command built (section 4, items 4 to 7) ==");
    const devNames = devOnlyNames();
    const notices = sha256(readFileSync(join(copyDir, "THIRD-PARTY-NOTICES.md")));
    const dTag = randomBytes(3).toString("hex");
    const dName = (what: string) => {
      const n = `x32-check-${runId}-${what}-${dTag}`;
      madeContainers.push(n);
      return n;
    };
    const d4 = await composeConfigCheck(copyDir, mkdtempSync(join(work, "s30d-")));
    const appImage = `${id}-app`;
    const setupImage = `${id}-setup`;
    const d56 = await runImageChecks(dockerEnv(), { image: appImage, container: dName("list-run"), copyNoticesSha256: notices, devNames });
    const d7 = await toolsImageChecks(dockerEnv(), { image: setupImage, listContainer: dName("list-tools"), licenceContainer: dName("licences"), devNames });
    const dChecks = [d4, ...d56, ...d7];
    for (const c of dChecks) say(`  ${c.id}: ${c.passed ? "passed" : "NOT passed"}: ${c.summary}`);
    count("D", { name: `items 4 to 7 on ${id}-app (the run image, as nobody) and ${id}-setup (the tools image, as node): Compose's reading, the run image's packages and notices file, the tools image's packages and the template's licence check, each passed`, ok: JSON.stringify(dChecks.map((c) => [c.id, c.passed])) === JSON.stringify(["compose_config", "run_image_packages", "run_image_notices", "tools_image_packages", "licence_check"].map((x) => [x, true])), detail: JSON.stringify(dChecks.map((c) => [c.id, c.passed])) });
    const runListed = d56.find((c) => c.id === "run_image_packages")?.listed;
    count("D", { name: "in the person's run image, the only copy of a development-only package is the base image's own npm spdx-exceptions 2.5.0", ok: JSON.stringify(runListed) === JSON.stringify([{ path: "/usr/local/lib/node_modules/npm/node_modules/spdx-exceptions", name: "spdx-exceptions", version: "2.5.0" }]), detail: JSON.stringify(runListed) });

    /* ---------------------------------------------------------------- E */
    say("");
    say("== E. The check from the copy (scripts/check-export.ts) ==");
    const runFolder = join(work, "check-run");
    const cargs = ["tsx", "scripts/check-export.ts", copyDir, "--project-id", id, "--version", String(p.acceptance_version), "--manifest-sha256", String(p.manifest_sha256), "--checklist-items", String(p.checklist_items), "--run-folder", runFolder];
    say(`E: npx ${hide(cargs.join(" "))} (run from builder/; the four values from the event).`);
    times.checkStarted = iso(Date.now());
    const child = spawn("npx", cargs, { cwd: builderDir, env: { ...dockerEnv(), TMPDIR: tmpdir() }, stdio: ["ignore", "pipe", "pipe"] });
    const out: string[] = [];
    const keepOut = (d: Buffer) => out.push(...d.toString("utf8").split("\n").filter((l) => l.trim() !== ""));
    child.stdout!.on("data", keepOut);
    child.stderr!.on("data", keepOut);
    const checkEnded = new Promise<number | null>((ok) => child.on("close", (c) => ok(c)));
    let checkDone = false;
    void checkEnded.then(() => (checkDone = true));
    // The runner, inspected while it runs.
    let seenRunner: Record<string, any> | null = null;
    let seenForwarder: Record<string, any> | null = null;
    while (!checkDone && !seenRunner) {
      const names = (await sh("docker", ["ps", "--filter", `name=${id}-copycheck-runner-`, "--format", "{{.Names}}"]).catch(() => "")).split("\n").filter(Boolean);
      if (names[0]) {
        const info = await sh("docker", ["inspect", names[0]]).then((x) => JSON.parse(x)[0], () => null);
        if (info?.State?.Running) {
          seenRunner = info;
          seenForwarder = await sh("docker", ["inspect", names[0].replace("-copycheck-runner-", "-copycheck-forwarder-")]).then((x) => JSON.parse(x)[0], () => null);
          break;
        }
      }
      await sleep(100);
    }
    const checkCode = await checkEnded;
    times.checkEnded = iso(Date.now());
    for (const l of out) say(`  check-export | ${hide(l).slice(0, 400)}`);
    count("E", { name: "scripts/check-export.ts exits with code 0", ok: checkCode === 0, detail: `exit code ${checkCode}` });
    count("E", { name: `it prints "passed" and "${SUMMARY}"`, ok: out.includes(`Check from the exported copy: passed. ${SUMMARY}.`) && out.includes("PASSED"), detail: out.find((l) => l.startsWith("Check from the exported copy:")) ?? "" });
    const readingFile = readPlain(join(runFolder, "check-reading.json"), 4 * 1024 * 1024);
    checkReading = readingFile ? (JSON.parse(readingFile.toString("utf8")) as Record<string, any>) : null;
    const rd = checkReading?.reading as { outcome?: string; summary?: string; items?: Array<{ number: number; status: string; why: string; screenshot?: { path: string } }> } | undefined;
    count("E", { name: "its reading (check-reading.json): passed, the summary, labelled as the stand-in", ok: rd?.outcome === "passed" && rd.summary === SUMMARY && checkReading?.label === STAND_IN, detail: `${rd?.outcome}; ${rd?.summary}; ${checkReading?.label}` });
    count("E", { name: "item 1 passed; the run's id and the export's manifest SHA-256 as given", ok: rd?.items?.length === 1 && rd.items[0]!.status === "passed" && checkReading?.manifestSha256 === p.manifest_sha256 && /^\S+$/.test(String(checkReading?.runId)), detail: `${JSON.stringify(rd?.items?.map((i) => [i.number, i.status]))}; run ${checkReading?.runId}` });
    count("E", { name: "the app it checked: the copy's own, from its folder, its image the one Compose built, at http://localhost:3000", ok: checkReading?.app?.workingDir === copyDir && checkReading?.app?.appUrl === `http://localhost:${APP_PORT}` && checkReading?.app?.imageId === imgIds[`${id}-app`], detail: hide(JSON.stringify(checkReading?.app ?? null)) });
    count("E", { name: "the copy unchanged during the check, and the forwarder removed", ok: checkReading?.copy?.unchanged === true && checkReading?.forwarderRemoved === true, detail: JSON.stringify({ copy: checkReading?.copy, forwarderRemoved: checkReading?.forwarderRemoved }) });
    const shot = rd?.items?.[0]?.screenshot?.path ? readPng(rd.items[0].screenshot.path) : null;
    if (shot) {
      writeFileSync(join(screensDir, "02-item-1-from-export-en.png"), shot);
      shotsCopied++;
    }
    shotsWanted++;
    count("E", { name: "the item's screenshot, taken by the runner in the app started from the export, is copied into the evidence", ok: shot !== null, detail: "" });
    if (checkReading) writeFileSync(join(evidence, "check-reading.json"), hide(JSON.stringify(checkReading, null, 2)) + "\n");
    // L3c's inspection, here as the runner ran.
    say(
      `E: the forwarder while the runner ran: networks ${JSON.stringify(Object.keys(seenForwarder?.NetworkSettings?.Networks ?? {}))}, user ${seenForwarder?.Config?.User}, read-only ${seenForwarder?.HostConfig?.ReadonlyRootfs}, image ${seenForwarder?.Config?.Image}`,
    );
    say(
      `E: the runner while it ran: network mode ${seenRunner?.HostConfig?.NetworkMode} (the forwarder is ${seenForwarder?.Id}), user ${seenRunner?.Config?.User}, read-only ${seenRunner?.HostConfig?.ReadonlyRootfs}, cap drop ${JSON.stringify(seenRunner?.HostConfig?.CapDrop)}, cap add ${JSON.stringify(seenRunner?.HostConfig?.CapAdd)}, security ${JSON.stringify(seenRunner?.HostConfig?.SecurityOpt)}, tmpfs ${JSON.stringify(seenRunner?.HostConfig?.Tmpfs)}`,
    );
    const mounts = ((seenRunner?.Mounts ?? []) as Array<{ Type: string; Name?: string; Source?: string; Destination: string; RW: boolean }>).map((x) => ({ Type: x.Type, Name: x.Name, Source: x.Type === "volume" ? undefined : hide(x.Source ?? ""), Destination: x.Destination, RW: x.RW }));
    say(`E: the runner's mounts: ${JSON.stringify(mounts)}`);
    const renv = ((seenRunner?.Config?.Env ?? []) as string[]).filter((e) => /^(BASE_URL|RUN_ID)=/.test(e)).sort();
    say(`E: the runner's BASE_URL and RUN_ID: ${JSON.stringify(renv)}`);
    count("E, the runner inspected while it ran", { name: "seen running", ok: seenRunner !== null && seenForwarder !== null, detail: "" });
    count("E, the runner inspected while it ran", { name: `the forwarder: on ${id}_front alone, user node, a read-only root, the approved node image`, ok: JSON.stringify(Object.keys(seenForwarder?.NetworkSettings?.Networks ?? {})) === JSON.stringify([`${id}_front`]) && seenForwarder?.Config?.User === "node" && seenForwarder?.HostConfig?.ReadonlyRootfs === true && seenForwarder?.Config?.Image === DEFAULT_IMAGES.node, detail: "" });
    count("E, the runner inspected while it ran", { name: "the runner: in the forwarder's network namespace (container:<forwarder>)", ok: seenRunner?.HostConfig?.NetworkMode === `container:${seenForwarder?.Id}`, detail: String(seenRunner?.HostConfig?.NetworkMode) });
    count("E, the runner inspected while it ran", { name: "the runner: user runner, a read-only root, every capability dropped, none added, no new privileges", ok: seenRunner?.Config?.User === "runner" && seenRunner?.HostConfig?.ReadonlyRootfs === true && JSON.stringify(seenRunner?.HostConfig?.CapDrop) === '["ALL"]' && !(seenRunner?.HostConfig?.CapAdd ?? []).length && JSON.stringify(seenRunner?.HostConfig?.SecurityOpt) === '["no-new-privileges:true"]', detail: "" });
    count("E, the runner inspected while it ran", {
      name: "the runner: exactly 3.1's three mounts (the copy's tests read-only, a results folder, the keys volume's sample_password read-only)",
      ok:
        JSON.stringify(mounts.map((x) => [x.Type, x.Destination, x.RW]).sort()) === JSON.stringify([["bind", "/acceptance", false], ["bind", "/results", true], ["volume", "/run/secrets/sample-password", false]]) &&
        mounts.find((x) => x.Destination === "/acceptance")?.Source === hide(join(copyDir, "acceptance", String(p.acceptance_version))) &&
        mounts.find((x) => x.Destination === "/run/secrets/sample-password")?.Name === `${id}_keys`,
      detail: JSON.stringify(mounts),
    });
    count("E, the runner inspected while it ran", { name: "the runner's BASE_URL is the app's APP_URL, http://localhost:3000", ok: renv[0] === `BASE_URL=http://localhost:${APP_PORT}` && renv[1] === `RUN_ID=${checkReading?.runId}`, detail: JSON.stringify(renv) });

    /* ---------------------------------------------------------------- F */
    say("");
    say("== F. A second start ==");
    const down = await sh("docker", ["compose", "down"], { cwd: copyDir, env: personEnv(), timeout: 180_000 }).then((x) => x, (e: Error) => `failed: ${e.message.split("\n")[0]}`);
    composeOut.push("== docker compose down (before the second start) ==", down);
    const endA = await Promise.race([startA.ended, bound(60_000)]);
    composeOut.push(`== The first start's command ended with exit code ${endA} ==`);
    say(`F: docker compose down; the first start's command ended (exit code ${endA}).`);
    times.secondStarted = iso(Date.now());
    startB = startBlock(copyDir, block!);
    const waitB = await waitHealthy(copyDir, startB);
    times.secondHealthy = iso(Date.now());
    composeOut.push(`== The second start: sh -c "${block}", the same way; started ${times.secondStarted}; the app healthy ${waitB ? "NOT reached" : times.secondHealthy} ==`, ...startB.output);
    const inst2 = installLines(startB.output);
    npmLines.push(`== The second start (${times.secondStarted}): every line of the build steps that run npm ci ==`, ...inst2);
    const said2 = startB.output.join("\n");
    count("F", { name: "the app is healthy again, the door running", ok: waitB === null, detail: waitB ?? "" });
    for (const k of ["db_password", "auth_secret", "sample_password"]) count("F", { name: `the keys service says "kept ${k}"`, ok: new RegExp(`keys-1 +\\| kept ${k}`).test(said2), detail: "" });
    for (const u of USERS) count("F", { name: `the seed says "exists: ${u}"`, ok: said2.includes(`exists: ${u}`), detail: "" });
    count("F", { name: "no user is created again", ok: !/created: /.test(said2), detail: "" });
    const migrations2 = await sql("select count(*) from drizzle.__drizzle_migrations").catch((e: Error) => e.message.split("\n")[0]!);
    const users2 = await sql('select email from "user" order by email').catch((e: Error) => e.message.split("\n")[0]!);
    count("F", { name: "no migration is applied again: drizzle.__drizzle_migrations still holds 2 rows; still the three users", ok: migrations2 === "2" && users2.split("\n").join(",") === USERS.join(","), detail: `${migrations2}; ${users2.split("\n").join(", ")}` });

    /* ---------------------------------------------------------------- G */
    say("");
    say("== G. The copy unchanged ==");
    const fpAfter = copyFingerprints(copyDir);
    const changes: string[] = [];
    for (const [k, v] of fpAfter) if (fpUnpacked.get(k) !== v) changes.push(fpUnpacked.has(k) ? `${k} (changed)` : `${k} (added)`);
    for (const k of fpUnpacked.keys()) if (!fpAfter.has(k)) changes.push(`${k} (removed)`);
    const status1 = await gitCopy(copyDir, ["status", "--porcelain", "--ignored"]);
    count("G", { name: `every file's SHA-256 (${fpUnpacked.size} entries, its history included) is what it was when unpacked, after C to F`, ok: changes.length === 0, detail: changes.slice(0, 20).join(", ") });
    count("G", { name: "git status --porcelain --ignored is still empty", ok: status1 === "", detail: status1.slice(0, 300) });

    /* ---------------------------------------------------------------- the run's record page */
    say("");
    say("== The run's record, photographed ==");
    const recordDir = join(work, "record");
    mkdirSync(recordDir, { mode: 0o755 });
    const item = rd?.items?.[0];
    const rowsHtml: Array<[string, string, string?]> = [
      ["Outcome", esc(rd?.outcome), "data-outcome"],
      ["Summary", esc(rd?.summary)],
      ["Label", esc(checkReading?.label)],
      ["Run id (the same as in the item's picture)", `<code>${esc(checkReading?.runId)}</code>`],
      ["Project, version", `<code>${esc(id)}</code>, ${esc(checkReading?.version)}`],
      ["Manifest SHA-256 (from the export's event)", `<code>${esc(checkReading?.manifestSha256)}</code>`],
      ["Item 1", `${esc(item?.status)}: ${esc(item?.why)}`],
      ["The builder that made the export", `Its interface, process ${esc(pid)} on 127.0.0.1:${UI_PORT}, was sent SIGTERM at ${esc(times.builderSigterm)} and exited with code ${esc(r?.code)} at ${esc(times.builderStopped)}. Its database was dropped at ${esc(times.dbDropped)}; its data folder and sandbox folders were deleted at ${esc(times.dataDeleted)}.`],
      ["The app started from the export", `Its README's command, <code>${esc(block)}</code>, run in the unpacked copy with only PATH and HOME set, at ${esc(times.appStarted)}; the app healthy at ${esc(times.appHealthy)}.`],
      ["The check ran", `<code>scripts/check-export.ts</code> from ${esc(times.checkStarted)} to ${esc(times.checkEnded)}, exit code ${esc(checkCode)}; the runner's exit code ${esc(checkReading?.exit?.code)}.`],
      ["The app it checked", `Container ${esc(checkReading?.app?.container)} of the Compose project ${esc(checkReading?.app?.project)}, image ${esc(checkReading?.app?.imageName)}, at ${esc(checkReading?.app?.appUrl)}.`],
      ["The copy", `${esc(checkReading?.copy?.files)} entries, ${checkReading?.copy?.unchanged ? "unchanged" : "CHANGED"} during the check; the forwarder ${checkReading?.forwarderRemoved ? "removed" : "NOT removed"}.`],
      ["Other builders on this machine", `Listening, recorded and not touched: 127.0.0.1:4020 ${esc(listening(4020).length ? "yes" : "no")}.`],
    ];
    const pageHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>The run's record</title>
<style>body { font: 16px/1.5 system-ui, sans-serif; margin: 24px; color: #111; background: #fff; max-width: 1100px } table { border-collapse: collapse; width: 100% } th, td { border: 1px solid #999; padding: 6px 10px; text-align: left; vertical-align: top } th { background: #eee; width: 28% } .note { background: #fff4d6; border: 1px solid #c90; padding: 8px 12px } code { font-family: monospace; word-break: break-all }</style></head>
<body>
<h1>Package 3.2's automated run: the check from the exported copy</h1>
<p class="note" data-drawn-from>This page is drawn from the automated run's own files (the check's reading, check-reading.json, and the run's stop record), run ${esc(runId)}. It is not a screen of the builder or of the app. The automated run wrote it, and its camera photographed it with no network.</p>
<table>
${rowsHtml.map(([k, v, attr]) => `<tr><th>${esc(k)}</th><td${attr ? ` ${attr}` : ""}>${v}</td></tr>`).join("\n")}
</table>
<p>Made-up data only. The test is a stand-in test written by Claude Code, not independent acceptance.</p>
</body></html>
`;
    writeFileSync(join(recordDir, "page.html"), pageHtml, { mode: 0o644 });
    await camera("The run's record", { script: "record-shot.mjs", network: "none", env: { BUILDER_CAMERA_SHOT: "03-run-record-en.png" }, mounts: [`${recordDir}:/record:ro`] });

    code = 0;
  } catch (err) {
    say(`The run stopped part-way: ${hide(err instanceof Error ? err.message : String(err))}`);
    count("the run", { name: "ran to its end without an error", ok: false, detail: hide(err instanceof Error ? err.message : String(err)) });
  } finally {
    /* ---------------------------------------------------------------- H */
    say("");
    say("== H. Clean-up, by exact names ==");
    listenerLo?.close();
    listenerAll?.close();
    if (ifaceProc && !ifaceDone) {
      say(`H: the interface's process ${ifaceProc.pid} is still running; SIGTERM to it.`);
      process.kill(ifaceProc.pid!, "SIGTERM");
      await sleep(5000);
      code = 1;
    }
    // The check's forwarder (and runner) first: a container left on <project>_front would stop Compose removing it.
    if (copyName) {
      const leftCheck = (await sh("docker", ["ps", "-a", "--filter", `name=${copyName}-copycheck-`, "--format", "{{.Names}}"]).catch(() => "")).split("\n").filter((n) => n.startsWith(`${copyName}-copycheck-`));
      for (const n of leftCheck) await sh("docker", ["rm", "-f", n]).catch(() => "");
      say(`H: the check's containers left (forwarder, runner): ${leftCheck.join(", ") || "none"}.`);
    }
    for (const n of [...madeContainers, ...camNames]) await sh("docker", ["rm", "-f", n]).catch(() => "");
    if (copyDir && existsSync(join(copyDir, "compose.yaml"))) {
      const d = await sh("docker", ["compose", "down", "--volumes"], { cwd: copyDir, env: personEnv(), timeout: 180_000 }).then((x) => x, (e: Error) => `failed: ${e.message.split("\n")[0]}`);
      composeOut.push("== docker compose down --volumes (the clean-up) ==", d);
      say(`H: docker compose down --volumes in the copy: ${d ? d.split("\n").length + " lines" : "done"}.`);
    }
    for (const s of [startA, startB]) {
      if (s && !s.done) {
        await Promise.race([s.ended, bound(30_000)]);
        if (!s.done) {
          process.kill(s.child.pid!, "SIGTERM");
          code = 1;
        }
      }
      if (s) composeOut.push(`== A start's command ended with exit code ${s.child.exitCode} ==`);
    }
    if (copyName) for (const image of [`${copyName}-app`, `${copyName}-setup`]) await sh("docker", ["image", "rm", image]).then((x) => say(`H: removed the image ${image}: ${x.split("\n").length} lines.`), () => say(`H: the image ${image} was not there.`));
    if (!dbDropped) {
      await pool?.end().catch(() => undefined);
      execFileSync("dropdb", ["-h", "/var/run/postgresql", "--if-exists", dbName]);
    }
    clearInterval(diskSampler);
    const gb = (b: number) => (b / 1024 ** 3).toFixed(2);
    say(`Free space on the run folder's disk, sampled every 2 s: ${gb(disk.first)} GB at the start, ${gb(disk.lowest)} GB at the lowest, ${gb(free())} GB at the end (GB of 1024^3 bytes).`);

    // The interface's output and the copy's output, with the run folder and the session's proxy as placeholders.
    let ifaceText = hide(ifaceLog.join("\n"));
    for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"]) if (process.env[k]) ifaceText = ifaceText.replaceAll(process.env[k]!, "<session proxy>");
    writeFileSync(join(evidence, "interface-log.txt"), `The interface's own output during package 3.2's automated run (run ${runId}; stdout and stderr), with the run's folder written <run folder> and the session proxy's address <session proxy>:\n\n${ifaceText}\n`);
    writeFileSync(join(evidence, "compose-output.txt"), `The exported copy's own output in package 3.2's automated run (run ${runId}): its README's command, run twice, and docker compose down, with the run's folder written <run folder>. The passwords are never printed by the copy; the evidence is searched for them (run-secret-search.txt).\n\n${hide(composeOut.join("\n"))}\n`);
    writeFileSync(join(evidence, "npm-build-lines.txt"), `The build's lines for the copy's install step (the steps that run npm ci), in package 3.2's automated run (run ${runId}), from the output of its README's command, with npm's cache mount as Docker's build cache listed it:\n\n${hide(npmLines.join("\n"))}\n`);

    // H: Docker's lists compared with the start.
    const after = await dockerLists().catch(() => null);
    const docker: string[] = [`Docker's lists in package 3.2's automated run (run ${runId}), at the start and at the end, after the clean-up.`, ""];
    if (after) {
      const newOf = <T>(a: T[], b: T[], key: (x: T) => string) => a.filter((x) => !b.some((y) => key(y) === key(x)));
      const newC = newOf(after.containers, before.containers, (x) => x.name);
      const newI = newOf(after.images, before.images, (x) => `${x.ref} ${x.id}`);
      const newV = newOf(after.volumes, before.volumes, (x) => x.name);
      const newN = newOf(after.networks, before.networks, (x) => x.name);
      const goneI = newOf(before.images, after.images, (x) => `${x.ref} ${x.id}`);
      const newCache = after.cache.filter((x) => !before.cache.includes(x));
      /** Another builder's own project (the owner's interface makes builder_j1-<id> projects): not the run's. */
      const others = (s: string) => /builder_j1-[0-9a-f]{12}/.test(s) && !(projectId && s.includes(projectId));
      const newAll = [...newC.map((x) => `container ${x.name}`), ...newI.map((x) => `image ${x.ref} ${x.id}`), ...newV.map((x) => `volume ${x.name}`), ...newN.map((x) => `network ${x.name}`)];
      const ofRun = newAll.filter((x) => !others(x));
      docker.push(
        `At the start: ${before.containers.length} containers, ${before.images.length} images, ${before.volumes.length} volumes, ${before.networks.length} networks, ${before.cache.length} build cache records.`,
        `At the end: ${after.containers.length} containers, ${after.images.length} images, ${after.volumes.length} volumes, ${after.networks.length} networks, ${after.cache.length} build cache records.`,
        "",
        `New since the start, in the four lists: ${newAll.join("; ") || "nothing"}.`,
        `Of those, another builder's (named builder_j1-<id> of another project; not touched): ${newAll.filter(others).join("; ") || "none"}.`,
        `Gone since the start (images): ${goneI.map((x) => x.ref).join("; ") || "none"}.`,
        `Build cache: ${newCache.length} new records (layers of the run's image builds; npm's cache mount is the builder's and stays). Build cache records can be removed only by pruning, which this run does not do.`,
        "",
        "Containers at the end:",
        ...after.containers.map((x) => `  ${x.name}`),
        "Images at the end:",
        ...after.images.map((x) => `  ${x.ref} ${x.id}`),
        "Volumes at the end:",
        ...after.volumes.map((x) => `  ${x.name}`),
        "Networks at the end:",
        ...after.networks.map((x) => `  ${x.name}`),
      );
      count("H", { name: "Docker's lists (containers, images, volumes, networks) compared with the start: nothing new of the run is left", ok: ofRun.length === 0, detail: ofRun.join("; ") });
      say(`H: new since the start: ${newAll.join("; ") || "nothing"}; build cache: ${newCache.length} new records (not removable without a prune, which this run does not do).`);
    } else count("H", { name: "Docker's lists could be read at the end", ok: false, detail: "" });
    writeFileSync(join(evidence, "docker-after.txt"), docker.join("\n") + "\n");

    rmSync(work, { recursive: true, force: true });
    count("H", { name: "the run folder (the delivered copy, the check's run folder with its trace, the camera's folder, the password file) is removed", ok: !existsSync(work), detail: "" });
    say(`Free disk after: ${execFileSync("df", ["-h", "/"], { encoding: "utf8" }).trim().split("\n").pop()}`);
    say(`Pictures copied into the evidence folder: ${shotsCopied} of ${shotsWanted}.`);

    // The secret search: every evidence file, pictures' names included, for each of the four secrets.
    const evFiles: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) evFiles.push(full);
      }
    };
    walk(evidence);
    const logText = log.join("\n");
    const searchLines: string[] = [
      `The search of the evidence for the four secrets package 3.2's automated run handled (run ${runId}), made by the run itself before anything was committed. Each secret was held in the run's memory only. Every file under ${relative(repoDir, evidence)}/ (pictures included) was read whole and searched for each secret's bytes; each file's path was searched too; and run-demo.txt was searched as it was about to be written.`,
      "",
    ];
    let hits = 0;
    for (const [what, value] of Object.entries(secrets)) {
      if (!value) {
        searchLines.push(`${what}: NOT READ, so not searched.`);
        hits++;
        continue;
      }
      const holding = evFiles.filter((f) => readFileSync(f).includes(Buffer.from(value)) || relative(evidence, f).includes(value));
      const inLog = logText.includes(value);
      hits += holding.length + (inLog ? 1 : 0);
      searchLines.push(`${what} (${value.length} characters): ${evFiles.length + 1} files searched (${evFiles.length} on disk and run-demo.txt); ${holding.length + (inLog ? 1 : 0)} hold it.${holding.length ? ` ${holding.map((f) => relative(evidence, f)).join(", ")}` : ""}${inLog ? " run-demo.txt" : ""}`);
    }
    searchLines.push("", hits === 0 ? "Result: no file holds any of the four secrets." : "Result: A SECRET WAS FOUND, or a secret was not read; nothing may be committed.");
    writeFileSync(join(evidence, "run-secret-search.txt"), searchLines.join("\n") + "\n");
    count("The secret search", { name: "no evidence file holds any of the four secrets (the interface password, the sample password, the exported app's db_password and auth_secret)", ok: hits === 0, detail: `${hits}` });

    const failed = allChecks.filter((c) => !c.ok);
    if (failed.length || shotsCopied !== shotsWanted || shotsWanted === 0 || hits > 0) code = 1;
    say(`Checks in all: ${allChecks.length - failed.length} passed, ${failed.length} failed (${allChecks.length} counted: the cameras', the event's, the machine's and Docker's, the copy's, the check's and the search's).`);
    for (const c of failed) say(`  FAILED: ${c.name}${c.detail ? ` (${c.detail.slice(0, 500)})` : ""}`);
    say(`Result: ${code === 0 ? "every check passed" : "NOT every check passed"} (exit code ${code}).`);
    const finalLog = log.join("\n");
    const leaked = Object.values(secrets).some((v) => v && finalLog.includes(v));
    writeFileSync(join(evidence, "run-demo.txt"), leaked ? "The run's log is not written: it would hold a secret.\n" : finalLog.split(work).join("<run folder>") + "\n");
    if (leaked) code = 1;
  }
  return code;
}

process.exitCode = await main();
