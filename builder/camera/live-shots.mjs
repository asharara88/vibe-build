// The live camera (package J3; final design, section 4.8). Runs only in the approved runner image, in the project's own
// `acceptance` service (builder/src/orchestrator/example-1-adapter.ts, `liveCamera`), on the project's `front` network
// alone: the image's unprivileged user (1001), a read-only root, this script read-only at /camera, one output folder at
// /shots, the passes in a read-only folder at /run/secrets/live (pass-1, and pass-2 when the walk asks for it), the
// sample user's password as one read-only file, and the camera socket's folder read-only at /psock.
//
// It listens on 127.0.0.1:4030 inside its own container and passes each connection, byte for byte, to /psock/c.sock;
// on the machine that socket leads to the builder's preview front (builder/src/web/preview.ts, `cameraSocket`). Its
// browser loads only http://127.0.0.1:4030/: every other address is refused inside the browser and counted, so the
// app's pages are seen only as the owner's browser sees them, through the front. No video is recorded and no trace is
// kept (the owner's answer to question A, 13 Nov 2026). The pass and the password are read from their files and typed;
// neither is printed, and both fields are masked in every photograph.
//
// WALK (a setting of this run):
//   "owner"   (default) the owner's walk: the gate, the pass, the app's sign-in as the made-up employee, My requests,
//             a new request, the list, Arabic, the 390 px view, sign-out, leave; and Chromium's checks (section 6, M3).
//   "storage" enter with pass-1, write the page's storage, ask for pass-2, enter again: storage must be gone.
//   "request" enter with pass-1, sign in, add a request: each POST's status (the mapping measurements of M3).
// It prints one JSON line per fact: {"kind":"check"|"shot"|"post"|"need"|"blocked"|"done", ...}.
import { existsSync, readFileSync, statSync } from "node:fs";
import net from "node:net";

const BASE = "http://127.0.0.1:4030";
const WALK = process.env.WALK ?? "owner";
const say = (o) => console.log(JSON.stringify(o));
let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  say({ kind: "check", name, ok: Boolean(ok), detail: String(detail).slice(0, 400) });
  return Boolean(ok);
}
if (!["owner", "storage", "request"].includes(WALK)) {
  check("the walk is one this camera knows", false, WALK);
  process.exit(2);
}
if (!existsSync("/psock/c.sock") || !statSync("/psock/c.sock").isSocket()) {
  check("the camera socket is there", false, "/psock/c.sock is not a socket");
  process.exit(2);
}

// 127.0.0.1:4030 inside this container, passed to the camera socket.
const forwarder = net.createServer((client) => {
  const up = net.connect("/psock/c.sock");
  client.pipe(up);
  up.pipe(client);
  const end = () => {
    client.destroy();
    up.destroy();
  };
  client.on("error", end);
  up.on("error", end);
  client.on("close", end);
  up.on("close", end);
});
await new Promise((r) => forwarder.listen(4030, "127.0.0.1", r));

const { chromium } = await import("/runner/node_modules/playwright-core/index.mjs");
const readPass = (n) => readFileSync(`/run/secrets/live/pass-${n}`, "utf8").trim();
const samplePassword = readFileSync("/run/secrets/sample-password", "utf8").trim();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const outside = new Map();
await context.route("**/*", (route) => {
  const u = route.request().url();
  if (u.startsWith(`${BASE}/`)) return route.continue();
  let host = "?";
  try {
    host = new URL(u).host;
  } catch {}
  outside.set(host, (outside.get(host) ?? 0) + 1);
  return route.abort();
});
const page = await context.newPage();
let cspViolations = 0;
const cspMessages = [];
page.on("console", (m) => {
  if (/Content Security Policy|Content-Security-Policy/i.test(m.text())) {
    cspViolations++;
    cspMessages.push(m.text().replace(/\s+/g, " ").slice(0, 240));
  }
});
const posts = [];
// Every answer the browser got (M3): its status, its Location and the names of its cookies as the browser sees them,
// and whether its body names the app's own address. Values of cookies are not read.
const answers = [];
const bodyChecks = [];
page.on("response", (r) => {
  const q = r.request();
  const path = new URL(r.url()).pathname;
  if (q.method() === "POST") posts.push({ path, status: r.status(), action: Boolean(q.headers()["next-action"]) });
  const h = r.headers();
  const a = { path, status: r.status(), location: h.location ?? null, cookies: [] };
  answers.push(a);
  // Playwright gives the headers as a list (Set-Cookie one by one) only through a promise.
  cookieReads.push(
    r.headersArray().then(
      (list) => void (a.cookies = list.filter((x) => x.name.toLowerCase() === "set-cookie").map((x) => x.value.split("=")[0])),
      () => undefined,
    ),
  );
  if (/text|javascript|json|x-component/.test(h["content-type"] ?? "")) bodyChecks.push(r.body().then((b) => (b.includes("app:3161") ? path : null), () => null));
});
const cookieReads = [];
/** A read that may never end (an answer still streaming when the page moved on): given 5 s, then counted as unread. */
const bounded = (p, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), 5000))]);
async function answersSummary() {
  await Promise.all(cookieReads.map((p) => bounded(p, undefined)));
  const read = await Promise.all(bodyChecks.map((p) => bounded(p, "unread")));
  const withApp = read.filter((x) => x && x !== "unread");
  say({ kind: "fact", name: "answer bodies read for the app's address", value: `${read.length - read.filter((x) => x === "unread").length} of ${read.length} (the rest were still streaming when read)` });
  const statuses = {};
  for (const a of answers) statuses[a.status] = (statuses[a.status] ?? 0) + 1;
  say({
    kind: "answers",
    count: answers.length,
    statuses,
    locations: [...new Set(answers.filter((a) => a.location).map((a) => `${a.status} ${a.path} -> ${a.location}`))],
    cookie_names: [...new Set(answers.flatMap((a) => a.cookies))],
    bodies_naming_app_3161: withApp,
  });
  return withApp;
}
const path = () => new URL(page.url()).pathname;
const text = async (sel) => ((await page.locator(sel).first().textContent().catch(() => null)) ?? "").replace(/\s+/g, " ").trim();
const masks = () => [page.locator('input[name="pass"]'), page.locator('input[type="password"]')];
async function shot(file) {
  await page.screenshot({ path: `/shots/${file}`, fullPage: true, mask: masks() });
  say({ kind: "shot", file, path: path(), width: page.viewportSize()?.width ?? 0 });
}
async function enter(n) {
  await page.goto(`${BASE}/__builder/enter`);
  await page.locator('input[name="pass"]').first().fill(readPass(n));
  const nav = page.waitForNavigation({ waitUntil: "load", timeout: 60_000 });
  await page.locator('form[action="/__builder/enter"] button').first().click();
  await nav;
}
async function signIn() {
  await page.goto(`${BASE}/en/sign-in`);
  await page.waitForLoadState("networkidle");
  await page.fill("#email", "employee@example.test");
  await page.fill("#password", samplePassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/en\/home$/, { timeout: 60_000 });
}
async function addRequest(reason) {
  await page.goto(`${BASE}/en/my-requests/new`);
  await page.waitForLoadState("networkidle");
  await page.fill("#startDate", "2026-12-14");
  await page.fill("#endDate", "2026-12-16");
  await page.fill("#days", "3");
  await page.fill("#reason", reason);
}
async function submitRequest() {
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/en\/my-requests\?sent=1$/, { timeout: 60_000 });
  await page.waitForLoadState("networkidle");
}

async function owner() {
  const t0 = Date.now();
  await page.goto(`${BASE}/`);
  check("before the pass: the gate, with its two labels", (await text("body")).includes("Simulated build: scripted engine, sample data") && (await text("body")).includes("Made-up data only. No customer or personal details. Removed when the project closes."), await text("body"));
  await page.goto(`${BASE}/__builder/enter`);
  await shot("01-gate.png");
  await enter(1);
  check("the pass let the browser in, at the app", !path().startsWith("/__builder"), `${path()}: ${(await text("body")).slice(0, 300)}`);
  await page.waitForLoadState("networkidle");
  await shot("02-app-sign-in.png");
  check("the app's own sample-data banner is there", (await text('[role="note"]')).length > 0, await text('[role="note"]'));
  const tSign = Date.now();
  await signIn();
  check("signed in to the app as the made-up employee, through the preview", path() === "/en/home", path());
  say({ kind: "timing", what: "sign-in to home", ms: Date.now() - tSign });
  await page.waitForLoadState("networkidle");
  await shot("03-app-home.png");
  await page.goto(`${BASE}/en/my-requests`);
  await page.waitForLoadState("networkidle");
  await shot("04-app-my-requests.png");
  const reason = "Made-up family visit (live preview check)";
  await addRequest(reason);
  await shot("05-app-new-request.png");
  await submitRequest();
  check("the new request was saved: the list shows it", (await text("main")).includes(reason), await text("main"));
  await shot("06-app-request-listed.png");
  // Arabic, with the app's own language switch.
  await page.locator('nav a[href*="/ar/"]').first().click();
  await page.waitForURL(/\/ar\/my-requests/, { timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  check("the app in Arabic, right to left", (await page.locator("html").getAttribute("dir")) === "rtl", await page.locator("html").getAttribute("dir"));
  await shot("07-app-my-requests-ar.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/en/my-requests`);
  await page.waitForLoadState("networkidle");
  await shot("08-app-my-requests-phone.png");
  await page.setViewportSize({ width: 1280, height: 900 });

  // The policy's refusals seen in the walk itself, before the deliberate tries below: none are expected.
  const beforeProbes = cspViolations;
  check("the walk itself drew no content-security-policy refusal", beforeProbes === 0, cspMessages.join(" || "));
  // Chromium's checks (section 6, M3), from inside one of the app's pages.
  const probe = await page.evaluate(async () => {
    const tryFetch = async (u) => {
      try {
        const r = await fetch(u, { mode: "no-cors" });
        return `answered (${r.type})`;
      } catch (e) {
        return `refused (${e && e.name ? e.name : "error"})`;
      }
    };
    let sw = "not tried";
    try {
      await navigator.serviceWorker.register("/sw-probe.js");
      sw = "registered";
    } catch (e) {
      sw = `refused (${e && e.name ? e.name : "error"})`;
    }
    return {
      app: await tryFetch("http://app:3161/en/sign-in"),
      builder: await tryFetch("http://127.0.0.1:4020/"),
      outside: await tryFetch("https://example.com/"),
      serviceWorker: sw,
      webrtc: typeof RTCPeerConnection === "function" ? "present (not blocked by the preview)" : "absent",
      secureContext: window.isSecureContext,
    };
  });
  check("a fetch to http://app:3161 from the app's page is refused", probe.app.startsWith("refused"), probe.app);
  check("a fetch to the builder's 127.0.0.1:4020 from the app's page is refused", probe.builder.startsWith("refused"), probe.builder);
  check("a fetch to an outside name from the app's page is refused", probe.outside.startsWith("refused"), probe.outside);
  check("a service worker is refused", probe.serviceWorker.startsWith("refused"), probe.serviceWorker);
  say({ kind: "fact", name: "WebRTC in the app's page", value: probe.webrtc });
  say({ kind: "fact", name: "the preview is a secure context in this browser", value: String(probe.secureContext) });
  say({ kind: "blocked", by_route: Object.fromEntries(outside), note: "addresses the browser tried that the camera's own rule refused; those the policy refused never reach it" });
  check("none of those fetches reached the network: the policy refused them before the camera's rule saw them", !outside.has("app:3161") && !outside.has("127.0.0.1:4020") && !outside.has("example.com"), JSON.stringify(Object.fromEntries(outside)));
  const named = await answersSummary();
  check("no answer the browser got names the app's own address (app:3161)", named.length === 0, named.join(", "));
  check("every cookie the browser was given carries the session's prefix or is the front's own", answers.flatMap((a) => a.cookies).every((n) => /^bp[0-9a-f]{8}_/.test(n) || n === "builder_preview"), JSON.stringify([...new Set(answers.flatMap((a) => a.cookies))]));
  check("no Location the browser got leads off the preview", answers.every((a) => !a.location || /^\/(?![/\\])/.test(a.location)), JSON.stringify(answers.filter((a) => a.location).map((a) => a.location)));

  // Sign out with the app's own button, then leave the live app.
  await page.goto(`${BASE}/en/home`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/en\/sign-in$/, { timeout: 60_000 });
  check("signed out of the app", path() === "/en/sign-in", path());
  await shot("09-app-signed-out.png");
  await page.goto(`${BASE}/__builder/leave`);
  const nav = page.waitForNavigation({ waitUntil: "load", timeout: 60_000 });
  await page.locator('form[action="/__builder/leave"] button').first().click();
  await nav;
  check("left the live app", (await page.locator("[data-left]").count()) > 0, await text("body"));
  await shot("10-left.png");
  await page.goto(`${BASE}/en/home`);
  check("after leaving, the app is not reached: the gate's page", (await page.locator("[data-no-live]").count()) > 0 || (await text("body")).includes("No live app now"), await text("body"));
  say({ kind: "timing", what: "whole walk", ms: Date.now() - t0 });
}

async function storage() {
  await enter(1);
  await page.goto(`${BASE}/en/sign-in`);
  await page.evaluate(() => {
    localStorage.setItem("j3-probe", "made-up");
    sessionStorage.setItem("j3-probe", "made-up");
  });
  const before = await page.evaluate(() => localStorage.getItem("j3-probe"));
  check("storage written in the app's page", before === "made-up", String(before));
  say({ kind: "need", what: "pass-2" });
  const end = Date.now() + 90_000;
  while (!existsSync("/run/secrets/live/pass-2") && Date.now() < end) await new Promise((r) => setTimeout(r, 500));
  await enter(2);
  await page.goto(`${BASE}/en/sign-in`);
  const after = await page.evaluate(() => [localStorage.getItem("j3-probe"), sessionStorage.getItem("j3-probe")]);
  check("after a new entry, the page's storage is gone (Clear-Site-Data)", after[0] === null && after[1] === null, JSON.stringify(after));
}

async function request() {
  await enter(1);
  await signIn().catch((e) => say({ kind: "fact", name: "sign-in", value: String(e && e.message ? e.message : e).split("\n")[0] }));
  const signedIn = path() === "/en/home";
  say({ kind: "fact", name: "signed in", value: String(signedIn) });
  if (signedIn) {
    await addRequest("Made-up request (mapping measurement)");
    await submitRequest().catch(() => undefined);
    say({ kind: "fact", name: "request saved", value: String(/\/en\/my-requests\?sent=1$/.test(page.url())) });
  }
  say({ kind: "posts", posts });
}

try {
  if (WALK === "owner") await owner();
  else if (WALK === "storage") await storage();
  else await request();
} catch (err) {
  check("the walk ran to its end without an error", false, String(err && err.message ? err.message : err).split("\n")[0]);
} finally {
  say({ kind: "csp", violations_seen_in_console: cspViolations, messages: cspMessages });
  check(`nothing but ${BASE} was loaded by the camera's own rule`, [...outside.keys()].every((h) => ["app:3161", "127.0.0.1:4020", "example.com"].includes(h)), JSON.stringify(Object.fromEntries(outside)));
  await context.close();
  await browser.close();
  forwarder.close();
}
say({ kind: "done", failed });
process.exit(failed === 0 ? 0 : 1);
