/**
 * Evidence run: shows the gateway metering calls and stopping a project at its cap.
 * Uses a stand-in model provider so no real key and no real spend are involved.
 * Run: npx tsx scripts/demo-cap.ts   (needs the local builder_test database)
 */
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { createGateway } from "../src/gateway/app.js";
import { createPool } from "../src/store/db.js";
import { listEvents } from "../src/store/events.js";
import { migrate } from "../src/store/migrate.js";
import { createProject, getSpend, issueProjectToken } from "../src/store/projects.js";

const log = (s: string) => console.log(s);
const listen = (app: Hono) =>
  new Promise<{ server: ServerType; url: string }>((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (i) =>
      resolve({ server, url: `http://127.0.0.1:${i.port}` }),
    );
  });

const standIn = new Hono();
const keysSeen: string[] = [];
standIn.post("/v1/messages", async (c) => {
  keysSeen.push(c.req.header("x-api-key") ?? "(none)");
  const body = (await c.req.json()) as { model: string };
  return c.json({
    id: "msg_demo",
    type: "message",
    model: body.model,
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: 150_000, output_tokens: 8_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });
});

const pool = createPool(process.env.BUILDER_TEST_DATABASE_URL ?? "postgres:///builder_test?host=/var/run/postgresql");
await migrate(pool);
const { server: up, url: upUrl } = await listen(standIn);
const REAL = "demo-real-key-" + Math.random().toString(36).slice(2);
const { server: gw, url: gwUrl } = await listen(createGateway({ pool, modelApiKey: REAL, upstreamUrl: upUrl }));

const projectId = `demo_${Date.now()}`;
await createProject(pool, { id: projectId, name: "Cap demonstration", capUsd: 2.0 });
const token = await issueProjectToken(pool, projectId);
log(`Project ${projectId} created with a cap of $2.00.`);
log(`The engine holds a project token (starts "${token.slice(0, 9)}..."), not the real key.`);
log("");
log("Each stand-in call reports 150,000 input tokens and 8,000 output tokens on claude-opus-5-5.");
log("At $4 and $20 per million that is $0.60 + $0.16 = $0.76 per call.");
log("");
for (let i = 1; i <= 4; i++) {
  const res = await fetch(`${gwUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": token,
      "anthropic-version": "2023-06-01",
      "x-builder-step": `step-${i}`,
    },
    body: JSON.stringify({ model: "claude-opus-5-5", max_tokens: 10, messages: [{ role: "user", content: "hello" }] }),
  });
  const spend = await getSpend(pool, projectId);
  if (res.ok) {
    log(`Call ${i}: allowed. Spent so far $${Number(spend.spent_usd).toFixed(2)} of $${Number(spend.cap_usd).toFixed(2)}.`);
  } else {
    const body = (await res.json()) as { error: { type: string; message: string } };
    log(`Call ${i}: REFUSED with HTTP ${res.status} (${body.error.type}).`);
    log(`         Message shown to the user: "${body.error.message}"`);
  }
}
log("");
const calls = await listEvents(pool, projectId, "model.call");
const refusals = await listEvents(pool, projectId, "gateway.refused");
log(`Event log for the project: ${calls.length} model.call events, ${refusals.length} gateway.refused event.`);
log(`Every forwarded call carried the real key: ${keysSeen.every((k) => k === REAL) ? "yes" : "NO"} (${keysSeen.length} calls checked).`);
log(`The project token never reached the provider: ${keysSeen.includes(token) ? "NO, IT DID" : "correct, it did not"}.`);
gw.close();
up.close();
await pool.end();
