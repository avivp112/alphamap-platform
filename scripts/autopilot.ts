#!/usr/bin/env node
/**
 * AlphaMap Weekly Market Intelligence Autopilot
 *
 * Executed every Sunday via GitHub Actions.
 *
 * Work queue (up to BATCH_SIZE companies per run):
 *   1. New companies in scripts/watchlist.json not yet in Supabase → INSERT
 *   2. Existing startups whose updated_at is older than STALE_DAYS → REFRESH
 *
 * Each company: 4 parallel Tavily searches → 1 Claude extraction →
 *               validate (privacy + industry) → upsert Supabase.
 *
 * Set DRY_RUN=true to simulate without writing to the database.
 */

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Configuration ─────────────────────────────────────────────────────────────
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 100); // default: full watchlist run
const DELAY_MS   = Number(process.env.DELAY_MS   ?? 45_000); // 45 s between companies
const STALE_DAYS = Number(process.env.STALE_DAYS ?? 7);
const DRY_RUN    = process.env.DRY_RUN === "true";

// ── Env-var guard ─────────────────────────────────────────────────────────────
const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "TAVILY_API_KEY",
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌  Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// ── Clients ───────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Types ─────────────────────────────────────────────────────────────────────
interface StartupRow {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  employee_count: number | null;
  country: string | null;
  city: string | null;
  founders: string[] | null;
  description: string | null;
  updated_at: string;
}

interface ExtractedData {
  name: string;
  is_public_company: boolean;
  is_tech_company: boolean;
  website?: string;
  description?: string;
  industry?: string;
  founded_year?: number;
  employee_count?: number;
  country?: string;
  city?: string;
  founders?: string[];
  round_type: string;
  amount_raised?: number;
  valuation?: number;
  announcement_date?: string;
  source_url?: string;
}

type ProcessResult = "inserted" | "updated" | "skipped" | "rejected" | "error";
interface ProcessOutcome {
  result: ProcessResult;
  reason?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isRateLimitErr(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as Error & { status?: number };
  return e.status === 429 || /rate.?limit|429/i.test(e.message);
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number; label?: string } = {},
): Promise<T> {
  const { retries = 4, baseMs = 20_000, label = "request" } = opts;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      if (attempt === retries || !isRateLimitErr(err)) throw err;
      const wait = baseMs * Math.pow(2, attempt);
      console.warn(
        `    ⚠️  Rate limit on ${label} — waiting ${wait / 1000}s before retry ${attempt + 1}/${retries}…`,
      );
      await sleep(wait);
    }
  }
  throw new Error("unreachable");
}

function normalizeRoundType(raw: string): string {
  if (!raw) return "Other";
  const s = raw.toLowerCase().trim();
  if (/pre.?seed/.test(s)) return "Pre-Seed";
  if (/\bseed\b/.test(s) && !/series/.test(s)) return "Seed";
  if (/series\s*a\b/.test(s)) return "Series A";
  if (/series\s*b\b/.test(s)) return "Series B";
  if (/series\s*c\b/.test(s)) return "Series C";
  if (/series\s*d\b/.test(s)) return "Series D";
  if (/series\s*[e-z+]/.test(s) || /late.?stage/.test(s)) return "Series E+";
  if (/\bgrowth\b/.test(s) || /expansion/.test(s)) return "Growth";
  if (/bridge/.test(s)) return "Bridge";
  if (/convertible/.test(s) || /\bsafe\b/.test(s) || /\bnote\b/.test(s)) return "Convertible Note";
  if (/bootstrap/.test(s)) return "Bootstrapped";
  if (/\bgrant\b/.test(s)) return "Grant";
  if (/acqui/.test(s) || /merg/.test(s)) return "Acquired";
  if (/\bipo\b/.test(s) || /\bpublic\b/.test(s) || /nyse|nasdaq/.test(s)) return "IPO";
  return "Other";
}

async function tavilySearch(query: string, attempt = 0): Promise<string> {
  const MAX_RETRIES = 3;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: "advanced",
        max_results: 5,
        include_answer: true,
      }),
    });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const wait = 15_000 * Math.pow(2, attempt);
      console.warn(`    ⚠️  Tavily rate limit (429) — waiting ${wait / 1000}s (retry ${attempt + 1}/${MAX_RETRIES})…`);
      await sleep(wait);
      return tavilySearch(query, attempt + 1);
    }
    if (!res.ok) {
      console.warn(`    ⚠️  Tavily HTTP ${res.status} for: "${query.slice(0, 80)}"`);
      return "";
    }
    const data = await res.json() as Record<string, unknown>;
    const parts: string[] = [];
    if (data.answer) parts.push(`Summary: ${data.answer}`);
    for (const r of (data.results as Array<Record<string, string>> ?? [])) {
      parts.push(`[${r.title}]\n${r.url}\n${String(r.content ?? "").slice(0, 500)}`);
    }
    return parts.join("\n---\n");
  } catch (err) {
    console.warn(`    ⚠️  Tavily search failed: ${String(err)}`);
    return "";
  }
}

// ── Core: research a company via Tavily + Claude ──────────────────────────────
async function researchCompany(name: string): Promise<ExtractedData> {
  const [funding, founders, market, publicStatus] = await Promise.all([
    tavilySearch(`"${name}" startup funding round raised valuation 2024 2025`),
    tavilySearch(`"${name}" founder co-founder "founded by" full name crunchbase angellist`),
    tavilySearch(`"${name}" company website headquarters country city industry description`),
    tavilySearch(`"${name}" IPO "went public" NASDAQ NYSE OR "private company" "privately held"`),
  ]);

  const context = [
    `## Funding & Valuation\n${funding}`,
    `## Founders & Leadership\n${founders}`,
    `## Company Overview & HQ\n${market}`,
    `## Public vs Private Status\n${publicStatus}`,
  ].join("\n\n");

  const msg = await withRetry(
    () => anthropic.messages.create({
    model: "claude-haiku-4-5-20251001", // Fast & cost-effective for structured data extraction
    max_tokens: 1024,
    tools: [
      {
        name: "save_startup",
        description: "Save validated private tech startup data for AlphaMap",
        input_schema: {
          type: "object" as const,
          properties: {
            is_public_company: {
              type: "boolean",
              description: "TRUE if listed on any public stock exchange (NYSE, NASDAQ, LSE, etc.)",
            },
            is_tech_company: {
              type: "boolean",
              description: "TRUE if tech-driven: Software, SaaS, AI, Cyber, FinTech, Biotech, Hardware, EdTech, etc.",
            },
            name:           { type: "string" },
            website:        { type: "string" },
            description:    { type: "string", description: "3-4 sentence company overview" },
            industry:       { type: "string", description: "Primary tech sector" },
            founded_year:   { type: "integer" },
            employee_count: { type: "integer" },
            country:        { type: "string", description: "HQ country (e.g. United States)" },
            city:           { type: "string", description: "HQ city (e.g. San Francisco)" },
            founders: {
              type: "array",
              items: { type: "string" },
              description: "Full legal names of ALL founders/co-founders",
            },
            round_type: {
              type: "string",
              enum: [
                "Pre-Seed", "Seed", "Series A", "Series B", "Series C",
                "Series D", "Series E+", "Growth", "Bridge", "Convertible Note",
                "Bootstrapped", "Grant", "Acquired", "IPO", "Other",
              ],
            },
            amount_raised:     { type: "number", description: "USD plain number" },
            valuation:         { type: "number", description: "USD plain number" },
            announcement_date: { type: "string", description: "YYYY-MM-DD" },
            source_url:        { type: "string" },
          },
          required: ["name", "round_type", "is_public_company", "is_tech_company"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "save_startup" },
    messages: [
      {
        role: "user",
        content: `AlphaMap weekly market intelligence refresh for: "${name}"

STRICT RULES — enforced by code after you respond:
• PRIVACY RULE:  is_public_company = true  → company is REJECTED (only private companies allowed)
• INDUSTRY RULE: is_tech_company   = false → company is REJECTED (only tech companies allowed)

ENRICHMENT PRIORITIES:
1. founders       — full legal name of every founder/co-founder
2. city + country — exact HQ location, split into two separate fields
3. description    — 3-4 sentences: what it does, who it serves, key differentiator
4. funding        — convert all amounts to plain USD numbers ($1.5B → 1500000000)

Omit any field you cannot verify. Do not guess.

Research data:
${context}`,
      },
    ],
  }),
  { retries: 4, baseMs: 20_000, label: "Claude API" },
  );

  const toolBlock = msg.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("Claude returned no structured data");
  }
  return toolBlock.input as ExtractedData;
}

// ── Core: process one company (insert or update) ──────────────────────────────
async function processCompany(
  name: string,
  existing: StartupRow | null,
): Promise<ProcessOutcome> {
  let extracted: ExtractedData;
  try {
    extracted = await researchCompany(name);
  } catch (e) {
    return { result: "error", reason: `Research failed: ${String(e)}` };
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  if (extracted.is_public_company === true) {
    return { result: "rejected", reason: "PRIVACY_RULE — publicly traded company" };
  }
  if (extracted.is_tech_company === false) {
    return {
      result: "rejected",
      reason: `INDUSTRY_RULE — not a tech company (industry: ${extracted.industry ?? "unknown"})`,
    };
  }

  const roundType = normalizeRoundType(extracted.round_type);
  if (roundType === "IPO") {
    return { result: "rejected", reason: "PRIVACY_RULE (fallback) — round_type resolved to IPO" };
  }

  if (DRY_RUN) {
    const action = existing ? "UPDATE" : "INSERT";
    console.log(
      `    [DRY RUN] Would ${action}: ${extracted.name} | ${roundType} | ${extracted.city}, ${extracted.country}`,
    );
    return { result: existing ? "updated" : "inserted" };
  }

  const cleanFounders = Array.isArray(extracted.founders)
    ? extracted.founders.map(String).filter((f) => f.trim() !== "")
    : null;

  // ── UPDATE existing startup ─────────────────────────────────────────────────
  if (existing) {
    const patch: Record<string, unknown> = {};

    // Only overwrite if new value is non-null; for static fields only fill if currently empty
    if (extracted.employee_count)                     patch.employee_count = extracted.employee_count;
    if (extracted.description)                        patch.description    = extracted.description;
    if (extracted.website   && !existing.website)     patch.website        = extracted.website;
    if (extracted.industry  && !existing.industry)    patch.industry       = extracted.industry;
    if (extracted.country   && !existing.country)     patch.country        = extracted.country;
    if (extracted.city      && !existing.city)        patch.city           = extracted.city;

    // Merge founders (union of old + new, deduplicated)
    if (cleanFounders && cleanFounders.length > 0) {
      patch.founders = [...new Set([...(existing.founders ?? []), ...cleanFounders])];
    }

    if (Object.keys(patch).length > 0) {
      const { error: updateErr } = await supabase
        .from("startups")
        .update(patch)
        .eq("id", existing.id);
      if (updateErr) {
        return { result: "error", reason: `DB update failed: ${updateErr.message}` };
      }
    }

    // Check for a new funding round (avoid duplicating rounds with same type + close date)
    const hasFundingSignal =
      extracted.amount_raised || extracted.valuation || extracted.announcement_date;

    if (hasFundingSignal) {
      const { data: existingRounds } = await supabase
        .from("funding_rounds")
        .select("round_type, announcement_date")
        .eq("startup_id", existing.id);

      const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;
      const roundAlreadyExists = (existingRounds ?? []).some((r) => {
        if (r.round_type !== roundType) return false;
        if (!r.announcement_date || !extracted.announcement_date) return true; // same type, no date to compare
        const diff = Math.abs(
          new Date(r.announcement_date).getTime() -
          new Date(extracted.announcement_date!).getTime(),
        );
        return diff < SIX_MONTHS_MS;
      });

      if (!roundAlreadyExists) {
        const { error: roundErr } = await supabase.from("funding_rounds").insert({
          startup_id:        existing.id,
          round_type:        roundType,
          amount_raised:     extracted.amount_raised     ?? null,
          valuation:         extracted.valuation         ?? null,
          announcement_date: extracted.announcement_date ?? null,
          source_url:        extracted.source_url        ?? null,
        });
        if (roundErr) {
          console.warn(`    ⚠️  New round insert failed: ${roundErr.message}`);
        } else {
          console.log(`    💰  New funding round added: ${roundType}`);
        }
      }
    }

    return { result: "updated" };
  }

  // ── INSERT new startup ──────────────────────────────────────────────────────
  if (extracted.website) {
    const { data: dup } = await supabase
      .from("startups")
      .select("id, name")
      .eq("website", extracted.website)
      .maybeSingle();
    if (dup) {
      return { result: "skipped", reason: `Website already exists for: ${dup.name}` };
    }
  }

  const { data: newStartup, error: insertErr } = await supabase
    .from("startups")
    .insert({
      name:           String(extracted.name).trim(),
      website:        extracted.website        ?? null,
      description:    extracted.description    ?? null,
      industry:       extracted.industry       ?? null,
      founded_year:   extracted.founded_year   ?? null,
      employee_count: extracted.employee_count ?? null,
      country:        extracted.country        ?? null,
      city:           extracted.city           ?? null,
      founders:       cleanFounders && cleanFounders.length > 0 ? cleanFounders : null,
    })
    .select("id")
    .single();

  if (insertErr) {
    return { result: "error", reason: `DB insert failed: ${insertErr.message}` };
  }

  const hasFundingData =
    extracted.amount_raised || extracted.valuation ||
    extracted.announcement_date || extracted.source_url;

  if (hasFundingData) {
    const { error: roundErr } = await supabase.from("funding_rounds").insert({
      startup_id:        newStartup!.id,
      round_type:        roundType,
      amount_raised:     extracted.amount_raised     ?? null,
      valuation:         extracted.valuation         ?? null,
      announcement_date: extracted.announcement_date ?? null,
      source_url:        extracted.source_url        ?? null,
    });
    if (roundErr) console.warn(`    ⚠️  Funding round insert failed: ${roundErr.message}`);
  }

  return { result: "inserted" };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const runAt = new Date().toISOString();
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║     AlphaMap Weekly Market Intelligence Autopilot   ║");
  console.log(`║     ${runAt}                   ║`);
  console.log(`║     BATCH=${BATCH_SIZE}  DELAY=${DELAY_MS / 1000}s  STALE=${STALE_DAYS}d  DRY_RUN=${DRY_RUN}  ║`);
  console.log("╚══════════════════════════════════════════════════════╝\n");
  // Explicit log so BATCH_SIZE is immediately verifiable in Actions output
  console.log(`ℹ️  BATCH_SIZE = ${BATCH_SIZE}  (env BATCH_SIZE="${process.env.BATCH_SIZE ?? "unset — using default 100"}")\n`);

  // ── Load watchlist ───────────────────────────────────────────────────────────
  const __dir = dirname(fileURLToPath(import.meta.url));
  const watchlistPath = join(__dir, "watchlist.json");
  let watchlist: string[] = [];
  if (existsSync(watchlistPath)) {
    try {
      watchlist = JSON.parse(readFileSync(watchlistPath, "utf-8")) as string[];
      console.log(`📋  Watchlist loaded: ${watchlist.length} companies`);
    } catch {
      console.warn("⚠️  Could not parse watchlist.json — skipping watchlist");
    }
  } else {
    console.log("📋  No watchlist.json found — processing stale startups only");
  }

  // ── Fetch stale startups ─────────────────────────────────────────────────────
  const staleThreshold = new Date(
    Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: staleRows, error: fetchErr } = await supabase
    .from("startups")
    .select("id, name, website, industry, employee_count, country, city, founders, description, updated_at")
    .lt("updated_at", staleThreshold)
    .order("updated_at", { ascending: true }) // oldest first
    .limit(BATCH_SIZE);

  if (fetchErr) {
    console.error("❌  Failed to fetch stale startups:", fetchErr.message);
    process.exit(1);
  }

  console.log(`🔄  Stale startups queued for refresh: ${staleRows?.length ?? 0}`);

  // ── Identify new watchlist companies not yet in DB ───────────────────────────
  const { data: allNames } = await supabase.from("startups").select("name");
  const existingNameSet = new Set(
    (allNames ?? []).map((r: { name: string }) => r.name.toLowerCase().trim()),
  );
  const newCompanies = watchlist.filter(
    (n) => !existingNameSet.has(n.toLowerCase().trim()),
  );
  console.log(`🆕  New watchlist companies to add: ${newCompanies.length}`);

  // ── Build work queue ─────────────────────────────────────────────────────────
  interface WorkItem { name: string; existing: StartupRow | null }

  const newItems: WorkItem[] = newCompanies
    .slice(0, BATCH_SIZE)
    .map((name) => ({ name, existing: null }));

  const staleItems: WorkItem[] = ((staleRows ?? []) as StartupRow[])
    .slice(0, Math.max(0, BATCH_SIZE - newItems.length))
    .map((s) => ({ name: s.name, existing: s }));

  const queue: WorkItem[] = [...newItems, ...staleItems];

  if (queue.length === 0) {
    console.log("\n✅  Nothing to process — all companies are up to date!\n");
    return;
  }

  console.log(`\n⚡  Processing ${queue.length} companies (${DELAY_MS / 1000}s gap between each)`);
  console.log("─".repeat(58));

  // ── Process each company sequentially ───────────────────────────────────────
  const tally: Record<ProcessResult, number> = {
    inserted: 0, updated: 0, skipped: 0, rejected: 0, error: 0,
  };
  const ICON: Record<ProcessResult, string> = {
    inserted: "✅", updated: "🔄", skipped: "⏭️ ", rejected: "🚫", error: "❌",
  };

  for (let i = 0; i < queue.length; i++) {
    const { name, existing } = queue[i];
    const tag = existing ? "REFRESH" : "NEW";
    console.log(`\n[${i + 1}/${queue.length}] ${tag}: "${name}"`);
    if (existing) {
      const age = Math.floor(
        (Date.now() - new Date(existing.updated_at).getTime()) / 86_400_000,
      );
      console.log(`    Last updated: ${existing.updated_at.slice(0, 10)} (${age}d ago)`);
    }

    const outcome = await processCompany(name, existing);
    tally[outcome.result]++;

    const detail = outcome.reason ? ` — ${outcome.reason}` : "";
    console.log(`    ${ICON[outcome.result]} ${outcome.result.toUpperCase()}${detail}`);

    if (i < queue.length - 1) {
      console.log(`    ⏳  Waiting ${DELAY_MS / 1000}s before next company…`);
      await sleep(DELAY_MS);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(58));
  console.log("RUN SUMMARY");
  console.log("═".repeat(58));
  for (const [key, count] of Object.entries(tally)) {
    if (count > 0) console.log(`  ${key.padEnd(12)} ${count}`);
  }
  console.log(`  Total        ${queue.length}`);
  console.log("═".repeat(58));
  console.log(`Completed: ${new Date().toISOString()}\n`);

  if (tally.error > 0) process.exit(1);
}

main().catch((e) => {
  console.error("💥  Fatal error:", e);
  process.exit(1);
});
