/**
 * Screenshots of the app the scripted engine built for example 1 (package 2.1), as a person would see it.
 * Usage: npx tsx scripts/screenshot-scripted.ts <baseUrl> <outDir> <samplePassword>
 *
 * Signed in as the sample employee: My requests, empty; the new-request form refusing a wrong value;
 * a five-day request (Monday 3 to Friday 7 May 2027, a made-up week) filled in and sent; My requests
 * showing it as waiting, in English, in Arabic, and at a phone's width. Each line printed is a check
 * with what was expected and what was seen; the exit code is 1 if any check failed.
 *
 * The browser runs on the machine that hosts the builder, as the earlier screenshot scripts do; the
 * app runs in its container. The acceptance runner of package 3.1 runs in a container of its own.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

const [baseUrl, outDir, password] = process.argv.slice(2);
if (!baseUrl || !outDir || !password) {
  console.error("usage: screenshot-scripted.ts <baseUrl> <outDir> <samplePassword>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

let failed = 0;
const check = (what: string, expected: string, seen: string) => {
  const ok = expected === seen;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}: expected ${expected}; saw ${seen}`);
};
const shot = (page: Page, name: string) => page.screenshot({ path: join(outDir, name), fullPage: true });
const banner = async (page: Page) => ((await page.getByRole("note").textContent()) ?? "").trim();

const browser = await chromium.launch();
try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await desktop.newPage();

  await page.goto(`${baseUrl}/en/sign-in`, { waitUntil: "networkidle" });
  await page.fill("#email", "employee@example.test");
  await page.fill("#password", password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/en\/home/, { timeout: 30_000 });
  check("banner (English) names the scripted engine", "true", String((await banner(page)).includes("Built by the scripted engine: fixed changes, no AI model.")));
  await shot(page, "01-scripted-home-employee-en.png");

  await page.getByTestId("my-requests-link").click();
  await page.waitForURL(/\/en\/my-requests$/, { timeout: 30_000 });
  await page.getByTestId("my-requests").waitFor();
  check("My requests before any request: requests listed", "0", String(await page.getByTestId("leave-request").count()));
  check("My requests before any request: empty state", "You have no leave requests yet", ((await page.getByRole("heading", { level: 2 }).first().textContent()) ?? "").trim());
  await shot(page, "02-scripted-my-requests-empty-en.png");

  await page.getByTestId("new-request-link").click();
  await page.waitForURL(/\/en\/my-requests\/new$/, { timeout: 30_000 });
  // A wrong value: nine working days between a Monday and the Friday of the same week.
  await page.fill("#startDate", "2027-05-03");
  await page.fill("#endDate", "2027-05-07");
  await page.fill("#days", "9");
  await page.getByRole("button", { name: "Submit" }).click();
  const alert = page.locator('form [role="alert"]').filter({ hasText: /\S/ });
  await alert.first().waitFor({ timeout: 30_000 });
  check(
    "form refuses 9 working days from Monday 3 to Friday 7 May 2027",
    "Working days requested cannot be more than 5, the number of calendar days from the first day of leave to the last.",
    (await alert.allTextContents()).join(" | "),
  );
  check("nothing was sent: still on the form", "/en/my-requests/new", new URL(page.url()).pathname);
  await shot(page, "03-scripted-form-error-en.png");

  await page.fill("#days", "5");
  await page.fill("#reason", "Made-up family visit.");
  await shot(page, "04-scripted-form-five-days-en.png");
  await page.getByRole("button", { name: "Submit" }).click();
  await page.waitForURL(/\/en\/my-requests\?sent=1$/, { timeout: 30_000 });
  await page.getByTestId("leave-request").first().waitFor();
  const rows = page.getByTestId("leave-request");
  check("My requests after sending: requests listed", "1", String(await rows.count()));
  check("the request's status, as stored", "waiting", (await rows.first().getAttribute("data-status")) ?? "");
  check("the request's status, as shown (English)", "Waiting", ((await page.getByTestId("leave-request-status").first().textContent()) ?? "").trim());
  console.log(`      (the request as listed: ${((await rows.first().innerText()) ?? "").replace(/\s*\n\s*/g, " / ")})`);
  check("the confirmation", "Your request was saved. Its status is Waiting.", ((await page.getByTestId("request-sent").textContent()) ?? "").trim());
  await shot(page, "05-scripted-my-requests-waiting-en.png");

  await page.goto(`${baseUrl}/ar/my-requests`, { waitUntil: "networkidle" });
  await page.getByTestId("leave-request").first().waitFor();
  check("My requests in Arabic: direction of the page", "rtl", (await page.getAttribute("html", "dir")) ?? "");
  check("the request's status, as shown (Arabic)", "قيد الانتظار", ((await page.getByTestId("leave-request-status").first().textContent()) ?? "").trim());
  check("banner (Arabic) names the scripted engine", "true", String((await banner(page)).includes("بناه المحرّك المُبرمَج مسبقاً")));
  await shot(page, "06-scripted-my-requests-waiting-ar.png");

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, storageState: await desktop.storageState() });
  const p = await phone.newPage();
  await p.goto(`${baseUrl}/ar/my-requests`, { waitUntil: "networkidle" });
  await p.getByTestId("leave-request").first().waitFor();
  check("My requests at phone width 390, Arabic: no sideways scrolling", "true", String((await p.evaluate(() => document.documentElement.scrollWidth)) <= 390));
  await p.screenshot({ path: join(outDir, "07-scripted-my-requests-waiting-ar-phone.png"), fullPage: true });
  await p.goto(`${baseUrl}/en/my-requests`, { waitUntil: "networkidle" });
  await p.getByTestId("leave-request").first().waitFor();
  check("My requests at phone width 390, English: no sideways scrolling", "true", String((await p.evaluate(() => document.documentElement.scrollWidth)) <= 390));
  await p.screenshot({ path: join(outDir, "08-scripted-my-requests-waiting-en-phone.png"), fullPage: true });
  await phone.close();
  await desktop.close();
} catch (err) {
  failed++;
  console.log(`FAIL  the run stopped: ${(err as Error).message}`);
} finally {
  await browser.close();
}
console.log(`\n${failed === 0 ? "RESULT: PASSED" : `RESULT: FAILED (${failed})`}`);
process.exit(failed === 0 ? 0 : 1);
