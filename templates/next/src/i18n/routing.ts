import { defineRouting } from "next-intl/routing";

/** English and Arabic from the first version (owner's decision, 11 Nov 2026). */
export const routing = defineRouting({
  locales: ["en", "ar"],
  defaultLocale: "en",
});

export type Locale = (typeof routing.locales)[number];

/** Arabic is written right to left. The layout reads this to set the page direction. */
export const direction = (locale: string): "rtl" | "ltr" => (locale === "ar" ? "rtl" : "ltr");
