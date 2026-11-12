/**
 * Rule 5: every screen, form action and data route checks the user's role before anything else.
 *
 * The guards here stop an unauthorised request themselves. The code given to a guard is only
 * ever called with a permitted user; it cannot forget to look at a flag, because
 * there is no flag. Each page, action and route is written through one of these, and the build
 * fails if one is not (scripts/check-guards.ts):
 *
 *   export default guardedPage(["manager"], async ({ user, locale }) => ...)   // a page
 *   export const approve = guardedAction(["manager"], async (user, formData) => ...) // a form action
 *   export const GET = guardedRoute(["manager"], async (request, user) => ...)  // a data route
 *
 * and, for the few things that need no role (the sign-in page, the sign-in library's own
 * routes), publicPage, publicAction and publicRoute, each with the reason written beside it.
 *
 * What a refused person gets: not signed in, the sign-in page (a route answers 401); signed in
 * with the wrong role or with a role this app does not recognise, a plain "no access" page in
 * their language (a route answers 403, with its message in both languages). An unrecognised role
 * is refused, never treated as the lowest role. A page file's other exports (generateMetadata
 * and the like) would run before the guard, which is why the build check refuses them.
 *
 * Protected: the build engine must not change this file.
 */
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { getLocale, setRequestLocale } from "next-intl/server";
import type { Role } from "@/app-config";
import { auth } from "@/auth";
import { NoAccess } from "@/components/NoAccess";
import { redirect } from "@/i18n/navigation";
import { decide, whoFrom, type Signed, type Who } from "./access";

export type { Signed } from "./access";

/** Who is asking, read from the session cookie by the sign-in library. */
export async function whoIsAsking(): Promise<Who> {
  return whoFrom(await auth.api.getSession({ headers: await headers() }));
}

type Query = Record<string, string | string[] | undefined>;
type PageProps = { params: Promise<{ locale: string } & Record<string, string | string[]>>; searchParams?: Promise<Query> };
type PageArgs = { locale: string; params: Record<string, string | string[]>; searchParams: Query };

/** A page for the roles in `allowed`. `render` is called only with a permitted user. */
export function guardedPage(allowed: readonly Role[], render: (args: PageArgs & { user: Signed }) => ReactNode | Promise<ReactNode>) {
  return async function GuardedPage({ params, searchParams }: PageProps): Promise<ReactNode> {
    const all = await params;
    const locale = all.locale;
    setRequestLocale(locale);
    const decision = decide(await whoIsAsking(), allowed);
    if (!decision.allow) {
      if (decision.reason === "not_signed_in") return redirect({ href: "/sign-in", locale });
      return <NoAccess reason={decision.reason} role={decision.role} allowed={allowed} />;
    }
    return render({ user: decision.user, locale, params: all, searchParams: (await searchParams) ?? {} });
  };
}

/** A page that needs no role. Say why in `reason`; the build check prints it. */
export function publicPage(reason: string, render: (args: Omit<PageArgs, "searchParams">) => ReactNode | Promise<ReactNode>) {
  void reason;
  return async function PublicPage({ params }: PageProps): Promise<ReactNode> {
    const all = await params;
    setRequestLocale(all.locale);
    // The address's query is not read here, so that a public page can still be prepared ahead of time.
    return render({ locale: all.locale, params: all });
  };
}

/**
 * A form action for the roles in `allowed`. `run` is called only with a permitted user.
 * Anyone else is sent to the sign-in page or to the "no access" page, and `run` does not start.
 */
export function guardedAction<Args extends unknown[], Result>(allowed: readonly Role[], run: (user: Signed, ...args: Args) => Promise<Result>) {
  return async function guardedActionCall(...args: Args): Promise<Result> {
    const decision = decide(await whoIsAsking(), allowed);
    if (!decision.allow) {
      const locale = await getLocale();
      return redirect({ href: decision.reason === "not_signed_in" ? "/sign-in" : "/no-access", locale });
    }
    return run(decision.user, ...args);
  };
}

/** A form action that needs no role. Say why in `reason`. */
export function publicAction<Args extends unknown[], Result>(reason: string, run: (...args: Args) => Promise<Result>) {
  void reason;
  return async function publicActionCall(...args: Args): Promise<Result> {
    return run(...args);
  };
}

const refusal = (status: 401 | 403, code: string, en: string, ar: string) =>
  Response.json({ error: code, message: { en, ar } }, { status, headers: { "cache-control": "no-store" } });

/**
 * A data route for the roles in `allowed`. `handle` is called only with a permitted user.
 * Not signed in: 401. Wrong or unrecognised role: 403. The answer says so in both languages.
 */
export function guardedRoute<Ctx>(allowed: readonly Role[], handle: (request: Request, user: Signed, context: Ctx) => Response | Promise<Response>) {
  return async function guardedRouteCall(request: Request, context: Ctx): Promise<Response> {
    const decision = decide(await whoIsAsking(), allowed);
    if (!decision.allow && decision.reason === "not_signed_in") return refusal(401, "not_signed_in", "Sign in first.", "سجّل الدخول أولاً.");
    if (!decision.allow) return refusal(403, "no_access", "Your role does not have access to this.", "دورك لا يملك صلاحية الوصول إلى هذا المحتوى.");
    return handle(request, decision.user, context);
  };
}

/** A data route that needs no role. Say why in `reason`. */
export function publicRoute<Ctx>(reason: string, handle: (request: Request, context: Ctx) => Response | Promise<Response>) {
  void reason;
  return async function publicRouteCall(request: Request, context: Ctx): Promise<Response> {
    return handle(request, context);
  };
}
