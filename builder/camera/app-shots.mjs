// The app camera (package J1; final design, section 5). Runs only in the approved runner image, in the project's
// own `acceptance` service (builder/src/orchestrator/example-1-adapter.ts): the image's unprivileged user, a
// read-only root, this script read-only at /camera, one output folder at /shots, and the sample user's password
// as one read-only file at /run/secrets/sample-password. Its one setting is BASE_URL, the app's address.
//
// It signs in as the made-up sample employee and photographs four pages of the running app, in English and
// Arabic. No video is recorded and no trace is kept: the browser context is made with neither, and nothing here
// asks for one (the owner's answer to question A, 13 Nov 2026: the approved browser, no video, no trace).
// The password is read from its file and typed into the app's sign-in form; it is never printed.
// It prints one JSON line per photograph, then a last line; the builder reads only the files it expects.
import { readFileSync } from "node:fs";
import { chromium } from "/runner/node_modules/playwright-core/index.mjs";

const base = process.env.BASE_URL;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) {
  console.log(JSON.stringify({ kind: "error", reason: "BASE_URL is not the app's address on 127.0.0.1" }));
  process.exit(2);
}
const password = readFileSync("/run/secrets/sample-password", "utf8").trim();
const SHOTS = [
  { name: "app-home-en", page: "/en/home" },
  { name: "app-my-requests-en", page: "/en/my-requests" },
  { name: "app-home-ar", page: "/ar/home" },
  { name: "app-my-requests-ar", page: "/ar/my-requests" },
];

const browser = await chromium.launch();
let code = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: base });
  const page = await context.newPage();
  await page.goto("/en/sign-in");
  await page.fill("#email", "employee@example.test");
  await page.fill("#password", password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/en\/home$/, { timeout: 30_000 });
  console.log(JSON.stringify({ kind: "signed_in", as: "employee@example.test (made-up sample user)" }));
  for (const s of SHOTS) {
    await page.goto(s.page);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `/shots/${s.name}.png`, fullPage: true });
    console.log(JSON.stringify({ kind: "shot", name: s.name, page: s.page, url_path: new URL(page.url()).pathname }));
  }
  await context.close();
} catch (err) {
  code = 1;
  console.log(JSON.stringify({ kind: "error", reason: String(err && err.message ? err.message : err).split("\n")[0].slice(0, 300) }));
} finally {
  await browser.close();
}
console.log(JSON.stringify({ kind: "done", code }));
process.exit(code);
