/**
 * Package J3, measurement M1 (final design, section 6): the owner's phone test, two script-free pages.
 *
 *   npx tsx scripts/probe-phone.ts <log file>          serve the pages (until stopped, or 2 hours)
 *   npx tsx scripts/probe-phone.ts --report <log file> [--port-4034=answered|did-not-open]
 *       [--cached-number=same|changed] [--signed-out=opened|did-not-open|could-not-try]
 *                                                      read what was recorded, with the owner's answers for what the
 *                                                      log cannot show, and say what the design's table decides
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
 * What the log cannot show is the owner's answer, given to `--report` and printed with it: (vi) when no request reached
 * 4034, whether step 5 opened the page "Port 4034 answered"; (vii) when the cached page reached the probe fewer than two
 * times, whether its number stayed the same; (ix) always.
 *
 * The decision (section 6, M1): same origin for the two pages: stop. Framed and cross-site (the Lax cookie does not
 * come back, or Sec-Fetch-Dest is iframe with Sec-Fetch-Site cross-site): stop, and use (B). Same host on another port,
 * or same-site: go on, with the cookie prefix, every-value cookie reads on 4020 too, and gap 157. Cross-site: go on.
 * After the independent review of 14787d8 (14 Nov 2026): "go on" only when every item (i) to (ix) has its evidence
 * (`decide`); with any missing, "not decided", naming each. A stop is returned on the evidence that decides it. The
 * report changes no setting: the live preview stays off (`BUILDER_LIVE_PREVIEW`, read only by src/web/main.ts).
 */
import { appendFileSync, readFileSync } from "node:fs";
import http from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

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

/**
 * The owner's answers for what the log cannot show, given on the command line and printed with the report (after the
 * independent review of 14787d8). Each is needed only where the log does not already show the item.
 */
export interface OwnerAnswers {
  /** (vi) Probe-a's step 5: "answered" if the page "Port 4034 answered" opened, "did-not-open" if not. Needed when no request reached 4034. */
  port4034?: "answered" | "did-not-open";
  /** (vii) Probe-a's step 6: whether the number stayed the "same" or "changed" when opened again. Needed when the cached page reached the probe fewer than two times. */
  cachedNumber?: "same" | "changed";
  /** (ix) Whether probe-a opened in a private window when signed out of Claude. Always needed; "could-not-try" is an answer (the design: "if he can"). */
  signedOut?: "opened" | "did-not-open" | "could-not-try";
}

/** One mandatory item of section 6, M1, and whether the log (or the owner's answer) shows it done. */
export interface Item {
  id: string;
  done: boolean;
  detail: string;
}

const ANSWER_WORDS = {
  "port-4034": ["answered", "did-not-open"],
  "cached-number": ["same", "changed"],
  "signed-out": ["opened", "did-not-open", "could-not-try"],
} as const;

/** The owner's answers from `--port-4034=…`, `--cached-number=…` and `--signed-out=…`; an unknown option or word throws. */
export function readAnswers(args: string[]): OwnerAnswers {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: { "port-4034": { type: "string" }, "cached-number": { type: "string" }, "signed-out": { type: "string" } } });
  for (const [name, words] of Object.entries(ANSWER_WORDS)) {
    const v = values[name as keyof typeof ANSWER_WORDS];
    if (v !== undefined && !(words as readonly string[]).includes(v)) throw new Error(`--${name} must be one of: ${words.join(", ")} (given: ${v})`);
  }
  return {
    port4034: values["port-4034"] as OwnerAnswers["port4034"],
    cachedNumber: values["cached-number"] as OwnerAnswers["cachedNumber"],
    signedOut: values["signed-out"] as OwnerAnswers["signedOut"],
  };
}

/** The Sec-Fetch-Site values that place one page against the other. */
const SITES = ["same-origin", "same-site", "cross-site"];
const MITIGATIONS = "(with the cookie prefix, every-value cookie reads on 4020 too, and gap 157)";

/**
 * What the design's table decides (section 6, M1). After the independent review of 14787d8: GO ON only when every
 * mandatory item (i) to (ix) has its evidence, in the log or, for (vi), (vii) and (ix), in the owner's answers; with
 * any missing, "not decided", naming each. A STOP is returned on the evidence that decides it, whatever else is missing.
 */
export function decide(lines: LogLine[], answers: OwnerAnswers = {}): { decision: string; facts: string[]; items: Item[] } {
  const facts: string[] = [];
  const items: Item[] = [];
  const item = (id: string, done: boolean, detail: string) => items.push({ id, done, detail });
  const pathOf = (l: LogLine) => l.path.split("?")[0]!;
  const at = (p: Probe, method: string, path: string) => lines.filter((l) => l.probe === p && l.method === method && pathOf(l) === path);
  const hostsOf = (p: Probe) => [...new Set(lines.filter((l) => l.probe === p).map((l) => l.kept.host ?? "(none)"))];
  const ha = hostsOf("a");
  const hb = hostsOf("b");
  facts.push(`Host seen by probe-a: ${ha.join(", ") || "never opened"}; by probe-b: ${hb.join(", ") || "never opened"}`);
  // (i) Each page's one Host, and the Origin of its form to itself (step 1).
  const selfOrigin: { a?: string; b?: string } = {};
  for (const p of ["a", "b"] as const) {
    const hosts = hostsOf(p);
    const posts = at(p, "POST", "/self");
    const origin = posts.map((l) => l.kept.origin ?? "").find((o) => o !== "" && o !== "null");
    if (origin !== undefined) selfOrigin[p] = origin;
    facts.push(`(i) probe-${p}: Origin of a POST to itself: ${posts.length ? posts.map((l) => l.kept.origin ?? "(no Origin)").join(", ") : "(not done)"}`);
    item(
      `(i) probe-${p}`,
      hosts.length === 1 && origin !== undefined,
      hosts.length === 0 ? `probe-${p} was never opened`
      : hosts.length > 1 ? `probe-${p} was reached at more than one address (${hosts.join(", ")}): start a fresh log`
      : posts.length === 0 ? `step 1 on probe-${p} (a form sent to this page) not done`
      : origin === undefined ? `the form probe-${p} sent to itself came with no Origin, or Origin null: the table needs it to rule out one shared origin`
      : `Host ${hosts[0]}; Origin of its form to itself ${origin}`,
    );
  }
  // (ii) Each page's link and form to the other (steps 3 and 4), with the Sec-Fetch-Site the other page saw.
  const crossLines: LogLine[] = [];
  for (const p of ["a", "b"] as const) {
    const q = p === "a" ? "b" : "a";
    for (const [kind, method, path, step] of [["link", "GET", `/from-${p}`, 3], ["form", "POST", `/from-${p}-form`, 4]] as const) {
      const seen = at(q, method, path);
      crossLines.push(...seen);
      const site = seen.map((l) => l.kept["sec-fetch-site"] ?? "").find((s) => SITES.includes(s));
      facts.push(`(ii) ${method} ${path} seen by probe-${q}: ${seen.length ? `Sec-Fetch-Site ${seen.map((l) => l.kept["sec-fetch-site"] ?? "(none)").join(", ")}` : "not done"}`);
      item(
        `(ii) probe-${p} to probe-${q}, ${kind}`,
        site !== undefined,
        seen.length === 0 ? `step ${step} on probe-${p} (a ${kind} to probe ${q.toUpperCase()}) not done`
        : site === undefined ? `it reached probe-${q} with no Sec-Fetch-Site the table can read (${seen.map((l) => l.kept["sec-fetch-site"] ?? "none").join(", ")})`
        : `Sec-Fetch-Site ${site}`,
      );
    }
  }
  // (iii) Each page's own Lax and Strict cookies on its step 2; (iv) the Sec-Fetch-Dest of that step.
  const laxMissing: string[] = [];
  for (const p of ["a", "b"] as const) {
    const again = at(p, "GET", "/again");
    const own = (kind: string) => again.some((l) => l.cookie_names.includes(`probe_${p}_${kind}`));
    if (again.length && !own("lax")) laxMissing.push(`probe-${p}`);
    const back = `its own Lax cookie ${own("lax") ? "came back" : "did NOT come back"}, its own Strict cookie ${own("strict") ? "came back" : "did NOT come back"}`;
    facts.push(`(iii) probe-${p} opened again: ${again.length ? `cookies back: ${[...new Set(again.flatMap((l) => l.cookie_names))].join(", ") || "(none)"}; ${back}` : "not done"}`);
    item(`(iii) probe-${p}`, again.length > 0, again.length ? back : `step 2 on probe-${p} (open this page again) not done`);
    const dest = again.map((l) => l.kept["sec-fetch-dest"] ?? "").find((d) => d !== "");
    item(`(iv) probe-${p}`, dest !== undefined, again.length === 0 ? `step 2 on probe-${p} not done (its Sec-Fetch-Dest is read there)` : dest === undefined ? `step 2 on probe-${p} came with no Sec-Fetch-Dest` : `Sec-Fetch-Dest ${dest}`);
  }
  const dests = [...new Set(lines.map((l) => `${l.kept["sec-fetch-dest"] ?? "(none)"} / ${l.kept["sec-fetch-site"] ?? "(none)"}`))];
  facts.push(`(iv) Sec-Fetch-Dest / Sec-Fetch-Site seen: ${dests.join("; ")}`);
  // (v) Recorded on every request.
  facts.push(`(v) header names seen: ${[...new Set(lines.flatMap((l) => l.header_names))].join(", ")}; cookie names: ${[...new Set(lines.flatMap((l) => l.cookie_names))].join(", ") || "(none)"}`);
  item("(v)", ha.length > 0 && hb.length > 0, ha.length && hb.length ? "recorded on every request" : "both pages must be opened");
  // (vi) Probe-a's step 5: a request that reached 4034, or the owner's answer that it did not open.
  const cAnswered = lines.some((l) => l.probe === "c");
  const cOffered = ha.some((h) => otherAddress(h, PORTS.a, PORTS.c, false) !== null);
  facts.push(`(vi) the unreported port 4034 answered: ${cAnswered ? "YES" : "no request reached it"}; the owner's answer: ${answers.port4034 ?? "not given"}`);
  item(
    "(vi)",
    cAnswered || (cOffered && answers.port4034 === "did-not-open"),
    cAnswered ? "a request reached 4034's page"
    : !cOffered ? "step 5 could not be offered: probe-a's address does not show 4032 (or probe-a was not opened)"
    : answers.port4034 === "did-not-open" ? "did not open (the owner's answer); no request reached 4034"
    : answers.port4034 === "answered" ? "the owner says it answered, but no request reached 4034's page: the log and the answer disagree"
    : "no request reached 4034: the owner's answer is needed (--port-4034=answered or did-not-open)",
  );
  // (vii) Probe-a's step 6, twice: two requests that reached the probe, or one and the owner's word that the number stayed.
  const counters = lines.filter((l) => l.probe === "a" && l.counter !== undefined).map((l) => l.counter);
  const cacheSeen = answers.cachedNumber === "same" && counters.length >= 1;
  facts.push(`(vii) the cached page reached the probe ${counters.length} time(s)${counters.length ? ` (numbers ${counters.join(", ")})` : ""}; the owner's answer: ${answers.cachedNumber ?? "not given"}`);
  item(
    "(vii)",
    counters.length >= 2 || cacheSeen,
    cacheSeen ? "the number stayed the same (the owner's answer): a cache on the way"
    : counters.length >= 2 ? "reached the probe twice or more: no cache on the way seen"
    : counters.length === 0 ? "step 6 on probe-a (the cached page) not done"
    : answers.cachedNumber === "changed" ? "the owner says the number changed, but the page reached the probe once: the log and the answer disagree"
    : "the page reached the probe once: the owner's answer is needed (--cached-number=same or changed)",
  );
  // (viii) The User-Agent of each page's requests.
  const uaOn = (p: Probe) => lines.some((l) => l.probe === p && (l.kept["user-agent"] ?? "") !== "");
  facts.push(`(viii) User-Agent: ${[...new Set(lines.map((l) => l.kept["user-agent"] ?? ""))].join(" | ")}`);
  item("(viii)", uaOn("a") && uaOn("b"), uaOn("a") && uaOn("b") ? "recorded" : `no User-Agent recorded on ${["a", "b"].filter((p) => !uaOn(p as Probe)).map((p) => `probe-${p}`).join(" and ")}`);
  // (ix) The owner's word.
  facts.push(`(ix) probe-a opened when signed out: the owner's answer: ${answers.signedOut ?? "not given"}`);
  item("(ix)", answers.signedOut !== undefined, answers.signedOut ? `the owner's answer: ${answers.signedOut}` : "the owner's answer is needed (--signed-out=opened, did-not-open or could-not-try)");

  let decision: string;
  const missing = items.filter((i) => !i.done).map((i) => i.id);
  const sameOriginCross = crossLines.find((l) => l.kept["sec-fetch-site"] === "same-origin");
  const framedCross = lines.some((l) => l.kept["sec-fetch-dest"] === "iframe" && l.kept["sec-fetch-site"] === "cross-site");
  if (ha.some((h) => hb.includes(h))) decision = "STOP: both pages had the same origin";
  else if (selfOrigin.a !== undefined && selfOrigin.a === selfOrigin.b) decision = `STOP: both pages had the same origin (the Origin of each page's form to itself: ${selfOrigin.a})`;
  else if (sameOriginCross) decision = `STOP: both pages had the same origin (probe-${sameOriginCross.probe} saw Sec-Fetch-Site same-origin for ${sameOriginCross.method} ${sameOriginCross.path})`;
  else if (laxMissing.length) decision = `STOP and use (B): the Lax cookie did not come back (a framed cross-site pane) on ${laxMissing.join(" and ")}`;
  else if (framedCross) decision = "STOP and use (B): framed, cross-site (Sec-Fetch-Dest iframe with Sec-Fetch-Site cross-site)";
  else if (!ha.length || !hb.length) decision = `not decided: both pages must be opened; missing ${missing.join("; ")}`;
  else if (missing.length) decision = `not decided: missing ${missing.join("; ")}`;
  else {
    const strip = (h: string) => h.replace(/:\d+$/, "");
    const siteOf = (h: string) => strip(h).split(".").slice(-2).join(".");
    const [a, b] = [ha[0]!, hb[0]!];
    if (strip(a) === strip(b)) decision = `GO ON: the same host on another port ${MITIGATIONS}`;
    else if (siteOf(a) === siteOf(b) || crossLines.some((l) => l.kept["sec-fetch-site"] === "same-site")) decision = `GO ON: same-site ${MITIGATIONS}`;
    else decision = "GO ON: cross-site";
  }
  if (cAnswered) decision += "; and an unreported port answered: gap 157";
  if (cacheSeen) decision += "; a cache on the way (the cached page's number stayed the same): gap 157";
  if (answers.signedOut === "opened") decision += "; and probe-a opened when signed out (its address is public): gaps 153 and 157";
  return { decision, facts, items };
}

const USAGE = [
  "Usage: npx tsx scripts/probe-phone.ts <log file>",
  "       npx tsx scripts/probe-phone.ts --report <log file> [--port-4034=answered|did-not-open] [--cached-number=same|changed] [--signed-out=opened|did-not-open|could-not-try]",
].join("\n");

function main(args: string[]): void {
  if (args[0] === "--report") {
    let answers: OwnerAnswers;
    try {
      answers = readAnswers(args.slice(2));
    } catch (e) {
      console.error(`${(e as Error).message}\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    const lines = readFileSync(resolve(args[1] ?? ""), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LogLine);
    const r = decide(lines, answers);
    for (const f of r.facts) console.log(f);
    console.log("Each mandatory item (design section 6, M1):");
    for (const i of r.items) console.log(`  ${i.done ? "done   " : "MISSING"} ${i.id}: ${i.detail}`);
    const given = (name: string, v: string | undefined) => (v === undefined ? `--${name} not given` : `--${name}=${v}`);
    console.log(`The owner's answers: ${given("port-4034", answers.port4034)}; ${given("cached-number", answers.cachedNumber)}; ${given("signed-out", answers.signedOut)}`);
    console.log(`DECISION: ${r.decision}`);
    console.log("This report changes no setting: the live preview stays off until BUILDER_LIVE_PREVIEW=1 is set by hand for the owner's interface, which is done only after a GO ON is recorded.");
  } else if (args[0]) serve(resolve(args[0]));
  else {
    console.error(USAGE);
    process.exitCode = 2;
  }
}

/** Run only when started as a script, so that a test can import decide() without serving the pages or setting an exit code. */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
