/**
 * Sign-in: email and password in Stage 1, through a maintained library (better-auth, MIT).
 * Nothing about passwords is written by hand here (docs/KNOWN-GAPS.md, gap 6).
 *
 * Protected: the build engine must not change this file.
 */
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import * as schema from "./db/schema";

const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error("AUTH_SECRET is not set. Rule 7: secrets come from the environment.");

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret,
  baseURL: process.env.APP_URL ?? "http://localhost:3000",
  trustedOrigins: process.env.APP_URL ? [process.env.APP_URL] : undefined,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    requireEmailVerification: false,
  },
  user: {
    additionalFields: {
      // Rule 5: the role is set by an admin or the seed, never by the user signing up.
      role: { type: "string", required: false, defaultValue: "employee", input: false },
    },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
