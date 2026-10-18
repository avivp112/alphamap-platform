// =============================================================================
// AlphaMap check worker — drains the company_checks queue.
//
// Runs on a small server of its own (Railway or Fly.io — worker/README.md),
// never on CI runners. Holds the only copy of SUPABASE_SERVICE_ROLE_KEY
// outside Supabase itself.
//
// Two phases per check: identify (worker/identify.ts — one search for "is
// this the company?") and, once the user confirms, the threshold checks
// (worker/gates.ts) and, when they pass, the research itself: enrichment
// v2's collection on that one company (worker/enrich.ts, worker/profile.ts).
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { loadConfig, ConfigError, type WorkerConfig } from "./config.ts";
import { Queue } from "./queue.ts";
import { processOne, type Execute, type Meter } from "./runner.ts";
import { runGates } from "./gates.ts";
import { runIdentify, fetchSiteMeta } from "./identify.ts";
import { serperSearch } from "./search.ts";
import { runEnrichment } from "./enrich.ts";
import { buildProfile, investorNames } from "./profile.ts";
import { loadSectorTaxonomy, type SectorTaxonomy } from "../lib/enrichment/extractProfile.ts";
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
  const gate = { status: g.decision.status, reason: g.decision.reason, evidence: g.decision.evidence, pages_fetched: g.pagesFetched };
  const name = row.input.name;
  if (g.decision.status !== "ready") {
    return { status: g.decision.status, patch: { gate }, notify: verdictNotice(g.decision.status, name) };
  }

  // Passed: the verdict shows at once, the research follows (stage 3).
  await queue.patch(row.id, { gate, progress: { stage: "starting", at: new Date().toISOString() } });
  const onStage = (stage: string, detail?: Record<string, unknown>) => {
    void queue.patch(row.id, { progress: { stage, ...detail, at: new Date().toISOString() } }).catch(() => {});
  };
  const collected = await runEnrichment(
    { checkId: row.id, name, website: row.input.website, country: row.input.country, founder: row.input.founder },
    { anthropic, model: cfg.enrichModel, taxonomy: await taxonomy(), meter, onStage },
  );
  switch (collected.outcome) {
    case "collected": break;
    case "public":
      return { status: "rejected_public", patch: { gate: { ...gate, status: "rejected_public",
        reason: "Publicly listed, per the research.", evidence: { ...gate.evidence, listing: collected.listing } } },
        notify: verdictNotice("rejected_public", name) };
    case "rejected":
      return { status: "rejected_non_tech", patch: { gate: { ...gate, status: "rejected_non_tech",
        reason: "The research shows the company is not technology-driven." } }, notify: verdictNotice("rejected_non_tech", name) };
    case "no_data": case "low_evidence": case "no_change":
      return { status: "stealth", patch: { gate: { ...gate, status: "stealth",
        reason: "The research found too little public information to build a profile." } }, notify: verdictNotice("stealth", name) };
    case "error":
      throw new Error(`enrichment: ${collected.reason}`);   // a malformed model answer: worth one more attempt
  }

  const profile = buildProfile(collected, name);
  await queue.patch(row.id, { result: { profile }, progress: { stage: "investors", at: new Date().toISOString() } });
  const { names, led } = investorNames(profile);
  const facts = (await queue.investorFacts(names)).map((f) => ({ ...f, led_here: led.has(f.name.toLowerCase()) }));
  return {
    status: "done",
    patch: { result: { investors: facts }, progress: { stage: "done", at: new Date().toISOString() } },
    notify: verdictNotice("done", name),
  };
};

/** The owner's bell line for a finished check. */
function verdictNotice(status: string, name: string): { title: string; body: string } {
  switch (status) {
    case "done": return { title: `${name}: profile ready`, body: "The research on the company you checked is ready (unverified)." };
    case "stealth": return { title: `${name}: probably in stealth`, body: "Very little public information about this company yet." };
    case "rejected_public": return { title: `${name}: a public company`, body: "AlphaMap covers private companies only." };
    case "rejected_non_tech": return { title: `${name}: not a technology company`, body: "AlphaMap covers technology companies only." };
    default: return { title: `${name}: check finished`, body: "See the result." };
  }
}

// The sector list, loaded once (enrichment v2 classifies against it).
let taxonomyCache: SectorTaxonomy | null = null;
const taxonomy = async (): Promise<SectorTaxonomy> => (taxonomyCache ??= await loadSectorTaxonomy(db));

const cost = (m: Meter) => m.llmCostUsd + m.searchCalls * cfg.searchCostUsd;

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
