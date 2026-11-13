// Package 0.6c, first step: builds the probe's attempt list from the machine reading (02c-...txt) on stdin.
// G: every machine IPv4 address x every listening port (the machine has no IPv6: no /proc/net/if_inet6).
// Plus outside attempts (A, B), name lookups (D), the egress proxy (E), the gateway routes (W), the relay
// directly (R), and the project's own peers (P). Settings: argv[2] = the relay's address (option a) or "none".
import { readFileSync } from "node:fs";
const text = readFileSync(0, "utf8");
const addrs = [...text.matchAll(/inet (\d+\.\d+\.\d+\.\d+)\//g)].map((m) => m[1]);
const ports = [...new Set([...text.matchAll(/^[\d.]+:(\d+)$/gm)].map((m) => Number(m[1])))].sort((a, b) => a - b);
const relay = process.argv[2] ?? "none";
const A = [];
for (const h of addrs) for (const p of ports) A.push({ id: `G ${h}:${p}`, type: "tcp", host: h, port: p, what: "a machine address and a port that listens on the machine" });
A.push({ id: "A2", type: "http", url: "http://registry.npmjs.org/-/ping", what: "outside, by name, plain HTTP, no proxy" });
A.push({ id: "A4", type: "http", url: "http://example.com/", what: "outside, refused host, plain HTTP, no proxy" });
A.push({ id: "B1", type: "tcp", host: "1.1.1.1", port: 443, what: "outside address, TCP 443" });
A.push({ id: "B4", type: "http", url: "http://169.254.169.254/", what: "the cloud's machine-information address" });
A.push({ id: "D1", type: "lookup", name: "registry.npmjs.org", what: "allowed outside name, the container's resolver" });
A.push({ id: "D2", type: "lookup", name: "example.com", what: "refused outside name, the container's resolver" });
A.push({ id: "D3", type: "lookup", name: "db", what: "the project's database by service name" });
A.push({ id: "D5", type: "resolve", name: "registry.npmjs.org", server: "1.1.1.1", what: "allowed name, asking 1.1.1.1 directly (UDP 53)" });
A.push({ id: "D6", type: "resolve", name: "registry.npmjs.org", server: "127.0.0.11", what: "asking Docker's own name server directly" });
A.push({ id: "E2", type: "connect", proxy: "egress:3128", target: "registry.npmjs.org:443", https: true, path: "/-/ping", what: "through the egress proxy: tunnel, then HTTPS GET, no session certificate" });
A.push({ id: "E3", type: "connect", proxy: "egress:3128", target: "example.com:443", what: "through the egress proxy: a refused host" });
A.push({ id: "E4", type: "http", url: "http://registry.npmjs.org/-/ping", connectHost: "egress", connectPort: 3128, proxied: true, what: "through the egress proxy: plain HTTP, allowed host" });
A.push({ id: "E5", type: "http", url: "http://example.com/", connectHost: "egress", connectPort: 3128, proxied: true, what: "through the egress proxy: plain HTTP, refused host" });
A.push({ id: "W1", type: "http", url: "http://egress:4010/v1/ping", what: "the gateway through the egress container's fixed port" });
A.push({ id: "W2", type: "http", url: "http://gateway.internal:4010/v1/ping", connectHost: "egress", connectPort: 3128, proxied: true, what: "the gateway by proxy semantics (gateway.internal through the egress proxy)" });
if (relay !== "none") {
  A.push({ id: "R1", type: "connect", proxy: `${relay}:13128`, target: "registry.npmjs.org:443", https: true, path: "/-/ping", what: "the relay's session-proxy port directly (not through the egress proxy)" });
  A.push({ id: "R2", type: "http", url: `http://${relay}:14010/v1/ping`, what: "the relay's gateway port directly" });
}
A.push({ id: "P1", type: "tcp", host: "db", port: 5432, what: "the project's database" });
A.push({ id: "P2", type: "http", url: "http://app:3000/en/sign-in", what: "the project's app, sign-in page" });
A.push({ id: "P3", type: "tcp", host: "egress", port: 3128, what: "the project's egress proxy" });
process.stdout.write(JSON.stringify(A));
