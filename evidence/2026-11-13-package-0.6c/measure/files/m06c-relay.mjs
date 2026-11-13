// Package 0.6c, first step: a throwaway prototype of the draft's relay (option a). Not part of the builder.
// Runs in a container with the host's network. Node's own modules only.
//
// RELAY_LISTEN   the address to listen on (ext's address on the machine), e.g. 10.231.60.1
// RELAY_ROUTES   "listenPort>target" pairs, comma separated; the target "session" means the session proxy's
//                host and port, read from HTTPS_PROXY (host and port only; never printed with anything else)
// RELAY_ALLOW    the source addresses accepted, comma separated, or "any" (the variant without the check)
// It refuses to start without HTTPS_PROXY, with an empty or unreadable one, or with no RELAY_ALLOW.
// One JSON line per connection: its source, and whether it was accepted.
import net from "node:net";

const log = (o) => process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n");
const fail = (reason) => {
  log({ refusedToStart: reason });
  process.exit(2);
};
let session;
try {
  const u = new URL(process.env.HTTPS_PROXY ?? "");
  if (!u.hostname || !u.port) throw new Error("no host or port");
  session = { host: u.hostname, port: Number(u.port) };
} catch {
  fail("HTTPS_PROXY is missing or is not a proxy address with a host and a port");
}
const listen = process.env.RELAY_LISTEN;
if (!listen) fail("RELAY_LISTEN is not set");
const allowRaw = (process.env.RELAY_ALLOW ?? "").trim();
if (!allowRaw) fail("RELAY_ALLOW is not set (a list of source addresses, or any)");
const allow = allowRaw === "any" ? null : new Set(allowRaw.split(",").map((s) => s.trim()));
const routes = (process.env.RELAY_ROUTES ?? "").split(",").filter(Boolean).map((r) => {
  const [lp, target] = r.split(">");
  if (target === "session") return { port: Number(lp), host: session.host, tport: session.port, name: "session proxy" };
  const [h, p] = target.split(":");
  return { port: Number(lp), host: h, tport: Number(p), name: `${h}:${p}` };
});
for (const r of routes) {
  const srv = net.createServer((c) => {
    const src = (c.remoteAddress ?? "").replace(/^::ffff:/, "");
    if (allow && !allow.has(src)) {
      log({ port: r.port, source: src, decision: "refused: source not allowed" });
      c.destroy();
      return;
    }
    log({ port: r.port, source: src, decision: `accepted, forwarded to ${r.name}` });
    const up = net.connect({ host: r.host, port: r.tport });
    c.pipe(up);
    up.pipe(c);
    up.on("error", () => c.destroy());
    c.on("error", () => up.destroy());
  });
  srv.on("error", (e) => {
    log({ port: r.port, listenError: e.code ?? e.message });
    process.exit(3);
  });
  srv.listen(r.port, listen, () => log({ listening: `${listen}:${r.port}`, to: r.name, sourceCheck: allow ? [...allow] : "none (any source)" }));
}
