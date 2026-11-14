/**
 * After the review of 14 Nov 2026, finding F18: does removing a project now leave alone the containers and images of
 * a project whose id is its own id, a dash, and more? The reviewer showed, on the code as it stood, that
 * destroyRealProject removed such a neighbour's container (reviewers-own-outputs/harness-safety/probe-dash.out.txt).
 * This is the same question put to the code after the fix, against the machine's Docker.
 *
 * Not a test, and not part of the product: it is run once, by hand, under the lock shared with the other sessions,
 * and its output is kept beside it. It starts nothing: three containers of the approved Node image are CREATED with
 * no network and never started, under names that carry this change's own project id, and all are removed at the end.
 *
 * Usage (from builder/, under the shared lock): npx tsx ../evidence/2026-11-14-package-0.6c-real-containers/after-review/neighbour-probe.mts
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RUNNER_IMAGE } from "../../../builder/src/acceptance/runner-image.js";
import { appImageName, composeProjectName, DEFAULT_IMAGES, dockerEnv } from "../../../builder/src/sandbox/manager.js";
import { makeExample1 } from "../../../builder/scripts/example-1-sandbox.js";
import { destroyRealProject, folderLeft, freePort, removeImages } from "../../../builder/scripts/isolation-harness.js";

const run = promisify(execFile);
const OWN = "p_iso06c_real_n";
const NEIGHBOUR = `${OWN}-b`;
const own = composeProjectName(OWN);
const neighbour = composeProjectName(NEIGHBOUR);
const log = (s: string) => console.log(s);
let ok = true;
const must = (what: string, holds: boolean) => {
  log(`   ${holds ? "as it should be" : "NOT AS IT SHOULD BE"}: ${what}`);
  if (!holds) ok = false;
};

log(`composeProjectName("${OWN}") = ${own}; composeProjectName("${NEIGHBOUR}") = ${neighbour}`);
const x = await makeExample1({ projectId: OWN, appPort: 3191, buildProxyPort: await freePort(), runnerImage: RUNNER_IMAGE });
const env = dockerEnv(x.sb);
const names = async () => (await run("docker", ["ps", "-a", "--filter", `name=${own}`, "--format", "{{.Names}}"], { env })).stdout.trim().split("\n").filter(Boolean).sort();
const ownLeftover = `${own}-isolation-left`;
const neighbourApp = `${neighbour}-app-1`;
const neighbourProbe = `${neighbour}-isolation-left`;
try {
  const there = await names();
  if (there.length) throw new Error(`Something named ${own}... is already on the machine (${there.join(", ")}); nothing was made.`);
  const create = (name: string, label?: string) => run("docker", ["create", "--name", name, "--network", "none", ...(label ? ["--label", `com.docker.compose.project=${label}`] : []), DEFAULT_IMAGES.node, "true"], { env });
  await create(ownLeftover);
  await create(neighbourApp, neighbour);
  await create(neighbourProbe);
  log(`1. Created, never started: ${ownLeftover} (this project's own leftover probe container); ${neighbourApp} (the neighbour's app container, labelled as Compose labels it); ${neighbourProbe} (the neighbour's leftover probe container).`);
  log(`   before: ${JSON.stringify(await names())}`);
  log(`2. destroyRealProject(${OWN}) said: ${await destroyRealProject(x)}`);
  log(`   (that line is leftOf's, which lists by the start of a name and so names the neighbour's containers too; it only reads.)`);
  const after = await names();
  log(`   after: ${JSON.stringify(after)}`);
  must(`this project's own leftover container was removed`, !after.includes(ownLeftover));
  must(`the neighbour's app container is still there`, after.includes(neighbourApp));
  must(`the neighbour's leftover probe container is still there`, after.includes(neighbourProbe));
  must(`this project's folder is gone (${folderLeft(x)})`, folderLeft(x) === "gone");
  const image = appImageName(NEIGHBOUR);
  const said = await removeImages(x.sb, [image]).then(() => "ACCEPTED as its own", (err: Error) => `refused: ${err.message}`);
  log(`3. removeImages for ${OWN}, given the neighbour's image name ${image}: ${said}`);
  must("the neighbour's image name is refused (no such image exists; Docker was not asked)", said.startsWith("refused: "));
} finally {
  for (const name of [ownLeftover, neighbourApp, neighbourProbe]) await run("docker", ["rm", "-f", name], { env: process.env }).catch(() => undefined);
  await destroyRealProject(x).catch(() => undefined);
  const left = (await run("docker", ["ps", "-a", "--filter", `name=${own}`, "--format", "{{.Names}}"])).stdout.trim();
  log(`4. Cleaned up: containers left under these names: ${left || "none"}; this project's folder: ${folderLeft(x)}`);
  if (left) ok = false;
}
log(ok ? "RESULT: as it should be on every line." : "RESULT: NOT as it should be; see the lines above.");
process.exit(ok ? 0 : 1);
