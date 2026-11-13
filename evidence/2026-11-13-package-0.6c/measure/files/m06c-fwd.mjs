// Package 0.6c, first step: a throwaway byte forwarder. Not part of the builder.
// FWD_LISTEN and FWD_TARGET are each "host:port" or an absolute Unix socket path.
// FWD_MODE (optional, for a socket it creates): e.g. "660". Logs one JSON line per connection.
import { chmodSync, rmSync } from "node:fs";
import net from "node:net";
const log = (o) => process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n");
const parse = (v) => (v.startsWith("/") ? { path: v } : { host: v.slice(0, v.lastIndexOf(":")), port: Number(v.slice(v.lastIndexOf(":") + 1)) });
const L = process.env.FWD_LISTEN, T = process.env.FWD_TARGET;
if (!L || !T) { log({ refusedToStart: "FWD_LISTEN and FWD_TARGET must both be set" }); process.exit(2); }
const target = parse(T);
const srv = net.createServer((c) => {
  log({ accepted: c.remoteAddress ?? "unix", to: T });
  const up = net.connect(target);
  c.pipe(up); up.pipe(c);
  up.on("error", (e) => { log({ targetError: e.code }); c.destroy(); });
  c.on("error", () => up.destroy());
});
srv.on("error", (e) => { log({ listenError: e.code ?? e.message }); process.exit(3); });
const l = parse(L);
if (l.path) { rmSync(l.path, { force: true }); srv.listen(l.path, () => { if (process.env.FWD_MODE) chmodSync(l.path, parseInt(process.env.FWD_MODE, 8)); log({ listening: L, to: T }); }); }
else srv.listen(l.port, l.host, () => log({ listening: L, to: T }));
