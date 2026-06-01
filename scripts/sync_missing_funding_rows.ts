#!/usr/bin/env node
/**
 * sync_missing_funding_rows.ts
 *
 * Database integrity check: finds every startup that has no row in
 * funding_rounds and inserts a stub { round_type: "Other" } so no
 * company is orphaned in the UI.
 *
 * No web searches, no LLM calls — pure DB read + write.
 *
 * Usage:
 *   npx tsx scripts/sync_missing_funding_rows.ts            # dry run
 *   DRY_RUN=false npx tsx scripts/sync_missing_funding_rows.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) {
    console.error(`❌  Missing required env var: ${key}`);
    process.exit(1);
  }
}

const DRY_RUN = process.env.DRY_RUN !== "false";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   AlphaMap — Sync Missing Funding Rows               ║");
  console.log(`║   ${new Date().toISOString()}           ║`);
  console.log(`║   DRY_RUN=${String(DRY_RUN).padEnd(47)}║`);
  console.log("╚══════════════════════════════════════════════════════╝\n");

  if (DRY_RUN) {
    console.log("ℹ️  DRY RUN — no writes will be made.");
    console.log("    Re-run with  DRY_RUN=false  to apply.\n");
  }

  // 1. Fetch all startups
  const { data: startups, error: sErr } = await supabase
    .from("startups")
    .select("id, name")
    .order("name");

  if (sErr) {
    console.error("❌  Failed to fetch startups:", sErr.message);
    process.exit(1);
  }

  // 2. Fetch all funding_rounds startup_ids (distinct is enough)
  const { data: rounds, error: rErr } = await supabase
    .from("funding_rounds")
    .select("startup_id");

  if (rErr) {
    console.error("❌  Failed to fetch funding_rounds:", rErr.message);
    process.exit(1);
  }

  const coveredIds = new Set((rounds ?? []).map((r) => r.startup_id as string));

  // 3. Identify gaps
  const missing = (startups ?? []).filter((s) => !coveredIds.has(s.id));

  console.log(`📊  Startups total:          ${(startups ?? []).length}`);
  console.log(`📊  funding_rounds rows:     ${(rounds ?? []).length}`);
  console.log(`📊  Unique startup_ids:      ${coveredIds.size}`);
  console.log(`🔍  Missing from rounds:     ${missing.length}\n`);

  if (missing.length === 0) {
    console.log("✅  All startups already have at least one funding_rounds row.\n");
    console.log(`Found 0 missing startups. Added 0 rows.`);
    return;
  }

  console.log("Companies missing a funding_rounds row:");
  for (const s of missing) {
    console.log(`  • ${s.name.padEnd(35)} ${s.id}`);
  }
  console.log();

  // 4. Insert stubs
  let added = 0;
  let failed = 0;

  for (const s of missing) {
    if (DRY_RUN) {
      console.log(`  [DRY] Would insert stub for: ${s.name}`);
      added++;
      continue;
    }

    const { error: insertErr } = await supabase
      .from("funding_rounds")
      .insert({
        startup_id:    s.id,
        round_type:    "Other",
        amount_raised: null,
      });

    if (insertErr) {
      console.error(`  ❌  Insert failed for ${s.name}: ${insertErr.message}`);
      failed++;
    } else {
      console.log(`  ✅  Stub inserted: ${s.name}`);
      added++;
    }
  }

  // 5. Summary
  console.log("\n" + "═".repeat(58));
  console.log(`Found ${missing.length} missing startups. Added ${added} rows.`);
  if (failed > 0)  console.log(`Failures: ${failed}`);
  if (DRY_RUN)     console.log("(Dry run — re-run with DRY_RUN=false to apply.)");
  console.log("═".repeat(58) + "\n");

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("💥  Fatal error:", e);
  process.exit(1);
});
