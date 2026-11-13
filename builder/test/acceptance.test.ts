/**
 * Package 3.1: the acceptance store and runner. Fast checks, with no container and no browser: the store,
 * the result reader against stand-in outputs for each "did not run" case, the Compose document, the mount
 * rule, the label, the change sets and the runner's own files. The live tests are in
 * test/acceptance-live.test.ts.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { traceScreenFrames, zipEntryNames } from "../src/acceptance/probes.js";
import { readRun, plainFileInside, type RunFacts } from "../src/acceptance/results.js";
import { runAcceptance } from "../src/acceptance/runner.js";
import { approvedPackages, BROWSER_ZIP_LABEL, BROWSER_ZIP_SHA256, checkedBrowserZip, RUNNER_BASE_IMAGES, RUNNER_DIR, RUNNER_IMAGE, runnerImageLabelProblem } from "../src/acceptance/runner-image.js";
import { exampleChecklist, standInSources, STAND_IN_DIR, writeStandInVersion } from "../src/acceptance/stand-in.js";
import {
  dataDirFromSetting,
  listVersions,
  MARKER_PLACEHOLDER,
  newRunFolder,
  openStore,
  REPO_ROOT,
  sha256,
  verifyVersion,
  writeVersion,
  type AcceptanceStore,
  type VersionCheck,
  type VersionManifest,
} from "../src/acceptance/store.js";
import { listSteps, readManifest, SCRIPTED_BANNER, scriptedHeader, sha256Of, TEMPLATE_PROTECTED_PATHS } from "../src/engine/scripted.js";
import { composeDocument, createSandbox, engineMountRefusal, sandbox, type Sandbox, type SandboxSpec } from "../src/sandbox/manager.js";
import { listEvents } from "../src/store/events.js";
import { createProject } from "../src/store/projects.js";
import { testPool, uniqueId } from "./helpers.js";

const builderDir = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "builder-acceptance-fast-"));
afterAll(() => {
  // Versions are written read-only; give the folders back before removing them.
  const open = (d: string) => {
    if (!existsSync(d)) return;
    chmodSync(d, 0o700);
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) open(join(d, e.name));
  };
  open(scratch);
  rmSync(scratch, { recursive: true, force: true });
});

const ITEM = (marker = MARKER_PLACEHOLDER) =>
  [
    "// Stand-in acceptance test, written in advance by Claude Code (the AI assistant building this project), not by the builder's acceptance writer. No model call by the builder.",
    `// Label: stand-in test. Example 1, acceptance item 1. Version marker: ${marker}`,
    'import { test } from "@playwright/test";',
    'test("item 1 (stand-in test): made-up", async () => {});',
    "",
  ].join("\n");
let n = 0;
const freshStore = (): AcceptanceStore => openStore(join(scratch, `data-${++n}`));
const write = (store: AcceptanceStore, projectId = "p_acc") =>
  writeVersion(store, projectId, { writtenBy: "stand-in", appSpecSha256: "a".repeat(64), items: [{ number: 1, file: "item-01.spec.ts", content: ITEM(), checklist: "made-up" }] });

// Review bot on a7f85b6 (P2): a manifest replaced by valid JSON of the wrong shape threw (null) or was
// passed on to the result reader ({}), so the refusal was never recorded.
const badManifests: Array<[string, (m: VersionManifest) => unknown, string]> = [
  ["null", () => null, "it is not an object"],
  ["a list", () => [], "it is not an object"],
  ["{}", () => ({}), "version is missing"],
  ["items not a list", (m) => ({ ...m, items: "item-01.spec.ts" }), "items is not a list"],
  ["items an object, not a list", (m) => ({ ...m, items: { 0: m.items[0] } }), "items is not a list"],
  ["no items", ({ items: _items, ...m }) => m, "items is missing"],
  ["an item that is not an object", (m) => ({ ...m, items: [null] }), "items[0] is not an object"],
  ["an item whose number is text", (m) => ({ ...m, items: [{ ...m.items[0], number: "1" }] }), "items[0].number is not a whole number"],
  ["an item whose file is not text", (m) => ({ ...m, items: [{ ...m.items[0], file: 1 }] }), "items[0].file is not text"],
  ["an item without its fingerprint", (m) => ({ ...m, items: [{ ...m.items[0], sha256: undefined }] }), "items[0].sha256 is missing"],
  ["a marker that is not text", (m) => ({ ...m, marker: 7 }), "marker is not text"],
  ["a field the store does not write", (m) => ({ ...m, made_up: true }), "it holds a field the store does not write"],
  ["an item with a field the store does not write", (m) => ({ ...m, items: [{ ...m.items[0], made_up: true }] }), "items[0] holds a field the store does not write"],
];
/** A fresh store whose project's v001 has its manifest replaced by `json(the manifest as written)`. */
const withManifest = (json: (m: VersionManifest) => unknown, projectId = "p_acc") => {
  const store = freshStore();
  const v = write(store, projectId);
  chmodSync(v.dir, 0o755);
  chmodSync(join(v.dir, "manifest.json"), 0o644);
  writeFileSync(join(v.dir, "manifest.json"), JSON.stringify(json(v.manifest)));
  return { store, v };
};

describe("acceptance store", () => {
  it("the data folder has no default: unset or relative is refused", () => {
    expect(() => dataDirFromSetting({})).toThrow(/BUILDER_DATA_DIR is not set/);
    expect(() => dataDirFromSetting({ BUILDER_DATA_DIR: "relative/data" })).toThrow(/absolute/);
    expect(dataDirFromSetting({ BUILDER_DATA_DIR: "/srv/made-up" })).toBe("/srv/made-up");
  });

  it("refuses a data folder inside the repository, builder/, builder/scripted, templates/ or a sandbox folder, also through a link", () => {
    for (const p of [REPO_ROOT, join(REPO_ROOT, "data"), join(REPO_ROOT, "builder", "data"), join(REPO_ROOT, "builder", "scripted", "x"), join(REPO_ROOT, "templates", "next", "x")]) {
      expect(() => openStore(p), p).toThrow(/is inside/);
    }
    const sandboxDir = join(scratch, "sandbox-a");
    mkdirSync(sandboxDir);
    expect(() => openStore(join(sandboxDir, "data"), { refuse: [sandboxDir] })).toThrow(/sandbox folder/);
    const link = join(scratch, "link-to-builder");
    symlinkSync(join(REPO_ROOT, "builder"), link);
    expect(() => openStore(join(link, "data"))).toThrow(/is inside the repository/);
    expect(() => openStore("relative")).toThrow(/absolute/);
  });

  it("writes v001, then v002, each with a manifest, a fresh marker in the label line, and the stand-in label; the files and folder are read-only modes", () => {
    const store = freshStore();
    const a = write(store);
    const b = write(store);
    expect([a.version, b.version]).toEqual(["v001", "v002"]);
    expect(listVersions(store, "p_acc")).toEqual(["v001", "v002"]);
    expect(a.manifest.marker).toMatch(/^acceptance-marker-[0-9a-f]{32}$/);
    expect(a.manifest.marker).not.toBe(b.manifest.marker);
    expect(a.manifest.written_by).toBe("stand-in");
    expect(a.manifest.written_by_note).toContain("written in advance by Claude Code");
    const file = readFileSync(join(a.dir, "item-01.spec.ts"), "utf8");
    expect(file.split("\n")[1]).toBe(`// Label: stand-in test. Example 1, acceptance item 1. Version marker: ${a.manifest.marker}`);
    expect(file).not.toContain(MARKER_PLACEHOLDER);
    expect(a.manifest.items).toEqual([{ number: 1, file: "item-01.spec.ts", sha256: sha256(file), checklist: "made-up" }]);
    expect(sha256(readFileSync(join(a.dir, "manifest.json")))).toBe(a.manifestSha256);
    expect(readdirSync(a.dir).sort()).toEqual(["item-01.spec.ts", "manifest.json"]);
    expect(readdirSync(join(store.root, "p_acc")).sort()).toEqual(["v001", "v002"]); // no temporary folder left
    // Modes are a courtesy only: the builder runs as root, and root ignores them (known gap 57).
    const mode = (p: string) => (statMode(p) & 0o777).toString(8);
    expect([mode(a.dir), mode(join(a.dir, "manifest.json")), mode(store.root)]).toEqual(["555", "444", "700"]);
    expect(verifyVersion(store, "p_acc", "v001")).toMatchObject({ ok: true, problems: [] });
  });

  it("never writes into an existing version: an empty folder put in the next version's place is left alone, and the version after it is written", () => {
    const store = freshStore();
    const first = write(store);
    mkdirSync(join(store.root, "p_acc", "v002"));
    const next = write(store);
    expect(next.version).toBe("v003");
    // rename(2) would have replaced the empty v002; it was not touched, and v001 is as it was.
    expect(readdirSync(join(store.root, "p_acc", "v002"))).toEqual([]);
    expect(verifyVersion(store, "p_acc", "v001")).toMatchObject({ ok: true, manifestSha256: first.manifestSha256 });
  });

  it("refuses bad input: a project id that is not a plain name, a file without the marker's place or the label, two markers, a wrong file name, a missing stand-in sentence", () => {
    const store = freshStore();
    const base = { writtenBy: "stand-in" as const, appSpecSha256: "a".repeat(64) };
    expect(() => write(store, "../escape")).toThrow(/not a project id/);
    expect(() => writeVersion(store, "p", { ...base, items: [{ number: 1, file: "item-01.spec.ts", content: ITEM().replace(MARKER_PLACEHOLDER, "x"), checklist: "" }] })).toThrow(/marker's place/);
    expect(() => writeVersion(store, "p", { ...base, items: [{ number: 1, file: "item-01.spec.ts", content: ITEM() + `// ${MARKER_PLACEHOLDER}\n`, checklist: "" }] })).toThrow(/marker's place/);
    expect(() => writeVersion(store, "p", { ...base, items: [{ number: 1, file: "item-01.spec.ts", content: ITEM().replace("Label: stand-in test.", "Label: x."), checklist: "" }] })).toThrow(/label line/);
    expect(() => writeVersion(store, "p", { ...base, items: [{ number: 2, file: "item-01.spec.ts", content: ITEM(), checklist: "" }] })).toThrow(/file name/);
    expect(() => writeVersion(store, "p", { ...base, items: [{ number: 1, file: "item-01.spec.ts", content: ITEM().replace("// Stand-in acceptance test", "// A test"), checklist: "" }] })).toThrow(/stand-in sentence/);
    expect(listVersions(store, "p")).toEqual([]);
  });

  it("the check before a run finds a changed file, an extra file, a file replaced by a link, and a changed manifest", () => {
    const store = freshStore();
    const v = write(store);
    const f = join(v.dir, "item-01.spec.ts");
    chmodSync(v.dir, 0o755);
    chmodSync(f, 0o644);
    writeFileSync(f, readFileSync(f, "utf8") + "// added\n");
    expect(verifyVersion(store, "p_acc", "v001").problems).toEqual(["item-01.spec.ts does not match its fingerprint in the manifest"]);
    writeFileSync(join(v.dir, "extra.ts"), "x");
    expect(verifyVersion(store, "p_acc", "v001").problems).toContain('the version holds "extra.ts", which the manifest does not name');
    rmSync(f);
    symlinkSync(join(scratch, "elsewhere.ts"), f);
    expect(verifyVersion(store, "p_acc", "v001").problems.join(" ")).toContain("not a plain file");
    const m = JSON.parse(readFileSync(join(v.dir, "manifest.json"), "utf8")) as VersionManifest;
    chmodSync(join(v.dir, "manifest.json"), 0o644);
    writeFileSync(join(v.dir, "manifest.json"), JSON.stringify({ ...m, written_by: "acceptance-writer" }));
    expect(verifyVersion(store, "p_acc", "v001").problems.join(" ")).toContain('written by "acceptance-writer"');
    expect(verifyVersion(store, "p_acc", "v009")).toMatchObject({ ok: false });
  });

  it("the check before a run reports a manifest of the wrong shape as one problem, never throws, and gives no manifest on", () => {
    for (const [name, json, why] of badManifests) {
      const { store, v } = withManifest(json);
      let check: VersionCheck | undefined;
      expect(() => (check = verifyVersion(store, "p_acc", "v001")), name).not.toThrow();
      expect(check, name).toEqual({ ok: false, problems: [`the manifest is not in the shape the store writes: ${why}`], dir: v.dir });
    }
  });

  it("a run folder is fresh: the same run id twice is refused", () => {
    const store = freshStore();
    const r = newRunFolder(store, "p_acc", "run-20261113t000000-abcd1234");
    expect(readdirSync(r.dir).sort()).toEqual(["builder", "results", "secret"]);
    expect(() => newRunFolder(store, "p_acc", "run-20261113t000000-abcd1234")).toThrow(/EEXIST/);
    expect(() => newRunFolder(store, "p_acc", "../run")).toThrow(/not a run id/);
  });
});

describe("a run refused because its manifest is malformed still says 'did not run', with its events and its report (test database; no container, no app check)", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = await testPool();
  });
  afterAll(async () => {
    await pool?.end();
  });
  /** A sandbox that fails the test if the run touches it: a refused run starts no container and asks no app. */
  const untouchable = new Proxy({}, {
    get: (_t, p) => {
      throw new Error(`the sandbox was used (${String(p)})`);
    },
  }) as Sandbox;

  for (const [name, json, why] of badManifests.filter(([name]) => ["null", "{}", "items not a list", "an item that is not an object"].includes(name))) {
    it(`manifest: ${name}`, async () => {
      const projectId = uniqueId("p_acc_bad");
      await createProject(pool, { id: projectId, name: "made-up", capUsd: 0 });
      const { store, v } = withManifest(json, projectId);
      const r = await runAcceptance({ pool, sandbox: untouchable, store, projectId, version: v.version, appUrl: "http://127.0.0.1:1", samplePassword: "made-up", checklistItems: 6 });
      const refused = `the version does not match its manifest: the manifest is not in the shape the store writes: ${why}`;
      expect(r).toMatchObject({ refused, manifestSha256: null, appAnswered: "not checked: the run was refused before this check", exit: null, args: null });
      expect(r.reading).toEqual({ outcome: "not passed", items: [], runProblems: [`the run was refused before its start: ${refused}`], summary: `did not run: the run was refused before its start: ${refused}` });
      const events = await listEvents(pool, projectId);
      expect(events.map((e) => e.kind)).toEqual(["acceptance.run.started", "acceptance.run.finished"]);
      expect(events[0]!.payload).toMatchObject({ run_id: r.runId, version: "v001", written_by: "stand-in", manifest_sha256: null, container_started: false, refused });
      expect(events[1]!.payload).toMatchObject({ run_id: r.runId, exit_code: null, timed_out: false, outcome: "not passed", summary: r.reading.summary });
      const saved = JSON.parse(readFileSync(join(r.runFolder.builder, "report.json"), "utf8"));
      expect(saved).toMatchObject({ runId: r.runId, refused, reading: { summary: r.reading.summary }, events: events.map((e) => e.id) });
      expect(existsSync(r.runFolder.secretFile)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------------------------------
// The result reader, against stand-in outputs shaped as Playwright 1.63.0's JSON reporter writes them
// (seen in the runner image on 13 Nov 2026: config.metadata, suites[].specs[].tests[].results[]).

const MANIFEST_SHA = "b".repeat(64);
const RUN_ID = "run-20261113t000000-made0up0";
const manifest: VersionManifest = {
  version: "v001",
  project_id: "p",
  written_by: "stand-in",
  written_by_note: "",
  written_at: "",
  app_spec_sha256: "a".repeat(64),
  marker: "acceptance-marker-" + "0".repeat(32),
  items: [{ number: 1, file: "item-01.spec.ts", sha256: "c".repeat(64), checklist: "" }],
};
type Result = Record<string, unknown>;
const passedResult = (extra: Result = {}): Result => ({
  status: "passed",
  retry: 0,
  errors: [],
  annotations: [],
  steps: [{ title: "signs in as the sample employee" }, { title: "sees status waiting" }],
  attachments: [
    { name: "item-screenshot", contentType: "image/png", path: "/results/test-results/item-01/item-01-stand-in-test.png" },
    { name: "screenshot", contentType: "image/png", path: "/results/test-results/item-01/test-finished-1.png" },
    { name: "trace", contentType: "application/zip", path: "/results/test-results/item-01/trace.zip" },
  ],
  ...extra,
});
const report = (o: { runId?: string; manifestSha256?: string; tests?: Result[]; file?: string; specs?: Result[]; errors?: unknown[] } = {}) => ({
  config: { metadata: { runId: o.runId ?? RUN_ID, manifestSha256: o.manifestSha256 ?? MANIFEST_SHA, actualWorkers: 1 } },
  suites: [
    {
      title: o.file ?? "item-01.spec.ts",
      file: o.file ?? "item-01.spec.ts",
      specs: o.specs ?? [{ title: "item 1 (stand-in test): made-up", file: o.file ?? "item-01.spec.ts", tests: o.tests ?? [{ expectedStatus: "passed", status: "expected", annotations: [], results: [passedResult()] }] }],
    },
  ],
  errors: o.errors ?? [],
  stats: {},
});

/** A run folder holding a results file and the files it names. */
function runFolder(content: unknown, opts: { noScreenshot?: boolean; screenshotLink?: boolean; resultsLink?: boolean; raw?: string } = {}): string {
  const d = mkdtempSync(join(scratch, "run-"));
  mkdirSync(join(d, "test-results", "item-01"), { recursive: true });
  if (!opts.noScreenshot) {
    if (opts.screenshotLink) symlinkSync("/etc/hostname", join(d, "test-results", "item-01", "item-01-stand-in-test.png"));
    else writeFileSync(join(d, "test-results", "item-01", "item-01-stand-in-test.png"), "made-up png");
  }
  writeFileSync(join(d, "test-results", "item-01", "test-finished-1.png"), "made-up png");
  writeFileSync(join(d, "test-results", "item-01", "trace.zip"), "made-up zip");
  if (opts.resultsLink) {
    writeFileSync(join(scratch, "elsewhere.json"), JSON.stringify(content));
    symlinkSync(join(scratch, "elsewhere.json"), join(d, "results.json"));
  } else writeFileSync(join(d, "results.json"), opts.raw ?? JSON.stringify(content));
  return d;
}
const facts = (resultsDir: string, extra: Partial<RunFacts> = {}): RunFacts => ({
  resultsDir,
  runId: RUN_ID,
  manifest,
  manifestSha256: MANIFEST_SHA,
  appAnswered: true,
  exit: { code: 0, timedOut: false },
  checklistItems: 6,
  ...extra,
});
const item1 = (f: RunFacts) => readRun(f).items[0]!;

describe("acceptance results: passed only when it ran and passed", () => {
  it("passed: one test, expected to pass, passed on its first try, its screenshot read from the run folder; the run reads 'version passed; checklist incomplete'", () => {
    const d = runFolder(report());
    const r = readRun(facts(d));
    expect(r.items[0]).toMatchObject({ status: "passed", title: "item 1 (stand-in test): made-up" });
    expect(r.items[0]!.screenshot).toEqual({ path: join(d, "test-results", "item-01", "item-01-stand-in-test.png"), sha256: sha256("made-up png") });
    expect(r.summary).toBe("version passed; checklist incomplete (5 of the app spec's 6 checklist items have no test)");
    expect(r.outcome).toBe("passed");
  });

  it("failed: a recorded failure names the failing step, or 'no step named'; a test's own time limit is a failure; the error text is kept apart, colour codes removed", () => {
    const failing = passedResult({
      status: "failed",
      error: { message: "\u001b[31mError: expect(locator).toContainText(expected) failed\u001b[39m\nExpected pattern: /waiting/i\nReceived string: \"Approved\"" },
      steps: [{ title: "signs in as the sample employee" }, { title: "sees status waiting", error: { message: "x" } }],
      attachments: [{ name: "screenshot", path: "/results/test-results/item-01/test-finished-1.png" }],
    });
    const r = readRun(facts(runFolder(report({ tests: [{ expectedStatus: "passed", status: "unexpected", annotations: [], results: [failing] }] })), { exit: { code: 1, timedOut: false } }));
    expect(r.items[0]).toMatchObject({ status: "failed", step: "sees status waiting", why: "it ran and failed" });
    expect(r.items[0]!.errorText).toContain('Received string: "Approved"');
    expect(r.items[0]!.errorText).not.toContain("\u001b");
    expect(r.items[0]!.screenshot?.sha256).toBe(sha256("made-up png"));
    expect(r.summary).toBe('version failed: item 1 failed at step "sees status waiting"');
    expect(r.outcome).toBe("failed");
    const outside = passedResult({ status: "failed", error: { message: "made-up" }, steps: [] });
    expect(item1(facts(runFolder(report({ tests: [{ expectedStatus: "passed", status: "unexpected", results: [outside] }] }))))).toMatchObject({ status: "failed", step: "no step named" });
    const tooLong = passedResult({ status: "timedOut", steps: [{ title: "signs in as the sample employee" }] });
    expect(item1(facts(runFolder(report({ tests: [{ expectedStatus: "passed", status: "unexpected", results: [tooLong] }] }))))).toMatchObject({ status: "failed", step: "no step named", why: "it ran past its own time limit" });
  });

  const didNotRun: Array<[string, () => RunFacts, RegExp]> = [
    ["the app did not answer before the start", () => facts(runFolder(report()), { appAnswered: "the project's app container is exited" }), /app did not answer/],
    ["the run was refused before its start", () => facts(runFolder(report()), { refused: "the manifest on disk is not the one the event log recorded" }), /refused before its start/],
    ["the runner was never started", () => facts(runFolder(report()), { exit: null }), /not started/],
    ["the overall time limit stopped the container", () => facts(runFolder(report()), { exit: { code: 137, timedOut: true } }), /time limit/],
    ["the container was killed (exit code 137)", () => facts(runFolder(report()), { exit: { code: 137, timedOut: false } }), /exit code 137/],
    ["the container ended with no exit code", () => facts(runFolder(report()), { exit: { code: null, timedOut: false } }), /exit code none/],
    ["no results file", () => facts(mkdtempSync(join(scratch, "run-empty-"))), /results\.json is missing/],
    ["the results file is a link", () => facts(runFolder(report(), { resultsLink: true })), /link/],
    ["the results file does not parse", () => facts(runFolder(null, { raw: "{ not json" })), /does not parse/],
    ["the results are another run's", () => facts(runFolder(report({ runId: "run-20261113t000000-other000" }))), /not this run's/],
    ["the results are for another version", () => facts(runFolder(report({ manifestSha256: "d".repeat(64) }))), /not for this version/],
    ["the item's test appears twice", () => facts(runFolder(report({ tests: [{ expectedStatus: "passed", status: "expected", results: [passedResult()] }, { expectedStatus: "passed", status: "expected", results: [passedResult()] }] }))), /2 tests/],
    ["the item's test is in another file", () => facts(runFolder(report({ file: "item-02.spec.ts" }))), /0 tests/],
    ["the test was skipped", () => facts(runFolder(report({ tests: [{ expectedStatus: "skipped", status: "skipped", annotations: [{ type: "skip" }], results: [passedResult({ status: "skipped" })] }] }))), /marked "skip"/],
    ["the test is marked fixme", () => facts(runFolder(report({ tests: [{ expectedStatus: "skipped", status: "skipped", annotations: [{ type: "fixme" }], results: [] }] }))), /0 results|fixme/],
    ["the test is marked as expected to fail (test.fail()) and 'passed' by failing", () => facts(runFolder(report({ tests: [{ expectedStatus: "failed", status: "expected", annotations: [{ type: "fail" }], results: [passedResult({ status: "failed" })] }] }))), /marked "fail"/],
    ["the result is from a retry", () => facts(runFolder(report({ tests: [{ expectedStatus: "passed", status: "expected", results: [passedResult({ retry: 1 })] }] }))), /retry 1/],
    ["two results", () => facts(runFolder(report({ tests: [{ expectedStatus: "passed", status: "flaky", results: [passedResult({ status: "failed" }), passedResult({ retry: 1 })] }] }))), /2 results/],
    ["the test was interrupted", () => facts(runFolder(report({ tests: [{ expectedStatus: "passed", status: "unexpected", results: [passedResult({ status: "interrupted" })] }] }))), /"interrupted"/],
    ["no screenshot", () => facts(runFolder(report(), { noScreenshot: true })), /screenshot cannot be read: .*missing/],
    ["the screenshot is a link", () => facts(runFolder(report(), { screenshotLink: true })), /link/],
    ["the screenshot attachment is outside /results", () => facts(runFolder(report({ tests: [{ expectedStatus: "passed", status: "expected", results: [passedResult({ attachments: [{ name: "item-screenshot", path: "/etc/hostname" }] })] }] }))), /not under \/results/],
    ["the screenshot attachment leads out of the run folder", () => facts(runFolder(report({ tests: [{ expectedStatus: "passed", status: "expected", results: [passedResult({ attachments: [{ name: "item-screenshot", path: "/results/../../etc/hostname" }] })] }] }))), /outside the run folder/],
  ];
  for (const [name, make, why] of didNotRun) {
    it(`did not run: ${name}`, () => {
      const r = readRun(make());
      expect(r.items[0]!.status, name).toBe("did not run");
      expect(r.items[0]!.why, name).toMatch(why);
      expect(r.summary).not.toMatch(/^version passed/);
      expect(r.outcome, name).toBe("not passed");
    });
  }

  // Package 3.1b (the third outside review supplied by the owner, item 3): a run in which no browser test ran is never a pass.
  it("no browser test ran: a version that names no test is never read as passed, whatever the results file holds", () => {
    const none: VersionManifest = { ...manifest, items: [] };
    const empty = { ...report(), suites: [] };
    for (const [label, content] of [["a results file with no test", empty], ["a results file with a passing test the version does not name", report()]] as const) {
      const r = readRun(facts(runFolder(content), { manifest: none }));
      expect(r, label).toEqual({ outcome: "not passed", items: [], runProblems: ["the version names no test, so no browser test ran"], summary: "did not run: the version names no test, so no browser test ran" });
    }
  });

  it("no browser test ran: results with no test at all, or with every test skipped, are 'not passed', every item 'did not run'", () => {
    const two: VersionManifest = { ...manifest, items: [manifest.items[0]!, { number: 2, file: "item-02.spec.ts", sha256: "e".repeat(64), checklist: "" }] };
    const skipped = (file: string) => ({ title: `${file} (stand-in test): made-up`, file, tests: [{ expectedStatus: "skipped", status: "skipped", annotations: [], results: [{ status: "skipped", retry: 0, annotations: [], attachments: [] }] }] });
    const cases: Array<[string, unknown]> = [
      ["no test at all", { ...report(), suites: [] }],
      ["every test skipped", { ...report(), suites: [{ title: "item-01.spec.ts", file: "item-01.spec.ts", specs: [skipped("item-01.spec.ts")] }, { title: "item-02.spec.ts", file: "item-02.spec.ts", specs: [skipped("item-02.spec.ts")] }] }],
    ];
    for (const [label, content] of cases) {
      const r = readRun(facts(runFolder(content), { manifest: two }));
      expect(r.outcome, label).toBe("not passed");
      expect(r.items.map((i) => i.status), label).toEqual(["did not run", "did not run"]);
      expect(r.summary, label).toMatch(/^version not passed: item 1 did not run \(.+\); item 2 did not run \(.+\)$/);
    }
  });

  // Review bot on a7f85b6 (P2): valid JSON with this run's metadata but report fields of the wrong shape threw
  // in the reader, so runAcceptance wrote no events and no report. Each is now "did not run", with the place named.
  const T = "suites[0].specs[0].tests[0]";
  const R = `${T}.results[0]`;
  const oneTest = (t: Result) => report({ tests: [{ expectedStatus: "passed", status: "expected", annotations: [], results: [passedResult()], ...t }] });
  const withResult = (extra: Result) => oneTest({ results: [passedResult(extra)] });
  const failedWith = (extra: Result) => oneTest({ status: "unexpected", results: [passedResult({ status: "failed", error: { message: "made-up" }, ...extra })] });
  const DEEP = 200_000;
  const deepSuites = `{"config":{"metadata":{"runId":"${RUN_ID}","manifestSha256":"${MANIFEST_SHA}"}},"suites":${'[{"suites":'.repeat(DEEP)}[]${"}]".repeat(DEEP)},"errors":[]}`;
  const deepSteps = (() => {
    const at = JSON.stringify(failedWith({ steps: ["MADE-UP-STEPS"] }));
    return at.replace('["MADE-UP-STEPS"]', `${'[{"title":"made-up","error":{"message":"made-up"},"steps":'.repeat(DEEP)}[]${"}]".repeat(DEEP)}`);
  })();
  const malformed: Array<[string, () => string, string]> = [
    ["suites is not a list", () => JSON.stringify({ ...report(), suites: {} }), "suites is not a list"],
    ["a suite is not an object", () => JSON.stringify({ ...report(), suites: [null] }), "suites[0] is not an object"],
    ["a suite's specs are not a list", () => JSON.stringify({ ...report(), suites: [{ file: "item-01.spec.ts", specs: {} }] }), "suites[0].specs is not a list"],
    ["a suite's suites are not a list", () => JSON.stringify({ ...report(), suites: [{ file: "item-01.spec.ts", specs: [], suites: "x" }] }), "suites[0].suites is not a list"],
    ["a spec's tests are not a list", () => JSON.stringify(report({ specs: [{ title: "made-up", file: "item-01.spec.ts", tests: {} }] })), "suites[0].specs[0].tests is not a list"],
    ["a test is not an object", () => JSON.stringify(report({ tests: [null] as unknown as Result[] })), `${T} is not an object`],
    ["a test's results are not a list", () => JSON.stringify(oneTest({ results: {} })), `${T}.results is not a list`],
    ["a result is not an object", () => JSON.stringify(oneTest({ results: [null] })), `${R} is not an object`],
    ["a test's annotations are not a list", () => JSON.stringify(oneTest({ annotations: {} })), `${T}.annotations is not a list`],
    ["a test's annotation is not an object", () => JSON.stringify(oneTest({ annotations: [null] })), `${T}.annotations[0] is not an object`],
    ["a result's annotations are not a list", () => JSON.stringify(withResult({ annotations: "skip" })), `${R}.annotations is not a list`],
    ["an annotation's type is not text", () => JSON.stringify(withResult({ annotations: [{ type: 5 }] })), `${R}.annotations[0].type is not text`],
    ["attachments are not a list", () => JSON.stringify(withResult({ attachments: {} })), `${R}.attachments is not a list`],
    ["an attachment is not an object", () => JSON.stringify(withResult({ attachments: [null, ...(passedResult().attachments as unknown[])] })), `${R}.attachments[0] is not an object`],
    ["an attachment's name is not text", () => JSON.stringify(withResult({ attachments: [{ name: ["item-screenshot"], path: "/results/test-results/item-01/item-01-stand-in-test.png" }] })), `${R}.attachments[0].name is not text`],
    ["a failed result's steps are not a list", () => JSON.stringify(failedWith({ steps: {} })), `${R}.steps is not a list`],
    ["a failed result's step is not an object", () => JSON.stringify(failedWith({ steps: [null] })), `${R}.steps[0] is not an object`],
    ["a step's steps are not a list", () => JSON.stringify(failedWith({ steps: [{ title: "made-up", error: { message: "made-up" }, steps: {} }] })), `${R}.steps[0].steps is not a list`],
    ["errors outside any test are not a list", () => JSON.stringify({ ...report(), errors: {} }), "errors is not a list"],
    [`suites nested ${DEEP} deep`, () => deepSuites, "suites are nested more than 50 deep"],
    [`steps nested ${DEEP} deep`, () => deepSteps, "steps are nested more than 50 deep"],
  ];
  for (const [name, raw, where] of malformed) {
    it(`did not run, the results file not in the reader's shape: ${name}`, () => {
      let r: ReturnType<typeof readRun> | undefined;
      expect(() => (r = readRun(facts(runFolder(null, { raw: raw() })))), name).not.toThrow();
      const why = `the results file is not in the shape the reader expects: ${where}`;
      expect(r!.items).toEqual([{ number: 1, file: "item-01.spec.ts", status: "did not run", why }]);
      expect(r!.summary).toBe(`did not run: ${why}`);
    });
  }

  it("a manifest not in the store's shape is never read: no item, 'did not run', no throw", () => {
    for (const bad of [null, {}, { ...manifest, items: "item-01.spec.ts" }, { ...manifest, items: [null] }]) {
      let r: ReturnType<typeof readRun> | undefined;
      expect(() => (r = readRun(facts(runFolder(report()), { manifest: bad as unknown as VersionManifest }))), JSON.stringify(bad)).not.toThrow();
      expect(r!.items, JSON.stringify(bad)).toEqual([]);
      expect(r!.summary, JSON.stringify(bad)).toMatch(/^did not run: the manifest is not in the shape the store writes \(.+\), so no item is read$/);
    }
  });

  it("a file under /results is read without following any link on the way", () => {
    const d = mkdtempSync(join(scratch, "run-links-"));
    mkdirSync(join(d, "real"));
    writeFileSync(join(d, "real", "a.png"), "x");
    symlinkSync(join(d, "real"), join(d, "linked"));
    expect(plainFileInside(d, "real/a.png", 10)).toEqual({ path: join(d, "real", "a.png"), size: 1 });
    expect(plainFileInside(d, "linked/a.png", 10)).toEqual({ refused: "linked/a.png passes through a link, which is not followed" });
    expect(plainFileInside(d, "real/a.png", 0)).toMatchObject({ refused: expect.stringContaining("larger") });
    expect(plainFileInside(d, "/etc/hostname", 10)).toMatchObject({ refused: expect.stringContaining("not a path inside") });
  });
});

// ---------------------------------------------------------------------------------------------------

const base: Omit<SandboxSpec, "profile" | "dir"> = {
  projectId: "p_acc",
  allowHosts: ["registry.npmjs.org"],
  gatewayUrl: "http://gateway:4010",
  builderDir,
  hostProxy: { url: "http://127.0.0.1:1", caBundlePath: "/root/.ccr/ca-bundle.crt" },
  devDbPort: 5563,
};

describe("acceptance runner: the service in the Compose file", () => {
  for (const profile of ["server", "development-cloud-session"] as const) {
    it(`${profile} profile: its own profile, the hardening, a 512 MB /tmp, the runner's user, one setting (BASE_URL), no settings file, no mount of its own`, () => {
      const doc = composeDocument({
        ...base,
        profile,
        dir: "/tmp/sb",
        app: { buildContext: "/tmp/sb/workspace", port: 3131 },
        acceptance: { image: RUNNER_IMAGE, baseUrl: "http://127.0.0.1:3131" },
      }) as { services: Record<string, Record<string, unknown>> };
      expect(doc.services.acceptance).toEqual({
        image: RUNNER_IMAGE,
        pull_policy: "never",
        profiles: ["acceptance"],
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges:true"],
        pids_limit: 256,
        mem_limit: "1g",
        read_only: true,
        tmpfs: ["/tmp:rw,noexec,nosuid,size=512m"],
        user: "runner",
        entrypoint: [],
        working_dir: "/runner",
        environment: { BASE_URL: "http://127.0.0.1:3131" },
        ...(profile === "server" ? { networks: ["internal"] } : { network_mode: "host" }),
      });
    });
  }

  it("there is no acceptance service unless the sandbox asks for one; the engine service is unchanged by it", () => {
    const doc = composeDocument({ ...base, profile: "development-cloud-session", dir: "/tmp/sb" }) as { services: Record<string, unknown> };
    expect(doc.services.acceptance).toBeUndefined();
  });

  it("up refuses the acceptance service", async () => {
    const dir = mkdtempSync(join(scratch, "sb-up-"));
    const sb = createSandbox({ ...base, profile: "development-cloud-session", dir, acceptance: { image: RUNNER_IMAGE, baseUrl: "http://127.0.0.1:3131" } }, "made-up");
    await expect(sandbox.up(sb, ["acceptance"])).rejects.toThrow(/acceptance service runs one acceptance run at a time/);
  });
});

// Package 3.1b (the third outside review supplied by the owner, item 3): a run whose runner cannot start, because
// Docker does not answer or the runner image (built from the approved browser zip) is not here, is recorded as
// "not passed", with its events and its report; no container is started and the app is not asked.
describe("a run whose runner cannot start is recorded 'not passed' (test database; no container started)", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = await testPool();
  });
  afterAll(async () => {
    await pool?.end();
  });
  /** A stand-in version of example 1, written and recorded; a sandbox whose acceptance service names `image`. */
  async function setUp(image: string) {
    const projectId = uniqueId("p_acc_nostart");
    await createProject(pool, { id: projectId, name: "made-up", capUsd: 0 });
    const store = freshStore();
    const v = await writeStandInVersion(pool, store, projectId, "example-1");
    const sb = createSandbox({ ...base, projectId, profile: "development-cloud-session", dir: mkdtempSync(join(scratch, "sb-nostart-")), acceptance: { image, baseUrl: "http://127.0.0.1:1" } }, "made-up");
    return { projectId, store, v, sb };
  }
  async function expectNotPassed(projectId: string, r: Awaited<ReturnType<typeof runAcceptance>>, refused: RegExp) {
    expect(r.refused).toMatch(refused);
    expect(r).toMatchObject({ appAnswered: "not checked: the run was refused before this check", exit: null, args: null });
    expect(r.reading.outcome).toBe("not passed");
    expect(r.reading.items.map((i) => i.status)).toEqual(["did not run"]);
    expect(r.reading.summary).toBe(`did not run: the run was refused before its start: ${r.refused}`);
    const events = await listEvents(pool, projectId);
    expect(events.map((e) => e.kind)).toEqual(["acceptance.version.written", "acceptance.run.started", "acceptance.item", "acceptance.run.finished"]);
    expect(events[1]!.payload).toMatchObject({ run_id: r.runId, container_started: false, refused: r.refused });
    expect(events[2]!.payload).toMatchObject({ run_id: r.runId, status: "did not run" });
    expect(events[3]!.payload).toMatchObject({ run_id: r.runId, exit_code: null, outcome: "not passed", summary: r.reading.summary });
    const saved = JSON.parse(readFileSync(join(r.runFolder.builder, "report.json"), "utf8"));
    expect(saved).toMatchObject({ runId: r.runId, refused: r.refused, reading: { outcome: "not passed", summary: r.reading.summary } });
    expect(existsSync(r.runFolder.secretFile)).toBe(false);
  }

  it("Docker does not answer: refused before its start, naming Docker; 'not passed' in the run's events and report", async () => {
    const { projectId, store, v, sb } = await setUp(RUNNER_IMAGE);
    const saved = process.env.DOCKER_HOST;
    process.env.DOCKER_HOST = "unix:///nonexistent-p31b/docker.sock"; // short: a socket's path has a length limit
    try {
      const r = await runAcceptance({ pool, sandbox: sb, store, projectId, version: v.version, appUrl: "http://127.0.0.1:1", samplePassword: "made-up", checklistItems: 6 });
      await expectNotPassed(projectId, r, /^the runner cannot start: Docker did not answer \(.*(?:failed to connect to the docker API|Cannot connect to the Docker daemon) at unix:\/\/\/nonexistent-p31b\/docker\.sock.*\), so the runner image could not be checked: start Docker as CLAUDE\.md, Commands, says$/);
    } finally {
      if (saved === undefined) delete process.env.DOCKER_HOST;
      else process.env.DOCKER_HOST = saved;
    }
  });

  it("the runner image is not on this machine (it is built from the approved zip): refused before its start, naming the image; 'not passed'", async () => {
    const image = `builder-acceptance-runner:made-up-absent-${randomBytes(4).toString("hex")}`;
    const { projectId, store, v, sb } = await setUp(image);
    const r = await runAcceptance({ pool, sandbox: sb, store, projectId, version: v.version, appUrl: "http://127.0.0.1:1", samplePassword: "made-up", checklistItems: 6 });
    await expectNotPassed(projectId, r, new RegExp(`^the runner cannot start: the runner image ${image} is not on this machine: it is built from the approved browser zip`));
  });

  it("an image without the approved zip's label, or with another zip's, is refused; with the approved one it is accepted", () => {
    expect(runnerImageLabelProblem(RUNNER_IMAGE, JSON.stringify({ "builder.package": "3.1", [BROWSER_ZIP_LABEL]: BROWSER_ZIP_SHA256 }))).toBeNull();
    expect(runnerImageLabelProblem(RUNNER_IMAGE, JSON.stringify({ "builder.package": "3.1" }))).toMatch(/has no builder\.browser-zip-sha256 label, so it was not built by this version of the builder from the approved browser zip/);
    expect(runnerImageLabelProblem(RUNNER_IMAGE, "null")).toMatch(/has no builder\.browser-zip-sha256 label/);
    expect(runnerImageLabelProblem(RUNNER_IMAGE, JSON.stringify({ [BROWSER_ZIP_LABEL]: "0".repeat(64) }))).toMatch(/built from a browser zip with another fingerprint/);
    expect(runnerImageLabelProblem(RUNNER_IMAGE, "not json")).toMatch(/labels could not be read/);
  });

  it("a version that names no test is refused before its start (the store's check); 'not passed', never passed", async () => {
    const projectId = uniqueId("p_acc_notest");
    await createProject(pool, { id: projectId, name: "made-up", capUsd: 0 });
    const { store, v } = withManifest((m) => ({ ...m, items: [] }), projectId);
    const untouchable = new Proxy({}, { get: (_t, p) => { throw new Error(`the sandbox was used (${String(p)})`); } }) as Sandbox;
    const r = await runAcceptance({ pool, sandbox: untouchable, store, projectId, version: v.version, appUrl: "http://127.0.0.1:1", samplePassword: "made-up", checklistItems: 6 });
    expect(r.refused).toMatch(/^the version does not match its manifest: .*the manifest names no test/);
    expect(r.reading).toMatchObject({ outcome: "not passed", items: [] });
    expect(r.reading.summary).toMatch(/^did not run: /);
    const finished = (await listEvents(pool, projectId, "acceptance.run.finished"))[0]!;
    expect(finished.payload).toMatchObject({ outcome: "not passed" });
  });
});

describe("the mount rule: no engine container is given the store's data folder, a folder inside it, or one that holds it", () => {
  const dataDir = join(scratch, "rule", "data");
  mkdirSync(join(dataDir, "acceptance", "p", "v001"), { recursive: true });
  const outside = join(scratch, "rule", "workspace");
  mkdirSync(outside, { recursive: true });

  it("the rule itself, with links resolved on both sides", () => {
    expect(engineMountRefusal(dataDir, dataDir)).toMatch(/is the acceptance store's data folder or inside it/);
    expect(engineMountRefusal(join(dataDir, "acceptance", "p", "v001"), dataDir)).toMatch(/inside it/);
    expect(engineMountRefusal(join(scratch, "rule"), dataDir)).toMatch(/holds the acceptance store's data folder/);
    expect(engineMountRefusal("/", dataDir)).toMatch(/holds/);
    expect(engineMountRefusal(outside, dataDir)).toBeNull();
    const link = join(scratch, "rule", "link-to-version");
    symlinkSync(join(dataDir, "acceptance", "p", "v001"), link);
    expect(engineMountRefusal(link, dataDir)).toMatch(/inside it/);
    expect(engineMountRefusal(outside, undefined)).toBeNull();
    expect(engineMountRefusal(outside, "relative")).toMatch(/not an absolute path/);
  });

  it("runStreaming refuses an engine run with such a mount, before anything is started; createSandbox refuses an engine service whose own mounts break it", () => {
    const saved = process.env.BUILDER_DATA_DIR;
    process.env.BUILDER_DATA_DIR = dataDir;
    try {
      const dir = mkdtempSync(join(scratch, "sb-rule-"));
      const workspace = join(dir, "workspace");
      mkdirSync(workspace, { recursive: true });
      const sb = createSandbox({ ...base, profile: "development-cloud-session", dir, engine: { workspace, changeSets: join(builderDir, "scripted") } }, "made-up");
      expect(sb.engineMountSources).toEqual([workspace, join(dir, "engine-empty"), join(builderDir, "scripted")]);
      const go = (volumes: string[]) => () => sandbox.runStreaming(sb, "engine", ["true"], { container: "made-up-never-started", onLine: () => undefined, volumes });
      expect(go([`${join(dataDir, "acceptance", "p", "v001")}:/x:ro`])).toThrow(/The engine run is refused: .*inside it/);
      expect(go([`${dataDir}:/x:ro`])).toThrow(/refused/);
      expect(go([`${join(scratch, "rule")}:/x:ro`])).toThrow(/holds the acceptance store's data folder/);
      const dir2 = mkdtempSync(join(scratch, "sb-rule2-"));
      expect(() => createSandbox({ ...base, profile: "development-cloud-session", dir: dir2, engine: { workspace: join(dataDir, "acceptance"), changeSets: join(builderDir, "scripted") } }, "made-up")).toThrow(/The engine service is refused/);
    } finally {
      if (saved === undefined) delete process.env.BUILDER_DATA_DIR;
      else process.env.BUILDER_DATA_DIR = saved;
    }
  });
});

// ---------------------------------------------------------------------------------------------------

describe("the stand-in test of example 1", () => {
  const sources = standInSources("example-1");

  it("one file, for checklist item 1, at the top of the repository, outside builder/ and templates/", () => {
    expect(sources.map((s) => [s.number, s.file])).toEqual([[1, "item-01.spec.ts"]]);
    expect(relative(REPO_ROOT, STAND_IN_DIR)).toBe("stand-in-acceptance");
    expect(exampleChecklist("example-1").items[0]).toMatchObject({ number: 1, as_role: "employee" });
  });

  it('labelled "stand-in test" in its first line, its label line and its test title; it says Claude Code wrote it and that no model call was made', () => {
    const lines = sources[0]!.content.split("\n");
    expect(lines[0]).toBe("// Stand-in acceptance test, written in advance by Claude Code (the AI assistant building this project), not by the builder's acceptance writer. No model call by the builder.");
    expect(lines[1]).toBe(`// Label: stand-in test. Example 1, acceptance item 1. Version marker: ${MARKER_PLACEHOLDER}`);
    expect(sources[0]!.content).toContain('test("item 1 (stand-in test): an employee signs in, submits a five-day request, and sees it in their list with status waiting"');
  });

  it("it names no path or address of the runner, and reads no setting: the address is Playwright's baseURL, the password and run id are options", () => {
    const code = sources[0]!.content.split("\n").filter((l) => !l.startsWith("//")).join("\n");
    expect(code).not.toMatch(/\/runner|\/results|\/acceptance|\/run\/secrets|127\.0\.0\.1|localhost|process\.env|readFileSync/);
    expect(code).toContain('page.goto("/en/sign-in")');
    expect(code).toContain("samplePassword");
  });

  it("each step is a test.step, the status is read inside the list item found by the run's reason, not in the confirmation, and its screenshot is attached as item-screenshot", () => {
    const code = sources[0]!.content;
    expect([...code.matchAll(/test\.step\("([^"]+)"/g)].map((m) => m[1])).toEqual([
      "signs in as the sample employee",
      "opens My requests, then New leave request",
      "fills in Monday 3 May 2027 to Friday 7 May 2027, 5 working days, and this run's reason",
      "submits the request",
      "finds the request in My requests by this run's reason",
      "sees status waiting",
      "takes a full-page screenshot",
    ]);
    expect(code).toContain('page.getByTestId("leave-request").filter({ hasText: reason })');
    expect(code).toContain("await expect(item).toContainText(/waiting/i);");
    expect(code).toContain('testInfo.attach("item-screenshot"');
    expect(code).not.toContain("request-sent");
  });

  it("no container mounts the folder: the engine mounts builder/scripted and the workspace, the egress container builder/", () => {
    for (const mounted of [join(builderDir, "scripted"), builderDir, resolve(builderDir, "..", "templates")]) {
      expect(STAND_IN_DIR.startsWith(mounted + "/"), mounted).toBe(false);
    }
  });
});

describe("the deliberately broken copy (step 03), kept outside builder/scripted", () => {
  const broken = join(builderDir, "scripted-broken");
  const scripted = join(builderDir, "scripted");

  it("example 1 still has its two steps in builder/scripted, which every engine container mounts; step 03 is only in builder/scripted-broken", () => {
    expect(listSteps(scripted, "example-1")).toEqual(["01-data", "02-submitter-screen"]);
    expect(listSteps(broken, "example-1")).toEqual(["03-wrong-status"]);
  });

  it("chained after step 02: each copy matches its fingerprint, and each replace expects the file as step 02 left it", () => {
    const after02 = new Map<string, string>();
    for (const step of listSteps(scripted, "example-1")) for (const f of readManifest(scripted, "example-1", step).files) after02.set(f.path, f.sha256);
    const m = readManifest(broken, "example-1", "03-wrong-status");
    expect(m.files.map((f) => [f.path, f.op])).toEqual([
      ["src/app/[locale]/my-requests/new/actions.ts", "replace"],
      ["messages/en.json", "replace"],
      ["messages/ar.json", "replace"],
    ]);
    for (const f of m.files) {
      expect(sha256Of(readFileSync(join(broken, "example-1", "03-wrong-status", "files", f.path))), f.path).toBe(f.sha256);
      expect(f.expectSha256, f.path).toBe(after02.get(f.path));
      expect(TEMPLATE_PROTECTED_PATHS.some((p) => f.path === p), f.path).toBe(false);
    }
  });

  it('labelled: the action is "scripted" and says it is deliberately broken; the only change to it is the status; the banner says so in both languages', () => {
    const files = join(broken, "example-1", "03-wrong-status", "files");
    const action = readFileSync(join(files, "src/app/[locale]/my-requests/new/actions.ts"), "utf8");
    const before = readFileSync(join(scripted, "example-1", "02-submitter-screen", "files", "src/app/[locale]/my-requests/new/actions.ts"), "utf8");
    expect(action.split("\n")[0]).toBe(scriptedHeader("example-1", "03-wrong-status"));
    expect(action.split("\n")[1]).toContain("Deliberately broken copy (package 3.1)");
    expect(action.split("\n").slice(2).join("\n")).toBe(before.split("\n").slice(1).join("\n").replace('status: "waiting",', 'status: "approved",'));
    const en = JSON.parse(readFileSync(join(files, "messages", "en.json"), "utf8"));
    const ar = JSON.parse(readFileSync(join(files, "messages", "ar.json"), "utf8"));
    expect(en.app.sample_banner).toContain(SCRIPTED_BANNER.en);
    expect(en.app.sample_banner).toContain("deliberately broken copy");
    expect(ar.app.sample_banner).toContain(SCRIPTED_BANNER.ar);
    expect(ar.app.sample_banner).toContain("نسخة معطّلة عمداً");
  });

  it("the folder holds nothing but the manifest and the files it lists", () => {
    const listed = new Set<string>();
    for (const step of listSteps(broken, "example-1")) {
      listed.add(join(broken, "example-1", step, "manifest.json"));
      for (const f of readManifest(broken, "example-1", step).files) listed.add(join(broken, "example-1", step, "files", f.path));
    }
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(join(d, e.name), out) : out.push(join(d, e.name)));
      return out;
    };
    expect(walk(broken).filter((f) => !listed.has(f))).toEqual([]);
  });
});

describe("the runner image's own files", () => {
  it("the approved Ubuntu list is exactly the licence inventory's 109 install-deps packages at their versions; the unpack stage installs unzip only", () => {
    const tsv = readFileSync(join(REPO_ROOT, "docs", "licences", "raw", "ubuntu-runner-packages.tsv"), "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
    const from109 = tsv.filter((c) => c[2] === "109" || c[2] === "109 and 16").map((c) => `${c[0]}=${c[1]}`).sort();
    expect(from109).toHaveLength(109);
    expect(approvedPackages("runner")).toEqual(from109);
    expect(approvedPackages("unpack")).toEqual(tsv.filter((c) => c[0] === "unzip").map((c) => `${c[0]}=${c[1]}`));
  });

  it("the Dockerfile names both bases by their approved digests, the zip by its SHA-256, the approved lists, Node's licence notice, and never a registry to push to", () => {
    const df = readFileSync(join(RUNNER_DIR, "Dockerfile"), "utf8");
    // Written out, tag@digest, so that the approved-images check reads them (test/approved-images.test.ts).
    expect(RUNNER_BASE_IMAGES).toEqual({
      ubuntu: "ubuntu:24.04@sha256:2198e4c65076e9cb0b3d695219df667c0e3b0072da64ca3c2648aca17dcecaf5",
      node: "node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee",
    });
    expect(df.split("\n").filter((l) => l.startsWith("FROM "))).toEqual([
      "FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS node",
      "FROM ubuntu:24.04@sha256:2198e4c65076e9cb0b3d695219df667c0e3b0072da64ca3c2648aca17dcecaf5 AS unpack",
      "FROM ubuntu:24.04@sha256:2198e4c65076e9cb0b3d695219df667c0e3b0072da64ca3c2648aca17dcecaf5",
    ]);
    expect(df.match(/^FROM /gm)).toHaveLength(3);
    expect(df).toContain(`echo "${BROWSER_ZIP_SHA256}  /browser/chrome-headless-shell-linux64.zip" | sha256sum -c -`);
    expect(df).toContain("sh /build/install-exactly.sh /build/approved-runner-packages.txt");
    expect(df).toContain("sh /build/install-exactly.sh /build/approved-unpack-packages.txt");
    expect(df).toContain("COPY --from=node /usr/local/LICENSE /usr/local/LICENSE");
    expect(df).toContain("playwright install-deps --dry-run chromium-headless-shell");
    expect(df).not.toMatch(/curl|wget|storage\.googleapis\.com|docker push/);
  });

  it("the runner's configuration: no retries, one worker, forbidOnly, the trace on without its screencast (no frames of the screen), the screenshot on, no video, the JSON report with this run's id and the manifest's fingerprint", () => {
    const cfg = readFileSync(join(RUNNER_DIR, "playwright.config.mjs"), "utf8");
    expect(cfg.match(/^\s*trace:.*$/gm)).toEqual(['    trace: { mode: "on", screenshots: false },']);
    for (const s of ['testDir: "/acceptance"', "retries: 0", "workers: 1", "forbidOnly: true", 'screenshot: "on"', 'video: "off"', '["json", { outputFile: "/results/results.json" }]', "metadata: { runId: process.env.RUN_ID", 'readFileSync("/run/secrets/sample-password"']) {
      expect(cfg, s).toContain(s);
    }
  });

  it("the browser cache: unset, missing, a link, or another fingerprint is refused before any build", async () => {
    await expect(checkedBrowserZip({})).rejects.toThrow(/BUILDER_BROWSER_CACHE is not set/);
    const cache = mkdtempSync(join(scratch, "cache-"));
    await expect(checkedBrowserZip({ BUILDER_BROWSER_CACHE: cache })).rejects.toThrow(/has no chrome-headless-shell-linux64\.zip/);
    writeFileSync(join(cache, "chrome-headless-shell-linux64.zip"), "made-up, not the browser");
    await expect(checkedBrowserZip({ BUILDER_BROWSER_CACHE: cache })).rejects.toThrow(/not the approved/);
    const cache2 = mkdtempSync(join(scratch, "cache-"));
    symlinkSync(join(cache, "chrome-headless-shell-linux64.zip"), join(cache2, "chrome-headless-shell-linux64.zip"));
    await expect(checkedBrowserZip({ BUILDER_BROWSER_CACHE: cache2 })).rejects.toThrow(/not a plain file/);
  });

  it("a trace's entries are read from its zip directory; frames of the screen (screencast/*.jpeg) are picked out; a file that is not a zip is refused", () => {
    // A made-up zip of four stored entries, with a comment at its end, built byte by byte to the zip format.
    const entries = ["trace.trace", "screencast/page@made-up-1700000000000.jpeg", "resources/made-up.png", "screenshots/made-up.png"];
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const name of entries) {
      const n = Buffer.from(name, "utf8");
      const data = Buffer.from("made-up");
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(n.length, 26);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt32LE(data.length, 20);
      central.writeUInt32LE(data.length, 24);
      central.writeUInt16LE(n.length, 28);
      central.writeUInt32LE(offset, 42);
      locals.push(local, n, data);
      centrals.push(central, n);
      offset += 30 + n.length + data.length;
    }
    const directory = Buffer.concat(centrals);
    const comment = Buffer.from("made-up comment");
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(comment.length, 20);
    const names = zipEntryNames(Buffer.concat([...locals, directory, end, comment]));
    expect(names).toEqual(entries);
    expect(traceScreenFrames(names)).toEqual(["screencast/page@made-up-1700000000000.jpeg"]);
    expect(traceScreenFrames(["trace.trace", "trace.network", "resources/made-up.png"])).toEqual([]);
    expect(() => zipEntryNames(Buffer.from("made-up, not a zip file at all"))).toThrow(/not a zip file/);
  });
});

// ---------------------------------------------------------------------------------------------------
// The evidence (review of 13 Nov 2026, blocking item): a check cited as passed must have its output in the
// repository. Two build logs were named `*.log`, which the repository's .gitignore leaves out, so they were
// cited but never committed.

const EVIDENCE_DIR = join("evidence", "2026-11-13-package-3.1");
/** True when git would leave this path (relative to the repository) out, tracked or not. */
const gitIgnores = (path: string): boolean => {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", "--", path], { cwd: REPO_ROOT, stdio: "ignore" });
    return true; // exit 0: ignored
  } catch (err) {
    if ((err as { status?: number }).status === 1) return false; // exit 1: not ignored
    throw err;
  }
};
const gitTracks = (path: string): boolean => execFileSync("git", ["ls-files", "--", path], { cwd: REPO_ROOT, encoding: "utf8" }).trim() !== "";

describe("package 3.1's evidence is in the repository, not left out by .gitignore", () => {
  it("no file the demonstration writes into its evidence folder has a name git ignores", () => {
    const src = readFileSync(join(builderDir, "scripts", "demo-acceptance.ts"), "utf8");
    const names = [...src.matchAll(/join\(outDir, ((?:"[^"]+"(?:, )?)+)\)/g)].map((m) => [...m[1]!.matchAll(/"([^"]+)"/g)].map((n) => n[1]).join("/"));
    expect(names).toEqual(expect.arrayContaining(["runner-packages.txt", "attempts-table.md", "events.json", "mounts.json", "probe-engine-network.jsonl"]));
    expect(names.filter((n) => n.startsWith("runner-image-build."))).toHaveLength(1);
    expect(names.filter((n) => gitIgnores(join(EVIDENCE_DIR, n)))).toEqual([]);
  });

  it("every file the evidence summary lists under 'Files here' is tracked by git", () => {
    const summary = readFileSync(join(REPO_ROOT, EVIDENCE_DIR, "acceptance.md"), "utf8");
    const section = summary.split(/^## Files here$/m)[1]?.split(/^## /m)[0] ?? "";
    const listed = [...section.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).filter((n) => /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9._-]+)*(\.(txt|md|json|jsonl|png)|\/)$/.test(n));
    expect(listed).toEqual(expect.arrayContaining(["run-demo.txt", "runner-image-build.txt", "runner-image-first-build.txt", "screens/"]));
    expect(listed.filter((n) => !gitTracks(join(EVIDENCE_DIR, n)))).toEqual([]);
  });
});

function statMode(p: string): number {
  // lstat: the mode of the path itself.
  return (process.getBuiltinModule("node:fs") as typeof import("node:fs")).lstatSync(p).mode;
}
void cpSync;
