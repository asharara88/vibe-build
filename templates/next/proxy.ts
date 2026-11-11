// Next.js 16 runs this file in front of every request (it was called middleware.ts before 16).
// next-intl uses it to put the language in the address: /en/... or /ar/...
import createMiddleware from "next-intl/middleware";
import { routing } from "./src/i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Everything except the API, Next's own files and static files.
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
