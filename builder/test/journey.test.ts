/**
 * Package J1: the journey (src/orchestrator/journey.ts), the parts that need no container: the confirmations
 * before any build, the order of events, recovery of journey projects only, and the closed real-model gate
 * (what the interface imports, what is left in its environment, and the only engine it makes). Part 2: the build,
 * preview, checklist and export jobs, with a stand-in for example 1's sandboxes (test/journey-stand-ins.ts): a real
 * workspace and history, no container.
 */
import { execFileSync, spawnSync } from "node:child_process";
import net from "node:net";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import { journeyFolder } from "../src/web/files.js";
import { PASSED_SUMMARY, PNG_1X1, slowPoolFor, StandInSandboxes } from "./journey-stand-ins.js";
import type { BuildEngine } from "../src/engine/interface.js";
import { ScriptedEngine } from "../src/engine/scripted.js";
import { DEFAULT_PROFILES } from "../src/gateway/hold.js";
import { diskRefusal, EV, EventQueue, EXPORT_LABEL, jobRunFinished, Journey, JourneyRefused, JOURNEY_STAND_IN_LABEL, orderedEngine, runOutcome, scriptedEngineFor, engineEventHandler, SIGN_OFF_LABEL, type JobRecord } from "../src/orchestrator/journey.js";
import { runBudgetedStep } from "../src/orchestrator/steps.js";
import { sandbox as sandboxManager, type Sandbox, type StreamingOptions } from "../src/sandbox/manager.js";
import { networkChecks } from "../scripts/journey-network-checks.js";
import { appendEvent, listEvents } from "../src/store/events.js";
import { getBudget, listStepHolds, openStepHold } from "../src/store/holds.js";
import { createProject } from "../src/store/projects.js";
import { testPool, uniqueId } from "./helpers.js";

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
      ["01-data", 4],
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

  it("step 1 runs through the step hold: its sandbox made, $1.5552 reserved and released, the engine's events in order and step.hold_closed after the last of them; step 2 only after step 1 is approved", async () => {
    // Every engine event's write is held 150 ms: written without waiting, they would land after step.hold_closed.
    const { j, jobs } = make({ pool: slowPoolFor(pool, EV.engineEvent, 150) });
    const id = await ready(j);
    await expect(jobs.buildStep(id, "02-submitter-screen")).rejects.toThrow("Step 01-data must be built and approved first.");
    await expect(jobs.approve(id, "01-data")).rejects.toThrow("This step is not built yet. A step is approved only once it has run to the end.");
    await jobs.buildStep(id, "01-data");
    await j.waitForJob();
    const kinds = (await stepEvents(id, "01-data")).map((e) => e.kind);
    expect(kinds).toEqual([EV.jobStarted, EV.sandboxMade, "step.hold_opened", ...Array(7).fill(EV.engineEvent), "step.hold_closed", EV.jobFinished]);
    const ev = await stepEvents(id, "01-data");
    expect(ev.filter((e) => e.kind === EV.engineEvent).map((e) => e.payload.type)).toEqual(["text", "text", "tool_call", "tool_call", "tool_call", "tool_call", "finished"]);
    expect(ev.find((e) => e.kind === "step.hold_opened")!.payload).toMatchObject({ step_budget_usd: 1.5552, turns: 4, model: "claude-opus-5-5" });
    expect(ev.find((e) => e.kind === "step.hold_closed")!.payload).toMatchObject({ released_usd: 1.5552, spent_in_step_usd: 0, calls_drawn: 0 });
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
    expect(s.stepJobs.get("01-data")!.reason).toMatch(/^This step needs up to \$1\.56 to finish \(4 turns\); this project has \$1\.00 left of its budget of \$1\.00 .*The step was not started\. A cap of at least \$1\.56 would let it start now\.$/);
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
    expect(started.payload).toEqual({ app_url: "http://app:3161", reached_from: "containers on the project's front network only; no port of the app or its database on the machine", live_view: false });
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
