/**
 * Package J3, measurement M1 (final design, section 6): the owner's phone test, two script-free pages.
 *
 *   npx tsx scripts/probe-phone.ts <log file>          serve the pages (until stopped, or 2 hours)
 *   npx tsx scripts/probe-phone.ts --report <log file> read what was recorded, and say what the design's table decides
 *
 * The pages listen on 127.0.0.1:4032 ("probe-a") and 127.0.0.1:4033 ("probe-b"), which the session reports to the
 * owner's Claude app; 127.0.0.1:4034 also answers but is not reported (item vi). Port 4020 is not touched. The pages
 * carry no script (content-security-policy script-src 'none') and hold no data: each shows what its request carried.
 *
 * Recorded for each request, one JSON line in the log: (i) Host, and the Origin of a POST to itself; (ii) the
 * Sec-Fetch-Site the other page sees for a link and a form POST from this one; (iii) each page's own Lax and Strict
 * cookie round trip; (iv) Sec-Fetch-Dest; (v) every request header name and cookie name (values not recorded, except
 * Host, Origin, the Sec-Fetch-* headers and the User-Agent); (vi) whether 4034 answers at the address built from the
 * page's own Host; (vii) an answer marked `public, max-age=60` with a counter (a cache on the way would repeat it);
 * (viii) the User-Agent. (ix), whether the address opens when signed out, the owner tells.
 *
 * The decision (section 6, M1): same origin for the two pages: stop. Framed and cross-site (the Lax cookie does not
 * come back, or Sec-Fetch-Dest is iframe with Sec-Fetch-Site cross-site): stop, and use (B). Same host on another port,
 * or same-site: go on, with the cookie prefix, every-value cookie reads on 4020 too, and gap 157. Cross-site: go on.
 */
import { appendFileSync, readFileSync } from "node:fs";
import http from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORTS = { a: 4032, b: 4033, c: 4034 } as const;
type Probe = keyof typeof PORTS;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(", ") : (v ?? ""));
const KEPT = ["host", "origin", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user", "user-agent"];

/** The other page's address, built from this one's Host by changing its port number where it appears (item vi too). */
export function otherAddress(host: string, from: number, to: number, secure: boolean): string | null {
  if (!host.includes(String(from))) return null;
  return `${secure ? "https" : "http"}://${host.replace(String(from), String(to))}`;
}

export interface LogLine {
  at: string;
  probe: Probe;
  method: string;
  path: string;
  kept: Record<string, string>;
  header_names: string[];
  cookie_names: string[];
  counter?: number;
}

function serve(logFile: string): void {
  let counter = 0;
  for (const probe of Object.keys(PORTS) as Probe[]) {
    const server = http.createServer((req, res) => {
      const h = req.headers;
      const cookieNames = one(h.cookie)
        .split(";")
        .map((c) => c.trim().split("=")[0]!)
        .filter(Boolean);
      const line: LogLine = {
        at: new Date().toISOString(),
        probe,
        method: req.method ?? "",
        path: (req.url ?? "").slice(0, 100),
        kept: Object.fromEntries(KEPT.filter((k) => h[k] !== undefined).map((k) => [k, one(h[k]).slice(0, 300)])),
        header_names: Object.keys(h).sort(),
        cookie_names: cookieNames,
      };
      if (req.url === "/cached") line.counter = ++counter;
      appendFileSync(logFile, JSON.stringify(line) + "\n");
      req.resume();
      const host = one(h.host);
      const secure = one(h["x-forwarded-proto"]) === "https" || one(h.origin).startsWith("https:") || one(h.referer).startsWith("https:");
      const other: Probe = probe === "a" ? "b" : "a";
      const otherUrl = otherAddress(host, PORTS[probe], PORTS[other], secure);
      const cUrl = otherAddress(host, PORTS[probe], PORTS.c, secure);
      const seen = `<ul><li>Host: <code>${esc(host)}</code></li><li>Origin: <code>${esc(one(h.origin) || "(none)")}</code></li><li>Sec-Fetch-Site: <code>${esc(one(h["sec-fetch-site"]) || "(none)")}</code>; Sec-Fetch-Dest: <code>${esc(one(h["sec-fetch-dest"]) || "(none)")}</code></li><li>Cookies that came back: <code>${esc(cookieNames.join(", ") || "(none)")}</code></li></ul>`;
      let body: string;
      if (probe === "c") body = `<h1>Port 4034 answered</h1><p>This port was not shared with your app. Tell Claude Code that this page opened.</p>${seen}`;
      else if (req.url === "/cached") body = `<h1>Cached page</h1><p>Number: <strong>${counter}</strong>. Open it once more: if the number stays the same, something on the way kept a copy.</p><p><a href="/cached">Open it again</a> · <a href="/">Back</a></p>`;
      else {
        const steps = [
          `<form method="post" action="/self"><button type="submit">1. Send a form to this page</button></form>`,
          `<p><a href="/again">2. Open this page again (cookie check)</a></p>`,
          otherUrl ? `<p><a href="${esc(otherUrl)}/from-${probe}">3. Go to probe ${other.toUpperCase()} by a link</a></p>` : `<p>3. The address of probe ${other.toUpperCase()} could not be built from this one; open "probe-${other}" from your preview list instead.</p>`,
          otherUrl ? `<form method="post" action="${esc(otherUrl)}/from-${probe}-form"><button type="submit">4. Send a form to probe ${other.toUpperCase()}</button></form>` : "",
          cUrl && probe === "a" ? `<p><a href="${esc(cUrl)}/">5. Try a port that was not shared (4034)</a></p>` : "",
          probe === "a" ? `<p><a href="/cached">6. Open the cached page (twice)</a></p>` : "",
        ];
        body = `<h1>Probe ${probe.toUpperCase()}: a test page with no data</h1><p>Press the steps in order. Each one shows what this page received; nothing else happens.</p>${seen}${steps.join("")}`;
      }
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action *",
        "cache-control": req.url === "/cached" ? "public, max-age=60" : "no-store",
        "set-cookie": [`probe_${probe}_lax=1; SameSite=Lax; Path=/; HttpOnly`, `probe_${probe}_strict=1; SameSite=Strict; Path=/; HttpOnly`],
      });
      res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Probe ${probe.toUpperCase()}</title><style>body{font: 16px/1.5 system-ui,sans-serif;margin: 16px}button{font: inherit;padding: 8px 14px;margin: 6px 0}</style></head><body>${body}</body></html>`);
    });
    server.listen(PORTS[probe], "127.0.0.1", () => console.log(`probe-${probe} listening on 127.0.0.1:${PORTS[probe]}${probe === "c" ? " (not reported)" : ""}`));
  }
  setTimeout(() => process.exit(0), 2 * 60 * 60 * 1000).unref();
}

/** What the design's table decides from the log (section 6, M1). */
export function decide(lines: LogLine[]): { decision: string; facts: string[] } {
  const facts: string[] = [];
  const hostOf = (p: Probe) => lines.find((l) => l.probe === p)?.kept.host ?? null;
  const ha = hostOf("a");
  const hb = hostOf("b");
  facts.push(`Host seen by probe-a: ${ha ?? "never opened"}; by probe-b: ${hb ?? "never opened"}`);
  const selfPost = lines.find((l) => l.probe === "a" && l.method === "POST" && l.path === "/self");
  facts.push(`(i) Origin of a POST to itself: ${selfPost?.kept.origin ?? "(no Origin, or not done)"}`);
  const cross = lines.filter((l) => l.path.startsWith("/from-"));
  for (const l of cross) facts.push(`(ii) ${l.method} ${l.path} seen by probe-${l.probe}: Sec-Fetch-Site ${l.kept["sec-fetch-site"] ?? "(none)"}`);
  const again = lines.filter((l) => l.path === "/again");
  for (const l of again) facts.push(`(iii) probe-${l.probe} again: cookies back: ${l.cookie_names.join(", ") || "(none)"}`);
  const dests = [...new Set(lines.map((l) => `${l.kept["sec-fetch-dest"] ?? "(none)"} / ${l.kept["sec-fetch-site"] ?? "(none)"}`))];
  facts.push(`(iv) Sec-Fetch-Dest / Sec-Fetch-Site seen: ${dests.join("; ")}`);
  facts.push(`(v) header names seen: ${[...new Set(lines.flatMap((l) => l.header_names))].join(", ")}; cookie names: ${[...new Set(lines.flatMap((l) => l.cookie_names))].join(", ") || "(none)"}`);
  facts.push(`(vi) the unreported port 4034 answered: ${lines.some((l) => l.probe === "c") ? "YES" : "no"}`);
  const counters = lines.filter((l) => l.path === "/cached").map((l) => l.counter);
  facts.push(`(vii) the cached page reached the probe ${counters.length} time(s)${counters.length ? ` (numbers ${counters.join(", ")})` : ""}`);
  facts.push(`(viii) User-Agent: ${[...new Set(lines.map((l) => l.kept["user-agent"] ?? ""))].join(" | ")}`);
  facts.push("(ix) opened when signed out: as the owner tells");
  let decision: string;
  const laxBack = again.filter((l) => l.cookie_names.some((n) => n.endsWith("_lax")));
  const framedCross = lines.some((l) => l.kept["sec-fetch-dest"] === "iframe" && l.kept["sec-fetch-site"] === "cross-site");
  if (!ha || !hb) decision = "not decided: both pages must be opened";
  else if (ha === hb) decision = "STOP: both pages had the same origin";
  else if (again.length && laxBack.length === 0) decision = "STOP and use (B): the Lax cookie did not come back (a framed cross-site pane)";
  else if (framedCross) decision = "STOP and use (B): framed, cross-site (Sec-Fetch-Dest iframe with Sec-Fetch-Site cross-site)";
  else {
    const strip = (h: string) => h.replace(/:\d+$/, "");
    const siteOf = (h: string) => strip(h).split(".").slice(-2).join(".");
    if (strip(ha) === strip(hb)) decision = "GO ON: the same host on another port (with the cookie prefix, every-value cookie reads on 4020 too, and gap 157)";
    else if (siteOf(ha) === siteOf(hb) || cross.some((l) => l.kept["sec-fetch-site"] === "same-site")) decision = "GO ON: same-site (with the cookie prefix, every-value cookie reads on 4020 too, and gap 157)";
    else decision = "GO ON: cross-site";
  }
  if (lines.some((l) => l.probe === "c")) decision += "; and an unreported port answered: gap 157";
  if (counters.length >= 2 && new Set(counters).size < counters.length) decision += "; a cache on the way: gap 157";
  return { decision, facts };
}

function main(args: string[]): void {
  if (args[0] === "--report") {
    const lines = readFileSync(resolve(args[1] ?? ""), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LogLine);
    const r = decide(lines);
    for (const f of r.facts) console.log(f);
    console.log(`DECISION: ${r.decision}`);
  } else if (args[0]) serve(resolve(args[0]));
  else {
    console.error("Usage: npx tsx scripts/probe-phone.ts <log file> | --report <log file>");
    process.exitCode = 2;
  }
}

/** Run only when started as a script, so that a test can import decide() without serving the pages or setting an exit code. */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
