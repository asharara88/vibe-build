/**
 * The machine side of the development profile's door (package 0.6c): the project's `egress-host` service,
 * which runs on the machine's network, as an unprivileged user, from the builder's own code mounted
 * read-only, with the project's socket folder mounted at /sock. `egress-machine-main.ts` is its entry point;
 * this module holds what it starts, so that a test can start it against a made-up upstream (package 0.6c,
 * after its review). It starts:
 * 1. the builder's egress proxy, with the project's list (EGRESS_ALLOW), listening only on the Unix socket
 *    EGRESS_SOCKET (mode 600), which the door container forwards port 3128 to;
 * 2. a forwarder from the Unix socket GATEWAY_SOCKET (mode 600) to the model gateway at GATEWAY_TARGET, which
 *    must be on the machine's loopback address; the door forwards port 4010 to it;
 * 3. when EGRESS_BUILD_PORT is set, a second egress proxy for the image build, with its own list
 *    (EGRESS_BUILD_ALLOW, the package registry), listening on 127.0.0.1 only.
 * Both proxies go out only through the cloud session's proxy, EGRESS_UPSTREAM_PROXY. Missing, empty, "direct"
 * or malformed, it refuses to start, saying why: it never goes out directly. Nothing it listens on has an
 * address that a container on a bridge network can reach (127.0.0.1 and two files).
 */
import type http from "node:http";
import type net from "node:net";
import { createEgressProxy, listSetting, parseUpstream } from "./egress-proxy.js";
import { createForwarder, listenOnSocket, parseGatewayTarget } from "./forwarder.js";

export interface MachineSide {
  proxy: http.Server;
  gateway: net.Server;
  build: http.Server | null;
}

/**
 * Check the settings and start the machine side's listeners. Throws, saying why, on any setting it refuses or
 * any listener that cannot start. `socketFolder` is the folder both sockets must be in: "/sock/" in the
 * `egress-host` container, where the project's socket folder is mounted.
 */
export async function startMachineSide(env: NodeJS.ProcessEnv, opts: { socketFolder: string; say: (o: object) => void }): Promise<MachineSide> {
  const { socketFolder, say } = opts;
  const upstream = parseUpstream(env.EGRESS_UPSTREAM_PROXY, { allowDirect: false })!;
  const gatewayTarget = parseGatewayTarget(env.GATEWAY_TARGET);
  const egressSocket = env.EGRESS_SOCKET ?? "";
  const gatewaySocket = env.GATEWAY_SOCKET ?? "";
  if (!egressSocket.startsWith(socketFolder) || !gatewaySocket.startsWith(socketFolder)) throw new Error(`EGRESS_SOCKET and GATEWAY_SOCKET must both be paths under ${socketFolder}.`);
  const buildPort = env.EGRESS_BUILD_PORT ? Number(env.EGRESS_BUILD_PORT) : 0;
  if (!Number.isInteger(buildPort) || buildPort < 0 || buildPort > 65535) throw new Error("EGRESS_BUILD_PORT must be a port number.");

  const allow = listSetting(env.EGRESS_ALLOW);
  const proxy = createEgressProxy({ allow, upstreamProxy: upstream.href });
  await listenOnSocket(proxy, egressSocket);
  say({ listening: egressSocket, kind: "egress proxy", allow, upstream: upstream.host });

  const gateway = createForwarder(gatewaySocket, gatewayTarget, (rec) => say(rec));
  await listenOnSocket(gateway, gatewaySocket);
  say({ listening: gatewaySocket, kind: "gateway forwarder", to: `${gatewayTarget.host}:${gatewayTarget.port}` });

  let build: http.Server | null = null;
  if (buildPort) {
    const buildAllow = listSetting(env.EGRESS_BUILD_ALLOW);
    const b = createEgressProxy({ allow: buildAllow, upstreamProxy: upstream.href, log: (r) => say({ ...r, listener: "build" }) });
    await new Promise<void>((resolve, reject) => {
      b.once("error", (e) => reject(new Error(`the build's listener on 127.0.0.1:${buildPort} could not start: ${(e as NodeJS.ErrnoException).code ?? e.message}`)));
      b.listen(buildPort, "127.0.0.1", () => resolve());
    });
    say({ listening: `127.0.0.1:${buildPort}`, kind: "egress proxy for the image build", allow: buildAllow, upstream: upstream.host });
    build = b;
  }
  return { proxy, gateway, build };
}
