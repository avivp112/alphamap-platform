#!/usr/bin/env node
/**
 * scripts/pilot_sample.ts — the companies of a partial wet run (owner,
 * 2026-11-01): 20 at random from AlphaMap, at least 5 small or thin on data
 * and at least 5 Israeli (HQ or founded in Israel), each with a website.
 * Reads only. Prints the list, what each holds now in the pilot's fields,
 * and the ONLY=… line for scripts/bulk_enrich_v2.ts; saves it to pilot_companies.json.
 *
 *   npx tsx scripts/pilot_sample.ts            # SIZE=20, SEED=<number> for a repeatable draw
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { PILOT_FIELDS, PILOT_MAX_COMPANIES } from "../lib/enrichment/writeGate.ts";
import { drawPilotSample, type PilotCandidate } from "../lib/enrichment/pilotSample.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(__dir, "..", ".env"))) config({ path: join(__dir, "..", ".env") });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const SIZE = Math.min(Number(process.env.SIZE ?? 20), PILOT_MAX_COMPANIES);
const SEED = Number(process.env.SEED ?? Date.now() % 100000);
const db = createClient(url, key, { auth: { persistSession: false } });

(async () => {
  const rows: PilotCandidate[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("startups")
      .select("id, name, website, description, city, country, founded_year, founding_country, status")
      .not("website", "is", null).neq("status", "ipo").range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as PilotCandidate[]));
    if (!data || data.length < 1000) break;
  }
  const sample = drawPilotSample(rows, { size: SIZE, minThin: 5, minIsraeli: 5, seed: SEED });
  console.log(`Pilot sample — ${sample.length} of ${rows.length} companies with a website (seed ${SEED}). Fields: ${PILOT_FIELDS.join(", ")}\n`);
  for (const s of sample) {
    console.log(`  ${s.name.padEnd(32)} ${(s.website ?? "").padEnd(32)} ${s.why.join("+").padEnd(14)} city=${s.city ?? "—"} country=${s.country ?? "—"} founded=${s.founded_year ?? "—"} founded_in=${s.founding_country ?? "—"}`);
  }
  writeFileSync("pilot_companies.json", JSON.stringify({ seed: SEED, drawn_at: new Date().toISOString(), companies: sample }, null, 2));
  console.log(`\nSaved pilot_companies.json. Dry run:\n  PILOT=true ONLY=${sample.map((s) => s.id).join(",")} npx tsx scripts/bulk_enrich_v2.ts`);
})().catch((e) => { console.error(e); process.exit(1); });
