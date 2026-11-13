/**
 * One acceptance run (package 3.1; design note 2.7; docs/design/package-3.1.md, sections 3 to 5).
 *
 * Before the runner's container starts, the builder checks that the version's files match its manifest
 * and that the manifest matches the builder's own `acceptance.version.written` event; that Docker answers
 * and the runner image the sandbox names is on this machine, labelled with the approved browser zip's
 * fingerprint (package 3.1b); and that the right app answers: Compose reports the project's app container
 * running and healthy, and the app's address answers its sign-in page, asked from a short-lived container
 * on the runner's own network (`front`), never from the machine (package 0.6c). A run refused at that
 * point never starts the runner's container, every item is reported "did not run", and the run's outcome
 * is "not passed".
 *
 * The runner's container (sandbox manager, `acceptance` service) sees the version read-only at
 * /acceptance, a fresh run folder at /results and the sample password at /run/secrets/sample-password,
 * and has two settings, BASE_URL and RUN_ID. When it has ended, the builder reads the run folder under
 * its own rules (results.ts) and then writes the events: `acceptance.run.started`, one
 * `acceptance.item` per item, and `acceptance.run.finished`, each with the run id, the version, its
 * manifest fingerprint and written_by "stand-in". Playwright's error messages, which can quote the test's
 * source, are written to files in the run's builder folder; the events hold their paths and fingerprints.
 */
import { chownSync, chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { dockerEnv, sandbox as sandboxManager, type Sandbox, type StreamingEnd, type StreamingRun } from "../sandbox/manager.js";
import { appendEvent, listEvents, type Event } from "../store/events.js";
import { readRun, type RunReading } from "./results.js";
import { RUNNER_UID, runnerImageProblem } from "./runner-image.js";
import { newRunFolder, newRunId, projectDir, sha256, STAND_IN_LABEL, verifyVersion, type AcceptanceStore, type RunFolder } from "./store.js";

/** The runner's command: Playwright Test with the runner's own configuration, baked into its image. */
export const RUNNER_COMMAND = ["node", "/runner/node_modules/@playwright/test/cli.js", "test", "--config", "/runner/playwright.config.mjs"];
export const DEFAULT_RUN_TIMEOUT_MS = 600_000;

export interface AcceptanceRunInput {
  pool: pg.Pool;
  sandbox: Sandbox;
  store: AcceptanceStore;
  projectId: string;
  version: string;
  /** The app's address, http://app:<port>, as the check container asks it before the start: the same as the runner's BASE_URL. */
  appUrl: string;
  samplePassword: string;
  /** How many items the app spec's checklist has. */
  checklistItems: number;
  /** The runner's container is stopped after this long, and every item is then "did not run". */
  timeoutMs?: number;
  runId?: string;
  /** Called once the runner's container has been asked for, with its handle (the evidence inspects it while it runs). */
  onStarted?: (run: StreamingRun) => void;
  /** Each line the runner prints (Playwright's line reporter). */
  onLine?: (line: string) => void;
}

export interface AcceptanceReport {
  runId: string;
  version: string;
  manifestSha256: string | null;
  writtenBy: "stand-in";
  runFolder: RunFolder;
  /** Why the run was refused before its start, if it was. */
  refused: string | null;
  appAnswered: true | string;
  exit: StreamingEnd | null;
  /** The exact `docker compose run` arguments, if the container was asked for. */
  args: string[] | null;
  reading: RunReading;
  output: string[];
  events: Event[];
}

/**
 * The app container is running and healthy by Compose, and its address answers its sign-in page with 200,
 * asked from a short-lived container of the `check` service on the project's `front` network (package 0.6c):
 * the builder's own process never connects to the app.
 */
export async function appAnswers(sb: Sandbox, appUrl: string): Promise<true | string> {
  let services: Array<{ Service?: string; State?: string; Health?: string }>;
  try {
    const out = (await sandboxManager.ps(sb)).trim();
    services = out ? (JSON.parse(`[${out.split("\n").join(",")}]`) as typeof services) : [];
  } catch (err) {
    return `Compose could not list the project's containers (${(err as Error).message.split("\n")[0]})`;
  }
  const app = services.find((s) => s.Service === "app");
  if (!app) return "the project's app container is not running";
  if (app.State !== "running" || app.Health !== "healthy") return `the project's app container is ${app.State ?? "in no state"}${app.Health ? ` (${app.Health})` : ""}`;
  try {
    const res = await sandboxManager.askApp(sb, `${appUrl}/en/sign-in`);
    if ("error" in res) return `the app's address did not answer, asked from the project's network (${res.error})`;
    if (res.status !== 200) return `the app's sign-in page answered ${res.status}`;
  } catch (err) {
    return `the app's address could not be asked from the project's network (${(err as Error).message.split("\n")[0]})`;
  }
  return true;
}

/** The version as the builder recorded it: its last `acceptance.version.written` event, compared with the manifest on disk. */
export async function versionMatchesEvent(pool: pg.Pool, projectId: string, version: string, manifestSha256: string, items: Array<{ number: number; file: string; sha256: string }>): Promise<string | null> {
  const events = (await listEvents(pool, projectId, "acceptance.version.written")).filter((e) => e.payload.version === version);
  const last = events[events.length - 1];
  if (!last) return `the event log has no record of version ${version} being written`;
  if (last.payload.manifest_sha256 !== manifestSha256) return `the manifest on disk is not the one the event log recorded for version ${version}`;
  // Compared item by item: the database stores the event's fields in an order of its own.
  const line = (i: { number?: unknown; file?: unknown; sha256?: unknown }) => `${String(i.number)}|${String(i.file)}|${String(i.sha256)}`;
  const recorded = (Array.isArray(last.payload.items) ? (last.payload.items as Array<Record<string, unknown>>) : []).map(line).join("\n");
  const onDisk = items.map(line).join("\n");
  if (recorded !== onDisk) return `the manifest's items are not the ones the event log recorded for version ${version}`;
  return null;
}

export async function runAcceptance(input: AcceptanceRunInput): Promise<AcceptanceReport> {
  const { pool, sandbox: sb, store, projectId, version } = input;
  const runId = input.runId ?? newRunId();
  const runFolder = newRunFolder(store, projectId, runId);
  const output: string[] = [];
  const common = { run_id: runId, version, written_by: "stand-in" as const, label: STAND_IN_LABEL };

  // 1. The version, against its manifest and against the event log.
  const check = verifyVersion(store, projectId, version);
  let refused: string | null = null;
  if (!check.ok) refused = `the version does not match its manifest: ${check.problems.join("; ")}`;
  else {
    const mismatch = await versionMatchesEvent(pool, projectId, version, check.manifestSha256!, check.manifest!.items);
    if (mismatch) refused = mismatch;
  }
  const manifestSha256 = check.manifestSha256 ?? null;
  // 2. Docker answers, and the runner image is here, built from the approved browser zip (package 3.1b).
  if (!refused) {
    let imageProblem: string | null;
    try {
      imageProblem = sb.acceptanceImage ? await runnerImageProblem(sb.acceptanceImage, dockerEnv(sb)) : "the sandbox has no acceptance service";
    } catch (err) {
      imageProblem = `Docker's settings could not be used (${(err as Error).message.split("\n")[0]})`;
    }
    if (imageProblem) refused = `the runner cannot start: ${imageProblem}`;
  }
  // 3. The right app answers.
  const appAnswered: true | string = refused ? "not checked: the run was refused before this check" : await appAnswers(sb, input.appUrl);
  if (!refused && appAnswered !== true) refused = `the app did not answer before the start: ${appAnswered}`;

  let exit: StreamingEnd | null = null;
  let args: string[] | null = null;
  if (!refused) {
    // 4. The runner's container, with the run's own mounts.
    writeFileSync(runFolder.secretFile, input.samplePassword, { mode: 0o400 });
    if (process.getuid?.() === 0) {
      chownSync(runFolder.results, RUNNER_UID, RUNNER_UID);
      chownSync(runFolder.secretFile, RUNNER_UID, RUNNER_UID);
    } else {
      // Not root: the runner's user cannot be given the folder, so it is opened to every user (development machine only).
      chmodSync(runFolder.results, 0o777);
      chmodSync(runFolder.secretFile, 0o444);
    }
    const versionDir = join(projectDir(store, projectId), version);
    try {
      const run = sandboxManager.runStreaming(sb, "acceptance", RUNNER_COMMAND, {
        container: `${sb.projectName}-acceptance-${runId}`.slice(0, 120),
        volumes: [`${versionDir}:/acceptance:ro`, `${runFolder.results}:/results`, `${runFolder.secretFile}:/run/secrets/sample-password:ro`],
        env: { RUN_ID: runId },
        onLine: (l) => {
          output.push(l);
          input.onLine?.(l);
        },
        timeoutMs: input.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
      });
      args = run.args ?? null;
      input.onStarted?.(run);
      exit = await run.done;
    } finally {
      // The password file is not kept after the run.
      rmSync(runFolder.secretFile, { force: true });
    }
  }

  // 5. The results, under the builder's own rules; then the events. verifyVersion gives no manifest that is not
  // in the store's shape, so such a version is refused and reported "did not run" with no item, and readRun does not throw.
  const reading = readRun({
    resultsDir: runFolder.results,
    runId,
    manifest: check.manifest ?? { version, project_id: projectId, written_by: "stand-in", written_by_note: "", written_at: "", app_spec_sha256: "", marker: "", items: [] },
    manifestSha256: manifestSha256 ?? "",
    refused,
    appAnswered,
    exit: exit ? { code: exit.code, timedOut: Boolean(exit.timedOut) } : null,
    checklistItems: input.checklistItems,
  });
  const events: Event[] = [];
  events.push(
    await appendEvent(pool, projectId, "acceptance.run.started", {
      ...common,
      manifest_sha256: manifestSha256,
      base_url: input.appUrl,
      app_answered: appAnswered,
      container_started: exit !== null,
      refused,
    }),
  );
  for (const it of reading.items) {
    let failureFile: { path: string; sha256: string } | null = null;
    if (it.errorText) {
      const path = join(runFolder.builder, `item-${String(it.number).padStart(2, "0")}-failure.txt`);
      writeFileSync(path, it.errorText, { mode: 0o600 });
      failureFile = { path, sha256: sha256(readFileSync(path)) };
    }
    events.push(
      await appendEvent(pool, projectId, "acceptance.item", {
        ...common,
        manifest_sha256: manifestSha256,
        item: it.number,
        file: it.file,
        status: it.status,
        why: it.why,
        test_title: it.title ?? null,
        step: it.step ?? null,
        failure_file: failureFile,
        screenshot: it.screenshot ?? null,
      }),
    );
  }
  events.push(
    await appendEvent(pool, projectId, "acceptance.run.finished", {
      ...common,
      manifest_sha256: manifestSha256,
      exit_code: exit?.code ?? null,
      timed_out: Boolean(exit?.timedOut),
      outcome: reading.outcome,
      summary: reading.summary,
      run_problems: reading.runProblems,
    }),
  );
  const report: AcceptanceReport = { runId, version, manifestSha256, writtenBy: "stand-in", runFolder, refused, appAnswered, exit, args, reading, output, events };
  writeFileSync(
    join(runFolder.builder, "report.json"),
    JSON.stringify({ ...report, reading: { ...reading, items: reading.items.map(({ errorText: _e, ...rest }) => rest) }, events: events.map((e) => e.id) }, null, 2) + "\n",
    { mode: 0o600 },
  );
  return report;
}
