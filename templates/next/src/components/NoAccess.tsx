import { getTranslations } from "next-intl/server";
import type { Role } from "@/app-config";
import { SignOutButton } from "@/components/SignOutButton";
import { Link } from "@/i18n/navigation";
import type { Refusal } from "@/lib/access";

/**
 * The plain "no access" page (rule 5): what a signed-in person sees in place of a page that is
 * not for their role. It says which role they have and who the page is for, never a blank page.
 */
export async function NoAccess({ reason, role, allowed }: { reason: Exclude<Refusal, "not_signed_in"> | "action"; role: Role | null; allowed: readonly Role[] }) {
  const t = await getTranslations("no_access");
  const roles = await getTranslations("roles");
  return (
    <div data-testid="no-access" data-reason={reason}>
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-slate-700">
        {reason === "role_not_recognised" && t("role_not_recognised")}
        {reason === "role_not_allowed" && role !== null && t("role_not_allowed", { role: roles(role), allowed: allowed.map((r) => roles(r)).join(t("list_separator")) })}
        {reason === "action" && t("action_refused")}
      </p>
      <p className="mt-2 text-slate-600">{t("what_to_do")}</p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Link href="/home" className="inline-flex min-h-11 items-center rounded-md bg-slate-900 px-4 text-white">
          {t("go_home")}
        </Link>
        <SignOutButton />
      </div>
    </div>
  );
}
