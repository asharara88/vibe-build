/**
 * Known gap 180's fix, on real Docker: the end of every removal of a journey project's sandbox reads Docker's own
 * lists, and reports the removal as done only when they hold nothing of the project.
 *
 * A made-up project (no sandbox is built): one network carrying the project's Compose label, held in use by a
 * container that is NOT the project's, so that Docker refuses to remove the network. The real adapter's removal must
 * then say what is left and keep the folder; once the holder is gone, it must remove everything and the folder.
 *
 * Needs Docker and the approved Node image; it fails, never skips, without them. It makes and removes only things
 * carrying its own made-up project id or its own holder's name. No model is called.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dockerLeftovers, example1Sandboxes } from "../src/orchestrator/example-1-adapter.js";
import { SandboxNotRemoved } from "../src/orchestrator/journey.js";
import { composeProjectName, DEFAULT_IMAGES } from "../src/sandbox/manager.js";

const run = promisify(execFile);
const docker = (args: string[]) => run("docker", args, { maxBuffer: 4 * 1024 * 1024 });

const projectId = `j1-${randomBytes(6).toString("hex")}`;
const name = composeProjectName(projectId);
const network = `${name}_front`;
const holder = `removal-test-holder-${randomBytes(4).toString("hex")}`;
let base: string | undefined;
let dir = "";
let dockerProblem: string | null = null;

beforeAll(async () => {
  dockerProblem = await docker(["image", "inspect", DEFAULT_IMAGES.node]).then(
    () => null,
    (e: unknown) => `Docker did not answer, or the approved Node image ${DEFAULT_IMAGES.node} is not on this machine (${(e instanceof Error ? e.message : String(e)).split("\n")[0]})`,
  );
  if (dockerProblem) return;
  // The folder as makeExample1 names it, with a compose file naming this project, as the removal's own check asks.
  base = mkdtempSync(join(tmpdir(), "removal-live-"));
  dir = join(base, "builder-acceptance-removal");
  mkdirSync(dir);
  writeFileSync(join(dir, "compose.yaml"), `name: ${JSON.stringify(name)}\nservices: {}\n`);
  await docker(["network", "create", "--label", `com.docker.compose.project=${name}`, network]);
  // Not the project's: no Compose label, and a name of its own. It only holds the network in use.
  await docker(["run", "--detach", "--name", holder, "--network", network, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "64m", DEFAULT_IMAGES.node, "sleep", "600"]);
}, 120_000);

afterAll(async () => {
  await docker(["rm", "-f", holder]).catch(() => undefined);
  await docker(["network", "rm", network]).catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
}, 120_000);

describe("Known gap 180's fix, live: a removal is reported done only when Docker lists nothing of the project", () => {
  it("its prerequisites are here: Docker answers and the approved Node image is on this machine", () => {
    if (dockerProblem) throw new Error(`This live test cannot run, so it fails (it is never skipped). ${dockerProblem}`);
  });

  it("a network of the project that Docker will not remove (held in use by a container that is not the project's): the removal throws, names the network, and keeps the folder", async () => {
    expect(dockerProblem).toBeNull();
    expect(await dockerLeftovers(projectId)).toEqual([`network ${network}`]);
    const failed = await example1Sandboxes().destroyRecorded(projectId, { dir }).then(() => null, (e: unknown) => e);
    expect(failed).toBeInstanceOf(SandboxNotRemoved);
    expect((failed as SandboxNotRemoved).left).toEqual([`network ${network}`]);
    expect((failed as SandboxNotRemoved).projectId).toBe(projectId);
    expect(existsSync(dir)).toBe(true);
    // The holder, which is not the project's, was not touched by the sweep.
    expect((await docker(["ps", "--filter", `name=^${holder}$`, "--format", "{{.Names}}"])).stdout.trim()).toBe(holder);
  }, 120_000);

  it("once nothing holds it: the same removal removes the network and then the folder, and Docker lists nothing of the project", async () => {
    expect(dockerProblem).toBeNull();
    await docker(["rm", "-f", holder]);
    const said = await example1Sandboxes().destroyRecorded(projectId, { dir });
    expect(said).toContain("nothing of the project left in Docker's lists; folder removed");
    expect(await dockerLeftovers(projectId)).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  }, 120_000);
});
