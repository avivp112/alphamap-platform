#!/usr/bin/env node
/**
 * AlphaMap Weekly Market Intelligence Autopilot
 *
 * Executed every Sunday via GitHub Actions.
 *
 * Source of truth: the 'startups' table in Supabase.
 * The script never inserts rows on its own — it only enriches or refreshes
 * existing rows that were added via the UI, CSV import, or Edge Function.
 *
 * Work queue (up to BATCH_SIZE rows per run):
 *   1. ENRICH  — rows missing description OR employee_count (not essentially complete)
 *   2. FUND    — essentially complete rows with only "Other" stub funding rounds
 *   3. REFRESH — fully complete rows whose updated_at is older than STALE_DAYS
 *
 * Each company: 4 parallel web searches (Tavily → DuckDuckGo fallback) →
 *               1 Claude extraction → validate (privacy + industry) → update Supabase.
 *
 * Set DRY_RUN=true to simulate without writing to the database.
 */

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { search as duckSearch } from "duck-duck-scrape";

// ── Configuration ─────────────────────────────────────────────────────────────
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 100); // default: full watchlist run
const DELAY_MS   = Number(process.env.DELAY_MS   ?? 45_000); // 45 s between companies
const STALE_DAYS = Number(process.env.STALE_DAYS ?? 7);
const DRY_RUN    = process.env.DRY_RUN === "true";

// ── Env-var guard ─────────────────────────────────────────────────────────────
for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"]) {
  if (!process.env[key]) {
    console.error(`❌  Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if (!process.env.TAVILY_API_KEY) {
  console.warn("⚠️  TAVILY_API_KEY not set — will use DuckDuckGo fallback for all searches.");
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
  founded_year: number | null;
  employee_count: number | null;
  country: string | null;
  city: string | null;
  founders: Array<{ name: string; linkedin_url: string | null }> | null;
  description: string | null;
  updated_at: string;
}

function isIncomplete(row: StartupRow): boolean {
  return (
    !row.description ||
    !row.industry ||
    !row.employee_count ||
    !row.country ||
    !row.city ||
    !row.founders ||
    row.founders.length === 0
  );
}

// A row with both description AND employee_count is "complete enough" to skip
// enrichment even if minor fields (founders, city, etc.) are still missing.
// This prevents repeatedly re-queuing well-known companies like OpenAI.
function isEssentiallyComplete(row: StartupRow): boolean {
  return !!(row.description && row.employee_count);
}

function needsEnrichment(rounds: Pick<FundingRoundRow, "round_type">[]): boolean {
  return rounds.every((r) => !r.round_type || r.round_type === "Other");
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

interface FundingRoundRow {
  id: string; startup_id: string; round_type: string | null;
  amount_raised: number | null; valuation: number | null;
  announcement_date: string | null; source_url: string | null;
}
interface RoundData {
  round_type: string;
  amount_raised?: number;
  valuation?: number;
  announcement_date?: string;
  source_url?: string;
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

// Becomes true on credit-exhaustion errors (401, 402, 432) so every
// subsequent webSearch() call skips Tavily and goes straight to DuckDuckGo.
let tavilyExhausted = !process.env.TAVILY_API_KEY;

// Returns null on failure — never returns an empty string.
async function tavilySearch(query: string, attempt = 0): Promise<string | null> {
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

    // Credit or auth exhaustion — permanently switch to fallback for this run
    if (res.status === 401 || res.status === 402 || res.status === 432) {
      const body = await res.text().catch(() => "");
      console.warn(
        `    ⚠️  Tavily unavailable (HTTP ${res.status}) — switching ALL remaining searches to DuckDuckGo.` +
        (body ? `\n        ${body.slice(0, 120)}` : ""),
      );
      tavilyExhausted = true;
      return null;
    }

    // Temporary rate-limit — retry with backoff (does NOT exhaust Tavily)
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const wait = 15_000 * Math.pow(2, attempt);
      console.warn(`    ⚠️  Tavily rate limit (429) — waiting ${wait / 1000}s (retry ${attempt + 1}/${MAX_RETRIES})…`);
      await sleep(wait);
      return tavilySearch(query, attempt + 1);
    }

    if (!res.ok) {
      console.warn(`    ⚠️  Tavily HTTP ${res.status} for: "${query.slice(0, 80)}"`);
      return null;
    }

    const data = await res.json() as Record<string, unknown>;
    const parts: string[] = [];
    if (data.answer) parts.push(`Summary: ${data.answer}`);
    for (const r of (data.results as Array<Record<string, string>> ?? [])) {
      parts.push(`[${r.title}]\n${r.url}\n${String(r.content ?? "").slice(0, 500)}`);
    }
    return parts.length > 0 ? parts.join("\n---\n") : null;
  } catch (err) {
    console.warn(`    ⚠️  Tavily request failed: ${String(err)}`);
    return null;
  }
}

// Free DuckDuckGo fallback — no API key required.
// Calls are serialized with a mandatory inter-request delay to avoid DDG
// "anomaly in request" blocks when multiple searches fire concurrently.
const DDG_INTERVAL_MS = 12_000;
let _ddgLock = Promise.resolve<void>(undefined);

async function fallbackSearch(query: string): Promise<string | null> {
  // Acquire position in the serial queue
  const waitFor = _ddgLock;
  let releaseNext!: () => void;
  _ddgLock = new Promise<void>((resolve) => (releaseNext = resolve));

  await waitFor; // wait for the previous DDG call + its cooldown to finish

  try {
    const results = await duckSearch(query, { safeSearch: -2 }); // SafeSearchType.OFF = -2
    if (!results?.results?.length) return null;
    const parts = results.results.slice(0, 6).map((r) =>
      `[${r.title}]\n${r.url}\n${(r.description ?? "").slice(0, 500)}`,
    );
    return parts.join("\n---\n") || null;
  } catch (err) {
    console.warn(`    ⚠️  DuckDuckGo fallback failed: ${String(err)}`);
    return null;
  } finally {
    // Hold the lock for DDG_INTERVAL_MS before releasing to the next waiter
    await sleep(DDG_INTERVAL_MS);
    releaseNext();
  }
}

// Primary entry-point for all web searches.
// Tries Tavily first; falls back to DuckDuckGo on any failure.
async function webSearch(query: string): Promise<string | null> {
  if (!tavilyExhausted) {
    const result = await tavilySearch(query);
    if (result !== null) return result;
    // tavilyExhausted may now be true (set by tavilySearch on 401/402/432)
  }
  console.warn(`    ↩️  Using DuckDuckGo for: "${query.slice(0, 70)}…"`);
  return fallbackSearch(query);
}

// ── Core: research a company via web search + Claude ─────────────────────────
async function researchCompany(name: string): Promise<ExtractedData> {
  const [funding, founders, market, publicStatus] = await Promise.all([
    webSearch(`"${name}" startup funding round raised valuation 2024 2025`),
    webSearch(`"${name}" founder co-founder "founded by" full name crunchbase angellist`),
    webSearch(`"${name}" company website headquarters country city industry description`),
    webSearch(`"${name}" IPO "went public" NASDAQ NYSE OR "private company" "privately held"`),
  ]);

  // Refuse to send a completely empty context to Claude — skip the company instead.
  const successCount = [funding, founders, market, publicStatus].filter((r) => r !== null).length;
  if (successCount === 0) {
    throw new Error("All 4 web searches failed (Tavily + DuckDuckGo) — no data available to extract");
  }

  const context = [
    `## Funding & Valuation\n${funding ?? "(no data — search failed)"}`,
    `## Founders & Leadership\n${founders ?? "(no data — search failed)"}`,
    `## Company Overview & HQ\n${market ?? "(no data — search failed)"}`,
    `## Public vs Private Status\n${publicStatus ?? "(no data — search failed)"}`,
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

  const cleanFounderNames = Array.isArray(extracted.founders)
    ? extracted.founders.map(String).filter((f) => f.trim() !== "")
    : [];

  // ── UPDATE existing startup ─────────────────────────────────────────────────
  if (existing) {
    const patch: Record<string, unknown> = {};

    // Always refresh time-varying fields when new data is available
    if (extracted.employee_count) patch.employee_count = extracted.employee_count;
    if (extracted.description)    patch.description    = extracted.description;

    // Fill in any field that is currently NULL (never overwrite user-provided data)
    if (extracted.website      && !existing.website)      patch.website      = extracted.website;
    if (extracted.industry     && !existing.industry)     patch.industry     = extracted.industry;
    if (extracted.country      && !existing.country)      patch.country      = extracted.country;
    if (extracted.city         && !existing.city)         patch.city         = extracted.city;
    if (extracted.founded_year && !existing.founded_year) patch.founded_year = extracted.founded_year;

    // Merge founders (union of existing + new names, deduplicated by name)
    if (cleanFounderNames.length > 0) {
      const existingFounders = existing.founders ?? [];
      const existingNames = new Set(existingFounders.map((f) => f.name.toLowerCase()));
      const newFounders = cleanFounderNames
        .filter((name) => !existingNames.has(name.toLowerCase()))
        .map((name) => ({ name, linkedin_url: null }));
      if (newFounders.length > 0) patch.founders = [...existingFounders, ...newFounders];
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
      founders:       cleanFounderNames.length > 0 ? cleanFounderNames.map((name) => ({ name, linkedin_url: null })) : null,
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

// ── FUND: research all historical funding rounds for one company ──────────────
async function researchFundingRounds(name: string): Promise<RoundData[]> {
  const [history, recent] = await Promise.all([
    webSearch(`"${name}" complete funding history "Series A" OR "Series B" Crunchbase PitchBook rounds`),
    webSearch(`"${name}" funding raised 2022 2023 2024 2025 valuation round amount`),
  ]);
  if (!history && !recent) throw new Error("Both searches failed");

  const context = [
    `## Complete Funding History\n${history ?? "(search failed)"}`,
    `## Recent Rounds (2022–2025)\n${recent  ?? "(search failed)"}`,
  ].join("\n\n");

  const msg = await withRetry(
    () => anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      tools: [{
        name: "save_funding_history",
        description: "Save the complete chronological funding history for a private tech startup",
        input_schema: {
          type: "object" as const,
          properties: {
            rounds: {
              type: "array",
              description: "All verified funding rounds, oldest first",
              items: {
                type: "object" as const,
                properties: {
                  round_type: {
                    type: "string",
                    enum: [
                      "Pre-Seed", "Seed", "Series A", "Series B", "Series C",
                      "Series D", "Series E+", "Growth", "Bridge",
                      "Convertible Note", "Bootstrapped", "Grant", "Acquired", "Other",
                    ],
                  },
                  amount_raised:     { type: "number", description: "USD amount (e.g. $50M → 50000000)" },
                  valuation:         { type: "number", description: "Post-money valuation in USD" },
                  announcement_date: { type: "string", description: "YYYY-MM-DD; YYYY-01-01 if only year is known" },
                  source_url:        { type: "string", description: "Crunchbase, press release, or SEC filing URL" },
                },
                required: ["round_type"],
              },
            },
          },
          required: ["rounds"],
        },
      }],
      tool_choice: { type: "tool", name: "save_funding_history" },
      messages: [{
        role: "user",
        content: `Extract the COMPLETE verified funding history for "${name}".
RULES: Include every confirmed round oldest to newest. Convert all amounts to plain USD integers ($1.5B → 1500000000). Omit unverifiable rounds — return an empty array rather than guessing.
Research data:\n${context}`,
      }],
    }),
    { retries: 3, baseMs: 20_000, label: "Claude API (funding)" },
  );

  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") return [];
  const input = tool.input as { rounds?: RoundData[] };
  return (input.rounds ?? []).filter((r) => r.round_type);
}

async function insertNewRounds(
  startupId: string,
  newRounds: RoundData[],
  existingRounds: FundingRoundRow[],
): Promise<{ inserted: number; skipped: number }> {
  const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;
  let inserted = 0;
  let skipped  = 0;
  const seen = [...existingRounds];

  for (const round of newRounds) {
    const roundType = normalizeRoundType(round.round_type);

    const isDup = seen.some((e) => {
      if (e.round_type !== roundType) return false;
      if (!e.announcement_date || !round.announcement_date) return true;
      return Math.abs(
        new Date(e.announcement_date).getTime() -
        new Date(round.announcement_date).getTime(),
      ) < SIX_MONTHS_MS;
    });

    if (isDup) { skipped++; continue; }

    const displayAmt = round.amount_raised
      ? `$${(round.amount_raised / 1e6).toFixed(0)}M`
      : "amt unknown";

    if (DRY_RUN) {
      console.log(`    [DRY] ${roundType} | ${round.announcement_date ?? "no date"} | ${displayAmt}`);
      inserted++;
      seen.push({ id: "dry", startup_id: startupId, round_type: roundType,
        amount_raised: null, valuation: null,
        announcement_date: round.announcement_date ?? null, source_url: null });
      continue;
    }

    const { error } = await supabase.from("funding_rounds").insert({
      startup_id:        startupId,
      round_type:        roundType,
      amount_raised:     round.amount_raised     ?? null,
      valuation:         round.valuation         ?? null,
      announcement_date: round.announcement_date ?? null,
      source_url:        round.source_url        ?? null,
    });

    if (error) {
      console.warn(`    ⚠️  Insert failed (${roundType}): ${error.message}`);
    } else {
      console.log(`    💰  ${roundType} | ${round.announcement_date ?? "no date"} | ${displayAmt}`);
      inserted++;
      seen.push({ id: "new", startup_id: startupId, round_type: roundType,
        amount_raised: round.amount_raised ?? null, valuation: round.valuation ?? null,
        announcement_date: round.announcement_date ?? null, source_url: null });
    }
  }

  return { inserted, skipped };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const runAt = new Date().toISOString();
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║     AlphaMap Weekly Market Intelligence Autopilot   ║");
  console.log(`║     ${runAt}                   ║`);
  console.log(`║     BATCH=${BATCH_SIZE}  DELAY=${DELAY_MS / 1000}s  STALE=${STALE_DAYS}d  DRY_RUN=${DRY_RUN}  ║`);
  console.log("╚══════════════════════════════════════════════════════╝\n");
  console.log(`ℹ️  BATCH_SIZE = ${BATCH_SIZE}  (env BATCH_SIZE="${process.env.BATCH_SIZE ?? "unset — using default 100"}")\n`);

  // ── Fetch all rows from startups (sole source of truth) ─────────────────────
  // Columns reflect the live schema: id, name, website, description, industry,
  // founded_year, employee_count, country, city, founders, updated_at
  const [{ data: allRows, error: fetchErr }, { data: roundData, error: rErr }] =
    await Promise.all([
      supabase
        .from("startups")
        .select("id, name, website, industry, founded_year, employee_count, country, city, founders, description, updated_at")
        .order("updated_at", { ascending: true }),
      supabase
        .from("funding_rounds")
        .select("id, startup_id, round_type, amount_raised, valuation, announcement_date, source_url"),
    ]);

  if (fetchErr) {
    console.error("❌  Failed to fetch startups:", fetchErr.message);
    process.exit(1);
  }
  if (rErr) {
    console.warn("⚠️  Could not fetch funding_rounds (FUND queue disabled):", rErr.message);
  }

  const rows      = (allRows   ?? []) as StartupRow[];
  const allRounds = (roundData ?? []) as FundingRoundRow[];

  const roundsByStartup = new Map<string, FundingRoundRow[]>();
  for (const r of allRounds) {
    const arr = roundsByStartup.get(r.startup_id) ?? [];
    arr.push(r);
    roundsByStartup.set(r.startup_id, arr);
  }

  console.log(`📋  Total startups in DB: ${rows.length}   Existing rounds: ${allRounds.length}\n`);

  // ── Classify every row ────────────────────────────────────────────────────────
  const COOLDOWN_MS      = 24 * 60 * 60 * 1000;
  const staleThresholdMs = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;

  const incompleteRows:     StartupRow[] = [];
  const fundRows:           StartupRow[] = [];
  const staleCompletedRows: StartupRow[] = [];
  let   cooldownSkipped = 0;
  let   freshSkipped    = 0;

  for (const row of rows) {
    const ageMs = Date.now() - new Date(row.updated_at).getTime();

    // Hard 24-hour cooldown — skip regardless of completeness
    if (ageMs < COOLDOWN_MS) {
      cooldownSkipped++;
      continue;
    }

    if (isIncomplete(row) && !isEssentiallyComplete(row)) {
      incompleteRows.push(row);
    } else if (isEssentiallyComplete(row) && needsEnrichment(roundsByStartup.get(row.id) ?? [])) {
      fundRows.push(row);
    } else if (new Date(row.updated_at).getTime() < staleThresholdMs) {
      staleCompletedRows.push(row);
    } else {
      freshSkipped++;
    }
  }

  console.log(`🩹  Incomplete profiles to enrich:   ${incompleteRows.length}`);
  console.log(`💰  Need funding round enrichment:   ${fundRows.length}`);
  console.log(`🔄  Complete but stale (refresh):    ${staleCompletedRows.length}`);
  console.log(`⏰  Skipped — 24h cooldown:           ${cooldownSkipped}`);
  console.log(`✅  Skipped — complete & fresh:       ${freshSkipped}`);

  // ── Build work queue (priority: enrich → fund → stale) ──────────────────────
  interface WorkItem {
    name: string;
    existing: StartupRow;
    type: "ENRICH" | "FUND" | "REFRESH";
    existingRounds?: FundingRoundRow[];
  }

  const incompleteItems: WorkItem[] = incompleteRows
    .slice(0, BATCH_SIZE)
    .map((row) => ({ name: row.name, existing: row, type: "ENRICH" as const }));

  const afterEnrich = Math.max(0, BATCH_SIZE - incompleteItems.length);
  const fundItems: WorkItem[] = fundRows
    .slice(0, afterEnrich)
    .map((row) => ({ name: row.name, existing: row, type: "FUND" as const, existingRounds: roundsByStartup.get(row.id) ?? [] }));

  const afterFund = Math.max(0, afterEnrich - fundItems.length);
  const staleItems: WorkItem[] = staleCompletedRows
    .slice(0, afterFund)
    .map((row) => ({ name: row.name, existing: row, type: "REFRESH" as const }));

  const queue: WorkItem[] = [...incompleteItems, ...fundItems, ...staleItems];

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
    const { name, existing, type: itemType, existingRounds } = queue[i];
    console.log(`\n[${i + 1}/${queue.length}] ${itemType}: "${name}"`);
    const age = Math.floor(
      (Date.now() - new Date(existing.updated_at).getTime()) / 86_400_000,
    );
    const missing = [
      !existing.description    && "description",
      !existing.industry       && "industry",
      !existing.employee_count && "employees",
      !existing.country        && "country",
      !existing.city           && "city",
      (!existing.founders || existing.founders.length === 0) && "founders",
    ].filter(Boolean).join(", ");
    console.log(`    Last updated: ${existing.updated_at.slice(0, 10)} (${age}d ago)${missing ? ` | missing: ${missing}` : ""}`);

    let outcome: ProcessOutcome;
    if (itemType === "FUND") {
      try {
        const rounds = await researchFundingRounds(name);
        console.log(`    📊  Claude found ${rounds.length} verifiable round(s)`);
        if (rounds.length > 0) {
          const { inserted, skipped } = await insertNewRounds(existing.id, rounds, existingRounds ?? []);
          console.log(`    💰  ${inserted} round(s) inserted, ${skipped} skipped (duplicates)`);
          outcome = inserted > 0
            ? { result: "updated" }
            : { result: "skipped", reason: "no new rounds (all duplicates)" };
        } else {
          outcome = { result: "skipped", reason: "no verifiable rounds found" };
        }
      } catch (e) {
        outcome = { result: "error", reason: `Funding research failed: ${String(e)}` };
      }
    } else {
      outcome = await processCompany(name, existing);
    }
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
