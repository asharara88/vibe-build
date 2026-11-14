/**
 * Package J2 (c), a restart mid-step (docs/design/journey-j2.md, sections 2 and 5): the pure checks the automated run
 * makes on what Docker and the machine list, and on a project's record, kept apart from the run so that a test can give
 * them made-up lists (test/journey.test.ts, C8), as journey-network-checks.ts is for J1.
 *
 * N, "nothing left" (section 2): for a project with id P, Docker's containers, volumes, networks and images and the
 * machine's processes count as P's when
 * - a container's name starts `builder_<P>-`, or its label `com.docker.compose.project` is `builder_<P>`;
 * - a volume's or a network's name starts `builder_<P>_`, or it has that label;
 * - an image's repository starts `builder_<P>-` (the app's and the tools' images, made by a plain `docker build --tag`,
 *   carry no Compose label, so they are matched by name);
 * - a process's command line holds `builder_<P>`;
 * - and the sandbox folder P's `journey.sandbox.made` records, while it exists.
 * It imports nothing from src/: the run reads the record's own words.
 */

export interface DockerSeen {
  containers: Array<{ name: string; composeProject: string }>;
  volumes: Array<{ name: string; composeProject: string }>;
  networks: Array<{ name: string; composeProject: string }>;
  images: Array<{ repository: string; tag: string }>;
}
export interface ProcessSeen {
  pid: number;
  args: string;
}
/** An event as the run reads it from the project's record. */
export interface EventSeen {
  id: string;
  kind: string;
  step: string | null;
  payload: Record<string, unknown>;
}
export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** N: what Docker and the machine still hold of one project, one line each ("container …", "image …", "folder …"). */
export function projectLeftovers(projectId: string, seen: DockerSeen, processes: ProcessSeen[], folder: { path: string | null; exists: boolean }): string[] {
  const compose = `builder_${projectId}`;
  const out: string[] = [];
  for (const c of seen.containers) if (c.name.startsWith(`${compose}-`) || c.composeProject === compose) out.push(`container ${c.name}`);
  for (const v of seen.volumes) if (v.name.startsWith(`${compose}_`) || v.composeProject === compose) out.push(`volume ${v.name}`);
  for (const n of seen.networks) if (n.name.startsWith(`${compose}_`) || n.composeProject === compose) out.push(`network ${n.name}`);
  for (const i of seen.images) if (i.repository.startsWith(`${compose}-`)) out.push(`image ${i.repository}:${i.tag}`);
  for (const p of processes) if (p.args.includes(compose)) out.push(`process ${p.pid} ${p.args}`);
  if (folder.path !== null && folder.exists) out.push(`folder ${folder.path}`);
  return out;
}

/** Lines of `docker ps -a`, `docker volume ls` or `docker network ls` printed as `<name>\t<compose project label>`. */
export function parseNameLabel(out: string): Array<{ name: string; composeProject: string }> {
  return out
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const [name, label] = l.split("\t");
      return { name: (name ?? "").trim(), composeProject: (label ?? "").trim() };
    });
}

/** Lines of `docker image ls` printed as `<repository>:<tag>` (the tag is after the last colon). */
export function parseImages(out: string): Array<{ repository: string; tag: string }> {
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((l) => {
      const at = l.lastIndexOf(":");
      return at < 0 ? { repository: l, tag: "" } : { repository: l.slice(0, at), tag: l.slice(at + 1) };
    });
}

/** Lines of `ps -eo pid,args`: a header line (if any) is skipped. */
export function parseProcesses(out: string): ProcessSeen[] {
  const rows: ProcessSeen[] = [];
  for (const l of out.split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(l);
    if (m) rows.push({ pid: Number(m[1]), args: m[2]!.trim() });
  }
  return rows;
}

const writesOf = (events: EventSeen[], step: string) => events.filter((e) => e.kind === "engine.event" && e.step === step && e.payload.type === "tool_call" && e.payload.tool === "scripted.write");

/**
 * T1 and K1, the record's and Docker's parts: the step is running part-way, before the signal. The record holds at least
 * one and fewer than all of the step's writes, and Docker lists the step's engine container.
 */
export function midStepChecks(events: EventSeen[], step: string, files: number, containerNames: string[], projectId: string): Check[] {
  const writes = writesOf(events, step).length;
  const prefix = `builder_${projectId}-engine-${step}-`;
  const engines = containerNames.filter((n) => n.startsWith(prefix));
  return [
    { name: `the record holds at least 1 and fewer than ${files} scripted.write events of step ${step}`, ok: writes >= 1 && writes < files, detail: `${writes} written` },
    { name: `Docker lists a container whose name starts ${prefix}`, ok: engines.length > 0, detail: engines.join(", ") || "none" },
  ];
}

/** T4: the record after a clean stop (SIGTERM or SIGINT) with the step's build job running. */
export function cleanStopRecordChecks(events: EventSeen[], jobId: string, step: string): Check[] {
  const ofJob = (kind: string) => events.filter((e) => e.kind === kind && String(e.payload.job_id) === jobId);
  const interrupted = ofJob("journey.job.interrupted");
  const holds = events.filter((e) => e.kind === "step.hold_closed" && e.step === step);
  const removed = events.filter((e) => e.kind === "journey.sandbox.removed");
  const ended = [...ofJob("journey.job.finished"), ...ofJob("journey.job.failed")];
  const resets = events.filter((e) => e.kind === "journey.workspace.reset");
  return [
    { name: `journey.job.interrupted for ${jobId}, its reason naming a stop on purpose`, ok: interrupted.length === 1 && /stopped on purpose \(SIG(TERM|INT)\)/.test(String(interrupted[0]!.payload.reason)), detail: interrupted.map((e) => String(e.payload.reason)).join(" | ") || "none" },
    { name: `step.hold_closed for step ${step} with reason step_ended (the halt path)`, ok: holds.length === 1 && holds[0]!.payload.reason === "step_ended", detail: holds.map((e) => String(e.payload.reason)).join(", ") || "none" },
    {
      name: "journey.sandbox.removed with interrupted: true, removed: true and the stop's own reason",
      ok: removed.length === 1 && removed[0]!.payload.interrupted === true && removed[0]!.payload.removed === true && /removed at the stop/.test(String(removed[0]!.payload.reason)),
      detail: removed.map((e) => JSON.stringify(e.payload)).join(" | ") || "none",
    },
    { name: `no journey.job.finished or journey.job.failed for ${jobId}, and no journey.workspace.reset`, ok: ended.length === 0 && resets.length === 0, detail: `${ended.length} ended, ${resets.length} resets` },
  ];
}

/** K3: the record after a crash (SIGKILL) with the step's build job running, then the next start's recovery. */
export function crashRestartRecordChecks(events: EventSeen[], jobId: string, step: string): Check[] {
  const interrupted = events.filter((e) => e.kind === "journey.job.interrupted" && String(e.payload.job_id) === jobId);
  const removed = events.filter((e) => e.kind === "journey.sandbox.removed");
  const holds = events.filter((e) => e.kind === "step.hold_closed" && e.step === step);
  return [
    { name: `journey.job.interrupted for ${jobId}: "The interface stopped while this job ran. It is not resumed."`, ok: interrupted.length === 1 && interrupted[0]!.payload.reason === "The interface stopped while this job ran. It is not resumed.", detail: interrupted.map((e) => String(e.payload.reason)).join(" | ") || "none" },
    {
      name: 'journey.sandbox.removed with interrupted: true, removed: true and "Found at start…"',
      ok: removed.length === 1 && removed[0]!.payload.interrupted === true && removed[0]!.payload.removed === true && String(removed[0]!.payload.reason).startsWith("Found at start"),
      detail: removed.map((e) => JSON.stringify(e.payload)).join(" | ") || "none",
    },
    { name: `step.hold_closed for step ${step} with reason job_interrupted`, ok: holds.length === 1 && holds[0]!.payload.reason === "job_interrupted", detail: holds.map((e) => String(e.payload.reason)).join(", ") || "none" },
  ];
}
