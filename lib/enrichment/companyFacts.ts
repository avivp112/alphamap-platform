/**
 * lib/enrichment/companyFacts.ts — facts the company states about itself in
 * fixed places (owner, 2026-11-02, coverage a and b). Pure.
 *
 *   a. The "About <Company>" paragraph at the end of its own press release
 *      (PRNewswire, BusinessWire, GlobeNewswire, its site's press page):
 *      "Founded in 2019 and headquartered in Tel Aviv, Guardz …". The
 *      company's own declaration, as its site.
 *   b. Its legal pages (Terms, Privacy, Legal, Imprint): the legal name, the
 *      company number and the registered office. The legal name anchors the
 *      register match; the registered office is not necessarily the
 *      headquarters, so it becomes an office only.
 */

import { MAJOR_CITIES } from "./majorCities";
import { isRegionalOfficeQuote } from "./validation";
import { namesCompany } from "./headcount";

const CITY_NAMES = [...MAJOR_CITIES.keys()].sort((a, b) => b.length - a.length);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CITY = `(${CITY_NAMES.map(esc).join("|")})`;
const title = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const YEAR = /\b(18[5-9]\d|19\d\d|20[0-4]\d)\b/;

/** The "About <Company>" paragraph of a press release, or null. */
export function aboutParagraph(text: string, companyName: string): string | null {
  const name = esc(companyName.trim()).replace(/\s+/g, "\\s+");
  // A heading line "About Guardz" (markdown or plain), then the paragraph.
  const heading = new RegExp(`(?:^|\\n)[#*_\\s]*About\\s+${name}(?:,?\\s*(?:Inc|Ltd|LLC|GmbH|Limited)\\.?)?[*_:\\s]*\\n+([\\s\\S]{40,1800}?)(?=\\n\\s*(?:#|\\*\\*|About\\s+\\p{Lu}|Media\\s+Contact|Press\\s+Contact|Contacts?:|SOURCE\\b|###|Forward[- ]Looking)|$)`, "iu");
  const m = text.match(heading);
  if (m) return m[1].replace(/\s+/g, " ").trim();
  // Inline: "About Guardz: Guardz is …" / "About Guardz Guardz is …" in one line.
  const inline = new RegExp(`\\bAbout\\s+${name}\\s*[:\\-–—]?\\s+(${name}\\b[^\\n]{40,1200})`, "iu");
  const i = text.match(inline);
  return i ? i[1].replace(/\s+/g, " ").trim() : null;
}

export interface AboutFacts { city?: string; cityQuote?: string; foundedYear?: number; yearQuote?: string }

const sentences = (t: string) => t.split(/(?<=[.!?])\s+/);

/** HQ city and founding year from an About paragraph — it is about the company, so the phrase alone counts. */
export function factsFromAbout(paragraph: string, companyName: string): AboutFacts {
  const out: AboutFacts = {};
  for (const s of sentences(paragraph)) {
    if (!out.city) {
      const m = s.match(new RegExp(`(?:headquartered|headquarters\\s+(?:is\\s+|are\\s+)?(?:located\\s+)?|based)\\s+in\\s+${CITY}\\b`, "i"))
        ?? s.match(new RegExp(`\\b${CITY}-based\\s+(\\S+)`, "i"));
      if (m) {
        const city = title(m[1].toLowerCase());
        // "<City>-based" must be the company: "Tel Aviv-based Guardz" or "Guardz is a Tel Aviv-based
        // company" — not "…, partnering with Perth-based Avid Group".
        const at = s.toLowerCase().indexOf(`${m[1].toLowerCase()}-based`);
        const basedOther = /-based/i.test(m[0])
          && !namesCompany(s.slice(at + m[1].length + 7).split(/[,;(]/)[0].split(/\s+/).slice(0, companyName.trim().split(/\s+/).length + 3).join(" ").replace(/\S+[’']s\b/g, ""), companyName)
          && !new RegExp(`^\\W*${esc(companyName.trim())}\\b[^,;]{0,25}\\b(?:is|was)\\s+(?:a|an|the)\\s+$`, "i").test(s.slice(0, at));
        if (!basedOther && !isRegionalOfficeQuote(s, city)) { out.city = city; out.cityQuote = s.trim(); }
      }
    }
    if (!out.foundedYear) {
      const m = s.match(/\b(?:founded|established|launched|started|incorporated)\b[^.]{0,60}?\b(18[5-9]\d|19\d\d|20[0-4]\d)\b/i) ?? s.match(/\bsince\s+(18[5-9]\d|19\d\d|20[0-4]\d)\b/i);
      // Founding, not incorporation (owner, 2026-11-02): "incorporated in 2022" counts only when no founding year is given.
      if (m && !/\bincorporated\b/i.test(m[0])) { out.foundedYear = Number(m[1]); out.yearQuote = s.trim(); }
      else if (m && !paragraph.match(/\b(?:founded|established|launched|started)\b[^.]{0,60}?\b(18[5-9]\d|19\d\d|20[0-4]\d)\b/i)) { out.foundedYear = Number(m[1]); out.yearQuote = s.trim(); }
    }
  }
  return out;
}

export interface LegalFacts { legalName?: string; companyNumber?: string; registeredCity?: string; quote?: string }

const LEGAL_SUFFIX = "(?:Ltd\\.?|Limited|Inc\\.?|Incorporated|LLC|L\\.L\\.C\\.|GmbH|AG|B\\.V\\.|BV|N\\.V\\.|NV|S\\.A\\.S\\.?|SAS|S\\.A\\.|SA|S\\.L\\.|Pty\\.? Ltd\\.?|plc|PLC|Corp\\.?|Corporation|בע\"מ)";

/**
 * The legal name (an entity with a legal suffix that shares a word with the
 * company's name, or one the page says operates the site), the company
 * number and the city of the registered office.
 */
export function legalFacts(text: string, companyName: string): LegalFacts {
  const out: LegalFacts = {};
  const flat = text.replace(/\s+/g, " ");
  const nameWords = companyName.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const entityRe = new RegExp(`\\b((?:[\\p{Lu}][\\p{L}\\d&.'-]*\\s+){0,5}${LEGAL_SUFFIX})(?=[\\s,.;)]|$)`, "gu");
  for (const m of flat.matchAll(entityRe)) {
    const cand = m[1].trim();
    if (nameWords.some((w) => cand.toLowerCase().includes(w))) { out.legalName = cand; out.quote = flat.slice(Math.max(0, m.index! - 60), m.index! + cand.length + 160).trim(); break; }
  }
  const num = flat.match(/\b(?:company|registration|registered|reg\.?|corporate)\s*(?:number|no\.?|nr\.?|#|id)\s*[:.]?\s*([A-Z]{0,2}\d{6,10})\b/i)
    ?? flat.match(/\b(HRB\s?\d{3,7})\b/)
    ?? flat.match(/(?:ח\.?פ\.?|מספר חברה)\s*:?\s*(5\d{8})\b/)
    ?? flat.match(/\bcompany\s+(?:registered\s+)?in\s+[^.]{0,40}?\b(?:with\s+)?(?:number|no\.?)\s*[:.]?\s*(\d{6,10})\b/i);
  if (num) out.companyNumber = num[1].replace(/\s+/g, "");
  const office = flat.match(new RegExp(`registered\\s+(?:office|address)[^.]{0,20}?(?:is\\s+|at\\s+|:\\s*)([^.]{5,160}?\\b${CITY}\\b[^.]{0,60})`, "i"));
  if (office) {
    out.registeredCity = title(office[2].toLowerCase());
    out.quote = out.quote ? `${out.quote} … registered office: ${office[1].trim()}` : `registered office: ${office[1].trim()}`;
  }
  return out;
}

/** True when a press release's About paragraph is about this company (its name opens the paragraph). */
export const aboutIsOf = (paragraph: string, companyName: string) => namesCompany(paragraph.split(/\s+/).slice(0, 12).join(" "), companyName);

export const yearIn = (s: string) => Number((s.match(YEAR) ?? [])[1]) || null;
