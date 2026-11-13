/**
 * What the live acceptance tests need before they can exercise the browser (package 3.1b; the third
 * outside review supplied by the owner, item 3): Docker answering, and the approved browser zip in the
 * folder named by BUILDER_BROWSER_CACHE. Each missing one is named in plain words, with how to put it
 * right. The live tests fail with these words when anything is missing; they are never skipped, so that
 * `npm test` cannot pass while the browser was not exercised.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkedBrowserZip } from "./runner-image.js";

const run = promisify(execFile);

/** How to start Docker in a cloud session (CLAUDE.md, Commands, measured 11 Nov 2026). */
export const START_DOCKER = "start Docker as CLAUDE.md, Commands, says (in a cloud session: `nohup dockerd > /tmp/dockerd.log 2>&1 &`)";
/** How to put the approved zip into the cache. */
export const FETCH_BROWSER = "from builder/, run `BUILDER_BROWSER_CACHE=<a folder outside the repository> npx tsx scripts/fetch-browser.ts`, then run the tests with BUILDER_BROWSER_CACHE set to that folder; if the session's network refuses storage.googleapis.com, the owner's cloud environment must let that host through first (docs/ENVIRONMENT-CHECK.md, 'Session set-up'; known gap 110)";

/** Null when Docker answers; otherwise what is wrong and how to put it right. */
export async function dockerProblem(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  try {
    await run("docker", ["info", "--format", "{{.ServerVersion}}"], { env, timeout: 60_000 });
    return null;
  } catch (err) {
    const e = err as { code?: unknown; stderr?: string; stdout?: string; message?: string };
    const said = e.code === "ENOENT" ? "the docker program is not installed" : ((e.stderr || e.stdout || e.message || "").trim().split("\n").find((l) => l.trim()) ?? "no answer").slice(0, 200);
    return `Docker does not answer on this machine (\`docker info\` failed: ${said}). To put it right, ${START_DOCKER}.`;
  }
}

/** Null when the approved zip is in the cache; otherwise what is wrong and how to put it right. */
export async function browserZipProblem(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  try {
    await checkedBrowserZip(env);
    return null;
  } catch (err) {
    const what = (err as Error).message;
    if (!env.BUILDER_BROWSER_CACHE) return `BUILDER_BROWSER_CACHE is not set, so the approved browser zip cannot be found. To put it right, ${FETCH_BROWSER}.`;
    return `The approved browser zip is not in the folder BUILDER_BROWSER_CACHE names: ${what} To put it right, remove any other file of that name yourself, then ${FETCH_BROWSER}.`;
  }
}

/** Every missing prerequisite of the live acceptance tests, in plain words; empty when all are there. */
export async function liveAcceptanceProblems(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const found = await Promise.all([dockerProblem(env), browserZipProblem(env)]);
  return found.filter((p): p is string => p !== null);
}
