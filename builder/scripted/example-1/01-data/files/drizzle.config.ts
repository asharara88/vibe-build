// Written by the scripted engine (fixed change example-1/01-data). No AI model wrote this.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // The template's sign-in tables (schema.ts, protected), then the app's own tables (app-schema.ts).
  schema: ["./src/db/schema.ts", "./src/db/app-schema.ts"],
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
