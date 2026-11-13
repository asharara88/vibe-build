/**
 * Package J3, measurement M2 (final design, section 6): streams to the app through short-lived `check` containers
 * (manager.ts, `appStream`), in a throwaway sandbox on the development profile, under the shared lock:
 *
 *   flock <scratchpad>/live-tests.lock npx tsx scripts/measure-j3-streams.ts <out folder>
 *
 * The sandbox's app is a stand-in made from the approved Node image with no network (as the isolation harness
 * makes its stand-ins): it answers a small page, a 2 MB answer, an echo of a POST body, and a page that never ends.
 * Example 1's own pages are timed through the whole chain in M3 (test/preview-live.test.ts), not here.
 *
 *  1. One stream at a time, straight (raw HTTP/1.1 over the container's standard input and output): first byte and
 *     whole answer, a new stream each time (cold) and a second request on the same stream (warm); the 2 MB answer
 *     and a POST body holding every byte value 0 to 255 (Ctrl-P and Ctrl-Q included), each checked by SHA-256.
 *  2. Through the preview front and the pump socket (preview.ts), as the browser would reach it: six requests at once;
 *     a client that leaves part-way through the 2 MB answer; a page that never ends, left by its client.
 *  3. The interface killed (SIGKILL) while streams are open: a child process holding the pump socket and its streams.
 *  4. `docker compose run` against `docker compose exec` into the running app stand-in: the time to a first byte.
 * After each of 2 and 3: the stream containers (`docker ps -a`), `docker compose` clients and stream processes
 * (`ps`) still there are counted; none is expected. Everything is removed after. Made-up data only.
 */
import { execFile, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { appImageName, createSandbox, DEFAULT_IMAGES, dockerEnv, sandbox, toolsImageName, type AppStream, type Sandbox } from "../src/sandbox/manager.js";
import { FRONT_TEXT_KEYS, type Texts } from "../src/web/preview-rules.ts";
import { LivePreview, removeStaleFolders } from "../src/web/preview.js";

const run = promisify(execFile);
const builderDir = resolve(import.meta.dirname, "..");
const APP_PORT = 3171;
const FRONT_PORT = 4041;
const out: string[] = [];
let progressFile: string | null = null;
const say = (s = "") => {
  out.push(s);
  console.log(s);
  if (progressFile) writeFileSync(progressFile, out.join("\n") + "\n");
};
/** Each stream's life: opened, killed asked, ended (with its code), in ms from the run's start. */
const T0 = performance.now();
const life: string[] = [];
function traced(s: AppStream): AppStream {
  const at = () => Math.round(performance.now() - T0);
  life.push(`${at()} opened ${s.container}`);
  void s.done.then((e) => life.push(`${at()} ended ${s.container} code ${e.code}`));
  const kill = s.kill;
  return { ...s, kill: () => (life.push(`${at()} kill asked ${s.container}`), kill()) };
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** The 2 MB answer, the same on both sides: byte i is (i*31+7) mod 256. */
const BIG = (() => {
  const b = Buffer.alloc(2 * 1024 * 1024);
  for (let i = 0; i < b.length; i++) b[i] = (i * 31 + 7) & 255;
  return b;
})();
/** Every byte value, 0 to 255, 256 times over (64 KB): Ctrl-P (0x10) and Ctrl-Q (0x11) side by side, 256 times. */
const ALL_BYTES = Buffer.concat(Array.from({ length: 256 }, () => Buffer.from(Array.from({ length: 256 }, (_, i) => i))));

const STAND_IN = `const http=require('http');const crypto=require('crypto');
const big=Buffer.alloc(2*1024*1024);for(let i=0;i<big.length;i++)big[i]=(i*31+7)&255;
http.createServer((q,s)=>{
 if(q.url==='/big'){s.writeHead(200,{'content-type':'text/plain','content-length':big.length});return s.end(big)}
 if(q.url==='/echo'&&q.method==='POST'){const c=[];q.on('data',d=>c.push(d));q.on('end',()=>{const b=Buffer.concat(c);s.writeHead(200,{'content-type':'text/plain','content-length':b.length,'x-sha256':crypto.createHash('sha256').update(b).digest('hex')});s.end(b)});return}
 if(q.url==='/hang'){s.writeHead(200,{'content-type':'text/plain'});s.write('started, and never ends');return}
 s.writeHead(200,{'content-type':'text/html; charset=utf-8'});s.end('<!doctype html><title>stand-in</title><p>stand-in app page</p>')
}).listen(Number(process.env.PORT),'0.0.0.0')`;

function buildImage(sb: Sandbox, tag: string, dockerfile: string): void {
  const r = spawnSync("docker", ["build", "--network", "none", "-t", tag, "-"], { input: dockerfile, env: dockerEnv(sb) });
  if (r.status !== 0) throw new Error(`the stand-in image ${tag} did not build: ${r.stderr?.toString().slice(-800)}`);
}

/** Whether an HTTP/1.1 answer with a Content-Length body has fully arrived. */
function complete(b: Buffer): boolean {
  const end = b.indexOf("\r\n\r\n");
  if (end < 0) return false;
  const m = /\r\ncontent-length:\s*(\d+)/i.exec(b.subarray(0, end).toString("latin1"));
  return m !== null && b.length - (end + 4) >= Number(m[1]);
}

/**
 * Send raw bytes on a stream; read until the answer has fully arrived (by its Content-Length), and wait for the stream
 * to end (the app closes the connection: Connection: close).
 */
async function rawExchange(s: AppStream, request: Buffer): Promise<{ firstMs: number; endMs: number; bytes: Buffer; endedMs: number }> {
  const t0 = performance.now();
  let first = 0;
  const chunks: Buffer[] = [];
  const whole = new Promise<void>((r) =>
    s.stdout.on("data", (d: Buffer) => {
      if (!first) first = performance.now();
      chunks.push(d);
      if (complete(Buffer.concat(chunks))) r();
    }),
  );
  s.stdin.write(request);
  await Promise.race([whole, s.done]);
  const endMs = Math.round(performance.now() - t0);
  s.stdin.end();
  await s.done;
  return { firstMs: Math.round(first - t0), endMs, bytes: Buffer.concat(chunks), endedMs: Math.round(performance.now() - t0) };
}

/** Split an HTTP/1.1 answer (Content-Length bodies only) into its status, headers and body. */
function parseAnswer(b: Buffer): { status: number; headers: Record<string, string>; body: Buffer } {
  const end = b.indexOf("\r\n\r\n");
  const head = b.subarray(0, end).toString("latin1").split("\r\n");
  const headers: Record<string, string> = {};
  for (const l of head.slice(1)) headers[l.slice(0, l.indexOf(":")).toLowerCase()] = l.slice(l.indexOf(":") + 1).trim();
  return { status: Number(head[0]!.split(" ")[1]), headers, body: b.subarray(end + 4) };
}

const name = (sb: Sandbox) => `${sb.projectName}-live-${randomBytes(4).toString("hex")}`;

async function leftovers(sb: Sandbox): Promise<{ containers: string[]; clients: string[] }> {
  const containers = (await run("docker", ["ps", "-a", "--filter", `name=${sb.projectName}-live-`, "--format", "{{.Names}}"], { env: dockerEnv(sb) })).stdout.split("\n").filter(Boolean);
  const ps = (await run("ps", ["-eo", "pid,args"])).stdout.split("\n");
  const clients = ps.filter((l) => l.includes(sb.composeFile) && / run /.test(l) && l.includes(" check "));
  return { containers, clients };
}

async function settle(sb: Sandbox, ms = 20_000): Promise<{ containers: string[]; clients: string[]; afterMs: number }> {
  const t0 = Date.now();
  let l = await leftovers(sb);
  while ((l.containers.length || l.clients.length) && Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 500));
    l = await leftovers(sb);
  }
  return { ...l, afterMs: Date.now() - t0 };
}

const texts = (): Texts => {
  const t = Object.fromEntries(FRONT_TEXT_KEYS.map((k) => [k, `(${k})`])) as Texts["en"];
  return { en: t, ar: t };
};

/** The child of step 3: holds a preview with its pump socket and streams until it is killed. */
async function child(composeFile: string, dir: string, projectName: string): Promise<void> {
  const sb: Sandbox = { dir, composeFile, projectName };
  const p = new LivePreview({ port: FRONT_PORT, texts: texts(), openStream: () => sandbox.appStream(sb, `app:${APP_PORT}`, { container: name(sb) }), onEvent: async () => undefined });
  await p.start();
  const o = await p.open({ projectId: "j1-000000000000", builderSession: "measure", appStartEventId: "1", appPort: APP_PORT });
  process.stdout.write(JSON.stringify({ pass: o.shown, pid: p.frontPid }) + "\n");
  await new Promise(() => undefined);
}

async function main(): Promise<number> {
  const outDir = resolve(process.argv[2] ?? join(builderDir, "..", "evidence", "2026-11-13-journey-j3", "m2"));
  mkdirSync(outDir, { recursive: true });
  progressFile = join(outDir, "m2-progress.txt");
  const dir = mkdtempSync(join(tmpdir(), "builder-j3m2-"));
  const workspace = join(dir, "workspace");
  mkdirSync(workspace, { recursive: true });
  const projectId = `p_j3m2_${randomBytes(3).toString("hex")}`;
  const sb = createSandbox(
    {
      projectId,
      dir,
      profile: "development-cloud-session",
      allowHosts: ["registry.npmjs.org"],
      gatewayUrl: "http://127.0.0.1:4010",
      builderDir,
      hostProxy: { url: process.env.HTTPS_PROXY ?? "http://127.0.0.1:1" },
      buildProxyPort: 13199,
      app: { buildContext: workspace, port: APP_PORT, env: { APP_URL: `http://app:${APP_PORT}` } },
    },
    "made-up-db-password",
    { AUTH_SECRET: "made-up", APP_SAMPLE_PASSWORD: "made-up" },
  );
  const images = [appImageName(projectId), toolsImageName(projectId)];
  let code = 0;
  let killedChild: ReturnType<typeof spawn> | null = null;
  try {
    say(`M2, ${new Date().toISOString()}: streams through short-lived check containers, sandbox ${sb.projectName} (development profile), app stand-in on app:${APP_PORT}.`);
    say(`Before: stream containers of this project ${JSON.stringify((await leftovers(sb)).containers)}.`);
    buildImage(sb, images[0]!, `FROM ${DEFAULT_IMAGES.node}\nUSER node\nENTRYPOINT []\nCMD ${JSON.stringify(["node", "-e", STAND_IN])}\n`);
    await sandbox.up(sb, ["app"]);
    say("App stand-in started and healthy (db, app).");
    const s0 = sandbox.appStream(sb, `app:${APP_PORT}`, { container: name(sb) });
    say(`The docker arguments of a stream: ${s0.args.join(" ").replace(sb.composeFile, "<compose file>")}`);
    await s0.kill();

    say("\n== 1. One stream, straight ==");
    const rows: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const s = sandbox.appStream(sb, `app:${APP_PORT}`, { container: name(sb) });
      const t0 = performance.now();
      let first = 0;
      const chunks: Buffer[] = [];
      s.stdout.on("data", (d: Buffer) => {
        if (!first) first = performance.now();
        chunks.push(d);
      });
      s.stdin.write("GET / HTTP/1.1\r\nHost: app\r\n\r\n");
      while (!Buffer.concat(chunks).includes("stand-in app page")) await new Promise((r) => setTimeout(r, 5));
      const cold = { first: Math.round(first - t0), whole: Math.round(performance.now() - t0) };
      const n0 = Buffer.concat(chunks).length;
      const t1 = performance.now();
      let first2 = 0;
      s.stdout.on("data", () => {
        if (!first2) first2 = performance.now();
      });
      s.stdin.write("GET / HTTP/1.1\r\nHost: app\r\nConnection: close\r\n\r\n");
      while (Buffer.concat(chunks).length - n0 < 216) await new Promise((r) => setTimeout(r, 5));
      s.stdin.end();
      await s.done;
      const warm = { first: Math.round(first2 - t1), whole: Math.round(performance.now() - t1) };
      rows.push(`  run ${i}: cold (a new stream: container started) first byte ${cold.first} ms, whole page ${cold.whole} ms; warm (the same stream, a second request) first byte ${warm.first} ms, whole page ${warm.whole} ms; bytes ${n0} then ${Buffer.concat(chunks).length - n0}`);
    }
    for (const r of rows) say(r);
    for (let i = 1; i <= 5; i++) {
      // The app closes the connection itself at the end (Connection: close): the case that once lost the answer's end.
      const s = sandbox.appStream(sb, `app:${APP_PORT}`, { container: name(sb) });
      const r = await rawExchange(s, Buffer.from("GET /big HTTP/1.1\r\nHost: app\r\nConnection: close\r\n\r\n"));
      const a = parseAnswer(r.bytes);
      const same = sha(a.body) === sha(BIG);
      say(`  2 MB answer, try ${i} of 5 (the app closes the connection after it): HTTP ${a.status}, ${a.body.length} bytes in ${r.endMs} ms (first byte ${r.firstMs} ms; the stream ended at ${r.endedMs} ms); SHA-256 ${sha(a.body)}; expected ${sha(BIG)}: ${same ? "the same" : "DIFFERENT"}`);
      if (!same) code = 1;
    }
    {
      const s = sandbox.appStream(sb, `app:${APP_PORT}`, { container: name(sb) });
      const req = Buffer.concat([Buffer.from(`POST /echo HTTP/1.1\r\nHost: app\r\nContent-Type: application/octet-stream\r\nContent-Length: ${ALL_BYTES.length}\r\nConnection: close\r\n\r\n`), ALL_BYTES]);
      const r = await rawExchange(s, req);
      const a = parseAnswer(r.bytes);
      const sent = sha(ALL_BYTES);
      const same = a.headers["x-sha256"] === sent && sha(a.body) === sent;
      say(`  POST body of every byte value (${ALL_BYTES.length} bytes, 0x10 0x11 included 256 times): the app received SHA-256 ${a.headers["x-sha256"]}; echoed back ${sha(a.body)}; sent ${sent}: ${same ? "the same both ways" : "DIFFERENT"}`);
      if (!same) code = 1;
    }
    const l1 = await settle(sb);
    say(`  After step 1: stream containers left ${l1.containers.length}, docker compose clients left ${l1.clients.length} (checked ${l1.afterMs} ms after the last stream).`);

    say("\n== 2. Through the preview front and the pump socket ==");
    const p = new LivePreview({ port: FRONT_PORT, texts: texts(), openStream: () => traced(sandbox.appStream(sb, `app:${APP_PORT}`, { container: name(sb) })), onEvent: async () => undefined });
    await p.start();
    try {
      const o = await p.open({ projectId: "j1-000000000000", builderSession: "measure", appStartEventId: "1", appPort: APP_PORT });
      const e = await fetch(`http://127.0.0.1:${FRONT_PORT}/__builder/enter`, { method: "POST", headers: { origin: `http://127.0.0.1:${FRONT_PORT}`, "content-type": "application/x-www-form-urlencoded" }, body: `pass=${o.shown}`, redirect: "manual" });
      const cookie = (e.headers.get("set-cookie") ?? "").split(";")[0]!;
      say(`  Entered with the pass: HTTP ${e.status}. Front's user: ${p.frontUser()}.`);
      await new Promise((r) => setTimeout(r, 200));
      const get = async (path: string) => {
        const t0 = performance.now();
        const r = await fetch(`http://127.0.0.1:${FRONT_PORT}${path}`, { headers: { cookie } });
        const b = Buffer.from(await r.arrayBuffer());
        return { status: r.status, ms: Math.round(performance.now() - t0), bytes: b };
      };
      const cold = await get("/");
      const warm = await get("/");
      say(`  Through the front: cold ${cold.ms} ms (HTTP ${cold.status}), warm ${warm.ms} ms (HTTP ${warm.status}); streams opened so far ${p.openedStreams}.`);
      const big = await get("/big");
      say(`  2 MB through the front: HTTP ${big.status}, ${big.bytes.length} bytes, ${big.ms} ms, SHA-256 ${sha(big.bytes) === sha(BIG) ? "the same" : "DIFFERENT"}.`);
      if (sha(big.bytes) !== sha(BIG)) code = 1;
      const t6 = performance.now();
      const six = await Promise.all(Array.from({ length: 6 }, () => get("/")));
      say(`  Six requests at once: ${six.map((x) => `HTTP ${x.status} ${x.ms} ms`).join(", ")}; all in ${Math.round(performance.now() - t6)} ms; streams opened so far ${p.openedStreams}, open now ${p.activeStreams()}.`);
      // A client that leaves part-way through the 2 MB answer.
      await new Promise<void>((done) => {
        const req = http.get({ host: "127.0.0.1", port: FRONT_PORT, path: "/big", headers: { cookie } }, (res) => {
          let n = 0;
          res.on("data", (d: Buffer) => {
            n += d.length;
            if (n > 100_000) {
              req.destroy();
              say(`  A client left after ${n} bytes of the 2 MB answer.`);
              done();
            }
          });
        });
        req.on("error", () => undefined);
      });
      // A page that never ends, left by its client after 3 s.
      await new Promise<void>((done) => {
        const req = http.get({ host: "127.0.0.1", port: FRONT_PORT, path: "/hang", headers: { cookie } }, (res) => {
          res.on("data", () => undefined);
          setTimeout(() => {
            req.destroy();
            say(`  A page that never ends (HTTP ${res.statusCode}): its client left after 3 s.`);
            done();
          }, 3000);
        });
        req.on("error", () => undefined);
      });
      await p.closeAll("measurement");
      const l2 = await settle(sb, 100_000);
      say(`  After step 2 and the session's end: stream containers left ${l2.containers.length}, docker compose clients left ${l2.clients.length} (${l2.afterMs} ms after the session ended).`);
      say("  Each stream's life (ms from the run's start):");
      for (const l of life) say(`    ${l.replace(sb.projectName, "<project>")}`);
      if (l2.containers.length || l2.clients.length) code = 1;
    } finally {
      await p.stop();
    }

    say("\n== 3. The interface killed (SIGKILL) with streams open ==");
    const before3 = readdirSync("/tmp").filter((f) => f.startsWith("bpv-"));
    // The interface's own process (node with tsx's loader), not a wrapper: SIGKILL must reach the process that holds the streams.
    killedChild = spawn(process.execPath, ["--import", "tsx", import.meta.filename, "--child", sb.composeFile, sb.dir, sb.projectName], { cwd: builderDir, stdio: ["ignore", "pipe", "inherit"] });
    const info = await new Promise<{ pass: string; pid: number }>((ok, bad) => {
      killedChild!.stdout!.on("data", (d: Buffer) => {
        try {
          ok(JSON.parse(d.toString("utf8").trim().split("\n")[0]!) as { pass: string; pid: number });
        } catch {
          /* not yet */
        }
      });
      setTimeout(() => bad(new Error("the child did not start")), 30_000);
    });
    const e = await fetch(`http://127.0.0.1:${FRONT_PORT}/__builder/enter`, { method: "POST", headers: { origin: `http://127.0.0.1:${FRONT_PORT}`, "content-type": "application/x-www-form-urlencoded" }, body: `pass=${info.pass}`, redirect: "manual" });
    const cookie = (e.headers.get("set-cookie") ?? "").split(";")[0]!;
    await new Promise((r) => setTimeout(r, 200));
    const hanging = Array.from({ length: 3 }, () => http.get({ host: "127.0.0.1", port: FRONT_PORT, path: "/hang", headers: { cookie } }, (r) => r.resume()).on("error", () => undefined));
    await new Promise((r) => setTimeout(r, 5000));
    const during = await leftovers(sb);
    say(`  With three pages that never end open: stream containers ${during.containers.length}, docker compose clients ${during.clients.length}.`);
    killedChild.kill("SIGKILL");
    say(`  The interface (pid ${killedChild.pid}) killed with SIGKILL.`);
    const l3 = await settle(sb, 100_000);
    // The front ends when its channel to the interface closes; it is looked for for up to 10 s.
    let frontLeft = "";
    for (let i = 0; i < 20; i++) {
      frontLeft = (await run("ps", ["-o", "pid=", "-p", String(info.pid)]).catch(() => ({ stdout: "" }))).stdout.trim();
      if (!frontLeft) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const stale = readdirSync("/tmp").filter((f) => f.startsWith("bpv-") && !before3.includes(f));
    say(`  The killed interface's short folder in /tmp is left (it could not remove it): ${stale.length ? stale.join(", ") : "none"}. The next interface to start removes such a folder, once nothing listens on its pump socket (preview.ts, removeStaleFolders); removed here by the same function: ${removeStaleFolders("/tmp", 0).join(", ") || "none"}.`);
    say(`  After: stream containers left ${l3.containers.length} (${l3.containers.join(", ") || "none"}), docker compose clients left ${l3.clients.length}, checked ${l3.afterMs} ms after the kill; the front (pid ${info.pid}) ${frontLeft ? "STILL RUNNING" : "gone"}.`);
    for (const h of hanging) h.destroy();
    if (l3.containers.length || l3.clients.length || frontLeft) code = 1;
    killedChild = null;

    say("\n== 4. compose run against exec (time to a first byte, a new connection each) ==");
    for (let i = 1; i <= 3; i++) {
      const t0 = performance.now();
      const s = sandbox.appStream(sb, `app:${APP_PORT}`, { container: name(sb) });
      const r = await rawExchange(s, Buffer.from("GET / HTTP/1.1\r\nHost: app\r\nConnection: close\r\n\r\n"));
      const t1 = performance.now();
      const ex = spawn("docker", ["compose", "-f", sb.composeFile, "exec", "-T", "app", "node", "-e", "const s=require('net').connect(Number(process.argv[2]),process.argv[1]);s.on('connect',()=>{process.stdin.pipe(s);s.pipe(process.stdout)});s.on('close',()=>process.exit(0))", "127.0.0.1", String(APP_PORT)], { env: dockerEnv(sb) });
      let first = 0;
      ex.stdout.on("data", () => {
        if (!first) first = performance.now();
      });
      ex.stdin.write("GET / HTTP/1.1\r\nHost: app\r\nConnection: close\r\n\r\n");
      await new Promise((r) => ex.on("close", r));
      say(`  run ${i}: compose run first byte ${r.firstMs} ms (whole ${Math.round(t1 - t0)} ms); exec into the running app first byte ${Math.round(first - t1)} ms. (Exec is measured only: it runs inside a container the app controls, which the design does not use.)`);
    }
  } catch (err) {
    say(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    code = 1;
  } finally {
    killedChild?.kill("SIGKILL");
    await sandbox.destroy(sb).catch(() => undefined);
    for (const i of images) await run("docker", ["image", "rm", "-f", i], { env: dockerEnv(sb) }).catch(() => undefined);
    const left = await leftovers(sb);
    rmSync(dir, { recursive: true, force: true });
    say(`\nRemoved: the sandbox, its images and its folder. Stream containers left: ${left.containers.length}; compose clients left: ${left.clients.length}.`);
    say(`RESULT: ${code === 0 ? "every check passed" : "NOT every check passed"}.`);
    writeFileSync(join(outDir, "m2-streams.txt"), out.join("\n").replaceAll(dir, "<sandbox folder>") + "\n");
  }
  return code;
}

if (process.argv[2] === "--child") await child(process.argv[3]!, process.argv[4]!, process.argv[5]!);
else process.exitCode = await main();
