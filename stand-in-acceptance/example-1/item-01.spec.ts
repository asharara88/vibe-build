// Stand-in acceptance test, written in advance by Claude Code (the AI assistant building this project), not by the builder's acceptance writer. No model call by the builder.
// Label: stand-in test. Example 1, acceptance item 1. Version marker: __VERSION_MARKER__
// Allowed only to develop and test the acceptance runner (package 3.1), by the owner's answer to question 12, option (a), 13 Nov 2026.
// It shows that the tests are kept apart from the engine; it is not independent acceptance (design note 2.7, amendment of 13 Nov 2026).
// It was written by the same author as the scripted app's changes, knowing the app: for example, it finds the request by its reason, which the app lists.
//
// Item 1 of example 1's app spec: an employee signs in and submits a request for five working days, and sees
// the request in My requests with status waiting. It names no path or address of the runner: the app's address
// is Playwright's baseURL, and the sample password and the run's id are two options the configuration sets.
import { expect, test as base } from "@playwright/test";

const test = base.extend<{ samplePassword: string; runId: string }>({
  samplePassword: ["", { option: true }],
  runId: ["", { option: true }],
});

test("item 1 (stand-in test): an employee signs in, submits a five-day request, and sees it in their list with status waiting", async ({ page, samplePassword, runId }, testInfo) => {
  // A reason unique to this run, so that the request this run sends is the one it looks for.
  const reason = `Made-up family visit, stand-in test run ${runId}.`;

  await test.step("signs in as the sample employee", async () => {
    await page.goto("/en/sign-in");
    await page.fill("#email", "employee@example.test");
    await page.fill("#password", samplePassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/en\/home$/);
  });

  await test.step("opens My requests, then New leave request", async () => {
    await page.getByTestId("my-requests-link").click();
    await page.waitForURL(/\/en\/my-requests$/);
    await page.getByTestId("new-request-link").click();
    await page.waitForURL(/\/en\/my-requests\/new$/);
  });

  await test.step("fills in Monday 3 May 2027 to Friday 7 May 2027, 5 working days, and this run's reason", async () => {
    await page.fill("#startDate", "2027-05-03");
    await page.fill("#endDate", "2027-05-07");
    await page.fill("#days", "5");
    await page.fill("#reason", reason);
  });

  await test.step("submits the request", async () => {
    await page.getByRole("button", { name: "Submit" }).click();
    await page.waitForURL(/\/en\/my-requests\?sent=1$/);
  });

  // The list item itself, not the confirmation above the list, which says "Waiting" whatever was stored.
  const item = page.getByTestId("leave-request").filter({ hasText: reason });

  await test.step("finds the request in My requests by this run's reason", async () => {
    await expect(item).toHaveCount(1);
  });

  await test.step("sees status waiting", async () => {
    await expect(item).toContainText(/waiting/i);
    await expect(item).not.toContainText(/approved|rejected|withdrawn/i);
  });

  await test.step("takes a full-page screenshot", async () => {
    const path = testInfo.outputPath("item-01-stand-in-test.png");
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach("item-screenshot", { path, contentType: "image/png" });
  });
});
