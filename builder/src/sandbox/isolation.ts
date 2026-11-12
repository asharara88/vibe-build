/**
 * Reading what the isolation probe prints (build plan package 0.6a).
 *
 * The probe (scripts/isolation-probe.mjs) runs inside a project container and prints one JSON line per
 * fact. This module turns those lines into a report, says which attempts got an answer (ANSWER_WORDING), and
 * draws the table of every attempt per container. It makes no connection itself.
 */

export type Toward = "outside" | "host" | "lookup" | "egress-proxy" | "session-proxy";

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
  /^(connected|refused|timed out|name not found|no name server answered|lookup refused by the name server|network unreachable|certificate not trusted|secure connection failed|connection reset|proxy closed without an answer|not an HTTP answer|error|HTTP \d{3}|proxy answered \d{3}|found \d+ address(es)?)$/;

const TOWARD = new Set<Toward>(["outside", "host", "lookup", "egress-proxy", "session-proxy"]);

/** What counts as an answer, in the words used wherever answers are counted. */
export const ANSWER_WORDING = "a connection opened, an HTTP status, a proxy's answer, or an address found";

/**
 * True if the attempt got an answer: a connection opened, an HTTP status, a proxy's answer, or an address
 * found. Every result the probe gives only after a connection opened counts, not only "connected":
 * "certificate not trusted" and "secure connection failed" (a TLS server answered on an open connection),
 * "connection reset", "proxy closed without an answer" and "not an HTTP answer" (review of 0.6a,
 * finding 11). An answer is not the same as reaching the target: a filter on the way can answer (the
 * report says which, from the answer's own words). Not counted: "refused" and "timed out" (no connection
 * opened), a lookup that found no address, "network unreachable", and "error", which the probe gives for
 * an error code it does not know and which can come before any connection opens.
 */
export function gotAnswer(result: string): boolean {
  return /^(connected|HTTP \d{3}|proxy answered \d{3}|found \d+ address|certificate not trusted|secure connection failed|connection reset|proxy closed without an answer|not an HTTP answer)/.test(result);
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
}

/** The rows of the table: every attempt any container made, in the order the probe makes them. */
function rows(columns: Column[]): ProbeAttempt[] {
  const seen = new Map<string, ProbeAttempt>();
  for (const c of columns) for (const a of c.report.attempts) if (!seen.has(a.id)) seen.set(a.id, a);
  const order = (id: string) => ["A", "B", "C", "X", "D", "E", "F"].indexOf(id[0] ?? "") * 100000 + Number(id.slice(1) || 0);
  return [...seen.values()].sort((x, y) => order(x.id) - order(y.id));
}

/** A plain-text table: one row per attempt, one column per container. */
export function renderTable(columns: Column[]): string {
  const header = ["id", "target", "what", ...columns.map((c) => c.label)];
  const body = rows(columns).map((r) => [r.id, r.target, r.what, ...columns.map((c) => cell(c.report.attempts.find((a) => a.id === r.id)))]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => (b[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(" | ").trimEnd();
  return [line(header), widths.map((w) => "-".repeat(w)).join("-|-"), ...body.map(line)].join("\n");
}

/** The same table in Markdown, for the evidence file. */
export function renderMarkdownTable(columns: Column[]): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const out = [`| Id | Target | What | ${columns.map((c) => esc(c.label)).join(" | ")} |`, `| --- | --- | --- | ${columns.map(() => "---").join(" | ")} |`];
  for (const r of rows(columns)) out.push(`| ${r.id} | ${esc(r.target)} | ${esc(r.what)} | ${columns.map((c) => esc(cell(c.report.attempts.find((a) => a.id === r.id)))).join(" | ")} |`);
  return out.join("\n");
}
