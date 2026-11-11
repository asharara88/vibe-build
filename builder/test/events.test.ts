import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { appendEvent, listEvents } from "../src/store/events.js";
import { createProject } from "../src/store/projects.js";
import { testPool, uniqueId } from "./helpers.js";

let pool: pg.Pool;
beforeAll(async () => {
  pool = await testPool();
});
afterAll(async () => {
  await pool.end();
});

describe("event log", () => {
  it("appends and lists events in order", async () => {
    const id = uniqueId("p");
    await createProject(pool, { id, name: "test", capUsd: 1 });
    await appendEvent(pool, id, "intake.question", { q: "What does this replace?" });
    await appendEvent(pool, id, "intake.answer", { a: "email_or_chat" }, null);
    const events = await listEvents(pool, id);
    expect(events.map((e) => e.kind)).toEqual(["intake.question", "intake.answer"]);
  });

  it("refuses to update an event", async () => {
    const id = uniqueId("p");
    await createProject(pool, { id, name: "test", capUsd: 1 });
    const e = await appendEvent(pool, id, "confirm.brief", { by: "owner" });
    await expect(pool.query("update events set payload = '{}' where id = $1", [e.id])).rejects.toThrow(/append-only/);
  });

  it("refuses to truncate the event log", async () => {
    await expect(pool.query("truncate events")).rejects.toThrow(/append-only/);
  });

  it("refuses to delete an event", async () => {
    const id = uniqueId("p");
    await createProject(pool, { id, name: "test", capUsd: 1 });
    const e = await appendEvent(pool, id, "confirm.plan", { by: "owner" });
    await expect(pool.query("delete from events where id = $1", [e.id])).rejects.toThrow(/append-only/);
    const still = await listEvents(pool, id);
    expect(still).toHaveLength(1);
  });
});
