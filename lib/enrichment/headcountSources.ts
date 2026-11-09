/**
 * lib/enrichment/headcountSources.ts — pure readers for the headcount-history sources (owner, 2026-11-07):
 * Companies House iXBRL accounts, Form 5500 rows, a team-size sentence of a page. No network, no database.
 * Every point is { date, value, lowerBound? } — the caller adds the source and the type.
 */

import { profileSourceAllowed } from "./roundSources.ts";

export interface HeadcountReading { date: string; value: number; lowerBound?: boolean }

/** AverageNumberEmployeesDuringPeriod (and its variants) of an iXBRL accounts document: one reading per period end. */
export function parseIxbrlEmployees(xhtml: string): HeadcountReading[] {
  // Contexts: id → period end, skipping any context split by a dimension (staff categories, not the total).
  const ends = new Map<string, string>();
  for (const m of xhtml.matchAll(/<xbrli:context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/xbrli:context>/gi)) {
    if (/explicitMember|typedMember/i.test(m[2])) continue;
    const end = m[2].match(/<xbrli:(?:endDate|instant)>\s*(\d{4}-\d{2}-\d{2})\s*</i)?.[1];
    if (end) ends.set(m[1], end);
  }
  const out = new Map<string, number>();
  for (const m of xhtml.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi)) {
    const attrs = m[1];
    const name = attrs.match(/\bname="([^"]+)"/i)?.[1] ?? "";
    if (!/AverageNumberEmployees/i.test(name)) continue;
    const end = ends.get(attrs.match(/\bcontextRef="([^"]+)"/i)?.[1] ?? "");
    if (!end) continue;
    const text = m[2].replace(/<[^>]+>/g, "").replace(/[,\s]/g, "");
    if (!/^\d+(\.\d+)?$/.test(text)) continue;
    const scale = Number(attrs.match(/\bscale="(-?\d+)"/i)?.[1] ?? 0);
    const value = Math.round(Number(text) * 10 ** scale);
    if (value > 0 && !out.has(end)) out.set(end, value);
  }
  return [...out].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Who files a Form 5500 for a company's employees without being the company: payroll and PEO providers. */
const PEO = /\b(justworks|gusto|trinet|insperity|adp\b|adp total ?source|paychex|vensure|oasis outsourcing|ceridian|rippling|papaya|deel|remote\.com|barrett business|alight|zenefits|employer services|professional employer|peo\b|staff leasing|nextep|engage pe[o]?|corporate synergies|human resource)/i;
export function isPayrollProvider(sponsorName: string): boolean {
  return PEO.test(sponsorName);
}

export interface Form5500Row { sponsor: string; ein?: string; state?: string; planYear: number; activeParticipants: number; planEnd?: string }

/** Reads the CSV header of a Form 5500 / 5500-SF dataset: which columns hold the sponsor, the EIN, the state and the active participants. */
export function form5500Columns(header: string[]): { sponsor: number; ein: number; state: number; active: number; end: number } | null {
  const idx = (re: RegExp) => header.findIndex((h) => re.test(h));
  const sponsor = idx(/^(SPONSOR_DFE_NAME|SF_SPONSOR_NAME)$/i);
  const active = idx(/^(TOT_ACTIVE_PARTCP_CNT|SF_TOT_ACT_PARTCP_EOY_CNT|SF_TOT_ACTIVE_PARTCP_EOY_CNT|TOT_ACT_PARTCP_EOY_CNT)$/i) >= 0
    ? idx(/^(TOT_ACTIVE_PARTCP_CNT|SF_TOT_ACT_PARTCP_EOY_CNT|SF_TOT_ACTIVE_PARTCP_EOY_CNT|TOT_ACT_PARTCP_EOY_CNT)$/i)
    : idx(/ACT\w*_PARTCP.*(EOY|CNT)/i);
  if (sponsor < 0 || active < 0) return null;
  return { sponsor, active, ein: idx(/SPONS\w*_EIN|^SF_SPONS_EIN$/i), state: idx(/SPONS\w*_US_STATE|SF_SPONS_US_STATE/i), end: idx(/PLAN_YEAR_END|TOT_.*END|^SF_PLAN_YEAR_END_DATE$/i) };
}

/**
 * A team-size sentence on a page: "a team of 200", "150+ employees", "over 100 people". The count is a lower bound
 * when the sentence says so. When the sentence names ONE year ("2014 Reached the milestone of 50 employees", "we grew to
 * 800 in 2021") the figure belongs to that year, not to the day the page was copied (owner, 2026-11-08, review 6:
 * BrowserStack); a milestone with no year has no date and gives nothing; several years (a range) give nothing.
 */
/**
 * A figure that belongs to someone's career, not to the company (review 7, 2026-11-09: CaPow's "managing a team of 300+
 * engineers" at SolarEdge, Kitov's "CEO of Verint ... 1200 employees", Armorblox's "helping to grow Blue Jeans to 200+").
 * Past-career wording is always one; a role title only on the company's own pages (a press sentence names its speaker).
 */
const BIO_STRONG = /\b(?:served as|prior to|previously|formerly|former|helping to grow|helped (?:to )?(?:grow|build|scale)|grew it from|managing a team|managed a team|led a team|leading a team|annual revenues?)\b/i;
const BIO_ROLE = /\b(?:CEO|CTO|CFO|COO|CMO|CRO|President|Vice President|VP|Chairman|Managing Director|Co-?Founder|Founder)\b/;
export function figureIsBiographical(sentence: string, onOwnPage: boolean): boolean {
  return BIO_STRONG.test(sentence) || (onOwnPage && BIO_ROLE.test(sentence));
}

export interface SizeStatement { value: number; lowerBound: boolean; sentence: string; year?: number }
const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d{1,6})`;
const LOWER = String.raw`(?:over|more than|\d+\+|at least|nearly|almost)`;
const PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b(?:team|staff|workforce)\s+of\s+(over\s+|more than\s+|about\s+|around\s+|approximately\s+|nearly\s+)?${NUM}(\+)?`, "i"),
  new RegExp(String.raw`\b(over\s+|more than\s+|about\s+|around\s+|approximately\s+|nearly\s+|almost\s+)?${NUM}(\+)?\s+(?:full[- ]time\s+)?(?:employees|team members|teammates|colleagues|staff members)\b`, "i"),
  new RegExp(String.raw`\b(?:we are|we're|with|have|has)\s+(over\s+|more than\s+|about\s+|around\s+|approximately\s+|nearly\s+)?${NUM}(\+)?\s+(?:talented\s+)?(?:people|professionals|engineers|employees)\b`, "i"),
];
const MILESTONE = /\b(milestone|reached|grew (?:to|from)|surpass\w*|crossed|hit|first \d+)\b/i;
export function sizeStatement(text: string): SizeStatement | null {
  for (const sentence of text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/)) {
    const years = [...sentence.matchAll(/\b(19[89]\d|20\d{2})\b/g)].map((y) => Number(y[1]));
    if (new Set(years).size > 1) continue;
    if (!years.length && MILESTONE.test(sentence)) continue;
    if (figureIsBiographical(sentence, true)) continue;
    for (const re of PATTERNS) {
      const m = sentence.match(re);
      if (!m) continue;
      const num = m.slice(1).find((x) => x && /^\d[\d,]*$/.test(x));
      const value = Number((num ?? "").replace(/,/g, ""));
      if (!value || value > 500000 || (value >= 1900 && value <= 2100)) continue;
      const qualifier = m.slice(1).find((x) => x && !/^\d[\d,]*$/.test(x));
      const lowerBound = qualifier === "+" || new RegExp(LOWER, "i").test(qualifier ?? "") || /\d\+/.test(m[0]);
      // The excerpt is centred on the match, so a long sentence still shows its number (review 6: CaPow's "300+").
      const at = Math.max(0, (m.index ?? 0) - 110);
      return { value, lowerBound, sentence: sentence.trim().slice(at, at + 240), ...(years.length ? { year: years[0] } : {}) };
    }
  }
  return null;
}

// ── A headcount point read out of an article or page by the extraction (profile.metrics.headcount_history) ──
export interface ExtractionPoint { date: string; employee_count: number; source_id: string; evidence_quote: string; point_type?: string }
const FIRST_PERSON = /\b(?:we|our|us)\b|\bthe\b[^.]{0,40}\b(?:company|startup|firm|team|business)\b/i;
const firstWord = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).find((w) => w.length >= 3) ?? "";

/** Why an extracted headcount point is not kept, or null (review 6, 2026-11-08). */
export function extractionPointProblem(h: ExtractionPoint, src: { url: string; source_type?: string | null; content?: string | null; title?: string | null } | undefined, companyName: string): string | null {
  if (!/^\d{4}(-\d{2}){0,2}$/.test(h.date ?? "")) return "undated";
  if (!src) return "no_source";
  if (!profileSourceAllowed(src, companyName)) return "source_not_allowed";   // a data platform (RocketReach...) is never one
  const q = (h.evidence_quote ?? "").replace(/(\d),(\d)/g, "$1$2");
  if (!new RegExp(`(^|[^\\d])${h.employee_count}([^\\d]|$)`).test(q)) return "number_not_in_quote";
  const w = firstWord(companyName);
  if (!(w && q.toLowerCase().includes(w)) && !FIRST_PERSON.test(q)) return "quote_not_about_the_company";
  if (figureIsBiographical(h.evidence_quote ?? "", src.source_type === "company_site")) return "quote_is_a_career_not_the_company";
  return null;
}

/** The usable points, typed by where they come from: the company's own site is site_stated, anything else press_reported. */
export function extractionPoints(points: ExtractionPoint[] | undefined, byId: Map<string, { url: string; source_type?: string | null; content?: string | null; title?: string | null }>, companyName: string): ExtractionPoint[] {
  return (points ?? []).filter((h) => !extractionPointProblem(h, byId.get(h.source_id), companyName))
    .map((h) => ({ ...h, point_type: byId.get(h.source_id)?.source_type === "company_site" ? "site_stated" : (h.point_type && h.point_type !== "observed" ? h.point_type : "press_reported") }));
}
