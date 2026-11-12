import { execFile } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http, { type Server } from "node:http";
import https from "node:https";
import type { AddressInfo, Socket } from "node:net";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, onTestFinished } from "vitest";
import { BODY_READ_MS, classifyError, countOtherSockets, INTERFACES_ALL, INTERFACES_UP, listInterfaces, parseAbstractUnix, parseListeners, parseSettings, parseUdpBound, planAttempts, runAttempt, type PlannedAttempt } from "../scripts/isolation-probe.mjs";
import { ANSWER_WORDING, cell, columnCell, DIFFERS_BY_CONTAINER, gotAnswer, parseProbeOutput, readMachineSide, RESULT, renderMarkdownTable, renderTable, sessionProxyHostPort, summarise, type ProbeAttempt } from "../src/sandbox/isolation.js";
import { createSandbox, dockerEnv, sandbox, type Sandbox } from "../src/sandbox/manager.js";

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

  it("a server that accepts the connection and never answers: 'connected, then no answer within the limit', counted as an answer, not 'timed out'", async () => {
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
    const opened = (detail: string) => ({ result: OPENED_THEN_SILENT, code: "TIMEOUT_AFTER_CONNECT", detail: `${detail} within the time limit (300 ms)`, counted: true });
    expect(seen).toEqual({
      http: opened("the connection opened; no HTTP status came"),
      https: opened("the connection opened; the secure handshake did not finish"),
      "http-proxy": opened("the connection to the proxy opened; no HTTP status came"),
      connect: opened("the connection to the proxy opened; it did not answer the CONNECT"),
    });
    expect(OPENED_THEN_SILENT).toMatch(RESULT);
  });

  it("a proxy that answers 200 to a CONNECT and then says nothing: the tunnel attempt is 'connected, then no answer within the limit', with the proxy's 200 in its detail", async () => {
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
  });
});

describe("isolation probe: reading what it prints (unit)", () => {
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
        hostProxy: { url: process.env.HTTPS_PROXY ?? "http://127.0.0.1:1", caBundlePath: "/root/.ccr/ca-bundle.crt" },
        devDbPort: 5563,
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
