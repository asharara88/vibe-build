"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { z } from "zod";
import { authClient } from "@/auth-client";
import { useRouter } from "@/i18n/navigation";

/** Rule 1: the form validates its inputs and says what is wrong in plain words. */
export function SignInForm() {
  const t = useTranslations("sign_in");
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  const schema = z.object({
    email: z.string().trim().min(1, t("email_required")).email(t("email_invalid")),
    password: z.string().min(1, t("password_required")),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as "email" | "password";
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const res = await authClient.signIn.email({ email: parsed.data.email, password: parsed.data.password });
      if (res.error) {
        // Rule 3: an error the user can act on, never a code.
        setErrors({ form: res.error.status === 401 || res.error.status === 403 ? t("wrong_credentials") : t("server_error") });
        return;
      }
      router.push("/home", { locale });
      router.refresh();
    } catch {
      setErrors({ form: t("server_error") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-sm rounded-lg bg-white p-6 shadow-sm" aria-labelledby="sign-in-title">
      <h1 id="sign-in-title" className="text-xl font-semibold">
        {t("title")}
      </h1>
      <label className="mt-4 block text-sm font-medium" htmlFor="email">
        {t("email")}
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-invalid={!!errors.email}
        aria-describedby={errors.email ? "email-error" : undefined}
        className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
      />
      {errors.email ? (
        <p id="email-error" role="alert" className="mt-1 text-sm text-red-700">
          {errors.email}
        </p>
      ) : null}
      <label className="mt-4 block text-sm font-medium" htmlFor="password">
        {t("password")}
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-invalid={!!errors.password}
        aria-describedby={errors.password ? "password-error" : undefined}
        className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
      />
      {errors.password ? (
        <p id="password-error" role="alert" className="mt-1 text-sm text-red-700">
          {errors.password}
        </p>
      ) : null}
      {errors.form ? (
        <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">
          {errors.form}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className="mt-6 w-full rounded bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-60">
        {busy ? t("signing_in") : t("submit")}
      </button>
    </form>
  );
}
