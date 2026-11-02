/**
 * lib/enrichment/models.ts — what each extraction model accepts and what a
 * call costs (owner, 2026-11-02: the Haiku 5.5 experiment).
 *
 *   claude-haiku-4-5   $1.00 / $5.00 per MTok input / output, at any prompt length.
 *   claude-haiku-5-5   $0.10 / $0.50 when the prompt is 100K tokens or fewer,
 *                      $0.50 / $2.50 when it is longer.
 *   Cache reads bill 0.1x the input rate, 5-minute cache writes 1.25x.
 *
 * Claude Haiku 5.5 rejects non-default sampling parameters (`temperature: 0`
 * returns a 400), so `requestFor` drops them for it. Every extraction call
 * forces its tool (`tool_choice: tool`), and a forced tool call on Haiku 5.5
 * skips thinking — the two models answer the same request the same way.
 *
 * The cost is computed from the tokens the API reports for each call
 * (`usage`), never estimated. Its prompt length — input + cache write +
 * cache read — picks Haiku 5.5's rate card, and calls over 100K are counted.
 */

export const LONG_PROMPT_TOKENS = 100_000;

interface Rates { input: number; output: number; longInput?: number; longOutput?: number }

const M = 1_000_000;
const RATES: Record<string, Rates> = {
  "claude-haiku-4-5": { input: 1 / M, output: 5 / M },
  "claude-haiku-4-5-20251001": { input: 1 / M, output: 5 / M },
  "claude-haiku-5-5": { input: 0.1 / M, output: 0.5 / M, longInput: 0.5 / M, longOutput: 2.5 / M },
  "claude-sonnet-5-5": { input: 2 / M, output: 10 / M },
  "claude-sonnet-5": { input: 2 / M, output: 10 / M },
};

/** Models that reject temperature / top_p / top_k at non-default values. */
const NO_SAMPLING = /^claude-(haiku-5|sonnet-5|opus-5|opus-4-[78]|fable)/;

export interface CallUsage { inputTokens: number; outputTokens: number; cacheWriteTokens?: number; cacheReadTokens?: number }

/** The prompt's length as the API counts it: uncached input plus cache writes plus cache reads. */
export const promptTokens = (u: CallUsage) => u.inputTokens + (u.cacheWriteTokens ?? 0) + (u.cacheReadTokens ?? 0);

/** USD for one call, from its reported usage. An unknown model is priced as Haiku 4.5 and flagged by `knownModel`. */
export function callCostUsd(model: string, u: CallUsage): number {
  const r = RATES[model] ?? RATES["claude-haiku-4-5"];
  const long = r.longInput != null && promptTokens(u) > LONG_PROMPT_TOKENS;
  const inRate = long ? r.longInput! : r.input, outRate = long ? r.longOutput! : r.output;
  return (u.inputTokens + (u.cacheWriteTokens ?? 0) * 1.25 + (u.cacheReadTokens ?? 0) * 0.1) * inRate + u.outputTokens * outRate;
}

export const knownModel = (model: string) => model in RATES;

/** The request as `model` accepts it: no sampling parameters where they 400. */
export function requestFor<T extends Record<string, unknown>>(request: T, model: string): T & { model: string } {
  if (!NO_SAMPLING.test(model)) return { ...request, model };
  const { temperature: _t, top_p: _p, top_k: _k, ...rest } = request as Record<string, unknown>;
  return { ...(rest as T), model };
}

/** Running totals for a run: tokens, cost and the longest prompt (the 100K check). */
export class UsageMeter {
  calls = 0; inputTokens = 0; outputTokens = 0; cacheWriteTokens = 0; cacheReadTokens = 0; costUsd = 0;
  maxPromptTokens = 0; callsOverLong = 0;
  add(model: string, u: CallUsage): void {
    this.calls++;
    this.inputTokens += u.inputTokens; this.outputTokens += u.outputTokens;
    this.cacheWriteTokens += u.cacheWriteTokens ?? 0; this.cacheReadTokens += u.cacheReadTokens ?? 0;
    this.costUsd += callCostUsd(model, u);
    const p = promptTokens(u);
    this.maxPromptTokens = Math.max(this.maxPromptTokens, p);
    if (p > LONG_PROMPT_TOKENS) this.callsOverLong++;
  }
  toJSON() {
    const { calls, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, costUsd, maxPromptTokens, callsOverLong } = this;
    return { calls, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, costUsd, maxPromptTokens, callsOverLong };
  }
}
