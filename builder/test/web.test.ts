/**
 * Package J1: the builder's own interface (src/web), through hono's request function: no browser, no network,
 * no container. The database is the test database (BUILDER_TEST_DATABASE_URL); the data folder is a fresh
 * temporary folder outside the repository.
 */
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openStore, sha256, STAND_IN_NOTE } from "../src/acceptance/store.js";
import { APPROVE_INTERRUPTED, CLOSE_NOT_REMOVED, closeNotRemovedRefusal, EV, EXPORT_LABEL, FOUND_AT_START, Journey, JourneyRefused, NOT_REMOVED_AT_START, NOT_REMOVED_AT_STOP, REMOVAL_NOT_FINISHED, removalNotFinished } from "../src/orchestrator/journey.js";
import { JourneyJobs, PRICED_MODEL, REFUSAL_EXTRA } from "../src/orchestrator/journey-jobs.js";
import { createPool } from "../src/store/db.js";
import { appendEvent, listEvents } from "../src/store/events.js";
import { frozenMessage, listFreezes, recordFreeze, SET_ASIDE_FREEZE_REASON } from "../src/store/freezes.js";
import { getBudget, keepHold, openHold, openStepHold, settleHold } from "../src/store/holds.js";
import { migrate } from "../src/store/migrate.js";
import { DEFAULT_PROFILES } from "../src/gateway/hold.js";
import { createProject } from "../src/store/projects.js";
import { createWebApp, PUBLIC_PATHS } from "../src/web/app.js";
import { PASSWORD_FILE, PasswordState, passwordFromSettings, Sessions, SignInLimiter, digestPassword } from "../src/web/auth.js";
import { journeyFolder } from "../src/web/files.js";
import { holdInstanceLock, LOCK_LOST, readSettings, SCRUBBED, startRecoveryLines, stopAfterLockLost, StopFlag, stopOnSignal, stopSignalHandler, unavailableReason } from "../src/web/main.js";
import { frontTexts, messageKeys, t } from "../src/web/pages.js";
import { LivePreview } from "../src/web/preview.js";
import { testPool, TEST_DB_URL, uniqueId } from "./helpers.js";
import { BROKEN_STEP_ID, changeSetFolders, FAILED_STEP, FAILED_SUMMARY, PASSED_SUMMARY, StandInSandboxes } from "./journey-stand-ins.js";

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

  it("the lock-out holds for attempts that arrive at the same moment: at most 5 passwords are checked, and the right one sent among them is refused once locked (review of 13 Nov, blocking item 1)", async () => {
    const password = new PasswordState("env", digestPassword(PASSWORD), null);
    let checked = 0;
    const check = password.check.bind(password);
    password.check = (p: string) => (checked++, check(p));
    const limiter = new SignInLimiter(5, 60_000, 60_000);
    const { app } = makeApp({ password, limiter });
    // Ten wrong guesses and then the right password, all sent at once: each request's lock-out check would
    // otherwise run before any body is read, and so before any of the guesses is judged.
    const sent = [...Array.from({ length: 10 }, (_, i) => post(app, "/sign-in", { password: `wrong-guess-${i}` })), post(app, "/sign-in", { password: PASSWORD })];
    const res = await Promise.all(sent);
    expect(checked).toBe(5);
    expect(res.at(-1)!.status).toBe(429);
    expect(res.map((r) => r.headers.get("set-cookie"))).toEqual(Array(11).fill(null));
    expect(res.map((r) => r.status).filter((s) => s === 401)).toHaveLength(4);
    expect(limiter.lockedFor()).toBeGreaterThan(0);
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

  it("a POST whose body is not a form is refused (415) before any route, signed in or not, with no Origin: csrf() judges form bodies only (review of 13 Nov, note 1)", async () => {
    const { app } = makeApp();
    const cookie = await signIn(app);
    const id = await journey.createProject({ name: "Not a form (made-up)", cap: "5", brief: "Made-up brief." });
    const before = await eventCount();
    const projects = await projectCount();
    const send = (path: string, type: string | null, body: string, withCookie = true) =>
      app.request(path, { method: "POST", headers: { ...(type ? { "content-type": type } : {}), ...(withCookie ? { cookie } : {}) }, body });
    for (const type of ["application/json", "application/x-www-form-urlencoded-not", "text/xml", "application/octet-stream"]) {
      const r = await send(`/projects/${id}/continue`, type, "{}");
      expect(r.status, type).toBe(415);
      const s = await send("/sign-in", type, JSON.stringify({ password: PASSWORD }), false);
      expect(s.status, type).toBe(415);
      expect(s.headers.get("set-cookie")).toBeNull();
      const n = await send("/projects", type, JSON.stringify({ name: "JSON (made-up)", cap: "5", brief: "x" }));
      expect(n.status, type).toBe(415);
    }
    // With no content type at all: refused the same way (csrf() would also refuse it without an Origin, as text/plain).
    expect((await send(`/projects/${id}/continue`, null, "")).status).toBe(415);
    expect(await eventCount()).toBe(before);
    expect(await projectCount()).toBe(projects);
    // A form from this site still works.
    expect((await post(app, `/projects/${id}/continue`, {}, { cookie })).status).toBe(303);
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

  it("brought up to date with 1.4c and 1.4b: the cost panel shows every freeze not cleared, each with its kind and frozenMessage's own words, and a bill above its hold in the unreconciled list", async () => {
    const { app } = makeApp();
    const cookie = await signIn(app);
    const id = await journey.createProject({ name: "Freezes (made-up)", cap: "5.00", brief: "Made-up brief." });
    const gw = uniqueId("gw_j1_cost_made_up");
    const open = async (projectId = id) => {
      const r = await openHold(pool, { projectId, step: null, amountUsd: 0.01, deadline: new Date(Date.now() + 3_600_000), gateway: gw, arithmetic: { made_up: true }, path: "/v1/messages" });
      if (!r.ok) throw new Error(`hold not opened: ${r.reason}`);
      return r.hold.id;
    };
    const billed = await open();
    const late = await open();
    const kept = await open();
    const unrecorded = await open();
    const setAside = await open();
    // Package 1.4c: a bill above its hold, through the settlement.
    expect((await settleHold(pool, { projectId: id, holdId: billed, step: null, actualUsd: 0.012345, call: { model: "made-up-model" }, gateway: gw })).freeze?.kind).toBe("bill_above_hold");
    // Package 1.4c: an answer above its hold, arriving after the hold was kept.
    await keepHold(pool, { projectId: id, holdId: late, step: null, reason: "the call reached its time limit", seen: {} });
    expect((await settleHold(pool, { projectId: id, holdId: late, step: null, actualUsd: 0.02, call: {}, gateway: gw })).freeze?.kind).toBe("late_answer_above_hold");
    // After 1.4c's review: a call kept with usage figures, read before it ended, already above its hold.
    const keptAbove = await keepHold(pool, { projectId: id, holdId: kept, step: null, reason: "the call reached its time limit", seen: {}, costAsRead: { usd: 0.015, usage: { output_tokens: 1 }, gateway: gw, endedAt: new Date() } });
    expect(keptAbove.freeze?.kind).toBe("kept_above_hold");
    // Package 1.4: an ending that could not be written.
    expect((await recordFreeze(pool, { journal_id: uniqueId("j_made_up"), gateway: gw, project_id: id, hold_id: unrecorded, step: null, ended_at: new Date().toISOString(), ending: "keep", kept_reason: "made up", cost_usd_as_read: null, call: {}, error: { name: "MadeUpError" } })).written).toBe(true);
    // Package 1.4b: an unreadable journal line set aside naming a hold. Made-up rows in migration 012's shape (the
    // recovery script writes them with its set-aside record): one of the set-aside's own kind, and one as 1.4b wrote it
    // on a database without 1.4c's migration 010 (the kind 'unrecorded_ending', the set-aside's reason).
    const insertSetAside = (kind: string, setAsideId: string) =>
      pool.query(
        `insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, bill_usd, record)
         values ($1, $2, $3, $4, $5, $6, now(), 0.01, null, $7)`,
        [id, kind, setAside, `set-aside:${setAsideId}`, gw, SET_ASIDE_FREEZE_REASON, JSON.stringify({ set_aside_id: setAsideId, fingerprint: "a".repeat(64), made_up: true })],
      );
    // As the recovery requires, the hold a set-aside names is open and kept at its full amount.
    await keepHold(pool, { projectId: id, holdId: setAside, step: null, reason: "the provider's answer broke off part-way", seen: {} });
    await insertSetAside("journal_line_set_aside", uniqueId("sa_made_up"));
    await insertSetAside("unrecorded_ending", uniqueId("sa_made_up_before_010"));
    // A bill above its hold alone, in a project of its own: its hold is settled and nothing else is kept, so the
    // unreconciled list holds only the bill (the case the owner meets after one overrun).
    const alone = await journey.createProject({ name: "A bill above its hold alone (made-up)", cap: "5.00", brief: "Made-up brief." });
    const aloneHold = await open(alone);
    const aloneFreeze = (await settleHold(pool, { projectId: alone, holdId: aloneHold, step: null, actualUsd: 0.011, call: {}, gateway: gw })).freeze!;
    expect(aloneFreeze.kind).toBe("bill_above_hold");
    const freezes = await listFreezes(pool, id);
    const shown = ["bill_above_hold", "late_answer_above_hold", "kept_above_hold", "unrecorded_ending", "journal_line_set_aside", "journal_line_set_aside"];
    expect(freezes.map((f) => f.kind)).toEqual(["bill_above_hold", "late_answer_above_hold", "kept_above_hold", "unrecorded_ending", "journal_line_set_aside", "unrecorded_ending"]);
    const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const before = await eventCount();
    for (const lang of ["en", "ar"] as const) {
      const page = await (await get(app, `/projects/${id}/cost${lang === "ar" ? "?lang=ar" : ""}`, cookie)).text();
      expect(page, lang).toContain(esc(t(lang, "cost.frozen_intro")));
      expect(page, lang).not.toContain("data-no-freeze");
      expect([...page.matchAll(/<tr data-freeze="(\d+)" data-freeze-kind="([a-z_]+)">/g)].map((m) => [m[1], m[2]]), lang).toEqual(freezes.map((f, i) => [f.id, shown[i]]));
      for (const [i, f] of freezes.entries()) {
        const row = new RegExp(`<tr data-freeze="${f.id}" [\\s\\S]*?</tr>`).exec(page)?.[0] ?? "";
        expect(row, `${lang} ${f.kind}`).toContain(esc(t(lang, `cost.kind.${shown[i]}`)));
        // The message in English, as the gateway's refusal of a step gives it, with each kind's own figures.
        expect(row, `${lang} ${f.kind}`).toContain(`<td lang="en" dir="ltr">${esc(frozenMessage(f, "step"))}</td>`);
      }
      expect(page).toContain(esc("was billed $0.012345, more than its hold of $0.010000 (above it by $0.002345)"));
      expect(page).toContain(esc("an answer that arrived at"));
      expect(page).toContain(esc("had already used at least $0.015000 by the usage figures read before it ended"));
      expect(page).toContain(esc(`a line of the gateway's journal that could not be read was set aside at ${freezes[5]!.frozen_at.toISOString()} as possibly the record of a call on its hold ${setAside}`));
      // The unreconciled list is not shown empty: the bill above its hold is in it, with its figures, beside the kept holds.
      expect(page, lang).not.toContain("data-unreconciled-empty");
      expect(page, lang).toContain(`<tr data-overrun="${freezes[0]!.id}"><td>${billed}</td><td>$0.012345</td><td>${esc(t(lang, "cost.overrun", { freeze: freezes[0]!.id, bill: "$0.012345", held: "$0.010000", above: "$0.002345" }))}</td></tr>`);
      for (const h of [late, kept, unrecorded, setAside]) expect(page, `${lang} hold ${h}`).toContain(`<tr data-unreconciled-hold="${h}">`);
      const lone = await (await get(app, `/projects/${alone}/cost${lang === "ar" ? "?lang=ar" : ""}`, cookie)).text();
      expect(lone, `${lang} alone`).toContain(`<tr data-freeze="${aloneFreeze.id}" data-freeze-kind="bill_above_hold">`);
      expect(lone, `${lang} alone`).not.toContain("data-unreconciled-empty");
      expect(lone, `${lang} alone`).not.toContain("data-unreconciled-hold");
      expect(lone, `${lang} alone`).toContain(`<tr data-overrun="${aloneFreeze.id}"><td>${aloneHold}</td><td>$0.011000</td><td>${esc(t(lang, "cost.overrun", { freeze: aloneFreeze.id, bill: "$0.011000", held: "$0.010000", above: "$0.001000" }))}</td></tr>`);
    }
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
      // Package J3, after its review: the live preview is off unless BUILDER_LIVE_PREVIEW is 1.
      expect(readSettings({ ...full }).livePreview).toBe(false);
      expect(readSettings({ ...full, BUILDER_LIVE_PREVIEW: "0" }).livePreview).toBe(false);
      expect(readSettings({ ...full, BUILDER_LIVE_PREVIEW: "1" }).livePreview).toBe(true);
      for (const bad of ["yes", "true", "on", " 1"]) expect(() => readSettings({ ...full, BUILDER_LIVE_PREVIEW: bad }), bad).toThrow(/BUILDER_LIVE_PREVIEW must be 1/);
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

describe("J1 interface, part 2: the build, preview, checklist and export screens (stand-in sandbox, no container)", () => {
  let sandboxes: StandInSandboxes;
  beforeAll(() => {
    sandboxes = new StandInSandboxes(pool);
  });
  afterAll(() => sandboxes.removeAll());

  function makeJobsApp() {
    const box: { jobs?: JourneyJobs } = {};
    const j = new Journey({ pool, dataDir, cleanupProject: (id, rec) => box.jobs!.cleanup(id, rec) });
    box.jobs = new JourneyJobs({ journey: j, sandboxes, measureFree: () => 50 * 1024 ** 3 });
    const app = createWebApp({ journey: j, jobs: box.jobs, password: new PasswordState("env", digestPassword(PASSWORD), null), sessions: new Sessions(), limiter: new SignInLimiter(), dataDir });
    return { app, j };
  }
  const page = async (app: App, path: string, cookie: string) => {
    const r = await get(app, path, cookie);
    expect(r.status, path).toBe(200);
    return r.text();
  };
  /** Every GET route of the project, in both languages, writes nothing. */
  const noGetWrites = async (app: App, id: string, cookie: string) => {
    const events = await eventCount();
    for (const r of routes(app, id).filter((x) => x.method === "GET")) {
      for (const q of ["", "?lang=ar"]) await (await get(app, `${r.path}${q}`, cookie)).arrayBuffer();
    }
    expect(await eventCount()).toBe(events);
  };
  const go = async (app: App, j: Journey, path: string, cookie: string, data: Record<string, string> = {}) => {
    const r = await post(app, path, data, { cookie });
    expect(r.status, `${path}: ${r.status === 303 ? "" : await r.clone().text()}`).toBe(303);
    await j.waitForJob();
    return r.headers.get("location");
  };

  it("the whole journey through the screens: each step built and approved, the preview's screenshots, the checklist with its labels, sign-off, the export as an attachment; no GET writes at any stage", async () => {
    const { app, j } = makeJobsApp();
    const cookie = await signIn(app);
    const made = await post(app, "/projects", { name: "Leave requests (made-up)", cap: "5.00", brief: "I need an app where staff can request leave and managers approve it" }, { cookie });
    const id = /\/projects\/(j1-[0-9a-f]{12})\//.exec(made.headers.get("location") ?? "")![1]!;
    for (const a of ["continue", "answer-rest", "confirm-brief", "confirm-plan"]) await go(app, j, `/projects/${id}/${a}`, cookie);
    expect((await get(app, `/projects/${id}`, cookie)).headers.get("location")).toBe(`/projects/${id}/build`);
    let html = await page(app, `/projects/${id}/build`, cookie);
    expect(html).toContain('data-build="01-data"');
    expect(html).toContain(t("en", "build.no_preview_after_1"));
    expect(html).toContain("a floor assumed, not measured");
    await noGetWrites(app, id, cookie);

    expect(await go(app, j, `/projects/${id}/build`, cookie, { step: "01-data" })).toBe(`/projects/${id}/build`);
    html = await page(app, `/projects/${id}/build`, cookie);
    expect(html).toContain('data-step="01-data" data-step-state="finished" data-approved="no"');
    expect(html).toContain("Scripted: fixed change, no model call. Reserved while it ran: $1.5552, sized at claude-opus-5-5&#39;s prices, released. Spent: $0.00.");
    expect(html).toContain('data-approve="01-data"');
    expect(html).toContain(t("en", "build.approve_next"));
    await noGetWrites(app, id, cookie);
    // While a job runs, the page refreshes itself every 2 seconds (no script).
    expect(await go(app, j, `/projects/${id}/approve`, cookie, { step: "01-data" })).toBe(`/projects/${id}/build`);
    html = await page(app, `/projects/${id}/build`, cookie);
    expect(html).toContain("Reserved while it ran: $3.1104");
    expect(html).toContain(t("en", "build.approve_last"));
    expect(html).not.toContain('http-equiv="refresh"');

    expect(await go(app, j, `/projects/${id}/approve`, cookie, { step: "02-submitter-screen" })).toBe(`/projects/${id}/preview`);
    html = await page(app, `/projects/${id}/preview`, cookie);
    expect(html).toContain('data-shots="4"');
    expect(html.match(/<img src="\/projects\/j1-[0-9a-f]{12}\/files\/\d+"/g)).toHaveLength(4);
    expect(html).toMatch(/Screenshot of the running app at \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\. Not live\. Sample data\./);
    const img = /<img src="(\/projects\/[^"]+)"/.exec(html)![1]!;
    const shot = await get(app, img, cookie);
    expect(shot.headers.get("content-type")).toBe("image/png");
    await noGetWrites(app, id, cookie);

    html = await page(app, `/projects/${id}/acceptance`, cookie);
    expect(html).toContain(t("en", "acceptance.run"));
    expect(html).toContain(t("en", "acceptance.sign_off_not_yet"));
    // Before any run, item 1 (its test is written) is not called untested.
    expect(/<tr data-item="1"[\s\S]*?<\/tr>/.exec(html)![0]).toContain(t("en", "acceptance.test_not_run_yet").replace(/'/g, "&#39;"));
    expect((await post(app, `/projects/${id}/sign-off`, {}, { cookie })).status).toBe(409);
    expect((await post(app, `/projects/${id}/export`, {}, { cookie })).status).toBe(409);
    expect(await page(app, `/projects/${id}/export`, cookie)).toContain(t("en", "export.not_yet"));
    await go(app, j, `/projects/${id}/acceptance`, cookie);
    html = await page(app, `/projects/${id}/acceptance`, cookie);
    expect(html).toContain('<span class="label" data-label>stand-in test, not independent acceptance</span>');
    expect(html).toContain(STAND_IN_NOTE.replace(/'/g, "&#39;"));
    expect(html).toContain('<tr data-item="1" data-status="passed" data-shown="passed">');
    expect(/<tr data-item="1"[\s\S]*?<\/tr>/.exec(html)![0]).toContain('<strong class="ok">Passed</strong>');
    for (const n of [2, 3, 4, 5, 6]) {
      const row = new RegExp(`<tr data-item="${n}" data-status="did not run" data-shown="did_not_run">[\\s\\S]*?</tr>`).exec(html)?.[0] ?? "";
      expect(row, `item ${n}`).toContain(t("en", "acceptance.no_test"));
      expect(row, `item ${n}`).not.toContain(t("en", "acceptance.status.passed"));
    }
    expect(html).toContain(PASSED_SUMMARY.replace(/'/g, "&#39;"));
    expect(html).toContain('<strong class="ok" data-outcome="passed">Passed</strong>');
    expect(html).toContain(t("en", "acceptance.sign_off_label"));
    await noGetWrites(app, id, cookie);
    await go(app, j, `/projects/${id}/sign-off`, cookie);
    html = await page(app, `/projects/${id}/acceptance`, cookie);
    expect(html).toContain("data-signed-off");
    expect((await get(app, `/projects/${id}`, cookie)).headers.get("location")).toBe(`/projects/${id}/export`);
    const ar = await page(app, `/projects/${id}/acceptance?lang=ar`, cookie);
    expect(ar).toContain(t("ar", "acceptance.label"));
    expect(ar).toContain("stand-in test, not independent acceptance");
    expect(ar).toContain("Sign-off on a simulated build, checked by a stand-in test of item 1 only: not acceptance");

    html = await page(app, `/projects/${id}/export`, cookie);
    expect(html).toContain(t("en", "export.label").replace(/'/g, "&#39;"));
    expect(t("en", "export.label")).toBe(EXPORT_LABEL);
    await go(app, j, `/projects/${id}/export`, cookie);
    html = await page(app, `/projects/${id}/export`, cookie);
    const link = /<a href="(\/projects\/j1-[0-9a-f]{12}\/files\/\d+)" data-download>/.exec(html)![1]!;
    const file = await get(app, link, cookie);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/gzip");
    expect(file.headers.get("content-disposition")).toBe(`attachment; filename="${id}-export.tar.gz"`);
    expect(Buffer.from(await file.arrayBuffer()).subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]))).toBe(true);
    await noGetWrites(app, id, cookie);
    await go(app, j, `/projects/${id}/close`, cookie);
    expect(sandboxes.destroyed).toContain(id);
    expect(await page(app, `/projects/${id}/record`, cookie)).toContain("data-closed");
  });

  it("a project capped at $1.00: the build screen shows step 1 refused with package 1.3's message and the sentence under it, in both languages", async () => {
    const { app, j } = makeJobsApp();
    const cookie = await signIn(app);
    const made = await post(app, "/projects", { name: "Leave requests, $1 cap (made-up)", cap: "1.00", brief: "Made-up brief." }, { cookie });
    const id = /\/projects\/(j1-[0-9a-f]{12})\//.exec(made.headers.get("location") ?? "")![1]!;
    for (const a of ["continue", "answer-rest", "confirm-brief", "confirm-plan"]) await go(app, j, `/projects/${id}/${a}`, cookie);
    await go(app, j, `/projects/${id}/build`, cookie, { step: "01-data" });
    const html = await page(app, `/projects/${id}/build`, cookie);
    expect(html).toContain("data-refused");
    expect(html).toMatch(/This step needs up to \$1\.56 to finish \(4 turns\); this project has \$1\.00 left of its budget of \$1\.00/);
    expect(html).toContain(REFUSAL_EXTRA.replace(/'/g, "&#39;"));
    expect(html).toContain('data-build="01-data"');
    expect(html).toContain(t("en", "build.retry", { n: 1 }));
    const ar = await page(app, `/projects/${id}/build?lang=ar`, cookie);
    expect(ar).toContain(t("ar", "build.refusal_extra"));
    expect(ar).toContain(REFUSAL_EXTRA.replace(/'/g, "&#39;"));
    expect(t("en", "build.refusal_extra")).toBe(REFUSAL_EXTRA);
    await go(app, j, `/projects/${id}/close`, cookie);
  });

  it("step ids such as 01-data are isolated left to right wherever a page shows them, so an Arabic page does not show them as data-01 (review of 13 Nov, note 7)", async () => {
    const { app, j } = makeJobsApp();
    const cookie = await signIn(app);
    const made = await post(app, "/projects", { name: "Step ids (made-up)", cap: "5.00", brief: "Made-up brief." }, { cookie });
    const id = /\/projects\/(j1-[0-9a-f]{12})\//.exec(made.headers.get("location") ?? "")![1]!;
    for (const a of ["continue", "answer-rest", "confirm-brief", "confirm-plan"]) await go(app, j, `/projects/${id}/${a}`, cookie);
    await go(app, j, `/projects/${id}/build`, cookie, { step: "01-data" });
    const iso = (step: string) => `<bdi dir="ltr">${step}</bdi>`;
    for (const lang of ["ar", "en"] as const) {
      const build = await page(app, `/projects/${id}/build?lang=${lang}`, cookie);
      const titles = [...build.matchAll(/<h2>([\s\S]*?)<span class="badge">/g)].map((m) => m[1]!);
      expect(titles, lang).toContain(t(lang, "build.step_title", { n: 1, total: 2 }).replace("{step}", iso("01-data")));
      expect(titles, lang).toContain(t(lang, "build.step_title", { n: 2, total: 2 }).replace("{step}", iso("02-submitter-screen")));
      expect(await page(app, `/projects/${id}/plan?lang=${lang}`, cookie)).toContain(`<strong>${iso("01-data")}</strong>`);
      expect(await page(app, `/projects/${id}/cost?lang=${lang}`, cookie)).toContain(`<td>${iso("01-data")}</td>`);
      expect(await page(app, `/projects/${id}/record?lang=${lang}`, cookie)).toContain(`<td>${iso("01-data")}</td>`);
      // No step id is shown as a bare text of its own anywhere on these pages.
      for (const p of ["build", "plan", "cost", "record"]) {
        const html = await page(app, `/projects/${id}/${p}?lang=${lang}`, cookie);
        for (const step of ["01-data", "02-submitter-screen"]) expect(html.split(`>${step}<`).length, `${p} ${lang} ${step}`).toBe(html.split(iso(step)).length);
      }
    }
    await go(app, j, `/projects/${id}/close`, cookie);
  });

  it("a checklist job that failed after its run is shown as failed on the checklist screen, and sign-off is not offered on an earlier passed run (review of 13 Nov, note 4)", async () => {
    const { app, j } = makeJobsApp();
    const cookie = await signIn(app);
    const made = await post(app, "/projects", { name: "Checklist job failed (made-up)", cap: "5.00", brief: "Made-up brief." }, { cookie });
    const id = /\/projects\/(j1-[0-9a-f]{12})\//.exec(made.headers.get("location") ?? "")![1]!;
    for (const a of ["continue", "answer-rest", "confirm-brief", "confirm-plan"]) await go(app, j, `/projects/${id}/${a}`, cookie);
    await go(app, j, `/projects/${id}/build`, cookie, { step: "01-data" });
    await go(app, j, `/projects/${id}/approve`, cookie, { step: "01-data" });
    await go(app, j, `/projects/${id}/approve`, cookie, { step: "02-submitter-screen" });
    await go(app, j, `/projects/${id}/acceptance`, cookie);
    expect(await page(app, `/projects/${id}/acceptance`, cookie)).toContain(t("en", "acceptance.sign_off_label"));
    sandboxes.acceptanceOutcome = "did not run";
    sandboxes.acceptanceFailsAfterRun = true;
    try {
      await go(app, j, `/projects/${id}/acceptance`, cookie);
    } finally {
      sandboxes.acceptanceOutcome = "passed";
      sandboxes.acceptanceFailsAfterRun = false;
    }
    for (const lang of ["en", "ar"] as const) {
      const html = await page(app, `/projects/${id}/acceptance?lang=${lang}`, cookie);
      expect(html, lang).toContain('<p class="warn" lang="en" dir="ltr" data-job-failed>the job stopped with an error (Error)</p>');
      expect(html, lang).toContain(t(lang, "acceptance.sign_off_not_yet"));
      expect(html, lang).not.toContain(`action="/projects/${id}/sign-off"`);
    }
    expect((await post(app, `/projects/${id}/sign-off`, {}, { cookie })).status).toBe(409);
    await go(app, j, `/projects/${id}/close`, cookie);
  });

  it("brought up to date with 3.1b: the checklist screen shows the run's outcome word from its acceptance.run.finished event, not its summary, and offers sign-off only on 'passed'", async () => {
    const { app, j } = makeJobsApp();
    const cookie = await signIn(app);
    const made = await post(app, "/projects", { name: "Outcome word (made-up)", cap: "5.00", brief: "Made-up brief." }, { cookie });
    const id = /\/projects\/(j1-[0-9a-f]{12})\//.exec(made.headers.get("location") ?? "")![1]!;
    for (const a of ["continue", "answer-rest", "confirm-brief", "confirm-plan"]) await go(app, j, `/projects/${id}/${a}`, cookie);
    await go(app, j, `/projects/${id}/build`, cookie, { step: "01-data" });
    await go(app, j, `/projects/${id}/approve`, cookie, { step: "01-data" });
    await go(app, j, `/projects/${id}/approve`, cookie, { step: "02-submitter-screen" });
    // Each run's summary says "version passed; …"; its record's outcome word is what is shown, and judged.
    for (const [word, shownAs, key] of [
      ["not passed", "not passed", "acceptance.outcome.not_passed"],
      ["failed", "failed", "acceptance.outcome.failed"],
      ["absent", "none", "acceptance.outcome.none"],
      ["skipped", "none", "acceptance.outcome.none"],
    ] as const) {
      sandboxes.outcomeWord = word;
      try {
        await go(app, j, `/projects/${id}/acceptance`, cookie);
      } finally {
        sandboxes.outcomeWord = null;
      }
      for (const lang of ["en", "ar"] as const) {
        const html = await page(app, `/projects/${id}/acceptance?lang=${lang}`, cookie);
        expect(html, `${word} ${lang}`).toContain(PASSED_SUMMARY.replace(/'/g, "&#39;"));
        expect(html.match(new RegExp(`<strong class="warn" data-outcome="${shownAs}">${t(lang, key)}</strong>`, "g")) ?? [], `${word} ${lang}`).toHaveLength(2);
        expect(html, `${word} ${lang}`).not.toContain('data-outcome="passed"');
        expect(html, `${word} ${lang}`).toContain(t(lang, "acceptance.sign_off_not_yet"));
        expect(html, `${word} ${lang}`).not.toContain(`action="/projects/${id}/sign-off"`);
      }
      expect((await post(app, `/projects/${id}/sign-off`, {}, { cookie })).status, word).toBe(409);
    }
    await go(app, j, `/projects/${id}/acceptance`, cookie);
    for (const lang of ["en", "ar"] as const) {
      const html = await page(app, `/projects/${id}/acceptance?lang=${lang}`, cookie);
      expect(html.match(new RegExp(`<strong class="ok" data-outcome="passed">${t(lang, "acceptance.outcome.passed")}</strong>`, "g")) ?? [], lang).toHaveLength(2);
      expect(html, lang).toContain(`action="/projects/${id}/sign-off"`);
    }
    await go(app, j, `/projects/${id}/sign-off`, cookie);
    await go(app, j, `/projects/${id}/close`, cookie);
  });

  it("no green Passed for an item when the run's outcome word is not 'passed': its result is provisional, shown neutral, with the run's outcome next to it (the last independent check, point c)", async () => {
    const { app, j } = makeJobsApp();
    const cookie = await signIn(app);
    const made = await post(app, "/projects", { name: "Provisional item (made-up)", cap: "5.00", brief: "Made-up brief." }, { cookie });
    const id = /\/projects\/(j1-[0-9a-f]{12})\//.exec(made.headers.get("location") ?? "")![1]!;
    for (const a of ["continue", "answer-rest", "confirm-brief", "confirm-plan"]) await go(app, j, `/projects/${id}/${a}`, cookie);
    await go(app, j, `/projects/${id}/build`, cookie, { step: "01-data" });
    await go(app, j, `/projects/${id}/approve`, cookie, { step: "01-data" });
    await go(app, j, `/projects/${id}/approve`, cookie, { step: "02-submitter-screen" });
    const itemRow = (html: string, n: number) => new RegExp(`<tr data-item="${n}"[\\s\\S]*?</tr>`).exec(html)?.[0] ?? "";
    // In each of these runs item 1's own record says "passed"; the run's outcome word says otherwise.
    for (const [word, shownAs, key] of [
      ["not passed", "not passed", "acceptance.outcome.not_passed"],
      ["failed", "failed", "acceptance.outcome.failed"],
      ["absent", "none", "acceptance.outcome.none"],
    ] as const) {
      sandboxes.outcomeWord = word;
      try {
        await go(app, j, `/projects/${id}/acceptance`, cookie);
      } finally {
        sandboxes.outcomeWord = null;
      }
      for (const lang of ["en", "ar"] as const) {
        const row = itemRow(await page(app, `/projects/${id}/acceptance?lang=${lang}`, cookie), 1);
        expect(row, `${word} ${lang}`).toContain('data-status="passed" data-shown="passed_provisional"');
        expect(row, `${word} ${lang}`).toContain(`<strong class="neutral">${t(lang, "acceptance.status.passed_provisional")}</strong>`);
        expect(row, `${word} ${lang}`).toContain(`<div class="note" data-run-outcome="${shownAs}">${t(lang, "acceptance.item_run_outcome", { outcome: t(lang, key) }).replace(/'/g, "&#39;")}</div>`);
        expect(row, `${word} ${lang}`).not.toContain('class="ok"');
        // Items with no test: did not run, with the run's outcome next to them too.
        expect(itemRow(await page(app, `/projects/${id}/acceptance?lang=${lang}`, cookie), 2), `${word} ${lang}`).toContain(`data-run-outcome="${shownAs}"`);
      }
    }
    // A run whose outcome word is "passed": item 1 is shown passed, in green, with nothing next to it.
    await go(app, j, `/projects/${id}/acceptance`, cookie);
    for (const lang of ["en", "ar"] as const) {
      const html = await page(app, `/projects/${id}/acceptance?lang=${lang}`, cookie);
      expect(itemRow(html, 1), lang).toContain(`<strong class="ok">${t(lang, "acceptance.status.passed")}</strong>`);
      expect(html, lang).not.toContain("data-run-outcome");
      expect(html, lang).not.toContain(t(lang, "acceptance.status.passed_provisional"));
    }
    await go(app, j, `/projects/${id}/close`, cookie);
  });

  it("the run table shows the latest checklist job, also one that failed before the runner wrote any event: no earlier run is shown, no outcome is read as passed, and sign-off is not offered (the last independent check, point c)", async () => {
    const { app, j } = makeJobsApp();
    const cookie = await signIn(app);
    const made = await post(app, "/projects", { name: "Latest checklist job (made-up)", cap: "5.00", brief: "Made-up brief." }, { cookie });
    const id = /\/projects\/(j1-[0-9a-f]{12})\//.exec(made.headers.get("location") ?? "")![1]!;
    for (const a of ["continue", "answer-rest", "confirm-brief", "confirm-plan"]) await go(app, j, `/projects/${id}/${a}`, cookie);
    await go(app, j, `/projects/${id}/build`, cookie, { step: "01-data" });
    await go(app, j, `/projects/${id}/approve`, cookie, { step: "01-data" });
    await go(app, j, `/projects/${id}/approve`, cookie, { step: "02-submitter-screen" });
    // A first run that passed.
    await go(app, j, `/projects/${id}/acceptance`, cookie);
    let html = await page(app, `/projects/${id}/acceptance`, cookie);
    const first = /<table data-run="(run-standin-[^"]+)" data-job="([^"]+)" data-job-state="finished">/.exec(html);
    expect(first).not.toBeNull();
    // The next checklist job fails before the runner writes any event.
    sandboxes.acceptanceFailsBeforeRun = true;
    try {
      await go(app, j, `/projects/${id}/acceptance`, cookie);
    } finally {
      sandboxes.acceptanceFailsBeforeRun = false;
    }
    const s = await j.state(id);
    const failedJob = s.jobs.at(-1)!;
    expect(failedJob).toMatchObject({ kind: "acceptance", state: "failed" });
    for (const lang of ["en", "ar"] as const) {
      html = await page(app, `/projects/${id}/acceptance?lang=${lang}`, cookie);
      expect(html, lang).toContain(`<table data-run="" data-job="${failedJob.jobId}" data-job-state="failed">`);
      expect(html, lang).toContain(`<strong class="warn">${t(lang, "acceptance.job_state.failed")}</strong>`);
      expect(html, lang).toContain(`<span data-no-run>${t(lang, "acceptance.no_run")}</span>`);
      expect(html, lang).toContain('<p class="warn" lang="en" dir="ltr" data-job-failed>the job stopped with an error (Error)</p>');
      expect(html.match(new RegExp(`<strong class="warn" data-outcome="none">${t(lang, "acceptance.outcome.none")}</strong>`, "g")) ?? [], lang).toHaveLength(2);
      // Nothing of the earlier run that passed: its id, its outcome, its summary, its item results.
      expect(html, lang).not.toContain(first![1]!);
      expect(html, lang).not.toContain(first![2]!);
      expect(html, lang).not.toContain('data-outcome="passed"');
      expect(html, lang).not.toContain(PASSED_SUMMARY.replace(/'/g, "&#39;"));
      expect(html, lang).not.toContain('data-status="passed"');
      const row1 = /<tr data-item="1"[\s\S]*?<\/tr>/.exec(html)![0];
      expect(row1, lang).toContain('data-status="did not run" data-shown="did_not_run"');
      expect(row1, lang).toContain(t(lang, "acceptance.test_no_result").replace(/'/g, "&#39;"));
      expect(row1, lang).not.toContain(t(lang, "acceptance.no_test"));
      expect(html, lang).toContain(t(lang, "acceptance.sign_off_not_yet"));
      expect(html, lang).not.toContain(`action="/projects/${id}/sign-off"`);
    }
    expect((await post(app, `/projects/${id}/sign-off`, {}, { cookie })).status).toBe(409);
    // A new run that passes is shown, and can be signed off.
    await go(app, j, `/projects/${id}/acceptance`, cookie);
    html = await page(app, `/projects/${id}/acceptance`, cookie);
    expect(html).toMatch(/<table data-run="run-standin-[^"]+" data-job="[^"]+" data-job-state="finished">/);
    expect(html).not.toContain("data-job-failed");
    expect(html).toContain(`action="/projects/${id}/sign-off"`);
    await go(app, j, `/projects/${id}/close`, cookie);
  });

  it("a step name that is not the plan's is refused, and the routes without a jobs runner refuse the jobs", async () => {
    const { app, j } = makeJobsApp();
    const cookie = await signIn(app);
    const id = await j.createProject({ name: "Bad step (made-up)", cap: "5", brief: "Made-up brief." });
    for (const step of ["03-wrong-status", "../01-data", ""]) expect((await post(app, `/projects/${id}/build`, { step }, { cookie })).status, step).toBe(409);
    const { app: plain } = makeApp();
    const c2 = await signIn(plain);
    const r = await post(plain, `/projects/${id}/build`, { step: "01-data" }, { cookie: c2 });
    expect(r.status).toBe(409);
    expect(await r.text()).toContain("This interface was started without builds.");
  });
});

describe("J1 interface: the instance lock lost while the interface serves (review bot on defb9c4)", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** Wait until `f` is true, for at most `ms`; returns whether it became true. */
  const until = async (f: () => boolean | Promise<boolean>, ms: number): Promise<boolean> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await f()) return true;
      await sleep(50);
    }
    return f();
  };
  /** The interface's instance lock's key, as main.ts computes it (written out here, so that the test does not lean on main.ts for it). */
  const LOCK_KEY_SQL = "('x' || substr(md5('builder-web-interface'), 1, 16))::bit(64)::bigint";
  /** End the session that holds the instance lock on the pool's database, as PostgreSQL does when it is restarted or the session is terminated; waits until it has ended. */
  async function endInstanceLockSession(p: pg.Pool): Promise<void> {
    const r = await p.query<{ ended: boolean }>(
      `select pg_terminate_backend(l.pid, 5000) as ended from pg_locks l
        where l.locktype = 'advisory' and l.granted and l.objsubid = 1
          and l.database = (select oid from pg_database where datname = current_database())
          and ((l.classid::bigint << 32) | l.objid::bigint) = ${LOCK_KEY_SQL}`,
    );
    expect(r.rows).toEqual([{ ended: true }]);
  }
  /** A second interface's lock: tried until the first's session has gone, for at most `ms`. */
  async function takeLockWithin(url: string, ms: number) {
    const end = Date.now() + ms;
    for (;;) {
      try {
        return await holdInstanceLock(url);
      } catch (err) {
        if (Date.now() > end) throw err;
        await sleep(50);
      }
    }
  }
  /** A project with its brief and plan confirmed. */
  async function readyProject(j: Journey, name: string): Promise<string> {
    const id = await j.createProject({ name, cap: "5", brief: "I need an app where staff can request leave and managers approve it" });
    await j.continueWithExample(id);
    await j.answerRestFromSheet(id);
    await j.confirmBrief(id);
    await j.confirmPlan(id);
    return id;
  }

  it("a job is running when PostgreSQL ends the lock's connection, and a second interface on the same database then takes the lock and runs its recovery: the first accepts no more work (every request a plain 503), and its job is stopped and changes nothing more in the sandbox (review bot on defb9c4)", async () => {
    const sb1 = new StandInSandboxes(pool);
    const sb2 = new StandInSandboxes(pool);
    const box: { j1?: Journey; jobs1?: JourneyJobs; jobs2?: JourneyJobs } = {};
    // The first interface, wired as main.ts wires it: the lock's loss halts its journey, the lock is asked of the
    // database before each job, and every request is refused once the lock is lost.
    const lock1 = await holdInstanceLock(TEST_DB_URL, { onLost: (why) => void box.j1?.halt(why) });
    const j1 = new Journey({ pool, dataDir, cleanupProject: (p, rec) => box.jobs1!.cleanup(p, rec), ownership: () => lock1.check() });
    box.j1 = j1;
    const jobs1 = new JourneyJobs({ journey: j1, sandboxes: sb1, measureFree: () => 50 * 1024 ** 3 });
    box.jobs1 = jobs1;
    const app1 = createWebApp({ journey: j1, jobs: jobs1, password: new PasswordState("env", digestPassword(PASSWORD), null), sessions: new Sessions(), limiter: new SignInLimiter(), dataDir, unavailable: () => lock1.lost() });
    let lock2: { release: () => Promise<void> } | null = null;
    let release: (() => void) | undefined;
    try {
      const cookie = await signIn(app1);
      const id = await readyProject(j1, "Lock lost while a job runs (made-up)");
      await jobs1.buildStep(id, "01-data");
      await j1.waitForJob();
      await jobs1.approve(id, "01-data");
      await j1.waitForJob();
      // The preview job: the app started (stand-in), its camera running, held until let go.
      let cameraStarted!: () => void;
      const started = new Promise<void>((r) => (cameraStarted = r));
      sb1.cameraHold = { started: () => cameraStarted(), release: new Promise<void>((r) => (release = r)) };
      expect((await jobs1.approve(id, "02-submitter-screen")).next).toBe("preview");
      await started;
      const previewJob = j1.runningJob()!;
      expect(previewJob.projectId).toBe(id);
      const projectsBefore = await projectCount();

      await endInstanceLockSession(pool);
      // The second interface: its lock taken, then its recovery run, as main.ts does at start.
      lock2 = await takeLockWithin(TEST_DB_URL, 5000);
      const j2 = new Journey({ pool, dataDir, cleanupProject: (p, rec) => box.jobs2!.cleanup(p, rec) });
      box.jobs2 = new JourneyJobs({ journey: j2, sandboxes: sb2 });
      expect(await j2.recoverInterrupted()).toContain(id);
      expect(sb2.destroyedRecorded.map((d) => d.projectId)).toContain(id);
      // The first interface's camera is let go: unless it was stopped, its job goes on from here.
      release!();
      await j1.waitForJob();

      // The first accepts no more work: every request, signed in or not, is refused with a plain 503. Its job was
      // stopped and changed nothing more: no screenshot recorded, its app not stopped by it (that is left to the
      // recovery, which has removed the sandbox), and no "finished" or "failed" written for it.
      await until(async () => (await get(app1, "/projects", cookie)).status === 503, 3000);
      const r = await get(app1, "/projects", cookie);
      const made = await post(app1, "/projects", { name: "After the loss (made-up)", cap: "5", brief: "Made-up brief." }, { cookie });
      const evs = await listEvents(pool, id);
      const afterLoss = {
        "GET /projects": r.status,
        "POST /projects (a new project)": made.status,
        "GET /sign-in": (await get(app1, "/sign-in")).status,
        "GET /static/app.css": (await get(app1, "/static/app.css")).status,
        "GET the project's preview": (await get(app1, `/projects/${id}/preview`, cookie)).status,
        "projects made after the loss": (await projectCount()) - projectsBefore,
        "screenshots recorded by the first's job": evs.filter((e) => e.kind === EV.screenshot).length,
        "the first's job written finished or failed": evs.filter((e) => (e.kind === EV.jobFinished || e.kind === EV.jobFailed) && e.payload.job_id === previewJob.jobId).length,
        "app stopped by the first after the loss": evs.filter((e) => e.kind === EV.appStopped).length + sb1.stoppedApps.filter((p) => p === id).length,
        "camera stopped by the halt": sb1.cameraAborted,
      };
      expect(afterLoss).toEqual({
        "GET /projects": 503,
        "POST /projects (a new project)": 503,
        "GET /sign-in": 503,
        "GET /static/app.css": 503,
        "GET the project's preview": 503,
        "projects made after the loss": 0,
        "screenshots recorded by the first's job": 0,
        "the first's job written finished or failed": 0,
        "app stopped by the first after the loss": 0,
        "camera stopped by the halt": 1,
      });
      expect(r.headers.get("content-type")).toMatch(/^text\/plain/);
      expect(await r.text()).toMatch(/lost its instance lock/);
      expect((await j2.state(id)).jobs.find((x) => x.jobId === previewJob.jobId)?.state).toBe("interrupted");
      // Nor does its journey start anything.
      await expect(j1.createProject({ name: "After the loss (made-up)", cap: "5", brief: "Made-up brief." })).rejects.toThrow(/lost its instance lock/);
      await expect(jobs1.acceptance(id)).rejects.toThrow(/lost its instance lock/);
    } finally {
      release?.();
      await lock2?.release();
      await lock1.release();
      sb1.removeAll();
      sb2.removeAll();
    }
  });

  it("before any job starts, the lock is asked of the database: once PostgreSQL has ended its connection, the job is refused and nothing is written, even with nothing else told of the loss; a lock released on purpose reports no loss (review bot on defb9c4, the fix's parts)", async () => {
    const quietSeen: string[] = [];
    const quiet = await holdInstanceLock(TEST_DB_URL, { onLost: (why) => quietSeen.push(why) });
    expect(await quiet.check()).toBeNull();
    await quiet.release();
    await sleep(100);
    expect(quietSeen).toEqual([]);
    expect(quiet.lost()).toBeNull();

    const seen: string[] = [];
    const lock = await holdInstanceLock(TEST_DB_URL, { onLost: (why) => seen.push(why) });
    // Nothing halts this journey: only the check before each job stands between the loss and a job.
    const j = new Journey({ pool, dataDir, ownership: () => lock.check() });
    try {
      const id = await readyProject(j, "Lock asked before a job (made-up)");
      expect(await lock.check()).toBeNull();
      expect(lock.lost()).toBeNull();
      await endInstanceLockSession(pool);
      const before = (await listEvents(pool, id)).length;
      let ran = false;
      await expect(
        j.startJob(id, "build_step", async () => {
          ran = true;
        }, { step: "01-data" }),
      ).rejects.toThrow(LOCK_LOST);
      expect(ran).toBe(false);
      expect(j.runningJob()).toBeNull();
      expect((await listEvents(pool, id)).length).toBe(before);
      expect(lock.lost()).toBe(LOCK_LOST);
      expect(seen).toEqual([LOCK_LOST]);
      // Another interface can take the lock now.
      const other = await holdInstanceLock(TEST_DB_URL);
      await other.release();
    } finally {
      await lock.release();
    }
    expect(seen).toEqual([LOCK_LOST]);
  });

  it("what the interface does once its lock is lost: a line saying why, its running job stopped first (or, if it has not ended in time, left for the next start), then its server closed and exit code 1 (review bot on defb9c4, the fix's parts)", async () => {
    // No job running.
    const j0 = new Journey({ pool, dataDir });
    const log0: string[] = [];
    const calls0: string[] = [];
    await stopAfterLockLost(LOCK_LOST, { journey: j0, closeServer: () => void calls0.push("server closed"), log: (l) => void log0.push(l), exit: (c) => void calls0.push(`exit ${c}`) });
    expect(log0).toEqual([`[interface stopped] ${LOCK_LOST} No job was running.`]);
    expect(calls0).toEqual(["server closed", "exit 1"]);
    expect(j0.halted()).toBe(LOCK_LOST);

    // A job that stops when told to: it ends first, recorded interrupted, then the server is closed.
    const j1 = new Journey({ pool, dataDir });
    const id1 = await readyProject(j1, "Stopped after the lock was lost (made-up)");
    const calls1: string[] = [];
    const { jobId } = await j1.startJob(
      id1,
      "build_step",
      ({ signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => {
            calls1.push("job stopped");
            reject(new Error("stopped"));
          }, { once: true }),
        ),
      { step: "01-data" },
    );
    const log1: string[] = [];
    await stopAfterLockLost(LOCK_LOST, { journey: j1, closeServer: () => void calls1.push("server closed"), log: (l) => void log1.push(l), exit: (c) => void calls1.push(`exit ${c}`), waitMs: 10_000 });
    expect(calls1).toEqual(["job stopped", "server closed", "exit 1"]);
    expect(log1).toEqual([
      `[interface stopped] ${LOCK_LOST} Its running job (${jobId}, project ${id1}) is being stopped first.`,
      `[interface stopped] The job ${jobId} has ended; its record says how. It is not resumed.`,
    ]);
    const s1 = await j1.state(id1);
    expect(s1.jobs.at(-1)).toMatchObject({ jobId, state: "interrupted" });
    expect(s1.jobs.at(-1)!.reason).toBe(`The interface stopped while this job ran: ${LOCK_LOST} The job was stopped part-way and is not resumed.`);

    // A job that does not end in time: the interface exits all the same after the wait.
    const j2 = new Journey({ pool, dataDir });
    const id2 = await readyProject(j2, "Not ended in time (made-up)");
    let letGo!: () => void;
    const second = await j2.startJob(id2, "build_step", () => new Promise((r) => (letGo = () => r({ note: "let go by the test" }))), { step: "01-data" });
    const log2: string[] = [];
    const calls2: string[] = [];
    const t0 = Date.now();
    await stopAfterLockLost(LOCK_LOST, { journey: j2, closeServer: () => void calls2.push("server closed"), log: (l) => void log2.push(l), exit: (c) => void calls2.push(`exit ${c}`), waitMs: 1000 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(calls2).toEqual(["server closed", "exit 1"]);
    expect(log2[1]).toBe(`[interface stopped] The job ${second.jobId} had not ended after 1 s; the interface exits all the same. The next start records it as interrupted and removes the project's sandbox.`);
    letGo();
    await j2.waitForJob();
  });

  it("the real interface (src/web/main.ts, on a database of its own) starts no live preview front unless BUILDER_LIVE_PREVIEW=1: off, nothing listens on its port and Open the live app is refused; on, the front listens (J3's review)", { timeout: 90_000 }, async () => {
    const base = new URL(TEST_DB_URL);
    const dbName = `${decodeURIComponent(base.pathname.slice(1))}_lp_${randomBytes(3).toString("hex")}`;
    expect(dbName).toMatch(/^[a-z0-9_]{1,63}$/);
    await pool.query(`create database "${dbName}"`);
    base.pathname = `/${dbName}`;
    const url = base.toString();
    const dir = mkdtempSync(join(tmpdir(), "builder-web-live-"));
    const procs: ChildProcess[] = [];
    const freePort = () =>
      new Promise<number>((resolve, reject) => {
        const srv = net.createServer();
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => {
          const port = (srv.address() as net.AddressInfo).port;
          srv.close(() => resolve(port));
        });
      });
    const answers = (port: number) =>
      new Promise<boolean>((resolve) => {
        const c = net.connect(port, "127.0.0.1");
        c.once("connect", () => (c.destroy(), resolve(true)));
        c.once("error", () => resolve(false));
      });
    const start = async (extra: Record<string, string>) => {
      const port = await freePort();
      const previewPort = await freePort();
      const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/root", PGUSER: process.env.PGUSER ?? "", BUILDER_DATABASE_URL: url, BUILDER_DATA_DIR: dir, BUILDER_UI_PASSWORD: PASSWORD, BUILDER_UI_PORT: String(port), BUILDER_PREVIEW_PORT: String(previewPort), ...extra };
      const child = spawn(process.execPath, ["--import", "tsx", "src/web/main.ts"], { cwd: builderDir, env, stdio: ["ignore", "pipe", "pipe"] });
      procs.push(child);
      const out = { stdout: "", stderr: "" };
      child.stdout!.on("data", (d: Buffer) => (out.stdout += d.toString("utf8")));
      child.stderr!.on("data", (d: Buffer) => (out.stderr += d.toString("utf8")));
      const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));
      expect(await until(() => out.stdout.includes("Interface listening on"), 30_000), `${out.stdout}\n${out.stderr}`).toBe(true);
      return { port, previewPort, out, exited, child };
    };
    const projectIdIn = async (u: string) => {
      const db = createPool(u);
      try {
        return (await db.query<{ id: string }>("select id from projects order by created_at limit 1")).rows[0]!.id;
      } finally {
        await db.end();
      }
    };
    /** A form POST over HTTP, on a connection of its own. */
    const postTo = (port: number, path: string, form: Record<string, string>, cookie?: string) =>
      new Promise<{ status: number; text: string; setCookie: string }>((resolve, reject) => {
        const body = new URLSearchParams(form).toString();
        const headers = { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body), origin: `http://127.0.0.1:${port}`, ...(cookie ? { cookie } : {}) };
        const req = http.request({ host: "127.0.0.1", port, method: "POST", path, headers, agent: false }, (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (d: string) => (text += d));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text, setCookie: String(res.headers["set-cookie"] ?? "") }));
        });
        req.on("error", reject);
        req.end(body);
      });
    try {
      const off = await start({});
      expect(off.out.stdout).toContain(`Live preview: off (BUILDER_LIVE_PREVIEW is not 1). Nothing listens on 127.0.0.1:${off.previewPort}`);
      expect(off.out.stdout).not.toContain("Live preview front listening");
      expect(await answers(off.previewPort)).toBe(false);
      // Open the live app is refused by the interface itself, before any job.
      const signedIn = await postTo(off.port, "/sign-in", { password: PASSWORD });
      expect(signedIn.status).toBe(303);
      const cookie = /builder_session=[^;]+/.exec(signedIn.setCookie)![0];
      const made = await postTo(off.port, "/projects", { name: "Live off (made-up)", cap: "5", brief: "Made-up brief." }, cookie);
      expect(made.status).toBe(303);
      const id = await projectIdIn(url);
      expect(id).toMatch(/^j1-[0-9a-f]{12}$/);
      const refused = await postTo(off.port, `/projects/${id}/live`, {}, cookie);
      expect(refused.status).toBe(409);
      expect(refused.text).toContain("This interface was started without the live preview.");
      off.child.kill("SIGTERM");
      expect(await off.exited).toBe(0);
      const on = await start({ BUILDER_LIVE_PREVIEW: "1" });
      expect(on.out.stdout).toContain(`Live preview front listening on http://127.0.0.1:${on.previewPort}`);
      expect(await answers(on.previewPort)).toBe(true);
      on.child.kill("SIGTERM");
      expect(await on.exited).toBe(0);
      expect(await answers(on.previewPort)).toBe(false);
    } finally {
      for (const p of procs) if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
      await pool.query(`drop database if exists "${dbName}" with (force)`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the real interface (src/web/main.ts, as npm run web starts it, on a database of its own): when PostgreSQL ends its lock's connection, it accepts no more work and exits with code 1 and a line saying why; a second interface on the same database then starts and runs its recovery (review bot on defb9c4)", { timeout: 90_000 }, async () => {
    const base = new URL(TEST_DB_URL);
    const dbName = `${decodeURIComponent(base.pathname.slice(1))}_lk_${randomBytes(3).toString("hex")}`;
    expect(dbName).toMatch(/^[a-z0-9_]{1,63}$/);
    await pool.query(`create database "${dbName}"`);
    base.pathname = `/${dbName}`;
    const url = base.toString();
    const db = createPool(url);
    const dir = mkdtempSync(join(tmpdir(), "builder-web-lock-"));
    const procs: ChildProcess[] = [];
    const freePort = () =>
      new Promise<number>((resolve, reject) => {
        const srv = net.createServer();
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => {
          const port = (srv.address() as net.AddressInfo).port;
          srv.close(() => resolve(port));
        });
      });
    type Answer = { status: number; text: string; setCookie: string } | "refused";
    /** One request over HTTP, on a connection of its own; "refused" once nothing listens. */
    const httpTo = (port: number, method: "GET" | "POST", path: string, o: { cookie?: string; form?: Record<string, string> } = {}) =>
      new Promise<Answer>((resolve, reject) => {
        const body = o.form ? new URLSearchParams(o.form).toString() : undefined;
        const headers: Record<string, string | number> = { ...(o.cookie ? { cookie: o.cookie } : {}) };
        if (body !== undefined) Object.assign(headers, { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body), origin: `http://127.0.0.1:${port}` });
        const req = http.request({ host: "127.0.0.1", port, method, path, headers, agent: false }, (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (d: string) => (text += d));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text, setCookie: String(res.headers["set-cookie"] ?? "") }));
        });
        req.on("error", (err: NodeJS.ErrnoException) => (err.code === "ECONNREFUSED" || err.code === "ECONNRESET" ? resolve("refused") : reject(err)));
        if (body !== undefined) req.write(body);
        req.end();
      });
    const shown = (a: Answer) => (a === "refused" ? "refused" : a.status);
    const start = async () => {
      const port = await freePort();
      const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/root", PGUSER: process.env.PGUSER ?? "", BUILDER_DATABASE_URL: url, BUILDER_DATA_DIR: dir, BUILDER_UI_PASSWORD: PASSWORD, BUILDER_UI_PORT: String(port) };
      const child = spawn(process.execPath, ["--import", "tsx", "src/web/main.ts"], { cwd: builderDir, env, stdio: ["ignore", "pipe", "pipe"] });
      procs.push(child);
      const out = { stdout: "", stderr: "" };
      child.stdout!.on("data", (d: Buffer) => (out.stdout += d.toString("utf8")));
      child.stderr!.on("data", (d: Buffer) => (out.stderr += d.toString("utf8")));
      const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));
      expect(await until(() => out.stdout.includes("Interface listening on"), 30_000), `${out.stdout}\n${out.stderr}`).toBe(true);
      return { port, out, exited, child };
    };
    const projects = async () => Number((await db.query<{ n: string }>("select count(*)::text as n from projects")).rows[0]!.n);
    try {
      const a = await start();
      const signedIn = await httpTo(a.port, "POST", "/sign-in", { form: { password: PASSWORD } });
      expect(shown(signedIn)).toBe(303);
      const cookie = /builder_session=[^;]+/.exec((signedIn as { setCookie: string }).setCookie)![0];
      // While it holds the lock, it accepts work.
      expect(shown(await httpTo(a.port, "POST", "/projects", { cookie, form: { name: "Before the loss (made-up)", cap: "5", brief: "Made-up brief." } }))).toBe(303);
      expect(await projects()).toBe(1);

      await endInstanceLockSession(db);
      // Every request after the loss is refused with a 503, or not answered at all once the process has exited.
      let last: Answer = "refused";
      await until(async () => {
        last = await httpTo(a.port, "GET", "/projects", { cookie });
        return shown(last) === 503 || shown(last) === "refused";
      }, 5000);
      const after = await httpTo(a.port, "POST", "/projects", { cookie, form: { name: "After the loss (made-up)", cap: "5", brief: "Made-up brief." } });
      const code = await Promise.race([a.exited, sleep(15_000).then(() => "still running")]);
      const notAccepted = (x: Answer) => (shown(x) === 503 || shown(x) === "refused" ? "503 or not answered" : shown(x));
      expect({
        "GET /projects after the loss": notAccepted(last),
        "POST /projects after the loss": notAccepted(after),
        "projects in the database": await projects(),
        "the first interface's exit code": code,
        "its line saying why": /\[interface stopped\] The builder lost its instance lock/.test(a.out.stderr),
      }).toEqual({
        "GET /projects after the loss": "503 or not answered",
        "POST /projects after the loss": "503 or not answered",
        "projects in the database": 1,
        "the first interface's exit code": 1,
        "its line saying why": true,
      });

      // A second interface on the same database starts: it takes the lock and runs its recovery.
      const b = await start();
      expect(b.out.stdout).toMatch(/marked interrupted and removed at start: 0\./);
      b.child.kill("SIGTERM");
      expect(await b.exited).toBe(0);
    } finally {
      for (const p of procs) if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
      await db.end();
      await pool.query(`drop database if exists "${dbName}" with (force)`);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});


describe("J3 interface: the live app's screens (stand-in sandbox, the real front)", () => {
  let sandboxes: StandInSandboxes;
  let preview: LivePreview;
  beforeAll(async () => {
    sandboxes = new StandInSandboxes(pool);
  });
  afterAll(async () => {
    await preview?.stop().catch(() => undefined);
    sandboxes.removeAll();
  });

  it("Open the live app and Show are POSTs only, behind sign-in; the pass and the sample password are on their answers only, never on a GET page or in a record; sign-out ends the live session", async () => {
    const box: { jobs?: JourneyJobs } = {};
    const j = new Journey({ pool, dataDir, cleanupProject: (id, rec) => box.jobs!.cleanup(id, rec) });
    const jobs = new JourneyJobs({ journey: j, sandboxes, measureFree: () => 50 * 1024 ** 3 });
    box.jobs = jobs;
    const net = await import("node:net");
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const port = (s.address() as import("node:net").AddressInfo).port;
    await new Promise((r) => s.close(r));
    preview = new LivePreview({ port, texts: frontTexts(), base: "/tmp", openStream: (id) => jobs.openStream(id), onEvent: async (id, kind, payload) => void (await appendEvent(pool, id, kind, payload)) });
    await preview.start();
    jobs.attachPreview(preview);
    const app = createWebApp({ journey: j, jobs, password: new PasswordState("env", digestPassword(PASSWORD), null), sessions: new Sessions(), limiter: new SignInLimiter(), dataDir, preview });
    const cookie = await signIn(app);
    const made = await post(app, "/projects", { name: "Leave requests (made-up, J3)", cap: "5.00", brief: "I need an app where staff can request leave and managers approve it" }, { cookie });
    const id = /\/projects\/(j1-[0-9a-f]{12})\//.exec(made.headers.get("location") ?? "")![1]!;
    for (const a of ["continue", "answer-rest", "confirm-brief", "confirm-plan"]) expect((await post(app, `/projects/${id}/${a}`, {}, { cookie })).status).toBe(303);
    for (const [a, step] of [["build", "01-data"], ["approve", "01-data"], ["approve", "02-submitter-screen"]] as const) {
      expect((await post(app, `/projects/${id}/${a}`, { step }, { cookie })).status).toBe(303);
      await j.waitForJob();
    }
    let html = await (await get(app, `/projects/${id}/preview`, cookie)).text();
    expect(html).toContain("data-live-open");
    expect(html).toContain("Simulated build: scripted engine, sample data");
    expect(html).toContain("Made-up data only. No customer or personal details. Removed when the project closes.");
    expect(html).toContain("data-live-not-approved");
    expect(html).toContain(`port ${port}`);
    // No GET route opens or shows anything.
    for (const p of [`/projects/${id}/live`, `/projects/${id}/live/show`, `/projects/${id}/live/end`]) expect((await get(app, p, cookie)).status, p).toBe(404);
    // Not signed in, or from another site: refused.
    expect((await post(app, `/projects/${id}/live`, {})).status).toBe(303);
    expect((await post(app, `/projects/${id}/live`, {}, { cookie, origin: "https://evil.example" })).status).toBe(403);
    expect(await listEvents(pool, id, EV.liveOpened)).toHaveLength(0);
    const opened = await post(app, `/projects/${id}/live`, {}, { cookie });
    expect(opened.status).toBe(200);
    expect(opened.headers.get("cache-control")).toBe("no-store");
    const passPage = await opened.text();
    const pass = /data-pass[^>]*><code[^>]*>([0-9A-Z]{4}-[0-9A-Z]{4})</.exec(passPage)?.[1];
    expect(pass).toBeDefined();
    await j.waitForJob();
    html = await (await get(app, `/projects/${id}/preview`, cookie)).text();
    expect(html.includes(pass!)).toBe(false);
    expect(html).toContain('data-live-state="pass_open"');
    const shown = await post(app, `/projects/${id}/live/show`, {}, { cookie });
    expect(shown.status).toBe(200);
    const shownHtml = await shown.text();
    expect(shownHtml).toContain("employee@example.test");
    expect(shownHtml).toContain("made-up-sample-password");
    expect((await (await get(app, `/projects/${id}/preview`, cookie)).text()).includes("made-up-sample-password")).toBe(false);
    const record = JSON.stringify((await listEvents(pool, id)).map((e) => e.payload));
    expect(record.includes(pass!)).toBe(false);
    expect(record.includes(pass!.replace("-", ""))).toBe(false);
    expect(record.includes("made-up-sample-password")).toBe(false);
    // Every value of the sign-in cookie is read: a made-up one of the same name in front of it does not sign the owner out.
    expect((await get(app, "/projects", `builder_session=made-up-not-valid; ${cookie}`)).status).toBe(200);
    // Sign-out ends the live session opened from that sign-in.
    expect(preview.status(id)).not.toBeNull();
    expect((await post(app, "/sign-out", {}, { cookie })).status).toBe(303);
    expect(preview.status(id)).toBeNull();
    expect((await listEvents(pool, id, EV.liveClosed)).at(-1)!.payload).toMatchObject({ reason: "sign_out" });
    await j.closeProject(id);
  }, 60_000);

  it("a live session ends no later than the builder sign-in session that opened it: it is opened to end by that session's expiry, and a new sign-in in the same browser ends it (J3's review)", async () => {
    const box: { jobs?: JourneyJobs } = {};
    const j = new Journey({ pool, dataDir, cleanupProject: (id, rec) => box.jobs!.cleanup(id, rec) });
    const jobs = new JourneyJobs({ journey: j, sandboxes, measureFree: () => 50 * 1024 ** 3 });
    box.jobs = jobs;
    const net = await import("node:net");
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const port = (s.address() as import("node:net").AddressInfo).port;
    await new Promise((r) => s.close(r));
    await preview?.stop().catch(() => undefined);
    preview = new LivePreview({ port, texts: frontTexts(), base: "/tmp", openStream: (id) => jobs.openStream(id), onEvent: async (id, kind, payload) => void (await appendEvent(pool, id, kind, payload)) });
    await preview.start();
    jobs.attachPreview(preview);
    // Sign-in sessions of ten minutes here (eight hours in the interface).
    const app = createWebApp({ journey: j, jobs, password: new PasswordState("env", digestPassword(PASSWORD), null), sessions: new Sessions(10 * 60 * 1000), limiter: new SignInLimiter(), dataDir, preview });
    const cookie = await signIn(app);
    const signedInAt = Date.now();
    const made = await post(app, "/projects", { name: "Leave requests (made-up, J3 review)", cap: "5.00", brief: "I need an app where staff can request leave and managers approve it" }, { cookie });
    const id = /\/projects\/(j1-[0-9a-f]{12})\//.exec(made.headers.get("location") ?? "")![1]!;
    for (const a of ["continue", "answer-rest", "confirm-brief", "confirm-plan"]) expect((await post(app, `/projects/${id}/${a}`, {}, { cookie })).status).toBe(303);
    for (const [a, step] of [["build", "01-data"], ["approve", "01-data"], ["approve", "02-submitter-screen"]] as const) {
      expect((await post(app, `/projects/${id}/${a}`, { step }, { cookie })).status).toBe(303);
      await j.waitForJob();
    }
    expect((await post(app, `/projects/${id}/live`, {}, { cookie })).status).toBe(200);
    await j.waitForJob();
    const live = preview.status(id)!;
    expect(live).not.toBeNull();
    expect(live.endsAt).toBeLessThanOrEqual(signedInAt + 10 * 60 * 1000 + 1000);
    expect(live.endsAt).toBeLessThan(Date.now() + 60 * 60 * 1000);
    // A new sign-in in the same browser (its old cookie sent) ends that sign-in session, and the live session with it.
    const again = await post(app, "/sign-in", { password: PASSWORD }, { cookie });
    expect(again.status).toBe(303);
    expect(preview.status(id)).toBeNull();
    expect((await listEvents(pool, id, EV.liveClosed)).at(-1)!.payload).toMatchObject({ reason: "signed_in_again" });
    await j.closeProject(id);
  }, 60_000);

  /* After the review bot on af80dc9: "Open the live app" while its sign-in session ends (signed out in another tab, or ended otherwise). */

  /** An interface with the real front, a project previewed, and its sign-in cookie; the streams' network check can be held. */
  const liveInterface = async (name: string) => {
    const box: { jobs?: JourneyJobs } = {};
    const j = new Journey({ pool, dataDir, cleanupProject: (id, rec) => box.jobs!.cleanup(id, rec) });
    const jobs = new JourneyJobs({ journey: j, sandboxes, measureFree: () => 50 * 1024 ** 3 });
    box.jobs = jobs;
    const net = await import("node:net");
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const port = (s.address() as import("node:net").AddressInfo).port;
    await new Promise((r) => s.close(r));
    await preview?.stop().catch(() => undefined);
    preview = new LivePreview({ port, texts: frontTexts(), base: "/tmp", openStream: (id) => jobs.openStream(id), onEvent: async (id, kind, payload) => void (await appendEvent(pool, id, kind, payload)) });
    await preview.start();
    jobs.attachPreview(preview);
    const sessions = new Sessions();
    const app = createWebApp({ journey: j, jobs, password: new PasswordState("env", digestPassword(PASSWORD), null), sessions, limiter: new SignInLimiter(), dataDir, preview });
    const cookie = await signIn(app);
    const made = await post(app, "/projects", { name, cap: "5.00", brief: "I need an app where staff can request leave and managers approve it" }, { cookie });
    const id = /\/projects\/(j1-[0-9a-f]{12})\//.exec(made.headers.get("location") ?? "")![1]!;
    for (const a of ["continue", "answer-rest", "confirm-brief", "confirm-plan"]) expect((await post(app, `/projects/${id}/${a}`, {}, { cookie })).status).toBe(303);
    for (const [a, step] of [["build", "01-data"], ["approve", "01-data"], ["approve", "02-submitter-screen"]] as const) {
      expect((await post(app, `/projects/${id}/${a}`, { step }, { cookie })).status).toBe(303);
      await j.waitForJob();
    }
    // The streams' network check waits until it is released: "Open the live app" is then pending.
    let started!: () => void;
    let release!: () => void;
    const asked = new Promise<void>((r) => (started = r));
    sandboxes.streamNetworkHold = { started, release: new Promise<void>((r) => (release = r)) };
    return { j, app, sessions, cookie, id, port, asked, release };
  };
  const passOn = (html: string) => /data-pass[^>]*><code[^>]*>([0-9A-Z]{4}-[0-9A-Z]{4})</.exec(html)?.[1];

  it("a sign-out in another tab while Open the live app is pending cancels it: no pass is shown, no live session exists, and nothing is recorded as opened (review bot on af80dc9)", async () => {
    const t = await liveInterface("Leave requests (made-up, bot af80dc9, sign-out)");
    try {
      const opening = post(t.app, `/projects/${t.id}/live`, {}, { cookie: t.cookie });
      await t.asked;
      // The other tab signs out while the open waits on its network check.
      expect((await post(t.app, "/sign-out", {}, { cookie: t.cookie })).status).toBe(303);
      t.release();
      const r = await opening;
      await t.j.waitForJob();
      const html = await r.text();
      expect(passOn(html)).toBeUndefined();
      expect(r.status).toBe(409);
      expect(preview.session()).toBeNull();
      expect(preview.status(t.id)).toBeNull();
      expect(await listEvents(pool, t.id, EV.liveOpened)).toHaveLength(0);
      expect((await t.j.state(t.id)).jobs.at(-1)).toMatchObject({ kind: "live", state: "failed" });
      // The front has no pass and no session: it says there is no live app.
      expect(await (await fetch(`http://127.0.0.1:${t.port}/`)).text()).toContain("data-no-live");
    } finally {
      sandboxes.streamNetworkHold = null;
      await t.j.waitForJob();
      await t.j.closeProject(t.id);
    }
  }, 60_000);

  it("the sign-in session ended without a sign-out (as at its expiry) while Open the live app is pending: the open checks it again and is refused; no pass, no live session (review bot on af80dc9)", async () => {
    const t = await liveInterface("Leave requests (made-up, bot af80dc9, ended)");
    try {
      const opening = post(t.app, `/projects/${t.id}/live`, {}, { cookie: t.cookie });
      await t.asked;
      t.sessions.end(t.cookie.slice("builder_session=".length));
      t.release();
      const r = await opening;
      await t.j.waitForJob();
      expect(passOn(await r.text())).toBeUndefined();
      expect(r.status).toBe(409);
      expect(preview.session()).toBeNull();
      expect(await listEvents(pool, t.id, EV.liveOpened)).toHaveLength(0);
    } finally {
      sandboxes.streamNetworkHold = null;
      await t.j.waitForJob();
      await t.j.closeProject(t.id);
    }
  }, 60_000);

  it("control: with the same wait, the sign-out of another sign-in session does not cancel the open: its pass is shown and its live session is open (review bot on af80dc9)", async () => {
    const t = await liveInterface("Leave requests (made-up, bot af80dc9, control)");
    try {
      const other = await signIn(t.app);
      expect(other).not.toBe(t.cookie);
      const opening = post(t.app, `/projects/${t.id}/live`, {}, { cookie: t.cookie });
      await t.asked;
      expect((await post(t.app, "/sign-out", {}, { cookie: other })).status).toBe(303);
      t.release();
      const r = await opening;
      await t.j.waitForJob();
      expect(r.status).toBe(200);
      expect(passOn(await r.text())).toBeDefined();
      expect(preview.status(t.id)).not.toBeNull();
      expect(await listEvents(pool, t.id, EV.liveOpened)).toHaveLength(1);
      // Its own sign-out then ends it.
      expect((await post(t.app, "/sign-out", {}, { cookie: t.cookie })).status).toBe(303);
      expect(preview.status(t.id)).toBeNull();
    } finally {
      sandboxes.streamNetworkHold = null;
      await t.j.waitForJob();
      await t.j.closeProject(t.id);
    }
  }, 60_000);

  /*
   * Own check after the review bot on af80dc9 (a fresh reader of 4e41340): a sign-out, or a new sign-in, whose close of
   * the live session already open is slow (its streams killed, its record written). While that close is held, the
   * same sign-in session must not be able to open a new live session from another tab.
   */

  /** An interface with the real front, a project previewed, a live session open for its sign-in, and a way to hold the next close. */
  const heldCloseInterface = async (name: string) => {
    const box: { jobs?: JourneyJobs } = {};
    const j = new Journey({ pool, dataDir, cleanupProject: (id, rec) => box.jobs!.cleanup(id, rec) });
    const jobs = new JourneyJobs({ journey: j, sandboxes, measureFree: () => 50 * 1024 ** 3 });
    box.jobs = jobs;
    sandboxes.streamNetworkHold = null;
    const net = await import("node:net");
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const port = (s.address() as import("node:net").AddressInfo).port;
    await new Promise((r) => s.close(r));
    await preview?.stop().catch(() => undefined);
    // The record of a live session's close waits while a hold is set: the close (and whatever awaits it) is then held.
    const gate: { hold: { started: () => void; release: Promise<void> } | null } = { hold: null };
    preview = new LivePreview({
      port,
      texts: frontTexts(),
      base: "/tmp",
      openStream: (id) => jobs.openStream(id),
      onEvent: async (id, kind, payload) => {
        const hold = kind === EV.liveClosed ? gate.hold : null;
        if (hold) {
          gate.hold = null;
          hold.started();
          await hold.release;
        }
        await appendEvent(pool, id, kind, payload);
      },
    });
    await preview.start();
    jobs.attachPreview(preview);
    const sessions = new Sessions();
    const app = createWebApp({ journey: j, jobs, password: new PasswordState("env", digestPassword(PASSWORD), null), sessions, limiter: new SignInLimiter(), dataDir, preview });
    const cookie = await signIn(app);
    const made = await post(app, "/projects", { name, cap: "5.00", brief: "I need an app where staff can request leave and managers approve it" }, { cookie });
    const id = /\/projects\/(j1-[0-9a-f]{12})\//.exec(made.headers.get("location") ?? "")![1]!;
    for (const a of ["continue", "answer-rest", "confirm-brief", "confirm-plan"]) expect((await post(app, `/projects/${id}/${a}`, {}, { cookie })).status).toBe(303);
    for (const [a, step] of [["build", "01-data"], ["approve", "01-data"], ["approve", "02-submitter-screen"]] as const) {
      expect((await post(app, `/projects/${id}/${a}`, { step }, { cookie })).status).toBe(303);
      await j.waitForJob();
    }
    // A live session open for this sign-in session.
    expect((await post(app, `/projects/${id}/live`, {}, { cookie })).status).toBe(200);
    await j.waitForJob();
    expect(preview.session()?.builderSession).toBe(cookie.slice("builder_session=".length));
    /** The next close of a live session is held at its record: `asked` resolves once it is held, `release` lets it go on. */
    const holdNextClose = () => {
      let started!: () => void;
      let release!: () => void;
      const asked = new Promise<void>((r) => (started = r));
      gate.hold = { started, release: new Promise<void>((r) => (release = r)) };
      return { asked, release };
    };
    return { j, app, sessions, cookie, value: cookie.slice("builder_session=".length), id, port, holdNextClose };
  };
  const reasonsClosed = async (id: string) => (await listEvents(pool, id, EV.liveClosed)).map((e) => (e.payload as { reason?: unknown }).reason);

  it("a sign-out whose close of its live session is held: Open the live app asked for meanwhile from another tab under the same sign-in shows no pass and opens nothing; afterwards no live session is open and the sign-in session is ended (own check after the review bot on af80dc9)", async () => {
    const t = await heldCloseInterface("Leave requests (made-up, own check, sign-out)");
    const held = t.holdNextClose();
    try {
      const signingOut = post(t.app, "/sign-out", {}, { cookie: t.cookie });
      await held.asked;
      // The close of the live session is held. Another tab asks for the live app under the same sign-in session.
      const r = await post(t.app, `/projects/${t.id}/live`, {}, { cookie: t.cookie });
      const html = await r.text();
      held.release();
      expect((await signingOut).status).toBe(303);
      await t.j.waitForJob();
      // Soft: each of the three is reported, whichever fails first.
      expect.soft(passOn(html), "a pass was shown under a sign-in session that was signing out").toBeUndefined();
      expect.soft(preview.session(), "a live session is open after its sign-in session signed out").toBeNull();
      expect.soft(t.sessions.valid(t.value), "the sign-in session still reads as valid").toBe(false);
      expect(r.status).toBe(303);
      expect(r.headers.get("location")).toBe("/sign-in");
      expect(await listEvents(pool, t.id, EV.liveOpened)).toHaveLength(1);
      expect(await reasonsClosed(t.id)).toEqual(["sign_out"]);
      expect(await (await fetch(`http://127.0.0.1:${t.port}/`)).text()).toContain("data-no-live");
    } finally {
      held.release();
      await t.j.waitForJob();
      await t.j.closeProject(t.id);
    }
  }, 60_000);

  it("a new sign-in in the same browser whose close of the replaced sign-in's live session is held: Open the live app asked for meanwhile under the replaced sign-in shows no pass and opens nothing; afterwards no live session is open (own check after the review bot on af80dc9)", async () => {
    const t = await heldCloseInterface("Leave requests (made-up, own check, sign-in again)");
    const held = t.holdNextClose();
    try {
      const signingIn = post(t.app, "/sign-in", { password: PASSWORD }, { cookie: t.cookie });
      await held.asked;
      const r = await post(t.app, `/projects/${t.id}/live`, {}, { cookie: t.cookie });
      const html = await r.text();
      held.release();
      const again = await signingIn;
      expect(again.status).toBe(303);
      await t.j.waitForJob();
      expect.soft(passOn(html), "a pass was shown under a sign-in session that a new sign-in was ending").toBeUndefined();
      expect.soft(preview.session(), "a live session is open after its sign-in session was replaced").toBeNull();
      expect.soft(t.sessions.valid(t.value), "the replaced sign-in session still reads as valid").toBe(false);
      expect(r.status).toBe(303);
      expect(r.headers.get("location")).toBe("/sign-in");
      // The new sign-in session is valid and has no live session.
      const fresh = /builder_session=([^;]+)/.exec(again.headers.get("set-cookie") ?? "")?.[1];
      expect(t.sessions.valid(fresh)).toBe(true);
      expect(await listEvents(pool, t.id, EV.liveOpened)).toHaveLength(1);
      expect(await reasonsClosed(t.id)).toEqual(["signed_in_again"]);
    } finally {
      held.release();
      await t.j.waitForJob();
      await t.j.closeProject(t.id);
    }
  }, 60_000);

  it("control: with the same held close, Open the live app asked for meanwhile under another valid sign-in session is not refused: its pass is shown and its live session stays open after the sign-out (own check after the review bot on af80dc9)", async () => {
    const t = await heldCloseInterface("Leave requests (made-up, own check, control)");
    const other = await signIn(t.app);
    const otherValue = other.slice("builder_session=".length);
    const held = t.holdNextClose();
    try {
      const signingOut = post(t.app, "/sign-out", {}, { cookie: t.cookie });
      await held.asked;
      const r = await post(t.app, `/projects/${t.id}/live`, {}, { cookie: other });
      const html = await r.text();
      held.release();
      expect((await signingOut).status).toBe(303);
      await t.j.waitForJob();
      expect(r.status).toBe(200);
      expect(passOn(html)).toBeDefined();
      expect(preview.session()?.builderSession).toBe(otherValue);
      expect(t.sessions.valid(otherValue)).toBe(true);
      expect(t.sessions.valid(t.value)).toBe(false);
      expect(await listEvents(pool, t.id, EV.liveOpened)).toHaveLength(2);
      expect(await reasonsClosed(t.id)).toEqual(["sign_out"]);
      // Its own sign-out then ends it.
      expect((await post(t.app, "/sign-out", {}, { cookie: other })).status).toBe(303);
      expect(preview.session()).toBeNull();
    } finally {
      held.release();
      await t.j.waitForJob();
      await t.j.closeProject(t.id);
    }
  }, 60_000);

  it("a sign-out from a browser that sends two valid values of the sign-in cookie ends both, and closes the live session opened under the second value too, not only one opened under the first (own check after the review bot on af80dc9)", async () => {
    const t = await heldCloseInterface("Leave requests (made-up, own check, every value)");
    const other = await signIn(t.app);
    const otherValue = other.slice("builder_session=".length);
    try {
      // A live session opened under the other value (it replaces the first).
      expect((await post(t.app, `/projects/${t.id}/live`, {}, { cookie: other })).status).toBe(200);
      await t.j.waitForJob();
      expect(preview.session()?.builderSession).toBe(otherValue);
      // The browser sends both values, the first sign-in's first: the interface reads that one as the request's session.
      expect((await post(t.app, "/sign-out", {}, { cookie: `${t.cookie}; ${other}` })).status).toBe(303);
      expect(t.sessions.valid(t.value)).toBe(false);
      expect(t.sessions.valid(otherValue)).toBe(false);
      expect(preview.session(), "a live session is open under a sign-in value the sign-out ended").toBeNull();
      expect(await reasonsClosed(t.id)).toEqual(["replaced", "sign_out"]);
    } finally {
      await t.j.waitForJob();
      await t.j.closeProject(t.id);
    }
  }, 60_000);
});

describe("J2 (a) interface: the broken-copy demonstration's screens (stand-in sandboxes with their own change-set folders, no container)", () => {
  const BROKEN = BROKEN_STEP_ID;
  const NAME = "Deliberately broken copy (made-up)";
  const BADGE = "Deliberately broken copy: a defect Claude Code planted on purpose";
  const NEVER = "A deliberately broken copy is never signed off or exported.";
  const LIVE_REFUSED = "A deliberately broken copy is not offered as a live app: it was built to be rejected by the checklist.";
  const NO_QUALITY_CHECK = "No quality check after a step yet, and no retry (milestones 1 and 3): only the checklist at the end checks the app.";
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const SCREENS = ["brief", "questions", "proposal", "plan", "build", "preview", "acceptance", "export", "cost", "record"] as const;
  let sandboxes: StandInSandboxes;
  const previews: LivePreview[] = [];
  beforeAll(() => {
    sandboxes = new StandInSandboxes(pool);
  });
  afterAll(async () => {
    for (const p of previews) await p.stop().catch(() => undefined);
    sandboxes.removeAll();
  });

  /** The interface with the jobs on stand-in sandboxes; with `front`, the live preview's front on, as J3's screens test it. */
  async function makeJobsApp(o: { front?: boolean } = {}) {
    const box: { jobs?: JourneyJobs } = {};
    const j = new Journey({ pool, dataDir, cleanupProject: (id, rec) => box.jobs!.cleanup(id, rec) });
    const jobs = new JourneyJobs({ journey: j, sandboxes, measureFree: () => 50 * 1024 ** 3 });
    box.jobs = jobs;
    let preview: LivePreview | undefined;
    if (o.front) {
      const srv = net.createServer();
      await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
      const port = (srv.address() as net.AddressInfo).port;
      await new Promise((r) => srv.close(r));
      preview = new LivePreview({ port, texts: frontTexts(), base: "/tmp", openStream: (id) => jobs.openStream(id), onEvent: async (id, kind, payload) => void (await appendEvent(pool, id, kind, payload)) });
      await preview.start();
      previews.push(preview);
      jobs.attachPreview(preview);
    }
    const app = createWebApp({ journey: j, jobs, password: new PasswordState("env", digestPassword(PASSWORD), null), sessions: new Sessions(), limiter: new SignInLimiter(), dataDir, preview });
    return { app, j, jobs };
  }
  const page = async (app: App, path: string, cookie: string) => {
    const r = await get(app, path, cookie);
    expect(r.status, path).toBe(200);
    return r.text();
  };
  const go = async (app: App, j: Journey, path: string, cookie: string, data: Record<string, string> = {}) => {
    const r = await post(app, path, data, { cookie });
    expect(r.status, `${path}: ${r.status === 303 ? "" : await r.clone().text()}`).toBe(303);
    await j.waitForJob();
    return r.headers.get("location");
  };
  const idFrom = (location: string | null) => /^\/projects\/(j1-[0-9a-f]{12})\/brief$/.exec(location ?? "")![1]!;
  /** The demonstration's button, pressed; the questions answered and both confirmations given. */
  const demo = async (app: App, j: Journey, cookie: string, o: { confirm?: boolean } = {}) => {
    const id = idFrom(await go(app, j, "/demonstrations/broken-copy", cookie));
    if (o.confirm !== false) for (const a of ["continue", "answer-rest", "confirm-brief", "confirm-plan"]) await go(app, j, `/projects/${id}/${a}`, cookie);
    return id;
  };
  const normal = async (app: App, j: Journey, cookie: string, data: Record<string, string> = {}) => {
    const made = await post(app, "/projects", { name: "Leave requests (made-up, J2)", cap: "5.00", brief: "I need an app where staff can request leave and managers approve it", ...data }, { cookie });
    expect(made.status).toBe(303);
    const id = idFrom(made.headers.get("location"));
    for (const a of ["continue", "answer-rest", "confirm-brief", "confirm-plan"]) await go(app, j, `/projects/${id}/${a}`, cookie);
    return id;
  };
  /** Steps built and approved through the screens, then the preview (the approval of the last step starts it). */
  const toPreview = async (app: App, j: Journey, cookie: string, id: string) => {
    await go(app, j, `/projects/${id}/build`, cookie, { step: "01-data" });
    for (const step of (await j.state(id)).plan) await go(app, j, `/projects/${id}/approve`, cookie, { step });
    expect((await j.state(id)).previewFinished).toBe(true);
  };
  const badgeShown = (html: string) => html.includes(`data-broken-badge>${esc(BADGE)}<`);
  const heading = (html: string) => /<h1>[\s\S]*?<\/h1>/.exec(html)?.[0] ?? "";
  /** A project's row in the Projects list. */
  const listRow = async (app: App, cookie: string, id: string) => new RegExp(`<tr data-project="${id}">[\\s\\S]*?</tr>`).exec(await page(app, "/projects", cookie))?.[0] ?? "";

  it("A2 and A8: the Projects screen has a panel of its own, labelled Simulated build, with one button, apart from New project; the New project form keeps its three fields; the button makes one project with the fixed name and a $5.00 cap, whose first event carries broken_copy; the badge is on its list row and every page, in English and Arabic", async () => {
    const { app, j } = await makeJobsApp();
    const cookie = await signIn(app);
    for (const lang of ["en", "ar"] as const) {
      const html = await page(app, `/projects?lang=${lang}`, cookie);
      const sections = html.split("<section ").slice(1);
      const demoPanel = sections.filter((x) => x.includes('action="/demonstrations/broken-copy"'));
      expect(demoPanel, lang).toHaveLength(1);
      expect(demoPanel[0], lang).toMatch(/^class="panel sim" data-panel="simulated">/);
      expect(demoPanel[0], lang).toContain(`<h2>${esc(t(lang, "demo.title"))}<span class="badge">`);
      expect(demoPanel[0], lang).toContain(esc(t(lang, "demo.intro")));
      // After J2's second review: the limit of the demonstration is on the screen, not only in the documents.
      expect(demoPanel[0], lang).toContain(`<p class="note" data-demo-limit>${esc(t(lang, "demo.limit"))}</p>`);
      expect(demoPanel[0], lang).toContain(`<button type="submit" class="">${esc(t(lang, "demo.button"))}</button>`);
      expect(demoPanel[0], lang).not.toContain('href="/projects/new"');
      expect(demoPanel[0]!.match(/<form /g), lang).toHaveLength(1);
      expect(sections.some((x) => x.includes('href="/projects/new"')), lang).toBe(true);
    }
    expect(t("en", "demo.title")).toBe("Simulated build");
    expect(t("en", "demo.button")).toBe("Start the broken-copy demonstration");
    expect(t("en", "demo.limit")).toBe("What this shows, and what it does not: Claude Code wrote both the planted defect and the test, each knowing the other. A failed run here shows the checklist's runner rejecting this one defect. It does not show that the checklist catches defects in general.");
    expect(t("en", "demo.intro")).toBe("Builds example 1 with one more step that Claude Code broke on purpose: a new request is saved as Approved instead of Waiting. The steps are fixed changes written in advance; no AI model is called. The checklist run on it is real. It is never signed off or exported.");
    // The New project form: the same three fields as before.
    const form = await page(app, "/projects/new", cookie);
    const newForm = /<form method="post" action="\/projects">[\s\S]*?<\/form>/.exec(form)![0];
    expect([...newForm.matchAll(/<(?:input|textarea|select)[^>]* name="([^"]+)"/g)].map((m) => m[1])).toEqual(["name", "cap", "brief"]);
    const projects = await projectCount();
    const id = await demo(app, j, cookie, { confirm: false });
    expect(await projectCount()).toBe(projects + 1);
    const s = await j.state(id);
    expect(s.project.name).toBe(NAME);
    expect(Number(s.project.cap_usd)).toBe(5);
    const first = (await listEvents(pool, id))[0]!;
    expect(first.kind).toBe(EV.briefEntered);
    expect(first.payload.broken_copy).toMatchObject({ by: "owner", step: BROKEN, sign_off: "never", export: "never" });
    expect(t("en", "broken.badge")).toBe(BADGE);
    const n = await normal(app, j, cookie);
    for (const lang of ["en", "ar"] as const) {
      const list = await page(app, `/projects?lang=${lang}`, cookie);
      const row = (p: string) => new RegExp(`<tr data-project="${p}">[\\s\\S]*?</tr>`).exec(list)?.[0] ?? "";
      expect(row(id), lang).toContain(`data-broken-badge>${esc(t(lang, "broken.badge"))}<`);
      expect(row(n), lang).not.toContain("data-broken-badge");
      for (const screen of SCREENS) {
        const html = await page(app, `/projects/${id}/${screen}?lang=${lang}`, cookie);
        expect(heading(html), `${screen} ${lang}`).toContain(`data-broken-badge>${esc(t(lang, "broken.badge"))}<`);
        expect(heading(await page(app, `/projects/${n}/${screen}?lang=${lang}`, cookie)), `${screen} ${lang}`).not.toContain("data-broken-badge");
      }
    }
    await go(app, j, `/projects/${id}/close`, cookie);
    await go(app, j, `/projects/${n}/close`, cookie);
  });

  it("A8: the broken copy through the screens: three steps, step 3's wording and the quality-check line on the plan and build screens, the approve wording, the checklist Failed with the step it failed at and its screenshot, the sign-off lines, no sign-off button and no Export tab; three reservations closed and $0.00 spent; then Close project", async () => {
    const { app, j } = await makeJobsApp();
    const cookie = await signIn(app);
    const id = await demo(app, j, cookie);
    const manifest = JSON.parse(readFileSync(join(builderDir, "scripted-broken", "example-1", BROKEN, "manifest.json"), "utf8")) as { label: string };
    for (const lang of ["en", "ar"] as const) {
      const plan = await page(app, `/projects/${id}/plan?lang=${lang}`, cookie);
      expect([...plan.matchAll(/<li data-step="([^"]+)">/g)].map((m) => m[1]), lang).toEqual(["01-data", "02-submitter-screen", BROKEN]);
      const step3 = new RegExp(`<li data-step="${BROKEN}">[\\s\\S]*?</li>`).exec(plan)![0];
      expect(step3, lang).toContain(esc(manifest.label));
      expect(step3, lang).toContain(`data-broken-step>${esc(t(lang, "broken.step_note"))}<`);
      expect(plan, lang).toContain(esc(t(lang, "plan.quality_gate")));
      expect(plan, lang).toContain(`data-no-quality-check>${esc(t(lang, "broken.no_quality_check"))}<`);
      const build = await page(app, `/projects/${id}/build?lang=${lang}`, cookie);
      expect(build, lang).toContain(`data-no-quality-check>${esc(t(lang, "broken.no_quality_check"))}<`);
      expect(build, lang).toContain(esc(t(lang, "build.step_title", { n: 3, total: 3 }).replace("{step}", "")));
    }
    expect(t("en", "broken.no_quality_check")).toBe(NO_QUALITY_CHECK);
    expect(t("en", "broken.step_note")).toBe("Deliberately broken copy: a new request is saved as Approved instead of Waiting. Made so that the checklist rejects it.");
    await go(app, j, `/projects/${id}/build`, cookie, { step: "01-data" });
    await go(app, j, `/projects/${id}/approve`, cookie, { step: "01-data" });
    let build = await page(app, `/projects/${id}/build`, cookie);
    expect(build).toContain(`<button type="submit" data-approve="02-submitter-screen">Approve and build step 3 (the deliberately broken copy)</button>`);
    expect(await go(app, j, `/projects/${id}/approve`, cookie, { step: "02-submitter-screen" })).toBe(`/projects/${id}/build`);
    build = await page(app, `/projects/${id}/build`, cookie);
    expect(build).toContain(`data-step="${BROKEN}" data-step-state="finished" data-approved="no"`);
    expect(build).toContain('data-reserved="$1.1664"');
    expect(build).toContain(`<button type="submit" data-approve="${BROKEN}">Go on to the preview with this broken step (no quality check after a step yet)</button>`);
    const ar = await page(app, `/projects/${id}/build?lang=ar`, cookie);
    expect(ar).toContain(`data-approve="${BROKEN}">${esc(t("ar", "build.approve_after_broken"))}</button>`);
    expect(await go(app, j, `/projects/${id}/approve`, cookie, { step: BROKEN })).toBe(`/projects/${id}/preview`);
    expect(await page(app, `/projects/${id}/preview`, cookie)).toContain('data-shots="4"');
    sandboxes.acceptanceOutcome = "failed";
    try {
      await go(app, j, `/projects/${id}/acceptance`, cookie);
    } finally {
      sandboxes.acceptanceOutcome = "passed";
    }
    const s = await j.state(id);
    const finished = (await listEvents(pool, id, "acceptance.run.finished")).at(-1)!;
    expect(finished.payload).toMatchObject({ outcome: "failed", exit_code: 1, summary: FAILED_SUMMARY, version: s.acceptanceVersion });
    expect(FAILED_SUMMARY).toBe('version failed: item 1 failed at step "sees status waiting"');
    const item = (await listEvents(pool, id, "acceptance.item")).at(-1)!;
    const failure = item.payload.failure_file as { path: string; sha256: string };
    expect(sha256(readFileSync(failure.path))).toBe(failure.sha256);
    expect(readFileSync(failure.path, "utf8")).toContain("Approved");
    for (const lang of ["en", "ar"] as const) {
      const html = await page(app, `/projects/${id}/acceptance?lang=${lang}`, cookie);
      expect(html.match(new RegExp(`<strong class="warn" data-outcome="failed">${t(lang, "acceptance.outcome.failed")}</strong>`, "g")) ?? [], lang).toHaveLength(2);
      expect(html, lang).toContain(`<td lang="en" dir="ltr" data-summary>${esc(FAILED_SUMMARY)}</td>`);
      expect(html, lang).toContain(`<th>${esc(t(lang, "acceptance.exit"))}</th><td>1</td>`);
      const row1 = /<tr data-item="1"[\s\S]*?<\/tr>/.exec(html)![0];
      expect(row1, lang).toContain('data-status="failed" data-shown="failed"');
      expect(row1, lang).toContain(`<strong class="warn">${t(lang, "acceptance.status.failed")}</strong>`);
      expect(row1, lang).toContain(`<div class="note" data-failed-step>${esc(t(lang, "acceptance.failed_at_step").split("{step}")[0]!)}<span lang="en" dir="ltr">${FAILED_STEP}</span>`);
      expect(row1, lang).toContain(`<img src="/projects/${id}/files/${item.id}"`);
      for (const n of [2, 3, 4, 5, 6]) expect(new RegExp(`<tr data-item="${n}" data-status="did not run" data-shown="did_not_run">`).test(html), `${lang} item ${n}`).toBe(true);
      expect(html, lang).toContain(esc(t(lang, "acceptance.sign_off_not_yet")));
      expect(html, lang).toContain(`data-broken-never>${esc(t(lang, "broken.never_signed_off"))}<`);
      expect(html, lang).toContain(`<p class="note" data-demo-limit>${esc(t(lang, "demo.limit"))}</p>`);
      expect(html, lang).not.toContain(`action="/projects/${id}/sign-off"`);
      expect(html, lang).not.toContain(`href="/projects/${id}/export"`);
    }
    expect(t("en", "acceptance.failed_at_step", { step: FAILED_STEP })).toBe("Failed at step: sees status waiting");
    expect(t("en", "broken.never_signed_off")).toBe(NEVER);
    const shot = await get(app, `/projects/${id}/files/${item.id}`, cookie);
    expect(shot.headers.get("content-type")).toBe("image/png");
    const signOff = await post(app, `/projects/${id}/sign-off`, {}, { cookie });
    expect(signOff.status).toBe(409);
    expect(await signOff.text()).toContain("The last checklist run did not pass, so there is nothing to sign off.");
    expect((await post(app, `/projects/${id}/export`, {}, { cookie })).status).toBe(409);
    expect(await page(app, `/projects/${id}/export`, cookie)).toContain("data-export-not-offered");
    for (const screen of SCREENS) expect(await page(app, `/projects/${id}/${screen}`, cookie), screen).not.toContain(`href="/projects/${id}/export"`);
    const cost = await page(app, `/projects/${id}/cost`, cookie);
    expect(cost).toContain('<td data-spent>$0.00</td>');
    expect([...cost.matchAll(/<tr><td><bdi dir="ltr">([^<]+)<\/bdi><\/td><td>(\$[0-9.]+)<\/td><td>([^<]+)<\/td><\/tr>/g)].map((m) => [m[1], m[2], m[3]])).toEqual([
      ["01-data", "$1.5552", "closed (step_ended)"],
      ["02-submitter-screen", "$3.1104", "closed (step_ended)"],
      [BROKEN, "$1.1664", "closed (step_ended)"],
    ]);
    const kinds = (await listEvents(pool, id)).map((e) => e.kind);
    expect(kinds).not.toContain(EV.signedOff);
    expect(kinds).not.toContain(EV.exportWritten);
    expect(kinds.filter((k) => k === "journey.broken_step_staged")).toHaveLength(1);
    await go(app, j, `/projects/${id}/close`, cookie);
    expect(sandboxes.destroyed).toContain(id);
    expect(await page(app, `/projects/${id}/record`, cookie)).toContain("data-closed");
  });

  it("A8: 'Failed at step' is shown in a failed item's row for every project, a normal one too", async () => {
    const { app, j } = await makeJobsApp();
    const cookie = await signIn(app);
    const id = await normal(app, j, cookie);
    await toPreview(app, j, cookie, id);
    sandboxes.acceptanceOutcome = "failed";
    try {
      await go(app, j, `/projects/${id}/acceptance`, cookie);
    } finally {
      sandboxes.acceptanceOutcome = "passed";
    }
    const html = await page(app, `/projects/${id}/acceptance`, cookie);
    expect(/<tr data-item="1"[\s\S]*?<\/tr>/.exec(html)![0]).toContain(`<div class="note" data-failed-step>Failed at step: <span lang="en" dir="ltr">${FAILED_STEP}</span></div>`);
    expect(html).not.toContain("data-broken-never");
    expect(badgeShown(html)).toBe(false);
    await go(app, j, `/projects/${id}/close`, cookie);
  });

  it("A1b (regression guard): a normal project past both confirmations, steps 1 and 2 built and approved (the preview waited for), asks to build 03-wrong-status: 409, \"That step is not one of the plan's.\", no job starts, nothing is staged, builder/scripted is unchanged; the same with a broken_copy written later by hand", async () => {
    const before = changeSetFolders();
    const { app, j } = await makeJobsApp();
    const cookie = await signIn(app);
    const id = await normal(app, j, cookie);
    await toPreview(app, j, cookie, id);
    const refusedNow = async (what: string) => {
      const started = (await listEvents(pool, id, EV.jobStarted)).length;
      const r = await post(app, `/projects/${id}/build`, { step: BROKEN }, { cookie });
      expect(r.status, what).toBe(409);
      expect(await r.text(), what).toContain("That step is not one of the plan&#39;s.");
      await j.waitForJob();
      expect((await listEvents(pool, id, EV.jobStarted)).length, what).toBe(started);
      expect((await listEvents(pool, id)).filter((e) => e.step === BROKEN), what).toEqual([]);
      expect(sandboxes.stagedBroken.filter((c) => c.projectId === id), what).toEqual([]);
    };
    await refusedNow("a normal project");
    const first = (await listEvents(pool, id))[0]!;
    const choice = { by: "owner", step: BROKEN, source: "builder/scripted-broken/example-1/03-wrong-status", label: "made-up", manifest_sha256: sha256(readFileSync(join(builderDir, "scripted-broken", "example-1", BROKEN, "manifest.json"))), sign_off: "never", export: "never" };
    await appendEvent(pool, id, EV.briefEntered, { ...first.payload, broken_copy: choice });
    await refusedNow("a broken_copy written later by hand");
    expect((await j.state(id)).plan).toEqual(["01-data", "02-submitter-screen"]);
    await go(app, j, `/projects/${id}/close`, cookie);
    expect(changeSetFolders()).toEqual(before);
  });

  it("A2b: POST /projects with extra fields (broken_copy=1, step=03-wrong-status) makes a normal project: two steps, nothing of the choice recorded, no badge (regression guard); a name that starts 'Deliberately broken copy' is refused on the New project form, and nothing is made", async () => {
    const { app, j } = await makeJobsApp();
    const cookie = await signIn(app);
    const id = await normal(app, j, cookie, { broken_copy: "1", step: BROKEN });
    const s = await j.state(id);
    expect(s.plan).toEqual(["01-data", "02-submitter-screen"]);
    expect(s.events.filter((e) => "broken_copy" in e.payload)).toEqual([]);
    expect(Object.keys(s.events[0]!.payload).sort()).toEqual(["characters", "given_to_engine", "text"]);
    expect(badgeShown(await page(app, `/projects/${id}/plan`, cookie))).toBe(false);
    const row = await listRow(app, cookie, id);
    expect(row).toContain(`<tr data-project="${id}">`);
    expect(badgeShown(row)).toBe(false);
    await go(app, j, `/projects/${id}/close`, cookie);
    const projects = await projectCount();
    for (const name of [NAME, "Deliberately broken copy", "deliberately broken copy of my own (made-up)", "  Deliberately   Broken Copy, again (made-up)"]) {
      const r = await post(app, "/projects", { name, cap: "5.00", brief: "Made-up brief." }, { cookie });
      expect(r.status, name).toBe(400);
      const html = await r.text();
      expect(html, name).toContain(esc('A name that starts "Deliberately broken copy" is kept for the broken-copy demonstration on the Projects screen. Give this project another name.'));
      expect(html, name).toContain('action="/projects"');
    }
    expect(await projectCount()).toBe(projects);
  });

  it("A6: a broken copy whose checklist run reads 'passed' (a forged pass): no sign-off button, the warning instead, POST sign-off 409; with a forged journey.signed_off, POST export 409 and nothing exported; a normal project whose record holds only a journey.broken_step_staged, or only an engine event of step 03: the badge, sign-off and export refused", async () => {
    const { app, j } = await makeJobsApp();
    const cookie = await signIn(app);
    const id = await demo(app, j, cookie);
    await toPreview(app, j, cookie, id);
    sandboxes.acceptanceOutcome = "passed";
    await go(app, j, `/projects/${id}/acceptance`, cookie);
    expect((await j.state(id)).acceptanceRun?.outcome).toBe("passed");
    expect(t("en", "broken.passed_warning")).toBe("A checklist run passed on a deliberately broken copy: the check did not catch the planted defect. It is still not signed off.");
    for (const lang of ["en", "ar"] as const) {
      const html = await page(app, `/projects/${id}/acceptance?lang=${lang}`, cookie);
      expect(html, lang).toContain(`data-broken-passed>${esc(t(lang, "broken.passed_warning"))}<`);
      expect(html, lang).not.toContain(esc(t(lang, "acceptance.sign_off_not_yet")));
      expect(html, lang).toContain(`data-broken-never>${esc(t(lang, "broken.never_signed_off"))}<`);
      expect(html, lang).not.toContain(`action="/projects/${id}/sign-off"`);
    }
    const r = await post(app, `/projects/${id}/sign-off`, {}, { cookie });
    expect(r.status).toBe(409);
    expect(await r.text()).toContain(NEVER);
    await appendEvent(pool, id, EV.signedOff, { note: "forged by the test" });
    const e = await post(app, `/projects/${id}/export`, {}, { cookie });
    expect(e.status).toBe(409);
    expect(await e.text()).toContain(NEVER);
    expect(await page(app, `/projects/${id}/export`, cookie)).not.toContain(`action="/projects/${id}/export"`);
    expect(await listEvents(pool, id, EV.exportWritten)).toEqual([]);
    await go(app, j, `/projects/${id}/close`, cookie);
    for (const [what, kind, payload] of [
      ["only a journey.broken_step_staged", "journey.broken_step_staged", { note: "forged by the test" }],
      ["only an engine event of step 03", EV.engineEvent, { type: "text", text: "Scripted engine: made-up line of the test.", at: new Date().toISOString() }],
    ] as const) {
      const n = await normal(app, j, cookie);
      await toPreview(app, j, cookie, n);
      await go(app, j, `/projects/${n}/acceptance`, cookie);
      expect(await page(app, `/projects/${n}/acceptance`, cookie), what).toContain(`action="/projects/${n}/sign-off"`);
      await appendEvent(pool, n, kind, payload, BROKEN);
      const html = await page(app, `/projects/${n}/acceptance`, cookie);
      expect(badgeShown(heading(html)), what).toBe(true);
      expect(html, what).not.toContain(`action="/projects/${n}/sign-off"`);
      expect(html, what).toContain("data-broken-passed");
      expect((await post(app, `/projects/${n}/sign-off`, {}, { cookie })).status, what).toBe(409);
      await appendEvent(pool, n, EV.signedOff, { note: "forged by the test" });
      expect((await post(app, `/projects/${n}/export`, {}, { cookie })).status, what).toBe(409);
      expect(await listEvents(pool, n, EV.exportWritten), what).toEqual([]);
      expect(badgeShown(await listRow(app, cookie, n)), what).toBe(true);
      await go(app, j, `/projects/${n}/close`, cookie);
    }
  });

  it("A7: a broken copy's preview screen renders with the live preview's front on: no 'Open the live app', the plain sentence instead; POST live 409", async () => {
    const { app, j } = await makeJobsApp({ front: true });
    const cookie = await signIn(app);
    const id = await demo(app, j, cookie);
    await toPreview(app, j, cookie, id);
    for (const lang of ["en", "ar"] as const) {
      const html = await page(app, `/projects/${id}/preview?lang=${lang}`, cookie);
      expect(html, lang).toContain(`<p class="warn" lang="en" dir="ltr" data-live-refused>${esc(LIVE_REFUSED)}</p>`);
      expect(html, lang).not.toContain("data-live-open");
      expect(html, lang).toContain('data-shots="4"');
    }
    const r = await post(app, `/projects/${id}/live`, {}, { cookie });
    expect(r.status).toBe(409);
    expect(await r.text()).toContain(esc(LIVE_REFUSED));
    expect((await listEvents(pool, id, EV.liveOpened))).toEqual([]);
    await go(app, j, `/projects/${id}/close`, cookie);
  });

  it("A9: an interrupted project whose last checklist run passed: the interrupted panel, no sign-off button, and POST sign-off 409", async () => {
    const { app, j } = await makeJobsApp();
    const cookie = await signIn(app);
    const id = await normal(app, j, cookie);
    await toPreview(app, j, cookie, id);
    await go(app, j, `/projects/${id}/acceptance`, cookie);
    expect(await page(app, `/projects/${id}/acceptance`, cookie)).toContain(`action="/projects/${id}/sign-off"`);
    // As the next start's recovery records a sandbox left by an interface that stopped (journey.ts, recoverInterrupted).
    await appendEvent(pool, id, EV.sandboxRemoved, { reason: "Found at start: made by an interface that has since stopped. It is not resumed.", interrupted: true, removed: true });
    for (const lang of ["en", "ar"] as const) {
      const html = await page(app, `/projects/${id}/acceptance?lang=${lang}`, cookie);
      // The interrupted panel: its "Close project" is the only one on this screen.
      expect(html, lang).toContain(`<form method="post" action="/projects/${id}/close"><button type="submit">${esc(t(lang, "interrupted.close"))}</button></form>`);
      expect(html, lang).not.toContain(`action="/projects/${id}/sign-off"`);
    }
    const r = await post(app, `/projects/${id}/sign-off`, {}, { cookie });
    expect(r.status).toBe(409);
    expect(await r.text()).toContain("This project was interrupted when the interface stopped, so it is not signed off.");
    expect(await listEvents(pool, id, EV.signedOff)).toEqual([]);
    await go(app, j, `/projects/${id}/close`, cookie);
  });
});

describe("J2 (c) interface: the clean stop and restart (stand-in sandboxes, no container; each test on a database of its own)", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (f: () => boolean | Promise<boolean>, ms: number): Promise<boolean> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await f()) return true;
      await sleep(50);
    }
    return f();
  };
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  /** The reason the record gives for a sandbox removed at a clean stop (final design, section 4.1, item 5). */
  const AT_STOP = "The interface was stopped on purpose; this project's containers, images and folder were removed at the stop. It is not resumed.";
  const STOPPED_PART_WAY = "stopped part-way when the interface stopped; not resumed";
  const NO_JOB = "The interface stopped while this project's app was set up or running. Its containers are removed at the stop or at the next start; nothing is resumed. Close the project, or start a new one.";
  const WITH_JOB = "A job of this project was interrupted when the interface stopped. It is not resumed. Close the project, or start a new one.";
  const interruptedFor = (sig: string) => `The interface stopped while this job ran: The interface was stopped on purpose (${sig}). The job was stopped part-way and is not resumed.`;

  /** A database of its own for one test (named after the test database, so builder_test_j2_… in J2's runs), migrated; dropped by `drop`. */
  async function freshDb() {
    const base = new URL(TEST_DB_URL);
    const name = `${decodeURIComponent(base.pathname.slice(1))}_st_${randomBytes(3).toString("hex")}`;
    expect(name).toMatch(/^[a-z0-9_]{1,63}$/);
    await pool.query(`create database "${name}"`);
    base.pathname = `/${name}`;
    const url = base.toString();
    const db = createPool(url);
    await migrate(db);
    const sandboxes = new StandInSandboxes(db);
    return {
      url,
      db,
      sandboxes,
      drop: async () => {
        sandboxes.removeAll();
        await db.end();
        await pool.query(`drop database if exists "${name}" with (force)`);
      },
    };
  }
  type Fresh = Awaited<ReturnType<typeof freshDb>>;

  /** A journey and its jobs, wired as main.ts wires them; each removal is noted in `calls` once it has ended. */
  function make(f: Fresh, calls: string[], o: { cleanupHold?: Promise<void> | null; ownership?: () => Promise<string | null>; stepPauseMs?: number } = {}) {
    const box: { jobs?: JourneyJobs; hold: Promise<void> | null } = { hold: o.cleanupHold ?? null };
    const j = new Journey({
      pool: f.db,
      dataDir,
      ownership: o.ownership,
      cleanupProject: async (id, rec) => {
        if (box.hold) await box.hold;
        await box.jobs!.cleanup(id, rec);
        calls.push(`removed ${id}`);
      },
    });
    box.jobs = new JourneyJobs({ journey: j, sandboxes: f.sandboxes, measureFree: () => 50 * 1024 ** 3, stepPauseMs: o.stepPauseMs });
    return { j, jobs: box.jobs };
  }
  /** A project with its brief and plan confirmed. */
  async function ready(j: Journey, name: string): Promise<string> {
    const id = await j.createProject({ name, cap: "5", brief: "I need an app where staff can request leave and managers approve it" });
    await j.continueWithExample(id);
    await j.answerRestFromSheet(id);
    await j.confirmBrief(id);
    await j.confirmPlan(id);
    return id;
  }
  /** Step 1 built, not approved: a project with a sandbox and no job running. */
  async function idle(j: Journey, jobs: JourneyJobs, name: string): Promise<string> {
    const id = await ready(j, name);
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    expect((await j.state(id)).sandbox).not.toBeNull();
    return id;
  }
  /** Step 1 built and approved; step 2 running, its engine's container (the stand-in) held until it is killed. */
  async function midStep2(f: Fresh, j: Journey, jobs: JourneyJobs, name: string): Promise<string> {
    const id = await ready(j, name);
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    let engineStarted!: () => void;
    const started = new Promise<void>((r) => (engineStarted = r));
    f.sandboxes.engineHold = { started: () => engineStarted() };
    try {
      expect((await jobs.approve(id, "01-data")).next).toBe("build_step");
      await started;
    } finally {
      f.sandboxes.engineHold = null;
    }
    expect(j.runningJob()?.projectId).toBe(id);
    return id;
  }
  /** A job of its own that does not stop when told to (as an operation that cannot be stopped from here); `letGo` ends it. */
  async function stubbornJob(j: Journey, jobs: JourneyJobs, name: string) {
    const id = await ready(j, name);
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    await j.approveStep(id, "01-data");
    let letGo!: () => void;
    const { jobId } = await j.startJob(id, "build_step", () => new Promise((r) => (letGo = () => r({ note: "let go by the test" }))), { step: "02-submitter-screen" });
    return { id, jobId, letGo: () => letGo() };
  }
  /** What stopOnSignal is given: a lock that answers held unless told otherwise; every call noted in `calls`, every line in `log`. */
  function stopOpts(j: Journey, calls: string[], log: string[], o: { check?: () => Promise<string | null>; flag?: StopFlag; waitMs?: number; lockCheckMs?: number; deadlineMs?: number } = {}) {
    return {
      journey: j,
      lock: { check: o.check ?? (async () => null), release: async () => void calls.push("lock released") },
      flag: o.flag ?? new StopFlag(),
      closeServer: () => void calls.push("server closed"),
      endPool: async () => void calls.push("pool ended"),
      log: (line: string) => void log.push(line),
      exit: (code: number) => void calls.push(`exit ${code}`),
      ...(o.waitMs !== undefined ? { waitMs: o.waitMs } : {}),
      ...(o.lockCheckMs !== undefined ? { lockCheckMs: o.lockCheckMs } : {}),
      ...(o.deadlineMs !== undefined ? { deadlineMs: o.deadlineMs } : {}),
    };
  }
  const removedEvents = async (db: pg.Pool, id: string) => (await listEvents(db, id, EV.sandboxRemoved)).map((e) => e.payload);
  /**
   * Known gap 180, after its review: the note a project's pages carry when its last removal left something, as the page
   * writes it: what was left in English, isolated left to right, and "Close project" in the words of the button `close`.
   */
  const leftNote = (lang: "en" | "ar", left: string[], close: string) => {
    const [before, after] = t(lang, "removal.left", { close }).split("{left}");
    return `<p class="warn" data-removal-left>${esc(before!)}<span lang="en" dir="ltr">${esc(left.join("; "))}</span>${esc(after!)}</p>`;
  };

  it("C1: stopOnSignal (SIGTERM) with step 2 running: the engine's container is killed, the job recorded interrupted with the stop's reason, its reservation closed step_ended, the sandbox removed and recorded, and only then the lock released; exit 0", async () => {
    const f = await freshDb();
    try {
      const calls: string[] = [];
      const log: string[] = [];
      const { j, jobs } = make(f, calls);
      const id = await midStep2(f, j, jobs, "Restart: clean stop (made-up)");
      const job = j.runningJob()!;
      const dir = jobs.handle(id)!.dir;
      expect(existsSync(dir)).toBe(true);
      await stopOnSignal("SIGTERM", stopOpts(j, calls, log));
      expect(calls).toEqual(["server closed", `removed ${id}`, "lock released", "pool ended", "exit 0"]);
      expect(j.halted()).toBe("The interface was stopped on purpose (SIGTERM).");
      expect(f.sandboxes.killedRunners.filter((c) => c.startsWith(`builder_${id}-engine-02-submitter-screen-`))).toHaveLength(1);
      const s = await j.state(id);
      expect(s.stepJobs.get("02-submitter-screen")).toMatchObject({ jobId: job.jobId, state: "interrupted", reason: interruptedFor("SIGTERM") });
      expect(s.interrupted).toBe(true);
      expect(s.sandbox).toBeNull();
      const evs = await listEvents(f.db, id);
      const two = evs.filter((e) => e.step === "02-submitter-screen");
      expect(two.filter((e) => e.kind === "step.hold_closed").map((e) => e.payload.reason)).toEqual(["step_ended"]);
      expect(evs.filter((e) => (e.kind === EV.jobFinished || e.kind === EV.jobFailed) && e.payload.job_id === job.jobId)).toEqual([]);
      expect(evs.filter((e) => e.kind === EV.workspaceReset)).toEqual([]);
      expect(await removedEvents(f.db, id)).toEqual([{ reason: AT_STOP, interrupted: true, removed: true }]);
      // The removal is recorded after the job's end.
      const kinds = evs.map((e) => e.kind);
      expect(kinds.indexOf(EV.jobInterrupted)).toBeLessThan(kinds.indexOf(EV.sandboxRemoved));
      expect(f.sandboxes.destroyed).toEqual([id]);
      expect(existsSync(dir)).toBe(false);
      expect((await getBudget(f.db, id)).stepRoom).toBe(0);
      // The lines name the job stopped and the sandbox removed, and count the removals.
      expect(log.join("\n")).toContain(`Its running job (${job.jobId}, project ${id}) is being stopped first.`);
      expect(log.join("\n")).toContain(`The job ${job.jobId} has ended; its record says how. It is not resumed.`);
      expect(log.join("\n")).toContain(`Project ${id}: its sandbox (${dir}) was removed at the stop`);
      expect(log).toContain("Projects with a sandbox, marked interrupted and removed at the stop: 1.");
    } finally {
      await f.drop();
    }
  });

  it("C2: at a stop on SIGINT, an idle project with a sandbox is removed and marked interrupted; a closed project whose record still names a sandbox, and a project whose id does not start j1-, are untouched; exit 0", async () => {
    const f = await freshDb();
    try {
      const calls: string[] = [];
      const log: string[] = [];
      const { j, jobs } = make(f, calls);
      const idleId = await idle(j, jobs, "Idle with a sandbox (made-up)");
      // A closed project whose record still names a sandbox (as a record written by hand would).
      const closedId = await ready(j, "Closed, sandbox still named (made-up)");
      await appendEvent(f.db, closedId, EV.sandboxMade, { dir: "/made-up/builder-acceptance-closed" }, "01-data");
      await appendEvent(f.db, closedId, EV.closed, { at_stage: "build" });
      // A project not made by the journey, with a sandbox in its record.
      const other = uniqueId("p_not_journey");
      await createProject(f.db, { id: other, name: "Not a journey project (made-up)", capUsd: 5 });
      await appendEvent(f.db, other, EV.sandboxMade, { dir: "/made-up/builder-acceptance-other" }, "01-data");
      const before = { closed: (await listEvents(f.db, closedId)).length, other: (await listEvents(f.db, other)).length };
      await stopOnSignal("SIGINT", stopOpts(j, calls, log));
      expect(calls).toEqual(["server closed", `removed ${idleId}`, "lock released", "pool ended", "exit 0"]);
      expect(j.halted()).toBe("The interface was stopped on purpose (SIGINT).");
      expect(await removedEvents(f.db, idleId)).toEqual([{ reason: AT_STOP, interrupted: true, removed: true }]);
      const s = await j.state(idleId);
      expect(s.interrupted).toBe(true);
      expect(s.jobs.some((x) => x.state === "interrupted")).toBe(false);
      expect({ closed: (await listEvents(f.db, closedId)).length, other: (await listEvents(f.db, other)).length }).toEqual(before);
      expect(f.sandboxes.destroyedRecorded).toEqual([]);
      expect(log.join("\n")).toContain("No job was running.");
      expect(log).toContain("Projects with a sandbox, marked interrupted and removed at the stop: 1.");
    } finally {
      await f.drop();
    }
  });

  it("C12 (after J2's second review): at a stop the journey is halted before the live preview's stop is awaited; and a step of the project the stop marked interrupted is not approved afterwards, by a new interface on the same record: refused with the reason, nothing written", async () => {
    const f = await freshDb();
    try {
      const calls: string[] = [];
      const log: string[] = [];
      const { j, jobs } = make(f, calls);
      const idleId = await idle(j, jobs, "Idle, step 1 built and not approved (made-up)");
      let haltedWhenThePreviewStopped: string | null = "the preview's stop was not called";
      const preview = {
        stop: async () => {
          haltedWhenThePreviewStopped = j.halted();
          calls.push("preview stopped");
        },
      };
      await stopOnSignal("SIGTERM", { ...stopOpts(j, calls, log), preview });
      expect(haltedWhenThePreviewStopped).toBe("The interface was stopped on purpose (SIGTERM).");
      expect(calls).toEqual(["server closed", "preview stopped", `removed ${idleId}`, "lock released", "pool ended", "exit 0"]);
      // As after a restart: a new journey on the same record. Step 1 ran to its end and was never approved.
      const again = make(f, []);
      const s = await again.j.state(idleId);
      expect(s.interrupted).toBe(true);
      expect(s.stepJobs.get("01-data")?.state).toBe("finished");
      const before = (await listEvents(f.db, idleId)).length;
      await expect(again.j.approveStep(idleId, "01-data")).rejects.toThrow(APPROVE_INTERRUPTED);
      expect((await listEvents(f.db, idleId)).length).toBe(before);
      expect(await listEvents(f.db, idleId, EV.stepApproved)).toEqual([]);
    } finally {
      await f.drop();
    }
  });

  it("C3: the lock found lost before the removal (PostgreSQL ended its session): nothing is removed, a line says so, exit 1; a lock check that does not answer within its bound: the same", async () => {
    const f = await freshDb();
    try {
      // The interface's real instance lock on this database, its session then ended by PostgreSQL.
      const lock = await holdInstanceLock(f.url);
      const calls: string[] = [];
      const log: string[] = [];
      const { j, jobs } = make(f, calls, { ownership: () => lock.check() });
      const id = await idle(j, jobs, "Lock lost before the stop's removal (made-up)");
      const ended = await f.db.query<{ ended: boolean }>(
        `select pg_terminate_backend(l.pid, 5000) as ended from pg_locks l
          where l.locktype = 'advisory' and l.granted and l.objsubid = 1
            and l.database = (select oid from pg_database where datname = current_database())
            and ((l.classid::bigint << 32) | l.objid::bigint) = ('x' || substr(md5('builder-web-interface'), 1, 16))::bit(64)::bigint`,
      );
      expect(ended.rows).toEqual([{ ended: true }]);
      await stopOnSignal("SIGTERM", { ...stopOpts(j, calls, log), lock: { check: () => lock.check(), release: async () => (calls.push("lock released"), lock.release()) } });
      expect(calls).toEqual(["server closed", "lock released", "pool ended", "exit 1"]);
      expect(await removedEvents(f.db, id)).toEqual([]);
      expect(f.sandboxes.destroyed).toEqual([]);
      expect(log.join("\n")).toContain(`${LOCK_LOST} Nothing more is removed`);
      expect(log).toContain("Projects with a sandbox, marked interrupted and removed at the stop: 0.");

      // A lock check that does not answer: bounded, here at 0.3 s.
      const calls2: string[] = [];
      const log2: string[] = [];
      const second = make(f, calls2);
      const t0 = Date.now();
      await stopOnSignal("SIGTERM", stopOpts(second.j, calls2, log2, { check: () => new Promise<string | null>(() => undefined), lockCheckMs: 300 }));
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(calls2).toEqual(["server closed", "lock released", "pool ended", "exit 1"]);
      expect(await removedEvents(f.db, id)).toEqual([]);
      expect(log2.join("\n")).toContain("The instance lock was not confirmed by the database within 0.3 s. Nothing more is removed");
    } finally {
      await f.drop();
    }
  });

  it("C4: a job that has not ended within the wait: its project is not removed, the other project is, a line names it, exit 1", async () => {
    const f = await freshDb();
    let letGo: (() => void) | undefined;
    try {
      const calls: string[] = [];
      const log: string[] = [];
      const { j, jobs } = make(f, calls);
      const other = await idle(j, jobs, "Idle, removed at the stop (made-up)");
      const stubborn = await stubbornJob(j, jobs, "A job that does not end in time (made-up)");
      letGo = stubborn.letGo;
      const t0 = Date.now();
      await stopOnSignal("SIGTERM", stopOpts(j, calls, log, { waitMs: 500 }));
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(calls).toEqual(["server closed", `removed ${other}`, "lock released", "pool ended", "exit 1"]);
      expect(await removedEvents(f.db, stubborn.id)).toEqual([]);
      expect(f.sandboxes.destroyed).toEqual([other]);
      expect(log.join("\n")).toContain(`The job ${stubborn.jobId} had not ended after 0.5 s`);
      expect(log.join("\n")).toContain(`Project ${stubborn.id} is left for the next start: its job ${stubborn.jobId} had not ended`);
      expect(log).toContain("Projects with a sandbox, marked interrupted and removed at the stop: 1.");
    } finally {
      letGo?.();
      await sleep(50);
      await f.drop();
    }
  });

  it("C13 (after the review of pull request #49): the wait for a job that will not stop counts from the halt, the live preview's stop included: with a preview whose stop takes longer than the wait, nothing more is waited after it", async () => {
    const f = await freshDb();
    let letGo: (() => void) | undefined;
    try {
      const calls: string[] = [];
      const log: string[] = [];
      const { j, jobs } = make(f, calls);
      const stubborn = await stubbornJob(j, jobs, "A job that does not end, behind a slow preview (made-up)");
      letGo = stubborn.letGo;
      const preview = {
        stop: async () => {
          await sleep(2500);
          calls.push("preview stopped");
        },
      };
      const t0 = Date.now();
      await stopOnSignal("SIGTERM", { ...stopOpts(j, calls, log, { waitMs: 2000 }), preview });
      const took = Date.now() - t0;
      // The preview's stop takes 2.5 s, and the 2 s wait for the job runs out inside it. A wait that began only after
      // the preview had stopped would make the whole stop 4.5 s or more.
      expect(took).toBeGreaterThanOrEqual(2400);
      expect(took).toBeLessThan(3900);
      expect(calls).toEqual(["server closed", "preview stopped", "lock released", "pool ended", "exit 1"]);
      expect(log.join("\n")).toContain(`The job ${stubborn.jobId} had not ended after 2 s`);
      expect(log.join("\n")).toContain(`Project ${stubborn.id} is left for the next start: its job ${stubborn.jobId} had not ended`);
      expect(await removedEvents(f.db, stubborn.id)).toEqual([]);
    } finally {
      letGo?.();
      await sleep(50);
      await f.drop();
    }
  });

  it("C14 (known gap 180's fix): a removal that leaves something at the stop is recorded removed: false, naming what is left; the project stays recorded for the next start; a line names it; exit 1. The next start tries again: still left, recorded so again, and its lines name the project left and do not count it as removed; then nothing left, recorded removed", async () => {
    const f = await freshDb();
    try {
      const calls: string[] = [];
      const log: string[] = [];
      const { j, jobs } = make(f, calls);
      const id = await idle(j, jobs, "Idle, its removal leaves a network (made-up)");
      const dir = (await j.state(id)).sandbox!.dir;
      const left = [`network builder_${id}_front`];
      f.sandboxes.notRemoved = left;
      await stopOnSignal("SIGTERM", stopOpts(j, calls, log));
      expect(calls).toEqual(["server closed", "lock released", "pool ended", "exit 1"]);
      expect(await removedEvents(f.db, id)).toEqual([{ reason: NOT_REMOVED_AT_STOP, interrupted: true, removed: false, left }]);
      const why = `its sandbox (${dir}) could not be removed (left: network builder_${id}_front); the next start tries again`;
      expect(log).toContain(`[interface stopping] Project ${id} is left for the next start: ${why}.`);
      expect(log).toContain("Projects with a sandbox, marked interrupted and removed at the stop: 0.");
      expect(log.join("\n")).not.toContain("was removed at the stop");
      expect(existsSync(dir)).toBe(true);
      // The next start, as a new interface on the same record: the sandbox is still named, so it tries again.
      const second = make(f, []);
      let s = await second.j.state(id);
      expect(s.sandbox?.dir).toBe(dir);
      expect(s.interrupted).toBe(true);
      // After the fix's review: what the start did, and its lines as main.ts prints them (startRecoveryLines). The
      // project left is named in the stop's own words, and the count line does not count it as removed.
      const again = await second.j.recoverAtStart();
      expect(again).toEqual({ touched: [id], removed: [], left: [{ projectId: id, why }] });
      expect(startRecoveryLines(again)).toEqual([
        `[interface starting] Project ${id} is left for the next start: ${why}.`,
        "Projects with a job or a sandbox left by an interface that stopped, marked interrupted and removed at start: 0.",
      ]);
      expect(await removedEvents(f.db, id)).toEqual([
        { reason: NOT_REMOVED_AT_STOP, interrupted: true, removed: false, left },
        { reason: NOT_REMOVED_AT_START, interrupted: true, removed: false, left },
      ]);
      expect((await second.j.state(id)).sandbox?.dir).toBe(dir);
      // The screen says so, in both languages: what the last try recorded as left, in English and left to right, with
      // "Close project" in the words of the button beside it. It does not leave "removed" to be understood.
      const app = createWebApp({ journey: second.j, jobs: second.jobs, password: new PasswordState("env", digestPassword(PASSWORD), null), sessions: new Sessions(), limiter: new SignInLimiter(), dataDir });
      const cookie = await signIn(app);
      for (const lang of ["en", "ar"] as const) {
        const html = await (await get(app, `/projects/${id}/build?lang=${lang}`, cookie)).text();
        expect(html, lang).toContain(leftNote(lang, left, t(lang, "interrupted.close")));
        expect(html, lang).toContain(`<button type="submit">${esc(t(lang, "interrupted.close"))}</button>`);
        expect(html.match(/data-removal-left/g), lang).toHaveLength(1);
      }
      expect(t("en", "removal.left", { left: "X", close: "Close project" })).toBe('The last try to remove this project did not finish. What it recorded as left: X. Pressing "Close project" tries again, and so does the interface at its next start; a new try may end the same way.');
      expect(t("ar", "removal.left")).toContain("«{close}»");
      expect(t("ar", "removal.left")).toContain("{left}");
      // Then nothing is left: recorded removed, counted as removed, and the sandbox no longer named.
      f.sandboxes.notRemoved = null;
      const third = make(f, []);
      const last = await third.j.recoverAtStart();
      expect(last).toEqual({ touched: [id], removed: [{ projectId: id, dir }], left: [] });
      expect(startRecoveryLines(last)).toEqual(["Projects with a job or a sandbox left by an interface that stopped, marked interrupted and removed at start: 1."]);
      expect((await removedEvents(f.db, id)).at(-1)).toEqual({ reason: FOUND_AT_START, interrupted: true, removed: true });
      s = await third.j.state(id);
      expect(s.sandbox).toBeNull();
      expect(s.removalLeft).toBeNull();
      expect(await (await get(app, `/projects/${id}/build?lang=en`, cookie)).text()).not.toContain("data-removal-left");
      expect(f.sandboxes.destroyedRecorded.map((x) => x.projectId)).toEqual([id]);
    } finally {
      f.sandboxes.notRemoved = null;
      await f.drop();
    }
  });

  it("C15 (known gap 180's fix): Close project when the removal leaves something: refused, saying what happened and what is left, recorded removed: false, the project not closed; pressed again with nothing left, it closes", async () => {
    const f = await freshDb();
    try {
      const { j, jobs } = make(f, []);
      const id = await idle(j, jobs, "Idle, closed while a container will not go (made-up)");
      const left = [`container builder_${id}-app-1`];
      f.sandboxes.notRemoved = left;
      const refused = await j.closeProject(id).then(() => null, (e: unknown) => e);
      expect(refused).toBeInstanceOf(JourneyRefused);
      expect((refused as Error).message).toBe(closeNotRemovedRefusal(left));
      // After the fix's review: the refusal says what happened. It no longer says that nothing else was changed, and it
      // does not advise restarting the interface. Second review round: it no longer says "its app is stopped" either,
      // which nothing checks (here the thing left is the app's own container): it says what Docker's lists held after
      // the removal, and that a container named as left may still be running.
      expect(closeNotRemovedRefusal(left)).toBe(
        `The project was not closed: its removal did not finish. After the removal, Docker's lists were read: they hold nothing more of this project than what is named as left. A container named there may still be running. Left: container builder_${id}-app-1. Nothing of this project is built, previewed, checked or opened any more. Pressing "Close project" again tries the removal again.`,
      );
      expect(closeNotRemovedRefusal(left)).not.toMatch(/app is stopped/);
      expect(closeNotRemovedRefusal(["Docker could not be asked (made-up words)"])).toBe(
        'The project was not closed: its removal did not finish. Docker could not be asked, so it is not known what of the project went, or whether its app is stopped. Left: Docker could not be asked (made-up words). Nothing of this project is built, previewed, checked or opened any more. Pressing "Close project" again tries the removal again.',
      );
      let s = await j.state(id);
      expect(s.stage).not.toBe("closed");
      expect(s.sandbox).not.toBeNull();
      expect(await removedEvents(f.db, id)).toEqual([{ reason: CLOSE_NOT_REMOVED, interrupted: false, removed: false, left }]);
      expect(await listEvents(f.db, id, EV.closed)).toEqual([]);
      expect(s.removalLeft).toEqual(left);
      // Through the screen: the project's page carries the note beside "Close project"; a POST to close gets the plain refusal.
      const app = createWebApp({ journey: j, jobs, password: new PasswordState("env", digestPassword(PASSWORD), null), sessions: new Sessions(), limiter: new SignInLimiter(), dataDir });
      const cookie = await signIn(app);
      for (const lang of ["en", "ar"] as const) {
        const page = await (await get(app, `/projects/${id}/build?lang=${lang}`, cookie)).text();
        expect(page, lang).toContain(leftNote(lang, left, t(lang, "close.button")));
        expect(page, lang).toContain(`<button type="submit" data-close-again>${esc(t(lang, "close.button"))}</button>`);
        expect(page.match(/data-removal-left/g), lang).toHaveLength(1);
      }
      const posted = await post(app, `/projects/${id}/close`, {}, { cookie });
      expect(posted.status).toBe(409);
      expect(await posted.text()).toContain(esc(closeNotRemovedRefusal(left)));
      expect(await listEvents(f.db, id, EV.closed)).toEqual([]);
      f.sandboxes.notRemoved = null;
      await j.closeProject(id);
      s = await j.state(id);
      expect(s.stage).toBe("closed");
      expect((await removedEvents(f.db, id)).at(-1)).toEqual({ reason: "The project was closed.", interrupted: false });
      expect(await listEvents(f.db, id, EV.closed)).toHaveLength(1);
    } finally {
      f.sandboxes.notRemoved = null;
      await f.drop();
    }
  });

  it("C18 (known gap 180, after its review): a stop with two projects, one whose removal leaves something and one that is removed: each is recorded and named for what happened to it, the count line counts the one removed, exit 1", async () => {
    const f = await freshDb();
    try {
      const calls: string[] = [];
      const log: string[] = [];
      const { j, jobs } = make(f, calls);
      // The project whose removal leaves something is the older one, so the stop's loop meets it first.
      const stuck = await idle(j, jobs, "Its removal leaves a volume (made-up)");
      const clean = await idle(j, jobs, "Removed at the stop (made-up)");
      const dirs = { stuck: (await j.state(stuck)).sandbox!.dir, clean: (await j.state(clean)).sandbox!.dir };
      const left = [`volume builder_${stuck}_pgdata`];
      f.sandboxes.notRemoved = { [stuck]: left };
      await stopOnSignal("SIGTERM", stopOpts(j, calls, log));
      expect(calls).toEqual(["server closed", `removed ${clean}`, "lock released", "pool ended", "exit 1"]);
      // The record of each.
      expect(await removedEvents(f.db, stuck)).toEqual([{ reason: NOT_REMOVED_AT_STOP, interrupted: true, removed: false, left }]);
      expect(await removedEvents(f.db, clean)).toEqual([{ reason: AT_STOP, interrupted: true, removed: true }]);
      const after = { stuck: await j.state(stuck), clean: await j.state(clean) };
      expect(after.stuck.sandbox?.dir).toBe(dirs.stuck);
      expect(after.stuck.removalLeft).toEqual(left);
      expect(after.clean.sandbox).toBeNull();
      expect(after.clean.removalLeft).toBeNull();
      // The lines of each, the count and the exit code.
      expect(log).toContain(`[interface stopping] Project ${clean}: its sandbox (${dirs.clean}) was removed at the stop: its containers, images and folder. It is marked interrupted, not resumed.`);
      expect(log).toContain(`[interface stopping] Project ${stuck} is left for the next start: its sandbox (${dirs.stuck}) could not be removed (left: volume builder_${stuck}_pgdata); the next start tries again.`);
      expect(log.join("\n")).not.toContain(`Project ${stuck}: its sandbox`);
      expect(log.join("\n")).not.toContain(`Project ${clean} is left`);
      expect(log).toContain("Projects with a sandbox, marked interrupted and removed at the stop: 1.");
      expect(log.at(-1)).toBe("[interface stopped] Lock released. Exit code 1: a project is left for the next start.");
      expect(f.sandboxes.destroyed).toEqual([clean]);
      expect(existsSync(dirs.stuck)).toBe(true);
      expect(existsSync(dirs.clean)).toBe(false);
    } finally {
      f.sandboxes.notRemoved = null;
      await f.drop();
    }
  });

  it("C19 (known gap 180, after its review): a refused Close project on a project with a step still to build: its build screen offers no build, only Close project and New project, and a build asked anyway is refused; the next start treats it as any open project left by an interface that stopped: it tries the removal again and marks it interrupted", async () => {
    const f = await freshDb();
    try {
      const { j, jobs } = make(f, []);
      // Step 1 built and approved, step 2 not built: the build screen would offer "Build step 2".
      const id = await idle(j, jobs, "Close refused, then a restart (made-up)");
      await j.approveStep(id, "01-data");
      const dir = (await j.state(id)).sandbox!.dir;
      const app = createWebApp({ journey: j, jobs, password: new PasswordState("env", digestPassword(PASSWORD), null), sessions: new Sessions(), limiter: new SignInLimiter(), dataDir });
      const cookie = await signIn(app);
      expect(await (await get(app, `/projects/${id}/build`, cookie)).text()).toContain('data-build="02-submitter-screen"');
      const left = [`network builder_${id}_front`];
      f.sandboxes.notRemoved = { [id]: left };
      await expect(j.closeProject(id)).rejects.toThrow(closeNotRemovedRefusal(left));
      let s = await j.state(id);
      expect(removalNotFinished(s)).toBe(true);
      expect(s.interrupted).toBe(false);
      for (const lang of ["en", "ar"] as const) {
        const page = await (await get(app, `/projects/${id}/build?lang=${lang}`, cookie)).text();
        expect(page, lang).toContain(`<p class="warn" data-removal-not-finished>${esc(t(lang, "removal.not_finished"))}</p>`);
        expect(page, lang).not.toMatch(/data-(build|approve)=/);
        expect([...page.matchAll(/<form method="post" action="([^"]+)"/g)].map((m) => m[1]), lang).toEqual(["/language", "/sign-out", `/projects/${id}/close`]);
        expect(page, lang).toContain(`<a href="/projects/new">${esc(t(lang, "projects.new"))}</a>`);
      }
      const asked = await post(app, `/projects/${id}/build`, { step: "02-submitter-screen" }, { cookie });
      expect(asked.status).toBe(409);
      expect(await asked.text()).toContain(esc(REMOVAL_NOT_FINISHED));
      expect(f.sandboxes.runnerCalls.filter((c) => c.step === "02-submitter-screen")).toEqual([]);
      // The next start, as a new interface on the same record (it holds no handle): still left.
      const second = make(f, []);
      expect((await second.j.recoverAtStart()).left.map((x) => x.projectId)).toEqual([id]);
      expect(await removedEvents(f.db, id)).toEqual([
        { reason: CLOSE_NOT_REMOVED, interrupted: false, removed: false, left },
        { reason: NOT_REMOVED_AT_START, interrupted: true, removed: false, left },
      ]);
      s = await second.j.state(id);
      expect(s.interrupted).toBe(true);
      expect(removalNotFinished(s)).toBe(true);
      // Then nothing is left: the start after it removes the sandbox, through the record.
      f.sandboxes.notRemoved = null;
      const third = make(f, []);
      expect(await third.j.recoverAtStart()).toEqual({ touched: [id], removed: [{ projectId: id, dir }], left: [] });
      expect((await removedEvents(f.db, id)).at(-1)).toEqual({ reason: FOUND_AT_START, interrupted: true, removed: true });
      s = await third.j.state(id);
      expect(s.sandbox).toBeNull();
      expect(removalNotFinished(s)).toBe(false);
      expect(s.interrupted).toBe(true);
      expect(f.sandboxes.destroyedRecorded.map((x) => x.projectId)).toEqual([id]);
    } finally {
      f.sandboxes.notRemoved = null;
      await f.drop();
    }
  });

  it("C4b: a second stop signal during the stop exits at once with code 1, saying so", async () => {
    const f = await freshDb();
    let letGo: (() => void) | undefined;
    try {
      const calls: string[] = [];
      const log: string[] = [];
      const { j, jobs } = make(f, calls);
      const stubborn = await stubbornJob(j, jobs, "The stop waits on this job (made-up)");
      letGo = stubborn.letGo;
      const onSignal = stopSignalHandler(stopOpts(j, calls, log, { waitMs: 10_000 }));
      const first = onSignal("SIGTERM");
      await until(() => calls.includes("server closed"), 2000);
      expect(calls).toEqual(["server closed"]);
      onSignal("SIGINT");
      // At once: nothing awaited between the second signal and the exit.
      expect(calls).toEqual(["server closed", "exit 1"]);
      expect(log.at(-1)).toBe("[interface stopped] A second stop signal (SIGINT) came during the stop; the interface exits now with code 1. What is left is removed at the next start.");
      letGo();
      await first;
      // The process has exited: no second exit.
      expect(calls.filter((c) => c.startsWith("exit"))).toEqual(["exit 1"]);
    } finally {
      letGo?.();
      await sleep(50);
      await f.drop();
    }
  });

  it("C9: from the stop signal on, every request gets a plain 503, \"The interface is stopping.\", through main.ts's own hook (as a lost lock does); nothing is made", async () => {
    const f = await freshDb();
    let letGo: (() => void) | undefined;
    try {
      const calls: string[] = [];
      const log: string[] = [];
      const { j, jobs } = make(f, calls);
      const flag = new StopFlag();
      const app = createWebApp({ journey: j, jobs, password: new PasswordState("env", digestPassword(PASSWORD), null), sessions: new Sessions(), limiter: new SignInLimiter(), dataDir, unavailable: unavailableReason({ lost: () => null }, flag) });
      const cookie = await signIn(app);
      expect((await get(app, "/projects", cookie)).status).toBe(200);
      const stubborn = await stubbornJob(j, jobs, "The stop waits on this job (made-up)");
      letGo = stubborn.letGo;
      const projectsBefore = Number((await f.db.query<{ n: string }>("select count(*)::text as n from projects")).rows[0]!.n);
      const stopping = stopOnSignal("SIGTERM", stopOpts(j, calls, log, { flag, waitMs: 10_000 }));
      await until(() => calls.includes("server closed"), 2000);
      const r = await get(app, "/projects", cookie);
      expect(r.status).toBe(503);
      expect(r.headers.get("content-type")).toMatch(/^text\/plain/);
      expect(await r.text()).toBe("The interface is stopping.");
      expect((await get(app, "/sign-in")).status).toBe(503);
      expect((await get(app, "/static/app.css")).status).toBe(503);
      const made = await post(app, "/projects", { name: "During the stop (made-up)", cap: "5", brief: "Made-up brief." }, { cookie });
      expect(made.status).toBe(503);
      expect(await made.text()).toBe("The interface is stopping.");
      expect(Number((await f.db.query<{ n: string }>("select count(*)::text as n from projects")).rows[0]!.n)).toBe(projectsBefore);
      // The flag alone gives the 503 (no lock lost); a lost lock's reason comes first.
      expect(unavailableReason({ lost: () => null }, new StopFlag())()).toBeNull();
      expect(unavailableReason({ lost: () => LOCK_LOST }, flag)()).toBe(LOCK_LOST);
      letGo();
      await stopping;
    } finally {
      letGo?.();
      await sleep(50);
      await f.drop();
    }
  });

  it("C11: the stop's last bound: a removal that has not ended when it comes exits 1 at once, saying so; nothing more is removed", async () => {
    const f = await freshDb();
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    try {
      const calls: string[] = [];
      const log: string[] = [];
      const setup = make(f, calls);
      const a = await idle(setup.j, setup.jobs, "Its removal hangs (made-up)");
      const b = await idle(setup.j, setup.jobs, "Would be removed next (made-up)");
      // A second interface on the same database, whose removal does not end (as a docker program that hangs).
      const { j } = make(f, calls, { cleanupHold: hold });
      const t0 = Date.now();
      const stopping = stopOnSignal("SIGTERM", stopOpts(j, calls, log, { deadlineMs: 800 }));
      expect(await until(() => calls.includes("exit 1"), 5000)).toBe(true);
      expect(Date.now() - t0).toBeLessThan(4000);
      expect(calls).toEqual(["server closed", "exit 1"]);
      expect(log.at(-1)).toBe("[interface stopped] The stop had not finished 0.8 s after SIGTERM; the interface exits now with code 1. What is left is removed at the next start.");
      release();
      await stopping;
      // The removal under way ends, and nothing more is removed after the exit; no second exit.
      expect(calls.filter((c) => c.startsWith("removed"))).toEqual([`removed ${a}`]);
      expect(await removedEvents(f.db, b)).toEqual([]);
      expect(calls.filter((c) => c.startsWith("exit"))).toEqual(["exit 1"]);
    } finally {
      release();
      await sleep(50);
      await f.drop();
    }
  });

  it("C7: the interrupted panel's two wordings (a job interrupted; no job, only the app set up), and the cost screen's note on a reservation of a step stopped part-way, at a clean stop and at a start after a crash; in English and Arabic", async () => {
    const f = await freshDb();
    try {
      const calls: string[] = [];
      const { j, jobs } = make(f, calls);
      // One job at a time: the idle project first, then step 2 of the other held running.
      const quiet = await idle(j, jobs, "Idle at the stop (made-up)");
      const mid = await midStep2(f, j, jobs, "Restart: clean stop (made-up)");
      await stopOnSignal("SIGTERM", stopOpts(j, calls, []));
      // As a crash leaves it, then the next start: a step's job left started, its reservation open.
      const after = make(f, []);
      const crashed = await ready(after.j, "Restart: crash (made-up)");
      await appendEvent(f.db, crashed, EV.jobStarted, { job_id: "job-0000c7c7", kind: "build_step", step: "01-data" }, "01-data");
      const opened = await openStepHold(f.db, { projectId: crashed, stepId: "01-data", model: PRICED_MODEL, maxTurns: 4, profile: DEFAULT_PROFILES.standard!, deadline: new Date(Date.now() + 3_600_000) });
      expect(opened.ok).toBe(true);
      expect(await after.j.recoverInterrupted()).toEqual([crashed]);
      const app = createWebApp({ journey: after.j, jobs: after.jobs, password: new PasswordState("env", digestPassword(PASSWORD), null), sessions: new Sessions(), limiter: new SignInLimiter(), dataDir });
      const cookie = await signIn(app);
      const page = async (path: string) => {
        const r = await get(app, path, cookie);
        expect(r.status, path).toBe(200);
        return r.text();
      };
      const rows = (html: string) => [...html.matchAll(/<tr><td><bdi dir="ltr">([^<]+)<\/bdi><\/td><td>(\$[0-9.]+)<\/td><td>([\s\S]*?)<\/td><\/tr>/g)].map((m) => [m[1], m[2], m[3]]);
      for (const lang of ["en", "ar"] as const) {
        const note = `<br><span class="note" data-stopped-part-way>${esc(t(lang, "cost.stopped_part_way"))}</span>`;
        // A job of the project was interrupted: the first wording.
        for (const id of [mid, crashed]) {
          const html = await page(`/projects/${id}/build?lang=${lang}`);
          expect(html, `${id} ${lang}`).toContain(esc(t(lang, "interrupted.message")));
          expect(html, `${id} ${lang}`).not.toContain(esc(t(lang, "interrupted.no_job")));
        }
        // Only the app was set up (no job ran when the interface stopped): the second.
        const q = await page(`/projects/${quiet}/build?lang=${lang}`);
        expect(q, lang).toContain(esc(t(lang, "interrupted.no_job")));
        expect(q, lang).not.toContain(esc(t(lang, "interrupted.message")));
        // The cost screen: the note only on the reservation of the step stopped part-way.
        const midCost = await page(`/projects/${mid}/cost?lang=${lang}`);
        expect(rows(midCost), lang).toEqual([
          ["01-data", "$1.5552", "closed (step_ended)"],
          ["02-submitter-screen", "$3.1104", `closed (step_ended)${note}`],
        ]);
        expect(midCost).toContain("<td data-step-room>$0.0000</td>");
        expect(midCost).toContain("<td data-spent>$0.00</td>");
        expect(rows(await page(`/projects/${crashed}/cost?lang=${lang}`)), lang).toEqual([["01-data", "$1.5552", `closed (job_interrupted)${note}`]]);
        expect(rows(await page(`/projects/${quiet}/cost?lang=${lang}`)), lang).toEqual([["01-data", "$1.5552", "closed (step_ended)"]]);
      }
      expect(t("en", "interrupted.no_job")).toBe(NO_JOB);
      expect(t("en", "interrupted.message")).toBe(WITH_JOB);
      expect(t("en", "cost.stopped_part_way")).toBe(STOPPED_PART_WAY);
      // The build screen's line for step 2, and no build, approve or retry button.
      const build = await page(`/projects/${mid}/build`);
      expect(build).toContain(esc(t("en", "build.line.job_interrupted")));
      expect(build).not.toMatch(/data-(build|approve)=/);
    } finally {
      await f.drop();
    }
  });

  it("C6: the demonstration pause: BUILDER_DEMO_STEP_PAUSE_MS from 0 to 10000 (unset or 0: off); anything else refuses the start; while on, the build screen says so, in English and Arabic", async () => {
    const dir = mkdtempSync(join(tmpdir(), "builder-web-pause-"));
    try {
      const full = { BUILDER_DATABASE_URL: TEST_DB_URL, BUILDER_DATA_DIR: dir, BUILDER_UI_PASSWORD: PASSWORD };
      expect(readSettings({ ...full }).stepPauseMs).toBe(0);
      expect(readSettings({ ...full, BUILDER_DEMO_STEP_PAUSE_MS: "" }).stepPauseMs).toBe(0);
      expect(readSettings({ ...full, BUILDER_DEMO_STEP_PAUSE_MS: "0" }).stepPauseMs).toBe(0);
      expect(readSettings({ ...full, BUILDER_DEMO_STEP_PAUSE_MS: "4000" }).stepPauseMs).toBe(4000);
      expect(readSettings({ ...full, BUILDER_DEMO_STEP_PAUSE_MS: "10000" }).stepPauseMs).toBe(10_000);
      for (const bad of ["10001", "-1", "1.5", "4e3", " 4000", "abc", "00", "99999999"]) {
        expect(() => readSettings({ ...full, BUILDER_DEMO_STEP_PAUSE_MS: bad }), bad).toThrow("BUILDER_DEMO_STEP_PAUSE_MS must be a whole number of milliseconds from 0 to 10000 (0 or unset: off). The interface does not start.");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const f = await freshDb();
    try {
      for (const pause of [4000, 0]) {
        const { j, jobs } = make(f, [], { stepPauseMs: pause });
        const app = createWebApp({ journey: j, jobs, password: new PasswordState("env", digestPassword(PASSWORD), null), sessions: new Sessions(), limiter: new SignInLimiter(), dataDir });
        const cookie = await signIn(app);
        const id = await ready(j, `Pause ${pause} (made-up)`);
        for (const lang of ["en", "ar"] as const) {
          const html = await (await get(app, `/projects/${id}/build?lang=${lang}`, cookie)).text();
          const line = `<p class="warn" data-step-pause="${pause}">${esc(t(lang, "build.step_pause", { ms: pause.toLocaleString("en") }))}</p>`;
          if (pause) expect(html, lang).toContain(line);
          else expect(html, lang).not.toContain("data-step-pause");
        }
        await j.closeProject(id);
      }
      expect(t("en", "build.step_pause", { ms: "4,000" })).toBe("Demonstration setting: the scripted engine pauses 4,000 ms before each write, so that a stop part-way can be shown.");
    } finally {
      await f.drop();
    }
  });

  it("C5: the real interface (src/web/main.ts, on a database and a port of its own): SIGTERM to its node process, and SIGINT to the tsx wrapper npm run web uses, each with no project: exit 0 and \"removed at the stop: 0\"; the pause line at start only when the setting is on", { timeout: 120_000 }, async () => {
    const f = await freshDb();
    const dir = mkdtempSync(join(tmpdir(), "builder-web-stop-"));
    const procs: ChildProcess[] = [];
    const freePort = () =>
      new Promise<number>((resolve, reject) => {
        const srv = net.createServer();
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => {
          const port = (srv.address() as net.AddressInfo).port;
          srv.close(() => resolve(port));
        });
      });
    const start = async (how: "node" | "tsx", extra: Record<string, string>) => {
      const port = await freePort();
      const previewPort = await freePort();
      for (const p of [port, previewPort]) expect([4020, 4022, 4030, 4031, 4032, 4033, 4034]).not.toContain(p);
      const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/root", PGUSER: process.env.PGUSER ?? "", BUILDER_DATABASE_URL: f.url, BUILDER_DATA_DIR: dir, BUILDER_UI_PASSWORD: PASSWORD, BUILDER_UI_PORT: String(port), BUILDER_PREVIEW_PORT: String(previewPort), ...extra };
      const child =
        how === "node"
          ? spawn(process.execPath, ["--import", "tsx", "src/web/main.ts"], { cwd: builderDir, env, stdio: ["ignore", "pipe", "pipe"] })
          : spawn(join(builderDir, "node_modules", ".bin", "tsx"), ["src/web/main.ts"], { cwd: builderDir, env, stdio: ["ignore", "pipe", "pipe"] });
      procs.push(child);
      const out = { stdout: "", stderr: "" };
      child.stdout!.on("data", (d: Buffer) => (out.stdout += d.toString("utf8")));
      child.stderr!.on("data", (d: Buffer) => (out.stderr += d.toString("utf8")));
      const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));
      expect(await until(() => out.stdout.includes("Interface listening on"), 30_000), `${out.stdout}\n${out.stderr}`).toBe(true);
      return { out, exited, child };
    };
    try {
      const a = await start("node", { BUILDER_DEMO_STEP_PAUSE_MS: "4000" });
      expect(a.out.stdout).toContain("Demonstration setting: the scripted engine pauses 4000 ms before each write (BUILDER_DEMO_STEP_PAUSE_MS), so that a stop part-way can be shown.");
      expect(a.child.kill("SIGTERM")).toBe(true);
      expect(await Promise.race([a.exited, sleep(30_000).then(() => "still running")]), `${a.out.stdout}\n${a.out.stderr}`).toBe(0);
      expect(a.out.stdout).toContain("[interface stopping] The interface was stopped on purpose (SIGTERM). No job was running.");
      expect(a.out.stdout).toContain("Projects with a sandbox, marked interrupted and removed at the stop: 0.");

      const b = await start("tsx", {});
      expect(b.out.stdout).not.toContain("Demonstration setting");
      expect(b.child.kill("SIGINT")).toBe(true);
      expect(await Promise.race([b.exited, sleep(30_000).then(() => "still running")]), `${b.out.stdout}\n${b.out.stderr}`).toBe(0);
      expect(b.out.stdout).toContain("[interface stopping] The interface was stopped on purpose (SIGINT). No job was running.");
      expect(b.out.stdout).toContain("Projects with a sandbox, marked interrupted and removed at the stop: 0.");
    } finally {
      for (const p of procs) if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
      rmSync(dir, { recursive: true, force: true });
      await f.drop();
    }
  });
});

/*
 * After the independent review of 14787d8, known gap 161 (the owner's choice: refuse the live app once a project is
 * signed off). "Open the live app" is refused after sign-off; a live session open when sign-off is asked is ended
 * first, its close recorded before the sign-off; an open asked for while the sign-off runs is refused, and a sign-off
 * is refused while an open is in flight. Marker for these tests: "after the review of 14787d8".
 */
describe("Sign-off and the live app (stand-in sandbox, the real front; after the review of 14787d8, known gap 161)", () => {
  let sandboxes: StandInSandboxes;
  let upstream: http.Server;
  let preview: LivePreview | null = null;
  beforeAll(async () => {
    sandboxes = new StandInSandboxes(pool);
    // A stand-in app on this machine's loopback address, which the stand-in streams reach.
    upstream = http.createServer((_q, s) => s.writeHead(200, { "content-type": "text/html" }).end("made-up app page"));
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    sandboxes.upstreamPort = (upstream.address() as net.AddressInfo).port;
  });
  afterAll(async () => {
    sandboxes.streamNetworkHold = null;
    await preview?.stop().catch(() => undefined);
    sandboxes.removeAll();
    await new Promise((r) => upstream.close(r));
  });

  /** The words of the refusal of "Open the live app" once a project is signed off. */
  const SIGNED_OFF_WORDS = "is signed off. The live app is not opened after sign-off";
  const sleep = (ms: number) => new Promise<"waiting">((r) => setTimeout(() => r("waiting"), ms));
  const passOn = (html: string) => /data-pass[^>]*><code[^>]*>([0-9A-Z]{4}-[0-9A-Z]{4})</.exec(html)?.[1];
  const enter = (port: number, shown: string) =>
    fetch(`http://127.0.0.1:${port}/__builder/enter`, { method: "POST", headers: { origin: `http://127.0.0.1:${port}`, "content-type": "application/x-www-form-urlencoded" }, body: `pass=${shown}`, redirect: "manual" });
  /** The project's live closes and its sign-off, in record order: "closed:<reason>:<session>" or "signed_off". */
  const closesAndSignOff = async (id: string) =>
    (await listEvents(pool, id)).filter((e) => e.kind === EV.liveClosed || e.kind === EV.signedOff).map((e) => (e.kind === EV.signedOff ? "signed_off" : `closed:${String(e.payload.reason)}:${String(e.payload.session)}`));

  /** A pool whose write of one event kind waits until `release` is called; `asked` resolves once that write is held. */
  const heldWritePool = (kind: string) => {
    let started!: () => void;
    let release!: () => void;
    const asked = new Promise<void>((r) => (started = r));
    const released = new Promise<void>((r) => (release = r));
    const held = new Proxy(pool, {
      get(target, prop) {
        if (prop === "query")
          return async (...args: unknown[]) => {
            if (Array.isArray(args[1]) && args[1][1] === kind) {
              started();
              await released;
            }
            return (target.query as (...a: unknown[]) => unknown)(...args);
          };
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    return { pool: held, asked, release };
  };

  /**
   * An interface with the real front and a project whose checklist passed, not signed off yet, with its sign-in cookie.
   * The record of the next close of a live session can be held (`holdNextClose`); `journeyPool` is the journey's pool.
   */
  const checkedInterface = async (name: string, o: { journeyPool?: pg.Pool } = {}) => {
    const box: { jobs?: JourneyJobs } = {};
    const j = new Journey({ pool: o.journeyPool ?? pool, dataDir, cleanupProject: (id, rec) => box.jobs!.cleanup(id, rec) });
    const jobs = new JourneyJobs({ journey: j, sandboxes, measureFree: () => 50 * 1024 ** 3 });
    box.jobs = jobs;
    sandboxes.streamNetworkHold = null;
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const port = (s.address() as net.AddressInfo).port;
    await new Promise((r) => s.close(r));
    await preview?.stop().catch(() => undefined);
    const gate: { hold: { started: () => void; release: Promise<void> } | null } = { hold: null };
    const live = new LivePreview({
      port,
      texts: frontTexts(),
      base: "/tmp",
      openStream: (id) => jobs.openStream(id),
      onEvent: async (id, kind, payload) => {
        const hold = kind === EV.liveClosed ? gate.hold : null;
        if (hold) {
          gate.hold = null;
          hold.started();
          await hold.release;
        }
        await appendEvent(pool, id, kind, payload);
      },
    });
    preview = live;
    await live.start();
    jobs.attachPreview(live);
    const app = createWebApp({ journey: j, jobs, password: new PasswordState("env", digestPassword(PASSWORD), null), sessions: new Sessions(), limiter: new SignInLimiter(), dataDir, preview: live });
    const cookie = await signIn(app);
    const made = await post(app, "/projects", { name, cap: "5.00", brief: "I need an app where staff can request leave and managers approve it" }, { cookie });
    const id = /\/projects\/(j1-[0-9a-f]{12})\//.exec(made.headers.get("location") ?? "")![1]!;
    for (const a of ["continue", "answer-rest", "confirm-brief", "confirm-plan"]) expect((await post(app, `/projects/${id}/${a}`, {}, { cookie })).status).toBe(303);
    for (const [a, step] of [["build", "01-data"], ["approve", "01-data"], ["approve", "02-submitter-screen"], ["acceptance", ""]] as const) {
      expect((await post(app, `/projects/${id}/${a}`, { step }, { cookie })).status).toBe(303);
      await j.waitForJob();
    }
    const st = await j.state(id);
    expect(st.acceptanceRun?.outcome).toBe("passed");
    expect(st.signedOff).toBe(false);
    /** The next close of a live session is held at its record: `asked` resolves once it is held, `release` lets it go on. */
    const holdNextClose = () => {
      let started!: () => void;
      let release!: () => void;
      const asked = new Promise<void>((r) => (started = r));
      gate.hold = { started, release: new Promise<void>((r) => (release = r)) };
      return { asked, release };
    };
    return { j, jobs, app, cookie, id, port, live, holdNextClose };
  };

  it("C17 (known gap 180, after its review): after a refused Close project on a project whose preview finished and whose checklist passed, the project is \"removal not finished\": its live session is ended and its app stopped; every build, preview, checklist run, approval, sign-off, export and live opening is refused with the one sentence naming that state, through the journey and through the routes, and nothing is written; its pages offer only Close project and New project, with the note of what is left, and its preview screen does not say that the app is not running any more; the same through a second journey on the same record that holds no handle (not a real start, which would first mark the project interrupted: C19); Close project again, with nothing left, closes it, and the preview screen says that sentence again", async () => {
    const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const x = await checkedInterface("Leave requests (made-up, close refused)");
    const { j, jobs, app, cookie, id } = x;
    const left = [`network builder_${id}_front`];
    try {
      // A live session open, as the owner may have one when "Close project" is pressed.
      expect((await post(app, `/projects/${id}/live`, {}, { cookie })).status).toBe(200);
      await j.waitForJob();
      expect(x.live.session()?.projectId).toBe(id);
      expect(jobs.handle(id)?.appStarted).toBe(true);
      sandboxes.notRemoved = { [id]: left };
      const closed = await post(app, `/projects/${id}/close`, {}, { cookie });
      expect(closed.status).toBe(409);
      expect(await closed.text()).toContain(esc(closeNotRemovedRefusal(left)));
      // As the real removal leaves it: the live session ended, the app stopped, the handle and the folder kept.
      expect(x.live.session()).toBeNull();
      expect(jobs.handle(id)?.appStarted).toBe(false);
      expect(existsSync(jobs.handle(id)!.dir)).toBe(true);
      let s = await j.state(id);
      expect(s.stage).toBe("acceptance");
      expect(s.appRunning).toBe(false);
      expect(s.interrupted).toBe(false);
      expect(s.acceptanceRun?.outcome).toBe("passed");
      expect(s.removalLeft).toEqual(left);
      expect(removalNotFinished(s)).toBe(true);
      expect(REMOVAL_NOT_FINISHED).toBe(
        'This project\'s removal is not finished, so nothing of it is built, previewed, checked, approved, signed off, exported or opened any more: press "Close project" to try the removal again, or start a new project.',
      );
      const written = (await listEvents(pool, id)).length;
      // Through the journey: each is refused with the one sentence that names the state.
      const asks = (jn: Journey, jb: JourneyJobs): Array<[string, () => Promise<unknown>]> => [
        ["build a step", () => jb.buildStep(id, "01-data")],
        ["preview", () => jb.preview(id)],
        ["run the checklist", () => jb.acceptance(id)],
        ["approve a step", () => jn.approveStep(id, "02-submitter-screen")],
        ["approve and go on", () => jb.approve(id, "02-submitter-screen")],
        ["sign off", () => jn.signOff(id)],
        ["export", () => jb.exportProject(id)],
        ["a live job", () => jn.startJob(id, "live", async () => undefined)],
      ];
      for (const [what, ask] of [...asks(j, jobs), ["open the live app", () => jobs.openLive(id, "made-up-sign-in-session")] as [string, () => Promise<unknown>]]) {
        const e = await ask().then(() => null, (err: unknown) => err);
        expect(e, what).toBeInstanceOf(JourneyRefused);
        expect((e as Error).message, what).toBe(REMOVAL_NOT_FINISHED);
      }
      // Through the routes: each a plain 409 with the same sentence.
      const routes: Array<[string, Record<string, string>]> = [["build", { step: "01-data" }], ["approve", { step: "02-submitter-screen" }], ["preview", {}], ["acceptance", {}], ["sign-off", {}], ["export", {}], ["live", {}]];
      for (const [path, body] of routes) {
        const r = await post(app, `/projects/${id}/${path}`, body, { cookie });
        expect(r.status, path).toBe(409);
        expect(await r.text(), path).toContain(esc(REMOVAL_NOT_FINISHED));
      }
      expect(x.live.session()).toBeNull();
      s = await j.state(id);
      expect(s.signedOff).toBe(false);
      expect((await listEvents(pool, id)).length).toBe(written);
      // The pages: the panel with the note of what is left, and nothing offered but "Close project" and "New project".
      const pagesOf = async (a: typeof app, c: string) => {
        for (const lang of ["en", "ar"] as const) {
          const [before, after] = t(lang, "removal.left", { close: t(lang, "close.button") }).split("{left}");
          for (const screen of ["build", "preview", "acceptance", "export", "cost", "record"]) {
            const html = await (await get(a, `/projects/${id}/${screen}?lang=${lang}`, c)).text();
            const where = `${screen} ${lang}`;
            expect(html, where).toContain(`<p class="warn" data-removal-not-finished>${esc(t(lang, "removal.not_finished"))}</p>`);
            expect(html, where).toContain(`<p class="warn" data-removal-left>${esc(before!)}<span lang="en" dir="ltr">${esc(left.join("; "))}</span>${esc(after!)}</p>`);
            expect(html, where).toContain(`<button type="submit" data-close-again>${esc(t(lang, "close.button"))}</button>`);
            expect(html, where).toContain(`<a href="/projects/new">${esc(t(lang, "projects.new"))}</a>`);
            const forms = [...html.matchAll(/<form method="post" action="([^"]+)"/g)].map((m) => m[1]!).filter((f) => f !== "/language" && f !== "/sign-out");
            expect([...new Set(forms)], where).toEqual([`/projects/${id}/close`]);
            expect(html, where).not.toMatch(/data-(build|approve|live-open|live-show|live-end)[=>\s]/);
            expect(html, where).not.toContain('data-go="preview"');
            // Second review round: the record marks the app as not running after every removal event, also one that
            // left something. The preview screen does not turn that into "The app is not running any more."
            expect(html, where).not.toContain(esc(t(lang, "preview.app_stopped")));
            expect(html, where).not.toContain("data-app-running");
          }
        }
      };
      await pagesOf(app, cookie);
      // From the record alone: a second journey and second jobs on the same record, which hold no handle and no memory of
      // the close. (Not a real start: its recovery would first mark the project interrupted, as C19 shows.)
      const box: { jobs?: JourneyJobs } = {};
      const j2 = new Journey({ pool, dataDir, cleanupProject: (pid, rec) => box.jobs!.cleanup(pid, rec) });
      const jobs2 = new JourneyJobs({ journey: j2, sandboxes, measureFree: () => 50 * 1024 ** 3 });
      box.jobs = jobs2;
      expect(jobs2.handle(id)).toBeUndefined();
      expect(removalNotFinished(await j2.state(id))).toBe(true);
      for (const [what, ask] of asks(j2, jobs2)) {
        const e = await ask().then(() => null, (err: unknown) => err);
        expect(e, `after a restart: ${what}`).toBeInstanceOf(JourneyRefused);
        expect((e as Error).message, `after a restart: ${what}`).toBe(REMOVAL_NOT_FINISHED);
      }
      const app2 = createWebApp({ journey: j2, jobs: jobs2, password: new PasswordState("env", digestPassword(PASSWORD), null), sessions: new Sessions(), limiter: new SignInLimiter(), dataDir });
      const cookie2 = await signIn(app2);
      const signOff2 = await post(app2, `/projects/${id}/sign-off`, {}, { cookie: cookie2 });
      expect(signOff2.status).toBe(409);
      expect(await signOff2.text()).toContain(esc(REMOVAL_NOT_FINISHED));
      await pagesOf(app2, cookie2);
      expect((await listEvents(pool, id)).length).toBe(written);
      // "Close project" again, with nothing left: through the handle the first interface kept; the project closes.
      sandboxes.notRemoved = null;
      const destroyedBefore = sandboxes.destroyed.length;
      expect((await post(app, `/projects/${id}/close`, {}, { cookie })).status).toBe(303);
      s = await j.state(id);
      expect(s.stage).toBe("closed");
      expect(removalNotFinished(s)).toBe(false);
      expect(sandboxes.destroyed.slice(destroyedBefore)).toEqual([id]);
      expect(jobs.handle(id)).toBeUndefined();
      expect((await listEvents(pool, id, EV.sandboxRemoved)).map((e) => e.payload)).toEqual([
        { reason: CLOSE_NOT_REMOVED, interrupted: false, removed: false, left },
        { reason: "The project was closed.", interrupted: false },
      ]);
      // Second review round: the removal completed, so the preview screen says again that the app is not running.
      for (const lang of ["en", "ar"] as const) {
        expect(await (await get(app, `/projects/${id}/preview?lang=${lang}`, cookie)).text(), lang).toContain(`<p class="note">${esc(t(lang, "preview.app_stopped"))}</p>`);
      }
    } finally {
      sandboxes.notRemoved = null;
      await j.waitForJob();
      await j.closeProject(id);
    }
  }, 60_000);

  it("signed off, Open the live app is refused: the preview screen offers no open button and says why, in both languages; a POST made anyway is refused (409) with that reason; no live session, no live job, nothing recorded as opened (after the review of 14787d8)", async () => {
    const t = await checkedInterface("Leave requests (made-up, signed off then open)");
    try {
      expect((await post(t.app, `/projects/${t.id}/sign-off`, {}, { cookie: t.cookie })).status).toBe(303);
      expect((await t.j.state(t.id)).signedOff).toBe(true);
      for (const q of ["", "?lang=ar"]) {
        const html = await (await get(t.app, `/projects/${t.id}/preview${q}`, t.cookie)).text();
        expect.soft(html, `the open button is offered after sign-off (${q || "en"})`).not.toContain("data-live-open");
        expect.soft(html, q).not.toContain(`action="/projects/${t.id}/live"`);
        expect.soft(html, q).toContain("data-live-refused");
        expect.soft(html, q).toContain(SIGNED_OFF_WORDS);
      }
      const jobsBefore = (await t.j.state(t.id)).jobs.length;
      const r = await post(t.app, `/projects/${t.id}/live`, {}, { cookie: t.cookie });
      const html = await r.text();
      await t.j.waitForJob();
      expect.soft(passOn(html), "a pass was shown after sign-off").toBeUndefined();
      expect.soft(t.live.session(), "a live session is open after sign-off").toBeNull();
      expect(r.status).toBe(409);
      expect(html).toContain(SIGNED_OFF_WORDS);
      expect(await listEvents(pool, t.id, EV.liveOpened)).toHaveLength(0);
      expect((await t.j.state(t.id)).jobs).toHaveLength(jobsBefore);
      // The front holds no pass and no session.
      expect(await (await fetch(`http://127.0.0.1:${t.port}/`)).text()).toContain("data-no-live");
    } finally {
      await t.j.waitForJob();
      await t.j.closeProject(t.id);
    }
  }, 60_000);

  it("a live session open when sign-off is asked, its pass shown and not used: the session is ended first and its close recorded, naming sign-off, before journey.signed_off; the pass then no longer works at the front; the export after sign-off is written as before (after the review of 14787d8)", async () => {
    const t = await checkedInterface("Leave requests (made-up, open then sign off)");
    try {
      const opened = await post(t.app, `/projects/${t.id}/live`, {}, { cookie: t.cookie });
      expect(opened.status).toBe(200);
      const shown = passOn(await opened.text());
      expect(shown).toBeDefined();
      await t.j.waitForJob();
      const session = t.live.session();
      expect(session?.projectId).toBe(t.id);
      expect((await post(t.app, `/projects/${t.id}/sign-off`, {}, { cookie: t.cookie })).status).toBe(303);
      expect.soft(t.live.session(), "a live session is open after sign-off").toBeNull();
      expect.soft(await closesAndSignOff(t.id), "the record's order").toEqual([`closed:signed_off:${session!.sessionId}`, "signed_off"]);
      // The pass no longer works at the front: it was revoked.
      await new Promise((x) => setTimeout(x, 100));
      const r = await enter(t.port, shown!);
      expect.soft(r.status, "the pass shown before sign-off still enters the live app").toBe(403);
      expect(await listEvents(pool, t.id, EV.liveEntered)).toHaveLength(0);
      expect(await (await fetch(`http://127.0.0.1:${t.port}/`)).text()).toContain("data-no-live");
      // The export after sign-off is written as before.
      expect((await post(t.app, `/projects/${t.id}/export`, {}, { cookie: t.cookie })).status).toBe(303);
      await t.j.waitForJob();
      const st = await t.j.state(t.id);
      expect(st.jobs.at(-1)).toMatchObject({ kind: "export", state: "finished" });
      expect(st.exportEventId).not.toBeNull();
      expect(await listEvents(pool, t.id, EV.liveOpened)).toHaveLength(1);
    } finally {
      await t.j.waitForJob();
      await t.j.closeProject(t.id);
    }
  }, 60_000);

  it("a live session entered at the front when sign-off is asked: it is ended first (revoked at the front, its streams killed) and its close recorded before journey.signed_off; the front's cookie then no longer reaches the app and no new stream is opened (after the review of 14787d8)", async () => {
    const t = await checkedInterface("Leave requests (made-up, entered then sign off)");
    try {
      const opened = await post(t.app, `/projects/${t.id}/live`, {}, { cookie: t.cookie });
      const shown = passOn(await opened.text());
      expect(shown).toBeDefined();
      await t.j.waitForJob();
      const entered = await enter(t.port, shown!);
      expect(entered.status).toBe(303);
      const frontCookie = (entered.headers.get("set-cookie") ?? "").split(";")[0]!;
      await new Promise((x) => setTimeout(x, 100));
      const session = t.live.session();
      expect(session?.entered).toBe(true);
      expect(await (await fetch(`http://127.0.0.1:${t.port}/en/home`, { headers: { cookie: frontCookie } })).text()).toBe("made-up app page");
      expect((await post(t.app, `/projects/${t.id}/sign-off`, {}, { cookie: t.cookie })).status).toBe(303);
      expect.soft(t.live.session(), "a live session is open after sign-off").toBeNull();
      expect.soft(t.live.activeStreams(), "streams to the app are open after sign-off").toBe(0);
      expect.soft(await closesAndSignOff(t.id), "the record's order").toEqual([`closed:signed_off:${session!.sessionId}`, "signed_off"]);
      expect((await listEvents(pool, t.id, EV.liveClosed)).at(-1)?.payload).toMatchObject({ entered: true });
      await new Promise((x) => setTimeout(x, 100));
      const streamsBefore = sandboxes.streamsOpened;
      const after = await (await fetch(`http://127.0.0.1:${t.port}/en/home`, { headers: { cookie: frontCookie, connection: "close" } })).text();
      expect.soft(after, "the front's cookie still reaches the app after sign-off").not.toBe("made-up app page");
      expect(after).toContain("data-no-live");
      expect(sandboxes.streamsOpened).toBe(streamsBefore);
    } finally {
      await t.j.waitForJob();
      await t.j.closeProject(t.id);
    }
  }, 60_000);

  it("Open the live app asked for while the sign-off is being recorded (its write held) waits behind it and is then refused: no pass, no live session, nothing recorded as opened; the sign-off is recorded (after the review of 14787d8)", async () => {
    const held = heldWritePool(EV.signedOff);
    const t = await checkedInterface("Leave requests (made-up, open during sign-off)", { journeyPool: held.pool });
    try {
      const signingOff = post(t.app, `/projects/${t.id}/sign-off`, {}, { cookie: t.cookie });
      await held.asked;
      const opening = Promise.resolve(post(t.app, `/projects/${t.id}/live`, {}, { cookie: t.cookie }));
      // The open waits behind the sign-off (the project's lock): it does not answer while the sign-off is held.
      expect(await Promise.race([opening.then(() => "answered" as const), sleep(400)])).toBe("waiting");
      held.release();
      expect((await signingOff).status).toBe(303);
      const r = await opening;
      const html = await r.text();
      await t.j.waitForJob();
      expect.soft(passOn(html), "a pass was shown for an open asked for while the sign-off was recorded").toBeUndefined();
      expect.soft(t.live.session(), "a live session is open after sign-off").toBeNull();
      expect(r.status).toBe(409);
      expect(html).toContain(SIGNED_OFF_WORDS);
      expect(await listEvents(pool, t.id, EV.liveOpened)).toHaveLength(0);
      expect((await t.j.state(t.id)).signedOff).toBe(true);
    } finally {
      held.release();
      await t.j.waitForJob();
      await t.j.closeProject(t.id);
    }
  }, 60_000);

  it("a sign-off asked for while Open the live app is in flight (its network check held) is refused, as while any job runs; once that open is made, a sign-off ends its session first and records the close before the sign-off (after the review of 14787d8)", async () => {
    const t = await checkedInterface("Leave requests (made-up, sign-off during open)");
    const hold: { release: () => void } = { release: () => undefined };
    try {
      let started!: () => void;
      const asked = new Promise<void>((r) => (started = r));
      sandboxes.streamNetworkHold = { started, release: new Promise<void>((r) => (hold.release = r)) };
      const opening = post(t.app, `/projects/${t.id}/live`, {}, { cookie: t.cookie });
      await asked;
      const refused = await post(t.app, `/projects/${t.id}/sign-off`, {}, { cookie: t.cookie });
      expect(refused.status).toBe(409);
      expect(await refused.text()).toContain("A job is running for this project");
      expect(await listEvents(pool, t.id, EV.signedOff)).toHaveLength(0);
      hold.release();
      const r = await opening;
      expect(r.status).toBe(200);
      expect(passOn(await r.text())).toBeDefined();
      await t.j.waitForJob();
      sandboxes.streamNetworkHold = null;
      const session = t.live.session();
      expect(session?.projectId).toBe(t.id);
      expect((await post(t.app, `/projects/${t.id}/sign-off`, {}, { cookie: t.cookie })).status).toBe(303);
      expect.soft(t.live.session(), "a live session is open after sign-off").toBeNull();
      expect(await closesAndSignOff(t.id)).toEqual([`closed:signed_off:${session!.sessionId}`, "signed_off"]);
    } finally {
      hold.release();
      sandboxes.streamNetworkHold = null;
      await t.j.waitForJob();
      await t.j.closeProject(t.id);
    }
  }, 60_000);

  it("a live session whose close (End the live app) is still being recorded when sign-off is asked: the sign-off waits for that record, so the close is recorded before the sign-off (after the review of 14787d8)", async () => {
    const t = await checkedInterface("Leave requests (made-up, close under way at sign-off)");
    const opened = await post(t.app, `/projects/${t.id}/live`, {}, { cookie: t.cookie });
    expect(opened.status).toBe(200);
    await t.j.waitForJob();
    const session = t.live.session();
    expect(session?.projectId).toBe(t.id);
    const held = t.holdNextClose();
    try {
      const ending = post(t.app, `/projects/${t.id}/live/end`, {}, { cookie: t.cookie });
      await held.asked;
      // The session is ended at the front; its record is held. The sign-off is asked for now.
      const signingOff = Promise.resolve(post(t.app, `/projects/${t.id}/sign-off`, {}, { cookie: t.cookie }));
      expect.soft(await Promise.race([signingOff.then(() => "answered" as const), sleep(400)]), "the sign-off answered while the live session's close was still being recorded").toBe("waiting");
      held.release();
      expect((await ending).status).toBe(303);
      expect((await signingOff).status).toBe(303);
      expect(t.live.session()).toBeNull();
      expect(await closesAndSignOff(t.id)).toEqual([`closed:ended_on_builder:${session!.sessionId}`, "signed_off"]);
    } finally {
      held.release();
      await t.j.waitForJob();
      await t.j.closeProject(t.id);
    }
  }, 60_000);

  it("control: before sign-off, after the checklist passed, the preview screen offers Open the live app and it opens (its pass shown, its session open, live_opened recorded); a sign-off with no live session open records no live close (after the review of 14787d8)", async () => {
    const t = await checkedInterface("Leave requests (made-up, control before sign-off)");
    try {
      for (const q of ["", "?lang=ar"]) {
        const html = await (await get(t.app, `/projects/${t.id}/preview${q}`, t.cookie)).text();
        expect(html, q).toContain("data-live-open");
        expect(html, q).not.toContain(SIGNED_OFF_WORDS);
      }
      const r = await post(t.app, `/projects/${t.id}/live`, {}, { cookie: t.cookie });
      expect(r.status).toBe(200);
      expect(passOn(await r.text())).toBeDefined();
      await t.j.waitForJob();
      const session = t.live.session();
      expect(session?.projectId).toBe(t.id);
      expect(await listEvents(pool, t.id, EV.liveOpened)).toHaveLength(1);
      expect((await post(t.app, `/projects/${t.id}/live/end`, {}, { cookie: t.cookie })).status).toBe(303);
      expect(t.live.session()).toBeNull();
      expect((await post(t.app, `/projects/${t.id}/sign-off`, {}, { cookie: t.cookie })).status).toBe(303);
      expect(await closesAndSignOff(t.id)).toEqual([`closed:ended_on_builder:${session!.sessionId}`, "signed_off"]);
    } finally {
      await t.j.waitForJob();
      await t.j.closeProject(t.id);
    }
  }, 60_000);
});
