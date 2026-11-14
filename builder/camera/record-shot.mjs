// The run's record camera (package 3.2; docs/design/package-3.2.md, section 7, "Pictures"). It photographs one page
// that the automated run (builder/scripts/demo-export.ts) wrote from its own files: the check's reading
// (check-reading.json) and the stop record. The page is not a screen of the builder or of the app, and says so.
//
// Runs only in the approved runner image, in a container of its own started by the automated run, with no network
// (`--network none`): the image's unprivileged user, a read-only root, every capability dropped, this script read-only
// at /camera, the page read-only at /record/page.html, and one output folder at /shots. The page is set as the
// browser's content with JavaScript off; any request it would make is refused and counted. No video is recorded and
// no trace is kept. BUILDER_CAMERA_SHOT names the picture (NN-<screen>-en.png), checked against a fixed pattern first.
// Each thing it checks is printed as one JSON line ({"kind":"check",...}); it ends with exit code 0 only if every check
// passed.
import { readFileSync } from "node:fs";
import { chromium } from "/runner/node_modules/playwright-core/index.mjs";

const say = (o) => console.log(JSON.stringify(o));
let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  say({ kind: "check", name, ok: Boolean(ok), detail: String(detail).slice(0, 400) });
  return Boolean(ok);
}

const FILE = process.env.BUILDER_CAMERA_SHOT ?? "";
if (!/^\d{2}-[a-z0-9-]+-en\.png$/.test(FILE)) {
  check("the picture's name is NN-<screen>-en.png", false, "BUILDER_CAMERA_SHOT is not set as the automated run sets it");
  process.exit(1);
}

const html = readFileSync("/record/page.html", "utf8");
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: false });
const outside = [];
await context.route("**/*", (route) => {
  outside.push(route.request().url());
  return route.abort();
});
const page = await context.newPage();
try {
  await page.setContent(html, { waitUntil: "load" });
  const note = ((await page.locator("[data-drawn-from]").first().textContent().catch(() => null)) ?? "").replace(/\s+/g, " ").trim();
  check("the page says it is drawn from the run's own files, not a screen of the builder or the app", note.includes("drawn from the automated run's own files") && note.includes("not a screen of the builder or of the app"), note);
  const outcome = ((await page.locator("[data-outcome]").first().textContent().catch(() => null)) ?? "").trim();
  check("the page shows the check's outcome", outcome.length > 0, outcome);
  await page.screenshot({ path: `/shots/${FILE}`, fullPage: true });
  say({ kind: "shot", file: FILE, lang: "en", width: 1280 });
} catch (err) {
  check("the camera ran to its end without an error", false, String(err && err.message ? err.message : err).split("\n")[0]);
} finally {
  check("the page loaded nothing (no request left the page)", outside.length === 0, outside.slice(0, 3).join(" "));
  await context.close();
  await browser.close();
}
say({ kind: "done", failed });
process.exit(failed === 0 ? 0 : 1);
