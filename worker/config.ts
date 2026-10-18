// Worker configuration — from the environment of the worker server
// (Railway / Fly.io). SUPABASE_SERVICE_ROLE_KEY lives ONLY there: the web app
// and the Edge Functions never hand it to a browser.

export interface WorkerConfig {
  supabaseUrl: string;
  serviceKey: string;
  anthropicKey: string;
  workerId: string;
  /** Idle wait between queue polls. */
  pollMs: number;
  /** Lease on a claimed check; renewed by a heartbeat every third of it. */
  leaseSeconds: number;
  /** Hard ceiling on one run; past it the run is abandoned and retried. */
  maxRunMs: number;
  /** Model for the threshold checks (same default as enrichment v2). */
  gateModel: string;
  /** Estimated price of one search call, for the per-run cost log. */
  searchCostUsd: number;
}

/** A setting that was never filled in: thrown at start, printed as one line. */
export class ConfigError extends Error {}

// Values copied from the README template ("https://<project>.supabase.co",
// "..."). No real URL or key contains angle brackets or an ellipsis.
const PLACEHOLDER = /[<>]|\.\.\.|…/;

function required(env: Record<string, string | undefined>, key: string): string {
  const v = env[key]?.trim();
  if (!v) throw new ConfigError(`Missing ${key} in the worker's environment.`);
  if (PLACEHOLDER.test(v)) throw new ConfigError(`${key} still holds the template placeholder — set the real value.`);
  return v;
}

function supabaseUrl(env: Record<string, string | undefined>): string {
  const v = required(env, "SUPABASE_URL").replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v)) {
    throw new ConfigError("SUPABASE_URL must be the project address, like https://abcd1234.supabase.co");
  }
  return v;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  // Without search every check would look like a stealth company: refuse to
  // start rather than return wrong verdicts.
  required(env, "SERP_KEY");
  return {
    supabaseUrl: supabaseUrl(env),
    serviceKey: required(env, "SUPABASE_SERVICE_ROLE_KEY"),
    anthropicKey: required(env, "ANTHROPIC_API_KEY"),
    workerId: env.WORKER_ID?.trim() || `worker-${Math.random().toString(36).slice(2, 8)}`,
    pollMs: Number(env.POLL_MS ?? 5000),
    leaseSeconds: Number(env.LEASE_SECONDS ?? 120),
    maxRunMs: Number(env.MAX_RUN_MS ?? 15 * 60_000),
    gateModel: env.GATE_MODEL?.trim() || "claude-haiku-4-5-20251001",
    searchCostUsd: Number(env.SEARCH_COST_USD ?? 0.001),
  };
}

/** USD per token, as in scripts/bulk_enrich_v2.ts. */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5":          { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  "claude-haiku-4-5-20251001": { input: 1 / 1_000_000, output: 5 / 1_000_000 },
};

export function llmCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICING[model] ?? MODEL_PRICING["claude-haiku-4-5-20251001"];
  return inputTokens * p.input + outputTokens * p.output;
}
