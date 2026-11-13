// Written by the scripted engine (fixed change example-1/02-submitter-screen). No AI model wrote this.
import { getTranslations } from "next-intl/server";
import { ROLES } from "@/app-config";
import { EmptyState } from "@/components/EmptyState";
import { SignOutButton } from "@/components/SignOutButton";
import { Link } from "@/i18n/navigation";
import { guardedPage } from "@/lib/roles";

// Rule 5: the role check comes before anything is rendered. Home is open to every recognised role.
// An employee is offered their leave requests; the other roles have no screens yet.
export default guardedPage(ROLES, async ({ user }) => {
  const t = await getTranslations("home");
  const roles = await getTranslations("roles");
  const leave = await getTranslations("leave");
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
        {user.role === "employee" ? (
          <ul className="space-y-2">
            <li>
              <Link href="/my-requests" className="underline underline-offset-4" data-testid="my-requests-link">
                {leave("my_requests_title")}
              </Link>
            </li>
            <li>
              <Link href="/my-requests/new" className="underline underline-offset-4">
                {leave("new_request_link")}
              </Link>
            </li>
          </ul>
        ) : (
          <EmptyState title={t("nothing_yet_title")} body={t("nothing_yet_body")} />
        )}
      </div>
    </div>
  );
});
