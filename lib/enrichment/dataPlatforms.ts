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
 */

export interface DataPlatform {
  name: string;
  aliases?: string[];
  caseSensitive?: boolean;
}

export const DATA_PLATFORMS: DataPlatform[] = [
  { name: "Crunchbase" },
  { name: "PitchBook" },
  { name: "Tracxn" },
  { name: "CB Insights", aliases: ["CBInsights", "CB Insight"] },
  { name: "Dealroom", aliases: ["dealroom.co"] },
  { name: "Harmonic", aliases: ["harmonic.ai"], caseSensitive: true },
  { name: "Specter", aliases: ["tryspecter.com"], caseSensitive: true },
  { name: "Dealigence" },
  { name: "Owler" },
  { name: "Growjo" },
  { name: "ZoomInfo" },
  { name: "RocketReach" },
  { name: "Seedtable" },
  { name: "Sacra" },
  { name: "Mattermark" },
  { name: "Preqin" },
  { name: "PrivCo" },
  { name: "Grata" },
  { name: "SourceScrub" },
  { name: "Craft.co" },
  { name: "GetLatka", aliases: ["Latka"] },
  { name: "Wellfound" },
  { name: "AngelList", aliases: ["Angel List"] },
  { name: "Startup Nation Finder", aliases: ["SNC Finder"] },
  { name: "IVC Research", aliases: ["IVC Data"] },
  { name: "Golden.com" },
  { name: "Apollo.io" },
  { name: "Lusha" },
  { name: "LeadIQ" },
  { name: "SignalHire" },
  { name: "Clay.com" },
];
