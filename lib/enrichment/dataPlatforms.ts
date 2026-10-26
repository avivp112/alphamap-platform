/**
 * lib/enrichment/dataPlatforms.ts — THE list of data / company-intelligence
 * platforms (owner, 2026-10-25). Most are AlphaMap's own competitors, so a
 * company's text never names them (lib/enrichment/narrative.ts) — they are
 * where a fact was read, never what the company does.
 *
 * To add or remove a platform, edit this list only: enrichment v2, the
 * check worker, the site and scripts/clean_narratives.ts all read it.
 *
 *   name           as the platform writes itself
 *   aliases        other spellings / domains
 *   caseSensitive  for a name that is also an ordinary word: matched only
 *                  as written ("Harmonic", not "harmonic analysis")
 *   domains        its sites, subdomains included (app.dealroom.co): a page
 *                  there is a data platform's page, never a primary source
 *                  (lib/enrichment/sources.ts)
 */

export interface DataPlatform {
  name: string;
  aliases?: string[];
  caseSensitive?: boolean;
  domains?: string[];
}

export const DATA_PLATFORMS: DataPlatform[] = [
  { name: "Crunchbase", domains: ["crunchbase.com"] },
  { name: "PitchBook", domains: ["pitchbook.com"] },
  { name: "Tracxn", domains: ["tracxn.com"] },
  { name: "CB Insights", aliases: ["CBInsights", "CB Insight"], domains: ["cbinsights.com"] },
  { name: "Dealroom", aliases: ["dealroom.co"], domains: ["dealroom.co"] },
  { name: "Harmonic", aliases: ["harmonic.ai"], caseSensitive: true, domains: ["harmonic.ai"] },
  { name: "Specter", aliases: ["tryspecter.com"], caseSensitive: true, domains: ["tryspecter.com"] },
  { name: "Dealigence", domains: ["dealigence.com"] },
  { name: "Owler", domains: ["owler.com"] },
  { name: "Growjo", domains: ["growjo.com"] },
  { name: "ZoomInfo", domains: ["zoominfo.com"] },
  { name: "RocketReach", domains: ["rocketreach.co"] },
  { name: "Seedtable", domains: ["seedtable.com"] },
  { name: "Sacra", domains: ["sacra.com"] },
  { name: "Mattermark", domains: ["mattermark.com"] },
  { name: "Preqin", domains: ["preqin.com"] },
  { name: "PrivCo", domains: ["privco.com"] },
  { name: "Grata", domains: ["grata.com"] },
  { name: "SourceScrub", domains: ["sourcescrub.com"] },
  { name: "Craft.co", domains: ["craft.co"] },
  { name: "GetLatka", aliases: ["Latka"], domains: ["getlatka.com"] },
  { name: "Wellfound", domains: ["wellfound.com"] },
  { name: "AngelList", aliases: ["Angel List"], domains: ["angel.co", "angellist.com"] },
  { name: "Startup Nation Finder", aliases: ["SNC Finder"], domains: ["finder.startupnationcentral.org"] },
  { name: "IVC Research", aliases: ["IVC Data"], domains: ["ivc-online.com"] },
  { name: "Golden.com", domains: ["golden.com"] },
  { name: "Apollo.io", domains: ["apollo.io"] },
  { name: "Lusha", domains: ["lusha.com"] },
  { name: "LeadIQ", domains: ["leadiq.com"] },
  { name: "SignalHire", domains: ["signalhire.com"] },
  { name: "Clay.com", domains: ["clay.com"] },
];

/**
 * Sites that list companies "like" a company — review and comparison
 * directories. Not data platforms (a company's text may name G2), but a
 * "similar companies" / "alternatives" page there is a listing, never a
 * source that a company competes with another (competitorEvidence.ts).
 */
export const LISTING_SITES = [
  "g2.com", "capterra.com", "getapp.com", "softwareadvice.com", "trustradius.com", "alternativeto.net", "saasworthy.com",
  "slashdot.org", "sourceforge.net", "crozdesk.com", "similarweb.com", "comparably.com", "sitelike.org", "siteslike.com",
  "producthunt.com", "stackshare.io", "featuredcustomers.com", "peerspot.com", "softwaresuggest.com",
];

const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");
const onDomain = (host: string, domain: string) => bare(host) === domain.toLowerCase() || bare(host).endsWith(`.${domain.toLowerCase()}`);
const hostOf = (url: string): string | null => {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname; } catch { return null; }
};

/** A page on a data platform's site — subdomains included (app.dealroom.co, flanders.dealroom.co). */
export function isDataPlatformUrl(url: string): boolean {
  const host = hostOf(url);
  return !!host && DATA_PLATFORMS.some((p) => (p.domains ?? []).some((d) => onDomain(host, d)));
}

/** A page on a review / comparison directory. */
export function isListingSiteUrl(url: string): boolean {
  const host = hostOf(url);
  return !!host && LISTING_SITES.some((d) => onDomain(host, d));
}
