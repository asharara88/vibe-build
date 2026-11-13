/**
 * Package 3.1b (the third outside review supplied by the owner, item 3): browser acceptance is required.
 * `npm test` is the gate, so it must not pass while the browser was not exercised:
 * - the live acceptance tests fail, never skip, when Docker does not answer or the approved browser zip is
 *   not in the folder BUILDER_BROWSER_CACHE names, and they say what is missing and how to put it right;
 * - no test in the suite can be skipped, marked to do, or singled out, and the test runner's settings
 *   neither pass an empty run nor leave files out.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { browserZipProblem, dockerProblem, liveAcceptanceProblems } from "../src/acceptance/prerequisites.js";
import { BROWSER_ZIP } from "../src/acceptance/runner-image.js";

const builderDir = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "builder-acceptance-gate-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
/** A Docker address where nothing listens (short: a socket's path has a length limit). */
const NO_DOCKER_HOST = "unix:///nonexistent-p31b/docker.sock";
const noDocker = () => ({ PATH: process.env.PATH ?? "/usr/bin:/bin", DOCKER_HOST: NO_DOCKER_HOST });

describe("the live acceptance tests' prerequisites, each named with how to put it right", () => {
  it("Docker: not answering, or not installed", async () => {
    expect(await dockerProblem(noDocker())).toMatch(/^Docker does not answer on this machine \(`docker info` failed: .*(?:failed to connect to the docker API|Cannot connect to the Docker daemon).*\)\. To put it right, start Docker as CLAUDE\.md, Commands, says \(in a cloud session: `nohup dockerd > \/tmp\/dockerd\.log 2>&1 &`\)\.$/);
    expect(await dockerProblem({ PATH: join(scratch, "no-programs-here") })).toMatch(/^Docker does not answer on this machine \(`docker info` failed: the docker program is not installed\)/);
  });

  it("the browser zip: the setting unset, a folder without the zip, another file, a link", async () => {
    const fix = /To put it right, .*from builder\/, run `BUILDER_BROWSER_CACHE=<a folder outside the repository> npx tsx scripts\/fetch-browser\.ts`, then run the tests with BUILDER_BROWSER_CACHE set to that folder; if the session's network refuses storage\.googleapis\.com, the owner's cloud environment must let that host through first/;
    const unset = await browserZipProblem({});
    expect(unset).toMatch(/^BUILDER_BROWSER_CACHE is not set, so the approved browser zip cannot be found\./);
    expect(unset).toMatch(fix);
    const empty = mkdtempSync(join(scratch, "cache-"));
    const none = await browserZipProblem({ BUILDER_BROWSER_CACHE: empty });
    expect(none).toMatch(new RegExp(`^The approved browser zip is not in the folder BUILDER_BROWSER_CACHE names: The browser cache has no ${BROWSER_ZIP.replace(/\./g, "\\.")}`));
    expect(none).toMatch(fix);
    writeFileSync(join(empty, BROWSER_ZIP), "made-up, not the browser");
    expect(await browserZipProblem({ BUILDER_BROWSER_CACHE: empty })).toMatch(/has SHA-256 [0-9a-f]{64}, not the approved .* To put it right, remove any other file of that name yourself, then from builder\//);
    const linked = mkdtempSync(join(scratch, "cache-"));
    symlinkSync(join(empty, BROWSER_ZIP), join(linked, BROWSER_ZIP));
    expect(await browserZipProblem({ BUILDER_BROWSER_CACHE: linked })).toMatch(/is not a plain file \(a link or a folder is not accepted\)\. To put it right/);
  });

  it("both missing: both are named", async () => {
    const found = await liveAcceptanceProblems(noDocker());
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/^Docker does not answer/);
    expect(found[1]).toMatch(/^BUILDER_BROWSER_CACHE is not set/);
  });
});

describe("the gate: npm test cannot pass while the browser was not exercised", () => {
  it("the live acceptance test file, run with the zip absent and Docker not answering, fails: all 7 of its tests, none skipped, each naming both and how to put them right", () => {
    const empty = mkdtempSync(join(scratch, "no-zip-"));
    const r = spawnSync(process.execPath, [join(builderDir, "node_modules", "vitest", "vitest.mjs"), "run", "test/acceptance-live.test.ts"], {
      cwd: builderDir,
      env: { ...process.env, ...noDocker(), BUILDER_BROWSER_CACHE: empty, NO_COLOR: "1", FORCE_COLOR: "0" },
      encoding: "utf8",
      timeout: 180_000,
    });
    const out = `${r.stdout}\n${r.stderr}`;
    expect(r.status, out.slice(-3000)).toBe(1);
    expect(out).toMatch(/Tests\s+7 failed \(7\)/);
    expect(out).not.toMatch(/\b\d+ (?:skipped|todo)\b/);
    expect(out).toContain("This live acceptance test cannot exercise the browser, so it fails (it is never skipped). Missing: Docker does not answer on this machine");
    expect(out).toContain(`The approved browser zip is not in the folder BUILDER_BROWSER_CACHE names: The browser cache has no ${BROWSER_ZIP}`);
    expect(out).toContain("nohup dockerd");
    expect(out).toContain("npx tsx scripts/fetch-browser.ts");
  }, 200_000);

  it("no test file can skip a test, mark one to do, run one alone or run one only if something holds; npm test runs the whole suite", () => {
    // The words are put together here so that this file, which is scanned too, does not hold them.
    const skip = ["sk", "ip"].join("");
    const words = [skip, `${skip}If`, ["run", "If"].join(""), ["to", "do"].join(""), ["on", "ly"].join("")];
    const byApi = new RegExp(`\\b(?:describe|it|test|suite|bench)(?:\\s*\\.\\s*\\w+)*\\s*\\.\\s*(?:${words.join("|")})\\b`);
    const byContext = new RegExp(`\\.\\s*${skip}\\s*\\(`);
    const testDir = join(builderDir, "test");
    const files = readdirSync(testDir).filter((f) => f.endsWith(".ts"));
    expect(files).toContain("acceptance-live.test.ts");
    expect(files).toContain("acceptance-gate.test.ts");
    const found: string[] = [];
    for (const f of files) {
      readFileSync(join(testDir, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (byApi.test(line) || byContext.test(line)) found.push(`test/${f}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(found).toEqual([]);
    const config = readFileSync(join(builderDir, "vitest.config.ts"), "utf8");
    for (const setting of ["passWithNoTests", ["allow", "Only"].join(""), "exclude", "include", "filter"]) expect(config, setting).not.toContain(setting);
    expect((JSON.parse(readFileSync(join(builderDir, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts.test).toBe("vitest run");
  });
});
