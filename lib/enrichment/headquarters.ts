/**
 * lib/enrichment/headquarters.ts — which city is the headquarters (owner,
 * 2026-11-01). The headquarters is what a source declares, in so many words
 * ("headquartered in", "HQ", "based in", "<city>-based"):
 *
 *   1. the company's own declaration — its site, or its own release on a wire;
 *   2. otherwise the most recent declaration in the press of tiers 1–3
 *      (roundSources.ts);
 *   3. press declarations of the last two years that disagree ("New
 *      York-based" against "Tel Aviv-based") leave the headquarters empty, and
 *      both cities become offices.
 *
 * A regional / second office is never the headquarters (validation.ts).
 * Only cities on the curated list (majorCities.ts) are read from the text;
 * the extraction's own city, when its quote declares the HQ, is one more
 * statement. Pure.
 */

import { MAJOR_CITIES } from "./majorCities";
import { isRegionalOfficeQuote } from "./validation";
import { roundSourceStanding } from "./roundSources";
import { parseFullDate } from "./evidence";
import { namesCompany } from "./headcount";
import type { LabeledSource } from "./sources";

export interface HqStatement {
  city: string;
  quote: string;
  source_id: string;
  url: string;
  /** "company": its site or its own release; "press": an allowed outlet of tiers 1–3. */
  kind: "company" | "press";
  /** The article's date (YYYY-MM-DD) when known; a company's own site is current. */
  date: string | null;
}

export type HqDecision =
  | { kind: "declared"; statement: HqStatement }
  | { kind: "conflict"; cities: HqStatement[] }
  /** The company's site lists several offices, no HQ, and the press declaring one is older than two years. */
  | { kind: "site_offices"; cities: string[] }
  | { kind: "none" };

const HQ_WORD = /\b(headquarter(?:s|ed)?|hq|head office|based in|-based)\b/i;
const CITY_NAMES = [...MAJOR_CITIES.keys()].sort((a, b) => b.length - a.length);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CITY_RE = new RegExp(`(^|[^\\p{L}])(${CITY_NAMES.map(esc).join("|")})(?=$|[^\\p{L}])`, "giu");
const title = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/** Who speaks: the company itself, the allowed press, or neither (never read). */
export function statementKind(s: Pick<LabeledSource, "url" | "source_type">): "company" | "press" | null {
  if (s.source_type === "company_site" || s.source_type === "press_release") return "company";
  const standing = roundSourceStanding(s.url);
  return standing.kind === "allowed" && standing.tier <= 3 ? "press" : null;
}

/** The article's own date: a "Date:" / "Published Time:" line, a wire dateline or a /YYYY/MM/DD/ URL. */
export function articleDate(s: Pick<LabeledSource, "url" | "content">): string | null {
  const c = [
    s.content.match(/Published Time:\s*(\S+)/i)?.[1],
    s.content.match(/Date:\s*([^—|\n]{6,40})/)?.[1],
    s.url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//)?.slice(1, 4).join("-"),
  ];
  for (const x of c) { const iso = x ? parseFullDate(x) : null; if (iso) return iso; }
  const ym = s.url.match(/\/(20\d{2})\/(\d{2})\//);
  return ym ? `${ym[1]}-${ym[2]}-15` : null;
}

const sentencesOf = (text: string) => text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);

/** Every sentence of a source that declares a headquarters city for this company. */
export function hqStatementsIn(s: LabeledSource, companyName: string): HqStatement[] {
  const kind = statementKind(s);
  if (!kind) return [];
  const date = kind === "company" && s.source_type === "company_site" ? null : articleDate(s);
  const out: HqStatement[] = [];
  for (const sentence of sentencesOf(`${s.title ?? ""}. ${s.content}`)) {
    if (sentence.length > 400 || !HQ_WORD.test(sentence)) continue;
    for (const m of sentence.matchAll(CITY_RE)) {
      const city = title(m[2].toLowerCase());
      if (!saysOfCompany(sentence, m.index! + m[1].length, city, companyName, s.source_type === "company_site") || isRegionalOfficeQuote(sentence, city)) continue;
      if (!out.some((o) => o.city === city)) out.push({ city, quote: sentence.trim(), source_id: s.source_id, url: s.url, kind, date });
    }
  }
  return out;
}

/**
 * The model's own HQ quote says it of THIS company — the same test as the
 * statements read from the text. EnerVenue's own release gave "Perth" from
 * "… with Avid Group, a Perth-based …" (model check 2026-11-02): the HQ word
 * was there, but it was Avid Group's.
 */
export function quoteSaysHqOf(quote: string, city: string, companyName: string, ownSite: boolean): boolean {
  const at = quote.toLowerCase().indexOf(city.trim().toLowerCase());
  if (at < 0) return false;
  return saysOfCompany(quote, at, quote.slice(at, at + city.trim().length), companyName, ownSite);
}

/** "<City>-based <another company>": the model's quote gives someone else's HQ. */
export function hqBelongsToAnother(quote: string, city: string, companyName: string): boolean {
  const at = quote.toLowerCase().indexOf(city.trim().toLowerCase());
  if (at < 0) return false;
  const c = quote.slice(at, at + city.trim().length);
  if (!/^-based\s/i.test(quote.slice(at + c.length))) return false;
  return !saysOfCompany(quote, at, c, companyName, false);
}

/**
 * HQ_DEBUG=true: every sentence of a source that has an HQ word, and why it
 * did or did not become a statement — the diagnosis the owner asked for
 * (2026-11-02: Guardz "Tel Aviv", Flyworks "Beer Sheva" rejected).
 */
export function diagnoseHq(s: LabeledSource, companyName: string): string[] {
  const kind = statementKind(s);
  const out: string[] = [];
  for (const sentence of sentencesOf(`${s.title ?? ""}. ${s.content}`)) {
    if (sentence.length > 400 || !HQ_WORD.test(sentence)) continue;
    if (!namesCompany(sentence, companyName) && !(s.source_type === "company_site")) continue;
    const cities = [...sentence.matchAll(CITY_RE)];
    let verdict: string;
    if (!kind) verdict = `source not allowed (${roundSourceStanding(s.url).kind})`;
    else if (!cities.length) verdict = "no city from the list in the sentence";
    else verdict = cities.map((m) => {
      const city = title(m[2].toLowerCase());
      if (isRegionalOfficeQuote(sentence, city)) return `${city}: regional office`;
      return saysOfCompany(sentence, m.index! + m[1].length, city, companyName, s.source_type === "company_site") ? `${city}: ACCEPTED (${kind})` : `${city}: not said of the company`;
    }).join("; ");
    out.push(`[${s.source_id}] ${s.url} — ${verdict}\n        "${sentence.trim().slice(0, 220)}"`);
  }
  return out;
}

/**
 * The HQ phrase is about THIS company, not another one in the same sentence
 * (owner, 2026-11-01: Fresha's own blog post about its round gave "Paris" —
 * the HQ of an investor it named):
 *   "<City>-based <Company>"        — the company right after "-based",
 *   "<Company>, the <City>-based startup" — or in apposition just before;
 *   "<Company>, headquartered in <City>" / "<Company> is based in <City>"
 *                                     — the company just before the phrase;
 *   on its own site, "we are / our headquarters" also counts.
 */
function saysOfCompany(sentence: string, at: number, city: string, companyName: string, ownSite: boolean): boolean {
  const after = sentence.slice(at + city.length);
  const based = after.match(/^-based\s+(.{0,60})/i);
  if (based) {
    // The company is the noun right after "-based" ("Tel Aviv-based Hailo", "Tel Aviv-based chipmaker
    // Hailo") — within its name's length plus three words, not as a possessive further on ("The
    // Perth-based energy solutions provider plans to install EnerVenue's …": model check 2026-11-02).
    const nWords = companyName.trim().split(/\s+/).length;
    const head = based[1].split(/[,;(]/)[0].split(/\s+/).slice(0, nWords + 3).join(" ");
    if (namesCompany(head, companyName) && !new RegExp(`${companyName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[’']s\\b`, "i").test(head)) return true;
    // "Mistral AI, the Paris-based startup": the company in apposition just before —
    // the words right before ", a", not anywhere earlier ("EnerVenue … with Avid Group,
    // a Perth-based …" is Avid Group's HQ: model check of 2026-11-02).
    const pre = sentence.slice(Math.max(0, at - 80), at);
    const appo = pre.match(/([^,;:()]*),\s*(?:the|a|an)\s+$/i);
    if (!appo) return false;
    const n = companyName.trim().split(/\s+/).length;
    const words = appo[1].trim().split(/\s+/);
    return namesCompany(words.slice(-n).join(" "), companyName);
  }
  const before = sentence.slice(Math.max(0, at - 90), at);
  const phrase = before.match(/(headquarter(?:s|ed)?|hq|head office|based)\s+(?:is\s+|are\s+)?(?:located\s+)?in\s+$/i);
  if (!phrase) return false;
  const lead = before.slice(0, phrase.index).split(/[;:]|\.\s/).pop() ?? "";
  // The subject is the words right before the phrase ("EnerVenue, headquartered in", "EnerVenue is
  // based in") — not a company named earlier in the sentence ("EnerVenue … with Avid Group,
  // headquartered in Perth": model check 2026-11-02).
  const clauses = lead.replace(/[,\s]+$/, "").split(/[,;(]/).map((c) => c.trim()).filter(Boolean);
  const subject = (clauses[clauses.length - 1] ?? "").split(/\s+/).slice(-(companyName.trim().split(/\s+/).length + 2)).join(" ");
  if (namesCompany(subject, companyName)) return true;
  // "Headquartered in Vancouver, British Columbia, with operations in the US and UK, Photonic's team…":
  // the sentence opens with the phrase and the company is its subject, right after (Photonic's own
  // release on GlobeNewswire, dry run 2026-11-02).
  if (!lead.trim() && /^(headquartered|based)\s+in\s+$/i.test(phrase[0])) {
    const rest = sentence.slice(at + city.length, at + city.length + 160);
    // A later clause that STARTS with the company's name (possessive allowed) — not "investor X backed Photonic".
    const n = companyName.trim().split(/\s+/).length;
    const subject = rest.split(/[,;]\s*/).find((part, i) => i > 0 && namesCompany(part.trim().split(/\s+/).slice(0, n).join(" ").replace(/[’']s$/i, ""), companyName));
    if (subject) return true;
  }
  return ownSite && /\b(we|we're|we are|our)\b/i.test(lead);
}

// A street address on the line: "1674 Broadway", "Hamasger 34", a postcode
// ("BS1 6QH", "94105", "6789141").
const ADDRESS_HINT = /(\b\d{1,5}\s+\p{L}{3,}|\p{L}{3,}\.?\s+\d{1,5}\b|\b[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}\b|\b\d{5}(?:-\d{4})?\b|\b\d{7}\b)/u;

/**
 * The cities of the street addresses the company's Contact page gives
 * (owner, 2026-11-02): one address there is the headquarters, even without
 * the word. Lines that name a city on the list and carry a street number or
 * a postcode; a regional office's line is not counted.
 */
export function contactPageAddresses(s: Pick<LabeledSource, "url" | "source_type" | "content" | "source_id" | "also_urls">): HqStatement[] {
  // The Contact page — or the page /contact rendered (Soda's /contact is its /about: dry run 2026-11-02).
  if (s.source_type !== "company_site" || ![s.url, ...(s.also_urls ?? [])].some((u) => /\/contact/i.test(u))) return [];
  const out: HqStatement[] = [];
  for (const raw of s.content.split(/\n+/)) {
    const line = raw.trim();
    if (line.length > 250 || !ADDRESS_HINT.test(line)) continue;
    for (const m of line.matchAll(CITY_RE)) {
      const city = title(m[2].toLowerCase());
      if (isRegionalOfficeQuote(line, city)) continue;
      if (!out.some((o) => sameCity(o.city, city))) out.push({ city, quote: line, source_id: s.source_id, url: s.url, kind: "company", date: null });
    }
  }
  return out;
}

const DAY = 86_400_000;
const sameCity = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The headquarters from every statement, by the owner's order (header).
 *
 * `siteOfficeCities`: the offices the company's own site lists. When it lists
 * two or more without naming a headquarters, and no press declaration is from
 * the last two years, the headquarters stays empty — an old article does not
 * outweigh what the site shows today (owner, 2026-11-02: Aidoc's site lists
 * New York and Tel Aviv; a 2022 WSJ "Tel Aviv-based" does not decide it). An
 * undated article is not shown to be recent, so it counts as old.
 */
export function decideHeadquarters(statements: HqStatement[], today = new Date().toISOString().slice(0, 10), siteOfficeCities: string[] = []): HqDecision {
  const latestFirst = (xs: HqStatement[]) => [...xs].sort((a, b) => (b.date ?? "9999").localeCompare(a.date ?? "9999"));
  const company = latestFirst(statements.filter((s) => s.kind === "company"));
  if (company.length) return { kind: "declared", statement: company[0] };
  const press = latestFirst(statements.filter((s) => s.kind === "press"));
  const recent = press.filter((s) => s.date && Date.parse(today) - Date.parse(s.date) <= 730 * DAY);
  const siteCities = siteOfficeCities.filter((c, i) => siteOfficeCities.findIndex((d) => sameCity(c, d)) === i);
  if (siteCities.length >= 2 && !recent.length) return { kind: "site_offices", cities: siteCities };
  if (!press.length) return { kind: "none" };
  const pool = recent.length ? recent : press;
  const cities = pool.filter((s, i) => pool.findIndex((t) => sameCity(t.city, s.city)) === i);
  if (cities.length > 1) return { kind: "conflict", cities };
  return { kind: "declared", statement: pool[0] };
}

/** The country a city stands for when the list knows only one. */
export function countryOfCity(city: string): string | null {
  const set = MAJOR_CITIES.get(city.trim().toLowerCase());
  return set && set.size === 1 ? [...set][0] : null;
}
