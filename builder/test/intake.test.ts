/**
 * Package J1: the intake of test example 1 (src/orchestrator/intake/example-1.json) against the question bank,
 * docs/spec/B2-question-bank.md, and the analyst's rules, docs/spec/B1-business-analyst.md. No database.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAppSpec } from "../src/spec/app-spec.js";
import {
  answerProblem,
  checkSheetAgainstSpec,
  fieldChecklist,
  loadExampleSpec,
  loadIntake,
  MAX_PER_TURN,
  sheetAnswer,
  showReason,
  type Intake,
} from "../src/orchestrator/intake.js";

const repo = resolve(import.meta.dirname, "..", "..");
const B2 = readFileSync(join(repo, "docs", "spec", "B2-question-bank.md"), "utf8");
const B2_LINES = new Set(B2.split("\n"));
const intake = loadIntake();
const spec = loadExampleSpec(intake);

/** B2's tables, read from the file: each row with the bold section heading it sits under. */
function b2Rows(): Array<{ section: string; question: string; options: string; recommendation: string }> {
  const rows: Array<{ section: string; question: string; options: string; recommendation: string }> = [];
  let section = "";
  for (const line of B2.split("\n")) {
    const h = /^\*\*(.+)\*\*$/.exec(line.trim());
    if (h) section = h[1]!;
    const cells = /^\| (.+) \| (.+) \| (.+) \|$/.exec(line);
    if (cells && cells[1] !== "Question" && !cells[1]!.startsWith("---")) rows.push({ section, question: cells[1]!, options: cells[2]!, recommendation: cells[3]! });
  }
  return rows;
}

describe("J1 intake: the 20 questions of B2, word for word", () => {
  it("has B2's 20 questions, in B2's order and sections, each row word for word", () => {
    const rows = b2Rows();
    expect(rows).toHaveLength(20);
    expect(intake.questions).toHaveLength(20);
    intake.questions.forEach((q, i) => {
      const row = rows[i]!;
      const section = intake.sections.find((s) => s.id === q.section)!;
      expect(section.en, q.id).toBe(row.section);
      expect(q.question, q.id).toBe(row.question);
      expect(q.bank_options, q.id).toBe(row.options);
      expect(q.recommendation, q.id).toBe(row.recommendation);
      // The whole table row, as written in B2.
      expect(B2_LINES.has(`| ${q.question} | ${q.bank_options} | ${q.recommendation} |`), q.id).toBe(true);
    });
  });

  it("shows B2's options word for word: for a closed question, B2's options cell split at ' · ', without its own 'Something else'", () => {
    for (const q of intake.questions) {
      if (q.kind !== "choice") {
        expect(q.options, q.id).toEqual([]);
        continue;
      }
      const cell = q.bank_options.split(" · ").filter((o) => o !== "Something else");
      expect(q.options, q.id).toEqual(cell);
      expect(q.options.length, q.id).toBeGreaterThanOrEqual(3);
      expect(q.options.length, q.id).toBeLessThanOrEqual(4);
    }
  });

  it("asks at most three questions per turn, every question exactly once, in B2's order, one section per turn", () => {
    const flat = intake.turns.flat();
    expect(flat).toEqual(intake.questions.map((q) => q.id));
    for (const turn of intake.turns) {
      expect(turn.length).toBeGreaterThanOrEqual(1);
      expect(turn.length).toBeLessThanOrEqual(MAX_PER_TURN);
      expect(new Set(turn.map((id) => intake.questions.find((q) => q.id === id)!.section)).size).toBe(1);
    }
  });

  it("marks R exactly where B2 does, with B2's text and one reason, and 'their call' where B2 says so", () => {
    for (const q of intake.questions) {
      const m = q.mark;
      if (q.recommendation.startsWith("R: ")) {
        expect(m.kind, q.id).toBe("R");
        if (m.kind !== "R") continue;
        expect(`R: ${m.text}. Reason: ${m.reason}`, q.id).toBe(q.recommendation);
        for (const i of m.options) expect(q.options[i], `${q.id} option ${i}`).toBeDefined();
      } else if (q.recommendation.startsWith("None; their call")) {
        expect(m.kind, q.id).toBe("their_call");
      } else if (q.recommendation === "None; recorded verbatim") {
        expect(m.kind, q.id).toBe("recorded_verbatim");
      } else {
        // B2's one conditional cell (sensitive data): shown as written, no R mark.
        expect(m.kind, q.id).toBe("conditional");
        expect(q.recommendation, q.id).toMatch(/^If yes: /);
      }
    }
    expect(intake.questions.filter((q) => q.mark.kind === "R").map((q) => q.id)).toEqual(["q03", "q04", "q05", "q06", "q09", "q10", "q11", "q12", "q14", "q17", "q19", "q20"]);
  });

  it("R reasons: only B2's own, each of B1's three kinds ('builds reliably', 'satisfies rule N', 'passed acceptance in N'), except B2's two Done-means reasons, which are B2's text as written", () => {
    // B2 itself gives these two reasons, which are none of B1's three kinds. They are shown as B2 has them,
    // and put to the owner (docs/QUESTIONS.md, "Yours to confirm"); nothing else may stand outside the three.
    const b2Exceptions = new Map([
      ["q19", "it becomes the acceptance test directly"],
      ["q20", "each role tests their own screen"],
    ]);
    const kinds = /^(builds reliably( \(H\))?|satisfies rule \d+|passed acceptance in \d+ (similar )?projects)(;|\.|$)/;
    for (const q of intake.questions) {
      if (q.mark.kind !== "R") continue;
      if (b2Exceptions.has(q.id)) expect(q.mark.reason).toBe(b2Exceptions.get(q.id));
      else expect(q.mark.reason, q.id).toMatch(kinds);
    }
  });

  it("shows (H) in plain words, 'builds reliably (not yet measured)', and never the letter mark", () => {
    const shown = intake.questions.flatMap((q) => (q.mark.kind === "R" ? [showReason(q.mark.reason, "en"), q.mark.reason_ar] : []));
    expect(shown.some((r) => r.startsWith("builds reliably (not yet measured)"))).toBe(true);
    for (const r of shown) expect(r).not.toContain("(H)");
  });

  it("single sign-on is shown as 'available later' (B7 item 5)", () => {
    const q5 = intake.questions.find((q) => q.id === "q05")!;
    expect(q5.options[0]).toBe("Company email (SSO)");
    expect(q5.available_later).toEqual([0]);
  });

  it("every question, option, recommendation and reason has its Arabic", () => {
    for (const q of intake.questions) {
      expect(q.question_ar.trim(), q.id).not.toBe("");
      expect(q.options_ar.length, q.id).toBe(q.options.length);
      for (const o of q.options_ar) expect(o.trim(), q.id).not.toBe("");
      if (q.kind !== "choice") expect((q.options_ar_note ?? "").trim(), q.id).not.toBe("");
      if (q.mark.kind === "R") expect(q.mark.text_ar && q.mark.reason_ar, q.id).toBeTruthy();
      if (q.mark.kind === "conditional") expect(q.mark.text_ar, q.id).toBeTruthy();
    }
    for (const s of intake.sections) expect(s.ar.trim()).not.toBe("");
  });
});

describe("J1 intake: example 1's answer sheet", () => {
  it("answers every question validly, and gives the app spec that loadAppSpec accepts and the scripted build uses", () => {
    for (const q of intake.questions) expect(answerProblem(q, sheetAnswer(q, spec), spec), q.id).toBeNull();
    const raw = JSON.parse(readFileSync(join(repo, "builder", intake.app_spec), "utf8"));
    expect(() => loadAppSpec(raw)).not.toThrow();
    expect(checkSheetAgainstSpec(intake, spec)).toEqual([]);
    expect(sheetAnswer(intake.questions.find((q) => q.id === "q07")!, spec)).toEqual({ fields: fieldChecklist(spec) });
  });

  it("control: a sheet that does not describe the spec is caught (three roles changed to two; the never-happen line changed)", () => {
    const changed: Intake = JSON.parse(JSON.stringify(intake));
    changed.questions.find((q) => q.id === "q03")!.sheet.option = 1;
    changed.questions.find((q) => q.id === "q18")!.sheet.open_text = "Something made up.";
    const p = checkSheetAgainstSpec(changed, spec);
    expect(p.some((x) => x.startsWith("q03"))).toBe(true);
    expect(p.some((x) => x.startsWith("q18"))).toBe(true);
  });

  it("free text only through 'something else' or q18's one line, at most 300 characters, no control characters", () => {
    const q1 = intake.questions[0]!;
    expect(answerProblem(q1, { option: 9 }, spec)).not.toBeNull();
    expect(answerProblem(q1, { open_text: "x" }, spec)).not.toBeNull();
    expect(answerProblem(q1, { something_else: "A shared mailbox" }, spec)).toBeNull();
    expect(answerProblem(q1, { something_else: "x".repeat(301) }, spec)).not.toBeNull();
    expect(answerProblem(q1, { something_else: "a\u0007b" }, spec)).not.toBeNull();
    const q18 = intake.questions.find((q) => q.id === "q18")!;
    expect(answerProblem(q18, { open_text: "two\nlines" }, spec)).not.toBeNull();
    const q7 = intake.questions.find((q) => q.id === "q07")!;
    expect(answerProblem(q7, { fields: ["Not a field"] }, spec)).not.toBeNull();
  });
});
