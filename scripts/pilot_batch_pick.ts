#!/usr/bin/env node
/**
 * scripts/pilot_batch_pick.ts — the five companies of the next wet batch (owner, 2026-11-09). Reads only. New companies (not in
 * pilot_companies.json or an earlier pilot_batch_*.json), at least one Israeli, one European, one American, one thin and one
 * data-rich. Saves pilot_batch_<N>.json (never pilot_companies.json) and prints the ids line.
 *
 *   N=3 npx tsx scripts/pilot_batch_pick.ts        # SEED=<number> for a repeatable pick; SIZE=25 for a batch of 25 (the most a pilot may write)
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { pickBatch, shuffled } from "../lib/enrichment/pilotBatchPick.ts";
import { dataGroup, spreadPick, type DataGroup } from "../lib/enrichment/dataGroups.ts";
import type { PilotCandidate } from "../lib/enrichment/pilotSample.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(__dir, "..", ".env"))) config({ path: join(__dir, "..", ".env") });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const N = process.env.N ?? "3";
// GROUP=empty|partial|full: the batch comes from that group of v1 data (dataGroups.ts), spread over the countries of the websites' domains (owner, 2026-11-13).
const GROUP = (process.env.GROUP ?? "") as DataGroup | "";
if (GROUP && !["empty", "partial", "full"].includes(GROUP)) { console.error("GROUP must be empty, partial or full."); process.exit(1); }
const SIZE = Math.min(Number(process.env.SIZE ?? 5), 25);   // a pilot writes at most 25 companies (writeGate.ts)
const SEED = Number(process.env.SEED ?? Date.now() % 100000);
const db = createClient(url, key, { auth: { persistSession: false } });

const exclude = new Set<string>();
for (const f of ["pilot_companies.json", ...readdirSync(".").filter((x) => /^pilot_batch_\d+\.json$/.test(x))]) {
  if (!existsSync(f)) continue;
  for (const c of (JSON.parse(readFileSync(f, "utf8")).companies ?? []) as Array<{ id: string }>) exclude.add(c.id);
}

(async () => {
  const rows: PilotCandidate[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("startups")
      .select("id, name, website, description, city, country, founded_year, founding_country, status, founders, leadership")
      .not("website", "is", null).neq("status", "ipo").range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as PilotCandidate[]));
    if (!data || data.length < 1000) break;
  }
  let batch: Array<PilotCandidate & { why: string[] }>;
  if (GROUP) {
    // The rounds on file, counted by company (a page of ids at a time).
    const rounds = new Map<string, number>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("funding_rounds").select("startup_id").range(from, from + 999);
      if (error) throw error;
      for (const r of (data ?? []) as Array<{ startup_id: string }>) rounds.set(r.startup_id, (rounds.get(r.startup_id) ?? 0) + 1);
      if (!data || data.length < 1000) break;
    }
    const sizes: Record<DataGroup, number> = { empty: 0, partial: 0, full: 0 };
    const inGroup = rows.filter((r) => r.website && r.status !== "ipo").filter((r) => { const g = dataGroup({ description: r.description, city: r.city, country: r.country, founded_year: r.founded_year, founders: r.founders as unknown[] | null, rounds: rounds.get(r.id) ?? 0 }); sizes[g]++; return g === GROUP; });
    console.log(`Groups among the companies with a website: empty ${sizes.empty} · partial ${sizes.partial} · full ${sizes.full}. Picking from ${GROUP} (not in an earlier batch: ${inGroup.filter((r) => !exclude.has(r.id)).length}).`);
    batch = spreadPick(shuffled(inGroup.filter((r) => !exclude.has(r.id)), SEED), SIZE).map((c) => ({ ...c, why: [GROUP, c.bucket] }));
  } else batch = pickBatch(rows, { size: SIZE, exclude, seed: SEED });
  console.log(`Batch ${N} — ${batch.length} new companies of ${rows.length} (seed ${SEED}); ${exclude.size} already in earlier batches excluded\n`);
  for (const c of batch) console.log(`  ${c.name.padEnd(30)} ${(c.website ?? "").padEnd(34)} ${c.why.join("+").padEnd(18)} country=${c.country ?? "—"} city=${c.city ?? "—"} founded=${c.founded_year ?? "—"}`);
  writeFileSync(`pilot_batch_${N}.json`, JSON.stringify({ seed: SEED, drawn_at: new Date().toISOString(), companies: batch }, null, 2));
  console.log(`\nSaved pilot_batch_${N}.json. Dry run:\n  PILOT=true DELAY_MS=5000 ONLY=${batch.map((c) => c.id).join(",")} FIELDS=news,round,patent,leader,competitor_declared npx tsx scripts/bulk_enrich_v2.ts`);
})().catch((e) => { console.error(e); process.exit(1); });
