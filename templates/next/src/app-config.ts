/**
 * App configuration the build engine's data step rewrites from the app spec.
 * Roles are the only entry the template needs before any app-specific table exists.
 */
export const ROLES = ["employee", "manager", "hr_admin"] as const;
export type Role = (typeof ROLES)[number];

export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);
