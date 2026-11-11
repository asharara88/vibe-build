import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { createPool } from "./db.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Apply every SQL file in ./migrations once, in name order. Safe to run again. */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  await pool.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const dir = join(here, "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    const seen = await pool.query("select 1 from schema_migrations where name = $1", [file]);
    if (seen.rowCount) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations(name) values ($1)", [file]);
      await client.query("commit");
      applied.push(file);
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
  return applied;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const pool = createPool();
  migrate(pool)
    .then((a) => {
      console.log(a.length ? `Applied: ${a.join(", ")}` : "Nothing to apply.");
      return pool.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
