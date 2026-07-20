#!/usr/bin/env node
/**
 * enrich_investors.ts — Web-research enrichment for the `investors` table
 *
 * The investors-table counterpart of scripts/bulk_enrich_all.ts, covering BOTH
 * VC and PE firms (they share the table, differentiated by firm_type). Fills
 * missing profile data: AUM/fund size, description, official investment
 * thesis, HQ, founded year, stages, check size, notable investments, sector
 * focus, and the leadership team WITH personal LinkedIn URLs (exact same
 * {name, role, linkedin_url} shape as startup founders/leadership, rendered
 * by the same LinkedInBadge component).
 *
 * Search stack (mirrors the startups pipeline, per its lessons learned):
 *   - Serper (Google) for 3 searches per firm, each anchored on the firm's
 *     known website domain when one exists (disambiguates generic names)
 *   - Direct HTML fetch of the firm's own website — homepage PLUS the first
 *     team-ish page found (/team, /people, /about) — parsed with cheerio.
 *     This is the HIGHEST-TRUST source for thesis, description, and the
 *     leadership roster, and costs zero search-API budget.
 *
 * Queue (self-advancing, same mechanism as startups):
 *   Rows missing any key field (description, thesis, fund_size, headquarters,
 *   leadership) are eligible; never-enriched rows first, then oldest stamp.
 *   Every processed row is stamped with last_enriched_at, so re-running with
 *   the SAME settings and OFFSET=0 walks the whole table batch by batch.
 *
 * Write strategy (enforced by code, not just prompt):
 *   - Fill-NULL only for all profile fields — never overwrites curated data
 *   - Dollar figures (fund_size, typical_check_size) are written only when
 *     confidence_score >= MIN_CONFIDENCE; descriptive fields always write
 *     (each carries its own "omit if unverifiable" instruction) → a row with
 *     dollars withheld logs as "partial", same convention as startups
 *   - leadership: fill when empty + backfill missing linkedin_url onto
 *     already-recorded people by name — never overwrites an existing URL
 *   - firm_type: UPGRADE-ONLY vc → pe/growth (the 'pe' tag may come from
 *     real transaction data — never let a model guess downgrade it)
 *   - is_investment_firm=false (name collision with an operating company /
 *     a person) → nothing written, row stamped so it isn't retried forever
 *
 * Usage:
 *   npx tsx scripts/enrich_investors.ts                          # dry run
 *   DRY_RUN=false BATCH_SIZE=100 npx tsx scripts/enrich_investors.ts
 *
 * GitHub Actions: see .github/workflows/enrich-investors.yml
 */

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as cheerio from "cheerio";

// ── Bootstrap: load .env for local dev (GHA uses repository secrets) ──────────
const __dir   = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

// ── Configuration ─────────────────────────────────────────────────────────────
const BATCH_SIZE     = Number(process.env.BATCH_SIZE     ?? 100);
const OFFSET         = Number(process.env.OFFSET         ?? 0);
const DELAY_MS       = Number(process.env.DELAY_MS       ?? 8_000);
const DRY_RUN        = process.env.DRY_RUN               !== "false"; // safe default
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE ?? 40);
const MODEL          = process.env.ENRICH_MODEL ?? "claude-haiku-4-5-20251001";

// ── Env-var guard ─────────────────────────────────────────────────────────────
for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"]) {
  if (!process.env[key]) {
    console.error(`❌  Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if (!process.env.SERP_KEY) {
  console.warn("⚠️  SERP_KEY not set — searches unavailable; only website fetches will run.\n");
}

// ── Clients ───────────────────────────────────────────────────────────────────
const supabase  = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Cost tracking (informational, printed in the run summary) ─────────────────
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5":          { input: 1 / 1_000_000, output: 5  / 1_000_000 },
  "claude-haiku-4-5-20251001": { input: 1 / 1_000_000, output: 5  / 1_000_000 },
  "claude-sonnet-5":           { input: 3 / 1_000_000, output: 15 / 1_000_000 },
};
const PRICING = MODEL_PRICING[MODEL] ?? MODEL_PRICING["claude-haiku-4-5-20251001"];
let totalInputTokens  = 0;
let totalOutputTokens = 0;

// ── Types ─────────────────────────────────────────────────────────────────────
interface Leader { name: string; role: string; linkedin_url?: string | null }

interface InvestorDbRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  thesis: string | null;
  founded_year: number | null;
  headquarters: string | null;
  fund_size: string | null;
  typical_check_size: string | null;
  portfolio_size: number | null;
  stages: string[] | null;
  sector_allocation: Record<string, number> | null;
  notable_investments: string[] | null;
  website: string | null;
  firm_type: string;
  leadership: Leader[] | null;
  last_enriched_at: string | null;
}

interface ExtractedLeader { name: string; role: string; linkedin_url?: string }

interface ExtractedInvestorProfile {
  description?: string;
  thesis?: string;
  aum?: string;
  headquarters?: string;
  founded_year?: number;
  website?: string;
  typical_check_size?: string;
  portfolio_size?: number;
  stages?: string[];
  notable_investments?: string[];
  sector_focus?: Array<{ sector: string; weight: number }>;
}

interface InvestorEnrichmentResult {
  is_investment_firm: boolean;
  firm_type: "vc" | "pe" | "growth";
  profile: ExtractedInvestorProfile;
  leadership: ExtractedLeader[];
  confidence_score: number;
  reasoning: string;
}

type ProcessStatus = "success" | "partial" | "low_confidence" | "not_a_firm" | "no_data" | "error";

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function websiteDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

// ── Serper (Google Search) — same retry/error-logging as the startups pipeline
let serperCallCount = 0;

async function serperSearch(query: string, attempt = 0): Promise<string | null> {
  if (!process.env.SERP_KEY) return null;
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERP_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 10 }),
    });

    if (res.status === 429 && attempt < 3) {
      const wait = 10_000 * 2 ** attempt;
      console.warn(`    ⚠️  Serper 429 — waiting ${wait / 1000}s (retry ${attempt + 1}/3)…`);
      await sleep(wait);
      return serperSearch(query, attempt + 1);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`    ⚠️  Serper HTTP ${res.status}` + (body ? ` — ${body.slice(0, 200)}` : ""));
      return null;
    }

    const data = await res.json() as {
      organic?: Array<{ title: string; link: string; snippet: string }>;
      answerBox?: { answer?: string; snippet?: string };
      knowledgeGraph?: { description?: string };
    };

    const parts: string[] = [];
    const answer = data.answerBox?.answer ?? data.answerBox?.snippet ?? data.knowledgeGraph?.description;
    if (answer) parts.push(`Summary: ${answer}`);
    for (const r of (data.organic ?? []).slice(0, 8)) {
      parts.push(`[${r.title}]\n${r.link}\n${(r.snippet ?? "").slice(0, 600)}`);
    }
    if (!parts.length) return null;

    serperCallCount++;
    return parts.join("\n---\n");
  } catch (err) {
    console.warn(`    ⚠️  Serper threw: ${String(err)}`);
    return null;
  }
}

// ── Firm's own website — the highest-trust source for thesis/description/team
// Fetches the homepage, then probes common team-page paths and keeps the
// FIRST one that responds with real HTML (leadership rosters almost always
// live on /team or /people, not the homepage). Best-effort and free: a
// bot-blocked or JS-only site just means one fewer context section.
const FETCH_TIMEOUT_MS  = 8_000;
const MAX_PAGE_CHARS    = 2_500;
const TEAM_PATHS        = ["/team", "/people", "/about", "/our-team"];

async function fetchPage(url: string): Promise<{ title: string; metaDesc: string; body: string } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AlphaMapEnrichmentBot/1.0; +https://alphamap.app)",
        "Accept": "text/html",
      },
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript, svg, nav, footer").remove();

    const title    = $("title").first().text().trim();
    const metaDesc = $('meta[name="description"]').attr("content")?.trim()
      ?? $('meta[property="og:description"]').attr("content")?.trim()
      ?? "";
    const body     = $("body").text().replace(/\s+/g, " ").trim();
    if (!title && !metaDesc && !body) return null;
    return { title, metaDesc, body: body.slice(0, MAX_PAGE_CHARS) };
  } catch {
    return null;
  }
}

async function fetchFirmWebsite(website: string | null | undefined): Promise<string | null> {
  if (!website) return null;
  const base = website.startsWith("http") ? website : `https://${website}`;
  const root = base.replace(/\/+$/, "");

  const home = await fetchPage(root);
  const sections: string[] = [];
  if (home) {
    sections.push([
      "### Homepage",
      home.title    ? `Title: ${home.title}` : "",
      home.metaDesc ? `Meta description: ${home.metaDesc}` : "",
      home.body     ? `Page text: ${home.body}` : "",
    ].filter(Boolean).join("\n"));
  }

  // First team-ish page that yields real content wins
  for (const path of TEAM_PATHS) {
    const page = await fetchPage(`${root}${path}`);
    if (page && page.body.length > 200) {
      sections.push([
        `### Team page (${path})`,
        page.title ? `Title: ${page.title}` : "",
        page.body  ? `Page text: ${page.body}` : "",
      ].filter(Boolean).join("\n"));
      break;
    }
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
}

// ── Claude: extract the complete firm profile in one call ─────────────────────
async function researchFirm(name: string, website: string | null): Promise<InvestorEnrichmentResult | null> {
  const domain = websiteDomain(website);
  const anchor = domain ? ` "${domain}"` : "";

  const [profileRaw, thesisRaw, teamRaw, ownSiteRaw] = await Promise.all([
    serperSearch(`"${name}"${anchor} investment firm AUM assets under management fund size headquarters founded year`),
    serperSearch(`"${name}"${anchor} investment thesis focus strategy sectors stages portfolio companies typical check size`),
    serperSearch(`"${name}"${anchor} partners team managing partner founders leadership linkedin.com/in`),
    fetchFirmWebsite(website),
  ]);

  if (![profileRaw, thesisRaw, teamRaw, ownSiteRaw].some(Boolean)) return null;

  const context = [
    `## Firm's Own Website (HIGHEST TRUST for thesis, description, and the leadership roster — this is the firm describing itself)\n${ownSiteRaw ?? "(not fetched — no known website, fetch failed, or bot-blocked)"}`,
    `## Firm Profile & AUM\n${profileRaw ?? "(search failed)"}`,
    `## Thesis, Focus & Portfolio\n${thesisRaw ?? "(search failed)"}`,
    `## Partners & Leadership\n${teamRaw ?? "(search failed)"}`,
  ].join("\n\n");

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3072,
    tools: [{
      name: "save_investor_profile",
      description: "Save a verified profile for an investment firm (VC, PE, or growth equity)",
      input_schema: {
        type: "object" as const,
        properties: {
          is_investment_firm: {
            type: "boolean",
            description: [
              "TRUE only if this is genuinely an investment firm (VC fund, PE firm, growth-equity fund,",
              "family office, sovereign fund, corporate venture arm). FALSE if the research shows this",
              "name is actually an operating company, a person, or something else entirely — name",
              "collisions are common with short firm names.",
            ].join(" "),
          },
          firm_type: {
            type: "string",
            enum: ["vc", "pe", "growth"],
            description: [
              "'pe' = control buyouts / LBOs / take-privates as the core strategy.",
              "'vc' = minority venture stakes in startups (Pre-Seed through late-stage venture).",
              "'growth' = growth equity — large minority positions in established scale-ups.",
              "Pick the firm's PRIMARY strategy when it does several.",
            ].join(" "),
          },
          profile: {
            type: "object" as const,
            description: "Firm profile — omit any field you cannot verify.",
            properties: {
              description: {
                type: "string",
                description: "2-4 sentences: what the firm is, its scale/standing, and what it's known for. Factual, no marketing fluff.",
              },
              thesis: {
                type: "string",
                description: "1-3 sentences: the firm's stated investment thesis/focus — what they invest in and why, ideally in terms close to the firm's own website language. Omit if not found.",
              },
              aum: {
                type: "string",
                description: "Assets under management / total fund size as a short normalized string, e.g. '$85B', '$2.5B', '$400M'. Use the most recent verifiable figure. Omit if unknown — never estimate.",
              },
              headquarters: {
                type: "string",
                description: "HQ as 'City, Country' (e.g. 'New York, United States'). Omit if unknown.",
              },
              founded_year: { type: "integer", description: "Year the firm was founded." },
              website: { type: "string", description: "Root domain URL (https://example.com). Only if confidently this firm's site." },
              typical_check_size: {
                type: "string",
                description: "Typical investment size range, e.g. '$500K – $10M' or '$100M+'. Omit if undisclosed.",
              },
              portfolio_size: {
                type: "integer",
                description: "Approximate count of active portfolio companies, as a plain integer. Omit if unknown.",
              },
              stages: {
                type: "array",
                items: { type: "string", enum: ["Pre-Seed", "Seed", "Series A", "Series B", "Growth", "Buyout"] },
                description: "The stages the firm invests at. 'Buyout' for control acquisitions (PE).",
              },
              notable_investments: {
                type: "array",
                items: { type: "string" },
                description: "Up to 8 best-known portfolio companies / deals, company names only.",
              },
              sector_focus: {
                type: "array",
                description: "3-6 sectors the firm focuses on with a relative weight 0-100, derived from its thesis and portfolio (e.g. {sector:'AI', weight:85}).",
                items: {
                  type: "object" as const,
                  properties: {
                    sector: { type: "string", description: "Short sector label, e.g. 'AI', 'FinTech', 'SaaS', 'HealthTech', 'Cyber'." },
                    weight: { type: "integer", description: "Relative emphasis 0-100." },
                  },
                  required: ["sector", "weight"],
                },
              },
            },
          },
          leadership: {
            type: "array",
            description: [
              "The firm's leadership: founders, managing partners, general partners, C-level.",
              "Named, verifiable individuals only — the firm's own team page is the best source.",
            ].join(" "),
            items: {
              type: "object" as const,
              properties: {
                name:         { type: "string", description: "Full name." },
                role:         { type: "string", description: "Current title (Managing Partner, General Partner, Co-Founder, etc.)." },
                linkedin_url: { type: "string", description: "Their personal linkedin.com/in/... profile URL, if found. Omit if not found — never guess or construct one from a name." },
              },
              required: ["name", "role"],
            },
          },
          confidence_score: {
            type: "number",
            description: [
              "Integer 0–100. Be conservative.",
              "90–100: firm's own site fetched + multiple sources agree on AUM and facts.",
              "70–89: one strong source, no contradictions.",
              "50–69: partial data or minor conflicts.",
              "0–49: mostly inferred — omit dollar figures entirely at this level.",
            ].join(" "),
          },
          reasoning: {
            type: "string",
            description: "2–3 sentences: sources found, what was confirmed, why this confidence score.",
          },
        },
        required: ["is_investment_firm", "firm_type", "confidence_score", "reasoning"],
      },
    }],
    tool_choice: { type: "tool", name: "save_investor_profile" },
    messages: [{
      role: "user",
      content: `You are a financial data analyst. Extract the verified profile for the investment firm "${name}".

STRICT RULES:
1. IDENTITY — first confirm this is actually an investment firm and not a same-named operating company
   or person. When a known website domain appears in the research, treat matching that domain as the
   deciding signal. If it is not an investment firm, set is_investment_firm: false and stop.
2. FIRM TYPE — classify the PRIMARY strategy: 'pe' (control buyouts/LBOs), 'vc' (minority venture
   stakes), 'growth' (growth equity minority positions in scale-ups).
3. AUM — the single most important dollar figure. Use the most recent verifiable number, normalized
   like '$85B'. NEVER estimate or extrapolate it; omit if sources disagree wildly or nothing is found.
4. OWN WEBSITE FIRST — the "Firm's Own Website" section, when present, is the firm describing itself:
   prefer it for description, thesis, and the leadership roster over third-party snippets.
5. LEADERSHIP — named, verifiable individuals with current titles. The team page is the best source.
   Include each person's personal linkedin.com/in/... URL ONLY when it appears in the research —
   never construct one from a name.
6. THESIS — the firm's own stated focus, not your summary of their portfolio. 1-3 sentences.
7. OMIT RATHER THAN GUESS — every profile field carries "omit if unverifiable"; honor it.
8. CONFIDENCE — score honestly and conservatively; penalize missing AUM, conflicting sources, or a
   failed website fetch.

Research data:
${context}`,
    }],
  });

  totalInputTokens  += msg.usage.input_tokens;
  totalOutputTokens += msg.usage.output_tokens;

  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") return null;

  const i = tool.input as Partial<InvestorEnrichmentResult> & {
    profile?: ExtractedInvestorProfile;
    leadership?: ExtractedLeader[];
  };

  return {
    is_investment_firm: i.is_investment_firm ?? true,
    firm_type:          (i.firm_type === "pe" || i.firm_type === "growth") ? i.firm_type : "vc",
    profile:            i.profile ?? {},
    leadership:         (i.leadership ?? []).filter((l) => l.name && l.role),
    confidence_score:   typeof i.confidence_score === "number" ? i.confidence_score : 0,
    reasoning:          i.reasoning ?? "",
  };
}

// ── DB: patch investor row — fill NULLs only, dollar figures confidence-gated ─
function patchFromResult(
  existing: InvestorDbRow,
  result: InvestorEnrichmentResult,
): { patch: Record<string, unknown>; dollarsWithheld: boolean } {
  const { profile, leadership } = result;
  const patch: Record<string, unknown> = {};
  const confident = result.confidence_score >= MIN_CONFIDENCE;
  let dollarsWithheld = false;

  // Descriptive fields: fill-null only, always written when found
  if (!existing.description  && profile.description)  patch.description  = profile.description;
  if (!existing.thesis       && profile.thesis)       patch.thesis       = profile.thesis;
  if (!existing.headquarters && profile.headquarters) patch.headquarters = profile.headquarters;
  if (!existing.founded_year && profile.founded_year) patch.founded_year = profile.founded_year;
  if (!existing.website      && profile.website)      patch.website      = profile.website;
  if ((existing.portfolio_size == null) && profile.portfolio_size != null) {
    patch.portfolio_size = profile.portfolio_size;
  }
  if ((!existing.stages || existing.stages.length === 0) && (profile.stages?.length ?? 0) > 0) {
    patch.stages = profile.stages;
  }
  if ((!existing.notable_investments || existing.notable_investments.length === 0)
      && (profile.notable_investments?.length ?? 0) > 0) {
    patch.notable_investments = profile.notable_investments!.slice(0, 8);
  }
  if ((!existing.sector_allocation || Object.keys(existing.sector_allocation).length === 0)
      && (profile.sector_focus?.length ?? 0) > 0) {
    const alloc: Record<string, number> = {};
    for (const sf of profile.sector_focus!.slice(0, 6)) {
      if (sf.sector && typeof sf.weight === "number") {
        alloc[sf.sector] = Math.max(0, Math.min(100, Math.round(sf.weight)));
      }
    }
    if (Object.keys(alloc).length > 0) patch.sector_allocation = alloc;
  }

  // Dollar figures: confidence-gated (same philosophy as startup funding rounds)
  if (!existing.fund_size && profile.aum) {
    if (confident) patch.fund_size = profile.aum;
    else dollarsWithheld = true;
  }
  if (!existing.typical_check_size && profile.typical_check_size) {
    if (confident) patch.typical_check_size = profile.typical_check_size;
    else dollarsWithheld = true;
  }

  // firm_type: upgrade-only vc → pe/growth. The 'pe' tag can come from real
  // transaction data (pe_firms migration auto-tag) — a model guess must never
  // downgrade it back to 'vc'.
  if (existing.firm_type === "vc" && result.firm_type !== "vc") {
    patch.firm_type = result.firm_type;
  }

  // Leadership: fill when empty; backfill missing linkedin_url by name match
  // without ever overwriting an existing URL (same merge as startup founders).
  const cleanLeaders = leadership.map((l) => ({
    name: l.name.trim(),
    role: l.role.trim(),
    linkedin_url: l.linkedin_url?.trim() || null,
  })).filter((l) => l.name && l.role);

  if (cleanLeaders.length > 0) {
    const existingLeaders = existing.leadership ?? [];
    if (existingLeaders.length === 0) {
      patch.leadership = cleanLeaders;
    } else {
      const byName = new Map(cleanLeaders.map((l) => [l.name.toLowerCase(), l]));
      let changed = false;
      const updated = existingLeaders.map((el) => {
        const match = byName.get(el.name.toLowerCase());
        if (match?.linkedin_url && !el.linkedin_url) {
          changed = true;
          return { ...el, linkedin_url: match.linkedin_url };
        }
        return el;
      });
      if (changed) patch.leadership = updated;
    }
  }

  return { patch, dollarsWithheld };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = new Date().toISOString();
  const bar       = "═".repeat(62);

  console.log(`╔${"═".repeat(62)}╗`);
  console.log(`║${"  AlphaMap — Investor Profile Enrichment Run".padEnd(62)}║`);
  console.log(`║  ${startedAt}${"".padEnd(62 - 2 - startedAt.length)}║`);
  console.log(`║  DRY_RUN=${String(DRY_RUN).padEnd(5)} | BATCH=${String(BATCH_SIZE).padEnd(5)} | OFFSET=${String(OFFSET).padEnd(5)} | DELAY=${DELAY_MS / 1000}s${" ".padEnd(8)}║`);
  console.log(`║  MIN_CONFIDENCE=${String(MIN_CONFIDENCE).padEnd(4)} | MODEL=${MODEL.padEnd(30)}║`);
  console.log(`╚${"═".repeat(62)}╝\n`);

  if (DRY_RUN) console.log("ℹ️  DRY RUN — set DRY_RUN=false to apply writes to the database.\n");

  // ── 1. Fetch all investors (paginated — PostgREST caps single responses) ──
  const PAGE = 1000;
  const investors: InvestorDbRow[] = [];
  {
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("investors")
        .select("id, name, slug, description, thesis, founded_year, headquarters, fund_size, typical_check_size, portfolio_size, stages, sector_allocation, notable_investments, website, firm_type, leadership, last_enriched_at")
        .order("name")
        .range(from, from + PAGE - 1);
      if (error) { console.error("❌  fetch failed:", error.message); process.exit(1); }
      const batch = (data ?? []) as InvestorDbRow[];
      investors.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
  }

  // ── 2. Queue: rows missing key data; never-enriched first, then oldest ────
  const needsEnrichment = (r: InvestorDbRow) =>
    !r.description || !r.thesis || !r.fund_size || !r.headquarters ||
    !r.leadership || r.leadership.length === 0;

  const eligible = investors.filter(needsEnrichment);
  eligible.sort((a, b) => {
    const aNever = a.last_enriched_at == null;
    const bNever = b.last_enriched_at == null;
    if (aNever !== bNever) return aNever ? -1 : 1;
    if (!aNever && a.last_enriched_at !== b.last_enriched_at) {
      return a.last_enriched_at! < b.last_enriched_at! ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  const queue = eligible.slice(OFFSET, OFFSET + BATCH_SIZE);

  console.log("── Queue " + "─".repeat(54));
  console.log(`  Total investors:        ${investors.length}`);
  console.log(`  Missing key data:       ${eligible.length}`);
  console.log(`  Processing range:       [${OFFSET + 1}–${OFFSET + queue.length}] of ${eligible.length}`);
  console.log("─".repeat(62) + "\n");

  if (queue.length === 0) {
    console.log("✅  Nothing to process — every investor has its key profile data.\n");
    return;
  }

  // ── 3. Sequential processing loop ─────────────────────────────────────────
  const tally: Record<ProcessStatus, number> = {
    success: 0, partial: 0, low_confidence: 0, not_a_firm: 0, no_data: 0, error: 0,
  };
  const STATUS_ICON: Record<ProcessStatus, string> = {
    success: "✅", partial: "🟠", low_confidence: "⚠️ ", not_a_firm: "🚫", no_data: "🔍", error: "❌",
  };
  let totalFieldsPatched = 0;

  for (let i = 0; i < queue.length; i++) {
    const row = queue[i];
    const idx = OFFSET + i + 1;

    const missing = [
      !row.description                                    && "description",
      !row.thesis                                         && "thesis",
      !row.fund_size                                      && "AUM",
      !row.headquarters                                   && "HQ",
      (!row.leadership || row.leadership.length === 0)    && "leadership",
    ].filter(Boolean);

    console.log(`\n[${idx}/${eligible.length}] "${row.name}" | ${row.firm_type.toUpperCase()} | Missing before this pass: ${missing.join(", ")}`);

    let status: ProcessStatus = "error";
    let fieldsPatched = 0;
    let confidenceSeen: number | null = null;

    try {
      const result = await researchFirm(row.name, row.website);
      if (result) confidenceSeen = result.confidence_score;

      if (!result) {
        console.log(`    🔍  All searches and the site fetch failed — no data retrieved`);
        status = "no_data";

      } else if (!result.is_investment_firm) {
        // Stamped below so it isn't retried forever; nothing written.
        console.log(`    🚫  Not an investment firm (name collision) — nothing written`);
        console.log(`    📝  ${result.reasoning}`);
        status = "not_a_firm";

      } else {
        const scoreIcon =
          result.confidence_score >= 90 ? "🟢" :
          result.confidence_score >= 70 ? "🟡" :
          result.confidence_score >= MIN_CONFIDENCE ? "🟠" : "🔴";
        console.log(`    ${scoreIcon}  Confidence: ${result.confidence_score}/100 | firm_type: ${result.firm_type} | ${result.leadership.length} leader(s)`);
        if (result.reasoning) console.log(`    📝  ${result.reasoning}`);

        const { patch, dollarsWithheld } = patchFromResult(row, result);
        fieldsPatched = Object.keys(patch).length;

        if (fieldsPatched === 0) {
          status = dollarsWithheld ? "low_confidence" : "success";
          if (dollarsWithheld) console.log(`    ⚠️  Only dollar figures found, withheld (confidence < ${MIN_CONFIDENCE})`);
          else console.log(`    ▫️  Nothing new to write (all found fields already populated)`);
        } else if (DRY_RUN) {
          console.log(`    [DRY] Would patch: ${Object.keys(patch).join(", ")}`);
          status = dollarsWithheld ? "partial" : "success";
        } else {
          const { error } = await supabase.from("investors").update(patch).eq("id", row.id);
          if (error) {
            console.warn(`    ⚠️  Patch failed: ${error.message}`);
            status = "error";
            fieldsPatched = 0;
          } else {
            console.log(`    👤  Patched: ${Object.keys(patch).join(", ")}`);
            status = dollarsWithheld ? "partial" : "success";
          }
        }
        if (dollarsWithheld && status !== "error") {
          console.log(`    🟠  AUM/check-size found but confidence ${result.confidence_score} < ${MIN_CONFIDENCE} — dollar figures withheld`);
        }
        totalFieldsPatched += fieldsPatched;
      }
    } catch (err) {
      console.error(`    ❌  Unhandled error: ${String(err)}`);
      status = "error";
    }

    tally[status]++;

    // Stamp so the queue advances (errors excluded → retried next run)
    if (status !== "error" && !DRY_RUN) {
      const stamp: Record<string, unknown> = { last_enriched_at: new Date().toISOString() };
      if (confidenceSeen != null) stamp.enrichment_confidence = confidenceSeen;
      const { error: stampErr } = await supabase.from("investors").update(stamp).eq("id", row.id);
      if (stampErr) console.warn(`    ⚠️  last_enriched_at stamp failed: ${stampErr.message}`);
    }

    console.log(`    → [${idx}/${eligible.length}] ${row.name} | ${STATUS_ICON[status]} ${status.replace("_", " ")}${fieldsPatched ? ` | ${fieldsPatched} fields` : ""}`);

    if (i < queue.length - 1) {
      console.log(`    ⏳  Waiting ${DELAY_MS / 1000}s…`);
      await sleep(DELAY_MS);
    }
  }

  // ── 4. Summary ────────────────────────────────────────────────────────────
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  const claudeCost = totalInputTokens * PRICING.input + totalOutputTokens * PRICING.output;

  console.log(`\n${bar}`);
  console.log("INVESTOR ENRICHMENT SUMMARY");
  console.log(bar);
  console.log(`  Firms processed:        ${queue.length}  (of ${eligible.length} needing data)`);
  console.log(`  ✅  Success:             ${tally.success}`);
  console.log(`  🟠  Partial:             ${tally.partial}  (profile written, $ figures withheld — confidence < ${MIN_CONFIDENCE})`);
  console.log(`  ⚠️   Low confidence:     ${tally.low_confidence}`);
  console.log(`  🚫  Not a firm:          ${tally.not_a_firm}  (name collisions — stamped, nothing written)`);
  console.log(`  🔍  No data:             ${tally.no_data}`);
  console.log(`  ❌  Errors:              ${tally.error}`);
  console.log(`  📝  Fields written:      ${totalFieldsPatched}`);
  console.log(`  🔍  Serper calls used:   ${serperCallCount}`);
  console.log(`  🧠  Claude tokens:       ${totalInputTokens.toLocaleString()} in / ${totalOutputTokens.toLocaleString()} out`);
  console.log(`  💵  Claude cost (est.):  $${claudeCost.toFixed(2)}  (${MODEL} @ $${(PRICING.input * 1_000_000).toFixed(2)}/$${(PRICING.output * 1_000_000).toFixed(2)} per MTok — Serper cost separate)`);
  console.log(`  ⏱️   Elapsed:             ${Math.floor(elapsedMs / 60_000)}m ${Math.floor((elapsedMs % 60_000) / 1000)}s`);

  if (DRY_RUN) console.log(`\n  ℹ️  DRY RUN — rerun with DRY_RUN=false to apply writes.`);
  if (OFFSET + queue.length < eligible.length) {
    console.log(`\n  ▶️  ~${eligible.length - queue.length} firms still waiting. Re-run with the SAME settings (keep OFFSET=0) —`);
    console.log(`     processed firms are stamped with last_enriched_at and move behind the untouched ones.`);
  } else {
    console.log(`\n  🏁  Every firm needing data has been processed.`);
  }
  console.log(bar + "\n");

  if (tally.error > 0 && tally.success === 0 && tally.partial === 0) process.exit(1);
}

main().catch((e) => {
  console.error("💥  Fatal error:", e);
  process.exit(1);
});
