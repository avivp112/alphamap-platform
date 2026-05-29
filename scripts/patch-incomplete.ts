#!/usr/bin/env node
/**
 * One-time migration: patch incomplete startup rows using data already
 * present in Supabase — no web searches, no LLM calls.
 *
 * What it can derive from existing DB state:
 *   website  — root domain extracted from funding_rounds.source_url
 *              when the startup's own website field is NULL
 *
 * Everything else (description, employee_count, industry, city, country,
 * founders) requires external data and is printed as an enrichment report
 * for the autopilot to handle.
 *
 * Usage:
 *   npx tsx scripts/patch-incomplete.ts            # dry run (default)
 *   DRY_RUN=false npx tsx scripts/patch-incomplete.ts  # apply patches
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env from repo root if present
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

// ── Env guard ─────────────────────────────────────────────────────────────────
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
interface StartupRow {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  employee_count: number | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  founders: string[] | null;
}

interface RoundRow {
  startup_id: string;
  source_url: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract a clean https://domain root from any URL.
 * Returns null when the URL is unparseable or points to a news/media site
 * rather than the company's own domain.
 */
const MEDIA_DOMAINS = new Set([
  "techcrunch.com", "crunchbase.com", "bloomberg.com", "reuters.com",
  "forbes.com", "businessinsider.com", "wsj.com", "cnbc.com",
  "venturebeat.com", "theinformation.com", "axios.com", "ft.com",
  "nytimes.com", "wired.com", "fortune.com", "inc.com",
]);

function extractCompanyDomain(url: string): string | null {
  try {
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    const { hostname } = new URL(normalized);
    const host = hostname.replace(/^www\./, "");
    if (MEDIA_DOMAINS.has(host)) return null;  // skip press/news links
    return `https://${host}`;
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║       AlphaMap — Patch Incomplete Startup Rows       ║");
  console.log(`║       ${new Date().toISOString()}           ║`);
  console.log(`║       DRY_RUN=${String(DRY_RUN).padEnd(47)}║`);
  console.log("╚══════════════════════════════════════════════════════╝\n");

  if (DRY_RUN) {
    console.log("ℹ️  DRY RUN — no writes will be made.");
    console.log("    Re-run with  DRY_RUN=false  to apply patches.\n");
  }

  // ── 1. Fetch all startups that are missing any of the three target fields ──
  const { data: incompleteRows, error: fetchErr } = await supabase
    .from("startups")
    .select("id, name, website, description, employee_count, industry, country, city, founders")
    .or("website.is.null,description.is.null,employee_count.is.null")
    .order("name");

  if (fetchErr) {
    console.error("❌  Failed to fetch startups:", fetchErr.message);
    process.exit(1);
  }

  const rows = (incompleteRows ?? []) as StartupRow[];

  if (rows.length === 0) {
    console.log("✅  No incomplete rows found — every startup has website, description, and employee_count.\n");
    return;
  }

  console.log(`📋  Found ${rows.length} startups missing at least one of: website, description, employee_count\n`);

  // ── 2. Fetch source_urls from funding_rounds for those startup IDs ──────────
  const ids = rows.map((r) => r.id);
  const { data: roundData, error: roundErr } = await supabase
    .from("funding_rounds")
    .select("startup_id, source_url")
    .in("startup_id", ids)
    .not("source_url", "is", null);

  if (roundErr) {
    console.warn("⚠️  Could not fetch funding rounds (website derivation skipped):", roundErr.message);
  }

  // Build: startup_id → best candidate company website
  // Use the first non-media source_url per startup
  const websiteCandidate = new Map<string, string>();
  for (const r of (roundData ?? []) as RoundRow[]) {
    if (websiteCandidate.has(r.startup_id)) continue;
    const domain = r.source_url ? extractCompanyDomain(r.source_url) : null;
    if (domain) websiteCandidate.set(r.startup_id, domain);
  }

  // ── 3. Build patch plan for each incomplete row ────────────────────────────
  interface PatchPlan {
    id: string;
    name: string;
    patch: Record<string, unknown>;
    missingAfterPatch: string[];
  }

  const plans: PatchPlan[] = [];

  for (const row of rows) {
    const patch: Record<string, unknown> = {};

    // website: fill from funding_rounds.source_url domain if null
    if (!row.website) {
      const candidate = websiteCandidate.get(row.id);
      if (candidate) patch.website = candidate;
    }

    // Compute which fields will still be missing after this patch
    const missingAfterPatch: string[] = [];
    if (!row.website && !patch.website)          missingAfterPatch.push("website");
    if (!row.description)                         missingAfterPatch.push("description");
    if (!row.employee_count)                      missingAfterPatch.push("employee_count");
    if (!row.industry)                            missingAfterPatch.push("industry");
    if (!row.country)                             missingAfterPatch.push("country");
    if (!row.city)                                missingAfterPatch.push("city");
    if (!row.founders || row.founders.length === 0) missingAfterPatch.push("founders");

    plans.push({ id: row.id, name: row.name, patch, missingAfterPatch });
  }

  const patchable   = plans.filter((p) => Object.keys(p.patch).length > 0);
  const unpatchable = plans.filter((p) => Object.keys(p.patch).length === 0);

  // ── 4. Report & apply ──────────────────────────────────────────────────────
  console.log(`🔧  Patchable from existing DB data:   ${patchable.length}`);
  console.log(`🔍  Require autopilot web enrichment:  ${unpatchable.length}\n`);

  let patched = 0;
  let failed  = 0;

  if (patchable.length > 0) {
    console.log("─".repeat(58));
    console.log("Rows being patched:");
    for (const plan of patchable) {
      const fields = Object.entries(plan.patch)
        .map(([k, v]) => `${k}="${String(v).slice(0, 50)}"`)
        .join(", ");
      const still = plan.missingAfterPatch.length
        ? `  ⚠️  still missing: ${plan.missingAfterPatch.join(", ")}`
        : "  ✅  all target fields now set";

      console.log(`  ${plan.name}`);
      console.log(`    patch → ${fields}`);
      console.log(`    ${still}`);

      if (!DRY_RUN) {
        const { error: updateErr } = await supabase
          .from("startups")
          .update(plan.patch)
          .eq("id", plan.id);

        if (updateErr) {
          console.error(`    ❌  DB error: ${updateErr.message}`);
          failed++;
        } else {
          patched++;
        }
      }
    }
    console.log("─".repeat(58) + "\n");
  }

  if (unpatchable.length > 0) {
    console.log("Rows requiring autopilot enrichment (web search needed):");
    for (const plan of unpatchable) {
      console.log(`  • ${plan.name.padEnd(30)} missing: ${plan.missingAfterPatch.join(", ")}`);
    }
    console.log();
  }

  // ── 5. Summary ─────────────────────────────────────────────────────────────
  console.log("═".repeat(58));
  if (DRY_RUN) {
    console.log(`DRY RUN COMPLETE — ${patchable.length} row(s) would be patched, ${unpatchable.length} need autopilot.`);
    console.log("Run with DRY_RUN=false to apply changes.");
  } else {
    console.log(`Patched: ${patched}   Failed: ${failed}   Need autopilot: ${unpatchable.length}`);
  }
  console.log("═".repeat(58) + "\n");

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("💥  Fatal error:", e);
  process.exit(1);
});
