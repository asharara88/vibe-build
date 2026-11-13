/**
 * Package 2.1: the scripted engine.
 *
 * The applier (builder/scripted/apply.mjs) is the build engine, so it is never run on this machine
 * (hard rule 9). The class is tested here against a stand-in runner that replays the lines the applier
 * prints and makes the changes the applier would make; the live tests at the end run the applier in
 * the engine container.
 */
import { execFile, execFileSync } from "node:child_process";
import { chownSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EngineEvent } from "../src/engine/interface.js";
import { commitAll, entriesGitCannotSee, git, initProjectRepo, resetToLastCommit, workspaceChanges, type ProjectRepo } from "../src/engine/project-repo.js";
import {
  listSteps,
  readManifest,
  SCRIPTED_AUTHOR,
  SCRIPTED_BANNER,
  DEFAULT_STEP_TIMEOUT_MS,
  ScriptedEngine,
  scriptedHeader,
  sha256Of,
  TEMPLATE_PROTECTED_PATHS,
  type EngineRunner,
} from "../src/engine/scripted.js";
import { composeDocument, createSandbox, DEFAULT_IMAGES, dockerEnv, engineEmptyDir, sandbox, type Sandbox, type SandboxSpec, type StreamingEnd } from "../src/sandbox/manager.js";

const run = promisify(execFile);
const builderDir = resolve(import.meta.dirname, "..");
const changeSets = join(builderDir, "scripted");
const templateDir = resolve(builderDir, "..", "templates", "next");
const EXAMPLE = "example-1";
const STEPS = ["01-data", "02-submitter-screen"];
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const PROTECTED = [...TEMPLATE_PROTECTED_PATHS];
/** The workspace as at the last commit. */
const CLEAN = { changed: [], ignoredNew: [], ignoredChanged: [], notAllowed: [] };

/** A copy of the template as the demonstrations make it: no installed packages, build output, certificates or local settings. */
function copyTemplate(to: string) {
  cpSync(templateDir, to, { recursive: true, filter: (src) => !/\/(node_modules|\.next|certs|\.env(\.(?!example$)[^/]*)?)(\/|$)/.test(src) });
}

/** A made-up `.git` folder as a misbehaving engine might plant it: a HEAD, harmless settings, empty objects and refs. */
function plantDotGit(at: string) {
  mkdirSync(join(at, "objects"), { recursive: true });
  mkdirSync(join(at, "refs"), { recursive: true });
  writeFileSync(join(at, "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(at, "config"), "[core]\n\trepositoryformatversion = 0\n");
}

/** A folder holding a repository of its own, with one file: `git clean` skips such a folder unless -f is given twice. */
function plantNestedRepo(at: string) {
  mkdirSync(at, { recursive: true });
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "init", "--quiet", at], { env });
  writeFileSync(join(at, "f.txt"), "made-up\n");
}

const mkfifo = (at: string) => execFileSync("mkfifo", [at]);

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

describe("scripted engine: the fixed change sets of example 1", () => {
  it("has the two steps of the design note's slice, in order", () => {
    expect(listSteps(changeSets, EXAMPLE)).toEqual(STEPS);
    expect(listSteps(changeSets, "no-such-example")).toEqual([]);
  });

  it("each copy matches its fingerprint; each add is a file not there yet; each replace names the fingerprint of the file the step finds (the template's, or the previous step's)", () => {
    const current = new Map<string, Buffer>();
    for (const step of STEPS) {
      const m = readManifest(changeSets, EXAMPLE, step);
      expect(m.example).toBe(EXAMPLE);
      expect(m.step).toBe(step);
      for (const f of m.files) {
        const copy = readFileSync(join(changeSets, EXAMPLE, step, "files", f.path));
        expect(sha256Of(copy), f.path).toBe(f.sha256);
        const before = current.get(f.path) ?? (existsSync(join(templateDir, f.path)) ? readFileSync(join(templateDir, f.path)) : undefined);
        if (f.op === "add") {
          expect(before, `${step} adds ${f.path}, which is already there`).toBeUndefined();
          expect(f.expectSha256).toBeUndefined();
        } else {
          expect(f.op).toBe("replace");
          expect(before, `${step} replaces ${f.path}, which is not there`).toBeDefined();
          expect(sha256Of(before!), `${step} ${f.path}`).toBe(f.expectSha256);
        }
      }
      for (const f of m.files) current.set(f.path, readFileSync(join(changeSets, EXAMPLE, step, "files", f.path)));
    }
  });

  it("no path is protected, outside the workspace, under certs/ or hidden", () => {
    for (const step of STEPS) {
      for (const f of readManifest(changeSets, EXAMPLE, step).files) {
        expect(PROTECTED.some((p) => f.path === p || f.path.startsWith(p + "/")), f.path).toBe(false);
        expect(f.path.startsWith("/") || f.path.split("/").some((s) => s === ".." || s === "." || s === "" || s.startsWith(".")), f.path).toBe(false);
        expect(f.path.startsWith("certs/"), f.path).toBe(false);
      }
    }
  });

  it("every protected path is a plain file in the template", () => {
    for (const p of PROTECTED) expect(lstatSync(join(templateDir, p)).isFile(), p).toBe(true);
  });

  it('every code file written starts with "Written by the scripted engine (fixed change …). No AI model wrote this."', () => {
    let count = 0;
    for (const step of STEPS) {
      for (const f of readManifest(changeSets, EXAMPLE, step).files.filter((x) => CODE.test(x.path))) {
        const first = readFileSync(join(changeSets, EXAMPLE, step, "files", f.path), "utf8").split("\n")[0];
        expect(first, f.path).toBe(scriptedHeader(EXAMPLE, step));
        count++;
      }
    }
    // 01-data: app-schema.ts, drizzle.config.ts. 02: rules.ts, two pages, the form, the action, home.
    expect(count).toBe(8);
  });

  it("after each step the banner says, in both languages, that the scripted engine built the app; English and Arabic have the same messages", () => {
    for (const step of STEPS) {
      const en = JSON.parse(readFileSync(join(changeSets, EXAMPLE, step, "files", "messages", "en.json"), "utf8"));
      const ar = JSON.parse(readFileSync(join(changeSets, EXAMPLE, step, "files", "messages", "ar.json"), "utf8"));
      expect(en.app.sample_banner).toContain(SCRIPTED_BANNER.en);
      expect(ar.app.sample_banner).toContain(SCRIPTED_BANNER.ar);
      const keys = (o: Record<string, unknown>, p = ""): string[] =>
        Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
      expect(keys(ar).sort()).toEqual(keys(en).sort());
    }
  });

  it("the leave-request statuses are exactly the example spec's, with waiting as the default", () => {
    const spec = JSON.parse(readFileSync(join(builderDir, "src", "spec", "examples", "example-1-leave-request.json"), "utf8"));
    const choices = spec.entities.find((e: { name: string }) => e.name === "leave_request").fields.find((f: { name: string }) => f.name === "status").choices;
    const schema = readFileSync(join(changeSets, EXAMPLE, "01-data", "files", "src", "db", "app-schema.ts"), "utf8");
    const listed = /LEAVE_STATUSES = \[([^\]]*)\]/.exec(schema)![1]!.split(",").map((s) => s.trim().replace(/"/g, ""));
    expect(listed).toEqual(choices);
    expect(schema).toContain('.default("waiting")');
    expect(schema).toContain("...stamps()");
  });

  it("the change sets hold nothing but the applier, the manifests and the files they list", () => {
    const listed = new Set([join(changeSets, "apply.mjs")]);
    for (const step of STEPS) {
      listed.add(join(changeSets, EXAMPLE, step, "manifest.json"));
      for (const f of readManifest(changeSets, EXAMPLE, step).files) listed.add(join(changeSets, EXAMPLE, step, "files", f.path));
    }
    expect(walkFiles(changeSets).filter((f) => !listed.has(f)).map((f) => relative(changeSets, f))).toEqual([]);
  });

  it("the applier uses nothing but Node's own modules", () => {
    const code = readFileSync(join(changeSets, "apply.mjs"), "utf8");
    const imports = [...code.matchAll(/^\s*import\b[^"']*["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) expect(i, i).toMatch(/^node:/);
    expect(code).not.toMatch(/\brequire\(|import\(/);
  });
});

const base: Omit<SandboxSpec, "profile" | "dir"> = {
  projectId: "p_engine",
  allowHosts: ["registry.npmjs.org"],
  gatewayUrl: "http://gateway:4010",
  builderDir,
  hostProxy: { url: process.env.HTTPS_PROXY ?? "http://127.0.0.1:1", caBundlePath: "/root/.ccr/ca-bundle.crt" },
  devDbPort: 5561,
};

describe("scripted engine: the engine service in the compose file", () => {
  type Service = Record<string, unknown> & { volumes?: Array<Record<string, unknown>> };
  for (const profile of ["server", "development-cloud-session"] as const) {
    it(`${profile} profile: no network, no settings, the hardening, user node, and exactly three mounts`, () => {
      const doc = composeDocument({
        ...base,
        profile,
        dir: "/tmp/sb",
        app: { buildContext: "/tmp/sb/workspace", port: 3131 },
        engine: { workspace: "/tmp/sb/workspace", changeSets: "/opt/builder/scripted" },
      }) as { services: Record<string, Service> };
      const engine = doc.services.engine!;
      expect(engine).toEqual({
        image: DEFAULT_IMAGES.node,
        profiles: ["engine"],
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges:true"],
        pids_limit: 256,
        mem_limit: "1g",
        read_only: true,
        tmpfs: ["/tmp:rw,noexec,nosuid,size=16m"],
        user: "node",
        network_mode: "none",
        entrypoint: [],
        working_dir: "/workspace",
        volumes: [
          { type: "bind", source: "/tmp/sb/workspace", target: "/workspace", read_only: false, bind: { create_host_path: false } },
          { type: "bind", source: engineEmptyDir("/tmp/sb"), target: "/workspace/certs", read_only: true, bind: { create_host_path: false } },
          { type: "bind", source: "/opt/builder/scripted", target: "/engine", read_only: true, bind: { create_host_path: false } },
        ],
      });
      // Nothing of the sandbox's settings, secrets or the builder's own code.
      expect(JSON.stringify(engine)).not.toMatch(/secrets|\.env|env_file|environment|PROXY|DATABASE|builder\/src/);
      // No other service sees the change sets.
      for (const [name, s] of Object.entries(doc.services)) if (name !== "engine") expect(JSON.stringify(s)).not.toContain("/opt/builder/scripted");
    });
  }

  it("there is no engine service unless the sandbox asks for one", () => {
    const doc = composeDocument({ ...base, profile: "development-cloud-session", dir: "/tmp/sb" }) as { services: Record<string, unknown> };
    expect(doc.services.engine).toBeUndefined();
  });

  it("Docker Compose accepts the file; the empty folder is made; up refuses the engine service", async () => {
    const dir = mkdtempSync(join(tmpdir(), "builder-engine-doc-"));
    try {
      mkdirSync(join(dir, "workspace"));
      const sb = createSandbox(
        { ...base, profile: "server", dir, app: { buildContext: join(dir, "workspace"), port: 3131 }, engine: { workspace: join(dir, "workspace"), changeSets } },
        "sample-only-password",
      );
      expect(readdirSync(engineEmptyDir(dir))).toEqual([]);
      const { stdout } = await run("docker", ["compose", "-f", sb.composeFile, "--profile", "engine", "config", "--quiet"], { env: dockerEnv(sb) });
      expect(stdout).toBe("");
      // Called without await inside a function: a refusal thrown before the promise would fail here.
      await expect(sandbox.up(sb, ["engine"])).rejects.toThrow(/not started with up/);
      expect(() => sandbox.runStreaming(sb, "engine", ["true"], { container: "x", onLine: () => undefined, volumes: [`${join(dir, "missing")}:/workspace/missing:ro`] })).toThrow(
        /does not exist/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * A stand-in for the engine container: it replays the lines the applier prints and makes the change the
 * applier would make (copying the change set's files into the workspace). Nothing of the change sets runs.
 */
class StandInRunner {
  calls: Array<{ container: string; cmd: string[]; volumes: string[]; timeoutMs: number }> = [];
  killed = false;
  constructor(
    private readonly workspace: string,
    private readonly script: (step: string, maxWrites: number) => { lines: object[]; code: number; write: string[]; hang?: boolean; end?: Partial<StreamingEnd> },
  ) {}
  runner: EngineRunner = (a) => {
    this.calls.push({ container: a.container, cmd: a.cmd, volumes: a.volumes, timeoutMs: a.timeoutMs });
    const step = a.cmd[a.cmd.indexOf("--step") + 1]!;
    const maxWrites = Number(a.cmd[a.cmd.indexOf("--max-writes") + 1]);
    const plan = this.script(step, maxWrites);
    let finish: (v: StreamingEnd) => void = () => undefined;
    const done = new Promise<StreamingEnd>((r) => (finish = r));
    setTimeout(() => {
      for (const p of plan.write) {
        mkdirSync(dirname(join(this.workspace, p)), { recursive: true });
        writeFileSync(join(this.workspace, p), readFileSync(join(changeSets, EXAMPLE, step, "files", p)));
      }
      for (const l of plan.lines) a.onLine(JSON.stringify(l));
      if (!plan.hang) finish({ code: plan.code, stderrTail: "", ...plan.end });
    }, 5);
    return {
      container: a.container,
      done,
      kill: async () => {
        this.killed = true;
        finish({ code: 137, stderrTail: "" });
      },
    };
  };
}

/** The lines the applier prints for a whole step, from its manifest. */
function applierLines(step: string, maxWrites = Infinity) {
  const m = readManifest(changeSets, EXAMPLE, step);
  const lines: object[] = [{ kind: "start", example: EXAMPLE, step, files: m.files.length, label: m.label }];
  const write: string[] = [];
  for (const f of m.files) {
    if (write.length >= maxWrites) {
      lines.push({ kind: "limit", written: write.length, needed: m.files.length, reason: "turn limit reached" });
      return { lines, code: 3, write };
    }
    write.push(f.path);
    lines.push({ kind: "write", op: f.op, path: f.path, sha256: f.sha256 });
  }
  lines.push({ kind: "done", written: write.length });
  return { lines, code: 0, write };
}

describe("scripted engine: the class, against a stand-in runner (no container, no model)", () => {
  let dir: string;
  let repo: ProjectRepo;
  const fakeSandbox = { dir: "/nowhere", composeFile: "/nowhere/compose.yaml", projectName: "builder_p_unit" } as Sandbox;
  const engineWith = (r: StandInRunner) => new ScriptedEngine({ sandbox: fakeSandbox, workspace: repo.workTree, gitDir: repo.gitDir, changeSetsDir: changeSets, example: EXAMPLE, runner: r.runner });
  const step = (stepId: string, maxTurns = 50) => ({ projectId: "p_unit", stepId, instruction: "Made-up instruction text.", protectedPaths: PROTECTED, maxTurns });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "builder-scripted-unit-"));
    repo = { gitDir: join(dir, "workspace.git"), workTree: join(dir, "workspace") };
    copyTemplate(repo.workTree);
    // As createSandbox does on the development profile: a certificate in the workspace, which git ignores.
    mkdirSync(join(repo.workTree, "certs"));
    writeFileSync(join(repo.workTree, "certs", "session-ca.crt"), "made-up certificate\n");
    await initProjectRepo(repo, "Template copy");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("a step that runs: name scripted, its events, zero usage, turns = files written, and a commit labelled [scripted] by the scripted engine", async () => {
    const r = new StandInRunner(repo.workTree, (s) => applierLines(s));
    const engine = engineWith(r);
    expect(engine.name).toBe("scripted");
    const events: EngineEvent[] = [];
    const res = await engine.runStep(step("01-data"), (e) => events.push(e));
    expect(res.failureReason).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(res.usage).toEqual({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation_1h_tokens: 0, speed: "standard" });
    expect(res.turns).toBe(4);
    expect(res.changedFiles).toEqual(["drizzle.config.ts", "messages/ar.json", "messages/en.json", "src/db/app-schema.ts"]);
    expect(events.map((e) => e.type)).toEqual(["text", "text", "tool_call", "tool_call", "tool_call", "tool_call", "finished"]);
    expect((events[0] as { text: string }).text).toMatch(/^Scripted engine: fixed change example-1\/01-data\. The instruction \(25 characters\) is not read\. No model is called\.$/);
    expect(events.filter((e) => e.type === "tool_call").every((e) => (e as { tool: string }).tool === "scripted.write")).toBe(true);
    // What the container was asked to do.
    const call = r.calls[0]!;
    expect(call.cmd.slice(0, 6)).toEqual(["node", "/engine/apply.mjs", "--example", EXAMPLE, "--step", "01-data"]);
    expect(JSON.parse(call.cmd[call.cmd.indexOf("--protected") + 1]!)).toEqual(PROTECTED);
    expect(call.volumes).toEqual(PROTECTED.map((p) => `${repo.workTree}/${p}:/workspace/${p}:ro`));
    expect(call.container).toMatch(/^builder_p_unit-engine-01-data-[0-9a-f]{6}$/);
    expect(call.timeoutMs).toBe(DEFAULT_STEP_TIMEOUT_MS);
    // The commit.
    expect((await git(repo, ["log", "-1", "--format=%an <%ae>|%cn <%ce>|%s"])).trim()).toBe(`${SCRIPTED_AUTHOR}|Builder <builder@example.invalid>|[scripted] example-1 01-data`);
    expect((await git(repo, ["show", "--name-only", "--format=", "HEAD"])).trim().split("\n").sort()).toEqual(res.changedFiles);
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
    // The next step starts from it.
    const res2 = await engine.runStep(step("02-submitter-screen"), () => undefined);
    expect(res2.ok).toBe(true);
    expect(res2.turns).toBe(8);
  });

  it("the turn limit: the container is told it; a limit line ends the step as failed with 'turn limit reached'; nothing is committed", async () => {
    const r = new StandInRunner(repo.workTree, (s, max) => applierLines(s, max));
    const head = await git(repo, ["rev-parse", "HEAD"]);
    const events: EngineEvent[] = [];
    const res = await engineWith(r).runStep(step("01-data", 1), (e) => events.push(e));
    expect(r.calls[0]!.cmd[r.calls[0]!.cmd.indexOf("--max-writes") + 1]).toBe("1");
    expect(res).toMatchObject({ ok: false, failureReason: "turn limit reached", turns: 1, changedFiles: ["src/db/app-schema.ts"] });
    expect(events.at(-1)).toMatchObject({ type: "failed", reason: "turn limit reached" });
    expect(await git(repo, ["rev-parse", "HEAD"])).toBe(head);
    // The defined way back: the workspace as at the last commit.
    await resetToLastCommit(repo);
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
  });

  it("an unknown step fails before any container is started", async () => {
    const r = new StandInRunner(repo.workTree, (s) => applierLines(s));
    const res = await engineWith(r).runStep(step("03-no-such-step"), () => undefined);
    expect(res).toMatchObject({ ok: false, turns: 0 });
    expect(res.failureReason).toMatch(/^unknown step/);
    expect(r.calls).toEqual([]);
  });

  it("a write to a protected path refused by the applier becomes a 'blocked' event and a failed step", async () => {
    const r = new StandInRunner(repo.workTree, () => ({
      lines: [
        { kind: "start", example: EXAMPLE, step: "01-data", files: 1, label: "made-up" },
        { kind: "refused", path: "src/auth.ts", reason: "the path is protected: the engine must not change it" },
      ],
      code: 2,
      write: [],
    }));
    const events: EngineEvent[] = [];
    const res = await engineWith(r).runStep(step("01-data"), (e) => events.push(e));
    expect(events.find((e) => e.type === "blocked")).toMatchObject({ reason: "src/auth.ts: the path is protected: the engine must not change it" });
    expect(res).toMatchObject({ ok: false, failureReason: "blocked: src/auth.ts: the path is protected: the engine must not change it", changedFiles: [] });
  });

  it("a file the change does not name, or one git ignores, fails the step and is reported; nothing is committed", async () => {
    for (const extra of ["src/extra.ts", "certs/planted.crt", "node_modules/planted/index.js"]) {
      const r = new StandInRunner(repo.workTree, (s) => {
        const p = applierLines(s);
        mkdirSync(dirname(join(repo.workTree, extra)), { recursive: true });
        writeFileSync(join(repo.workTree, extra), "made-up\n");
        return p;
      });
      const head = await git(repo, ["rev-parse", "HEAD"]);
      const res = await engineWith(r).runStep(step("01-data"), () => undefined);
      expect(res.ok, extra).toBe(false);
      expect(res.failureReason, extra).toMatch(/files changed that (are not in the fixed change|git ignores)/);
      expect(res.changedFiles, extra).toContain(extra);
      expect(await git(repo, ["rev-parse", "HEAD"])).toBe(head);
      expect((await resetToLastCommit(repo)).unrestorable).toEqual([]);
      expect(existsSync(join(repo.workTree, extra)), extra).toBe(false);
    }
    // The certificate that was there before is kept.
    expect(existsSync(join(repo.workTree, "certs", "session-ca.crt"))).toBe(true);
  });

  it("stop() kills the running container and resolves only once the step has ended 'stopped'", async () => {
    const r = new StandInRunner(repo.workTree, (s) => ({ ...applierLines(s), lines: [], write: [], hang: true }));
    const engine = engineWith(r);
    const events: EngineEvent[] = [];
    const pending = engine.runStep(step("01-data"), (e) => events.push(e));
    await new Promise((res) => setTimeout(res, 50));
    expect(r.calls).toHaveLength(1);
    await engine.stop();
    expect(r.killed).toBe(true);
    // The step had ended, with its check after the run done, before stop() resolved.
    expect(events.at(-1)).toMatchObject({ type: "failed", reason: "stopped" });
    expect(await pending).toMatchObject({ ok: false, failureReason: "stopped" });
  });

  it("stop() asked for while the step is being prepared: no container is started, and stop() resolves once the step has ended", async () => {
    const r = new StandInRunner(repo.workTree, (s) => applierLines(s));
    const engine = engineWith(r);
    const events: EngineEvent[] = [];
    // runStep returns while the step is still at its first check (git status, before any container).
    const pending = engine.runStep(step("01-data"), (e) => events.push(e));
    await engine.stop();
    expect(r.calls).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: "failed", reason: "stopped" });
    expect(await pending).toMatchObject({ ok: false, failureReason: "stopped", turns: 0, changedFiles: [] });
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
    // The engine is free again: the next step runs.
    expect((await engine.runStep(step("01-data"), () => undefined)).ok).toBe(true);
  });

  it("a runner that reports a time limit or a failing event handler ends the step as failed, saying so", async () => {
    for (const [end, reason] of [
      [{ code: 137, timedOut: true }, /^the step ran longer than its time limit \(600 seconds\), so the engine container was stopped$/],
      [{ code: 137, handlerError: "made-up failure" }, /^handling the step's events failed, so the engine container was stopped: made-up failure$/],
    ] as const) {
      const r = new StandInRunner(repo.workTree, (s) => ({ ...applierLines(s), lines: [], write: [], code: 137, end }));
      const res = await engineWith(r).runStep(step("01-data"), () => undefined);
      expect(res.ok).toBe(false);
      expect(res.failureReason).toMatch(reason);
    }
  });

  it("an event handler that throws before the container is asked for fails the step; no container is started", async () => {
    const r = new StandInRunner(repo.workTree, (s) => applierLines(s));
    const res = await engineWith(r).runStep(step("01-data"), (e) => {
      if (e.type === "text") throw new Error("made-up failure in an event handler");
    });
    expect(res).toMatchObject({ ok: false, failureReason: "handling the step's events failed: made-up failure in an event handler" });
    expect(r.calls).toEqual([]);
  });

  it("entries git cannot see (a .git at the top, a .git in a folder git tracks, a .GIT, a named pipe, a nested repository) fail the step and are reported; nothing is committed; the reset leaves nothing", async () => {
    const plants: Array<[string, (ws: string) => void, string]> = [
      [".git", (ws) => plantDotGit(join(ws, ".git")), ".git (named .git)"],
      ["src/.git", (ws) => plantDotGit(join(ws, "src", ".git")), "src/.git (named .git)"],
      ["src/lib/.GIT", (ws) => plantDotGit(join(ws, "src", "lib", ".GIT")), "src/lib/.GIT (named .git)"],
      ["src/pipe", (ws) => mkfifo(join(ws, "src", "pipe")), "src/pipe (a named pipe)"],
      ["vendor2/x", (ws) => plantNestedRepo(join(ws, "vendor2", "x")), "vendor2/x/.git (named .git)"],
    ];
    for (const [name, plant, described] of plants) {
      const head = await git(repo, ["rev-parse", "HEAD"]);
      // Planted as the stand-in container runs, beside the step's own files.
      const r = new StandInRunner(repo.workTree, (s) => {
        plant(repo.workTree);
        return applierLines(s);
      });
      const res = await engineWith(r).runStep(step("01-data"), () => undefined);
      expect(res.ok, name).toBe(false);
      expect(res.failureReason, name).toContain("git cannot see");
      expect(res.failureReason, name).toContain(described);
      expect(await git(repo, ["rev-parse", "HEAD"]), name).toBe(head);
      const back = await resetToLastCommit(repo);
      expect(back.unrestorable, name).toEqual([]);
      expect(await workspaceChanges(repo), name).toEqual(CLEAN);
      expect(lstatSync(join(repo.workTree, name), { throwIfNoEntry: false }), name).toBeUndefined();
    }
    expect(existsSync(join(repo.workTree, "certs", "session-ca.crt"))).toBe(true);
  });

  it("a step does not start on a workspace that holds an entry git cannot see; the walk follows no link", async () => {
    const r = new StandInRunner(repo.workTree, (s) => applierLines(s));
    mkfifo(join(repo.workTree, "src", "pipe"));
    expect((await engineWith(r).runStep(step("01-data"), () => undefined)).failureReason).toMatch(/^the workspace holds entries git cannot see, which it must never hold: src\/pipe \(a named pipe\)$/);
    expect(r.calls).toEqual([]);
    rmSync(join(repo.workTree, "src", "pipe"));
    // A link to a folder holding a pipe is not followed: only the workspace's own entries are walked.
    const outside = mkdtempSync(join(tmpdir(), "builder-scripted-outside-"));
    try {
      mkfifo(join(outside, "pipe"));
      plantDotGit(join(outside, ".git"));
      symlinkSync(outside, join(repo.workTree, "link-out"));
      expect(entriesGitCannotSee(repo.workTree)).toEqual([]);
    } finally {
      rmSync(join(repo.workTree, "link-out"), { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("the reset: a nested repository and a named pipe are removed, nothing is left; what cannot be put back is returned", async () => {
    plantNestedRepo(join(repo.workTree, "vendor2", "x"));
    mkfifo(join(repo.workTree, "src", "pipe"));
    plantDotGit(join(repo.workTree, ".git"));
    writeFileSync(join(repo.workTree, "README.md"), "changed\n");
    const back = await resetToLastCommit(repo);
    expect(back.unrestorable).toEqual([]);
    // git removes the nested repository itself (-f twice); the walk's entries are removed after it.
    expect(back.removedNotAllowed).toEqual([".git", "src/pipe"]);
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
    for (const p of ["vendor2", "src/pipe", ".git"]) expect(lstatSync(join(repo.workTree, p), { throwIfNoEntry: false }), p).toBeUndefined();
    // An ignored file that was there at the last commit and has changed: git never had it, so it is returned.
    writeFileSync(join(repo.workTree, "certs", "session-ca.crt"), "made-up, changed\n");
    expect((await resetToLastCommit(repo)).unrestorable).toEqual(["certs/session-ca.crt"]);
  });

  it("ignored files named toString, constructor and __proto__ count as themselves: the check reports them as new, and the reset removes them", async () => {
    // Made-up names that a plain object would confuse with its own built-in properties (found by the review bot).
    const names = ["toString", "constructor", "__proto__"];
    const gi = join(repo.workTree, ".gitignore");
    writeFileSync(gi, readFileSync(gi, "utf8") + names.map((n) => `/${n}`).join("\n") + "\n");
    await commitAll(repo, SCRIPTED_AUTHOR, "A made-up commit: three more names ignored");
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
    for (const n of names) writeFileSync(join(repo.workTree, n), "made-up\n");
    expect((await workspaceChanges(repo)).ignoredNew).toEqual([...names].sort());
    const back = await resetToLastCommit(repo);
    expect(back.unrestorable).toEqual([]);
    for (const n of names) expect(existsSync(join(repo.workTree, n)), n).toBe(false);
    // And as part of the baseline: a file named __proto__ that was there at the commit, then changed, is seen.
    writeFileSync(join(repo.workTree, "__proto__"), "made-up, at the commit\n");
    writeFileSync(join(repo.workTree, "README.md"), "made-up, so that there is something to commit\n");
    await commitAll(repo, SCRIPTED_AUTHOR, "A made-up commit: an ignored __proto__ in the workspace");
    writeFileSync(join(repo.workTree, "__proto__"), "made-up, changed\n");
    expect((await workspaceChanges(repo)).ignoredChanged).toEqual(["__proto__"]);
  });

  it("the reset: a step that edited .gitignore so that the session certificate is no longer ignored does not get it removed", async () => {
    // Made-up: a .gitignore without its certificate line, then an untracked-looking certificate.
    const gi = join(repo.workTree, ".gitignore");
    writeFileSync(gi, readFileSync(gi, "utf8").split("\n").filter((l) => !l.startsWith("certs/")).join("\n"));
    const back = await resetToLastCommit(repo);
    expect(back.unrestorable).toEqual([]);
    expect(readFileSync(join(repo.workTree, "certs", "session-ca.crt"), "utf8")).toBe("made-up certificate\n");
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
  });

  it("a step does not start on a workspace with changes that are not committed, or when a protected path is missing", async () => {
    const r = new StandInRunner(repo.workTree, (s) => applierLines(s));
    writeFileSync(join(repo.workTree, "README.md"), "changed\n");
    expect((await engineWith(r).runStep(step("01-data"), () => undefined)).failureReason).toMatch(/not committed/);
    await resetToLastCommit(repo);
    rmSync(join(repo.workTree, "src", "auth.ts"));
    expect((await engineWith(r).runStep(step("01-data"), () => undefined)).failureReason).toMatch(/does not exist in the workspace/);
    expect(r.calls).toEqual([]);
  });

  it("an async event handler whose promise rejects before the container is asked for fails the step; no container is asked for", async () => {
    const r = new StandInRunner(repo.workTree, (s) => applierLines(s));
    const res = await engineWith(r).runStep(step("01-data"), async (e) => {
      if (e.type === "text") throw new Error("made-up failure in an async event handler");
    });
    expect(res).toMatchObject({ ok: false, failureReason: "handling the step's events failed: made-up failure in an async event handler", turns: 0 });
    expect(r.calls).toEqual([]);
  });

  it("an ignored symbolic link that is pointed elsewhere counts as a change: the step fails, nothing is committed, and the reset reports it", async () => {
    // An ignored link at the last commit, as installed packages have (node_modules/.bin).
    const link = join(repo.workTree, "node_modules", ".bin", "tool");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync("../tool-one/cli.js", link);
    writeFileSync(join(repo.workTree, "notes.txt"), "made-up\n");
    await commitAll(repo, SCRIPTED_AUTHOR, "A made-up commit, with an ignored link in the workspace");
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
    const head = await git(repo, ["rev-parse", "HEAD"]);
    // The stand-in container points it elsewhere, beside the step's own files.
    const r = new StandInRunner(repo.workTree, (s) => {
      rmSync(link);
      symlinkSync("../tool-two/cli.js", link);
      return applierLines(s);
    });
    const res = await engineWith(r).runStep(step("01-data"), () => undefined);
    expect(res).toMatchObject({ ok: false, failureReason: "files changed that git ignores, so the history would not show them: node_modules/.bin/tool" });
    expect(res.changedFiles).toContain("node_modules/.bin/tool");
    expect(await git(repo, ["rev-parse", "HEAD"])).toBe(head);
    // git never had it, so the reset cannot put it back, and says so.
    expect((await resetToLastCommit(repo)).unrestorable).toEqual(["node_modules/.bin/tool"]);
  });

  it("a folder tree deeper than the machine's path limit: the step fails saying the workspace could not be checked, nothing is committed; the reset cannot put it back (known gap 58)", async () => {
    const deep = join(repo.workTree, "d2345678901234567890");
    try {
      const head = await git(repo, ["rev-parse", "HEAD"]);
      // Planted as the stand-in container runs: 300 folders, one inside the other, made with relative
      // steps (a path given whole that long is refused), by a short Node command on this machine.
      const r = new StandInRunner(repo.workTree, (s) => {
        const makeDeep = "const fs = require('node:fs'); process.chdir(process.argv[1]); for (let i = 0; i < 300; i++) { fs.mkdirSync('d2345678901234567890'); process.chdir('d2345678901234567890'); } fs.writeFileSync('f.txt', 'made-up\\n');";
        execFileSync(process.execPath, ["-e", makeDeep, repo.workTree]);
        return applierLines(s);
      });
      const res = await engineWith(r).runStep(step("01-data"), () => undefined);
      expect(res).toMatchObject({ ok: false, failureReason: "the workspace could not be checked after the step (ENAMETOOLONG), so nothing was committed" });
      expect(await git(repo, ["rev-parse", "HEAD"])).toBe(head);
      // The remaining limit: git cannot read the tree, so the reset fails with git's error and the tree stays.
      await expect(resetToLastCommit(repo)).rejects.toThrow();
      expect(existsSync(deep)).toBe(true);
    } finally {
      // Node's rmSync fails on this tree (ENAMETOOLONG, measured); `rm -rf` removes it.
      execFileSync("rm", ["-rf", deep]);
    }
    expect((await resetToLastCommit(repo)).unrestorable).toEqual([]);
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
  });
});

// ---------------------------------------------------------------------------------------------------
// Live: the applier in the engine container (development profile). Needs Docker and the approved Node image (DEFAULT_IMAGES.node).
// ---------------------------------------------------------------------------------------------------

describe("scripted engine: live, in the engine container (development profile)", () => {
  // Made in beforeAll, not when the file is read, so that a run that skips these tests leaves no folder.
  let dir: string;
  let workspace: string;
  // A copy of the change sets, with made-up examples: one whose only change names a protected path,
  // changes the applier must refuse, and one a made-up misbehaving engine pretends to apply.
  let sets: string;
  let repo: ProjectRepo;
  let sb: Sandbox;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "builder-engine-live-"));
    workspace = join(dir, "workspace");
    sets = join(dir, "change-sets");
    repo = { gitDir: join(dir, "workspace.git"), workTree: workspace };
  });

  /** Run a command in the engine service and collect what it prints. */
  async function inEngine(cmd: string[], volumes: string[] = []): Promise<{ code: number | null; lines: string[] }> {
    const lines: string[] = [];
    const r = sandbox.runStreaming(sb, "engine", cmd, { container: `${sb.projectName}-probe-${Date.now()}`, onLine: (l) => lines.push(l), volumes });
    const { code } = await r.done;
    return { code, lines };
  }
  const protectedMounts = () => PROTECTED.map((p) => `${join(workspace, p)}:/workspace/${p}:ro`);
  const stepOf = (stepId: string, maxTurns = 50) => ({ projectId: "p_engine_live", stepId, instruction: "", protectedPaths: PROTECTED, maxTurns });
  /** The default runner, with a different command in place of the applier: a made-up misbehaving engine, in the same service with the step's mounts. */
  const engineRunning = (cmd: string[], seen?: { volumes: string[] }): EngineRunner => (a) => {
    if (seen) seen.volumes = a.volumes;
    return sandbox.runStreaming(sb, "engine", cmd, { container: a.container, volumes: a.volumes, onLine: a.onLine, timeoutMs: a.timeoutMs });
  };

  /** A made-up change set in the test's copy of the change sets: its files, and its manifest with their fingerprints. */
  function madeUpStep(example: string, stepId: string, files: Array<{ path: string; op: "add" | "replace"; content?: string; expectSha256?: string }>) {
    const at = join(sets, example, stepId);
    mkdirSync(join(at, "files"), { recursive: true });
    const entries = files.map((f) => {
      // No copy is written for a path outside the workspace: the applier refuses it before looking for one.
      if (f.content !== undefined) {
        mkdirSync(dirname(join(at, "files", f.path)), { recursive: true });
        writeFileSync(join(at, "files", f.path), f.content);
      }
      return { path: f.path, op: f.op, sha256: sha256Of(f.content ?? ""), ...(f.expectSha256 ? { expectSha256: f.expectSha256 } : {}) };
    });
    writeFileSync(join(at, "manifest.json"), JSON.stringify({ example, step: stepId, label: `A made-up change: ${stepId}`, files: entries }));
  }

  const projectContainers = async () =>
    (await run("docker", ["ps", "-a", "--filter", `label=com.docker.compose.project=${sb.projectName}`, "--format", "{{.Names}}"], { env: dockerEnv(sb) })).stdout.trim();

  afterAll(async () => {
    if (sb) {
      await sandbox.destroy(sb).catch(() => undefined);
      const left = await run("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${sb.projectName}`], { env: dockerEnv(sb) }).catch(() => ({ stdout: "" }));
      for (const id of left.stdout.split("\n").filter(Boolean)) await run("docker", ["rm", "-f", id], { env: dockerEnv(sb) }).catch(() => undefined);
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("set-up: a fresh copy of the template, its history outside it, owned by the engine's user", async () => {
    copyTemplate(workspace);
    cpSync(changeSets, sets, { recursive: true });
    mkdirSync(join(sets, "test-protected", "01-protected", "files", "src"), { recursive: true });
    writeFileSync(join(sets, "test-protected", "01-protected", "files", "src", "auth.ts"), "// made-up replacement\n");
    writeFileSync(
      join(sets, "test-protected", "01-protected", "manifest.json"),
      JSON.stringify({
        example: "test-protected",
        step: "01-protected",
        label: "A made-up change that replaces a protected file",
        files: [{ path: "src/auth.ts", op: "replace", sha256: sha256Of("// made-up replacement\n"), expectSha256: sha256Of(readFileSync(join(templateDir, "src", "auth.ts"))) }],
      }),
    );
    // Made-up changes the applier must refuse, and one with two files for the turn limit.
    madeUpStep("test-refusals", "01-wrong-fingerprint", [
      { path: "notes/first.txt", op: "add", content: "made-up\n" },
      { path: "messages/en.json", op: "replace", content: "{}\n", expectSha256: "0".repeat(64) },
    ]);
    madeUpStep("test-refusals", "02-add-existing", [{ path: "messages/en.json", op: "add", content: "{}\n" }]);
    madeUpStep("test-refusals", "03-outside-relative", [{ path: "../outside.txt", op: "add" }]);
    madeUpStep("test-refusals", "04-outside-absolute", [{ path: "/tmp/outside.txt", op: "add" }]);
    madeUpStep("test-refusals", "05-through-link", [{ path: "linked/new.txt", op: "add", content: "made-up\n" }]);
    madeUpStep("test-refusals", "06-two-files", [
      { path: "notes/a.txt", op: "add", content: "made-up a\n" },
      { path: "notes/b.txt", op: "add", content: "made-up b\n" },
    ]);
    // The step a made-up misbehaving engine pretends to apply while it plants entries git cannot see.
    madeUpStep("test-unseen", "01-note", [{ path: "src/note-c.ts", op: "add", content: "// made-up note\n" }]);
    sb = createSandbox(
      { ...base, projectId: "p_engine_live", profile: "development-cloud-session", dir, app: { buildContext: workspace, port: 3131 }, engine: { workspace, changeSets: sets } },
      "sample-only-password",
    );
    expect(existsSync(join(workspace, "certs", "session-ca.crt"))).toBe(true);
    // The engine runs as the image's user node (uid 1000), so the workspace must be that user's.
    if (process.getuid?.() === 0) for (const f of [workspace, ...walkFiles(workspace), ...walkDirs(workspace)]) chownSync(f, 1000, 1000);
    await initProjectRepo(repo, "Template copy");
  });

  it("stop() part-way: the container is killed and removed, and the workspace is put back", async () => {
    const engine = new ScriptedEngine({ sandbox: sb, workspace, gitDir: repo.gitDir, changeSetsDir: sets, example: EXAMPLE, delayMsPerWrite: 2000 });
    const events: EngineEvent[] = [];
    let firstWrite: () => void = () => undefined;
    const wrote = new Promise<void>((r) => (firstWrite = r));
    const pending = engine.runStep({ projectId: "p_engine_live", stepId: "01-data", instruction: "", protectedPaths: PROTECTED, maxTurns: 50 }, (e) => {
      events.push(e);
      if (e.type === "tool_call") firstWrite();
    });
    await wrote;
    await engine.stop();
    // stop() resolved only once the step had ended: its last event is out, and no container is left.
    expect(events.at(-1)).toMatchObject({ type: "failed", reason: "stopped" });
    expect(await projectContainers()).toBe("");
    const res = await pending;
    expect(res).toMatchObject({ ok: false, failureReason: "stopped", turns: 1, changedFiles: ["src/db/app-schema.ts"] });
    expect((await resetToLastCommit(repo)).unrestorable).toEqual([]);
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
  }, 120_000);

  it("stop() asked for while the step is being prepared: no engine container is started, and the workspace is unchanged", async () => {
    let started = 0;
    const counting: EngineRunner = (a) => {
      started++;
      return sandbox.runStreaming(sb, "engine", a.cmd, { container: a.container, volumes: a.volumes, onLine: a.onLine, timeoutMs: a.timeoutMs });
    };
    const engine = new ScriptedEngine({ sandbox: sb, workspace, gitDir: repo.gitDir, changeSetsDir: sets, example: EXAMPLE, runner: counting });
    const head = await git(repo, ["rev-parse", "HEAD"]);
    const pending = engine.runStep(stepOf("01-data"), () => undefined);
    await engine.stop();
    expect(started).toBe(0);
    expect(await pending).toMatchObject({ ok: false, failureReason: "stopped", turns: 0, changedFiles: [] });
    expect(await projectContainers()).toBe("");
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
    expect(await git(repo, ["rev-parse", "HEAD"])).toBe(head);
  }, 120_000);

  it("a step that runs past its time limit: the container is killed and removed, and the step fails saying so", async () => {
    const engine = new ScriptedEngine({ sandbox: sb, workspace, gitDir: repo.gitDir, changeSetsDir: sets, example: EXAMPLE, delayMsPerWrite: 5000, stepTimeoutMs: 2000 });
    const t = Date.now();
    const res = await engine.runStep(stepOf("01-data"), () => undefined);
    expect(res).toMatchObject({ ok: false, failureReason: "the step ran longer than its time limit (2 seconds), so the engine container was stopped", turns: 0 });
    expect(Date.now() - t).toBeLessThan(30_000);
    expect(await projectContainers()).toBe("");
    expect((await resetToLastCommit(repo)).unrestorable).toEqual([]);
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
  }, 120_000);

  it("an event handler that throws while the container runs: the builder goes on, the container is killed and removed, and the step fails saying so", async () => {
    const engine = new ScriptedEngine({ sandbox: sb, workspace, gitDir: repo.gitDir, changeSetsDir: sets, example: EXAMPLE, delayMsPerWrite: 1500 });
    const head = await git(repo, ["rev-parse", "HEAD"]);
    const res = await engine.runStep(stepOf("01-data"), (e) => {
      if (e.type === "tool_call") throw new Error("made-up failure in an event handler");
    });
    expect(res).toMatchObject({ ok: false, failureReason: "handling the step's events failed, so the engine container was stopped: made-up failure in an event handler", turns: 1 });
    expect(await projectContainers()).toBe("");
    expect(await git(repo, ["rev-parse", "HEAD"])).toBe(head);
    expect((await resetToLastCommit(repo)).unrestorable).toEqual([]);
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
  }, 120_000);

  it("applies both fixed steps in the engine container; each is committed as [scripted] by the scripted engine, with zero usage", async () => {
    const engine = new ScriptedEngine({ sandbox: sb, workspace, gitDir: repo.gitDir, changeSetsDir: sets, example: EXAMPLE });
    for (const [stepId, files] of [["01-data", 4], ["02-submitter-screen", 8]] as const) {
      const events: EngineEvent[] = [];
      const res = await engine.runStep({ projectId: "p_engine_live", stepId, instruction: "Made-up instruction.", protectedPaths: PROTECTED, maxTurns: 50 }, (e) => events.push(e));
      expect(res.failureReason, stepId).toBeUndefined();
      expect(res).toMatchObject({ ok: true, turns: files });
      expect(res.usage.input_tokens + res.usage.output_tokens).toBe(0);
      expect(res.changedFiles).toEqual(readManifest(sets, EXAMPLE, stepId).files.map((f) => f.path).sort());
      expect(events.filter((e) => e.type === "tool_call")).toHaveLength(files);
      expect(events.at(-1)?.type).toBe("finished");
    }
    const log = (await git(repo, ["log", "--format=%an <%ae>|%s"])).trim().split("\n");
    expect(log).toEqual([`${SCRIPTED_AUTHOR}|[scripted] example-1 02-submitter-screen`, `${SCRIPTED_AUTHOR}|[scripted] example-1 01-data`, "Builder <builder@example.invalid>|Template copy"]);
    expect(readFileSync(join(workspace, "src", "db", "app-schema.ts"), "utf8").split("\n")[0]).toBe(scriptedHeader(EXAMPLE, "01-data"));
    expect(await projectContainers()).toBe("");
  }, 120_000);

  it("a protected path: the applier refuses to write it (a 'blocked' event), and the read-only mount refuses a write in place (EROFS), which is all a mount over a file stops (next test)", async () => {
    const engine = new ScriptedEngine({ sandbox: sb, workspace, gitDir: repo.gitDir, changeSetsDir: sets, example: "test-protected" });
    const events: EngineEvent[] = [];
    const res = await engine.runStep({ projectId: "p_engine_live", stepId: "01-protected", instruction: "", protectedPaths: PROTECTED, maxTurns: 50 }, (e) => events.push(e));
    expect(events.find((e) => e.type === "blocked")).toMatchObject({ reason: "src/auth.ts: the path is protected: the engine must not change it" });
    expect(res).toMatchObject({ ok: false, changedFiles: [] });
    // Past the applier: a write straight to the file, in the same service with the same mounts.
    const write = "const fs = require('node:fs'); for (const p of ['/workspace/src/auth.ts', '/workspace/certs/planted.crt']) { try { fs.writeFileSync(p, 'x'); console.log(p + ' WRITTEN'); } catch (e) { console.log(p + ' ' + e.code); } }";
    const out = await inEngine(["node", "-e", write], protectedMounts());
    expect(out.lines).toEqual(["/workspace/src/auth.ts EROFS", "/workspace/certs/planted.crt EROFS"]);
    expect(sha256Of(readFileSync(join(workspace, "src", "auth.ts")))).toBe(sha256Of(readFileSync(join(templateDir, "src", "auth.ts"))));
  }, 120_000);

  it("a protected file replaced through a renamed folder, or its folder moved aside and replaced by a link to the moved copy: the read-only mount over the file does not stop it; the check after the step does (the step fails, nothing is committed, one reset puts the folder back)", async () => {
    // A made-up misbehaving engine, run in the engine service with the step's mounts, in place of the applier.
    const script = [
      "const fs = require('node:fs');",
      "let inPlace; try { fs.writeFileSync('/workspace/src/lib/roles.tsx', 'x'); inPlace = 'WRITTEN'; } catch (e) { inPlace = e.code; }",
      "fs.renameSync('/workspace/src/lib', '/workspace/src/lib-moved');",
      "fs.mkdirSync('/workspace/src/lib');",
      "fs.writeFileSync('/workspace/src/lib/roles.tsx', '// made-up replacement\\n');",
      "console.log(JSON.stringify({ kind: 'start', example: 'test-protected', step: '01-protected', files: 1, label: 'made-up engine: write in place ' + inPlace + '; src/lib renamed, roles.tsx written anew' }));",
      "console.log(JSON.stringify({ kind: 'done', written: 0 }));",
    ].join("\n");
    const seen = { volumes: [] as string[] };
    const engine = new ScriptedEngine({ sandbox: sb, workspace, gitDir: repo.gitDir, changeSetsDir: sets, example: "test-protected", runner: engineRunning(["node", "-e", script], seen) });
    const head = await git(repo, ["rev-parse", "HEAD"]);
    const events: EngineEvent[] = [];
    const res = await engine.runStep(stepOf("01-protected"), (e) => events.push(e));
    // The protected file was mounted read-only over itself, and a write in place was refused.
    expect(seen.volumes).toContain(`${join(workspace, "src", "lib", "roles.tsx")}:/workspace/src/lib/roles.tsx:ro`);
    expect(events.some((e) => e.type === "text" && e.text === "Scripted engine: made-up engine: write in place EROFS; src/lib renamed, roles.tsx written anew (1 files).")).toBe(true);
    // Yet the file at the protected path on this machine is now a different one.
    expect(readFileSync(join(workspace, "src", "lib", "roles.tsx"), "utf8")).toBe("// made-up replacement\n");
    expect(res).toMatchObject({ ok: false, failureReason: "protected files changed: src/lib/access.ts, src/lib/roles.tsx" });
    expect(await git(repo, ["rev-parse", "HEAD"])).toBe(head);
    expect((await resetToLastCommit(repo)).unrestorable).toEqual([]);
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
    expect(sha256Of(readFileSync(join(workspace, "src", "lib", "roles.tsx")))).toBe(sha256Of(readFileSync(join(templateDir, "src", "lib", "roles.tsx"))));
    expect(existsSync(join(workspace, "src", "lib-moved"))).toBe(false);
    expect(await projectContainers()).toBe("");

    // The second route (found by the second review): src/lib moved aside and a link to the moved copy
    // put in its place. A reset that put the tracked files back before removing what is new wrote
    // nothing there, and its clean then removed the link and the copy, so one reset left them missing.
    const viaLink = [
      "const fs = require('node:fs');",
      "fs.renameSync('/workspace/src/lib', '/workspace/src/lib-moved');",
      "fs.symlinkSync('lib-moved', '/workspace/src/lib');",
      "console.log(JSON.stringify({ kind: 'start', example: 'test-protected', step: '01-protected', files: 1, label: 'made-up engine: src/lib moved aside and replaced by a link to it' }));",
      "console.log(JSON.stringify({ kind: 'done', written: 0 }));",
    ].join("\n");
    const linking = new ScriptedEngine({ sandbox: sb, workspace, gitDir: repo.gitDir, changeSetsDir: sets, example: "test-protected", runner: engineRunning(["node", "-e", viaLink]) });
    const res2 = await linking.runStep(stepOf("01-protected"), () => undefined);
    expect(lstatSync(join(workspace, "src", "lib")).isSymbolicLink()).toBe(true);
    expect(res2).toMatchObject({ ok: false, failureReason: "protected files changed: src/lib/access.ts, src/lib/roles.tsx" });
    expect(await git(repo, ["rev-parse", "HEAD"])).toBe(head);
    // One reset puts the folder back: what is new (the link, the moved copy) is removed first.
    expect((await resetToLastCommit(repo)).unrestorable).toEqual([]);
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
    expect(lstatSync(join(workspace, "src", "lib")).isDirectory()).toBe(true);
    for (const f of ["roles.tsx", "access.ts"]) expect(sha256Of(readFileSync(join(workspace, "src", "lib", f))), f).toBe(sha256Of(readFileSync(join(templateDir, "src", "lib", f))));
    expect(existsSync(join(workspace, "src", "lib-moved"))).toBe(false);
    expect(await projectContainers()).toBe("");
  }, 120_000);

  it("a step that plants .git folders and a named pipe beside its own file: the walk sees them though git does not, the step fails, nothing is committed, the reset removes them", async () => {
    const note = "// made-up note\n";
    // A made-up misbehaving engine (busybox sh in the engine image). The planted settings are harmless.
    const script = [
      "set -e",
      "for d in /workspace/.git /workspace/src/.git; do mkdir -p $d/objects $d/refs; printf 'ref: refs/heads/main\\n' > $d/HEAD; printf '[core]\\n\\trepositoryformatversion = 0\\n' > $d/config; done",
      "mkfifo /workspace/src/pipe",
      "printf '// made-up note\\n' > /workspace/src/note-c.ts",
      `echo '${JSON.stringify({ kind: "start", example: "test-unseen", step: "01-note", files: 1, label: "made-up engine" })}'`,
      `echo '${JSON.stringify({ kind: "write", op: "add", path: "src/note-c.ts", sha256: sha256Of(note) })}'`,
      `echo '${JSON.stringify({ kind: "done", written: 1 })}'`,
    ].join("\n");
    const engine = new ScriptedEngine({ sandbox: sb, workspace, gitDir: repo.gitDir, changeSetsDir: sets, example: "test-unseen", runner: engineRunning(["sh", "-c", script]) });
    const head = await git(repo, ["rev-parse", "HEAD"]);
    // git itself lists only the note.
    const res = await engine.runStep(stepOf("01-note"), () => undefined);
    expect((await git(repo, ["status", "--porcelain", "--untracked-files=all"])).trim()).toBe("?? src/note-c.ts");
    expect(res).toMatchObject({
      ok: false,
      failureReason: "entries git cannot see, which the workspace must never hold: .git (named .git), src/.git (named .git), src/pipe (a named pipe)",
      changedFiles: [".git", "src/.git", "src/note-c.ts", "src/pipe"],
    });
    expect(await git(repo, ["rev-parse", "HEAD"])).toBe(head);
    const back = await resetToLastCommit(repo);
    expect(back).toMatchObject({ removedNotAllowed: [".git", "src/.git", "src/pipe"], unrestorable: [] });
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
    for (const p of [".git", "src/.git", "src/pipe", "src/note-c.ts"]) expect(lstatSync(join(workspace, p), { throwIfNoEntry: false }), p).toBeUndefined();
    expect(await projectContainers()).toBe("");
  }, 120_000);

  it("the applier's refusals, in the engine container: a wrong fingerprint for a replace (nothing written, though the entry before it was sound), an add over an existing file, a path outside the workspace, a path through a link; and the applier does not start outside /engine or without a workspace", async () => {
    const applier = (stepId: string) => inEngine(["node", "/engine/apply.mjs", "--example", "test-refusals", "--step", stepId, "--protected", JSON.stringify(PROTECTED)], protectedMounts());
    // A link in the workspace, planted on this machine for the test: it points out of the workspace.
    symlinkSync("/tmp", join(workspace, "linked"));
    try {
      for (const [stepId, path, reason] of [
        ["01-wrong-fingerprint", "messages/en.json", "the file is not the one this change was written for (its fingerprint differs)"],
        ["02-add-existing", "messages/en.json", "the file already exists, and this change only adds it"],
        ["03-outside-relative", "../outside.txt", "the path is outside the workspace"],
        ["04-outside-absolute", "/tmp/outside.txt", "the path is outside the workspace"],
        ["05-through-link", "linked/new.txt", "the path goes through a symbolic link"],
      ] as const) {
        const out = await applier(stepId);
        expect(out.code, stepId).toBe(2);
        expect(
          out.lines.map((l) => JSON.parse(l) as { kind: string }),
          stepId,
        ).toEqual([expect.objectContaining({ kind: "start", example: "test-refusals", step: stepId }), { kind: "refused", path, reason }]);
      }
    } finally {
      rmSync(join(workspace, "linked"), { force: true });
    }
    // None of them wrote anything.
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
    expect(existsSync(join(workspace, "notes"))).toBe(false);
    // The applier's own guard (it needs /.dockerenv, /workspace and to be run from /engine). Run from
    // anywhere but /engine, it does not start; nor in a container with no workspace mounted. Its
    // /.dockerenv test cannot fail in any container, and is not run on this machine (hard rule 9).
    const refusal = JSON.stringify({ kind: "error", reason: "apply.mjs runs only inside the project's engine container" });
    const copy = await inEngine(["sh", "-c", "cp /engine/apply.mjs /tmp/apply.mjs && node /tmp/apply.mjs --example example-1 --step 01-data --protected '[]'"]);
    expect(copy).toEqual({ code: 1, lines: [refusal] });
    const noWorkspace = await run(
      "docker",
      ["run", "--rm", "--network", "none", "--user", "node", "--read-only", "--cap-drop", "ALL", "-v", `${sets}:/engine:ro`, DEFAULT_IMAGES.node, "node", "/engine/apply.mjs", "--example", "example-1", "--step", "01-data", "--protected", "[]"],
      { env: dockerEnv(sb) },
    ).then(
      (r) => ({ code: 0, out: r.stdout.trim() }),
      (e: { code?: number; stdout?: string }) => ({ code: e.code, out: (e.stdout ?? "").trim() }),
    );
    expect(noWorkspace).toEqual({ code: 1, out: refusal });
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
    expect(await projectContainers()).toBe("");
  }, 120_000);

  it("the turn limit inside the applier: with a limit of 1 it writes one file and stops; the step fails 'turn limit reached'; nothing is committed; the reset puts it back", async () => {
    const engine = new ScriptedEngine({ sandbox: sb, workspace, gitDir: repo.gitDir, changeSetsDir: sets, example: "test-refusals" });
    const head = await git(repo, ["rev-parse", "HEAD"]);
    const res = await engine.runStep(stepOf("06-two-files", 1), () => undefined);
    expect(res).toMatchObject({ ok: false, failureReason: "turn limit reached", turns: 1, changedFiles: ["notes/a.txt"] });
    expect(await git(repo, ["rev-parse", "HEAD"])).toBe(head);
    expect((await resetToLastCommit(repo)).unrestorable).toEqual([]);
    expect(await workspaceChanges(repo)).toEqual(CLEAN);
    expect(await projectContainers()).toBe("");
  }, 120_000);

  it("runStreaming: a line handler that throws does not bring the builder down; the container is killed and removed, and the run ends carrying the error", async () => {
    const t = Date.now();
    const lines: string[] = [];
    const r = sandbox.runStreaming(sb, "engine", ["node", "-e", "console.log('first'); console.log('second'); setTimeout(() => {}, 60000)"], {
      container: `${sb.projectName}-handler-${Date.now()}`,
      onLine: (l) => {
        lines.push(l);
        throw new Error("made-up failure in an event handler");
      },
    });
    const end = await r.done;
    expect(end.handlerError).toBe("made-up failure in an event handler");
    expect(lines).toEqual(["first"]);
    expect(Date.now() - t).toBeLessThan(30_000);
    expect(await projectContainers()).toBe("");
  }, 120_000);

  it("an event handler that fails asynchronously (its promise rejects) while the container runs: no rejection is left unhandled, the container is killed and removed, and the step fails saying so", async () => {
    // A rejection left unhandled ends a Node process (the builder). It is counted here as well as by the test runner.
    const unhandled: unknown[] = [];
    const count = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", count);
    try {
      // Example 1's steps are committed by now (an earlier test): the made-up two-file change is used.
      const engine = new ScriptedEngine({ sandbox: sb, workspace, gitDir: repo.gitDir, changeSetsDir: sets, example: "test-refusals", delayMsPerWrite: 2000 });
      const head = await git(repo, ["rev-parse", "HEAD"]);
      // As a handler that awaits a write to the event store, and that write fails.
      const res = await engine.runStep(stepOf("06-two-files"), async (e) => {
        if (e.type === "tool_call") {
          await new Promise((r) => setTimeout(r, 10));
          throw new Error("made-up failure in an async event handler");
        }
      });
      expect(res).toMatchObject({
        ok: false,
        failureReason: "handling the step's events failed, so the engine container was stopped: made-up failure in an async event handler",
        turns: 1,
        changedFiles: ["notes/a.txt"],
      });
      expect(await projectContainers()).toBe("");
      expect(await git(repo, ["rev-parse", "HEAD"])).toBe(head);
      expect((await resetToLastCommit(repo)).unrestorable).toEqual([]);
      expect(await workspaceChanges(repo)).toEqual(CLEAN);
      // Time for a rejection that was not caught to be reported.
      await new Promise((r) => setTimeout(r, 500));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", count);
    }
  }, 120_000);

  it("inside the engine container: user node, no settings of its own, no network but loopback, an empty certs folder, the change sets read-only", async () => {
    const probe = [
      "const fs = require('node:fs'); const os = require('node:os');",
      "console.log('uid ' + process.getuid());",
      "console.log('env ' + Object.keys(process.env).sort().join(','));",
      "console.log('interfaces ' + Object.keys(os.networkInterfaces()).sort().join(','));",
      "console.log('certs [' + fs.readdirSync('/workspace/certs').join(',') + ']');",
      "try { fs.writeFileSync('/engine/x', 'x'); console.log('engine WRITTEN'); } catch (e) { console.log('engine ' + e.code); }",
      "console.log('dockerenv ' + fs.existsSync('/.dockerenv'));",
    ].join(" ");
    const out = await inEngine(["node", "-e", probe]);
    expect(out.code).toBe(0);
    expect(out.lines).toEqual(["uid 1000", "env HOME,HOSTNAME,NODE_VERSION,PATH,YARN_VERSION", "interfaces lo", "certs []", "engine EROFS", "dockerenv true"]);
  }, 120_000);

  it("removing the project also removes an engine container whose run was cut off", async () => {
    // An engine run left behind, as when the builder is stopped while a step runs.
    await run("docker", ["compose", "-f", sb.composeFile, "--profile", "engine", "run", "-d", "--no-deps", "engine", "node", "-e", "setTimeout(() => {}, 120000)"], { env: dockerEnv(sb) });
    expect(await projectContainers()).not.toBe("");
    await sandbox.destroy(sb);
    expect(await projectContainers()).toBe("");
  }, 120_000);
});

function walkDirs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      out.push(join(dir, e.name));
      walkDirs(join(dir, e.name), out);
    }
  }
  return out;
}
