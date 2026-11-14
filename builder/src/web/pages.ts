/**
 * The interface's pages (package J1), written with hono's `html` tagged template, which escapes every value
 * put into it. No page carries a script (the
 * content-security-policy says `script-src 'none'`); a page that must follow a running job refreshes itself
 * with a meta refresh.
 *
 * Every page shows the mode line, true on every page: "Scripted mode: no AI model is connected. The
 * real-model gate is closed." Each panel says Real or Simulated; a simulated panel says who wrote its
 * content. English and Arabic on every page, with `lang` and `dir` set (right to left for Arabic).
 *
 * Package J2 (a): the Projects screen's "Simulated build" panel, whose button starts the broken-copy demonstration
 * (shown as `brokenCopyDemoShown` decides); the badge on every page and list row of a project with any trace of the
 * broken copy (`brokenBadge`, from `JourneyState.brokenTrace`, never from the name); the plan and build screens from
 * the project's own plan (`planSteps(s)`); a failed checklist item's step; and the sign-off panel's lines for it.
 *
 * Package J2 (c): the interrupted panel's second wording, for a project marked interrupted with no job interrupted (its
 * app was set up or running when the interface stopped); the cost screen's note on the reservation of a step stopped
 * part-way (`holdsStoppedPartWay`); and, while the demonstration pause is on, its line on the build screen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Event } from "../store/events.js";
import type { Budget, StepHoldRow } from "../store/holds.js";
import { SET_ASIDE_FREEZE_REASON, type Freeze, type FreezeKind } from "../store/freezes.js";
import type { UnreconciledList } from "../store/reconcile.js";
import { fieldChecklist, MAX_FREE_TEXT, showReason, type Answer, type IntakeQuestion } from "../orchestrator/intake.js";
import {
  approveRefusal,
  BROKEN_STEP,
  brokenCopyDemoShown,
  buildStepRefusal,
  DISK_FLOOR_BYTES,
  EV,
  EXAMPLE_1_ASK,
  EXPORT_LABEL,
  JOB_RULES,
  jobRunFinished,
  JOURNEY_PREFIX,
  JOURNEY_STAND_IN_LABEL,
  MAX_BRIEF,
  MAX_NAME,
  runOutcome,
  SIGN_OFF_LABEL,
  signOffRefusal,
  type Journey,
  type JourneyState,
  type Stage,
} from "../orchestrator/journey.js";
import { LIVE_DATA_LABEL, LIVE_LABEL, REFUSAL_EXTRA, USED_LIVE_NOTE } from "../orchestrator/journey-jobs.js";
import type { LiveSession } from "./preview.js";
import { FRONT_TEXT_KEYS, type Texts } from "./preview-rules.ts";
import { STAND_IN_NOTE } from "../acceptance/store.js";

export type Lang = "en" | "ar";
export const LANGS: Lang[] = ["en", "ar"];
type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

const MESSAGES: Record<Lang, Record<string, string>> = {
  en: JSON.parse(readFileSync(join(import.meta.dirname, "messages", "en.json"), "utf8")) as Record<string, string>,
  ar: JSON.parse(readFileSync(join(import.meta.dirname, "messages", "ar.json"), "utf8")) as Record<string, string>,
};
export const messageKeys = (lang: Lang): string[] => Object.keys(MESSAGES[lang]);

/** A message in the page's language, with `{name}` filled in. A key missing from a language falls back to English (the key test keeps both files equal). */
export function t(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const m = MESSAGES[lang][key] ?? MESSAGES.en[key];
  if (m === undefined) throw new Error(`No message "${key}".`);
  return m.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all));
}

/** B5's raw ask for example 1, as the new-project box is prefilled (defined in journey.ts, which the demonstration also uses). */
export { EXAMPLE_1_ASK };

export const STYLESHEET = `
:root{ --ink: #1d2330; --muted: #5b6475; --line: #d5d9e2; --bg: #f6f7f9; --card: #fff; --real: #14633a; --real-bg: #e3f4ea; --sim: #7a4b00; --sim-bg: #fff2d6; --accent: #1f4fbf; --bad: #9b1c1c }
*{ box-sizing: border-box }
body{ margin: 0; font: 16px/1.5 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif; color: var(--ink); background: var(--bg) }
header.top{ display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; padding: 10px 16px; background: var(--card); border-bottom: 1px solid var(--line) }
header.top .brand{ font-weight: 700 }
header.top .brand small{ font-weight: 400; color: var(--muted); margin-inline-start: 6px }
header.top nav{ display: flex; gap: 12px; flex-wrap: wrap; margin-inline-start: auto; align-items: center }
header.top form{ margin: 0 }
.mode{ margin: 0; padding: 8px 16px; background: #eef1f7; border-bottom: 1px solid var(--line); font-size: 14px }
main{ max-width: 960px; margin: 0 auto; padding: 16px }
h1{ font-size: 24px; margin: 8px 0 12px }
h2{ font-size: 19px; margin: 0 0 8px }
h3{ font-size: 16px; margin: 12px 0 4px }
a{ color: var(--accent) }
.tabs{ display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; padding: 0; list-style: none }
.tabs a,.tabs span{ display: inline-block; padding: 4px 10px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); text-decoration: none; font-size: 14px }
.tabs .here{ background: var(--ink); color: #fff; border-color: var(--ink) }
.panel{ background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; margin: 0 0 14px; overflow-wrap: anywhere }
.badge{ display: inline-block; font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 10px; margin-inline-start: 8px; vertical-align: middle }
.real .badge{ background: var(--real-bg); color: var(--real) }
.sim .badge{ background: var(--sim-bg); color: var(--sim) }
.sim{ border-inline-start: 4px solid #e3b341 }
.real{ border-inline-start: 4px solid #3aa168 }
.simnote{ font-size: 14px; color: var(--sim); background: var(--sim-bg); padding: 6px 8px; border-radius: 6px; margin: 4px 0 10px }
.note{ font-size: 14px; color: var(--muted) }
.warn{ color: var(--bad); font-weight: 600 }
.ok{ color: var(--real); font-weight: 600 }
.neutral{ color: var(--muted); font-weight: 600 }
label{ display: block; font-weight: 600; margin: 10px 0 4px }
input[type=text],input[type=password],input[type=number],textarea{ width: 100%; max-width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: 6px; font: inherit }
textarea{ min-height: 120px }
button{ font: inherit; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer }
button.secondary{ background: #fff; color: var(--accent) }
button.link{ background: none; border: none; color: var(--accent); padding: 0; text-decoration: underline }
.actions{ display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px }
table{ border-collapse: collapse; width: 100%; font-size: 14px }
th,td{ border-bottom: 1px solid var(--line); padding: 6px; text-align: start; vertical-align: top }
.scroll{ overflow-x: auto }
pre{ white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font-size: 13px }
.chat{ display: flex; flex-direction: column; gap: 10px }
.bubble{ border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--card); max-width: 100% }
.bubble.analyst{ background: #fbf7ee }
.bubble.you{ background: #eef4ff; align-self: flex-end }
.who{ font-size: 12px; font-weight: 700; color: var(--muted); margin-bottom: 4px }
fieldset{ border: 1px solid var(--line); border-radius: 8px; margin: 10px 0; padding: 8px 10px }
legend{ font-weight: 700; padding: 0 4px }
.opt{ display: flex; gap: 8px; align-items: flex-start; font-weight: 400; margin: 4px 0 }
.opt input{ margin-top: 4px }
.rmark{ display: inline-block; font-size: 11px; font-weight: 700; color: var(--real); border: 1px solid var(--real); border-radius: 8px; padding: 0 6px; margin-inline-start: 6px }
.later{ display: inline-block; font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 8px; padding: 0 6px; margin-inline-start: 6px }
.greyed{ color: var(--muted); background: #f0f1f4; border-radius: 6px; padding: 6px 8px }
.lines{ font-size: 14px; margin: 6px 0; padding-inline-start: 22px }
.lines li{ margin: 2px 0 }
.label{ display: inline-block; font-weight: 700; color: var(--sim); background: var(--sim-bg); border-radius: 6px; padding: 2px 8px }
figure{ margin: 0 0 14px }
figure img{ max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px }
figcaption{ font-size: 13px; color: var(--muted) }
.shots{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px }
ul,ol{ padding-inline-start: 22px; margin: 4px 0 }
@media (max-width: 480px){main{ padding: 12px }h1{ font-size: 21px }header.top nav{ margin-inline-start: 0 }}
`;

/* ------------------------------------------------------------------ layout */

export interface PageOpts {
  lang: Lang;
  title: string;
  /** The path the language switch comes back to. */
  back: string;
  signedIn: boolean;
  /** Seconds after which the page reloads itself (a running job). */
  refreshSeconds?: number;
}

export function layout(o: PageOpts, body: Html): Html {
  const dir = o.lang === "ar" ? "rtl" : "ltr";
  const other: Lang = o.lang === "en" ? "ar" : "en";
  return html`<!doctype html>
<html lang="${o.lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
${o.refreshSeconds ? html`<meta http-equiv="refresh" content="${o.refreshSeconds}">` : ""}
<title>${o.title} · ${t(o.lang, "app.name")}</title>
<link rel="stylesheet" href="/static/app.css">
</head>
<body>
<header class="top">
<div class="brand">${t(o.lang, "app.name")}<small>${t(o.lang, "app.tagline")}</small></div>
<nav>
${o.signedIn ? html`<a href="/projects">${t(o.lang, "nav.projects")}</a>` : ""}
<form method="post" action="/language"><input type="hidden" name="lang" value="${other}"><input type="hidden" name="back" value="${o.back}"><button class="link" type="submit" lang="${other}">${t(other, `lang.${other}`)}</button></form>
${o.signedIn ? html`<form method="post" action="/sign-out"><button class="link" type="submit">${t(o.lang, "nav.sign_out")}</button></form>` : ""}
</nav>
</header>
<p class="mode" role="status" data-mode="scripted">${t(o.lang, "mode.line")}</p>
<main>
${body}
</main>
</body>
</html>`;
}

/** A panel marked Real or Simulated; a simulated panel says who wrote its content. */
export function panel(lang: Lang, kind: "real" | "sim", title: string | Html, body: Html, o: { simNote?: string } = {}): Html {
  return html`<section class="panel ${kind}" data-panel="${kind === "real" ? "real" : "simulated"}">
<h2>${title}<span class="badge">${t(lang, kind === "real" ? "label.real" : "label.simulated")}</span></h2>
${kind === "sim" ? html`<p class="simnote">${o.simNote ?? t(lang, "simulated.note")}</p>` : ""}
${body}
</section>`;
}

/**
 * A step id ("01-data") isolated left to right: on an Arabic page, the right-to-left layout would otherwise show it
 * as "data-01" (review of 13 Nov 2026, note 7).
 */
export const stepId = (step: string): Html => html`<bdi dir="ltr">${step}</bdi>`;

/** A message whose {step} is a step id, isolated left to right. The rest of the message is escaped as any text is. */
function tStep(lang: Lang, key: string, vars: Record<string, string | number>, step: string): Html {
  const [before, ...after] = t(lang, key, vars).split("{step}");
  return html`${before}${after.map((a) => html`${stepId(step)}${a}`)}`;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const usd4 = (n: number) => `$${n.toFixed(4)}`;
/** To the millionth, as a bill above its hold is stored (it can differ from the hold by less than a cent). */
const usd6 = (n: number) => `$${n.toFixed(6)}`;

/**
 * The kind a freeze is shown under (packages 1.4, 1.4c and 1.4b). A set-aside freeze written by package 1.4b on a
 * database that had not yet run 1.4c's migration 010 has the kind 'unrecorded_ending' and the set-aside's reason
 * (store/freezes.ts, `frozenMessage`, reads it the same way): it is shown as a set-aside.
 */
export function shownFreezeKind(f: Pick<Freeze, "kind" | "reason">): FreezeKind {
  return f.kind === "unrecorded_ending" && f.reason === SET_ASIDE_FREEZE_REASON ? "journal_line_set_aside" : f.kind;
}

/* ------------------------------------------------------------------ sign-in and first run */

export function signInPage(lang: Lang, o: { message?: "wrong" | "locked" | "signed_out" | "setup_done"; lockedSeconds?: number } = {}): Html {
  const msg =
    o.message === "wrong"
      ? html`<p class="warn" role="alert">${t(lang, "sign_in.wrong")}</p>`
      : o.message === "locked"
        ? html`<p class="warn" role="alert">${t(lang, "sign_in.locked", { seconds: o.lockedSeconds ?? 0 })}</p>`
        : o.message === "signed_out"
          ? html`<p class="ok">${t(lang, "sign_in.signed_out")}</p>`
          : o.message === "setup_done"
            ? html`<p class="ok">${t(lang, "setup.done")}</p>`
            : "";
  return layout(
    { lang, title: t(lang, "sign_in.title"), back: "/sign-in", signedIn: false },
    html`<h1>${t(lang, "sign_in.title")}</h1>
${panel(
  lang,
  "real",
  t(lang, "sign_in.title"),
  html`${msg}<form method="post" action="/sign-in">
<label for="password">${t(lang, "sign_in.password")}</label>
<input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024">
<div class="actions"><button type="submit">${t(lang, "sign_in.submit")}</button></div>
</form>
<p class="note">${t(lang, "sign_in.footnote")}</p>`,
)}`,
  );
}

export function setupPage(lang: Lang, o: { message?: "mismatch" | "too_short" | "already" } = {}): Html {
  const msg = o.message ? html`<p class="warn" role="alert">${t(lang, `setup.${o.message}`)}</p>` : "";
  return layout(
    { lang, title: t(lang, "setup.title"), back: "/setup", signedIn: false },
    html`<h1>${t(lang, "setup.title")}</h1>
${panel(
  lang,
  "real",
  t(lang, "setup.title"),
  html`<p>${t(lang, "setup.intro")}</p>${msg}<form method="post" action="/setup">
<label for="password">${t(lang, "setup.password")}</label>
<input id="password" name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="1024">
<label for="again">${t(lang, "setup.again")}</label>
<input id="again" name="again" type="password" autocomplete="new-password" required minlength="12" maxlength="1024">
<div class="actions"><button type="submit">${t(lang, "setup.submit")}</button></div>
</form>
<p class="note">${t(lang, "sign_in.footnote")}</p>`,
)}`,
  );
}

/* ------------------------------------------------------------------ projects */

export function projectsPage(lang: Lang, rows: Array<{ state: JourneyState; spentUsd: number }>, others: number): Html {
  const list = rows.length
    ? html`<div class="scroll"><table>
<thead><tr><th>${t(lang, "col.name")}</th><th>${t(lang, "col.stage")}</th><th>${t(lang, "col.cap")}</th><th>${t(lang, "col.spent")}</th><th></th></tr></thead>
<tbody>${rows.map(
        (r) => html`<tr data-project="${r.state.project.id}">
<td><a href="/projects/${r.state.project.id}">${r.state.project.name}</a>${brokenBadge(lang, r.state)}</td>
<td>${stageName(lang, r.state.stage)}</td>
<td>${usd(Number(r.state.project.cap_usd))}</td>
<td>${usd(r.spentUsd)}</td>
<td><a href="/projects/${r.state.project.id}/record">${t(lang, "projects.record")}</a></td>
</tr>`,
      )}</tbody></table></div>`
    : html`<p>${t(lang, "projects.none")}</p>`;
  return layout(
    { lang, title: t(lang, "projects.title"), back: "/projects", signedIn: true },
    html`<h1>${t(lang, "projects.title")}</h1>
${panel(lang, "real", t(lang, "projects.title"), html`${list}<div class="actions"><a href="/projects/new">${t(lang, "projects.new")}</a></div>${others > 0 ? html`<p class="note">${t(lang, "projects.others", { n: others })}</p>` : ""}`)}
${brokenCopyDemoShown() ? demoPanel(lang) : ""}`,
  );
}

/**
 * Package J2 (a): the demonstration's panel, apart from "New project": labelled "Simulated build", with one button. The
 * route behind it makes a project the builder names itself (journey.ts, `createBrokenCopyDemo`).
 */
function demoPanel(lang: Lang): Html {
  return panel(lang, "sim", t(lang, "demo.title"), html`<p>${t(lang, "demo.intro")}</p><p class="note" data-demo-limit>${t(lang, "demo.limit")}</p><div class="actions">${postButton("/demonstrations/broken-copy", t(lang, "demo.button"))}</div>`, { simNote: t(lang, "demo.sim_note") });
}

/**
 * Package J2 (a): the badge of a project with any trace of the broken copy (`JourneyState.brokenTrace`), added by the
 * system on every page of the project and in its list row. Drawn from the record, never from the name.
 */
export function brokenBadge(lang: Lang, s: Pick<JourneyState, "brokenTrace">): Html | string {
  return s.brokenTrace ? html` <span class="label" data-broken-badge>${t(lang, "broken.badge")}</span>` : "";
}

export function stageName(lang: Lang, stage: Stage): string {
  return t(lang, `stage.${stage}`);
}

export function newProjectPage(lang: Lang, o: { error?: string; name?: string; cap?: string; brief?: string } = {}): Html {
  return layout(
    { lang, title: t(lang, "new.title"), back: "/projects/new", signedIn: true },
    html`<h1>${t(lang, "new.title")}</h1>
${panel(
  lang,
  "real",
  t(lang, "new.title"),
  html`${o.error ? html`<p class="warn" role="alert">${o.error}</p>` : ""}<form method="post" action="/projects">
<label for="name">${t(lang, "new.name")}</label>
<input id="name" name="name" type="text" required maxlength="${MAX_NAME}" value="${o.name ?? ""}">
<label for="cap">${t(lang, "new.cap")}</label>
<input id="cap" name="cap" type="text" inputmode="decimal" required maxlength="11" value="${o.cap ?? ""}">
<p class="note">${t(lang, "new.cap_help")}</p>
<label for="brief">${t(lang, "new.brief")}</label>
<p class="warn">${t(lang, "new.made_up")}</p>
<textarea id="brief" name="brief" required maxlength="${MAX_BRIEF}">${o.brief ?? EXAMPLE_1_ASK}</textarea>
<p class="note">${t(lang, "new.brief_limit")}</p>
<div class="actions"><button type="submit">${t(lang, "new.submit")}</button></div>
</form>`,
)}`,
  );
}

/* ------------------------------------------------------------------ one project */

export type Screen = "brief" | "questions" | "proposal" | "plan" | "build" | "preview" | "acceptance" | "export" | "cost" | "record";

/** The tabs of a project's screens, those its stage allows. */
export function tabs(lang: Lang, s: JourneyState, here: Screen): Html {
  const reached: Record<Screen, boolean> = {
    brief: true,
    questions: s.stage !== "brief" || s.answers.size > 0,
    proposal: s.stage !== "brief" && s.nextTurn === null,
    plan: s.briefConfirmed,
    build: s.planConfirmed,
    preview: s.previewFinished || s.jobs.some((j) => j.kind === "preview") || (s.plan.length > 0 && s.plan.every((st) => s.approved.has(st))),
    acceptance: s.previewFinished,
    export: s.signedOff,
    cost: true,
    record: true,
  };
  const order: Screen[] = ["brief", "questions", "proposal", "plan", "build", "preview", "acceptance", "export", "cost", "record"];
  const id = s.project.id;
  return html`<ul class="tabs">${order
    .filter((k) => reached[k])
    .map((k) => html`<li>${k === here ? html`<span class="here" aria-current="page">${t(lang, `tab.${k}`)}</span>` : html`<a href="/projects/${id}/${k}">${t(lang, `tab.${k}`)}</a>`}</li>`)}</ul>`;
}

function projectPage(lang: Lang, s: JourneyState, here: Screen, title: string, body: Html, o: { refreshSeconds?: number } = {}): Html {
  return layout(
    { lang, title: `${title} · ${s.project.name}`, back: `/projects/${s.project.id}/${here}`, signedIn: true, refreshSeconds: o.refreshSeconds },
    html`<h1>${s.project.name}${brokenBadge(lang, s)}</h1>
<p class="note">${t(lang, "col.stage")}: <strong data-stage="${s.stage}">${stageName(lang, s.stage)}</strong></p>
${tabs(lang, s, here)}
${s.interrupted && s.stage !== "closed" ? interruptedPanel(lang, s) : ""}
${body}`,
  );
}

function interruptedPanel(lang: Lang, s: JourneyState): Html {
  // Package J2 (c): "A job of this project was interrupted…" only when one was; otherwise the project had only its app
  // set up or running (its sandbox was removed at a stop, or found at the next start).
  const jobInterrupted = s.jobs.some((j) => j.state === "interrupted");
  return panel(
    lang,
    "real",
    t(lang, "error.title"),
    html`<p class="warn">${t(lang, jobInterrupted ? "interrupted.message" : "interrupted.no_job")}</p>
<div class="actions"><form method="post" action="/projects/${s.project.id}/close"><button type="submit">${t(lang, "interrupted.close")}</button></form><a href="/projects/new">${t(lang, "projects.new")}</a></div>`,
  );
}

const postButton = (action: string, label: string, cls = "") => html`<form method="post" action="${action}"><button type="submit" class="${cls}">${label}</button></form>`;

/** Package J2 (a): on a broken copy's plan and build screens, the line saying no step is checked after it runs, nor retried. */
const noQualityCheck = (lang: Lang, s: JourneyState): Html | string => (s.brokenTrace ? html`<p class="greyed" data-no-quality-check>${t(lang, "broken.no_quality_check")}</p>` : "");

/** Package J2 (a): under the broken step, what it does and why it is there. */
const brokenStepNote = (lang: Lang, step: string): Html | string => (step === BROKEN_STEP ? html`<div class="warn" data-broken-step>${t(lang, "broken.step_note")}</div>` : "");

export function briefPage(lang: Lang, s: JourneyState, j: Journey): Html {
  const id = s.project.id;
  const actions =
    s.stage === "brief"
      ? html`<div class="actions">${postButton(`/projects/${id}/continue`, t(lang, "brief.continue"))}${postButton(`/projects/${id}/stop`, t(lang, "brief.stop"), "secondary")}</div>`
      : s.stage === "stopped"
        ? html`<p class="warn">${t(lang, "brief.stopped")}</p>`
        : html`<p class="ok">${t(lang, "brief.continued")}</p>`;
  return projectPage(
    lang,
    s,
    "brief",
    t(lang, "brief.title"),
    html`${panel(lang, "real", t(lang, "brief.yours"), html`<pre data-brief>${s.brief ?? ""}</pre>`)}
${panel(lang, "sim", t(lang, "brief.restatement"), html`<p lang="en" dir="ltr">${j.spec.purpose.one_sentence}</p>${actions}`, { simNote: t(lang, "brief.simulated_analyst") })}`,
  );
}

/** How an answer reads in the chat. */
export function answerText(lang: Lang, q: IntakeQuestion, a: Answer): string {
  if ("option" in a) return (lang === "ar" ? q.options_ar : q.options)[a.option] ?? "?";
  if ("fields" in a) return [...a.fields, ...(a.something_else ? [`${t(lang, "questions.something_else")}: ${a.something_else}`] : [])].join(" · ");
  if ("open_text" in a) return a.open_text;
  return `${t(lang, "questions.something_else")}: ${a.something_else}`;
}

function questionText(lang: Lang, q: IntakeQuestion): string {
  return lang === "ar" ? q.question_ar : q.question;
}

/** What the analyst says under a question: the recommendation with its one reason, "their call", or nothing. */
function markLine(lang: Lang, q: IntakeQuestion): Html {
  const m = q.mark;
  if (m.kind === "R") return html`<p class="note" data-mark="R">${t(lang, "questions.recommended", { text: lang === "ar" ? m.text_ar : m.text, reason: lang === "ar" ? m.reason_ar : showReason(m.reason, "en") })}</p>`;
  if (m.kind === "their_call") return html`<p class="note" data-mark="their_call">${t(lang, "questions.their_call")}</p>`;
  if (m.kind === "conditional") return html`<p class="note" data-mark="conditional">${lang === "ar" ? m.text_ar : q.recommendation}</p>`;
  return html`<p class="note" data-mark="recorded_verbatim">${t(lang, "questions.recorded_verbatim")}</p>`;
}

function questionField(lang: Lang, q: IntakeQuestion, j: Journey): Html {
  const name = q.id;
  const optionLabel = (i: number) => {
    const isR = q.mark.kind === "R" && q.mark.options.includes(i);
    const later = q.available_later?.includes(i);
    return html`${(lang === "ar" ? q.options_ar : q.options)[i]}${isR ? html`<span class="rmark" title="${t(lang, "questions.r_mark")}">${t(lang, "questions.r_mark")}</span>` : ""}${later ? html`<span class="later">${t(lang, "questions.available_later")}</span>` : ""}`;
  };
  const elseInput = html`<input type="text" name="else_${name}" maxlength="${MAX_FREE_TEXT}" aria-label="${t(lang, "questions.something_else")}" placeholder="${t(lang, "questions.something_else_help")}">`;
  let inputs: Html;
  if (q.kind === "choice") {
    inputs = html`${q.options.map((_, i) => html`<label class="opt"><input type="radio" name="a_${name}" value="${i}" required> <span>${optionLabel(i)}</span></label>`)}
<label class="opt"><input type="radio" name="a_${name}" value="else"> <span>${t(lang, "questions.something_else")}</span></label>${elseInput}`;
  } else if (q.kind === "checklist") {
    inputs = html`<p class="note">${lang === "ar" ? q.options_ar_note ?? "" : q.bank_options}</p><p class="note">${t(lang, "questions.fields_note")}</p>
${fieldChecklist(j.spec).map((f) => html`<label class="opt"><input type="checkbox" name="f_${name}" value="${f}"> <span lang="en" dir="ltr">${f}</span></label>`)}
<label class="opt"><span>${t(lang, "questions.something_else")}</span></label>${elseInput}`;
  } else {
    inputs = html`<p class="note">${lang === "ar" ? q.options_ar_note ?? "" : q.bank_options}</p><input type="text" name="t_${name}" maxlength="${MAX_FREE_TEXT}" required aria-label="${t(lang, "questions.one_line")}">`;
  }
  return html`<fieldset data-question="${q.id}"><legend>${questionText(lang, q)}</legend>${markLine(lang, q)}${inputs}</fieldset>`;
}

export function questionsPage(lang: Lang, s: JourneyState, j: Journey): Html {
  const id = s.project.id;
  if (s.stage === "brief") return projectPage(lang, s, "questions", t(lang, "questions.title"), panel(lang, "sim", t(lang, "questions.title"), html`<p>${t(lang, "questions.not_yet")}</p>`, { simNote: t(lang, "brief.simulated_analyst") }));
  const total = j.intake.turns.length;
  const section = (sid: string) => j.intake.sections.find((x) => x.id === sid)?.[lang] ?? sid;
  const history = j.intake.turns
    .map((ids, turn) => ({ ids, turn }))
    .filter(({ ids }) => ids.every((q) => s.answers.has(q)))
    .map(
      ({ ids, turn }) => html`<div class="bubble analyst"><div class="who">${t(lang, "questions.analyst")} · ${t(lang, "questions.turn", { n: turn + 1, total })} · ${section(j.question(ids[0]!).section)}</div>
<ol>${ids.map((qid) => html`<li>${questionText(lang, j.question(qid))}</li>`)}</ol></div>
<div class="bubble you"><div class="who">${t(lang, "questions.you")}</div><ol>${ids.map((qid) => {
        const rec = s.answers.get(qid)!;
        return html`<li data-answer="${qid}">${answerText(lang, j.question(qid), rec.answer)}${rec.by === "scripted_customer" ? html`<div class="note">${t(lang, "questions.by_sheet")}</div>` : ""}${!rec.matchesSheet ? html`<div class="note" data-differs>${t(lang, "questions.differs")}</div>` : ""}</li>`;
      })}</ol></div>`,
    );
  let current: Html | string = "";
  if (s.stage === "questions" && s.nextTurn !== null) {
    const ids = j.intake.turns[s.nextTurn]!;
    current = html`<div class="bubble analyst"><div class="who">${t(lang, "questions.analyst")} · ${t(lang, "questions.turn", { n: s.nextTurn + 1, total })} · ${section(j.question(ids[0]!).section)}</div>
<form method="post" action="/projects/${id}/answers"><input type="hidden" name="turn" value="${s.nextTurn}">
${ids.map((qid) => questionField(lang, j.question(qid), j))}
<div class="actions"><button type="submit">${t(lang, "questions.submit")}</button></div>
</form></div>
<div class="actions">${postButton(`/projects/${id}/answer-rest`, t(lang, "questions.scripted_customer"), "secondary")}${postButton(`/projects/${id}/stop`, t(lang, "brief.stop"), "secondary")}</div>`;
  } else if (s.nextTurn === null) {
    current = html`<p class="ok">${t(lang, "questions.all_answered")}</p><div class="actions"><a href="/projects/${id}/proposal">${t(lang, "questions.see_proposal")}</a></div>`;
  } else if (s.stage === "stopped") {
    current = html`<p class="warn">${t(lang, "brief.stopped")}</p>`;
  }
  return projectPage(lang, s, "questions", t(lang, "questions.title"), panel(lang, "sim", t(lang, "questions.title"), html`<div class="chat">${history}${current}</div>`, { simNote: t(lang, "brief.simulated_analyst") }));
}

export function proposalPage(lang: Lang, s: JourneyState, j: Journey): Html {
  const id = s.project.id;
  if (s.nextTurn !== null || s.stage === "brief") return projectPage(lang, s, "proposal", t(lang, "proposal.title"), panel(lang, "sim", t(lang, "proposal.title"), html`<p>${t(lang, "proposal.not_yet")}</p>`));
  const spec = j.spec;
  const sec = (sid: string) => j.intake.sections.find((x) => x.id === sid)?.[lang] ?? sid;
  const body = html`<p class="note">${t(lang, "proposal.in_english")}</p>
<div lang="en" dir="ltr">
<h3>1. ${sec("purpose")}</h3>
<p>${spec.purpose.one_sentence}</p>
<p class="note">${t(lang, "proposal.replaces")}: ${spec.purpose.replaces} · ${t(lang, "proposal.who_pain")}: ${spec.purpose.who_feels_the_pain.join(", ")}</p>
<h3>2. ${sec("users")}</h3>
<ul>${spec.roles.map((r) => html`<li>${r.label} (${t(lang, "proposal.sees")}: ${r.sees})</li>`)}</ul>
<p class="note">${t(lang, "proposal.sign_in")}: ${spec.sign_in}</p>
<h3>3. ${sec("data")}</h3>
<ul>${spec.entities.map((e) => html`<li><strong>${e.label}</strong> (${t(lang, "proposal.starting_data")}: ${e.starting_data}): ${e.fields.map((f) => f.label).join(", ")}</li>`)}</ul>
<h3>4. ${sec("screens")}</h3>
<ul>${spec.screens.map((sc) => html`<li><strong>${sc.label}</strong> (${sc.for_role}): ${sc.shows}</li>`)}</ul>
<h3>5. ${sec("actions")}</h3>
<ul>${spec.actions.map(
    (a) => html`<li><strong>${a.label}</strong> (${a.by_role}). ${t(lang, "proposal.trigger")}: ${a.trigger} ${t(lang, "proposal.steps")}: ${a.steps.join(" ")} ${t(lang, "proposal.result")}: ${a.result}${a.notifies.length ? html` ${t(lang, "proposal.tells")}: ${a.notifies.map((n) => `${n.role} (${n.by})`).join(", ")}` : ""}</li>`,
  )}</ul>
<h3>6. ${sec("rules")}</h3>
<ul>${spec.rules.map((r) => html`<li>${r.statement} (${t(lang, "proposal.if_broken")}: ${r.on_breach}${r.their_call ? html`; ${t(lang, "proposal.their_call")}` : ""})</li>`)}</ul>
${spec.must_never_happen ? html`<p><strong>${t(lang, "proposal.must_never")}:</strong> ${spec.must_never_happen}</p>` : ""}
<h3>7. ${sec("done")}</h3>
<p>${t(lang, "proposal.checklist")}:</p>
<ol data-checklist>${spec.acceptance.map((i) => html`<li>As ${i.as_role}: ${i.does} Sees: ${i.sees}</li>`)}</ol>
<p class="note">${t(lang, "proposal.signs_off")}: ${spec.signs_off.join(", ")}</p>
<h3>${t(lang, "proposal.later")}</h3>
<ul data-later>${spec.later.map((l) => html`<li>${l.item}: ${l.reason}</li>`)}</ul>
<h3>${t(lang, "proposal.assumed")}</h3>
<ul data-assumed>${spec.assumed.map((a) => html`<li>${a.about}: ${a.chose} ${a.reason}</li>`)}</ul>
</div>
<p><strong>${t(lang, "proposal.confirm_sentence")}</strong></p>
<p class="note">${t(lang, "proposal.no_change")}</p>
${s.stage === "brief_review" ? html`<div class="actions">${postButton(`/projects/${id}/confirm-brief`, t(lang, "proposal.confirm"))}${postButton(`/projects/${id}/stop`, t(lang, "brief.stop"), "secondary")}</div>` : s.briefConfirmed ? html`<p class="ok">${t(lang, "proposal.confirmed")}</p>` : ""}`;
  return projectPage(lang, s, "proposal", t(lang, "proposal.title"), panel(lang, "sim", t(lang, "proposal.title"), body));
}

export function planPage(lang: Lang, s: JourneyState, j: Journey): Html {
  const id = s.project.id;
  if (!s.briefConfirmed) return projectPage(lang, s, "plan", t(lang, "plan.title"), panel(lang, "sim", t(lang, "plan.title"), html`<p>${t(lang, "plan.not_yet")}</p>`));
  const steps = j.planSteps(s);
  const body = html`<ol data-steps>${steps.map(
    (st) => html`<li data-step="${st.step}"><strong>${stepId(st.step)}</strong><div>${t(lang, "plan.shown")}: <span lang="en" dir="ltr">${st.label}</span></div>${brokenStepNote(lang, st.step)}<div class="note">${t(lang, "plan.files", { n: st.files })}</div></li>`,
  )}</ol>
<p class="greyed">${t(lang, "plan.not_built")}</p>
<p class="greyed">${t(lang, "plan.quality_gate")}</p>
${noQualityCheck(lang, s)}
<p class="note">${t(lang, "plan.tests_fixed")}</p>
${
  s.stage === "plan_review"
    ? html`<div class="actions">${postButton(`/projects/${id}/confirm-plan`, t(lang, "plan.confirm"))}${postButton(`/projects/${id}/stop`, t(lang, "brief.stop"), "secondary")}</div>`
    : s.planConfirmed
      ? html`<p class="ok">${t(lang, "plan.confirmed", { version: s.acceptanceVersion ?? "?" })}</p><div class="actions"><a href="/projects/${id}/build" data-go="build">${t(lang, "plan.go_build")}</a></div>`
      : ""
}`;
  return projectPage(lang, s, "plan", t(lang, "plan.title"), panel(lang, "sim", t(lang, "plan.title"), body, { simNote: t(lang, "simulated.note") }));
}

export interface CostView {
  budget: Budget;
  stepHolds: StepHoldRow[];
  /** Every freeze of the project not cleared, oldest first, each with the message `frozenMessage` gives for a step. */
  freezes: Array<{ freeze: Freeze; message: string }>;
  unreconciled: UnreconciledList;
  modelCalls: number;
  pricedModel: string;
  priceTableDate: string;
}

/**
 * Package J2 (c): the step holds stopped part-way, by their id: each opened by the last build job of its step, when that
 * job was interrupted (the interface stopped while it ran). Its close reads "step_ended" after a clean stop, or
 * "job_interrupted" after a crash; the cost screen adds a note to either, so that neither reads as a finished step.
 */
export function holdsStoppedPartWay(s: JourneyState): Set<string> {
  const out = new Set<string>();
  for (const [step, job] of s.stepJobs) {
    if (job.state !== "interrupted") continue;
    const end = s.events.find((e) => e.kind === EV.jobInterrupted && String(e.payload.job_id) === job.jobId);
    for (const e of s.events) {
      if (e.kind !== "step.hold_opened" || e.step !== step || BigInt(e.id) <= BigInt(job.startedEventId) || (end && BigInt(e.id) >= BigInt(end.id))) continue;
      out.add(String(e.payload.step_hold_id));
    }
  }
  return out;
}

export function costPage(lang: Lang, s: JourneyState, v: CostView): Html {
  const b = v.budget;
  const partWay = holdsStoppedPartWay(s);
  const left = Math.max(b.cap - b.spent - b.openHolds - b.stepRoom, 0);
  const figures = html`<table data-cost>
<tr><th>${t(lang, "cost.cap")}</th><td data-cap>${usd(b.cap)}</td></tr>
<tr><th>${t(lang, "cost.spent")}</th><td data-spent>${usd(b.spent)}</td></tr>
<tr><th>${t(lang, "cost.held")}</th><td data-held>${usd4(b.openHolds)}</td></tr>
<tr><th>${t(lang, "cost.step_room")}</th><td data-step-room>${usd4(b.stepRoom)}</td></tr>
<tr><th>${t(lang, "cost.left")}</th><td>${usd4(left)}</td></tr>
</table>
${b.spent === 0 && v.modelCalls === 0 ? html`<p class="note" data-zero>${t(lang, "cost.zero")}</p>` : ""}
<p class="note">${t(lang, "cost.read_only")}</p>`;
  const steps = v.stepHolds.length
    ? html`<div class="scroll"><table data-step-holds><thead><tr><th>${t(lang, "col.step")}</th><th>${t(lang, "cost.reserved")}</th><th>${t(lang, "cost.state")}</th></tr></thead>
<tbody>${v.stepHolds.map(
        (h) =>
          html`<tr><td>${stepId(h.step_id)}</td><td>${usd4(Number(h.budget_usd))}</td><td>${h.state}${h.closed_reason ? ` (${h.closed_reason})` : ""}${h.state === "closed" && partWay.has(String(h.id)) ? html`<br><span class="note" data-stopped-part-way>${t(lang, "cost.stopped_part_way")}</span>` : ""}</td></tr>`,
      )}</tbody></table></div>
<p class="note">${t(lang, "cost.priced", { model: v.pricedModel, date: v.priceTableDate })}</p>`
    : html`<p>${t(lang, "cost.no_steps")}</p>`;
  // Every freeze not cleared, each with its kind (packages 1.4, 1.4b and 1.4c) and the message the gateway's refusal gives.
  const freeze = v.freezes.length
    ? html`<p class="warn" data-frozen>${t(lang, "cost.frozen_intro")}</p>
<div class="scroll"><table data-freezes><thead><tr><th>#</th><th>${t(lang, "cost.freeze_kind")}</th><th>${t(lang, "cost.freeze_hold")}</th><th>${t(lang, "cost.freeze_message")}</th></tr></thead>
<tbody>${v.freezes.map(({ freeze: f, message }) => {
        const kind = shownFreezeKind(f);
        return html`<tr data-freeze="${f.id}" data-freeze-kind="${kind}"><td>${f.id}</td><td>${t(lang, `cost.kind.${kind}`)}<div class="note" lang="en" dir="ltr"><code>${kind}</code></div></td><td>${f.hold_id ?? ""}</td><td lang="en" dir="ltr">${message}</td></tr>`;
      })}</tbody></table></div>`
    : html`<p data-no-freeze>${t(lang, "cost.no_freeze")}</p>`;
  const un = v.unreconciled;
  const unreconciled =
    un.holds.length === 0 && un.freezesWithNoOpenHold.length === 0 && un.overrunFreezes.length === 0
      ? html`<p data-unreconciled-empty>${t(lang, "cost.unreconciled_none")}</p>`
      : html`<div class="scroll"><table data-unreconciled><thead><tr><th>#</th><th>${t(lang, "cost.amount")}</th><th>${t(lang, "cost.reason")}</th></tr></thead>
<tbody>${un.holds.map((h) => html`<tr data-unreconciled-hold="${h.holdId}"><td>${h.holdId}</td><td>${usd4(h.amountUsd)}</td><td>${h.kinds.join(", ")}${h.keptReason ? `: ${h.keptReason}` : ""}</td></tr>`)}${un.freezesWithNoOpenHold.map((f) => html`<tr data-freeze-no-open-hold="${f.freezeId}"><td>${f.freezeId}</td><td></td><td>${f.holdState ?? ""}</td></tr>`)}${un.overrunFreezes.map((o) => html`<tr data-overrun="${o.freezeId}"><td>${o.holdId}</td><td>${usd6(o.billUsd)}</td><td>${t(lang, "cost.overrun", { freeze: o.freezeId, bill: usd6(o.billUsd), held: usd6(o.heldUsd), above: usd6(o.aboveByUsd) })}</td></tr>`)}</tbody></table></div>`;
  return projectPage(
    lang,
    s,
    "cost",
    t(lang, "cost.title"),
    html`${panel(lang, "real", t(lang, "cost.title"), figures)}
${panel(lang, "real", t(lang, "cost.steps"), steps)}
${panel(lang, "real", t(lang, "cost.freeze"), freeze)}
${panel(lang, "real", t(lang, "cost.unreconciled"), unreconciled)}`,
  );
}

export function recordPage(lang: Lang, s: JourneyState): Html {
  const events: Event[] = s.events;
  return projectPage(
    lang,
    s,
    "record",
    t(lang, "record.title"),
    panel(
      lang,
      "real",
      t(lang, "record.title"),
      html`<p class="note">${t(lang, "record.order")}</p><p class="note">${t(lang, "record.count", { n: events.length })}</p>
${closeAction(lang, s)}
<div class="scroll"><table data-record><thead><tr><th>${t(lang, "col.id")}</th><th>${t(lang, "col.at")}</th><th>${t(lang, "col.kind")}</th><th>${t(lang, "col.step")}</th><th>${t(lang, "col.details")}</th></tr></thead>
<tbody>${events.map((e) => html`<tr data-event="${e.id}"><td>${e.id}</td><td>${e.at.toISOString()}</td><td>${e.kind}</td><td>${e.step ? stepId(e.step) : ""}</td><td><pre lang="en" dir="ltr">${JSON.stringify(e.payload, null, 1)}</pre></td></tr>`)}</tbody></table></div>`,
    ),
  );
}

/* ------------------------------------------------------------------ build, preview, acceptance, export (part 2) */

/** "Close project": removes its containers, images and sandbox folder; the record stays. Not while a job runs. */
function closeAction(lang: Lang, s: JourneyState): Html | string {
  if (s.stage === "closed") return html`<p class="note" data-closed>${t(lang, "close.done")}</p>`;
  if (s.runningJob) return "";
  return html`<div class="actions">${postButton(`/projects/${s.project.id}/close`, t(lang, "close.button"), "secondary")}</div><p class="note">${t(lang, "close.note")}</p>`;
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));

/** On an Arabic page, the English wording of a label the owner approved is shown under its Arabic, word for word. */
const englishToo = (lang: Lang, english: string): Html | string => (lang === "ar" ? html`<p class="note" lang="en" dir="ltr">${english}</p>` : "");

/** The lines of one step, from its events in id order: what the job, the reservation and the engine reported. */
export function stepLines(lang: Lang, s: JourneyState, step: string): Array<{ text: string; en?: boolean }> {
  const out: Array<{ text: string; en?: boolean }> = [];
  // A refusal's message is shown once, under the lines; the engine's and the job's copies of it are not repeated.
  const refusals = new Set(s.events.filter((e) => e.step === step && e.kind === "step.refused").map((e) => String(e.payload.message ?? "")));
  for (const e of s.events) {
    if (e.step !== step) continue;
    const p = e.payload;
    switch (e.kind) {
      case EV.sandboxMade:
        out.push({ text: t(lang, "build.line.sandbox") });
        break;
      case EV.jobStarted:
        if (p.kind === "build_step") out.push({ text: t(lang, "build.line.started") });
        break;
      case "step.hold_opened":
        out.push({ text: t(lang, "build.line.reserved", { usd: usd4(num(p.step_budget_usd)), turns: num(p.turns), model: String(p.model) }) });
        break;
      case EV.engineEvent:
        if (p.type === "text") out.push({ text: String(p.text), en: true });
        else if (p.type === "tool_call") {
          const input = (p.input ?? {}) as { path?: unknown; op?: unknown };
          out.push({ text: t(lang, "build.line.wrote", { path: String(input.path), op: String(input.op) }) });
        } else if (p.type === "finished") out.push({ text: t(lang, "build.line.engine_finished") });
        else if ((p.type === "failed" || p.type === "blocked") && !refusals.has(String(p.reason))) out.push({ text: t(lang, "build.line.engine_failed", { reason: String(p.reason) }), en: true });
        break;
      case "step.hold_closed":
        out.push({ text: t(lang, "build.line.released", { usd: usd4(num(p.released_usd)), spent: usd(num(p.spent_in_step_usd)) }) });
        break;
      case "step.refused":
        out.push({ text: t(lang, "build.line.refused") });
        break;
      case EV.workspaceReset:
        out.push({ text: t(lang, "build.line.reset") });
        break;
      case EV.jobFinished:
        out.push({ text: t(lang, "build.line.job_finished") });
        break;
      case EV.jobFailed:
        if (!refusals.has(String(p.reason))) out.push({ text: t(lang, "build.line.job_failed", { reason: String(p.reason) }), en: true });
        break;
      case EV.jobInterrupted:
        out.push({ text: t(lang, "build.line.job_interrupted") });
        break;
      case EV.stepApproved:
        out.push({ text: t(lang, "build.line.approved") });
        break;
    }
  }
  return out;
}

const lineList = (lines: Array<{ text: string; en?: boolean }>): Html =>
  html`<ol class="lines" data-lines>${lines.map((l) => (l.en ? html`<li><span lang="en" dir="ltr">${l.text}</span></li>` : html`<li>${l.text}</li>`))}</ol>`;

function runningNote(lang: Lang, s: JourneyState): Html | string {
  return s.runningJob ? html`<p class="note" data-job-running="${s.runningJob.kind}">${t(lang, "job.running", { kind: t(lang, `job.kind.${s.runningJob.kind}`) })}</p>` : "";
}

/**
 * The build screen. Package J2 (c): `stepPauseMs`, the demonstration pause while it is on (BUILDER_DEMO_STEP_PAUSE_MS),
 * is shown on it as a demonstration setting.
 */
export function buildPage(lang: Lang, s: JourneyState, j: Journey, o: { stepPauseMs?: number } = {}): Html {
  const id = s.project.id;
  if (!s.planConfirmed) return projectPage(lang, s, "build", t(lang, "build.title"), panel(lang, "real", t(lang, "build.title"), html`<p>${t(lang, "build.not_yet")}</p>`));
  const steps = j.planSteps(s);
  const open = !s.runningJob && !s.interrupted && s.stage !== "closed" && s.stage !== "stopped";
  // The next thing to do: build the first step not approved, or approve it once built.
  let action: Html | string = "";
  const next = steps.findIndex((st) => !s.approved.has(st.step));
  if (open && next >= 0) {
    const st = steps[next]!;
    const last = s.stepJobs.get(st.step);
    if (last?.state === "finished" && !approveRefusal(s, st.step)) {
      // Package J2: the approval before the broken step, and of it, say what they lead to.
      const label =
        steps[next + 1]?.step === BROKEN_STEP
          ? t(lang, "build.approve_broken", { n: next + 2 })
          : st.step === BROKEN_STEP
            ? t(lang, "build.approve_after_broken")
            : next < steps.length - 1
              ? t(lang, "build.approve_next")
              : t(lang, "build.approve_last");
      action = html`<form method="post" action="/projects/${id}/approve"><input type="hidden" name="step" value="${st.step}"><button type="submit" data-approve="${st.step}">${label}</button></form>`;
    } else if (!buildStepRefusal(s, st.step)) {
      const label = last?.state === "failed" || last?.state === "interrupted" ? t(lang, "build.retry", { n: next + 1 }) : t(lang, "build.start", { n: next + 1 });
      action = html`<form method="post" action="/projects/${id}/build"><input type="hidden" name="step" value="${st.step}"><button type="submit" data-build="${st.step}">${label}</button></form>`;
    }
  } else if (open && next < 0) {
    action = html`<a href="/projects/${id}/preview" data-go="preview">${t(lang, "build.go_preview")}</a>`;
  }
  const head = panel(
    lang,
    "real",
    t(lang, "build.title"),
    html`${runningNote(lang, s)}${o.stepPauseMs ? html`<p class="warn" data-step-pause="${o.stepPauseMs}">${t(lang, "build.step_pause", { ms: o.stepPauseMs.toLocaleString("en") })}</p>` : ""}<p>${t(lang, "build.intro")}</p>
<div class="actions">${action}</div>
<p class="note">${t(lang, "build.no_preview_after_1")}</p>
<p class="note">${t(lang, "build.disk_note", { gb: (DISK_FLOOR_BYTES / 1024 ** 3).toFixed(1) })}</p>
<p class="greyed">${t(lang, "plan.quality_gate")}</p>
${noQualityCheck(lang, s)}`,
  );
  const stepPanels = steps.map((st, i) => {
    const last = s.stepJobs.get(st.step);
    const state = last?.state ?? "none";
    const lines = stepLines(lang, s, st.step);
    const opened = s.events.filter((e) => e.step === st.step && e.kind === "step.hold_opened").at(-1);
    const closed = s.events.filter((e) => e.step === st.step && e.kind === "step.hold_closed").at(-1);
    const refused = s.events.filter((e) => e.step === st.step && e.kind === "step.refused").at(-1);
    const summary =
      refused && state === "failed"
        ? html`<div data-refused><p class="warn" lang="en" dir="ltr">${String(refused.payload.message ?? "")}</p><p class="warn">${t(lang, "build.refusal_extra")}</p>${englishToo(lang, REFUSAL_EXTRA)}</div>`
        : opened && closed
          ? html`<p class="ok" data-reserved="${usd4(num(opened.payload.step_budget_usd))}">${t(lang, "build.step_label", { usd: usd4(num(opened.payload.step_budget_usd)), model: String(opened.payload.model), spent: usd(num(closed.payload.spent_in_step_usd)) })}</p>`
          : "";
    return panel(
      lang,
      "sim",
      tStep(lang, "build.step_title", { n: i + 1, total: steps.length }, st.step),
      html`<div data-step="${st.step}" data-step-state="${state}" data-approved="${s.approved.has(st.step) ? "yes" : "no"}">
<p>${t(lang, "plan.shown")}: <span lang="en" dir="ltr">${st.label}</span></p>
${brokenStepNote(lang, st.step)}
${lines.length ? lineList(lines) : html`<p class="note">${t(lang, "build.not_built")}</p>`}
${summary}
${s.approved.has(st.step) ? html`<p class="ok">${t(lang, "build.approved")}</p>` : ""}
</div>`,
      { simNote: t(lang, "build.sim_note") },
    );
  });
  return projectPage(lang, s, "build", t(lang, "build.title"), html`${head}${stepPanels}`, { refreshSeconds: s.runningJob ? 2 : undefined });
}

/** Package J3: the texts of the preview front's own pages, from the message files ("front.*"), for both languages. */
export function frontTexts(): Texts {
  const pick = (lang: Lang) => Object.fromEntries(FRONT_TEXT_KEYS.map((k) => [k, t(lang, `front.${k}`)])) as Texts["en"];
  return { en: pick("en"), ar: pick("ar") };
}

const utcTime = (d: Date | number) => new Date(d).toISOString().slice(11, 19);

/**
 * Package J3: the live app's panel on the preview screen. Simulated build, labelled so. Offered only while the app
 * runs; the session's state as the preview holds it. Not marked approved for use: the owner's phone test comes first.
 */
function livePanel(lang: Lang, s: JourneyState, live: { port: number; session: LiveSession | null } | null): Html {
  const id = s.project.id;
  const labels = html`<p><span class="label" data-live-label>${t(lang, "live.label_sim")}</span></p><p><span class="label" data-live-data-label>${t(lang, "live.label_data")}</span></p>${englishToo(lang, `${LIVE_LABEL} ${LIVE_DATA_LABEL}`)}`;
  const lastClosed = s.events.filter((e) => e.kind === EV.liveClosed).at(-1);
  const closedNote = lastClosed ? html`<p class="note" data-live-closed="${String(lastClosed.payload.reason ?? "")}">${t(lang, "live.closed_last", { reason: String(lastClosed.payload.reason ?? "") })}</p>` : "";
  let body: Html;
  if (!live) body = html`${labels}<p class="note">${t(lang, "live.not_started")}</p>`;
  else if (!s.appRunning || s.stage === "closed") body = html`${labels}<p class="note" data-live-off>${t(lang, "live.only_running")}</p>${closedNote}`;
  else {
    const se = live.session;
    const canOpen = !s.runningJob && !s.interrupted && JOB_RULES.live(s) === null;
    const state = se
      ? se.entered
        ? html`<p class="ok" data-live-state="entered">${t(lang, "live.open_entered", { time: utcTime(se.enteredAt ?? se.openedAt), until: utcTime(se.endsAt) })}</p>`
        : html`<p class="neutral" data-live-state="pass_open">${t(lang, "live.open_pending", { time: utcTime(se.passExpiresAt) })}</p>`
      : html`<p class="note" data-live-state="none">${t(lang, "live.none_open")}</p>${closedNote}`;
    const why = JOB_RULES.live(s);
    body = html`${labels}<p>${t(lang, "live.intro")}</p>
<p class="warn" data-live-not-approved>${t(lang, "live.not_approved")}</p>
${state}
<div class="actions">
${canOpen ? html`<form method="post" action="/projects/${id}/live"><button type="submit" data-live-open>${t(lang, se ? "live.open_again" : "live.open")}</button></form>` : ""}
${se ? html`<form method="post" action="/projects/${id}/live/end"><button type="submit" class="secondary" data-live-end>${t(lang, "live.end")}</button></form>` : ""}
<form method="post" action="/projects/${id}/live/show"><button type="submit" class="secondary" data-live-show>${t(lang, "live.show")}</button></form>
</div>
${why && !s.runningJob ? html`<p class="warn" lang="en" dir="ltr" data-live-refused>${why}</p>` : ""}
<p class="note">${t(lang, "live.where", { port: live.port })}</p>
<p class="note">${t(lang, "live.checklist_note")}</p>`;
  }
  return panel(lang, "sim", t(lang, "live.title"), body, { simNote: t(lang, "live.sim_note") });
}

/** Package J3: the answer to "Open the live app": the pass, shown once, with what it is tied to. Masked in screenshots. */
export function livePassPage(lang: Lang, s: JourneyState, o: { shown: string; expiresAt: Date; port: number }): Html {
  const id = s.project.id;
  return projectPage(
    lang,
    s,
    "preview",
    t(lang, "live.pass_title"),
    panel(
      lang,
      "sim",
      t(lang, "live.pass_title"),
      html`<p><span class="label">${t(lang, "live.label_sim")}</span></p><p><span class="label">${t(lang, "live.label_data")}</span></p>
<p class="pass" data-pass dir="ltr" lang="en"><code style="font-size: 28px; letter-spacing: 4px">${o.shown}</code></p>
<p data-pass-valid>${t(lang, "live.pass_valid", { time: utcTime(o.expiresAt) })}</p>
<p class="note">${t(lang, "live.pass_bound")}</p>
<p>${t(lang, "live.where", { port: o.port })}</p>
<p class="warn">${t(lang, "live.not_approved")}</p>
<div class="actions"><form method="post" action="/projects/${id}/live/show"><button type="submit" class="secondary" data-live-show>${t(lang, "live.show")}</button></form><a href="/projects/${id}/preview" data-go="preview">${t(lang, "live.back")}</a></div>`,
      { simNote: t(lang, "live.sim_note") },
    ),
  );
}

/** Package J3: the answer to "Show": the made-up employee's sign-in. Masked in screenshots; never on a GET page. */
export function liveSamplePage(lang: Lang, s: JourneyState, o: { email: string; password: string }): Html {
  const id = s.project.id;
  return projectPage(
    lang,
    s,
    "preview",
    t(lang, "live.sample_title"),
    panel(
      lang,
      "sim",
      t(lang, "live.sample_title"),
      html`<table><tr><th>${t(lang, "live.sample_email")}</th><td dir="ltr" lang="en"><code data-sample-email>${o.email}</code></td></tr>
<tr><th>${t(lang, "live.sample_password")}</th><td dir="ltr" lang="en"><code data-sample-password>${o.password}</code></td></tr></table>
<p class="note">${t(lang, "live.sample_note")}</p>
<div class="actions"><a href="/projects/${id}/preview" data-go="preview">${t(lang, "live.back")}</a></div>`,
      { simNote: t(lang, "live.sim_note") },
    ),
  );
}

export function previewPage(lang: Lang, s: JourneyState, live: { port: number; session: LiveSession | null } | null = null): Html {
  const id = s.project.id;
  const lines = s.events.filter((e) => e.kind === EV.previewLine).slice(-12);
  const lastPreview = [...s.jobs].reverse().find((x) => x.kind === "preview");
  // The screenshots of the latest preview job only (one job runs at a time): never an earlier attempt's, which
  // failed part-way and whose files are kept (review bot on defb9c4).
  const shots = lastPreview ? s.events.filter((e) => e.kind === EV.screenshot && BigInt(e.id) > BigInt(lastPreview.startedEventId)) : [];
  const canStart = !s.runningJob && !s.interrupted && JOB_RULES.preview(s) === null;
  const status = html`${runningNote(lang, s)}
${lastPreview?.state === "failed" ? html`<p class="warn">${t(lang, "preview.failed")}</p><p class="warn" lang="en" dir="ltr">${lastPreview.reason ?? ""}</p>` : ""}
${s.appRunning ? html`<p class="ok" data-app-running>${t(lang, "preview.app_running")}</p>` : s.previewFinished ? html`<p class="note">${t(lang, "preview.app_stopped")}</p>` : ""}
${canStart ? html`<div class="actions">${postButton(`/projects/${id}/preview`, t(lang, "preview.start"))}</div>` : ""}
${lines.length ? html`<details${s.runningJob?.kind === "preview" ? html` open` : ""}><summary>${t(lang, "preview.lines")}</summary><ol class="lines">${lines.map((e) => html`<li lang="en" dir="ltr">${String(e.payload.line ?? "")}</li>`)}</ol></details>` : ""}
<p class="note">${t(lang, "preview.not_live")}</p>`;
  const gallery = shots.length
    ? html`<div class="shots" data-shots="${shots.length}">${shots.map(
        (e) => html`<figure data-shot="${String(e.payload.name ?? "")}"><img src="/projects/${id}/files/${e.id}" alt="${t(lang, "preview.alt", { page: String(e.payload.page ?? "") })}" loading="lazy">
<figcaption>${t(lang, "preview.caption", { time: String(e.payload.taken_at ?? "").replace("T", " ").slice(0, 19) })}</figcaption></figure>`,
      )}</div>${s.previewFinished && !s.signedOff ? html`<div class="actions"><a href="/projects/${id}/acceptance" data-go="acceptance">${t(lang, "preview.go_acceptance")}</a></div>` : ""}`
    : html`<p>${t(lang, "preview.none")}</p>`;
  return projectPage(
    lang,
    s,
    "preview",
    t(lang, "preview.title"),
    html`${panel(lang, "real", t(lang, "preview.title"), status)}${s.previewFinished ? livePanel(lang, s, live) : ""}${panel(lang, "real", t(lang, "preview.shots"), gallery)}`,
    { refreshSeconds: s.runningJob ? 2 : undefined },
  );
}

export function acceptancePage(lang: Lang, s: JourneyState, j: Journey): Html {
  const id = s.project.id;
  // The latest checklist job, and the runner's record of its run, if it wrote one: the table and the items show that
  // job only, never an earlier run (a job that failed before the runner wrote any event shows no run).
  const lastJob = [...s.jobs].reverse().find((x) => x.kind === "acceptance");
  const ended = lastJob && lastJob.state !== "running" ? lastJob : null;
  const finished = ended ? jobRunFinished(s.events, ended) : undefined;
  const runId = finished ? String(finished.payload.run_id ?? "") : null;
  // The run's outcome word, from its own acceptance.run.finished event (package 3.1b), not from the summary's text.
  const outcome = runId ? runOutcome(s.events, runId) : null;
  const outcomeWord = t(lang, `acceptance.outcome.${outcome === null ? "none" : outcome === "not passed" ? "not_passed" : outcome}`);
  const outcomeShown = html`<strong class="${outcome === "passed" ? "ok" : "warn"}" data-outcome="${outcome ?? "none"}">${outcomeWord}</strong>`;
  const items = runId ? s.events.filter((e) => e.kind === "acceptance.item" && e.payload.run_id === runId) : [];
  // The items the tests version has a test for (its acceptance.version.written event), so an item with a test that did not run is not called untested.
  const versionEvent = s.events.filter((e) => e.kind === "acceptance.version.written" && e.payload.version === s.acceptanceVersion).at(-1);
  const tested = new Set((Array.isArray(versionEvent?.payload.items) ? (versionEvent.payload.items as Array<{ number?: unknown }>) : []).map((i) => num(i.number)));
  const canRun = !s.runningJob && !s.interrupted && JOB_RULES.acceptance(s) === null;
  const dash = html`<span data-none>—</span>`;
  const runTable = ended
    ? html`<table data-run="${runId ?? ""}" data-job="${ended.jobId}" data-job-state="${ended.state}"><tr><th>${t(lang, "acceptance.job")}</th><td><strong class="${ended.state === "finished" ? "neutral" : "warn"}">${t(lang, `acceptance.job_state.${ended.state}`)}</strong></td></tr><tr><th>${t(lang, "acceptance.run_id")}</th><td>${runId ? html`<span lang="en" dir="ltr">${runId}</span>` : html`<span data-no-run>${t(lang, "acceptance.no_run")}</span>`}</td></tr><tr><th>${t(lang, "acceptance.version")}</th><td>${finished ? String(finished.payload.version ?? "") : dash}</td></tr><tr><th>${t(lang, "acceptance.exit")}</th><td>${!finished ? dash : finished.payload.exit_code === null ? t(lang, "acceptance.no_container") : String(finished.payload.exit_code)}</td></tr><tr><th>${t(lang, "acceptance.outcome")}</th><td>${outcomeShown}</td></tr><tr><th>${t(lang, "acceptance.summary")}</th><td lang="en" dir="ltr" data-summary>${finished ? String(finished.payload.summary ?? "") : dash}</td></tr></table>`
    : html`<p class="note">${t(lang, s.runningJob?.kind === "acceptance" ? "acceptance.running" : "acceptance.not_run")}</p>`;
  const runPanel = panel(
    lang,
    "real",
    t(lang, "acceptance.run_title"),
    html`${runningNote(lang, s)}<p>${t(lang, "acceptance.run_intro")}</p>
${lastJob?.state === "failed" || lastJob?.state === "interrupted" ? html`<p class="warn" lang="en" dir="ltr" data-job-failed>${lastJob.reason ?? ""}</p>` : ""}
${ended && s.events.some((e) => e.kind === EV.jobFinished && String(e.payload.job_id) === ended.jobId && e.payload.app_used_live === true) ? html`<p class="warn" data-used-live>${t(lang, "acceptance.used_live")}</p>${englishToo(lang, USED_LIVE_NOTE)}` : ""}
${canRun ? html`<div class="actions">${postButton(`/projects/${id}/acceptance`, t(lang, "acceptance.run"))}</div>` : ""}
${runTable}`,
  );
  const rows = j.spec.acceptance.map((item) => {
    const ev = items.find((e) => num(e.payload.item) === item.number);
    const status = ev ? String(ev.payload.status) : "did not run";
    // An item's own "passed" is shown as passed only when the run's outcome word is "passed"; otherwise it is
    // provisional, shown neutral, with the run's outcome next to it (a run that did not pass passes nothing).
    const shownAs = status === "passed" ? (outcome === "passed" ? "passed" : "passed_provisional") : status === "failed" ? "failed" : "did_not_run";
    const shot = ev && ev.payload.screenshot ? html`<figure><img src="/projects/${id}/files/${ev.id}" alt="${t(lang, "acceptance.shot_alt", { n: item.number })}" loading="lazy"><figcaption>${t(lang, "acceptance.shot_caption")}</figcaption></figure>` : "";
    const why = ev ? html`<span lang="en" dir="ltr">${String(ev.payload.why ?? "")}</span>` : !tested.has(item.number) ? html`${t(lang, "acceptance.no_test")}` : html`${t(lang, ended ? "acceptance.test_no_result" : "acceptance.test_not_run_yet")}`;
    const runOutcomeNote = runId && outcome !== "passed" ? html`<div class="note" data-run-outcome="${outcome ?? "none"}">${t(lang, "acceptance.item_run_outcome", { outcome: outcomeWord })}</div>` : "";
    // Package J2, for every project: the step a failed item failed at, from its own event (the runner's `step`).
    const failedStep = shownAs === "failed" && typeof ev?.payload.step === "string" && ev.payload.step !== "" ? failedAt(lang, ev.payload.step) : "";
    return html`<tr data-item="${item.number}" data-status="${status}" data-shown="${shownAs}"><td>${item.number}</td><td lang="en" dir="ltr">As ${item.as_role}: ${item.does} Sees: ${item.sees}</td><td><strong class="${shownAs === "passed" ? "ok" : shownAs === "passed_provisional" ? "neutral" : "warn"}">${t(lang, `acceptance.status.${shownAs}`)}</strong>${runOutcomeNote}<div class="note">${why}</div>${failedStep}${shot}</td></tr>`;
  });
  const results = panel(
    lang,
    "sim",
    t(lang, "acceptance.results"),
    html`<p><span class="label" data-label>${t(lang, "acceptance.label")}</span></p>${englishToo(lang, JOURNEY_STAND_IN_LABEL)}
<p class="note" lang="en" dir="ltr" data-stand-in-note>${STAND_IN_NOTE}</p>
${ended ? html`<p>${t(lang, "acceptance.outcome")}: ${outcomeShown}</p>${finished ? html`<p>${t(lang, "acceptance.summary")}: <span lang="en" dir="ltr">${String(finished.payload.summary ?? "")}</span></p>` : ""}` : ""}
<div class="scroll"><table data-items><thead><tr><th>#</th><th>${t(lang, "acceptance.item")}</th><th>${t(lang, "acceptance.result")}</th></tr></thead><tbody>${rows}</tbody></table></div>
<h3>${t(lang, "proposal.assumed")}</h3>
<ul data-assumed lang="en" dir="ltr">${j.spec.assumed.map((a) => html`<li>${a.about}: ${a.chose} ${a.reason}</li>`)}</ul>`,
    { simNote: t(lang, "acceptance.sim_note") },
  );
  const signed = s.events.filter((e) => e.kind === EV.signedOff).at(-1);
  const signOff = panel(
    lang,
    "real",
    t(lang, "acceptance.sign_off_title"),
    signed
      ? html`<p class="ok" data-signed-off>${t(lang, "acceptance.signed_off", { time: signed.at.toISOString().replace("T", " ").slice(0, 19) })}</p><p><span class="label" data-sign-off-label>${t(lang, "acceptance.sign_off_label")}</span></p>${englishToo(lang, SIGN_OFF_LABEL)}<div class="actions"><a href="/projects/${id}/export" data-go="export">${t(lang, "acceptance.go_export")}</a></div>`
      : signOffRefusal(s) === null
        ? html`<p><span class="label" data-sign-off-label>${t(lang, "acceptance.sign_off_label")}</span></p>${englishToo(lang, SIGN_OFF_LABEL)}<div class="actions">${postButton(`/projects/${id}/sign-off`, t(lang, "acceptance.sign_off"))}</div>`
        : html`${s.brokenTrace && outcome === "passed" ? html`<p class="warn" data-broken-passed>${t(lang, "broken.passed_warning")}</p>` : html`<p class="note">${t(lang, "acceptance.sign_off_not_yet")}</p>`}${s.brokenTrace ? html`<p class="warn" data-broken-never>${t(lang, "broken.never_signed_off")}</p><p class="note" data-demo-limit>${t(lang, "demo.limit")}</p>` : ""}`,
  );
  return projectPage(lang, s, "acceptance", t(lang, "acceptance.title"), html`${runPanel}${results}${signOff}`, { refreshSeconds: s.runningJob ? 2 : undefined });
}

/** Package J2: "Failed at step: <step>", the step in English, isolated left to right. */
function failedAt(lang: Lang, step: string): Html {
  const [before, ...after] = t(lang, "acceptance.failed_at_step").split("{step}");
  return html`<div class="note" data-failed-step>${before}${after.map((a) => html`<span lang="en" dir="ltr">${step}</span>${a}`)}</div>`;
}

export function exportPage(lang: Lang, s: JourneyState): Html {
  const id = s.project.id;
  if (!s.signedOff) return projectPage(lang, s, "export", t(lang, "export.title"), panel(lang, "real", t(lang, "export.title"), html`<p data-export-not-offered>${t(lang, "export.not_yet")}</p>`));
  const written = s.exportEventId ? s.events.find((e) => e.id === s.exportEventId) : undefined;
  const lastExport = [...s.jobs].reverse().find((x) => x.kind === "export");
  const canExport = !written && !s.runningJob && !s.interrupted && JOB_RULES.export(s) === null && s.stage !== "closed";
  const file = written ? (written.payload.file as { path?: string; sha256?: string } | undefined) : undefined;
  const body = html`<p class="warn" data-export-label>${t(lang, "export.label")}</p>
${englishToo(lang, EXPORT_LABEL)}
${runningNote(lang, s)}
${lastExport?.state === "failed" ? html`<p class="warn" lang="en" dir="ltr">${lastExport.reason ?? ""}</p>` : ""}
${canExport ? html`<p>${t(lang, "export.what")}</p><div class="actions">${postButton(`/projects/${id}/export`, t(lang, "export.make"))}</div>` : ""}
${
  written
    ? html`<table data-export="${written.id}">
<tr><th>${t(lang, "export.file")}</th><td><a href="/projects/${id}/files/${written.id}" data-download>${(file?.path ?? "").split("/").pop()}</a></td></tr>
<tr><th>${t(lang, "export.size")}</th><td>${t(lang, "export.bytes", { n: num(written.payload.bytes).toLocaleString("en") })}</td></tr>
<tr><th>SHA-256</th><td lang="en" dir="ltr"><code>${file?.sha256 ?? ""}</code></td></tr>
<tr><th>${t(lang, "export.commits")}</th><td>${String(written.payload.commits ?? "")}</td></tr>
<tr><th>${t(lang, "export.acceptance")}</th><td>${t(lang, "export.acceptance_copy_only", { version: String(written.payload.acceptance_version ?? "") })}</td></tr>
</table>`
    : ""
}
${closeAction(lang, s)}`;
  return projectPage(lang, s, "export", t(lang, "export.title"), panel(lang, "real", t(lang, "export.title"), body), { refreshSeconds: s.runningJob ? 2 : undefined });
}

export function errorPage(lang: Lang, o: { message: string; back: string; signedIn: boolean }): Html {
  return layout(
    { lang, title: t(lang, "error.title"), back: o.back, signedIn: o.signedIn },
    html`<h1>${t(lang, "error.title")}</h1>${panel(lang, "real", t(lang, "error.title"), html`<p class="warn" role="alert" lang="en" dir="ltr">${o.message}</p>${lang === "ar" ? html`<p class="note">${t(lang, "error.english_only")}</p>` : ""}<div class="actions"><a href="${o.back}">${t(lang, "error.back")}</a></div>`)}`,
  );
}

export function notFoundPage(lang: Lang, signedIn: boolean): Html {
  return layout({ lang, title: t(lang, "error.not_found"), back: "/projects", signedIn }, html`<h1>${t(lang, "error.not_found")}</h1>`);
}

/** A project's path, only for an id the journey made. */
export const isJourneyId = (id: string): boolean => id.startsWith(JOURNEY_PREFIX) && /^j1-[0-9a-f]{12}$/.test(id);

