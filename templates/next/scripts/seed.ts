/**
 * Seed three sample users, one per role. Sample data is made up and labelled as such.
 * The sample password comes from the environment (APP_SAMPLE_PASSWORD), set per project by the
 * builder; it is never written into this repository.
 */
import { eq } from "drizzle-orm";
import { auth } from "../src/auth";
import { db, pool } from "../src/db";
import { user } from "../src/db/schema";
import { ROLES } from "../src/app-config";

const password = process.env.APP_SAMPLE_PASSWORD;
if (!password || password.length < 12) {
  console.error("APP_SAMPLE_PASSWORD must be set (12 characters or more). It is the sample users' password.");
  process.exit(1);
}

const SAMPLE = {
  employee: { name: "Sample Employee", email: "employee@example.test" },
  manager: { name: "Sample Manager", email: "manager@example.test" },
  hr_admin: { name: "Sample HR Admin", email: "hr.admin@example.test" },
} as const;

for (const role of ROLES) {
  const s = SAMPLE[role];
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, s.email));
  if (existing.length) {
    console.log(`exists: ${s.email} (${role})`);
    continue;
  }
  const res = await auth.api.signUpEmail({ body: { name: s.name, email: s.email, password } });
  await db.update(user).set({ role }).where(eq(user.id, res.user.id));
  console.log(`created: ${s.email} (${role})`);
}
await pool.end();
