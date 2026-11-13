/**
 * Model prices, USD per million tokens, from Anthropic's pricing page.
 * Source: https://platform.claude.com/docs/en/about-claude/pricing, read on 2026-11-11.
 * Re-check before relying on it; the date is part of the record.
 */
export const PRICE_TABLE_DATE = "2026-11-11";
export const PRICE_TABLE_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";

export interface ModelPrice {
  input: number;
  cache_write_5m: number;
  cache_write_1h: number;
  cache_read: number;
  output: number;
}

export const PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, cache_write_5m: 5, cache_write_1h: 8, cache_read: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, cache_write_5m: 2.5, cache_write_1h: 4, cache_read: 0.1, output: 10 },
  // Haiku 5.5 prices below are for prompts up to 100,000 tokens. Longer prompts cost more;
  // the gateway charges the higher rate when the prompt (all input kinds) exceeds 100k.
  "claude-haiku-5-5": { input: 0.1, cache_write_5m: 0.125, cache_write_1h: 0.2, cache_read: 0.01, output: 0.5 },
  "claude-fable-5-2": { input: 8, cache_write_5m: 10, cache_write_1h: 16, cache_read: 0.2, output: 40 },
};

export const HAIKU_LONG_PROMPT: ModelPrice = { input: 0.5, cache_write_5m: 0.625, cache_write_1h: 1, cache_read: 0.05, output: 2.5 };

/**
 * Fast mode is priced at twice the standard rate (pricing page: Opus 5.5 $8 in, $40 out).
 * Assumption recorded in docs/KNOWN-GAPS.md: the same factor is applied to cache rates.
 */
export const FAST_MODE_FACTOR = 2;

export function priceFor(model: string, promptTokens: number): ModelPrice | null {
  if (model === "claude-haiku-5-5" && promptTokens > 100_000) return HAIKU_LONG_PROMPT;
  return Object.hasOwn(PRICES, model) ? (PRICES[model] ?? null) : null;
}
