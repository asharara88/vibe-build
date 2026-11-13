/**
 * Rule 5, the decision itself: who is asking, and may they?
 *
 * This file is plain logic with no framework in it, so that it can be tested on its own.
 * The guards in roles.tsx are the only callers. An unrecognised role is refused: it is never
 * treated as the lowest role.
 *
 * Protected: the build engine must not change this file.
 */
import { isRole, type Role } from "../app-config";

/** A signed-in user whose role this app recognises. The only kind of user a guard hands on. */
export interface Signed {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

/** Who is asking: nobody; someone whose account carries no role this app knows; or a user. */
export type Who = { kind: "nobody" } | { kind: "no-role"; userId: string; name: string; email: string } | { kind: "user"; user: Signed };

/** What the sign-in library hands back for a session, as far as the guard reads it. */
export interface SessionLike {
  user: { id: string; name: string; email: string; role?: unknown };
}

export function whoFrom(session: SessionLike | null | undefined): Who {
  if (!session || !session.user || typeof session.user.id !== "string" || session.user.id === "") return { kind: "nobody" };
  const { id, name, email, role } = session.user;
  // "none" is what a new account is given (src/auth.ts). It is refused here even if the list of
  // roles in app-config.ts, which the build engine writes, were ever to name it.
  if (role === "none" || !isRole(role)) return { kind: "no-role", userId: id, name, email };
  return { kind: "user", user: { userId: id, name, email, role } };
}

export type Refusal = "not_signed_in" | "role_not_recognised" | "role_not_allowed";
export type Decision = { allow: true; user: Signed } | { allow: false; reason: Refusal; role: Role | null };

/**
 * May this person do something that is only for the roles in `allowed`?
 * Nothing is allowed unless a recognised role is on the list: an empty list allows nobody.
 */
export function decide(who: Who, allowed: readonly Role[]): Decision {
  if (who.kind === "nobody") return { allow: false, reason: "not_signed_in", role: null };
  if (who.kind === "no-role") return { allow: false, reason: "role_not_recognised", role: null };
  const permitted = allowed.filter(isRole);
  if (!permitted.includes(who.user.role)) return { allow: false, reason: "role_not_allowed", role: who.user.role };
  return { allow: true, user: who.user };
}
