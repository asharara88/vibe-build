/**
 * Package 3.1b (the third outside review supplied by the owner, item 3): browser acceptance is required.
 * `npm test` is the gate, so it must not pass while the browser was not exercised:
 * - the live acceptance tests fail, never skip, when Docker does not answer or the approved browser zip is
 *   not in the folder BUILDER_BROWSER_CACHE names, and they say what is missing and how to put it right;
 * - no test in the suite can be skipped, marked to do, or singled out, and the test runner's settings
 *   neither pass an empty run nor leave files out.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { browserZipProblem, dockerProblem, liveAcceptanceProblems } from "../src/acceptance/prerequisites.js";
import { BROWSER_ZIP } from "../src/acceptance/runner-image.js";
import { runnerTestFiles, scanForLeftOutTests, scanRunnerSettings } from "./gate-scan.js";

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
    expect(none).not.toContain("remove what is at that place");
    writeFileSync(join(empty, BROWSER_ZIP), "made-up, not the browser");
    expect(await browserZipProblem({ BUILDER_BROWSER_CACHE: empty })).toMatch(/has SHA-256 [0-9a-f]{64}, not the approved .* To put it right, remove what is at that place yourself \(the fetch never replaces it\), then from builder\//);
    const linked = mkdtempSync(join(scratch, "cache-"));
    symlinkSync(join(empty, BROWSER_ZIP), join(linked, BROWSER_ZIP));
    expect(await browserZipProblem({ BUILDER_BROWSER_CACHE: linked })).toMatch(/is not a plain file \(a link or a folder is not accepted\)\. To put it right, remove what is at that place yourself/);
  });

  it("Docker's own message, when long, is cut at a word and marked with '…' (after the review: it was cut mid-word)", async () => {
    // A stand-in docker program that fails with a long message; made-up words, so where the cut falls is known.
    const bin = mkdtempSync(join(scratch, "stand-in-docker-"));
    const said = `Cannot connect to the Docker daemon at unix:///made-up/docker.sock. Is the docker daemon running? ${"abcdefghij ".repeat(30).trim()}`;
    writeFileSync(join(bin, "docker"), `#!/bin/sh\nprintf '%s\\n' '${said}' >&2\nexit 1\n`, { mode: 0o755 });
    const found = await dockerProblem({ PATH: bin });
    const quoted = /`docker info` failed: (.*)\)\. To put it right, /.exec(found ?? "")?.[1];
    expect(quoted, found ?? "").toBeDefined();
    expect(quoted!.length).toBeLessThanOrEqual(202);
    expect(quoted).toMatch(/^Cannot connect to the Docker daemon at unix:\/\/\/made-up\/docker\.sock\. Is the docker daemon running\? (?:abcdefghij )+…$/);
    expect(said.startsWith(quoted!.slice(0, -2))).toBe(true);
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

  it("the live isolation test file for the real containers (package 0.6c, 14 Nov 2026), run with the zip absent and Docker not answering, fails: all 10 of its tests, none skipped, each naming both and how to put them right", () => {
    const empty = mkdtempSync(join(scratch, "no-zip-"));
    const r = spawnSync(process.execPath, [join(builderDir, "node_modules", "vitest", "vitest.mjs"), "run", "test/isolation-real-live.test.ts"], {
      cwd: builderDir,
      env: { ...process.env, ...noDocker(), BUILDER_BROWSER_CACHE: empty, NO_COLOR: "1", FORCE_COLOR: "0" },
      encoding: "utf8",
      timeout: 180_000,
    });
    const out = `${r.stdout}\n${r.stderr}`;
    expect(r.status, out.slice(-3000)).toBe(1);
    expect(out).toMatch(/Tests\s+10 failed \(10\)/);
    expect(out).not.toMatch(/\b\d+ (?:skipped|todo)\b/);
    // Each of the ten fails with the same words, once each: none of them got as far as starting anything.
    const words = "This live isolation test runs the probe in the real containers, so it needs Docker and the approved browser zip; it fails (it is never skipped). Missing: Docker does not answer on this machine";
    expect(out.split(words).length - 1).toBe(10);
    expect(out.split(`The approved browser zip is not in the folder BUILDER_BROWSER_CACHE names: The browser cache has no ${BROWSER_ZIP}`).length - 1).toBe(10);
    expect(out).toContain("nohup dockerd");
    expect(out).toContain("npx tsx scripts/fetch-browser.ts");
  }, 200_000);

  it("no test file can skip a test, mark one to do, run one alone, run one only if something holds, or expect it to fail; the test runner runs every test file in test/; npm test runs the whole suite", () => {
    // The scan is in test/gate-scan.ts; the tests below, on made-up folders, show that each of its rules finds what it is for.
    const listed = runnerTestFiles(builderDir);
    expect(listed).toContain(realpathSync(join(builderDir, "test", "acceptance-live.test.ts")));
    expect(listed).toContain(realpathSync(join(builderDir, "test", "acceptance-gate.test.ts")));
    // Package 0.6c, 14 Nov 2026: the live isolation tests in the real containers are on the runner's own list too.
    expect(listed).toContain(realpathSync(join(builderDir, "test", "isolation-real-live.test.ts")));
    expect(scanForLeftOutTests(builderDir, listed)).toEqual([]);
    expect(scanRunnerSettings(builderDir)).toEqual([]);
  }, 60_000);
});

describe("the gate's scan, on made-up folders: each rule finds what it is for (added after the package's review)", () => {
  // The words are put together here, so that this file, which the scan reads too, does not hold them.
  const word = (...parts: string[]) => parts.join("");
  const [skipW, onlyW, failsW] = [word("sk", "ip"), word("on", "ly"), word("fa", "ils")];
  /** A made-up builder folder: package.json, vitest.config.ts and one plain test file, then the given files. */
  const madeUp = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(scratch, "made-up-builder-"));
    const all: Record<string, string> = {
      "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
      "vitest.config.ts": "export default { test: { fileParallelism: false } };\n",
      "test/plain.test.ts": "// made-up\n",
      ...files,
    };
    for (const [name, text] of Object.entries(all)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    return dir;
  };

  it("a failure turned into a pass: `fails` after it or test is found", () => {
    const dir = madeUp({ "test/a.test.ts": `it.${failsW}("made-up", () => { throw new Error("x"); });\ntest.concurrent.${failsW}("made-up", () => {});\n` });
    const found = scanForLeftOutTests(dir, [join(dir, "test", "plain.test.ts"), join(dir, "test", "a.test.ts")]);
    expect(found).toEqual([`test/a.test.ts:1: it.${failsW}("made-up", () => { throw new Error("x"); });`, `test/a.test.ts:2: test.concurrent.${failsW}("made-up", () => {});`]);
  });

  it("a file in a subfolder of test/ is read", () => {
    const dir = madeUp({ "test/sub/deeper/b.test.ts": `it.${skipW}("made-up", () => {});\n`, "test/sub/helper.ts": `export const later = () => describe.${onlyW}("made-up", () => {});\n` });
    const found = scanForLeftOutTests(dir, [join(dir, "test", "plain.test.ts"), join(dir, "test", "sub", "deeper", "b.test.ts")]);
    expect(found).toEqual([`test/sub/deeper/b.test.ts:1: it.${skipW}("made-up", () => {});`, `test/sub/helper.ts:1: export const later = () => describe.${onlyW}("made-up", () => {});`]);
  });

  it("a file the test runner runs outside test/ is read", () => {
    const dir = madeUp({ "src/c.test.ts": `describe.${onlyW}("made-up", () => {});\n` });
    expect(scanForLeftOutTests(dir, [join(dir, "test", "plain.test.ts")])).toEqual([]);
    expect(scanForLeftOutTests(dir, [join(dir, "test", "plain.test.ts"), join(dir, "src", "c.test.ts")])).toEqual([`src/c.test.ts:1: describe.${onlyW}("made-up", () => {});`]);
  });

  it("a test file in test/ that the test runner would not run is named, whatever setting leaves it out (here one the settings file takes from another file, so no word in it shows)", () => {
    const dir = madeUp({
      "vitest.config.ts": 'import more from "./more-settings.mjs";\nexport default { test: { ...more } };\n',
      "more-settings.mjs": 'export default { exclude: ["test/hidden/**", "**/node_modules/**"] };\n',
      "test/hidden/d.test.ts": "// made-up\n",
    });
    const listed = runnerTestFiles(dir);
    expect(listed).toEqual([realpathSync(join(dir, "test", "plain.test.ts"))]);
    expect(scanRunnerSettings(dir)).toEqual([]);
    expect(scanForLeftOutTests(dir, listed)).toEqual(["test/hidden/d.test.ts: a test file the test runner would not run"]);
  }, 60_000);

  it("settings that name projects, dir, root or workspace, and another settings file or a workspace file, are named; so are the earlier ones", () => {
    for (const [setting, config] of [
      ["projects", 'export default { test: { projects: ["test/sub"] } };\n'],
      ["dir", 'export default { test: { dir: "test/sub" } };\n'],
      ["root", 'export default { test: { root: "test/sub" } };\n'],
      ["workspace", 'export default { test: { workspace: ["test/sub"] } };\n'],
      ["passWithNoTests", "export default { test: { passWithNoTests: true } };\n"],
      ["exclude", 'export default { test: { exclude: ["test/x/**"] } };\n'],
    ] as const) {
      expect(scanRunnerSettings(madeUp({ "vitest.config.ts": config })), setting).toEqual([`vitest.config.ts names ${setting}`]);
    }
    const others = madeUp({ "vite.config.ts": "export default {};\n", "vitest.config.mts": "export default {};\n", "vitest.workspace.ts": "export default [];\n" });
    expect(scanRunnerSettings(others)).toEqual(["vite.config.ts: another settings file for the test runner", "vitest.config.mts: another settings file for the test runner", "vitest.workspace.ts: another settings file for the test runner"]);
    expect(scanRunnerSettings(madeUp({ "package.json": JSON.stringify({ scripts: { test: "vitest run test/plain.test.ts" } }) }))).toEqual(['npm test runs "vitest run test/plain.test.ts", not "vitest run"']);
  });
});
