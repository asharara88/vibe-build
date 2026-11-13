// Written by the scripted engine (fixed change example-1/02-submitter-screen). No AI model wrote this.
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { guardedPage } from "@/lib/roles";
import { NewRequestForm } from "./NewRequestForm";

// Rule 5: the new-request form is for employees only.
export default guardedPage(["employee"], async () => {
  const t = await getTranslations("leave");
  return (
    <div data-testid="new-request">
      <Link href="/my-requests" className="text-sm underline underline-offset-4">
        {t("back_to_my_requests")}
      </Link>
      <h1 className="mt-3 text-xl font-semibold">{t("new_request_title")}</h1>
      <NewRequestForm />
    </div>
  );
});
