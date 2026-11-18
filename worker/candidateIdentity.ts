// =============================================================================
// worker/candidateIdentity.ts — stage 4: does this review candidate have a
// website of its own, and is it really THIS company's?
//
// A candidate from a registry (SEC Form D, a UK incorporation that surfaced
// from the watchlist) arrives with a name and a place. This finds the company's
// own site, proves it is theirs with at least two independent matches taken
// from the registry record (a director's name on the site, the company number,
// the postcode or city, the legal name, the founding year), and says in one
// line what the company does — in the company's own words.
//
// Rules (owner's decisions of 2026-11-18):
//   * Zero guessing. No verified site => status "no_site"/"unverified" and the
//     card says "לא נמצאה זהות דיגיטלית מאומתת". Nothing is inferred from a name.
//   * Allowed sources only: the company's own website. Directories, databases
//     (Crunchbase, PitchBook, Dealroom...), Wikipedia and forums are never
//     read or cited.
//   * Polite: every page goes through the crawl policy (robots.txt first, an
//     honest User-Agent) — pass a politeFetch() as `fetch`.
//   * At most MAX_SEARCHES searches and MAX_PAGES pages per candidate.
//   * The description is a sentence the model QUOTES from the page; the code
//     checks the quote is in the page text, word for word. Not found => no
//     description at all.
//   * No automatic rejection. This only prepares evidence and a recommendation
//     input; the owner decides.
//
// Pure functions are tested in candidateIdentity.test.ts; enrichCandidate()
// does the I/O through injected dependencies.
// =============================================================================

import { isGenericDirectoryDomain, websiteDomain } from "../lib/enrichment/websiteValidation.ts";
import { htmlToText, promptText } from "../lib/enrichment/pageText.ts";
import { domainNameMatch, rootDomain } from "./identify.ts";
import type { Search, SearchResult } from "./search.ts";

export const MAX_SEARCHES = 3;
export const MAX_PAGES = 2;
/** Matches needed to call a website the company's: at least two kinds, one of them an identity kind. */
export const MIN_MATCH_KINDS = 2;

// ── Types ────────────────────────────────────────────────────────────────────

export interface CandidateInput {
  id: string;
  source: string;
  name: string;
  country: string | null;
  founded_year: number | null;
  entity_number: string | null;
  website: string | null;
  evidence: {
    address?: string;
    postal_code?: string;
    officers?: Array<{ name?: string; relationships?: string[] }>;
  } & Record<string, unknown>;
}

export type MatchKind = "director" | "company_number" | "postcode" | "legal_name" | "city" | "founded";

export interface MatchSignal {
  kind: MatchKind;
  /** What was matched, e.g. the director's name. */
  text: string;
  url: string;
}

/** Kinds that identify the company on their own; city and year alone could be a namesake. */
const IDENTITY_KINDS: ReadonlySet<MatchKind> = new Set(["director", "company_number", "postcode", "legal_name"]);

export type SiteSignalKind = "jobs" | "pricing" | "login" | "demo" | "agency" | "consulting";

export interface SiteSignal {
  kind: SiteSignalKind;
  level: "product" | "services";
  text: string;
  url: string;
}

export type EnrichmentStatus = "verified" | "unverified" | "no_site";

export interface Enrichment {
  status: EnrichmentStatus;
  /** The verified website (status verified) or the best unconfirmed one (unverified). */
  website: string | null;
  match_signals: MatchSignal[];
  site_signals: SiteSignal[];
  /** One Hebrew line: what the company says it does. Only with a verified site and a quote found on the page. */
  description_he: string | null;
  /** The sentence taken from the page, word for word. */
  description_quote: string | null;
  description_source_url: string | null;
  source_urls: string[];
  search_calls: number;
  enriched_at: string;
  notes: string[];
}

export interface Page { url: string; html: string; text: string }

// ── Sources that are never read or cited ─────────────────────────────────────

const FORBIDDEN_DOMAINS = [
  "crunchbase.com", "pitchbook.com", "dealroom.co", "wikipedia.org", "wikidata.org", "reddit.com",
  "quora.com", "tracxn.com", "cbinsights.com", "zoominfo.com", "owler.com", "apollo.io", "rocketreach.co",
  "craft.co", "growjo.com", "opencorporates.com", "companycheck.co.uk", "endole.co.uk", "northdata.com",
];

export function isForbiddenDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return FORBIDDEN_DOMAINS.some((f) => d === f || d.endsWith(`.${f}`)) || isGenericDirectoryDomain(d);
}

// ── Names, places, people ────────────────────────────────────────────────────

const fold = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const wordsOf = (s: string): string[] => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

const LEGAL_SUFFIX = /[,\s]+(inc|incorporated|ltd|limited|llc|l\.l\.c|corp|corporation|gmbh|plc|co|company|lp|llp)\.?$/i;

/** "UCHU Biosensors, Inc." -> "UCHU Biosensors". */
export function plainName(name: string): string {
  let n = name.trim();
  for (let i = 0; i < 2; i++) n = n.replace(LEGAL_SUFFIX, "").trim();
  return n || name.trim();
}

export interface PersonName { first: string; last: string }

/** UK officers are "BLOGGS, Jo Simon"; Form D related persons are "Dana R Okonkwo". Lowercase, accents folded. */
export function personName(raw: string | undefined): PersonName | null {
  const name = (raw ?? "").trim();
  if (!name) return null;
  const comma = name.indexOf(",");
  const parts = comma > 0
    ? { last: name.slice(0, comma), given: name.slice(comma + 1) }
    : (() => { const w = name.split(/\s+/); return { last: w[w.length - 1], given: w.slice(0, -1).join(" ") }; })();
  const last = wordsOf(parts.last).pop();
  const first = wordsOf(parts.given)[0];
  return first && last && first.length >= 2 && last.length >= 2 && first !== last ? { first, last } : null;
}

/** The person's first and last name within a few words of each other ("Jo Bloggs", "Jo S. Bloggs", "Bloggs, Jo"). */
export function textHasPerson(text: string, p: PersonName): boolean {
  const w = wordsOf(text);
  for (let i = 0; i < w.length; i++) {
    if (w[i] === p.first && w.slice(i + 1, i + 4).includes(p.last)) return true;
    if (w[i] === p.last && w.slice(i + 1, i + 4).includes(p.first)) return true;
  }
  return false;
}

/** Directors and executive officers of the candidate, as searchable names. */
export function candidatePeople(c: CandidateInput, max = 4): Array<{ raw: string; name: PersonName }> {
  const out: Array<{ raw: string; name: PersonName }> = [];
  for (const o of c.evidence.officers ?? []) {
    const roles = (o.relationships ?? []).join(" ").toLowerCase();
    if (roles && !/director|executive|officer|manager|ceo|founder/.test(roles)) continue;
    const name = personName(o.name);
    if (name && o.name) out.push({ raw: o.name, name });
    if (out.length >= max) break;
  }
  return out;
}

/** "Jo Bloggs" for a search query, from either name form. */
export function displayName(raw: string): string {
  const comma = raw.indexOf(",");
  const n = comma > 0 ? `${raw.slice(comma + 1)} ${raw.slice(0, comma)}` : raw;
  return n.replace(/\s+/g, " ").trim().split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/** The city of the registered address: Form D "street, city, ST, zip" -> city. UK addresses give the postcode instead. */
export function cityOf(c: CandidateInput): string | null {
  const parts = (c.evidence.address ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (c.source === "sec_form_d" && parts.length >= 4) return parts[parts.length - 3] || null;
  return null;
}

const normPostcode = (s: string): string => s.toUpperCase().replace(/\s+/g, "");

// ── Matching the site to the record (pure) ───────────────────────────────────

/**
 * The matches between a website's pages and the registry record. Each kind
 * counts once. A company is the site's owner when at least MIN_MATCH_KINDS
 * kinds match and one of them is an identity kind.
 */
export function matchSignals(c: CandidateInput, pages: Page[]): MatchSignal[] {
  const found = new Map<MatchKind, MatchSignal>();
  const add = (kind: MatchKind, text: string, url: string) => { if (!found.has(kind)) found.set(kind, { kind, text, url }); };
  const people = candidatePeople(c, 6);
  const city = cityOf(c);
  const postcode = c.evidence.postal_code ? normPostcode(c.evidence.postal_code) : null;
  const legal = wordsOf(c.name.replace(/[.,]/g, " "));
  const hasLegalSuffix = /\b(ltd|limited|inc|llc|gmbh|plc|corp|corporation)\b/i.test(c.name);

  for (const p of pages) {
    for (const person of people) if (textHasPerson(p.text, person.name)) add("director", displayName(person.raw), p.url);
    if (c.source === "uk_companies_house" && c.entity_number && new RegExp(`(?<![0-9A-Za-z])${c.entity_number}(?![0-9A-Za-z])`).test(p.text)) {
      add("company_number", c.entity_number, p.url);
    }
    if (postcode && normPostcode(p.text).includes(postcode)) add("postcode", c.evidence.postal_code!, p.url);
    if (city && city.length >= 3 && wordsOf(p.text).join(" ").includes(wordsOf(city).join(" "))) add("city", city, p.url);
    // The full legal name incl. its suffix ("Acme Robotics Ltd") is what footers and terms pages carry.
    if (hasLegalSuffix && legal.length >= 2 && wordsOf(p.text).join(" ").includes(legal.join(" "))) add("legal_name", c.name, p.url);
    if (c.founded_year && new RegExp(`\\b(?:founded|since|established|est\\.?|incorporated)\\b[^.\\n]{0,30}\\b${c.founded_year}\\b`, "i").test(p.text)) {
      add("founded", String(c.founded_year), p.url);
    }
  }
  return [...found.values()];
}

export function isVerified(signals: MatchSignal[]): boolean {
  const kinds = new Set(signals.map((s) => s.kind));
  return kinds.size >= MIN_MATCH_KINDS && [...kinds].some((k) => IDENTITY_KINDS.has(k));
}

// ── What the site looks like (pure) ──────────────────────────────────────────

const LINK = /<a\s[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi;

/** Signals read from a page's links and words: a product company has pricing, a login, a demo and jobs; an agency sells "services". */
export function siteSignals(pages: Page[]): SiteSignal[] {
  const out = new Map<SiteSignalKind, SiteSignal>();
  const add = (kind: SiteSignalKind, level: SiteSignal["level"], text: string, url: string) => { if (!out.has(kind)) out.set(kind, { kind, level, text, url }); };
  for (const p of pages) {
    const links: Array<{ href: string; label: string }> = [];
    for (const m of p.html.matchAll(LINK)) links.push({ href: m[1], label: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
    const has = (re: RegExp) => links.find((l) => re.test(l.href) || re.test(l.label));
    const jobs = has(/\b(careers?|jobs?|we'?re hiring|join us|join the team)\b/i);
    if (jobs) add("jobs", "product", `יש עמוד משרות (${jobs.label || jobs.href})`, p.url);
    const pricing = has(/\b(pricing|plans)\b/i);
    if (pricing) add("pricing", "product", "יש עמוד מחירים", p.url);
    const login = has(/\b(log ?in|sign ?in|sign ?up|get started|dashboard)\b/i);
    if (login) add("login", "product", "יש התחברות או הרשמה למוצר", p.url);
    const demo = has(/\b(book a demo|request a demo|schedule a demo|try (?:it )?free|free trial)\b/i);
    if (demo) add("demo", "product", "יש הזמנת הדגמה או ניסיון חינם", p.url);
    if (/\b(digital agency|creative agency|marketing agency|web design agency|we build (?:websites|apps) for)\b/i.test(p.text)) add("agency", "services", "האתר מתאר סוכנות", p.url);
    if (/\b(consultancy|consulting services|our consultants|management consulting|it consulting)\b/i.test(p.text)) add("consulting", "services", "האתר מתאר חברת ייעוץ", p.url);
  }
  return [...out.values()];
}

// ── The description: a quote the code can find on the page (pure) ────────────

const squash = (s: string): string => fold(s).replace(/[‘’‛`´]/g, "'").replace(/[“”„]/g, '"').replace(/\s+/g, " ").trim();

/** True only when the quote is in the text word for word (whitespace, case, accents and quote marks aside). */
export function quoteInText(quote: string, text: string): boolean {
  const q = squash(quote).replace(/[.…]+$/, "");
  return q.length >= 20 && squash(text).includes(q);
}

// ── Choosing sites from search results (pure) ────────────────────────────────

export interface SiteCandidate { url: string; domain: string; via: "name" | "person" }

/** Distinct root domains whose name carries the company's name, never a forbidden source. At most `max`. */
export function pickSiteCandidates(c: CandidateInput, result: SearchResult, max = 3): SiteCandidate[] {
  const out: SiteCandidate[] = [];
  const seen = new Set<string>();
  const people = candidatePeople(c, 3);
  for (const r of result.organic) {
    const host = websiteDomain(r.url);
    if (!host) continue;
    const root = rootDomain(host);
    if (seen.has(root) || isForbiddenDomain(root)) continue;
    const byName = domainNameMatch(root, plainName(c.name)) >= 1;
    // A result whose own words name the company AND one of its people, on a domain not named after it.
    const snippet = `${r.title ?? ""} ${r.content ?? ""}`;
    const byPerson = !byName && people.some((p) => textHasPerson(snippet, p.name)) && wordsOf(snippet).join(" ").includes(wordsOf(plainName(c.name)).join(" "));
    if (!byName && !byPerson) continue;
    seen.add(root);
    out.push({ url: r.url, domain: root, via: byName ? "name" : "person" });
    if (out.length >= max) break;
  }
  return out;
}

// ── The run ──────────────────────────────────────────────────────────────────

export interface Describer {
  /** Returns a sentence quoted from `text` and a Hebrew line saying the same, or null. */
  (args: { name: string; text: string }): Promise<{ quote: string; description_he: string } | null>;
}

export interface IdentityDeps {
  search: Search;
  /** Must be politeFetch(): robots.txt first, honest User-Agent. */
  fetch: typeof fetch;
  describe: Describer;
  now?: () => Date;
}

const PAGE_TIMEOUT_MS = 12_000;
const MAX_HTML = 400_000;
const ABOUT_LINK = /\b(about|team|company|who-?we-?are|our-?story|leadership|contact)\b/i;

async function getPage(url: string, f: typeof fetch): Promise<Page | null> {
  try {
    const res = await f(url, { redirect: "follow", signal: AbortSignal.timeout(PAGE_TIMEOUT_MS), headers: { Accept: "text/html" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return null;
    const html = (await res.text()).slice(0, MAX_HTML);
    return { url: res.url || url, html, text: htmlToText(html) };
  } catch {
    return null;
  }
}

/** The first same-site link to an about/team/contact page, absolute. */
export function aboutLink(home: Page): string | null {
  let base: URL;
  try { base = new URL(home.url); } catch { return null; }
  for (const m of home.html.matchAll(LINK)) {
    try {
      const u = new URL(m[1], base);
      if (u.origin !== base.origin || u.pathname === "/" || u.pathname === base.pathname) continue;
      if (ABOUT_LINK.test(u.pathname) || ABOUT_LINK.test(m[2].replace(/<[^>]+>/g, " "))) return u.toString();
    } catch { /* not a URL */ }
  }
  return null;
}

async function readSite(url: string, f: typeof fetch): Promise<Page[]> {
  let origin: string;
  try { origin = new URL(url).origin; } catch { return []; }
  const home = await getPage(origin + "/", f);
  if (!home) return [];
  const pages = [home];
  const about = aboutLink(home);
  if (about && pages.length < MAX_PAGES) {
    const p = await getPage(about, f);
    if (p) pages.push(p);
  }
  return pages;
}

const blank = (now: Date): Enrichment => ({
  status: "no_site", website: null, match_signals: [], site_signals: [], description_he: null,
  description_quote: null, description_source_url: null, source_urls: [], search_calls: 0,
  enriched_at: now.toISOString(), notes: [],
});

export async function enrichCandidate(c: CandidateInput, deps: IdentityDeps): Promise<Enrichment> {
  const out = blank((deps.now ?? (() => new Date()))());
  const name = plainName(c.name);
  const people = candidatePeople(c, 2);
  const city = cityOf(c);
  let searches = 0;
  // Domains the searches returned, so a "no site" can be audited: what was there, and was the right one wrongly dropped?
  const seen = new Set<string>();
  const search = async (q: string, label: string): Promise<SearchResult> => {
    searches++; out.search_calls = searches;
    const r = await deps.search(q, label);
    for (const x of r.organic) { const h = websiteDomain(x.url); if (h) seen.add(rootDomain(h)); }
    return r;
  };

  // 1. Find candidate sites: name + place first, then name + people.
  let sites: SiteCandidate[] = [];
  if (c.website) {
    const d = websiteDomain(c.website);
    if (d && !isForbiddenDomain(rootDomain(d))) sites = [{ url: c.website, domain: rootDomain(d), via: "name" }];
  }
  if (sites.length === 0) {
    sites = pickSiteCandidates(c, await search(`"${name}" ${city ?? c.country ?? ""}`.trim(), "candidate_site"));
  }
  if (sites.length === 0 && people.length > 0) {
    sites = pickSiteCandidates(c, await search(`"${name}" ${people.map((p) => `"${displayName(p.raw)}"`).join(" ")}`, "candidate_site_people"));
  }
  if (sites.length === 0) {
    out.notes.push(`לא נמצא אתר שהדומיין שלו נושא את שם החברה. דומיינים בתוצאות: ${[...seen].slice(0, 8).join(", ") || "אין"}`);
    return out;
  }

  // 2. Read at most two pages of each of the first two sites and score them against the record.
  let best: { site: SiteCandidate; pages: Page[]; signals: MatchSignal[] } | null = null;
  for (const site of sites.slice(0, 2)) {
    const pages = await readSite(site.url, deps.fetch);
    if (pages.length === 0) { out.notes.push(`האתר ${site.domain} לא נקרא (חסום ב-robots.txt או לא זמין)`); continue; }
    const signals = matchSignals(c, pages);
    if (!best || new Set(signals.map((s) => s.kind)).size > new Set(best.signals.map((s) => s.kind)).size) best = { site, pages, signals };
    if (isVerified(signals)) break;
  }
  if (!best) return out;

  // 3. One more search, only when the best site is one match short: does the search engine tie a director to this domain?
  if (!isVerified(best.signals) && searches < MAX_SEARCHES && people.length > 0) {
    const r = await search(`site:${best.site.domain} "${displayName(people[0].raw)}"`, "candidate_site_person");
    const hit = r.organic.find((x) => {
      const h = websiteDomain(x.url);
      return h && rootDomain(h) === best!.site.domain && textHasPerson(`${x.title ?? ""} ${x.content ?? ""}`, people[0].name);
    });
    if (hit && !best.signals.some((s) => s.kind === "director")) best.signals.push({ kind: "director", text: displayName(people[0].raw), url: hit.url });
  }

  out.website = best.site.url;
  out.match_signals = best.signals;
  out.source_urls = best.pages.map((p) => p.url);
  out.site_signals = siteSignals(best.pages);

  if (!isVerified(best.signals)) {
    out.status = "unverified";
    out.notes.push(`נמצא אתר ${best.site.domain} אבל רק ${new Set(best.signals.map((s) => s.kind)).size} התאמה לרשומה: לא מאומת`);
    return out;
  }
  out.status = "verified";

  // 4. What the company says it does: a sentence the model quotes and the code finds on the page.
  const text = best.pages.map((p) => promptText(p.text, 4000)).join("\n\n");
  try {
    const d = await deps.describe({ name, text });
    if (d && quoteInText(d.quote, text)) {
      out.description_quote = d.quote.trim();
      out.description_he = d.description_he.trim();
      out.description_source_url = best.pages.find((p) => quoteInText(d.quote, p.text))?.url ?? best.pages[0].url;
    } else if (d) {
      out.notes.push("הציטוט שהמודל החזיר לא נמצא בטקסט האתר: התיאור נזרק");
    }
  } catch (e) {
    out.notes.push(`תיאור לא נוצר: ${String(e).slice(0, 120)}`);
  }
  return out;
}
