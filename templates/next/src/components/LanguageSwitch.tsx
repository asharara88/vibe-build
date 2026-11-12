"use client";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

/** Switch between English and Arabic, keeping the current page. */
export function LanguageSwitch() {
  const t = useTranslations("app");
  const locale = useLocale();
  const pathname = usePathname();
  const other = locale === "ar" ? "en" : "ar";
  return (
    <nav aria-label={t("language")} className="text-sm">
      <Link href={pathname} locale={other} className="underline underline-offset-4">
        {other === "ar" ? t("arabic") : t("english")}
      </Link>
    </nav>
  );
}
