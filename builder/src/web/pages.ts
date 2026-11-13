/**
 * The interface's pages (package J1), written with hono's `html` tagged template, which escapes every value
 * put into it. No page carries a script (the
 * content-security-policy says `script-src 'none'`); a page that must follow a running job refreshes itself
 * with a meta refresh.
 *
 * Every page shows the mode line, true on every page: "Scripted mode: no AI model is connected. The
 * real-model gate is closed." Each panel says Real or Simulated; a simulated panel says who wrote its
 * content. English and Arabic on every page, with `lang` and `dir` set (right to left for Arabic).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Event } from "../store/events.js";
import type { Budget, StepHoldRow } from "../store/holds.js";
import type { Freeze } from "../store/freezes.js";
import type { UnreconciledList } from "../store/reconcile.js";
import { fieldChecklist, MAX_FREE_TEXT, showReason, type Answer, type IntakeQuestion } from "../orchestrator/intake.js";
import { JOURNEY_PREFIX, MAX_BRIEF, MAX_NAME, type Journey, type JourneyState, type Stage } from "../orchestrator/journey.js";

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

/** B5's raw ask for example 1, as the new-project box is prefilled. */
export const EXAMPLE_1_ASK = "I need an app where staff can request leave and managers approve it";

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
export function panel(lang: Lang, kind: "real" | "sim", title: string, body: Html, o: { simNote?: string } = {}): Html {
  return html`<section class="panel ${kind}" data-panel="${kind === "real" ? "real" : "simulated"}">
<h2>${title}<span class="badge">${t(lang, kind === "real" ? "label.real" : "label.simulated")}</span></h2>
${kind === "sim" ? html`<p class="simnote">${o.simNote ?? t(lang, "simulated.note")}</p>` : ""}
${body}
</section>`;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const usd4 = (n: number) => `$${n.toFixed(4)}`;

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
<td><a href="/projects/${r.state.project.id}">${r.state.project.name}</a></td>
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
${panel(lang, "real", t(lang, "projects.title"), html`${list}<div class="actions"><a href="/projects/new">${t(lang, "projects.new")}</a></div>${others > 0 ? html`<p class="note">${t(lang, "projects.others", { n: others })}</p>` : ""}`)}`,
  );
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

export type Screen = "brief" | "questions" | "proposal" | "plan" | "cost" | "record";

/** The tabs of a project's screens, those its stage allows. Part 2 adds build, preview, acceptance and export. */
export function tabs(lang: Lang, s: JourneyState, here: Screen): Html {
  const reached: Record<Screen, boolean> = {
    brief: true,
    questions: s.stage !== "brief" || s.answers.size > 0,
    proposal: s.stage !== "brief" && s.nextTurn === null,
    plan: s.briefConfirmed,
    cost: true,
    record: true,
  };
  const order: Screen[] = ["brief", "questions", "proposal", "plan", "cost", "record"];
  const id = s.project.id;
  return html`<ul class="tabs">${order
    .filter((k) => reached[k])
    .map((k) => html`<li>${k === here ? html`<span class="here" aria-current="page">${t(lang, `tab.${k}`)}</span>` : html`<a href="/projects/${id}/${k}">${t(lang, `tab.${k}`)}</a>`}</li>`)}</ul>`;
}

function projectPage(lang: Lang, s: JourneyState, here: Screen, title: string, body: Html, o: { refreshSeconds?: number } = {}): Html {
  return layout(
    { lang, title: `${title} · ${s.project.name}`, back: `/projects/${s.project.id}/${here}`, signedIn: true, refreshSeconds: o.refreshSeconds },
    html`<h1>${s.project.name}</h1>
<p class="note">${t(lang, "col.stage")}: <strong data-stage="${s.stage}">${stageName(lang, s.stage)}</strong></p>
${tabs(lang, s, here)}
${s.interrupted && s.stage !== "closed" ? interruptedPanel(lang, s) : ""}
${body}`,
  );
}

function interruptedPanel(lang: Lang, s: JourneyState): Html {
  return panel(
    lang,
    "real",
    t(lang, "error.title"),
    html`<p class="warn">${t(lang, "interrupted.message")}</p>
<div class="actions"><form method="post" action="/projects/${s.project.id}/close"><button type="submit">${t(lang, "interrupted.close")}</button></form><a href="/projects/new">${t(lang, "projects.new")}</a></div>`,
  );
}

const postButton = (action: string, label: string, cls = "") => html`<form method="post" action="${action}"><button type="submit" class="${cls}">${label}</button></form>`;

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
  const steps = j.planSteps();
  const body = html`<ol data-steps>${steps.map(
    (st) => html`<li data-step="${st.step}"><strong>${st.step}</strong><div>${t(lang, "plan.shown")}: <span lang="en" dir="ltr">${st.label}</span></div><div class="note">${t(lang, "plan.files", { n: st.files })}</div></li>`,
  )}</ol>
<p class="greyed">${t(lang, "plan.not_built")}</p>
<p class="greyed">${t(lang, "plan.quality_gate")}</p>
<p class="note">${t(lang, "plan.tests_fixed")}</p>
${
  s.stage === "plan_review"
    ? html`<div class="actions">${postButton(`/projects/${id}/confirm-plan`, t(lang, "plan.confirm"))}${postButton(`/projects/${id}/stop`, t(lang, "brief.stop"), "secondary")}</div>`
    : s.planConfirmed
      ? html`<p class="ok">${t(lang, "plan.confirmed", { version: s.acceptanceVersion ?? "?" })}</p><p class="note">${t(lang, "plan.build_not_here")}</p>`
      : ""
}`;
  return projectPage(lang, s, "plan", t(lang, "plan.title"), panel(lang, "sim", t(lang, "plan.title"), body, { simNote: t(lang, "simulated.note") }));
}

export interface CostView {
  budget: Budget;
  stepHolds: StepHoldRow[];
  freeze: Freeze | null;
  freezeMessage: string | null;
  unreconciled: UnreconciledList;
  modelCalls: number;
  pricedModel: string;
  priceTableDate: string;
}

export function costPage(lang: Lang, s: JourneyState, v: CostView): Html {
  const b = v.budget;
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
<tbody>${v.stepHolds.map((h) => html`<tr><td>${h.step_id}</td><td>${usd4(Number(h.budget_usd))}</td><td>${h.state}${h.closed_reason ? ` (${h.closed_reason})` : ""}</td></tr>`)}</tbody></table></div>
<p class="note">${t(lang, "cost.priced", { model: v.pricedModel, date: v.priceTableDate })}</p>`
    : html`<p>${t(lang, "cost.no_steps")}</p>`;
  const freeze = v.freeze ? html`<p class="warn" data-freeze>${t(lang, "cost.frozen", { message: v.freezeMessage ?? "" })}</p>` : html`<p data-no-freeze>${t(lang, "cost.no_freeze")}</p>`;
  const un = v.unreconciled;
  const unreconciled =
    un.holds.length === 0 && un.freezesWithNoOpenHold.length === 0
      ? html`<p data-unreconciled-empty>${t(lang, "cost.unreconciled_none")}</p>`
      : html`<div class="scroll"><table data-unreconciled><thead><tr><th>#</th><th>${t(lang, "cost.amount")}</th><th>${t(lang, "cost.reason")}</th></tr></thead>
<tbody>${un.holds.map((h) => html`<tr><td>${h.holdId}</td><td>${usd4(h.amountUsd)}</td><td>${h.kinds.join(", ")}${h.keptReason ? `: ${h.keptReason}` : ""}</td></tr>`)}${un.freezesWithNoOpenHold.map((f) => html`<tr><td>${f.freezeId}</td><td></td><td>${f.holdState ?? ""}</td></tr>`)}</tbody></table></div>`;
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
<div class="scroll"><table data-record><thead><tr><th>${t(lang, "col.id")}</th><th>${t(lang, "col.at")}</th><th>${t(lang, "col.kind")}</th><th>${t(lang, "col.step")}</th><th>${t(lang, "col.details")}</th></tr></thead>
<tbody>${events.map((e) => html`<tr data-event="${e.id}"><td>${e.id}</td><td>${e.at.toISOString()}</td><td>${e.kind}</td><td>${e.step ?? ""}</td><td><pre lang="en" dir="ltr">${JSON.stringify(e.payload, null, 1)}</pre></td></tr>`)}</tbody></table></div>`,
    ),
  );
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

