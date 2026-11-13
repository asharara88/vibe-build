// Package 0.6c, first step: a throwaway measurement (not part of the builder). The same flag as item 02, with a
// persistent profile folder (Chromium's documentation of the flag has asked for --user-data-dir in the past).
import { mkdtempSync } from "node:fs";
import { chromium, test } from "@playwright/test";

test("5. with the flag and a persistent profile: isSecureContext and crypto.subtle", async ({ baseURL }) => {
  const ctx = await chromium.launchPersistentContext(mkdtempSync("/tmp/m06c-profile-"), { args: ["--unsafely-treat-insecure-origin-as-secure=http://app:3000"] });
  const page = await ctx.newPage();
  await page.goto(`${baseURL}/en/sign-in`);
  console.log(`M06C flag + persistent profile: isSecureContext: ${JSON.stringify(await page.evaluate(() => window.isSecureContext))}`);
  console.log(`M06C flag + persistent profile: crypto.subtle: ${JSON.stringify(await page.evaluate(() => typeof (globalThis.crypto as Crypto | undefined)?.subtle))}`);
  await ctx.close();
});
