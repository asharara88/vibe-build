import type { ReactNode } from "react";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { direction, routing } from "@/i18n/routing";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("app");
  return (
    <html lang={locale} dir={direction(locale)}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{t("name")}</title>
      </head>
      <body>
        <NextIntlClientProvider>
          {/* Sample data is labelled as sample data (house standard). */}
          <div role="note" className="bg-amber-100 text-amber-900 text-sm px-4 py-2 text-center">
            {t("sample_banner")}
          </div>
          <header className="flex items-center justify-between gap-4 px-4 py-3 border-b border-slate-200 bg-white">
            <span className="font-semibold">{t("name")}</span>
            <LanguageSwitch />
          </header>
          <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
