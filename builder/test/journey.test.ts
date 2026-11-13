/**
 * Package J1: the journey (src/orchestrator/journey.ts), the parts that need no container: the confirmations
 * before any build, the order of events, recovery of journey projects only, and the closed real-model gate
 * (what the interface imports, what is left in its environment, and the only engine it makes). The build,
 * preview, acceptance and export jobs are J1's part 2.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openStore } from "../src/acceptance/store.js";
import type { BuildEngine } from "../src/engine/interface.js";
import { ScriptedEngine } from "../src/engine/scripted.js";
import { DEFAULT_PROFILES } from "../src/gateway/hold.js";
import { diskRefusal, EV, EventQueue, Journey, JourneyRefused, JOURNEY_STAND_IN_LABEL, orderedEngine, scriptedEngineFor, engineEventHandler } from "../src/orchestrator/journey.js";
import { runBudgetedStep } from "../src/orchestrator/steps.js";
import type { Sandbox } from "../src/sandbox/manager.js";
import { appendEvent, listEvents } from "../src/store/events.js";
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
    await journey.startJob(a, "build_step", async ({ queue }) => {
      queue.push("journey.test_line", { n: 1 });
      await gate;
      throw new Error("made-up failure");
    });
    await expect(journey.startJob(b, "build_step", noop)).rejects.toThrow(/One job runs at a time/);
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
    const results = await Promise.allSettled(ids.map((id) => j.startJob(id, "build_step", body)));
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

  it("the only engine the journey makes is the scripted engine; no other engine is named in the interface or the journey", () => {
    const files = [...readdirSync(join(builderDir, "src", "web")).filter((f) => f.endsWith(".ts")).map((f) => join(builderDir, "src", "web", f)), join(builderDir, "src", "orchestrator", "journey.ts")];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/new\s+(\w*Engine)\s*\(/g)) expect(m[1], f).toBe("ScriptedEngine");
      for (const m of src.matchAll(/from\s+["']\.\.\/engine\/([\w-]+)\.js["']/g)) expect(["scripted", "interface"], f).toContain(m[1]);
    }
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

