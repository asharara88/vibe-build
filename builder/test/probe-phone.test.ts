/**
 * Package J3, measurement M1: the decision of the owner's phone test (`scripts/probe-phone.ts --report`), from made-up
 * log lines. The pages are not served: nothing listens, and ports 4032 to 4034 are not touched.
 *
 * After the independent review of 14787d8 (14 Nov 2026): the report said "GO ON" as soon as both pages had been
 * opened. Now GO ON needs the evidence of every mandatory item of the design's section 6, M1 (items i to ix); with any
 * item missing the result is "not decided", naming it. A STOP is still returned on evidence that already decides STOP.
 * The addresses use the reserved `.test` names; the browser's name is made up.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decide, type LogLine, type OwnerAnswers } from "../scripts/probe-phone.js";

const BUILDER_DIR = join(import.meta.dirname, "..");
const UA = "MadeUpPhone/1.0 (a made-up test browser)";
const MITIGATIONS = "(with the cookie prefix, every-value cookie reads on 4020 too, and gap 157)";

/** Every mandatory item, in the report's order. */
const ALL_IDS = [
  "(i) probe-a",
  "(i) probe-b",
  "(ii) probe-a to probe-b, link",
  "(ii) probe-a to probe-b, form",
  "(ii) probe-b to probe-a, link",
  "(ii) probe-b to probe-a, form",
  "(iii) probe-a",
  "(iv) probe-a",
  "(iii) probe-b",
  "(iv) probe-b",
  "(v)",
  "(vi)",
  "(vii)",
  "(viii)",
  "(ix)",
];
/** Recorded on every request: done as soon as both pages have been opened. */
const RECORDED_ALWAYS = ["(v)", "(viii)"];

type P = LogLine["probe"];
function req(probe: P, method: string, path: string, kept: Record<string, string>, cookies: string[] = [], counter?: number): LogLine {
  const k: Record<string, string> = { "user-agent": UA, "sec-fetch-dest": "document", ...kept };
  return { at: "2026-11-14T10:00:00.000Z", probe, method, path, kept: k, header_names: Object.keys(k).sort(), cookie_names: cookies, ...(counter === undefined ? {} : { counter }) };
}

interface Pages {
  ha: string;
  hb: string;
  oa: string;
  ob: string;
  /** The Sec-Fetch-Site each page sees for the other's link and form. */
  site: string;
  dest?: string;
}
const SAME_HOST: Pages = { ha: "preview.example.test:4032", hb: "preview.example.test:4033", oa: "https://preview.example.test:4032", ob: "https://preview.example.test:4033", site: "same-site" };
const SAME_SITE: Pages = { ha: "p4032.preview.example.test", hb: "p4033.preview.example.test", oa: "https://p4032.preview.example.test", ob: "https://p4033.preview.example.test", site: "same-site" };
const CROSS_SITE: Pages = { ha: "pv4032.test", hb: "pv4033.test", oa: "https://pv4032.test", ob: "https://pv4033.test", site: "cross-site" };

/** A whole phone run as the owner's steps make it: probe-a's steps 1 to 6 (step 5 reaching nothing, step 6 twice), then probe-b's 1 to 4. */
function phoneRun(p: Pages): LogLine[] {
  const d = p.dest ?? "document";
  const own = (x: "a" | "b") => [`probe_${x}_lax`, `probe_${x}_strict`];
  return [
    req("a", "GET", "/", { host: p.ha, "sec-fetch-site": "none", "sec-fetch-dest": d }),
    req("a", "POST", "/self", { host: p.ha, origin: p.oa, "sec-fetch-site": "same-origin", "sec-fetch-dest": d }, own("a")),
    req("a", "GET", "/again", { host: p.ha, "sec-fetch-site": "same-origin", "sec-fetch-dest": d }, own("a")),
    req("b", "GET", "/from-a", { host: p.hb, "sec-fetch-site": p.site, "sec-fetch-dest": d }),
    req("b", "POST", "/from-a-form", { host: p.hb, origin: p.oa, "sec-fetch-site": p.site, "sec-fetch-dest": d }, own("b")),
    req("a", "GET", "/cached", { host: p.ha, "sec-fetch-site": "same-origin", "sec-fetch-dest": d }, own("a"), 1),
    req("a", "GET", "/cached", { host: p.ha, "sec-fetch-site": "same-origin", "sec-fetch-dest": d }, own("a"), 2),
    req("b", "GET", "/", { host: p.hb, "sec-fetch-site": "none", "sec-fetch-dest": d }, own("b")),
    req("b", "POST", "/self", { host: p.hb, origin: p.ob, "sec-fetch-site": "same-origin", "sec-fetch-dest": d }, own("b")),
    req("b", "GET", "/again", { host: p.hb, "sec-fetch-site": "same-origin", "sec-fetch-dest": d }, own("b")),
    req("a", "GET", "/from-b", { host: p.ha, "sec-fetch-site": p.site, "sec-fetch-dest": d }, own("a")),
    req("a", "POST", "/from-b-form", { host: p.ha, origin: p.ob, "sec-fetch-site": p.site, "sec-fetch-dest": d }, own("a")),
  ];
}

/** The owner's answers for a whole run whose step 5 reached nothing: 4034 did not open; signed out, it did not open. */
const ANSWERED: OwnerAnswers = { port4034: "did-not-open", signedOut: "did-not-open" };

const without = (lines: LogLine[], probe: P, method: string, path: string) => lines.filter((l) => !(l.probe === probe && l.method === method && l.path === path));
const one = (lines: LogLine[], probe: P, method: string, path: string) => lines.find((l) => l.probe === probe && l.method === method && l.path === path)!;
const missingOf = (r: ReturnType<typeof decide>) => (r.items ?? []).filter((i) => !i.done).map((i) => i.id);

describe("the phone test's decision, after the review of 14787d8: GO ON only with the evidence of every mandatory item (design section 6, M1)", () => {
  it("both pages opened and nothing else is not decided, and every item but (v) and (viii), which every request records, is named as missing (the review's case; regression for incomplete results)", () => {
    const lines = [req("a", "GET", "/", { host: SAME_SITE.ha, "sec-fetch-site": "none" }), req("b", "GET", "/", { host: SAME_SITE.hb, "sec-fetch-site": "none" })];
    const r = decide(lines, {});
    expect(r.decision).toMatch(/^not decided: missing /);
    for (const id of RECORDED_ALWAYS) expect(r.decision, id).not.toContain(id);
    for (const id of ALL_IDS.filter((x) => !RECORDED_ALWAYS.includes(x))) expect(r.decision, id).toContain(id);
    expect(missingOf(r)).toEqual(ALL_IDS.filter((x) => !RECORDED_ALWAYS.includes(x)));
  });

  const cases: [string, (l: LogLine[]) => LogLine[], OwnerAnswers, string[]][] = [
    ["probe-a's step 1 (its form to itself)", (l) => without(l, "a", "POST", "/self"), ANSWERED, ["(i) probe-a"]],
    ["probe-b's step 1 (its form to itself)", (l) => without(l, "b", "POST", "/self"), ANSWERED, ["(i) probe-b"]],
    ["the Origin of probe-a's form to itself", (l) => (delete one(l, "a", "POST", "/self").kept.origin, l), ANSWERED, ["(i) probe-a"]],
    ["an Origin other than null on probe-b's form to itself", (l) => ((one(l, "b", "POST", "/self").kept.origin = "null"), l), ANSWERED, ["(i) probe-b"]],
    ["one address for probe-a (a second Host for it in the log)", (l) => [...l, req("a", "GET", "/", { host: "p4032.elsewhere.example.test", "sec-fetch-site": "none" })], ANSWERED, ["(i) probe-a"]],
    ["probe-a's step 3 (its link to probe-b)", (l) => without(l, "b", "GET", "/from-a"), ANSWERED, ["(ii) probe-a to probe-b, link"]],
    ["probe-a's step 4 (its form to probe-b)", (l) => without(l, "b", "POST", "/from-a-form"), ANSWERED, ["(ii) probe-a to probe-b, form"]],
    ["probe-b's step 3 (its link to probe-a)", (l) => without(l, "a", "GET", "/from-b"), ANSWERED, ["(ii) probe-b to probe-a, link"]],
    ["probe-b's step 4 (its form to probe-a)", (l) => without(l, "a", "POST", "/from-b-form"), ANSWERED, ["(ii) probe-b to probe-a, form"]],
    ["the Sec-Fetch-Site of probe-b's form to probe-a", (l) => (delete one(l, "a", "POST", "/from-b-form").kept["sec-fetch-site"], l), ANSWERED, ["(ii) probe-b to probe-a, form"]],
    ["probe-a's step 2 (the page opened again)", (l) => without(l, "a", "GET", "/again"), ANSWERED, ["(iii) probe-a", "(iv) probe-a"]],
    ["probe-b's step 2 (the page opened again)", (l) => without(l, "b", "GET", "/again"), ANSWERED, ["(iii) probe-b", "(iv) probe-b"]],
    ["the Sec-Fetch-Dest of probe-b's step 2", (l) => (delete one(l, "b", "GET", "/again").kept["sec-fetch-dest"], l), ANSWERED, ["(iv) probe-b"]],
    ["the owner's answer on step 5 (4034), when no request reached it", (l) => l, { signedOut: "did-not-open" }, ["(vi)"]],
    ["an answer on step 5 that the log contradicts (it answered, yet no request reached 4034)", (l) => l, { port4034: "answered", signedOut: "did-not-open" }, ["(vi)"]],
    ["the cached page (probe-a's step 6)", (l) => without(l, "a", "GET", "/cached"), ANSWERED, ["(vii)"]],
    ["the cached page's second open reaching the probe, with no answer on its number", (l) => l.filter((x) => x.counter !== 2), ANSWERED, ["(vii)"]],
    ["an answer on the cached number that the log contradicts (it changed, yet the page reached the probe once)", (l) => l.filter((x) => x.counter !== 2), { ...ANSWERED, cachedNumber: "changed" }, ["(vii)"]],
    ["the User-Agent on probe-b's requests", (l) => (l.filter((x) => x.probe === "b").forEach((x) => delete x.kept["user-agent"]), l), ANSWERED, ["(viii)"]],
    ["the owner's answer on the signed-out window (ix)", (l) => l, { port4034: "did-not-open" }, ["(ix)"]],
  ];
  it.each(cases)("a whole run without %s is not decided, naming what is missing (regression for incomplete results)", (_what, change, answers, expected) => {
    const r = decide(change(phoneRun(SAME_SITE)), answers);
    expect(r.decision).toMatch(/^not decided: missing /);
    for (const id of expected) expect(r.decision, id).toContain(id);
    expect(missingOf(r)).toEqual(expected);
  });

  it("pages whose address does not show their port: steps 3 to 5 cannot be offered, so the result is not decided, naming (ii) and (vi) (regression for incomplete results)", () => {
    const pages: Pages = { ha: "pa.preview.example.test", hb: "pb.preview.example.test", oa: "https://pa.preview.example.test", ob: "https://pb.preview.example.test", site: "same-site" };
    const lines = phoneRun(pages).filter((l) => !l.path.startsWith("/from-"));
    const r = decide(lines, ANSWERED);
    expect(r.decision).toMatch(/^not decided: missing /);
    expect(missingOf(r)).toEqual(["(ii) probe-a to probe-b, link", "(ii) probe-a to probe-b, form", "(ii) probe-b to probe-a, link", "(ii) probe-b to probe-a, form", "(vi)"]);
    expect(r.items.find((i) => i.id === "(vi)")!.detail).toContain("could not be offered");
  });

  it("a whole run lists every mandatory item as done, with the owner's answers needed for it", () => {
    const r = decide(phoneRun(SAME_SITE), ANSWERED);
    expect(r.items.map((i) => i.id)).toEqual(ALL_IDS);
    expect(missingOf(r)).toEqual([]);
    expect(r.facts.join("\n")).toContain("the owner's answer: did-not-open");
  });

  // Behaviour controls: the GO ON rows on a whole run, as before the fix.
  it("a whole run, the same host on another port: GO ON with the cookie prefix (control)", () => {
    expect(decide(phoneRun(SAME_HOST), ANSWERED).decision).toBe(`GO ON: the same host on another port ${MITIGATIONS}`);
  });
  it("a whole run, same-site: GO ON with the cookie prefix (control)", () => {
    expect(decide(phoneRun(SAME_SITE), ANSWERED).decision).toBe(`GO ON: same-site ${MITIGATIONS}`);
  });
  it("a whole run, cross-site: GO ON (control)", () => {
    expect(decide(phoneRun(CROSS_SITE), ANSWERED).decision).toBe("GO ON: cross-site");
  });
  it("a whole run with every answer given, the cached number changed: GO ON, and the answers are in the facts", () => {
    const r = decide(phoneRun(CROSS_SITE), { port4034: "did-not-open", cachedNumber: "changed", signedOut: "could-not-try" });
    expect(r.decision).toBe("GO ON: cross-site");
    expect(r.facts.join("\n")).toContain("could-not-try");
  });

  // Behaviour controls: the STOP rows, unchanged; a STOP is still returned on evidence that already decides it.
  it("the same Host for both pages: STOP, on a whole run and on the two page loads alone (control)", () => {
    expect(decide(phoneRun({ ...SAME_SITE, hb: SAME_SITE.ha }), ANSWERED).decision).toMatch(/^STOP: both pages had the same origin/);
    const two = [req("a", "GET", "/", { host: "preview.example.test", "sec-fetch-site": "none" }), req("b", "GET", "/", { host: "preview.example.test", "sec-fetch-site": "none" })];
    expect(decide(two).decision).toMatch(/^STOP: both pages had the same origin/);
  });
  it("the Lax cookie back on neither page's step 2: STOP and use (B) (control)", () => {
    const lines = phoneRun(CROSS_SITE);
    for (const l of lines) if (l.path === "/again") l.cookie_names = [];
    expect(decide(lines, ANSWERED).decision).toMatch(/^STOP and use \(B\): the Lax cookie did not come back/);
  });
  it("framed and cross-site: STOP and use (B), on a whole run and on the two page loads alone (control)", () => {
    expect(decide(phoneRun({ ...CROSS_SITE, dest: "iframe" }), ANSWERED).decision).toMatch(/^STOP and use \(B\): framed, cross-site/);
    const two = [req("a", "GET", "/", { host: CROSS_SITE.ha, "sec-fetch-site": "cross-site", "sec-fetch-dest": "iframe" }), req("b", "GET", "/", { host: CROSS_SITE.hb, "sec-fetch-site": "cross-site", "sec-fetch-dest": "iframe" })];
    expect(decide(two).decision).toMatch(/^STOP and use \(B\): framed, cross-site/);
  });
  it("probe-b never opened: not decided, both pages must be opened (control)", () => {
    const lines = phoneRun(SAME_SITE).filter((l) => l.probe === "a" && !l.path.startsWith("/from-"));
    expect(decide(lines, ANSWERED).decision).toMatch(/^not decided: both pages must be opened/);
  });
  it("an unreported port that answered: GO ON with gap 157 (control)", () => {
    const lines = [...phoneRun(SAME_SITE), req("c", "GET", "/", { host: "p4034.preview.example.test", "sec-fetch-site": "same-site" })];
    const r = decide(lines, { signedOut: "did-not-open" });
    expect(r.decision).toMatch(/^GO ON: same-site/);
    expect(r.decision).toContain("; and an unreported port answered: gap 157");
  });

  // STOP on evidence the decision did not read before.
  it("the same Origin on both pages' forms to themselves, under Hosts that differ (a tunnel that rewrites Host): STOP, same origin", () => {
    const r = decide(phoneRun({ ha: "127.0.0.1:4032", hb: "127.0.0.1:4033", oa: "https://preview.example.test", ob: "https://preview.example.test", site: "same-site" }), ANSWERED);
    expect(r.decision).toBe("STOP: both pages had the same origin (the Origin of each page's form to itself: https://preview.example.test)");
  });
  it("Sec-Fetch-Site same-origin on a request from the other page: STOP, same origin", () => {
    expect(decide(phoneRun({ ...SAME_SITE, site: "same-origin" }), ANSWERED).decision).toMatch(/^STOP: both pages had the same origin \(probe-b saw Sec-Fetch-Site same-origin for GET \/from-a\)/);
  });
  it("probe-b's own Lax cookie not back on its step 2, though probe-a's was (a shared host sends it to both): STOP and use (B)", () => {
    const lines = phoneRun(SAME_HOST);
    one(lines, "b", "GET", "/again").cookie_names = ["probe_a_lax", "probe_a_strict"];
    expect(decide(lines, ANSWERED).decision).toBe("STOP and use (B): the Lax cookie did not come back (a framed cross-site pane) on probe-b");
  });

  // What the owner's answers add.
  it("a cache on the way: the cached page reached the probe once and the owner saw the same number twice: GO ON with gap 157", () => {
    const r = decide(phoneRun(SAME_SITE).filter((x) => x.counter !== 2), { ...ANSWERED, cachedNumber: "same" });
    expect(r.decision).toBe(`GO ON: same-site ${MITIGATIONS}; a cache on the way (the cached page's number stayed the same): gap 157`);
  });
  it("probe-a opened when signed out: GO ON with gaps 153 and 157", () => {
    const r = decide(phoneRun(CROSS_SITE), { port4034: "did-not-open", signedOut: "opened" });
    expect(r.decision).toBe("GO ON: cross-site; and probe-a opened when signed out (its address is public): gaps 153 and 157");
  });
});

describe("the phone test's report as a command (npx tsx scripts/probe-phone.ts --report; nothing listens)", () => {
  const run = (lines: LogLine[], flags: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), "probe-phone-"));
    try {
      const file = join(dir, "phone.log");
      writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      return spawnSync(process.execPath, ["--import", "tsx", "scripts/probe-phone.ts", "--report", file, ...flags], { cwd: BUILDER_DIR, encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("both pages opened and nothing else: each item printed done or MISSING, the owner's answers printed, not decided, and no setting changed (regression for incomplete results)", () => {
    const r = run([req("a", "GET", "/", { host: SAME_SITE.ha, "sec-fetch-site": "none" }), req("b", "GET", "/", { host: SAME_SITE.hb, "sec-fetch-site": "none" })], []);
    expect(r.status, r.stderr).toBe(0);
    for (const id of ALL_IDS.filter((x) => !RECORDED_ALWAYS.includes(x))) expect(r.stdout, id).toContain(`MISSING ${id}:`);
    for (const id of RECORDED_ALWAYS) expect(r.stdout, id).toContain(`done    ${id}:`);
    expect(r.stdout).toContain("The owner's answers: --port-4034 not given; --cached-number not given; --signed-out not given");
    expect(r.stdout).toMatch(/^DECISION: not decided: missing /m);
    expect(r.stdout).not.toMatch(/^DECISION: GO ON/m);
    expect(r.stdout).toContain("This report changes no setting: the live preview stays off");
  });

  it("a whole run with the owner's answers: every item done, the answers recorded, GO ON", () => {
    const r = run(phoneRun(SAME_SITE), ["--port-4034=did-not-open", "--signed-out=could-not-try"]);
    expect(r.status, r.stderr).toBe(0);
    for (const id of ALL_IDS) expect(r.stdout, id).toContain(`done    ${id}:`);
    expect(r.stdout).not.toContain("MISSING");
    expect(r.stdout).toContain("The owner's answers: --port-4034=did-not-open; --cached-number not given; --signed-out=could-not-try");
    expect(r.stdout).toContain(`DECISION: GO ON: same-site ${MITIGATIONS}`);
  });

  it("an answer that is not one of its words, or an unknown option, is refused (exit code 2), and nothing is decided", () => {
    for (const bad of [["--signed-out=maybe"], ["--port-4034=yes"], ["--cached-number=1"], ["--go-on"]]) {
      const r = run(phoneRun(SAME_SITE), bad);
      expect(r.status, `${bad.join(" ")}: ${r.stdout}`).toBe(2);
      expect(r.stdout, bad.join(" ")).not.toContain("DECISION");
    }
  });
});
