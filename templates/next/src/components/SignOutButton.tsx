"use client";
import { useLocale, useTranslations } from "next-intl";
import { authClient } from "@/auth-client";
import { useRouter } from "@/i18n/navigation";

export function SignOutButton() {
  const t = useTranslations("app");
  const locale = useLocale();
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-sm underline underline-offset-4"
      onClick={async () => {
        await authClient.signOut();
        router.push("/sign-in", { locale });
        router.refresh();
      }}
    >
      {t("sign_out")}
    </button>
  );
}
