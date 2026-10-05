/**
 * lib/enrichment/headcount.ts — the checks a headcount figure needs on top
 * of evidence.ts's "this number is in the quote".
 *
 * A real run wrote a 4 -> 70,000 -> 51 employee series for Gladia: every
 * point's number genuinely appeared in its quote, but "70,000" was a count
 * of developers, "4" was most likely a "$4 million" seed, and "51" was the
 * lower bound of "51-100 employees". So a headcount figure is accepted only
 * when:
 *   1. the number sits next to an employee word ("45 employees", "the
 *      45-person team", "team of 45", "headcount: 45", "employs 45");
 *   2. it is not one end of a range ("51-100") or an open bound ("50+");
 *   3. the quote is about THIS company: it names the company, or the
 *      source is the company's own site, or the source page's URL/title is
 *      the company's own page (an industry list page like "Team size: 369"
 *      can belong to any of the companies listed on it).
 */

export type HeadcountDropReason = "headcount_not_employees" | "headcount_is_range_bound" | "headcount_not_about_company";

const EMPLOYEE_AFTER = /^\s*(?:\+\s*)?(?:full[- ]time\s+|total\s+|global\s+)?(?:employees?|staff(?:ers)?|people|persons?|team members?|workers|engineers and|ftes?|[- ]?person(?:\b|[- ])|[- ]strong)/i;
const EMPLOYEE_BEFORE = /(?:employees?|staff|headcount|workforce|team size|team of|employs|employing|company size|employee count|size)\s*(?:of|:|is|at|to|has|grew to|reached)?\s*(?:about|around|roughly|approximately|nearly|over|more than|~)?\s*$/i;

interface NumberHit { value: number; start: number; end: number }

function numbersWithPositions(text: string): NumberHit[] {
  const hits: NumberHit[] = [];
  const re = /\d[\d,.]*\s*(?:k\b|thousand\b)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const scaled = /k\b|thousand/i.test(raw) ? 1000 : 1;
    const num = parseFloat(raw.replace(/[^\d.]/g, "").replace(/\.$/, ""));
    if (!Number.isNaN(num)) hits.push({ value: num * scaled, start: m.index, end: m.index + raw.trimEnd().length });
  }
  return hits;
}

function wordsOf(s: string): string[] {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’]s\b/g, " ").split(/[^a-z0-9]+/).filter(Boolean);
}

/** True when `text` contains the company name as whole words (accent/punctuation-insensitive; URLs split on - / . _). */
export function namesCompany(text: string, companyName: string): boolean {
  const name = wordsOf(companyName.replace(/\b(inc|ltd|llc|gmbh|corp|sas|sa)\b\.?/gi, ""));
  if (name.length === 0) return false;
  const words = wordsOf(text);
  const joined = name.join("");
  for (let i = 0; i < words.length; i++) {
    if (name.every((w, j) => words[i + j] === w)) return true;
    if (name.length > 1 && words[i] === joined) return true;
  }
  return false;
}

export function checkHeadcountClaim(
  value: number,
  quote: string,
  source: { url: string; title?: string; isCompanySite: boolean } | undefined,
  companyName?: string,
): HeadcountDropReason | null {
  const hits = numbersWithPositions(quote).filter((h) => Math.abs(h.value - value) < 0.5);
  if (hits.length === 0) return "headcount_not_employees";

  let sawRange = false;
  const nearEmployeeWord = hits.some((h) => {
    const before = quote.slice(Math.max(0, h.start - 40), h.start);
    const after = quote.slice(h.end, h.end + 40);
    if (/^\s*[-–]\s*\d/.test(after) || /\d\s*[-–]\s*$/.test(before) || /^\s*\+/.test(after)) { sawRange = true; return false; }
    if (/\$\s*$/.test(before) || /^\s*(?:m\b|mn\b|million|bn\b|billion|%)/i.test(after)) return false;
    return EMPLOYEE_AFTER.test(after) || EMPLOYEE_BEFORE.test(before);
  });
  if (!nearEmployeeWord) return sawRange ? "headcount_is_range_bound" : "headcount_not_employees";

  if (companyName && source && !source.isCompanySite) {
    const aboutCompany = namesCompany(quote, companyName) || namesCompany(source.url, companyName) || (source.title ? namesCompany(source.title, companyName) : false);
    if (!aboutCompany) return "headcount_not_about_company";
  }
  return null;
}
