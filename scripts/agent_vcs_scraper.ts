#!/usr/bin/env node
/**
 * agent_vcs_scraper.ts — Modular multi-source VC ingestion pipeline
 *
 * Architecture: Adapter pattern
 *   Each source implements VCAdapter → scrape() → RawVCProfile[]
 *   The orchestrator handles normalization, entity resolution, and safe upserts.
 *
 * Source registry (run in order; earlier adapters have higher priority):
 *   1. VCDirectoryAdapter  — curated high-confidence baseline
 *   2. WikipediaAdapter    — mass ingestion from Wikipedia's VC list table
 *
 * ── Adding a new adapter ───────────────────────────────────────────────────────
 * 1. Implement the VCAdapter interface (name + scrape()).
 * 2. Add an instance to ADAPTER_REGISTRY below.
 * 3. Done — entity resolution, dedup, and safety are handled by the orchestrator.
 *
 * Example adapters to add next:
 *   - TechCrunchRssAdapter   parse TC RSS feed for newly announced funds/firms
 *   - CrunchbaseExportAdapter ingest a public CSV export from Crunchbase Open Data
 *   - PitchBookTableAdapter  scrape PitchBook's public league table pages
 *   - AngelListAdapter       AngelList Venture public fund directory (no key needed)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Usage:
 *   npx tsx scripts/agent_vcs_scraper.ts                  # dry run (default)
 *   DRY_RUN=false npx tsx scripts/agent_vcs_scraper.ts    # live write
 *   SOURCE=wikipedia npx tsx scripts/agent_vcs_scraper.ts # single adapter
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

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) { console.error(`❌  Missing env var: ${k}`); process.exit(1); }
}

const DRY_RUN       = process.env.DRY_RUN !== "false";
const SOURCE_FILTER = process.env.SOURCE?.toLowerCase() ?? null; // optional: run one adapter

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const WIKIPEDIA_UA = "AlphaMapVCScraper/1.0 (https://alphamap.io; contact@alphamap.io)";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Loose profile returned by any adapter — only `name` is required. */
interface RawVCProfile {
  name:               string;
  description?:       string;
  founded_year?:      number | null;
  headquarters?:      string | null;
  fund_size?:         string | null;
  typical_check_size?: string | null;
  portfolio_size?:    number | null;
  stages?:            string[];
  sector_allocation?: Record<string, number>;
  notable_investments?: string[];
  website?:           string | null;
}

/** Every source adapter must implement this interface. */
interface VCAdapter {
  readonly name: string;
  scrape(): Promise<RawVCProfile[]>;
}

type UpsertResult = "upserted" | "protected" | "duplicate" | "skipped" | "error";

// ── Entity Resolution ─────────────────────────────────────────────────────────

/**
 * Canonical key for fuzzy entity matching.
 *
 * Strips common VC legal/type suffixes (iteratively, to handle multi-suffix
 * names like "ABC Venture Capital Partners"), removes diacritics and special
 * chars, and collapses whitespace. Two firms with the same normalized name
 * are treated as the same entity even if their raw names differ.
 *
 * Examples:
 *   "Andreessen Horowitz"          → "andreessen horowitz"
 *   "Sequoia Capital"              → "sequoia"
 *   "Lightspeed Venture Partners"  → "lightspeed"
 *   "New Enterprise Associates"    → "new enterprise"
 *   "Accel Partners"               → "accel"
 */
const STRIP_SUFFIXES = [
  // Compound phrases (must come before single-word equivalents)
  "venture capital", "venture partners", "capital partners",
  "capital management", "capital group", "growth partners",
  "growth equity", "equity partners", "investment partners",
  "investment group", "investment management",
  // Single words
  "ventures", "venture", "capital", "partners", "investments",
  "associates", "group", "management", "fund", "equity",
  // Legal
  "inc", "llc", "lp", "ltd", "gmbh",
];

export function normalizeName(raw: string): string {
  let s = raw.toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // strip diacritics
    .replace(/[^a-z0-9\s]/g, " ")      // special chars → space
    .replace(/\s+/g, " ")
    .trim();

  // Iteratively strip trailing suffixes until stable
  let prev: string;
  do {
    prev = s;
    for (const suf of STRIP_SUFFIXES) {
      const re = new RegExp(`\\s+${suf.replace(/\s/g, "\\s+")}\\s*$`);
      s = s.replace(re, "").trimEnd();
    }
  } while (s !== prev);

  return s.replace(/\s+/g, " ").trim();
}

/**
 * Extracts a canonical domain from a URL — the primary entity key.
 * More stable than firm names ("Andreessen Horowitz" == "a16z" but both
 * point to a16z.com). Returns null for unparseable / missing URLs.
 *
 *   "https://www.sequoiacap.com/"  →  "sequoiacap.com"
 *   "https://a16z.com"             →  "a16z.com"
 *   "www.benchmark.com"            →  "benchmark.com"
 */
export function normalizeDomain(url: string): string | null {
  if (!url?.trim()) return null;
  try {
    const full = url.startsWith("http") ? url : `https://${url}`;
    const { hostname } = new URL(full);
    return hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    // Bare domain without protocol (e.g. "lsvp.com") — try a quick regex
    const m = url.match(/^(?:www\.)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return m ? m[1].toLowerCase() : null;
  }
}

/** Derives a unique 3-6 char slug from a firm name. */
function generateSlug(name: string, takenSlugs: Set<string>): string {
  const words = name
    .split(/[\s\-&+/]+/)
    .map(w => w.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(w => w.length > 0);

  const base =
    words.length === 1
      ? words[0].slice(0, 6).toUpperCase()
      : (words[0].slice(0, 3) + words[words.length - 1].slice(0, 3)).toUpperCase();

  if (!takenSlugs.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base.slice(0, 5)}${i}`;
    if (!takenSlugs.has(candidate)) return candidate;
  }
  return base + Date.now().toString(36).slice(-4).toUpperCase();
}

// ── DB Utilities ──────────────────────────────────────────────────────────────

interface ExistingEntry {
  id:       string;
  name:     string;
  slug:     string;
  verified: boolean;
  domain:   string | null;  // normalized domain — primary entity key
}

/**
 * Loads all existing investors and builds two lookup indexes:
 *   byDomain — keyed by normalizeDomain(website)  ← primary resolution key
 *   byNorm   — keyed by normalizeName(name)        ← fallback when no website
 */
async function buildExistingMap(): Promise<{
  byNorm:   Map<string, ExistingEntry>;
  byDomain: Map<string, ExistingEntry>;
  slugs:    Set<string>;
}> {
  const { data, error } = await supabase
    .from("investors")
    .select("id, name, slug, website, is_manually_verified");

  if (error) throw new Error(`buildExistingMap: ${error.message}`);

  const byNorm   = new Map<string, ExistingEntry>();
  const byDomain = new Map<string, ExistingEntry>();
  const slugs    = new Set<string>();

  for (const row of data ?? []) {
    const domain = normalizeDomain(row.website);
    const entry: ExistingEntry = {
      id:       row.id,
      name:     row.name,
      slug:     row.slug,
      verified: row.is_manually_verified ?? false,
      domain,
    };
    byNorm.set(normalizeName(row.name), entry);
    if (domain) byDomain.set(domain, entry);
    slugs.add(row.slug);
  }
  return { byNorm, byDomain, slugs };
}

/**
 * Writes a single profile with four safety layers applied in order:
 *
 *  1. Domain-first resolution — if the profile has a website, its normalized
 *     domain is checked against byDomain first. This is the primary key because
 *     it survives name variations ("a16z" vs "Andreessen Horowitz" both map to
 *     a16z.com). When a domain match is found, we UPDATE that existing row by id.
 *
 *  2. Name-fallback resolution — for firms without a known website, fall back to
 *     normalizeName(). Cross-alias collisions (same normalized form, different raw
 *     name) are logged as duplicates and skipped rather than inserted as new rows.
 *
 *  3. is_manually_verified safety gate — if either resolution path finds a row
 *     with is_manually_verified=TRUE, the write is skipped entirely.
 *
 *  4. ON CONFLICT (name) — DB-level safety net for truly new insertions.
 */
async function safeUpsert(
  profile:   RawVCProfile,
  byNorm:    Map<string, ExistingEntry>,
  byDomain:  Map<string, ExistingEntry>,
  slugs:     Set<string>,
  source:    string,
): Promise<UpsertResult> {
  // ── 1. Domain-first resolution ────────────────────────────────────────────
  const domain = normalizeDomain(profile.website ?? "");
  let existing: ExistingEntry | undefined = domain ? byDomain.get(domain) : undefined;

  if (existing && existing.name !== profile.name) {
    console.log(
      `  ~  [${source}] "${profile.name}" → ${domain} matches ` +
      `"${existing.name}" (same firm, different alias)`,
    );
  }

  // ── 2. Name-fallback resolution ───────────────────────────────────────────
  if (!existing) {
    const norm      = normalizeName(profile.name);
    const nameMatch = byNorm.get(norm);
    if (nameMatch) {
      if (nameMatch.name !== profile.name) {
        // Different raw name, same normalized form — cross-alias duplicate
        console.log(
          `  ↩  [${source}] "${profile.name}" normalises to "${norm}" ` +
          `— already indexed as "${nameMatch.name}" — skipping`,
        );
        return "duplicate";
      }
      existing = nameMatch;
    }
  }

  // ── 3. is_manually_verified safety gate ──────────────────────────────────
  if (existing?.verified) {
    console.log(`  🔒 [${source}] "${profile.name}" is manually verified — skipping`);
    return "protected";
  }

  // ── 4. Assemble the DB row ────────────────────────────────────────────────
  const slug = existing?.slug ?? generateSlug(profile.name, slugs);
  const now  = new Date().toISOString();

  const fields = {
    description:         profile.description         ?? null,
    founded_year:        profile.founded_year         ?? null,
    headquarters:        profile.headquarters         ?? null,
    fund_size:           profile.fund_size            ?? null,
    typical_check_size:  profile.typical_check_size   ?? null,
    portfolio_size:      profile.portfolio_size        ?? null,
    stages:              profile.stages               ?? [],
    sector_allocation:   profile.sector_allocation    ?? {},
    notable_investments: profile.notable_investments  ?? [],
    website:             profile.website              ?? null,
    updated_at:          now,
  };

  if (DRY_RUN) {
    const action = existing ? "Would update" : "Would insert";
    console.log(
      `  [DRY RUN] [${source}] ${action} "${profile.name}" ` +
      `(slug: ${slug}, domain: ${domain ?? "—"}, founded: ${fields.founded_year ?? "?"})`,
    );
    // Register in local maps so later adapters see this as "existing"
    if (!existing) {
      const entry: ExistingEntry = { id: "dry-run", name: profile.name, slug, verified: false, domain };
      slugs.add(slug);
      byNorm.set(normalizeName(profile.name), entry);
      if (domain) byDomain.set(domain, entry);
    }
    return "upserted";
  }

  // ── 5. Write to DB ────────────────────────────────────────────────────────
  let dbError: { message: string } | null = null;

  if (existing) {
    // UPDATE by id — domain matched (possibly different name); preserves slug and FK links
    const { error } = await supabase
      .from("investors")
      .update(fields)
      .eq("id", existing.id);
    dbError = error;
  } else {
    // INSERT — new firm; ON CONFLICT (name) is the final DB-level safety net
    const { error } = await supabase
      .from("investors")
      .upsert({ name: profile.name, slug, ...fields, is_manually_verified: false }, { onConflict: "name" });
    dbError = error;
    if (!error) {
      const entry: ExistingEntry = { id: "new", name: profile.name, slug, verified: false, domain };
      slugs.add(slug);
      byNorm.set(normalizeName(profile.name), entry);
      if (domain) byDomain.set(domain, entry);
    }
  }

  if (dbError) {
    console.error(`  ❌ [${source}] "${profile.name}": ${dbError.message}`);
    return "error";
  }

  const verb = existing ? "Updated " : "Inserted";
  console.log(`  ✅ [${source}] ${verb} "${profile.name}" (slug: ${slug}, domain: ${domain ?? "—"})`);
  return "upserted";
}

// ── Adapter 1: VCDirectory (curated high-confidence baseline) ─────────────────
// Same data as agent_vcs.ts but wrapped in the adapter interface so it
// participates in entity resolution and the safety gate like any other source.

class VCDirectoryAdapter implements VCAdapter {
  readonly name = "VCDirectory";

  async scrape(): Promise<RawVCProfile[]> {
    return [
      {
        name: "Sequoia Capital",
        description: "One of Silicon Valley's founding venture firms, Sequoia has backed companies responsible for more than 25% of NASDAQ's total value. Its Global Equities program and Arc accelerator reflect a rare full-stack model from pre-seed to public markets.",
        founded_year: 1972,
        headquarters: "Menlo Park, CA",
        fund_size: "$85B+ AUM",
        typical_check_size: "$1M – $100M",
        portfolio_size: 1500,
        stages: ["Pre-Seed", "Seed", "Series A", "Series B", "Growth", "Public"],
        sector_allocation: { AI: 88, FinTech: 72, Cyber: 58, SaaS: 92, HealthTech: 62, FoodTech: 28 },
        notable_investments: ["Apple", "Google", "GitHub", "Stripe", "Airbnb", "Klarna", "Unity"],
        website: "https://www.sequoiacap.com",
      },
      {
        name: "Andreessen Horowitz",
        description: "a16z pioneered the 'full-stack VC' concept — combining capital with a proprietary talent network, go-to-market support, and regulatory affairs teams. Its dedicated crypto, bio, and American Dynamism funds signal explicit sector conviction.",
        founded_year: 2009,
        headquarters: "Menlo Park, CA",
        fund_size: "$42B AUM",
        typical_check_size: "$500K – $50M",
        portfolio_size: 900,
        stages: ["Seed", "Series A", "Series B", "Growth"],
        sector_allocation: { AI: 90, FinTech: 80, Cyber: 65, SaaS: 85, HealthTech: 70, FoodTech: 22 },
        notable_investments: ["Facebook", "Lyft", "Coinbase", "GitHub", "Roblox", "OpenAI"],
        website: "https://a16z.com",
      },
      {
        name: "Accel",
        description: "Accel is a global venture firm with a laser focus on infrastructure, security, and SaaS. Its early bets on Dropbox, Facebook, and Slack established a pattern of identifying category-defining enterprise platforms before they break out.",
        founded_year: 1983,
        headquarters: "Palo Alto, CA",
        fund_size: "$20B+ AUM",
        typical_check_size: "$500K – $30M",
        portfolio_size: 600,
        stages: ["Seed", "Series A", "Series B", "Series C"],
        sector_allocation: { AI: 70, FinTech: 60, Cyber: 82, SaaS: 90, HealthTech: 45, FoodTech: 18 },
        notable_investments: ["Facebook", "Slack", "Dropbox", "Crowdstrike", "Atlassian", "Spotify"],
        website: "https://www.accel.com",
      },
      {
        name: "Lightspeed Venture Partners",
        description: "Lightspeed operates four global platforms — US, Europe, India, and China — enabling it to identify cross-border opportunities and back companies at Seed through late-stage. Strong thesis in consumer internet and enterprise AI.",
        founded_year: 2000,
        headquarters: "Menlo Park, CA",
        fund_size: "$25B AUM",
        typical_check_size: "$1M – $20M",
        portfolio_size: 500,
        stages: ["Seed", "Series A", "Series B", "Growth"],
        sector_allocation: { AI: 75, FinTech: 68, Cyber: 52, SaaS: 80, HealthTech: 58, FoodTech: 45 },
        notable_investments: ["Snapchat", "Affirm", "Nutanix", "MuleSoft", "Epic Games", "Razorpay"],
        website: "https://lsvp.com",
      },
      {
        name: "Benchmark",
        description: "Benchmark's equal-partnership model and deliberate small-fund strategy ($425M funds) is a philosophical outlier in an era of mega-funds. Their concentrated bets and board-level conviction produced Uber, Twitter, Snap, and Discord.",
        founded_year: 1995,
        headquarters: "San Francisco, CA",
        fund_size: "$425M per fund",
        typical_check_size: "$5M – $25M",
        portfolio_size: 250,
        stages: ["Series A", "Series B"],
        sector_allocation: { AI: 62, FinTech: 55, Cyber: 40, SaaS: 78, HealthTech: 42, FoodTech: 30 },
        notable_investments: ["Uber", "Twitter", "Snap", "Discord", "Stitch Fix", "Zillow"],
        website: "https://www.benchmark.com",
      },
    ];
  }
}

// ── Adapter 2: Wikipedia (mass ingestion) ────────────────────────────────────
// Fetches the Wikipedia "List of venture capital firms" article via the free
// MediaWiki API, parses the wikitables to extract firm names and basic metadata,
// then batch-enriches with lead-paragraph descriptions.
//
// Data quality: medium — names and founding years are reliable; AUM, check size,
// and sector allocation are NOT available from Wikipedia and stay null/empty.
// Those gaps are filled over time as deal data grows (internal aggregator).

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKI_LIST_PAGE = "List_of_venture_capital_firms";
const WIKI_ENRICH_BATCH = 20;   // titles per API request
const WIKI_BATCH_DELAY  = 250;  // ms between batch requests (polite crawling)

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Strips wiki markup from a raw cell string and returns clean plain text. */
function stripWikiMarkup(raw: string): string {
  return raw
    // [[Target|Display]] → Display
    .replace(/\[\[(?:[^\]|]+\|)?([^\]|]+)\]\]/g, "$1")
    // {{flag|XX}} → XX, {{plainlist|...}} → "", {{...}} → ""
    .replace(/\{\{(?:[^}|]+\|)?([^}]*)\}\}/g, "$1")
    .replace(/\{\{[^}]*\}\}/g, "")
    // Remove HTML tags
    .replace(/<[^>]+>/g, "")
    // Remove ref tags
    .replace(/<ref[^/]*\/>/g, "")
    // Remove bold/italic
    .replace(/'{2,}/g, "")
    // Common HTML entities
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extracts [[WikiTitle|Display]] parts from a cell, returning both. */
function extractWikiLink(cell: string): { title: string; display: string } | null {
  const m = cell.match(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/);
  if (!m) return null;
  const title   = m[1].trim();
  const display = (m[2] ?? m[1]).trim();
  if (/^(File|Image|Category|Template|WP):/i.test(title)) return null;
  return { title, display };
}

interface ParsedWikiRow {
  firmName:   string;
  wikiTitle:  string;  // used for Wikipedia API lookup
  rawCells:   string[];
}

/**
 * Parses wikitable markup from the list article into rows.
 * Handles both inline "| A || B || C" and multi-line "| A \n| B \n| C" formats.
 */
function parseWikitableRows(wikitext: string): ParsedWikiRow[] {
  const rows: ParsedWikiRow[] = [];
  let inTable  = false;
  let rowCells: string[] = [];
  let pendingRow = false;

  const flushRow = () => {
    if (!pendingRow || rowCells.length === 0) return;
    const firstCell = rowCells[0];
    const link = extractWikiLink(firstCell);
    const name = link?.display ?? stripWikiMarkup(firstCell);
    // Skip headers, navbox rows, and empty/short names
    if (name.length < 3 || name.length > 100) return;
    // Skip if name looks like a country or region
    if (/^(United States|Europe|Asia|Africa|Canada|UK|Israel|India|China)$/i.test(name)) return;
    rows.push({
      firmName:  name,
      wikiTitle: link?.title ?? name,
      rawCells:  rowCells,
    });
  };

  for (const line of wikitext.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.startsWith("{|"))  { inTable = true;  continue; }
    if (trimmed.startsWith("|}"))  { flushRow(); inTable = false; pendingRow = false; rowCells = []; continue; }
    if (!inTable)                  continue;
    if (trimmed.startsWith("!"))   continue; // header row

    if (trimmed.startsWith("|-")) {
      flushRow();
      rowCells  = [];
      pendingRow = true;
      continue;
    }

    if (pendingRow && trimmed.startsWith("|")) {
      // May be "| A || B || C" (inline) or "| A" (one cell per line)
      const cellContent = trimmed.slice(1);
      if (cellContent.includes("||")) {
        rowCells.push(...cellContent.split("||").map(c => c.trim()));
      } else {
        rowCells.push(cellContent.trim());
      }
    }
  }
  flushRow();
  return rows;
}

/** Extracts the first 4-digit year from a string (handles "Est. 1983", "{{Start date|1972}}"). */
function extractYear(text: string): number | null {
  const m = text.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0]) : null;
}

/**
 * Batch-fetches introductory text for up to WIKI_ENRICH_BATCH titles per call.
 * Returns a Map<title → description>.
 */
async function fetchWikipediaExtracts(
  titles: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (titles.length === 0) return result;

  const params = new URLSearchParams({
    action:    "query",
    prop:      "extracts",
    exintro:   "1",
    exsentences: "3",
    explaintext: "1",
    redirects: "1",
    titles:    titles.join("|"),
    format:    "json",
  });

  const res = await fetch(`${WIKI_API}?${params}`, {
    headers: { "User-Agent": WIKIPEDIA_UA },
  });
  const json = await res.json() as {
    query?: { pages?: Record<string, { title: string; extract?: string }> };
  };

  for (const page of Object.values(json.query?.pages ?? {})) {
    if (page.extract && page.extract.length > 20) {
      // Truncate to ~400 chars, stopping at a sentence boundary
      const short = page.extract.slice(0, 420).replace(/\.[^.]*$/, ".").trim();
      result.set(page.title, short);
    }
  }
  return result;
}

class WikipediaAdapter implements VCAdapter {
  readonly name = "Wikipedia";

  async scrape(): Promise<RawVCProfile[]> {
    console.log("  📡 Fetching Wikipedia VC list…");

    // ── Step 1: Fetch the list article wikitext ────────────────────────────
    const listParams = new URLSearchParams({
      action: "parse",
      page:   WIKI_LIST_PAGE,
      prop:   "wikitext",
      format: "json",
    });

    let wikitext = "";
    try {
      const res  = await fetch(`${WIKI_API}?${listParams}`, { headers: { "User-Agent": WIKIPEDIA_UA } });
      const json = await res.json() as { parse?: { wikitext?: { "*"?: string } } };
      wikitext = json.parse?.wikitext?.["*"] ?? "";
    } catch (err) {
      console.warn(`  ⚠️  Wikipedia fetch failed: ${(err as Error).message} — returning []`);
      return [];
    }

    if (!wikitext) {
      console.warn("  ⚠️  Wikipedia returned empty wikitext — returning []");
      return [];
    }

    // ── Step 2: Parse wikitable rows ───────────────────────────────────────
    const parsed = parseWikitableRows(wikitext);
    console.log(`  📊 Parsed ${parsed.length} candidate rows from Wikipedia`);

    if (parsed.length === 0) return [];

    // ── Step 3: Batch-enrich with Wikipedia descriptions ──────────────────
    const wikiTitles = [...new Set(parsed.map(r => r.wikiTitle))];
    const descriptions = new Map<string, string>();

    for (let i = 0; i < wikiTitles.length; i += WIKI_ENRICH_BATCH) {
      const batch = wikiTitles.slice(i, i + WIKI_ENRICH_BATCH);
      const partial = await fetchWikipediaExtracts(batch);
      for (const [k, v] of partial) descriptions.set(k, v);
      if (i + WIKI_ENRICH_BATCH < wikiTitles.length) await delay(WIKI_BATCH_DELAY);
    }

    console.log(`  💬 Got descriptions for ${descriptions.size}/${wikiTitles.length} firms`);

    // ── Step 4: Assemble RawVCProfile from parsed rows ────────────────────
    const profiles: RawVCProfile[] = [];
    const seen = new Set<string>(); // dedup within this adapter's output

    for (const row of parsed) {
      const name = row.firmName;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());

      // Extract year from second cell if available (common table structure: Name | Country | Founded)
      const yearCell      = row.rawCells[2] ?? row.rawCells[1] ?? "";
      const founded_year  = extractYear(stripWikiMarkup(yearCell));

      // Notable investments sometimes in 4th column
      const notesCell    = row.rawCells[3] ?? "";
      const notesClean   = stripWikiMarkup(notesCell);
      const notable_investments = notesClean.length > 2 && notesClean.length < 300
        ? notesClean
            .split(/[,;·•]/)
            .map(s => s.trim())
            .filter(s => s.length > 1 && s.length < 60)
            .slice(0, 8)
        : [];

      profiles.push({
        name,
        description:         descriptions.get(row.wikiTitle) ?? null,
        founded_year:        founded_year,
        headquarters:        null, // Wikipedia tables rarely give city-level HQ; left for manual enrichment
        notable_investments: notable_investments.length > 0 ? notable_investments : undefined,
        // fund_size, typical_check_size, sector_allocation: not available from Wikipedia
        // → filled over time by the internal deals aggregator (agent_vcs.ts)
      });
    }

    return profiles;
  }
}

// ── [FUTURE] News-Feed Adapters ───────────────────────────────────────────────
//
// To add a TechCrunch RSS adapter, create a class like:
//
//   class TechCrunchRssAdapter implements VCAdapter {
//     readonly name = "TechCrunchRSS";
//     async scrape(): Promise<RawVCProfile[]> {
//       const res  = await fetch("https://techcrunch.com/feed/?s=venture+capital");
//       const xml  = await res.text();
//       // Parse <item> elements, extract <title> and <description>, NLP-extract firm names.
//       // Return RawVCProfile[] with only { name, description } — orchestrator handles the rest.
//       return [];
//     }
//   }
//
// Then add `new TechCrunchRssAdapter()` to ADAPTER_REGISTRY.
// No other changes needed — entity resolution and safety are automatic.
//
// ─────────────────────────────────────────────────────────────────────────────

// ── Adapter Registry ──────────────────────────────────────────────────────────
// Adapters run in order. Earlier entries have higher priority: if two adapters
// produce the same normalized entity, the first one's data is kept and the
// second adapter's version is recorded as a duplicate and skipped.

const ADAPTER_REGISTRY: VCAdapter[] = [
  new VCDirectoryAdapter(),  // highest-confidence data, runs first
  new WikipediaAdapter(),    // mass ingestion, fills in new firms
];

// ── Orchestrator ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`\n🤖  AlphaMap VC Scraper`);
  console.log(`   Mode    : ${DRY_RUN ? "DRY RUN (set DRY_RUN=false to write)" : "LIVE WRITE"}`);
  console.log(`   Adapters: ${ADAPTER_REGISTRY.map(a => a.name).join(", ")}`);
  if (SOURCE_FILTER) console.log(`   Filter  : ${SOURCE_FILTER}`);
  console.log();

  const grand = { upserted: 0, protected: 0, duplicate: 0, error: 0, total: 0 };

  // Load current DB state once — always required and always fatal if it fails.
  // Both dry-run and live-write need the existing map for accurate entity
  // resolution; a DB connection error here means the Action should fail visibly
  // rather than silently skipping dedup checks.
  const { byNorm, byDomain, slugs } = await buildExistingMap();
  console.log(`   DB state: ${byNorm.size} existing investors loaded\n`);

  for (const adapter of ADAPTER_REGISTRY) {
    if (SOURCE_FILTER && adapter.name.toLowerCase() !== SOURCE_FILTER) continue;

    console.log(`\n▶  [${adapter.name}] Scraping…`);
    const tally = { upserted: 0, protected: 0, duplicate: 0, error: 0 };

    let profiles: RawVCProfile[];
    try {
      profiles = await adapter.scrape();
    } catch (err) {
      console.error(`  ❌ [${adapter.name}] scrape() threw: ${(err as Error).message}`);
      grand.error++;
      continue;
    }

    console.log(`  📦 [${adapter.name}] ${profiles.length} profiles returned`);

    for (const profile of profiles) {
      if (!profile.name?.trim()) continue;
      grand.total++;

      const result = await safeUpsert(profile, byNorm, byDomain, slugs, adapter.name);
      tally[result === "skipped" ? "protected" : result]++;
    }

    console.log(
      `  ── [${adapter.name}] done: ` +
      `${tally.upserted} upserted · ` +
      `${tally.protected} protected · ` +
      `${tally.duplicate} duplicates · ` +
      `${tally.error} errors`,
    );

    grand.upserted  += tally.upserted;
    grand.protected += tally.protected;
    grand.duplicate += tally.duplicate;
    grand.error     += tally.error;
  }

  console.log(`\n── Grand Summary ${"─".repeat(40)}`);
  console.log(`   Total processed : ${grand.total}`);
  console.log(`   Upserted        : ${grand.upserted}`);
  console.log(`   Protected (skip): ${grand.protected}`);
  console.log(`   Duplicates (skip): ${grand.duplicate}`);
  console.log(`   Errors          : ${grand.error}`);
  console.log(`${"─".repeat(52)}\n`);
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
