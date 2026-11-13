import { execFile } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http, { type Server } from "node:http";
import https from "node:https";
import type { AddressInfo, Socket } from "node:net";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import tls from "node:tls";
import { promisify } from "node:util";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { appAnswers } from "../src/acceptance/runner.js";
import {
  BODY_READ_MS,
  classifyError,
  countOtherSockets,
  DEFAULT_ROUTE_INFO,
  INTERFACES_ALL,
  INTERFACES_UP,
  IPV6_INFO,
  ipv6State,
  listInterfaces,
  MAX_MACHINE_LISTENERS,
  parseAbstractUnix,
  parseListeners,
  parseRoutes,
  parseSettings,
  parseUdpBound,
  planAttempts,
  ROUTES_INFO,
  runAttempt,
  type PlannedAttempt,
} from "../scripts/isolation-probe.mjs";
import {
  ANSWER_WORDING,
  cell,
  columnCell,
  compareIds,
  compareWithExpected,
  DIFFERS_BY_CONTAINER,
  expectedOnDevelopment,
  expectedPositiveControls,
  gotAnswer,
  machineAddressesFrom,
  machineListenersFrom,
  parseProbeOutput,
  readMachineSide,
  RESULT,
  renderMarkdownTable,
  renderTable,
  sessionProxyHostPort,
  summarise,
  type Comparison,
  type ProbeAttempt,
} from "../src/sandbox/isolation.js";
import { composeDocument, createSandbox, dockerEnv, sandbox, socketOwner, toYaml, type Sandbox, type SandboxSpec } from "../src/sandbox/manager.js";
import {
  APP_STAND_IN,
  buildStandIns,
  devProbeSettings,
  freePort,
  GATEWAY_STAND_IN,
  leftOf,
  probeComparison,
  probeInNetworkOf,
  probeService,
  removeImages,
  runnerStandInImage,
  runnerStandInImageFor,
  startCanary,
  startGatewayStandIn,
} from "../scripts/isolation-harness.js";

// Package 0.6a. The unit tests call the probe's functions only. Those that make an attempt make it only
// against made-up servers the test itself starts on the loopback address (127.0.0.1 and "localhost"):
// nothing beyond this machine's loopback address is contacted from here.
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
    expect(classifyError("EPROTO")).toBe("secure connection failed");
    expect(classifyError("ERR_SSL_WRONG_VERSION_NUMBER")).toBe("secure connection failed");
    expect(classifyError("HPE_INVALID_CONSTANT")).toBe("not an HTTP answer");
    expect(classifyError("SOMETHING_ELSE")).toBe("error");
    expect(classifyError("ENOTFOUND", "lookup")).toBe("name not found");
    expect(classifyError("EAI_AGAIN", "lookup")).toBe("no name server answered");
    expect(classifyError("ECONNREFUSED", "lookup")).toBe("no name server answered");
    expect(classifyError("EREFUSED", "lookup")).toBe("lookup refused by the name server");
    const codes = ["ECONNREFUSED", "ETIMEDOUT", "TIMEOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "ECONNRESET", "SELF_SIGNED_CERT_IN_CHAIN", "EPROTO", "ERR_SSL_X", "HPE_X", "EREFUSED", "X"];
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

  it("lists UDP sockets with no remote end and abstract Unix sockets (made-up samples in the kernel's format)", () => {
    const udp = [
      "   sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops",
      "  101: 00000000:0044 00000000:0000 07 00000000:00000000 00:00000000 00000000     0        0 11 2 0000000000000000 0",
      "  102: 0100007F:0035 00000000:0000 07 00000000:00000000 00:00000000 00000000     0        0 12 2 0000000000000000 0",
      "  103: 020200C0:A1B2 08080808:0035 01 00000000:00000000 00:00000000 00000000     0        0 13 2 0000000000000000 0",
    ].join("\n");
    expect(parseUdpBound(udp)).toEqual([
      { address: "0.0.0.0", port: 68 },
      { address: "127.0.0.1", port: 53 },
    ]);
    const unix = [
      "Num       RefCount Protocol Flags    Type St Inode Path",
      "0000000000000000: 00000002 00000000 00010000 0001 01 21 @/made-up/shim.sock",
      "0000000000000000: 00000002 00000000 00010000 0001 01 22 /run/made-up.sock",
      "0000000000000000: 00000003 00000000 00000000 0001 03 23",
      "0000000000000000: 00000002 00000000 00010000 0001 01 24 @/made-up/shim.sock",
    ].join("\n");
    expect(parseAbstractUnix(unix)).toEqual(["@/made-up/shim.sock"]);
    expect(parseUdpBound("")).toEqual([]);
    expect(parseAbstractUnix("")).toEqual([]);
  });

  it("lists every network interface in a /sys/class/net folder, up or down, with its state (made-up folder)", () => {
    const dir = mkdtempSync(join(tmpdir(), "builder-isolation-net-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    for (const [name, state] of [["lo", "unknown"], ["eth0", "up"], ["docker0", "down"], ["made-up0", null]] as const) {
      mkdirSync(join(dir, name));
      if (state) writeFileSync(join(dir, name, "operstate"), `${state}\n`);
    }
    expect(listInterfaces(dir)).toBe("docker0 (down), eth0 (up), lo (unknown), made-up0 (state not given)");
    const empty = join(dir, "docker0", "empty");
    mkdirSync(empty);
    expect(listInterfaces(empty)).toBe("none");
    expect(listInterfaces(join(dir, "not-there"))).toBe("could not be read (ENOENT)");
  });

  it("plans every attempt once, aims host attempts at the loopback address, and tries the session proxy only when given", () => {
    const withProxy = planAttempts(parseSettings(JSON.stringify(SETTINGS)), [{ address: "0.0.0.0", port: 2024 }]);
    const ids = withProxy.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of ["A", "B", "C", "D", "E", "F"]) expect(ids.some((i) => i.startsWith(g))).toBe(true);
    expect(ids).toContain("C9");
    expect(withProxy.find((a) => a.id === "X2024")?.target).toBe("127.0.0.1:2024");
    // With no gateway given, there is no G attempt.
    expect(ids.some((i) => i.startsWith("G"))).toBe(false);
    for (const a of withProxy.filter((x) => x.toward === "host")) expect(a.target).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(withProxy.find((a) => a.id === "C7")?.target).toBe("127.0.0.1:5560");
    // Without a session proxy: no attempt toward it, and nothing else changes.
    const without = planAttempts(parseSettings(JSON.stringify({ ...SETTINGS, sessionProxy: null })));
    expect(without.some((a) => a.id === "C9" || a.id.startsWith("F") || a.toward === "session-proxy")).toBe(false);
    // One extra listener, C9, and F1 to F4 fewer.
    expect(without.length).toBe(withProxy.length - 1 - 1 - 4);
    // B2 and B3 name the address as example.com's only once the probe has looked it up itself.
    expect(withProxy.find((a) => a.id === "B2")?.what).toBe("the address given for example.com (not checked), HTTP port");
    const looked = planAttempts({ ...parseSettings(JSON.stringify(SETTINGS)), exampleAddress: "192.0.2.10", exampleAddressLookedUp: true });
    expect(looked.find((a) => a.id === "B3")?.what).toBe("example.com's address, plain HTTP");
    expect(looked.find((a) => a.id === "B3")?.target).toBe("192.0.2.10:80");
  });

  it("group G: one TCP attempt per port listening on the machine, at the gateway address of Docker's default network, with the address each port listens on as read on the machine", () => {
    const listeners = ["0.0.0.0:2024", "127.0.0.1:5432", "::1:5432", "127.0.0.1:45887"];
    const s = parseSettings(JSON.stringify({ ...SETTINGS, bridgeGateway: "172.17.0.1", machineListeners: listeners }));
    const g = planAttempts(s).filter((a) => a.id.startsWith("G"));
    expect(g.map((a) => [a.id, a.target, a.op])).toEqual([
      ["G2024", "172.17.0.1:2024", { type: "tcp", host: "172.17.0.1", port: 2024 }],
      ["G5432", "172.17.0.1:5432", { type: "tcp", host: "172.17.0.1", port: 5432 }],
      ["G45887", "172.17.0.1:45887", { type: "tcp", host: "172.17.0.1", port: 45887 }],
    ]);
    expect(g[0]?.what).toBe("port 2024, listening on the machine at 0.0.0.0 (every address), as read on the machine");
    expect(g[1]?.what).toBe("port 5432, listening on the machine at 127.0.0.1 (loopback only) and ::1 (loopback only), as read on the machine");
    for (const a of g) expect([a.group, a.toward, a.how]).toEqual(["Toward the machine through the container network's gateway", "host", "TCP connection, opened and closed; nothing sent"]);
    // Only an IPv4 gateway, and only "address:port" texts, are accepted.
    for (const bad of [{ bridgeGateway: "gateway.invalid" }, { bridgeGateway: "300.1.1.1" }, { machineListeners: ["2024"] }, { machineListeners: ["0.0.0.0:0"] }, { machineListeners: "0.0.0.0:2024" }])
      expect(() => parseSettings(JSON.stringify({ ...SETTINGS, ...bad })), JSON.stringify(bad)).toThrow(/bridgeGateway|machineListeners/);
  });
});

describe("isolation probe, package 0.6c additions (unit)", () => {
  const S06C = { ...SETTINGS, machineListeners: ["0.0.0.0:2024", "127.0.0.1:5432"], machineAddresses: ["192.0.2.2", "172.17.0.1"], egressHost: "egress", gatewayVia: "egress:4010", peers: ["db:5432", "app:3131"] };

  it("group M: every machine address crossed with every port listening on the machine; E through the egress host named; W1 at the door's gateway port; P by service name", () => {
    const plan = planAttempts(parseSettings(JSON.stringify(S06C)));
    expect(plan.filter((a) => a.id.startsWith("M")).map((a) => [a.id, a.op])).toEqual([
      ["M192.0.2.2:2024", { type: "tcp", host: "192.0.2.2", port: 2024 }],
      ["M192.0.2.2:5432", { type: "tcp", host: "192.0.2.2", port: 5432 }],
      ["M172.17.0.1:2024", { type: "tcp", host: "172.17.0.1", port: 2024 }],
      ["M172.17.0.1:5432", { type: "tcp", host: "172.17.0.1", port: 5432 }],
    ]);
    expect(plan.find((a) => a.id === "E1")?.op).toEqual({ type: "connect", proxy: { host: "egress", port: 3128 }, target: "registry.npmjs.org:443" });
    expect(plan.find((a) => a.id === "E1")?.how).toBe("CONNECT through egress:3128");
    expect(plan.find((a) => a.id === "W1")).toMatchObject({ toward: "gateway", target: "egress:4010", op: { type: "http", host: "egress", port: 4010, path: "/" } });
    expect(plan.filter((a) => a.id.startsWith("P")).map((a) => [a.id, a.toward, a.target])).toEqual([
      ["Pdb:5432", "project", "db:5432"],
      ["Papp:3131", "project", "app:3131"],
    ]);
    // Without the new settings nothing of M, W or P is planned, and E keeps 0.6a's 127.0.0.1.
    const old = planAttempts(parseSettings(JSON.stringify(SETTINGS)));
    expect(old.some((a) => /^[MWP]/.test(a.id))).toBe(false);
    expect(old.find((a) => a.id === "E1")?.how).toBe("CONNECT through 127.0.0.1:3128");
  });

  it("refuses malformed new settings", () => {
    for (const bad of [{ machineAddresses: ["not-an-address"] }, { machineAddresses: "192.0.2.2" }, { egressHost: "Egress!" }, { gatewayVia: "egress" }, { gatewayVia: "made-up-user@egress:4010" }, { peers: ["db"] }, { peers: ["db:0"] }])
      expect(() => parseSettings(JSON.stringify({ ...SETTINGS, ...bad })), JSON.stringify(bad)).toThrow(/machineAddresses|egressHost|gatewayVia|peers/);
  });

  it("reads routes and IPv6 state from the kernel's text (made-up samples in its format)", () => {
    const route = [
      "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT",
      "eth0\t00000000\t010013AC\t0003\t0\t0\t0\t00000000\t0\t0\t0",
      "eth0\t000013AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0",
    ].join("\n");
    expect(parseRoutes(route)).toEqual(["to 0.0.0.0/0 via 172.19.0.1 on eth0", "to 172.19.0.0/16 via 0.0.0.0 on eth0"]);
    expect(parseRoutes("")).toEqual([]);
    expect(ipv6State(null)).toBe("absent: this kernel has no IPv6 here");
    expect(ipv6State("")).toBe("present, with no address");
    expect(ipv6State("fe800000000000000000000000000001 02 40 20 80 eth0")).toBe("fe80:0000:0000:0000:0000:0000:0000:0001 on eth0");
    expect([ROUTES_INFO, DEFAULT_ROUTE_INFO, IPV6_INFO].every((n) => n.length > 0)).toBe(true);
  });

  it("reads the machine's addresses from the kernel's tables: loopback and IPv6 link-local left out, each once (made-up samples in their format)", () => {
    const fib = [
      "Main:",
      "  +-- 0.0.0.0/0 3 0 4",
      "     |-- 0.0.0.0",
      "        /0 universe UNICAST",
      "           |-- 127.0.0.1",
      "              /32 host LOCAL",
      "           |-- 172.17.0.0",
      "              /16 link UNICAST",
      "           |-- 172.17.0.1",
      "              /32 host LOCAL",
      "        |-- 172.17.255.255",
      "           /32 link BROADCAST",
      "           |-- 192.0.2.2",
      "              /32 host LOCAL",
      "Local:",
      "           |-- 192.0.2.2",
      "              /32 host LOCAL",
    ].join("\n");
    expect(machineAddressesFrom(fib, null)).toEqual(["172.17.0.1", "192.0.2.2"]);
    const v6 = ["20010db8000000000000000000000001 04 40 00 80 br-x", "fe800000000000000000000000000001 02 40 20 80 eth0", "00000000000000000000000000000001 01 80 10 80 lo"].join("\n");
    expect(machineAddressesFrom(fib, v6)).toEqual(["172.17.0.1", "192.0.2.2", "2001:db8::1"]);
  });

  it("orders ids by group, then naturally within a group", () => {
    const ids = ["P1", "M172.17.0.1:5432", "G45887", "M172.17.0.1:2024", "A1", "W1", "E2", "G2024", "X40000", "M192.0.2.2:2024"].map((id) => ({ id }));
    expect(ids.sort(compareIds).map((x) => x.id)).toEqual(["A1", "X40000", "G2024", "G45887", "M172.17.0.1:2024", "M172.17.0.1:5432", "M192.0.2.2:2024", "E2", "W1", "P1"]);
  });
});

describe("isolation harness: comparing a container's attempts with its expected list (unit, package 0.6c)", () => {
  const ctx = { appPort: 3131, gatewayServer: /server: gateway-stand-in/ };
  const end = (n: number) => JSON.stringify({ kind: "end", attempts: n });

  it("passes only when every listed answer came, from whom the list says, and nothing else answered", () => {
    const runner = parseProbeOutput([
      attempt({ id: "A2", result: "timed out", code: "TIMEOUT" }),
      attempt({ id: "M172.17.0.1:2024", toward: "host", result: "network unreachable", code: "ENETUNREACH" }),
      attempt({ id: "Papp:3131", toward: "project", result: "connected", code: null }),
      attempt({ id: "X41000", toward: "host", target: "127.0.0.11:41000", result: "connected", code: null }),
      end(4),
    ]);
    const ok = compareWithExpected(runner, expectedOnDevelopment("runner", ctx));
    expect(ok.pass).toBe(true);
    expect(ok.rows.map((r) => `${r.id} ${r.pass ? "PASS" : "FAIL"}`)).toEqual(["A2 PASS", "X41000 PASS", "M172.17.0.1:2024 PASS", "Papp:3131 PASS"]);
    // One answer the list does not allow fails the comparison: here, a machine address that connected.
    const leak = parseProbeOutput([attempt({ id: "M172.17.0.1:2024", toward: "host", result: "connected", code: null }), attempt({ id: "Papp:3131", toward: "project", result: "connected", code: null }), end(2)]);
    const c = compareWithExpected(leak, expectedOnDevelopment("runner", ctx));
    expect(c.pass).toBe(false);
    expect(c.rows.filter((r) => !r.pass).map((r) => r.id)).toEqual(["M172.17.0.1:2024"]);
    // A listed answer that did not come fails too, and so does one that was never tried.
    const silent = parseProbeOutput([attempt({ id: "Papp:3131", toward: "project", result: "name not found", code: "ENOTFOUND" }), end(1)]);
    expect(compareWithExpected(silent, expectedOnDevelopment("runner", ctx)).pass).toBe(false);
    const none = compareWithExpected(parseProbeOutput([end(0)]), expectedOnDevelopment("runner", ctx));
    expect(none.pass).toBe(false);
    expect(none.missing.length).toBeGreaterThan(0);
  });

  it("compares who answered, not only that something did: a 403 that is not the egress proxy's own refusal fails, and so does a gateway answer from another server", () => {
    const eng = (e3detail: string, w1detail: string) =>
      parseProbeOutput([
        attempt({ id: "E3", toward: "egress-proxy", result: "proxy answered 403", code: null, detail: e3detail }),
        attempt({ id: "W1", toward: "gateway", result: "HTTP 200", code: null, detail: w1detail }),
        end(2),
      ]);
    const rowsOf = (r: Comparison) => Object.fromEntries(r.rows.map((x) => [x.id, x.pass]));
    expect(rowsOf(compareWithExpected(eng('says: "egress refused: example.com is not an allowed host"', "server: gateway-stand-in"), expectedOnDevelopment("engine", ctx)))).toEqual({ E3: true, W1: true });
    expect(rowsOf(compareWithExpected(eng('says: "Forbidden by the session"', "server: something-else"), expectedOnDevelopment("engine", ctx)))).toEqual({ E3: false, W1: false });
  });

  it("an unnamed error, an unfinished run, or a stray line fails the comparison", () => {
    const err = parseProbeOutput([attempt({ id: "A1", result: "error", code: "WHATEVER" }), end(1)]);
    expect(compareWithExpected(err, []).pass).toBe(false);
    expect(compareWithExpected(parseProbeOutput([attempt({ id: "A1" })]), []).pass).toBe(false);
    expect(compareWithExpected(parseProbeOutput(["stray", attempt({ id: "A1" }), end(1)]), []).pass).toBe(false);
  });

  it("the positive controls must get their answers; the comparison containers' other attempts are not compared", () => {
    const machine = parseProbeOutput([
      attempt({ id: "M192.0.2.2:40001", toward: "host", result: "connected", code: null }),
      attempt({ id: "M172.17.0.1:40001", toward: "host", result: "connected", code: null }),
      attempt({ id: "A2", result: "HTTP 301", code: null }),
      end(3),
    ]);
    expect(compareWithExpected(machine, expectedPositiveControls("machine", { canaryPort: 40001, bridgeAddress: "172.17.0.1" }), false).pass).toBe(true);
    const blind = parseProbeOutput([attempt({ id: "M192.0.2.2:40001", toward: "host", result: "refused", code: "ECONNREFUSED" }), end(1)]);
    expect(compareWithExpected(blind, expectedPositiveControls("machine", { canaryPort: 40001, bridgeAddress: "172.17.0.1" }), false).pass).toBe(false);
    const bridge = parseProbeOutput([attempt({ id: "M172.17.0.1:40001", toward: "host", result: "connected", code: null }), end(1)]);
    expect(compareWithExpected(bridge, expectedPositiveControls("default-bridge", { canaryPort: 40001, bridgeAddress: "172.17.0.1" }), false).pass).toBe(true);
    // The address is matched exactly: 172.17.0.10 is not 172.17.0.1.
    const near = parseProbeOutput([attempt({ id: "M172.17.0.10:40001", toward: "host", result: "connected", code: null }), end(1)]);
    expect(compareWithExpected(near, expectedPositiveControls("default-bridge", { canaryPort: 40001, bridgeAddress: "172.17.0.1" }), false).pass).toBe(false);
  });
});

/** DER, the encoding of a certificate: a tag, a length, a body. Enough of it for one made-up certificate. */
const der = (tag: number, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const n = body.length;
  return Buffer.concat([Buffer.from([tag, ...(n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff])]), body]);
};
const derSeq = (...parts: Buffer[]) => der(0x30, ...parts);
const derOid = (dotted: string) => {
  const [a = 0, b = 0, ...rest] = dotted.split(".").map(Number);
  const out = [40 * a + b];
  for (let v of rest) {
    const enc = [v & 0x7f];
    while ((v >>= 7)) enc.unshift((v & 0x7f) | 0x80);
    out.push(...enc);
  }
  return der(0x06, Buffer.from(out));
};
const derTime = (d: Date) => der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z"));

/**
 * A made-up certificate for `host`, signed by itself, made with Node's own crypto for this test run only
 * (no file is kept, no package added). Its key never leaves the test.
 */
function madeUpCertificate(host: string): { cert: string; key: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const name = derSeq(der(0x31, derSeq(derOid("2.5.4.3"), der(0x0c, Buffer.from(host)))));
  const ecdsaSha256 = derSeq(derOid("1.2.840.10045.4.3.2"));
  const now = Date.now();
  const tbs = derSeq(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, Buffer.from([1])),
    ecdsaSha256,
    name,
    derSeq(derTime(new Date(now - 3_600_000)), derTime(new Date(now + 86_400_000))),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    der(0xa3, derSeq(derSeq(derOid("2.5.29.17"), der(0x04, derSeq(der(0x82, Buffer.from(host))))))),
  );
  const body = derSeq(tbs, ecdsaSha256, der(0x03, Buffer.concat([Buffer.from([0]), sign("sha256", tbs, privateKey)])));
  const cert = `-----BEGIN CERTIFICATE-----\n${(body.toString("base64").match(/.{1,64}/g) ?? []).join("\n")}\n-----END CERTIFICATE-----\n`;
  return { cert, key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}

/** Start a made-up server on the loopback address; it is closed, with every connection it holds, when the test ends. */
async function onLoopback(server: net.Server | Server, host = "127.0.0.1"): Promise<number> {
  const sockets = new Set<Socket>();
  server.on("connection", (c: Socket) => {
    sockets.add(c);
    c.on("close", () => sockets.delete(c));
  });
  await new Promise<void>((r) => server.listen(0, host, r));
  onTestFinished(async () => {
    for (const c of sockets) c.destroy();
    await new Promise((r) => server.close(r));
  });
  return (server.address() as AddressInfo).port;
}

/**
 * A made-up TLS server on the loopback address ("localhost") that completes the secure handshake and then never
 * sends a byte, with a file holding its made-up certificate, given to the probe as its certificate file (as a
 * copy of the session's certificate would be). `handshakes()` counts the handshakes it completed. The server
 * and the file are removed when the test ends.
 */
async function silentTlsServer(): Promise<{ port: number; certFile: string; handshakes: () => number }> {
  const dir = mkdtempSync(join(tmpdir(), "builder-isolation-cert-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const { cert, key } = madeUpCertificate("localhost");
  const certFile = join(dir, "made-up-ca.crt");
  writeFileSync(certFile, cert);
  let handshakes = 0;
  const server = tls.createServer({ cert, key }, (s) => {
    handshakes++;
    s.on("error", () => undefined);
  });
  return { port: await onLoopback(server, "localhost"), certFile, handshakes: () => handshakes };
}

const madeUpAttempt = (op: PlannedAttempt["op"]): PlannedAttempt => ({ id: "T1", group: "made-up", toward: "outside", what: "made-up", target: "made-up", how: "made-up", op });

describe("isolation probe: its attempts, against made-up servers on the loopback address (unit)", () => {
  it("sends the HTTPS request of a tunnel attempt inside the proxy's tunnel, never straight to the target (review finding 8)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "builder-isolation-cert-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const { cert, key } = madeUpCertificate("localhost");
    const certFile = join(dir, "made-up-ca.crt");
    writeFileSync(certFile, cert);
    const answering = (name: string) => https.createServer({ cert, key }, (_req, res) => res.writeHead(418, { server: name }).end(name));
    // Server A listens at the request's own target, host and port. Server B is reached only through the tunnel.
    const direct = answering("A-direct-to-the-target");
    let directConnections = 0;
    direct.on("connection", () => directConnections++);
    const directPort = await onLoopback(direct, "localhost");
    const insidePort = await onLoopback(answering("B-inside-the-tunnel"));
    // A made-up proxy: it answers 200 to any CONNECT and joins the tunnel to server B, whatever the target.
    const connects: string[] = [];
    const proxyPort = await onLoopback(
      net.createServer((c) => {
        c.on("error", () => undefined);
        c.once("data", (d: Buffer) => {
          connects.push(d.toString("latin1").split("\r\n")[0] ?? "");
          const up = net.connect(insidePort, "127.0.0.1", () => {
            c.write("HTTP/1.1 200 Connection established\r\n\r\n");
            c.pipe(up).pipe(c);
          });
          up.on("error", () => c.destroy());
          c.on("close", () => up.destroy());
        });
      }),
    );
    const s = parseSettings(JSON.stringify({ ...SETTINGS, sessionProxy: null, timeoutMs: 3000 }));
    const r = await runAttempt(madeUpAttempt({ type: "https-tunnel", proxy: { host: "127.0.0.1", port: proxyPort }, host: "localhost", port: directPort, path: "/" }), s, certFile);
    // All at once, so that a failure shows every part: what the proxy was asked, who answered, and whether A was reached.
    expect({ connects, result: r.result, answeredBy: /server: ([^;]+)/.exec(r.detail)?.[1] ?? r.detail, directConnections }).toEqual({
      connects: [`CONNECT localhost:${directPort} HTTP/1.1`],
      result: "HTTP 418",
      answeredBy: "B-inside-the-tunnel",
      directConnections: 0,
    });
  });

  it("an HTTP answer whose body is held open is still that HTTP status, settled once the headers came (review finding 10)", async () => {
    // A made-up server that sends a 200 status, its headers and one byte, then holds the body open.
    const port = await onLoopback(
      http.createServer((_req, res) => {
        res.writeHead(200, { server: "made-up-slow-body" });
        res.write("x");
      }),
    );
    const op = { type: "http" as const, host: "127.0.0.1", port, path: "/" };
    // The limit is longer than the brief read of the body: the body's read ends first.
    const t0 = Date.now();
    const brief = await runAttempt(madeUpAttempt(op), parseSettings(JSON.stringify({ ...SETTINGS, timeoutMs: 4000 })), null);
    expect({ result: brief.result, detail: brief.detail }).toEqual({ result: "HTTP 200", detail: `server: made-up-slow-body; the body did not finish within ${BODY_READ_MS} ms of the answer` });
    expect(Date.now() - t0).toBeLessThan(3500);
    // The limit is shorter than the brief read: the limit ends it, and the result is still the status.
    const limited = await runAttempt(madeUpAttempt(op), parseSettings(JSON.stringify({ ...SETTINGS, timeoutMs: 300 })), null);
    expect({ result: limited.result, detail: limited.detail }).toEqual({ result: "HTTP 200", detail: "server: made-up-slow-body; the body did not finish within the time limit (300 ms)" });
    // A body that finishes is read whole, as before.
    const whole = await onLoopback(http.createServer((_req, res) => res.writeHead(403, { server: "made-up" }).end("made-up refusal")));
    expect(await runAttempt(madeUpAttempt({ ...op, port: whole }), parseSettings(JSON.stringify(SETTINGS)), null)).toEqual({ result: "HTTP 403", code: null, detail: 'server: made-up; says: "made-up refusal"' });
  });

  it("a proxy that closes the connection without answering a CONNECT has its own result, at once, not 'timed out'", async () => {
    // A made-up proxy that reads the CONNECT and closes the connection without a word.
    const port = await onLoopback(net.createServer((c) => c.once("data", () => c.end())));
    const s = parseSettings(JSON.stringify({ ...SETTINGS, timeoutMs: 3000 }));
    const t0 = Date.now();
    const r = await runAttempt(madeUpAttempt({ type: "connect", proxy: { host: "127.0.0.1", port }, target: "made-up.invalid:443" }), s, null);
    expect(r).toEqual({ result: "proxy closed without an answer", code: "PROXY_CLOSED", detail: "" });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.result).toMatch(RESULT);
  });

  // Review of 0.6a, second round: an attempt whose connection opened and then heard nothing until the limit
  // was "timed out", counted as no answer. The words are written out here, not taken from the probe.
  const OPENED_THEN_SILENT = "connected, then no answer within the limit";

  it("a server that accepts the connection and never answers: 'connected, then no answer within the limit', counted as an answer, not 'timed out'; over HTTPS, the detail says whether the secure handshake finished", async () => {
    // A made-up server that accepts every connection and never sends a byte. It listens at "localhost", so
    // that the HTTPS attempt can name its server as a name, not an address.
    const host = "localhost";
    const port = await onLoopback(net.createServer(() => undefined), host);
    const s = parseSettings(JSON.stringify({ ...SETTINGS, timeoutMs: 300 }));
    const seen: Record<string, unknown> = {};
    for (const [name, op] of [
      ["http", { type: "http", host, port, path: "/" }],
      ["https", { type: "https", host, port, path: "/" }],
      ["http-proxy", { type: "http-proxy", proxy: { host, port }, url: "http://made-up.invalid/" }],
      ["connect", { type: "connect", proxy: { host, port }, target: "made-up.invalid:443" }],
    ] as const) {
      const r = await runAttempt(madeUpAttempt(op), s, null);
      seen[name] = { ...r, counted: gotAnswer(r.result) };
    }
    // HTTPS to a made-up TLS server that completes the secure handshake and then never answers (third review of
    // 0.6a): the detail says that the secure connection opened. Its limit is longer, so that the handshake has time.
    const silent = await silentTlsServer();
    const r = await runAttempt(madeUpAttempt({ type: "https", host, port: silent.port, path: "/" }), parseSettings(JSON.stringify({ ...SETTINGS, timeoutMs: 1000 })), silent.certFile);
    seen["https, the handshake finished"] = { ...r, counted: gotAnswer(r.result), handshakes: silent.handshakes() };
    const opened = (detail: string, ms = 300) => ({ result: OPENED_THEN_SILENT, code: "TIMEOUT_AFTER_CONNECT", detail: `${detail} within the time limit (${ms} ms)`, counted: true });
    expect(seen).toEqual({
      http: opened("the connection opened; no HTTP status came"),
      https: opened("the connection opened; the secure handshake did not finish"),
      "http-proxy": opened("the connection to the proxy opened; no HTTP status came"),
      connect: opened("the connection to the proxy opened; it did not answer the CONNECT"),
      "https, the handshake finished": { ...opened("the secure connection opened; no HTTP status came", 1000), handshakes: 1 },
    });
    expect(OPENED_THEN_SILENT).toMatch(RESULT);
  });

  it("a proxy that answers 200 to a CONNECT and then says nothing: the tunnel attempt is 'connected, then no answer within the limit', with the proxy's 200 in its detail, and, where the secure connection inside the tunnel opened, that too", async () => {
    // A made-up proxy: it reads the CONNECT, answers 200, and then sends nothing more.
    const connects: string[] = [];
    const port = await onLoopback(
      net.createServer((c) =>
        c.once("data", (d: Buffer) => {
          connects.push(d.toString("latin1").split("\r\n")[0] ?? "");
          c.write("HTTP/1.1 200 Connection established\r\n\r\n");
        }),
      ),
    );
    const s = parseSettings(JSON.stringify({ ...SETTINGS, timeoutMs: 300 }));
    const r = await runAttempt(madeUpAttempt({ type: "https-tunnel", proxy: { host: "127.0.0.1", port }, host: "made-up.invalid", port: 443, path: "/" }), s, null);
    expect({ connects, ...r, counted: gotAnswer(r.result) }).toEqual({
      connects: ["CONNECT made-up.invalid:443 HTTP/1.1"],
      result: OPENED_THEN_SILENT,
      code: "TIMEOUT_AFTER_CONNECT",
      detail: "the proxy answered 200 to the CONNECT; nothing came back inside the tunnel within the time limit (300 ms)",
      counted: true,
    });
    // A made-up proxy that answers 200 and joins its tunnel to a made-up TLS server that completes the secure
    // handshake and then never answers (third review of 0.6a): the detail says that the secure connection inside
    // the tunnel opened. Its limit is longer, so that the handshake has time.
    const silent = await silentTlsServer();
    const joined: string[] = [];
    const joining = await onLoopback(
      net.createServer((c) => {
        c.on("error", () => undefined);
        c.once("data", (d: Buffer) => {
          joined.push(d.toString("latin1").split("\r\n")[0] ?? "");
          const up = net.connect(silent.port, "localhost", () => {
            c.write("HTTP/1.1 200 Connection established\r\n\r\n");
            c.pipe(up).pipe(c);
          });
          up.on("error", () => c.destroy());
          c.on("close", () => up.destroy());
        });
      }),
    );
    const inside = await runAttempt(
      madeUpAttempt({ type: "https-tunnel", proxy: { host: "127.0.0.1", port: joining }, host: "localhost", port: 443, path: "/" }),
      parseSettings(JSON.stringify({ ...SETTINGS, timeoutMs: 1000 })),
      silent.certFile,
    );
    expect({ connects: joined, ...inside, counted: gotAnswer(inside.result), handshakes: silent.handshakes() }).toEqual({
      connects: ["CONNECT localhost:443 HTTP/1.1"],
      result: OPENED_THEN_SILENT,
      code: "TIMEOUT_AFTER_CONNECT",
      detail: "the proxy answered 200 to the CONNECT and the secure connection inside the tunnel opened; no HTTP status came within the time limit (1000 ms)",
      counted: true,
      handshakes: 1,
    });
  });
});

describe("isolation probe: reading what it prints (unit)", () => {
  it(`the harness passes the machine's listening sockets to the probe, and refuses plainly when there are more than the probe takes (${MAX_MACHINE_LISTENERS})`, () => {
    // Made-up /proc/net/tcp text in the kernel's format: n listening sockets on 127.0.0.1, ports 10000 and up.
    const tcp = (n: number) =>
      ["  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode"]
        .concat(Array.from({ length: n }, (_, i) => `   ${i}: 0100007F:${(10000 + i).toString(16).toUpperCase()} 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 ${i} 1 0 100 0 0 10 0`))
        .join("\n");
    const most = machineListenersFrom(tcp(MAX_MACHINE_LISTENERS), "");
    expect(most.length).toBe(MAX_MACHINE_LISTENERS);
    // As many as that is what the probe takes; one more it refuses.
    expect(parseSettings(JSON.stringify({ ...SETTINGS, bridgeGateway: "172.17.0.1", machineListeners: most })).machineListeners.length).toBe(MAX_MACHINE_LISTENERS);
    expect(() => parseSettings(JSON.stringify({ ...SETTINGS, bridgeGateway: "172.17.0.1", machineListeners: [...most, "127.0.0.1:9999"] }))).toThrow(/at most 64/);
    // The same socket listed twice counts once.
    expect(machineListenersFrom(`${tcp(2)}\n${tcp(2).split("\n").slice(1).join("\n")}`, "")).toEqual(["127.0.0.1:10000", "127.0.0.1:10001"]);
    // One more than the probe takes: the harness refuses, saying how many there are and how many would be left out.
    expect(() => machineListenersFrom(tcp(MAX_MACHINE_LISTENERS + 1), "")).toThrow(
      "The machine has 65 listening TCP sockets; the isolation probe takes at most 64 for group G. The check stops here rather than leave 1 of them out without saying so.",
    );
  });

  it("reads a complete run, and counts which attempts got an answer", () => {
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

  it(`an answer (${ANSWER_WORDING}) is told apart from a failure; every result given only after a connection opened is an answer (review finding 11)`, () => {
    // Given only once a connection opened: nothing more came before the limit, a TLS server sent a certificate,
    // a connection was reset, a proxy closed or sent something that is not HTTP.
    const afterAConnection = ["connected, then no answer within the limit", "certificate not trusted", "secure connection failed", "connection reset", "proxy closed without an answer", "not an HTTP answer"];
    for (const r of ["connected", "HTTP 403", "proxy answered 200", "found 1 address", "found 12 addresses", ...afterAConnection]) expect(gotAnswer(r), r).toBe(true);
    // "Timed out" is given only when no connection opened. A word the probe does not give is not counted either.
    for (const r of ["refused", "timed out", "name not found", "no name server answered", "lookup refused by the name server", "network unreachable", "error", "connected maybe", "HTTP 2000"])
      expect(gotAnswer(r), r).toBe(false);
    // Every word either way is one the report accepts.
    for (const r of afterAConnection) expect(r).toMatch(RESULT);
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
    // In a column whose loopback address is the container's own, every attempt aimed at 127.0.0.1, as its
    // target or as the proxy it goes through, says so; G rows come after the X rows.
    const own = parseProbeOutput([
      attempt({ id: "C5", toward: "host", target: "127.0.0.1:5432" }),
      attempt({ id: "E1", toward: "egress-proxy", target: "registry.npmjs.org:443", how: "CONNECT through 127.0.0.1:3128" }),
      attempt({ id: "F1", toward: "session-proxy", target: "registry.npmjs.org:443", how: "CONNECT through the cloud session's proxy (127.0.0.1:3999)" }),
      attempt({ id: "G2024", toward: "host", target: "172.17.0.1:2024", result: "connected", code: null }),
      attempt({ id: "X2024", toward: "host", target: "127.0.0.1:2024" }),
      attempt({ id: "A1", target: "1.1.1.127:443" }),
      JSON.stringify({ kind: "end", attempts: 6 }),
    ]);
    const column = { label: "own", report: own, ownLoopback: true };
    expect(own.attempts.map((a) => `${a.id}: ${columnCell(column, a)}`)).toEqual([
      "C5: refused (ECONNREFUSED), at its own loopback address",
      "E1: refused (ECONNREFUSED), at its own loopback address",
      "F1: refused (ECONNREFUSED), at its own loopback address",
      "G2024: connected",
      "X2024: refused (ECONNREFUSED), at its own loopback address",
      "A1: refused (ECONNREFUSED)",
    ]);
    expect(columnCell({ ...column, ownLoopback: false }, own.attempts[0])).toBe("refused (ECONNREFUSED)");
    expect(renderTable([column]).split("\n").slice(2).map((l) => l.split(" ")[0])).toEqual(["A1", "C5", "X2024", "G2024", "E1", "F1"]);
  });

  it("marks attempts aimed at the container's own loopback address however the session proxy is written: 127.0.0.1, localhost or [::1]", () => {
    const marked = (sessionProxy: string) => {
      const plan = planAttempts(parseSettings(JSON.stringify({ ...SETTINGS, sessionProxy })));
      const column = { label: "own", report: parseProbeOutput([]), ownLoopback: true };
      return plan
        .filter((a) => a.id === "C9" || a.id === "F1")
        .map((a) => `${a.id} ${a.target} [${a.how}]: ${columnCell(column, { ...a, result: "refused", code: "ECONNREFUSED", detail: "" })}`);
    };
    expect(marked("127.0.0.1:3999")).toEqual([
      "C9 127.0.0.1:3999 [TCP connection, opened and closed]: refused (ECONNREFUSED), at its own loopback address",
      "F1 registry.npmjs.org:443 [CONNECT through the cloud session's proxy (127.0.0.1:3999)]: refused (ECONNREFUSED), at its own loopback address",
    ]);
    expect(marked("localhost:3999")).toEqual([
      "C9 localhost:3999 [TCP connection, opened and closed]: refused (ECONNREFUSED), at its own loopback address",
      "F1 registry.npmjs.org:443 [CONNECT through the cloud session's proxy (localhost:3999)]: refused (ECONNREFUSED), at its own loopback address",
    ]);
    // An IPv6 address is written in brackets before its port.
    expect(marked("[::1]:3999")).toEqual([
      "C9 [::1]:3999 [TCP connection, opened and closed]: refused (ECONNREFUSED), at its own loopback address",
      "F1 registry.npmjs.org:443 [CONNECT through the cloud session's proxy ([::1]:3999)]: refused (ECONNREFUSED), at its own loopback address",
    ]);
    // A name that only starts like "localhost", or an address that only ends in 127, is not marked.
    expect(marked("localhost.example:3999").map((l) => l.endsWith("at its own loopback address"))).toEqual([false, false]);
    expect(marked("10.0.0.127:3999").map((l) => l.endsWith("at its own loopback address"))).toEqual([false, false]);
  });

  it("when containers give an attempt different targets (B2 and B3 can), the row says so and each cell gives its own target and description", () => {
    // Made-up addresses from the documentation ranges: one container looked example.com up, the other used the address given.
    const lookedUp = parseProbeOutput([
      attempt({ id: "B2", target: "192.0.2.10:80", what: "example.com's address, HTTP port", result: "connected", code: null }),
      attempt({ id: "B1", target: "198.51.100.1:443", what: "a public address, HTTPS port", result: "connected", code: null }),
      JSON.stringify({ kind: "end", attempts: 2 }),
    ]);
    const given = parseProbeOutput([
      attempt({ id: "B2", target: "203.0.113.14:80", what: "the address given for example.com (not checked), HTTP port" }),
      attempt({ id: "B1", target: "198.51.100.1:443", what: "a public address, HTTPS port", result: "connected", code: null }),
      JSON.stringify({ kind: "end", attempts: 2 }),
    ]);
    const columns = [
      { label: "first", report: lookedUp },
      { label: "second", report: given },
    ];
    expect(renderMarkdownTable(columns).split("\n").slice(2)).toEqual([
      "| B1 | 198.51.100.1:443 | a public address, HTTPS port | connected | connected |",
      `| B2 | ${DIFFERS_BY_CONTAINER} | ${DIFFERS_BY_CONTAINER} | connected; this container: 192.0.2.10:80, example.com's address, HTTP port | refused (ECONNREFUSED); this container: 203.0.113.14:80, the address given for example.com (not checked), HTTP port |`,
    ]);
    expect(renderTable(columns).split("\n")[3]).toContain("refused (ECONNREFUSED); this container: 203.0.113.14:80");
  });
});

describe("isolation probe: live, the engine container (development profile)", () => {
  it("from inside the engine container, which has no network, every attempt fails, outside and on the host alike", async () => {
    // Made inside the test, so that nothing is left behind when the test is filtered out. The clean-up is
    // registered straight away, before anything can fail: it removes the project if it was made, then the folder.
    const dir = mkdtempSync(join(tmpdir(), "builder-isolation-live-"));
    let made: Sandbox | undefined;
    onTestFinished(async () => {
      if (made) await sandbox.destroy(made).catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    });
    mkdirSync(join(dir, "workspace", "certs"), { recursive: true });
    const sb = createSandbox(
      {
        projectId: "p_isolation_live",
        dir,
        profile: "development-cloud-session",
        allowHosts: ["registry.npmjs.org"],
        gatewayUrl: "http://127.0.0.1:4010",
        builderDir,
        hostProxy: { url: process.env.HTTPS_PROXY ?? "http://127.0.0.1:1" },
        engine: { workspace: join(dir, "workspace"), changeSets: join(builderDir, "scripted") },
      },
      "sample-only-password",
    );
    made = sb;
    // Group G as well: the machine's listening ports at the gateway address of Docker's default network.
    const machine = await readMachineSide(dockerEnv(sb));
    expect(machine.bridgeGateway).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(machine.machineListeners.length).toBeGreaterThan(0);
    const settings = JSON.stringify({ ...SETTINGS, sessionProxy: sessionProxyHostPort(process.env.HTTPS_PROXY), projectDbPort: 5563, timeoutMs: 3000, ...machine });
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
    // First, and all at once: every attempt that got an answer (a connection opened, an HTTP status, a
    // proxy's answer, or an address found; any result given only after a connection opened, "connected,
    // then no answer within the limit" among them). There must be none.
    expect(report.attempts.filter((a) => gotAnswer(a.result)).map((a) => `${a.id} ${a.target}: ${a.result}`)).toEqual([]);
    // Nor an attempt whose error the probe could not name: it is not counted as an answer, so it must not pass unseen.
    expect(report.attempts.filter((a) => a.result === "error").map((a) => `${a.id} ${a.target}: ${a.code}`)).toEqual([]);
    expect(report.attempts.filter((a) => a.toward === "outside").length).toBeGreaterThanOrEqual(13);
    // Nothing listens inside a container with no network, so the probe adds no attempt of its own.
    expect(report.attempts.map((a) => a.id)).toEqual(planAttempts(parseSettings(settings)).map((a) => a.id));
    expect(report.attempts.filter((a) => a.id.startsWith("G")).length).toBeGreaterThan(0);
    expect(report.info.find((i) => i.name === INTERFACES_UP)?.value).toMatch(/^lo \([^;]*\)$/);
    // Every interface the kernel lists inside, up or down: only the loopback interface.
    expect(report.info.find((i) => i.name === INTERFACES_ALL)?.value).toMatch(/^lo \([^,]*\)$/);
    expect(report.info.find((i) => i.name === "a copy of the session certificate inside")?.value).toBe("none");
    const left = await run("docker", ["ps", "-a", "--filter", `name=${sb.projectName}-isolation-engine`, "--format", "{{.Names}}"], { env: dockerEnv(sb) });
    expect(left.stdout.trim()).toBe("");
  }, 180_000);
});

/**
 * Package 0.6c, live: every project container on the development profile, each compared exactly with its
 * expected list (design note 2.5, amendment of 13 Nov 2026), with the positive controls and both deliberate
 * misconfigurations. Stand-in images for the app, tools and runner (scripts/isolation-harness.ts): the
 * networks come from the Compose file, which is the sandbox manager's, unchanged. The egress proxy goes out
 * through this session's proxy, so E2 needs the registry to answer through it.
 */
describe("isolation: live, every project container on the development profile, compared with its expected list (package 0.6c)", () => {
  const APP_PORT = 3161;
  const made: Array<{ sb: Sandbox; dir: string; images: string[] }> = [];
  let gateway: Awaited<ReturnType<typeof startGatewayStandIn>> | undefined;
  let canary: Awaited<ReturnType<typeof startCanary>> | undefined;
  let main: Sandbox | undefined;
  const ctx = () => ({ appPort: APP_PORT, gatewayServer: new RegExp(`server: ${GATEWAY_STAND_IN}`) });

  /**
   * A sandbox on the development profile with the three stand-in images, and the engine as package 2.2 would
   * place it. A deliberate misconfiguration changes the sandbox manager's Compose file before anything starts.
   */
  async function makeProject(projectId: string, mutate?: (doc: Record<string, unknown>) => void): Promise<Sandbox> {
    const dir = mkdtempSync(join(tmpdir(), "builder-iso06c-"));
    const workspace = join(dir, "workspace");
    mkdirSync(workspace, { recursive: true });
    const spec: SandboxSpec = {
      projectId,
      dir,
      profile: "development-cloud-session",
      allowHosts: ["registry.npmjs.org"],
      gatewayUrl: `http://127.0.0.1:${gateway!.port}`,
      builderDir,
      hostProxy: { url: process.env.HTTPS_PROXY ?? "http://127.0.0.1:1" },
      buildProxyPort: await freePort(),
      app: { buildContext: workspace, port: APP_PORT, env: { APP_URL: `http://app:${APP_PORT}` } },
      engine: { workspace, changeSets: join(builderDir, "scripted"), network: "egress" },
      acceptance: { image: runnerStandInImageFor(projectId), baseUrl: `http://app:${APP_PORT}` },
    };
    const sb = createSandbox(spec, "sample-only-password", { AUTH_SECRET: "made-up-secret", APP_SAMPLE_PASSWORD: "made-up-sample" });
    expect(runnerStandInImage(sb)).toBe(spec.acceptance!.image);
    if (mutate) {
      const doc = composeDocument(spec, socketOwner());
      mutate(doc);
      writeFileSync(sb.composeFile, toYaml(doc));
    }
    made.push({ sb, dir, images: buildStandIns(sb, projectId) });
    return sb;
  }

  const report = (lines: string[]) => parseProbeOutput(lines);
  const failing = (c: Comparison) => c.rows.filter((r) => !r.pass).map((r) => `${r.id} ${r.target}: expected ${r.expected}; got ${r.actual}`);

  afterAll(async () => {
    for (const m of made) {
      await sandbox.destroy(m.sb).catch(() => undefined);
      // A probe container left by a failed run goes before its image.
      const left = await run("docker", ["ps", "-aq", "--filter", `name=${m.sb.projectName}-`], { env: dockerEnv(m.sb) }).catch(() => ({ stdout: "" }));
      for (const id of left.stdout.split("\n").filter(Boolean)) await run("docker", ["rm", "-f", id], { env: dockerEnv(m.sb) }).catch(() => undefined);
      await removeImages(m.sb, m.images);
      rmSync(m.dir, { recursive: true, force: true });
    }
    await gateway?.close();
    await canary?.close();
  });

  it("each project container (app, tools, db, runner, the door, and the engine as package 2.2 would place it) reaches exactly what its list allows", async () => {
    gateway = await startGatewayStandIn();
    canary = await startCanary();
    main = await makeProject("p_iso06c_live");
    await sandbox.up(main, ["app", "egress"]);
    const { settings, machineAddresses } = await devProbeSettings(main, { appPort: APP_PORT, gatewayPort: gateway.port });
    expect(machineAddresses.length).toBeGreaterThan(0);
    const columns: Array<[string, "app" | "tools" | "db" | "runner" | "engine" | "egress", () => Promise<string[]>]> = [
      ["app", "app", () => probeService(main!, "app", "app", settings)],
      ["tools", "tools", () => probeService(main!, "tools", "tools", settings)],
      ["db", "db", () => probeInNetworkOf(main!, "db", "db", settings)],
      ["runner", "runner", () => probeService(main!, "acceptance", "runner", settings)],
      ["engine", "engine", () => probeService(main!, "engine", "engine", settings)],
      ["egress", "egress", () => probeService(main!, "egress", "door", settings)],
    ];
    const results: Record<string, string[]> = {};
    for (const [label, kind, go] of columns) {
      const r = report(await go());
      expect(r.problems, label).toEqual([]);
      const c = compareWithExpected(r, expectedOnDevelopment(kind, ctx()));
      results[label] = [...failing(c), ...c.missing.map((m) => `not tried: ${m}`)];
      // Every machine address was tried on every port, and none answered (also covered by the comparison).
      expect(r.attempts.filter((a) => a.id.startsWith("M")).length, label).toBe(machineAddresses.length * new Set(JSON.parse(settings).machineListeners.map((l: string) => l.split(":").pop())).size);
      expect(r.info.find((i) => i.name === DEFAULT_ROUTE_INFO)?.value, label).toBe("no");
    }
    // All at once, so that a failure shows every container's differences.
    expect(results).toEqual({ app: [], tools: [], db: [], runner: [], engine: [], egress: [] });
  }, 900_000);

  it("the builder's check that the right app answers (package 3.1) asks from a container on `front`: it gets the app; the machine itself cannot even look the app's name up", async () => {
    expect(await appAnswers(main!, `http://app:${APP_PORT}`)).toBe(true);
    expect(await sandbox.askApp(main!, `http://app:${APP_PORT}/en/sign-in`)).toEqual({ status: 200 });
    // From this machine's own process, the app's address leads nowhere.
    const fromMachine = await fetch(`http://app:${APP_PORT}/en/sign-in`, { signal: AbortSignal.timeout(5000) }).then(
      (r) => `HTTP ${r.status}`,
      (e: Error & { cause?: { code?: string } }) => e.cause?.code ?? e.name,
    );
    expect(fromMachine).toMatch(/ENOTFOUND|EAI_AGAIN|TimeoutError/);
  }, 120_000);

  it("the positive controls: from the machine's own network and from Docker's default network, the same settings reach the harness's listener (so the targets and ports are right)", async () => {
    const { settings } = await devProbeSettings(main!, { appPort: APP_PORT, gatewayPort: gateway!.port });
    const bridgeAddress = (await run("docker", ["network", "inspect", "bridge", "--format", "{{range .IPAM.Config}}{{.Gateway}}{{end}}"], { env: dockerEnv(main!) })).stdout.trim();
    const onMachine = report(await probeComparison(main!, "host", settings));
    const onBridge = report(await probeComparison(main!, "bridge", settings));
    const m = compareWithExpected(onMachine, expectedPositiveControls("machine", { canaryPort: canary!.port, bridgeAddress }), false);
    const b = compareWithExpected(onBridge, expectedPositiveControls("default-bridge", { canaryPort: canary!.port, bridgeAddress }), false);
    expect({ machine: [...failing(m), ...m.missing], bridge: [...failing(b), ...b.missing] }).toEqual({ machine: [], bridge: [] });
    // And each got more answers than any project container is allowed.
    expect(onMachine.attempts.filter((a) => gotAnswer(a.result)).length).toBeGreaterThan(5);
    expect(onBridge.attempts.filter((a) => gotAnswer(a.result)).length).toBeGreaterThan(1);
  }, 600_000);

  it("deliberate misconfiguration 1: the app given a way out (also on an ordinary bridge) fails the app's comparison", async () => {
    const sb = await makeProject("p_iso06c_mis1", (doc) => {
      (doc.networks as Record<string, unknown>).ext = { enable_ipv6: false };
      (doc.services as Record<string, { networks?: string[] }>).app!.networks = ["data", "front", "ext"];
    });
    await sandbox.up(sb, ["db"]);
    const { settings } = await devProbeSettings(sb, { appPort: APP_PORT, gatewayPort: gateway!.port });
    const c = compareWithExpected(report(await probeService(sb, "app", "app-misconfigured", settings)), expectedOnDevelopment("app", ctx()));
    expect(c.pass).toBe(false);
    // What gave it away: answers from outside, or from the machine at its new bridge's address.
    expect(c.rows.filter((r) => !r.pass && /^(A|B|D1|D5|M)/.test(r.id)).length).toBeGreaterThan(0);
  }, 600_000);

  it("deliberate misconfiguration 2: the data network made internal without the isolated gateway mode fails the comparison (the machine is reached at that network's address)", async () => {
    const sb = await makeProject("p_iso06c_mis2", (doc) => {
      (doc.networks as Record<string, unknown>).data = { internal: true, enable_ipv6: false };
    });
    await sandbox.up(sb, ["db"]);
    // Read after the network exists: its address on the machine appears only then.
    const { settings, machineAddresses } = await devProbeSettings(sb, { appPort: APP_PORT, gatewayPort: gateway!.port });
    const c = compareWithExpected(report(await probeService(sb, "tools", "tools-misconfigured", settings)), expectedOnDevelopment("tools", ctx()));
    expect(c.pass).toBe(false);
    const leaked = c.rows.filter((r) => !r.pass);
    expect(leaked.some((r) => r.id.startsWith("M") && r.id.endsWith(`:${canary!.port}`)), JSON.stringify({ leaked, machineAddresses })).toBe(true);
  }, 600_000);

  it("everything made is removed", async () => {
    const left: string[] = [];
    for (const m of made) {
      await sandbox.destroy(m.sb);
      await removeImages(m.sb, m.images);
      left.push(await leftOf(m.sb));
    }
    for (const l of left) expect(l).toBe("containers: none; named containers: none; networks: none; volumes: none; images: none");
    expect(APP_STAND_IN).toBe("app-stand-in");
  }, 300_000);
});
