import { serve } from "@hono/node-server";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createPool, databaseUrl } from "../store/db.js";
import { holdLivenessLock, JournalFolderBusy } from "../store/liveness.js";
import { createGateway, errorSummary, startHoldKeeper } from "./app.js";
import { FaultGate, FaultJournal } from "./journal.js";

const key = process.env.BUILDER_MODEL_API_KEY;
if (!key) {
  console.error("BUILDER_MODEL_API_KEY is not set. The gateway holds the model key; nothing else does.");
  process.exit(1);
}
const port = Number(process.env.BUILDER_GATEWAY_PORT ?? 4010);
const pool = createPool();
const gatewayId = `gw_${randomBytes(6).toString("hex")}`;
const fault = (m: string, d: unknown) => console.error(`[gateway fault] ${m}`, d);

// Package 1.4. The journal where a call's ending is kept while the database refuses it: one folder per
// deployment, fixed, one gateway process per folder. Start-up stops here if it cannot be written, or (1.4b)
// if the folder's id file cannot be read.
const journalDir = process.env.BUILDER_GATEWAY_JOURNAL_DIR ?? fileURLToPath(new URL("../../.gateway-journal", import.meta.url));
const journal = await FaultJournal.open(journalDir).catch((err: unknown) => {
  console.error(`The gateway's journal folder cannot be written, or its id file cannot be read (${journalDir}); the gateway does not start.`, errorSummary(err));
  process.exit(1);
});
// Its liveness lock, on a connection of its own, before anything else touches holds: a gateway starting
// beside it then knows it is running and leaves its holds alone. With it (1.4b), the lock of its journal
// folder: another gateway, or the journal recovery script, using the folder stops this start-up here.
const liveness = await holdLivenessLock(databaseUrl(), gatewayId, { onLost: (m) => fault(m, { gateway: gatewayId }), journalFolderId: journal.folderId }).catch((err: unknown) => {
  if (!(err instanceof JournalFolderBusy)) throw err;
  console.error(`Another process is using the gateway's journal folder (${journalDir}): a gateway, or the journal recovery script. The gateway does not start.`);
  process.exit(1);
});
// The journal writes nothing while the gateway does not hold its folder's lock (1.4b).
journal.guardWrites(() => liveness.ok());
const gate = new FaultGate({ pool, journal, onFault: fault });
// Before taking any call: write what the journal still holds into the event log (a frozen project and its kept hold).
// A journal file that exists and cannot be read stops start-up (1.4b); a line in it that cannot be read keeps the
// gate closed for every project until it is recovered and the gateway restarted.
const replay = await gate.replay().catch((err: unknown) => {
  console.error(`The gateway's journal file cannot be read (${journal.file}); the gateway does not start.`, errorSummary(err));
  process.exit(1);
});
console.log(`journal lines replayed at start-up: ${replay.loaded}; all recorded: ${replay.recorded}`);
console.log(
  `journal lines that could not be read at start-up: ${replay.unreadable}${replay.unreadable > 0 ? "; this gateway forwards nothing, for any project, until an operator recovers them (scripts/journal-recover.ts) and restarts it" : ""}`,
);
const app = createGateway({ pool, modelApiKey: key, upstreamUrl: process.env.BUILDER_UPSTREAM_URL, gatewayId, gate, liveness, onFault: fault });
// Then find the holds left open in the database and keep them; those of a gateway found gone are marked unreconciled.
const keeper = await startHoldKeeper(pool, gatewayId, 30_000, gate);
console.log(`holds found open at start-up: ${keeper.found}; marked expired at start-up: ${keeper.expiredAtStart}; their gateway found gone: ${keeper.ownerGone}`);
serve({ fetch: app.fetch, port, hostname: process.env.BUILDER_GATEWAY_HOST ?? "127.0.0.1" }, (info) => {
  console.log(`gateway ${gatewayId} listening on ${info.address}:${info.port}`);
});
