/**
 * Rule 5: every screen checks the user's role before showing anything.
 * Server components call `requireRole([...])` first; it returns the session or redirects.
 *
 * Protected: the build engine must not change this file.
 */
import { headers } from "next/headers";
import { isRole, type Role } from "@/app-config";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";

export interface Signed {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

/** The signed-in user, or null. */
export async function currentUser(): Promise<Signed | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const role = (session.user as { role?: unknown }).role;
  return { userId: session.user.id, name: session.user.name, email: session.user.email, role: isRole(role) ? role : "employee" };
}

/**
 * Require a signed-in user with one of the allowed roles. Not signed in: sent to sign-in.
 * Wrong role: returns `{ denied: true }` so the page can say so in plain words (never a blank page).
 */
export async function requireRole(locale: string, allowed: readonly Role[]): Promise<{ user: Signed; denied: false } | { user: Signed; denied: true }> {
  const user = await currentUser();
  if (!user) redirect({ href: "/sign-in", locale });
  const u = user as Signed;
  return allowed.includes(u.role) ? { user: u, denied: false } : { user: u, denied: true };
}
