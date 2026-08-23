#!/usr/bin/env node
/**
 * discover_and_enrich_startups.ts — Automated Startup Discovery & Enrichment Engine
 *
 * Searches the web (Tavily) for newly launched, early-stage private startups
 * across a fixed set of target sectors, validates + extracts each candidate
 * with Claude acting as a strict VC analyst, and inserts the ones that pass
 * directly into the `startups` table — deduped on the `website` UNIQUE
 * constraint so re-running the same query never creates duplicates.
 *
 * Designed to run unattended on a Google Cloud VM (e.g. via cron or a
 * systemd timer), the same way bulk_enrich_all.ts / discover_competitors.ts
 * are run from this repo's own maintenance VM.
 *
 * Two Claude gates, enforced per candidate, mirroring the rules
 * ingest-startup (the interactive "Add Startup" edge function) already
 * enforces for manually-added companies:
 *   1. is_private_company — REJECT any publicly traded company outright
 *      (e.g. NVIDIA, Microsoft, CrowdStrike), even if the source article
 *      only mentions them in passing.
 *   2. is_new_early_stage — REJECT anything that isn't a newly launched or
 *      early-stage company (fresh out of stealth, just announced a
 *      Pre-Seed/Seed/Series A) — an established company merely in the news
 *      does not qualify.
 * A candidate is only inserted if BOTH gates pass.
 *
 * Usage:
 *   npx tsx scripts/discover_and_enrich_startups.ts                        # dry run (default)
 *   DRY_RUN=false npx tsx scripts/discover_and_enrich_startups.ts
 *   DRY_RUN=false RESULTS_PER_SECTOR=12 DELAY_MS=4000 npx tsx scripts/discover_and_enrich_startups.ts
 *
 * Env vars:
 *   DRY_RUN            default "true"  — preview only, no Supabase writes
 *   RESULTS_PER_SECTOR default 8       — max Tavily results pulled per sector query
 *   SEARCH_DAYS        default 45      — restrict Tavily results to the last N days
 *   DELAY_MS           default 3000    — pause between Claude validation calls (rate-limit friendly)
 *   DISCOVERY_MODEL    default "claude-sonnet-5" — override the classification/extraction model
 *
 * Required:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, TAVILY_API_KEY
 */

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Bootstrap: load .env for local/VM runs ──────────────────────────────────
const __dir   = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

// ── Configuration ────────────────────────────────────────────────────────────
const DRY_RUN            = process.env.DRY_RUN !== "false"; // safe default: dry run
const RESULTS_PER_SECTOR = Number(process.env.RESULTS_PER_SECTOR ?? 8);
const SEARCH_DAYS        = Number(process.env.SEARCH_DAYS ?? 45);
const DELAY_MS           = Number(process.env.DELAY_MS ?? 3000);
const MODEL              = process.env.DISCOVERY_MODEL ?? "claude-sonnet-5";

// ── Target sectors ────────────────────────────────────────────────────────────
const SECTORS = [
  "AI & ML",
  "Fintech",
  "Cybersecurity",
  "SaaS and dev tools",
  "Health tech",
  "Climate and energy",
  "Deep tech",
] as const;

// ── Trusted sources — restricts Tavily to reputable tech/startup outlets,
// rather than the open web, to keep noise and misinformation out of the
// candidate pool before it ever reaches Claude. ─────────────────────────────
const TRUSTED_DOMAINS = [
  "techcrunch.com",
  "venturebeat.com",
  "sifted.eu",
  "producthunt.com",
  "crunchbase.com",
  "eu-startups.com",
  "tech.eu",
  "axios.com",
  "forbes.com",
  "businessinsider.com",
  "fortune.com",
  "theinformation.com",
];

// ── Env-var guard ────────────────────────────────────────────────────────────
for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "TAVILY_API_KEY"]) {
  if (!process.env[key]) {
    console.error(`❌  Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// ── Clients ───────────────────────────────────────────────────────────────────
const supabase  = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWebsite(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const w = raw.trim();
  if (!w) return null;
  const withProto = /^https?:\/\//i.test(w) ? w : `https://${w}`;
  return withProto.replace(/\/+$/, "");
}

function websiteDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

// ── Tavily search ─────────────────────────────────────────────────────────────
interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

async function tavilySearch(sector: string): Promise<TavilyResult[]> {
  const query = `"${sector}" startup launches out of stealth seed funding new company announcement`;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        topic: "news",
        search_depth: "advanced",
        max_results: RESULTS_PER_SECTOR,
        days: SEARCH_DAYS,
        include_domains: TRUSTED_DOMAINS,
      }),
    });
    if (!res.ok) {
      console.warn(`  ⚠️  Tavily HTTP ${res.status} for sector "${sector}"`);
      return [];
    }
    const data = await res.json();
    return (data.results ?? []) as TavilyResult[];
  } catch (err) {
    console.warn(`  ⚠️  Tavily search failed for "${sector}": ${String(err)}`);
    return [];
  }
}

// ── Claude validation + extraction ───────────────────────────────────────────
interface Verdict {
  isPrivate: boolean;
  isNewEarlyStage: boolean;
  rejectionReason: string | null;
  name: string | null;
  website: string | null;
  city: string | null;
  country: string | null;
  description: string | null;
}

async function validateAndExtract(sector: string, result: TavilyResult): Promise<Verdict> {
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [
      {
        name: "save_startup_candidate",
        description: "Record whether this article describes a valid new, early-stage, privately held startup for AlphaMap — and if so, extract its structured profile.",
        input_schema: {
          type: "object" as const,
          properties: {
            is_private_company: {
              type: "boolean",
              description:
                "TRUE only if the company is privately held. FALSE for ANY publicly traded company — including well-known public tech giants that might appear in the article (e.g. NVIDIA, Microsoft, CrowdStrike, Google, Amazon) — even if they're only mentioned as a competitor, investor, or acquirer, not the main subject.",
            },
            is_new_early_stage: {
              type: "boolean",
              description:
                "TRUE only if this describes a NEWLY LAUNCHED or early-stage startup: just came out of stealth, just founded, or just announced a Pre-Seed/Seed/Series A round. FALSE for an established/mature company that merely appears in the news (e.g. a later funding round, an acquisition of a mature company, routine coverage).",
            },
            rejection_reason: {
              type: "string",
              description: "If either flag above is false, a one-sentence reason why. Omit if both are true.",
            },
            name: { type: "string", description: "Official company name (required if both flags above are true)" },
            website: { type: "string", description: "Company website URL, including https:// (required if both flags above are true)" },
            city: { type: "string", description: "HQ city, if stated or confidently inferable" },
            country: { type: "string", description: "HQ country, if stated or confidently inferable" },
            description: { type: "string", description: "2-3 sentence description: what the company does, who it serves, and its key differentiator" },
          },
          required: ["is_private_company", "is_new_early_stage"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "save_startup_candidate" },
    messages: [
      {
        role: "user",
        content: `You are a strict venture-capital analyst screening tech-news content for AlphaMap, a private-market intelligence platform that tracks ONLY privately held, early-stage startups. You are reviewing one article at a time to decide whether it describes a startup that belongs in AlphaMap.

Sector being researched: ${sector}

Article title: ${result.title}
Article URL: ${result.url}
Article content:
${result.content}

Evaluate strictly and skeptically:
1. is_private_company — set FALSE for any company you know or suspect is publicly traded on any exchange, with no exceptions.
2. is_new_early_stage — set FALSE unless this is clearly a brand-new or early-stage company (just launched, just left stealth, or just closed a Pre-Seed/Seed/Series A).

Only extract name/website/city/country/description if BOTH flags are true. If you extract a website, only include it if you are confident it is correct — never guess.`,
      },
    ],
  });

  const toolBlock = msg.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("Claude did not return structured data");
  }
  const extracted = toolBlock.input as Record<string, unknown>;

  return {
    isPrivate: extracted.is_private_company === true,
    isNewEarlyStage: extracted.is_new_early_stage === true,
    rejectionReason: extracted.rejection_reason ? String(extracted.rejection_reason) : null,
    name: extracted.name ? String(extracted.name).trim() : null,
    website: normalizeWebsite(extracted.website ? String(extracted.website) : null),
    city: extracted.city ? String(extracted.city).trim() : null,
    country: extracted.country ? String(extracted.country).trim() : null,
    description: extracted.description ? String(extracted.description).trim() : null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = new Date().toISOString();
  const bar = "═".repeat(62);

  console.log(`╔${bar}╗`);
  console.log(`║${"  🚀 AlphaMap — Automated Startup Discovery & Enrichment Engine".padEnd(62)}║`);
  console.log(`║  ${startedAt}${"".padEnd(Math.max(0, 62 - 2 - startedAt.length))}║`);
  console.log(`║${`  DRY_RUN=${String(DRY_RUN).padEnd(5)} | RESULTS_PER_SECTOR=${String(RESULTS_PER_SECTOR).padEnd(3)} | SEARCH_DAYS=${String(SEARCH_DAYS)}`.padEnd(62)}║`);
  console.log(`║${`  DELAY=${DELAY_MS / 1000}s | MODEL=${MODEL}`.padEnd(62)}║`);
  console.log(`╚${bar}╝\n`);

  if (DRY_RUN) console.log("ℹ️  DRY RUN — set DRY_RUN=false to write to the database.\n");

  const tally = {
    searched: 0,
    rejectedPublic: 0,
    rejectedNotEarly: 0,
    missingFields: 0,
    duplicates: 0,
    inserted: 0,
    errors: 0,
  };

  const seenDomains = new Set<string>(); // in-run dedup across sectors/articles

  for (const sector of SECTORS) {
    console.log(`\n🔎 Sector: ${sector}`);
    const results = await tavilySearch(sector);
    console.log(`   📰 Found ${results.length} candidate article(s) from trusted sources`);
    tally.searched += results.length;

    for (const result of results) {
      const domain = websiteDomain(result.url);
      // Best-effort pre-filter: skip an article from a domain we've already
      // turned into a startup this run — cheap, avoids wasting a Claude call
      // on what's almost certainly the same company covered twice.
      if (domain && seenDomains.has(domain)) {
        console.log(`   ⏭️   Skipping (already processed this run): ${result.title}`);
        continue;
      }

      try {
        const verdict = await validateAndExtract(sector, result);

        if (!verdict.isPrivate) {
          console.log(`   🚫 Rejected (public company): ${result.title}${verdict.rejectionReason ? ` — ${verdict.rejectionReason}` : ""}`);
          tally.rejectedPublic++;
        } else if (!verdict.isNewEarlyStage) {
          console.log(`   🚫 Rejected (not new/early-stage): ${result.title}${verdict.rejectionReason ? ` — ${verdict.rejectionReason}` : ""}`);
          tally.rejectedNotEarly++;
        } else if (!verdict.name || !verdict.website) {
          console.log(`   ⚠️  Passed both gates but missing name/website — skipped: ${result.title}`);
          tally.missingFields++;
        } else {
          console.log(`   ✅ Valid: ${verdict.name} (${verdict.website})`);
          if (domain) seenDomains.add(domain);

          if (DRY_RUN) {
            console.log(`      [DRY] Would insert: ${JSON.stringify({ name: verdict.name, website: verdict.website, city: verdict.city, country: verdict.country, sector })}`);
          } else {
            const { data, error } = await supabase
              .from("startups")
              .upsert(
                {
                  name: verdict.name,
                  website: verdict.website,
                  city: verdict.city,
                  country: verdict.country,
                  description: verdict.description,
                  industry: sector,
                  data_sources: { name: "discover_and_enrich_startups", source_url: result.url, sector },
                },
                { onConflict: "website", ignoreDuplicates: true },
              )
              .select();

            if (error) {
              console.error(`      ❌ Insert failed: ${error.message}`);
              tally.errors++;
            } else if (!data || data.length === 0) {
              console.log(`      ⏭️   Already in database — skipped (duplicate website)`);
              tally.duplicates++;
            } else {
              console.log(`      💾 Inserted into startups`);
              tally.inserted++;
            }
          }
        }
      } catch (err) {
        console.error(`   ❌ Error processing "${result.title}": ${String(err)}`);
        tally.errors++;
      }

      await sleep(DELAY_MS);
    }
  }

  // ── Refresh the materialized search view so new rows show up immediately ──
  if (!DRY_RUN && tally.inserted > 0) {
    console.log(`\n🔄 Refreshing startups_search materialized view...`);
    try {
      const { error } = await supabase.rpc("refresh_startups_search");
      if (error) console.warn(`   ⚠️  Refresh failed: ${error.message}`);
      else console.log(`   ✅ startups_search refreshed — new startups are now visible in the UI`);
    } catch (err) {
      console.warn(`   ⚠️  Refresh RPC threw: ${String(err)}`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  const mm = Math.floor(elapsedMs / 60_000);
  const ss = Math.floor((elapsedMs % 60_000) / 1000);

  console.log(`\n${bar}`);
  console.log("🧭 DISCOVERY & ENRICHMENT SUMMARY");
  console.log(bar);
  console.log(`  Sectors searched:        ${SECTORS.length}`);
  console.log(`  📰 Articles reviewed:     ${tally.searched}`);
  console.log(`  ✅ Inserted:              ${tally.inserted}`);
  console.log(`  ⏭️  Duplicates skipped:    ${tally.duplicates}`);
  console.log(`  🚫 Rejected (public):     ${tally.rejectedPublic}`);
  console.log(`  🚫 Rejected (not early):  ${tally.rejectedNotEarly}`);
  console.log(`  ⚠️  Missing fields:        ${tally.missingFields}`);
  console.log(`  ❌ Errors:                ${tally.errors}`);
  console.log(`  ⏱️  Elapsed:               ${mm}m ${ss}s`);
  if (DRY_RUN) console.log(`\n  ℹ️  DRY RUN — rerun with DRY_RUN=false to apply.`);
  console.log(bar + "\n");

  if (!DRY_RUN && tally.errors > 0 && tally.inserted === 0) process.exit(1);
}

main().catch((e) => {
  console.error("💥 Fatal error:", e);
  process.exit(1);
});
