/**
 * Package 0.5: the tools container receives a named list of settings, never the host's environment.
 *
 * A stand-in seed step (a one-line Node program, run in the tools container exactly as the seed is
 * run) prints the NAMES in its environment, never the values, and says which of a list of made-up
 * marker values it finds among the values. It is run twice:
 *
 *  1. through `sandbox.runOnce`, the way the demonstration runs the real seed;
 *  2. through `docker compose run` given this process's whole environment plus made-up values for
 *     every setting the builder itself reads, to show that the compose file alone keeps them out.
 *
 * Passes only if, both times, every name printed is either on the sandbox's named list or set by the
 * tools image itself (read from `docker image inspect`, plus HOSTNAME and HOME, which Docker sets for
 * every container), and none of the marker values is found.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { sandbox, type Sandbox } from "../src/sandbox/manager.js";

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
  "HTTP_PROXY",
  "PGUSER",
];

/** The stand-in seed step: names only, and which markers (given as arguments) appear in any value. */
const PRINT_ENV = [
  "const markers = process.argv.slice(1);",
  "const values = Object.values(process.env);",
  "console.log(JSON.stringify({ names: Object.keys(process.env).sort(), found: markers.filter((m) => values.some((v) => (v ?? '').includes(m))) }));",
].join(" ");

interface Seen {
  names: string[];
  found: string[];
}

function parse(stdout: string): Seen {
  const line = stdout.trim().split("\n").pop() ?? "";
  return JSON.parse(line) as Seen;
}

async function imageEnvNames(image: string): Promise<string[]> {
  const { stdout } = await run("docker", ["image", "inspect", image, "--format", "{{json .Config.Env}}"]);
  return (JSON.parse(stdout) as string[]).map((e) => e.split("=")[0]!);
}

export async function checkToolsEnv(sb: Sandbox): Promise<{ passed: boolean; lines: string[] }> {
  if (!sb.appBuild || !sb.toolsEnvNames) throw new Error("This sandbox has no tools container.");
  const named = sb.toolsEnvNames;
  const fromImage = [...new Set([...(await imageEnvNames(sb.appBuild.toolsImage)), "HOSTNAME", "HOME"])].sort();
  const allowed = new Set([...named, ...fromImage]);

  // Made-up marker values, one per builder setting and one for a setting of no known name.
  const markers: Record<string, string> = {};
  for (const name of [...BUILDER_SETTINGS, "BUILDER_TOOLS_CHECK_MARKER"]) markers[name] = `made-up-marker-${randomBytes(8).toString("hex")}`;
  const markerValues = Object.values(markers);

  const lines: string[] = [];
  lines.push(`Named list (${named.length}): ${named.join(", ")}`);
  lines.push(`Set by the tools image itself, or by Docker for every container (${fromImage.length}): ${fromImage.join(", ")}`);

  const first = parse(await sandbox.runOnce(sb, "tools", ["node", "-e", PRINT_ENV, ...markerValues]));
  const hostEnv = { ...process.env, ...markers };
  const second = parse(
    (
      await run("docker", ["compose", "-f", sb.composeFile, "run", "--rm", "--no-deps", "-T", "tools", "node", "-e", PRINT_ENV, ...markerValues], {
        env: hostEnv,
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
      })
    ).stdout,
  );

  let passed = true;
  for (const [label, seen] of [
    ["1. As the seed is run (Compose itself given only PATH and HOME)", first],
    [`2. Compose given this process's whole environment (${Object.keys(hostEnv).length} settings, including made-up values for the builder's ${BUILDER_SETTINGS.length} settings and one more)`, second],
  ] as const) {
    const extra = seen.names.filter((n) => !allowed.has(n));
    const builderNames = seen.names.filter((n) => BUILDER_SETTINGS.includes(n) || n.startsWith("BUILDER_"));
    const ok = extra.length === 0 && builderNames.length === 0 && seen.found.length === 0;
    if (!ok) passed = false;
    lines.push(`${label}:`);
    lines.push(`   settings seen inside (${seen.names.length}): ${seen.names.join(", ")}`);
    lines.push(`   not on the named list and not the image's own: ${extra.length ? extra.join(", ") : "none"}`);
    lines.push(`   builder settings among them: ${builderNames.length ? builderNames.join(", ") : "none"}`);
    lines.push(`   made-up marker values found in any setting: ${seen.found.length} of ${markerValues.length}`);
    lines.push(`   ${ok ? "PASSED" : "FAILED"}`);
  }
  return { passed, lines };
}
