/**
 * Known gap 180's fix, on real Docker: the end of every removal of a journey project's sandbox reads Docker's own
 * lists, and reports the removal as done only when they hold nothing of the project.
 *
 * A made-up project (no sandbox is built): one network carrying the project's Compose label, held in use by a
 * container that is NOT the project's, so that Docker refuses to remove the network. The real adapter's removal must
 * then say what is left and keep the folder; once the holder is gone, it must remove everything and the folder.
 *
 * After the fix's review (14 Nov 2026), on made-up projects of their own: the same through the removal with a handle
 * (the path "Close project" and a clean stop take in a running interface); a labelled network with a tab in its name,
 * which the check used not to see; a folder that cannot be removed in full; and a recorded folder that fails its own
 * check, which is left alone while Docker's side is removed and checked all the same.
 *
 * After the second review round: a folder whose own removal is refused (its parent made unchangeable), which keeps its
 * compose file and so can still be removed from the record once the parent can be changed.
 *
 * Needs Docker and the approved Node image; two tests also need `chattr` and a file system under TMPDIR that takes its
 * +i flag (to make a file that cannot be removed, and a folder that cannot be changed). It fails, never skips, without them. It makes and removes only
 * things carrying a made-up project id of its own, or a name starting "removal-test-". No model is called.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dockerLeftovers, example1Sandboxes, recordedSandboxRefusal, type ProjectSandbox } from "../src/orchestrator/example-1-adapter.js";
import { SandboxNotRemoved } from "../src/orchestrator/journey.js";
import { appImageName, composeProjectName, DEFAULT_IMAGES, toolsImageName, type Sandbox } from "../src/sandbox/manager.js";

const run = promisify(execFile);
const docker = (args: string[]) => run("docker", args, { maxBuffer: 4 * 1024 * 1024 });
const hex = (bytes: number) => randomBytes(bytes).toString("hex");

const projectId = `j1-${hex(6)}`;
const name = composeProjectName(projectId);
const network = `${name}_front`;
const holder = `removal-test-holder-${hex(4)}`;
let base: string | undefined;
let dir = "";
let dockerProblem: string | null = null;
/** Everything the later tests make, removed at the end whatever happened: containers and volumes by name, networks by id, and files made unremovable. */
const made = { containers: [] as string[], networks: [] as string[], volumes: [] as string[], unremovable: [] as string[] };

/** A made-up project of one test's own: its id, its Compose name, and a folder named as makeExample1 names it, holding a compose file that names the project (unless `compose` is false). */
function madeUp(o: { compose?: boolean } = {}): { id: string; name: string; folder: string } {
  const id = `j1-${hex(6)}`;
  const folder = join(base!, `builder-acceptance-${id.slice(3)}`);
  mkdirSync(folder);
  if (o.compose !== false) writeFileSync(join(folder, "compose.yaml"), `name: ${JSON.stringify(composeProjectName(id))}\nservices: {}\n`);
  return { id, name: composeProjectName(id), folder };
}
/** A container that is NOT a project's (no Compose label, a name of its own): it only holds the network `net` in use. */
const hold = (holderName: string, net: string) =>
  docker(["run", "--detach", "--name", holderName, "--network", net, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "64m", DEFAULT_IMAGES.node, "sleep", "600"]);
/** The name Docker lists a running container under, or "". */
const runningAs = async (holderName: string) => (await docker(["ps", "--filter", `name=^${holderName}$`, "--format", "{{.Names}}"])).stdout.trim();
const removal = (remove: () => Promise<string>) => remove().then(() => null, (e: unknown) => e);

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
  await hold(holder, network);
}, 120_000);

afterAll(async () => {
  for (const f of made.unremovable) await run("chattr", ["-i", f]).catch(() => undefined);
  for (const c of [holder, ...made.containers]) await docker(["rm", "-f", c]).catch(() => undefined);
  for (const n of [network, ...made.networks]) await docker(["network", "rm", n]).catch(() => undefined);
  for (const v of made.volumes) await docker(["volume", "rm", "-f", v]).catch(() => undefined);
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

  it("the removal with a handle, as Close project and a clean stop make it in a running interface, while the same network is held: it throws, names the network, keeps the folder, and leaves the container that is not the project's alone", async () => {
    expect(dockerProblem).toBeNull();
    // A handle made by hand for the same made-up project, its sandbox as the removal from the record builds it.
    const sb: Sandbox = {
      dir,
      composeFile: join(dir, "compose.yaml"),
      projectName: name,
      appBuild: { context: join(dir, "workspace"), image: appImageName(projectId), toolsImage: toolsImageName(projectId), hostNetwork: true, args: {}, before: ["egress-host"] },
    };
    const x: ProjectSandbox = {
      projectId,
      dir,
      workspace: join(dir, "workspace"),
      changeSets: join(dir, "engine-change-sets"),
      repo: { gitDir: join(dir, "workspace.git"), workTree: join(dir, "workspace") },
      sb,
      appPort: 3161,
      buildProxyPort: 13161,
      appUrl: "http://app:3161",
      samplePassword: "made-up-sample-password",
      appStarted: true,
    };
    const failed = await removal(() => example1Sandboxes().destroy(x));
    expect(failed).toBeInstanceOf(SandboxNotRemoved);
    expect((failed as SandboxNotRemoved).left).toEqual([`network ${network}`]);
    expect((failed as SandboxNotRemoved).projectId).toBe(projectId);
    expect(x.appStarted).toBe(false);
    expect(existsSync(join(dir, "compose.yaml"))).toBe(true);
    expect(await runningAs(holder)).toBe(holder);
  }, 120_000);

  it("once nothing holds it: the same removal removes the network and then the folder, and Docker lists nothing of the project", async () => {
    expect(dockerProblem).toBeNull();
    await docker(["rm", "-f", holder]);
    const said = await example1Sandboxes().destroyRecorded(projectId, { dir });
    expect(said).toContain("nothing of the project left in Docker's lists; folder removed");
    expect(await dockerLeftovers(projectId)).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  }, 120_000);

  it("a network carrying the project's label with a tab in its name, held in use by a container that is not the project's: it is reported as left and the folder is kept; a network that is not the project's, with a line break in its name, is not reported", async () => {
    expect(dockerProblem).toBeNull();
    const p = madeUp();
    const tabbed = `removal-test-net-${hex(4)}\tx`;
    const tabbedId = (await docker(["network", "create", "--label", `com.docker.compose.project=${p.name}`, tabbed])).stdout.trim();
    made.networks.push(tabbedId);
    const h = `removal-test-holder-${hex(4)}`;
    made.containers.push(h);
    await hold(h, tabbedId);
    // Not the project's: no label, and a name that does not start as the project's do. Its second line reads like a network of the project.
    const broken = `removal-test-net-${hex(4)}\n${p.name}_y`;
    made.networks.push((await docker(["network", "create", broken])).stdout.trim());
    // Docker itself lists the labelled network, and only it, as this project's.
    expect((await docker(["network", "ls", "-q", "--no-trunc", "--filter", `label=com.docker.compose.project=${p.name}`])).stdout.trim()).toBe(tabbedId);
    // The tab is shown as JSON writes it.
    const shown = `network ${tabbed.replace("\t", "\\t")}`;
    expect(await dockerLeftovers(p.id)).toEqual([shown]);
    const failed = await removal(() => example1Sandboxes().destroyRecorded(p.id, { dir: p.folder }));
    expect(failed).toBeInstanceOf(SandboxNotRemoved);
    expect((failed as SandboxNotRemoved).left).toEqual([shown]);
    expect(existsSync(join(p.folder, "compose.yaml"))).toBe(true);
    expect(await runningAs(h)).toBe(h);
    // Once nothing holds it, the same removal completes.
    await docker(["rm", "-f", h]);
    expect(await example1Sandboxes().destroyRecorded(p.id, { dir: p.folder })).toContain("nothing of the project left in Docker's lists; folder removed");
    expect(await dockerLeftovers(p.id)).toEqual([]);
    expect(existsSync(p.folder)).toBe(false);
  }, 120_000);

  it("a folder that cannot be removed in full (one file made unremovable with chattr +i), Docker's side being clean: the removal throws SandboxNotRemoved naming the folder and the error's code, not a plain error; the rest of the folder is gone and its compose file kept for last, so the folder still passes its own check; once the file can be removed, the same removal completes", async () => {
    expect(dockerProblem).toBeNull();
    const p = madeUp();
    mkdirSync(join(p.folder, "workspace"));
    writeFileSync(join(p.folder, "workspace", "made-up.txt"), "made-up\n");
    mkdirSync(join(p.folder, "held"));
    const stuck = join(p.folder, "held", "unremovable.txt");
    writeFileSync(stuck, "made-up\n");
    made.unremovable.push(stuck);
    const flagged = await run("chattr", ["+i", stuck]).then(
      () => null,
      (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 2).join(" "),
    );
    if (flagged !== null) throw new Error(`This test needs chattr and a file system under TMPDIR that takes its +i flag, to make a file that cannot be removed. It fails, never skips, without them (${flagged}).`);
    try {
      const failed = await removal(() => example1Sandboxes().destroyRecorded(p.id, { dir: p.folder }));
      expect(failed).toBeInstanceOf(SandboxNotRemoved);
      const left = (failed as SandboxNotRemoved).left;
      // The code is the file's own (EPERM: it may not be removed), not the ENOTDIR Node's recursive removal reports for it.
      expect(left).toEqual([`folder ${p.folder} (not removed: EPERM)`]);
      // What went and what stayed: all but the entry that holds the unremovable file, and the compose file, kept for last.
      expect(existsSync(stuck)).toBe(true);
      expect(readdirSync(p.folder).sort()).toEqual(["compose.yaml", "held"]);
      expect(recordedSandboxRefusal(p.id, p.folder)).toBeNull();
    } finally {
      await run("chattr", ["-i", stuck]).catch(() => undefined);
    }
    expect(await example1Sandboxes().destroyRecorded(p.id, { dir: p.folder })).toContain("nothing of the project left in Docker's lists; folder removed");
    expect(existsSync(p.folder)).toBe(false);
  }, 120_000);

  it("second review round: the folder itself cannot be removed (its parent made unchangeable with chattr +i), Docker's side being clean: the removal throws SandboxNotRemoved naming the folder and the error's code; the folder's own removal was asked for before its compose file was touched, so everything else in it is gone, its compose file is still there and the folder still passes its own check; a second try ends the same way; once the parent can be changed, the same removal from the record completes", async () => {
    expect(dockerProblem).toBeNull();
    // A parent of its own, so that making it unchangeable touches nothing else of this test file.
    const parent = join(base!, `removal-test-parent-${hex(4)}`);
    mkdirSync(parent);
    const id = `j1-${hex(6)}`;
    const folder = join(parent, `builder-acceptance-${id.slice(3)}`);
    mkdirSync(join(folder, "workspace"), { recursive: true });
    writeFileSync(join(folder, "compose.yaml"), `name: ${JSON.stringify(composeProjectName(id))}\nservices: {}\n`);
    writeFileSync(join(folder, "workspace", "made-up.txt"), "made-up\n");
    made.unremovable.push(parent);
    const flagged = await run("chattr", ["+i", parent]).then(
      () => null,
      (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 2).join(" "),
    );
    if (flagged !== null) throw new Error(`This test needs chattr and a file system under TMPDIR that takes its +i flag, to make a folder that cannot be changed. It fails, never skips, without them (${flagged}).`);
    try {
      for (const attempt of ["first try", "second try"]) {
        const failed = await removal(() => example1Sandboxes().destroyRecorded(id, { dir: folder }));
        expect(failed, attempt).toBeInstanceOf(SandboxNotRemoved);
        expect((failed as SandboxNotRemoved).left, attempt).toEqual([`folder ${folder} (not removed: EPERM)`]);
        // The compose file was not touched: the folder is not left empty, and it still passes its own check.
        expect(readdirSync(folder), attempt).toEqual(["compose.yaml"]);
        expect(recordedSandboxRefusal(id, folder), attempt).toBeNull();
      }
    } finally {
      await run("chattr", ["-i", parent]).catch(() => undefined);
    }
    expect(await example1Sandboxes().destroyRecorded(id, { dir: folder })).toContain("nothing of the project left in Docker's lists; folder removed");
    expect(existsSync(folder)).toBe(false);
    expect(readdirSync(parent)).toEqual([]);
  }, 120_000);

  it("a recorded folder that fails its own check (it holds no compose file): the folder is left exactly as it is; Docker's side is removed and checked all the same; the removal throws SandboxNotRemoved, with the sentence it always had, naming what Docker still lists and the folder with why it was left alone", async () => {
    expect(dockerProblem).toBeNull();
    const p = madeUp({ compose: false });
    writeFileSync(join(p.folder, "made-up.txt"), "made-up\n");
    const why = "the recorded folder holds no compose file";
    expect(recordedSandboxRefusal(p.id, p.folder)).toBe(why);
    // Of the project, in Docker: a volume the sweep can remove, and a network it cannot (held in use by a container that is not the project's).
    const volume = `removal-test-vol-${hex(4)}`;
    made.volumes.push(volume);
    await docker(["volume", "create", "--label", `com.docker.compose.project=${p.name}`, volume]);
    const net = `${p.name}_front`;
    made.networks.push((await docker(["network", "create", "--label", `com.docker.compose.project=${p.name}`, net])).stdout.trim());
    const h = `removal-test-holder-${hex(4)}`;
    made.containers.push(h);
    await hold(h, net);
    const failed = await removal(() => example1Sandboxes().destroyRecorded(p.id, { dir: p.folder }));
    expect(failed).toBeInstanceOf(SandboxNotRemoved);
    expect((failed as Error).message).toBe(`The sandbox of ${p.id} was not removed: ${why}.`);
    expect((failed as SandboxNotRemoved).left).toEqual([`network ${net}`, `folder ${p.folder} (left as it is: ${why})`]);
    // Docker's side was done: the volume is gone. The container that is not the project's was not touched.
    expect(await docker(["volume", "inspect", volume]).then(() => "still there", () => "gone")).toBe("gone");
    expect(await runningAs(h)).toBe(h);
    // The folder is exactly as it was.
    expect(readdirSync(p.folder)).toEqual(["made-up.txt"]);
    expect(readFileSync(join(p.folder, "made-up.txt"), "utf8")).toBe("made-up\n");
    // With nothing of the project left in Docker, the folder is still reported, and still not touched.
    await docker(["rm", "-f", h]);
    const again = await removal(() => example1Sandboxes().destroyRecorded(p.id, { dir: p.folder }));
    expect(again).toBeInstanceOf(SandboxNotRemoved);
    expect((again as SandboxNotRemoved).left).toEqual([`folder ${p.folder} (left as it is: ${why})`]);
    expect(await dockerLeftovers(p.id)).toEqual([]);
    expect(readdirSync(p.folder)).toEqual(["made-up.txt"]);
  }, 120_000);
});
