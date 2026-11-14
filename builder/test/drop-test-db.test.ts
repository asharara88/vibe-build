/**
 * The tests' own database clean-up (known gap 185): a database a test made for itself is dropped only once
 * PostgreSQL lists no connection to it, so the drop ends nobody's connection.
 *
 * Needs PostgreSQL (the test database's server). No container, no model, made-up data.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase } from "./drop-test-db.js";
import { testPool, TEST_DB_URL } from "./helpers.js";

let admin: pg.Pool;
beforeAll(async () => {
  admin = await testPool();
});
afterAll(async () => {
  await admin.end();
});

const exists = async (name: string) => (await admin.query("select 1 from pg_database where datname = $1", [name])).rowCount === 1;
const connections = async (name: string) =>
  (await admin.query<{ n: number }>("select count(*)::int as n from pg_stat_activity where datname = $1", [name])).rows[0]!.n;
const urlOf = (name: string) => {
  const u = new URL(TEST_DB_URL);
  u.pathname = `/${name}`;
  return u.toString();
};
const makeDb = async (tag: string) => {
  const base = decodeURIComponent(new URL(TEST_DB_URL).pathname.slice(1));
  const name = `${base}_dd_${tag}_${randomBytes(3).toString("hex")}`;
  expect(name).toMatch(/^[a-z0-9_]{1,63}$/);
  await admin.query(`create database "${name}"`);
  return name;
};

describe("the tests' own database clean-up (known gap 185)", () => {
  it("D1: a pool ended a moment ago is waited for, not cut off: 40 rounds, every database gone, no connection ended by the drop, no error left for nobody", async () => {
    const strays: unknown[] = [];
    const onStray = (e: unknown) => strays.push(e);
    process.on("uncaughtException", onStray);
    process.on("unhandledRejection", onStray);
    const ended: string[] = [];
    try {
      for (let round = 0; round < 40; round += 1) {
        const name = await makeDb("d1");
        const db = new pg.Pool({ connectionString: urlOf(name), max: 5 });
        // A connection the server ends on purpose says so on the client's "error" event.
        db.on("error", (e) => ended.push(String(e)));
        const clients = await Promise.all([1, 2, 3, 4, 5].map(() => db.connect()));
        for (const c of clients) {
          c.on("error", (e) => ended.push(String(e)));
          await c.query("select 1");
          c.release();
        }
        await db.end();
        const r = await dropTestDatabase(admin, name);
        expect(r.forced, `round ${round}`).toBe(false);
        expect(await exists(name), `round ${round}`).toBe(false);
      }
      // Give a late message of the server the time to arrive before it is counted as absent.
      await new Promise((r) => setTimeout(r, 300));
      expect(ended).toEqual([]);
      expect(strays).toEqual([]);
    } finally {
      process.off("uncaughtException", onStray);
      process.off("unhandledRejection", onStray);
    }
  }, 120_000);

  it("D2: while a connection is still open the database is NOT dropped; it is dropped once that connection has gone", async () => {
    const name = await makeDb("d2");
    const held = new pg.Client({ connectionString: urlOf(name) });
    const heldErrors: string[] = [];
    held.on("error", (e) => heldErrors.push(String(e)));
    await held.connect();
    try {
      let done = false;
      const dropping = dropTestDatabase(admin, name).then((r) => {
        done = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 600));
      expect(done).toBe(false);
      expect(await exists(name)).toBe(true);
      expect(await connections(name)).toBe(1);
      // The held connection still works: nothing ended it.
      expect((await held.query("select 41 + 1 as n")).rows[0].n).toBe(42);
      await held.end();
      const r = await dropping;
      expect(r.forced).toBe(false);
      expect(r.polls).toBeGreaterThan(1);
      expect(await exists(name)).toBe(false);
      expect(heldErrors).toEqual([]);
    } finally {
      await held.end().catch(() => undefined);
      await admin.query(`drop database if exists "${name}" with (force)`).catch(() => undefined);
    }
  }, 60_000);

  it("D3: when the wait is over, one last attempt is made with force, and says so", async () => {
    const name = await makeDb("d3");
    const held = new pg.Client({ connectionString: urlOf(name) });
    const heldErrors: string[] = [];
    held.on("error", (e) => heldErrors.push(String(e)));
    await held.connect();
    try {
      const r = await dropTestDatabase(admin, name, 400);
      expect(r.forced).toBe(true);
      expect(await exists(name)).toBe(false);
      // The held connection was the test role's own, so the forced drop could end it, and the client was told.
      await new Promise((res) => setTimeout(res, 300));
      // (pg reports it twice: the server's own message, then the closed socket.)
      expect(heldErrors.length).toBeGreaterThanOrEqual(1);
      expect(heldErrors[0]).toContain("terminating connection due to administrator command");
    } finally {
      await held.end().catch(() => undefined);
      await admin.query(`drop database if exists "${name}" with (force)`).catch(() => undefined);
    }
  }, 60_000);

  it("D4: a name that is not a test database's is refused before PostgreSQL is asked anything", async () => {
    await expect(dropTestDatabase(admin, 'x"; drop database postgres; --')).rejects.toThrow(/is not a test database's name/);
    await expect(dropTestDatabase(admin, "")).rejects.toThrow(/is not a test database's name/);
  });
});
