// Package 0.6c, first step: a throwaway measurement (not part of the builder). Chromium's own flag that
// treats one plain-HTTP origin as secure, in case a page ever needs a secure context at http://app:3000.
import { test } from "@playwright/test";

test.use({ launchOptions: { args: ["--unsafely-treat-insecure-origin-as-secure=http://app:3000"] } });

test("4. with Chromium's flag for http://app:3000: isSecureContext and crypto.subtle", async ({ page }) => {
  await page.goto("/en/sign-in");
  console.log(`M06C with the flag: isSecureContext: ${JSON.stringify(await page.evaluate(() => window.isSecureContext))}`);
  console.log(`M06C with the flag: crypto.subtle: ${JSON.stringify(await page.evaluate(() => typeof (globalThis.crypto as Crypto | undefined)?.subtle))}`);
});
