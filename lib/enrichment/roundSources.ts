/**
 * lib/enrichment/roundSources.ts — the sources a funding round may be written
 * from (owner, 2026-11-01). An allowlist in tiers, not a denylist: the
 * 2026-11-01 review sheet came mostly from multiples.vc, fundediq.co,
 * parsers.vc, startup-map.cologne, Wikipedia and a spam domain — a list of
 * banned platforms is never complete. Subdomains count (en.globes.co.il).
 *
 *   Tier 1 — official and first-hand: the company's own site (blog, newsroom,
 *            press page), the lead investor's own site (it is a party to the
 *            deal), official press wires, company registers and filings.
 *   Tier 2 — leading business and technology press.
 *   Tier 3 — regional business and startup press.
 *   Tier 4 — trade press by sector.
 *
 * Denied (never a source, at most a hint — hints.ts): data platforms
 * (dataPlatforms.ts) and the sites that copy them, Wikipedia, social
 * networks, content / sponsored-PR sites.
 *
 * Anything else is unlisted: a round only it states is not written — it is
 * kept as a hint, and the domain goes to the review list
 * (source_domain_review, migration 20261114000000) for the owner to allow,
 * deny or ignore. Lower confidence: EIN Presswire, and tier 4 alone.
 *
 * To add or move a domain, edit this file only.
 */

import { isDataPlatformUrl } from "./dataPlatforms";

export type SourceTier = 1 | 2 | 3 | 4;

/** Wires and registers (tier 1 beside the company's and the investor's own sites). */
export const TIER1_DOMAINS = [
  // Official press wires
  "prnewswire.com", "businesswire.com", "globenewswire.com", "accesswire.com", "einpresswire.com", "newswire.com",
  // Registers and filings
  "sec.gov", "find-and-update.company-information.service.gov.uk", "companieshouse.gov.uk", "data.gov.il",
  "maya.tase.co.il", "handelsregister.de", "unternehmensregister.de", "infogreffe.fr", "mca.gov.in",
];

export const TIER2_DOMAINS = [
  "reuters.com", "bloomberg.com", "ft.com", "wsj.com", "cnbc.com", "forbes.com", "fortune.com", "businessinsider.com",
  "axios.com", "theinformation.com", "techcrunch.com", "venturebeat.com", "wired.com", "theverge.com", "fastcompany.com", "inc.com",
];

export const TIER3_DOMAINS = [
  // Israel
  "calcalistech.com", "calcalist.co.il", "globes.co.il", "themarker.com", "geektime.com", "geektime.co.il", "nocamels.com",
  "timesofisrael.com", "ynet.co.il", "ynetnews.com",
  // Europe
  "sifted.eu", "tech.eu", "eu-startups.com", "uktech.news", "maddyness.com", "lesechos.fr", "handelsblatt.com",
  "gruenderszene.de", "expansion.com", "elreferente.es",
  // India
  "economictimes.indiatimes.com", "livemint.com", "moneycontrol.com", "inc42.com", "yourstory.com", "entrackr.com", "vccircle.com",
  // Asia
  "techinasia.com", "dealstreetasia.com", "kr-asia.com", "asia.nikkei.com", "e27.co", "36kr.com",
  // Latin America
  "bloomberglinea.com", "contxto.com", "latamlist.com",
  // Middle East and Africa
  "wamda.com", "zawya.com", "techcabal.com", "disrupt-africa.com",
  // Australia and Canada
  "afr.com", "smartcompany.com.au", "startupdaily.net", "betakit.com", "theglobeandmail.com",
];

export const TIER4_DOMAINS = [
  // Health, medtech, biotech
  "fiercebiotech.com", "fiercehealthcare.com", "endpts.com", "statnews.com", "medtechdive.com", "mobihealthnews.com", "biopharmadive.com",
  // Fintech
  "finextra.com", "fintechfutures.com", "thepaypers.com",
  // Cyber
  "securityweek.com", "darkreading.com", "cyberscoop.com",
  // Climate and agritech
  "canarymedia.com", "agfundernews.com",
  // Defence and space
  "defensenews.com", "breakingdefense.com", "spacenews.com",
  // Logistics
  "freightwaves.com",
];

/** Lower confidence even though allowed. */
// The company publishes on these wires itself — allowed, below its own site (owner, 2026-11-02:
// newswire.com, EIN Presswire, Accesswire).
export const LOW_CONFIDENCE_DOMAINS = ["einpresswire.com", "accesswire.com", "newswire.com"];

/** Never a source for a round, beside every data platform (dataPlatforms.ts). */
export const DENIED_DOMAINS = [
  // Encyclopedias
  "wikipedia.org",
  // Social networks and publishing platforms
  "linkedin.com", "facebook.com", "fb.com", "instagram.com", "x.com", "twitter.com", "youtube.com", "youtu.be", "tiktok.com",
  "threads.net", "reddit.com", "medium.com", "substack.com", "quora.com", "pinterest.com",
  // Content / sponsored-PR sites
  "everything-pr.com", "openpr.com", "prlog.org", "issuewire.com", "pr.com",
];

export function hostOf(url: string): string | null {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}
const onList = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));

/** The registrable domain to review ("news.example.co.uk" → "example.co.uk", "blog.acme.com" → "acme.com"). */
export function reviewDomain(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  const parts = host.split(".");
  const twoLevelTld = /^(co|com|org|net|gov|ac)\.[a-z]{2}$/.test(parts.slice(-2).join("."));
  return parts.slice(twoLevelTld ? -3 : -2).join(".");
}

const INVESTOR_WORDS = /\b(ventures?|capital|partners?|vc|fund|funds|management|investments?|group|holdings|advisors|equity|the|and|&|llc|lp|inc|ltd)\b/g;

/**
 * The lead investor's own site — "indexventures.com" for Index Ventures,
 * "fiveelms.com" for Five Elms Capital, "accel.com" for Accel: the domain's
 * name is the investor's name (its distinctive words, joined).
 */
export function isInvestorSite(url: string, investor: string | null | undefined): boolean {
  const host = hostOf(url);
  if (!host || !investor) return false;
  const label = host.split(".").slice(-2)[0].replace(/-/g, "");
  const full = investor.toLowerCase().replace(/[^a-z0-9& ]/g, " ");
  const core = full.replace(INVESTOR_WORDS, " ").replace(/\s+/g, "");
  const whole = full.replace(/[^a-z0-9]/g, "");
  return (core.length >= 4 && (label === core || label.startsWith(core))) || (whole.length >= 4 && label === whole);
}

export type SourceStanding =
  | { kind: "allowed"; tier: SourceTier; lowConfidence: boolean; why: string }
  | { kind: "denied"; why: string }
  | { kind: "unlisted"; domain: string };

/**
 * Where a round's source stands. `isCompanySite` comes from sources.ts (the
 * company's verified domain); `leadInvestor` lets the investor's own site count.
 */
export function roundSourceStanding(url: string, opts: { isCompanySite?: boolean; leadInvestor?: string | null } = {}): SourceStanding {
  const host = hostOf(url);
  if (!host) return { kind: "denied", why: "no_host" };
  if (opts.isCompanySite) return { kind: "allowed", tier: 1, lowConfidence: false, why: "company_site" };
  if (isDataPlatformUrl(url)) return { kind: "denied", why: "data_platform" };
  if (onList(host, DENIED_DOMAINS)) return { kind: "denied", why: "denied_domain" };
  if (onList(host, TIER1_DOMAINS)) return { kind: "allowed", tier: 1, lowConfidence: onList(host, LOW_CONFIDENCE_DOMAINS), why: "wire_or_register" };
  if (isInvestorSite(url, opts.leadInvestor)) return { kind: "allowed", tier: 1, lowConfidence: false, why: "investor_site" };
  if (onList(host, TIER2_DOMAINS)) return { kind: "allowed", tier: 2, lowConfidence: false, why: "tier2_press" };
  if (onList(host, TIER3_DOMAINS)) return { kind: "allowed", tier: 3, lowConfidence: false, why: "tier3_press" };
  if (onList(host, TIER4_DOMAINS)) return { kind: "allowed", tier: 4, lowConfidence: true, why: "tier4_press" };
  return { kind: "unlisted", domain: reviewDomain(url) ?? host };
}

/**
 * The sources the pilot's fields — HQ city/country, founded year, founding
 * country — may be written from (owner, 2026-11-02): the company's own site or
 * release, a register, or the press of tiers 1–3. The 10-company dry run of
 * 2026-11-02 took KETS's founding year from Tracxn, Soda's founding country
 * from SourceForge and Mentat's year from a Tracxn list of mood-tracker apps.
 */
export function profileSourceAllowed(s: { url: string; source_type?: string | null }): boolean {
  if (s.source_type === "company_site" || s.source_type === "press_release" || s.source_type === "registry") return true;
  const standing = roundSourceStanding(s.url);
  return standing.kind === "allowed" && standing.tier <= 3;
}

/** Provenance confidence for a round value: lowered for EIN Presswire / tier 4 alone. */
export function roundSourceConfidence(base: number, standing: SourceStanding): number {
  return standing.kind === "allowed" && standing.lowConfidence ? Math.min(base, 60) : base;
}
