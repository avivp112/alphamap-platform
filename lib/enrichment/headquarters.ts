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
    if (namesCompany(based[1].split(/[,;(]/)[0], companyName)) return true;
    // "Mistral AI, the Paris-based startup": the company in apposition just before.
    const pre = sentence.slice(Math.max(0, at - 60), at);
    return /,\s*(?:the|a|an)\s+$/i.test(pre) && namesCompany(pre, companyName);
  }
  const before = sentence.slice(Math.max(0, at - 90), at);
  const phrase = before.match(/(headquarter(?:s|ed)?|hq|head office|based)\s+(?:is\s+|are\s+)?(?:located\s+)?in\s+$/i);
  if (!phrase) return false;
  const lead = before.slice(0, phrase.index).split(/[;:]|\.\s/).pop() ?? "";
  if (namesCompany(lead, companyName)) return true;
  return ownSite && /\b(we|we're|we are|our)\b/i.test(lead);
}

const DAY = 86_400_000;
const sameCity = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The headquarters from every statement, by the owner's order (header). */
export function decideHeadquarters(statements: HqStatement[], today = new Date().toISOString().slice(0, 10)): HqDecision {
  const latestFirst = (xs: HqStatement[]) => [...xs].sort((a, b) => (b.date ?? "9999").localeCompare(a.date ?? "9999"));
  const company = latestFirst(statements.filter((s) => s.kind === "company"));
  if (company.length) return { kind: "declared", statement: company[0] };
  const press = latestFirst(statements.filter((s) => s.kind === "press"));
  if (!press.length) return { kind: "none" };
  const recent = press.filter((s) => s.date && Date.parse(today) - Date.parse(s.date) <= 730 * DAY);
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
