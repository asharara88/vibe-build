import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/auth";
import { publicRoute } from "@/lib/roles";

const handlers = toNextJsHandler(auth);
const reason = "the sign-in library's own routes (sign in, sign out, read the session): they must answer before anyone is signed in";

export const GET = publicRoute(reason, handlers.GET);
export const POST = publicRoute(reason, handlers.POST);
