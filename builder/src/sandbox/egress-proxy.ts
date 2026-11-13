/**
 * The egress proxy: the only way out of a project's containers.
 * - Server profile: it runs in its own container on the project's `out` network and on an ordinary
 *   bridge, and connects directly (designed, not shown: package 0.6b).
 * - Development profile (package 0.6c): it runs on the machine's network (`egress-machine-main.ts`) and
 *   listens only on a Unix socket in the project's socket folder, which a small door container on the
 *   project's `out` network forwards to, and on one port of the machine's loopback address for the image
 *   build. It goes out only through the cloud session's proxy; it refuses to start without one.
 *
 * It is a plain HTTP proxy that allows exactly the hosts it is told to allow and refuses
 * everything else, logging each decision as one JSON line. It handles HTTPS by tunnelling
 * (the CONNECT method), so it never sees or alters the content of an HTTPS exchange.
 *
 * Its way out is set explicitly (`parseUpstream`): the word "direct", accepted only where the caller
 * allows it (the server profile), or a proxy's address with a host and a port. An empty, missing or
 * malformed setting is refused, so the proxy never goes out directly by accident: package 0.6c's
 * measurement saw an empty setting send requests straight out, past the session's proxy
 * (evidence/2026-11-13-package-0.6c/measure/08-upstream-empty-or-wrong.txt).
 *
 * Design note: docs/design/stage-1.md, section 2.5. Known gap 14 explains how this differs
 * from the secure-deployment guide's "no network at all" pattern.
 */
import http from "node:http";
import net from "node:net";
import { URL } from "node:url";

export interface EgressOptions {
  /** Hostnames allowed, exact match or "*.example.com" for subdomains. */
  allow: string[];
  /**
   * Upstream proxy URL, e.g. http://127.0.0.1:46857, or none for a direct connection. Given as text, it
   * must be a proxy address with a host and a port (`parseUpstream`); anything else throws.
   */
  upstreamProxy?: string;
  /** Called with one record per decision. Default: JSON line to stdout. */
  log?: (record: EgressRecord) => void;
  /** How long the upstream proxy has to answer a tunnel request before the client is told 504. Default 30 s. */
  upstreamTimeoutMs?: number;
}

/**
 * The egress proxy's way out, checked (package 0.6c). "direct" means no upstream proxy and is accepted only
 * when `allowDirect` is true (the server profile). Anything else must be a plain-HTTP proxy address with a
 * host and a port, such as http://127.0.0.1:46857; only its host and port are used, so a user name or
 * password in it is never sent. An empty, missing or malformed value throws: the proxy must not fall back
 * to going out directly.
 */
export function parseUpstream(value: string | undefined, opts: { allowDirect: boolean }): URL | null {
  const v = (value ?? "").trim();
  if (v === "direct") {
    if (opts.allowDirect) return null;
    throw new Error('The egress proxy\'s way out is "direct", which this profile does not allow: it must go out through the cloud session\'s proxy.');
  }
  if (!v) throw new Error("The egress proxy's way out (EGRESS_UPSTREAM_PROXY) is empty or missing: it refuses to start rather than go out directly.");
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error("The egress proxy's way out (EGRESS_UPSTREAM_PROXY) is not an address: it refuses to start.");
  }
  if (u.protocol !== "http:" || !u.hostname || !u.port) throw new Error("The egress proxy's way out (EGRESS_UPSTREAM_PROXY) must be http://host:port, with a host and a port: it refuses to start.");
  return new URL(`http://${u.host}`);
}

export interface EgressRecord {
  at: string;
  method: string;
  host: string;
  port: number;
  decision: "allowed" | "refused" | "error";
  detail?: string;
}

export function hostAllowed(host: string, allow: string[]): boolean {
  const h = host.toLowerCase();
  return allow.some((a) => {
    const rule = a.toLowerCase().trim();
    if (rule.startsWith("*.")) return h.endsWith(rule.slice(1)) && h.length > rule.length - 1;
    return h === rule;
  });
}

export function createEgressProxy(opts: EgressOptions): http.Server {
  const log = opts.log ?? ((r: EgressRecord) => process.stdout.write(JSON.stringify(r) + "\n"));
  const upstream = opts.upstreamProxy === undefined ? null : parseUpstream(opts.upstreamProxy, { allowDirect: false });
  const upstreamTimeoutMs = opts.upstreamTimeoutMs ?? 30_000;
  const record = (method: string, host: string, port: number, decision: EgressRecord["decision"], detail?: string) =>
    log({ at: new Date().toISOString(), method, host, port, decision, detail });

  const server = http.createServer((req, res) => {
    // Plain HTTP request through the proxy (rare: package registries and the model API use HTTPS).
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end("bad request");
      return;
    }
    const port = Number(target.port || 80);
    if (!hostAllowed(target.hostname, opts.allow)) {
      record(req.method ?? "GET", target.hostname, port, "refused");
      res.writeHead(403, { "content-type": "text/plain" }).end(`egress refused: ${target.hostname} is not an allowed host\n`);
      return;
    }
    record(req.method ?? "GET", target.hostname, port, "allowed");
    const connectHost = upstream ? upstream.hostname : target.hostname;
    const connectPort = upstream ? Number(upstream.port || 80) : port;
    const path = upstream ? target.toString() : target.pathname + target.search;
    const out = http.request({ host: connectHost, port: connectPort, method: req.method, path, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    out.on("error", (e) => {
      record(req.method ?? "GET", target.hostname, port, "error", e.message);
      if (!res.headersSent) res.writeHead(502).end("egress error");
    });
    req.pipe(out);
  });

  server.on("connect", (req, clientSocket, head) => {
    const [hostRaw, portRaw] = (req.url ?? "").split(":");
    const host = hostRaw ?? "";
    const port = Number(portRaw || 443);
    if (!hostAllowed(host, opts.allow)) {
      record("CONNECT", host, port, "refused");
      clientSocket.write("HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\n" + `egress refused: ${host} is not an allowed host\n`);
      clientSocket.destroy();
      return;
    }
    record("CONNECT", host, port, "allowed");
    if (!upstream) {
      let opened = false;
      const target = net.connect(port, host, () => {
        opened = true;
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) target.write(head);
        target.pipe(clientSocket);
        clientSocket.pipe(target);
      });
      target.on("error", (e) => {
        record("CONNECT", host, port, "error", e.message);
        if (!opened && !clientSocket.destroyed) clientSocket.end(`HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\negress error: ${e.message}\n`);
        else clientSocket.destroy();
      });
      clientSocket.on("error", () => target.destroy());
      return;
    }
    // Chain: ask the upstream proxy to open the tunnel, then pipe bytes both ways.
    const tunnel = net.connect(Number(upstream.port || 80), upstream.hostname, () => {
      tunnel.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
    let established = false;
    let buffer = Buffer.alloc(0);
    // Until the upstream proxy has answered, every way the attempt can end gives the client an answer of
    // ours, never silence (package 0.6c, measurement item 8): 502 when the upstream refuses, fails or closes
    // first, 504 when it says nothing within the limit.
    const failBeforeTunnel = (status: "502 Bad Gateway" | "504 Gateway Timeout", detail: string) => {
      if (established) return;
      established = true;
      clearTimeout(timer);
      record("CONNECT", host, port, "error", detail);
      if (!clientSocket.destroyed) clientSocket.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\n\r\negress error: ${detail}\n`);
      tunnel.destroy();
    };
    const timer = setTimeout(() => failBeforeTunnel("504 Gateway Timeout", `the upstream proxy did not answer within ${upstreamTimeoutMs} ms`), upstreamTimeoutMs);
    tunnel.on("data", (chunk: Buffer | string) => {
      if (established) return;
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const statusLine = buffer.subarray(0, end).toString().split("\r\n")[0] ?? "";
      const rest = buffer.subarray(end + 4);
      if (!/^HTTP\/1\.[01] 200/.test(statusLine)) {
        failBeforeTunnel("502 Bad Gateway", `upstream answered: ${statusLine}`);
        return;
      }
      established = true;
      clearTimeout(timer);
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) tunnel.write(head);
      if (rest.length) clientSocket.write(rest);
      tunnel.pipe(clientSocket);
      clientSocket.pipe(tunnel);
    });
    tunnel.on("error", (e) => {
      if (!established) failBeforeTunnel("502 Bad Gateway", `the upstream proxy could not be reached or failed: ${e.message}`);
      else {
        record("CONNECT", host, port, "error", e.message);
        clientSocket.destroy();
      }
    });
    tunnel.on("close", () => {
      if (!established) failBeforeTunnel("502 Bad Gateway", "the upstream proxy closed the connection before it answered");
      else clientSocket.destroy();
    });
    clientSocket.on("error", () => tunnel.destroy());
    clientSocket.on("close", () => {
      clearTimeout(timer);
      tunnel.destroy();
    });
  });

  return server;
}

/** A comma-separated list setting, as a list of its non-empty entries. */
export const listSetting = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * Entry point for the server profile's egress container: configuration from the environment.
 * EGRESS_UPSTREAM_PROXY must be "direct" or a proxy's address (`parseUpstream`); empty or missing, the
 * proxy refuses to start, saying why on one JSON line, and the process exits with code 2.
 */
export function startFromEnv(): http.Server | null {
  const allow = listSetting(process.env.EGRESS_ALLOW);
  const port = Number(process.env.EGRESS_PORT ?? 3128);
  let upstream: URL | null;
  try {
    upstream = parseUpstream(process.env.EGRESS_UPSTREAM_PROXY, { allowDirect: true });
  } catch (err) {
    process.stdout.write(JSON.stringify({ at: new Date().toISOString(), refusedToStart: (err as Error).message }) + "\n");
    process.exitCode = 2;
    return null;
  }
  const server = createEgressProxy({ allow, upstreamProxy: upstream ? upstream.href : undefined });
  server.listen(port, "0.0.0.0", () => {
    process.stdout.write(JSON.stringify({ at: new Date().toISOString(), listening: port, allow, upstream: upstream ? upstream.host : "direct" }) + "\n");
  });
  return server;
}
