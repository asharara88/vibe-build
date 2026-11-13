/**
 * The gate's scan (package 3.1b): what in the builder's test suite, or in the test runner's settings, could leave
 * a test out of `npm test`, or turn a failing test into a pass. `test/acceptance-gate.test.ts` runs it on the real
 * suite, and on made-up folders to show that each rule finds what it is for.
 *
 * After the package's review (13 Nov 2026) it also finds `fails`, reads the subfolders of `test/` and every file
 * the test runner itself lists, asks the test runner which files it would run (so a setting that leaves a test
 * file out is seen whatever it is called), and names the settings `projects`, `dir`, `root` and `workspace` and any
 * other settings or workspace file.
 *
 * The words are put together here, so that this file, which the scan reads too, does not hold them.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";

const skip = ["sk", "ip"].join("");
/** After describe, it, test, suite or bench, each of these leaves a test out, or (the last) turns its failure into a pass. */
export const LEFT_OUT_WORDS = [skip, `${skip}If`, ["run", "If"].join(""), ["to", "do"].join(""), ["on", "ly"].join(""), ["fa", "ils"].join("")] as const;
const byApi = new RegExp(`\\b(?:describe|it|test|suite|bench)(?:\\s*\\.\\s*\\w+)*\\s*\\.\\s*(?:${LEFT_OUT_WORDS.join("|")})\\b`);
/** A test's context skipping it at run time. */
const byContext = new RegExp(`\\.\\s*${skip}\\s*\\(`);
/** A file the scan reads: any JavaScript or TypeScript source. */
const SOURCE = /\.(?:c|m)?[jt]sx?$/;
/** A test file by the test runner's own default rule (`**\/*.{test,spec}.?(c|m)[jt]s?(x)`), read as a file name. */
const TEST_FILE = /\.(?:test|spec)\.(?:c|m)?[jt]sx?$/;
/** Settings that pass an empty run, let a test run alone, or choose which files run. */
const SETTINGS = ["passWithNoTests", ["allow", "Only"].join(""), "exclude", "include", "filter", "projects", "dir", "root", "workspace"];

const real = (p: string) => realpathSync(p);

/** Every source file under `test/`, its subfolders included (a folder reached through a link is not walked; the runner's own list covers what it would run there). */
export function testFolderSources(builderDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(p);
      } else if ((e.isFile() || e.isSymbolicLink()) && SOURCE.test(e.name)) out.push(real(p));
    }
  };
  walk(join(real(builderDir), "test"));
  return out.sort();
}

/** The files the test runner would run, as it lists them itself (`vitest list --filesOnly --json`, run in `dir`), as real paths. */
export function runnerTestFiles(dir: string, vitestEntry = join(import.meta.dirname, "..", "node_modules", "vitest", "vitest.mjs")): string[] {
  const r = spawnSync(process.execPath, [vitestEntry, "list", "--filesOnly", "--json"], { cwd: dir, encoding: "utf8", timeout: 120_000, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } });
  if (r.status !== 0) throw new Error(`The test runner could not list its files (exit code ${r.status}): ${`${r.stdout}\n${r.stderr}`.slice(-2000)}`);
  return (JSON.parse(r.stdout) as { file: string }[]).map((x) => real(x.file)).sort();
}

/**
 * Each line that leaves a test out, in every source file under `test/` and every file the runner lists (wherever it
 * is); and each test file under `test/` that the runner would not run. Empty when nothing is found.
 */
export function scanForLeftOutTests(builderDir: string, runnerFiles: string[]): string[] {
  const root = real(builderDir);
  const inFolder = testFolderSources(root);
  const listed = new Set(runnerFiles.map(real));
  const found: string[] = [];
  for (const f of [...new Set([...inFolder, ...listed])].sort()) {
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (byApi.test(line) || byContext.test(line)) found.push(`${relative(root, f)}:${i + 1}: ${line.trim()}`);
      });
  }
  for (const f of inFolder) if (TEST_FILE.test(f) && !listed.has(f)) found.push(`${relative(root, f)}: a test file the test runner would not run`);
  return found;
}

/** What in the test runner's settings, or in the command `npm test` runs, could pass an empty run or leave tests out. Empty when nothing is found. */
export function scanRunnerSettings(builderDir: string): string[] {
  const found: string[] = [];
  const names = readdirSync(builderDir);
  if (!names.includes("vitest.config.ts")) found.push("vitest.config.ts is missing");
  else {
    const config = readFileSync(join(builderDir, "vitest.config.ts"), "utf8");
    for (const s of SETTINGS) if (new RegExp(`\\b${s}\\b`).test(config)) found.push(`vitest.config.ts names ${s}`);
  }
  // Another settings file the test runner could read, now or after a change (vite.config.*, another vitest.config.*), or a workspace or projects file.
  for (const n of names.sort()) if (/^(?:vitest|vite)\.(?:config|workspace|projects)\./.test(n) && n !== "vitest.config.ts") found.push(`${n}: another settings file for the test runner`);
  const scripts = (JSON.parse(readFileSync(join(builderDir, "package.json"), "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
  if (scripts.test !== "vitest run") found.push(`npm test runs ${JSON.stringify(scripts.test)}, not "vitest run"`);
  return found;
}
