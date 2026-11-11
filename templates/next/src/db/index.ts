import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

/** Rule 7: the connection string comes from the environment, never from the code. */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. The app reads its database address from the environment.");

export const pool = new pg.Pool({ connectionString: url, max: 5 });
export const db = drizzle(pool, { schema });
