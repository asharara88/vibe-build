/**
 * The intake of package J1: the 20 questions of docs/spec/B2-question-bank.md for test example 1, asked as a
 * chat, at most three per turn (B1 step 2), and example 1's answer sheet (B5, "How it runs here").
 *
 * SIMULATED ANALYST. These are fixed questions, read from intake/example-1.json; no model is called and the
 * customer's brief is not read. Every brief continues as example 1, and the scripted build always builds
 * example 1's app spec, whatever is answered here. A real analyst needs the model key (milestone 2).
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadAppSpec, type AppSpec } from "../spec/app-spec.js";

export const BUILDER_DIR = resolve(import.meta.dirname, "..", "..");
export const INTAKE_FILE = join(BUILDER_DIR, "src", "orchestrator", "intake", "example-1.json");

export type Mark =
  | { kind: "R"; text: string; text_ar: string; reason: string; reason_ar: string; options: number[] }
  | { kind: "their_call" }
  | { kind: "conditional"; text_ar: string }
  | { kind: "recorded_verbatim" };

export interface SheetAnswer {
  option?: number;
  something_else?: string;
  all_fields?: boolean;
  open_text?: string;
  note: string;
}

export interface IntakeQuestion {
  id: string;
  section: string;
  kind: "choice" | "checklist" | "open_text";
  question: string;
  question_ar: string;
  /** B2's options cell, word for word. */
  bank_options: string;
  options: string[];
  options_ar: string[];
  options_ar_note?: string;
  /** B2's recommendation cell, word for word. */
  recommendation: string;
  mark: Mark;
  /** Options shown as "available later" (B7 item 5: single sign-on in Stage 1). */
  available_later?: number[];
  sheet: SheetAnswer;
}

export interface Intake {
  example: string;
  app_spec: string;
  sections: Array<{ id: string; en: string; ar: string }>;
  turns: string[][];
  questions: IntakeQuestion[];
}

/** At most this many questions in one turn (B1, procedure step 2). */
export const MAX_PER_TURN = 3;
/** The longest "something else" or open-text answer taken, in characters. */
export const MAX_FREE_TEXT = 300;

export function loadIntake(file: string = INTAKE_FILE): Intake {
  return JSON.parse(readFileSync(file, "utf8")) as Intake;
}

export function loadExampleSpec(intake: Intake): AppSpec {
  return loadAppSpec(JSON.parse(readFileSync(join(BUILDER_DIR, intake.app_spec), "utf8")));
}

/** The typical fields of the example, as the checklist of question q07 shows them: "Entity: Field". */
export function fieldChecklist(spec: AppSpec): string[] {
  return spec.entities.flatMap((e) => e.fields.map((f) => `${e.label}: ${f.label}`));
}

/** One answer as the journey records it (event `intake.answer`). */
export type Answer =
  | { option: number }
  | { something_else: string }
  | { fields: string[]; something_else?: string }
  | { open_text: string };

/** The answer the scripted customer gives, from the sheet. */
export function sheetAnswer(q: IntakeQuestion, spec: AppSpec): Answer {
  const s = q.sheet;
  if (q.kind === "checklist") return { fields: s.all_fields ? fieldChecklist(spec) : [] };
  if (q.kind === "open_text") return { open_text: s.open_text ?? "" };
  if (s.something_else !== undefined) return { something_else: s.something_else };
  return { option: s.option ?? 0 };
}

/** Same answer, compared as recorded. */
export function sameAnswer(a: Answer, b: Answer): boolean {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}
function normalise(a: Answer): unknown {
  if ("fields" in a) return { fields: [...a.fields].sort(), something_else: a.something_else?.trim() || undefined };
  if ("something_else" in a) return { something_else: a.something_else.trim() };
  if ("open_text" in a) return { open_text: a.open_text.trim() };
  return a;
}

/**
 * Check a submitted answer against its question. Returns a plain-language problem, or null. Free text is
 * taken only through "something else" (B1 step 2), or as the open text of q18, and is at most 300 characters.
 */
export function answerProblem(q: IntakeQuestion, a: Answer, spec: AppSpec): string | null {
  const freeText = (t: string) => {
    if (t.trim() === "") return "the text is empty";
    if (t.length > MAX_FREE_TEXT) return `the text is longer than ${MAX_FREE_TEXT} characters`;
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(t)) return "the text holds control characters";
    return null;
  };
  if (q.kind === "choice") {
    if ("option" in a) return Number.isInteger(a.option) && a.option >= 0 && a.option < q.options.length ? null : "that option is not one of this question's";
    if ("something_else" in a && !("fields" in a)) return freeText(a.something_else);
    return "this question takes one option or \"something else\"";
  }
  if (q.kind === "checklist") {
    if (!("fields" in a)) return "this question takes a list of fields";
    const known = new Set(fieldChecklist(spec));
    if (a.fields.some((f) => !known.has(f))) return "a field is not one of the checklist's";
    if (a.something_else !== undefined && a.something_else.trim() !== "") return freeText(a.something_else);
    if (a.fields.length === 0) return "tick at least one field, or add one under \"something else\"";
    return null;
  }
  if (!("open_text" in a)) return "this question takes one line of text";
  if (/[\r\n]/.test(a.open_text)) return "the answer must be one line";
  return freeText(a.open_text);
}

/** "(H)" is shown in plain words: "builds reliably" has not been measured yet (B2). */
export const showReason = (reason: string, lang: "en" | "ar"): string => (lang === "en" ? reason.replace("(H)", "(not yet measured)") : reason);

/**
 * Problems between the answer sheet and the app spec the scripted build uses, in plain language: the sheet's
 * choices must describe that spec. An empty list means they agree.
 */
export function checkSheetAgainstSpec(intake: Intake, spec: AppSpec): string[] {
  const p: string[] = [];
  const q = (id: string) => {
    const found = intake.questions.find((x) => x.id === id);
    if (!found) throw new Error(`The intake has no question ${id}.`);
    return found;
  };
  const opt = (id: string) => q(id).sheet.option;
  const replaces = ["email_or_chat", "spreadsheet", "paper_or_pdf_form", "nothing_new"][opt("q01") ?? -1] ?? "something_else";
  if (spec.purpose.replaces !== replaces) p.push(`q01: the sheet says ${replaces}, the spec ${spec.purpose.replaces}.`);
  const pain = [["submitters"], ["approvers"], ["reporters"], ["submitters", "approvers", "reporters"]][opt("q02") ?? -1] ?? [];
  if ([...spec.purpose.who_feels_the_pain].sort().join() !== [...pain].sort().join()) p.push("q02: who feels the pain differs.");
  const roleCount = spec.roles.length;
  const o3 = opt("q03");
  if (!((o3 === 0 && roleCount === 1) || (o3 === 1 && roleCount === 2) || (o3 === 2 && roleCount === 3) || (o3 === 3 && roleCount > 3))) p.push(`q03: the spec has ${roleCount} roles.`);
  const q4 = q("q04");
  const sees = new Set(spec.roles.map((r) => r.sees));
  if (q4.mark.kind !== "R" || q4.sheet.something_else !== q4.mark.text || !(sees.has("own") && sees.has("team") && sees.has("all"))) p.push("q04: the spec's roles do not see own, team and all, as the sheet's answer says.");
  const o5 = opt("q05");
  const ssoLater = spec.later.some((l) => /single sign-on/i.test(l.item));
  if (!((o5 === 0 && spec.sign_in === "email_and_password" && ssoLater) || (o5 === 1 && spec.sign_in === "email_and_password"))) p.push("q05: sign-in differs (company email goes to the Later list and is built with email and password in Stage 1).");
  const start = ["typed_in", "uploaded_once", "synced_on_schedule", "connected_system"][opt("q06") ?? -1];
  if (!spec.entities.some((e) => e.starting_data === start)) p.push(`q06: no entity's starting data is ${start}.`);
  if (q("q07").sheet.all_fields !== true) p.push("q07: the sheet does not tick the spec's fields.");
  const sensitivity = spec.entities.flatMap((e) => e.fields.map((f) => f.sensitive));
  const most = sensitivity.includes("salary_id_or_health") ? 2 : sensitivity.includes("contact_details") ? 1 : 0;
  if (opt("q08") !== most) p.push("q08: the spec's most sensitive field differs.");
  const kinds = new Set(spec.screens.map((s) => s.kind));
  if (!(opt("q09") === 1 && kinds.has("my_items") && kinds.has("form"))) p.push("q09: the spec has no list of my items with a form.");
  if (!(opt("q10") === 1 && kinds.has("queue"))) p.push("q10: the spec has no approver's queue.");
  if (!(opt("q11") === 2 && kinds.has("table_with_filters") && spec.screens.some((s) => s.kind === "table_with_filters" && /export/i.test(s.shows)))) p.push("q11: the spec has no table with filters and export.");
  const submit = spec.actions[0];
  const by = new Set(submit?.notifies.map((n) => n.by));
  if (!(opt("q12") === 3 && by.has("email") && by.has("in_app"))) p.push("q12: the spec's first action does not tell the approver by email and in the app.");
  if (!(opt("q13") === 3 && spec.actions.some((a) => a.steps.some((s) => /balance/i.test(s)) && a.notifies.length > 0))) p.push("q13: no action changes the status, a balance and notifies.");
  if (!(opt("q14") === 1 && spec.actions.some((a) => /withdraw/.test(a.name)))) p.push("q14: the spec has no withdrawal.");
  if (!(opt("q15") === 0 && spec.rules.some((r) => r.their_call && /direct manager/i.test(r.statement)))) p.push("q15: the spec's approver is not the direct manager.");
  if (!(opt("q16") === 1 && spec.rules.some((r) => r.their_call && /balance/i.test(r.statement)))) p.push("q16: the spec has no limit per person.");
  if (!(opt("q17") === 0 && spec.rules.every((r) => r.on_breach === "block_and_say_why"))) p.push("q17: not every rule of the spec blocks and says why.");
  if (q("q18").sheet.open_text !== spec.must_never_happen) p.push("q18: the sheet's text is not the spec's \"must never happen\".");
  if (!(opt("q19") === 0 && spec.acceptance.length > 0)) p.push("q19: the spec has no case written as steps.");
  if (!(opt("q20") === 2 && spec.signs_off.length === 3)) p.push("q20: the spec's sign-off is not three people.");
  return p;
}
