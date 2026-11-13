/**
 * The hold for one model call (design note 5.5; build plan package 1.2): a reservation worked out
 * from the provider's token estimate plus an assumed margin, not a proven ceiling on the bill.
 * The gateway enforces a limit when a call is admitted (spend plus open holds plus this hold within
 * the cap); it does not enforce that a bill stays within its hold (docs/KNOWN-GAPS.md, gaps 41 and 62).
 *
 * The hold is worked out from the request itself, before anything is forwarded:
 *   input  = the prompt's token count (from the provider's counting call, which the provider calls
 *            an estimate, plus an assumed margin)
 *            at the dearest input rate that could apply: the one-hour cache-write rate,
 *            at the long-prompt price when the counted prompt plus the margin reaches that
 *            threshold (a prompt counted below it but billed above it is not covered);
 *   output = the request's max_tokens at the dearest output rate that could apply;
 *   both doubled when fast mode could apply.
 * Requests that ask for what these inputs would not cover (non-default inference_geo, tools the
 * provider runs, unlisted fields or beta features, fast mode without a listed price or permission)
 * are refused, never estimated.
 */
import { FAST_MODE_FACTOR, HAIKU_LONG_PROMPT, PRICES, type ModelPrice } from "./prices.js";

/** What a project's profile allows. Kept deliberately small until there are measurements. */
export interface ProfileLimits {
  /** A request asking for more output than this is refused, so a hold cannot be made absurd. */
  maxTokensCeiling: number;
  /** Whether fast mode may be served. When true, every hold on a model with a fast-mode price is doubled. */
  allowFastMode: boolean;
}

export const DEFAULT_PROFILES: Record<string, ProfileLimits> = {
  standard: { maxTokensCeiling: 16_000, allowFastMode: false },
};

/**
 * Models whose fast-mode price is on the provider's pricing page (read 12 Nov 2026) at twice
 * the standard rate. Fast mode on any other model is refused: its price would be a guess.
 */
export const FAST_MODE_PRICED = new Set(["claude-opus-5-5", "claude-fable-5-2"]);

/** Models with a dearer rate above a prompt-size threshold, and that threshold in tokens (all input kinds). */
export const LONG_PROMPT: Record<string, { thresholdTokens: number; price: ModelPrice }> = {
  "claude-haiku-5-5": { thresholdTokens: 100_000, price: HAIKU_LONG_PROMPT },
};

/**
 * The provider calls its token count "an estimate" that "might differ by a small amount".
 * The hold therefore adds a margin to the count. THE SIZE IS AN ASSUMPTION, not a measurement:
 * no real provider has been called. It is checked against real usage in package 2.3.
 */
export const COUNT_MARGIN = { fraction: 0.05, tokens: 200 };

/**
 * Tools the provider runs on its own servers are billed on top of tokens (web search is priced
 * per search), which a token-based hold cannot bound. A tool entry is accepted only if it is the
 * caller's own (no `type`, or `type: "custom"`) or one of the provider-defined tools that the
 * caller itself executes. Everything else is refused. The list is an assumption to be checked
 * against what the engine actually sends, in package 2.2.
 */
const CLIENT_EXECUTED_TOOL_TYPE = /^(bash|text_editor)_\d{8}$/;

/**
 * The only top-level request fields the gateway forwards. A field outside this list is refused,
 * because the hold is worked out from these fields alone: an unknown field could add prompt
 * content the count never saw (a stored conversation, a container), bring in other models
 * (fallbacks), or change what is billed (service tier, server-side context handling).
 * To be widened only with a reason, when package 2.2 shows what the engine really sends.
 */
export const FORWARDED_FIELDS = new Set([
  "model",
  "messages",
  "system",
  "max_tokens",
  "stream",
  "temperature",
  "top_p",
  "top_k",
  "stop_sequences",
  "metadata",
  "tools",
  "tool_choice",
  "thinking",
  "speed",
  "inference_geo",
  "mcp_servers",
]);

export interface MeteredRequest {
  model?: unknown;
  max_tokens?: unknown;
  stream?: unknown;
  speed?: unknown;
  inference_geo?: unknown;
  tools?: unknown;
  mcp_servers?: unknown;
  [key: string]: unknown;
}

export type Refusal = { reason: string; message: string; detail?: Record<string, unknown> };

/** Checks that do not need the token count. Returns a refusal, or null when the request may go on. */
export function guardRequest(body: MeteredRequest, profile: ProfileLimits): Refusal | null {
  const model = typeof body.model === "string" ? body.model : "";
  const unknown = Object.keys(body).filter((k) => !FORWARDED_FIELDS.has(k));
  if (unknown.length > 0) {
    return {
      reason: "field_not_allowed",
      message: `The request carries ${unknown.length === 1 ? "a field" : "fields"} the gateway does not forward (${unknown.slice(0, 5).join(", ")}). A call's hold is worked out from a fixed list of fields; anything else could change the price or add prompt content that was not counted.`,
      detail: { fields: unknown.slice(0, 20) },
    };
  }
  if (typeof body.max_tokens !== "number" || !Number.isInteger(body.max_tokens) || body.max_tokens <= 0) {
    return { reason: "max_tokens_missing", message: "The request does not state max_tokens as a whole number above zero, so its hold cannot be worked out." };
  }
  if (body.max_tokens > profile.maxTokensCeiling) {
    return {
      reason: "max_tokens_above_ceiling",
      message: `The request asks for up to ${body.max_tokens} output tokens. This project's profile allows at most ${profile.maxTokensCeiling} per call.`,
      detail: { max_tokens: body.max_tokens, ceiling: profile.maxTokensCeiling },
    };
  }
  if (body.inference_geo !== undefined && body.inference_geo !== null && body.inference_geo !== "global") {
    return {
      reason: "inference_geo_not_allowed",
      message: "The request sets inference_geo, which changes the price of every token. The gateway forwards only the default routing until its holds include that factor.",
      detail: { inference_geo: String(body.inference_geo) },
    };
  }
  if (body.speed !== undefined && body.speed !== null && body.speed !== "standard") {
    if (body.speed !== "fast") return { reason: "speed_not_recognised", message: "The request sets a speed the gateway does not recognise.", detail: { speed: String(body.speed) } };
    if (!profile.allowFastMode) return { reason: "fast_mode_not_allowed", message: "The request asks for fast mode, which this project's profile does not allow." };
    if (!FAST_MODE_PRICED.has(model)) {
      return { reason: "fast_mode_not_priced", message: `The request asks for fast mode on "${model}", whose fast-mode price is not in the gateway's price table.`, detail: { model } };
    }
  }
  if (body.mcp_servers !== undefined && body.mcp_servers !== null && !(Array.isArray(body.mcp_servers) && body.mcp_servers.length === 0)) {
    return { reason: "server_tool_not_allowed", message: "The request asks the provider to connect to tool servers itself. The gateway cannot bound what that costs and does not forward it.", detail: { field: "mcp_servers" } };
  }
  if (body.tools !== undefined && body.tools !== null) {
    if (!Array.isArray(body.tools)) return { reason: "tools_not_readable", message: "The request's tools are not a list, so they cannot be checked." };
    for (const t of body.tools as Array<Record<string, unknown> | null>) {
      const type = t && typeof t === "object" ? t["type"] : undefined;
      if (type === undefined || type === null || type === "custom") continue;
      if (typeof type === "string" && CLIENT_EXECUTED_TOOL_TYPE.test(type)) continue;
      return {
        reason: "server_tool_not_allowed",
        message: `The request includes a tool of type "${String(type)}". Tools the provider runs itself can be billed on top of tokens, so the gateway does not forward them.`,
        detail: { tool_type: String(type) },
      };
    }
  }
  return null;
}

export interface HoldArithmetic {
  model: string;
  counted_prompt_tokens: number;
  count_margin_tokens: number;
  prompt_tokens_held: number;
  max_tokens: number;
  long_prompt_rates: boolean;
  long_prompt_threshold_tokens: number | null;
  input_rate_usd_per_million: number;
  input_rate_is: string;
  output_rate_usd_per_million: number;
  fast_mode_factor: number;
  fast_mode_because: string | null;
  input_part_usd: number;
  output_part_usd: number;
  hold_usd: number;
  price_table_date: string;
}

/** The hold for a request whose prompt has been counted. `guardRequest` must have passed first. */
export function computeHold(body: MeteredRequest, countedPromptTokens: number, profile: ProfileLimits, priceTableDate: string): HoldArithmetic {
  const model = String(body.model);
  const base = Object.hasOwn(PRICES, model) ? PRICES[model] : undefined;
  if (!base) throw new Error(`No price for model "${model}"`);
  const maxTokens = body.max_tokens as number;
  const margin = Math.ceil(countedPromptTokens * COUNT_MARGIN.fraction) + COUNT_MARGIN.tokens;
  const held = countedPromptTokens + margin;
  const long = LONG_PROMPT[model];
  // The long-prompt rate applies unless the prompt, with its margin, is still under the threshold.
  const useLong = long !== undefined && held >= long.thresholdTokens;
  const price = useLong ? long.price : base;
  const fastAsked = body.speed === "fast";
  const fast = fastAsked || (profile.allowFastMode && FAST_MODE_PRICED.has(model));
  const factor = fast ? FAST_MODE_FACTOR : 1;
  // A hold is rounded up to the next millionth of a dollar, never down.
  const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
  const up6 = (n: number) => Math.ceil(n * 1e6 - 1e-6) / 1e6;
  const inputPart = up6((held * price.cache_write_1h * factor) / 1_000_000);
  const outputPart = up6((maxTokens * price.output * factor) / 1_000_000);
  return {
    model,
    counted_prompt_tokens: countedPromptTokens,
    count_margin_tokens: margin,
    prompt_tokens_held: held,
    max_tokens: maxTokens,
    long_prompt_rates: useLong,
    long_prompt_threshold_tokens: long?.thresholdTokens ?? null,
    input_rate_usd_per_million: price.cache_write_1h,
    input_rate_is: useLong ? "one-hour cache write, long-prompt price" : "one-hour cache write",
    output_rate_usd_per_million: price.output,
    fast_mode_factor: factor,
    fast_mode_because: fast ? (fastAsked ? "the request asks for it" : "the profile allows it") : null,
    input_part_usd: inputPart,
    output_part_usd: outputPart,
    hold_usd: round6(inputPart + outputPart),
    price_table_date: priceTableDate,
  };
}

/** The fields the provider's token-counting call accepts, taken from the request as sent. */
export function countRequestBody(body: MeteredRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["model", "messages", "system", "tools", "tool_choice", "thinking"]) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}

/**
 * Beta features are switched on by the `anthropic-beta` request header and can change what a
 * call costs. The gateway forwards a request only if every value in that header is on its list
 * (GatewayOptions.allowedBetas; empty by default). Returns the values that are not allowed.
 */
export function betasNotAllowed(header: string | undefined | null, allowed: ReadonlySet<string>): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && !allowed.has(v));
}
