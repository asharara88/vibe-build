import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { classifyError, countOtherSockets, parseListeners, parseSettings, planAttempts } from "../scripts/isolation-probe.mjs";
import { cell, gotAnswer, parseProbeOutput, RESULT, renderMarkdownTable, renderTable, sessionProxyHostPort, summarise, type ProbeAttempt } from "../src/sandbox/isolation.js";
import { createSandbox, dockerEnv, sandbox } from "../src/sandbox/manager.js";

// Package 0.6a. The unit tests call the probe's pure functions only: no attempt is made from this machine.
const run = promisify(execFile);
const builderDir = resolve(import.meta.dirname, "..");
const probeFile = join(builderDir, "scripts", "isolation-probe.mjs");

const SETTINGS = { sessionProxy: "127.0.0.1:3999", projectDbPort: 5560, egressPort: 3128, gatewayPort: 4010, builderDbPort: 5432 };

// `toward` is any text here, so that a wrong value can be written on purpose.
const attempt = (over: Partial<Omit<ProbeAttempt, "toward">> & { toward?: string }) =>
  JSON.stringify({ kind: "attempt", id: "A1", group: "g", toward: "outside", what: "w", target: "t:1", how: "h", result: "refused", code: "ECONNREFUSED", detail: "", ...over });

describe("isolation probe: its own settings and words (unit)", () => {
  it("reads its settings, and refuses a session proxy given with anything but host and port", () => {
    const s = parseSettings(JSON.stringify(SETTINGS));
    expect(s.sessionProxy).toEqual({ host: "127.0.0.1", port: 3999 });
    expect(s.exampleAddress).toBe("93.184.215.14");
    expect(s.timeoutMs).toBe(5000);
    expect(parseSettings(JSON.stringify({ ...SETTINGS, sessionProxy: null })).sessionProxy).toBeNull();
    // Made-up user names and passwords: the probe refuses them, so it can never print one.
    for (const bad of ["made-up-user:made-up-pass@127.0.0.1:3999", "http://127.0.0.1:3999", "127.0.0.1", "127.0.0.1:70000", "127.0.0.1:39/x"])
      expect(() => parseSettings(JSON.stringify({ ...SETTINGS, sessionProxy: bad })), bad).toThrow(/host:port/);
    expect(() => parseSettings("not json")).toThrow(/JSON/);
    expect(() => parseSettings(JSON.stringify({ ...SETTINGS, egressPort: 0 }))).toThrow(/egressPort/);
    expect(() => parseSettings(JSON.stringify({ ...SETTINGS, exampleAddress: "example.com" }))).toThrow(/IPv4/);
    expect(() => parseSettings(JSON.stringify({ ...SETTINGS, timeoutMs: 60_000 }))).toThrow(/timeoutMs/);
  });

  it("names each failure by its error code, and every name it can give is one the report accepts", () => {
    expect(classifyError("ECONNREFUSED")).toBe("refused");
    expect(classifyError("TIMEOUT")).toBe("timed out");
    expect(classifyError("ENOTFOUND")).toBe("name not found");
    expect(classifyError("ENETUNREACH")).toBe("network unreachable");
    expect(classifyError("SELF_SIGNED_CERT_IN_CHAIN")).toBe("certificate not trusted");
    expect(classifyError("ECONNRESET")).toBe("connection reset");
    expect(classifyError("SOMETHING_ELSE")).toBe("error");
    expect(classifyError("ENOTFOUND", "lookup")).toBe("name not found");
    expect(classifyError("EAI_AGAIN", "lookup")).toBe("no name server answered");
    expect(classifyError("ECONNREFUSED", "lookup")).toBe("no name server answered");
    expect(classifyError("EREFUSED", "lookup")).toBe("lookup refused by the name server");
    const codes = ["ECONNREFUSED", "ETIMEDOUT", "TIMEOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "ECONNRESET", "SELF_SIGNED_CERT_IN_CHAIN", "EREFUSED", "X"];
    for (const c of codes) for (const ctx of ["connection", "lookup"] as const) expect(classifyError(c, ctx)).toMatch(RESULT);
    for (const ok of ["connected", "HTTP 301", "proxy answered 403", "found 1 address", "found 12 addresses"]) expect(ok).toMatch(RESULT);
  });

  it("finds the listening ports in /proc/net/tcp text (made-up sample in the kernel's format)", () => {
    const text = [
      "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      "   0: 0100007F:1538 00000000:0000 0A 00000000:00000000 00:00000000 00000000   102        0 1 1 0 100 0 0 10 0",
      "   1: 00000000:07E8 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 2 1 0 100 0 0 10 0",
      "   2: 020200C0:878C 0A684FA0:01BB 01 00000000:00000000 02:0000161A 00000000     0        0 3 2 0 20 4 30 628 -1",
    ].join("\n");
    expect(parseListeners(text)).toEqual([
      { address: "127.0.0.1", port: 5432 },
      { address: "0.0.0.0", port: 2024 },
    ]);
    expect(countOtherSockets(text)).toBe(1);
    expect(parseListeners("")).toEqual([]);
  });

  it("plans every attempt once, aims host attempts at the loopback address, and tries the session proxy only when given", () => {
    const withProxy = planAttempts(parseSettings(JSON.stringify(SETTINGS)), [{ address: "0.0.0.0", port: 2024 }]);
    const ids = withProxy.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of ["A", "B", "C", "D", "E", "F"]) expect(ids.some((i) => i.startsWith(g))).toBe(true);
    expect(ids).toContain("C9");
    expect(withProxy.find((a) => a.id === "X2024")?.target).toBe("127.0.0.1:2024");
    for (const a of withProxy.filter((x) => x.toward === "host")) expect(a.target).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(withProxy.find((a) => a.id === "C7")?.target).toBe("127.0.0.1:5560");
    // Without a session proxy: no attempt toward it, and nothing else changes.
    const without = planAttempts(parseSettings(JSON.stringify({ ...SETTINGS, sessionProxy: null })));
    expect(without.some((a) => a.id === "C9" || a.id.startsWith("F") || a.toward === "session-proxy")).toBe(false);
    // One extra listener, C9, and F1 to F4 fewer.
    expect(without.length).toBe(withProxy.length - 1 - 1 - 4);
  });
});

describe("isolation probe: reading what it prints (unit)", () => {
  it("reads a complete run, and counts which attempts got an answer of any kind", () => {
    const lines = [
      JSON.stringify({ kind: "info", name: "network interfaces", value: "lo (127.0.0.1)" }),
      attempt({ id: "A1" }),
      attempt({ id: "A2", result: "HTTP 301", code: null, detail: "server: made-up" }),
      attempt({ id: "C5", toward: "host", result: "connected", code: null }),
      attempt({ id: "D1", toward: "lookup", result: "found 2 addresses", code: null }),
      attempt({ id: "E3", toward: "egress-proxy", result: "proxy answered 403", code: null }),
      JSON.stringify({ kind: "end", attempts: 5 }),
    ];
    const r = parseProbeOutput(lines);
    expect(r.problems).toEqual([]);
    expect(r.ended).toBe(true);
    expect(r.info).toEqual([{ name: "network interfaces", value: "lo (127.0.0.1)" }]);
    const s = summarise(r);
    expect(s.total).toBe(5);
    expect(s.answered).toBe(4);
    expect(s.byToward.outside).toEqual({ total: 2, answered: 1 });
    expect(s.byToward.host).toEqual({ total: 1, answered: 1 });
    expect(s.byToward["session-proxy"]).toEqual({ total: 0, answered: 0 });
  });

  it("an answer of any kind is told apart from a failure", () => {
    for (const r of ["connected", "HTTP 403", "proxy answered 200", "found 1 address"]) expect(gotAnswer(r), r).toBe(true);
    for (const r of ["refused", "timed out", "name not found", "no name server answered", "network unreachable", "certificate not trusted", "connection reset", "error"])
      expect(gotAnswer(r), r).toBe(false);
  });

  it("never drops a line it does not understand: an unfinished run, a wrong count, an unknown result, a stray line and a stop are all problems", () => {
    expect(parseProbeOutput([attempt({})]).problems).toEqual(["the probe's closing line is missing: it did not finish"]);
    expect(parseProbeOutput([attempt({}), JSON.stringify({ kind: "end", attempts: 2 })]).problems).toEqual(["the probe says it made 2 attempts, 1 were read"]);
    const r = parseProbeOutput([
      attempt({ result: "maybe" }),
      attempt({ id: "A2", toward: "elsewhere" }),
      "a stray line",
      attempt({}),
      JSON.stringify({ kind: "error", reason: "made-up stop" }),
      JSON.stringify({ kind: "end", attempts: 2 }),
    ]);
    expect(r.ended).toBe(true);
    expect(r.problems).toEqual([
      'attempt A1: unknown result "maybe"',
      `an attempt line with a missing or wrong field: ${attempt({ id: "A2", toward: "elsewhere" })}`,
      "not a line of the probe: a stray line",
      "attempt A1 appears twice",
      "the probe stopped: made-up stop",
    ]);
  });

  it("takes the session proxy's host and port from its setting, never a user name or password", () => {
    expect(sessionProxyHostPort("http://made-up-user:made-up-pass@127.0.0.1:3999")).toBe("127.0.0.1:3999");
    expect(sessionProxyHostPort("http://127.0.0.1")).toBe("127.0.0.1:80");
    expect(sessionProxyHostPort("https://proxy.invalid")).toBe("proxy.invalid:443");
    expect(sessionProxyHostPort("not a url")).toBeNull();
    expect(sessionProxyHostPort("")).toBeNull();
    expect(sessionProxyHostPort(undefined)).toBeNull();
  });

  it("draws one row per attempt in the probe's order and one column per container, 'not tried' where a container did not make it", () => {
    const one = parseProbeOutput([attempt({ id: "F1", toward: "session-proxy", result: "proxy answered 200", code: null }), attempt({ id: "A1" }), JSON.stringify({ kind: "end", attempts: 2 })]);
    const two = parseProbeOutput([attempt({ id: "A1", result: "network unreachable", code: "ENETUNREACH" }), JSON.stringify({ kind: "end", attempts: 1 })]);
    const text = renderTable([
      { label: "first", report: one },
      { label: "second", report: two },
    ]);
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^id\s+\| target\s+\| what\s+\| first\s+\| second$/);
    expect(lines[2]).toContain("refused (ECONNREFUSED)");
    expect(lines[2]).toContain("network unreachable (ENETUNREACH)");
    expect(lines[3]).toMatch(/^F1 .*proxy answered 200 .*\| not tried$/);
    const md = renderMarkdownTable([
      { label: "first", report: one },
      { label: "second", report: two },
    ]);
    expect(md.split("\n")[0]).toBe("| Id | Target | What | first | second |");
    expect(cell(undefined)).toBe("not tried");
  });
});

describe("isolation probe: live, the engine container (development profile)", () => {
  const dir = mkdtempSync(join(tmpdir(), "builder-isolation-live-"));
  mkdirSync(join(dir, "workspace", "certs"), { recursive: true });
  const sb = createSandbox(
    {
      projectId: "p_isolation_live",
      dir,
      profile: "development-cloud-session",
      allowHosts: ["registry.npmjs.org"],
      gatewayUrl: "http://127.0.0.1:4010",
      builderDir,
      hostProxy: { url: process.env.HTTPS_PROXY ?? "http://127.0.0.1:1", caBundlePath: "/root/.ccr/ca-bundle.crt" },
      devDbPort: 5563,
      engine: { workspace: join(dir, "workspace"), changeSets: join(builderDir, "scripted") },
    },
    "sample-only-password",
  );

  afterAll(async () => {
    await sandbox.destroy(sb).catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  it("from inside the engine container, which has no network, every attempt fails, outside and on the host alike", async () => {
    const settings = JSON.stringify({ ...SETTINGS, sessionProxy: sessionProxyHostPort(process.env.HTTPS_PROXY), projectDbPort: 5563, timeoutMs: 3000 });
    const lines: string[] = [];
    const r = sandbox.runStreaming(sb, "engine", ["node", "/probe/isolation-probe.mjs", settings], {
      container: `${sb.projectName}-isolation-engine`,
      onLine: (l) => lines.push(l),
      volumes: [`${probeFile}:/probe/isolation-probe.mjs:ro`],
      timeoutMs: 170_000,
    });
    const end = await r.done;
    expect(end.code, end.stderrTail).toBe(0);
    const report = parseProbeOutput(lines);
    expect(report.problems).toEqual([]);
    expect(report.ended).toBe(true);
    // Nothing listens inside a container with no network, so the probe adds no attempt of its own.
    expect(report.attempts.map((a) => a.id)).toEqual(planAttempts(parseSettings(settings)).map((a) => a.id));
    expect(report.info.find((i) => i.name === "network interfaces")?.value).toMatch(/^lo \([^;]*\)$/);
    expect(report.info.find((i) => i.name === "a copy of the session certificate inside")?.value).toBe("none");
    const outside = report.attempts.filter((a) => a.toward === "outside");
    expect(outside.length).toBeGreaterThanOrEqual(13);
    for (const a of report.attempts) expect(gotAnswer(a.result), `${a.id} ${a.target}: ${a.result}`).toBe(false);
    const left = await run("docker", ["ps", "-a", "--filter", `name=${sb.projectName}-isolation-engine`, "--format", "{{.Names}}"], { env: dockerEnv(sb) });
    expect(left.stdout.trim()).toBe("");
  }, 180_000);
});
