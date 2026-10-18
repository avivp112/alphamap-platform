// =============================================================================
// worker/identify.ts — the identify phase of "check a company": one short
// search that finds the company, so the user can confirm "is this the company
// you mean?" before the checks run.
//
// Missing is better than wrong:
//   * A search result becomes a candidate only when its domain carries the
//     company's name (nuova.ai, getnuova.com for "Nuova AI") — news sites,
//     directories and look-alike names drop out on their own.
//   * Location only when Google's knowledge panel for THAT website states it.
//   * When the user gave the website, it is the one candidate: their word
//     beats any search, and the page itself supplies name and description.
// buildCandidates() is pure (identify.test.ts); runIdentify() does the I/O.
// =============================================================================

import * as cheerio from "cheerio";
import { isGenericDirectoryDomain, websiteDomain } from "../lib/enrichment/websiteValidation.ts";
import { namesCompany } from "../lib/enrichment/headcount.ts";
import type { KnowledgeGraph, Search, SearchResult } from "./search.ts";

export interface IdentityCandidate {
  name: string;
  website: string | null;
  domain: string | null;
  description: string | null;
  location: string | null;
  /** your_website = the site the user gave; search = found by the search. */
  source: "your_website" | "search";
  /** The page the candidate was taken from. */
  evidence_url: string | null;
  /** The user's website could not be opened (still offered: they said it is theirs). */
  unreachable?: boolean;
  /** Set when the company is already in AlphaMap: confirming it opens the company, nothing runs. */
  startup_id: string | null;
  startup_name: string | null;
}

export interface IdentifyInput {
  name: string;
  website: string | null;
  country: string | null;
  founder: string | null;
}

export interface SiteMeta {
  siteName: string | null;
  title: string | null;
  description: string | null;
}

export const MAX_CANDIDATES = 4;

// ── Names and domains ────────────────────────────────────────────────────────

const LEGAL_OR_GENERIC = new Set([
  "inc", "ltd", "llc", "corp", "co", "gmbh", "sa", "sas", "plc", "limited", "company", "corporation",
  "the", "and", "ai", "labs", "lab", "tech", "technologies", "technology", "systems", "solutions",
  "software", "digital", "global", "group", "holdings", "ventures", "io", "app", "hq", "data",
]);
// Prefixes/suffixes start-ups put around their name in a domain.
const DOMAIN_AFFIXES = ["get", "try", "use", "join", "go", "hello", "with", "app", "hq", "ai", "labs", "io", "inc", "team"];
// Second-level labels under which the registrable domain has three parts.
const MULTI_PART_SUFFIX = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "or", "ne"]);

function words(s: string): string[] {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** The name's distinctive words, and all its words run together ("blackforestlabs"). */
export function nameTokens(name: string): { distinct: string[]; joined: string } {
  const all = words(name).filter((w) => !["inc", "ltd", "llc", "corp", "gmbh", "sa", "sas", "plc", "limited"].includes(w));
  return { distinct: all.filter((w) => w.length >= 3 && !LEGAL_OR_GENERIC.has(w)), joined: all.join("") };
}

/** "blog.acme.co.uk" -> "acme.co.uk", "www.acme.ai" -> "acme.ai". */
export function rootDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const sld = parts[parts.length - 2];
  const n = MULTI_PART_SUFFIX.has(sld) && parts[parts.length - 1].length === 2 ? 3 : 2;
  return parts.slice(-n).join(".");
}

/**
 * How well a domain carries the company's name: 2 = it IS the name (acme.ai,
 * getacme.com, acme-hq.io), 1 = it contains a distinctive word of it, 0 = no.
 */
export function domainNameMatch(domain: string, name: string): 0 | 1 | 2 {
  const label = rootDomain(domain).split(".")[0].replace(/-/g, "");
  const { distinct, joined } = nameTokens(name);
  const exact = [joined, ...distinct].filter((t) => t.length >= 2);
  for (const t of exact) {
    if (label === t) return 2;
    for (const a of DOMAIN_AFFIXES) if (label === a + t || label === t + a) return 2;
  }
  if (joined.length >= 4 && label.includes(joined)) return 1;
  if (distinct.some((t) => t.length >= 4 && label.includes(t))) return 1;
  return 0;
}

/** The company-name part of a page title ("Acme — AI for X" -> "Acme"), when it names the company. */
export function titleName(title: string | null | undefined, name: string): string | null {
  if (!title) return null;
  const head = title.split(/\s*[|–—·]\s*|\s-\s|:\s/)[0].trim();
  return head && head.length <= 60 && namesCompany(head, name) ? head : null;
}

function kgLocation(kg: KnowledgeGraph | null): string | null {
  if (!kg) return null;
  for (const [k, v] of Object.entries(kg.attributes)) {
    if (/^(headquarters|headquarters location|location)$/i.test(k.trim()) && v?.trim()) return v.trim().slice(0, 80);
  }
  return null;
}

const clip = (s: string | null | undefined, n = 220): string | null => {
  const t = s?.replace(/\s+/g, " ").trim();
  return t ? (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t) : null;
};

// ── Candidates (pure) ────────────────────────────────────────────────────────

export function buildCandidates(input: IdentifyInput, search: SearchResult, site: SiteMeta | null): IdentityCandidate[] {
  const kg = search.knowledgeGraph;
  const kgDomain = kg?.website ? websiteDomain(kg.website) : null;
  const kgRoot = kgDomain ? rootDomain(kgDomain) : null;

  // The user's own website: one candidate, never replaced by a search hit.
  const userHost = websiteDomain(input.website);
  if (input.website && userHost) {
    const root = rootDomain(userHost);
    const ownHit = search.organic.find((r) => { const d = websiteDomain(r.url); return d && rootDomain(d) === root; });
    return [{
      name: clip(site?.siteName, 60) ?? titleName(site?.title, input.name) ?? input.name,
      website: input.website,
      domain: root,
      description: clip(site?.description) ?? clip(ownHit?.content),
      location: kgRoot === root ? kgLocation(kg) : null,
      source: "your_website",
      evidence_url: input.website,
      ...(site ? {} : { unreachable: true }),
      startup_id: null,
      startup_name: null,
    }];
  }

  type Scored = IdentityCandidate & { strength: number; rank: number };
  const byDomain = new Map<string, Scored>();
  const consider = (url: string, title: string | null, snippet: string | null, rank: number, fromKg: boolean) => {
    const host = websiteDomain(url);
    if (!host) return;
    const root = rootDomain(host);
    if (isGenericDirectoryDomain(root) || byDomain.has(root)) return;
    const strength = domainNameMatch(root, input.name);
    // The knowledge panel is Google's own pick for the name: enough when its title names the company.
    if (strength === 0 && !(fromKg && namesCompany(title ?? "", input.name))) return;
    byDomain.set(root, {
      name: (fromKg ? clip(title, 60) : titleName(title, input.name)) ?? input.name,
      website: `https://${root}`,
      domain: root,
      description: clip(snippet),
      location: root === kgRoot ? kgLocation(kg) : null,
      source: "search",
      evidence_url: url,
      startup_id: null,
      startup_name: null,
      strength: fromKg ? 3 : strength,
      rank,
    });
  };
  if (kg?.website) consider(kg.website, kg.title, kg.description, -1, true);
  search.organic.forEach((r, i) => consider(r.url, r.title ?? null, r.content, i, false));

  return [...byDomain.values()]
    .sort((a, b) => b.strength - a.strength || a.rank - b.rank)
    .slice(0, MAX_CANDIDATES)
    .map(({ strength: _s, rank: _r, ...c }) => c);
}

/** The one query: the quoted name, anchored by whatever else the user gave. */
export function identifyQuery(input: IdentifyInput): string {
  const host = websiteDomain(input.website);
  const parts = [`"${input.name}"`];
  if (host) parts.push(rootDomain(host));
  else {
    if (input.founder) parts.push(`"${input.founder}"`);
    if (input.country) parts.push(input.country);
  }
  return parts.join(" ");
}

// ── I/O ──────────────────────────────────────────────────────────────────────

const SITE_TIMEOUT_MS = 8_000;

export function parseSiteMeta(html: string): SiteMeta {
  const $ = cheerio.load(html);
  const meta = (sel: string) => $(sel).attr("content")?.trim() || null;
  return {
    siteName: meta('meta[property="og:site_name"]'),
    title: $("title").first().text().trim() || meta('meta[property="og:title"]'),
    description: meta('meta[name="description"]') ?? meta('meta[property="og:description"]'),
  };
}

export async function fetchSiteMeta(url: string): Promise<SiteMeta | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SITE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AlphaMapBot/1.0; +https://alphamap.app)", Accept: "text/html" },
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return null;
    return parseSiteMeta((await res.text()).slice(0, 300_000));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function runIdentify(input: IdentifyInput, deps: {
  search: Search;
  fetchSite: (url: string) => Promise<SiteMeta | null>;
  findExisting: (website: string) => Promise<{ id: string; name: string } | null>;
}): Promise<IdentityCandidate[]> {
  const [search, site] = await Promise.all([
    deps.search(identifyQuery(input), "check_identify"),
    input.website ? deps.fetchSite(input.website) : Promise.resolve(null),
  ]);
  const candidates = buildCandidates(input, search, site);
  for (const c of candidates) {
    if (!c.website) continue;
    const hit = await deps.findExisting(c.website);
    if (hit) { c.startup_id = hit.id; c.startup_name = hit.name; }
  }
  return candidates;
}
