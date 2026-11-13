/**
 * Take screenshots of a running template or app for the evidence folder, as a person would see it.
 * Pages: sign-in (en, ar), home after signing in as the employee (en, ar), phone-width sign-in.
 *
 * It runs only inside the project's acceptance runner container, on the project's `front` network, never on
 * the machine (package 0.6c): scripts/browser-in-project.ts starts it there with
 * <baseUrl> <outDir> <samplePasswordFile>, the base address being http://app:<port>.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [baseUrl, outDir, passwordFile] = process.argv.slice(2);
if (!baseUrl || !outDir || !passwordFile) {
  console.error("usage: screenshot.ts <baseUrl> <outDir> <samplePasswordFile>");
  process.exit(1);
}
const password = readFileSync(passwordFile, "utf8").trim();
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const results: string[] = [];
try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await desktop.newPage();

  await page.goto(`${baseUrl}/en/sign-in`, { waitUntil: "networkidle" });
  await page.screenshot({ path: join(outDir, "01-sign-in-en.png"), fullPage: true });
  results.push(`sign-in (English): title "${await page.title()}", dir=${await page.getAttribute("html", "dir")}`);

  await page.goto(`${baseUrl}/ar/sign-in`, { waitUntil: "networkidle" });
  await page.screenshot({ path: join(outDir, "02-sign-in-ar.png"), fullPage: true });
  results.push(`sign-in (Arabic): title "${await page.title()}", dir=${await page.getAttribute("html", "dir")}`);

  // Rule 1 evidence: submit an empty form and capture the plain-words messages.
  await page.goto(`${baseUrl}/en/sign-in`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Sign in" }).click();
  const alerts = page.locator('form [role="alert"]').filter({ hasText: /\S/ });
  await alerts.first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: join(outDir, "03-sign-in-validation-en.png"), fullPage: true });
  results.push(`validation messages shown: ${(await alerts.allTextContents()).join(" | ")}`);

  // Sign in as the sample employee and reach home.
  await page.fill("#email", "employee@example.test");
  await page.fill("#password", password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/en\/home/, { timeout: 30_000 });
  await page.getByTestId("signed-in-as").waitFor();
  await page.screenshot({ path: join(outDir, "04-home-en.png"), fullPage: true });
  results.push(`home (English): ${await page.getByTestId("signed-in-as").textContent()}`);

  await page.goto(`${baseUrl}/ar/home`, { waitUntil: "networkidle" });
  await page.getByTestId("signed-in-as").waitFor();
  await page.screenshot({ path: join(outDir, "05-home-ar.png"), fullPage: true });
  results.push(`home (Arabic): ${await page.getByTestId("signed-in-as").textContent()}, dir=${await page.getAttribute("html", "dir")}`);

  // Wrong password: rule 3 evidence.
  await page.goto(`${baseUrl}/en/sign-in`, { waitUntil: "networkidle" });
  await page.fill("#email", "employee@example.test");
  await page.fill("#password", "definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  const formAlert = page.locator('form [role="alert"]').filter({ hasText: /\S/ });
  await formAlert.first().waitFor({ timeout: 30_000 });
  results.push(`wrong password message: ${(await formAlert.allTextContents()).join(" | ")}`);
  await page.screenshot({ path: join(outDir, "06-sign-in-wrong-password-en.png"), fullPage: true });
  await desktop.close();

  // Rule 10: a phone screen.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const p = await phone.newPage();
  await p.goto(`${baseUrl}/ar/sign-in`, { waitUntil: "networkidle" });
  await p.screenshot({ path: join(outDir, "07-sign-in-ar-phone.png"), fullPage: true });
  const scrollWidth = await p.evaluate(() => document.documentElement.scrollWidth);
  results.push(`phone width 390: page scroll width ${scrollWidth} (no sideways scrolling when 390)`);
  await phone.close();
} finally {
  await browser.close();
}
for (const r of results) console.log(r);
