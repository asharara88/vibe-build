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
  return Math.round(c * 1e6) / 1e6;
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
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * Whether a usage block from the provider can be trusted as a bill: every count the meter
 * uses is present as a whole number that is not negative, or absent. Anything else (text
 * where a number belongs, a negative count, a fraction) means the usage was NOT read, and the
 * caller keeps the hold. `require` names the counts that must be present.
 * A usage block that itemises several attempts (`iterations`) is also not read: its top-level
 * figures do not cover everything that was billed.
 */
export function usageIsReadable(part: unknown, require: ReadonlyArray<(typeof USAGE_NUMBER_FIELDS)[number]>): part is ProviderUsage {
  if (part === null || typeof part !== "object" || Array.isArray(part)) return false;
  const u = part as Record<string, unknown>;
  if (u["iterations"] !== undefined && u["iterations"] !== null) return false;
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
    for (const v of Object.values(cc as Record<string, unknown>)) if (v !== undefined && v !== null && !isCount(v)) return false;
  }
  const speed = u["speed"];
  if (speed !== undefined && speed !== null && typeof speed !== "string") return false;
  return true;
}
