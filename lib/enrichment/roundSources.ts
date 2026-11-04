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
import { isRegionalWireHost } from "./primarySources";

export type SourceTier = 1 | 2 | 3 | 4;

/** Wires and registers (tier 1 beside the company's and the investor's own sites). */
export const TIER1_DOMAINS = [
  // Official press wires
  "prnewswire.com", "businesswire.com", "globenewswire.com", "accesswire.com", "einpresswire.com", "newswire.com", "pr.com", "businesswireindia.com", "prweb.com",
  // Registers and filings
  "sec.gov", "find-and-update.company-information.service.gov.uk", "companieshouse.gov.uk", "data.gov.il",
  "maya.tase.co.il", "handelsregister.de", "unternehmensregister.de", "infogreffe.fr", "mca.gov.in",
];

export const TIER2_DOMAINS = [
  "reuters.com", "bloomberg.com", "ft.com", "wsj.com", "cnbc.com", "forbes.com", "fortune.com", "businessinsider.com",
  "axios.com", "theinformation.com", "techcrunch.com", "venturebeat.com", "wired.com", "theverge.com", "fastcompany.com", "inc.com",
  "telegraph.co.uk", // owner, 2026-11-03
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
  // United States, regional
  "geekwire.com", // owner, 2026-11-03
  // Technology, its regional editions too (au.pcmag.com…) — owner, 2026-11-03
  "pcmag.com",
  // Owner, 2026-11-03 (rejected-domains table, runs 1–2)
  "seenews.com", "aninews.in", "thehansindia.com", "dbusiness.com", "prolificnorth.co.uk",
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
  // Owner, 2026-11-03 (field review run 2)
  "gamesbeat.com", "techtarget.com", "siliconangle.com", "bankinfosecurity.com", "biospace.com",
  "nosh.com", "gameworldobserver.com", "channele2e.com", "pymnts.com", "venturecapitaljournal.com",
  "phocuswire.com", "constructiondive.com", "datacenterdynamics.com", "gamedeveloper.com", "wealthmanagement.com",
  "financemagnates.com", "fxnewsgroup.com", "defensedaily.com", "electronicsweekly.com", "paymentsdive.com", "industrialcyber.co",
  "roboticsandautomationnews.com", "globalaginvesting.com", "decrypt.co",
];

/** Lower confidence even though allowed. */
// The company publishes on these wires itself — allowed, below its own site (owner, 2026-11-02:
// newswire.com, EIN Presswire, Accesswire; 2026-11-03: pr.com).
export const LOW_CONFIDENCE_DOMAINS = ["einpresswire.com", "accesswire.com", "newswire.com", "pr.com", "businesswireindia.com", "prweb.com"];

/** Never a source for a round, beside every data platform (dataPlatforms.ts). */
export const DENIED_DOMAINS = [
  // Encyclopedias
  "wikipedia.org",
  // Social networks and publishing platforms
  "linkedin.com", "facebook.com", "fb.com", "instagram.com", "x.com", "twitter.com", "youtube.com", "youtu.be", "tiktok.com",
  "threads.net", "reddit.com", "medium.com", "substack.com", "quora.com", "pinterest.com",
  // Content / sponsored-PR sites
  "everything-pr.com", "openpr.com", "prlog.org", "issuewire.com",
  // A redirect whose target cannot be read
  "google.com",
  // Blogs and newsletters (owner, 2026-11-03 — field review run 2)
  "reboot-hub.com", "neatnettricks.com", "stacksync.com", "revenuememo.com",
  "asiatechdaily.com", "aithority.com", "technews180.com", "automationtoday.net", "theindustryspread.com", "ajuniorvc.com",
  "clinchbase.com", "aibase.com", "simplywall.st", "beehiiv.com",
  // Company databases, directories, job boards (owner, 2026-11-03)
  "highperformr.ai", "siliconvalleyinvestclub.com", "startupintros.com", "shortlistjobs.com", "thecompanycheck.com", "getlatka.com",
  "rootdata.com", "traderknows.com", "chemxplore.com", "qubevents.com", "multiples.vc", "altss.com", "gritt.io", "inven.ai",
  "gamecompanies.com", "builtinnyc.com", "startupblink.com",
  // Owner, 2026-11-04 (run 3)
  "tipranks.com", "neuron.com", "telescoped.com", "cyberdb.co", "andorra-startup.com", "growthlist.co", "builtin.com",
  "workology.com", "avahr.com", "compono.com", "resumeoptimizerpro.com",
];

/**
 * A hint only, never a source (owner, 2026-11-03): what these state is searched for in an
 * allowed source — a round through hints.ts, a news item through its headline.
 */
export const HINT_ONLY_DOMAINS = ["finsmes.com", "techfundingnews.com", "thesaasnews.com", "refreshmiami.com",
  "defenseandmunitions.com", "tectonicdefense.com", "enlit.world", "cyprusshippingnews.com", "uktechnews.info"];

/**
 * Sites that republish others' articles (owner, 2026-11-03): allowed only when the article
 * is a republication of an allowed source that the article itself names — the wire's
 * dateline ("/PRNewswire/", "(BUSINESS WIRE)"), "(Reuters) -", or "Originally published on
 * TechCrunch" / "Read the original article on Business Insider". The original's standing is
 * the republication's.
 */
export const SYNDICATION_HOSTS = ["finance.yahoo.com", "tradingview.com", "financialcontent.com"];
/** Republishers on part of a site only (owner, 2026-11-04): nasdaq.com's press releases. */
const SYNDICATION_PATHS: Array<[string, RegExp]> = [["nasdaq.com", /^\/press-release\//]];

/**
 * A company's own newsroom on a newsroom service (owner, 2026-11-04): mynewsdesk.com/<country>/<newsroom>/…
 * counts as the company's release — tier 1, low confidence — when the newsroom is the company's
 * (its name's words in the newsroom's slug). Larian's announcement in Bastion UK's (a PR
 * agency's) newsroom is not.
 */
export function isOwnNewsroom(url: string, companyName: string | null | undefined): boolean {
  if (!companyName) return false;
  const host = hostOf(url);
  if (!host || !(host === "mynewsdesk.com" || host.endsWith(".mynewsdesk.com"))) return false;
  let segs: string[] = [];
  try { segs = new URL(url).pathname.split("/").filter(Boolean); } catch { return false; }
  const slug = (/^[a-z]{2}$/.test(segs[0] ?? "") ? segs[1] : segs[0]) ?? "";
  const words = companyName.toLowerCase().replace(/\b(inc|ltd|llc|gmbh|ag|ab|as|oy|studios?|group|technologies)\b\.?/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const slugWords = slug.toLowerCase().split(/[^a-z0-9]+/);
  return words.length > 0 && words.every((w) => slugWords.includes(w));
}
const ORIGINAL_MARKS: Array<[RegExp, string]> = [
  [/\/\s*PRNewswire\s*\/|\bPR Newswire\b/i, "prnewswire.com"],
  [/\(\s*BUSINESS WIRE\s*\)|\bBusiness Wire\b/, "businesswire.com"],
  [/\(?\s*GLOBE NEWSWIRE\s*\)?|\bGlobeNewswire\b/, "globenewswire.com"],
  [/\bACCESSWIRE\b|\bAccesswire\b/, "accesswire.com"],
  [/\/\s*EINPresswire\.com\s*\/|\bEIN Presswire\b/i, "einpresswire.com"],
  [/\(Reuters\)\s*[-–—]/, "reuters.com"],
];
const OUTLET_NAMES: Record<string, string> = {
  "techcrunch": "techcrunch.com", "business insider": "businessinsider.com", "insider": "businessinsider.com", "fortune": "fortune.com",
  "forbes": "forbes.com", "cnbc": "cnbc.com", "reuters": "reuters.com", "bloomberg": "bloomberg.com", "axios": "axios.com",
  "the verge": "theverge.com", "fast company": "fastcompany.com", "inc.": "inc.com", "inc": "inc.com", "venturebeat": "venturebeat.com",
  "wired": "wired.com", "the wall street journal": "wsj.com", "financial times": "ft.com", "pymnts": "pymnts.com", "pymnts.com": "pymnts.com",
  "geekwire": "geekwire.com", "siliconangle": "siliconangle.com", "fierce healthcare": "fiercehealthcare.com", "fierce biotech": "fiercebiotech.com",
};
const ORIGINAL_ON = /(?:originally (?:published|appeared|posted) (?:on|in|at|by)|read the original article on|this article first appeared (?:on|in))\s+\[?(?:the\s+)?([A-Za-z][\w .&'-]{1,40}?)\]?(?=\s*(?:\(|\.|,|\n|$))/im;

/** The allowed outlet a republished article names as its original, or null. */
export function syndicatedFrom(content: string | null | undefined): string | null {
  if (!content) return null;
  const head = content.slice(0, 4000);
  for (const [re, d] of ORIGINAL_MARKS) if (re.test(head)) return d;
  const m = content.match(ORIGINAL_ON);
  const name = m?.[1]?.trim().toLowerCase().replace(/^the\s+/, "");
  return name ? OUTLET_NAMES[name] ?? OUTLET_NAMES[`the ${name}`] ?? null : null;
}

/**
 * A Google redirect ("google.com/url?q=https://…") is the page it points to; one whose target
 * cannot be read (an encoded token — field review run 1, Avenda) stays as it is, and is refused.
 */
export function unwrapRedirect(url: string): string {
  try {
    const u = new URL(url);
    if (!/(^|\.)google\.[a-z.]+$/.test(u.hostname) || u.pathname !== "/url") return url;
    const target = u.searchParams.get("url") ?? u.searchParams.get("q") ?? "";
    return /^https?:\/\//.test(target) ? target : url;
  } catch { return url; }
}

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
/**
 * A directory or profile page, not an article (field review run 2: Docplanner's HQ came from
 * eu-startups.com/directory/docplanner) — never a source, even on an allowed outlet.
 */
const NOT_ARTICLE_PATH = /\/(?:directory|directories|company-directory|startup-directory|company-profile|profiles?|rankings?)(?:\/|$)|\/(?:companies|company|startups?|organi[sz]ations?)\/[^/]+\/?$/i;
export function isDirectoryPage(url: string): boolean {
  try { return NOT_ARTICLE_PATH.test(new URL(url.startsWith("http") ? url : `https://${url}`).pathname); } catch { return false; }
}

/**
 * A party to the event — the acquirer, a partner, an authority — announcing it on its own
 * official site (owner, 2026-11-03: Akamai on LayerX, Honeywell on SCADAfence, EDAP on
 * Avenda, esd.ny.gov on Kraken). The page is a release (a news / press / investor path or
 * host), and the site's name is a word of its headline, or the site is a government's.
 */
const RELEASE_PATH = /\/(news|newsroom|press|press-releases?|news-releases?|media|media-center|esd-media-center|releases?)(\/|-|$)/i;
export function isPartyRelease(url: string, headline: string | null | undefined): boolean {
  const host = hostOf(url);
  if (!host) return false;
  let path = "";
  try { path = new URL(url.startsWith("http") ? url : `https://${url}`).pathname; } catch { return false; }
  const releaseHost = /^(investors?|ir|news|press|media|newsroom)\./.test(host);
  if (!RELEASE_PATH.test(path) && !releaseHost) return false;
  if (/\.gov(\.[a-z]{2})?$|\.gov\.[a-z]{2}$|\.gc\.ca$|\.europa\.eu$/.test(host)) return true;
  const label = (reviewDomain(url) ?? host).split(".")[0];
  const words = new Set((headline ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
  return label.split("-").some((part, i) => (i === 0 || part.length >= 4) && part.length >= 3 && words.has(part));
}

export function roundSourceStanding(url: string, opts: { isCompanySite?: boolean; leadInvestor?: string | null; investors?: Array<string | null | undefined>; content?: string | null; headline?: string | null; companyName?: string | null } = {}): SourceStanding {
  const host = hostOf(url);
  if (!host) return { kind: "denied", why: "no_host" };
  if (opts.isCompanySite) return { kind: "allowed", tier: 1, lowConfidence: false, why: "company_site" };
  if (isDataPlatformUrl(url)) return { kind: "denied", why: "data_platform" };
  if (onList(host, DENIED_DOMAINS)) return { kind: "denied", why: "denied_domain" };
  if (onList(host, HINT_ONLY_DOMAINS)) return { kind: "denied", why: "hint_only" };
  if (isOwnNewsroom(url, opts.companyName)) return { kind: "allowed", tier: 1, lowConfidence: true, why: "own_newsroom" };
  if (onList(host, SYNDICATION_HOSTS) || SYNDICATION_PATHS.some(([d, re]) => onList(host, [d]) && re.test(new URL(url.startsWith("http") ? url : `https://${url}`).pathname))) {
    const original = syndicatedFrom(opts.content);
    const standing = original ? roundSourceStanding(`https://${original}/`) : null;
    return standing?.kind === "allowed" ? { ...standing, why: `republished_from:${original}` } : { kind: "denied", why: "republished_without_allowed_original" };
  }
  if (onList(host, TIER1_DOMAINS) || isRegionalWireHost(host)) return { kind: "allowed", tier: 1, lowConfidence: onList(host, LOW_CONFIDENCE_DOMAINS), why: "wire_or_register" };
  // A directory page of an allowed outlet is refused; of an unlisted one it stays unlisted (domain review).
  if (isDirectoryPage(url) && (onList(host, TIER2_DOMAINS) || onList(host, TIER3_DOMAINS) || onList(host, TIER4_DOMAINS) ||
    [opts.leadInvestor, ...(opts.investors ?? [])].some((inv) => isInvestorSite(url, inv)))) return { kind: "denied", why: "directory_page" };
  // The site of the round's lead or of any investor of the company (owner: investors' sites
  // are allowed — field review run 2: Blumberg Capital on Databand's acquisition).
  if ([opts.leadInvestor, ...(opts.investors ?? [])].some((inv) => isInvestorSite(url, inv))) return { kind: "allowed", tier: 1, lowConfidence: false, why: "investor_site" };
  if (onList(host, TIER2_DOMAINS)) return { kind: "allowed", tier: 2, lowConfidence: false, why: "tier2_press" };
  if (onList(host, TIER3_DOMAINS)) return { kind: "allowed", tier: 3, lowConfidence: false, why: "tier3_press" };
  if (onList(host, TIER4_DOMAINS)) return { kind: "allowed", tier: 4, lowConfidence: true, why: "tier4_press" };
  // Tier 1 for the event itself; the profile's fields take it as tier 2 (profileSourceAllowed).
  if (isPartyRelease(url, opts.headline)) return { kind: "allowed", tier: 1, lowConfidence: false, why: "party_release" };
  return { kind: "unlisted", domain: reviewDomain(url) ?? host };
}

/**
 * The sources the pilot's fields — HQ city/country, founded year, founding
 * country — may be written from (owner, 2026-11-02): the company's own site or
 * release, a register, or the press of tiers 1–3. The 10-company dry run of
 * 2026-11-02 took KETS's founding year from Tracxn, Soda's founding country
 * from SourceForge and Mentat's year from a Tracxn list of mood-tracker apps.
 */
export function profileSourceAllowed(s: { url: string; source_type?: string | null; content?: string | null; title?: string | null }, companyName?: string | null): boolean {
  if (s.source_type === "company_site" || s.source_type === "registry") return true;
  if (isDirectoryPage(s.url)) return false;
  if (s.source_type === "press_release") return true;
  const standing = roundSourceStanding(s.url, { content: s.content, headline: s.title, companyName });
  // A party's release counts as tier 2 for the profile (owner, 2026-11-03): still within 1–3.
  const tier = standing.kind === "allowed" && standing.why === "party_release" ? 2 : standing.kind === "allowed" ? standing.tier : 99;
  return tier <= 3;
}

/** Provenance confidence for a round value: lowered for EIN Presswire / tier 4 alone. */
export function roundSourceConfidence(base: number, standing: SourceStanding): number {
  return standing.kind === "allowed" && standing.lowConfidence ? Math.min(base, 60) : base;
}
