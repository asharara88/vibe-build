/**
 * Package J1: the journey (src/orchestrator/journey.ts), the parts that need no container: the confirmations
 * before any build, the order of events, recovery of journey projects only, and the closed real-model gate
 * (what the interface imports, what is left in its environment, and the only engine it makes). Part 2: the build,
 * preview, checklist and export jobs, with a stand-in for example 1's sandboxes (test/journey-stand-ins.ts): a real
 * workspace and history, no container.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import net from "node:net";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BROWSER_ZIP_LABEL, BROWSER_ZIP_SHA256, RUNNER_IMAGE } from "../src/acceptance/runner-image.js";
import { openStore, sha256 } from "../src/acceptance/store.js";
import { git, workspaceChanges } from "../src/engine/project-repo.js";
import { buildPortRefusal, cameraImageProblem, cameraNetworkProblem, checkJourneyId, example1Sandboxes, frontOnlyProblem, J1_APP_PORT, recordedSandboxRefusal, type ProjectSandbox } from "../src/orchestrator/example-1-adapter.js";
import { secretLikePath } from "../src/orchestrator/export.js";
import { APP_SHOTS, JourneyJobs, REFUSAL_EXTRA } from "../src/orchestrator/journey-jobs.js";
import { journeyFolder, recordedFile } from "../src/web/files.js";
import { frontTexts, previewPage } from "../src/web/pages.js";
import { BROKEN_STEP_ID, changeSetFolders, PASSED_SUMMARY, PNG_1X1, slowPoolFor, StandInSandboxes } from "./journey-stand-ins.js";
import type { BuildEngine } from "../src/engine/interface.js";
import { ScriptedEngine } from "../src/engine/scripted.js";
import { DEFAULT_PROFILES } from "../src/gateway/hold.js";
import { brokenStageTargetProblem, diskRefusal, EV, EventQueue, EXPORT_LABEL, JOB_RULES, jobRunFinished, Journey, JourneyRefused, JOURNEY_STAND_IN_LABEL, orderedEngine, runOutcome, scriptedEngineFor, scriptedOnlyProblem, engineEventHandler, SIGN_OFF_LABEL, signOffRefusal, type JobRecord, type JourneyState } from "../src/orchestrator/journey.js";
import { LivePreview } from "../src/web/preview.js";
import { runBudgetedStep } from "../src/orchestrator/steps.js";
import { sandbox as sandboxManager, type Sandbox, type StreamingOptions } from "../src/sandbox/manager.js";
import { networkChecks } from "../scripts/journey-network-checks.js";
import { brokenCopyRecordChecks, cleanStopRecordChecks, crashRestartRecordChecks, midStepChecks, parseImages, parseNameLabel, parseProcesses, projectLeftovers } from "../scripts/journey-restart-checks.js";
import { createPool } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";
import { appendEvent, listEvents } from "../src/store/events.js";
import { getBudget, listStepHolds, openStepHold } from "../src/store/holds.js";
import { createProject } from "../src/store/projects.js";
import { testPool, TEST_DB_URL, uniqueId } from "./helpers.js";

const builderDir = resolve(import.meta.dirname, "..");
let pool: pg.Pool;
let dataDir: string;
let journey: Journey;

beforeAll(async () => {
  pool = await testPool();
  dataDir = openStore(mkdtempSync(join(tmpdir(), "builder-journey-"))).dataDir;
  journey = new Journey({ pool, dataDir });
});
afterAll(async () => {
  await pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

const newProject = (cap = "5") => journey.createProject({ name: "Journey test (made-up)", cap, brief: "Made-up brief." });
const noop = async () => ({ note: "a stand-in job body: no container" });

describe("J1 journey: nothing is built before both confirmations, nothing exported before sign-off", () => {
  it("a build step is refused at every stage before the brief and the plan are both confirmed, and allowed after", async () => {
    const id = await newProject();
    const refusedAt = async (stage: string) => {
      await expect(journey.startJob(id, "build_step", noop), stage).rejects.toThrow(JourneyRefused);
      expect((await listEvents(pool, id, EV.jobStarted)).length, stage).toBe(0);
    };
    await refusedAt("brief entered");
    await journey.continueWithExample(id);
    await refusedAt("questions");
    await journey.answerRestFromSheet(id);
    expect((await journey.state(id)).stage).toBe("brief_review");
    await refusedAt("brief to confirm");
    await journey.confirmBrief(id);
    await expect(journey.startJob(id, "build_step", noop)).rejects.toThrow(/plan is not confirmed/);
    await journey.confirmPlan(id);
    const { jobId } = await journey.startJob(id, "build_step", noop, { step: "01-data" });
    await journey.waitForJob();
    const s = await journey.state(id);
    expect(s.jobs).toEqual([expect.objectContaining({ jobId, kind: "build_step", state: "finished", step: "01-data" })]);
  });

  it("the plan cannot be confirmed before the brief; the brief not before every question is answered", async () => {
    const id = await newProject();
    await journey.continueWithExample(id);
    await expect(journey.confirmPlan(id)).rejects.toThrow(/brief must be confirmed/);
    await expect(journey.confirmBrief(id)).rejects.toThrow(/Every question must be answered/);
    expect((await listEvents(pool, id)).map((e) => e.kind)).toEqual([EV.briefEntered, EV.continued]);
  });

  it("confirming the plan fixes the tests: a stand-in version is written to the acceptance store, labelled, before the confirmation", async () => {
    const id = await newProject();
    await journey.continueWithExample(id);
    await journey.answerRestFromSheet(id);
    await journey.confirmBrief(id);
    await journey.confirmPlan(id);
    const events = await listEvents(pool, id);
    const kinds = events.map((e) => e.kind);
    expect(kinds.slice(-3)).toEqual([EV.briefConfirmed, "acceptance.version.written", EV.planConfirmed]);
    const plan = events.at(-1)!;
    expect(plan.payload).toMatchObject({ acceptance_version: "v001", acceptance_label: JOURNEY_STAND_IN_LABEL, quality_gate_after_each_step: "not done (milestone 1)" });
    expect((plan.payload.steps as Array<{ step: string; files: number }>).map((s) => [s.step, s.files])).toEqual([
      ["01-data", 7],
      ["02-submitter-screen", 8],
    ]);
    expect(statSync(join(dataDir, "acceptance", id, "v001")).isDirectory()).toBe(true);
  });

  it("export is refused before sign-off, and allowed after it", async () => {
    const id = await newProject();
    await journey.continueWithExample(id);
    await journey.answerRestFromSheet(id);
    await journey.confirmBrief(id);
    await journey.confirmPlan(id);
    await expect(journey.startJob(id, "export", noop)).rejects.toThrow(/not signed off/);
    await appendEvent(pool, id, EV.signedOff, { note: "written by the test, standing in for part 2's sign-off" });
    await journey.startJob(id, "export", noop);
    await journey.waitForJob();
    expect((await journey.state(id)).jobs.map((j) => [j.kind, j.state])).toEqual([["export", "finished"]]);
  });

  it("one job at a time; a job that throws is recorded failed, after the events it pushed", async () => {
    const a = await newProject();
    const b = await newProject();
    for (const id of [a, b]) {
      await journey.continueWithExample(id);
      await journey.answerRestFromSheet(id);
      await journey.confirmBrief(id);
      await journey.confirmPlan(id);
    }
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await journey.startJob(
      a,
      "build_step",
      async ({ queue }) => {
        queue.push("journey.test_line", { n: 1 });
        await gate;
        throw new Error("made-up failure");
      },
      { step: "01-data" },
    );
    await expect(journey.startJob(b, "build_step", noop, { step: "01-data" })).rejects.toThrow(/One job runs at a time/);
    release();
    await journey.waitForJob();
    const kinds = (await listEvents(pool, a)).map((e) => e.kind);
    expect(kinds.slice(-3)).toEqual([EV.jobStarted, "journey.test_line", EV.jobFailed]);
    expect((await journey.state(a)).jobs[0]).toMatchObject({ state: "failed", reason: "the job stopped with an error (Error)" });
  });

  it("one job at a time also when two projects ask at the same moment: exactly one starts", async () => {
    const ids = [await newProject(), await newProject()];
    for (const id of ids) {
      await journey.continueWithExample(id);
      await journey.answerRestFromSheet(id);
      await journey.confirmBrief(id);
      await journey.confirmPlan(id);
    }
    // A pool that holds each "job started" write for 200 ms, so that the second request is always judged while
    // the first is still writing (without it the window is one round trip to the database).
    const slow = new Proxy(pool, {
      get(target, prop) {
        if (prop === "query")
          return async (...args: unknown[]) => {
            if (Array.isArray(args[1]) && args[1][1] === EV.jobStarted) await new Promise((r) => setTimeout(r, 200));
            return (target.query as (...a: unknown[]) => unknown)(...args);
          };
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const j = new Journey({ pool: slow, dataDir });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const body = async () => (await gate, {});
    const results = await Promise.allSettled(ids.map((id) => j.startJob(id, "build_step", body, { step: "01-data" })));
    release();
    await j.waitForJob();
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason))).toEqual([expect.stringMatching(/One job runs at a time/)]);
    let started = 0;
    for (const id of ids) started += (await listEvents(pool, id, EV.jobStarted)).length;
    expect(started).toBe(1);
  });

  it("a stopped project starts nothing", async () => {
    const id = await newProject();
    await journey.stop(id);
    await expect(journey.continueWithExample(id)).rejects.toThrow(JourneyRefused);
    await expect(journey.startJob(id, "build_step", noop)).rejects.toThrow(/stopped/);
    expect((await journey.state(id)).stage).toBe("stopped");
  });
});

describe("J1 journey: events in emission order", () => {
  it("the engine's events are written in the order it emitted them, and step.hold_closed follows the last of them", async () => {
    const id = uniqueId("j1-order");
    await createProject(pool, { id, name: "Order test (made-up)", capUsd: 5 });
    const queue = new EventQueue(pool, id);
    const N = 30;
    // A stand-in engine (no container) that emits its events at once and returns without waiting, as the
    // scripted engine does not wait for its handler's promise.
    const fast: BuildEngine = {
      name: "stand-in for the order test",
      async runStep(_s, onEvent) {
        for (let i = 0; i < N; i++) onEvent({ type: "text", text: `line ${i}`, at: new Date().toISOString() });
        onEvent({ type: "finished", at: new Date().toISOString() });
        return { ok: true, changedFiles: [], usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation_1h_tokens: 0, speed: "standard" }, turns: 0 };
      },
      stop: async () => undefined,
    };
    const r = await runBudgetedStep({
      pool,
      profile: DEFAULT_PROFILES.standard!,
      model: "claude-opus-5-5",
      gatewayUrl: "http://127.0.0.1:1",
      engineFor: () => orderedEngine(fast, queue),
      step: { projectId: id, stepId: "01-data", instruction: "Made-up.", protectedPaths: [], maxTurns: 4 },
      onEvent: engineEventHandler(queue, "01-data"),
      stepTimeLimitMs: 60_000,
    });
    expect(r.ok).toBe(true);
    await queue.drain();
    const events = await listEvents(pool, id);
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe("step.hold_opened");
    expect(kinds.at(-1)).toBe("step.hold_closed");
    const lines = events.filter((e) => e.kind === EV.engineEvent);
    expect(lines).toHaveLength(N + 1);
    expect(lines.map((e) => (e.payload.type === "text" ? e.payload.text : e.payload.type))).toEqual([...Array.from({ length: N }, (_, i) => `line ${i}`), "finished"]);
    // The step's reservation, sized at claude-opus-5-5's prices, 4 turns, standard profile: $1.5552 (design section 1, item 6).
    expect(events[0]!.payload.step_budget_usd).toBe(1.5552);
  });
});

describe("J1 journey: recovery at start touches journey projects only", () => {
  it("a job left 'started' is marked interrupted and its containers' cleanup called, only for projects whose id starts j1-", async () => {
    const j1 = await newProject();
    const other = uniqueId("p_recover_other");
    await createProject(pool, { id: other, name: "Not a journey project (made-up)", capUsd: 5 });
    await appendEvent(pool, j1, EV.jobStarted, { job_id: "job-left1", kind: "build_step", step: "01-data" }, "01-data");
    await appendEvent(pool, other, EV.jobStarted, { job_id: "job-left2", kind: "build_step", step: "01-data" }, "01-data");
    const cleaned: string[] = [];
    const j = new Journey({ pool, dataDir, cleanupProject: async (p) => void cleaned.push(p) });
    const touched = await j.recoverInterrupted();
    expect(touched).toContain(j1);
    expect(touched).not.toContain(other);
    expect(touched.every((p) => p.startsWith("j1-"))).toBe(true);
    expect(cleaned).toEqual(touched);
    expect((await listEvents(pool, j1, EV.jobInterrupted)).map((e) => e.payload.job_id)).toEqual(["job-left1"]);
    expect(await listEvents(pool, other, EV.jobInterrupted)).toEqual([]);
    const s = await j.state(j1);
    expect(s.interrupted).toBe(true);
    await expect(j.startJob(j1, "build_step", noop)).rejects.toThrow(/interrupted/);
    // Run again: nothing more to do for it.
    expect(await j.recoverInterrupted()).not.toContain(j1);
  });
});

describe("J1 journey: the real-model gate stays closed", () => {
  /** Every module the interface and the journey load, following relative imports from their entry points. */
  function importGraph(entries: string[]): Set<string> {
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      // `import x from "./a.js"`, `export … from "./a.js"`, a bare `import "./a.js"`, and `import("./a.js")`.
      for (const m of src.matchAll(/(?:import|export)\s[^"';]*?from\s+["'](\.[^"']+)["']|import\s+["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)/g)) {
        const spec = (m[1] ?? m[2] ?? m[3])!;
        const target = resolve(dirname(file), spec.replace(/\.js$/, ".ts"));
        if (target.endsWith(".ts")) walk(target);
      }
    };
    for (const e of entries) walk(e);
    return seen;
  }

  it("neither the interface nor the journey imports the gateway's app, main, key reader or journal, directly or through another module", () => {
    const web = readdirSync(join(builderDir, "src", "web")).filter((f) => f.endsWith(".ts")).map((f) => join(builderDir, "src", "web", f));
    const graph = importGraph([...web, join(builderDir, "src", "orchestrator", "journey.ts")]);
    expect(graph.has(join(builderDir, "src", "web", "main.ts"))).toBe(true);
    expect(graph.has(join(builderDir, "src", "orchestrator", "intake.ts"))).toBe(true);
    for (const f of ["app.ts", "main.ts", "key-reader.ts", "journal.ts"]) expect([...graph], f).not.toContain(join(builderDir, "src", "gateway", f));
    // What it may read from the gateway's folder: prices and cost arithmetic only.
    expect([...graph].filter((f) => f.includes("/src/gateway/")).map((f) => f.split("/").pop()).sort()).toEqual(["cost.ts", "hold.ts", "prices.ts"]);
  });

  it("the only engine the journey makes is the scripted engine; no other engine is named in the interface, the journey or its jobs", () => {
    const files = [...readdirSync(join(builderDir, "src", "web")).filter((f) => f.endsWith(".ts")).map((f) => join(builderDir, "src", "web", f)), join(builderDir, "src", "orchestrator", "journey.ts")];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/new\s+(\w*Engine)\s*\(/g)) expect(m[1], f).toBe("ScriptedEngine");
      for (const m of src.matchAll(/from\s+["']\.\.\/engine\/([\w-]+)\.js["']/g)) expect(["scripted", "interface"], f).toContain(m[1]);
    }
    // Part 2's modules: the same two rules; from the engine's folder they may also read project-repo.ts, the
    // project's history helper (git, resetToLastCommit), which is not an engine.
    const part2 = ["journey-jobs.ts", "export.ts", "example-1-adapter.ts"].map((f) => join(builderDir, "src", "orchestrator", f));
    part2.push(join(builderDir, "scripts", "example-1-sandbox.ts"));
    for (const f of part2) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/new\s+(\w*Engine)\s*\(/g)) expect(m[1], f).toBe("ScriptedEngine");
      for (const m of src.matchAll(/from\s+["'](?:\.\.\/)+(?:src\/)?engine\/([\w-]+)\.js["']/g)) expect(["scripted", "interface", "project-repo"], f).toContain(m[1]);
    }
    expect(readFileSync(part2[0]!, "utf8")).toMatch(/scriptedEngineFor\(/);
    const fake = { dir: "/nowhere", composeFile: "/nowhere/compose.yaml", projectName: "builder_j1-unit" } as Sandbox;
    const engine = scriptedEngineFor({ sandbox: fake, workspace: "/nowhere/w", gitDir: "/nowhere/g", changeSetsDir: join(builderDir, "scripted"), example: "example-1" }, new EventQueue(pool, "unused"));
    expect(engine.name).toBe("scripted");
    expect(new ScriptedEngine({ sandbox: fake, workspace: "/w", gitDir: "/g", changeSetsDir: "/c", example: "example-1" }).name).toBe(engine.name);
  });
});

describe("J1 journey: the disk check before a build", () => {
  it("uses the free space measured at the time, against a floor recorded as assumed", () => {
    expect(diskRefusal("/", 4 * 1024 ** 3, () => 5 * 1024 ** 3)).toBeNull();
    expect(diskRefusal("/", 4 * 1024 ** 3, () => 1.6 * 1024 ** 3)).toBe("This machine has 1.6 GB free; a build needs at least 4.0 GB (a floor assumed, not measured). The build was not started.");
    expect(typeof diskRefusal(tmpdir())).not.toBe("undefined");
  });
});


/* ---------------------------------------------------------------- part 2: the jobs, with a stand-in sandbox (no container) */

describe("J1 journey, part 2: the build, preview, checklist and export jobs (stand-in sandbox, no container, no model)", () => {
  let sandboxes: StandInSandboxes;
  beforeAll(() => {
    sandboxes = new StandInSandboxes(pool);
  });
  afterAll(() => sandboxes.removeAll());

  const make = (o: { pool?: pg.Pool; measureFree?: (p: string) => number; onFault?: (message: string, detail: unknown) => void } = {}) => {
    const box: { jobs?: JourneyJobs } = {};
    const j = new Journey({ pool: o.pool ?? pool, dataDir, cleanupProject: (id, rec) => box.jobs!.cleanup(id, rec), onFault: o.onFault });
    box.jobs = new JourneyJobs({ journey: j, sandboxes, measureFree: o.measureFree ?? (() => 50 * 1024 ** 3) });
    return { j, jobs: box.jobs };
  };
  /** A project with its brief and plan confirmed. */
  const ready = async (j: Journey, cap = "5") => {
    const id = await j.createProject({ name: "Leave requests (made-up)", cap, brief: "I need an app where staff can request leave and managers approve it" });
    await j.continueWithExample(id);
    await j.answerRestFromSheet(id);
    await j.confirmBrief(id);
    await j.confirmPlan(id);
    return id;
  };
  const stepEvents = async (id: string, step: string) => (await listEvents(pool, id)).filter((e) => e.step === step);

  it("step 1 runs through the step hold: its sandbox made, $2.7216 reserved and released, the engine's events in order and step.hold_closed after the last of them; step 2 only after step 1 is approved", async () => {
    // Every engine event's write is held 150 ms: written without waiting, they would land after step.hold_closed.
    const { j, jobs } = make({ pool: slowPoolFor(pool, EV.engineEvent, 150) });
    const id = await ready(j);
    await expect(jobs.buildStep(id, "02-submitter-screen")).rejects.toThrow("Step 01-data must be built and approved first.");
    await expect(jobs.approve(id, "01-data")).rejects.toThrow("This step is not built yet. A step is approved only once it has run to the end.");
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    const kinds = (await stepEvents(id, "01-data")).map((e) => e.kind);
    expect(kinds).toEqual([EV.jobStarted, EV.sandboxMade, "step.hold_opened", ...Array(10).fill(EV.engineEvent), "step.hold_closed", EV.jobFinished]);
    const ev = await stepEvents(id, "01-data");
    expect(ev.filter((e) => e.kind === EV.engineEvent).map((e) => e.payload.type)).toEqual(["text", "text", "tool_call", "tool_call", "tool_call", "tool_call", "tool_call", "tool_call", "tool_call", "finished"]);
    expect(ev.find((e) => e.kind === "step.hold_opened")!.payload).toMatchObject({ step_budget_usd: 2.7216, turns: 7, model: "claude-opus-5-5" });
    expect(ev.find((e) => e.kind === "step.hold_closed")!.payload).toMatchObject({ released_usd: 2.7216, spent_in_step_usd: 0, calls_drawn: 0 });
    expect(JSON.stringify(ev.map((e) => e.payload))).not.toMatch(/bpt_/);
    await expect(jobs.buildStep(id, "01-data")).rejects.toThrow("This step is already built.");
    await expect(jobs.preview(id)).rejects.toThrow(/Every step must be built and approved/);
    const next = await jobs.approve(id, "01-data");
    expect(next.next).toBe("build_step");
    await j.waitForJob();
    const two = await stepEvents(id, "02-submitter-screen");
    expect(two.find((e) => e.kind === "step.hold_opened")!.payload).toMatchObject({ step_budget_usd: 3.1104, turns: 8 });
    expect(two.at(-2)!.kind).toBe("step.hold_closed");
    expect(two.at(-1)!.kind).toBe(EV.jobFinished);
    expect((await j.state(id)).stage).toBe("build");
    expect(sandboxes.runnerCalls.filter((c) => c.container.startsWith(`builder_${id}`)).map((c) => c.step)).toEqual(["01-data", "02-submitter-screen"]);
  });

  it("a project capped at $1.00: step 1 is refused before the engine is made, with package 1.3's message; no container is asked for; the job fails with that message", async () => {
    const { j, jobs } = make();
    const id = await ready(j, "1");
    const before = sandboxes.runnerCalls.length;
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    const s = await j.state(id);
    expect(s.stepJobs.get("01-data")).toMatchObject({ state: "failed" });
    expect(s.stepJobs.get("01-data")!.reason).toMatch(/^This step needs up to \$2\.73 to finish \(7 turns\); this project has \$1\.00 left of its budget of \$1\.00 .*The step was not started\. A cap of at least \$2\.73 would let it start now\.$/);
    const kinds = (await stepEvents(id, "01-data")).map((e) => e.kind);
    expect(kinds).toContain("step.refused");
    expect(kinds).not.toContain("step.hold_opened");
    expect(sandboxes.runnerCalls.length).toBe(before);
    expect(REFUSAL_EXTRA).toBe("Scripted steps spend $0; this is a reservation sized from a real model's price. To go on, ask Claude Code to change the cap (a recorded change), or start a new project.");
  });

  it("a step that fails leaves nothing behind: the workspace is put back to its last commit, and the step can be tried again", async () => {
    const { j, jobs } = make();
    const id = await ready(j);
    sandboxes.extraFile = "made-up-extra.txt";
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    const s = await j.state(id);
    expect(s.stepJobs.get("01-data")).toMatchObject({ state: "failed", reason: "files changed that are not in the fixed change: made-up-extra.txt" });
    expect((await stepEvents(id, "01-data")).map((e) => e.kind)).toContain(EV.workspaceReset);
    const x = jobs.handle(id)!;
    expect(existsSync(join(x.workspace, "made-up-extra.txt"))).toBe(false);
    expect(existsSync(join(x.workspace, "src", "db", "app-schema.ts"))).toBe(false);
    const left = await workspaceChanges(x.repo);
    expect([...left.changed, ...left.ignoredNew, ...left.ignoredChanged]).toEqual([]);
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    expect((await j.state(id)).stepJobs.get("01-data")).toMatchObject({ state: "finished" });
  });

  it("the disk check: below the floor, measured at the time, the build is refused before anything is made", async () => {
    const { j, jobs } = make({ measureFree: () => 1.6 * 1024 ** 3 });
    const id = await ready(j);
    const made = sandboxes.made.length;
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    expect((await j.state(id)).stepJobs.get("01-data")).toMatchObject({
      state: "failed",
      reason: "This machine has 1.6 GB free; a build needs at least 4.0 GB (a floor assumed, not measured). The build was not started.",
    });
    expect(sandboxes.made.length).toBe(made);
    expect((await listEvents(pool, id)).map((e) => e.kind)).not.toContain("step.hold_opened");
  });

  /** Both steps built and approved, the preview made. */
  const previewed = async (j: Journey, jobs: JourneyJobs) => {
    const id = await ready(j);
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    await jobs.approve(id, "01-data");
    await j.waitForJob();
    const r = await jobs.approve(id, "02-submitter-screen");
    expect(r.next).toBe("preview");
    await j.waitForJob();
    return id;
  };

  it("the preview: after the last approval the app is started once and photographed; each screenshot is recorded with its file and SHA-256, inside the project's shots folder", async () => {
    const { j, jobs } = make();
    const id = await previewed(j, jobs);
    const s = await j.state(id);
    expect(s.stage).toBe("acceptance");
    expect(s.appRunning).toBe(true);
    const shots = await listEvents(pool, id, EV.screenshot);
    expect(shots.map((e) => e.payload.name)).toEqual(APP_SHOTS.map((x) => x.name));
    for (const e of shots) {
      const f = e.payload.file as { path: string; sha256: string };
      expect(f.path.startsWith(journeyFolder(dataDir, id, "shots") + "/")).toBe(true);
      expect(sha256(readFileSync(f.path))).toBe(f.sha256);
      expect(e.payload.caption).toMatch(/^Screenshot of the running app at \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\. Not live\. Sample data\.$/);
      expect(e.payload.live).toBe(false);
    }
    // The camera's own folder, and the password file in it, are gone.
    expect(existsSync(join(dataDir, "journey", id, "camera-runs")) ? readdirSync(join(dataDir, "journey", id, "camera-runs")) : []).toEqual([]);
    await expect(jobs.preview(id)).rejects.toThrow("The preview is already made.");
  });

  it("a camera file that is not a PNG is not recorded: the preview fails and its app is stopped", async () => {
    const { j, jobs } = make();
    const id = await ready(j);
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    await jobs.approve(id, "01-data");
    await j.waitForJob();
    sandboxes.cameraWrites = (outDir) => {
      for (const s of APP_SHOTS) writeFileSync(join(outDir, `${s.name}.png`), s.name === "app-home-ar" ? "<html>not a picture</html>" : PNG_1X1);
    };
    try {
      await jobs.approve(id, "02-submitter-screen");
      await j.waitForJob();
    } finally {
      sandboxes.cameraWrites = (outDir) => {
        for (const s of APP_SHOTS) writeFileSync(join(outDir, `${s.name}.png`), PNG_1X1);
      };
    }
    const s = await j.state(id);
    expect(s.jobs.at(-1)).toMatchObject({ kind: "preview", state: "failed", reason: "The camera's app-home-ar.png is not a PNG image." });
    expect(s.previewFinished).toBe(false);
    expect(s.appRunning).toBe(false);
    expect((await listEvents(pool, id)).map((e) => e.kind).slice(-2)).toEqual([EV.appStopped, EV.jobFailed]);
    expect((await listEvents(pool, id, EV.screenshot)).map((e) => e.payload.name)).toEqual(["app-home-en", "app-my-requests-en"]);
    expect(sandboxes.stoppedApps).toContain(id);
    await expect(jobs.acceptance(id)).rejects.toThrow("The app is not running: make the preview first.");
  });

  it("a preview that failed part-way can be tried again: each attempt writes its screenshots in a folder of its own, and no file an earlier event names is overwritten (review bot on defb9c4)", async () => {
    const faults: string[] = [];
    const { j, jobs } = make({ onFault: (m, d) => void faults.push(`${m} ${JSON.stringify(d)}`) });
    const id = await ready(j);
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    await jobs.approve(id, "01-data");
    await j.waitForJob();
    const allPng = (body: Buffer) => (outDir: string) => {
      for (const s of APP_SHOTS) writeFileSync(join(outDir, `${s.name}.png`), body);
    };
    // The first attempt: the third screenshot is not a PNG, so the preview fails after the first two were copied and recorded.
    sandboxes.cameraWrites = (outDir) => {
      for (const s of APP_SHOTS) writeFileSync(join(outDir, `${s.name}.png`), s.name === "app-home-ar" ? "<html>not a picture</html>" : PNG_1X1);
    };
    try {
      await jobs.approve(id, "02-submitter-screen");
      await j.waitForJob();
    } finally {
      sandboxes.cameraWrites = allPng(PNG_1X1);
    }
    const first = await listEvents(pool, id, EV.screenshot);
    expect(first.map((e) => e.payload.name)).toEqual(["app-home-en", "app-my-requests-en"]);
    expect((await j.state(id)).jobs.at(-1)).toMatchObject({ kind: "preview", state: "failed", reason: "The camera's app-home-ar.png is not a PNG image." });
    const kept = first.map((e) => ({ id: e.id, ...(e.payload.file as { path: string; sha256: string }) }));
    // The retry, with four valid screenshots whose bytes differ from the first attempt's (so an overwrite would show).
    const retryPng = Buffer.concat([PNG_1X1, Buffer.from("made-up bytes of the retry")]);
    sandboxes.cameraWrites = allPng(retryPng);
    try {
      await jobs.preview(id);
      await j.waitForJob();
    } finally {
      sandboxes.cameraWrites = allPng(PNG_1X1);
    }
    const s = await j.state(id);
    expect(s.jobs.at(-1), `the faults reported: ${faults.join(" | ")}`).toMatchObject({ kind: "preview", state: "finished" });
    expect(s.previewFinished).toBe(true);
    expect(s.appRunning).toBe(true);
    const all = await listEvents(pool, id, EV.screenshot);
    const retry = all.slice(first.length);
    expect(retry.map((e) => e.payload.name)).toEqual(APP_SHOTS.map((x) => x.name));
    const shotsDir = journeyFolder(dataDir, id, "shots");
    const folderOf = (path: string) => dirname(path);
    const retryFolder = folderOf((retry[0]!.payload.file as { path: string }).path);
    for (const e of retry) {
      const f = e.payload.file as { path: string; sha256: string };
      expect(folderOf(f.path)).toBe(retryFolder);
      expect(f.path.startsWith(shotsDir + "/")).toBe(true);
      expect(f.sha256).toBe(sha256(retryPng));
      const served = await recordedFile(pool, dataDir, id, e.id);
      expect(served.ok && sha256(served.body)).toBe(f.sha256);
    }
    // The first attempt's files are where its events say, unchanged, in a folder of their own, and still served.
    for (const k of kept) {
      expect(folderOf(k.path)).not.toBe(retryFolder);
      expect(k.path.startsWith(shotsDir + "/")).toBe(true);
      expect(sha256(readFileSync(k.path))).toBe(k.sha256);
      expect(k.sha256).toBe(sha256(PNG_1X1));
      const served = await recordedFile(pool, dataDir, id, k.id);
      expect(served.ok && sha256(served.body)).toBe(k.sha256);
    }
    // The preview screen shows the retry's four screenshots, not the failed attempt's two as well.
    const page = String(await previewPage("en", s));
    expect(page).toContain('data-shots="4"');
    for (const e of retry) expect(page).toContain(`/projects/${id}/files/${e.id}"`);
    for (const k of kept) expect(page).not.toContain(`/projects/${id}/files/${k.id}"`);
  });

  it("halted while a step's engine runs (the interface lost its instance lock): the engine's container is killed at once, the workspace is not reset, the job is recorded interrupted, and no job or action starts after it (review bot on defb9c4, the fix's parts)", async () => {
    const { j, jobs } = make();
    const id = await ready(j);
    let engineStarted!: () => void;
    const started = new Promise<void>((r) => (engineStarted = r));
    sandboxes.engineHold = { started: () => engineStarted() };
    const why = "Made-up reason for the test: the interface lost its instance lock.";
    try {
      await jobs.buildStep(id, "01-data");
      await started;
      expect(j.runningJob()?.projectId).toBe(id);
      await j.halt(why);
    } finally {
      sandboxes.engineHold = null;
    }
    expect(j.runningJob()).toBeNull();
    expect(j.halted()).toBe(why);
    expect(sandboxes.killedRunners.filter((c) => c.startsWith(`builder_${id}-engine-01-data-`))).toHaveLength(1);
    const s = await j.state(id);
    expect(s.stepJobs.get("01-data")).toMatchObject({ state: "interrupted" });
    expect(s.stepJobs.get("01-data")!.reason).toContain(why);
    expect(s.interrupted).toBe(true);
    const kinds = (await stepEvents(id, "01-data")).map((e) => e.kind);
    expect(kinds).not.toContain(EV.workspaceReset);
    expect(kinds).not.toContain(EV.jobFinished);
    expect(kinds).not.toContain(EV.jobFailed);
    expect(kinds).toContain("step.hold_closed");
    expect(kinds.at(-1)).toBe(EV.jobInterrupted);
    // Nothing starts after the halt, and the sandbox is left for the next start's recovery.
    const before = (await listEvents(pool, id)).length;
    await expect(jobs.buildStep(id, "01-data")).rejects.toThrow(why);
    await expect(j.closeProject(id)).rejects.toThrow(why);
    await expect(j.createProject({ name: "After the halt (made-up)", cap: "5", brief: "Made-up brief." })).rejects.toThrow(why);
    expect((await listEvents(pool, id)).length).toBe(before);
    expect(sandboxes.destroyed).not.toContain(id);
    expect(existsSync(jobs.handle(id)!.dir)).toBe(true);
  });

  it("one project's app at a time: another project's preview is refused while one app runs", async () => {
    const { j, jobs } = make();
    const a = await previewed(j, jobs);
    const b = await ready(j);
    await jobs.buildStep(b, "01-data");
    await j.waitForJob();
    await jobs.approve(b, "01-data");
    await j.waitForJob();
    await jobs.approve(b, "02-submitter-screen");
    await j.waitForJob();
    expect((await j.state(b)).jobs.at(-1)).toMatchObject({ kind: "preview", state: "failed", reason: "Another project's app is running. One project's app runs at a time: close that project first." });
    await j.closeProject(a);
    // A port already in use: the app is not started.
    // The build's port on the machine already in use (package 0.6c: the project's one port there): the app is not built.
    const busy = "Something already listens on 127.0.0.1:13161, the port this machine gives a project's image build (another project's running sandbox, or another program); the app's images are not built and the app is not started.";
    sandboxes.ports = busy;
    try {
      await jobs.preview(b);
      await j.waitForJob();
    } finally {
      sandboxes.ports = null;
    }
    expect((await j.state(b)).jobs.at(-1)).toMatchObject({ kind: "preview", state: "failed", reason: busy });
    expect(sandboxes.started.filter((p) => p === b)).toEqual([]);
    expect(sandboxes.destroyed).toContain(a);
    expect((await listEvents(pool, a, EV.sandboxRemoved)).map((e) => e.payload.interrupted)).toEqual([false]);
    await jobs.preview(b);
    await j.waitForJob();
    expect((await j.state(b)).previewFinished).toBe(true);
    await j.closeProject(b);
  });

  it("the checklist, sign-off and export in order: no checklist before the preview, no sign-off before a passed run, no export before sign-off", async () => {
    const { j, jobs } = make();
    const early = await ready(j);
    await expect(jobs.acceptance(early)).rejects.toThrow("The app is not running: make the preview first.");
    await expect(j.signOff(early)).rejects.toThrow("The checklist has not been run yet.");
    await expect(jobs.exportProject(early)).rejects.toThrow(/not signed off/);
    const id = await previewed(j, jobs);
    sandboxes.acceptanceOutcome = "did not run";
    await jobs.acceptance(id);
    await j.waitForJob();
    sandboxes.acceptanceOutcome = "passed";
    await expect(j.signOff(id)).rejects.toThrow("The last checklist run did not pass, so there is nothing to sign off.");
    await expect(jobs.exportProject(id)).rejects.toThrow(/not signed off/);
    await jobs.acceptance(id);
    await j.waitForJob();
    await j.signOff(id);
    const signed = (await listEvents(pool, id, EV.signedOff))[0]!;
    expect(signed.payload).toMatchObject({ label: SIGN_OFF_LABEL, acceptance_outcome: "passed", acceptance_summary: PASSED_SUMMARY, acceptance_label: JOURNEY_STAND_IN_LABEL });
    expect(SIGN_OFF_LABEL).toBe("Sign-off on a simulated build, checked by a stand-in test of item 1 only: not acceptance");
    expect((await j.state(id)).stage).toBe("signed_off");
    await expect(jobs.acceptance(id)).rejects.toThrow("The project is signed off; the checklist is not run again.");
    await j.closeProject(id);
  });

  it("sign-off is judged on the last checklist job: when a later run's job fails after the runner wrote its events, the earlier passed run is not signed off (review of 13 Nov, note 4)", async () => {
    const { j, jobs } = make();
    const id = await previewed(j, jobs);
    await jobs.acceptance(id);
    await j.waitForJob();
    expect((await j.state(id)).acceptanceRun?.summary).toBe(PASSED_SUMMARY);
    // The second run: the runner writes its events ("did not run"), then the job fails.
    sandboxes.acceptanceOutcome = "did not run";
    sandboxes.acceptanceFailsAfterRun = true;
    try {
      await jobs.acceptance(id);
      await j.waitForJob();
    } finally {
      sandboxes.acceptanceOutcome = "passed";
      sandboxes.acceptanceFailsAfterRun = false;
    }
    const s = await j.state(id);
    expect(s.jobs.at(-1)).toMatchObject({ kind: "acceptance", state: "failed" });
    expect((await listEvents(pool, id, "acceptance.run.finished")).at(-1)!.payload.summary).toBe("did not run: the stand-in said so");
    await expect(j.signOff(id)).rejects.toThrow("The last checklist run did not pass, so there is nothing to sign off.");
    expect(await listEvents(pool, id, EV.signedOff)).toEqual([]);
    // A new run that passes can be signed off.
    await jobs.acceptance(id);
    await j.waitForJob();
    await j.signOff(id);
    await j.closeProject(id);
  });

  it("the export: a .tar.gz of the project's history, with the checklist's tests and the note added in the exported copy only, never in the workspace history; recorded with its SHA-256", async () => {
    const { j, jobs } = make();
    const id = await previewed(j, jobs);
    await jobs.acceptance(id);
    await j.waitForJob();
    await j.signOff(id);
    await jobs.exportProject(id);
    await j.waitForJob();
    const s = await j.state(id);
    expect(s.jobs.at(-1)).toMatchObject({ kind: "export", state: "finished" });
    const ev = (await listEvents(pool, id, EV.exportWritten))[0]!;
    const f = ev.payload.file as { path: string; sha256: string };
    expect(f.path).toBe(join(journeyFolder(dataDir, id, "exports"), `${id}-export.tar.gz`));
    expect(sha256(readFileSync(f.path))).toBe(f.sha256);
    expect(statSync(f.path).mode & 0o777).toBe(0o600);
    expect(ev.payload).toMatchObject({ acceptance_version: "v001", acceptance_in_exported_copy_only: true, label: EXPORT_LABEL, commits: 4 });
    const listing = execFileSync("tar", ["-tzf", f.path], { encoding: "utf8" }).split("\n");
    for (const p of [`${id}/acceptance/v001/item-01.spec.ts`, `${id}/acceptance/v001/manifest.json`, `${id}/acceptance/README.txt`, `${id}/EXPORT-NOTE.txt`, `${id}/.git/HEAD`, `${id}/src/db/app-schema.ts`]) expect(listing, p).toContain(p);
    expect(listing.filter((p) => /certs\/|\.crt$|secrets\//.test(p))).toEqual([]);
    // The workspace history is untouched: no acceptance folder in it, and its last commit is the step's.
    const x = jobs.handle(id)!;
    expect((await git(x.repo, ["ls-tree", "-r", "--name-only", "HEAD"])).split("\n").filter((p) => p.startsWith("acceptance"))).toEqual([]);
    expect((await git(x.repo, ["rev-parse", "HEAD"])).trim()).toBe(ev.payload.workspace_head);
    expect((await git(x.repo, ["log", "-1", "--format=%s"])).trim()).toBe("[scripted] example-1 02-submitter-screen");
    // The copy: its last commit adds the tests; it points nowhere.
    const out = mkdtempSync(join(tmpdir(), "builder-journey-export-"));
    try {
      execFileSync("tar", ["-xzf", f.path, "-C", out]);
      const copy = join(out, id);
      const gitIn = (args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", copy, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
      expect(gitIn(["remote"]).trim()).toBe("");
      expect(gitIn(["log", "-1", "--format=%an <%ae>"]).trim()).toBe("Builder export <export@example.invalid>");
      expect(gitIn(["show", "--name-only", "--format=", "HEAD"]).trim().split("\n").sort()).toEqual(["EXPORT-NOTE.txt", "acceptance/README.txt", "acceptance/v001/item-01.spec.ts", "acceptance/v001/manifest.json"]);
      expect(readFileSync(join(copy, "acceptance", "README.txt"), "utf8")).toContain(`Label: ${JOURNEY_STAND_IN_LABEL}.`);
      expect(readFileSync(join(copy, "EXPORT-NOTE.txt"), "utf8").split("\n")[0]).toBe(EXPORT_LABEL);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
    await j.closeProject(id);
  });

  it("the export is refused when the project's history holds a file that looks like a secret", async () => {
    const { j, jobs } = make();
    const id = await previewed(j, jobs);
    await jobs.acceptance(id);
    await j.waitForJob();
    await j.signOff(id);
    const x = jobs.handle(id)!;
    writeFileSync(join(x.workspace, ".env"), "MADE_UP=1\n");
    await git(x.repo, ["add", "-f", ".env"]);
    await git(x.repo, ["commit", "--quiet", "--no-verify", "-m", "made-up settings file, committed by the test"]);
    await jobs.exportProject(id);
    await j.waitForJob();
    expect((await j.state(id)).jobs.at(-1)).toMatchObject({ kind: "export", state: "failed" });
    expect(await listEvents(pool, id, EV.exportWritten)).toEqual([]);
    expect(existsSync(join(journeyFolder(dataDir, id, "exports"), `${id}-export.tar.gz`))).toBe(false);
    expect(secretLikePath(".env")).toBe(true);
    expect(secretLikePath(".env.example")).toBe(false);
    expect(secretLikePath("certs/session-ca.crt")).toBe(true);
    expect(secretLikePath("src/db/app-schema.ts")).toBe(false);
    await j.closeProject(id);
  });

  it("the export is refused when any commit of the history held a file that looks like a secret, even one removed by a later commit (review of 13 Nov, note 5)", async () => {
    const faults: unknown[] = [];
    const { j, jobs } = make({ onFault: (_m, d) => void faults.push(d) });
    const id = await previewed(j, jobs);
    await jobs.acceptance(id);
    await j.waitForJob();
    await j.signOff(id);
    const x = jobs.handle(id)!;
    writeFileSync(join(x.workspace, ".env"), "MADE_UP=1\n");
    await git(x.repo, ["add", "-f", ".env"]);
    await git(x.repo, ["commit", "--quiet", "--no-verify", "-m", "made-up settings file, committed by the test"]);
    await git(x.repo, ["rm", "--quiet", "--cached", ".env"]);
    rmSync(join(x.workspace, ".env"));
    await git(x.repo, ["commit", "--quiet", "--no-verify", "-m", "the made-up settings file removed again, by the test"]);
    expect((await git(x.repo, ["ls-tree", "-r", "--name-only", "HEAD"])).split("\n")).not.toContain(".env");
    await jobs.exportProject(id);
    await j.waitForJob();
    const s = await j.state(id);
    expect(s.jobs.at(-1)).toMatchObject({ kind: "export", state: "failed" });
    expect(faults).toEqual([expect.objectContaining({ project: id, error: "The project's history holds files that look like secrets (.env); the export is refused." })]);
    expect(await listEvents(pool, id, EV.exportWritten)).toEqual([]);
    await j.closeProject(id);
  });

  it("the exported copy holds only what the history reaches: an object no commit reaches (as a reset can leave) is not copied (review of 13 Nov, note 5)", async () => {
    const { j, jobs } = make();
    const id = await previewed(j, jobs);
    await jobs.acceptance(id);
    await j.waitForJob();
    await j.signOff(id);
    const x = jobs.handle(id)!;
    const loose = join(x.dir, "unreachable.txt");
    writeFileSync(loose, `MADE_UP_UNREACHABLE=${uniqueId("u")}\n`);
    const blob = (await git(x.repo, ["hash-object", "-w", loose])).trim();
    expect((await git(x.repo, ["cat-file", "-t", blob])).trim()).toBe("blob");
    await jobs.exportProject(id);
    await j.waitForJob();
    expect((await j.state(id)).jobs.at(-1)).toMatchObject({ kind: "export", state: "finished" });
    const f = (await listEvents(pool, id, EV.exportWritten))[0]!.payload.file as { path: string };
    const out = mkdtempSync(join(tmpdir(), "builder-journey-export-"));
    try {
      execFileSync("tar", ["-xzf", f.path, "-C", out]);
      const env = { PATH: process.env.PATH, HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
      const has = (sha: string) => {
        try {
          execFileSync("git", ["-C", join(out, id), "cat-file", "-e", sha], { env, stdio: "ignore" });
          return true;
        } catch {
          return false;
        }
      };
      expect(has(blob)).toBe(false);
      expect(has((await git(x.repo, ["rev-parse", "HEAD"])).trim())).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
    await j.closeProject(id);
  });

  it("at start, a sandbox left by an interface that stopped is removed and the project marked interrupted; only projects whose id starts j1-", async () => {
    const { j } = make();
    const id = await ready(j);
    const other = uniqueId("p_recover_sandbox");
    await createProject(pool, { id: other, name: "Not a journey project (made-up)", capUsd: 5 });
    // A record written before package 0.6c, with the ports the app and database had on the machine then: only its folder is read.
    const rec = { dir: "/made-up/builder-acceptance-left", app_port: 3161, db_port: 5591 };
    await appendEvent(pool, id, EV.sandboxMade, rec, "01-data");
    await appendEvent(pool, other, EV.sandboxMade, rec, "01-data");
    const cleaned: Array<[string, unknown]> = [];
    const fresh = new Journey({ pool, dataDir, cleanupProject: async (p, r) => void cleaned.push([p, r]) });
    const touched = await fresh.recoverInterrupted();
    expect(touched).toContain(id);
    expect(touched).not.toContain(other);
    expect(cleaned.find(([p]) => p === id)?.[1]).toEqual({ dir: rec.dir });
    expect(cleaned.map(([p]) => p).every((p) => p.startsWith("j1-"))).toBe(true);
    expect((await listEvents(pool, id, EV.sandboxRemoved)).map((e) => e.payload)).toEqual([expect.objectContaining({ interrupted: true, removed: true })]);
    expect(await listEvents(pool, other, EV.sandboxRemoved)).toEqual([]);
    const s = await fresh.state(id);
    expect(s.interrupted).toBe(true);
    expect(s.sandbox).toBeNull();
    expect(await fresh.recoverInterrupted()).not.toContain(id);
  });

  it("at start, the reservation of a step whose job was interrupted is closed, so the cost panel shows no money reserved for a step that is not running (review of 13 Nov, note 3)", async () => {
    const { j } = make();
    const id = await ready(j);
    const other = await ready(j);
    // As an interface that stopped in the middle of step 1 leaves it: the job started, the step's hold open.
    await appendEvent(pool, id, EV.jobStarted, { job_id: "job-0000aaaa", kind: "build_step", step: "01-data" }, "01-data");
    const deadline = new Date(Date.now() + 60 * 60 * 1000);
    const opened = await openStepHold(pool, { projectId: id, stepId: "01-data", model: "claude-opus-5-5", maxTurns: 4, profile: DEFAULT_PROFILES.standard!, deadline });
    expect(opened.ok).toBe(true);
    // Another project's open reservation, with no job left running in its record, is not touched.
    const kept = await openStepHold(pool, { projectId: other, stepId: "01-data", model: "claude-opus-5-5", maxTurns: 4, profile: DEFAULT_PROFILES.standard!, deadline });
    expect(kept.ok).toBe(true);
    expect((await getBudget(pool, id)).stepRoom).toBe(1.5552);
    const fresh = new Journey({ pool, dataDir, cleanupProject: async () => undefined });
    expect(await fresh.recoverInterrupted()).toContain(id);
    expect((await listStepHolds(pool, id)).map((h) => [h.step_id, h.state, h.closed_reason])).toEqual([["01-data", "closed", "job_interrupted"]]);
    expect((await getBudget(pool, id)).stepRoom).toBe(0);
    const closed = (await listEvents(pool, id)).filter((e) => e.kind === "step.hold_closed");
    expect(closed.map((e) => e.payload)).toEqual([expect.objectContaining({ reason: "job_interrupted", released_usd: 1.5552 })]);
    // The interrupted job's ending comes first, then the reservation's close.
    const kinds = (await listEvents(pool, id)).map((e) => e.kind);
    expect(kinds.indexOf(EV.jobInterrupted)).toBeLessThan(kinds.indexOf("step.hold_closed"));
    expect((await listStepHolds(pool, other)).map((h) => h.state)).toEqual(["open"]);
  });

  it("brought up to date with 3.1b: sign-off reads the outcome word of the run's own acceptance.run.finished event, never its summary's text", async () => {
    const { j, jobs } = make();
    const id = await previewed(j, jobs);
    // The summary says "version passed; …" in every one of these runs; only the outcome word differs.
    for (const word of ["not passed", "failed", "absent", "Passed", "passed "]) {
      sandboxes.outcomeWord = word;
      try {
        await jobs.acceptance(id);
        await j.waitForJob();
      } finally {
        sandboxes.outcomeWord = null;
      }
      const s = await j.state(id);
      expect(s.acceptanceRun?.summary, word).toBe(PASSED_SUMMARY);
      expect(s.acceptanceRun?.outcome, word).toBe(word === "not passed" || word === "failed" ? word : null);
      await expect(j.signOff(id), word).rejects.toThrow("The last checklist run did not pass, so there is nothing to sign off.");
    }
    expect(await listEvents(pool, id, EV.signedOff)).toEqual([]);
    // A run whose record gives "passed" is signed off, and the sign-off records the word.
    await jobs.acceptance(id);
    await j.waitForJob();
    expect((await j.state(id)).acceptanceRun?.outcome).toBe("passed");
    await j.signOff(id);
    expect((await listEvents(pool, id, EV.signedOff))[0]!.payload).toMatchObject({ acceptance_outcome: "passed", acceptance_summary: PASSED_SUMMARY });
    await j.closeProject(id);
  });

  it("brought up to date with 3.1b: a run's outcome word is read only from one acceptance.run.finished event of that run, and only if it is one of the three words", () => {
    const at = new Date();
    const ev = (id: string, payload: Record<string, unknown>, kind = "acceptance.run.finished") => ({ id, project_id: "j1-0123456789ab", at, kind, step: null, payload });
    expect(runOutcome([ev("1", { run_id: "r1", outcome: "passed" })], "r1")).toBe("passed");
    expect(runOutcome([ev("1", { run_id: "r1", outcome: "not passed" })], "r1")).toBe("not passed");
    expect(runOutcome([ev("1", { run_id: "r1", outcome: "failed" })], "r1")).toBe("failed");
    expect(runOutcome([ev("1", { run_id: "r2", outcome: "passed" })], "r1")).toBeNull(); // another run's
    expect(runOutcome([ev("1", { run_id: "r1", outcome: "passed" }, "acceptance.item")], "r1")).toBeNull(); // not the run's ending
    expect(runOutcome([ev("1", { run_id: "r1", summary: PASSED_SUMMARY })], "r1")).toBeNull(); // no word: not read from the summary
    expect(runOutcome([ev("1", { run_id: "r1", outcome: "skipped" })], "r1")).toBeNull();
    expect(runOutcome([ev("1", { run_id: "r1", outcome: true })], "r1")).toBeNull();
    expect(runOutcome([ev("1", { run_id: "r1", outcome: "passed" }), ev("2", { run_id: "r1", outcome: "passed" })], "r1")).toBeNull(); // two endings for one run
  });

  it("brought up to date with 3.1b: the preview checks the camera's runner image first; with a problem, no app is built, or the app is stopped before the camera starts, and no screenshot is recorded", async () => {
    const { j, jobs } = make();
    const id = await ready(j);
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    await jobs.approve(id, "01-data");
    await j.waitForJob();
    const problem = `the runner image ${RUNNER_IMAGE} has no ${BROWSER_ZIP_LABEL} label, so it was not built by this version of the builder from the approved browser zip: build it again`;
    const runsBefore = sandboxes.cameraRuns;
    // Before the build: nothing is built or started.
    sandboxes.cameraImage = problem;
    try {
      await jobs.approve(id, "02-submitter-screen");
      await j.waitForJob();
    } finally {
      sandboxes.cameraImage = null;
    }
    let s = await j.state(id);
    expect(s.jobs.at(-1)).toMatchObject({ kind: "preview", state: "failed", reason: `The app camera cannot start, so the app was not built: ${problem}.` });
    expect(sandboxes.started).not.toContain(id);
    expect(s.appRunning).toBe(false);
    // After the build, just before the camera: the app is stopped, the camera does not run.
    sandboxes.cameraImageAfterStart = problem;
    try {
      await jobs.preview(id);
      await j.waitForJob();
    } finally {
      sandboxes.cameraImageAfterStart = null;
      sandboxes.cameraImage = null;
    }
    s = await j.state(id);
    expect(s.jobs.at(-1)).toMatchObject({ kind: "preview", state: "failed", reason: `The app camera did not start: ${problem}. No screenshot was recorded.` });
    expect(sandboxes.started).toContain(id);
    expect(sandboxes.stoppedApps).toContain(id);
    expect(s.appRunning).toBe(false);
    expect((await listEvents(pool, id)).map((e) => e.kind).slice(-2)).toEqual([EV.appStopped, EV.jobFailed]);
    expect(sandboxes.cameraRuns).toBe(runsBefore);
    expect(await listEvents(pool, id, EV.screenshot)).toEqual([]);
    expect(existsSync(join(dataDir, "journey", id, "camera-runs")) ? readdirSync(join(dataDir, "journey", id, "camera-runs")) : []).toEqual([]);
    // With the image as it should be, the preview is made.
    const checks = sandboxes.cameraImageChecks;
    await jobs.preview(id);
    await j.waitForJob();
    expect((await j.state(id)).previewFinished).toBe(true);
    expect(sandboxes.cameraImageChecks - checks).toBe(2); // before the build, and just before the camera
    expect(sandboxes.cameraRuns).toBe(runsBefore + 1);
    await j.closeProject(id);
  });

  it("on 0.6c's networks: just before the app camera starts, its service is checked to be on the project's front network alone; with a problem the app is stopped, the camera does not run and no screenshot is recorded", async () => {
    const { j, jobs } = make();
    const id = await ready(j);
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    await jobs.approve(id, "01-data");
    await j.waitForJob();
    const problem = 'Compose puts the acceptance service on network_mode "host", not on the project\'s front network';
    const runsBefore = sandboxes.cameraRuns;
    const checksBefore = sandboxes.cameraNetworkChecks;
    sandboxes.cameraNetwork = problem;
    try {
      await jobs.approve(id, "02-submitter-screen");
      await j.waitForJob();
    } finally {
      sandboxes.cameraNetwork = null;
    }
    const s = await j.state(id);
    expect(s.jobs.at(-1)).toMatchObject({ kind: "preview", state: "failed", reason: `The app camera did not start: ${problem}. No screenshot was recorded.` });
    expect(sandboxes.cameraNetworkChecks - checksBefore).toBe(1);
    expect(sandboxes.cameraRuns).toBe(runsBefore);
    expect(sandboxes.stoppedApps).toContain(id);
    expect(s.appRunning).toBe(false);
    expect(await listEvents(pool, id, EV.screenshot)).toEqual([]);
    expect(existsSync(join(dataDir, "journey", id, "camera-runs")) ? readdirSync(join(dataDir, "journey", id, "camera-runs")) : []).toEqual([]);
    // With the service on front alone, the preview is made; the app's start records where it is reached from.
    await jobs.preview(id);
    await j.waitForJob();
    expect((await j.state(id)).previewFinished).toBe(true);
    expect(sandboxes.cameraRuns).toBe(runsBefore + 1);
    const started = (await listEvents(pool, id, EV.appStarted)).at(-1)!;
    // Package J3: the record also says the live preview's streams reach it, and that a live view is offered.
    expect(started.payload).toEqual({
      app_url: "http://app:3161",
      reached_from: "containers on the project's front network only; no port of the app or its database on the machine; the live preview's streams are check containers on that network, whose HTTP the builder's preview front reads on the machine",
      live_view: true,
    });
    const made = (await listEvents(pool, id, EV.sandboxMade))[0]!;
    expect(made.payload).toMatchObject({ app_url: "http://app:3161", build_proxy_port: 13161 });
    expect(Object.keys(made.payload)).not.toContain("db_port");
    await j.closeProject(id);
  });

  it("the run a checklist job made is the runner's record written between the job's start and its end; a job that ended before the runner wrote any event has none, even after an earlier run", () => {
    let n = 0;
    const ev = (kind: string, payload: Record<string, unknown>) => ({ id: String(++n), project_id: "j1-0123456789ab", at: new Date(), kind, step: null, payload }) as Parameters<typeof jobRunFinished>[0][number];
    const job = (jobId: string, startedEventId: string, state: JobRecord["state"]): JobRecord => ({ jobId, kind: "acceptance", step: null, state, startedEventId, reason: null });
    const events = [
      ev(EV.jobStarted, { job_id: "a", kind: "acceptance" }), // 1
      ev("acceptance.run.started", { run_id: "r1" }), // 2
      ev("acceptance.run.finished", { run_id: "r1", outcome: "passed" }), // 3
      ev(EV.jobFinished, { job_id: "a", run_id: "r1" }), // 4
      ev(EV.jobStarted, { job_id: "b", kind: "acceptance" }), // 5
      ev(EV.jobFailed, { job_id: "b", reason: "the job stopped with an error (Error)" }), // 6
      ev(EV.jobStarted, { job_id: "c", kind: "acceptance" }), // 7
      ev("acceptance.run.finished", { run_id: "r3", outcome: "not passed" }), // 8
      ev(EV.jobFailed, { job_id: "c", reason: "the job stopped with an error (Error)" }), // 9
      ev(EV.jobStarted, { job_id: "d", kind: "acceptance" }), // 10
    ];
    expect(jobRunFinished(events, job("a", "1", "finished"))?.payload.run_id).toBe("r1");
    expect(jobRunFinished(events, job("b", "5", "failed"))).toBeUndefined(); // not r1, the earlier job's run
    expect(jobRunFinished(events, job("c", "7", "failed"))?.payload.run_id).toBe("r3"); // written, then the job failed
    expect(jobRunFinished(events, job("d", "10", "running"))).toBeUndefined();
    expect(jobRunFinished(events, job("d", "10", "interrupted"))).toBeUndefined();
  });
});

describe("J1 journey, part 2: the adapter removes only journey sandboxes", () => {
  it("a project id that is not j1- and 12 hexadecimal characters is refused; a recorded folder is removed only if it is makeExample1's and its compose file names this project", () => {
    expect(() => checkJourneyId("p_other_project")).toThrow(/not a journey project's id/);
    expect(() => checkJourneyId("j1-../../x")).toThrow(/not a journey project's id/);
    expect(() => checkJourneyId("j1-0123456789ab")).not.toThrow();
    const base = mkdtempSync(join(tmpdir(), "builder-journey-adapter-"));
    try {
      const id = "j1-0123456789ab";
      const good = join(base, "builder-acceptance-abc123");
      mkdirSync(good);
      writeFileSync(join(good, "compose.yaml"), `name: "builder_${id}"\nservices: {}\n`);
      expect(recordedSandboxRefusal(id, good)).toBeNull();
      expect(recordedSandboxRefusal("j1-ffffffffffff", good)).toBe("the recorded folder's compose file names another project");
      const wrongName = join(base, "my-own-folder");
      mkdirSync(wrongName);
      writeFileSync(join(wrongName, "compose.yaml"), `name: "builder_${id}"\n`);
      expect(recordedSandboxRefusal(id, wrongName)).toBe("the recorded folder is not one makeExample1 makes");
      expect(recordedSandboxRefusal(id, "relative/builder-acceptance-x")).toBe("the recorded folder is not an absolute, plain path");
      expect(recordedSandboxRefusal(id, `${good}/../builder-acceptance-abc123`)).toBe("the recorded folder is not an absolute, plain path");
      const empty = join(base, "builder-acceptance-empty");
      mkdirSync(empty);
      expect(recordedSandboxRefusal(id, empty)).toBe("the recorded folder holds no compose file");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("J1 journey on package 0.6c's private networks: the adapter, the app camera and the automated run's checks", () => {
  /** The camera's network check's refusals when front is not one of 0.6c's private networks (the option's name as 0.6c's manager writes it). */
  const NOT_INTERNAL = "Compose reads the project's front network as not internal: Docker would give it a route out";
  const NOT_ISOLATED = 'Compose reads the project\'s front network without com.docker.network.bridge.gateway_mode_ipv4 "isolated": Docker would put an address of the machine on it';
  const freePort = () =>
    new Promise<number>((ok) => {
      const s = net.createServer().listen(0, "127.0.0.1", () => {
        const port = (s.address() as net.AddressInfo).port;
        s.close(() => ok(port));
      });
    });
  const hold = (port: number) => new Promise<net.Server>((ok) => { const s = net.createServer().listen(port, "127.0.0.1", () => ok(s)); });
  /** A compose file's services, each as its block of text (the file is the sandbox manager's toYaml). */
  const serviceBlocks = (yaml: string): Record<string, string> => {
    const lines = yaml.slice(yaml.indexOf("\nservices:\n") + "\nservices:\n".length).split("\n");
    const out: Record<string, string> = {};
    let name: string | null = null;
    for (const l of lines) {
      const m = /^  ([a-z][a-z-]*):$/.exec(l);
      if (m) name = m[1]!;
      else if (/^\S/.test(l)) name = null;
      else if (name) out[name] = (out[name] ?? "") + l + "\n";
    }
    return out;
  };

  it("a journey sandbox puts the app on the project's private networks: the app at http://app:3161, no port on the machine, the runner's service on front alone, only the machine side on the machine's network; Compose reads it the same", async () => {
    const port = await freePort();
    const savedProxy = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = savedProxy || "http://127.0.0.1:9"; // makeExample1 names the session's proxy to the machine side; nothing is started here
    let x: ProjectSandbox | null = null;
    try {
      x = await example1Sandboxes({ buildProxyPort: port }).make("j1-0123456789ab");
      expect(x.appUrl).toBe(`http://app:${J1_APP_PORT}`);
      expect(x.buildProxyPort).toBe(port);
      const yaml = readFileSync(join(x.dir, "compose.yaml"), "utf8");
      const s = serviceBlocks(yaml);
      expect(Object.keys(s).sort()).toEqual(["acceptance", "app", "check", "db", "egress", "egress-host", "engine", "tools"]);
      expect(yaml).not.toMatch(/^\s+ports:/m); // no port of any service published on the machine
      expect(yaml.match(/network_mode: "host"/g)).toHaveLength(1);
      expect(s["egress-host"]).toContain('network_mode: "host"');
      expect(s["egress-host"]).toContain(`EGRESS_BUILD_PORT: "${port}"`);
      expect(s.acceptance).toContain('    networks:\n      - "front"\n');
      expect(s.acceptance).toContain('BASE_URL: "http://app:3161"');
      expect(s.acceptance).not.toContain("network_mode");
      expect(s.app).toContain('    networks:\n      - "data"\n      - "front"\n');
      expect(s.app).not.toContain("network_mode");
      // Compose's own reading of the file, as the camera's check asks it (no container is started by `config`).
      expect(await cameraNetworkProblem(x.sb)).toBeNull();
      // The same file with front an ordinary bridge (`internal` dropped), or without 0.6c's isolated gateway option:
      // the service is still on front alone, and the real Compose's reading of each is refused.
      const frontBlock = '  front:\n    internal: true\n    enable_ipv6: false\n    driver_opts:\n      com.docker.network.bridge.gateway_mode_ipv4: "isolated"\n';
      expect(yaml.split(frontBlock)).toHaveLength(2);
      for (const [file, block, expected] of [
        ["compose-front-bridge.yaml", '  front:\n    enable_ipv6: false\n    driver_opts:\n      com.docker.network.bridge.gateway_mode_ipv4: "isolated"\n', NOT_INTERNAL],
        ["compose-front-not-isolated.yaml", "  front:\n    internal: true\n    enable_ipv6: false\n", NOT_ISOLATED],
      ] as const) {
        writeFileSync(join(x.dir, file), yaml.replace(frontBlock, block));
        expect(await cameraNetworkProblem({ dir: x.dir, composeFile: join(x.dir, file) }), file).toBe(expected);
      }
      // The build's port in use: no sandbox is made, and the preview is refused, each with a reason the screens show.
      const held = await hold(port);
      try {
        const refused = await example1Sandboxes({ buildProxyPort: port }).make("j1-0123456789ac").then(() => null, (e: unknown) => e);
        expect(refused).toBeInstanceOf(JourneyRefused);
        expect((refused as Error).message).toBe(`Something already listens on 127.0.0.1:${port}, the port this machine gives a project's image build (another project's running sandbox, or another program); the sandbox was not made. Close the other project, then try again.`);
        expect(await example1Sandboxes({ buildProxyPort: port }).portsBusy(x)).toBe(`Something already listens on 127.0.0.1:${port}, the port this machine gives a project's image build (another project's running sandbox, or another program); the app's images are not built and the app is not started.`);
      } finally {
        await new Promise((r) => held.close(r));
      }
      expect(await example1Sandboxes({ buildProxyPort: port }).portsBusy(x)).toBeNull();
      expect(await buildPortRefusal(port, "x")).toBeNull();
    } finally {
      if (savedProxy === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = savedProxy;
      if (x) rmSync(x.dir, { recursive: true, force: true });
    }
  });

  it("the camera's network check: only a service on the project's front network and nothing else passes, with front internal and in 0.6c's isolated gateway mode, as Compose reads it", async () => {
    // front as 0.6c's manager writes it, in Compose's reading (`docker compose config --format json`).
    const front = () => ({ name: "builder_j1-0123456789ab_front", driver_opts: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" } as Record<string, string>, ipam: {}, internal: true as boolean, enable_ipv6: false });
    const reading = (service: object, f: object | null = front()) => ({ services: { acceptance: service }, networks: f === null ? {} : { front: f } });
    const onFront = { networks: { front: null } };
    expect(frontOnlyProblem(reading(onFront), "acceptance")).toBeNull();
    expect(frontOnlyProblem(reading({ networks: ["front"] }), "acceptance")).toBeNull();
    expect(frontOnlyProblem(reading({ network_mode: "host" }), "acceptance")).toBe('Compose puts the acceptance service on network_mode "host", not on the project\'s front network');
    expect(frontOnlyProblem(reading({ networks: { front: null, data: null } }), "acceptance")).toBe("Compose puts the acceptance service on front, data, not on the project's front network alone");
    expect(frontOnlyProblem(reading({ networks: { default: null } }), "acceptance")).toBe("Compose puts the acceptance service on default, not on the project's front network alone");
    expect(frontOnlyProblem(reading({}), "acceptance")).toBe("Compose puts the acceptance service on no named network, not on the project's front network alone");
    expect(frontOnlyProblem({ services: {} }, "acceptance")).toBe("Compose's reading of the sandbox has no acceptance service");
    // The service on front alone, but front is not one of 0.6c's private networks: refused.
    const { internal: _dropped, ...bridge } = front(); // an ordinary bridge: Compose leaves `internal` out when it is not set
    expect(frontOnlyProblem(reading(onFront, bridge), "acceptance")).toBe(NOT_INTERNAL);
    expect(frontOnlyProblem(reading(onFront, { ...front(), internal: false }), "acceptance")).toBe(NOT_INTERNAL);
    expect(frontOnlyProblem(reading(onFront, { ...bridge, driver_opts: {} }), "acceptance")).toBe(NOT_INTERNAL);
    const { driver_opts: _none, ...noOptions } = front();
    expect(frontOnlyProblem(reading(onFront, noOptions), "acceptance")).toBe(NOT_ISOLATED);
    expect(frontOnlyProblem(reading(onFront, { ...front(), driver_opts: {} }), "acceptance")).toBe(NOT_ISOLATED);
    expect(frontOnlyProblem(reading(onFront, { ...front(), driver_opts: { "com.docker.network.bridge.gateway_mode_ipv4": "nat" } }), "acceptance")).toBe(NOT_ISOLATED);
    expect(frontOnlyProblem(reading(onFront, { ...front(), driver_opts: { "com.docker.network.bridge.gateway_mode_ipv6": "isolated" } }), "acceptance")).toBe(NOT_ISOLATED);
    expect(frontOnlyProblem(reading(onFront, null), "acceptance")).toBe("Compose's reading of the sandbox has no front network");
    expect(frontOnlyProblem({ services: { acceptance: onFront } }, "acceptance")).toBe("Compose's reading of the sandbox has no front network");
    // Through a made-up docker program: what Compose answers is what is judged, and a failure refuses.
    const bin = mkdtempSync(join(tmpdir(), "builder-journey-standin-compose-"));
    const sbDir = mkdtempSync(join(tmpdir(), "builder-journey-camera-network-"));
    const savedPath = process.env.PATH;
    try {
      const frontJson = '"networks":{"front":{"name":"builder_j1-0123456789ab_front","driver_opts":{"com.docker.network.bridge.gateway_mode_ipv4":"isolated"},"ipam":{},"internal":true,"enable_ipv6":false}}';
      for (const [answer, expected] of [
        [`{"services":{"acceptance":{"networks":{"front":null}}},${frontJson}}`, null],
        [`{"services":{"acceptance":{"network_mode":"host"}},${frontJson}}`, 'Compose puts the acceptance service on network_mode "host", not on the project\'s front network'],
        [`{"services":{"acceptance":{"networks":{"front":null}}},${frontJson.replace('"internal":true,', "")}}`, NOT_INTERNAL],
        [`{"services":{"acceptance":{"networks":{"front":null}}},${frontJson.replace('"isolated"', '"nat"')}}`, NOT_ISOLATED],
        ["", "Compose could not read the sandbox's services"],
      ] as const) {
        writeFileSync(join(bin, "docker"), `#!/bin/sh\necho "$*" > "$(dirname "$0")/calls"\n${answer ? `echo '${answer}'` : "exit 1"}\n`, { mode: 0o755 });
        process.env.PATH = `${bin}:${savedPath ?? ""}`;
        const got = await cameraNetworkProblem({ dir: sbDir, composeFile: join(sbDir, "compose.yaml") });
        if (expected === "Compose could not read the sandbox's services") expect(got, answer).toMatch(/^Compose could not read the sandbox's services \(/);
        else expect(got, answer).toBe(expected);
        expect(readFileSync(join(bin, "calls"), "utf8").trim()).toBe(`compose -f ${join(sbDir, "compose.yaml")} --profile acceptance config --format json`);
      }
    } finally {
      process.env.PATH = savedPath;
      rmSync(bin, { recursive: true, force: true });
      rmSync(sbDir, { recursive: true, force: true });
    }
  });

  it("the adapter runs the app camera in the project's acceptance service (on front), with its script read-only, its folder and the password file, and no address of its own", async () => {
    const calls: Array<{ service: string; cmd: string[]; opts: StreamingOptions }> = [];
    const saved = sandboxManager.runStreaming;
    sandboxManager.runStreaming = ((_sb: Sandbox, service: string, cmd: string[], opts: StreamingOptions) => {
      calls.push({ service, cmd, opts });
      return { container: opts.container, done: Promise.resolve({ code: 0, stderrTail: "" }), kill: async () => undefined };
    }) as typeof sandboxManager.runStreaming;
    try {
      const x = { projectId: "j1-0123456789ab", sb: { projectName: "builder_j1-0123456789ab" } } as unknown as ProjectSandbox;
      const end = await example1Sandboxes().appCamera(x, { outDir: "/made-up/out", secretFile: "/made-up/secret/sample-password", onLine: () => undefined });
      expect(end.code).toBe(0);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.service).toBe("acceptance");
      expect(calls[0]!.cmd).toEqual(["node", "/camera/app-shots.mjs"]);
      expect(calls[0]!.opts.volumes).toEqual([`${join(builderDir, "camera", "app-shots.mjs")}:/camera/app-shots.mjs:ro`, "/made-up/out:/shots", "/made-up/secret/sample-password:/run/secrets/sample-password:ro"]);
      expect(calls[0]!.opts.env).toBeUndefined(); // BASE_URL is the service's own, http://app:<port>
      expect(calls[0]!.opts.container).toMatch(/^builder_j1-0123456789ab-app-camera-[0-9a-f]{6}$/);
    } finally {
      sandboxManager.runStreaming = saved;
    }
  });

  it("the app camera loads its browser only for http://app:<port>, the app's address on the project's front network; any other address stops it first", () => {
    const camera = join(builderDir, "camera", "app-shots.mjs");
    // Before the script is run on this machine: the runner's playwright must be absent here, at the path the script
    // imports it from (its one import besides node:fs), so that running it here can never reach a browser. If it is
    // present, the test fails here and the script is not run.
    const source = readFileSync(camera, "utf8");
    const browserImports = [...source.matchAll(/\bimport\s*\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]!);
    expect(browserImports).toEqual(["/runner/node_modules/playwright-core/index.mjs"]);
    expect(source.match(/\bimport\b.*$/gm)).toEqual(['import { readFileSync } from "node:fs";', 'import("/runner/node_modules/playwright-core/index.mjs");']);
    for (const path of [browserImports[0]!, dirname(browserImports[0]!)]) expect(lstatSync(path, { throwIfNoEntry: false }), `${path} is on this machine`).toBeUndefined();
    const runWith = (base: string | undefined) =>
      spawnSync(process.execPath, [camera], { env: { PATH: process.env.PATH ?? "", ...(base === undefined ? {} : { BASE_URL: base }) }, encoding: "utf8", timeout: 30_000 });
    for (const base of [undefined, "", "http://127.0.0.1:3161", "http://localhost:3161", "https://app:3161", "http://app:3161/en", "http://app.example.test:3161", "http://app", "http://APP:3161"]) {
      const r = runWith(base);
      expect(r.status, String(base)).toBe(2);
      expect(r.stdout.trim(), String(base)).toBe(JSON.stringify({ kind: "error", reason: "BASE_URL is not the app's address on the project's front network, http://app:<port>" }));
      expect(r.stderr, String(base)).not.toContain("playwright"); // the browser was never loaded
    }
    // The app's address: past the check, it loads the browser (on this machine the runner image's copy is not there).
    const r = runWith("http://app:3161");
    expect(r.status).not.toBe(2);
    expect(r.stderr).toContain("ERR_MODULE_NOT_FOUND");
    expect(r.stderr).toContain("/runner/node_modules/playwright-core/index.mjs");
  });

  it("the automated run's checks on Docker's list of J1's containers: no published port, only the machine side on the machine's network, the app camera and the runner on front alone, the app on data and front", () => {
    const p = "builder_j1-0123456789ab";
    const good = (): Map<string, { networks: string; ports: string }> =>
      new Map([
        [`${p}-egress-host-1`, { networks: "host", ports: "" }],
        [`${p}-egress-1`, { networks: `${p}_out`, ports: "" }],
        [`${p}-db-1`, { networks: `${p}_data`, ports: "5432/tcp" }],
        [`${p}-app-1`, { networks: `${p}_data,${p}_front`, ports: "" }],
        [`${p}-app-camera-a1b2c3`, { networks: `${p}_front`, ports: "" }],
        [`${p}-acceptance-run-1`, { networks: `${p}_front`, ports: "" }],
        [`${p}-check-run-0f9e8d7c6b5a`, { networks: `${p}_front`, ports: "" }],
      ]);
    expect(networkChecks(good()).map((c) => [c.name, c.ok])).toEqual([
      ["no J1 container published a port on the machine (Docker's list, every second)", true],
      ["only the door's machine side (egress-host) was on the machine's network", true],
      ["the app camera ran on the project's front network alone", true],
      ["the acceptance runner ran on the project's front network alone", true],
      ["the app was on the project's data and front networks alone", true],
      ["every check container seen (it asks the app before a start or a run) was on the front network alone", true],
    ]);
    const failing = (change: (m: Map<string, { networks: string; ports: string }>) => void) => {
      const m = good();
      change(m);
      return networkChecks(m).filter((c) => !c.ok).map((c) => c.name);
    };
    expect(failing((m) => m.set(`${p}-app-1`, { networks: `${p}_data,${p}_front`, ports: "127.0.0.1:3161->3161/tcp" }))).toEqual(["no J1 container published a port on the machine (Docker's list, every second)"]);
    expect(failing((m) => m.set(`${p}-app-camera-a1b2c3`, { networks: "host", ports: "" }))).toEqual(["only the door's machine side (egress-host) was on the machine's network", "the app camera ran on the project's front network alone"]);
    expect(failing((m) => m.set(`${p}-app-camera-a1b2c3`, { networks: `${p}_data,${p}_front`, ports: "" }))).toEqual(["the app camera ran on the project's front network alone"]);
    expect(failing((m) => m.delete(`${p}-app-camera-a1b2c3`))).toEqual(["the app camera ran on the project's front network alone"]);
    expect(failing((m) => m.set(`${p}-acceptance-run-1`, { networks: `${p}_front,${p}_out`, ports: "" }))).toEqual(["the acceptance runner ran on the project's front network alone"]);
    expect(failing((m) => m.set(`${p}-app-1`, { networks: `${p}_data,${p}_front,bridge`, ports: "" }))).toEqual(["the app was on the project's data and front networks alone"]);
    expect(failing((m) => m.set(`${p}-check-run-0f9e8d7c6b5a`, { networks: "host", ports: "" }))).toEqual(["only the door's machine side (egress-host) was on the machine's network", "every check container seen (it asks the app before a start or a run) was on the front network alone"]);
    expect(failing((m) => m.clear())).toContain("no J1 container published a port on the machine (Docker's list, every second)");
  });
});

describe("J1 journey, brought up to date with 3.1b: both cameras check the runner image first, with runnerImageProblem", () => {
  /** A made-up docker program: it answers `docker image inspect` only, as its mode file says, and writes down every call. */
  function standInDocker(mode: "right label" | "no label" | "another fingerprint" | "no such image") {
    const bin = mkdtempSync(join(tmpdir(), "builder-journey-standin-docker-"));
    const labels =
      mode === "right label" ? `{"builder.package":"3.1","${BROWSER_ZIP_LABEL}":"${BROWSER_ZIP_SHA256}"}`
      : mode === "another fingerprint" ? `{"builder.package":"3.1","${BROWSER_ZIP_LABEL}":"${"0".repeat(64)}"}`
      : '{"builder.package":"3.1"}';
    const script = [
      "#!/bin/sh",
      'echo "$*" >> "$(dirname "$0")/calls"',
      'if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then',
      mode === "no such image" ? `  echo "Error response from daemon: No such image: ${RUNNER_IMAGE}" >&2; exit 1` : `  echo '${labels}'; exit 0`,
      "fi",
      'echo "made-up docker: only image inspect is answered" >&2',
      "exit 1",
      "",
    ].join("\n");
    writeFileSync(join(bin, "docker"), script, { mode: 0o755 });
    return { bin, calls: () => (existsSync(join(bin, "calls")) ? readFileSync(join(bin, "calls"), "utf8").trim().split("\n") : []) };
  }

  it("the app camera: the adapter asks runnerImageProblem of the image the sandbox's acceptance service names, with the sandbox's Docker settings", async () => {
    const sbDir = mkdtempSync(join(tmpdir(), "builder-journey-camera-image-"));
    const savedPath = process.env.PATH;
    try {
      expect(await cameraImageProblem({ dir: sbDir })).toBe("the sandbox has no acceptance service");
      for (const [mode, expected] of [
        ["right label", null],
        ["no label", `the runner image ${RUNNER_IMAGE} has no ${BROWSER_ZIP_LABEL} label, so it was not built by this version of the builder from the approved browser zip: build it again`],
        ["another fingerprint", `the runner image ${RUNNER_IMAGE} was built from a browser zip with another fingerprint, not the approved ${BROWSER_ZIP_SHA256}: build it again`],
        ["no such image", `the runner image ${RUNNER_IMAGE} is not on this machine: it is built from the approved browser zip (scripts/fetch-browser.ts fetches the zip; the image is built by buildRunnerImage)`],
      ] as const) {
        const d = standInDocker(mode);
        try {
          process.env.PATH = `${d.bin}:${savedPath ?? ""}`;
          expect(await cameraImageProblem({ dir: sbDir, acceptanceImage: RUNNER_IMAGE }), mode).toBe(expected);
          expect(d.calls(), mode).toEqual([`image inspect --format {{json .Config.Labels}} ${RUNNER_IMAGE}`]);
        } finally {
          process.env.PATH = savedPath;
          rmSync(d.bin, { recursive: true, force: true });
        }
      }
    } finally {
      process.env.PATH = savedPath;
      rmSync(sbDir, { recursive: true, force: true });
    }
  });

  it("the builder camera: the automated run checks the runner image before anything else, and is refused with runnerImageProblem's reason, starting and writing nothing", () => {
    for (const mode of ["no label", "no such image"] as const) {
      const d = standInDocker(mode);
      const evidence = mkdtempSync(join(tmpdir(), "builder-journey-demo-refused-"));
      try {
        const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/demo-journey.ts", evidence], {
          cwd: builderDir,
          env: { PATH: `${d.bin}:${process.env.PATH ?? ""}`, HOME: process.env.HOME ?? "/root", NO_COLOR: "1" },
          encoding: "utf8",
          timeout: 60_000,
        });
        const out = `${r.stdout}\n${r.stderr}`;
        expect(r.status, out).toBe(2);
        expect(out, mode).toMatch(mode === "no label" ? new RegExp(`Refused: the runner image ${RUNNER_IMAGE.replace(/[.:-]/g, "\\$&")} has no ${BROWSER_ZIP_LABEL.replace(/\./g, "\\.")} label`) : /Refused: the runner image builder-acceptance-runner:local is not on this machine/);
        expect(out).toContain("Nothing was started.");
        // The image check was the only Docker call: no container listed, no database made, no port tried.
        expect(d.calls(), mode).toEqual([`image inspect --format {{json .Config.Labels}} ${RUNNER_IMAGE}`]);
        expect(out).not.toMatch(/Builder tree|Fresh database|docker system df before|Ports .* free before the run/);
        // Nothing written into the evidence folder but its empty screens folder.
        expect(readdirSync(evidence)).toEqual(["screens"]);
        expect(readdirSync(join(evidence, "screens"))).toEqual([]);
      } finally {
        rmSync(d.bin, { recursive: true, force: true });
        rmSync(evidence, { recursive: true, force: true });
      }
    }
  });
});

describe("J1 journey after the review bot on defb9c4: the app camera's container is killed when its job is told to stop", () => {
  it("the adapter's app camera, given a signal that is then aborted (the interface lost its instance lock), kills its container by name at once (a made-up docker program; no container) (review bot on defb9c4, the fix's parts)", async () => {
    const bin = mkdtempSync(join(tmpdir(), "builder-journey-standin-docker-"));
    const sbDir = mkdtempSync(join(tmpdir(), "builder-journey-camera-kill-"));
    const outDir = join(sbDir, "out");
    mkdirSync(outDir);
    const secretFile = join(sbDir, "sample-password");
    writeFileSync(secretFile, "made-up-sample-password", { mode: 0o400 });
    // `compose ... run` writes its process id and sleeps; `kill <name>` ends that process, as Docker ends a killed container's run.
    const script = [
      "#!/bin/sh",
      'here="$(dirname "$0")"',
      'echo "$*" >> "$here/calls"',
      'if [ "$1" = "compose" ]; then echo $$ > "$here/pid"; exec sleep 30; fi',
      'if [ "$1" = "kill" ]; then kill "$(cat "$here/pid")"; exit 0; fi',
      "exit 0",
      "",
    ].join("\n");
    writeFileSync(join(bin, "docker"), script, { mode: 0o755 });
    const calls = () => (existsSync(join(bin, "calls")) ? readFileSync(join(bin, "calls"), "utf8").trim().split("\n") : []);
    const savedPath = process.env.PATH;
    const projectId = "j1-0123456789ab";
    const x = { projectId, sb: { dir: sbDir, composeFile: join(sbDir, "compose.yaml"), projectName: `builder_${projectId}` } } as unknown as ProjectSandbox;
    try {
      process.env.PATH = `${bin}:${savedPath ?? ""}`;
      const ac = new AbortController();
      const t0 = Date.now();
      const running = example1Sandboxes().appCamera(x, { outDir, secretFile, onLine: () => undefined, signal: ac.signal });
      for (let i = 0; i < 100 && !existsSync(join(bin, "pid")); i++) await new Promise((r) => setTimeout(r, 50));
      expect(existsSync(join(bin, "pid"))).toBe(true);
      ac.abort("made-up: the interface lost its instance lock");
      // Not ended within 12 s (the made-up run sleeps 30 s unless killed): the test ends that process itself, then fails.
      const end = await Promise.race([running, new Promise<"not ended">((r) => setTimeout(() => r("not ended"), 12_000))]);
      if (end === "not ended") {
        try {
          process.kill(Number(readFileSync(join(bin, "pid"), "utf8").trim()));
        } catch {
          /* already gone */
        }
        await running;
      }
      expect(end).not.toBe("not ended");
      expect((end as { code: number | null }).code).not.toBe(0);
      expect(Date.now() - t0).toBeLessThan(12_000);
      const run = calls().find((c) => c.startsWith("compose "))!;
      const name = /--name (\S+)/.exec(run)![1]!;
      expect(name.startsWith(`builder_${projectId}-app-camera-`)).toBe(true);
      expect(calls()).toContain(`kill ${name}`);
    } finally {
      process.env.PATH = savedPath;
      rmSync(bin, { recursive: true, force: true });
      rmSync(sbDir, { recursive: true, force: true });
    }
  });
});

/* ---------------------------------------------------------------- package J3: the live app (stand-in sandbox, the forked front) */

describe("J3: the live app, on the journey (stand-in sandbox, the real front, a stand-in app on this machine's loopback address)", () => {
  let sandboxes: StandInSandboxes;
  let upstream: import("node:http").Server;
  let previews: LivePreview[] = [];
  beforeAll(async () => {
    sandboxes = new StandInSandboxes(pool);
    const http = await import("node:http");
    upstream = http.createServer((_q, s) => s.writeHead(200, { "content-type": "text/html" }).end("made-up app page"));
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    sandboxes.upstreamPort = (upstream.address() as net.AddressInfo).port;
  });
  afterAll(async () => {
    for (const p of previews) await p.stop().catch(() => undefined);
    sandboxes.removeAll();
    await new Promise((r) => upstream.close(r));
  });

  const make = async () => {
    const box: { jobs?: JourneyJobs } = {};
    const j = new Journey({ pool, dataDir, cleanupProject: (id, rec) => box.jobs!.cleanup(id, rec) });
    const jobs = new JourneyJobs({ journey: j, sandboxes, measureFree: () => 50 * 1024 ** 3 });
    box.jobs = jobs;
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const port = (s.address() as net.AddressInfo).port;
    await new Promise((r) => s.close(r));
    const preview = new LivePreview({ port, texts: frontTexts(), base: "/tmp", openStream: (id) => jobs.openStream(id), onEvent: async (id, kind, payload) => void (await appendEvent(pool, id, kind, payload)) });
    previews.push(preview);
    await preview.start();
    jobs.attachPreview(preview);
    return { j, jobs, preview, port };
  };
  const previewed = async (j: Journey, jobs: JourneyJobs) => {
    const id = await j.createProject({ name: "Leave requests (made-up, J3)", cap: "5", brief: "I need an app where staff can request leave and managers approve it" });
    await j.continueWithExample(id);
    await j.answerRestFromSheet(id);
    await j.confirmBrief(id);
    await j.confirmPlan(id);
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    await jobs.approve(id, "01-data");
    await j.waitForJob();
    await jobs.approve(id, "02-submitter-screen");
    await j.waitForJob();
    return id;
  };
  const enter = (port: number, shown: string) =>
    fetch(`http://127.0.0.1:${port}/__builder/enter`, { method: "POST", headers: { origin: `http://127.0.0.1:${port}`, "content-type": "application/x-www-form-urlencoded" }, body: `pass=${shown}`, redirect: "manual" });

  it("opens only while the app runs, as a live job; records live_opened without the pass; the pass works once at the front", async () => {
    const { j, jobs, port } = await make();
    const id = await j.createProject({ name: "Not built (made-up)", cap: "5", brief: "Made-up brief." });
    await expect(jobs.openLive(id, "builder-session")).rejects.toThrow(/plan is not confirmed|not running/);
    const id2 = await previewed(j, jobs);
    expect((await j.state(id2)).appStartedEventId).not.toBeNull();
    const started = await listEvents(pool, id2, EV.appStarted);
    expect(started.at(-1)!.payload).toMatchObject({ live_view: true });
    const r = await jobs.openLive(id2, "builder-session");
    await j.waitForJob();
    const s = await j.state(id2);
    expect(s.jobs.at(-1)).toMatchObject({ kind: "live", state: "finished" });
    const opened = await listEvents(pool, id2, EV.liveOpened);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.payload).toMatchObject({ session: r.sessionId, pass_recorded: false, label: "Simulated build: scripted engine, sample data" });
    // The pass is in no event of the project, in any spelling.
    const all = JSON.stringify((await listEvents(pool, id2)).map((e) => e.payload));
    expect(all.includes(r.pass)).toBe(false);
    expect(all.includes(r.shown)).toBe(false);
    expect((await enter(port, r.shown)).status).toBe(303);
    await new Promise((x) => setTimeout(x, 100));
    expect((await listEvents(pool, id2, EV.liveEntered)).at(-1)!.payload).toMatchObject({ session: r.sessionId });
    expect(sandboxes.streamNetworkChecks).toBeGreaterThan(0);
    await j.closeProject(id);
    await j.closeProject(id2);
  });

  it("is refused for a record that does not show the scripted engine's fixed change sets alone: a model call, or an engine event of another kind", async () => {
    const { j, jobs } = await make();
    const id = await previewed(j, jobs);
    await appendEvent(pool, id, EV.engineEvent, { type: "tool_call", tool: "Write", input: { path: "src/x.ts" }, at: new Date().toISOString() }, "02-submitter-screen");
    await expect(jobs.openLive(id, "builder-session")).rejects.toThrow(/not one the scripted engine writes/);
    expect(scriptedOnlyProblem(await j.state(id))).toMatch(/not one the scripted engine writes/);
    // One project's app runs at a time: each is closed before the next is previewed.
    await j.closeProject(id);
    const id2 = await previewed(j, jobs);
    await appendEvent(pool, id2, "model.call", { model: "made-up" });
    await expect(jobs.openLive(id2, "builder-session")).rejects.toThrow(/holds a model call/);
    // A write whose digest is not the fixed change's.
    await j.closeProject(id2);
    const id3 = await previewed(j, jobs);
    const s3 = await j.state(id3);
    expect(scriptedOnlyProblem(s3)).toBeNull();
    const w = s3.events.find((e) => e.kind === EV.engineEvent && e.payload.type === "tool_call")!;
    const tampered = s3.events.map((e) => (e.id === w.id ? { ...e, payload: { ...e.payload, input: { ...(e.payload.input as object), sha256: "0".repeat(64) } } } : e));
    expect(scriptedOnlyProblem({ ...s3, events: tampered })).toMatch(/not exactly its fixed change's files/);
    await j.closeProject(id3);
  });

  it("is refused when Compose does not read the check service as on front alone", async () => {
    const { j, jobs } = await make();
    const id = await previewed(j, jobs);
    sandboxes.streamNetwork = "Compose puts the check service on front, out, not on the project's front network alone";
    try {
      await expect(jobs.openLive(id, "builder-session")).rejects.toThrow(/front network alone/);
    } finally {
      sandboxes.streamNetwork = null;
    }
    expect(await listEvents(pool, id, EV.liveOpened)).toHaveLength(0);
    // The refusal comes from inside the live job, and reaches the caller before that job's ending is written. Closing
    // at once raced with it ("A job is running for this project"): seen once, in the whole-suite run of 14 Nov 2026 on
    // abe41e5. The job is waited for first, as the tests around this one do.
    await j.waitForJob();
    await j.closeProject(id);
  });

  it("the checklist ends the live session first, and its record says the app was used live and its data changed", async () => {
    const { j, jobs, port, preview } = await make();
    const id = await previewed(j, jobs);
    const r = await jobs.openLive(id, "builder-session");
    await j.waitForJob();
    expect((await enter(port, r.shown)).status).toBe(303);
    await new Promise((x) => setTimeout(x, 100));
    expect(preview.status(id)?.entered).toBe(true);
    await jobs.acceptance(id);
    await j.waitForJob();
    expect(preview.status(id)).toBeNull();
    expect((await listEvents(pool, id, EV.liveClosed)).at(-1)!.payload).toMatchObject({ reason: "checklist", entered: true });
    const finished = (await listEvents(pool, id, EV.jobFinished)).at(-1)!;
    expect(finished.payload).toMatchObject({ kind: "acceptance", app_used_live: true, app_used_live_note: "The app was used live before this run; its data changed." });
    // The order: the session closed before the run's first event.
    const ev = await listEvents(pool, id);
    const closedAt = ev.findIndex((e) => e.kind === EV.liveClosed);
    const runAt = ev.findIndex((e) => e.kind.startsWith("acceptance.run"));
    expect(closedAt).toBeGreaterThan(-1);
    expect(runAt === -1 || closedAt < runAt).toBe(true);
    await j.closeProject(id);
  });

  it("closing the project ends the live session (project_closed); Show gives the made-up employee only while the app runs", async () => {
    const { j, jobs, preview } = await make();
    const id = await previewed(j, jobs);
    expect(jobs.sampleSignIn(id)).toEqual({ email: "employee@example.test", password: "made-up-sample-password" });
    await jobs.openLive(id, "builder-session");
    await j.waitForJob();
    await j.closeProject(id);
    expect(preview.status(id)).toBeNull();
    expect((await listEvents(pool, id, EV.liveClosed)).at(-1)!.payload).toMatchObject({ reason: "project_closed" });
    expect(() => jobs.sampleSignIn(id)).toThrow(/not held|not running/);
  });

  it("a stream is opened only for a project whose app this interface runs; otherwise the session ends (app_stopped)", async () => {
    const { j, jobs, port, preview } = await make();
    const id = await previewed(j, jobs);
    const r = await jobs.openLive(id, "builder-session");
    await j.waitForJob();
    const cookie = ((await enter(port, r.shown)).headers.get("set-cookie") ?? "").split(";")[0]!;
    await new Promise((x) => setTimeout(x, 100));
    const before = sandboxes.streamsOpened;
    expect(await (await fetch(`http://127.0.0.1:${port}/en/home`, { headers: { cookie } })).text()).toBe("made-up app page");
    expect(sandboxes.streamsOpened).toBe(before + 1);
    jobs.handle(id)!.appStarted = false;
    const after = await fetch(`http://127.0.0.1:${port}/en/other`, { headers: { cookie: `${cookie}` }, signal: AbortSignal.timeout(10_000) }).then((x) => x.status, () => -1);
    expect([200, 502, -1]).toContain(after);
    await new Promise((x) => setTimeout(x, 200));
    // A kept-alive stream may have answered; a new one is not opened, and the session ends once one is asked for.
    if (preview.status(id)) {
      await fetch(`http://127.0.0.1:${port}/en/third`, { headers: { cookie, connection: "close" } }).catch(() => undefined);
      await preview.closeFor(id, "app_stopped");
    }
    expect(preview.status(id)).toBeNull();
    expect(sandboxes.streamsOpened).toBeLessThanOrEqual(before + 1);
    await j.closeProject(id);
  });

  it("a sign-out while live_opened is being written ends the session just opened, and its pass is not returned; with no sign-out, the same slow write returns it (review bot on af80dc9)", async () => {
    // The journey's writes of live_opened take 800 ms here; the preview's own events go straight to the database.
    const box: { jobs?: JourneyJobs } = {};
    const j = new Journey({ pool: slowPoolFor(pool, EV.liveOpened, 800), dataDir, cleanupProject: (id, rec) => box.jobs!.cleanup(id, rec) });
    const jobs = new JourneyJobs({ journey: j, sandboxes, measureFree: () => 50 * 1024 ** 3 });
    box.jobs = jobs;
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const port = (s.address() as net.AddressInfo).port;
    await new Promise((r) => s.close(r));
    const preview = new LivePreview({ port, texts: frontTexts(), base: "/tmp", openStream: (id) => jobs.openStream(id), onEvent: async (id, kind, payload) => void (await appendEvent(pool, id, kind, payload)) });
    previews.push(preview);
    await preview.start();
    jobs.attachPreview(preview);
    const id = await previewed(j, jobs);
    const opened = async () => {
      for (let i = 0; i < 200 && !preview.session(); i++) await new Promise((x) => setTimeout(x, 5));
      return preview.session();
    };
    // No sign-out: the pass is returned once the event is written.
    const first = jobs.openLive(id, "builder-session");
    expect(await opened()).not.toBeNull();
    const r = await first;
    await j.waitForJob();
    expect(r.shown).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(preview.status(id)?.sessionId).toBe(r.sessionId);
    expect(await preview.closeFor(id, "ended_on_builder")).toBe(true);
    // The sign-out comes after the session is opened, while its event is being written.
    const second = jobs.openLive(id, "builder-session");
    second.catch(() => undefined);
    const live = await opened();
    expect(live).not.toBeNull();
    await preview.signedOut("builder-session");
    expect(preview.session()).toBeNull();
    await expect(second).rejects.toThrow(/not opened/);
    await j.waitForJob();
    expect(preview.session()).toBeNull();
    expect((await j.state(id)).jobs.at(-1)).toMatchObject({ kind: "live", state: "failed" });
    expect((await listEvents(pool, id, EV.liveClosed)).at(-1)!.payload).toMatchObject({ session: live!.sessionId, reason: "sign_out" });
    await j.closeProject(id);
  });
});

/* ---------------------------------------------------------------- J2 (a): the broken copy rejected */

describe("J2 (a): the broken copy rejected (stand-in sandboxes, each with its own change-set folder; no container, no model)", () => {
  const BROKEN = BROKEN_STEP_ID;
  const NAME = "Deliberately broken copy (made-up)";
  const NEVER = "A deliberately broken copy is never signed off or exported.";
  const LIVE_REFUSED = "A deliberately broken copy is not offered as a live app: it was built to be rejected by the checklist.";
  const ASK = "I need an app where staff can request leave and managers approve it";
  const brokenManifestPath = join(builderDir, "scripted-broken", "example-1", BROKEN, "manifest.json");
  const brokenManifest = () => JSON.parse(readFileSync(brokenManifestPath, "utf8")) as { label: string; files: Array<{ path: string; sha256: string }> };
  /** The choice as the demonstration records it (final design, section 3.1). */
  const choice = () => ({ by: "owner", step: BROKEN, source: "builder/scripted-broken/example-1/03-wrong-status", label: brokenManifest().label, manifest_sha256: sha256(readFileSync(brokenManifestPath)), sign_off: "never", export: "never" });
  let sandboxes: StandInSandboxes;
  const outside: string[] = [];
  beforeAll(() => {
    sandboxes = new StandInSandboxes(pool);
  });
  afterAll(() => {
    sandboxes.removeAll();
    for (const d of outside) rmSync(d, { recursive: true, force: true });
  });

  /**
   * A journey and its jobs. `doctor`, when set, changes the state a job's body is given, as if the journey's own rules
   * had been passed some other way: a test of the job's own checks, made again inside it (final design, section 3.3).
   */
  const make = () => {
    const box: { jobs?: JourneyJobs; doctor: ((s: JourneyState) => JourneyState) | null } = { doctor: null };
    const j = new Journey({ pool, dataDir, cleanupProject: (id, rec) => box.jobs!.cleanup(id, rec) });
    const seen = Object.create(j) as Journey;
    seen.startJob = (projectId, kind, body, o) => j.startJob(projectId, kind, (ctx) => body(box.doctor ? { ...ctx, state: box.doctor(ctx.state) } : ctx), o);
    box.jobs = new JourneyJobs({ journey: seen, sandboxes, measureFree: () => 50 * 1024 ** 3 });
    return { j, jobs: box.jobs, setDoctor: (d: ((s: JourneyState) => JourneyState) | null) => void (box.doctor = d) };
  };
  const confirmed = async (j: Journey, id: string) => {
    await j.continueWithExample(id);
    await j.answerRestFromSheet(id);
    await j.confirmBrief(id);
    await j.confirmPlan(id);
    return id;
  };
  const normal = async (j: Journey, name = "Leave requests (made-up, J2)") => confirmed(j, await j.createProject({ name, cap: "5", brief: ASK }));
  const broken = async (j: Journey) => confirmed(j, await j.createBrokenCopyDemo());
  /** Steps 1 and 2 built and approved; for a broken copy, the approval of step 2 builds step 3. */
  const throughStep2 = async (j: Journey, jobs: JourneyJobs, id: string) => {
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    await jobs.approve(id, "01-data");
    await j.waitForJob();
    const r = await jobs.approve(id, "02-submitter-screen");
    await j.waitForJob();
    return r;
  };
  /** A project built, approved and previewed, its app running. */
  const previewed = async (j: Journey, jobs: JourneyJobs, id: string) => {
    const r = await throughStep2(j, jobs, id);
    if (r.next === "build_step") {
      await jobs.approve(id, BROKEN);
      await j.waitForJob();
    }
    expect((await j.state(id)).previewFinished).toBe(true);
    return id;
  };
  const passedRun = async (j: Journey, jobs: JourneyJobs, id: string) => {
    sandboxes.acceptanceOutcome = "passed";
    await jobs.acceptance(id);
    await j.waitForJob();
    expect((await j.state(id)).acceptanceRun?.outcome).toBe("passed");
  };
  const staged = (id: string) => listEvents(pool, id, "journey.broken_step_staged");
  const stagedCalls = (id: string) => sandboxes.stagedBroken.filter((c) => c.projectId === id);

  it("A1 (regression guard): a normal project goes through the whole journey on two steps; stageBrokenStep is never called; builder/scripted and builder/scripted-broken are unchanged", async () => {
    const before = changeSetFolders();
    const { j, jobs } = make();
    const id = await normal(j);
    expect((await j.state(id)).plan).toEqual(["01-data", "02-submitter-screen"]);
    const r = await throughStep2(j, jobs, id);
    expect(r.next).toBe("preview");
    await passedRun(j, jobs, id);
    await j.signOff(id);
    await jobs.exportProject(id);
    await j.waitForJob();
    const s = await j.state(id);
    expect(s.jobs.map((x) => [x.kind, x.step, x.state])).toEqual([
      ["build_step", "01-data", "finished"],
      ["build_step", "02-submitter-screen", "finished"],
      ["preview", null, "finished"],
      ["acceptance", null, "finished"],
      ["export", null, "finished"],
    ]);
    expect(s.brokenTrace).not.toBe(true);
    expect(stagedCalls(id)).toEqual([]);
    expect(await staged(id)).toEqual([]);
    expect(sandboxes.runnerCalls.filter((c) => c.container.startsWith(`builder_${id}-`)).map((c) => c.step)).toEqual(["01-data", "02-submitter-screen"]);
    const x = jobs.handle(id)!;
    expect(existsSync(join(x.changeSets, "example-1", BROKEN))).toBe(false);
    await j.closeProject(id);
    expect(changeSetFolders()).toEqual(before);
    expect(before.status).toBe("");
    expect(readdirSync(join(builderDir, "scripted", "example-1")).sort()).toEqual(["01-data", "02-submitter-screen"]);
  });

  it("A2: the demonstration makes one project: the fixed name and a $5.00 cap; its first event is intake.brief_entered with example 1's ask and broken_copy; three steps, step 3's label read from builder/scripted-broken; plan_confirmed lists all three, with broken_copy; a normal project's is unchanged", async () => {
    const { j } = make();
    const id = await j.createBrokenCopyDemo();
    expect(id).toMatch(/^j1-[0-9a-f]{12}$/);
    const s = await j.state(id);
    expect(s.project.name).toBe(NAME);
    expect(Number(s.project.cap_usd)).toBe(5);
    const first = await listEvents(pool, id);
    expect(first).toHaveLength(1);
    expect(first[0]!.kind).toBe(EV.briefEntered);
    expect(first[0]!.payload).toEqual({ text: ASK, characters: ASK.length, given_to_engine: false, broken_copy: choice() });
    expect(s.plan).toEqual(["01-data", "02-submitter-screen", BROKEN]);
    expect(s.brokenCopy).toEqual(choice());
    expect(s.brokenTrace).toBe(true);
    await confirmed(j, id);
    const plan = (await listEvents(pool, id, EV.planConfirmed))[0]!.payload;
    expect(plan).toMatchObject({ broken_copy: true, quality_check_after_each_step_and_retry: "not done (milestones 1 and 3)", quality_gate_after_each_step: "not done (milestone 1)", acceptance_label: JOURNEY_STAND_IN_LABEL });
    const label = (step: string) => (JSON.parse(readFileSync(join(builderDir, "scripted", "example-1", step, "manifest.json"), "utf8")) as { label: string }).label;
    expect((plan.steps as Array<{ step: string; label: string; files: number }>).map((x) => [x.step, x.label, x.files])).toEqual([
      ["01-data", label("01-data"), 7],
      ["02-submitter-screen", label("02-submitter-screen"), 8],
      [BROKEN, brokenManifest().label, 3],
    ]);
    expect(j.planSteps(await j.state(id)).map((x) => x.step)).toEqual(["01-data", "02-submitter-screen", BROKEN]);
    const n = await normal(j);
    const normalPlan = (await listEvents(pool, n, EV.planConfirmed))[0]!.payload;
    expect(Object.keys(normalPlan).sort()).toEqual(["acceptance_label", "acceptance_version", "acceptance_written_by", "quality_gate_after_each_step", "stand_in_label", "steps"]);
    expect((normalPlan.steps as Array<{ step: string }>).map((x) => x.step)).toEqual(["01-data", "02-submitter-screen"]);
    expect(Object.keys((await listEvents(pool, n))[0]!.payload).sort()).toEqual(["characters", "given_to_engine", "text"]);
  });

  it("A2: the project row and its first event are written in one transaction: with a database that refuses the second insert, no project row is left", async () => {
    const refuse = (sql: unknown) => {
      if (typeof sql === "string" && /^\s*insert into events/i.test(sql)) throw new Error("made-up refusal of the second insert");
    };
    const wrapQuery = <T extends { query: (...a: unknown[]) => unknown }>(target: T) =>
      new Proxy(target, {
        get(t, prop) {
          if (prop === "query")
            return async (...args: unknown[]) => {
              refuse(args[0]);
              return (t.query as (...a: unknown[]) => unknown)(...args);
            };
          const v = Reflect.get(t, prop) as unknown;
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
        },
      });
    const refusing = new Proxy(pool, {
      get(t, prop) {
        if (prop === "connect") return async () => wrapQuery(await t.connect());
        if (prop === "query") return wrapQuery(t).query;
        const v = Reflect.get(t, prop) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
    const count = async () => Number((await pool.query<{ n: string }>("select count(*)::text as n from projects where name = $1", [NAME])).rows[0]!.n);
    const before = await count();
    const j = new Journey({ pool: refusing, dataDir });
    await expect(j.createBrokenCopyDemo()).rejects.toThrow("made-up refusal of the second insert");
    expect(await count()).toBe(before);
  });

  it("A3: the choice is honoured only on the project's first event: a later intake.brief_entered carrying broken_copy leaves the plan at two steps, and sign-off and export are still refused", async () => {
    const { j, jobs } = make();
    const id = await normal(j);
    await appendEvent(pool, id, EV.briefEntered, { text: "Made-up later brief.", characters: 20, given_to_engine: false, broken_copy: choice() });
    let s = await j.state(id);
    expect(s.plan).toEqual(["01-data", "02-submitter-screen"]);
    expect(s.brokenCopy).toBeNull();
    expect(s.brokenTrace).toBe(true);
    expect(j.planSteps(s).map((x) => x.step)).toEqual(["01-data", "02-submitter-screen"]);
    await expect(jobs.buildStep(id, BROKEN)).rejects.toThrow("That step is not one of the plan's.");
    const r = await throughStep2(j, jobs, id);
    expect(r.next).toBe("preview");
    await passedRun(j, jobs, id);
    s = await j.state(id);
    expect(signOffRefusal(s)).toBe(NEVER);
    await expect(j.signOff(id)).rejects.toThrow(NEVER);
    await appendEvent(pool, id, EV.signedOff, { note: "forged by the test" });
    s = await j.state(id);
    expect(JOB_RULES.export(s)).toBe(NEVER);
    await expect(jobs.exportProject(id)).rejects.toThrow(NEVER);
    expect(await listEvents(pool, id, EV.exportWritten)).toEqual([]);
    expect(stagedCalls(id)).toEqual([]);
    await j.closeProject(id);
  });

  it("A4: step 3 is staged once, just before its engine and never before steps 1 and 2 are approved, only into the sandbox's own change-set folder; its SHA-256 is read from the staged copy; builder/scripted is unchanged", async () => {
    const before = changeSetFolders();
    const { j, jobs } = make();
    const id = await broken(j);
    await expect(jobs.buildStep(id, BROKEN)).rejects.toThrow("Step 01-data must be built and approved first.");
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    const x = jobs.handle(id)!;
    expect(x.changeSets).toBe(join(x.dir, "engine-change-sets"));
    const stagedDir = join(x.changeSets, "example-1", BROKEN);
    expect(existsSync(stagedDir)).toBe(false);
    await jobs.approve(id, "01-data");
    await j.waitForJob();
    expect((await j.state(id)).stepJobs.get("02-submitter-screen")).toMatchObject({ state: "finished" });
    expect(existsSync(stagedDir)).toBe(false);
    await expect(jobs.buildStep(id, BROKEN)).rejects.toThrow("Step 02-submitter-screen must be built and approved first.");
    expect(stagedCalls(id)).toEqual([]);
    expect(await staged(id)).toEqual([]);
    const r = await jobs.approve(id, "02-submitter-screen");
    expect(r.next).toBe("build_step");
    await j.waitForJob();
    expect((await j.state(id)).stepJobs.get(BROKEN)).toMatchObject({ state: "finished" });
    expect(stagedCalls(id)).toEqual([{ projectId: id, into: x.changeSets }]);
    const events = await listEvents(pool, id);
    const ev = events.filter((e) => e.kind === "journey.broken_step_staged");
    expect(ev).toHaveLength(1);
    const at = (pred: (e: (typeof events)[number]) => boolean) => events.findIndex(pred);
    const order = [
      at((e) => e.kind === EV.stepApproved && e.payload.step === "02-submitter-screen"),
      at((e) => e.kind === EV.jobStarted && e.payload.step === BROKEN),
      at((e) => e.kind === "journey.broken_step_staged"),
      at((e) => e.kind === "step.hold_opened" && e.step === BROKEN),
      at((e) => e.kind === EV.engineEvent && e.step === BROKEN),
    ];
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const stagedManifest = readFileSync(join(stagedDir, "manifest.json"));
    expect(ev[0]!.step).toBe(BROKEN);
    expect(ev[0]!.payload).toMatchObject({ step: BROKEN, manifest_sha256: sha256(stagedManifest), into: x.changeSets });
    expect(ev[0]!.payload.manifest_sha256).toBe(choice().manifest_sha256);
    expect(ev[0]!.payload.files).toEqual(brokenManifest().files.map((f) => ({ path: f.path, sha256: f.sha256 })));
    // The staged copy is inside the sandbox's own folder; the engine ran step 3 from there, with exactly its files.
    expect(stagedDir.startsWith(`${x.dir}/`)).toBe(true);
    expect(sandboxes.runnerCalls.filter((c) => c.container.startsWith(`builder_${id}-`)).map((c) => c.step)).toEqual(["01-data", "02-submitter-screen", BROKEN]);
    const writes = events.filter((e) => e.kind === EV.engineEvent && e.step === BROKEN && e.payload.type === "tool_call").map((e) => (e.payload.input as { path: string }).path);
    expect(writes).toEqual(brokenManifest().files.map((f) => f.path));
    await j.closeProject(id);
    expect(changeSetFolders()).toEqual(before);
    expect(readdirSync(join(builderDir, "scripted", "example-1")).sort()).toEqual(["01-data", "02-submitter-screen"]);
  });

  it("A4: staging happens once per build job of step 3: a retry after a failed step 3 stages again and writes one more event", async () => {
    const { j, jobs } = make();
    const id = await broken(j);
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    await jobs.approve(id, "01-data");
    await j.waitForJob();
    sandboxes.extraFile = "made-up-extra.txt";
    await jobs.approve(id, "02-submitter-screen");
    await j.waitForJob();
    expect((await j.state(id)).stepJobs.get(BROKEN)).toMatchObject({ state: "failed", reason: "files changed that are not in the fixed change: made-up-extra.txt" });
    expect(await staged(id)).toHaveLength(1);
    await jobs.buildStep(id, BROKEN);
    await j.waitForJob();
    expect((await j.state(id)).stepJobs.get(BROKEN)).toMatchObject({ state: "finished" });
    expect((await listEvents(pool, id, EV.jobStarted)).filter((e) => e.payload.step === BROKEN)).toHaveLength(2);
    expect(await staged(id)).toHaveLength(2);
    expect(stagedCalls(id)).toHaveLength(2);
    await j.closeProject(id);
  });

  it("A4: a staged manifest whose SHA-256 is not the one chosen (read back from the sandbox's copy): step 3 is refused before its engine is made, and nothing is recorded as staged", async () => {
    const { j, jobs } = make();
    const id = await broken(j);
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    await jobs.approve(id, "01-data");
    await j.waitForJob();
    sandboxes.stageTamper = true;
    try {
      await jobs.approve(id, "02-submitter-screen");
      await j.waitForJob();
    } finally {
      sandboxes.stageTamper = false;
    }
    const s = await j.state(id);
    expect(s.stepJobs.get(BROKEN)?.state).toBe("failed");
    expect(s.stepJobs.get(BROKEN)!.reason).toMatch(/^The staged broken step's manifest has the SHA-256 [0-9a-f]{64}, not [0-9a-f]{64}, recorded when the project was made\. Step 3 was not built\.$/);
    expect(stagedCalls(id)).toHaveLength(1);
    expect(await staged(id)).toEqual([]);
    const kinds = (await listEvents(pool, id)).filter((e) => e.step === BROKEN).map((e) => e.kind);
    expect(kinds).toEqual([EV.jobStarted, EV.jobFailed]);
    expect(sandboxes.runnerCalls.filter((c) => c.container.startsWith(`builder_${id}-`)).map((c) => c.step)).toEqual(["01-data", "02-submitter-screen"]);
    await j.closeProject(id);
  });

  it("A4: a sandbox whose change-set folder is outside its own folder: staging is refused and nothing is copied; the target check also refuses a folder under builder/", async () => {
    const { j, jobs } = make();
    const id = await broken(j);
    const out = mkdtempSync(join(tmpdir(), "builder-outside-change-sets-"));
    outside.push(out);
    sandboxes.changeSetsOutside = out;
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    expect(jobs.handle(id)!.changeSets).toBe(out);
    await jobs.approve(id, "01-data");
    await j.waitForJob();
    await jobs.approve(id, "02-submitter-screen");
    await j.waitForJob();
    const s = await j.state(id);
    expect(s.stepJobs.get(BROKEN)?.state).toBe("failed");
    expect(s.stepJobs.get(BROKEN)!.reason).toMatch(/^The broken step was not staged: the sandbox's change-set folder is not its own folder's engine-change-sets/);
    expect(stagedCalls(id)).toEqual([]);
    expect(existsSync(join(out, "example-1", BROKEN))).toBe(false);
    expect(await staged(id)).toEqual([]);
    expect((await listEvents(pool, id)).filter((e) => e.step === BROKEN).map((e) => e.kind)).toEqual([EV.jobStarted, EV.jobFailed]);
    await j.closeProject(id);
    // The check itself, on made-up folders: its own engine-change-sets, outside builder/, only.
    const madeUp = join(tmpdir(), "builder-acceptance-made-up");
    expect(brokenStageTargetProblem({ dir: madeUp, changeSets: join(madeUp, "engine-change-sets") })).toBeNull();
    expect(brokenStageTargetProblem({ dir: madeUp, changeSets: join(builderDir, "scripted") })).toMatch(/not its own folder's engine-change-sets/);
    expect(brokenStageTargetProblem({ dir: join(builderDir, "made-up"), changeSets: join(builderDir, "made-up", "engine-change-sets") })).toMatch(/under builder\//);
    expect(brokenStageTargetProblem({ dir: madeUp, changeSets: join(madeUp, "engine-change-sets", "..", "elsewhere") })).toMatch(/not its own folder's engine-change-sets/);
  });

  it("A4b: the target check reads real paths: a change-set folder that is a link into builder/, a sandbox folder that is a link into builder/ before its change-set folder is made, and one under a folder that is such a link, are refused; real folders outside builder/ are accepted", () => {
    // Made-up folders in the test's temporary folder; the links point at builder/scripted and builder/test, which the
    // check only reads. rmSync removes a link, never what it points at.
    const base = mkdtempSync(join(tmpdir(), "builder-target-links-"));
    outside.push(base);
    // What the check says; "accepted" for null, so that a failure names it.
    const check = (dir: string) => brokenStageTargetProblem({ dir, changeSets: join(dir, "engine-change-sets") }) ?? "accepted";
    // 1. The sandbox's folder is real; its engine-change-sets is a link to builder/scripted (the real-path half).
    const real = join(base, "real-sandbox");
    mkdirSync(real);
    symlinkSync(join(builderDir, "scripted"), join(real, "engine-change-sets"));
    expect(check(real)).toMatch(/under builder\//);
    // 2. The sandbox's folder is itself a link into builder/; its engine-change-sets is not made yet.
    const linked = join(base, "linked-sandbox");
    symlinkSync(join(builderDir, "test"), linked);
    expect(existsSync(join(linked, "engine-change-sets"))).toBe(false);
    expect(check(linked)).toMatch(/under builder\//);
    // 3. The sandbox's folder does not exist yet, under a folder that is a link to builder/.
    const parent = join(base, "parent-link");
    symlinkSync(builderDir, parent);
    expect(existsSync(join(parent, "made-up-sandbox"))).toBe(false);
    expect(check(join(parent, "made-up-sandbox"))).toMatch(/under builder\//);
    // 4. Real folders outside builder/: accepted before and after the change-set folder is made, and when not made yet.
    const plain = join(base, "plain-sandbox");
    mkdirSync(plain);
    expect(check(plain)).toBe("accepted");
    mkdirSync(join(plain, "engine-change-sets"));
    expect(check(plain)).toBe("accepted");
    expect(check(join(base, "not-made-yet"))).toBe("accepted");
    // Nothing was written under builder/.
    expect(existsSync(join(builderDir, "test", "engine-change-sets"))).toBe(false);
    expect(existsSync(join(builderDir, "made-up-sandbox"))).toBe(false);
  });

  it("A4c (after J2's second review): the target check refuses a link at any folder the copy goes through (engine-change-sets, its example-1, the step's own folder), so the broken step is never copied through a link to somewhere else; plain folders pass; the real adapter's own check refuses too, before anything is copied; and whatever is already at the step's own folder is removed, not followed", async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "builder-link-target-"));
    outside.push(elsewhere);
    const sandbox = (make: (own: string) => void) => {
      const dir = mkdtempSync(join(tmpdir(), "builder-link-sandbox-"));
      outside.push(dir);
      make(join(dir, "engine-change-sets"));
      return { dir, changeSets: join(dir, "engine-change-sets") };
    };
    // Plain folders, as makeExample1 makes them, with and without the step's own folder: accepted.
    expect(brokenStageTargetProblem(sandbox((own) => mkdirSync(join(own, "example-1"), { recursive: true })))).toBeNull();
    expect(brokenStageTargetProblem(sandbox((own) => mkdirSync(join(own, "example-1", BROKEN), { recursive: true })))).toBeNull();
    // example-1 is a link to another folder: refused, and named.
    const linkedExample = sandbox((own) => {
      mkdirSync(own);
      symlinkSync(elsewhere, join(own, "example-1"));
    });
    expect(brokenStageTargetProblem(linkedExample)).toBe(`a folder the broken step would be copied through is a link, not a folder (${join(linkedExample.changeSets, "example-1")})`);
    // The step's own folder is a link: refused.
    const linkedStep = sandbox((own) => {
      mkdirSync(join(own, "example-1"), { recursive: true });
      symlinkSync(elsewhere, join(own, "example-1", BROKEN));
    });
    expect(brokenStageTargetProblem(linkedStep)).toMatch(/is a link, not a folder/);
    // engine-change-sets itself is a link to a folder outside builder/: refused (before, only a link into builder/ was).
    expect(brokenStageTargetProblem(sandbox((own) => symlinkSync(elsewhere, own)))).toMatch(/is a link, not a folder/);
    // The real adapter's own check, in front of the copy (no container is started by it): the same refusals.
    const adapter = example1Sandboxes();
    await expect(adapter.stageBrokenStep({ ...linkedExample, projectId: "j1-0123456789ab" } as unknown as ProjectSandbox)).rejects.toThrow(/^The broken step was not staged: a folder the broken step would be copied through is a link, not a folder/);
    await expect(adapter.stageBrokenStep({ dir: linkedStep.dir, changeSets: elsewhere, projectId: "j1-0123456789ab" } as unknown as ProjectSandbox)).rejects.toThrow(/^The broken step was not staged: the sandbox's change-set folder is not its own folder's engine-change-sets/);
    expect(readdirSync(elsewhere)).toEqual([]);
    // After the review of pull request #49. A file where a folder should be: a reason, not a throw.
    expect(brokenStageTargetProblem(sandbox((own) => writeFileSync(own, "not a folder")))).toMatch(/is not a folder/);
    const fileBelow = sandbox((own) => {
      mkdirSync(own);
      writeFileSync(join(own, "example-1"), "not a folder");
    });
    expect(brokenStageTargetProblem(fileBelow)).toMatch(/is not a folder|could not be read/);
    // A step folder already there, with links INSIDE it (its files folder a link to another folder; its manifest a link
    // to a file elsewhere): the real adapter removes it and copies into a new folder. Nothing is written through either
    // link, and what is staged is plain files and folders.
    const target = join(elsewhere, "target.json");
    writeFileSync(target, "untouched");
    const linksInside = sandbox((own) => {
      const step = join(own, "example-1", BROKEN);
      mkdirSync(step, { recursive: true });
      symlinkSync(elsewhere, join(step, "files"));
      symlinkSync(target, join(step, "manifest.json"));
    });
    expect(brokenStageTargetProblem(linksInside)).toBeNull();
    await adapter.stageBrokenStep({ ...linksInside, projectId: "j1-0123456789ab" } as unknown as ProjectSandbox);
    expect(readdirSync(elsewhere)).toEqual(["target.json"]);
    expect(readFileSync(target, "utf8")).toBe("untouched");
    const staged = join(linksInside.changeSets, "example-1", BROKEN);
    expect(lstatSync(join(staged, "manifest.json")).isFile()).toBe(true);
    expect(lstatSync(join(staged, "files")).isDirectory()).toBe(true);
    expect(readFileSync(join(staged, "manifest.json"), "utf8")).toBe(readFileSync(join(builderDir, "scripted-broken", "example-1", BROKEN, "manifest.json"), "utf8"));
  });

  it("A4: the job checks the state again before staging: given a state without the honoured choice, or without step 2's approval, it refuses and stages nothing", async () => {
    const { j, jobs, setDoctor } = make();
    const id = await broken(j);
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    await jobs.approve(id, "01-data");
    await j.waitForJob();
    // The approval alone (the journey's rules then allow step 3); the job is started below.
    await j.approveStep(id, "02-submitter-screen");
    const cases: Array<[string, (s: JourneyState) => JourneyState, string]> = [
      ["without the honoured choice", (s) => ({ ...s, brokenCopy: null }), "This project was not made as the deliberately broken copy, so its broken step is not staged."],
      ["without step 2's approval", (s) => ({ ...s, approved: new Set([...s.approved].filter((x) => x !== "02-submitter-screen")) }), "Step 02-submitter-screen must be built and approved before the broken step is staged."],
    ];
    for (const [what, doctor, why] of cases) {
      setDoctor(doctor);
      try {
        await jobs.buildStep(id, BROKEN);
        await j.waitForJob();
      } finally {
        setDoctor(null);
      }
      expect((await j.state(id)).stepJobs.get(BROKEN), what).toMatchObject({ state: "failed", reason: why });
    }
    expect(stagedCalls(id)).toEqual([]);
    expect(await staged(id)).toEqual([]);
    expect(existsSync(join(jobs.handle(id)!.changeSets, "example-1", BROKEN))).toBe(false);
    expect((await listEvents(pool, id)).filter((e) => e.step === BROKEN && e.kind === EV.engineEvent)).toEqual([]);
    await j.closeProject(id);
  });

  it("A5: step 3's reservation is sized for its 3 files: $1.1664 made and released, after $2.7216 and $3.1104; spent $0.00", async () => {
    const { j, jobs } = make();
    const id = await broken(j);
    await throughStep2(j, jobs, id);
    const holds = (await listEvents(pool, id)).filter((e) => e.kind === "step.hold_opened" || e.kind === "step.hold_closed");
    expect(holds.map((e) => [e.kind, e.step, e.kind === "step.hold_opened" ? e.payload.step_budget_usd : e.payload.released_usd, e.payload.turns ?? null, e.payload.spent_in_step_usd ?? null])).toEqual([
      ["step.hold_opened", "01-data", 2.7216, 7, null],
      ["step.hold_closed", "01-data", 2.7216, null, 0],
      ["step.hold_opened", "02-submitter-screen", 3.1104, 8, null],
      ["step.hold_closed", "02-submitter-screen", 3.1104, null, 0],
      ["step.hold_opened", BROKEN, 1.1664, 3, null],
      ["step.hold_closed", BROKEN, 1.1664, null, 0],
    ]);
    expect((await listStepHolds(pool, id)).map((h) => [h.step_id, h.state, h.closed_reason])).toEqual([
      ["01-data", "closed", "step_ended"],
      ["02-submitter-screen", "closed", "step_ended"],
      [BROKEN, "closed", "step_ended"],
    ]);
    expect((await getBudget(pool, id)).spent).toBe(0);
    await j.closeProject(id);
  });

  it("A6: a broken copy whose run reads 'passed' (a forged pass) is not signed off; with a forged journey.signed_off its export is refused; a normal project whose record holds only a journey.broken_step_staged, or only an engine event of step 03, is refused the same", async () => {
    const { j, jobs } = make();
    const id = await previewed(j, jobs, await broken(j));
    await passedRun(j, jobs, id);
    expect(signOffRefusal(await j.state(id))).toBe(NEVER);
    await expect(j.signOff(id)).rejects.toThrow(NEVER);
    expect(await listEvents(pool, id, EV.signedOff)).toEqual([]);
    await appendEvent(pool, id, EV.signedOff, { note: "forged by the test" });
    expect(JOB_RULES.export(await j.state(id))).toBe(NEVER);
    await expect(jobs.exportProject(id)).rejects.toThrow(NEVER);
    expect(await listEvents(pool, id, EV.exportWritten)).toEqual([]);
    await j.closeProject(id);
    const traces: Array<[string, (id: string) => Promise<unknown>]> = [
      ["only a journey.broken_step_staged", (p) => appendEvent(pool, p, "journey.broken_step_staged", { note: "forged by the test" }, BROKEN)],
      ["only an engine event of step 03", (p) => appendEvent(pool, p, EV.engineEvent, { type: "text", text: "Scripted engine: made-up line of the test.", at: new Date().toISOString() }, BROKEN)],
    ];
    for (const [what, trace] of traces) {
      const n = await previewed(j, jobs, await normal(j));
      await passedRun(j, jobs, n);
      expect(signOffRefusal(await j.state(n)), what).toBeNull();
      await trace(n);
      const s = await j.state(n);
      expect(s.plan, what).toEqual(["01-data", "02-submitter-screen"]);
      expect(s.brokenCopy, what).toBeNull();
      expect(s.brokenTrace, what).toBe(true);
      expect(signOffRefusal(s), what).toBe(NEVER);
      await expect(j.signOff(n), what).rejects.toThrow(NEVER);
      await appendEvent(pool, n, EV.signedOff, { note: "forged by the test" });
      expect(JOB_RULES.export(await j.state(n)), what).toBe(NEVER);
      await expect(jobs.exportProject(n), what).rejects.toThrow(NEVER);
      expect(await listEvents(pool, n, EV.exportWritten), what).toEqual([]);
      await j.closeProject(n);
    }
  });

  it("A6b: a normal project whose record holds only a journey.plan_confirmed listing step 03 (forged, as confirmPlan writes its steps, or as plain step names) is refused sign-off and export the same", async () => {
    const { j, jobs } = make();
    const forms: Array<[string, (steps: unknown[]) => unknown[]]> = [
      ["the steps as confirmPlan writes them, step 03 added", (steps) => [...steps, { step: BROKEN, label: brokenManifest().label, files: brokenManifest().files.length }]],
      ["the steps as plain names, step 03 among them", () => ["01-data", "02-submitter-screen", BROKEN]],
    ];
    for (const [what, steps] of forms) {
      const n = await previewed(j, jobs, await normal(j));
      await passedRun(j, jobs, n);
      expect(signOffRefusal(await j.state(n)), what).toBeNull();
      const confirmed = await listEvents(pool, n, EV.planConfirmed);
      expect(confirmed, what).toHaveLength(1);
      const p = confirmed[0]!.payload;
      expect(Array.isArray(p.steps) && p.steps.length === 2, what).toBe(true);
      await appendEvent(pool, n, EV.planConfirmed, { ...p, steps: steps(p.steps as unknown[]), note: "forged by the test" });
      const s = await j.state(n);
      expect(s.plan, what).toEqual(["01-data", "02-submitter-screen"]);
      expect(s.brokenCopy, what).toBeNull();
      expect(s.acceptanceVersion, what).toBe(p.acceptance_version);
      expect(s.brokenTrace, what).toBe(true);
      expect(signOffRefusal(s), what).toBe(NEVER);
      await expect(j.signOff(n), what).rejects.toThrow(NEVER);
      await appendEvent(pool, n, EV.signedOff, { note: "forged by the test" });
      expect(JOB_RULES.export(await j.state(n)), what).toBe(NEVER);
      await expect(jobs.exportProject(n), what).rejects.toThrow(NEVER);
      expect(await listEvents(pool, n, EV.exportWritten), what).toEqual([]);
      expect(stagedCalls(n), what).toEqual([]);
      await j.closeProject(n);
    }
  });

  it("A7: the live app is refused for a broken copy with a plain sentence, before the scripted-only check (which its record, read through changeSetsFor, passes)", async () => {
    const { j, jobs } = make();
    const id = await previewed(j, jobs, await broken(j));
    const s = await j.state(id);
    expect(s.appRunning).toBe(true);
    expect(scriptedOnlyProblem(s)).toBeNull();
    expect(JOB_RULES.live(s)).toBe(LIVE_REFUSED);
    await expect(j.startJob(id, "live", noop)).rejects.toThrow(LIVE_REFUSED);
    expect((await j.state(id)).jobs.filter((x) => x.kind === "live")).toEqual([]);
    await j.closeProject(id);
  });

  it("A8b: the app camera prints one banner line per page, after its photograph: the text of the app's role=\"note\" element, cut at 200 characters (read from the script; the automated run shows it working)", () => {
    const source = readFileSync(join(builderDir, "camera", "app-shots.mjs"), "utf8");
    const loop = /for \(const s of SHOTS\) \{([\s\S]*?)\n  \}/.exec(source)?.[1] ?? "";
    expect(loop).toContain("page.screenshot(");
    expect(loop).toContain(`page.locator('[role="note"]')`);
    expect(loop).toMatch(/console\.log\(JSON\.stringify\(\{ kind: "banner", name: s\.name, text \}\)\)/);
    expect(loop).toContain(".slice(0, 200)");
    expect(loop.indexOf('kind: "banner"')).toBeGreaterThan(loop.indexOf("page.screenshot("));
    expect(source.match(/kind: "banner"/g)).toHaveLength(1);
    // The broken copy's banners fit whole in 200 characters, and each camera line in the record's 300.
    for (const lang of ["en", "ar"]) {
      const banner = (JSON.parse(readFileSync(join(builderDir, "scripted-broken", "example-1", BROKEN, "files", "messages", `${lang}.json`), "utf8")) as { app: { sample_banner: string } }).app.sample_banner;
      expect(banner.length, lang).toBeLessThanOrEqual(200);
      expect(JSON.stringify({ kind: "banner", name: `app-my-requests-${lang}`, text: banner }).length, lang).toBeLessThanOrEqual(300);
    }
  });

  it("A9: an interrupted project whose last checklist run passed is not signed off", async () => {
    const { j, jobs } = make();
    const id = await previewed(j, jobs, await normal(j));
    await passedRun(j, jobs, id);
    expect(signOffRefusal(await j.state(id))).toBeNull();
    // As the next start's recovery records a sandbox left by an interface that stopped (journey.ts, recoverInterrupted).
    await appendEvent(pool, id, EV.sandboxRemoved, { reason: "Found at start: made by an interface that has since stopped. It is not resumed.", interrupted: true, removed: true });
    const s = await j.state(id);
    expect(s.interrupted).toBe(true);
    expect(s.acceptanceRun?.outcome).toBe("passed");
    expect(signOffRefusal(s)).toBe("This project was interrupted when the interface stopped, so it is not signed off. Close the project, or start a new one.");
    await expect(j.signOff(id)).rejects.toThrow(/interrupted when the interface stopped/);
    expect(await listEvents(pool, id, EV.signedOff)).toEqual([]);
    await j.closeProject(id);
  });
});

describe("J2 (c): the clean stop and restart, the journey's part (stand-in sandboxes; no container, no model)", () => {
  /** A database of its own for one test (named after the test database, so builder_test_j2_… in J2's runs), migrated; dropped by `drop`. */
  async function freshDb() {
    const base = new URL(TEST_DB_URL);
    const name = `${decodeURIComponent(base.pathname.slice(1))}_rs_${randomBytes(3).toString("hex")}`;
    expect(name).toMatch(/^[a-z0-9_]{1,63}$/);
    await pool.query(`create database "${name}"`);
    base.pathname = `/${name}`;
    const db = createPool(base.toString());
    await migrate(db);
    const sandboxes = new StandInSandboxes(db);
    return {
      db,
      sandboxes,
      drop: async () => {
        sandboxes.removeAll();
        await db.end();
        await pool.query(`drop database if exists "${name}" with (force)`);
      },
    };
  }
  const ready = async (j: Journey, name: string) => {
    const id = await j.createProject({ name, cap: "5", brief: "I need an app where staff can request leave and managers approve it" });
    await j.continueWithExample(id);
    await j.answerRestFromSheet(id);
    await j.confirmBrief(id);
    await j.confirmPlan(id);
    return id;
  };

  it("C6: the demonstration pause: with stepPauseMs set, each build step first records journey.step.paused_for_demonstration and the engine's applier is given --delay-ms; unset or 0, neither", async () => {
    const sandboxes = new StandInSandboxes(pool);
    try {
      for (const pause of [4000, 0, undefined]) {
        const box: { jobs?: JourneyJobs } = {};
        const j = new Journey({ pool, dataDir, cleanupProject: (id, rec) => box.jobs!.cleanup(id, rec) });
        box.jobs = new JourneyJobs({ journey: j, sandboxes, measureFree: () => 50 * 1024 ** 3, ...(pause === undefined ? {} : { stepPauseMs: pause }) });
        expect(box.jobs.stepPauseMs()).toBe(pause ?? 0);
        const id = await ready(j, `Pause ${String(pause)} (made-up)`);
        await box.jobs.buildStep(id, "01-data");
        await j.waitForJob();
        await box.jobs.approve(id, "01-data");
        await j.waitForJob();
        const calls = sandboxes.runnerCalls.filter((c) => c.container.startsWith(`builder_${id}-engine-`));
        expect(calls.map((c) => c.step), String(pause)).toEqual(["01-data", "02-submitter-screen"]);
        for (const c of calls) {
          const at = c.cmd.indexOf("--delay-ms");
          if (pause) expect(c.cmd.slice(at, at + 2), String(pause)).toEqual(["--delay-ms", "4000"]);
          else expect(at, String(pause)).toBe(-1);
        }
        for (const step of ["01-data", "02-submitter-screen"]) {
          const kinds = (await listEvents(pool, id)).filter((e) => e.step === step).map((e) => e.kind);
          const paused = (await listEvents(pool, id, "journey.step.paused_for_demonstration")).filter((e) => e.step === step);
          if (pause) {
            // First in the job, right after its start.
            expect(kinds.slice(0, 2), step).toEqual([EV.jobStarted, "journey.step.paused_for_demonstration"]);
            expect(paused.map((e) => e.payload), step).toEqual([{ pause_ms: 4000, setting: "BUILDER_DEMO_STEP_PAUSE_MS", label: "Demonstration setting: the scripted engine pauses before each write, so that a stop part-way can be shown. Every step is slower." }]);
          } else expect(paused, step).toEqual([]);
        }
        await j.closeProject(id);
      }
    } finally {
      sandboxes.removeAll();
    }
  });

  it("C10: a Close project in progress when the stop comes: the stop waits on that project's chain of actions, then skips it, closed; the record holds one journey.sandbox.removed; an action not ended within the wait leaves its project for the next start", async () => {
    const f = await freshDb();
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    try {
      let holdClose = false;
      let inside!: () => void;
      const closing = new Promise<void>((r) => (inside = r));
      const box: { jobs?: JourneyJobs } = {};
      const j = new Journey({
        pool: f.db,
        dataDir,
        cleanupProject: async (id, rec) => {
          if (holdClose) {
            inside();
            await hold;
          }
          await box.jobs!.cleanup(id, rec);
        },
      });
      box.jobs = new JourneyJobs({ journey: j, sandboxes: f.sandboxes, measureFree: () => 50 * 1024 ** 3 });
      const id = await ready(j, "Closed while the interface stops (made-up)");
      await box.jobs.buildStep(id, "01-data");
      await j.waitForJob();
      holdClose = true;
      const closed = j.closeProject(id);
      await closing;
      // The stop comes now, while the close is removing the sandbox: the journey is halted, then the removal runs.
      await j.halt("Made-up stop for the test.");
      setTimeout(release, 300);
      const t0 = Date.now();
      const r = await j.removeAtStop({ waitUntil: Date.now() + 10_000, mayRemove: async () => null });
      expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
      await closed;
      expect(r).toEqual({ removed: [], left: [], ended: null });
      expect((await listEvents(f.db, id, EV.sandboxRemoved)).map((e) => e.payload)).toEqual([{ reason: "The project was closed.", interrupted: false }]);
      expect((await j.state(id)).stage).toBe("closed");
      expect(f.sandboxes.destroyed).toEqual([id]);

      // An action that has not ended when the wait ends: its project is left, named, and not read or removed.
      let release2!: () => void;
      const hold2 = new Promise<void>((r2) => (release2 = r2));
      let inside2!: () => void;
      const closing2 = new Promise<void>((r2) => (inside2 = r2));
      const box2: { jobs?: JourneyJobs; hold: boolean } = { hold: false };
      const j2 = new Journey({
        pool: f.db,
        dataDir,
        cleanupProject: async (pid, rec) => {
          if (box2.hold) {
            inside2();
            await hold2;
          }
          await box2.jobs!.cleanup(pid, rec);
        },
      });
      box2.jobs = new JourneyJobs({ journey: j2, sandboxes: f.sandboxes, measureFree: () => 50 * 1024 ** 3 });
      const id2 = await ready(j2, "Its close outlasts the wait (made-up)");
      await box2.jobs.buildStep(id2, "01-data");
      await j2.waitForJob();
      box2.hold = true;
      const closed2 = j2.closeProject(id2);
      await closing2;
      await j2.halt("Made-up stop for the test.");
      const r2 = await j2.removeAtStop({ waitUntil: Date.now() + 300, mayRemove: async () => null });
      expect(r2).toEqual({ removed: [], left: [{ projectId: id2, why: "an action of this project was still in progress when the wait ended" }], ended: null });
      release2();
      await closed2;
      expect((await listEvents(f.db, id2, EV.sandboxRemoved)).map((e) => e.payload)).toEqual([{ reason: "The project was closed.", interrupted: false }]);
    } finally {
      release();
      await f.drop();
    }
  });

  it("C8 (regression guard): the automated run's pure checks on made-up lists: N reports a container, a volume, a network, an image, a process or the folder of the project, each alone, and nothing of another project; the record checks for a clean stop, a crash and a step running", () => {
    const P = "j1-0123456789ab";
    const Q = "j1-ba9876543210";
    const none = { containers: [], volumes: [], networks: [], images: [] };
    const gone = { path: "/made-up/builder-acceptance-p", exists: false };
    expect(projectLeftovers(P, none, [], gone)).toEqual([]);
    // Each kind alone is reported.
    expect(projectLeftovers(P, { ...none, containers: [{ name: `builder_${P}-engine-02-submitter-screen-1a2b3c`, composeProject: "" }] }, [], gone)).toEqual([`container builder_${P}-engine-02-submitter-screen-1a2b3c`]);
    expect(projectLeftovers(P, { ...none, containers: [{ name: "made-up-name", composeProject: `builder_${P}` }] }, [], gone)).toEqual(["container made-up-name"]);
    expect(projectLeftovers(P, { ...none, volumes: [{ name: `builder_${P}_pgdata`, composeProject: "" }] }, [], gone)).toEqual([`volume builder_${P}_pgdata`]);
    expect(projectLeftovers(P, { ...none, volumes: [{ name: "made-up-volume", composeProject: `builder_${P}` }] }, [], gone)).toEqual(["volume made-up-volume"]);
    expect(projectLeftovers(P, { ...none, networks: [{ name: `builder_${P}_front`, composeProject: "" }] }, [], gone)).toEqual([`network builder_${P}_front`]);
    expect(projectLeftovers(P, { ...none, images: [{ repository: `builder_${P}-app`, tag: "latest" }] }, [], gone)).toEqual([`image builder_${P}-app:latest`]);
    expect(projectLeftovers(P, { ...none, images: [{ repository: `builder_${P}-tools`, tag: "latest" }] }, [], gone)).toEqual([`image builder_${P}-tools:latest`]);
    expect(projectLeftovers(P, { ...none, images: [{ repository: `builder_${P}-other`, tag: "made-up" }] }, [], gone)).toEqual([`image builder_${P}-other:made-up`]);
    expect(projectLeftovers(P, none, [{ pid: 4242, args: `docker compose -p builder_${P} up --detach app` }], gone)).toEqual([`process 4242 docker compose -p builder_${P} up --detach app`]);
    expect(projectLeftovers(P, none, [], { ...gone, exists: true })).toEqual(["folder /made-up/builder-acceptance-p"]);
    // After J2's second review: a Compose command of the builder's own names the sandbox's folder, not the project's Compose name.
    expect(projectLeftovers(P, none, [{ pid: 4243, args: "docker compose -f /made-up/builder-acceptance-p/compose.yaml down --volumes" }], gone)).toEqual(["process 4243 docker compose -f /made-up/builder-acceptance-p/compose.yaml down --volumes"]);
    expect(projectLeftovers(P, none, [{ pid: 4244, args: "docker compose -f /made-up/builder-acceptance-q/compose.yaml down --volumes" }], gone)).toEqual([]);
    expect(projectLeftovers(P, none, [{ pid: 4245, args: "docker compose -f /made-up/builder-acceptance-p/compose.yaml down" }], { path: null, exists: false })).toEqual([]);
    // Nothing of another project, nor a name that only starts the same way without the separator.
    const others = {
      containers: [{ name: `builder_${Q}-app-1`, composeProject: `builder_${Q}` }, { name: `builder_${P}x-app-1`, composeProject: `builder_${P}x` }],
      volumes: [{ name: `builder_${Q}_pgdata`, composeProject: `builder_${Q}` }],
      networks: [{ name: `builder_${Q}_front`, composeProject: `builder_${Q}` }, { name: "bridge", composeProject: "" }],
      images: [{ repository: `builder_${Q}-app`, tag: "latest" }, { repository: "node", tag: "22" }],
    };
    expect(projectLeftovers(P, others, [{ pid: 7, args: `docker compose -p builder_${Q} up` }], gone)).toEqual([]);
    // The parsers of Docker's and ps's lines.
    expect(parseNameLabel(`builder_${P}-app-1\tbuilder_${P}\nlone\t\n`)).toEqual([{ name: `builder_${P}-app-1`, composeProject: `builder_${P}` }, { name: "lone", composeProject: "" }]);
    expect(parseImages(`builder_${P}-app:latest\nnode:22\n<none>:<none>\n`)).toEqual([{ repository: `builder_${P}-app`, tag: "latest" }, { repository: "node", tag: "22" }, { repository: "<none>", tag: "<none>" }]);
    expect(parseProcesses("  PID COMMAND\n  12 node --import tsx src/web/main.ts\n 345 docker build --tag x .\n")).toEqual([{ pid: 12, args: "node --import tsx src/web/main.ts" }, { pid: 345, args: "docker build --tag x ." }]);

    // The record checks. A made-up record of a clean stop with step 2 running (path T).
    let n = 0;
    const ev = (kind: string, payload: Record<string, unknown>, step: string | null = null) => ({ id: String(++n), kind, step, payload });
    const writes = (k: number) => Array.from({ length: k }, (_, i) => ev(EV.engineEvent, { type: "tool_call", tool: "scripted.write", input: { path: `made-up-${i}.ts` } }, "02-submitter-screen"));
    const started = ev(EV.jobStarted, { job_id: "job-0000aaaa", kind: "build_step", step: "02-submitter-screen" }, "02-submitter-screen");
    const t = [
      started,
      ...writes(3),
      ev("step.hold_closed", { reason: "step_ended" }, "02-submitter-screen"),
      ev(EV.jobInterrupted, { job_id: "job-0000aaaa", reason: "The interface stopped while this job ran: The interface was stopped on purpose (SIGTERM). The job was stopped part-way and is not resumed." }, "02-submitter-screen"),
      ev(EV.sandboxRemoved, { reason: "The interface was stopped on purpose; this project's containers, images and folder were removed at the stop. It is not resumed.", interrupted: true, removed: true }),
    ];
    const allOk = (rows: Array<{ ok: boolean }>) => rows.length > 0 && rows.every((r) => r.ok);
    expect(allOk(cleanStopRecordChecks(t, "job-0000aaaa", "02-submitter-screen"))).toBe(true);
    const failing = (rows: Array<{ name: string; ok: boolean }>) => rows.filter((r) => !r.ok).map((r) => r.name);
    expect(failing(cleanStopRecordChecks(t.filter((e) => e.kind !== "step.hold_closed"), "job-0000aaaa", "02-submitter-screen"))).toHaveLength(1);
    expect(failing(cleanStopRecordChecks([...t, ev(EV.workspaceReset, {}, "02-submitter-screen")], "job-0000aaaa", "02-submitter-screen"))).toHaveLength(1);
    expect(failing(cleanStopRecordChecks([...t, ev(EV.jobFailed, { job_id: "job-0000aaaa", reason: "made-up" }, "02-submitter-screen")], "job-0000aaaa", "02-submitter-screen"))).toHaveLength(1);
    expect(failing(cleanStopRecordChecks(t.map((e) => (e.kind === EV.sandboxRemoved ? { ...e, payload: { ...e.payload, reason: "Found at start: made by an interface that has since stopped. It is not resumed." } } : e)), "job-0000aaaa", "02-submitter-screen"))).toHaveLength(1);
    // A step running: at least one and fewer than all of its writes, and its engine container in Docker's list.
    expect(allOk(midStepChecks([started, ...writes(1)], "02-submitter-screen", 8, [`builder_${P}-engine-02-submitter-screen-1a2b3c`], P))).toBe(true);
    expect(failing(midStepChecks([started], "02-submitter-screen", 8, [`builder_${P}-engine-02-submitter-screen-1a2b3c`], P))).toHaveLength(1);
    expect(failing(midStepChecks([started, ...writes(8)], "02-submitter-screen", 8, [`builder_${P}-engine-02-submitter-screen-1a2b3c`], P))).toHaveLength(1);
    expect(failing(midStepChecks([started, ...writes(2)], "02-submitter-screen", 8, [`builder_${Q}-engine-02-submitter-screen-1a2b3c`], P))).toHaveLength(1);
    // A crash, then the next start (path K).
    const k = [
      started,
      ...writes(2),
      ev(EV.jobInterrupted, { job_id: "job-0000aaaa", reason: "The interface stopped while this job ran. It is not resumed." }, "02-submitter-screen"),
      ev(EV.sandboxRemoved, { reason: "Found at start: made by an interface that has since stopped. It is not resumed.", interrupted: true, removed: true }),
      ev("step.hold_closed", { reason: "job_interrupted" }, "02-submitter-screen"),
    ];
    expect(allOk(crashRestartRecordChecks(k, "job-0000aaaa", "02-submitter-screen"))).toBe(true);
    expect(failing(crashRestartRecordChecks(k.map((e) => (e.kind === "step.hold_closed" ? { ...e, payload: { reason: "step_ended" } } : e)), "job-0000aaaa", "02-submitter-screen"))).toHaveLength(1);
    expect(failing(crashRestartRecordChecks(k.filter((e) => e.kind !== EV.sandboxRemoved), "job-0000aaaa", "02-submitter-screen"))).toHaveLength(1);
  });

  it("the automated run's record checks of the broken copy (scripts/journey-restart-checks.ts, brokenCopyRecordChecks), on a made-up record: all pass on it, and each fault given alone is reported by its own check", () => {
    const steps = ["01-data", "02-submitter-screen", "03-wrong-status"];
    const reservations = [2.7216, 3.1104, 1.1664];
    const x = { step: "03-wrong-status", source: "builder/scripted-broken/example-1/03-wrong-status", label: "made-up label", manifestSha256: "a".repeat(64), steps, reservations, bannerEn: "Made-up English sentence.", bannerAr: "جملة عربية مختلقة." };
    const failureText = Buffer.from("made-up runner error: expected Waiting, received Approved");
    const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    const readFile = (p: string) => (p === "/made-up/item-01-failure.txt" ? failureText : null);
    const choice = { by: "owner", step: x.step, source: x.source, label: x.label, manifest_sha256: x.manifestSha256, sign_off: "never", export: "never" };
    const record = (o: { twoStaged?: boolean; signedOff?: boolean } = {}) => {
      let n = 0;
      const ev = (kind: string, payload: Record<string, unknown>, step: string | null = null) => ({ id: String(++n), kind, step, payload });
      const out = [
        ev(EV.briefEntered, { text: "made-up", broken_copy: choice }),
        ev(EV.planConfirmed, { steps: steps.map((st, i) => ({ step: st, label: i === 2 ? x.label : "made-up" })), acceptance_version: "v001", broken_copy: true, quality_check_after_each_step_and_retry: "not done (milestones 1 and 3)" }),
      ];
      steps.forEach((st, i) => {
        out.push(ev(EV.jobStarted, { job_id: `job-${i}`, kind: "build_step", step: st }, st));
        if (st === x.step) for (let k = 0; k < (o.twoStaged ? 2 : 1); k++) out.push(ev(EV.brokenStepStaged, { manifest_sha256: x.manifestSha256, manifest_read_from: "the sandbox's own copy, as the engine reads it" }, st));
        out.push(ev("step.hold_opened", { step_budget_usd: reservations[i] }, st));
        out.push(ev(EV.engineEvent, { type: "tool_call", tool: "scripted.write" }, st));
        out.push(ev("step.hold_closed", { reason: "step_ended", released_usd: reservations[i], spent_in_step_usd: 0 }, st));
        out.push(ev(EV.jobFinished, { job_id: `job-${i}`, kind: "build_step", step: st }, st));
        out.push(ev(EV.stepApproved, { step: st }, st));
      });
      for (const [name, text] of [["app-home-en", x.bannerEn], ["app-my-requests-en", x.bannerEn], ["app-home-ar", x.bannerAr], ["app-my-requests-ar", x.bannerAr]] as const) {
        out.push(ev(EV.screenshot, { name, lang: name.slice(-2) }));
        out.push(ev(EV.previewLine, { line: `app camera: ${JSON.stringify({ kind: "banner", name, text: `Made-up start. ${text}` })}` }));
      }
      out.push(ev("acceptance.item", { item: 1, status: "failed", step: "sees status waiting", screenshot: { path: "/made-up/shot.png" }, failure_file: { path: "/made-up/item-01-failure.txt", sha256: digest(failureText) } }));
      out.push(ev("acceptance.run.finished", { outcome: "failed", exit_code: 1, version: "v001", summary: 'version failed: item 1 failed at step "sees status waiting"' }));
      if (o.signedOff) out.push(ev(EV.signedOff, { label: "made-up" }));
      out.push(ev(EV.sandboxRemoved, { reason: "The project was closed.", interrupted: false }));
      out.push(ev(EV.closed, { at_stage: "acceptance" }));
      return out;
    };
    const failing = (r: ReturnType<typeof record>, read = readFile) => brokenCopyRecordChecks(r, x, read, digest).filter((c) => !c.ok).map((c) => c.name);
    expect(brokenCopyRecordChecks(record(), x, readFile, digest).length).toBe(11);
    expect(failing(record())).toEqual([]);
    const change = (kind: string, f: (p: Record<string, unknown>) => Record<string, unknown>) => record().map((e) => (e.kind === kind ? { ...e, payload: f(e.payload) } : e));
    const one = (r: ReturnType<typeof record>, words: string, read = readFile) => {
      const names = failing(r, read);
      expect(names, words).toHaveLength(1);
      expect(names[0], words).toContain(words);
    };
    one(change(EV.briefEntered, (p) => ({ ...p, broken_copy: { ...choice, export: "allowed" } })), "first event");
    one(change(EV.planConfirmed, (p) => ({ ...p, steps: (p.steps as unknown[]).slice(0, 2) })), "plan_confirmed");
    one(record().filter((e) => !(e.kind === EV.stepApproved && e.step === "03-wrong-status")), "built once and approved");
    one(change("step.hold_closed", (p) => ({ ...p, spent_in_step_usd: 0.01 })), "reservation");
    one(record({ twoStaged: true }), "broken_step_staged");
    one(change(EV.brokenStepStaged, (p) => ({ ...p, manifest_sha256: "b".repeat(64) })), "broken_step_staged");
    one(change(EV.previewLine, (p) => ({ ...p, line: String(p.line).replace(x.bannerAr, "made-up other text") })), "banner");
    one(change("acceptance.run.finished", (p) => ({ ...p, outcome: "not passed" })), "outcome");
    one(change("acceptance.run.finished", (p) => ({ ...p, version: "v002" })), "outcome");
    one(change("acceptance.item", (p) => ({ ...p, step: "made-up other step" })), "item 1 failed");
    one(record(), "failure file", () => null);
    one(record(), "failure file", () => Buffer.from("made-up text without the word"));
    one(record({ signedOff: true }), "signed_off");
    one(record().filter((e) => e.kind !== EV.closed), "journey.closed");
  });
});
