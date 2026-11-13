// Package 0.6c, unit: the egress proxy's way out fails closed, and the door's forwarders. Nothing here leaves the
// machine's loopback address: every server is a made-up one this test starts on 127.0.0.1 or on a Unix socket in a
// temporary folder, and no Docker container is started.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createEgressProxy, parseUpstream, type EgressRecord } from "../src/sandbox/egress-proxy.js";
import { createForwarder, listenOnSocket, parseDoorRoutes, parseGatewayTarget, type ForwardRecord } from "../src/sandbox/forwarder.js";

const builderDir = resolve(import.meta.dirname, "..");

/** Start a server on 127.0.0.1 (or a socket path); it is closed, with every connection it holds, when the test ends. */
async function started(server: net.Server, where: string | 0 = 0): Promise<number> {
  const sockets = new Set<net.Socket>();
  server.on("connection", (c: net.Socket) => {
    sockets.add(c);
    c.on("close", () => sockets.delete(c));
  });
  if (typeof where === "string") await listenOnSocket(server, where);
  else await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  onTestFinished(async () => {
    for (const c of sockets) c.destroy();
    await new Promise((r) => server.close(r));
  });
  return typeof where === "string" ? 0 : (server.address() as AddressInfo).port;
}

/** Send a CONNECT to a proxy (TCP port or socket path) and give back the first line of its answer, or what happened. */
function connectThrough(proxy: number | string, target: string, limitMs = 5000): Promise<string> {
  return new Promise((resolve) => {
    const s = typeof proxy === "number" ? net.connect(proxy, "127.0.0.1") : net.connect({ path: proxy });
    let buf = "";
    const done = (v: string) => {
      clearTimeout(t);
      s.destroy();
      resolve(v);
    };
    const t = setTimeout(() => done("no answer within the limit"), limitMs);
    s.on("connect", () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    s.on("data", (d) => {
      buf += d.toString("latin1");
      if (buf.includes("\r\n")) done(buf.split("\r\n")[0]!);
    });
    s.on("close", () => done(buf ? buf.split("\r\n")[0]! : "closed with no answer"));
    s.on("error", (e: NodeJS.ErrnoException) => done(`error ${e.code}`));
  });
}

/** A short folder for sockets: a socket's path holds at most 107 bytes, and this session's temporary folder is long. */
const tmp = () => {
  const d = mkdtempSync("/tmp/m06c-door-");
  onTestFinished(() => rmSync(d, { recursive: true, force: true }));
  return d;
};

describe("the egress proxy's way out fails closed (package 0.6c)", () => {
  it("parseUpstream: an empty, missing, malformed or portless value is refused; 'direct' only where allowed; a user name or password is dropped", () => {
    for (const bad of [undefined, "", "   ", "not a url", "http://", "http://127.0.0.1", "https://127.0.0.1:3128", "socks5://127.0.0.1:1080"])
      expect(() => parseUpstream(bad, { allowDirect: true }), String(bad)).toThrow(/refuses to start|empty or missing/);
    expect(parseUpstream("direct", { allowDirect: true })).toBeNull();
    expect(() => parseUpstream("direct", { allowDirect: false })).toThrow(/does not allow/);
    // Made-up user name and password: only host and port are kept.
    expect(parseUpstream("http://made-up-user:made-up-pass@127.0.0.1:3999", { allowDirect: false })?.href).toBe("http://127.0.0.1:3999/");
  });

  it("createEgressProxy refuses an empty or 'direct' upstream given as text: no direct path by accident", () => {
    expect(() => createEgressProxy({ allow: [], upstreamProxy: "" })).toThrow(/empty or missing/);
    expect(() => createEgressProxy({ allow: [], upstreamProxy: "direct" })).toThrow(/does not allow/);
  });

  it("the machine side refuses to start without a valid upstream, saying why, exit code 2; the server profile's entry point refuses an empty one and accepts 'direct'", () => {
    const start = (entry: string, env: Record<string, string>, ms = 15_000) =>
      spawnSync("node", ["--import", "tsx", `src/sandbox/${entry}`], { cwd: builderDir, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/root", ...env }, timeout: ms, encoding: "utf8" });
    const machine = { EGRESS_ALLOW: "registry.npmjs.org", EGRESS_SOCKET: "/sock/egress.sock", GATEWAY_SOCKET: "/sock/gateway.sock", GATEWAY_TARGET: "127.0.0.1:4010" };
    for (const upstream of [undefined, "", "direct", "garbage", "http://127.0.0.1"]) {
      const r = start("egress-machine-main.ts", upstream === undefined ? machine : { ...machine, EGRESS_UPSTREAM_PROXY: upstream });
      expect({ status: r.status, said: /refusedToStart/.test(r.stdout) }, String(upstream)).toEqual({ status: 2, said: true });
    }
    // A gateway that is not on the loopback address is refused too.
    const gw = start("egress-machine-main.ts", { ...machine, EGRESS_UPSTREAM_PROXY: "http://127.0.0.1:3999", GATEWAY_TARGET: "10.0.0.5:4010" });
    expect({ status: gw.status, said: /loopback/.test(gw.stdout) }).toEqual({ status: 2, said: true });
    const server = start("egress-main.ts", { EGRESS_ALLOW: "registry.npmjs.org", EGRESS_PORT: "0" });
    expect({ status: server.status, said: /refusedToStart/.test(server.stdout) }).toEqual({ status: 2, said: true });
    // "direct" is accepted on the server profile's entry point: it starts and listens (stopped by the time limit).
    const direct = start("egress-main.ts", { EGRESS_ALLOW: "registry.npmjs.org", EGRESS_PORT: "0", EGRESS_UPSTREAM_PROXY: "direct" }, 4_000);
    expect(direct.stdout).toMatch(/"listening":0.*"upstream":"direct"/);
  });

  it("a tunnel request gets an answer of the proxy's own whatever the upstream does: 502 when it is closed, refuses, closes first or fails; 504 when it says nothing", async () => {
    const records: EgressRecord[] = [];
    const proxyFor = async (upstream: string, upstreamTimeoutMs = 1500) =>
      started(createEgressProxy({ allow: ["registry.npmjs.org"], upstreamProxy: upstream, upstreamTimeoutMs, log: (r) => records.push(r) }));
    // A port nothing listens on.
    const free = await started(net.createServer());
    const closedPort = free;
    // Upstreams: one that closes at once, one that never answers, one that refuses with 403.
    const closer = await started(net.createServer((c) => c.end()));
    const silent = await started(net.createServer(() => undefined));
    const refuser = await started(net.createServer((c) => c.once("data", () => c.end("HTTP/1.1 403 Forbidden\r\n\r\n"))));
    const deadProxy = await proxyFor(`http://127.0.0.1:${closedPort}`);
    // The listening port is closed after it was taken, so nothing answers there.
    await new Promise<void>((r) => net.createServer().listen(0, "127.0.0.1", function (this: net.Server) { this.close(() => r()); }));
    const seen = {
      closesAtOnce: await connectThrough(await proxyFor(`http://127.0.0.1:${closer}`), "registry.npmjs.org:443"),
      saysNothing: await connectThrough(await proxyFor(`http://127.0.0.1:${silent}`), "registry.npmjs.org:443"),
      refuses: await connectThrough(await proxyFor(`http://127.0.0.1:${refuser}`), "registry.npmjs.org:443"),
      notOnTheList: await connectThrough(deadProxy, "example.com:443"),
    };
    expect(seen).toEqual({
      closesAtOnce: "HTTP/1.1 502 Bad Gateway",
      saysNothing: "HTTP/1.1 504 Gateway Timeout",
      refuses: "HTTP/1.1 502 Bad Gateway",
      notOnTheList: "HTTP/1.1 403 Forbidden",
    });
    expect(records.filter((r) => r.decision === "error").map((r) => r.detail)).toEqual([
      "the upstream proxy closed the connection before it answered",
      "the upstream proxy did not answer within 1500 ms",
      "upstream answered: HTTP/1.1 403 Forbidden",
    ]);
  });

  it("an upstream that nothing listens on: 502 at once", async () => {
    const holder = net.createServer();
    await new Promise<void>((r) => holder.listen(0, "127.0.0.1", r));
    const port = (holder.address() as AddressInfo).port;
    await new Promise((r) => holder.close(r));
    const proxy = await started(createEgressProxy({ allow: ["registry.npmjs.org"], upstreamProxy: `http://127.0.0.1:${port}`, log: () => undefined }));
    const t0 = Date.now();
    expect(await connectThrough(proxy, "registry.npmjs.org:443")).toBe("HTTP/1.1 502 Bad Gateway");
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe("the door's forwarders (package 0.6c)", () => {
  it("the door's routes and the gateway's target are checked before anything listens", () => {
    expect(parseDoorRoutes("3128=/sock/egress.sock,4010=/sock/gateway.sock")).toEqual([
      { port: 3128, socket: "/sock/egress.sock" },
      { port: 4010, socket: "/sock/gateway.sock" },
    ]);
    for (const bad of [undefined, "", "3128", "3128=/tmp/x.sock", "3128=/sock/../etc.sock", "0=/sock/a.sock", "x=/sock/a.sock", "3128=sock/a.sock"])
      expect(() => parseDoorRoutes(bad), String(bad)).toThrow(/route|no routes/);
    expect(parseGatewayTarget("127.0.0.1:4010")).toEqual({ host: "127.0.0.1", port: 4010 });
    expect(parseGatewayTarget("localhost:4010")).toEqual({ host: "localhost", port: 4010 });
    expect(parseGatewayTarget("[::1]:4010")).toEqual({ host: "::1", port: 4010 });
    for (const bad of [undefined, "", "10.0.0.5:4010", "gateway:4010", "127.0.0.1", "127.0.0.1:0", "127.0.0.1:70000", "127.0.0.2:4010"])
      expect(() => parseGatewayTarget(bad), String(bad)).toThrow(/loopback/);
  });

  it("a socket is made readable and writable by its owner only (mode 600), replacing a file left at its path; a path too long for a socket is refused", async () => {
    const d = tmp();
    const path = join(d, "egress.sock");
    writeFileSync(path, "left by an earlier run");
    await started(net.createServer(), path);
    await expect(listenOnSocket(net.createServer(), join(d, "x".repeat(120)))).rejects.toThrow(/at most 107 bytes/);
    expect((statSync(path).mode & 0o777).toString(8)).toBe("600");
    expect(statSync(path).isSocket()).toBe(true);
  });

  it("end to end on this machine's loopback: TCP port, then the door's forwarder, then a Unix socket, then the egress proxy, then a made-up upstream; and the gateway forwarder", async () => {
    const d = tmp();
    // A made-up upstream proxy that answers 200 to any CONNECT and then echoes.
    const upstream = await started(
      net.createServer((c) =>
        c.once("data", () => {
          c.write("HTTP/1.1 200 Connection established\r\n\r\n");
          c.pipe(c);
        }),
      ),
    );
    const records: EgressRecord[] = [];
    await started(createEgressProxy({ allow: ["registry.npmjs.org"], upstreamProxy: `http://127.0.0.1:${upstream}`, log: (r) => records.push(r) }), join(d, "egress.sock"));
    // A made-up gateway on the loopback address.
    const gateway = await started(http.createServer((_q, s) => s.writeHead(200, { server: "made-up-gateway" }).end("ok")) as unknown as net.Server);
    const fwd: ForwardRecord[] = [];
    await started(createForwarder(join(d, "gateway.sock"), { host: "127.0.0.1", port: gateway }, (r) => fwd.push(r)), join(d, "gateway.sock"));
    // The door's two forwarders, each on a TCP port, to the two sockets.
    const doorProxy = await started(createForwarder("3128", { path: join(d, "egress.sock") }, (r) => fwd.push(r)));
    const doorGateway = await started(createForwarder("4010", { path: join(d, "gateway.sock") }, (r) => fwd.push(r)));
    expect(await connectThrough(doorProxy, "registry.npmjs.org:443")).toBe("HTTP/1.1 200 Connection Established");
    expect(await connectThrough(doorProxy, "example.com:443")).toBe("HTTP/1.1 403 Forbidden");
    const res = await fetch(`http://127.0.0.1:${doorGateway}/`);
    expect([res.status, res.headers.get("server"), await res.text()]).toEqual([200, "made-up-gateway", "ok"]);
    expect(records.map((r) => `${r.host} ${r.decision}`)).toEqual(["registry.npmjs.org allowed", "example.com refused"]);
    expect(fwd.filter((r) => r.decision === "forwarded").map((r) => r.listen).sort()).toEqual([join(d, "gateway.sock"), "3128", "3128", "4010"]);
  });

  it("a forwarder whose socket is gone closes the client's connection and logs the error", async () => {
    const d = tmp();
    const fwd: ForwardRecord[] = [];
    const port = await started(createForwarder("3128", { path: join(d, "nothing-here.sock") }, (r) => fwd.push(r)));
    // No answer either way: the connection is closed, or reset, before a byte comes back.
    expect(["closed with no answer", "error ECONNRESET"]).toContain(await connectThrough(port, "registry.npmjs.org:443"));
    expect(fwd).toMatchObject([{ listen: "3128", decision: "error", detail: expect.stringContaining("ENOENT") }]);
  });
});
