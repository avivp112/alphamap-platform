/**
 * lib/enrichment/linkedin.ts — founders' personal LinkedIn profiles
 * (linkedin.com/in/..., never a Crunchbase person page), found
 * mechanically from `site:linkedin.com/in` search results rather than by
 * asking a model to recall or construct a URL.
 *
 * A result is a person's profile only when its URL is a linkedin.com/in/
 * page; it belongs to a founder only when the profile's own name (the
 * result title, "Jean-Louis Quéguiner - Gladia | LinkedIn") matches that
 * founder's name AND the result names the company. When no founders are
 * known at all, profiles whose headline says Founder/Co-founder of the
 * company are offered as founders, with the profile URL as their source.
 */

import { namesCompany } from "./headcount";

export interface LinkedInPerson {
  name: string;
  /** The rest of the title, e.g. "Co-founder & CEO - Gladia". */
  headline: string;
  url: string;
  isFounder: boolean;
  /** Title + snippet of the search result — the "Education: … · Experience: …" line lives here. */
  snippet: string;
}

/** Canonical https://www.linkedin.com/in/<slug> (regional hosts and query strings stripped), or null. */
export function normalizeLinkedInProfileUrl(url: string): string | null {
  const m = url.match(/^https?:\/\/(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/([^/?#\s]+)/i);
  return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}` : null;
}

function personTokens(name: string): string[] {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b(dr|mr|mrs|ms|prof)\.?\s/g, " ")
    .split(/[^a-z]+/).filter((t) => t.length > 1);
}

/** Same person when first and last name tokens agree (middle names/initials ignored, accents ignored). */
export function samePersonName(a: string, b: string): boolean {
  const ta = personTokens(a), tb = personTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  return ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseLinkedInPersonResult(
  result: { url: string; title?: string; content?: string },
  companyName: string,
): LinkedInPerson | null {
  const url = normalizeLinkedInProfileUrl(result.url);
  if (!url || !result.title) return null;
  const parts = result.title.replace(/\s*\|\s*LinkedIn\s*$/i, "").split(/\s+[-–—|]\s+/);
  const name = parts[0]?.trim() ?? "";
  if (personTokens(name).length < 2 || /\d/.test(name)) return null;
  const headline = parts.slice(1).join(" - ").trim();
  const text = `${result.title} ${result.content ?? ""}`;
  if (!namesCompany(text, companyName)) return null;
  const company = escapeRe(companyName.trim());
  // The company must be the OBJECT of the founder claim ("Co-founder & CEO
  // at Gladia", "Gladia co-founder") — "Founder at XYZ Agency | GoHighLevel
  // expert" is a founder of something else who uses GoHighLevel.
  const role = "(?:co-?\\s?founder|founder)";
  const titleAfter = "(?:\\s*(?:&|and|/|,)\\s*[A-Za-z][A-Za-z .]{1,25}?)?";
  const isFounder =
    new RegExp(`\\b${role}${titleAfter}\\s*(?:at|of|@|-|–|—|,|\\|)?\\s*${company}\\b`, "i").test(text) ||
    new RegExp(`\\b${company}(?:'s|’s)?\\s+${role}\\b`, "i").test(text);
  return { name, headline, url, isFounder, snippet: text };
}

/** The LinkedIn profile for `personName` among the results (URL + snippet), or null. */
export function findPersonResult(
  personName: string,
  results: Array<{ url: string; title?: string; content?: string }>,
  companyName: string,
): LinkedInPerson | null {
  for (const r of results) {
    const p = parseLinkedInPersonResult(r, companyName);
    if (p && samePersonName(p.name, personName)) return p;
  }
  return null;
}

/** The LinkedIn profile URL for `personName` among the results, or null. */
export function findPersonProfile(
  personName: string,
  results: Array<{ url: string; title?: string; content?: string }>,
  companyName: string,
): string | null {
  for (const r of results) {
    const p = parseLinkedInPersonResult(r, companyName);
    if (p && samePersonName(p.name, personName)) return p.url;
  }
  return null;
}

/** Profiles that identify themselves as a founder of the company, deduped by person. */
export function discoverFounders(
  results: Array<{ url: string; title?: string; content?: string }>,
  companyName: string,
  max = 3,
): LinkedInPerson[] {
  const out: LinkedInPerson[] = [];
  for (const r of results) {
    const p = parseLinkedInPersonResult(r, companyName);
    if (!p?.isFounder || out.some((o) => samePersonName(o.name, p.name) || o.url === p.url)) continue;
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

/** "Co-founder & CEO - Gladia" -> "Co-founder & CEO"; falls back to "Founder". */
export function founderTitleFromHeadline(headline: string, companyName: string): string {
  const role = headline.split(/\s+[-–—|]\s+|\s+(?:at|@)\s+/i)
    .find((part) => /founder/i.test(part));
  const cleaned = role?.replace(new RegExp(`\\s*(?:at|@|of)?\\s*${escapeRe(companyName)}\\s*$`, "i"), "").trim();
  return cleaned && cleaned.length <= 60 ? cleaned : "Founder";
}

// ── Background facts from the public search snippet ─────────────────────
// The profile page itself is behind LinkedIn's login wall (and its terms
// forbid scraping it), but the search snippet Google shows for it usually
// carries "Education: … · Experience: …". Only what that snippet states is
// used — nothing inferred.

const ELITE_UNIT_RE = /\b(unit\s*8200|8200|unit\s*81|talpiot|mamram|matzov|sayeret\s+matkal|shayetet\s*13|unit\s*9900|lotem)\b/i;
const ELITE_SCHOOL_RE = /\b(massachusetts institute of technology|mit|stanford|harvard|technion|uc berkeley|university of california,? berkeley|caltech|california institute of technology|princeton|yale|university of oxford|oxford university|university of cambridge|cambridge university|carnegie mellon|columbia university|wharton|eth z(?:u|ü)rich|imperial college|weizmann institute|insead|(?:e|é)cole polytechnique)\b/i;

export interface LinkedInFacts {
  education: string[];
  experience: string[];
  eliteUnit: string | null;
  eliteSchool: string | null;
}

function fieldValues(text: string, label: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(`${label}:\\s*([^·|\\n]{2,80})`, "gi"))) {
    const v = m[1].replace(/\s*(…|\.\.\.)\s*$/, "").replace(/[,;.]\s*$/, "").trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

export function parseLinkedInFacts(snippet: string): LinkedInFacts {
  const education = fieldValues(snippet, "Education");
  const experience = fieldValues(snippet, "Experience");
  const unit = snippet.match(ELITE_UNIT_RE)?.[1] ?? null;
  const school = education.map((e) => e.match(ELITE_SCHOOL_RE)?.[1]).find(Boolean) ?? null;
  return {
    education,
    experience,
    eliteUnit: unit ? (/^\d/.test(unit) ? `Unit ${unit}` : unit.replace(/\s+/g, " ")) : null,
    eliteSchool: school,
  };
}

/** A short factual bio from the snippet facts, or null when the snippet states none. */
export function bioFromLinkedInFacts(facts: LinkedInFacts, companyName: string): string | null {
  const parts: string[] = [];
  const previous = facts.experience.filter((e) => !namesCompany(e, companyName));
  if (previous.length > 0) parts.push(`Previously at ${previous.join(", ")}.`);
  if (facts.education.length > 0) parts.push(`Studied at ${facts.education.join(", ")}.`);
  if (facts.eliteUnit) parts.push(`Served in ${facts.eliteUnit}.`);
  return parts.length > 0 ? parts.join(" ") : null;
}
