#!/usr/bin/env node
/**
 * sync_startups.ts — one-time utility to ensure every tracked company
 * has a row in the 'startups' table.
 *
 * Sources scanned:
 *   1. scripts/watchlist.json  — the authoritative list of 100 companies we follow
 *   2. funding_rounds table    — referential integrity audit (startup_id FK means
 *                                every round already has a parent; this is a sanity check)
 *
 * For every name in the watchlist that has no matching row in 'startups', a
 * stub row is inserted with:
 *   - name              → company name (trimmed)
 *   - all profile fields → NULL  (autopilot ENRICH picks them up immediately)
 *   - updated_at        → 30 days ago  (clears the 24h cooldown; autopilot sees it as stale)
 *   - created_at        → now()
 *
 * Usage:
 *   npx tsx scripts/sync_startups.ts              # dry run (default)
 *   DRY_RUN=false npx tsx scripts/sync_startups.ts   # apply inserts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const __dir   = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) {
    console.error(`❌  Missing required env var: ${key}`);
    process.exit(1);
  }
}

const DRY_RUN = process.env.DRY_RUN !== "false"; // safe default: dry run

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Types ─────────────────────────────────────────────────────────────────────
interface StartupRow { id: string; name: string }
interface RoundRow   { startup_id: string }

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalize(name: string): string {
  return name.toLowerCase().trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║         AlphaMap — Sync Startups Table               ║");
  console.log(`║         ${new Date().toISOString()}           ║`);
  console.log(`║         DRY_RUN=${String(DRY_RUN).padEnd(46)}║`);
  console.log("╚══════════════════════════════════════════════════════╝\n");

  if (DRY_RUN) {
    console.log("ℹ️  DRY RUN — no writes will happen. Set DRY_RUN=false to apply.\n");
  }

  // ── 1. Load watchlist ───────────────────────────────────────────────────────
  const watchlistPath = join(__dir, "watchlist.json");
  if (!existsSync(watchlistPath)) {
    console.error("❌  scripts/watchlist.json not found — nothing to sync.");
    process.exit(1);
  }
  const watchlist: string[] = JSON.parse(readFileSync(watchlistPath, "utf-8"));
  const watchlistNorm = new Set(watchlist.map(normalize));
  console.log(`📋  Watchlist: ${watchlist.length} company names\n`);

  // ── 2. Fetch all existing startup rows ─────────────────────────────────────
  const { data: existingRows, error: startupErr } = await supabase
    .from("startups")
    .select("id, name");

  if (startupErr) {
    console.error("❌  Failed to fetch startups:", startupErr.message);
    process.exit(1);
  }

  const existing = (existingRows ?? []) as StartupRow[];
  const existingByNorm = new Map(existing.map((r) => [normalize(r.name), r]));
  console.log(`🗄️   Startups already in DB: ${existing.length}`);

  // ── 3. Referential integrity audit on funding_rounds ───────────────────────
  // funding_rounds.startup_id is a FK → startups.id (ON DELETE CASCADE),
  // so orphaned rounds cannot exist by schema constraint. We audit anyway.
  const { data: roundRows, error: roundErr } = await supabase
    .from("funding_rounds")
    .select("startup_id");

  if (roundErr) {
    console.warn("⚠️  Could not audit funding_rounds:", roundErr.message);
  } else {
    const roundStartupIds = new Set((roundRows ?? []).map((r: RoundRow) => r.startup_id));
    const existingIds     = new Set(existing.map((r) => r.id));
    const orphaned        = [...roundStartupIds].filter((id) => !existingIds.has(id));

    if (orphaned.length > 0) {
      console.warn(`⚠️  Found ${orphaned.length} funding_round rows with no matching startup! IDs:`);
      orphaned.forEach((id) => console.warn(`    ${id}`));
    } else {
      console.log(`✅  funding_rounds integrity OK — all ${roundStartupIds.size} referenced startups exist`);
    }
  }

  // ── 4. Identify watchlist companies missing from startups ──────────────────
  const toInsert = watchlist.filter((name) => !existingByNorm.has(normalize(name)));

  console.log(`\n🆕  Watchlist companies missing from startups: ${toInsert.length}`);

  if (toInsert.length === 0) {
    console.log("\n✅  All watchlist companies are already in the startups table.\n");
    return;
  }

  // ── 5. Report what will be inserted ────────────────────────────────────────
  console.log("\nCompanies to stub-insert:");
  toInsert.forEach((name) => console.log(`  • ${name}`));

  // ── 6. Insert stub rows ─────────────────────────────────────────────────────
  // updated_at is set 30 days in the past so the autopilot's 24h cooldown
  // is already cleared and the row is immediately eligible for ENRICH.
  const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  let inserted = 0;
  let skipped  = 0;
  let failed   = 0;

  if (!DRY_RUN) {
    console.log("\nInserting…");
    for (const name of toInsert) {
      // Double-check by exact name in case of case-variation duplicates
      const { data: dup } = await supabase
        .from("startups")
        .select("id")
        .ilike("name", name.trim())
        .maybeSingle();

      if (dup) {
        console.log(`  ⏭️   Skip (already exists, case variant): ${name}`);
        skipped++;
        continue;
      }

      const { error } = await supabase.from("startups").insert({
        name:       name.trim(),
        updated_at: THIRTY_DAYS_AGO,
        // all profile fields intentionally omitted (NULL) so autopilot enriches them
      });

      if (error) {
        console.error(`  ❌  Failed: ${name} — ${error.message}`);
        failed++;
      } else {
        console.log(`  ✅  Inserted: ${name}`);
        inserted++;
      }
    }
  }

  // ── 7. Summary ──────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(58));
  if (DRY_RUN) {
    console.log(`DRY RUN — ${toInsert.length} rows would be inserted.`);
    console.log("Watchlist total: " + watchlist.length);
    console.log("Already in DB:   " + (watchlist.length - toInsert.length));
    console.log("Would insert:    " + toInsert.length);
    console.log("\nRun with DRY_RUN=false to apply.");
  } else {
    console.log(`Inserted:  ${inserted}`);
    console.log(`Skipped:   ${skipped}  (case-variant duplicates)`);
    console.log(`Failed:    ${failed}`);
    console.log(`Total processed: ${toInsert.length}`);
  }
  console.log("═".repeat(58) + "\n");

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("💥  Fatal error:", e);
  process.exit(1);
});
