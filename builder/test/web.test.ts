/**
 * Package J1: the builder's own interface (src/web), through hono's request function: no browser, no network,
 * no container. The database is the test database (BUILDER_TEST_DATABASE_URL); the data folder is a fresh
 * temporary folder outside the repository.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openStore, sha256 } from "../src/acceptance/store.js";
import { Journey } from "../src/orchestrator/journey.js";
import { appendEvent } from "../src/store/events.js";
import { createProject } from "../src/store/projects.js";
import { createWebApp, PUBLIC_PATHS } from "../src/web/app.js";
import { PASSWORD_FILE, PasswordState, passwordFromSettings, Sessions, SignInLimiter, digestPassword } from "../src/web/auth.js";
import { journeyFolder } from "../src/web/files.js";
import { holdInstanceLock, readSettings, SCRUBBED } from "../src/web/main.js";
import { messageKeys, t } from "../src/web/pages.js";
import { testPool, TEST_DB_URL, uniqueId } from "./helpers.js";

const builderDir = resolve(import.meta.dirname, "..");
const ORIGIN = "http://localhost";
/** Made up for these tests; never a real password. */
const PASSWORD = "made-up-test-password-" + uniqueId("pw");

let pool: pg.Pool;
let dataDir: string;
let journey: Journey;

beforeAll(async () => {
  pool = await testPool();
  dataDir = openStore(mkdtempSync(join(tmpdir(), "builder-web-"))).dataDir;
  journey = new Journey({ pool, dataDir });
});
afterAll(async () => {
  await pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

function makeApp(o: { password?: PasswordState; limiter?: SignInLimiter } = {}) {
  const sessions = new Sessions();
  const app = createWebApp({ journey, password: o.password ?? new PasswordState("env", digestPassword(PASSWORD), null), sessions, limiter: o.limiter ?? new SignInLimiter(), dataDir });
  return { app, sessions };
}

type App = ReturnType<typeof makeApp>["app"];
const form = (data: Record<string, string | string[]>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
  return p.toString();
};
const post = (app: App, path: string, data: Record<string, string | string[]> = {}, o: { cookie?: string; origin?: string | null } = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(o.origin === null ? {} : { origin: o.origin ?? ORIGIN }), ...(o.cookie ? { cookie: o.cookie } : {}) },
    body: form(data),
  });
const get = (app: App, path: string, cookie?: string) => app.request(path, { headers: cookie ? { cookie } : {} });

async function signIn(app: App): Promise<string> {
  const r = await post(app, "/sign-in", { password: PASSWORD });
  expect(r.status).toBe(303);
  const set = r.headers.get("set-cookie") ?? "";
  const m = /builder_session=([^;]+)/.exec(set);
  expect(m).not.toBeNull();
  return `builder_session=${m![1]}`;
}

async function eventCount(): Promise<number> {
  return Number((await pool.query<{ n: string }>("select count(*)::text as n from events")).rows[0]!.n);
}
async function projectCount(): Promise<number> {
  return Number((await pool.query<{ n: string }>("select count(*)::text as n from projects")).rows[0]!.n);
}

/** Every route the app has, with its parameters filled in. */
function routes(app: App, id: string, eventId = "1"): Array<{ method: string; path: string }> {
  const seen = new Set<string>();
  const out: Array<{ method: string; path: string }> = [];
  for (const r of app.routes) {
    if (r.method === "ALL") continue;
    const path = r.path.replace(":eventId", eventId).replace(":id", id);
    const key = `${r.method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ method: r.method, path });
  }
  return out;
}

describe("J1 interface: the sign-in guard", () => {
  it("every route without a session gives only sign-in (a redirect to it, or the sign-in page itself); nothing is written", async () => {
    const { app } = makeApp();
    const id = await journey.createProject({ name: "Guard test (made-up)", cap: "5", brief: "Made-up brief for the guard test." });
    const before = await eventCount();
    const all = routes(app, id);
    expect(all.length).toBeGreaterThan(15);
    for (const r of all) {
      const res = r.method === "GET" ? await get(app, r.path) : await post(app, r.path);
      const body = await res.text();
      if (PUBLIC_PATHS.has(r.path)) {
        if (r.path === "/sign-in" && r.method === "GET") expect(body).toContain('action="/sign-in"');
        continue;
      }
      expect(res.status, `${r.method} ${r.path}`).toBe(303);
      expect(res.headers.get("location"), `${r.method} ${r.path}`).toBe("/sign-in");
      expect(body).not.toContain("Guard test");
    }
    expect(await eventCount()).toBe(before);
  });

  it("the public routes are only sign-in, first run, the language switch and the stylesheet", () => {
    expect([...PUBLIC_PATHS].sort()).toEqual(["/language", "/setup", "/sign-in", "/static/app.css"]);
  });

  it("a wrong password is refused, with no session; the right one gives a session cookie that is HttpOnly, SameSite=Strict, Path=/", async () => {
    const { app } = makeApp();
    const bad = await post(app, "/sign-in", { password: "not-the-password-at-all" });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("set-cookie")).toBeNull();
    expect(await bad.text()).toContain(t("en", "sign_in.wrong"));
    const ok = await post(app, "/sign-in", { password: PASSWORD });
    expect(ok.status).toBe(303);
    const set = ok.headers.get("set-cookie")!;
    expect(set).toMatch(/builder_session=[A-Za-z0-9_-]{43};/);
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Strict/);
    expect(set).toMatch(/Path=\//);
  });

  it("lock-out for the whole server: after 5 failures even the right password is refused, and the next lock-out is twice as long", async () => {
    const limiter = new SignInLimiter(5, 400, 10_000);
    const { app } = makeApp({ limiter });
    for (let i = 0; i < 4; i++) expect((await post(app, "/sign-in", { password: "wrong-wrong-wrong" })).status).toBe(401);
    expect((await post(app, "/sign-in", { password: "wrong-wrong-wrong" })).status).toBe(429);
    const locked = await post(app, "/sign-in", { password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.headers.get("set-cookie")).toBeNull();
    // The limiter on its own clock: 400 ms, then 800 ms.
    const l = new SignInLimiter(5, 400, 10_000);
    for (let i = 0; i < 5; i++) l.fail(1_000);
    expect(l.lockedFor(1_000)).toBe(400);
    expect(l.lockedFor(1_400)).toBe(0);
    for (let i = 0; i < 5; i++) l.fail(2_000);
    expect(l.lockedFor(2_000)).toBe(800);
    l.succeed();
    for (let i = 0; i < 5; i++) l.fail(5_000);
    expect(l.lockedFor(5_000)).toBe(400);
  });

  it("sign-out ends the session on the server; an expired session is refused", async () => {
    const { app, sessions } = makeApp();
    const cookie = await signIn(app);
    expect((await get(app, "/projects", cookie)).status).toBe(200);
    expect((await post(app, "/sign-out", {}, { cookie })).status).toBe(303);
    const after = await get(app, "/projects", cookie);
    expect(after.status).toBe(303);
    expect(after.headers.get("location")).toBe("/sign-in");
    const short = new Sessions(1_000);
    const sid = short.create(0);
    expect(short.valid(sid, 999)).toBe(true);
    expect(short.valid(sid, 1_000)).toBe(false);
    expect(sessions.valid("made-up-session-id")).toBe(false);
  });

  it("a cross-origin POST is refused (403), signed in or not, and writes nothing", async () => {
    const { app } = makeApp();
    const cookie = await signIn(app);
    const before = await projectCount();
    const r1 = await post(app, "/projects", { name: "Cross-site (made-up)", cap: "5", brief: "x" }, { cookie, origin: "http://evil.example" });
    expect(r1.status).toBe(403);
    const r2 = await post(app, "/projects", { name: "No origin (made-up)", cap: "5", brief: "x" }, { cookie, origin: null });
    expect(r2.status).toBe(403);
    const r3 = await post(app, "/sign-in", { password: PASSWORD }, { origin: "http://evil.example" });
    expect(r3.status).toBe(403);
    expect(r3.headers.get("set-cookie")).toBeNull();
    expect(await projectCount()).toBe(before);
  });
});

describe("J1 interface: pages", () => {
  it("no GET changes anything: every GET route at every stage leaves the events and projects as they were", async () => {
    const { app } = makeApp();
    const cookie = await signIn(app);
    const id = await journey.createProject({ name: "GET test (made-up)", cap: "5", brief: "Made-up brief." });
    const stages = [
      async () => undefined,
      () => journey.continueWithExample(id),
      () => journey.answerRestFromSheet(id),
      () => journey.confirmBrief(id),
      () => journey.confirmPlan(id),
    ];
    for (const step of stages) {
      await step();
      const events = await eventCount();
      const projects = await projectCount();
      for (const r of routes(app, id).filter((x) => x.method === "GET")) {
        const res = await get(app, `${r.path}?lang=ar`, cookie);
        expect([200, 303, 404], r.path).toContain(res.status);
        await res.arrayBuffer();
        const en = await get(app, r.path, cookie);
        await en.arrayBuffer();
      }
      expect(await eventCount()).toBe(events);
      expect(await projectCount()).toBe(projects);
    }
  });

  it("every page has the content-security-policy (no script), nosniff and no-store; no page holds a script; the mode line is on every page, in both languages", async () => {
    const { app } = makeApp();
    const cookie = await signIn(app);
    const id = await journey.createProject({ name: "Headers test (made-up)", cap: "5", brief: "Made-up brief." });
    await journey.continueWithExample(id);
    const pages = ["/sign-in", ...routes(app, id).filter((r) => r.method === "GET" && !r.path.endsWith(".css") && !r.path.includes("/files/") && r.path !== "/setup" && r.path !== "/").map((r) => r.path), "/no-such-page"];
    for (const lang of ["en", "ar"] as const) {
      for (const p of pages) {
        const res = await get(app, `${p}?lang=${lang}`, p === "/sign-in" ? undefined : cookie);
        const csp = res.headers.get("content-security-policy") ?? "";
        expect(csp, p).toContain("script-src 'none'");
        expect(csp, p).toContain("default-src 'none'");
        expect(csp, p).toContain("form-action 'self'");
        expect(res.headers.get("x-content-type-options"), p).toBe("nosniff");
        expect(res.headers.get("cache-control"), p).toBe("no-store");
        if (res.status === 303) continue;
        const body = await res.text();
        expect(body.toLowerCase(), p).not.toContain("<script");
        expect(body, p).toContain(t(lang, "mode.line"));
        expect(body, p).toContain(`lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"`);
      }
    }
  });

  it("the brief is escaped on display", async () => {
    const { app } = makeApp();
    const cookie = await signIn(app);
    const brief = `<script>alert("made-up")</script> & <img src=x onerror=1>`;
    const r = await post(app, "/projects", { name: `<b>Name</b> (made-up)`, cap: "5", brief }, { cookie });
    expect(r.status).toBe(303);
    const page = await (await get(app, r.headers.get("location")!, cookie)).text();
    expect(page).toContain("&lt;script&gt;alert(&quot;made-up&quot;)&lt;/script&gt; &amp; &lt;img src=x onerror=1&gt;");
    expect(page).toContain("&lt;b&gt;Name&lt;/b&gt; (made-up)");
    expect(page).not.toContain("<script>");
    expect(page).not.toContain("<img src=x");
    expect(page).not.toContain("<b>Name</b>");
  });

  it("a brief over 2,000 characters, a cap that is not dollars, or an empty name is refused and nothing is made", async () => {
    const { app } = makeApp();
    const cookie = await signIn(app);
    const before = await projectCount();
    for (const bad of [
      { name: "Long (made-up)", cap: "5", brief: "x".repeat(2_001) },
      { name: "Cap (made-up)", cap: "five", brief: "x" },
      { name: "Cap (made-up)", cap: "1e3", brief: "x" },
      { name: "   ", cap: "5", brief: "x" },
    ]) {
      const r = await post(app, "/projects", bad, { cookie });
      expect(r.status).toBe(400);
    }
    expect(await projectCount()).toBe(before);
  });

  it("the questions are a chat of at most three per turn, with 'something else'; an answer other than the sheet's says the scripted build always builds example 1's", async () => {
    const { app } = makeApp();
    const cookie = await signIn(app);
    const id = await journey.createProject({ name: "Chat test (made-up)", cap: "5", brief: "Made-up brief." });
    expect((await post(app, `/projects/${id}/continue`, {}, { cookie })).status).toBe(303);
    let page = await (await get(app, `/projects/${id}/questions`, cookie)).text();
    expect(page.match(/<fieldset data-question=/g)).toHaveLength(2);
    expect(page).toContain(t("en", "questions.something_else"));
    expect(page).toContain(t("en", "questions.their_call"));
    // Turn 1: the sheet's answer for q01, "something else" for q02.
    expect((await post(app, `/projects/${id}/answers`, { turn: "0", a_q01: "0", a_q02: "else", else_q02: "A made-up answer" }, { cookie })).status).toBe(303);
    page = await (await get(app, `/projects/${id}/questions`, cookie)).text();
    expect(page).toContain("A made-up answer");
    expect(page.match(/data-differs/g)).toHaveLength(1);
    expect(page.match(/<fieldset data-question=/g)).toHaveLength(3);
    expect(page).toContain("Recommended: Two or three. Reason: builds reliably (not yet measured); more roles rarely needed for version one");
    expect(page).toContain(t("en", "questions.available_later"));
    const ar = await (await get(app, `/projects/${id}/questions?lang=ar`, cookie)).text();
    expect(ar).toContain("كم نوعاً من المستخدمين؟");
    // Answering an old turn again is refused.
    expect((await post(app, `/projects/${id}/answers`, { turn: "0", a_q01: "1", a_q02: "1" }, { cookie })).status).toBe(409);
    const s = await journey.state(id);
    const q2 = s.events.find((e) => e.kind === "intake.answer" && e.payload.question === "q02")!;
    expect(q2.payload).toMatchObject({ by: "owner", matches_sheet: false, something_else_logged: true, answer: { something_else: "A made-up answer" } });
    // The rest from the sheet, then the proposed app.
    expect((await post(app, `/projects/${id}/answer-rest`, {}, { cookie })).status).toBe(303);
    expect((await journey.state(id)).stage).toBe("brief_review");
    const proposal = await (await get(app, `/projects/${id}/proposal`, cookie)).text();
    expect(proposal).toContain("Confirm this brief, or tell me what to change. Nothing is built until you confirm.");
    expect(proposal.match(/<li>As /g)).toHaveLength(6);
    expect(proposal).toContain("Company email sign-in (single sign-on)");
    expect(proposal).toContain("Working days");
  });

  it("the record lists every event of the project in id order", async () => {
    const { app } = makeApp();
    const cookie = await signIn(app);
    const id = await journey.createProject({ name: "Record test (made-up)", cap: "5", brief: "Made-up brief." });
    await journey.continueWithExample(id);
    await journey.answerRestFromSheet(id);
    const page = await (await get(app, `/projects/${id}/record`, cookie)).text();
    const ids = [...page.matchAll(/data-event="(\d+)"/g)].map((m) => Number(m[1]));
    const events = (await journey.state(id)).events;
    expect(ids).toEqual(events.map((e) => Number(e.id)));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids).toHaveLength(22);
  });

  it("the cost panel reads the budget: cap, spent $0.00 with its sentence, no step held, no freeze, an empty unreconciled list", async () => {
    const { app } = makeApp();
    const cookie = await signIn(app);
    const id = await journey.createProject({ name: "Cost test (made-up)", cap: "5.00", brief: "Made-up brief." });
    const before = await eventCount();
    const page = await (await get(app, `/projects/${id}/cost?lang=ar`, cookie)).text();
    expect(page).toContain('<td data-cap>$5.00</td>');
    expect(page).toContain('<td data-spent>$0.00</td>');
    expect(page).toContain(t("ar", "cost.zero"));
    expect(page).toContain("data-no-freeze");
    expect(page).toContain("data-unreconciled-empty");
    expect(page).toContain(t("ar", "cost.no_steps"));
    expect(await eventCount()).toBe(before);
  });

  it("a project id not made by the journey is not found", async () => {
    const { app } = makeApp();
    const cookie = await signIn(app);
    const other = uniqueId("p_web_other");
    await createProject(pool, { id: other, name: "Other (made-up)", capUsd: 5 });
    for (const p of [`/projects/${other}`, `/projects/${other}/record`, `/projects/j1-zzzzzzzzzzzz/record`]) expect((await get(app, p, cookie)).status).toBe(404);
    expect((await post(app, `/projects/${other}/continue`, {}, { cookie })).status).toBe(404);
  });
});

describe("J1 interface: files served", () => {
  it("serves only a file an event names, inside its folder, with its SHA-256; anything else is not found", async () => {
    const { app } = makeApp();
    const cookie = await signIn(app);
    const id = await journey.createProject({ name: "Files test (made-up)", cap: "5", brief: "Made-up brief." });
    const shots = journeyFolder(dataDir, id, "shots");
    mkdirSync(shots, { recursive: true });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("made-up image bytes")]);
    const good = join(shots, "01.png");
    writeFileSync(good, png);
    const outside = join(dataDir, "outside.png");
    writeFileSync(outside, png);
    const link = join(shots, "link.png");
    symlinkSync(outside, link);
    const name = (path: string, hash = sha256(png)) => appendEvent(pool, id, "journey.screenshot", { file: { path, sha256: hash } });
    const ok = await name(good);
    const res = await get(app, `/projects/${id}/files/${ok.id}`, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);
    const refused = [
      (await name(outside)).id, // outside the folder
      (await name(link)).id, // a link out of the folder
      (await name(join(shots, "..", "..", "..", "outside.png"))).id, // a path that climbs out
      (await name(good, "0".repeat(64))).id, // the wrong SHA-256
      (await name(join(shots, "missing.png"))).id, // not there
      (await appendEvent(pool, id, "intake.note", { file: { path: good, sha256: sha256(png) } })).id, // an event of another kind
      "999999999", // no such event
    ];
    for (const e of refused) {
      const r = await get(app, `/projects/${id}/files/${e}`, cookie);
      expect(r.status, e).toBe(404);
      expect(r.headers.get("content-type"), e).toMatch(/^text\/html/);
    }
    // An event of another project, asked for under this one.
    const id2 = await journey.createProject({ name: "Files test 2 (made-up)", cap: "5", brief: "Made-up brief." });
    expect((await get(app, `/projects/${id2}/files/${ok.id}`, cookie)).status).toBe(404);
    // A file not named by any event is never reachable by its path.
    expect((await get(app, `/projects/${id}/files/01.png`, cookie)).status).toBe(404);
  });
});

describe("J1 interface: first run and start checks", () => {
  it("first run: the first visitor sees 'Choose your password'; its digest is written with mode 0600; then the ordinary sign-in; a second choice is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "builder-web-first-"));
    try {
      const password = passwordFromSettings({ BUILDER_UI_FIRST_RUN: "1" }, dir);
      expect(password.source).toBe("first_run");
      const { app } = makeApp({ password });
      for (const p of ["/", "/projects", "/sign-in"]) {
        const r = await get(app, p);
        expect(r.status, p).toBe(303);
        expect(r.headers.get("location"), p).toBe("/setup");
      }
      expect(await (await get(app, "/setup")).text()).toContain(t("en", "setup.title"));
      expect((await post(app, "/setup", { password: "short", again: "short" })).status).toBe(400);
      expect((await post(app, "/setup", { password: PASSWORD, again: PASSWORD + "x" })).status).toBe(400);
      expect(existsSync(join(dir, PASSWORD_FILE))).toBe(false);
      const set = await post(app, "/setup", { password: PASSWORD, again: PASSWORD });
      expect(set.status).toBe(303);
      expect(set.headers.get("location")).toBe("/sign-in?m=setup_done");
      expect(statSync(join(dir, PASSWORD_FILE)).mode & 0o777).toBe(0o600);
      expect(readFileSync(join(dir, PASSWORD_FILE), "utf8")).not.toContain(PASSWORD);
      expect((await post(app, "/setup", { password: "another-made-up-pass", again: "another-made-up-pass" })).status).toBe(409);
      expect((await get(app, "/setup")).headers.get("location")).toBe("/sign-in");
      await signIn(app);
      // After a restart, the file is read: the ordinary sign-in, no first run.
      const again = passwordFromSettings({ BUILDER_UI_FIRST_RUN: "1" }, dir);
      expect(again.source).toBe("file");
      expect(again.check(PASSWORD)).toBe(true);
      // A digest file others can read is refused at start.
      chmodSync(join(dir, PASSWORD_FILE), 0o644);
      expect(() => passwordFromSettings({}, dir)).toThrow(/mode 644/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("start is refused without each setting: the database, the data folder, a password (or a first run); a short password; a data folder inside the repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "builder-web-start-"));
    try {
      const full = { BUILDER_DATABASE_URL: TEST_DB_URL, BUILDER_DATA_DIR: dir, BUILDER_UI_PASSWORD: PASSWORD };
      expect(readSettings({ ...full }).password.source).toBe("env");
      expect(() => readSettings({ ...full, BUILDER_DATABASE_URL: "" })).toThrow(/BUILDER_DATABASE_URL is not set/);
      expect(() => readSettings({ ...full, BUILDER_DATA_DIR: undefined })).toThrow(/BUILDER_DATA_DIR is not set/);
      expect(() => readSettings({ ...full, BUILDER_UI_PASSWORD: undefined })).toThrow(/No password for the interface/);
      expect(() => readSettings({ ...full, BUILDER_UI_PASSWORD: "elevenchars" })).toThrow(/12 characters or more/);
      expect(() => readSettings({ ...full, BUILDER_DATA_DIR: join(builderDir, "tmp-data") })).toThrow(/inside/);
      expect(readSettings({ ...full, BUILDER_UI_PASSWORD: undefined, BUILDER_UI_FIRST_RUN: "1" }).password.source).toBe("first_run");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the process itself refuses to start without a password, saying why, and exits 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "builder-web-proc-"));
    try {
      const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/root", BUILDER_DATABASE_URL: TEST_DB_URL, BUILDER_DATA_DIR: dir, PGUSER: process.env.PGUSER ?? "" };
      const r = spawnSync(join(builderDir, "node_modules", ".bin", "tsx"), ["src/web/main.ts"], { cwd: builderDir, env, encoding: "utf8", timeout: 30_000 });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("No password for the interface");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the password and the model key are taken out of the environment at start, so nothing the interface starts inherits them", () => {
    const dir = mkdtempSync(join(tmpdir(), "builder-web-env-"));
    const saved = { ...process.env };
    try {
      Object.assign(process.env, { BUILDER_DATABASE_URL: TEST_DB_URL, BUILDER_DATA_DIR: dir, BUILDER_UI_PASSWORD: PASSWORD, BUILDER_MODEL_API_KEY: "made-up-not-a-key" });
      readSettings(process.env);
      for (const k of SCRUBBED) expect(k in process.env, k).toBe(false);
      const childEnv = execFileSync("env", { encoding: "utf8" });
      expect(childEnv).not.toContain("BUILDER_MODEL_API_KEY");
      expect(childEnv).not.toContain("BUILDER_UI_PASSWORD");
      expect(childEnv).not.toContain(PASSWORD);
      // Scrubbed even when the start is refused.
      process.env.BUILDER_MODEL_API_KEY = "made-up-not-a-key";
      expect(() => readSettings({ ...process.env, BUILDER_DATA_DIR: "" })).toThrow();
      const env2: NodeJS.ProcessEnv = { BUILDER_MODEL_API_KEY: "made-up-not-a-key", BUILDER_UI_PASSWORD: PASSWORD };
      expect(() => readSettings(env2)).toThrow();
      expect(Object.keys(env2)).toEqual([]);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      for (const k of SCRUBBED) delete process.env[k];
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("one interface per database: a second instance lock on the same database is refused", async () => {
    const first = await holdInstanceLock(TEST_DB_URL);
    try {
      await expect(holdInstanceLock(TEST_DB_URL)).rejects.toThrow(/Another interface is running on this database/);
    } finally {
      await first.release();
    }
    const again = await holdInstanceLock(TEST_DB_URL);
    await again.release();
  });
});

describe("J1 interface: languages", () => {
  it("English and Arabic have the same keys, none empty, with the same {placeholders}", () => {
    const en = messageKeys("en");
    const ar = messageKeys("ar");
    expect([...ar].sort()).toEqual([...en].sort());
    for (const k of en) {
      expect(t("en", k).trim(), k).not.toBe("");
      expect(t("ar", k).trim(), k).not.toBe("");
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const raw = (l: "en" | "ar") => JSON.parse(readFileSync(join(builderDir, "src", "web", "messages", `${l}.json`), "utf8"))[k] as string;
      expect(ph(raw("ar")), k).toEqual(ph(raw("en")));
    }
  });
});
