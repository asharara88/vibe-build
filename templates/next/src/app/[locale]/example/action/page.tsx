import { getTranslations } from "next-intl/server";
import { isRole, ROLES } from "@/app-config";
import { guardedPage } from "@/lib/roles";
import { runExampleAction } from "./actions";

// Every recognised role can open this page; only a manager or an HR admin can use its button.
export default guardedPage(ROLES, async ({ user, searchParams }) => {
  const t = await getTranslations("example");
  const roles = await getTranslations("roles");
  const done = searchParams["done"];
  return (
    <div data-testid="example-action">
      <h1 className="text-xl font-semibold">{t("action_title")}</h1>
      <p className="mt-2 text-slate-700">{t("action_body", { role: roles(user.role) })}</p>
      <form action={runExampleAction} className="mt-4">
        <button type="submit" className="inline-flex min-h-11 items-center rounded-md bg-slate-900 px-4 text-white">
          {t("action_button")}
        </button>
      </form>
      {isRole(done) && (
        <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-emerald-900" role="status" data-testid="example-action-done">
          {t("action_done", { role: roles(done) })}
        </p>
      )}
    </div>
  );
});
