/**
 * lib/enrichment/headcountSources.ts — pure readers for the headcount-history sources (owner, 2026-11-07):
 * Companies House iXBRL accounts, Form 5500 rows, a team-size sentence of a page. No network, no database.
 * Every point is { date, value, lowerBound? } — the caller adds the source and the type.
 */

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

/** A team-size sentence on a page: "a team of 200", "150+ employees", "over 100 people". The count is a lower bound when the sentence says so. */
export interface SizeStatement { value: number; lowerBound: boolean; sentence: string }
const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d{1,6})`;
const LOWER = String.raw`(?:over|more than|\d+\+|at least|nearly|almost)`;
const PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b(?:team|staff|workforce)\s+of\s+(over\s+|more than\s+|about\s+|around\s+|approximately\s+|nearly\s+)?${NUM}(\+)?`, "i"),
  new RegExp(String.raw`\b(over\s+|more than\s+|about\s+|around\s+|approximately\s+|nearly\s+|almost\s+)?${NUM}(\+)?\s+(?:full[- ]time\s+)?(?:employees|team members|teammates|colleagues|staff members)\b`, "i"),
  new RegExp(String.raw`\b(?:we are|we're|with|have|has)\s+(over\s+|more than\s+|about\s+|around\s+|approximately\s+|nearly\s+)?${NUM}(\+)?\s+(?:talented\s+)?(?:people|professionals|engineers|employees)\b`, "i"),
];
// A timeline entry or a past count ("2014 Reached the milestone of 50 employees", "grew to 800 in 2021") is not the
// size on the day of the copy (review 6, 2026-11-08: BrowserStack's 2014 milestone dated 2026-01-17).
const PAST = /\b(milestone|reached|grew (?:to|from)|surpass\w*|crossed|hit|first \d+|(?:19|20)\d{2})\b/i;
export function sizeStatement(text: string): SizeStatement | null {
  for (const sentence of text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/)) {
    if (PAST.test(sentence)) continue;
    for (const re of PATTERNS) {
      const m = sentence.match(re);
      if (!m) continue;
      const num = m.slice(1).find((x) => x && /^\d[\d,]*$/.test(x));
      const value = Number((num ?? "").replace(/,/g, ""));
      if (!value || value > 500000 || (value >= 1900 && value <= 2100 && !/employee|team|staff/i.test(sentence))) continue;
      const qualifier = m.slice(1).find((x) => x && !/^\d[\d,]*$/.test(x));
      const lowerBound = qualifier === "+" || new RegExp(LOWER, "i").test(qualifier ?? "") || /\d\+/.test(m[0]);
      // The excerpt is centred on the match, so a long sentence still shows its number (review 6: CaPow's "300+").
      const at = Math.max(0, (m.index ?? 0) - 110);
      return { value, lowerBound, sentence: sentence.trim().slice(at, at + 240) };
    }
  }
  return null;
}
