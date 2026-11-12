import { randomBytes } from "node:crypto";
import type pg from "pg";
import { createPool } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";

export const TEST_DB_URL = process.env.BUILDER_TEST_DATABASE_URL ?? "postgres:///builder_test?host=/var/run/postgresql";

export async function testPool(): Promise<pg.Pool> {
  const pool = createPool(TEST_DB_URL);
  await migrate(pool);
  return pool;
}

export const uniqueId = (prefix: string) => `${prefix}_${randomBytes(4).toString("hex")}`;
