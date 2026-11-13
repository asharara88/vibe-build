/**
 * Reading what the isolation probe prints (build plan package 0.6a; extended in package 0.6c).
 *
 * The probe (scripts/isolation-probe.mjs) runs inside a project container and prints one JSON line per
 * fact. This module turns those lines into a report, says which attempts got an answer (ANSWER_WORDING), and
 * draws the table of every attempt per container. It makes no connection itself: `readMachineSide` only
 * reads files on the machine and asks Docker for its default network's gateway address, for group G, and
 * `readMachineAddresses` lists the machine's own addresses from the kernel's tables (/proc/net/fib_trie and
 * /proc/net/if_inet6), for group M.
 *
 * Package 0.6c adds the comparison with an expected list (`compareWithExpected`): for each container, the
 * attempts design note 2.5 lets it get an answer to, with who must answer (the result's words and, where it
 * tells them apart, its detail), and, for every other attempt, no answer at all. `expectedOnDevelopment`
 * holds those lists for the development profile.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { MAX_MACHINE_LISTENERS, parseListeners } from "../../scripts/isolation-probe.mjs";

export type Toward = "outside" | "host" | "lookup" | "egress-proxy" | "session-proxy" | "gateway" | "project";

export interface ProbeAttempt {
  id: string;
  group: string;
  toward: Toward;
  what: string;
  target: string;
  how: string;
  result: string;
  code: string | null;
  detail: string;
}

export interface ProbeReport {
  info: { name: string; value: string }[];
  attempts: ProbeAttempt[];
  /** True once the probe's closing line was read, with as many attempts as it says it made. */
  ended: boolean;
  /** Lines that were not what the probe prints, and anything else that does not add up. */
  problems: string[];
}

/** Every result word the probe can give. Anything else is reported as a problem. */
export const RESULT =
  /^(connected|connected, then no answer within the limit|refused|timed out|name not found|no name server answered|lookup refused by the name server|network unreachable|certificate not trusted|secure connection failed|connection reset|proxy closed without an answer|not an HTTP answer|error|HTTP \d{3}|proxy answered \d{3}|found \d+ address(es)?)$/;

const TOWARD = new Set<Toward>(["outside", "host", "lookup", "egress-proxy", "session-proxy", "gateway", "project"]);

/** What counts as an answer, in the words used wherever answers are counted. */
export const ANSWER_WORDING = "a connection opened, an HTTP status, a proxy's answer, or an address found";

/**
 * True if the attempt got an answer: a connection opened, an HTTP status, a proxy's answer, or an address
 * found. Every result the probe gives only after a connection opened counts, not only "connected":
 * "connected, then no answer within the limit" (a connection opened, or a proxy answered 200 to a CONNECT,
 * and nothing more came before the limit: review of 0.6a, second round), "certificate not trusted" and
 * "secure connection failed" (a TLS server answered on an open connection), "connection reset", "proxy
 * closed without an answer" and "not an HTTP answer" (review of 0.6a, finding 11). An answer is not the same
 * as reaching the target: a filter on the way can answer (the report says which, from the answer's own
 * words). Not counted: "refused"; "timed out", which the probe gives only when the limit came before any
 * connection opened (or, for a lookup, before any answer); a lookup that found no address; "network
 * unreachable"; and "error", which the probe gives for an error code it does not know and which can come
 * before any connection opens. The whole result must match: a word the probe does not give is not counted
 * (and the report lists it as a problem, RESULT).
 */
export function gotAnswer(result: string): boolean {
  return /^(connected|connected, then no answer within the limit|HTTP \d{3}|proxy answered \d{3}|found \d+ address(es)?|certificate not trusted|secure connection failed|connection reset|proxy closed without an answer|not an HTTP answer)$/.test(result);
}

const str = (v: unknown) => typeof v === "string";

/** Parse the probe's output. Lines that are not the probe's JSON are kept as problems, never dropped silently. */
export function parseProbeOutput(lines: string[]): ProbeReport {
  const report: ProbeReport = { info: [], attempts: [], ended: false, problems: [] };
  let declared: number | null = null;
  for (const line of lines) {
    if (line.trim() === "") continue;
    let o: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      o = parsed as Record<string, unknown>;
    } catch {
      report.problems.push(`not a line of the probe: ${line.slice(0, 200)}`);
      continue;
    }
    if (o.kind === "info" && str(o.name) && str(o.value)) {
      report.info.push({ name: o.name as string, value: o.value as string });
    } else if (o.kind === "attempt") {
      const ok =
        str(o.id) && str(o.group) && TOWARD.has(o.toward as Toward) && str(o.what) && str(o.target) && str(o.how) && str(o.result) && (o.code === null || str(o.code)) && str(o.detail);
      if (!ok) {
        report.problems.push(`an attempt line with a missing or wrong field: ${line.slice(0, 200)}`);
        continue;
      }
      const a = o as unknown as ProbeAttempt;
      if (!RESULT.test(a.result)) report.problems.push(`attempt ${a.id}: unknown result "${a.result}"`);
      if (report.attempts.some((x) => x.id === a.id)) report.problems.push(`attempt ${a.id} appears twice`);
      report.attempts.push({ id: a.id, group: a.group, toward: a.toward, what: a.what, target: a.target, how: a.how, result: a.result, code: a.code, detail: a.detail });
    } else if (o.kind === "end" && typeof o.attempts === "number") {
      declared = o.attempts;
    } else if (o.kind === "error" && str(o.reason)) {
      report.problems.push(`the probe stopped: ${o.reason as string}`);
    } else {
      report.problems.push(`not a line of the probe: ${line.slice(0, 200)}`);
    }
  }
  if (declared === null) report.problems.push("the probe's closing line is missing: it did not finish");
  else if (declared !== report.attempts.length) report.problems.push(`the probe says it made ${declared} attempts, ${report.attempts.length} were read`);
  report.ended = declared !== null && declared === report.attempts.length;
  return report;
}

export interface Summary {
  total: number;
  answered: number;
  byToward: Record<Toward, { total: number; answered: number }>;
}

export function summarise(report: ProbeReport): Summary {
  const byToward = Object.fromEntries([...TOWARD].map((t) => [t, { total: 0, answered: 0 }])) as Summary["byToward"];
  for (const a of report.attempts) {
    byToward[a.toward].total++;
    if (gotAnswer(a.result)) byToward[a.toward].answered++;
  }
  return { total: report.attempts.length, answered: report.attempts.filter((a) => gotAnswer(a.result)).length, byToward };
}

/** The session proxy's host and port, from a proxy setting such as HTTPS_PROXY. Never a user name or password. */
export function sessionProxyHostPort(setting: string | undefined): string | null {
  if (!setting) return null;
  try {
    const u = new URL(setting);
    if (!u.hostname) return null;
    const port = u.port || (u.protocol === "https:" ? "443" : u.protocol === "http:" ? "80" : "");
    if (!port) return null;
    return `${u.hostname}:${port}`;
  } catch {
    return null;
  }
}

/** One cell of the table: the result, with its error code when there is one. */
export function cell(a: ProbeAttempt | undefined): string {
  if (!a) return "not tried";
  return a.code && !a.result.startsWith("HTTP") && !a.result.startsWith("proxy answered") ? `${a.result} (${a.code})` : a.result;
}

export interface Column {
  label: string;
  report: ProbeReport;
  /**
   * True for a container with a network of its own (Docker's default network, or none). There 127.0.0.1 is
   * the container's own loopback address, not the machine's, so each attempt aimed at it says so in its cell.
   */
  ownLoopback?: boolean;
}

/**
 * An attempt aimed at a loopback address, as its target or as the proxy it goes through: 127.x.x.x,
 * "localhost", or ::1 (written "[::1]" before its port, as the probe writes it, or without the brackets).
 */
const AT_LOOPBACK = /(^|[\s(])(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\]|::1):\d+/i;

/** A row of the table: an attempt's id, and its target and description where every container that made it agrees. */
export interface Row {
  id: string;
  target: string;
  what: string;
  /** True when the containers that made this attempt gave it different targets or descriptions (B2 and B3 can). */
  differs: boolean;
}

/** What a row's target and description read when they differ between containers; each cell then gives its own. */
export const DIFFERS_BY_CONTAINER = "differs by container: see each cell";

/**
 * One cell of a column: the result, and, where the column's loopback address is the container's own and the
 * attempt aimed at it, that it did. When the row's target differs between containers, the cell also gives
 * this container's own target and description.
 */
export function columnCell(c: Column, a: ProbeAttempt | undefined, row?: Row): string {
  let text = cell(a);
  if (a && c.ownLoopback && AT_LOOPBACK.test(`${a.target} ${a.how}`)) text = `${text}, at its own loopback address`;
  if (a && row?.differs) text = `${text}; this container: ${a.target}, ${a.what}`;
  return text;
}

/** The rows of the table: every attempt any container made, in the order the probe makes them. */
function rows(columns: Column[]): Row[] {
  const byId = new Map<string, ProbeAttempt[]>();
  for (const c of columns) for (const a of c.report.attempts) byId.set(a.id, [...(byId.get(a.id) ?? []), a]);
  const out: Row[] = [];
  for (const [id, made] of byId) {
    const first = made[0]!;
    const differs = made.some((a) => a.target !== first.target || a.what !== first.what);
    out.push(differs ? { id, target: DIFFERS_BY_CONTAINER, what: DIFFERS_BY_CONTAINER, differs } : { id, target: first.target, what: first.what, differs });
  }
  return out.sort(compareIds);
}

/** The groups in the order the probe makes them; within a group, ids in natural order (G2024 before G45887, M addresses by number). */
const GROUP_ORDER = ["A", "B", "C", "X", "G", "M", "D", "E", "W", "F", "P", "U"];
export function compareIds(x: { id: string }, y: { id: string }): number {
  const gx = GROUP_ORDER.indexOf(x.id[0] ?? "");
  const gy = GROUP_ORDER.indexOf(y.id[0] ?? "");
  if (gx !== gy) return gx - gy;
  return x.id.localeCompare(y.id, "en", { numeric: true });
}

/** A plain-text table: one row per attempt, one column per container. */
export function renderTable(columns: Column[]): string {
  const header = ["id", "target", "what", ...columns.map((c) => c.label)];
  const body = rows(columns).map((r) => [r.id, r.target, r.what, ...columns.map((c) => columnCell(c, c.report.attempts.find((a) => a.id === r.id), r))]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => (b[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(" | ").trimEnd();
  return [line(header), widths.map((w) => "-".repeat(w)).join("-|-"), ...body.map(line)].join("\n");
}

/** The same table in Markdown, for the evidence file. */
export function renderMarkdownTable(columns: Column[]): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const out = [`| Id | Target | What | ${columns.map((c) => esc(c.label)).join(" | ")} |`, `| --- | --- | --- | ${columns.map(() => "---").join(" | ")} |`];
  for (const r of rows(columns)) out.push(`| ${r.id} | ${esc(r.target)} | ${esc(r.what)} | ${columns.map((c) => esc(columnCell(c, c.report.attempts.find((a) => a.id === r.id), r))).join(" | ")} |`);
  return out.join("\n");
}

/**
 * The machine's listening TCP sockets, as "address:port" texts, from /proc/net/tcp and /proc/net/tcp6 text:
 * each once, sorted. The probe takes at most MAX_MACHINE_LISTENERS of them; with more, this refuses with a
 * plain message rather than leave some out of group G without saying so.
 */
export function machineListenersFrom(tcp4: string, tcp6: string): string[] {
  const listeners = [...parseListeners(tcp4, 4), ...parseListeners(tcp6, 6)];
  const all = [...new Set(listeners.map((l) => `${l.address}:${l.port}`))].sort();
  if (all.length > MAX_MACHINE_LISTENERS)
    throw new Error(
      `The machine has ${all.length} listening TCP sockets; the isolation probe takes at most ${MAX_MACHINE_LISTENERS} for group G. The check stops here rather than leave ${all.length - MAX_MACHINE_LISTENERS} of them out without saying so.`,
    );
  return all;
}

/**
 * What the harness reads on the machine for the probe's group G, read-only; nothing is connected to:
 * the listening TCP sockets with their addresses (/proc/net/tcp, and /proc/net/tcp6 where the machine has
 * IPv6), and the gateway address of Docker's default network (`docker network inspect bridge`, run with
 * the sandbox's Docker settings).
 */
export async function readMachineSide(dockerSettings: NodeJS.ProcessEnv): Promise<{ bridgeGateway: string | null; machineListeners: string[] }> {
  const read = (p: string) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };
  const machineListeners = machineListenersFrom(read("/proc/net/tcp"), read("/proc/net/tcp6"));
  const { stdout } = await promisify(execFile)("docker", ["network", "inspect", "bridge", "--format", "{{range .IPAM.Config}}{{.Gateway}} {{end}}"], { env: dockerSettings });
  const bridgeGateway = stdout.trim().split(/\s+/).find((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a)) ?? null;
  return { bridgeGateway, machineListeners };
}

/**
 * Every address the machine holds, read on the machine from the kernel's own tables (read-only; nothing is
 * connected to, and no program is run): IPv4 from /proc/net/fib_trie (each address marked "/32 host LOCAL"),
 * IPv6 from /proc/net/if_inet6 where the kernel has IPv6. For the probe's group M. The loopback addresses are
 * left out (from a container, 127.0.0.1 is the container's own), and so are IPv6 link-local addresses
 * (fe80::/10, which need an interface named to be reached; the development machine's kernel has no IPv6).
 */
export function readMachineAddresses(): string[] {
  const read = (p: string) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  };
  return machineAddressesFrom(read("/proc/net/fib_trie") ?? "", read("/proc/net/if_inet6"));
}

/** The addresses in /proc/net/fib_trie and /proc/net/if_inet6 text, as `readMachineAddresses` keeps them, each once. */
export function machineAddressesFrom(fibTrie: string, ifInet6: string | null): string[] {
  const out: string[] = [];
  const keep = (a: string) => {
    if (/^127\./.test(a) || a === "::1" || /^fe[89ab]/i.test(a) || out.includes(a)) return;
    out.push(a);
  };
  const lines = fibTrie.split("\n");
  for (let i = 0; i + 1 < lines.length; i++) {
    const m = /^\s*\|-- (\d{1,3}(?:\.\d{1,3}){3})\s*$/.exec(lines[i]!);
    if (m && /^\s*\/32 host LOCAL\s*$/.test(lines[i + 1]!)) keep(m[1]!);
  }
  for (const line of (ifInet6 ?? "").split("\n")) {
    const hex = line.trim().split(/\s+/)[0] ?? "";
    if (!/^[0-9a-f]{32}$/i.test(hex)) continue;
    keep((hex.match(/.{4}/g) ?? []).map((g) => g.replace(/^0{1,3}/, "")).join(":").replace(/(^|:)0(:0)+(:|$)/, "::"));
  }
  return out;
}

/** One entry of an expected list: the attempts it covers (by id), and the answer each must get. */
export interface Expected {
  /** The attempts this entry covers, by id. */
  ids: RegExp;
  /** The result each must give. */
  result: RegExp;
  /** Words its detail must contain: who answered, where the result alone does not say. */
  detail?: RegExp;
  /** Words its detail must not contain (for example, the egress proxy's own refusal). */
  detailNot?: RegExp;
  /** Why design note 2.5 allows it, in a few words. */
  why: string;
}

export interface ComparisonRow {
  id: string;
  target: string;
  expected: string;
  actual: string;
  pass: boolean;
}

export interface Comparison {
  rows: ComparisonRow[];
  /** Expected entries that no attempt matched: an answer the list asks for was not even tried. */
  missing: string[];
  pass: boolean;
}

/** How an expected answer reads in the table. */
const describeExpected = (e: Expected) => `${e.result.source.replace(/^\^|\$$/g, "")}${e.detail ? ` (${e.detail.source})` : ""}: ${e.why}`;

/** What "no answer" means in the table: every result the probe gives before a connection opened, except "error". */
export const NO_ANSWER = "no answer (refused, timed out, name not found, no name server, network unreachable)";

/**
 * Compare one container's attempts with its expected list, exactly. Each attempt covered by an entry must get
 * that answer, with its detail where the entry names one; with `othersSilent` (a project container), every
 * other attempt must get no answer, and a result the probe could not name ("error") fails, since it would
 * otherwise pass unseen. Without it (a comparison container, a positive control), only the entries are
 * checked. Every entry must cover at least one attempt the container made.
 */
export function compareWithExpected(report: ProbeReport, expected: Expected[], othersSilent = true): Comparison {
  const rows: ComparisonRow[] = [];
  const used = new Set<Expected>();
  for (const a of [...report.attempts].sort(compareIds)) {
    const e = expected.find((x) => x.ids.test(a.id));
    const actual = `${cell(a)}${a.detail ? `; ${a.detail}` : ""}`;
    if (e) {
      used.add(e);
      const pass = e.result.test(a.result) && (!e.detail || e.detail.test(a.detail)) && (!e.detailNot || !e.detailNot.test(a.detail));
      rows.push({ id: a.id, target: a.target, expected: describeExpected(e), actual, pass });
    } else if (othersSilent) {
      rows.push({ id: a.id, target: a.target, expected: NO_ANSWER, actual, pass: !gotAnswer(a.result) && a.result !== "error" });
    } else {
      rows.push({ id: a.id, target: a.target, expected: "not compared (comparison container)", actual, pass: true });
    }
  }
  const missing = expected.filter((e) => !used.has(e)).map((e) => `${e.ids.source}: ${e.why}`);
  return { rows, missing, pass: report.ended && report.problems.length === 0 && missing.length === 0 && rows.every((r) => r.pass) };
}

/** The comparison as a Markdown table, with a line for each expected answer that was not tried. */
export function renderComparison(label: string, c: Comparison): string {
  const esc = (t: string) => t.replace(/\|/g, "\\|");
  const lines = [`| Id | Target | Expected | Actual | ${esc(label)} |`, "| --- | --- | --- | --- | --- |"];
  for (const r of c.rows) lines.push(`| ${r.id} | ${esc(r.target)} | ${esc(r.expected)} | ${esc(r.actual)} | ${r.pass ? "PASS" : "FAIL"} |`);
  for (const m of c.missing) lines.push(`| (not tried) | | ${esc(m)} | not tried | FAIL |`);
  return lines.join("\n");
}

/** The project containers the development profile's lists are written for (package 0.6c; package J3: check, camera). */
export type DevContainer = "app" | "tools" | "db" | "runner" | "engine" | "egress" | "check" | "camera";

/**
 * The expected lists on the development profile (package 0.6c; design note 2.5, amendment of 13 Nov 2026).
 * Every attempt not listed must get no answer. `appPort` is the app's port; `gatewayServer` the words the
 * gateway (or its stand-in) puts in its `server` header.
 * - Every container: Docker's own name server inside the container's own network namespace (127.0.0.11, on a
 *   port Docker chooses: an X attempt), which answers only for the project's own names.
 * - On `data` (app, tools, db): the name `db` is found; the database and the app answer by name. The tools
 *   and database containers reach the app because the app listens on every address of its own container,
 *   `data` included (seen in package 0.6c's measurement; known gap 119).
 * - db, in its own network namespace: the database itself at its own loopback address (C5, C7).
 * - On `front` only (runner): the app by name.
 * - On `out` (the engine as package 2.2 would place it, and the door): through the door, the egress proxy
 *   lets the registry through (E1, E2, E4) and refuses example.com in its own words (E3, E5); the gateway
 *   answers at the door's gateway port (W1); the door's two ports answer by name.
 */
export function expectedOnDevelopment(container: DevContainer, ctx: { appPort: number; gatewayServer: RegExp; frontServer?: RegExp }): Expected[] {
  const dns: Expected = { ids: /^X/, result: /^connected$/, why: "Docker's own name server, inside this container's own network namespace (127.0.0.11)" };
  const onData: Expected[] = [
    { ids: /^D3$/, result: /^found \d+ address(es)?$/, why: "the project's database, by its name on the data network" },
    { ids: /^Pdb:5432$/, result: /^connected$/, why: "its project's database (2.5)" },
    { ids: new RegExp(`^Papp:${ctx.appPort}$`), result: /^connected$/, why: "the project's app, which listens on every address of its own container, data included (gap 119)" },
  ];
  const onOut: Expected[] = [
    { ids: /^E1$/, result: /^proxy answered 200$/, why: "the egress proxy, through the door, opens a tunnel to the registry" },
    { ids: /^E2$/, result: /^HTTP 200$/, why: "the registry answers inside the tunnel, its certificate checked with the container's own public roots" },
    { ids: /^E3$/, result: /^proxy answered 403$/, detail: /egress refused: example\.com is not an allowed host/, why: "the egress proxy refuses example.com, in its own words" },
    { ids: /^E4$/, result: /^HTTP \d{3}$/, detailNot: /egress (refused|error)/, why: "an allowed host by plain HTTP: passed on to the cloud session's proxy, which answers" },
    { ids: /^E5$/, result: /^HTTP 403$/, detail: /egress refused: example\.com is not an allowed host/, why: "the egress proxy refuses example.com, in its own words" },
    { ids: /^W1$/, result: /^HTTP \d{3}$/, detail: ctx.gatewayServer, why: "the model gateway, through the door's gateway port" },
    { ids: /^Pegress:3128$/, result: /^connected$/, why: "the door's egress proxy port" },
    { ids: /^Pegress:4010$/, result: /^connected$/, why: "the door's gateway port" },
  ];
  switch (container) {
    case "app":
    case "tools":
      return [dns, ...onData];
    case "db":
      return [dns, ...onData, { ids: /^C[57]$/, result: /^connected$/, why: "the database itself, at its own container's loopback address" }];
    case "runner":
      return [dns, { ids: new RegExp(`^Papp:${ctx.appPort}$`), result: /^connected$/, why: "the project's app, on the front network (the runner's only peer)" }];
    // Package J3: a stream container (the check service) has the runner's list: the app on front, nothing else.
    case "check":
      return [dns, { ids: new RegExp(`^Papp:${ctx.appPort}$`), result: /^connected$/, why: "the project's app, on the front network (a stream's only peer)" }];
    // Package J3: the live camera (the runner, with the camera socket's folder mounted): the runner's list, and through
    // the socket the preview front, which answers in its own words.
    case "camera":
      return [
        dns,
        { ids: new RegExp(`^Papp:${ctx.appPort}$`), result: /^connected$/, why: "the project's app, on the front network (the runner's only peer)" },
        { ids: /^U1$/, result: /^HTTP \d{3}$/, detail: ctx.frontServer ?? /server: preview-front/, why: "the preview front, through the camera socket (and nothing else through it)" },
      ];
    case "engine":
    case "egress":
      return [dns, ...onOut];
  }
}

/**
 * The positive controls (package 0.6c): attempts that must get an answer from the comparison containers, so
 * that a wrong address or port, which would read as "isolated" in a project container, shows as a failure
 * here. `canaryPort` is a listener the harness keeps on every address of the machine during the run; the
 * comparison container on the machine's own network must reach it at every machine address, and the one on
 * Docker's default network at that network's address on the machine (`bridgeAddress`).
 */
export function expectedPositiveControls(where: "machine" | "default-bridge", ctx: { canaryPort: number; bridgeAddress: string | null }): Expected[] {
  if (where === "machine") return [{ ids: new RegExp(`^M.*:${ctx.canaryPort}$`), result: /^connected$/, why: "the harness's own listener, on every address of the machine, reached at each machine address" }];
  const at = (ctx.bridgeAddress ?? "none").replace(/\./g, "\\.");
  return [{ ids: new RegExp(`^M${at}:${ctx.canaryPort}$`), result: /^connected$/, why: "the harness's own listener, reached at the address of Docker's default network on the machine" }];
}
