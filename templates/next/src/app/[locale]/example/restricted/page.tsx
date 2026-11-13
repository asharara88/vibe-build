import { getTranslations } from "next-intl/server";
import { guardedPage } from "@/lib/roles";

// An example of a page for one role only. The build step that adds an app's own screens replaces it.
export default guardedPage(["hr_admin"], async ({ user }) => {
  const t = await getTranslations("example");
  return (
    <div data-testid="example-restricted">
      <h1 className="text-xl font-semibold">{t("restricted_title")}</h1>
      <p className="mt-2 text-slate-700">{t("restricted_body", { name: user.name })}</p>
    </div>
  );
});
