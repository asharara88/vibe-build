// Written by the scripted engine (fixed change example-1/02-submitter-screen). No AI model wrote this.
/**
 * Rule 1: the checks on a new leave request. The same code runs in the browser, before anything is
 * sent, and again in the form action on the server, so a request that skips the browser's check is
 * still refused. Each problem names its field; the form shows it in the reader's language.
 */
import { z } from "zod";

export const MAX_REASON_LENGTH = 1000;

export type Field = "startDate" | "endDate" | "days" | "reason";
export type Problem =
  | { code: "start_date_missing" | "start_date_invalid" | "end_date_missing" | "end_date_invalid" | "end_before_start" }
  | { code: "days_missing" | "days_not_whole" | "days_too_few" }
  | { code: "days_too_many"; max: number }
  | { code: "reason_too_long"; max: number };

export interface LeaveRequestInput {
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
}

export type CheckResult = { ok: true; value: LeaveRequestInput } | { ok: false; problems: Partial<Record<Field, Problem>> };

/** What the form action answers: saved, refused with each field's problem, or not saved because of a fault. */
export type SubmitResult = { ok: true } | { ok: false; problems: Partial<Record<Field, Problem>> } | { ok: false; saveFailed: true };

/** What the form sends. Anything else in it is ignored. */
const Sent = z.object({
  startDate: z.string().catch(""),
  endDate: z.string().catch(""),
  days: z.union([z.string(), z.number()]).catch(""),
  reason: z.string().nullish().catch(null),
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** A calendar date written as the date field writes it (year-month-day), and a real one: 2027-02-30 is refused. */
function dayNumber(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t / DAY_MS;
}

export function checkLeaveRequest(input: unknown): CheckResult {
  const sent = Sent.safeParse(input ?? {});
  const raw = sent.success ? sent.data : { startDate: "", endDate: "", days: "", reason: null };
  const problems: Partial<Record<Field, Problem>> = {};

  const startText = raw.startDate.trim();
  const endText = raw.endDate.trim();
  const start = startText === "" ? null : dayNumber(startText);
  const end = endText === "" ? null : dayNumber(endText);
  if (startText === "") problems.startDate = { code: "start_date_missing" };
  else if (start === null) problems.startDate = { code: "start_date_invalid" };
  if (endText === "") problems.endDate = { code: "end_date_missing" };
  else if (end === null) problems.endDate = { code: "end_date_invalid" };
  else if (start !== null && end < start) problems.endDate = { code: "end_before_start" };

  const daysText = String(raw.days).trim();
  const days = Number(daysText);
  if (daysText === "") problems.days = { code: "days_missing" };
  else if (!/^-?\d+$/.test(daysText) || !Number.isSafeInteger(days)) problems.days = { code: "days_not_whole" };
  else if (days < 1) problems.days = { code: "days_too_few" };
  else if (start !== null && end !== null && end >= start && days > end - start + 1) problems.days = { code: "days_too_many", max: end - start + 1 };

  const reason = (raw.reason ?? "").trim();
  if (reason.length > MAX_REASON_LENGTH) problems.reason = { code: "reason_too_long", max: MAX_REASON_LENGTH };

  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return { ok: true, value: { startDate: startText, endDate: endText, days, reason: reason === "" ? null : reason } };
}
