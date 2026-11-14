/**
 * Package 0.6c, the run in real containers: measurement M6, made after measure-first.mts showed that the probe in
 * the real runner image ends in well under a second (0.6 s for the whole `docker compose run`, where the Alpine
 * images take about 35 s: their name lookups wait for the probe's own time limit, the runner image's do not).
 *
 * The live test asks Docker which image each one-off container runs WHILE it runs (`docker inspect`). With a
 * container that lives a fraction of a second, is it always seen? Measured here, in the real runner container:
 *   (a) the harness's `probeServiceSeen` as it is in this tree, N times: how often the container was seen running;
 *   (b) what Docker's own event stream says about one such container: when it was created, started and ended, and
 *       which image-related facts its `create` event carries.
 *
 * Usage (from builder/ of a copy made by checks/make-run-copy.sh, under the shared lock):
 *   npx tsx ../evidence/2026-11-14-package-0.6c-real-containers/measurements/measure-seen.mts <output folder> [N]
 *
 * Every attempt of the probe is made from inside a container. Made-up data only. No model is called.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseProbeOutput } from "../../../builder/src/sandbox/isolation.js";
import { dockerEnv } from "../../../builder/src/sandbox/manager.js";
import { destroyRealProject, devProbeSettings, ensureRunnerImage, probeServiceSeen, startRealProject, type RealProject } from "../../../builder/scripts/isolation-harness.js";

const out = resolve(process.argv[2] ?? ".");
const N = Number(process.argv[3] ?? 20);
mkdirSync(out, { recursive: true });
const lines: string[] = [];
const say = (s: string) => {
  console.log(s);
  lines.push(s);
};
let real: RealProject | null = null;
try {
  say(`M6: is a one-off container that lives a fraction of a second always seen running? Started ${new Date().toISOString()}.`);
  const runner = await ensureRunnerImage();
  real = await startRealProject({ projectId: "p_iso06c_real_m", appPort: 3191 });
  const { x, images } = real;
  say(`Real project ${x.sb.projectName} started; the runner image's id ${runner.imageId}; the acceptance service's image as read after the build ${images.acceptance.id}.`);
  const { settings } = await devProbeSettings(x.sb, { appPort: 3191, gatewayPort: 4010 });

  // (b) Docker's own events for one runner container.
  const name = `${x.sb.projectName}-isolation-events`;
  const events: string[] = [];
  const watcher = spawn("docker", ["events", "--filter", `container=${name}`, "--format", "{{json .}}"], { env: dockerEnv(x.sb), stdio: ["ignore", "pipe", "ignore"] });
  watcher.stdout.on("data", (d: Buffer) => events.push(...d.toString("utf8").split("\n").filter(Boolean)));
  await new Promise((r) => setTimeout(r, 500));
  const one = await probeServiceSeen(x.sb, "acceptance", "events", settings);
  await new Promise((r) => setTimeout(r, 1000));
  watcher.kill();
  const parsed = events.map((e) => JSON.parse(e) as { Action?: string; status?: string; timeNano?: number; Actor?: { Attributes?: Record<string, string> } });
  const t0 = parsed.find((e) => e.Action === "create")?.timeNano ?? 0;
  say(`(b) Docker's events for one runner container (${name}); seen running by the harness: ${one.seen.whileRunning}, image ${one.seen.imageId}`);
  for (const e of parsed) say(`    +${(((e.timeNano ?? 0) - t0) / 1e6).toFixed(0).padStart(5)} ms  ${e.Action}`);
  const created = parsed.find((e) => e.Action === "create")?.Actor?.Attributes ?? {};
  say(`    the create event's image-related attributes: ${JSON.stringify(Object.fromEntries(Object.entries(created).filter(([k]) => /image|^name$/i.test(k))))}`);
  const lived = ((parsed.find((e) => e.Action === "die")?.timeNano ?? 0) - (parsed.find((e) => e.Action === "start")?.timeNano ?? 0)) / 1e6;
  say(`    from start to end: ${lived.toFixed(0)} ms; attempts read: ${parseProbeOutput(one.lines).attempts.length}`);

  // (a) the harness's own function, N times.
  let seen = 0;
  let rightImage = 0;
  const took: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = Date.now();
    const p = await probeServiceSeen(x.sb, "acceptance", `seen-${i}`, settings);
    took.push(Date.now() - t);
    if (p.seen.whileRunning) seen++;
    if (p.seen.imageId === images.acceptance.id) rightImage++;
  }
  say(`(a) probeServiceSeen on the acceptance service, ${N} times: seen running ${seen} of ${N}; the image id read equal to the runner image's ${rightImage} of ${N}; each whole run took between ${Math.min(...took)} and ${Math.max(...took)} ms.`);
} catch (err) {
  const e = err as { stderr?: string; message?: string };
  say(`FAILED: ${e.message ?? String(err)}\n${(e.stderr ?? "").slice(-2000)}`);
  process.exitCode = 1;
} finally {
  if (real) say(`Removed. Left of the project: ${await destroyRealProject(real.x).catch((e: Error) => `FAILED: ${e.message.slice(0, 300)}`)}`);
  say(`Finished ${new Date().toISOString()}.`);
  writeFileSync(join(out, "M6-seen-while-running.txt"), lines.join("\n") + "\n");
}
