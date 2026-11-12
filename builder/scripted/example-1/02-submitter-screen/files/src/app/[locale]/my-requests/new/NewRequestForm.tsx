// Written by the scripted engine (fixed change example-1/02-submitter-screen). No AI model wrote this.
"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { checkLeaveRequest, type Field, type Problem } from "../rules";
import { submitLeaveRequest } from "./actions";

/** Rule 1: the form checks its answers and says what is wrong, in plain words, before anything is sent. */
export function NewRequestForm() {
  const t = useTranslations("leave");
  const locale = useLocale();
  const router = useRouter();
  const [values, setValues] = useState({ startDate: "", endDate: "", days: "", reason: "" });
  const [problems, setProblems] = useState<Partial<Record<Field, Problem>>>({});
  const [saveFailed, setSaveFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const say = (p: Problem) => ("max" in p ? t(`problem_${p.code}`, { max: p.max }) : t(`problem_${p.code}`));
  const set = (field: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [field]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaveFailed(false);
    const checked = checkLeaveRequest(values);
    if (!checked.ok) {
      setProblems(checked.problems);
      return;
    }
    setProblems({});
    setBusy(true);
    try {
      const res = await submitLeaveRequest(values);
      if (res.ok) {
        router.push("/my-requests?sent=1", { locale });
        router.refresh();
        return;
      }
      if ("problems" in res) setProblems(res.problems);
      else setSaveFailed(true);
    } catch {
      setSaveFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const field = (name: Field, label: string, input: React.ReactNode, hint?: string) => {
    const problem = problems[name];
    return (
      <div className="mt-4">
        <label className="block text-sm font-medium" htmlFor={name}>
          {label}
        </label>
        {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
        {input}
        {problem ? (
          <p id={`${name}-error`} role="alert" className="mt-1 text-sm text-red-700">
            {say(problem)}
          </p>
        ) : null}
      </div>
    );
  };
  const common = (name: Field) => ({
    id: name,
    name,
    value: values[name],
    onChange: set(name),
    "aria-invalid": !!problems[name],
    "aria-describedby": problems[name] ? `${name}-error` : undefined,
    className: "mt-1 w-full rounded border border-slate-300 px-3 py-2",
  });

  return (
    <form onSubmit={submit} noValidate className="mt-4 max-w-md rounded-lg bg-white p-6 shadow-sm">
      {field("startDate", t("first_day"), <input type="date" {...common("startDate")} />)}
      {field("endDate", t("last_day"), <input type="date" {...common("endDate")} />)}
      {field("days", t("days"), <input type="number" inputMode="numeric" min={1} step={1} {...common("days")} />)}
      {field("reason", t("reason"), <textarea rows={3} {...common("reason")} />, t("reason_hint"))}
      {saveFailed ? (
        <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">
          {t("save_failed")}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className="mt-6 w-full rounded bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-60">
        {busy ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
