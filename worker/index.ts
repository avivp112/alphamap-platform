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
// A finished company enters AlphaMap only after an admin approves it
// (worker/promote.ts). "Deepen this profile" runs the same research on a
// company already in AlphaMap (worker/deepen.ts).
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { loadConfig, ConfigError, type WorkerConfig } from "./config.ts";
import { Queue } from "./queue.ts";
import { processOne, type Execute, type Meter } from "./runner.ts";
import { runGates } from "./gates.ts";
import { runIdentify, fetchSiteMeta } from "./identify.ts";
import { serperSearch } from "./search.ts";
import { runEnrichment, runCollection } from "./enrich.ts";
import { buildProfile, investorNames } from "./profile.ts";
import { promoteOne, serializeCollected, domainIndex } from "./promote.ts";
import { runDeepen, loadCompany, applyDirectWrites } from "./deepen.ts";
import { boardsBatch, logBoardRun } from "./boards.ts";
import { writeCollected, newWriteSummary, BULK_THRESHOLDS } from "../lib/enrichment/writeCompany.ts";
import { loadSectorTaxonomy, type SectorTaxonomy } from "../lib/enrichment/extractProfile.ts";
import { isDistinctiveName } from "../lib/enrichment/entity.ts";
import { PermanentError } from "./retry.ts";
import { PHASE1_PASSED } from "../lib/enrichment/writeGate.ts";

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
    // "Zero", "Atlas": names many companies share — the app asks for the website (2026-10-18, zero.ai).
    return { status: "awaiting_confirmation", patch: { candidates, progress: { generic_name: !isDistinctiveName(row.input.name) } } };
  }
  if (row.kind === "deepen") {
    // A company already in AlphaMap: no identify phase, no threshold checks (worker/deepen.ts).
    const progress = (stage: string) => { void queue.patch(row.id, { progress: { stage, at: new Date().toISOString() } }).catch(() => {}); };
    return runDeepen(row, {
      loadCompany: (id) => loadCompany(db, id),
      collect: async (c, onStage) => runCollection(c.row, c.rounds, { anthropic, model: cfg.enrichModel, taxonomy: await taxonomy(), meter, onStage }),
      // Until v2 passes Phase 1 nothing is written without an admin (lib/enrichment/writeGate.ts):
      // what would have been written directly goes into the proposal instead.
      applyDirectWrites: async (id, w) => (PHASE1_PASSED ? applyDirectWrites(db, id, w) : []),
      dryRunWrite: async (r, c) => writeCollected(r, c, {
        db, dryRun: true, update: false, verbose: false, thresholds: BULK_THRESHOLDS,
        taxonomy: await taxonomy(), startupByDomain: await domainIndex(db), seen: null,
      }, newWriteSummary()),
      investorFacts: (names) => queue.investorFacts(names),
      proposeUpdate: (checkId, startupId, c, diff) => queue.proposeUpdate(checkId, startupId, serializeCollected(c), diff),
      progress,
    });
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
    // Into AlphaMap only with an admin's approval (worker/promote.ts).
    after: () => queue.proposePromotion(row.id, serializeCollected(collected)),
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

// Job boards: is each one really the company's (worker/boards.ts)? A few at a
// time, between users' checks. BOARD_CHECK=false turns it off.
const BOARD_CHECK = process.env.BOARD_CHECK !== "false";
const BOARD_CHECK_EVERY_MS = Number(process.env.BOARD_CHECK_EVERY_MS ?? 60_000);
const BOARD_BATCH = Number(process.env.BOARD_BATCH ?? 3);
let lastBoardsAt = 0;
let lastEmptyBoardLogAt = 0;

async function boardsTurn(): Promise<void> {
  if (!BOARD_CHECK || Date.now() - lastBoardsAt < BOARD_CHECK_EVERY_MS) return;
  lastBoardsAt = Date.now();
  const started = new Date();
  try {
    const r = await boardsBatch({ db, jinaKey: process.env.JINA_API_KEY }, BOARD_BATCH);
    const empty = r.checked === 0 && r.scanned === 0;
    // An empty turn is logged at most hourly: enough for the daily health check.
    if (!empty || Date.now() - lastEmptyBoardLogAt > 3_600_000) {
      await logBoardRun(db, r, null, started);
      if (empty) lastEmptyBoardLogAt = Date.now();
    }
  } catch (e) {
    console.error(`[worker] boards: ${String(e)}`);
    await logBoardRun(db, null, String(e).slice(0, 500), started);
  }
}

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
      // Users' checks first; an approved company is written when none is waiting.
      if (!worked) worked = await promoteOne({
        db, taxonomy, loadCompany: (id) => loadCompany(db, id), findExisting: (w) => queue.findExisting(w), notify: (...a) => queue.notify(...a),
      });
    } catch (e) {
      console.error(`[worker] queue error: ${String(e)}`);   // e.g. Supabase unreachable: wait and try again
    }
    if (!worked && !stopping) await boardsTurn();
    if (!worked && !stopping) await idle(cfg.pollMs);
  }
  console.log("[worker] stopped");
}

main();
