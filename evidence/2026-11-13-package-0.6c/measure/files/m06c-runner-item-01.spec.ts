// Package 0.6c, first step: a throwaway measurement run in the acceptance runner's image, on the
// project's `front` network only, with BASE_URL http://app:3000 and the app's APP_URL http://app:3000.
// Not a stand-in test and not part of the builder. It prints facts (cookie names and flags, never values).
import { lookup } from "node:dns/promises";
import { writeFileSync } from "node:fs";
import { expect, test as base } from "@playwright/test";

const test = base.extend<{ samplePassword: string; runId: string }>({
  samplePassword: ["", { option: true }],
  runId: ["", { option: true }],
});
const facts: Record<string, unknown> = {};
const note = (k: string, v: unknown) => { facts[k] = v; console.log(`M06C ${k}: ${JSON.stringify(v)}`); };

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/en/sign-in");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.afterAll(async ({}, testInfo) => { writeFileSync(`/results/m06c-facts-worker-${testInfo.workerIndex}.json`, JSON.stringify(facts, null, 2)); });

test("1. employee: sign-in, cookies, reload, a refused page, sign-out, at http://app:3000", async ({ page, context, samplePassword, baseURL }, testInfo) => {
  note("baseURL", baseURL);
  await page.goto("/en/sign-in");
  note("sign-in page isSecureContext", await page.evaluate(() => window.isSecureContext));
  note("sign-in page crypto.subtle", await page.evaluate(() => typeof (globalThis.crypto as Crypto | undefined)?.subtle));
  await signIn(page, "employee@example.test", samplePassword);
  await page.waitForURL(/\/en\/home$/);
  note("after sign-in", page.url());
  note("cookies (no values)", (await context.cookies()).map((c) => ({ name: c.name, domain: c.domain, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite })));
  await page.screenshot({ path: testInfo.outputPath("employee-home.png"), fullPage: true });
  await page.reload();
  note("after reload", page.url());
  await page.goto("/en/example/restricted");
  note("employee opens the HR-admin-only page, lands on", page.url());
  await page.goto("/en/home");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/en\/sign-in$/);
  note("after sign-out", page.url());
  await page.goto("/en/home");
  note("home after sign-out, lands on", page.url());
  expect(page.url()).toMatch(/\/en\/sign-in/);
});

test("2. manager: a form action (server action) at http://app:3000", async ({ page, samplePassword }, testInfo) => {
  await signIn(page, "manager@example.test", samplePassword);
  await page.waitForURL(/\/en\/home$/);
  await page.goto("/en/example/action");
  await page.getByRole("button", { name: "Run the example action" }).click();
  await expect(page.getByTestId("example-action-done")).toBeVisible();
  note("manager's form action: done message shown at", page.url());
  await page.screenshot({ path: testInfo.outputPath("manager-action-done.png"), fullPage: true });
});

test("3. control: the same sign-in at the app's own address (not the origin APP_URL names) is refused", async ({ page, samplePassword }) => {
  const ip = (await lookup("app")).address;
  const other = `http://${ip}:3000`;
  note("control origin", other);
  const answers: number[] = [];
  page.on("response", (r) => { if (r.url().includes("/api/auth/sign-in")) answers.push(r.status()); });
  await page.goto(`${other}/en/sign-in`);
  await page.fill("#email", "employee@example.test");
  await page.fill("#password", samplePassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForTimeout(3000);
  note("control: sign-in answers (HTTP status)", answers);
  note("control: page after sign-in attempt", page.url());
  expect(page.url()).not.toMatch(/\/en\/home$/);
});
