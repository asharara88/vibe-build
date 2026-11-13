// The acceptance runner's own configuration (package 3.1; design: docs/design/package-3.1.md,
// section 4). It is baked into the runner image and is never taken from the test folder.
//
// What the runner sees: /acceptance, one version of a project's tests, read-only; /results, a fresh
// run folder; /run/secrets/sample-password, one file. Settings: BASE_URL and RUN_ID only.
//
// This configuration is no defence against a test written to cheat: a test file can change its own
// settings (test.describe.configure), mark itself as expected to fail (test.fail()), or write into
// /results. The builder does not trust what this run reports: it reads the results file under its own
// rules (builder/src/acceptance/results.ts).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// The fingerprint of the version's manifest, so that the results say which version they are for.
const manifestSha256 = createHash("sha256").update(readFileSync("/acceptance/manifest.json")).digest("hex");

export default {
  testDir: "/acceptance",
  testMatch: /\/item-\d{2}\.spec\.ts$/,
  outputDir: "/results/test-results",
  preserveOutput: "always",
  retries: 0,
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["line"], ["json", { outputFile: "/results/results.json" }]],
  metadata: { runId: process.env.RUN_ID ?? "", manifestSha256 },
  use: {
    baseURL: process.env.BASE_URL,
    trace: "on",
    screenshot: "on",
    // No video is played or recorded in the acceptance runs (the owner's approval of the browser, 13 Nov 2026).
    video: "off",
    viewport: { width: 1280, height: 800 },
    // The two options the tests declare: the sample user's password, from the one secret file, and
    // the run's id. The tests name neither a path nor an address of the runner.
    samplePassword: readFileSync("/run/secrets/sample-password", "utf8").trim(),
    runId: process.env.RUN_ID ?? "",
  },
};
