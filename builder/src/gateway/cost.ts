import { FAST_MODE_FACTOR, priceFor } from "./prices.js";

/** The usage block Anthropic returns on a message, or accumulates over a stream. */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  /** Of the cache writes, how many were one-hour writes (priced higher). */
  cache_creation_1h_tokens: number;
  /** "fast" when the response reports fast mode. */
  speed: "standard" | "fast";
}

export const emptyUsage = (): Usage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_1h_tokens: 0,
  speed: "standard",
});

/** What the provider's JSON may carry. Only the fields the meter needs. */
export interface ProviderUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
  speed?: string | null;
}

/** Cost in USD, rounded to 6 places. Null when the model is not in the price table. */
export function costUsd(model: string, u: Usage): number | null {
  const promptTokens = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
  const p = priceFor(model, promptTokens);
  if (!p) return null;
  const perM = (n: number, price: number) => (n * price) / 1_000_000;
  const write1h = Math.min(u.cache_creation_1h_tokens, u.cache_creation_input_tokens);
  const write5m = u.cache_creation_input_tokens - write1h;
  let c =
    perM(u.input_tokens, p.input) +
    perM(write5m, p.cache_write_5m) +
    perM(write1h, p.cache_write_1h) +
    perM(u.cache_read_input_tokens, p.cache_read) +
    perM(u.output_tokens, p.output);
  if (u.speed === "fast") c *= FAST_MODE_FACTOR;
  // Rounded up to the next millionth of a dollar, as holds are: a cost is never under-recorded.
  return Math.ceil(c * 1e6 - 1e-6) / 1e6;
}

/**
 * Merge a provider usage object into the accumulator. Values replace, they do not add:
 * message_delta.usage is cumulative for the message.
 */
export function mergeUsage(acc: Usage, part: ProviderUsage): Usage {
  return {
    input_tokens: part.input_tokens ?? acc.input_tokens,
    output_tokens: part.output_tokens ?? acc.output_tokens,
    cache_creation_input_tokens: part.cache_creation_input_tokens ?? acc.cache_creation_input_tokens,
    cache_read_input_tokens: part.cache_read_input_tokens ?? acc.cache_read_input_tokens,
    cache_creation_1h_tokens: part.cache_creation?.ephemeral_1h_input_tokens ?? acc.cache_creation_1h_tokens,
    speed: part.speed === "fast" ? "fast" : part.speed ? "standard" : acc.speed,
  };
}

const USAGE_NUMBER_FIELDS = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"] as const;
/** The counts the meter accumulates over a stream. None of them falls from one frame to the next. */
export const USAGE_COUNTS = [...USAGE_NUMBER_FIELDS, "cache_creation_1h_tokens"] as const;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
/**
 * Every field the provider's reference lists for a usage block (docs/SOURCES.md, read 12 Nov 2026),
 * plus `iterations`, which is refused below. A field that is not on this list and carries a value
 * means the bill has a part the meter does not know how to price: the usage is not read.
 */
const KNOWN_USAGE_FIELDS = new Set<string>([
  ...USAGE_NUMBER_FIELDS,
  "cache_creation",
  "inference_geo",
  "iterations",
  "output_tokens_details",
  "server_tool_use",
  "service_tier",
  "speed",
]);
const KNOWN_CACHE_CREATION_FIELDS = new Set<string>(["ephemeral_5m_input_tokens", "ephemeral_1h_input_tokens"]);

/**
 * Whether a usage block from the provider can be trusted as a bill: every count the meter
 * uses is present as a whole number that is not negative, or absent. Anything else (text
 * where a number belongs, a negative count, a fraction) means the usage was NOT read, and the
 * caller keeps the hold. `require` names the counts that must be present.
 * A usage block that itemises several attempts (`iterations`) is also not read: its top-level
 * figures do not cover everything that was billed. Nor is one that carries a field the meter
 * does not know.
 */
export function usageIsReadable(part: unknown, require: ReadonlyArray<(typeof USAGE_NUMBER_FIELDS)[number]>): part is ProviderUsage {
  if (part === null || typeof part !== "object" || Array.isArray(part)) return false;
  const u = part as Record<string, unknown>;
  if (u["iterations"] !== undefined && u["iterations"] !== null) return false;
  for (const [name, v] of Object.entries(u)) if (!KNOWN_USAGE_FIELDS.has(name) && v !== undefined && v !== null) return false;
  for (const f of USAGE_NUMBER_FIELDS) {
    const v = u[f];
    if (v === undefined || v === null) {
      if (require.includes(f)) return false;
      continue;
    }
    if (!isCount(v)) return false;
  }
  const cc = u["cache_creation"];
  if (cc !== undefined && cc !== null) {
    if (typeof cc !== "object" || Array.isArray(cc)) return false;
    let members = 0;
    for (const [name, v] of Object.entries(cc as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      // A kind of cache write the price table has no rate for.
      if (!KNOWN_CACHE_CREATION_FIELDS.has(name)) return false;
      if (!isCount(v)) return false;
      members += v;
    }
    // The itemised cache writes must add up to the total given beside them, where one is given.
    const total = u["cache_creation_input_tokens"];
    if (typeof total === "number" && members !== total) return false;
    if ((total === undefined || total === null) && members > 0) return false;
  }
  // The breakdown of output tokens is for information: the reference says output_tokens stays the
  // inclusive total that is billed. It must still be made of counts, none above that total.
  const otd = u["output_tokens_details"];
  if (otd !== undefined && otd !== null) {
    if (typeof otd !== "object" || Array.isArray(otd)) return false;
    const out = u["output_tokens"];
    for (const v of Object.values(otd as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      if (!isCount(v)) return false;
      if (typeof out === "number" && v > out) return false;
    }
  }
  // Only the two speeds the price table knows.
  const speed = u["speed"];
  if (speed !== undefined && speed !== null && speed !== "standard" && speed !== "fast") return false;
  // Anything that says the call was billed outside the token rates the hold was worked out from.
  const stu = u["server_tool_use"];
  if (stu !== undefined && stu !== null) {
    if (typeof stu !== "object" || Array.isArray(stu)) return false;
    for (const v of Object.values(stu as Record<string, unknown>)) if (v !== 0 && v !== null && v !== undefined) return false;
  }
  const tier = u["service_tier"];
  if (tier !== undefined && tier !== null && tier !== "standard") return false;
  const geo = u["inference_geo"];
  if (geo !== undefined && geo !== null && geo !== "global" && geo !== "not_available") return false;
  return true;
}
