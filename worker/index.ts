// =============================================================================
// AlphaMap check worker — drains the company_checks queue.
//
// Runs on a small server of its own (Railway or Fly.io — worker/README.md),
// never on CI runners. Holds the only copy of SUPABASE_SERVICE_ROLE_KEY
// outside Supabase itself.
//
// Two phases per check: identify (worker/identify.ts — one search for "is
// this the company?") and, once the user confirms, the threshold checks
// (worker/gates.ts). Stage 3 adds the enrichment after the checks pass.
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { loadConfig, llmCostUsd, ConfigError, type WorkerConfig } from "./config.ts";
import { Queue } from "./queue.ts";
import { processOne, type Execute, type Meter } from "./runner.ts";
import { runGates } from "./gates.ts";
import { runIdentify, fetchSiteMeta } from "./identify.ts";
import { serperSearch } from "./search.ts";
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

const search = (meter: Meter) => serperSearch(cfg.serpKey, meter);

const execute: Execute = async (row, meter) => {
  if (!row.input?.name) throw new PermanentError("check has no company name");
  if (row.phase === "identify") {
    const candidates = await runIdentify(
      { name: row.input.name, website: row.input.website, country: row.input.country, founder: row.input.founder },
      { search: search(meter), fetchSite: fetchSiteMeta, findExisting: (w) => queue.findExisting(w) },
    );
    return { status: "awaiting_confirmation", patch: { candidates } };
  }
  const g = await runGates(
    { name: row.input.name, website: row.input.website, country: row.input.country, sector: row.input.sector },
    { anthropic, model: cfg.gateModel, search: search(meter), meter },
  );
  return {
    status: g.decision.status,
    patch: { gate: { status: g.decision.status, reason: g.decision.reason, evidence: g.decision.evidence, pages_fetched: g.pagesFetched } },
  };
};

const cost = (m: Meter) => llmCostUsd(cfg.gateModel, m.llmInputTokens, m.llmOutputTokens) + m.searchCalls * cfg.searchCostUsd;

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
      worked = await processOne(queue, execute, { leaseSeconds: cfg.leaseSeconds, maxRunMs: cfg.maxRunMs, model: cfg.gateModel, cost });
    } catch (e) {
      console.error(`[worker] queue error: ${String(e)}`);   // e.g. Supabase unreachable: wait and try again
    }
    if (!worked && !stopping) await idle(cfg.pollMs);
  }
  console.log("[worker] stopped");
}

main();
