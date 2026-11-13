// The builder camera (package J1; final design, sections 3 and 5). Runs only in the approved runner image, in a
// container of its own started by builder/scripts/demo-journey.ts: the image's unprivileged user, a read-only
// root, every capability dropped, this script read-only at /camera, one output folder at /shots, and the
// interface's password as one read-only file at /run/secrets/ui-password. It shares the machine's network so that
// it can reach the interface on 127.0.0.1:4020 (or the loopback port BUILDER_CAMERA_BASE names, when the automated
// run had to use another), and it loads nothing else: every other address is refused below.
//
// It walks J1's "Done means" as the owner would, in the browser, and photographs each screen
// (NN-<screen>-<en|ar|phone>.png; "phone" is 390 px wide). No video is recorded and no trace is kept: the browser
// context is made with neither (the owner's answer to question A, 13 Nov 2026). The password is read from its
// file and typed into the sign-in form; it is never printed. The sign-in page is photographed before anything is
// typed. Each thing it checks is printed as one JSON line ({"kind":"check",...}); it ends with exit code 0 only if
// every check passed.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "/runner/node_modules/playwright-core/index.mjs";

// Only http://127.0.0.1:<port> is accepted; anything else stops the camera before the browser starts.
const BASE = process.env.BUILDER_CAMERA_BASE ?? "http://127.0.0.1:4020";
if (!/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/.test(BASE)) {
  console.log(JSON.stringify({ kind: "check", name: "the camera's address is 127.0.0.1", ok: false, detail: "BUILDER_CAMERA_BASE is not http://127.0.0.1:<port>" }));
  process.exit(1);
}
const ASK = "I need an app where staff can request leave and managers approve it";
const password = readFileSync("/run/secrets/ui-password", "utf8").trim();
const say = (o) => console.log(JSON.stringify(o));
let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  say({ kind: "check", name, ok: Boolean(ok), detail: String(detail).slice(0, 400) });
  return Boolean(ok);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const outside = [];
await context.route("**/*", (route) => {
  const u = route.request().url();
  if (u.startsWith(`${BASE}/`)) return route.continue();
  outside.push(u);
  return route.abort();
});
const page = await context.newPage();
const path = () => new URL(page.url()).pathname;
const text = async (sel) => ((await page.locator(sel).first().textContent().catch(() => null)) ?? "").replace(/\s+/g, " ").trim();
const has = async (sel) => (await page.locator(sel).count().catch(() => 0)) > 0;
/** Click a link or a form's button and wait for the page it leads to (a form's POST answers with a redirect). */
const clickAndLoad = async (sel) => {
  const nav = page.waitForNavigation({ waitUntil: "load", timeout: 120_000 });
  await page.locator(sel).first().click();
  await nav;
};

/** Photograph the page as it is (en), then in Arabic (?lang=ar) and at 390 px wide, as asked. GETs change nothing. */
async function photo(nn, screen, kinds = ["en"]) {
  const here = page.url().split("?")[0];
  for (const k of kinds) {
    if (k === "ar") await page.goto(`${here}?lang=ar`);
    if (k === "phone") {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(here);
    }
    const file = `${String(nn).padStart(2, "0")}-${screen}-${k}.png`;
    await page.screenshot({ path: `/shots/${file}`, fullPage: true });
    say({ kind: "shot", file, path: path(), lang: k === "ar" ? "ar" : "en", width: k === "phone" ? 390 : 1280 });
    if (k === "phone") await page.setViewportSize({ width: 1280, height: 900 });
  }
  if (kinds.some((k) => k !== "en")) await page.goto(here);
}

/**
 * Where the walk stopped, photographed as it is, so that the evidence shows why; then the screens that can still be
 * read (the cost panel and the record, under the numbers they have in the whole walk), and sign-out.
 */
async function stopped(nn, screen, id) {
  await photo(nn, `${screen}-stopped`, ["en", "ar"]);
  if (!id) return;
  await page.goto(`${BASE}/projects/${id}/cost`);
  check("cost, after the stop: $0.00 spent, no freeze, an empty unreconciled list", (await text("td[data-spent]")) === "$0.00" && (await has("[data-no-freeze]")) && (await has("[data-unreconciled-empty]")), await text("table[data-cost]"));
  await photo(18, "cost", ["en", "ar", "phone"]);
  await page.goto(`${BASE}/projects/${id}/record`);
  const ids = await page.$$eval("tr[data-event]", (rows) => rows.map((r) => Number(r.getAttribute("data-event"))));
  check("the record, after the stop: every event, in id order", ids.length > 20 && ids.every((v, i) => i === 0 || v > ids[i - 1]), `${ids.length} events`);
  say({ kind: "record", project: id, events: ids.length });
  await photo(21, "record", ["en"]);
  await clickAndLoad('form[action="/sign-out"] button');
  check("signed out", path() === "/sign-in", path());
}

/** Reload until a selector is there (a running job's page refreshes itself; this does not rely on it). */
async function waitFor(sel, ms, failSel = null) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await has(sel)) return true;
    if (failSel && (await has(failSel))) return false;
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: "load" }).catch(() => undefined);
  }
  return false;
}

async function run() {
  // 1. A visitor who is not signed in gets only the sign-in page.
  for (const p of ["/projects", "/projects/new", "/"]) {
    await page.goto(`${BASE}${p}`);
    check(`a visitor not signed in who opens ${p} gets the sign-in page`, path() === "/sign-in", path());
  }
  check("the sign-in page has one password field", (await page.locator('input[type="password"]').count()) === 1);
  check("the mode line says the real-model gate is closed", (await text("p.mode")).includes("The real-model gate is closed."), await text("p.mode"));
  await photo(1, "sign-in", ["en", "ar", "phone"]);

  // 2. A wrong password is refused.
  await page.fill("#password", `made-up-wrong-${randomBytes(6).toString("hex")}`);
  await clickAndLoad('form[action="/sign-in"] button[type="submit"]');
  check("a wrong password is refused", path() === "/sign-in" && (await text('p[role="alert"]')).includes("That password is not right."), await text('p[role="alert"]'));
  await photo(2, "sign-in-wrong-password", ["en"]);

  // 3. Sign in.
  await page.fill("#password", password);
  await clickAndLoad('form[action="/sign-in"] button[type="submit"]');
  check("signed in, at the projects page", path() === "/projects", path());
  await photo(3, "projects", ["en"]);

  // 4. A new project: "Leave requests (made-up)", a $5.00 cap, the brief.
  await clickAndLoad('a[href="/projects/new"]');
  await page.fill("#name", "Leave requests (made-up)");
  await page.fill("#cap", "5.00");
  await page.fill("#brief", ASK);
  await photo(4, "new-project", ["en"]);
  await clickAndLoad('form[action="/projects"] button[type="submit"]');
  const m = /^\/projects\/(j1-[0-9a-f]{12})\/brief$/.exec(path());
  if (!check("the project is made, at its brief", m, path())) return;
  const id = m[1];
  say({ kind: "project", id, name: "Leave requests (made-up)", cap: "5.00" });
  check("the brief is shown as typed", (await text("pre[data-brief]")) === ASK);
  await photo(5, "brief", ["en"]);
  await clickAndLoad(`form[action="/projects/${id}/continue"] button`);
  check("continued as example 1, at the questions", path() === `/projects/${id}/questions`, path());
  await photo(6, "questions", ["en", "ar", "phone"]);

  // 5. Answer every turn, as the owner would: the recommended option where there is one, else the first; every
  // field ticked; one made-up line where a line is asked for.
  let turns = 0;
  while (await has(`form[action="/projects/${id}/answers"]`)) {
    const form = page.locator(`form[action="/projects/${id}/answers"]`);
    const sets = form.locator("fieldset[data-question]");
    const n = await sets.count();
    if (n > 3) check("a turn asks at most three questions", false, `${n}`);
    for (let i = 0; i < n; i++) {
      const fs = sets.nth(i);
      const rec = fs.locator("label.opt:has(.rmark) input[type=radio]");
      const radios = fs.locator('input[type=radio]:not([value="else"])');
      if ((await rec.count()) > 0) await rec.first().check();
      else if ((await radios.count()) > 0) await radios.first().check();
      const boxes = fs.locator("input[type=checkbox]");
      for (let b = 0; b < (await boxes.count()); b++) await boxes.nth(b).check();
      const line = fs.locator('input[name^="t_"]');
      if ((await line.count()) > 0) await line.fill("Made-up answer typed by the automated run.");
    }
    await clickAndLoad(`form[action="/projects/${id}/answers"] button[type="submit"]`);
    turns++;
    if (turns > 20) break;
    if (await has('p[role="alert"]')) {
      check("each turn's answers are accepted", false, await text('p[role="alert"]'));
      return;
    }
  }
  check("every turn answered in the chat, 8 turns", turns === 8 && (await text("main")).includes("Every question is answered."), `${turns} turns`);
  await photo(7, "questions-answered", ["en"]);

  // 6. The proposed app and the build steps; confirm both.
  await clickAndLoad(`a[href="/projects/${id}/proposal"]`);
  check("the proposed app shows its seven sections, the Later list and the assumed choice", (await page.locator("main h3").count()) >= 9 && (await has("ul[data-later] li")) && (await has("ul[data-assumed] li")));
  await photo(8, "proposal", ["en"]);
  await clickAndLoad(`form[action="/projects/${id}/confirm-brief"] button`);
  check("brief confirmed, at the build steps", path() === `/projects/${id}/plan`, path());
  check("the plan has the two steps", (await page.locator("li[data-step]").count()) === 2);
  await photo(9, "plan", ["en"]);
  await clickAndLoad(`form[action="/projects/${id}/confirm-plan"] button`);
  check("plan confirmed; tests fixed as v001, stand-in test, not independent acceptance", (await text("main")).includes("Tests fixed as version v001: stand-in test, not independent acceptance."));
  await photo(10, "plan-confirmed", ["en"]);

  // 7. Build: step 1, approve, step 2, approve (which starts the app for the preview).
  await clickAndLoad('a[data-go="build"]');
  await photo(11, "build", ["en"]);
  await clickAndLoad('button[data-build="01-data"]');
  const one = await waitFor('[data-step="01-data"][data-step-state="finished"]', 600_000, '[data-step="01-data"][data-step-state="failed"]');
  if (!check("step 1 built", one, await text('[data-step="01-data"]'))) return stopped(12, "build-step-1", id);
  const r1 = await text('[data-step="01-data"] [data-reserved]');
  check("step 1: $1.5552 reserved while it ran, released, $0.00 spent", r1.includes("Reserved while it ran: $1.5552") && r1.includes("released") && r1.includes("Spent: $0.00."), r1);
  check("step 1's live lines: one line per file written (4)", (await page.locator('[data-step="01-data"] ol[data-lines] li', { hasText: "Wrote " }).count()) === 4);
  await photo(12, "build-step-1", ["en"]);
  await clickAndLoad('button[data-approve="01-data"]');
  const two = await waitFor('[data-step="02-submitter-screen"][data-step-state="finished"]', 600_000, '[data-step="02-submitter-screen"][data-step-state="failed"]');
  if (!check("step 1 approved; step 2 built", two && (await has('[data-step="01-data"][data-approved="yes"]')), await text('[data-step="02-submitter-screen"]'))) return stopped(13, "build-step-2", id);
  const r2 = await text('[data-step="02-submitter-screen"] [data-reserved]');
  check("step 2: $3.1104 reserved while it ran, released, $0.00 spent", r2.includes("Reserved while it ran: $3.1104") && r2.includes("released") && r2.includes("Spent: $0.00."), r2);
  await photo(13, "build-step-2", ["en", "ar", "phone"]);
  await clickAndLoad('button[data-approve="02-submitter-screen"]');
  check("step 2 approved; the app is being built for the preview", path() === `/projects/${id}/preview`, path());

  // 8. The preview: screenshots of the running app, taken by the app camera.
  const shots = await waitFor("[data-shots]", 1_800_000, "main p.warn");
  if (!check("the preview's screenshots are there", shots, await text("main"))) return stopped(14, "preview", id);
  const loaded = await page.$$eval("[data-shots] img", (imgs) => imgs.map((i) => i.complete && i.naturalWidth > 0));
  check("four screenshots of the running app, each loaded", loaded.length === 4 && loaded.every(Boolean), JSON.stringify(loaded));
  check("each is captioned 'Not live. Sample data.'", (await page.locator("figcaption", { hasText: "Not live. Sample data." }).count()) === 4);
  // Package 0.6c: the app is reached only at http://app:3161, from containers on the project's front network.
  const previewLines = await text("details ol.lines");
  check("the preview: before the app started, nothing answered at http://app:3161, asked from a container on the project's front network", previewLines.includes("Before the app was started, nothing answered at http://app:3161, asked from a container on the project's front network"), previewLines);
  check("the app camera signed in at http://app:3161, the app's address on the project's front network", previewLines.includes('app camera: {"kind":"signed_in","at":"http://app:3161"'), previewLines);
  await photo(14, "preview", ["en"]);

  // 9. The checklist: run it; item 1 passed, items 2 to 6 did not run; the stand-in label; sign off.
  await clickAndLoad('a[data-go="acceptance"]');
  await photo(15, "checklist-before-run", ["en"]);
  await clickAndLoad(`form[action="/projects/${id}/acceptance"] button`);
  const ran = await waitFor("table[data-run]", 900_000);
  if (!check("the checklist ran", ran, await text("main"))) return stopped(16, "checklist", id);
  check("item 1 passed", await has('tr[data-item="1"][data-status="passed"]'));
  let notRun = 0;
  for (const n of [2, 3, 4, 5, 6]) if (await has(`tr[data-item="${n}"][data-status="did not run"]`)) notRun++;
  check("items 2 to 6: did not run (no test written yet)", notRun === 5 && (await page.locator("tr[data-item]", { hasText: "No test written yet: did not run." }).count()) === 5);
  check("labelled 'stand-in test, not independent acceptance'", (await text("[data-label]")) === "stand-in test, not independent acceptance", await text("[data-label]"));
  check("the summary as the runner's reading wrote it", (await text("[data-summary]")) === "version passed; checklist incomplete (5 of the app spec's 6 checklist items have no test)", await text("[data-summary]"));
  // Package 3.1b: the outcome word, read from the run's own acceptance.run.finished event, not from the summary.
  check("the outcome word, as the run's record gives it: Passed", (await text('table[data-run] [data-outcome="passed"]')) === "Passed" && (await page.locator('[data-outcome]:not([data-outcome="passed"])').count()) === 0, await text("table[data-run]"));
  const itemShot = await page.$$eval('tr[data-item="1"] img', (imgs) => imgs.map((i) => i.complete && i.naturalWidth > 0));
  check("item 1's screenshot, taken by the runner, is shown", itemShot.length === 1 && itemShot[0], JSON.stringify(itemShot));
  await photo(16, "checklist", ["en", "ar", "phone"]);
  await clickAndLoad(`form[action="/projects/${id}/sign-off"] button`);
  check("signed off, labelled as a sign-off on a simulated build", (await has("[data-signed-off]")) && (await text("[data-sign-off-label]")) === "Sign-off on a simulated build, checked by a stand-in test of item 1 only: not acceptance");
  await photo(17, "signed-off", ["en"]);

  // 10. Cost: $0.00 spent, no freeze, an empty unreconciled list, the two reservations closed.
  await page.goto(`${BASE}/projects/${id}/cost`);
  check("cost: $0.00 spent, with its sentence", (await text("td[data-spent]")) === "$0.00" && (await has("[data-zero]")), await text("td[data-spent]"));
  check("cost: no freeze", await has("[data-no-freeze]"));
  check("cost: the unreconciled list is empty", await has("[data-unreconciled-empty]"));
  const holds = await text("table[data-step-holds]");
  check("cost: the two step reservations, $1.5552 and $3.1104, closed", holds.includes("$1.5552") && holds.includes("$3.1104") && (holds.match(/closed/g) ?? []).length === 2, holds);
  await photo(18, "cost", ["en", "ar", "phone"]);

  // 11. Export, offered after sign-off; download it.
  await page.goto(`${BASE}/projects/${id}/export`);
  check("the export is labelled internal only and not yet shown to start without the builder", (await text("[data-export-label]")).startsWith("Internal only, not for customers. Not yet shown to start without the builder (package 3.2)"));
  await photo(19, "export-before", ["en"]);
  await clickAndLoad(`form[action="/projects/${id}/export"] button`);
  const exported = await waitFor("a[data-download]", 600_000);
  if (!check("the export is written", exported, await text("main"))) return stopped(20, "export", id);
  await photo(20, "export", ["en"]);
  const shown = await text("table[data-export] code");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("a[data-download]").click()]);
  await download.saveAs("/shots/export.tar.gz");
  const body = readFileSync("/shots/export.tar.gz");
  const got = createHash("sha256").update(body).digest("hex");
  say({ kind: "export_downloaded", file: download.suggestedFilename(), bytes: body.length, sha256: got });
  check("the downloaded export has the SHA-256 the page shows", got === shown, `${got} / ${shown}`);

  // 12. The record: every event, in id order.
  await page.goto(`${BASE}/projects/${id}/record`);
  const ids = await page.$$eval("tr[data-event]", (rows) => rows.map((r) => Number(r.getAttribute("data-event"))));
  check("the record lists every event in id order", ids.length > 50 && ids.every((v, i) => i === 0 || v > ids[i - 1]), `${ids.length} events`);
  say({ kind: "record", project: id, events: ids.length });
  await photo(21, "record", ["en"]);
  await clickAndLoad(`form[action="/projects/${id}/close"] button`);
  check("the project is closed: its containers, images and folder removed", await has("[data-closed]"));
  await photo(22, "closed", ["en"]);

  // 13. A second project, capped at $1.00: step 1 is refused.
  await page.goto(`${BASE}/projects/new`);
  await page.fill("#name", "Leave requests, $1.00 cap (made-up)");
  await page.fill("#cap", "1.00");
  await page.fill("#brief", ASK);
  await clickAndLoad('form[action="/projects"] button[type="submit"]');
  const m2 = /^\/projects\/(j1-[0-9a-f]{12})\/brief$/.exec(path());
  if (!check("the second project is made", m2, path())) return;
  const id2 = m2[1];
  say({ kind: "project", id: id2, name: "Leave requests, $1.00 cap (made-up)", cap: "1.00" });
  await clickAndLoad(`form[action="/projects/${id2}/continue"] button`);
  await clickAndLoad(`form[action="/projects/${id2}/answer-rest"] button`);
  await clickAndLoad(`a[href="/projects/${id2}/proposal"]`);
  await clickAndLoad(`form[action="/projects/${id2}/confirm-brief"] button`);
  await clickAndLoad(`form[action="/projects/${id2}/confirm-plan"] button`);
  await clickAndLoad('a[data-go="build"]');
  await clickAndLoad('button[data-build="01-data"]');
  const refused = await waitFor('[data-step="01-data"][data-step-state="failed"] [data-refused]', 300_000);
  const why = await text("[data-refused]");
  check(
    "a project capped at $1.00: step 1 refused with package 1.3's message and the sentence under it",
    refused && /This step needs up to \$1\.56 to finish \(4 turns\); this project has \$1\.00 left of its budget of \$1\.00/.test(why) && why.includes("Scripted steps spend $0; this is a reservation sized from a real model's price."),
    why,
  );
  await photo(23, "refused", ["en", "ar"]);
  await page.goto(`${BASE}/projects/${id2}/record`);
  await clickAndLoad(`form[action="/projects/${id2}/close"] button`);
  check("the second project is closed", await has("[data-closed]"));
  await page.goto(`${BASE}/projects`);
  await photo(24, "projects-end", ["en"]);

  // 14. Sign out.
  await clickAndLoad('form[action="/sign-out"] button');
  check("signed out", path() === "/sign-in" && (await text("main")).includes("You are signed out."), path());
}

/**
 * Package J3's walk (BUILDER_CAMERA_WALK=j3): the journey to the preview, then "Open the live app" and "Show" as the
 * owner would. The pass and the sample password are read from the page and written, each as a read-only file, into
 * /shots (pass-1, sample-password) for the automated run to hand to the live camera; both are masked in every
 * photograph. Then it waits for /shots/live-done (the live camera has walked the app), photographs the preview screen,
 * runs the checklist (which ends the live session first, and says the app was used live), and closes the project.
 */
async function runJ3() {
  await page.goto(`${BASE}/sign-in`);
  await page.fill("#password", password);
  await clickAndLoad('form[action="/sign-in"] button[type="submit"]');
  check("signed in, at the projects page", path() === "/projects", path());
  await clickAndLoad('a[href="/projects/new"]');
  await page.fill("#name", "Leave requests (made-up, J3 live)");
  await page.fill("#cap", "5.00");
  await page.fill("#brief", ASK);
  await clickAndLoad('form[action="/projects"] button[type="submit"]');
  const m = /^\/projects\/(j1-[0-9a-f]{12})\/brief$/.exec(path());
  if (!check("the project is made", m, path())) return;
  const id = m[1];
  say({ kind: "project", id, name: "Leave requests (made-up, J3 live)", cap: "5.00" });
  for (const a of ["continue", "answer-rest"]) await clickAndLoad(`form[action="/projects/${id}/${a}"] button`);
  await clickAndLoad(`a[href="/projects/${id}/proposal"]`);
  await clickAndLoad(`form[action="/projects/${id}/confirm-brief"] button`);
  await clickAndLoad(`form[action="/projects/${id}/confirm-plan"] button`);
  await clickAndLoad('a[data-go="build"]');
  await clickAndLoad('button[data-build="01-data"]');
  if (!check("step 1 built", await waitFor('[data-step="01-data"][data-step-state="finished"]', 600_000, '[data-step="01-data"][data-step-state="failed"]'))) return;
  await clickAndLoad('button[data-approve="01-data"]');
  if (!check("step 2 built", await waitFor('[data-step="02-submitter-screen"][data-step-state="finished"]', 600_000, '[data-step="02-submitter-screen"][data-step-state="failed"]'))) return;
  await clickAndLoad('button[data-approve="02-submitter-screen"]');
  if (!check("the preview is made: the app runs", await waitFor("[data-shots]", 1_800_000, "main p.warn"), await text("main"))) return;
  check("the live app's panel, labelled: simulated build, made-up data, not yet approved for use", (await has("[data-live-open]")) && (await text("[data-live-label]")) === "Simulated build: scripted engine, sample data" && (await text("[data-live-data-label]")) === "Made-up data only. No customer or personal details. Removed when the project closes." && (await has("[data-live-not-approved]")), await text("main"));
  await photo(1, "preview-live-panel", ["en", "ar", "phone"]);

  // "Open the live app": the pass, shown once, masked in the photograph, written for the live camera.
  await clickAndLoad("button[data-live-open]");
  const pass = (await text("[data-pass] code")).trim();
  if (!check("the pass is shown once, on the POST's answer", /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(pass), "not shown")) return;
  await page.screenshot({ path: "/shots/02-live-pass-en.png", fullPage: true, mask: [page.locator("[data-pass]")] });
  say({ kind: "shot", file: "02-live-pass-en.png", path: path(), lang: "en", width: 1280 });
  writeFileSync("/shots/pass-1", pass, { mode: 0o400 });
  await clickAndLoad("button[data-live-show]");
  const sample = (await text("[data-sample-password]")).trim();
  check("Show gives the made-up employee's sign-in", (await text("[data-sample-email]")) === "employee@example.test" && sample.length >= 12, await text("[data-sample-email]"));
  await page.screenshot({ path: "/shots/03-live-sample-sign-in-en.png", fullPage: true, mask: [page.locator("[data-sample-password]")] });
  say({ kind: "shot", file: "03-live-sample-sign-in-en.png", path: path(), lang: "en", width: 1280 });
  writeFileSync("/shots/sample-password", sample, { mode: 0o400 });
  say({ kind: "live_ready" });

  // The automated run's live camera walks the app; this camera waits for it to finish.
  const end = Date.now() + 600_000;
  while (!existsSync("/shots/live-done") && Date.now() < end) await page.waitForTimeout(1000);
  check("the live camera finished its walk", existsSync("/shots/live-done"), "no /shots/live-done after 10 minutes");
  await page.goto(`${BASE}/projects/${id}/preview`);
  check("the preview screen says the last live session closed when the owner left", (await page.locator('[data-live-closed="leave"]').count()) > 0, await text("main"));
  await photo(4, "preview-after-live", ["en", "ar"]);

  // The checklist ends a live session first, and its record says the app was used live.
  await clickAndLoad(`button[data-live-open]`);
  check("a second pass is shown", /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test((await text("[data-pass] code")).trim()));
  await page.goto(`${BASE}/projects/${id}/acceptance`);
  await clickAndLoad(`form[action="/projects/${id}/acceptance"] button`);
  if (!check("the checklist ran", await waitFor("table[data-run]", 900_000), await text("main"))) return;
  check("the checklist's screen says the app was used live and its data changed", (await text("[data-used-live]")) === "The app was used live before this run; its data changed.", await text("main"));
  await photo(5, "checklist-after-live", ["en", "ar"]);
  await page.goto(`${BASE}/projects/${id}/preview`);
  check("the open pass was ended by the checklist", (await page.locator('[data-live-closed="checklist"]').count()) > 0, await text("main"));
  await page.goto(`${BASE}/projects/${id}/record`);
  const record = await text("main");
  check("the record holds live_opened, live_entered and live_closed", ["journey.preview.live_opened", "journey.preview.live_entered", "journey.preview.live_closed"].every((k) => record.includes(k)), "");
  await photo(6, "record", ["en"]);
  await clickAndLoad(`form[action="/projects/${id}/close"] button`);
  check("the project is closed: its containers, images and folder removed", await has("[data-closed]"));
  await clickAndLoad('form[action="/sign-out"] button');
  check("signed out", path() === "/sign-in", path());
}

try {
  if ((process.env.BUILDER_CAMERA_WALK ?? "j1") === "j3") await runJ3();
  else await run();
} catch (err) {
  check("the walk ran to its end without an error", false, String(err && err.message ? err.message : err).split("\n")[0]);
} finally {
  check(`nothing but ${BASE.slice("http://".length)} was loaded`, outside.length === 0, outside.slice(0, 3).join(" "));
  await context.close();
  await browser.close();
}
say({ kind: "done", failed });
process.exit(failed === 0 ? 0 : 1);
