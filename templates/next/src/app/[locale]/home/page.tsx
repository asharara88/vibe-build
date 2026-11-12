import { getTranslations, setRequestLocale } from "next-intl/server";
import { ROLES } from "@/app-config";
import { EmptyState } from "@/components/EmptyState";
import { SignOutButton } from "@/components/SignOutButton";
import { requireRole } from "@/lib/roles";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Rule 5: the role check comes before anything is rendered. Home is open to every role.
  const { user } = await requireRole(locale, ROLES);
  const t = await getTranslations("home");
  const roles = await getTranslations("roles");
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <SignOutButton />
      </div>
      <p className="mt-1 text-slate-600" data-testid="signed-in-as">
        {t("signed_in_as", { name: user.name, role: roles(user.role) })}
      </p>
      <h2 className="mt-8 text-lg font-medium">{t("what_you_can_do")}</h2>
      <div className="mt-3">
        <EmptyState title={t("nothing_yet_title")} body={t("nothing_yet_body")} />
      </div>
    </div>
  );
}
