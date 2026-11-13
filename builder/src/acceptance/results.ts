/**
 * Reading an acceptance run's results (package 3.1; docs/design/package-3.1.md, section 4).
 *
 * Every item in the version's manifest starts as "did not run". It becomes "passed" only if all of these
 * hold: the app answered before the start; the runner's container ended with exit code 0 or 1 within its
 * time limit; results.json was read under the rules below, parses, and is in the shape of Playwright's
 * JSON report (reportShapeProblem; the manifest too, in the store's shape); its metadata holds this run's id and
 * this version's manifest fingerprint; the item's test appears once, in the manifest's file for that item;
 * it expected to pass, its outcome is "expected", it has exactly one result, on retry 0, with status
 * "passed", and no skip, fixme or fail annotation; and its screenshot (the attachment "item-screenshot")
 * exists. It becomes "failed" only on a recorded failure (status "failed" or "timedOut"), with the step
 * named, or "no step named" for a failure outside a step or a test's own time limit. Everything else stays
 * "did not run": a kill, exit code 137, the overall time limit, a skipped or interrupted test, a missing
 * or unreadable file, a file not in that shape.
 *
 * The run as a whole has one outcome (package 3.1b): "passed" only when the version names at least one
 * item, every item passed and nothing else was found about the run; "failed" when an item recorded a
 * failure; "not passed" otherwise. A version that names no test is never read as passed, whatever the
 * results file holds: with no test, no browser ran.
 *
 * The run folder is written by the runner, and the builder runs as root (known gap 57), so it is read
 * without following links: each path is checked part by part with lstat, only plain files are read, only
 * inside the run folder, within size limits. An attachment whose path is outside /results is ignored.
 *
 * Playwright's error messages carry lines of the test's source, so they are not put into events: the
 * caller writes them into the run's builder folder and the event holds the file's path and fingerprint.
 */
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";
import { manifestShapeProblem, sha256, type VersionManifest } from "./store.js";

export type ItemStatus = "passed" | "failed" | "did not run";

export interface ItemResult {
  number: number;
  file: string;
  status: ItemStatus;
  /** Why it has that status, in plain words. */
  why: string;
  /** The test's title, as the results give it (test text), when the test was found. */
  title?: string;
  /** For a failure: the step that failed, or "no step named". */
  step?: string;
  /** For a failure: Playwright's error message (it may quote the test's source), colour codes removed. */
  errorText?: string;
  /** The item's own screenshot (passed), or the screenshot taken when it failed. Host path, inside the run folder. */
  screenshot?: { path: string; sha256: string };
  /** The trace, when one is there. Host path. */
  trace?: { path: string; sha256: string };
}

/** The run's outcome: never "passed" unless at least one test ran and every item passed. Never "skipped". */
export type RunOutcome = "passed" | "failed" | "not passed";

export interface RunReading {
  /** "passed", "failed" or "not passed" (package 3.1b): what the run's record says, in one word. */
  outcome: RunOutcome;
  items: ItemResult[];
  /** What was found about the run as a whole (unreadable results, a wrong id, errors outside any test). */
  runProblems: string[];
  /** One line: "version passed; checklist incomplete (...)", "version failed: ...", or "did not run: ...". */
  summary: string;
}

export interface RunFacts {
  /** The host folder mounted at /results in the runner. */
  resultsDir: string;
  runId: string;
  manifest: VersionManifest;
  manifestSha256: string;
  /** Set when the builder refused the run before its start (a version that does not match its manifest or the event log, or an app that did not answer). */
  refused?: string | null;
  /** The app's check before the start: true, or why it did not answer. */
  appAnswered: true | string;
  /** How the runner's container ended; null if it was never started. */
  exit: { code: number | null; timedOut: boolean } | null;
  /** How many items the app spec's checklist has (example 1: 6). */
  checklistItems: number;
}

export const RESULTS_MAX_BYTES = 20 * 1024 * 1024;
export const SCREENSHOT_MAX_BYTES = 20 * 1024 * 1024;
export const TRACE_MAX_BYTES = 100 * 1024 * 1024;
export const ITEM_SCREENSHOT = "item-screenshot";

/** Colour and cursor codes, as terminals use them. */
export const plainText = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

/**
 * A plain file inside `root`, by a relative path, read without following any link: every part of the path
 * is checked with lstat. Returns the host path, or a reason it is refused.
 */
export function plainFileInside(root: string, rel: string, maxBytes: number): { path: string; size: number } | { refused: string } {
  if (rel === "" || isAbsolute(rel)) return { refused: `"${rel}" is not a path inside the run folder` };
  const norm = normalize(rel);
  if (norm.startsWith("..") || norm.split(sep).includes("..")) return { refused: `"${rel}" leads outside the run folder` };
  const rootSt = lstatSync(root, { throwIfNoEntry: false });
  if (!rootSt?.isDirectory()) return { refused: "the run folder is missing or is not a folder" };
  const parts = norm.split(sep).filter(Boolean);
  let at = root;
  for (let i = 0; i < parts.length; i++) {
    at = join(at, parts[i]!);
    const st = lstatSync(at, { throwIfNoEntry: false });
    if (!st) return { refused: `${rel} is missing` };
    if (st.isSymbolicLink()) return { refused: `${rel} passes through a link, which is not followed` };
    if (i < parts.length - 1) {
      if (!st.isDirectory()) return { refused: `${rel}: a part of the path is not a folder` };
    } else {
      if (!st.isFile()) return { refused: `${rel} is not a plain file` };
      if (st.size > maxBytes) return { refused: `${rel} is larger than ${maxBytes} bytes` };
      return { path: at, size: st.size };
    }
  }
  return { refused: `"${rel}" is not a file path` };
}

/** An attachment's container path, under /results, as a host file in the run folder; or why not. */
function attachmentFile(resultsDir: string, containerPath: unknown, maxBytes: number): { path: string; sha256: string } | { refused: string } {
  if (typeof containerPath !== "string" || !containerPath.startsWith("/results/")) return { refused: "its path is not under /results, so it is ignored" };
  const found = plainFileInside(resultsDir, containerPath.slice("/results/".length), maxBytes);
  if ("refused" in found) return found;
  return { path: found.path, sha256: sha256(readFileSync(found.path)) };
}

interface JsonStep {
  title?: string;
  error?: unknown;
  steps?: JsonStep[];
}
interface JsonResult {
  status?: string;
  retry?: number;
  error?: { message?: string };
  errors?: Array<{ message?: string }>;
  steps?: JsonStep[];
  annotations?: Array<{ type?: string }>;
  attachments?: Array<{ name?: string; path?: string; contentType?: string }>;
}
interface JsonTest {
  expectedStatus?: string;
  status?: string;
  annotations?: Array<{ type?: string }>;
  results?: JsonResult[];
}
interface JsonSpec {
  title?: string;
  file?: string;
  tests?: JsonTest[];
}
interface JsonSuite {
  file?: string;
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}

/** How deep suites may sit inside suites, and steps inside steps. Playwright's own reports go a few levels. */
export const MAX_NESTING = 50;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
class ShapeProblem extends Error {}

/**
 * Why a parsed results file is not in the shape the reader walks (Playwright's JSON report, as typed in
 * its testReporter.d.ts: suites, specs, tests, results, steps, annotations, attachments, errors), or null.
 * The file is the runner's to write, so nothing in it is trusted: every list the reader walks must be a
 * list of objects, every field it reads must have its type where present, and suites and steps may nest
 * at most MAX_NESTING deep. Fields the reader does not read are not checked. Names only fields and
 * places, never a value from the file.
 */
export function reportShapeProblem(report: unknown): string | null {
  const fail = (what: string): never => {
    throw new ShapeProblem(what);
  };
  const text = (o: Record<string, unknown>, at: string, ...keys: string[]) => {
    for (const k of keys) if (o[k] !== undefined && typeof o[k] !== "string") fail(`${at}.${k} is not text`);
  };
  const object = (o: Record<string, unknown>, at: string, k: string) => {
    if (o[k] !== undefined && !isObject(o[k])) fail(`${at}${at ? "." : ""}${k} is not an object`);
  };
  const list = (o: Record<string, unknown>, at: string, k: string, each: (x: Record<string, unknown>, at: string) => void) => {
    const v = o[k];
    if (v === undefined) return;
    const where = `${at}${at ? "." : ""}${k}`;
    if (!Array.isArray(v)) fail(`${where} is not a list`);
    (v as unknown[]).forEach((x, i) => {
      if (!isObject(x)) fail(`${where}[${i}] is not an object`);
      each(x as Record<string, unknown>, `${where}[${i}]`);
    });
  };
  const error = (e: Record<string, unknown>, at: string) => text(e, at, "message");
  const annotation = (a: Record<string, unknown>, at: string) => text(a, at, "type");
  const step = (depth: number) => (s: Record<string, unknown>, at: string) => {
    if (depth > MAX_NESTING) fail(`steps are nested more than ${MAX_NESTING} deep`);
    text(s, at, "title");
    object(s, at, "error");
    list(s, at, "steps", step(depth + 1));
  };
  const result = (r: Record<string, unknown>, at: string) => {
    text(r, at, "status");
    if (r.retry !== undefined && !Number.isInteger(r.retry)) fail(`${at}.retry is not a whole number`);
    object(r, at, "error");
    if (isObject(r.error)) error(r.error, `${at}.error`);
    list(r, at, "errors", error);
    list(r, at, "steps", step(1));
    list(r, at, "annotations", annotation);
    list(r, at, "attachments", (a, where) => text(a, where, "name", "path", "contentType"));
  };
  const test = (t: Record<string, unknown>, at: string) => {
    text(t, at, "expectedStatus", "status");
    list(t, at, "annotations", annotation);
    list(t, at, "results", result);
  };
  const spec = (s: Record<string, unknown>, at: string) => {
    text(s, at, "title", "file");
    list(s, at, "tests", test);
  };
  const suite = (depth: number) => (s: Record<string, unknown>, at: string) => {
    if (depth > MAX_NESTING) fail(`suites are nested more than ${MAX_NESTING} deep`);
    text(s, at, "title", "file");
    list(s, at, "specs", spec);
    list(s, at, "suites", suite(depth + 1));
  };
  try {
    if (!isObject(report)) fail("it is not an object");
    const r = report as Record<string, unknown>;
    object(r, "", "config");
    if (isObject(r.config)) object(r.config, "config", "metadata");
    list(r, "", "errors", error);
    list(r, "", "suites", suite(1));
    return null;
  } catch (err) {
    if (err instanceof ShapeProblem) return err.message;
    throw err;
  }
}

function allSpecs(suites: JsonSuite[] | undefined, out: JsonSpec[] = []): JsonSpec[] {
  for (const s of suites ?? []) {
    for (const sp of s.specs ?? []) out.push({ ...sp, file: sp.file ?? s.file });
    allSpecs(s.suites, out);
  }
  return out;
}

/** The first step, depth first, that carries an error: the innermost one inside it if there is one. */
function failedStep(steps: JsonStep[] | undefined): string | undefined {
  for (const st of steps ?? []) {
    if (st.error !== undefined) return failedStep(st.steps) ?? st.title;
  }
  return undefined;
}

const SKIPPING = new Set(["skip", "fixme", "fail"]);

/**
 * Read a run under the rules above. Pure apart from reading files in the run folder. It does not throw:
 * a manifest not in the store's shape gives no item and "did not run"; a results file not in the shape
 * the reader walks, or anything else that fails while it is read, gives every item "did not run".
 */
export function readRun(f: RunFacts): RunReading {
  const manifestShape = manifestShapeProblem(f.manifest);
  if (manifestShape) {
    const why = `the manifest is not in the shape the store writes (${manifestShape}), so no item is read`;
    return { outcome: "not passed", items: [], runProblems: [why], summary: `did not run: ${why}` };
  }
  const items: ItemResult[] = f.manifest.items.map((it) => ({ number: it.number, file: it.file, status: "did not run" as ItemStatus, why: "not reached" }));
  const runProblems: string[] = [];
  // Every item afresh, so that nothing set by a reading cut short (a status, a screenshot) is kept.
  const allDidNotRun = (why: string): RunReading => ({
    outcome: "not passed",
    items: f.manifest.items.map((it) => ({ number: it.number, file: it.file, status: "did not run", why })),
    runProblems: [...runProblems, why],
    summary: `did not run: ${why}`,
  });
  if (f.refused) return allDidNotRun(`the run was refused before its start: ${f.refused}`);
  if (f.appAnswered !== true) return allDidNotRun(`the app did not answer before the start (${f.appAnswered}), so the runner was not started`);
  if (!f.exit) return allDidNotRun("the runner was not started");
  if (f.exit.timedOut) return allDidNotRun("the run went past its time limit and its container was stopped");
  if (f.exit.code !== 0 && f.exit.code !== 1) return allDidNotRun(`the runner's container ended with exit code ${f.exit.code ?? "none (killed)"}`);
  // Package 3.1b: with no item there is nothing to pass. Without this, every one of no items "passed".
  if (f.manifest.items.length === 0) return allDidNotRun("the version names no test, so no browser test ran");
  try {
    return readResults(f, items, runProblems, allDidNotRun);
  } catch (err) {
    // A backstop: the shape check is meant to leave nothing that throws below it.
    return allDidNotRun(`the results file could not be read: ${plainText(String((err as Error)?.message ?? err)).split("\n")[0]!.slice(0, 200)}`);
  }
}

function readResults(f: RunFacts, items: ItemResult[], runProblems: string[], allDidNotRun: (why: string) => RunReading): RunReading {
  const found = plainFileInside(f.resultsDir, "results.json", RESULTS_MAX_BYTES);
  if ("refused" in found) return allDidNotRun(`the results file cannot be read: ${found.refused}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(found.path, "utf8"));
  } catch {
    return allDidNotRun("the results file does not parse");
  }
  if (parsed === null || typeof parsed !== "object") return allDidNotRun("the results file does not parse");
  const shape = reportShapeProblem(parsed);
  if (shape) return allDidNotRun(`the results file is not in the shape the reader expects: ${shape}`);
  const report = parsed as { config?: { metadata?: { runId?: unknown; manifestSha256?: unknown } }; suites?: JsonSuite[]; errors?: Array<{ message?: string }> };
  const md = report.config?.metadata;
  if (md?.runId !== f.runId) return allDidNotRun(`the results are not this run's (run id ${JSON.stringify(md?.runId)}, expected ${f.runId})`);
  if (md?.manifestSha256 !== f.manifestSha256) return allDidNotRun("the results are not for this version (the manifest's fingerprint differs)");
  for (const e of report.errors ?? []) runProblems.push(`an error outside any test: ${plainText(String(e?.message ?? "")).split("\n")[0]}`);

  const specs = allSpecs(report.suites);
  const known = new Set(f.manifest.items.map((i) => i.file));
  for (const sp of specs) if (!known.has(String(sp.file))) runProblems.push(`a test in ${String(sp.file)}, which the manifest does not name, is not counted`);

  for (const it of items) {
    const tests = specs.filter((sp) => sp.file === it.file).flatMap((sp) => (sp.tests ?? []).map((t) => ({ sp, t })));
    if (tests.length !== 1) {
      it.why = `its file holds ${tests.length} tests in the results; exactly one is needed`;
      continue;
    }
    const { sp, t } = tests[0]!;
    it.title = String(sp.title ?? "");
    const results = t.results ?? [];
    if (results.length !== 1) {
      it.why = `its test has ${results.length} results; exactly one is needed`;
      continue;
    }
    const r = results[0]!;
    if (r.retry !== 0) {
      it.why = `its result is from retry ${String(r.retry)}, not the first try`;
      continue;
    }
    const marks = [...(t.annotations ?? []), ...(r.annotations ?? [])].map((a) => String(a?.type)).filter((a) => SKIPPING.has(a));
    if (marks.length) {
      it.why = `its test is marked "${marks.join(", ")}"`;
      continue;
    }
    if (t.expectedStatus !== "passed") {
      it.why = `its test was not expected to pass (expected status "${String(t.expectedStatus)}")`;
      continue;
    }
    const trace = (r.attachments ?? []).find((a) => a.name === "trace");
    if (trace) {
      const tr = attachmentFile(f.resultsDir, trace.path, TRACE_MAX_BYTES);
      if (!("refused" in tr)) it.trace = tr;
    }
    if (t.status === "expected" && r.status === "passed") {
      const shot = (r.attachments ?? []).filter((a) => a.name === ITEM_SCREENSHOT);
      if (shot.length !== 1) {
        it.why = `its screenshot ("${ITEM_SCREENSHOT}") is ${shot.length === 0 ? "missing" : "given more than once"}`;
        continue;
      }
      const file = attachmentFile(f.resultsDir, shot[0]!.path, SCREENSHOT_MAX_BYTES);
      if ("refused" in file) {
        it.why = `its screenshot cannot be read: ${file.refused}`;
        continue;
      }
      it.status = "passed";
      it.why = "ran once and passed, with its screenshot";
      it.screenshot = file;
      continue;
    }
    if (t.status === "unexpected" && (r.status === "failed" || r.status === "timedOut")) {
      it.status = "failed";
      it.step = failedStep(r.steps) ?? "no step named";
      it.why = r.status === "timedOut" ? "it ran past its own time limit" : "it ran and failed";
      const msg = r.error?.message ?? r.errors?.[0]?.message;
      if (msg) it.errorText = plainText(String(msg));
      const shot = (r.attachments ?? []).find((a) => a.name === "screenshot");
      if (shot) {
        const file = attachmentFile(f.resultsDir, shot.path, SCREENSHOT_MAX_BYTES);
        if (!("refused" in file)) it.screenshot = file;
      }
      continue;
    }
    it.why = `its result is "${String(r.status)}" with outcome "${String(t.status)}", which is neither a pass nor a recorded failure`;
  }

  const passed = items.filter((i) => i.status === "passed");
  const failed = items.filter((i) => i.status === "failed");
  let summary: string;
  let outcome: RunOutcome;
  if (failed.length) {
    outcome = "failed";
    summary = `version failed: ${failed.map((i) => `item ${i.number} failed at step "${i.step}"`).join("; ")}`;
  } else if (passed.length === items.length && runProblems.length === 0) {
    outcome = "passed";
    const missing = f.checklistItems - items.length;
    summary = missing > 0 ? `version passed; checklist incomplete (${missing} of the app spec's ${f.checklistItems} checklist items have no test)` : "version passed";
  } else {
    outcome = "not passed";
    summary = `version not passed: ${items.filter((i) => i.status === "did not run").map((i) => `item ${i.number} did not run (${i.why})`).concat(runProblems).join("; ")}`;
  }
  return { outcome, items, runProblems, summary };
}
