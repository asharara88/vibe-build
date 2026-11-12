import { serve } from "@hono/node-server";
import { createPool } from "../store/db.js";
import { randomBytes } from "node:crypto";
import { createGateway, startHoldKeeper } from "./app.js";

const key = process.env.BUILDER_MODEL_API_KEY;
if (!key) {
  console.error("BUILDER_MODEL_API_KEY is not set. The gateway holds the model key; nothing else does.");
  process.exit(1);
}
const port = Number(process.env.BUILDER_GATEWAY_PORT ?? 4010);
const pool = createPool();
const gatewayId = `gw_${randomBytes(6).toString("hex")}`;
const app = createGateway({ pool, modelApiKey: key, upstreamUrl: process.env.BUILDER_UPSTREAM_URL, gatewayId });
// Before taking any call: find the holds left open in the database and keep them.
const keeper = await startHoldKeeper(pool, gatewayId);
console.log(`holds found open at start-up: ${keeper.found}; marked expired at start-up: ${keeper.expiredAtStart}`);
serve({ fetch: app.fetch, port, hostname: process.env.BUILDER_GATEWAY_HOST ?? "127.0.0.1" }, (info) => {
  console.log(`gateway listening on ${info.address}:${info.port}`);
});
