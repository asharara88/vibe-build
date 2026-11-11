import { serve } from "@hono/node-server";
import { createPool } from "../store/db.js";
import { createGateway } from "./app.js";

const key = process.env.BUILDER_MODEL_API_KEY;
if (!key) {
  console.error("BUILDER_MODEL_API_KEY is not set. The gateway holds the model key; nothing else does.");
  process.exit(1);
}
const port = Number(process.env.BUILDER_GATEWAY_PORT ?? 4010);
const app = createGateway({ pool: createPool(), modelApiKey: key, upstreamUrl: process.env.BUILDER_UPSTREAM_URL });
serve({ fetch: app.fetch, port, hostname: process.env.BUILDER_GATEWAY_HOST ?? "127.0.0.1" }, (info) => {
  console.log(`gateway listening on ${info.address}:${info.port}`);
});
