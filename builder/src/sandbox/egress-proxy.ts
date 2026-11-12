/**
 * The egress proxy: the only way out of a project's containers.
 *
 * It is a plain HTTP proxy that allows exactly the hosts it is told to allow and refuses
 * everything else, logging each decision as one JSON line. It handles HTTPS by tunnelling
 * (the CONNECT method), so it never sees or alters the content of an HTTPS exchange.
 *
 * On the development machine the proxy itself must go out through the session's proxy
 * (EGRESS_UPSTREAM_PROXY); on a server it connects directly.
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
  /** Upstream proxy URL, e.g. http://127.0.0.1:46857, or none for a direct connection. */
  upstreamProxy?: string;
  /** Called with one record per decision. Default: JSON line to stdout. */
  log?: (record: EgressRecord) => void;
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
  const upstream = opts.upstreamProxy ? new URL(opts.upstreamProxy) : null;
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
      const target = net.connect(port, host, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) target.write(head);
        target.pipe(clientSocket);
        clientSocket.pipe(target);
      });
      target.on("error", (e) => {
        record("CONNECT", host, port, "error", e.message);
        clientSocket.destroy();
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
    tunnel.on("data", (chunk: Buffer | string) => {
      if (established) return;
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const statusLine = buffer.subarray(0, end).toString().split("\r\n")[0] ?? "";
      const rest = buffer.subarray(end + 4);
      established = true;
      if (!/^HTTP\/1\.[01] 200/.test(statusLine)) {
        record("CONNECT", host, port, "error", `upstream answered: ${statusLine}`);
        clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        clientSocket.destroy();
        tunnel.destroy();
        return;
      }
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) tunnel.write(head);
      if (rest.length) clientSocket.write(rest);
      tunnel.pipe(clientSocket);
      clientSocket.pipe(tunnel);
    });
    tunnel.on("error", (e) => {
      record("CONNECT", host, port, "error", e.message);
      clientSocket.destroy();
    });
    clientSocket.on("error", () => tunnel.destroy());
  });

  return server;
}

/** Entry point for the container: configuration from the environment. */
export function startFromEnv(): http.Server {
  const allow = (process.env.EGRESS_ALLOW ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const port = Number(process.env.EGRESS_PORT ?? 3128);
  const server = createEgressProxy({ allow, upstreamProxy: process.env.EGRESS_UPSTREAM_PROXY || undefined });
  server.listen(port, "0.0.0.0", () => {
    process.stdout.write(JSON.stringify({ at: new Date().toISOString(), listening: port, allow }) + "\n");
  });
  return server;
}
