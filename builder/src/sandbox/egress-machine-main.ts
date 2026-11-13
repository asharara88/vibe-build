/**
 * The entry point of the development profile's machine side (package 0.6c): the project's `egress-host`
 * service. What it starts, and what it refuses, is in `egress-machine.ts`. A setting it refuses, or a listener
 * that cannot start, stops it with exit code 2, saying why on one JSON line: it never goes out directly.
 */
import { startMachineSide } from "./egress-machine.js";

const say = (o: object) => process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n");
try {
  await startMachineSide(process.env, { socketFolder: "/sock/", say });
} catch (err) {
  say({ refusedToStart: (err as Error).message });
  process.exit(2);
}
