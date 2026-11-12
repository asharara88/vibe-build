/**
 * Package 0.5: the tools container receives a named list of settings, never the host's environment.
 *
 * A stand-in seed step (a few lines of Node, run in the tools container exactly as the seed is run)
 * prints the NAMES in its environment and, for each, a SHA-256 fingerprint of its value, never the
 * value itself. The check then requires, every time:
 *  - the names inside are exactly: the named list the builder gave, the names the tools image itself
 *    declares (read from `docker image inspect`), and HOSTNAME and HOME, which Docker sets in every
 *    container;
 *  - each named setting holds exactly the value the builder chose to give it, and each of the image's
 *    own settings holds the image's value (compared by fingerprint). HOSTNAME and HOME are not compared:
 *    Docker sets them per container.
 * So a builder setting cannot be inside under any name, its own or one on the list.
 *
 * It is run twice:
 *  1. through `sandbox.runOnce`, the way the demonstration runs the real seed;
 *  2. through `docker compose run` given this process's whole environment plus made-up values for every
 *     setting the builder reads, to show that the compose file alone copies nothing in. In this run
 *     only, the stand-in also reports which of the made-up values it finds in any value.
 */
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { dockerEnv, sandbox, type Sandbox } from "../src/sandbox/manager.js";

const run = promisify(execFile);

/** Every setting the builder's own code reads (grep of process.env in builder/src and builder/scripts, 12 Nov 2026). */
export const BUILDER_SETTINGS = [
  "BUILDER_DATABASE_URL",
  "BUILDER_TEST_DATABASE_URL",
  "BUILDER_MODEL_API_KEY",
  "BUILDER_GATEWAY_HOST",
  "BUILDER_GATEWAY_PORT",
  "BUILDER_UPSTREAM_URL",
  "EGRESS_ALLOW",
  "EGRESS_PORT",
  "EGRESS_UPSTREAM_PROXY",
  "HTTPS_PROXY",
  "PGUSER",
];
/** Also given made-up values in run 2: the other common proxy name, and a name no code reads. */
export const OTHER_MARKED = ["HTTP_PROXY", "BUILDER_TOOLS_CHECK_MARKER"];

/** The stand-in seed step: names and value fingerprints, and which markers (given as arguments) appear in any value. */
const PRINT_ENV = [
  "const { createHash } = require('node:crypto');",
  "const fp = (v) => createHash('sha256').update(String(v)).digest('hex');",
  "const markers = process.argv.slice(1);",
  "const entries = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, fp(v)]));",
  "const values = Object.values(process.env);",
  "console.log(JSON.stringify({ entries, found: markers.filter((m) => values.some((v) => (v ?? '').includes(m))) }));",
].join(" ");

const fingerprint = (v: string) => createHash("sha256").update(v).digest("hex");

interface Seen {
  entries: Record<string, string>;
  found: string[];
}

function parse(stdout: string): Seen {
  const line = stdout.trim().split("\n").pop() ?? "";
  const seen = JSON.parse(line) as Seen;
  if (!seen || typeof seen.entries !== "object" || seen.entries === null || !Array.isArray(seen.found)) {
    throw new Error("the stand-in step's output could not be read");
  }
  return seen;
}

async function imageEnv(sb: Sandbox, image: string): Promise<Record<string, string>> {
  const { stdout } = await run("docker", ["image", "inspect", image, "--format", "{{json .Config.Env}}"], { env: dockerEnv(sb) });
  return Object.fromEntries((JSON.parse(stdout) as string[]).map((e) => [e.slice(0, e.indexOf("=")), e.slice(e.indexOf("=") + 1)]));
}

/**
 * `given` holds the values the builder chose to give the tools container, by name. Its names must be
 * exactly the sandbox's named list. Values are only fingerprinted here; none is printed.
 */
export async function checkToolsEnv(sb: Sandbox, given: Record<string, string>): Promise<{ passed: boolean; lines: string[] }> {
  if (!sb.appBuild || !sb.toolsEnvNames) throw new Error("This sandbox has no tools container.");
  const named = sb.toolsEnvNames;
  if (JSON.stringify(Object.keys(given).sort()) !== JSON.stringify(named)) throw new Error("the values given do not match the sandbox's named list");
  const own = await imageEnv(sb, sb.appBuild.toolsImage);
  const expected: Record<string, string> = {};
  for (const [k, v] of Object.entries(own)) expected[k] = fingerprint(v);
  for (const [k, v] of Object.entries(given)) expected[k] = fingerprint(v);
  const setByDocker = ["HOSTNAME", "HOME"];
  const allowed = new Set([...Object.keys(expected), ...setByDocker]);

  const markers: Record<string, string> = {};
  for (const name of [...BUILDER_SETTINGS, ...OTHER_MARKED]) markers[name] = `made-up-marker-${randomBytes(8).toString("hex")}`;
  const markerValues = Object.values(markers);

  const lines: string[] = [];
  lines.push(`Named list (${named.length}): ${named.join(", ")}`);
  lines.push(`Declared by the tools image itself (${Object.keys(own).length}): ${Object.keys(own).sort().join(", ")}`);
  lines.push(`Set by Docker in every container, names only: ${setByDocker.join(", ")}`);

  const first = parse(await sandbox.runOnce(sb, "tools", ["node", "-e", PRINT_ENV]));
  const fullEnv = { ...process.env, ...markers, ...dockerEnv(sb) };
  const second = parse(
    (
      await run("docker", ["compose", "-f", sb.composeFile, "--profile", "tools", "run", "--rm", "--no-deps", "-T", "tools", "node", "-e", PRINT_ENV, ...markerValues], {
        env: fullEnv,
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
      })
    ).stdout,
  );

  let passed = true;
  const runs = [
    { label: "1. As the seed is run (sandbox.runOnce)", seen: first, markersChecked: false },
    {
      label: `2. Compose given this process's whole environment (${Object.keys(fullEnv).length} settings, including made-up values for the builder's ${BUILDER_SETTINGS.length} settings, ${OTHER_MARKED.join(" and ")})`,
      seen: second,
      markersChecked: true,
    },
  ];
  for (const { label, seen, markersChecked } of runs) {
    const names = Object.keys(seen.entries).sort();
    const extra = names.filter((n) => !allowed.has(n));
    const missing = Object.keys(expected).filter((n) => !(n in seen.entries));
    const wrongValue = Object.keys(expected).filter((n) => n in seen.entries && seen.entries[n] !== expected[n]);
    const builderNames = names.filter((n) => BUILDER_SETTINGS.includes(n) || OTHER_MARKED.includes(n) || n.startsWith("BUILDER_"));
    const ok =
      extra.length === 0 && missing.length === 0 && wrongValue.length === 0 && builderNames.length === 0 && (!markersChecked || seen.found.length === 0);
    if (!ok) passed = false;
    lines.push(`${label}:`);
    lines.push(`   settings seen inside (${names.length}): ${names.join(", ")}`);
    lines.push(`   not on the named list, not the image's own, not set by Docker: ${extra.length ? extra.join(", ") : "none"}`);
    lines.push(`   named or image settings missing: ${missing.length ? missing.join(", ") : "none"}`);
    lines.push(
      `   named or image settings whose value is not the one given: ${wrongValue.length ? wrongValue.join(", ") : "none"} (${Object.keys(expected).length} compared by fingerprint)`,
    );
    lines.push(`   builder settings among the names: ${builderNames.length ? builderNames.join(", ") : "none"}`);
    if (markersChecked) lines.push(`   made-up values found in any setting: ${seen.found.length} of ${markerValues.length}`);
    lines.push(`   ${ok ? "PASSED" : "FAILED"}`);
  }
  return { passed, lines };
}
