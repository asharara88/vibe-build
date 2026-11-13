// The isolation probe (build plan package 0.6a; extended in package 0.6c).
//
// It runs ONLY inside a container (hard rule 9): it refuses to start where Docker's marker file
// `/.dockerenv` is missing. It is started by scripts/demo-isolation.ts and by the live test in
// test/isolation.test.ts, mounted read-only at /probe/isolation-probe.mjs. It uses nothing but Node's
// own modules.
//
//   node /probe/isolation-probe.mjs '<settings as JSON>'
//
// Settings: {"sessionProxy": "host:port" or null, "projectDbPort": n, "egressPort": n,
//            "gatewayPort": n, "builderDbPort": n, "exampleAddress": "a.b.c.d", "timeoutMs": n,
//            "bridgeGateway": "a.b.c.d" or null, "machineListeners": ["address:port", ...],
//            and, from package 0.6c, all optional:
//            "machineAddresses": ["a.b.c.d", ...]  every address the machine holds, read there (group M),
//            "egressHost": "egress"                where the project's egress proxy is (default 127.0.0.1),
//            "gatewayVia": "egress:4010"           the door's gateway port (attempt W1),
//            "peers": ["db:5432", "app:3131", ...] the project's own services by name (group P),
//            and, from package J3, optional:
//            "sockets": ["/psock/c.sock"]          Unix sockets mounted into the container (group U)}
// The session proxy is given as host and port only; anything that looks like a user name or a password
// is refused, so the probe can never print one. `bridgeGateway` (the gateway address of Docker's default
// network) and `machineListeners` (the machine's listening TCP sockets, with their addresses) are read on
// the machine by the harness, read-only, and given here for group G.
//
// Every attempt is harmless: a TCP connection that is opened and closed at once, a plain HTTP request
// (GET, no body), a proxy's CONNECT, or a name lookup. Each has a short time limit. Nothing else is sent.
//
// It prints one JSON line per fact on stdout:
//   {"kind":"info","name":...,"value":...}           what the container sees (no setting's value is printed)
//   {"kind":"attempt","id","group","toward","what","target","how","result","code","detail"}
//                                                    ("timed out" only where no connection opened; once one
//                                                    opened and nothing more came: OPENED_THEN_SILENT)
//   {"kind":"end","attempts":n}
//   {"kind":"error","reason":...}                    (exit 1)
import dns from "node:dns";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { pathToFileURL } from "node:url";

/** Where a copy of the cloud session's certificate could be found inside a project container. */
export const SESSION_CERT_PATHS = ["/certs/session-ca.crt", "/workspace/certs/session-ca.crt"];

export const GROUPS = {
  A: "Without the proxy, by name",
  B: "Without the proxy, by address",
  C: "On other ports, and services on the host",
  D: "By name lookup",
  E: "Through the project's egress proxy",
  F: "Through the cloud session's proxy, bypassing the project's egress proxy",
  G: "Toward the machine through the container network's gateway",
  M: "Toward every address the machine holds, on every port listening on the machine",
  P: "The project's own services, by name",
  W: "The model gateway, through the door's gateway port",
  U: "Through a Unix socket mounted into the container",
};

const HOST_PORT = /^([a-zA-Z0-9.-]{1,253}|\[[0-9a-fA-F:]{2,39}\]):(\d{1,5})$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const isIPv4 = (v) => {
  const parts = typeof v === "string" ? IPV4.exec(v) : null;
  return Boolean(parts) && parts.slice(1).every((p) => Number(p) <= 255);
};
/** A listening socket as parseListeners writes it: an IPv4 address, "::", "::1" or "ipv6", then the port. */
const LISTENER = /^(\d{1,3}(?:\.\d{1,3}){3}|::|::1|ipv6):(\d{1,5})$/;

/** The most listening sockets the probe takes for group G. The harness refuses to run with more (src/sandbox/isolation.ts). */
export const MAX_MACHINE_LISTENERS = 64;
/** The most machine addresses the probe takes for group M. */
export const MAX_MACHINE_ADDRESSES = 32;
/** A service's name on the project's networks, and a port: "db:5432". */
const PEER = /^([a-z][a-z0-9-]{0,62}):(\d{1,5})$/;
const IPV6 = /^[0-9a-fA-F:]{2,39}$/;

/** Read and check the settings. Throws with a plain message on anything unexpected. */
export function parseSettings(text) {
  let raw;
  try {
    raw = JSON.parse(text ?? "");
  } catch {
    throw new Error("The settings must be one JSON object, given as the first argument.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The settings must be one JSON object.");
  const port = (name) => {
    const v = raw[name];
    if (!Number.isInteger(v) || v < 1 || v > 65535) throw new Error(`"${name}" must be a port number (1 to 65535).`);
    return v;
  };
  let sessionProxy = null;
  if (raw.sessionProxy !== null && raw.sessionProxy !== undefined) {
    // Host and port only: a user name or password (anything with "@" or "/") is refused, never printed.
    const m = typeof raw.sessionProxy === "string" ? HOST_PORT.exec(raw.sessionProxy) : null;
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 65535) throw new Error('"sessionProxy" must be "host:port", with nothing else, or null.');
    sessionProxy = { host: m[1].replace(/^\[|\]$/g, ""), port: Number(m[2]) };
  }
  const exampleAddress = raw.exampleAddress ?? "93.184.215.14";
  if (!isIPv4(exampleAddress)) throw new Error('"exampleAddress" must be an IPv4 address.');
  const timeoutMs = raw.timeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('"timeoutMs" must be a whole number from 100 to 30000.');
  const bridgeGateway = raw.bridgeGateway ?? null;
  if (bridgeGateway !== null && !isIPv4(bridgeGateway)) throw new Error('"bridgeGateway" must be an IPv4 address, or null.');
  const machineListeners = [];
  const given = raw.machineListeners ?? [];
  if (!Array.isArray(given) || given.length > MAX_MACHINE_LISTENERS) throw new Error(`"machineListeners" must be a list of at most ${MAX_MACHINE_LISTENERS} "address:port" texts.`);
  for (const item of given) {
    const m = typeof item === "string" ? LISTENER.exec(item) : null;
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 65535 || (m[1].includes(".") && !isIPv4(m[1])))
      throw new Error('"machineListeners" must be a list of "address:port" texts, as read on the machine.');
    machineListeners.push({ address: m[1], port: Number(m[2]) });
  }
  const machineAddresses = [];
  const addresses = raw.machineAddresses ?? [];
  if (!Array.isArray(addresses) || addresses.length > MAX_MACHINE_ADDRESSES) throw new Error(`"machineAddresses" must be a list of at most ${MAX_MACHINE_ADDRESSES} addresses.`);
  for (const a of addresses) {
    if (!(isIPv4(a) || (typeof a === "string" && a.includes(":") && IPV6.test(a)))) throw new Error('"machineAddresses" must be a list of IPv4 or IPv6 addresses, as read on the machine.');
    machineAddresses.push(a);
  }
  const egressHost = raw.egressHost ?? "127.0.0.1";
  if (typeof egressHost !== "string" || !(isIPv4(egressHost) || /^[a-z][a-z0-9-]{0,62}$/.test(egressHost))) throw new Error('"egressHost" must be a service name or an IPv4 address.');
  let gatewayVia = null;
  if (raw.gatewayVia !== null && raw.gatewayVia !== undefined) {
    const m = typeof raw.gatewayVia === "string" ? PEER.exec(raw.gatewayVia) : null;
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 65535) throw new Error('"gatewayVia" must be "name:port", or null.');
    gatewayVia = { host: m[1], port: Number(m[2]) };
  }
  const peers = [];
  const givenPeers = raw.peers ?? [];
  if (!Array.isArray(givenPeers) || givenPeers.length > 16) throw new Error('"peers" must be a list of at most 16 "name:port" texts.');
  for (const item of givenPeers) {
    const m = typeof item === "string" ? PEER.exec(item) : null;
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 65535) throw new Error('"peers" must be a list of "name:port" texts.');
    peers.push({ host: m[1], port: Number(m[2]) });
  }
  const sockets = [];
  const givenSockets = raw.sockets ?? [];
  if (!Array.isArray(givenSockets) || givenSockets.length > 4) throw new Error('"sockets" must be a list of at most 4 socket paths.');
  for (const item of givenSockets) {
    if (typeof item !== "string" || !/^\/psock\/[a-z0-9-]{1,40}\.sock$/.test(item)) throw new Error('"sockets" must be a list of "/psock/<name>.sock" paths.');
    sockets.push(item);
  }
  return {
    sessionProxy,
    sockets,
    machineAddresses,
    egressHost,
    gatewayVia,
    peers,
    projectDbPort: port("projectDbPort"),
    egressPort: port("egressPort"),
    gatewayPort: port("gatewayPort"),
    builderDbPort: port("builderDbPort"),
    exampleAddress,
    // Set by the probe once it has looked example.com up itself; until then the address is only the one given.
    exampleAddressLookedUp: false,
    timeoutMs,
    bridgeGateway,
    machineListeners,
  };
}

/** The words a result can be, and the error codes behind each failure. */
export function classifyError(code, context = "connection") {
  if (context === "lookup") {
    if (["ENOTFOUND", "ENODATA", "EAI_NONAME", "EAI_NODATA"].includes(code)) return "name not found";
    if (["EREFUSED", "ESERVFAIL", "EFORMERR", "ENOTIMP"].includes(code)) return "lookup refused by the name server";
    if (["EAI_AGAIN", "ETIMEOUT", "ETIMEDOUT", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "TIMEOUT"].includes(code)) return "no name server answered";
    return "error";
  }
  if (code === "ECONNREFUSED") return "refused";
  if (["ETIMEDOUT", "ETIMEOUT", "TIMEOUT"].includes(code)) return "timed out";
  if (["ENOTFOUND", "EAI_NONAME", "ENODATA", "EAI_NODATA"].includes(code)) return "name not found";
  if (code === "EAI_AGAIN") return "no name server answered";
  if (["ENETUNREACH", "EHOSTUNREACH", "EADDRNOTAVAIL"].includes(code)) return "network unreachable";
  if (["ECONNRESET", "EPIPE", "ECONNABORTED"].includes(code)) return "connection reset";
  // An answer that is not HTTP: Node's HTTP reader could not parse what came back on an open connection.
  if (code.startsWith("HPE_")) return "not an HTTP answer";
  if (
    [
      "SELF_SIGNED_CERT_IN_CHAIN",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "UNABLE_TO_GET_ISSUER_CERT",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "CERT_UNTRUSTED",
      "CERT_HAS_EXPIRED",
      "ERR_TLS_CERT_ALTNAME_INVALID",
    ].includes(code)
  )
    return "certificate not trusted";
  // A secure (TLS) connection that failed after the TCP connection opened, for a reason other than the certificate.
  if (code === "EPROTO" || code.startsWith("ERR_SSL_") || code.startsWith("ERR_TLS_")) return "secure connection failed";
  return "error";
}

/** An address as /proc/net writes it (hex), in plain form. */
function decodeAddress(addrHex, family) {
  // Four bytes, least significant first.
  if (family === 4 && addrHex.length === 8) return [6, 4, 2, 0].map((i) => parseInt(addrHex.slice(i, i + 2), 16)).join(".");
  return /^0+$/.test(addrHex) ? "::" : addrHex === "00000000000000000000000001000000" ? "::1" : "ipv6";
}

/** The sockets in /proc/net/tcp, tcp6, udp or udp6 text whose state and remote end pass `keep`: [{address, port}]. */
function parseSockets(text, family, keep) {
  const out = [];
  for (const line of (text ?? "").split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 4 || !keep(f[3], f[2] ?? "")) continue;
    const [addrHex, portHex] = (f[1] ?? "").split(":");
    if (!addrHex || !portHex) continue;
    out.push({ address: decodeAddress(addrHex, family), port: parseInt(portHex, 16) });
  }
  return out;
}

/** Listening TCP sockets in /proc/net/tcp or /proc/net/tcp6 text: [{address, port}]. */
export function parseListeners(text, family = 4) {
  return parseSockets(text, family, (state) => state === "0A"); // 0A: listening
}

/** UDP sockets with no remote end (those that wait for anyone's packets) in /proc/net/udp or udp6 text: [{address, port}]. */
export function parseUdpBound(text, family = 4) {
  return parseSockets(text, family, (_state, remote) => /^0+:0000$/.test(remote));
}

/**
 * The names of abstract Unix sockets in /proc/net/unix text: those whose name starts with "@". They belong to
 * the network the container shares, not to its files. Listed only; the probe never connects to one.
 */
export function parseAbstractUnix(text) {
  const names = new Set();
  for (const line of (text ?? "").split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    const name = f.slice(7).join(" ");
    if (name.startsWith("@")) names.add(name.slice(0, 80));
  }
  return [...names].sort();
}

/** The names of the info lines about routes and IPv6 (package 0.6c). */
export const ROUTES_INFO = "IPv4 routes (/proc/net/route)";
export const DEFAULT_ROUTE_INFO = "a default route (a way to any address)";
export const IPV6_INFO = "IPv6 in this network namespace (/proc/net/if_inet6)";

/** The IPv4 routes in /proc/net/route text, as "to <destination>/<prefix> via <gateway> on <interface>". */
export function parseRoutes(text) {
  const hex = (h) => [6, 4, 2, 0].map((i) => parseInt(h.slice(i, i + 2), 16)).join(".");
  const bits = (h) => [...hex(h).split(".").map(Number)].reduce((n, b) => n + b.toString(2).split("").filter((c) => c === "1").length, 0);
  const out = [];
  for (const line of (text ?? "").split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 8 || !/^[0-9A-Fa-f]{8}$/.test(f[1] ?? "") || !/^[0-9A-Fa-f]{8}$/.test(f[7] ?? "")) continue;
    out.push(`to ${hex(f[1])}/${bits(f[7])} via ${hex(f[2])} on ${f[0]}`);
  }
  return out;
}

/** What /proc/net/if_inet6 says: absent (no IPv6 in the kernel), or the addresses it lists with their interfaces. */
export function ipv6State(text) {
  if (text === null) return "absent: this kernel has no IPv6 here";
  const rows = text.split("\n").map((l) => l.trim().split(/\s+/)).filter((f) => f.length >= 6 && /^[0-9a-f]{32}$/i.test(f[0]));
  if (rows.length === 0) return "present, with no address";
  return rows.map((f) => `${f[0].match(/.{4}/g).join(":")} on ${f[5]}`).join("; ");
}

/** The names of the info lines about network interfaces. */
export const INTERFACES_UP = "network interfaces that are up and running, with their addresses (as Node lists them)";
export const INTERFACES_ALL = "every network interface in /sys/class/net, up or down (name and state only)";

/**
 * Every network interface in `dir` (the kernel's /sys/class/net), up or down, with its state as the kernel
 * gives it ("up", "down", or "unknown", which the loopback interface has). Node's own list leaves out an
 * interface that is not up and running, such as Docker's bridge while no container is attached to it.
 * Read only; the addresses of an interface that is down are not listed.
 */
export function listInterfaces(dir = "/sys/class/net") {
  let names;
  try {
    names = readdirSync(dir).sort();
  } catch (e) {
    return `could not be read (${codeOf(e)})`;
  }
  const state = (n) => {
    try {
      return readFileSync(join(dir, n, "operstate"), "utf8").trim() || "state not given";
    } catch {
      return "state not given";
    }
  };
  return names.map((n) => `${n} (${state(n)})`).join(", ") || "none";
}

/** The number of TCP sockets in /proc/net/tcp text that are not listening, in any state (open, closing, or waiting after closing). */
export function countOtherSockets(text) {
  return (text ?? "").split("\n").slice(1).filter((l) => {
    const f = l.trim().split(/\s+/);
    return f.length >= 4 && f[3] !== "0A";
  }).length;
}

/**
 * Every attempt, in order. Pure: it only lists what will be tried. `extraListeners` are the listening
 * ports found inside the container that are not among the named services; each gets a connection attempt.
 */
export function planAttempts(s, extraListeners = []) {
  const plan = [];
  // An IPv6 address is written in brackets before its port ("[::1]:3128"), so that the table can tell it apart.
  const hostPort = (host, port) => (host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`);
  const add = (id, group, toward, what, target, how, op) => plan.push({ id, group: GROUPS[group], toward, what, target, how, op });
  const ex = s.exampleAddress;

  add("A1", "A", "outside", "a host the egress list allows, HTTPS", "registry.npmjs.org:443", "HTTPS GET /-/ping, sent directly, no proxy", { type: "https", host: "registry.npmjs.org", port: 443, path: "/-/ping" });
  add("A2", "A", "outside", "a host the egress list allows, plain HTTP", "registry.npmjs.org:80", "HTTP GET /-/ping, sent directly, no proxy", { type: "http", host: "registry.npmjs.org", port: 80, path: "/-/ping" });
  add("A3", "A", "outside", "a host the egress list refuses, HTTPS", "example.com:443", "HTTPS GET /, sent directly, no proxy", { type: "https", host: "example.com", port: 443, path: "/" });
  add("A4", "A", "outside", "a host the egress list refuses, plain HTTP", "example.com:80", "HTTP GET /, sent directly, no proxy", { type: "http", host: "example.com", port: 80, path: "/" });
  add("A5", "A", "outside", "another host the egress list refuses, plain HTTP", "github.com:80", "HTTP GET /, sent directly, no proxy", { type: "http", host: "github.com", port: 80, path: "/" });

  add("B1", "B", "outside", "a public address, HTTPS port", "1.1.1.1:443", "TCP connection, opened and closed", { type: "tcp", host: "1.1.1.1", port: 443 });
  // The address is example.com's only if the probe looked it up itself; otherwise it is the one given, unchecked.
  const exWhat = s.exampleAddressLookedUp ? "example.com's address" : "the address given for example.com (not checked)";
  add("B2", "B", "outside", `${exWhat}, HTTP port`, `${ex}:80`, "TCP connection, opened and closed", { type: "tcp", host: ex, port: 80 });
  add("B3", "B", "outside", `${exWhat}, plain HTTP`, `${ex}:80`, "HTTP GET / with the name example.com, no proxy", { type: "http", host: ex, port: 80, path: "/", hostHeader: "example.com" });
  add("B4", "B", "outside", "the cloud's machine-information address (link-local)", "169.254.169.254:80", "HTTP GET /, no extra headers, no proxy", { type: "http", host: "169.254.169.254", port: 80, path: "/" });

  add("C1", "C", "outside", "an outside address, port 22 (remote login)", "1.1.1.1:22", "TCP connection, opened and closed", { type: "tcp", host: "1.1.1.1", port: 22 });
  add("C2", "C", "outside", "an outside address, port 25 (mail)", "1.1.1.1:25", "TCP connection, opened and closed", { type: "tcp", host: "1.1.1.1", port: 25 });
  add("C3", "C", "outside", "an outside address, port 53 (name service over TCP)", "1.1.1.1:53", "TCP connection, opened and closed", { type: "tcp", host: "1.1.1.1", port: 53 });
  add("C4", "C", "outside", "an outside address, port 8080", "1.1.1.1:8080", "TCP connection, opened and closed", { type: "tcp", host: "1.1.1.1", port: 8080 });
  add("C5", "C", "host", "the builder's own database (PostgreSQL)", `127.0.0.1:${s.builderDbPort}`, "TCP connection, opened and closed", { type: "tcp", host: "127.0.0.1", port: s.builderDbPort });
  add("C6", "C", "host", "the model gateway's port", `127.0.0.1:${s.gatewayPort}`, "TCP connection, opened and closed", { type: "tcp", host: "127.0.0.1", port: s.gatewayPort });
  add("C7", "C", "host", "the project's database", `127.0.0.1:${s.projectDbPort}`, "TCP connection, opened and closed", { type: "tcp", host: "127.0.0.1", port: s.projectDbPort });
  add("C8", "C", "host", "the project's egress proxy", `127.0.0.1:${s.egressPort}`, "TCP connection, opened and closed", { type: "tcp", host: "127.0.0.1", port: s.egressPort });
  if (s.sessionProxy)
    add("C9", "C", "host", "the cloud session's proxy", hostPort(s.sessionProxy.host, s.sessionProxy.port), "TCP connection, opened and closed", { type: "tcp", host: s.sessionProxy.host, port: s.sessionProxy.port });
  for (const l of extraListeners) {
    const host = l.address === "0.0.0.0" || l.address === "::" ? "127.0.0.1" : l.address;
    add(`X${l.port}`, "C", "host", "another listening port, seen inside the container", hostPort(host, l.port), "TCP connection, opened and closed", { type: "tcp", host, port: l.port });
  }
  // G: the machine as a container on Docker's default network sees it, through that network's gateway
  // address, on every port the harness read as listening on the machine. Each port once; its listening
  // addresses, as read on the machine, are in the attempt's description.
  if (s.bridgeGateway) {
    const byPort = new Map();
    for (const l of s.machineListeners) byPort.set(l.port, [...(byPort.get(l.port) ?? []), l.address]);
    for (const [p, addresses] of [...byPort].sort((x, y) => x[0] - y[0])) {
      const where = addresses
        .map((a) => (a === "0.0.0.0" || a === "::" ? `${a} (every address)` : a === "127.0.0.1" || a === "::1" ? `${a} (loopback only)` : a))
        .join(" and ");
      add(`G${p}`, "G", "host", `port ${p}, listening on the machine at ${where}, as read on the machine`, `${s.bridgeGateway}:${p}`, "TCP connection, opened and closed; nothing sent", { type: "tcp", host: s.bridgeGateway, port: p });
    }
  }
  // M (package 0.6c): every address the machine holds, as read there, crossed with every port listening on the
  // machine, so that no machine address is assumed to be the one a container could reach it at.
  if (s.machineAddresses.length) {
    const byPort = new Map();
    for (const l of s.machineListeners) byPort.set(l.port, [...(byPort.get(l.port) ?? []), l.address]);
    for (const address of s.machineAddresses) {
      for (const [p, addresses] of [...byPort].sort((x, y) => x[0] - y[0])) {
        const where = addresses.map((a) => (a === "0.0.0.0" || a === "::" ? `${a} (every address)` : a === "127.0.0.1" || a === "::1" ? `${a} (loopback only)` : a)).join(" and ");
        add(`M${hostPort(address, p)}`, "M", "host", `a machine address, and port ${p}, listening on the machine at ${where}`, hostPort(address, p), "TCP connection, opened and closed; nothing sent", { type: "tcp", host: address, port: p });
      }
    }
  }

  add("D1", "D", "lookup", "an outside name the egress list allows", "registry.npmjs.org", "lookup with the container's own resolver", { type: "lookup", name: "registry.npmjs.org" });
  add("D2", "D", "lookup", "an outside name the egress list refuses", "example.com", "lookup with the container's own resolver", { type: "lookup", name: "example.com" });
  add("D3", "D", "lookup", "an internal-looking name: the database's name on the server profile", "db", "lookup with the container's own resolver", { type: "lookup", name: "db" });
  add("D4", "D", "lookup", "an internal-looking name: the cloud's machine-information service", "metadata.google.internal", "lookup with the container's own resolver", { type: "lookup", name: "metadata.google.internal" });
  add("D5", "D", "lookup", "an allowed name, asking an outside name server directly", "registry.npmjs.org @1.1.1.1", "question sent to 1.1.1.1 port 53 (UDP)", { type: "resolve", name: "registry.npmjs.org", server: "1.1.1.1" });
  add("D6", "D", "lookup", "a refused name, asking an outside name server directly", "example.com @1.1.1.1", "question sent to 1.1.1.1 port 53 (UDP)", { type: "resolve", name: "example.com", server: "1.1.1.1" });

  const eg = { host: s.egressHost, port: s.egressPort };
  const egAt = hostPort(s.egressHost, s.egressPort);
  add("E1", "E", "egress-proxy", "an allowed host, tunnel", "registry.npmjs.org:443", `CONNECT through ${egAt}`, { type: "connect", proxy: eg, target: "registry.npmjs.org:443" });
  add("E2", "E", "egress-proxy", "an allowed host, HTTPS inside the tunnel", "registry.npmjs.org:443", `CONNECT through ${egAt}, then HTTPS GET /-/ping`, { type: "https-tunnel", proxy: eg, host: "registry.npmjs.org", port: 443, path: "/-/ping" });
  add("E3", "E", "egress-proxy", "a refused host, tunnel", "example.com:443", `CONNECT through ${egAt}`, { type: "connect", proxy: eg, target: "example.com:443" });
  add("E4", "E", "egress-proxy", "an allowed host, plain HTTP", "registry.npmjs.org:80", `HTTP GET http://registry.npmjs.org/-/ping through ${egAt}`, { type: "http-proxy", proxy: eg, url: "http://registry.npmjs.org/-/ping" });
  add("E5", "E", "egress-proxy", "a refused host, plain HTTP", "example.com:80", `HTTP GET http://example.com/ through ${egAt}`, { type: "http-proxy", proxy: eg, url: "http://example.com/" });
  if (s.gatewayVia)
    add("W1", "W", "gateway", "the model gateway, at the door's gateway port", hostPort(s.gatewayVia.host, s.gatewayVia.port), "HTTP GET /, no proxy", { type: "http", host: s.gatewayVia.host, port: s.gatewayVia.port, path: "/" });
  for (const p of s.peers)
    add(`P${p.host}:${p.port}`, "P", "project", `the project's ${p.host} service, by its name`, `${p.host}:${p.port}`, "TCP connection, opened and closed; nothing sent", { type: "tcp", host: p.host, port: p.port });

  // U (package J3): each Unix socket mounted into the container, asked for a page.
  for (const [i, path] of (s.sockets ?? []).entries())
    add(`U${i + 1}`, "U", "host", "a Unix socket mounted into the container (the live camera's)", path, "HTTP GET / over the socket, no proxy", { type: "unix-http", path });

  if (s.sessionProxy) {
    const sp = s.sessionProxy;
    const via = `CONNECT through the cloud session's proxy (${hostPort(sp.host, sp.port)})`;
    add("F1", "F", "session-proxy", "a host the egress list allows", "registry.npmjs.org:443", via, { type: "connect", proxy: sp, target: "registry.npmjs.org:443" });
    add("F2", "F", "session-proxy", "a host the egress list refuses", "github.com:443", via, { type: "connect", proxy: sp, target: "github.com:443" });
    add("F3", "F", "session-proxy", "another host the egress list refuses", "example.com:443", via, { type: "connect", proxy: sp, target: "example.com:443" });
    add("F4", "F", "session-proxy", "a host the egress list refuses, HTTPS inside the tunnel", "github.com:443", `${via}, then HTTPS GET /robots.txt`, { type: "https-tunnel", proxy: sp, host: "github.com", port: 443, path: "/robots.txt" });
  }
  return plan;
}

const oneLine = (s, n = 110) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const codeOf = (err) => (err && typeof err === "object" && "code" in err && err.code ? String(err.code) : "ERROR");

/** What an HTTP answer says about where it came from: the server header, a redirect, a refusal's own words. */
function httpDetail(status, headers, body) {
  const bits = [];
  if (headers.server) bits.push(`server: ${oneLine(headers.server, 40)}`);
  if (headers.location) bits.push(`location: ${oneLine(headers.location, 60)}`);
  if (headers["x-deny-reason"]) bits.push(`x-deny-reason: ${oneLine(headers["x-deny-reason"], 60)}`);
  if (status >= 400 && body) bits.push(`says: "${oneLine(body)}"`);
  return bits.join("; ");
}

/**
 * Run `start(finish, cleanup, atLimit)` with a time limit; `finish` settles once with a result. When the
 * limit comes first, the result is "timed out", unless `atLimit(f)` was called: then it is `f()`. An attempt
 * calls it once its connection opened (`openedThenSilent`), and an HTTP attempt again once its status and
 * headers have come (then the result is that HTTP status, whatever the body does). So "timed out" is given
 * only where no connection opened (or, for a lookup, no answer came).
 */
function withLimit(ms, start) {
  return new Promise((resolve) => {
    let done = false;
    const cleanups = [];
    let limitResult = () => ({ result: "timed out", code: "TIMEOUT", detail: `no answer within ${ms} ms` });
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const c of cleanups) {
        try {
          c();
        } catch {
          /* already closed */
        }
      }
      resolve(r);
    };
    const timer = setTimeout(() => finish(limitResult()), ms);
    start(
      finish,
      (c) => cleanups.push(c),
      (f) => (limitResult = f),
    );
  });
}

/**
 * The result of an attempt whose connection opened, but which got nothing more before its time limit: a
 * request went out on an open connection, or a proxy was asked for a tunnel, or it answered 200 and nothing
 * came back inside the tunnel. It counts as an answer, since a connection opened (review of 0.6a, second
 * round: these used to be "timed out", which is now kept for an attempt where no connection opened).
 */
export const OPENED_THEN_SILENT = "connected, then no answer within the limit";

/** From now on, the limit gives OPENED_THEN_SILENT, with what had happened (`what`) as its detail. */
function openedThenSilent(atLimit, ms, what) {
  atLimit(() => ({ result: OPENED_THEN_SILENT, code: "TIMEOUT_AFTER_CONNECT", detail: `${what} within the time limit (${ms} ms)` }));
}

/** Call `f` once the socket's TCP connection has opened. */
function whenOpen(sock, f) {
  if (sock.connecting || !sock.remoteAddress) sock.once("connect", f);
  else f();
}

function tcpAttempt(op, ms) {
  return withLimit(ms, (finish, cleanup) => {
    const s = net.connect({ host: op.host, port: op.port });
    cleanup(() => s.destroy());
    s.on("connect", () => finish({ result: "connected", code: null, detail: "" }));
    s.on("error", (e) => finish({ result: classifyError(codeOf(e)), code: codeOf(e), detail: "" }));
  });
}

/** The certificates an HTTPS attempt trusts: the container's own, plus a session certificate if one is found inside. */
function trust(sessionCert) {
  return sessionCert ? { ca: [...tls.rootCertificates, readFileSync(sessionCert, "utf8")] } : {};
}

/** How long the body is read, once the status and headers have come, for the detail only. */
export const BODY_READ_MS = 1000;

/**
 * An HTTP answer. It settles when the status and headers arrive: from then on the result is the HTTP status,
 * whatever the body does. The body is read only briefly, for the detail (a refusal's own words); if it does
 * not finish in that time, or within the attempt's limit, the detail says so (review of 0.6a, finding 10).
 */
function readAnswer(res, finish, cleanup, atLimit, ms) {
  const status = res.statusCode ?? 0;
  let body = "";
  const settle = (code, note) => finish({ result: `HTTP ${status}`, code, detail: [httpDetail(status, res.headers, body), note].filter(Boolean).join("; ") });
  atLimit(() => ({ result: `HTTP ${status}`, code: null, detail: [httpDetail(status, res.headers, body), `the body did not finish within the time limit (${ms} ms)`].filter(Boolean).join("; ") }));
  const brief = setTimeout(() => settle(null, `the body did not finish within ${BODY_READ_MS} ms of the answer`), BODY_READ_MS);
  cleanup(() => clearTimeout(brief));
  res.setEncoding("utf8");
  res.on("data", (d) => {
    if (body.length < 2048) body += d;
  });
  res.on("end", () => settle(null, ""));
  res.on("error", (e) => settle(codeOf(e), ""));
}

function httpAttempt(op, ms, secure, sessionCert) {
  return withLimit(ms, (finish, cleanup, atLimit) => {
    const mod = secure ? https : http;
    // agent: false, so no proxy setting and no shared connection is used: the request goes straight out.
    const req = mod.request(
      {
        host: op.host,
        port: op.port,
        path: op.path,
        method: "GET",
        agent: false,
        headers: { host: op.hostHeader ?? op.host, "user-agent": "isolation-probe", connection: "close" },
        ...(secure ? { servername: op.host, ...trust(sessionCert) } : {}),
      },
      (res) => readAnswer(res, finish, cleanup, atLimit, ms),
    );
    cleanup(() => req.destroy());
    req.on("socket", (sock) => {
      whenOpen(sock, () => openedThenSilent(atLimit, ms, secure ? "the connection opened; the secure handshake did not finish" : "the connection opened; no HTTP status came"));
      if (secure) sock.once("secureConnect", () => openedThenSilent(atLimit, ms, "the secure connection opened; no HTTP status came"));
    });
    req.on("error", (e) => finish({ result: classifyError(codeOf(e)), code: codeOf(e), detail: "" }));
    req.end();
  });
}

/** An HTTP GET / over a Unix socket (package J3, group U). */
function unixHttpAttempt(op, ms) {
  return withLimit(ms, (finish, cleanup, atLimit) => {
    const req = http.request({ socketPath: op.path, path: "/", method: "GET", agent: false, headers: { host: "socket", "user-agent": "isolation-probe", connection: "close" } }, (res) =>
      readAnswer(res, finish, cleanup, atLimit, ms),
    );
    cleanup(() => req.destroy());
    req.on("socket", () => openedThenSilent(atLimit, ms, "the socket opened; no HTTP status came"));
    req.on("error", (e) => finish({ result: classifyError(codeOf(e)), code: codeOf(e), detail: "" }));
    req.end();
  });
}

function httpViaProxyAttempt(op, ms) {
  return withLimit(ms, (finish, cleanup, atLimit) => {
    const url = new URL(op.url);
    const req = http.request(
      { host: op.proxy.host, port: op.proxy.port, path: op.url, method: "GET", agent: false, headers: { host: url.host, "user-agent": "isolation-probe", connection: "close" } },
      (res) => readAnswer(res, finish, cleanup, atLimit, ms),
    );
    cleanup(() => req.destroy());
    req.on("socket", (sock) => whenOpen(sock, () => openedThenSilent(atLimit, ms, "the connection to the proxy opened; no HTTP status came")));
    req.on("error", (e) => finish({ result: classifyError(codeOf(e)), code: codeOf(e), detail: "" }));
    req.end();
  });
}

/**
 * Ask a proxy to open a tunnel; `then(socket)` continues once it answers 200. A proxy that closes the
 * connection before a whole answer has its own result, at once, not "timed out" at the limit. Once the
 * connection to the proxy opened, and again once it answered 200, the limit gives OPENED_THEN_SILENT.
 */
function tunnel(op, finish, cleanup, then, atLimit, ms) {
  const s = net.connect({ host: op.proxy.host, port: op.proxy.port });
  cleanup(() => s.destroy());
  let buf = Buffer.alloc(0);
  const closed = () => finish({ result: "proxy closed without an answer", code: "PROXY_CLOSED", detail: buf.length ? "part of an answer came first" : "" });
  const onData = (d) => {
    buf = Buffer.concat([buf, d]);
    const end = buf.indexOf("\r\n\r\n");
    if (end < 0) return;
    s.off("data", onData);
    s.off("end", closed);
    s.off("close", closed);
    const head = buf.subarray(0, end).toString("latin1");
    const status = Number((/^HTTP\/1\.[01] (\d{3})/.exec(head) ?? [])[1] ?? 0);
    const rest = buf.subarray(end + 4).toString("utf8");
    if (status !== 200 || !then) {
      finish({ result: status ? `proxy answered ${status}` : "not an HTTP answer", code: status ? null : "BAD_ANSWER", detail: status >= 400 && rest ? `says: "${oneLine(rest)}"` : "" });
      return;
    }
    openedThenSilent(atLimit, ms, "the proxy answered 200 to the CONNECT; nothing came back inside the tunnel");
    then(s);
  };
  s.on("data", onData);
  s.on("end", closed);
  s.on("close", closed);
  s.on("connect", () => {
    openedThenSilent(atLimit, ms, "the connection to the proxy opened; it did not answer the CONNECT");
    s.write(`CONNECT ${op.target} HTTP/1.1\r\nHost: ${op.target}\r\nUser-Agent: isolation-probe\r\n\r\n`);
  });
  s.on("error", (e) => finish({ result: classifyError(codeOf(e)), code: codeOf(e), detail: "the proxy itself could not be reached" }));
}

function connectAttempt(op, ms) {
  return withLimit(ms, (finish, cleanup, atLimit) => tunnel(op, finish, cleanup, null, atLimit, ms));
}

function httpsTunnelAttempt(op, ms, sessionCert) {
  return withLimit(ms, (finish, cleanup, atLimit) =>
    tunnel({ ...op, target: `${op.host}:${op.port}` }, finish, cleanup, (socket) => {
      // No agent: with none, Node writes the request over the socket `createConnection` returns, which is
      // TLS inside the proxy's tunnel. With `agent: false` it would make a fresh agent, which ignores
      // `createConnection` and opens a new, direct connection to host:port (review of 0.6a, finding 8).
      // `servername` and the trusted certificates are also given here, as before; with no agent they are
      // not used, and the TLS socket below carries its own.
      const req = https.request(
        {
          host: op.host,
          port: op.port,
          path: op.path,
          method: "GET",
          servername: op.host,
          ...trust(sessionCert),
          createConnection: () => {
            const inside = tls.connect({ socket, servername: op.host, ...trust(sessionCert) });
            inside.once("secureConnect", () =>
              openedThenSilent(atLimit, ms, "the proxy answered 200 to the CONNECT and the secure connection inside the tunnel opened; no HTTP status came"),
            );
            return inside;
          },
          headers: { host: op.host, "user-agent": "isolation-probe", connection: "close" },
        },
        (res) => readAnswer(res, finish, cleanup, atLimit, ms),
      );
      cleanup(() => req.destroy());
      req.on("error", (e) => finish({ result: classifyError(codeOf(e)), code: codeOf(e), detail: "the proxy answered 200; the error came after" }));
      req.end();
    }, atLimit, ms),
  );
}

function lookupAttempt(op, ms) {
  return withLimit(ms, (finish) => {
    dns.lookup(op.name, { all: true }, (err, addresses) => {
      if (err) finish({ result: classifyError(codeOf(err), "lookup"), code: codeOf(err), detail: "" });
      else finish({ result: `found ${addresses.length} address${addresses.length === 1 ? "" : "es"}`, code: null, detail: addresses.slice(0, 3).map((a) => a.address).join(", ") });
    });
  });
}

function resolveAttempt(op, ms) {
  return withLimit(ms, (finish) => {
    const r = new dns.promises.Resolver({ timeout: Math.max(100, ms - 500), tries: 1 });
    r.setServers([op.server]);
    r.resolve4(op.name).then(
      (addresses) => finish({ result: `found ${addresses.length} address${addresses.length === 1 ? "" : "es"}`, code: null, detail: addresses.slice(0, 3).join(", ") }),
      (err) => finish({ result: classifyError(codeOf(err), "lookup"), code: codeOf(err), detail: "" }),
    );
  });
}

export async function runAttempt(a, s, sessionCert) {
  const ms = s.timeoutMs;
  switch (a.op.type) {
    case "tcp":
      return tcpAttempt(a.op, ms);
    case "http":
      return httpAttempt(a.op, ms, false, null);
    case "https":
      return httpAttempt(a.op, ms, true, sessionCert);
    case "http-proxy":
      return httpViaProxyAttempt(a.op, ms);
    case "connect":
      return connectAttempt(a.op, ms);
    case "https-tunnel":
      return httpsTunnelAttempt(a.op, ms, sessionCert);
    case "lookup":
      return lookupAttempt(a.op, ms);
    case "resolve":
      return resolveAttempt(a.op, ms);
    case "unix-http":
      return unixHttpAttempt(a.op, ms);
    default:
      return { result: "error", code: "UNKNOWN_ATTEMPT", detail: a.op.type };
  }
}

const print = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const readOr = (p, fallback = "") => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return fallback;
  }
};

async function main() {
  if (!existsSync("/.dockerenv")) {
    print({ kind: "error", reason: "The isolation probe runs only inside a container; /.dockerenv is missing here." });
    process.exit(1);
  }
  let s;
  try {
    s = parseSettings(process.argv[2]);
  } catch (e) {
    print({ kind: "error", reason: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  }
  const ifaces = Object.entries(os.networkInterfaces())
    .map(([name, addrs]) => `${name} (${(addrs ?? []).map((a) => a.address).join(", ")})`)
    .join("; ");
  const resolv = readOr("/etc/resolv.conf")
    .split("\n")
    .filter((l) => /^\s*nameserver\s/.test(l))
    .map((l) => l.trim().split(/\s+/)[1])
    .join(", ");
  const tcp4 = readOr("/proc/net/tcp");
  const listeners = [...parseListeners(tcp4, 4), ...parseListeners(readOr("/proc/net/tcp6"), 6)];
  const sessionCert = SESSION_CERT_PATHS.find((p) => existsSync(p)) ?? null;
  print({ kind: "info", name: "user id", value: String(process.getuid?.() ?? "unknown") });
  print({ kind: "info", name: INTERFACES_UP, value: ifaces || "none" });
  print({ kind: "info", name: INTERFACES_ALL, value: listInterfaces() });
  print({ kind: "info", name: "name servers in /etc/resolv.conf", value: resolv || "none" });
  print({ kind: "info", name: "listening TCP ports seen in /proc/net", value: listeners.map((l) => `${l.address}:${l.port}`).sort().join(", ") || "none" });
  print({ kind: "info", name: "other TCP sockets seen, in any state (/proc/net/tcp)", value: String(countOtherSockets(tcp4)) });
  const udp = [...parseUdpBound(readOr("/proc/net/udp"), 4), ...parseUdpBound(readOr("/proc/net/udp6"), 6)];
  print({ kind: "info", name: "UDP sockets with no remote end, seen in /proc/net/udp", value: udp.map((l) => `${l.address}:${l.port}`).sort().join(", ") || "none" });
  const abstract = parseAbstractUnix(readOr("/proc/net/unix"));
  print({ kind: "info", name: "abstract Unix sockets seen in /proc/net/unix (listed only, not connected to)", value: abstract.slice(0, 20).join(", ") + (abstract.length > 20 ? `, and ${abstract.length - 20} more` : "") || "none" });
  const dockerSockets = ["/var/run/docker.sock", "/run/docker.sock"].filter((p) => existsSync(p));
  print({ kind: "info", name: "Docker's socket inside (/var/run/docker.sock, /run/docker.sock)", value: dockerSockets.join(", ") || "absent" });
  // Names only, never values: the app's container holds its database password and sign-in secret.
  print({ kind: "info", name: "settings that name a proxy or a certificate (names only)", value: Object.keys(process.env).filter((k) => /proxy|cert|_ca_/i.test(k)).sort().join(", ") || "none" });
  print({ kind: "info", name: "a copy of the session certificate inside", value: sessionCert ?? "none" });
  const routes = parseRoutes(readOr("/proc/net/route"));
  print({ kind: "info", name: ROUTES_INFO, value: routes.join("; ") || "none" });
  print({ kind: "info", name: DEFAULT_ROUTE_INFO, value: routes.some((r) => r.startsWith("to 0.0.0.0/0 ")) ? "yes" : "no" });
  print({ kind: "info", name: "packet forwarding (/proc/sys/net/ipv4/ip_forward)", value: readOr("/proc/sys/net/ipv4/ip_forward", "could not be read").trim() });
  print({ kind: "info", name: IPV6_INFO, value: ipv6State(existsSync("/proc/net/if_inet6") ? readOr("/proc/net/if_inet6") : null) });
  // example.com's address for B2 and B3: looked up here if the lookup works, otherwise the one given.
  const found = await withLimit(s.timeoutMs, (finish) =>
    dns.lookup("example.com", { family: 4 }, (err, address) => finish(err ? { code: codeOf(err) } : { address })),
  ).then((r) => (r.result === "timed out" ? { code: "TIMEOUT" } : r));
  if (found.address) s = { ...s, exampleAddress: found.address, exampleAddressLookedUp: true };
  print({
    kind: "info",
    name: "example.com's address used by B2 and B3",
    value: found.address ? `${found.address}, from a lookup inside this container` : `${s.exampleAddress}, as given in the settings: example.com could not be looked up here (${found.code})`,
  });

  const named = new Set([s.builderDbPort, s.gatewayPort, s.projectDbPort, s.egressPort, ...(s.sessionProxy ? [s.sessionProxy.port] : [])]);
  const seen = new Set();
  const extra = listeners
    .filter((l) => !named.has(l.port) && l.address !== "ipv6")
    .filter((l) => (seen.has(l.port) ? false : (seen.add(l.port), true)))
    .sort((x, y) => x.port - y.port);
  const plan = planAttempts(s, extra);
  for (const a of plan) {
    const r = await runAttempt(a, s, a.op.type === "https" || a.op.type === "https-tunnel" ? sessionCert : null);
    const how = (a.op.type === "https" || a.op.type === "https-tunnel") && sessionCert ? `${a.how}; trusting also ${sessionCert}` : a.how;
    print({ kind: "attempt", id: a.id, group: a.group, toward: a.toward, what: a.what, target: a.target, how, result: r.result, code: r.code, detail: r.detail });
  }
  print({ kind: "end", attempts: plan.length });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
