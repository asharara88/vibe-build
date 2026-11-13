/**
 * The door container's entry point (development profile, package 0.6c). It runs in the project's `egress`
 * service, on the project's internal `out` network only, as an unprivileged user, with the project's socket
 * folder mounted read-only at /sock. For each route in DOOR_ROUTES ("3128=/sock/egress.sock,4010=/sock/
 * gateway.sock") it listens on that port inside its own container and passes each connection to that socket.
 * A route that is not of that form stops it before it listens. See forwarder.ts.
 */
import { createForwarder, parseDoorRoutes } from "./forwarder.js";

const say = (o: object) => process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n");
let routes: ReturnType<typeof parseDoorRoutes>;
try {
  routes = parseDoorRoutes(process.env.DOOR_ROUTES);
} catch (err) {
  say({ refusedToStart: (err as Error).message });
  process.exit(2);
}
for (const r of routes) {
  const server = createForwarder(String(r.port), { path: r.socket }, (rec) => say(rec));
  server.on("error", (e) => {
    say({ listenError: `${r.port}: ${(e as NodeJS.ErrnoException).code ?? e.message}` });
    process.exit(3);
  });
  server.listen(r.port, "0.0.0.0", () => say({ listening: r.port, to: r.socket }));
}
