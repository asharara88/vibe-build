/**
 * Known gap 145, closed on the owner's instruction of 14 Nov 2026: "Ensure a detected overrun blocks further forwarding
 * for that project before completion is exposed. Test the delayed-stream-ending case and concurrent requests,
 * preserving existing accounting and recovery checks." (docs/DECISIONS.md.)
 *
 * Until this change, a streamed call was settled, and so frozen when its bill was above its hold (package 1.4c), only
 * when the provider's body ended, after the bytes carrying the end marker had gone to the caller: the same project's
 * next call, sent as soon as the caller saw the marker, could be forwarded. Here the stand-in provider sends the
 * figures that put the call above its hold and the end marker together, then keeps its body open 1.5 seconds before
 * ending it, which is the case the review found.
 *
 * Against a stand-in provider written here as a plain Node server and gateways in this process: no real provider is
 * called, the key is made up, nothing is spent, and every figure, name and usage record is made up. The model is the
 * first one in the gateway's price table, named from the table, not written here; its rates are checked below
 * ($4 in, $5 five-minute and $8 one-hour cache writes, $0.20 cache reads, $20 out, per million tokens).
 *
 * Each call is answered with 30 input, 4 cache-write, 8 cache-read and 300 output tokens. At the standard rates that is
 * $0.006142 (6,141.6 millionths, rounded up). Mode "fast-..." says fast mode served the call, which the request did not
 * ask for and the profile does not allow, so the bill doubles to $0.012284, above each call's hold of $0.009960
 * ((42 counted + 5% + 200) x $8 + 400 x $20, per million). Mode "cache1h-..." says 600 cache-write tokens, not split
 * by lifetime, on a request that may ask for a one-hour cache: $0.010922 at the one-hour rate the gateway settles them
 * at (above the hold), $0.009122 at the five-minute rate (below it).
 *
 * Test-only database objects (created here, never a migration, dropped at the end; their names are this file's own):
 * a trigger that makes the insert of a hold sleep 0.8 s for a chosen project, so that a call's hold can be opened
 * before the stop is written and reach its forward after the figures were read.
 */
import { serve, type ServerType } from "@hono/node-server";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGateway } from "../src/gateway/app.js";
import { DEFAULT_PROFILES } from "../src/gateway/hold.js";
import { FaultGate, FaultJournal } from "../src/gateway/journal.js";
import { PRICES } from "../src/gateway/prices.js";
import { listEvents } from "../src/store/events.js";
import { activeFreeze, frozenMessage, KEPT_ABOVE_HOLD_REASON, listFreezes } from "../src/store/freezes.js";
import * as holds from "../src/store/holds.js";
import { getBudget, listHolds, openHold, recoverHolds } from "../src/store/holds.js";
import { holdLivenessLock, type Liveness } from "../src/store/liveness.js";
import { createProject, issueProjectToken } from "../src/store/projects.js";
import { reconcileHold, recordOverrun } from "../src/store/reconcile.js";
import { checkProject, micro, type Bill } from "./invariants.js";
import { TEST_DB_URL, testPool, uniqueId } from "./helpers.js";

/** Made up for these tests; never a real key. */
const MADE_UP_KEY = "made-up-key-for-gap-145-tests";
/** The first model of the gateway's price table (see the top of this file). */
const MODEL = Object.keys(PRICES)[0]!;
const USAGE = { input_tokens: 30, cache_creation_input_tokens: 4, cache_read_input_tokens: 8, output_tokens: 300 };
const BILL_MICRO = 6142;
const FAST_BILL_MICRO = 12284;
const HOLD_MICRO = 9960;
const HOLD_USD = HOLD_MICRO / 1e6;
/** Mode "cache1h-...": 600 cache writes not split by lifetime, at the one-hour rate: 120 + 4,800 + 1.6 + 6,000 millionths, rounded up. */
const CACHE1H_USAGE = { input_tokens: 30, cache_creation_input_tokens: 600, cache_read_input_tokens: 8, output_tokens: 300 };
const CACHE1H_BILL_MICRO = 10922;
/** How long the stand-in keeps its body open after the end marker, in the "-late" and "-wait" modes. */
const LATE_MS = 1_500;
const EVIDENCE = "Provider usage record (made up for this test): fast mode, 30 input, 4 cache-write, 8 cache-read and 300 output tokens, billed $0.012284";
const WHO = { askedBy: "the owner (made up for this test)", recordedBy: "the test", reason: "gap 145 test: the bill above its hold was looked at and is recorded" };
/** What the checker flags for a project with one bill above its hold, as designed (as in test/overrun.test.ts). */
const ONE_BILL_ABOVE_ITS_HOLD = ["2: below what was owed", "a settled call above its hold", "hold.exceeded written"];
/** The words the refusal must carry while the stop stands: the cost as read, the hold, the difference. */
const stopWords = (costMicro: number) =>
  `had already used $${(costMicro / 1e6).toFixed(6)} by the usage figures the gateway read from its answer, more than its hold of $0.009960 (above it by $${((costMicro - HOLD_MICRO) / 1e6).toFixed(6)})`;

let pool: pg.Pool;
let standServer: Server;
let standUrl: string;
const servers: ServerType[] = [];
const livenesses: Liveness[] = [];
const journalDirs: string[] = [];
const bills = new Map<string, Bill[]>();

/* ------------------------------------------------------------------ the stand-in provider */

/** What reached the stand-in, per project: metered calls and counting calls. A refused call must move neither. */
const forwards = new Map<string, number>();
const counts = new Map<string, number>();
const forwardsOf = (project: string) => forwards.get(project) ?? 0;
const countsOf = (project: string) => counts.get(project) ?? 0;
/** For each streamed call of the "-late" and "-wait" modes, by project: when the end marker was written, and when the body ended (performance.now()). */
const streams = new Map<string, { markerSentAt: number; bodyEndAt: number | null }>();
/** Mode "fast-wait": the stand-in holds back the figures and the end marker until the test lets them go. */
const figureGates = new Map<string, () => void>();
/** Counting calls held back by the stand-in until the test lets them go, by tag. */
const heldCounts: Array<{ tag: string; release: () => void }> = [];
const releaseCounts = (tag: string) => {
  for (const h of heldCounts.filter((x) => x.tag === tag)) h.release();
};
const heldCountsOf = (tag: string) => heldCounts.filter((x) => x.tag === tag).length;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.setEncoding("utf8");
    req.on("data", (d: string) => (s += d));
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

/** A bill, pinned to the project's latest hold.opened (this call's hold, committed before the call was forwarded). */
async function bill(project: string, billMicro: number): Promise<void> {
  const r = await pool.query<{ id: string }>("select coalesce(max(id), 0)::text as id from events where project_id = $1 and kind = 'hold.opened'", [project]);
  bills.set(project, [...(bills.get(project) ?? []), { pinnedAt: Number(r.rows[0]!.id), billMicro }]);
}

const frame = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The project a request's prompt names ("for <project>", or "count-held <tag> for <project>"). */
function promptOf(text: string): { project: string; held: string | null } {
  const b = JSON.parse(text) as { messages?: Array<{ content?: unknown }> };
  const c = b.messages?.[0]?.content;
  const s = typeof c === "string" ? c : Array.isArray(c) ? String((c[0] as { text?: unknown } | undefined)?.text ?? "") : "";
  const m = /^(?:count-held (\S+) )?for (\S+)$/.exec(s);
  return { project: m?.[2] ?? "", held: m?.[1] ?? null };
}

async function standIn(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const text = await readBody(req);
  if (req.url === "/v1/messages/count_tokens") {
    const { project, held } = promptOf(text);
    counts.set(project, countsOf(project) + 1);
    if (held !== null) await new Promise<void>((release) => heldCounts.push({ tag: held, release }));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ input_tokens: 42 }));
    return;
  }
  if (req.url !== "/v1/messages") {
    res.writeHead(404).end();
    return;
  }
  const body = JSON.parse(text) as { model: string; stream?: boolean; metadata?: { test?: string; project?: string } };
  const mode = body.metadata?.test ?? "ok";
  const project = body.metadata?.project ?? "";
  forwards.set(project, forwardsOf(project) + 1);
  const fast = mode.startsWith("fast-");
  const cache1h = mode.startsWith("cache1h-");
  const usage = cache1h ? CACHE1H_USAGE : fast ? { ...USAGE, speed: "fast" } : USAGE;
  if (project) await bill(project, cache1h ? CACHE1H_BILL_MICRO : fast ? FAST_BILL_MICRO : BILL_MICRO);
  if (!body.stream) {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "msg_test", type: "message", model: body.model, content: [{ type: "text", text: "hello" }], usage }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(frame("message_start", { type: "message_start", message: { model: body.model, usage: { ...usage, output_tokens: 1 } } }));
  res.write(frame("content_block_delta", { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } }));
  if (mode === "fast-wait") await new Promise<void>((go) => figureGates.set(project, go));
  if (mode === "fast-fallsplit") {
    // The figures that put the call above its hold, then, 150 ms later, a figure that falls (30 input tokens become 10),
    // so the figures can no longer be trusted, and the end marker.
    res.write(frame("message_delta", { type: "message_delta", usage: { output_tokens: usage.output_tokens } }));
    await sleep(150);
    res.end(frame("message_delta", { type: "message_delta", usage: { input_tokens: 10, output_tokens: usage.output_tokens } }) + frame("message_stop", { type: "message_stop" }));
    return;
  }
  // The figures that settle the call and the end marker, in one write; then, in the "-late" and "-wait" modes, the
  // body kept open for LATE_MS before it ends (the case the review found).
  res.write(frame("message_delta", { type: "message_delta", usage: { output_tokens: usage.output_tokens } }) + frame("message_stop", { type: "message_stop" }));
  const s = { markerSentAt: performance.now(), bodyEndAt: null as number | null };
  if (mode.endsWith("-late") || mode === "fast-wait") {
    streams.set(project, s);
    await sleep(LATE_MS);
  }
  if (!res.destroyed) res.end();
  s.bodyEndAt = performance.now();
}

/* ------------------------------------------------------------------ helpers */

function listen(app: { fetch: (r: Request) => Response | Promise<Response> }): Promise<{ server: ServerType; url: string }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => resolve({ server, url: `http://127.0.0.1:${info.port}` }));
    servers.push(server);
  });
}

async function newProject(capUsd: number) {
  const id = uniqueId("pfx145");
  await createProject(pool, { id, name: "gap 145 test (made-up data)", capUsd });
  return { id, token: await issueProjectToken(pool, id) };
}

const body = (project: string, mode = "ok", more: Record<string, unknown> = {}) => ({ model: MODEL, max_tokens: 400, messages: [{ role: "user", content: `for ${project}` }], metadata: { test: mode, project }, ...more });
/** A call whose counting call the stand-in holds back until the test lets it go (tag). */
const heldBody = (project: string, tag: string) => body(project, "ok", { messages: [{ role: "user", content: `count-held ${tag} for ${project}` }] });
/** A request that may ask for a one-hour cache lifetime (so cache writes it does not split are settled at the one-hour rate). */
const cache1hBody = (project: string) =>
  body(project, "cache1h-late", { stream: true, messages: [{ role: "user", content: [{ type: "text", text: `for ${project}`, cache_control: { type: "ephemeral", ttl: "1h" } }] }] });
const callAt = (base: string, token: string, b: unknown) =>
  fetch(base + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": token, "anthropic-version": "2023-06-01" }, body: JSON.stringify(b) });
const errorOf = async (res: Response) => ((await res.json()) as { error: { type: string; message: string } }).error;

/**
 * What a gateway's forwards looked like from inside its own process: the moment it called fetch for each metered call
 * (the gateway calls it synchronously when it forwards), and, for a streamed answer, the moment the gateway's reader
 * was handed the piece of the answer that carries the figures settling the call. The gateway reads those figures after
 * that moment, so a forward logged before it was made before the gateway could have read them.
 */
interface ForwardLog {
  forwards: Array<{ project: string; test: string; at: number }>;
  figuresHandedAt: Map<string, number>;
  markerHandedAt: Map<string, number>;
}
function instrumented(log: ForwardLog): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.endsWith("/v1/messages")) return fetch(input, init);
    const b = JSON.parse(String(init?.body)) as { stream?: boolean; metadata?: { project?: string; test?: string } };
    const project = b.metadata?.project ?? "";
    log.forwards.push({ project, test: b.metadata?.test ?? "", at: performance.now() });
    const res = await fetch(input, init);
    if (!b.stream || !res.body) return res;
    const upstream = res.body.getReader();
    const decoder = new TextDecoder();
    const passOn = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        const { done, value } = await upstream.read();
        if (done) {
          ctrl.close();
          return;
        }
        const text = decoder.decode(value, { stream: true });
        if (text.includes('"output_tokens":300') && !log.figuresHandedAt.has(project)) log.figuresHandedAt.set(project, performance.now());
        if (text.includes("message_stop") && !log.markerHandedAt.has(project)) log.markerHandedAt.set(project, performance.now());
        ctrl.enqueue(value);
      },
      cancel: (reason) => upstream.cancel(reason),
    });
    return new Response(passOn, { status: res.status, headers: res.headers });
  }) as typeof fetch;
}

/** A gateway in this process, holding its liveness lock, with its own gate and journal and an instrumented fetch. */
async function gateway(name: string) {
  const gatewayId = uniqueId(name);
  const liveness = await holdLivenessLock(TEST_DB_URL, gatewayId);
  livenesses.push(liveness);
  const dir = await mkdtemp(join(tmpdir(), "fx145-journal-"));
  journalDirs.push(dir);
  const faults: Array<{ message: string; detail: Record<string, unknown> }> = [];
  const onFault = (message: string, detail: unknown) => faults.push({ message, detail: (detail ?? {}) as Record<string, unknown> });
  const journal = await FaultJournal.open(dir);
  const gate = new FaultGate({ pool, journal, onFault });
  const log: ForwardLog = { forwards: [], figuresHandedAt: new Map(), markerHandedAt: new Map() };
  const app = createGateway({ pool, modelApiKey: MADE_UP_KEY, upstreamUrl: standUrl, profiles: DEFAULT_PROFILES, gatewayId, gate, liveness, onFault, fetchImpl: instrumented(log) });
  const { url } = await listen(app);
  return { url, gatewayId, faults, log };
}

/** Wait until a condition holds. */
async function until(what: string, f: () => Promise<boolean> | boolean, tries = 400): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await f()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for: ${what}`);
}

/** Read a streamed answer until its end marker has arrived; returns what was read, when the marker was seen, and the reader. */
async function readToMarker(res: Response): Promise<{ got: string; seenAt: number; reader: ReadableStreamDefaultReader<Uint8Array> }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let got = "";
  while (!got.includes("message_stop")) {
    const { value, done } = await reader.read();
    if (done) break;
    got += decoder.decode(value, { stream: true });
  }
  return { got, seenAt: performance.now(), reader };
}
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    while (!(await reader.read()).done);
  } catch {
    /* cut part-way */
  }
}

/** The hold's stop as the database holds it (null when the column does not exist, as on the source before this change). */
async function stopOn(holdId: string): Promise<{ usd: string | null; at: Date | null } | null> {
  const h = (await listHolds(pool, (await pool.query<{ project_id: string }>("select project_id from holds where id = $1", [holdId])).rows[0]!.project_id)).find((x) => x.id === holdId) as
    | (Record<string, unknown> & { read_above_hold_usd?: string | null; read_above_hold_at?: Date | null })
    | undefined;
  if (!h || !("read_above_hold_usd" in h)) return null;
  return { usd: h.read_above_hold_usd ?? null, at: h.read_above_hold_at ?? null };
}

async function rulesOf(id: string): Promise<string[]> {
  const r = await checkProject(pool, id, bills.get(id) ?? [], []);
  return [...new Set(r.violations.map((v) => v.rule))];
}

/** Printed for the evidence: what was measured, before any assertion, so a failing run shows it too. */
const measured = (what: string, v: Record<string, unknown>) => console.log(`MEASURED gap 145 ${what}: ${JSON.stringify(v)}`);
const ms = (x: number) => Math.round(x * 10) / 10;

/** The test-only slow insert of a hold, for a chosen project. */
const slowHolds = {
  on: (project: string) => pool.query("insert into test_slow_holds_fx145(project_id) values ($1)", [project]),
  off: () => pool.query("delete from test_slow_holds_fx145"),
};
/** The test-only slow write of a stop on a hold (0.5 s, inside its transaction), for a chosen project. */
const slowStops = {
  on: (project: string) => pool.query("insert into test_slow_stops_fx145(project_id) values ($1)", [project]),
  off: () => pool.query("delete from test_slow_stops_fx145"),
};
/** Whether a statement starting so is running in this test database now. */
const running = async (start: string) =>
  ((await pool.query("select 1 from pg_stat_activity where datname = current_database() and state = 'active' and query like $1", [`${start}%`])).rowCount ?? 0) > 0;

beforeAll(async () => {
  pool = await testPool();
  await pool.query(`
    create table if not exists test_slow_holds_fx145 (project_id text not null);
    delete from test_slow_holds_fx145;
    create or replace function test_slow_hold_fx145() returns trigger language plpgsql as $$
    begin
      if exists (select 1 from test_slow_holds_fx145 s where s.project_id = new.project_id) then
        perform pg_sleep(0.8);
      end if;
      return new;
    end $$;
    drop trigger if exists test_slow_hold_fx145_insert on holds;
    create trigger test_slow_hold_fx145_insert before insert on holds for each row execute function test_slow_hold_fx145();
    create table if not exists test_slow_stops_fx145 (project_id text not null);
    delete from test_slow_stops_fx145;
    -- Read through jsonb so that it can be created on the source before this change too, where the column does not exist.
    create or replace function test_slow_stop_fx145() returns trigger language plpgsql as $$
    begin
      if (to_jsonb(new) ->> 'read_above_hold_at') is not null and (to_jsonb(old) ->> 'read_above_hold_at') is null
         and exists (select 1 from test_slow_stops_fx145 s where s.project_id = new.project_id) then
        perform pg_sleep(0.5);
      end if;
      return new;
    end $$;
    drop trigger if exists test_slow_stop_fx145_update on holds;
    create trigger test_slow_stop_fx145_update before update on holds for each row execute function test_slow_stop_fx145();
  `);
  standServer = createServer((req, res) => {
    standIn(req, res).catch(() => res.destroy());
  });
  await new Promise<void>((r) => standServer.listen(0, "127.0.0.1", () => r()));
  standUrl = `http://127.0.0.1:${(standServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const h of heldCounts) h.release();
  for (const go of figureGates.values()) go();
  for (const l of livenesses) await l.stop();
  for (const s of servers) s.close();
  standServer.closeAllConnections();
  standServer.close();
  await pool.query(`
    drop trigger if exists test_slow_hold_fx145_insert on holds;
    drop function if exists test_slow_hold_fx145();
    drop table if exists test_slow_holds_fx145;
    drop trigger if exists test_slow_stop_fx145_update on holds;
    drop function if exists test_slow_stop_fx145();
    drop table if exists test_slow_stops_fx145;
  `);
  await pool.end();
  for (const d of journalDirs) await rm(d, { recursive: true, force: true });
});

describe("known gap 145: a streamed call read above its hold stops its project before the end marker reaches the caller (against a stand-in provider)", () => {
  it("gap 145: the arithmetic of these tests (the first model of the price table has the rates written above)", () => {
    expect(PRICES[MODEL]).toEqual({ input: 4, cache_write_5m: 5, cache_write_1h: 8, cache_read: 0.2, output: 20 });
  });

  it("gap 145 (1) the delayed stream ending: the provider ends its body 1.5 s after the end marker; the same project's next call, sent the moment the caller sees the marker, is refused with nothing forwarded and no counting call; the stop was written before the marker reached the caller; another project's call at that moment is forwarded; the settlement then freezes the project as in package 1.4c", async () => {
    const g = await gateway("gw_fx145_late");
    const p = await newProject(1);
    const q = await newProject(1);
    const res = await callAt(g.url, p.token, body(p.id, "fast-late", { stream: true }));
    expect(res.status).toBe(200);
    const { got, seenAt, reader } = await readToMarker(res);
    // The moment the caller sees the marker: the project's next call, another project's call, and a look at the
    // database, all started now, before anything is awaited.
    const nextP = callAt(g.url, p.token, body(p.id, "ok"));
    const nextQ = callAt(g.url, q.token, body(q.id, "ok"));
    const look = pool.query("select read_above_hold_usd::text as usd from holds where project_id = $1", [p.id]).then(
      (r) => r.rows,
      (e: Error) => ({ error: e.message }),
    );
    const rp = await nextP;
    const rpText = await rp.text();
    const rq = await nextQ;
    await rq.text();
    const s = streams.get(p.id)!;
    measured("(1)", {
      next_call_status: rp.status,
      calls_forwarded_for_the_project: forwardsOf(p.id),
      counting_calls_for_the_project: countsOf(p.id),
      stop_in_the_database_when_the_caller_saw_the_marker: await look,
      marker_written_by_the_provider_to_seen_by_the_caller_ms: ms(seenAt - s.markerSentAt),
      other_project_status: rq.status,
    });
    expect(got).toContain("message_stop");
    expect(rp.status).toBe(402);
    expect(forwardsOf(p.id)).toBe(1); // only the call above its hold
    expect(countsOf(p.id)).toBe(1); // the next call sent no counting call either
    const e = (JSON.parse(rpText) as { error: { type: string; message: string } }).error;
    expect(e.type).toBe("project_frozen");
    expect(e.message).toContain(stopWords(FAST_BILL_MICRO));
    expect(e.message).toContain("The gateway forwarded nothing, and no further call will be made for this project until that call's ending is recorded and the owner records what it cost.");
    // Written before the marker reached the caller: a look at the database started the moment the caller saw it finds it.
    expect(await look).toEqual([{ usd: "0.012284" }]);
    // The marker was not held back until the provider's body ended (1.5 s later).
    expect(seenAt - s.markerSentAt).toBeLessThan(500);
    // Another project is not stopped.
    expect(rq.status).toBe(200);
    expect(forwardsOf(q.id)).toBe(1);

    // The provider ends its body; the call is settled as in package 1.4c: charged in full, frozen with the bill.
    await drain(reader);
    expect(s.bodyEndAt! - s.markerSentAt).toBeGreaterThanOrEqual(LATE_MS - 10);
    await until("the project's freeze", async () => (await listEvents(pool, p.id, "project.frozen")).length === 1);
    const [h] = await listHolds(pool, p.id);
    expect(h).toMatchObject({ state: "settled", read_above_hold_usd: "0.012284" });
    expect(micro(Number(h!.actual_usd))).toBe(FAST_BILL_MICRO);
    const freezes = await listFreezes(pool, p.id);
    expect(freezes.map((f) => [f.kind, f.hold_id])).toEqual([["bill_above_hold", String(h!.id)]]);
    expect(g.faults.map((x) => x.message)).toEqual(["A settled call cost more than its hold."]);
    // The record: the stop, then the refusal of the next call, then the settlement and its freeze.
    const evs = (await listEvents(pool, p.id)).map((x) => [x.kind, x.payload] as const);
    expect(evs.map(([k]) => k)).toEqual(["hold.opened", "hold.read_above_hold", "gateway.refused", "model.call", "hold.settled", "hold.exceeded", "project.frozen"]);
    expect(evs[1]![1]).toMatchObject({ hold_id: Number(h!.id), amount_usd: HOLD_USD, cost_usd_as_read: FAST_BILL_MICRO / 1e6, above_by_usd: (FAST_BILL_MICRO - HOLD_MICRO) / 1e6, gateway: g.gatewayId });
    expect(evs[2]![1]).toMatchObject({ reason: "call_above_hold_in_flight", hold_id: Number(h!.id) });
    // From now on the freeze of package 1.4c refuses the project, with its own message.
    const after = await callAt(g.url, p.token, body(p.id, "ok"));
    expect(after.status).toBe(402);
    expect((await errorOf(after)).message).toBe(frozenMessage(freezes[0]!));
    // The owner records the bill: the project's next call is forwarded and settled (nothing of the stop is left).
    await recordOverrun(pool, { projectId: p.id, holdId: String(h!.id), evidence: EVIDENCE, ...WHO });
    const again = await callAt(g.url, p.token, body(p.id, "ok"));
    expect(again.status).toBe(200);
    await again.text();
    expect(forwardsOf(p.id)).toBe(2);
    expect(micro((await getBudget(pool, p.id)).spent)).toBe(FAST_BILL_MICRO + BILL_MICRO);
    expect(await rulesOf(p.id)).toEqual(ONE_BILL_ABOVE_ITS_HOLD);
    expect(await rulesOf(q.id)).toEqual([]);
  });

  it("gap 145 (2) concurrent calls: calls of the same project sent just before the figures arrive (their counting calls still out) and at the moment the marker is seen, through the same gateway and through a second gateway on the same database: none is forwarded after the gateway was handed the figures; another project's calls at that moment are forwarded", async () => {
    const g = await gateway("gw_fx145_c1");
    const g2 = await gateway("gw_fx145_c2");
    const p = await newProject(1);
    const q = await newProject(1);
    // The call that will go above its hold: the stand-in holds back its figures and its end marker.
    const ro = callAt(g.url, p.token, body(p.id, "fast-wait", { stream: true }));
    await until("the first call forwarded", () => forwardsOf(p.id) === 1 && figureGates.has(p.id));
    // Just before: two calls sent and answered before the figures come (forwarded, as calls before the overrun is read are).
    for (let i = 0; i < 2; i++) {
      const r = await callAt(g.url, p.token, body(p.id, "ok"));
      expect(r.status).toBe(200);
      await r.text();
    }
    // Just before, still inside a gateway: three calls through the same gateway (H) and two through the second (Z), each
    // with its counting call held by the stand-in.
    const h = [1, 2, 3].map(() => callAt(g.url, p.token, heldBody(p.id, "H")));
    const z = [1, 2].map(() => callAt(g2.url, p.token, heldBody(p.id, "Z")));
    await until("five counting calls held", () => heldCountsOf("H") === 3 && heldCountsOf("Z") === 2);
    // The figures and the end marker are sent; the H counting calls are answered at the same moment.
    figureGates.get(p.id)!();
    releaseCounts("H");
    const r0 = await ro;
    expect(r0.status).toBe(200);
    const { seenAt, reader } = await readToMarker(r0);
    // The moment the caller sees the marker: the Z counting calls are answered, and new calls are sent: three of the
    // project through the same gateway (M), two through the second (W), two of another project (Q).
    releaseCounts("Z");
    const m = [1, 2, 3].map(() => callAt(g.url, p.token, body(p.id, "ok")));
    const w = [1, 2].map(() => callAt(g2.url, p.token, body(p.id, "ok")));
    const qs = [1, 2].map(() => callAt(g.url, q.token, body(q.id, "ok")));
    const status = async (rs: Array<Promise<Response>>) => Promise.all(rs.map(async (x) => (await x).status));
    const [sh, sz, sm, sw, sq] = [await status(h), await status(z), await status(m), await status(w), await status(qs)];
    const handed = g.log.figuresHandedAt.get(p.id)!;
    const pForwards = [...g.log.forwards, ...g2.log.forwards].filter((f) => f.project === p.id);
    const after = pForwards.filter((f) => f.at >= handed);
    const refusedEv = (await listEvents(pool, p.id, "gateway.refused")).map((e) => e.payload);
    const releasedUnsent = (await listEvents(pool, p.id, "hold.settled")).map((e) => e.payload).filter((x) => x["forwarded"] === false);
    measured("(2)", {
      statuses: { H_same_gateway_held_counts: sh, Z_second_gateway_held_counts: sz, M_same_gateway_at_marker: sm, W_second_gateway_at_marker: sw, Q_other_project_at_marker: sq },
      calls_forwarded_for_the_project: forwardsOf(p.id),
      forwards_after_the_figures_were_handed_to_the_gateway: after.map((f) => ({ test: f.test, after_ms: ms(f.at - handed) })),
      last_forward_before_the_figures_ms: ms(handed - Math.max(...pForwards.map((f) => f.at))),
      figures_handed_to_marker_seen_ms: ms(seenAt - handed),
      counting_calls_for_the_project: countsOf(p.id),
      refused_before_the_counting_call: refusedEv.filter((x) => x["this_hold_usd"] === undefined && x["reason"] === "call_above_hold_in_flight").length,
      refused_under_the_project_lock: refusedEv.filter((x) => x["this_hold_usd"] !== undefined && x["reason"] === "call_above_hold_in_flight").length,
      hold_opened_then_not_forwarded: releasedUnsent.length,
    });
    expect([...sh, ...sz, ...sm, ...sw]).toEqual(Array(10).fill(402));
    expect(sq).toEqual([200, 200]);
    // Forwarded: the call above its hold and the two sent and answered before; none after the figures were handed over.
    expect(forwardsOf(p.id)).toBe(3);
    expect(after).toEqual([]);
    expect(pForwards.map((f) => f.test).sort()).toEqual(["fast-wait", "ok", "ok"]);
    // The calls sent at the marker sent no counting call: 1 + 2 + 5 counting calls in all.
    expect(countsOf(p.id)).toBe(8);
    expect(forwardsOf(q.id)).toBe(2);
    // The five held calls were stopped at the project's lock or just before their forward, the five sent at the marker
    // before their counting call; every refusal names the stop.
    expect(refusedEv.filter((x) => x["reason"] === "call_above_hold_in_flight").length + releasedUnsent.length).toBe(10);
    for (const x of releasedUnsent) expect(String(x["reason"])).toContain("read usage figures above its hold");
    // The Z calls, through a gateway that never read the figures, were refused under the project's lock.
    expect(refusedEv.filter((x) => x["this_hold_usd"] !== undefined && x["reason"] === "call_above_hold_in_flight").length).toBeGreaterThanOrEqual(2);
    // Then the provider ends its body; the call is settled and the project frozen as in package 1.4c.
    await drain(reader);
    await until("the project's freeze", async () => (await listEvents(pool, p.id, "project.frozen")).length === 1);
    expect((await listFreezes(pool, p.id)).map((f) => f.kind)).toEqual(["bill_above_hold"]);
    expect(micro((await getBudget(pool, p.id)).spent)).toBe(FAST_BILL_MICRO + 2 * BILL_MICRO);
    expect(micro((await getBudget(pool, p.id)).openHolds)).toBe(0);
    expect(await rulesOf(p.id)).toEqual(ONE_BILL_ABOVE_ITS_HOLD);
  });

  it("gap 145 (3) a call whose hold was opened before the stop was written, and which reaches its forward after the figures were read, is not forwarded: the gateway's own check just before it forwards stops it, and its hold is given back as never sent", async () => {
    const g = await gateway("gw_fx145_mem");
    const p = await newProject(1);
    const ro = callAt(g.url, p.token, body(p.id, "fast-wait", { stream: true }));
    await until("the first call forwarded", () => forwardsOf(p.id) === 1 && figureGates.has(p.id));
    // The next call's hold is opened slowly (0.8 s inside the project's lock), so the figures arrive while it waits.
    await slowHolds.on(p.id);
    let x: Response | null = null;
    try {
      const rx = callAt(g.url, p.token, body(p.id, "ok"));
      await until(
        "the second call's hold insert under way",
        async () => (await pool.query("select 1 from pg_stat_activity where datname = current_database() and state = 'active' and query like 'insert into holds%'")).rowCount === 1,
      );
      figureGates.get(p.id)!();
      const r0 = await ro;
      const { reader } = await readToMarker(r0);
      x = await rx;
      measured("(3)", { second_call_status: x.status, calls_forwarded_for_the_project: forwardsOf(p.id) });
      expect(x.status).toBe(402);
      expect(forwardsOf(p.id)).toBe(1);
      await drain(reader);
    } finally {
      await slowHolds.off();
    }
    expect((await errorOf(x!)).message).toContain(stopWords(FAST_BILL_MICRO));
    const evs = await listEvents(pool, p.id);
    const opened = evs.filter((e) => e.kind === "hold.opened");
    const stop = evs.find((e) => e.kind === "hold.read_above_hold")!;
    // Its hold was opened before the stop was written: the check under the lock could not see it.
    expect(Number(opened[1]!.id)).toBeLessThan(Number(stop.id));
    const released = evs.filter((e) => e.kind === "hold.settled" && e.payload["hold_id"] === opened[1]!.payload["hold_id"]).map((e) => e.payload);
    expect(released).toEqual([expect.objectContaining({ forwarded: false, actual_usd: 0, reason: expect.stringContaining("read usage figures above its hold") })]);
    await until("the project's freeze", async () => (await listEvents(pool, p.id, "project.frozen")).length === 1);
    expect(await rulesOf(p.id)).toEqual(ONE_BILL_ABOVE_ITS_HOLD);
  });

  it("gap 145 (4) control: a stream with no overrun is not held back: its end marker reaches the caller before the provider's body ends, nothing is written on its hold, and the same project's next call, sent at that moment, is forwarded", async () => {
    const g = await gateway("gw_fx145_ok");
    const p = await newProject(1);
    const res = await callAt(g.url, p.token, body(p.id, "ok-late", { stream: true }));
    const { seenAt, reader } = await readToMarker(res);
    const next = callAt(g.url, p.token, body(p.id, "ok"));
    const rn = await next;
    await rn.text();
    const s = streams.get(p.id)!;
    measured("(4) control", { next_call_status: rn.status, marker_written_by_the_provider_to_seen_by_the_caller_ms: ms(seenAt - s.markerSentAt), body_still_open: s.bodyEndAt === null });
    expect(rn.status).toBe(200);
    expect(forwardsOf(p.id)).toBe(2);
    expect(seenAt - s.markerSentAt).toBeLessThan(500);
    expect(s.bodyEndAt).toBeNull(); // the provider's body was still open when the caller saw the marker
    await drain(reader);
    await until("both settled", async () => (await listEvents(pool, p.id, "hold.settled")).length === 2);
    const hs = await listHolds(pool, p.id);
    for (const h of hs) expect((h as unknown as { read_above_hold_usd?: unknown }).read_above_hold_usd ?? null).toBeNull();
    expect((await listEvents(pool, p.id)).map((e) => e.kind)).not.toContain("hold.read_above_hold");
    expect(micro((await getBudget(pool, p.id)).spent)).toBe(2 * BILL_MICRO);
    expect(await activeFreeze(pool, p.id)).toBeNull();
    expect(await rulesOf(p.id)).toEqual([]);
  });

  it("gap 145 (5) a call above its hold only at the rate it is settled at (cache writes not split by lifetime, at the one-hour rate; $0.010922 against $0.009960, while the five-minute rate gives $0.009122) is stopped before its marker reaches the caller too", async () => {
    const g = await gateway("gw_fx145_1h");
    const p = await newProject(1);
    const res = await callAt(g.url, p.token, cache1hBody(p.id));
    expect(res.status).toBe(200);
    const { reader } = await readToMarker(res);
    const rn = await callAt(g.url, p.token, body(p.id, "ok"));
    const text = await rn.text();
    measured("(5)", { next_call_status: rn.status, calls_forwarded_for_the_project: forwardsOf(p.id) });
    expect(rn.status).toBe(402);
    expect(forwardsOf(p.id)).toBe(1);
    expect(text).toContain(stopWords(CACHE1H_BILL_MICRO));
    await drain(reader);
    await until("the project's freeze", async () => (await listEvents(pool, p.id, "project.frozen")).length === 1);
    const [h] = await listHolds(pool, p.id);
    expect(h).toMatchObject({ state: "settled", read_above_hold_usd: "0.010922" });
    expect(micro(Number(h!.actual_usd))).toBe(CACHE1H_BILL_MICRO);
    expect((await listFreezes(pool, p.id)).map((f) => f.kind)).toEqual(["bill_above_hold"]);
  });

  it("gap 145 (6) the stop outlives its gateway: a hold read above its amount whose gateway is gone is kept by the next gateway's start, which freezes the project (kind 'kept_above_hold', with the cost as read); the owner's reconciliation of the hold clears it", async () => {
    const p = await newProject(1);
    const opened = await openHold(pool, { projectId: p.id, step: null, amountUsd: HOLD_USD, deadline: new Date(Date.now() + 600_000), gateway: uniqueId("gw_fx145_gone"), arithmetic: { model: MODEL }, path: "/v1/messages" });
    if (!opened.ok) throw new Error(`hold not opened: ${opened.reason}`);
    const holdId = opened.hold.id;
    const marked = await holds.markReadAboveHold(pool, { projectId: p.id, holdId, step: null, costUsd: FAST_BILL_MICRO / 1e6, gateway: "gw_fx145_gone", usage: { ...USAGE, speed: "fast" } });
    expect(marked).toMatchObject({ marked: true });
    // While the gateway is not known to be gone, the stop refuses the project under its lock.
    const refused = await openHold(pool, { projectId: p.id, step: null, amountUsd: HOLD_USD, deadline: new Date(Date.now() + 600_000), gateway: "gw_fx145_other", arithmetic: { model: MODEL }, path: "/v1/messages" });
    expect(refused).toMatchObject({ ok: false, reason: "call_above_hold_in_flight" });
    // Another gateway starts: the hold's gateway is gone (nobody holds its liveness lock).
    await recoverHolds(pool, uniqueId("gw_fx145_next"));
    const [h] = await listHolds(pool, p.id);
    expect(h).toMatchObject({ state: "open", unreconciled: true, kept_reason: holds.OWNER_GONE, read_above_hold_usd: "0.012284" });
    const f = (await activeFreeze(pool, p.id))!;
    expect(f).toMatchObject({ kind: "kept_above_hold", hold_id: String(holdId), reason: KEPT_ABOVE_HOLD_REASON });
    expect(micro(Number(f.bill_usd))).toBe(FAST_BILL_MICRO);
    expect(f.record).toMatchObject({ kept_reason: holds.OWNER_GONE, cost_usd_as_read: FAST_BILL_MICRO / 1e6 });
    // The owner reconciles the hold: the freeze is cleared and nothing of the stop is left.
    const r = await reconcileHold(pool, { projectId: p.id, holdId: String(holdId), actualUsd: FAST_BILL_MICRO / 1e6, evidence: EVIDENCE, ...WHO });
    expect(r).toMatchObject({ freezesCleared: [f.id], projectStillFrozen: false });
    const next = await openHold(pool, { projectId: p.id, step: null, amountUsd: HOLD_USD, deadline: new Date(Date.now() + 600_000), gateway: "gw_fx145_other", arithmetic: { model: MODEL }, path: "/v1/messages" });
    expect(next.ok).toBe(true);
  });

  it("gap 145 (7) the database refuses a stop that is not above its hold, is not a number, or has only one of its two fields", async () => {
    const p = await newProject(1);
    const opened = await openHold(pool, { projectId: p.id, step: null, amountUsd: HOLD_USD, deadline: new Date(Date.now() + 600_000), gateway: "gw_fx145_store", arithmetic: { model: MODEL }, path: "/v1/messages" });
    if (!opened.ok) throw new Error("hold not opened");
    for (const [usd, at] of [
      ["0.009960", "now()"], // equal to the hold
      ["0.009959", "now()"], // below it
      ["NaN", "now()"],
      ["0.012284", "null"],
      [null, "now()"],
    ] as const) {
      const err = await pool.query(`update holds set read_above_hold_usd = $2, read_above_hold_at = ${at} where id = $1`, [opened.hold.id, usd]).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, `${usd} ${at}`).toMatchObject({ code: "23514", constraint: "holds_read_above_hold" });
    }
  });

  it("gap 145 (8) the end marker waits for the stop's write: with that write made slow (0.5 s, by a test-only trigger), the marker reaches the caller only after it; while it is being written, the same gateway refuses the project's call and passed-through request before anything goes to the provider; once written, a second gateway refuses the project's call before its counting call", async () => {
    const g = await gateway("gw_fx145_slow1");
    const g2 = await gateway("gw_fx145_slow2");
    const p = await newProject(1);
    await slowStops.on(p.id);
    try {
      const res = await callAt(g.url, p.token, body(p.id, "fast-late", { stream: true }));
      expect(res.status).toBe(200);
      const reading = readToMarker(res);
      await until("the stop being written", () => running("update holds set read_above_hold_usd"));
      // The figures were read and the stop is being written: a call and a passed-through request through the same gateway.
      // Both sent at once; each refusal is decided before anything goes to the provider (no counting call, no forward).
      // Writing its gateway.refused event then waits for the project's row, which the stop's transaction holds.
      const duringAt = performance.now();
      const [during, passed] = await Promise.all([
        callAt(g.url, p.token, body(p.id, "ok")),
        fetch(g.url + "/v1/messages/count_tokens", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": p.token, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: `for ${p.id}` }] }),
        }),
      ]);
      const answeredAt = performance.now();
      const { seenAt, reader } = await reading;
      const atMarker = await callAt(g2.url, p.token, body(p.id, "ok"));
      const s = streams.get(p.id)!;
      measured("(8)", {
        call_during_the_write_status: during.status,
        passed_through_request_during_the_write_status: passed.status,
        second_gateway_call_at_the_marker_status: atMarker.status,
        counting_calls_for_the_project: countsOf(p.id),
        marker_written_by_the_provider_to_seen_by_the_caller_ms: ms(seenAt - s.markerSentAt),
        both_sent_ms_after_the_marker_was_written: ms(duringAt - s.markerSentAt),
        both_answered_ms_after_the_marker_was_written: ms(answeredAt - s.markerSentAt),
      });
      expect([during.status, passed.status, atMarker.status]).toEqual([402, 402, 402]);
      // Sent well inside the stop's 0.5 s write, which began after the marker was written.
      expect(duringAt - s.markerSentAt).toBeLessThan(400);
      expect(countsOf(p.id)).toBe(1); // only the first call's counting call: none of the three reached the provider
      expect(forwardsOf(p.id)).toBe(1);
      expect((await errorOf(atMarker)).message).toContain(stopWords(FAST_BILL_MICRO));
      // The marker reached the caller only after the slow write (0.5 s), not as soon as the provider sent it.
      expect(seenAt - s.markerSentAt).toBeGreaterThanOrEqual(450);
      expect(seenAt - s.markerSentAt).toBeLessThan(LATE_MS);
      await drain(reader);
    } finally {
      await slowStops.off();
    }
    await until("the project's freeze", async () => (await listEvents(pool, p.id, "project.frozen")).length === 1);
    expect((await listFreezes(pool, p.id)).map((f) => f.kind)).toEqual(["bill_above_hold"]);
    expect(await rulesOf(p.id)).toEqual(ONE_BILL_ABOVE_ITS_HOLD);
  });

  it("gap 145 (9) a stop whose call then ends with figures that can no longer be trusted (a figure falls) freezes nothing, as in package 1.4c, and once that ending is recorded the project's next call is forwarded", async () => {
    const g = await gateway("gw_fx145_fall");
    const p = await newProject(1);
    const res = await callAt(g.url, p.token, body(p.id, "fast-fallsplit", { stream: true }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("message_stop");
    await until("the hold kept", async () => (await listEvents(pool, p.id, "hold.kept")).length === 1);
    const [h] = await listHolds(pool, p.id);
    expect(h).toMatchObject({ state: "open", kept_reason: "the stream ended without usage figures that could be read" });
    expect(await stopOn(h!.id)).toMatchObject({ usd: "0.012284" });
    expect(await listFreezes(pool, p.id)).toEqual([]);
    const next = await callAt(g.url, p.token, body(p.id, "ok"));
    expect(next.status).toBe(200);
    await next.text();
    expect(forwardsOf(p.id)).toBe(2);
  });
});
