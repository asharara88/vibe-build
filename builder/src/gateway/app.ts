/**
 * The model gateway: the only route to the model.
 *
 * - Holds the real model key. The engine's container holds a project token instead.
 * - Forwards only the two paths the engine needs; every other path is refused and logged.
 * - Before forwarding a metered call it works out a hold for it (a reservation from the provider's
 *   token estimate plus an assumed margin, not a proven ceiling on the bill; see hold.ts) and
 *   checks the budget equation in one locked database transaction:
 *       spent + open holds + this call's hold <= cap.
 *   If it does not fit, nothing is forwarded.
 * - A hold is settled in three cases only: the call ended with usage figures that could be read
 *   and trusted (settled to the actual cost); the provider's own error says it turned the
 *   request away before doing any work (settled at nothing); or the caller left before the call
 *   was forwarded (settled at nothing; only the counting call had been sent). Any other ending
 *   keeps the hold open at its full amount: money is not released on a guess.
 * - Refuses what a hold cannot bound: a prompt that cannot be counted, a model with no price,
 *   more output than the profile allows, routing or tools that are billed outside the token rates.
 *
 * - Since package 1.4: a call whose ending cannot be written closes this gateway's gate at once (it then
 *   forwards nothing for any project) until the ending is recorded, with the project frozen
 *   (gateway/journal.ts, store/freezes.ts); a frozen project gets nothing forwarded, not even its counting
 *   call; a gateway that has lost its liveness lock forwards nothing; a database that cannot be reached
 *   gets a 503 with the reason, not a bare 500.
 *
 * Design note: docs/design/stage-1.md, sections 2.4 and 5.5. Build plan: packages 1.2 and 1.4.
 */
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type pg from "pg";
import { appendEvent } from "../store/events.js";
import { activeFreeze, frozenMessage, type UnrecordedEnding } from "../store/freezes.js";
import { expireHolds, keepHold, openHold, recoverHolds, releaseUnsentHold, settleHold } from "../store/holds.js";
import { tokenOwner, type Project } from "../store/projects.js";
import { costUsd, emptyUsage, itemisedCacheWrites, mergeUsage, statesSpeed, USAGE_COUNTS, usageAsPriced, usageIsReadable, type ProviderUsage, type Usage } from "./cost.js";
import { betasNotAllowed, computeHold, countRequestBody, DEFAULT_PROFILES, guardRequest, mayAskForOneHourCache, type MeteredRequest, type ProfileLimits } from "./hold.js";
import { FaultGate, newJournalId, type FaultJournal } from "./journal.js";
import { spellsKey } from "./key-reader.js";
import { PRICE_TABLE_DATE, PRICES } from "./prices.js";

export interface GatewayOptions {
  pool: pg.Pool;
  /** The real model key. The gateway's aim is that it is not logged and not returned; what is and is not covered is in the evidence file for package 1.2. */
  modelApiKey: string;
  /** Where to forward. Default: Anthropic. Tests point this at a stand-in. */
  upstreamUrl?: string;
  /** Models this gateway may forward. Default: every model in the price table. Must be a subset of it. */
  allowedModels?: string[];
  fetchImpl?: typeof fetch;
  /** Called when something that should never happen happens (for example the event log is unreachable). */
  onFault?: (message: string, detail: unknown) => void;
  /** What each project profile allows. Default: DEFAULT_PROFILES. */
  profiles?: Record<string, ProfileLimits>;
  /** A name for this gateway process, written on every hold it opens. Default: a random one. */
  gatewayId?: string;
  /** How long a call may run before the gateway cuts it off, in milliseconds. */
  callTimeLimitMs?: { plain: number; stream: number };
  /** Added to the time limit to give a hold its deadline, in milliseconds. */
  holdDeadlineMarginMs?: { plain: number; stream: number };
  /** Values of the `anthropic-beta` header the gateway forwards. Default: none. */
  allowedBetas?: string[];
  /**
   * The gate closed while a call's ending is unrecorded (package 1.4). Default: one of its own, writing to
   * `journal` if given, else keeping its records in memory only.
   */
  gate?: FaultGate;
  /** Where the gate's own default keeps unrecorded endings on disk (package 1.4). Ignored when `gate` is given. */
  journal?: FaultJournal | null;
  /** Whether this gateway still holds its liveness lock (store/liveness.ts). Without it, it forwards nothing. Default: not checked. */
  liveness?: { ok(): boolean };
}

/**
 * The provider's own error types for a request it turned away before doing any work, with the
 * status each comes with. Only such an answer, in the provider's own error shape, settles a
 * hold at nothing. Any other error keeps the hold: a status code alone is not proof.
 */
const REJECTED_BEFORE_WORK: Record<number, string[]> = {
  400: ["invalid_request_error"],
  401: ["authentication_error"],
  403: ["permission_error"],
  404: ["not_found_error"],
  413: ["request_too_large"],
  429: ["rate_limit_error"],
};
function rejectedBeforeWork(status: number, text: string): boolean {
  const types = REJECTED_BEFORE_WORK[status];
  if (!types) return false;
  try {
    const j = JSON.parse(text) as { type?: unknown; error?: { type?: unknown } };
    return j.type === "error" && typeof j.error?.type === "string" && types.includes(j.error.type);
  } catch {
    return false;
  }
}

/**
 * Error codes that mean the request was never sent, because no connection to the provider was
 * made: the name lookup failed (ENOTFOUND), the connection was refused (ECONNREFUSED), or Node's
 * fetch gave up while connecting (UND_ERR_CONNECT_TIMEOUT). A request's bytes can only be written
 * on a connection that exists. Any other failure of the forward, including a socket closed or
 * reset, a timeout waiting for the answer, an error with no code, or a code not on this list,
 * counts as "the request may have been sent". Sources: Node's list of common system errors and
 * undici's list of its own errors (docs/SOURCES.md, 13 Nov 2026); the first two measured in
 * evidence/2026-11-12-package-1.2/run-2026-11-13-fetch-error-codes.txt.
 */
const NOTHING_SENT = new Set(["ENOTFOUND", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const failedBeforeSending = (err: unknown): boolean => {
  const code = errorSummary(err).code;
  return typeof code === "string" && NOTHING_SENT.has(code);
};

/** Deeper than any answer the provider documents; when a body has to be cleaned and written out again, a value nested further is cut off, not walked. */
const MAX_DEPTH = 200;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
/** An answer body longer than this is not searched: it is withheld, and on a metered call its hold is kept. */
const MAX_BODY_CHARS = 8_000_000;
const WITHHELD_BODY = JSON.stringify({ type: "error", error: { type: "api_error", message: "The gateway withheld the provider's answer body: it could not be checked." } });
/** Why a call whose hold allowed for fast mode is not settled when its usage leaves the speed out. */
const SPEED_NOT_STATED = "the hold allowed for fast mode, and the usage does not state the speed that served the call";
const MINUTE = 60_000;
/**
 * The gateway's own time limits for a call. As built, a plain call does not reach its 10 minutes:
 * Node's fetch, which forwards it with its default settings, gives up after 300 seconds without the
 * answer's headers (undici's headersTimeout) and after 300 seconds between pieces of the body
 * (bodyTimeout). A streamed call is cut by the same 300 seconds if its headers or the next piece of
 * it do not come, and by the 60 minutes here overall. Known gap 63; docs/SOURCES.md, 13 Nov 2026.
 */
const DEFAULT_TIME_LIMIT = { plain: 10 * MINUTE, stream: 60 * MINUTE };
/** Design note 5.5, step 4: ten minutes for a plain call, thirty for a streamed one. */
const DEFAULT_DEADLINE_MARGIN = { plain: 10 * MINUTE, stream: 30 * MINUTE };

/** The only paths forwarded. Everything else under /v1 is refused. */
const METERED_PATH = "/v1/messages";
const PASSTHROUGH_PATHS = new Set(["/v1/messages/count_tokens"]);

const STRIP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "x-api-key", "authorization"]);
/** The request headers the gateway passes to the provider. `anthropic-beta` is checked against its own list first. */
const FORWARDED_HEADERS = ["content-type", "accept", "anthropic-version", "anthropic-beta", "user-agent"];

/** An amount in dollars shown to the cent, rounded up or down. Worked in millionths of a dollar, as the budget is. */
const centsUp = (usd: number): string => (Math.ceil(Math.round(usd * 1e6) / 10_000) / 100).toFixed(2);
const centsDown = (usd: number): string => (Math.floor(Math.round(usd * 1e6) / 10_000) / 100).toFixed(2);

type ErrorBody = { type: "error"; error: { type: string; message: string } };
const errorBody = (type: string, message: string): ErrorBody => ({ type: "error", error: { type, message } });

export function createGateway(opts: GatewayOptions) {
  const upstream = (opts.upstreamUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const allowed = new Set(opts.allowedModels ?? Object.keys(PRICES));
  for (const m of allowed) if (!Object.hasOwn(PRICES, m)) throw new Error(`Model "${m}" has no price in the price table and cannot be allowed.`);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const fault = opts.onFault ?? ((m: string, d: unknown) => console.error(`[gateway fault] ${m}`, d));
  const profiles = opts.profiles ?? DEFAULT_PROFILES;
  const gatewayId = opts.gatewayId ?? `gw_${randomBytes(6).toString("hex")}`;
  const timeLimit = opts.callTimeLimitMs ?? DEFAULT_TIME_LIMIT;
  const deadlineMargin = opts.holdDeadlineMarginMs ?? DEFAULT_DEADLINE_MARGIN;
  const allowedBetas = new Set(opts.allowedBetas ?? []);
  const key = opts.modelApiKey;
  const gate = opts.gate ?? new FaultGate({ pool: opts.pool, journal: opts.journal ?? null, onFault: fault });
  /** Whether the key can be read out of a text, by the rules set out in key-reader.ts. */
  const carriesKey = (text: string): boolean => spellsKey(text, key);
  /**
   * One text inside a parsed value. The plain spelling of the key is cut out; a text out of
   * which the key can still be read, as it will be written into JSON, is replaced whole.
   */
  const redact = (text: string): string => {
    if (!key) return text;
    const cut = text.includes(key) ? text.split(key).join("[redacted]") : text;
    return carriesKey(JSON.stringify(cut)) ? "[redacted]" : cut;
  };
  /**
   * The same, for anything about to be stored or passed back: every string inside a parsed
   * value, keys included. A value nested deeper than any real answer is cut off there.
   */
  const scrub = (value: unknown, depth = 0): unknown => {
    if (typeof value === "string") return redact(value);
    if (depth > MAX_DEPTH) return "[nested too deeply to keep]";
    if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [redact(k), scrub(v, depth + 1)]));
    return value;
  };
  /**
   * A whole answer body about to go back to the caller. If the key cannot be read out of it,
   * the text the gateway read goes back as it is. If it can, the body is cleaned where that is
   * possible (a JSON body is parsed, each text in it cleaned, and written out again; any other
   * body has the plain spelling cut out), searched again, and withheld if the key is still there.
   * A body too long to search is withheld.
   */
  const safeBody = (raw: string): string => {
    if (!key) return raw;
    if (raw.length > MAX_BODY_CHARS) return WITHHELD_BODY;
    if (!carriesKey(raw)) return raw;
    let out: string;
    try {
      out = JSON.stringify(scrub(JSON.parse(raw)));
    } catch {
      // Not JSON (or, in principle, a JSON value that cannot be written out again).
      out = raw.split(key).join("[redacted]");
    }
    return carriesKey(out) ? WITHHELD_BODY : out;
  };
  /**
   * What is about to be written to the event log: cleaned, with any NUL character (which the
   * database's JSON type refuses) made visible, and then judged as the text that will be stored.
   * If the key is still found in that text, only the fallback is stored.
   */
  const storable = (fields: Record<string, unknown>, fallback: Record<string, unknown>): Record<string, unknown> => {
    // The database's JSON type refuses a NUL character and half of a surrogate pair on its own.
    const noNul = (v: unknown, depth = 0): unknown => {
      if (typeof v === "string") return (v.includes("\u0000") ? v.split("\u0000").join("[NUL]") : v).replace(LONE_SURROGATE, "\ufffd");
      if (depth > MAX_DEPTH + 2) return v;
      if (Array.isArray(v)) return v.map((x) => noNul(x, depth + 1));
      if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [noNul(k) as string, noNul(x, depth + 1)]));
      return v;
    };
    const cleaned = noNul(scrub(fields)) as Record<string, unknown>;
    return carriesKey(JSON.stringify(cleaned)) ? { ...fallback, withheld: "the rest of this record carried the model key and was not stored" } : cleaned;
  };
  /** Response headers passed back to the caller: not one out of whose name or value the key can be read, in any letter case. */
  const safeHeaders = (h: Headers): Headers => {
    const out = copyHeaders(h);
    const lower = key.toLowerCase();
    for (const [k, v] of [...out.entries()]) if (key && (v.toLowerCase().includes(lower) || k.toLowerCase().includes(lower) || carriesKey(v) || carriesKey(k))) out.delete(k);
    return out;
  };
  const app = new Hono();

  // A database that cannot be reached, or refuses a read or a write, gets a 503 with the reason, not the
  // web framework's bare 500; only a fixed summary of the error is kept, never its text (package 1.4).
  app.onError((err, c) => {
    fault("The gateway could not use its database for a request; the request was stopped.", { path: c.req.path, error: errorSummary(err) });
    return c.json(errorBody("gateway_unavailable", "The gateway could not use its database, so it stopped this request. If a model call was under way, its hold stays open at its full amount."), 503);
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  // Package 1.4: the two refusals of a gateway that must forward nothing, on arrival and again just before
  // a metered call is forwarded (`sent` says what, if anything, reached the provider).
  const livenessLost = (sent: string) =>
    errorBody("gateway_unavailable", `This gateway has lost the database connection that shows it is running, so it forwards nothing until that connection is back. ${sent}`);
  const gateClosed = (sent: string) =>
    errorBody(
      "gateway_unrecorded",
      `This gateway has stopped forwarding: a model call that ended at ${gate.oldest()?.ended_at ?? "an unknown time"} could not be recorded in the event log, and until it is, the gateway forwards nothing for any project. ${sent}`,
    );

  app.all("/v1/*", async (c) => {
    // Package 1.4. These two refusals come before anything else, and write nothing to the database.
    if (opts.liveness && !opts.liveness.ok()) return c.json(livenessLost("Nothing was forwarded."), 503);
    // The gate: closed while a call's ending is unrecorded. It tries to record it first.
    if (gate.closed()) await gate.drain();
    if (gate.closed()) return c.json(gateClosed("Nothing was forwarded."), 503);
    const token = c.req.header("x-api-key") ?? bearer(c.req.header("authorization"));
    if (!token) return c.json(errorBody("authentication_error", "No project token was sent. The engine must send its project token as the API key."), 401);
    const owner = await tokenOwner(opts.pool, token);
    if (!owner) return c.json(errorBody("authentication_error", "This project token is not recognised or has been revoked."), 401);
    const project: Project = owner.project;

    // A step's token (package 1.3) names its step: the label comes from the step hold, never from the
    // caller. A step header that says otherwise is refused. Calls made without a step's token are still
    // labelled by the header the caller sends, which nothing checks (known gap 18).
    const stepHold = owner.stepHold;
    const stepHeader = c.req.header("x-builder-step") ?? null;
    const step = stepHold ? stepHold.stepId : stepHeader;
    if (stepHold && stepHeader !== null && stepHeader !== stepHold.stepId) {
      await appendEvent(opts.pool, project.id, "gateway.refused", { reason: "step_label_differs", path: normalisePath(new URL(c.req.url).pathname), step_hold_id: Number(stepHold.id) }, step);
      return c.json(errorBody("invalid_request_error", "The step named in the x-builder-step header is not the step this token was issued for. The gateway forwarded nothing."), 400);
    }
    const url = new URL(c.req.url);
    const path = normalisePath(url.pathname);
    const metered = path === METERED_PATH;
    const passthrough = PASSTHROUGH_PATHS.has(path);

    if (!metered && !passthrough) {
      await appendEvent(opts.pool, project.id, "gateway.refused", { reason: "path_not_allowed", path: url.pathname }, step);
      return c.json(errorBody("invalid_request_error", `The gateway forwards only ${METERED_PATH} and ${[...PASSTHROUGH_PATHS].join(", ")}. "${url.pathname}" is not forwarded.`), 403);
    }
    if (c.req.method !== "POST") {
      await appendEvent(opts.pool, project.id, "gateway.refused", { reason: "method_not_allowed", method: c.req.method, path }, step);
      return c.json(errorBody("invalid_request_error", "Only POST requests are forwarded."), 405);
    }

    const rawBody = await c.req.text();
    let body: MeteredRequest = {};
    try {
      const parsed: unknown = rawBody ? JSON.parse(rawBody) : {};
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as MeteredRequest;
    } catch {
      return c.json(errorBody("invalid_request_error", "The request body is not a JSON object."), 400);
    }
    const requestedModel = typeof body.model === "string" ? body.model : "";
    if (!allowed.has(requestedModel)) {
      await appendEvent(opts.pool, project.id, "gateway.refused", { reason: "model_not_allowed", model: requestedModel, path }, step);
      return c.json(errorBody("invalid_request_error", `The model "${requestedModel}" is not one the gateway may forward.`), 400);
    }

    // Only these request headers go to the provider; everything else the caller sent stays here.
    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const v = c.req.header(name);
      if (v !== undefined) headers.set(name, v);
    }
    headers.set("x-api-key", opts.modelApiKey);
    // The names (never the values) of what the caller sent and the gateway did not pass on, for the log.
    const droppedHeaders = [...c.req.raw.headers.keys()]
      .map((k) => k.toLowerCase())
      .map((k) => (opts.modelApiKey && k.includes(opts.modelApiKey.toLowerCase()) ? "[redacted]" : k))
      .filter((k) => !FORWARDED_HEADERS.includes(k) && !STRIP.has(k) && k !== "x-builder-step")
      .slice(0, 30);
    if (url.search) {
      await appendEvent(opts.pool, project.id, "gateway.refused", { reason: "query_not_allowed", path }, step);
      return c.json(errorBody("invalid_request_error", "The gateway does not forward anything after a \"?\" in the address: it could switch on options the gateway has not checked."), 400);
    }
    // What is forwarded is the body as the gateway read it, written out again, never the raw
    // bytes: a body with a repeated key cannot show one value to the gateway and another to the provider.
    const forwardedBody = metered ? JSON.stringify(body) : rawBody;
    const forward = (signal?: AbortSignal) => fetchImpl(upstream + path, { method: "POST", headers, body: forwardedBody, redirect: "manual", signal });

    const badBetas = betasNotAllowed(c.req.header("anthropic-beta"), allowedBetas);
    if (badBetas.length > 0) {
      await appendEvent(opts.pool, project.id, "gateway.refused", { reason: "beta_not_allowed", path, model: requestedModel, betas: badBetas.slice(0, 20) }, step);
      return c.json(errorBody("invalid_request_error", `The request switches on beta features the gateway does not forward (${badBetas.slice(0, 5).join(", ")}). A beta feature can change what a call costs.`), 400);
    }

    // A frozen project (package 1.4) gets nothing forwarded, not even the counting call. The check under
    // the project's lock in openHold is the one that decides; this one keeps the counting call from going.
    const frozen = await activeFreeze(opts.pool, project.id);
    if (frozen) {
      await appendEvent(opts.pool, project.id, "gateway.refused", { reason: "project_frozen", freeze_id: Number(frozen.id), journal_id: frozen.journal_id, path }, step);
      return c.json(errorBody("project_frozen", frozenMessage(frozen)), 402);
    }

    if (passthrough) {
      let res: Response;
      try {
        res = await forward();
      } catch (err) {
        await appendEvent(opts.pool, project.id, "gateway.error", { path, error: errorSummary(err) }, step);
        return c.json(errorBody("api_error", "The gateway could not reach the model provider."), 502);
      }
      await appendEvent(opts.pool, project.id, "gateway.passthrough", storable({ path, status: res.status, ...(droppedHeaders.length ? { headers_not_forwarded: droppedHeaders } : {}) }, { path, status: res.status }), step);
      return new Response(safeBody(await res.text().catch(() => "")), { status: res.status, headers: safeHeaders(res.headers) });
    }

    // Metered. 1: refuse what a hold cannot bound.
    const stream = body.stream === true;
    const started = Date.now();
    const refuse = async (status: 400 | 402 | 502, type: string, reason: string, message: string, detail: Record<string, unknown> = {}) => {
      await appendEvent(opts.pool, project.id, "gateway.refused", { reason, path, model: requestedModel, ...detail }, step);
      return c.json(errorBody(type, message), status);
    };
    const profile = Object.hasOwn(profiles, project.profile) ? profiles[project.profile] : undefined;
    if (!profile) return refuse(400, "invalid_request_error", "profile_unknown", `This project's profile "${project.profile}" has no limits set in the gateway.`, { profile: project.profile });
    const guard = guardRequest(body, profile);
    if (guard) return refuse(400, "invalid_request_error", guard.reason, guard.message, guard.detail);

    // 2: count the prompt with the provider's own counting call. No count, no call.
    let counted: number;
    try {
      const countHeaders = new Headers(headers);
      countHeaders.set("content-type", "application/json");
      const cr = await fetchImpl(upstream + "/v1/messages/count_tokens", {
        method: "POST",
        headers: countHeaders,
        body: JSON.stringify(countRequestBody(body)),
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      });
      const cj = cr.ok ? ((await cr.json()) as { input_tokens?: unknown }) : null;
      if (!cj || typeof cj.input_tokens !== "number" || !Number.isFinite(cj.input_tokens) || cj.input_tokens < 0) {
        return refuse(502, "prompt_not_counted", "prompt_not_counted", "The prompt could not be counted by the provider, so this call's hold cannot be worked out. The gateway did not forward it.", { count_status: cr.status });
      }
      counted = Math.ceil(cj.input_tokens);
    } catch (err) {
      return refuse(502, "prompt_not_counted", "prompt_not_counted", "The prompt could not be counted by the provider, so this call's hold cannot be worked out. The gateway did not forward it.", { error: errorSummary(err) });
    }

    // 3: work out the hold and check the budget equation, in one locked transaction.
    const arithmetic = computeHold(body, counted, profile, PRICE_TABLE_DATE);
    // A hold that allowed for fast mode is settled only on usage that states the speed that served
    // the call: without it, which rate is the bill is not known (review of 13 Nov 2026).
    const fastHeld = arithmetic.fast_mode_factor > 1;
    // Cache writes an answer does not itemise are priced at the one-hour rate unless the request
    // asks for no one-hour cache anywhere (review of 13 Nov 2026).
    const oneHourPossible = mayAskForOneHourCache(body);
    const limitMs = stream ? timeLimit.stream : timeLimit.plain;
    // Counted from now, when the hold is about to open, so the margin is not eaten by the counting call.
    const deadline = new Date(Date.now() + limitMs + (stream ? deadlineMargin.stream : deadlineMargin.plain));
    const opened = await openHold(opts.pool, {
      projectId: project.id,
      step,
      amountUsd: arithmetic.hold_usd,
      deadline,
      gateway: gatewayId,
      arithmetic: { ...arithmetic },
      path,
      stepHoldId: stepHold?.id ?? null,
      model: requestedModel,
      maxTokens: body.max_tokens as number,
    });
    if (!opened.ok) {
      const b = opened.budget;
      const s = opened.step;
      if (opened.reason === "project_frozen" && opened.freeze) return c.json(errorBody("project_frozen", frozenMessage(opened.freeze)), 402);
      // A step call (package 1.3). Nothing was forwarded in any of these cases.
      if (opened.reason === "step_closed") {
        return c.json(errorBody("step_closed", "This step has ended, so its token no longer lets calls through. The gateway forwarded nothing."), 401);
      }
      if (opened.reason === "step_call_outside_limits" && s) {
        const why =
          s.which === "model" ? `this call asks for the model "${requestedModel}", and the step's budget was worked out for "${s.model}"`
          : s.which === "max_tokens" ? `this call asks for up to ${String(body.max_tokens)} output tokens, and the step's budget allows ${s.maxTokensCeiling} per call`
          : `this call's hold ($${arithmetic.hold_usd.toFixed(6)}) is more than one turn's share of the step's budget ($${s.perTurn.toFixed(6)}): its prompt is larger than the step's budget allows for`;
        return c.json(errorBody("invalid_request_error", `This call is outside the limits its step's budget was worked out from: ${why}. The gateway forwarded nothing.`), 400);
      }
      if (opened.reason === "step_budget_used_up" && s) {
        return c.json(
          errorBody(
            "step_budget_reached",
            `This step has used up its budget: $${centsDown(s.room)} is left of the $${centsUp(s.budget)} reserved for it, and this call needed up to $${centsUp(arithmetic.hold_usd)}. The gateway forwarded nothing. Raising the project's cap does not add to a running step's budget: the step has to end, and a new one be started.`,
          ),
          402,
        );
      }
      // Shown to the cent, rounded so that the figures never appear to fit: what this call needs,
      // what is spent and what is held are rounded up, the cap down, so the room left that the
      // figures imply is rounded down (review of 13 Nov 2026). The wording is the design note's (5.5),
      // with the room reserved for running steps named when there is any (package 1.3).
      const reserved = b.stepRoom > 0 ? `, and $${centsUp(b.stepRoom)} reserved for running steps` : "";
      return c.json(
        errorBody(
          "budget_reached",
          `This project has reached its budget of $${centsDown(b.cap)} (spent $${centsUp(b.spent)}, with $${centsUp(b.openHolds)} held for work in progress or awaiting reconciliation${reserved}; this call needed up to $${centsUp(arithmetic.hold_usd)}). The gateway will forward nothing more until the budget is raised.`,
        ),
        402,
      );
    }
    const holdId = opened.hold.id;

    // 4: forward. Exactly one ending is recorded for the hold.
    let ended = false;
    /**
     * The write recording this call's ending failed (package 1.4). The gate closes at once, before anything
     * is awaited; then the record goes to the journal (forced to disk) and, if the database takes it, the
     * project is frozen and the gate reopens. Until then this gateway forwards nothing.
     */
    const unrecorded = async (
      what: Pick<UnrecordedEnding, "ending" | "kept_reason" | "cost_usd_as_read" | "call" | "ended_at">,
      err: unknown,
      message: string,
    ) => {
      const rec: UnrecordedEnding = { journal_id: newJournalId(), gateway: gatewayId, project_id: project.id, hold_id: holdId, step, ...what, error: errorSummary(err) };
      gate.note(rec);
      fault(message, { project: project.id, hold: holdId, journal_id: rec.journal_id, error: rec.error });
      await gate.persist(rec.journal_id);
      await gate.drain();
    };
    const callFields = (usage: Usage, status: number, servedModel: string, extra: Record<string, unknown> = {}) => {
      const priced = Object.hasOwn(PRICES, servedModel) ? servedModel : requestedModel;
      const fields = storable(
        {
        model: requestedModel,
        served_model: servedModel || null,
        priced_as: priced,
        path,
        status,
        stream,
        usage,
        duration_ms: Date.now() - started,
        ...(droppedHeaders.length ? { headers_not_forwarded: droppedHeaders } : {}),
        ...extra,
      },
        { model: requestedModel, priced_as: priced, path, status, stream, usage },
      );
      return { priced, fields };
    };
    /**
     * The call finished and its usage was read: settle the hold to the actual cost. `itemised` is
     * how many of the cache writes the answer split into five-minute and one-hour (null: none).
     */
    const settle = async (usage: Usage, status: number, servedModel: string, extra: Record<string, unknown> = {}, itemised: number | null = null) => {
      if (ended) return;
      ended = true;
      const asPriced = usageAsPriced(usage, itemised, oneHourPossible);
      const note =
        asPriced.notItemised > 0
          ? {
              cache_writes_not_itemised: {
                tokens: asPriced.notItemised,
                priced_at: oneHourPossible ? "the one-hour rate" : "the five-minute rate",
                because: oneHourPossible ? "the request may ask for a one-hour cache lifetime" : "no cache_control in the request asks for more than five minutes",
              },
            }
          : {};
      const { priced, fields } = callFields(usage, status, servedModel, { ...extra, ...note });
      const cost = costUsd(priced, asPriced.usage);
      const endedAt = new Date().toISOString();
      try {
        if (servedModel && servedModel !== requestedModel && !Object.hasOwn(PRICES, servedModel)) {
          // Answered by a model the price table does not know: its cost would be a guess.
          await keepHold(opts.pool, { projectId: project.id, holdId, step, reason: "the answer came from a model that has no price in the gateway's table", seen: fields });
          return;
        }
        const r = await settleHold(opts.pool, { projectId: project.id, holdId, step, actualUsd: cost ?? Number.NaN, call: fields });
        if (r.exceeded) fault("A settled call cost more than its hold.", { project: project.id, hold: holdId, hold_usd: r.amountUsd, actual_usd: cost });
      } catch (err) {
        // The hold stays open in the database at its full amount: nothing was released.
        await unrecorded({ ending: "settle", kept_reason: null, cost_usd_as_read: cost ?? null, call: fields, ended_at: endedAt }, err, "A finished model call could not be written to the event log. Its hold stays open at its full amount.");
      }
    };
    /** The call ended in a way that does not say what it cost: the hold stays open at its full amount. */
    const keep = async (reason: string, usage: Usage, status: number, servedModel: string, extra: Record<string, unknown> = {}) => {
      if (ended) return;
      ended = true;
      const { fields } = callFields(usage, status, servedModel, extra);
      const endedAt = new Date().toISOString();
      try {
        await keepHold(opts.pool, { projectId: project.id, holdId, step, reason, seen: fields });
      } catch (err) {
        await unrecorded({ ending: "keep", kept_reason: reason, cost_usd_as_read: null, call: fields, ended_at: endedAt }, err, "A model call that ended without readable usage could not be noted in the event log. Its hold stays open at its full amount.");
      }
    };
    const clientGone = c.req.raw.signal;
    // The gate and the liveness lock checked again (review of 1.4): a call that passed them on arrival may
    // have waited at its counting call or for the lock while one closed. Then it is not forwarded, and as
    // only the counting call was sent, its hold is given back. No await stands between this and the forward.
    const stoppedSince = gate.closed() ? "gate" : opts.liveness && !opts.liveness.ok() ? "liveness" : null;
    if (stoppedSince) {
      ended = true;
      const why = stoppedSince === "gate" ? "a call's ending could not be recorded, so the gateway's gate closed" : "the gateway lost its liveness lock";
      try {
        await releaseUnsentHold(opts.pool, { projectId: project.id, holdId, step, reason: `${why} before this call was forwarded (only the counting call, assumed to cost nothing, was sent)` });
      } catch (err) {
        fault("A hold for a call that was never sent could not be closed. It stays open at its full amount.", { project: project.id, hold: holdId, error: errorSummary(err) });
      }
      const sent = "This call was not forwarded (only the counting call, assumed to cost nothing, was sent).";
      return c.json(stoppedSince === "gate" ? gateClosed(sent) : livenessLost(sent), 503);
    }
    // A caller that left before the call was forwarded: only the counting call has been sent, and
    // the call itself has not been forwarded, so the hold is settled at nothing with that reason. No
    // await stands between this check and the forward below, so the caller cannot leave in between
    // unseen; once the forward has begun, any ending keeps the hold as below (review of 13 Nov 2026).
    if (clientGone.aborted) {
      ended = true;
      try {
        await releaseUnsentHold(opts.pool, { projectId: project.id, holdId, step, reason: "the caller left before the call was forwarded to the provider (only the counting call, assumed to cost nothing, was sent)" });
      } catch (err) {
        fault("A hold for a call that was never sent could not be closed. It stays open at its full amount.", { project: project.id, hold: holdId, error: errorSummary(err) });
      }
      return c.json(errorBody("api_error", "The caller went away before the call was forwarded to the model provider (only the counting call, assumed to cost nothing, was sent)."), 502);
    }
    const limit = new AbortController();
    const limitTimer = setTimeout(() => limit.abort(new Error("time limit reached")), limitMs);
    const stopTimer = () => clearTimeout(limitTimer);
    // If the caller goes away while a plain call is waiting, stop waiting for the provider too.
    // (A streamed call handles this where it reads the stream, below.)
    let callerLeft = false;
    const onCallerLeft = () => {
      callerLeft = true;
      limit.abort(new Error("caller disconnected"));
    };
    if (!stream) {
      if (clientGone.aborted) onCallerLeft();
      else clientGone.addEventListener("abort", onCallerLeft, { once: true });
    }
    const whyCut = () => (callerLeft ? "the caller disconnected before the answer arrived" : "the call reached its time limit");

    let res: Response;
    try {
      res = await forward(limit.signal);
    } catch (err) {
      stopTimer();
      // The hold is kept in every case here. Only the reason differs: whether the request can be
      // known never to have been sent, or may have reached the provider, which may bill it.
      if (limit.signal.aborted) {
        await keep(whyCut(), emptyUsage(), 0, "", { error: errorSummary(err) });
        return c.json(errorBody("api_error", callerLeft ? "The caller went away before the answer arrived." : "The call reached the gateway's time limit and was cut off."), 502);
      }
      if (failedBeforeSending(err)) {
        await keep("the provider could not be reached", emptyUsage(), 0, "", { error: errorSummary(err) });
        return c.json(errorBody("api_error", "The gateway could not reach the model provider."), 502);
      }
      await keep("the connection failed after the request was sent, or may have been sent; the provider may have billed it", emptyUsage(), 0, "", { error: errorSummary(err) });
      return c.json(
        errorBody("api_error", "The connection to the model provider failed after the request was sent, or may have been sent. The provider may have done the work and billed it."),
        502,
      );
    }
    if (res.status >= 300 && res.status < 400) {
      stopTimer();
      await keep("the provider answered with a redirect, which is not followed", emptyUsage(), res.status, "");
      return c.json(errorBody("api_error", "The model provider answered with a redirect, which the gateway does not follow."), 502);
    }
    if (!res.ok) {
      const rawText = await res.text().catch(() => "");
      stopTimer();
      const text = safeBody(rawText);
      if (rejectedBeforeWork(res.status, text)) {
        // The provider's own error says it turned the request away before doing any work.
        await settle(emptyUsage(), res.status, "", { upstream_error: safeJson(text), rejected_before_work: true });
      } else {
        await keep(res.status >= 500 ? "the provider answered with a server error" : "an error answer that is not one of the provider's own rejections before work", emptyUsage(), res.status, "", { upstream_error: safeJson(text) });
      }
      return new Response(text, { status: res.status, headers: safeHeaders(res.headers) });
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (stream && contentType.includes("text/event-stream") && res.body) {
      // Tee the stream: the client receives the bytes untouched; usage is read from the events.
      let usage = emptyUsage();
      let servedModel = "";
      let sawInput = false;
      let sawOutput = false;
      let sawUnreadable = false; // a usage block that could not be trusted: the whole call counts as unread
      let sawStop = false; // the provider's own end-of-message marker
      let sawError = false; // an error event inside the stream
      let speedStated = false; // a usage block in the stream said which speed served the call
      let itemised: number | null = null; // the cache writes the last breakdown in the stream itemised
      let buffer = "";
      const decoder = new TextDecoder();
      const consume = (text: string) => {
        buffer += text;
        let idx: number;
        while ((idx = frameEnd(buffer)) >= 0) {
          const frame = buffer.slice(0, idx.valueOf());
          buffer = buffer.slice(idx + (buffer.startsWith("\r\n", idx) ? 4 : 2));
          const r = readFrame(frame, usage);
          // A figure the provider has given does not later fall, and fast mode is not taken back:
          // if either happens, which figure is the bill is not known.
          if (USAGE_COUNTS.some((f) => r.usage[f] < usage[f]) || (usage.speed === "fast" && r.usage.speed !== "fast")) sawUnreadable = true;
          usage = r.usage;
          if (r.part && statesSpeed(r.part)) speedStated = true;
          if (r.part && itemisedCacheWrites(r.part) !== null) itemised = itemisedCacheWrites(r.part);
          if (r.model) servedModel = r.model;
          if (r.kind === "message_start") {
            if (sawInput) sawUnreadable = true; // a second start: which one is the bill is not known
            sawInput = true;
          }
          if (r.kind === "message_delta") sawOutput = true;
          if (r.kind === "message_stop") sawStop = true;
          if (r.kind === "error") sawError = true;
          if (r.kind === "unreadable") sawUnreadable = true;
        }
      };
      // Pull from the provider ourselves so that every ending is seen: a clean end, a provider
      // failure part-way, the time limit, or the client going away.
      const reader = res.body.getReader();
      const onClientGone = () => {
        stopTimer();
        reader.cancel("client disconnected").catch(() => undefined);
        void keep("the client disconnected part-way", usage, res.status, servedModel);
      };
      if (clientGone.aborted) onClientGone();
      else clientGone.addEventListener("abort", onClientGone, { once: true });
      limit.signal.addEventListener("abort", () => reader.cancel("time limit reached").catch(() => undefined), { once: true });
      const out = new ReadableStream<Uint8Array>({
        async pull(ctrl) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              stopTimer();
              if (buffer.trim()) consume("\n\n");
              if (limit.signal.aborted) await keep("the call reached its time limit", usage, res.status, servedModel);
              else if (sawError) await keep("the provider reported an error inside the stream", usage, res.status, servedModel);
              else if (!sawStop) await keep("the stream ended without the provider's end-of-message marker, so its figures may be partial", usage, res.status, servedModel);
              else if (sawInput && sawOutput && !sawUnreadable && usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens > 0) {
                if (fastHeld && !speedStated) await keep(`the stream ended without usage figures that could be read: ${SPEED_NOT_STATED}`, usage, res.status, servedModel);
                else await settle(usage, res.status, servedModel, {}, itemised);
              } else await keep("the stream ended without usage figures that could be read", usage, res.status, servedModel);
              ctrl.close();
              return;
            }
            consume(decoder.decode(value, { stream: true }));
            ctrl.enqueue(value);
          } catch (err) {
            stopTimer();
            await keep(limit.signal.aborted ? "the call reached its time limit" : "the provider's stream failed part-way", usage, res.status, servedModel, { error: errorSummary(err) });
            ctrl.error(err);
          }
        },
        async cancel(reason) {
          stopTimer();
          await reader.cancel(reason).catch(() => undefined);
          await keep("the client cancelled part-way", usage, res.status, servedModel);
        },
      });
      return new Response(out, { status: res.status, headers: safeHeaders(res.headers) });
    }

    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      stopTimer();
      await keep(limit.signal.aborted ? whyCut() : "the provider's answer broke off part-way", emptyUsage(), res.status, "", { error: errorSummary(err) });
      return c.json(errorBody("api_error", "The model provider's answer could not be read to the end."), 502);
    }
    stopTimer();
    if (text.length > MAX_BODY_CHARS) {
      // Far larger than any answer the request could have asked for: not searched, not passed on, not settled.
      await keep("the answer was larger than the gateway reads", emptyUsage(), res.status, "");
      return c.json(errorBody("api_error", "The model provider's answer was larger than the gateway passes on."), 502);
    }
    let usage: Usage | null = null;
    let servedModel = "";
    let speedNotStated = false;
    let itemised: number | null = null;
    try {
      const j = JSON.parse(text) as { usage?: unknown; model?: unknown };
      servedModel = typeof j.model === "string" ? j.model : "";
      // An answer names the model that served it, as text. Without that name it is not priced.
      if (servedModel !== "" && usageIsReadable(j.usage, ["input_tokens", "output_tokens"])) {
        const u = mergeUsage(emptyUsage(), j.usage);
        // An answer that says no prompt tokens at all were used is not a bill that can be trusted.
        if (u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens > 0) {
          if (fastHeld && !statesSpeed(j.usage)) speedNotStated = true;
          else {
            usage = u;
            itemised = itemisedCacheWrites(j.usage);
          }
        }
      }
    } catch {
      /* not JSON: usage stays unread */
    }
    if (usage) await settle(usage, res.status, servedModel, {}, itemised);
    else await keep(`the answer succeeded but its usage could not be read${speedNotStated ? `: ${SPEED_NOT_STATED}` : ""}`, emptyUsage(), res.status, servedModel);
    return new Response(safeBody(text), { status: res.status, headers: safeHeaders(res.headers) });
  });

  return app;
}

/** Decode percent-encoding and collapse trailing slashes so "/v1/%6Dessages/" is seen as "/v1/messages". */
export function normalisePath(pathname: string): string {
  let p = pathname;
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep as is; it will not match an allowed path */
  }
  return p.replace(/\/+$/, "") || "/";
}

function bearer(h: string | undefined): string | undefined {
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1];
}

function copyHeaders(h: Headers): Headers {
  const out = new Headers();
  h.forEach((v, k) => {
    const key = k.toLowerCase();
    if (!STRIP.has(key) && key !== "content-encoding") out.set(k, v);
  });
  return out;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}

/** A fixed, header-free summary of an error: never the error's full text, which is outside our control. */
export function errorSummary(err: unknown): { name: string; code?: string } {
  const e = err as { name?: string; code?: string; cause?: { code?: string } };
  return { name: e?.name ?? "Error", code: e?.code ?? e?.cause?.code };
}

/** Index of the end of the first complete SSE frame ("\n\n" or "\r\n\r\n"), or -1. */
function frameEnd(buffer: string): number {
  const a = buffer.indexOf("\n\n");
  const b = buffer.indexOf("\r\n\r\n");
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

/**
 * Read usage (and the served model) from one SSE frame. message_start carries input usage; message_delta carries output.
 * `part` is the usage block the frame itself carried, when it was read.
 */
export function readFrame(frame: string, acc: Usage): { usage: Usage; model?: string; kind?: "message_start" | "message_delta" | "message_stop" | "error" | "unreadable"; part?: ProviderUsage } {
  // Lines end as the event-stream format allows: CR LF, LF, or CR alone.
  const lines = frame.split(/\r\n|\n|\r/);
  const data = lines
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .join("\n");
  // The frame's own name, where it has one. A frame named "error" is an error whatever its data
  // says. A frame with more than one name is two frames run together: not read.
  const names = lines.filter((l) => l.startsWith("event:")).map((l) => l.slice(6).trim());
  if (names.includes("error")) return { usage: acc, kind: "error" };
  if (names.length > 1) return { usage: acc, kind: "unreadable" };
  const named = names[0];
  // A named frame always carries data. A frame with neither (a comment, a keep-alive) is passed over.
  if (!data) return named !== undefined ? { usage: acc, kind: "unreadable" } : { usage: acc };
  try {
    const ev = JSON.parse(data) as { type?: unknown; message?: { usage?: unknown; model?: unknown } | null; usage?: unknown };
    // The provider names each frame after the type inside it. A frame whose name and type
    // disagree cannot be trusted to be what either says.
    if (named !== undefined && ev.type !== named) return { usage: acc, kind: "unreadable" };
    if (ev.type === "message_start") {
      const m = ev.message;
      // The model must be given as text, and not empty: anything else is not a name the price table can be asked about.
      if (m !== null && typeof m === "object" && typeof m.model === "string" && m.model !== "" && usageIsReadable(m.usage, ["input_tokens"])) {
        return { usage: mergeUsage(acc, m.usage), model: m.model, kind: "message_start", part: m.usage };
      }
      return { usage: acc, model: m !== null && typeof m === "object" && typeof m.model === "string" ? m.model : undefined, kind: "unreadable" };
    }
    if (ev.type === "message_delta" && usageIsReadable(ev.usage, ["output_tokens"])) return { usage: mergeUsage(acc, ev.usage), kind: "message_delta", part: ev.usage };
    if (ev.type === "message_delta" && ev.usage !== undefined) return { usage: acc, kind: "unreadable" };
    if (ev.type === "message_stop") return { usage: acc, kind: "message_stop" };
    if (ev.type === "error") return { usage: acc, kind: "error" };
  } catch {
    // Data that is not JSON: every frame the provider sends carries JSON, so something was lost or added.
    return { usage: acc, kind: "unreadable" };
  }
  return { usage: acc };
}

/** Kept for callers of the old name. */
export const readUsageFromFrame = (frame: string, acc: Usage): Usage => readFrame(frame, acc).usage;

/**
 * What a gateway process does about holds outside any one request: at start-up it finds the
 * holds left open in the database, and from then on it marks holds that pass their deadline.
 * Nothing here releases money. Returns a function that stops the timer.
 */
export async function startHoldKeeper(
  pool: pg.Pool,
  gatewayId: string,
  everyMs = 30_000,
  /** Package 1.4: the gate, whose unrecorded endings the keeper tries to record on each pass. */
  gate?: FaultGate,
): Promise<{ found: number; expiredAtStart: number; ownerGone: number; stop: () => void }> {
  const r = await recoverHolds(pool, gatewayId);
  const timer = setInterval(() => {
    expireHolds(pool).catch((err) => console.error("[gateway fault] holds past their deadline could not be marked", errorSummary(err)));
    if (gate?.closed()) void gate.drain();
  }, everyMs);
  timer.unref();
  return { found: r.found.length, expiredAtStart: r.expired.length, ownerGone: r.ownerGone, stop: () => clearInterval(timer) };
}
