"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { guardedAction } from "@/lib/roles";

// An example of a form action for two roles only. It stores nothing: it only shows that the
// check ran before the action did.
export const runExampleAction = guardedAction(["manager", "hr_admin"], async (user) => {
  const locale = await getLocale();
  return redirect({ href: { pathname: "/example/action", query: { done: user.role } }, locale });
});
