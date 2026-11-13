/**
 * Package 0.5: the tools container receives a named list of settings, never the host's environment.
 *
 * A stand-in seed step (a few lines of Node, run in the tools container exactly as the seed is run)
 * prints the NAMES in its environment and, for each, a SHA-256 fingerprint of its value, never the
 * value itself. "The builder's own settings" below means the names in BUILDER_SETTINGS and OTHER_MARKED
 * that are set, to a value that is not empty, in this process. The check then requires, every time:
 *  - on this machine, before the stand-in step runs: no value the check knows in plain text (each value
 *    the tools image itself declares, and each value given) contains, anywhere within it, the value of
 *    one of the builder's own settings;
 *  - the names inside are exactly: the named list the builder gave, the names the tools image itself
 *    declares (read from `docker image inspect`), and HOSTNAME and HOME, which Docker sets in every
 *    container;
 *  - each named setting holds exactly the value the builder chose to give it, and each of the image's
 *    own settings holds the image's value (compared by fingerprint). HOSTNAME and HOME are not compared
 *    with an expected value: Docker sets them per container;
 *  - no name inside is in BUILDER_SETTINGS or OTHER_MARKED, or starts with BUILDER_;
 *  - no value inside, HOSTNAME and HOME included, is equal to the value of one of the builder's own
 *    settings (compared by fingerprint).
 * Values are never printed. When a value matches, the output names the builder's setting it matched.
 * So, when the check passes: no name in BUILDER_SETTINGS or OTHER_MARKED is inside; no value inside is
 * equal to the value of one of the builder's own settings; and every value inside except HOSTNAME and
 * HOME is equal, by fingerprint, to a value that does not contain one of theirs. HOSTNAME and HOME are
 * compared for equality only. What the check cannot judge is the named list itself: which settings to
 * give is the builder's own choice. The check can fail falsely: a short value of the builder's (a port
 * number, a user name) can occur by chance inside a longer value, and on the development profile, where
 * the container shares the machine's network, HOSTNAME inside is the machine's name, which one of the
 * builder's settings may also hold. The output names the builder's setting matched, so that such a
 * failure can be told apart.
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

/**
 * The eleven settings specific to the builder that its code reads (grep of process.env in builder/src and
 * builder/scripts, 12 Nov 2026). The code also reads PATH, HOME and Docker's own client settings
 * (DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_HOST, DOCKER_TLS, DOCKER_TLS_VERIFY, DOCKER_CERT_PATH), which steer
 * the Docker command itself. They are not in this list. Inside the container, as long as the named list
 * does not include them:
 *  - a DOCKER_* name would fail the check as a name not on the list, unless the tools image declares it;
 *  - PATH: when the tools image declares it (the template's does), the host's PATH inside would fail only
 *    if its value differs from the image's PATH; otherwise, as a name not on the list;
 *  - HOME is set by Docker and, unless the image declares it, has no expected value: its value is compared
 *    only with the values of the builder's own settings, which do not include HOME, so the host's HOME
 *    inside would not be detected.
 */
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

  // The builder's own settings set in this process: their names, and each value's fingerprint mapped to
  // the names holding it. Values stay in memory here and are never printed.
  const listed = [...BUILDER_SETTINGS, ...OTHER_MARKED];
  const builderSet = listed.filter((n) => typeof process.env[n] === "string" && process.env[n] !== "");
  const builderByFingerprint = new Map<string, string[]>();
  for (const n of builderSet) {
    const f = fingerprint(process.env[n]!);
    builderByFingerprint.set(f, [...(builderByFingerprint.get(f) ?? []), n]);
  }

  // On this machine: no value known here in plain text may contain the value of one of the builder's own settings.
  const plain: Array<[string, string]> = [
    ...Object.entries(own).map(([k, v]): [string, string] => [`${k} (the image's own)`, v]),
    ...Object.entries(given).map(([k, v]): [string, string] => [`${k} (given)`, v]),
  ];
  const containing = plain.flatMap(([label, v]) => builderSet.filter((n) => v.includes(process.env[n]!)).map((n) => `${label} contains ${n}`));

  const markers: Record<string, string> = {};
  for (const name of listed) markers[name] = `made-up-marker-${randomBytes(8).toString("hex")}`;
  const markerValues = Object.values(markers);

  let passed = true;
  const lines: string[] = [];
  lines.push(`Named list (${named.length}): ${named.join(", ")}`);
  lines.push(`Declared by the tools image itself (${Object.keys(own).length}): ${Object.keys(own).sort().join(", ")}`);
  lines.push(`Set by Docker in every container, names only: ${setByDocker.join(", ")}`);
  lines.push(`The builder's own settings set in this process, names only (${builderSet.length} of ${listed.length}): ${builderSet.length ? builderSet.join(", ") : "none"}`);
  lines.push(`0. On this machine, before the stand-in step runs:`);
  lines.push(
    `   values known here in plain text that contain the value of one of the builder's own settings: ${containing.length ? containing.join("; ") : "none"} (${plain.length} values: the image's own ${Object.keys(own).length}, given ${Object.keys(given).length})`,
  );
  if (containing.length) passed = false;
  lines.push(`   ${containing.length ? "FAILED" : "PASSED"}`);

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

  const runs = [
    { label: "1. As the seed is run (sandbox.runOnce)", seen: first, markersChecked: false },
    {
      label: `2. Compose given this process's whole environment, with Docker's client folder set to the project's own (${Object.keys(fullEnv).length} settings, including made-up values for the builder's ${BUILDER_SETTINGS.length} settings, ${OTHER_MARKED.join(" and ")})`,
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
    const builderValues = names
      .filter((n) => builderByFingerprint.has(seen.entries[n]!))
      .map((n) => `${n} (equals ${builderByFingerprint.get(seen.entries[n]!)!.join(" or ")})`);
    const ok =
      extra.length === 0 &&
      missing.length === 0 &&
      wrongValue.length === 0 &&
      builderNames.length === 0 &&
      builderValues.length === 0 &&
      (!markersChecked || seen.found.length === 0);
    if (!ok) passed = false;
    lines.push(`${label}:`);
    lines.push(`   settings seen inside (${names.length}): ${names.join(", ")}`);
    lines.push(`   not on the named list, not the image's own, not set by Docker: ${extra.length ? extra.join(", ") : "none"}`);
    lines.push(`   named or image settings missing: ${missing.length ? missing.join(", ") : "none"}`);
    lines.push(
      `   named or image settings whose value is not the one given: ${wrongValue.length ? wrongValue.join(", ") : "none"} (${Object.keys(expected).length} compared by fingerprint)`,
    );
    lines.push(`   builder settings among the names: ${builderNames.length ? builderNames.join(", ") : "none"}`);
    lines.push(
      `   settings whose value equals one of the builder's own settings in this process: ${builderValues.length ? builderValues.join(", ") : "none"} (compared by fingerprint with the ${builderSet.length} set here)`,
    );
    if (markersChecked) lines.push(`   made-up values found in any setting: ${seen.found.length} of ${markerValues.length}`);
    lines.push(`   ${ok ? "PASSED" : "FAILED"}`);
  }
  return { passed, lines };
}
