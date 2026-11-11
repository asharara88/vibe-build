import { priceFor } from "./prices.js";

/** The usage block Anthropic returns on a message, or accumulates over a stream. */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export const emptyUsage = (): Usage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
});

/** Cost in USD, rounded to 6 places. Null when the model is not in the price table. */
export function costUsd(model: string, u: Usage): number | null {
  const totalInput = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
  const p = priceFor(model, totalInput);
  if (!p) return null;
  const perM = (n: number, price: number) => (n * price) / 1_000_000;
  const c =
    perM(u.input_tokens, p.input) +
    perM(u.cache_creation_input_tokens, p.cache_write_5m) +
    perM(u.cache_read_input_tokens, p.cache_read) +
    perM(u.output_tokens, p.output);
  return Math.round(c * 1e6) / 1e6;
}

/** Merge a (partial) usage object into an accumulator. Used while reading a stream. */
export function mergeUsage(acc: Usage, part: Partial<Record<keyof Usage, number | null | undefined>>): Usage {
  return {
    input_tokens: part.input_tokens ?? acc.input_tokens,
    output_tokens: part.output_tokens ?? acc.output_tokens,
    cache_creation_input_tokens: part.cache_creation_input_tokens ?? acc.cache_creation_input_tokens,
    cache_read_input_tokens: part.cache_read_input_tokens ?? acc.cache_read_input_tokens,
  };
}
