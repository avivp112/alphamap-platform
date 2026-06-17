#!/usr/bin/env node
/**
 * agent_vcs.ts — VC investor profile ingestion agent
 *
 * Strategy: "Internal Aggregator" — no external paid APIs required.
 *
 *  1. Each VC has a curated baseline sector_allocation (0–100 scores per domain)
 *     derived from public knowledge of their known thesis.
 *  2. The agent then queries our own `deals` table, finds every deal where that
 *     VC appears in the `investors[]` column, and computes a live signal from the
 *     actual sector distribution of those deals.
 *  3. Final allocation = 70 % curated baseline + 30 % live DB signal
 *     (the weighting ensures the profile is meaningful even with sparse deal data).
 *  4. Upsert all profiles into the `investors` table (idempotent — safe to re-run).
 *
 * Usage:
 *   npx tsx scripts/agent_vcs.ts                # dry run (default)
 *   DRY_RUN=false npx tsx scripts/agent_vcs.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config }        from "dotenv";
import { existsSync }    from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Bootstrap .env ────────────────────────────────────────────────────────────
const __dir   = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

// ── Config ────────────────────────────────────────────────────────────────────
const DRY_RUN = process.env.DRY_RUN !== "false";

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) { console.error(`❌  Missing env var: ${k}`); process.exit(1); }
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Types ─────────────────────────────────────────────────────────────────────
type RadarKey = "AI" | "FinTech" | "Cyber" | "SaaS" | "HealthTech" | "FoodTech";

const RADAR_KEYS: RadarKey[] = ["AI", "FinTech", "Cyber", "SaaS", "HealthTech", "FoodTech"];

type SectorAllocation = Record<RadarKey, number>;

interface VCProfile {
  name:                string;
  aliases:             string[];    // all forms this VC name appears as in our deals table
  slug:                string;
  description:         string;
  founded_year:        number;
  headquarters:        string;
  fund_size:           string;
  typical_check_size:  string;
  portfolio_size:      number;
  stages:              string[];
  baseline_allocation: SectorAllocation;
  notable_investments: string[];
  website:             string;
}

// ── Deals-sector → radar key mapping ─────────────────────────────────────────
// Maps the `sector` values stored in our deals table to the 6 radar axes.
const SECTOR_MAP: Record<string, RadarKey> = {
  "AI & ML":            "AI",
  "AI":                 "AI",
  "DeepTech":           "AI",
  "Fintech":            "FinTech",
  "FinTech":            "FinTech",
  "Blockchain":         "FinTech",
  "Cybersecurity":      "Cyber",
  "Security":           "Cyber",
  "SaaS":               "SaaS",
  "Enterprise Software":"SaaS",
  "Cloud":              "SaaS",
  "HealthTech":         "HealthTech",
  "Health & Life Sciences": "HealthTech",
  "BioTech":            "HealthTech",
  "FoodTech":           "FoodTech",
  "AgTech":             "FoodTech",
  "Consumer & Media":   "FoodTech",   // loose catch-all for the sixth axis
};

// ── Curated VC roster ─────────────────────────────────────────────────────────
// baseline_allocation: expert-curated thesis scores that remain stable even
// before our deals DB is populated. These represent where each firm is KNOWN
// to deploy capital, not just what they claim on their website.
const VC_PROFILES: VCProfile[] = [
  {
    name:               "Sequoia Capital",
    aliases:            ["Sequoia Capital", "Sequoia", "Sequoia Capital India", "Sequoia Capital China"],
    slug:               "SEQ",
    description:        "One of Silicon Valley's founding venture firms, Sequoia has backed companies responsible for more than 25% of NASDAQ's total value. Its Global Equities program and Arc accelerator reflect a rare full-stack model from pre-seed to public markets.",
    founded_year:       1972,
    headquarters:       "Menlo Park, CA",
    fund_size:          "$85B+ AUM",
    typical_check_size: "$1M – $100M",
    portfolio_size:     1500,
    stages:             ["Pre-Seed", "Seed", "Series A", "Series B", "Growth", "Public"],
    baseline_allocation:{ AI: 88, FinTech: 72, Cyber: 58, SaaS: 92, HealthTech: 62, FoodTech: 28 },
    notable_investments:["Apple", "Google", "GitHub", "Stripe", "Airbnb", "Klarna", "Unity"],
    website:            "https://www.sequoiacap.com",
  },
  {
    name:               "Andreessen Horowitz",
    aliases:            ["Andreessen Horowitz", "a16z", "A16Z"],
    slug:               "a16z",
    description:        "a16z pioneered the 'full-stack VC' concept — combining capital with a proprietary talent network, go-to-market support, and regulatory affairs teams. Its dedicated crypto, bio, and American Dynamism funds signal explicit sector conviction.",
    founded_year:       2009,
    headquarters:       "Menlo Park, CA",
    fund_size:          "$42B AUM",
    typical_check_size: "$500K – $50M",
    portfolio_size:     900,
    stages:             ["Seed", "Series A", "Series B", "Growth"],
    baseline_allocation:{ AI: 90, FinTech: 80, Cyber: 65, SaaS: 85, HealthTech: 70, FoodTech: 22 },
    notable_investments:["Facebook", "Lyft", "Coinbase", "GitHub", "Roblox", "OpenAI"],
    website:            "https://a16z.com",
  },
  {
    name:               "Accel",
    aliases:            ["Accel", "Accel Partners", "Accel Ventures"],
    slug:               "ACC",
    description:        "Accel is a global venture firm with a laser focus on infrastructure, security, and SaaS. Its early bet on Dropbox, Facebook, and Slack established a pattern of identifying category-defining enterprise and consumer platforms before they break out.",
    founded_year:       1983,
    headquarters:       "Palo Alto, CA",
    fund_size:          "$20B+ AUM",
    typical_check_size: "$500K – $30M",
    portfolio_size:     600,
    stages:             ["Seed", "Series A", "Series B", "Series C"],
    baseline_allocation:{ AI: 70, FinTech: 60, Cyber: 82, SaaS: 90, HealthTech: 45, FoodTech: 18 },
    notable_investments:["Facebook", "Slack", "Dropbox", "Crowdstrike", "Atlassian", "Spotify"],
    website:            "https://www.accel.com",
  },
  {
    name:               "Lightspeed Venture Partners",
    aliases:            ["Lightspeed", "Lightspeed Venture Partners", "Lightspeed India"],
    slug:               "LSP",
    description:        "Lightspeed operates four global platforms — US, Europe, India, and China — enabling it to identify cross-border opportunities and back companies at Seed through late-stage. Strong thesis in consumer internet and enterprise AI.",
    founded_year:       2000,
    headquarters:       "Menlo Park, CA",
    fund_size:          "$25B AUM",
    typical_check_size: "$1M – $20M",
    portfolio_size:     500,
    stages:             ["Seed", "Series A", "Series B", "Growth"],
    baseline_allocation:{ AI: 75, FinTech: 68, Cyber: 52, SaaS: 80, HealthTech: 58, FoodTech: 45 },
    notable_investments:["Snapchat", "Affirm", "Nutanix", "MuleSoft", "Epic Games", "Razorpay"],
    website:            "https://lsvp.com",
  },
  {
    name:               "Benchmark",
    aliases:            ["Benchmark", "Benchmark Capital"],
    slug:               "BNK",
    description:        "Benchmark's equal-partnership model and deliberate small-fund strategy ($425M funds) is a philosophical outlier in an era of mega-funds. Their concentrated bets and board-level conviction produced Uber, Twitter, Snap, and Discord.",
    founded_year:       1995,
    headquarters:       "San Francisco, CA",
    fund_size:          "$425M per fund",
    typical_check_size: "$5M – $25M",
    portfolio_size:     250,
    stages:             ["Series A", "Series B"],
    baseline_allocation:{ AI: 62, FinTech: 55, Cyber: 40, SaaS: 78, HealthTech: 42, FoodTech: 30 },
    notable_investments:["Uber", "Twitter", "Snap", "Discord", "Stitch Fix", "Zillow"],
    website:            "https://www.benchmark.com",
  },
];

// ── Internal Aggregator ───────────────────────────────────────────────────────
/**
 * Queries our own `deals` table for investments matching this VC's known aliases,
 * computes a sector distribution from the real deal data, and blends it with the
 * curated baseline (70 % baseline, 30 % live signal).
 *
 * This keeps profiles useful from day one (baseline) while automatically improving
 * as our deals database grows richer.
 */
async function computeSectorAllocation(
  vcName: string,
  aliases: string[],
  baseline: SectorAllocation,
): Promise<SectorAllocation> {
  const { data, error } = await supabase
    .from("deals")
    .select("sector")
    .overlaps("investors", aliases)
    .not("sector", "is", null);

  if (error) {
    console.warn(`  ⚠️  DB query error for ${vcName}: ${error.message} — using baseline`);
    return baseline;
  }

  const dealCount = data?.length ?? 0;
  if (dealCount === 0) {
    console.log(`  ℹ️  No matching deals in DB for ${vcName} — using curated baseline`);
    return baseline;
  }

  // Tally deals per radar axis
  const counts: Record<RadarKey, number> = { AI: 0, FinTech: 0, Cyber: 0, SaaS: 0, HealthTech: 0, FoodTech: 0 };
  let mapped = 0;
  for (const deal of data!) {
    const key = SECTOR_MAP[deal.sector as string];
    if (key) { counts[key]++; mapped++; }
  }

  if (mapped === 0) {
    console.log(`  ℹ️  ${dealCount} deals found for ${vcName} but none map to radar axes — using baseline`);
    return baseline;
  }

  // Normalise counts → 0-100 scores
  const maxCount = Math.max(1, ...Object.values(counts));
  const dbScores: SectorAllocation = {} as SectorAllocation;
  for (const k of RADAR_KEYS) {
    dbScores[k] = Math.round((counts[k] / maxCount) * 100);
  }

  // Blend: 70% curated knowledge + 30% empirical DB signal
  const blended: SectorAllocation = {} as SectorAllocation;
  for (const k of RADAR_KEYS) {
    blended[k] = Math.round(0.7 * baseline[k] + 0.3 * dbScores[k]);
  }

  console.log(`  📊  ${vcName}: ${dealCount} deals matched (${mapped} mapped) → blended allocation computed`);
  return blended;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🤖  AlphaMap VC Ingestion Agent`);
  console.log(`   Mode : ${DRY_RUN ? "DRY RUN (set DRY_RUN=false to write)" : "LIVE WRITE"}`);
  console.log(`   VCs  : ${VC_PROFILES.map(v => v.name).join(", ")}\n`);

  const tally = { processed: 0, upserted: 0, errors: 0 };

  for (const vc of VC_PROFILES) {
    console.log(`\n▶  ${vc.name}`);

    // ── Step 1: compute live sector allocation via internal aggregator
    const sector_allocation = await computeSectorAllocation(
      vc.name,
      vc.aliases,
      vc.baseline_allocation,
    );

    // ── Step 2: assemble the row
    const row = {
      name:                vc.name,
      slug:                vc.slug,
      description:         vc.description,
      founded_year:        vc.founded_year,
      headquarters:        vc.headquarters,
      fund_size:           vc.fund_size,
      typical_check_size:  vc.typical_check_size,
      portfolio_size:      vc.portfolio_size,
      stages:              vc.stages,
      sector_allocation,
      notable_investments: vc.notable_investments,
      website:             vc.website,
      updated_at:          new Date().toISOString(),
    };

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would upsert:`);
      console.log(`    sector_allocation: ${JSON.stringify(sector_allocation)}`);
      tally.processed++;
      continue;
    }

    // ── Step 3: upsert (conflict on name → update everything)
    const { error } = await supabase
      .from("investors")
      .upsert(row, { onConflict: "name" });

    if (error) {
      console.error(`  ❌  Upsert failed: ${error.message}`);
      tally.errors++;
    } else {
      console.log(`  ✅  Upserted → sector: ${JSON.stringify(sector_allocation)}`);
      tally.upserted++;
    }
    tally.processed++;
  }

  console.log(`\n── Summary ──────────────────────────────────────────`);
  console.log(`   Processed : ${tally.processed}`);
  console.log(`   Upserted  : ${tally.upserted}`);
  console.log(`   Errors    : ${tally.errors}`);
  console.log(`────────────────────────────────────────────────────\n`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
