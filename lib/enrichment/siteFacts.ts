import { sentenceIsAboutCompany } from "./subject.ts";
/**
 * lib/enrichment/siteFacts.ts — facts a company's own site states in a clear structure (owner, round 10): a structure on the company's own page (about, footer, a "Since 2013" mark)
 * is evidence enough, where free text in an article needs an explicit sentence.
 * Pure.
 */

const YEAR = "(?:19|20)\\d{2}";
const PRIOR = /\b(previous|earlier|prior|before|sold|acquired|exit(?:ed)?|worked|career|decade|ago)\b/i;

/** The year a company's own text says it was founded: "Founded in 2013", "Established 2013", "Since 2013", "Est. 2013". Not "launched in", not a © year. */
export function foundedYearFromSite(text: string, currentYear = new Date().getFullYear(), about?: { companyName: string; ownSite?: boolean }): { year: number; quote: string } | null {
  const lines = text.replace(/\r/g, "").split(/\n+/).map((l) => l.replace(/[*_#>|]+/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const candidates: RegExp[] = [
    new RegExp(`\\b(?:founded|established|incorporated|formed)\\s+(?:in\\s+|on\\s+)?(?:[A-Z][a-z]+\\s+(?:\\d{1,2},?\\s+)?)?(${YEAR})\\b`, "i"),
    new RegExp(`\\b(?:founded|established)\\b[^.]{0,25}?\\bin\\s+(${YEAR})\\b`, "i"),
    // "Since <year>" counts only as "in business since", "serving … since", "established since", or as a line of its own — not after a growth verb or a "%" (owner, round 10: "Growing by 720% Since 2020").
    new RegExp(`\\b(?:in business|established|operating|trusted|serving[^.]{0,60}?)\\s+since\\s+(${YEAR})\\b`, "i"),
    new RegExp(`^(?:since|est\\.?)\\s+(${YEAR})$`, "i"),
  ];
  for (const line of lines) {
    if (/©|\(c\)|copyright|launched|launch of/i.test(line) && !/\b(founded|established|since|est\.)/i.test(line)) continue;
    if (line.length > 400 || /!\[|\]\(/.test(line)) continue;
    for (const re of candidates) {
      const m = line.match(re);
      if (!m) continue;
      const year = Number(m[1]);
      if (year < 1900 || year > currentYear) continue;
      // "founded by Ann, who sold her earlier company in 2008": the year of something else.
      const around = line.slice(Math.max(0, (m.index ?? 0) - 80), (m.index ?? 0) + 120);
      if (PRIOR.test(around) && !/\bwe (were|are)\b/i.test(around)) continue;
      // The sentence must be about the company (subject.ts): "DHNY was founded in 2022" on another organisation's blog post is not.
      if (about && !sentenceIsAboutCompany(line, about.companyName, { ownSite: about.ownSite })) continue;
      return { year, quote: line.slice(0, 240) };
    }
  }
  return null;
}

/** The first year of a footer's © range ("© 2015–2026 Acme", "Copyright 2019 Acme"), or null. */
export function copyrightStartYear(text: string): number | null {
  const years: number[] = [];
  for (const m of text.matchAll(new RegExp(`(?:©|\\(c\\)|copyright)\\s*(?:\\d{4}\\s*[-–—]\\s*)?(${YEAR})(?:\\s*[-–—]\\s*(${YEAR}))?`, "gi"))) {
    const range = m[0].match(new RegExp(`(${YEAR})\\s*[-–—]\\s*(${YEAR})`));
    years.push(Number(range ? range[1] : m[1]));
  }
  return years.length ? Math.min(...years) : null;
}

/** An article's "founded in <city> in <year>" about a named company: the year and the city (whose country is the founding country). */
export function foundedInCityYear(sentences: string[], companyName: string): { year: number; city: string; quote: string } | null {
  const name = companyName.toLowerCase().replace(/\b(inc|ltd|llc|gmbh|corp)\b\.?/g, "").trim();
  for (const s of sentences) {
    if (!name || !s.toLowerCase().includes(name)) continue;
    const m = s.match(new RegExp(`\\bfounded\\s+in\\s+([A-Z][\\p{L}.' -]{2,30}?)\\s+in\\s+(${YEAR})\\b`, "u"));
    if (m) return { year: Number(m[2]), city: m[1].trim(), quote: s.slice(0, 240) };
  }
  return null;
}
