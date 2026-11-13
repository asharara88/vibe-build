/**
 * Package J3, live (final design, section 6, M3; build brief, "Live"): example 1 built by the scripted engine in a real
 * sandbox on the development profile, its app running on the project's private networks, and the live preview in this
 * process (its front forked as the interface forks it, on 127.0.0.1:4041). The live camera (the approved runner image, in
 * the project's own `acceptance` service, on `front` only, no video, no trace) walks the app through the whole chain:
 * its browser -> 127.0.0.1:4030 in its container -> the camera socket -> the front -> the pump socket -> a `check`
 * container -> the app.
 *
 * Measured and checked: the owner's walk (gate, pass, the app's sign-in, My requests, a new request, the list, Arabic,
 * 390 px, sign-out, leave) with Chromium's checks; storage gone after a new entry; each mapping turned off in turn
 * (Host, Origin, Referer, Sec-Fetch-*, the cookie prefix) to show which the app needs and that its own check then
 * refuses; the content-security-policy's `sandbox` value tried. The refusals: no pass; a crafted cross-site POST, which
 * opens no stream; after the app stops (the project closed).
 *
 * Never skipped (as acceptance-live.test.ts): without Docker or the approved browser zip it fails in plain words.
 * Before it starts, 127.0.0.1:13161 (the image build's port) and 4041 must be free; it waits for them, and never stops
 * another project. With J3_M3_OUT set, it writes what it measured, and the camera's photographs, into that folder.
 * Made-up data only. No model is called.
 */
import { chmodSync, chownSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveAcceptanceProblems } from "../src/acceptance/prerequisites.js";
import { RUNNER_UID } from "../src/acceptance/runner-image.js";
import { openStore } from "../src/acceptance/store.js";
import { example1Sandboxes, J1_BUILD_PROXY_PORT, liveCamera, streamNetworkProblem } from "../src/orchestrator/example-1-adapter.js";
import { EV, Journey } from "../src/orchestrator/journey.js";
import { JourneyJobs } from "../src/orchestrator/journey-jobs.js";
import { appendEvent, listEvents } from "../src/store/events.js";
import { frontTexts } from "../src/web/pages.js";
import { cameraSocket, LivePreview } from "../src/web/preview.js";
import type { MappingControls } from "../src/web/preview-rules.ts";
import { portFree } from "../scripts/example-1-sandbox.js";
import { testPool } from "./helpers.js";

const run = promisify(execFile);
const FRONT_PORT = 4041;
const OUT = process.env.J3_M3_OUT ?? null;
const notes: string[] = [];
const note = (s: string) => {
  notes.push(s);
  console.log(`[J3 live] ${s}`);
};

let pool: pg.Pool;
let dataDir: string;
let work: string;
let jobs: JourneyJobs;
let journey: Journey;
let preview: LivePreview;
let camera: Awaited<ReturnType<typeof cameraSocket>>;
let projectId = "";
let missing: string[] = [];

/** Wait until a port on 127.0.0.1 is free (another project's machine side may hold it); never stop what holds it. */
async function waitFree(port: number, label: string): Promise<void> {
  const end = Date.now() + 20 * 60_000;
  while (!(await portFree(port))) {
    if (Date.now() > end) throw new Error(`127.0.0.1:${port} (${label}) stayed in use for 20 minutes; this live test did not start.`);
    note(`waiting: 127.0.0.1:${port} (${label}) is in use by another program`);
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

/** A folder of the runner's user, with the pass files and the sample password, mounted read-only into the camera. */
function secrets(): { passDir: string; sampleFile: string; outDir: string; setPass: (n: number, pass: string) => void } {
  const d = mkdtempSync(join(work, "cam-"));
  const passDir = join(d, "live");
  const outDir = join(d, "out");
  mkdirSync(passDir, { mode: 0o500 });
  mkdirSync(outDir, { mode: 0o700 });
  const sampleFile = join(d, "sample-password");
  writeFileSync(sampleFile, jobs.sampleSignIn(projectId).password, { mode: 0o400 });
  const own = (p: string) => (process.getuid?.() === 0 ? chownSync(p, RUNNER_UID, RUNNER_UID) : chmodSync(p, 0o777));
  for (const p of [passDir, outDir, sampleFile]) own(p);
  if (process.getuid?.() !== 0) chmodSync(sampleFile, 0o444);
  return {
    passDir,
    sampleFile,
    outDir,
    setPass: (n, pass) => {
      const f = join(passDir, `pass-${n}`);
      writeFileSync(f, pass, { mode: 0o400 });
      if (process.getuid?.() === 0) chownSync(f, RUNNER_UID, RUNNER_UID);
      else chmodSync(f, 0o444);
    },
  };
}

/** One run of the live camera with a fresh pass; returns its parsed lines. `onNeed` answers a request for pass-2. */
async function cameraRun(walk: "owner" | "storage" | "request", o: { onNeed?: (setPass: (n: number, pass: string) => void) => Promise<void> } = {}) {
  const s = secrets();
  const opened = await jobs.openLive(projectId, "live-test-builder-session");
  await journey.waitForJob();
  s.setPass(1, opened.shown);
  const lines: Array<Record<string, unknown>> = [];
  const raw: string[] = [];
  const waits: Promise<void>[] = [];
  const end = await liveCamera(jobs.handle(projectId)!.sb, {
    cameraDir: camera.dir,
    outDir: s.outDir,
    passDir: s.passDir,
    sampleFile: s.sampleFile,
    env: { WALK: walk },
    onLine: (l) => {
      let o2: Record<string, unknown>;
      try {
        o2 = JSON.parse(l) as Record<string, unknown>;
      } catch {
        raw.push(l);
        return;
      }
      lines.push(o2);
      if (o2.kind === "need" && o.onNeed) waits.push(o.onNeed(s.setPass));
    },
  });
  await Promise.all(waits);
  if (end.code !== 0) note(`the live camera (${walk}) ended with exit code ${end.code}; its error output: ${end.stderrTail.trim().split("\n").filter((l) => !/^\s+at /.test(l)).join(" | ").slice(0, 1500)}`);
  for (const l of raw) note(`the live camera (${walk}) printed a line that is not JSON: ${l.slice(0, 300)}`);
  return { end, lines, outDir: s.outDir, checks: lines.filter((l) => l.kind === "check") as Array<{ name: string; ok: boolean; detail: string }> };
}

beforeAll(async () => {
  missing = await liveAcceptanceProblems();
  if (missing.length) return;
  await waitFree(J1_BUILD_PROXY_PORT, "the image build's port of journey sandboxes");
  await waitFree(FRONT_PORT, "the automated run's preview front");
  pool = await testPool();
  work = mkdtempSync(join(tmpdir(), "j3-live-"));
  dataDir = openStore(join(work, "data")).dataDir;
  const box: { jobs?: JourneyJobs } = {};
  journey = new Journey({ pool, dataDir, cleanupProject: (id, rec) => box.jobs!.cleanup(id, rec) });
  jobs = new JourneyJobs({ journey, sandboxes: example1Sandboxes() });
  box.jobs = jobs;
  preview = new LivePreview({ port: FRONT_PORT, texts: frontTexts(), allowControls: true, openStream: (id) => jobs.openStream(id), onEvent: async (id, kind, payload) => void (await appendEvent(pool, id, kind, payload)) });
  await preview.start();
  jobs.attachPreview(preview);
  camera = await cameraSocket(FRONT_PORT);
}, 25 * 60_000);

afterAll(async () => {
  if (missing.length) return;
  if (projectId) await journey.closeProject(projectId).catch(() => undefined);
  await preview?.stop().catch(() => undefined);
  await camera?.close().catch(() => undefined);
  await pool?.end();
  if (OUT) writeFileSync(join(OUT, "m3-measurements.txt"), notes.join("\n").replaceAll(work ?? "\u0000", "<run folder>") + "\n");
  if (work) rmSync(work, { recursive: true, force: true });
}, 300_000);

describe("J3, live: the scripted app through the whole chain (example 1, development profile)", () => {
  it("its prerequisites are here: Docker answers, and the approved browser zip is in BUILDER_BROWSER_CACHE's folder", () => {
    if (missing.length) throw new Error(`This live test cannot run, so it fails (it is never skipped). Missing: ${missing.join(" ")}`);
  });

  it(
    "example 1 is built and started; the check service reads as on front alone; the live app opens for it",
    async () => {
      expect(missing).toEqual([]);
      projectId = await journey.createProject({ name: "Leave requests (made-up, J3 live)", cap: "5", brief: "I need an app where staff can request leave and managers approve it" });
      await journey.continueWithExample(projectId);
      await journey.answerRestFromSheet(projectId);
      await journey.confirmBrief(projectId);
      await journey.confirmPlan(projectId);
      await jobs.buildStep(projectId, "01-data");
      await journey.waitForJob();
      await jobs.approve(projectId, "01-data");
      await journey.waitForJob();
      const t0 = Date.now();
      await jobs.approve(projectId, "02-submitter-screen");
      await journey.waitForJob();
      const s = await journey.state(projectId);
      expect(s.jobs.filter((j) => j.kind === "preview").at(-1)?.state, s.jobs.at(-1)?.reason ?? "").toBe("finished");
      note(`example 1 built, started and photographed by the app camera in ${Math.round((Date.now() - t0) / 1000)} s`);
      expect(await streamNetworkProblem(jobs.handle(projectId)!.sb)).toBeNull();
    },
    30 * 60_000,
  );

  it(
    "the owner's walk through the preview, with Chromium's checks: every check passes, nothing names app:3161, every cookie carries the prefix",
    async () => {
      expect(projectId).not.toBe("");
      const t0 = Date.now();
      const r = await cameraRun("owner");
      note(`owner's walk: exit ${r.end.code}, ${Math.round((Date.now() - t0) / 1000)} s; checks ${r.checks.filter((c) => c.ok).length} passed, ${r.checks.filter((c) => !c.ok).length} failed`);
      for (const c of r.checks) note(`  ${c.ok ? "PASS" : "FAIL"} ${c.name}${c.ok ? "" : `: ${c.detail}`}`);
      for (const l of r.lines.filter((x) => ["fact", "timing", "answers", "blocked", "csp"].includes(String(x.kind)))) note(`  ${JSON.stringify(l)}`);
      if (OUT) {
        mkdirSync(join(OUT, "screens"), { recursive: true });
        for (const f of readdirSync(r.outDir).filter((x) => /^\d\d-[a-z0-9-]+\.png$/.test(x))) copyFileSync(join(r.outDir, f), join(OUT, "screens", f));
      }
      expect(r.checks.filter((c) => !c.ok)).toEqual([]);
      expect(r.checks.length).toBeGreaterThan(15);
      expect(r.end.code).toBe(0);
      expect(r.lines.filter((l) => l.kind === "shot").length).toBe(10);
      const entered = await listEvents(pool, projectId, EV.liveEntered);
      note(`  live_entered: ${JSON.stringify(entered.at(-1)?.payload)}`);
      expect(entered.at(-1)?.payload.sec_fetch_site_sent).toBe(true);
    },
    15 * 60_000,
  );

  it(
    "after a new entry, the page's storage is gone (Clear-Site-Data, in Chromium)",
    async () => {
      const r = await cameraRun("storage", {
        onNeed: async (setPass) => {
          const again = await jobs.openLive(projectId, "live-test-builder-session");
          await journey.waitForJob();
          setPass(2, again.shown);
        },
      });
      for (const c of r.checks) note(`storage: ${c.ok ? "PASS" : "FAIL"} ${c.name}${c.ok ? "" : `: ${c.detail}`}`);
      expect(r.checks.filter((c) => !c.ok)).toEqual([]);
      expect(r.checks.map((c) => c.name)).toContain("after a new entry, the page's storage is gone (Clear-Site-Data)");
      expect(r.end.code).toBe(0);
    },
    10 * 60_000,
  );

  it(
    "each mapping turned off in turn shows which the app needs, and that its own check then refuses; the policy's sandbox value is tried",
    async () => {
      const rows: string[] = [];
      const tries: Array<[string, MappingControls, boolean]> = [
        ["all mappings on, the policy's sandbox value on (as built)", {}, true],
        ["Host not mapped", { host: true }, true],
        ["Origin not mapped", { origin: true }, true],
        ["Referer not mapped", { referer: true }, true],
        ["Sec-Fetch-* not passed", { secFetch: true }, true],
        ["no cookie prefix", { cookiePrefix: true }, true],
        ["the policy's sandbox value off", {}, false],
      ];
      const results: Record<string, { signedIn: string; saved: string; posts: unknown }> = {};
      try {
        for (const [label, controls, sandboxValue] of tries) {
          preview.controls(controls, sandboxValue);
          const r = await cameraRun("request");
          const fact = (n: string) => String(r.lines.find((l) => l.kind === "fact" && l.name === n)?.value ?? "not reached");
          const posts = r.lines.find((l) => l.kind === "posts")?.posts ?? [];
          results[label] = { signedIn: fact("signed in"), saved: fact("request saved"), posts };
          rows.push(`| ${label} | ${fact("signed in")} | ${fact("request saved")} | ${(posts as Array<{ path: string; status: number; action: boolean }>).map((p) => `${p.action ? "action " : ""}${p.path} ${p.status}`).join("; ")} |`);
        }
      } finally {
        preview.controls({}, true);
      }
      note("mappings (M3): what the app does with each one turned off, through the browser");
      note("| Turned off | Signed in | Request saved | The POSTs the browser made (status as the browser got it) |");
      note("| --- | --- | --- | --- |");
      for (const r of rows) note(r);
      expect(results["all mappings on, the policy's sandbox value on (as built)"]).toMatchObject({ signedIn: "true", saved: "true" });
      // The app's own origin checks refuse when the Origin, or the Host, is the preview's.
      expect(results["Origin not mapped"]!.signedIn).toBe("false");
      expect(results["Host not mapped"]!.saved).not.toBe("true");
    },
    20 * 60_000,
  );

  it("the refusals: no pass gives only the gate; a crafted cross-site POST opens no stream; after the project closes (the app stopped), the live app is gone", async () => {
    const base = `http://127.0.0.1:${FRONT_PORT}`;
    const streamsBefore = preview.openedStreams;
    // A visitor with no session gets the front's own page (no live app, or the gate), and no stream is opened.
    expect(await (await fetch(`${base}/en/home`)).text()).toMatch(/No live app now|__builder\/enter|No pass is open now/);
    expect(preview.openedStreams).toBe(streamsBefore);
    const opened = await jobs.openLive(projectId, "live-test-builder-session");
    await journey.waitForJob();
    const e = await fetch(`${base}/__builder/enter`, { method: "POST", headers: { origin: base, "content-type": "application/x-www-form-urlencoded" }, body: `pass=${opened.shown}`, redirect: "manual" });
    expect(e.status).toBe(303);
    const cookie = (e.headers.get("set-cookie") ?? "").split(";")[0]!;
    await new Promise((r) => setTimeout(r, 200));
    const before = preview.openedStreams;
    const crafted = await fetch(`${base}/en/my-requests/new`, { method: "POST", headers: { cookie, origin: "https://made-up-attacker.example", "sec-fetch-site": "cross-site", "content-type": "text/plain" }, body: "[]" });
    expect(crafted.status).toBe(403);
    expect(preview.openedStreams).toBe(before);
    note(`refusals: no pass -> the gate; a crafted cross-site POST -> HTTP ${crafted.status}, streams opened by it: ${preview.openedStreams - before}`);
    await journey.closeProject(projectId);
    expect(preview.status(projectId)).toBeNull();
    expect(await (await fetch(`${base}/en/home`, { headers: { cookie } })).text()).toMatch(/No live app now/);
    await expect(jobs.openLive(projectId, "live-test-builder-session")).rejects.toThrow(/stopped or closed/);
    const left = (await run("docker", ["ps", "-a", "--filter", `label=com.docker.compose.project=builder_${projectId}`, "--format", "{{.Names}}"])).stdout.trim();
    note(`after the project closed: its containers left: ${left || "none"}; live sessions open: ${preview.session() ? 1 : 0}`);
    expect(left).toBe("");
    const closed = (await listEvents(pool, projectId, EV.liveClosed)).map((x) => String(x.payload.reason));
    note(`live_closed reasons, in order: ${closed.join(", ")}`);
    expect(closed.at(-1)).toBe("project_closed");
    projectId = projectId ? projectId : "";
    expect(existsSync(camera.socket)).toBe(true);
  }, 300_000);
});
