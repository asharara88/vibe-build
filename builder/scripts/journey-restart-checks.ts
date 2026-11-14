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
  // After J2's review: the builder's own Compose commands name the sandbox's folder (-f <folder>/compose.yaml), not the
  // project's Compose name, so a command line that holds the recorded folder counts too.
  for (const p of processes) if (p.args.includes(compose) || (folder.path !== null && p.args.includes(folder.path))) out.push(`process ${p.pid} ${p.args}`);
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

/* ------------------------------------------------------------------ J2 (a): the broken copy's record */

/** What the run expects of the broken copy's record, read by the run from builder/scripted-broken itself. */
export interface BrokenCopyExpected {
  /** The broken step, its source folder (repository-relative), its manifest's label and the manifest file's SHA-256. */
  step: string;
  source: string;
  label: string;
  manifestSha256: string;
  /** The plan, in order, and each step's reservation in US dollars. */
  steps: string[];
  reservations: number[];
  /** The app's banner sentence of the broken copy, in English and in Arabic (its own message files). */
  bannerEn: string;
  bannerAr: string;
}

const sameUsd = (a: unknown, b: number) => typeof a === "number" && Math.abs(a - b) < 1e-9;
const byId = (a: EventSeen, b: EventSeen) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);

/**
 * J2 (a), "Done means" items 2 to 9, the record's part (the screens are the builder camera's): the choice in the
 * project's first event; the three steps in `journey.plan_confirmed`; each step built, approved and its reservation made
 * and released; exactly one `journey.broken_step_staged`, between step 2's approval and step 3's first engine event,
 * with the chosen SHA-256; the app camera's banner lines; the checklist's run as the record gives it (outcome "failed",
 * exit code 1, the version fixed at "Confirm plan", the summary) and item 1's failure file (read through `readFile`, its
 * text never returned); no sign-off and no export; the record ending with the project closed.
 */
export function brokenCopyRecordChecks(events: EventSeen[], x: BrokenCopyExpected, readFile: (path: string) => Buffer | null, sha256Of: (b: Buffer) => string): Check[] {
  const ev = [...events].sort(byId);
  const of = (kind: string, step?: string) => ev.filter((e) => e.kind === kind && (step === undefined || e.step === step));
  const first = ev[0];
  const choice = first?.kind === "intake.brief_entered" ? (first.payload.broken_copy as Record<string, unknown> | undefined) : undefined;
  const wantChoice = { by: "owner", step: x.step, source: x.source, label: x.label, manifest_sha256: x.manifestSha256, sign_off: "never", export: "never" };
  const plans = of("journey.plan_confirmed");
  const plan = plans[0]?.payload ?? {};
  const planSteps = Array.isArray(plan.steps) ? (plan.steps as Array<{ step?: unknown; label?: unknown }>) : [];
  const out: Check[] = [];
  out.push({
    name: "the record's first event is intake.brief_entered, carrying broken_copy: by owner, the step, its source, label and manifest SHA-256, sign_off never, export never",
    ok: choice !== undefined && JSON.stringify(Object.entries(choice).sort()) === JSON.stringify(Object.entries(wantChoice).sort()),
    detail: first ? `${first.kind}: ${JSON.stringify(choice ?? null)}` : "no event",
  });
  out.push({
    name: `journey.plan_confirmed lists the three steps (${x.steps.join(", ")}), the third with its label from builder/scripted-broken, and broken_copy: true`,
    ok:
      plans.length === 1 &&
      JSON.stringify(planSteps.map((s) => s.step)) === JSON.stringify(x.steps) &&
      planSteps[x.steps.indexOf(x.step)]?.label === x.label &&
      plan.broken_copy === true &&
      plan.quality_check_after_each_step_and_retry === "not done (milestones 1 and 3)",
    detail: `${plans.length} confirmed: ${JSON.stringify(planSteps.map((s) => s.step))}, broken_copy ${JSON.stringify(plan.broken_copy)}`,
  });
  const notBuilt = x.steps.filter((step) => {
    const finished = of("journey.job.finished", step).filter((e) => e.payload.kind === "build_step");
    const bad = [...of("journey.job.failed", step), ...of("journey.job.interrupted", step)];
    return finished.length !== 1 || bad.length !== 0 || of("journey.step_approved", step).length !== 1;
  });
  out.push({ name: "steps 1, 2 and 3 each built once and approved", ok: notBuilt.length === 0, detail: notBuilt.length ? `not so: ${notBuilt.join(", ")}` : "" });
  const holdsWrong = x.steps.filter((step, i) => {
    const opened = of("step.hold_opened", step);
    const closed = of("step.hold_closed", step);
    const r = x.reservations[i]!;
    return !(opened.length === 1 && closed.length === 1 && sameUsd(opened[0]!.payload.step_budget_usd, r) && closed[0]!.payload.reason === "step_ended" && sameUsd(closed[0]!.payload.released_usd, r) && sameUsd(closed[0]!.payload.spent_in_step_usd, 0));
  });
  out.push({
    name: `each step's reservation made and released, closed step_ended: ${x.reservations.map((r) => `$${r.toFixed(4)}`).join(", ")}; $0.00 spent in each`,
    ok: holdsWrong.length === 0,
    detail: x.steps.map((step) => `${step}: ${of("step.hold_opened", step).map((e) => String(e.payload.step_budget_usd)).join("/")} -> ${of("step.hold_closed", step).map((e) => `${String(e.payload.reason)} released ${String(e.payload.released_usd)} spent ${String(e.payload.spent_in_step_usd)}`).join("/")}`).join("; "),
  });
  const staged = of("journey.broken_step_staged");
  const approved2 = of("journey.step_approved", x.steps[x.steps.indexOf(x.step) - 1]).at(-1);
  const firstEngine3 = of("engine.event", x.step)[0];
  out.push({
    name: "exactly one journey.broken_step_staged, after step 2's approval and before step 3's first engine event, its manifest SHA-256 (read back from the sandbox's copy) the chosen one",
    ok:
      staged.length === 1 &&
      approved2 !== undefined &&
      firstEngine3 !== undefined &&
      BigInt(staged[0]!.id) > BigInt(approved2.id) &&
      BigInt(staged[0]!.id) < BigInt(firstEngine3.id) &&
      staged[0]!.payload.manifest_sha256 === x.manifestSha256 &&
      staged[0]!.payload.manifest_sha256 === choice?.manifest_sha256 &&
      String(staged[0]!.payload.manifest_read_from).includes("sandbox's own copy"),
    detail: `${staged.length} staged (ids ${staged.map((e) => e.id).join(", ")}); step 2 approved at ${approved2?.id ?? "none"}; step 3's first engine event ${firstEngine3?.id ?? "none"}; SHA-256 ${String(staged[0]?.payload.manifest_sha256 ?? "none")}`,
  });
  // The app camera's banner lines, kept among the preview's lines ("app camera: {...}").
  const banners = new Map<string, string | null>();
  for (const e of of("journey.preview.line")) {
    const line = String(e.payload.line ?? "");
    if (!line.startsWith("app camera: ")) continue;
    try {
      const o = JSON.parse(line.slice("app camera: ".length)) as { kind?: unknown; name?: unknown; text?: unknown };
      if (o.kind === "banner") banners.set(String(o.name), typeof o.text === "string" ? o.text : null);
    } catch {
      // a line cut at 300 characters, or not JSON: not a banner line
    }
  }
  const wantBanner: Array<[string, string]> = [
    ["app-home-en", x.bannerEn],
    ["app-my-requests-en", x.bannerEn],
    ["app-home-ar", x.bannerAr],
    ["app-my-requests-ar", x.bannerAr],
  ];
  const shotsByLang = of("journey.screenshot").map((e) => String(e.payload.lang));
  out.push({
    name: "the app camera's pictures recorded for both languages, and its banner lines: each English page carries the English sentence, each Arabic page the Arabic one",
    ok: shotsByLang.filter((l) => l === "en").length === 2 && shotsByLang.filter((l) => l === "ar").length === 2 && wantBanner.every(([name, want]) => (banners.get(name) ?? "").includes(want)),
    detail: `${shotsByLang.join(",")}; ${wantBanner.map(([name]) => `${name}: ${JSON.stringify(banners.get(name) ?? null)}`).join("; ")}`,
  });
  const runs = of("acceptance.run.finished");
  const run = runs[0]?.payload ?? {};
  out.push({
    name: 'the checklist run as its record gives it: outcome "failed", exit code 1, the version fixed at "Confirm plan", the summary \'version failed: item 1 failed at step "sees status waiting"\'',
    ok: runs.length === 1 && run.outcome === "failed" && run.exit_code === 1 && typeof plan.acceptance_version === "string" && run.version === plan.acceptance_version && run.summary === 'version failed: item 1 failed at step "sees status waiting"',
    detail: `${runs.length} runs: ${JSON.stringify({ outcome: run.outcome, exit_code: run.exit_code, version: run.version, plan_version: plan.acceptance_version, summary: run.summary })}`,
  });
  const items = of("acceptance.item");
  const item1 = items.find((e) => e.payload.item === 1);
  const ff = (item1?.payload.failure_file ?? null) as { path?: unknown; sha256?: unknown } | null;
  out.push({
    name: "item 1 failed at step 'sees status waiting', with the runner's screenshot; no other item has a result",
    ok: item1 !== undefined && items.length === 1 && item1.payload.status === "failed" && item1.payload.step === "sees status waiting" && item1.payload.screenshot !== null && item1.payload.screenshot !== undefined,
    detail: items.map((e) => `item ${String(e.payload.item)}: ${String(e.payload.status)} at ${String(e.payload.step)}`).join("; ") || "none",
  });
  const body = typeof ff?.path === "string" ? readFile(ff.path) : null;
  out.push({
    name: "the failure file item 1's event names exists, its SHA-256 is the event's, and its text contains \"Approved\" (the text is not copied)",
    ok: body !== null && sha256Of(body) === ff?.sha256 && body.toString("utf8").includes("Approved"),
    detail: body === null ? "not found" : `${body.length} bytes; SHA-256 ${sha256Of(body) === ff?.sha256 ? "the event's" : "NOT the event's"}; "Approved" ${body.toString("utf8").includes("Approved") ? "in it" : "NOT in it"}`,
  });
  out.push({ name: "the record holds no journey.signed_off and no journey.export.written", ok: of("journey.signed_off").length === 0 && of("journey.export.written").length === 0, detail: `${of("journey.signed_off").length} signed off, ${of("journey.export.written").length} exports` });
  const removed = of("journey.sandbox.removed");
  out.push({
    name: "closed: its sandbox removed (not interrupted), and the record ends with journey.closed",
    ok: ev.at(-1)?.kind === "journey.closed" && removed.length === 1 && removed[0]!.payload.interrupted === false,
    detail: `last: ${ev.at(-1)?.kind ?? "none"}; removed: ${removed.map((e) => JSON.stringify(e.payload)).join(" | ")}`,
  });
  return out;
}
