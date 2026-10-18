// =============================================================================
// AlphaMap check worker — drains the company_checks queue.
//
// Runs on a small server of its own (Railway or Fly.io — worker/README.md),
// never on CI runners. Holds the only copy of SUPABASE_SERVICE_ROLE_KEY
// outside Supabase itself.
//
// Stage 1: the threshold checks (worker/gates.ts). Stage 3 adds the
// enrichment to the same run, after a check passes them.
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { loadConfig, llmCostUsd, ConfigError, type WorkerConfig } from "./config.ts";
import { Queue } from "./queue.ts";
import { processOne, type Execute } from "./runner.ts";
import { runGates } from "./gates.ts";
import { PermanentError } from "./retry.ts";

let cfg: WorkerConfig;
try {
  cfg = loadConfig();
} catch (e) {
  if (!(e instanceof ConfigError)) throw e;
  console.error(`[worker] not started: ${e.message}`);
  process.exit(1);
}
const db = createClient(cfg.supabaseUrl, cfg.serviceKey, { auth: { persistSession: false } });
const anthropic = new Anthropic({ apiKey: cfg.anthropicKey });
const queue = new Queue(db, cfg.workerId, cfg.leaseSeconds);

const execute: Execute = async (row) => {
  if (!row.input?.name) throw new PermanentError("check has no company name");
  const g = await runGates(
    { name: row.input.name, website: row.input.website, country: row.input.country, sector: row.input.sector },
    { anthropic, model: cfg.gateModel },
  );
  const cost = llmCostUsd(cfg.gateModel, g.llmInputTokens, g.llmOutputTokens) + g.searchCalls * cfg.searchCostUsd;
  return {
    status: g.decision.status,
    patch: { gate: { status: g.decision.status, reason: g.decision.reason, evidence: g.decision.evidence, pages_fetched: g.pagesFetched } },
    usage: { cost_usd: cost, search_calls: g.searchCalls, llm_input_tokens: g.llmInputTokens, llm_output_tokens: g.llmOutputTokens },
  };
};

let stopping = false;
let wake: (() => void) | null = null;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`[worker] ${sig}: finishing the current check, then stopping`);
    stopping = true;
    wake?.();   // cut an idle wait short
  });
}
const idle = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); wake = () => { clearTimeout(t); r(); }; });

async function main() {
  console.log(`[worker] ${cfg.workerId} started (poll ${cfg.pollMs} ms, lease ${cfg.leaseSeconds} s, max run ${cfg.maxRunMs / 1000} s)`);
  while (!stopping) {
    let worked = false;
    try {
      worked = await processOne(queue, execute, { leaseSeconds: cfg.leaseSeconds, maxRunMs: cfg.maxRunMs, model: cfg.gateModel });
    } catch (e) {
      console.error(`[worker] queue error: ${String(e)}`);   // e.g. Supabase unreachable: wait and try again
    }
    if (!worked && !stopping) await idle(cfg.pollMs);
  }
  console.log("[worker] stopped");
}

main();
