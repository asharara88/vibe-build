import { userInfo } from "node:os";
import pg from "pg";

/**
 * One connection pool for the builder. The URL comes from BUILDER_DATABASE_URL.
 * On the development machine the default is the local PostgreSQL over its Unix
 * socket with peer authentication, so no password exists anywhere.
 */
export function databaseUrl(): string {
  return process.env.BUILDER_DATABASE_URL ?? "postgres:///builder_dev?host=/var/run/postgresql";
}

export function createPool(url: string = databaseUrl()): pg.Pool {
  // With peer authentication over the socket the URL carries no user, and the pg library
  // does not fill it in. Use the operating-system user, as psql does.
  // Values parsed from the URL take precedence over explicit options in the pg library, and its
  // own fallback is the USER environment variable, which a container shell may not set. So the
  // fallback is given through PGUSER, which the library reads when the URL names no user.
  const hasUser = new URL(url).username !== "";
  if (!hasUser && !process.env.PGUSER) process.env.PGUSER = userInfo().username;
  return new pg.Pool({ connectionString: url, max: 5 });
}
