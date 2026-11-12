// Written by the scripted engine (fixed change example-1/02-submitter-screen). No AI model wrote this.
import { desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/EmptyState";
import { db } from "@/db";
import { leaveRequest } from "@/db/app-schema";
import { Link } from "@/i18n/navigation";
import { guardedPage } from "@/lib/roles";

// Rule 5: an employee's own requests, and nobody else's. The list is read for the signed-in user only.
export default guardedPage(["employee"], async ({ user, locale, searchParams }) => {
  const t = await getTranslations("leave");
  const rows = await db
    .select({
      id: leaveRequest.id,
      startDate: leaveRequest.startDate,
      endDate: leaveRequest.endDate,
      days: leaveRequest.days,
      reason: leaveRequest.reason,
      status: leaveRequest.status,
      createdAt: leaveRequest.createdAt,
    })
    .from(leaveRequest)
    .where(eq(leaveRequest.employee, user.userId))
    .orderBy(desc(leaveRequest.createdAt));
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const show = (d: string) => day.format(new Date(`${d}T00:00:00Z`));
  const newLink = (
    <Link href="/my-requests/new" className="inline-flex min-h-11 items-center rounded-md bg-slate-900 px-4 text-white" data-testid="new-request-link">
      {t("new_request_link")}
    </Link>
  );
  return (
    <div data-testid="my-requests">
      <Link href="/home" className="text-sm underline underline-offset-4">
        {t("home_link")}
      </Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{t("my_requests_title")}</h1>
        {rows.length > 0 ? newLink : null}
      </div>
      {searchParams["sent"] === "1" ? (
        <p role="status" className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-emerald-900" data-testid="request-sent">
          {t("sent")}
        </p>
      ) : null}
      {rows.length === 0 ? (
        // Rule 2: an empty list says what to do first.
        <div className="mt-4">
          <EmptyState title={t("empty_title")} body={t("empty_body")} action={newLink} />
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-4" data-testid="leave-request" data-status={r.status}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{t("dates", { start: show(r.startDate), end: show(r.endDate) })}</span>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-900" data-testid="leave-request-status">
                  {t(`status_${r.status}`)}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-700">{t("days_value", { days: r.days })}</p>
              {r.reason ? <p className="mt-1 text-sm text-slate-600">{t("reason_value", { reason: r.reason })}</p> : null}
              <p className="mt-1 text-xs text-slate-500">{t("sent_on", { when: day.format(r.createdAt) })}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
