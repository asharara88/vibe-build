// Package 0.6c, first step: a throwaway measurement probe. Not part of the builder.
// Runs ONLY inside a container (refuses where /.dockerenv is missing). Node's own modules only.
//
//   node m06c-probe.mjs '<label>' '<attempts as JSON>'
//
// Prints one JSON line per fact: {"kind":"info",...}, {"kind":"attempt",...}, {"kind":"end"}.
// Every attempt is harmless: a TCP connection opened and closed, a plain HTTP GET, a proxy's CONNECT
// (then, for a tunnel attempt, one HTTPS GET inside it), a name lookup, or a Unix socket connection.
// The result says WHO answered where it can: the HTTP status with the server header and the first words
// of the body, or the proxy's status line. No setting's value is printed.
import dns from "node:dns";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import tls from "node:tls";

if (!existsSync("/.dockerenv")) {
  console.log(JSON.stringify({ kind: "error", reason: "not inside a container (/.dockerenv missing); refusing to run" }));
  process.exit(1);
}
const label = process.argv[2] ?? "?";
const attempts = JSON.parse(process.argv[3] ?? "[]");
const LIMIT = Number(process.env.PROBE_LIMIT_MS ?? 3000);
const out = (o) => process.stdout.write(JSON.stringify({ label, ...o }) + "\n");
const one = (s, n = 90) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const codeOf = (e) => (e && e.code ? String(e.code) : String(e?.message ?? e));

// --- what the container sees -------------------------------------------------------------------
const read = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch (e) {
    return `(unreadable: ${codeOf(e)})`;
  }
};
const hex2ip = (h) => [3, 2, 1, 0].map((i) => parseInt(h.slice(i * 2, i * 2 + 2), 16)).join(".");
const routes = read("/proc/net/route")
  .split("\n")
  .slice(1)
  .filter(Boolean)
  .map((l) => l.trim().split(/\s+/))
  .map((f) => `${f[0]} dest ${hex2ip(f[1])} gw ${hex2ip(f[2])} mask ${hex2ip(f[7])}`);
out({ kind: "info", name: "uid", value: process.getuid?.() });
out({ kind: "info", name: "interfaces (up, as Node lists them)", value: Object.entries(os.networkInterfaces()).map(([n, a]) => `${n}: ${a.map((x) => `${x.family} ${x.address}`).join(", ")}`) });
out({ kind: "info", name: "interfaces in /sys/class/net", value: (() => { try { return readdirSync("/sys/class/net"); } catch (e) { return codeOf(e); } })() });
out({ kind: "info", name: "IPv4 routes (/proc/net/route)", value: routes });
out({ kind: "info", name: "default route present", value: routes.some((r) => r.includes("dest 0.0.0.0 ") && r.endsWith("mask 0.0.0.0")) });
out({ kind: "info", name: "ip_forward (/proc/sys/net/ipv4/ip_forward)", value: read("/proc/sys/net/ipv4/ip_forward").trim() });
out({ kind: "info", name: "IPv6 in this network namespace", value: { "/proc/net/if_inet6": existsSync("/proc/net/if_inet6") ? read("/proc/net/if_inet6").trim() || "(empty)" : "(absent)", "/proc/sys/net/ipv6": existsSync("/proc/sys/net/ipv6") ? "present" : "absent" } });
out({ kind: "info", name: "name servers (/etc/resolv.conf)", value: read("/etc/resolv.conf").split("\n").filter((l) => l.startsWith("nameserver")) });

// --- attempts ------------------------------------------------------------------------------------
function limit(start) {
  return new Promise((resolve) => {
    let done = false;
    const cleanups = [];
    let atLimit = () => ({ result: "timed out", detail: `no answer within ${LIMIT} ms` });
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      for (const c of cleanups) try { c(); } catch {}
      resolve(r);
    };
    const t = setTimeout(() => finish(atLimit()), LIMIT);
    start(finish, (c) => cleanups.push(c), (f) => (atLimit = f));
  });
}
const failed = (e) => {
  const c = codeOf(e);
  const word =
    c === "ECONNREFUSED" ? "refused" :
    ["ENETUNREACH", "EHOSTUNREACH", "EADDRNOTAVAIL"].includes(c) ? "network unreachable" :
    ["ENOTFOUND", "EAI_NONAME", "ENODATA", "EAI_NODATA"].includes(c) ? "name not found" :
    c === "EAI_AGAIN" ? "no name server answered" :
    ["ECONNRESET", "EPIPE"].includes(c) ? "connection reset" :
    c === "EACCES" ? "permission denied" :
    c === "ENOENT" ? "no such socket" :
    /CERT|SELF_SIGNED|UNABLE_TO/.test(c) ? "certificate not trusted" :
    "error";
  return { result: word, code: c };
};

function tcp(a) {
  return limit((finish, cleanup) => {
    const s = net.connect({ host: a.host, port: a.port });
    cleanup(() => s.destroy());
    s.on("connect", () => {
      // Wait a moment: a listener that checks the source closes the connection at once.
      setTimeout(() => finish({ result: s.destroyed || s.readyState !== "open" ? "connected, then closed by the other end" : "connected", detail: `from ${s.localAddress}` }), 300);
    });
    s.on("close", () => finish({ result: "connected, then closed by the other end", detail: "" }));
    s.on("error", (e) => finish(failed(e)));
  });
}
function unix(a) {
  return limit((finish, cleanup) => {
    const s = net.connect({ path: a.path });
    cleanup(() => s.destroy());
    s.on("connect", () => finish({ result: "connected", detail: "" }));
    s.on("error", (e) => finish(failed(e)));
  });
}
function httpGet(a) {
  return limit((finish, cleanup, atLimit) => {
    const u = new URL(a.url);
    const req = http.request({ host: a.connectHost ?? u.hostname, port: a.connectPort ?? (u.port || 80), path: a.proxied ? a.url : u.pathname + u.search, method: "GET", agent: false, headers: { host: u.host, connection: "close", "user-agent": "m06c-probe" } }, (res) => {
      let body = "";
      atLimit(() => ({ result: `HTTP ${res.statusCode}`, detail: answerDetail(res, body) }));
      res.setEncoding("utf8");
      res.on("data", (d) => (body += d.length < 512 ? d : d.slice(0, 512)));
      res.on("end", () => finish({ result: `HTTP ${res.statusCode}`, detail: answerDetail(res, body) }));
    });
    cleanup(() => req.destroy());
    req.on("error", (e) => finish(failed(e)));
    req.end();
  });
}
const answerDetail = (res, body) => [res.headers.server ? `server: ${one(res.headers.server, 40)}` : "", res.headers["x-deny-reason"] ? `x-deny-reason: ${one(res.headers["x-deny-reason"], 60)}` : "", body ? `says: "${one(body)}"` : ""].filter(Boolean).join("; ");

/** CONNECT through a proxy; then optionally HTTPS GET inside, with the container's own trust store only. */
function connect(a) {
  return limit((finish, cleanup, atLimit) => {
    const [ph, pp] = a.proxy.startsWith("/") ? [null, null] : a.proxy.split(":");
    const s = ph ? net.connect({ host: ph, port: Number(pp) }) : net.connect({ path: a.proxy });
    cleanup(() => s.destroy());
    s.on("connect", () => {
      atLimit(() => ({ result: "connected, then no answer within the limit", detail: "CONNECT sent" }));
      s.write(`CONNECT ${a.target} HTTP/1.1\r\nHost: ${a.target}\r\n\r\n`);
    });
    let buf = Buffer.alloc(0);
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) return;
      s.off("data", onData);
      const head = buf.subarray(0, end).toString();
      const status = head.split("\r\n")[0];
      const bodyStart = one(buf.subarray(end + 4).toString(), 80);
      if (!/^HTTP\/1\.[01] 200/.test(status) || !a.https) {
        finish({ result: `proxy answered: ${one(status, 60)}`, detail: bodyStart ? `says: "${bodyStart}"` : "" });
        return;
      }
      const [host] = a.target.split(":");
      const t = tls.connect({ socket: s, servername: host }, () => {
        t.write(`GET ${a.path ?? "/"} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nUser-Agent: m06c-probe\r\n\r\n`);
      });
      let resp = "";
      t.on("data", (d) => (resp += d.toString().slice(0, 600)));
      t.on("end", () => finish({ result: `tunnel open; inside it: ${one(resp.split("\r\n")[0], 40)}`, detail: `proxy said: ${one(status, 40)}; certificate trusted with the container's own store` }));
      t.on("error", (e) => finish({ ...failed(e), result: `tunnel open; inside it: ${failed(e).result}`, detail: `proxy said: ${one(status, 40)}` }));
    };
    s.on("data", onData);
    s.on("close", () => finish({ result: "connected, then closed by the other end", detail: buf.length ? `got: "${one(buf.toString(), 60)}"` : "nothing came back" }));
    s.on("error", (e) => finish(failed(e)));
  });
}
function lookup(a) {
  return limit((finish) => dns.lookup(a.name, { all: true }, (e, addrs) => (e ? finish(failed(e)) : finish({ result: "address found", detail: addrs.map((x) => x.address).join(" ") }))));
}
function resolveVia(a) {
  return limit((finish) => {
    const r = new dns.Resolver({ timeout: LIMIT - 200, tries: 1 });
    r.setServers([a.server]);
    r.resolve4(a.name, (e, addrs) => (e ? finish(failed(e)) : finish({ result: "address found", detail: addrs.join(" ") })));
  });
}
const kinds = { tcp, unix, http: httpGet, connect, lookup, resolve: resolveVia };

const pool = 12;
const results = new Array(attempts.length);
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(pool, attempts.length) }, async () => {
    while (next < attempts.length) {
      const i = next++;
      const a = attempts[i];
      const f = kinds[a.type];
      results[i] = f ? await f(a) : { result: "error", detail: `unknown attempt type ${a.type}` };
    }
  }),
);
attempts.forEach((a, i) => out({ kind: "attempt", id: a.id, what: a.what ?? "", target: a.target ?? (a.host ? `${a.host}:${a.port}` : a.url ?? a.name ?? a.path ?? ""), how: a.type + (a.proxy ? ` via ${a.proxy}` : "") + (a.server ? ` @${a.server}` : ""), ...results[i] }));
out({ kind: "end", attempts: attempts.length });
