import { guardedRoute } from "@/lib/roles";

// An example of a data route for two roles only. It answers with who asked, and nothing else.
export const GET = guardedRoute(["manager", "hr_admin"], (_request, user) => Response.json({ role: user.role }, { headers: { "cache-control": "no-store" } }));
