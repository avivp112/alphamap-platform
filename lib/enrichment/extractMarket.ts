/**
 * lib/enrichment/extractMarket.ts — the third extraction call: competitors
 * (with a short overview of each), acquisitions, news, patents, and
 * technology. These used to ride along inside the profile call, which also
 * carries the overview, founders, leadership, and headcount -- one very
 * large schema for a single Haiku call. Real DRY_RUN=false runs showed the
 * cost of that: competitors and news came back [] for well-known companies
 * (GetResponse, GetYourGuide) whose search results plainly contained both.
 * A dedicated call with its own rules for these sections fixes that.
 *
 * These fields are lists of named entities rather than single numeric
 * facts, so they're grounded differently from evidence.ts's verbatim-quote
 * check -- each item is checked mechanically against what was actually
 * fetched, so nothing can enter that no source mentions:
 *   - competitor / acquisition: its name must appear in a fetched source.
 *   - news: its URL must be one of the fetched source URLs.
 *   - patent: its URL, patent number, or title must appear in a source.
 *   - tech_stack: each technology must appear in a source.
 *   - github_url / huggingface_url: verifyEvidence (verbatim URL), as before.
 */

import Anthropic from "@anthropic-ai/sdk";
import { sanitizeModelOutput, ensureArray } from "./sanitize";
import { verifyEvidence, normalizeForMatch, type EvidenceSource } from "./evidence";
import { formatSourcesForPrompt, type LabeledSource } from "./sources";
import { debugDumpJson } from "./debugDump";

export interface EvidencedValue<T> {
  value: T;
  source_id: string;
  evidence_quote: string;
}

export interface V2Competitor { name: string; website?: string; how_it_competes: string; source_ids?: string[] }
export interface V2Acquisition { company_name: string; website?: string; acquired_date?: string; amount?: number; description?: string; source_ids?: string[] }
export interface V2NewsItem { title: string; url: string; source?: string; published_date?: string; summary?: string; image_url?: string }
export interface V2PatentRecord { title: string; patent_number?: string; filing_date?: string; url?: string; summary?: string }
export interface V2Technology {
  tech_stack?: string[];
  github_url?: EvidencedValue<string>;
  huggingface_url?: EvidencedValue<string>;
}

export interface V2MarketExtraction {
  competitors: V2Competitor[];
  acquisitions: V2Acquisition[];
  news: V2NewsItem[];
  patent_summary: { patent_count: number | null; patent_fields: string[] };
  patents: V2PatentRecord[];
  technology: V2Technology;
}

export function emptyMarketExtraction(): V2MarketExtraction {
  return {
    competitors: [], acquisitions: [], news: [],
    patent_summary: { patent_count: null, patent_fields: [] },
    patents: [], technology: {},
  };
}

export type MarketDropReason =
  | "competitor_not_in_source" | "competitor_is_self" | "acquisition_not_in_source"
  | "news_url_not_in_sources" | "news_is_profile_page" | "patent_not_in_source"
  | "tech_not_in_source" | "competitor_is_acquisition" | "acquisition_is_self" | "news_date_not_in_source" | "evidence_mismatch" | "value_not_in_quote" | "url_not_in_source" | "source_not_found";

export interface MarketDroppedField { field: string; reason: MarketDropReason }

export interface ProcessedMarketExtraction {
  result: V2MarketExtraction;
  dropped: MarketDroppedField[];
}

// ── Schema ───────────────────────────────────────────────────────────────

function materialField(valueSchema: Record<string, unknown>, description: string) {
  return {
    type: "object" as const,
    description,
    properties: {
      value: valueSchema,
      source_id: { type: "string", description: "The [Sx] or [Wx] id of the ONE source this value was taken from." },
      evidence_quote: { type: "string", description: "5-40 words copied VERBATIM from that source, containing this exact value." },
    },
    required: ["value", "source_id", "evidence_quote"],
  };
}

function marketExtractionTool() {
  return {
    name: "save_market_extraction",
    description: "Save the competitors, acquisitions, news, patents, and technology for a private tech company.",
    input_schema: {
      type: "object" as const,
      properties: {
        competitors: {
          type: "array",
          description: "4-6 DIRECT competitors named in the research, most direct first.",
          items: {
            type: "object" as const,
            properties: {
              name: { type: "string", description: "The competitor's company name exactly as written in the source." },
              website: { type: "string", description: "Competitor's root domain, only if it appears in a source." },
              how_it_competes: { type: "string", description: "2-3 sentences: who this competitor is (what it sells, to whom) and specifically how it overlaps with the company." },
              source_ids: { type: "array", items: { type: "string" }, description: "Every [Sx]/[Wx] id that names this competitor." },
            },
            required: ["name", "how_it_competes", "source_ids"],
          },
        },
        acquisitions: {
          type: "array",
          description: "Companies THIS company bought (outbound only). [] if none are reported.",
          items: {
            type: "object" as const,
            properties: {
              company_name: { type: "string" }, website: { type: "string" },
              acquired_date: { type: "string", description: "YYYY-MM-DD, YYYY-MM-01, or YYYY-01-01." },
              amount: { type: "number", description: "USD plain integer, only if stated." },
              description: { type: "string" },
              source_ids: { type: "array", items: { type: "string" } },
            },
            required: ["company_name", "source_ids"],
          },
        },
        news: {
          type: "array",
          description: "Up to 8 articles ABOUT this company, most recent first.",
          items: {
            type: "object" as const,
            properties: {
              title: { type: "string" },
              url: { type: "string", description: "The article's URL exactly as shown in its source header." },
              source: { type: "string", description: "Publication name, e.g. 'TechCrunch'." },
              published_date: { type: "string", description: "YYYY-MM-DD when determinable (convert relative dates like '3 days ago' using today's date); omit otherwise." },
              summary: { type: "string", description: "1-2 sentences on what the article reports." },
            },
            required: ["title", "url"],
          },
        },
        patent_summary: {
          type: "object" as const,
          properties: {
            patent_count: { type: "integer", description: "Only if a source states a count." },
            patent_fields: { type: "array", items: { type: "string" } },
          },
        },
        patents: {
          type: "array",
          items: {
            type: "object" as const,
            properties: {
              title: { type: "string" }, patent_number: { type: "string" }, filing_date: { type: "string" },
              url: { type: "string" }, summary: { type: "string" },
            },
            required: ["title"],
          },
        },
        technology: {
          type: "object" as const,
          properties: {
            tech_stack: { type: "array", items: { type: "string" }, description: "Technologies named in a concrete source (careers page, engineering blog, GitHub, job post)." },
            github_url: materialField({ type: "string" }, "The company's own GitHub org page, not a founder's personal account."),
            huggingface_url: materialField({ type: "string" }, "The company's own Hugging Face org page."),
          },
        },
      },
      required: ["competitors", "news"],
    },
  };
}

export function buildMarketExtractionRequest(companyName: string, sources: LabeledSource[], today = new Date().toISOString().slice(0, 10)) {
  const context = formatSourcesForPrompt(sources);
  const prompt = `You are a market research analyst. From the labeled research below, extract the competitors, acquisitions, news coverage, patents, and technology of the company "${companyName}". Today's date is ${today}.

RULES:
1. COMPETITORS — find 4-6 DIRECT competitors. Real evidence includes: "alternatives to ${companyName}" / "${companyName} vs X" pages, G2/Capterra/Crunchbase "similar companies" or "top competitors" lists, market-landscape articles that group ${companyName} with named peers, and ${companyName}'s own comparison pages. A company named alongside ${companyName} in such a source IS a competitor for this purpose. For each, write 2-3 sentences: who the competitor is and exactly how it overlaps with ${companyName}. Never list ${companyName} itself, a parent company, an investor, or a customer. Only name competitors that actually appear in the sources (cite them in source_ids) — never add a well-known company from your own knowledge that no source mentions.
2. NEWS — include EVERY article in the sources that is about ${companyName} (funding, product launches, partnerships, acquisitions, executive hires, awards, interviews), up to 8, most recent first. Use the article URL exactly as it appears in that source's header line. A source's "Source:" and "Date:" lines give the publication and date. Do NOT list the company's own website pages ([W#] sources) or directory/profile pages (Crunchbase, LinkedIn, PitchBook, Tracxn, CB Insights profiles) as news.
3. ACQUISITIONS — only companies ${companyName} itself bought. If ${companyName} was acquired BY someone, that is not an acquisition here.
4. PATENTS — individual patent records named in the sources (title, number, URL from patents.google.com or similar). patent_summary.patent_count only if a source states a count. Never infer.
5. TECHNOLOGY — only technologies a source names (job posts, careers pages, engineering blogs, GitHub). Never infer from the sector.
6. Never construct or guess a URL — every URL you output must appear verbatim in a source.
7. Scan EVERY source below for each category, not just the ones whose label matches it. An empty list is correct only after that check.

Labeled research (each source is tagged [S#] for a search result or [W#] for a fetched website page):
${context}`;

  return {
    model: "",
    max_tokens: 8192,
    temperature: 0,
    tools: [marketExtractionTool()],
    tool_choice: { type: "tool" as const, name: "save_market_extraction" },
    messages: [{ role: "user" as const, content: prompt }],
  };
}

// ── Grounding helpers (pure) ─────────────────────────────────────────────

/** True when `term` appears as a whole word/phrase in `text` (case/punctuation-insensitive). */
export function termAppearsIn(term: string, text: string): boolean {
  // Sentence-final periods are stripped ("...like Substack." must match
  // "Substack"); periods inside a token ("wordpress.com") are kept.
  const norm = (s: string) => normalizeForMatch(s).replace(/\.(?=\s|$)/g, "");
  const t = norm(term);
  if (!t) return false;
  return ` ${norm(text)} `.includes(` ${t} `);
}

function sourceText(s: LabeledSource): string {
  return `${s.title ?? ""} ${s.content} ${s.url}`;
}

/** Name must appear in a cited source; falls back to any source if the citations are missing or wrong. */
function nameIsGrounded(name: string, citedIds: string[] | undefined, sources: LabeledSource[]): boolean {
  const cited = sources.filter((s) => (citedIds ?? []).includes(s.source_id));
  if (cited.some((s) => termAppearsIn(name, sourceText(s)))) return true;
  return sources.some((s) => termAppearsIn(name, sourceText(s)));
}

export function normalizeUrlForMatch(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

const PROFILE_PAGE_HOSTS = ["crunchbase.com", "linkedin.com", "pitchbook.com", "tracxn.com", "cbinsights.com", "dealroom.co", "zoominfo.com", "owler.com"];

function isProfilePageUrl(url: string): boolean {
  const n = normalizeUrlForMatch(url);
  return PROFILE_PAGE_HOSTS.some((h) => n.startsWith(h) || n.includes(`.${h}`));
}

// ── News dates ───────────────────────────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";

function isoOf(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Every calendar date written in `text` ("Oct. 15, 2024", "15 October 2024", "2024-10-15", URL "/2024/10/15/"). */
function datesIn(text: string): string[] {
  const out: string[] = [];
  const t = text.toLowerCase();
  for (const m of t.matchAll(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "g"))) out.push(isoOf(+m[3], MONTHS.indexOf(m[1]) + 1, +m[2]));
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})\\s+${MONTH_RE}\\s+(\\d{4})\\b`, "g"))) out.push(isoOf(+m[3], MONTHS.indexOf(m[2]) + 1, +m[1]));
  for (const m of t.matchAll(/\b(\d{4})[-/](\d{2})[-/](\d{2})\b/g)) out.push(isoOf(+m[1], +m[2], +m[3]));
  return out;
}

/**
 * A news item's published_date is kept only when the source itself supports
 * it: the same day written in the source text or URL, the same month in a
 * /YYYY/MM/ URL path, or a relative "N days ago" that lands within its own
 * granularity of the claimed date. Anything else is the model's guess.
 */
export function newsDateIsGrounded(date: string, source: { url: string; title?: string; content: string }, today = new Date().toISOString().slice(0, 10)): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const text = `${source.title ?? ""} ${source.content} ${source.url}`;
  if (datesIn(text).includes(date)) return true;
  const ym = date.slice(0, 7).replace("-", "/");
  if (source.url.includes(`/${ym}/`)) return true;
  const rel = text.toLowerCase().match(/\b(\d+|an?|one)\s+(hour|day|week|month)s?\s+ago\b/);
  if (rel) {
    const n = /^\d+$/.test(rel[1]) ? +rel[1] : 1;
    const days = { hour: 0, day: 1, week: 7, month: 30 }[rel[2] as "hour" | "day" | "week" | "month"] * n;
    const tolerance = { hour: 1, day: 2, week: 7, month: 31 }[rel[2] as "hour" | "day" | "week" | "month"];
    const expected = new Date(new Date(today).getTime() - days * 86_400_000);
    return Math.abs(new Date(date).getTime() - expected.getTime()) / 86_400_000 <= tolerance;
  }
  return false;
}

// ── Response processing (pure) ───────────────────────────────────────────

export function processMarketExtractionResponse(
  rawToolInput: unknown,
  sources: LabeledSource[],
  companyName: string,
  today = new Date().toISOString().slice(0, 10),
): ProcessedMarketExtraction {
  const dropped: MarketDroppedField[] = [];
  const i = (sanitizeModelOutput(rawToolInput) ?? {}) as Partial<V2MarketExtraction>;
  const sourceLookup: Record<string, EvidenceSource> = Object.fromEntries(sources.map((s) => [s.source_id, { content: s.content, url: s.url }]));
  const selfKey = normalizeForMatch(companyName);

  const acquisitions = ensureArray<V2Acquisition>(i.acquisitions).filter((a) => {
    if (!a?.company_name) return false;
    // "X was acquired by Y" is not an acquisition BY X (Gladia listed itself).
    if (normalizeForMatch(a.company_name) === selfKey) { dropped.push({ field: "acquisitions", reason: "acquisition_is_self" }); return false; }
    if (!nameIsGrounded(a.company_name, a.source_ids, sources)) { dropped.push({ field: "acquisitions", reason: "acquisition_not_in_source" }); return false; }
    return true;
  });

  // A company this one bought is not also its competitor ("Blow" vs the
  // acquired "Blow Me") — that pairing is a contradiction, not two facts.
  const isAcquired = (name: string) => acquisitions.some((a) => termAppearsIn(name, a.company_name) || termAppearsIn(a.company_name, name));
  const seenCompetitors = new Set<string>();
  const competitors = ensureArray<V2Competitor>(i.competitors).filter((c) => {
    if (!c?.name || !c.how_it_competes) return false;
    const key = normalizeForMatch(c.name);
    if (!key || seenCompetitors.has(key)) return false;
    if (key === selfKey) { dropped.push({ field: "competitors", reason: "competitor_is_self" }); return false; }
    if (isAcquired(c.name)) { dropped.push({ field: "competitors", reason: "competitor_is_acquisition" }); return false; }
    if (!nameIsGrounded(c.name, c.source_ids, sources)) { dropped.push({ field: "competitors", reason: "competitor_not_in_source" }); return false; }
    seenCompetitors.add(key);
    return true;
  }).slice(0, 6);

  const sourceByUrl = new Map(sources.map((s) => [normalizeUrlForMatch(s.url), s]));
  const seenNews = new Set<string>();
  const news: V2NewsItem[] = [];
  for (const n of ensureArray<V2NewsItem>(i.news)) {
    if (!n?.url || !n.title) continue;
    const key = normalizeUrlForMatch(n.url);
    if (seenNews.has(key)) continue;
    const src = sourceByUrl.get(key);
    if (!src) { dropped.push({ field: "news", reason: "news_url_not_in_sources" }); continue; }
    if (src.source_id.startsWith("W") || isProfilePageUrl(src.url)) { dropped.push({ field: "news", reason: "news_is_profile_page" }); continue; }
    seenNews.add(key);
    let publishedDate = n.published_date;
    if (publishedDate && !newsDateIsGrounded(publishedDate, src, today)) {
      dropped.push({ field: "news.published_date", reason: "news_date_not_in_source" });
      publishedDate = undefined;
    }
    news.push({ ...n, url: src.url, published_date: publishedDate });
    if (news.length >= 8) break;
  }

  const patents = ensureArray<V2PatentRecord>(i.patents).filter((p) => {
    if (!p?.title) return false;
    const grounded =
      (p.url && sourceByUrl.has(normalizeUrlForMatch(p.url))) ||
      (p.patent_number && sources.some((s) => sourceText(s).includes(p.patent_number!))) ||
      sources.some((s) => termAppearsIn(p.title, sourceText(s)));
    if (!grounded) { dropped.push({ field: "patents", reason: "patent_not_in_source" }); return false; }
    return true;
  });

  const anyPatentMention = sources.some((s) => /\bpatent/i.test(sourceText(s)));
  const patentSummary = {
    patent_count: anyPatentMention ? (i.patent_summary?.patent_count ?? null) : null,
    patent_fields: anyPatentMention ? ensureArray<string>(i.patent_summary?.patent_fields) : [],
  };

  const techStack = ensureArray<string>(i.technology?.tech_stack).filter((t) => {
    if (typeof t !== "string" || !t.trim()) return false;
    if (!sources.some((s) => termAppearsIn(t, sourceText(s)))) { dropped.push({ field: "technology.tech_stack", reason: "tech_not_in_source" }); return false; }
    return true;
  });

  const verifyUrl = (field: string, claim: EvidencedValue<string> | undefined): EvidencedValue<string> | undefined => {
    if (!claim) return undefined;
    const verdict = verifyEvidence({ field, value: claim.value, source_id: claim.source_id, evidence_quote: claim.evidence_quote, is_url: true }, sourceLookup);
    if (!verdict.verified) { dropped.push({ field, reason: (verdict.drop_reason ?? "evidence_mismatch") as MarketDropReason }); return undefined; }
    return claim;
  };

  return {
    result: {
      competitors,
      acquisitions,
      news,
      patent_summary: patentSummary,
      patents,
      technology: {
        tech_stack: [...new Set(techStack)],
        github_url: verifyUrl("technology.github_url", i.technology?.github_url),
        huggingface_url: verifyUrl("technology.huggingface_url", i.technology?.huggingface_url),
      },
    },
    dropped,
  };
}

// ── Live API wrapper ─────────────────────────────────────────────────────

export interface ExtractMarketOptions { client: Anthropic; model: string; request?: object }

export async function extractMarket(
  companyName: string,
  sources: LabeledSource[],
  options: ExtractMarketOptions,
): Promise<{ extraction: ProcessedMarketExtraction; stopReason: string | null; inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number }> {
  const request = (options.request ?? buildMarketExtractionRequest(companyName, sources)) as ReturnType<typeof buildMarketExtractionRequest>;
  debugDumpJson(companyName, "market_sources", sources);
  const msg = await options.client.messages.create({ ...request, model: options.model });

  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") {
    return { extraction: { result: emptyMarketExtraction(), dropped: [] }, stopReason: msg.stop_reason, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0, cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0 };
  }
  debugDumpJson(companyName, "market_raw", tool.input);
  const extraction = processMarketExtractionResponse(tool.input, sources, companyName);
  debugDumpJson(companyName, "market_dropped", extraction.dropped);
  return { extraction, stopReason: msg.stop_reason, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0, cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0 };
}
