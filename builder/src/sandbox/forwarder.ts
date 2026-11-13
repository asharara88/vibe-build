/**
 * Byte forwarders for the development profile's door (package 0.6c; design note 2.5, amendment of 13 Nov
 * 2026; evidence/2026-11-13-package-0.6c/measurements.md, item 9).
 *
 * The project's containers sit on internal networks with no address on the machine and no route out.
 * Their only way out is a small "door" container on the project's `out` network, named `egress`, which
 * hands each connection, byte for byte, to a Unix socket in the project's socket folder on the machine.
 * There the builder's egress proxy listens (port 3128 at the door), and a second forwarder passes the other
 * socket on to the model gateway on the machine's loopback address (port 4010 at the door). The forwarders
 * read nothing and change nothing: the egress proxy decides what may pass, and the gateway asks for a
 * project's token. Each connection is logged as one JSON line, with where it came from.
 */
import { chmodSync, rmSync } from "node:fs";
import net from "node:net";
import { isAbsolute } from "node:path";

export type ForwardTarget = { path: string } | { host: string; port: number };

export interface ForwardRecord {
  at: string;
  /** What this forwarder listens on: a port or a socket's path. */
  listen: string;
  /** Where the connection came from, as the listening side sees it ("socket" for a Unix socket). */
  from: string;
  /** Where it was passed on to. */
  to: string;
  decision: "forwarded" | "error";
  detail?: string;
}

const describe = (t: ForwardTarget) => ("path" in t ? t.path : `${t.host}:${t.port}`);

/** A server that passes every connection on to `target`, both ways, and logs each one. */
export function createForwarder(listen: string, target: ForwardTarget, log: (r: ForwardRecord) => void): net.Server {
  return net.createServer((client) => {
    const from = client.remoteAddress ?? "socket";
    const record = (decision: ForwardRecord["decision"], detail?: string) =>
      log({ at: new Date().toISOString(), listen, from, to: describe(target), decision, ...(detail ? { detail } : {}) });
    const up = net.connect(target as net.NetConnectOpts);
    let opened = false;
    up.on("connect", () => {
      opened = true;
      record("forwarded");
      client.pipe(up);
      up.pipe(client);
    });
    up.on("error", (e: NodeJS.ErrnoException) => {
      record("error", `${opened ? "after" : "before"} the connection to ${describe(target)} opened: ${e.code ?? e.message}`);
      client.destroy();
    });
    client.on("error", () => up.destroy());
    client.on("close", () => up.destroy());
    up.on("close", () => client.destroy());
  });
}

/**
 * Listen on a Unix socket at `path`, readable and writable by its owner only (mode 600): connecting to a
 * Unix socket needs write permission on it, so only the user the door runs as can connect. A file left at
 * the path by an earlier run is removed first.
 */
export function listenOnSocket(server: net.Server, path: string): Promise<void> {
  if (!isAbsolute(path)) return Promise.reject(new Error(`A socket's path must be absolute: ${path}`));
  // Linux keeps at most 107 bytes of a socket's path; a longer one would be cut short without a word.
  if (Buffer.byteLength(path) > 107) return Promise.reject(new Error(`A socket's path must be at most 107 bytes: ${path}`));
  rmSync(path, { force: true });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      chmodSync(path, 0o600);
      resolve();
    });
  });
}

/** The machine's loopback addresses: the only places the gateway forwarder will pass connections to. */
export const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1"];

/**
 * The gateway's address on the machine, "host:port", checked: the host must be a loopback address, so that
 * the gateway forwarder can never be pointed at anything but the machine's own gateway. Throws otherwise.
 */
export function parseGatewayTarget(value: string | undefined): { host: string; port: number } {
  const m = /^(\[::1\]|127\.0\.0\.1|localhost|::1):(\d{1,5})$/.exec((value ?? "").trim());
  const port = m ? Number(m[2]) : 0;
  if (!m || port < 1 || port > 65535) throw new Error("The gateway's address (GATEWAY_TARGET) must be host:port on the machine's loopback address (127.0.0.1, localhost or ::1).");
  return { host: m[1]!.replace(/^\[|\]$/g, ""), port };
}

/** The door's routes, "port=socket path,port=socket path": each an absolute path under `/sock/`. Throws on anything else. */
export function parseDoorRoutes(value: string | undefined): Array<{ port: number; socket: string }> {
  const routes = (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (routes.length === 0) throw new Error("The door has no routes (DOOR_ROUTES is empty).");
  return routes.map((r) => {
    const m = /^(\d{1,5})=(\/sock\/[a-z0-9-]{1,40}\.sock)$/.exec(r);
    const port = m ? Number(m[1]) : 0;
    if (!m || port < 1 || port > 65535) throw new Error(`A door route must be "port=/sock/name.sock": ${r}`);
    return { port, socket: m[2]! };
  });
}
