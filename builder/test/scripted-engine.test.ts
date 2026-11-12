/**
 * Package 2.1: the scripted engine.
 *
 * The applier (builder/scripted/apply.mjs) is the build engine, so it is never run on this machine
 * (hard rule 9). The class is tested here against a stand-in runner that replays the lines the applier
 * prints and makes the changes the applier would make; the live tests at the end run the applier in
 * the engine container.
 */
import { execFile } from "node:child_process";
import { chownSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EngineEvent } from "../src/engine/interface.js";
import { git, initProjectRepo, resetToLastCommit, workspaceChanges, type ProjectRepo } from "../src/engine/project-repo.js";
import {
  listSteps,
  readManifest,
  SCRIPTED_AUTHOR,
  SCRIPTED_BANNER,
  ScriptedEngine,
  scriptedHeader,
  sha256Of,
  TEMPLATE_PROTECTED_PATHS,
  type EngineRunner,
} from "../src/engine/scripted.js";
import { composeDocument, createSandbox, dockerEnv, engineEmptyDir, sandbox, type Sandbox, type SandboxSpec } from "../src/sandbox/manager.js";

const run = promisify(execFile);
const builderDir = resolve(import.meta.dirname, "..");
const changeSets = join(builderDir, "scripted");
const templateDir = resolve(builderDir, "..", "templates", "next");
const EXAMPLE = "example-1";
const STEPS = ["01-data", "02-submitter-screen"];
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const PROTECTED = [...TEMPLATE_PROTECTED_PATHS];

/** A copy of the template as the demonstrations make it: no installed packages, build output, certificates or local settings. */
function copyTemplate(to: string) {
  cpSync(templateDir, to, { recursive: true, filter: (src) => !/\/(node_modules|\.next|certs|\.env(\.(?!example$)[^/]*)?)(\/|$)/.test(src) });
}

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
        image: "node:22-alpine",
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
      await expect(async () => sandbox.up(sb, ["engine"])).rejects.toThrow(/not started with up/);
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
  calls: Array<{ container: string; cmd: string[]; volumes: string[] }> = [];
  killed = false;
  constructor(
    private readonly workspace: string,
    private readonly script: (step: string, maxWrites: number) => { lines: object[]; code: number; write: string[]; hang?: boolean },
  ) {}
  runner: EngineRunner = (a) => {
    this.calls.push({ container: a.container, cmd: a.cmd, volumes: a.volumes });
    const step = a.cmd[a.cmd.indexOf("--step") + 1]!;
    const maxWrites = Number(a.cmd[a.cmd.indexOf("--max-writes") + 1]);
    const plan = this.script(step, maxWrites);
    let finish: (v: { code: number | null; stderrTail: string }) => void = () => undefined;
    const done = new Promise<{ code: number | null; stderrTail: string }>((r) => (finish = r));
    setTimeout(() => {
      for (const p of plan.write) {
        mkdirSync(dirname(join(this.workspace, p)), { recursive: true });
        writeFileSync(join(this.workspace, p), readFileSync(join(changeSets, EXAMPLE, step, "files", p)));
      }
      for (const l of plan.lines) a.onLine(JSON.stringify(l));
      if (!plan.hang) finish({ code: plan.code, stderrTail: "" });
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
    // The commit.
    expect((await git(repo, ["log", "-1", "--format=%an <%ae>|%cn <%ce>|%s"])).trim()).toBe(`${SCRIPTED_AUTHOR}|Builder <builder@example.invalid>|[scripted] example-1 01-data`);
    expect((await git(repo, ["show", "--name-only", "--format=", "HEAD"])).trim().split("\n").sort()).toEqual(res.changedFiles);
    expect(await workspaceChanges(repo)).toEqual({ changed: [], ignoredNew: [], ignoredChanged: [] });
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
    expect(await workspaceChanges(repo)).toEqual({ changed: [], ignoredNew: [], ignoredChanged: [] });
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

  it("stop() kills the running container and the step ends 'stopped'", async () => {
    const r = new StandInRunner(repo.workTree, (s) => ({ ...applierLines(s), lines: [], write: [], hang: true }));
    const engine = engineWith(r);
    const pending = engine.runStep(step("01-data"), () => undefined);
    await new Promise((res) => setTimeout(res, 50));
    await engine.stop();
    expect(r.killed).toBe(true);
    expect(await pending).toMatchObject({ ok: false, failureReason: "stopped" });
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
});

// ---------------------------------------------------------------------------------------------------
// Live: the applier in the engine container (development profile). Needs Docker and node:22-alpine.
// ---------------------------------------------------------------------------------------------------

describe("scripted engine: live, in the engine container (development profile)", () => {
  const dir = mkdtempSync(join(tmpdir(), "builder-engine-live-"));
  const workspace = join(dir, "workspace");
  // A copy of the change sets, with one more made-up example whose only change names a protected path.
  const sets = join(dir, "change-sets");
  const repo: ProjectRepo = { gitDir: join(dir, "workspace.git"), workTree: workspace };
  let sb: Sandbox;

  /** Run a command in the engine service and collect what it prints. */
  async function inEngine(cmd: string[], volumes: string[] = []): Promise<{ code: number | null; lines: string[] }> {
    const lines: string[] = [];
    const r = sandbox.runStreaming(sb, "engine", cmd, { container: `${sb.projectName}-probe-${Date.now()}`, onLine: (l) => lines.push(l), volumes });
    const { code } = await r.done;
    return { code, lines };
  }
  const projectContainers = async () =>
    (await run("docker", ["ps", "-a", "--filter", `label=com.docker.compose.project=${sb.projectName}`, "--format", "{{.Names}}"], { env: dockerEnv(sb) })).stdout.trim();

  afterAll(async () => {
    if (sb) {
      await sandbox.destroy(sb).catch(() => undefined);
      const left = await run("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${sb.projectName}`], { env: dockerEnv(sb) }).catch(() => ({ stdout: "" }));
      for (const id of left.stdout.split("\n").filter(Boolean)) await run("docker", ["rm", "-f", id], { env: dockerEnv(sb) }).catch(() => undefined);
    }
    rmSync(dir, { recursive: true, force: true });
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
    const res = await pending;
    expect(res).toMatchObject({ ok: false, failureReason: "stopped", turns: 1, changedFiles: ["src/db/app-schema.ts"] });
    expect(await projectContainers()).toBe("");
    await resetToLastCommit(repo);
    expect(await workspaceChanges(repo)).toEqual({ changed: [], ignoredNew: [], ignoredChanged: [] });
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

  it("a write to a protected path is refused: by the applier (a 'blocked' event), and by the read-only mount (the system refuses it)", async () => {
    const engine = new ScriptedEngine({ sandbox: sb, workspace, gitDir: repo.gitDir, changeSetsDir: sets, example: "test-protected" });
    const events: EngineEvent[] = [];
    const res = await engine.runStep({ projectId: "p_engine_live", stepId: "01-protected", instruction: "", protectedPaths: PROTECTED, maxTurns: 50 }, (e) => events.push(e));
    expect(events.find((e) => e.type === "blocked")).toMatchObject({ reason: "src/auth.ts: the path is protected: the engine must not change it" });
    expect(res).toMatchObject({ ok: false, changedFiles: [] });
    // Past the applier: a write straight to the file, in the same service with the same mounts.
    const write = "const fs = require('node:fs'); for (const p of ['/workspace/src/auth.ts', '/workspace/certs/planted.crt']) { try { fs.writeFileSync(p, 'x'); console.log(p + ' WRITTEN'); } catch (e) { console.log(p + ' ' + e.code); } }";
    const out = await inEngine(["node", "-e", write], PROTECTED.map((p) => `${join(workspace, p)}:/workspace/${p}:ro`));
    expect(out.lines).toEqual(["/workspace/src/auth.ts EROFS", "/workspace/certs/planted.crt EROFS"]);
    expect(sha256Of(readFileSync(join(workspace, "src", "auth.ts")))).toBe(sha256Of(readFileSync(join(templateDir, "src", "auth.ts"))));
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
