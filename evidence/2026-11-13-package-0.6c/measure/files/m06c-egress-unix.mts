// Package 0.6c, first step: the builder's own egress proxy (builder/src/sandbox/egress-proxy.ts, unchanged),
// started on a Unix socket instead of a TCP port, for option (a-prime). Not part of the builder.
// EGRESS_SOCKET: the socket's path. EGRESS_ALLOW and EGRESS_UPSTREAM_PROXY as in egress-main.ts.
// EGRESS_LOOPBACK_PORT (optional): a second listener of the same proxy on 127.0.0.1 only, for the image build
// (docker build --network host), with its own list EGRESS_LOOPBACK_ALLOW. It refuses to start without an upstream.
import { rmSync } from "node:fs";
import { createEgressProxy } from "/builder/src/sandbox/egress-proxy.ts";
const say = (o: object) => console.log(JSON.stringify({ at: new Date().toISOString(), ...o }));
const path = process.env.EGRESS_SOCKET ?? "";
if (!path.startsWith("/")) { say({ refusedToStart: "EGRESS_SOCKET must be an absolute path" }); process.exit(2); }
const upstreamProxy = process.env.EGRESS_UPSTREAM_PROXY ?? "";
try { const u = new URL(upstreamProxy); if (!u.hostname || !u.port) throw new Error(); } catch { say({ refusedToStart: "EGRESS_UPSTREAM_PROXY is missing or is not a proxy address with a host and a port" }); process.exit(2); }
const list = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const allow = list(process.env.EGRESS_ALLOW);
const server = createEgressProxy({ allow, upstreamProxy });
rmSync(path, { force: true });
server.listen(path, () => say({ listening: path, allow, umask: process.umask().toString(8) }));
const lp = Number(process.env.EGRESS_LOOPBACK_PORT ?? 0);
if (lp) {
  const lallow = list(process.env.EGRESS_LOOPBACK_ALLOW);
  createEgressProxy({ allow: lallow, upstreamProxy }).listen(lp, "127.0.0.1", () => say({ listening: `127.0.0.1:${lp}`, allow: lallow }));
}
