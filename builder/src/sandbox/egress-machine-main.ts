/**
 * The machine side of the development profile's door (package 0.6c): the project's `egress-host` service,
 * which runs on the machine's network, as an unprivileged user, from the builder's own code mounted
 * read-only, with the project's socket folder mounted at /sock. It starts:
 * 1. the builder's egress proxy, with the project's list (EGRESS_ALLOW), listening only on the Unix socket
 *    EGRESS_SOCKET (mode 600), which the door container forwards port 3128 to;
 * 2. a forwarder from the Unix socket GATEWAY_SOCKET (mode 600) to the model gateway at GATEWAY_TARGET, which
 *    must be on the machine's loopback address; the door forwards port 4010 to it;
 * 3. when EGRESS_BUILD_PORT is set, a second egress proxy for the image build, with its own list
 *    (EGRESS_BUILD_ALLOW, the package registry), listening on 127.0.0.1 only.
 * Both proxies go out only through the cloud session's proxy, EGRESS_UPSTREAM_PROXY. Missing, empty, "direct"
 * or malformed, it refuses to start (exit code 2), saying why: it never goes out directly. Nothing it listens
 * on has an address that a container on a bridge network can reach (127.0.0.1 and two files).
 */
import type http from "node:http";
import { createEgressProxy, listSetting, parseUpstream } from "./egress-proxy.js";
import { createForwarder, listenOnSocket, parseGatewayTarget } from "./forwarder.js";

const say = (o: object) => process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n");
const refuse = (why: string) => {
  say({ refusedToStart: why });
  process.exit(2);
};

let upstream: URL;
let gateway: { host: string; port: number };
try {
  upstream = parseUpstream(process.env.EGRESS_UPSTREAM_PROXY, { allowDirect: false })!;
  gateway = parseGatewayTarget(process.env.GATEWAY_TARGET);
} catch (err) {
  refuse((err as Error).message);
}
const egressSocket = process.env.EGRESS_SOCKET ?? "";
const gatewaySocket = process.env.GATEWAY_SOCKET ?? "";
if (!egressSocket.startsWith("/sock/") || !gatewaySocket.startsWith("/sock/")) refuse("EGRESS_SOCKET and GATEWAY_SOCKET must both be paths under /sock/.");
const buildPort = process.env.EGRESS_BUILD_PORT ? Number(process.env.EGRESS_BUILD_PORT) : 0;
if (!Number.isInteger(buildPort) || buildPort < 0 || buildPort > 65535) refuse("EGRESS_BUILD_PORT must be a port number.");

const allow = listSetting(process.env.EGRESS_ALLOW);
const proxy = createEgressProxy({ allow, upstreamProxy: upstream!.href });
await listenOnSocket(proxy, egressSocket);
say({ listening: egressSocket, kind: "egress proxy", allow, upstream: upstream!.host });

const gw = createForwarder(gatewaySocket, gateway!, (rec) => say(rec));
await listenOnSocket(gw, gatewaySocket);
say({ listening: gatewaySocket, kind: "gateway forwarder", to: `${gateway!.host}:${gateway!.port}` });

if (buildPort) {
  const buildAllow = listSetting(process.env.EGRESS_BUILD_ALLOW);
  const build: http.Server = createEgressProxy({ allow: buildAllow, upstreamProxy: upstream!.href, log: (r) => say({ ...r, listener: "build" }) });
  build.on("error", (e) => refuse(`the build's listener on 127.0.0.1:${buildPort} could not start: ${(e as NodeJS.ErrnoException).code ?? e.message}`));
  build.listen(buildPort, "127.0.0.1", () => say({ listening: `127.0.0.1:${buildPort}`, kind: "egress proxy for the image build", allow: buildAllow, upstream: upstream!.host }));
}
