/**
 * Proof row B6, with the first gateway run as a process of its own: a gateway that is stopped
 * cleanly while one of its calls is still waiting on the provider, so that call's hold is left open
 * in the database. Started with `node --import tsx test/b6-gateway-process.ts` (from `builder/`) by
 * the test "B6: a gateway process that stops cleanly ..." in test/gateway.test.ts and by section B6
 * of scripts/demo-cap.ts. Design note 7.2, row B6; build plan package 1.2.
 *
 * It is built from the gateway's own parts (createGateway and the database store), not from the
 * gateway's start-up file src/gateway/main.ts, which has no stop routine of its own. It does not
 * look for open holds when it starts: in row B6 that is the part of the gateway started after it.
 *
 * Settings, from the environment (all made up for the run; there is no real key):
 *   BUILDER_TEST_DATABASE_URL  the test database
 *   B6_UPSTREAM_URL            the stand-in provider the gateway forwards to
 *   B6_GATEWAY_ID              the name the gateway writes on the holds it opens
 *   B6_MODEL_KEY               the made-up key the gateway holds (never printed)
 *   B6_GRACE_MS                how long a call in progress is given to end once the stop begins (default 300)
 *
 * What it prints, one JSON object per line on its standard output:
 *   {"listening":"<address>"}                         once it takes calls
 *   {"stopping":{"calls_in_progress":<n>}}            when it is told to stop (the signal SIGTERM), once its server is closed to new connections
 *   {"stopped":{"calls_in_progress":<n>, ...}}        last, just before it exits with code 0
 *   {"fault":"<message>"}                             if the gateway raises a fault
 * Every value in "stopped" is read at that moment, none is written in: whether every connection had
 * ended within the grace period, whether the server still listens for connections, and how many
 * database connections the pool still holds.
 *
 * How it stops, on SIGTERM: it stops taking new calls (its server is closed to new connections, so
 * a call sent after "stopping" has its connection refused; the B6 test sends one), gives the calls in
 * progress B6_GRACE_MS to end, closes its database connections, and exits with code 0. A call that
 * has not ended by then is not ended by the gateway: nothing more is written for it, and its hold
 * stays open in the database.
 */
import { serve } from "@hono/node-server";
import { createGateway } from "../src/gateway/app.js";
import { createPool } from "../src/store/db.js";

const say = (o: Record<string, unknown>, then?: () => void) => process.stdout.write(JSON.stringify(o) + "\n", then);
const need = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    say({ error: `${name} is not set` }, () => process.exit(2));
    throw new Error(`${name} is not set`);
  }
  return v;
};

const pool = createPool(need("BUILDER_TEST_DATABASE_URL"));
const gatewayId = need("B6_GATEWAY_ID");
const graceMs = Number(process.env.B6_GRACE_MS ?? 300);
const app = createGateway({ pool, modelApiKey: need("B6_MODEL_KEY"), upstreamUrl: need("B6_UPSTREAM_URL"), gatewayId, onFault: (m) => say({ fault: m }) });

let inProgress = 0;
const server = serve(
  {
    fetch: async (request, env) => {
      inProgress++;
      try {
        return await app.fetch(request, env);
      } finally {
        inProgress--;
      }
    },
    port: 0,
    hostname: "127.0.0.1",
  },
  (info) => say({ listening: `http://127.0.0.1:${info.port}`, gateway: gatewayId }),
);

process.once("SIGTERM", () => {
  void (async () => {
    // Closed to new connections at once; the callback comes only once every open connection has ended.
    // "stopping" is printed after the close has begun, so a call sent on reading it meets a closed server.
    const everyConnectionEnded = new Promise<boolean>((resolve) => server.close(() => resolve(true)));
    say({ stopping: { calls_in_progress: inProgress } });
    const allEnded = await Promise.race([everyConnectionEnded, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), graceMs))]);
    await pool.end();
    say({ stopped: { calls_in_progress: inProgress, every_connection_ended: allEnded, still_listening: server.listening, database_connections_open: pool.totalCount } }, () => process.exit(0));
  })();
});
