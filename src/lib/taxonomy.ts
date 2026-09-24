// =============================================================================
// Taxonomy display layer
//
// Funding stages ("Series A") and sectors ("Fintech") are DATA values: they
// come back from Supabase, are used as object keys for badge styling
// (ROUND_STYLE, STAGE_STYLES), and are compared directly in filter predicates.
// Translating them at the source would break every one of those lookups.
//
// So the canonical English string stays the value everywhere, and only the
// moment it is *rendered* does it pass through here to become a localised
// label. Anything without a mapping falls through unchanged, which keeps
// unknown/free-text values from the database safe.
// =============================================================================

import type { TFunction } from "i18next";
import type { RoundType } from "./supabase";

// ── Sector taxonomy (canonical data) ─────────────────────────────────────────
// Two-tier hierarchy: parent -> subcategories. Moved here from Startups.tsx
// (2026-09) so Onboarding.tsx's mandate step can share the exact same tree
// instead of declaring its own copy — this codebase already has three
// independent, hand-duplicated sector classifiers (Startups.tsx's own
// keyword map, GlobalTechHubMap's SECTOR_KW, and the SQL-side
// classify_sector_parent()); a fourth copy for onboarding is exactly how
// that number becomes four.
export const SECTOR_TAXONOMY: Record<string, string[]> = {
  "AI & ML":               ["AI / General", "LLMs", "Generative AI", "Computer Vision", "NLP / Speech", "AI Agents", "MLOps", "AI Infrastructure"],
  "Fintech":               ["Fintech / General", "Payments", "Banking / Neobanking", "Insurance / Insurtech", "Lending", "Crypto / Web3", "WealthTech", "RegTech"],
  "Cybersecurity":         ["Cybersecurity / General", "Identity & Access", "Endpoint Security", "Cloud Security", "Threat Intelligence", "Zero Trust", "Data Security"],
  "SaaS & Dev Tools":      ["SaaS / General", "Developer Tools", "DevOps / CI-CD", "API Platforms", "Low-Code / No-Code", "Data Infrastructure"],
  "E-commerce & Retail":   ["E-commerce / General", "D2C", "Marketplaces", "Logistics / Supply Chain", "Retail Tech"],
  "Health & Life Sciences": ["Digital Health", "MedTech", "Biotech / Genomics", "Mental Health", "Healthcare SaaS"],
  "Climate & Energy":      ["CleanTech", "EnergyTech", "Carbon Markets", "Sustainability"],
  "Enterprise Software":   ["Enterprise / General", "CRM", "HR Tech", "ERP / Finance", "Analytics / BI"],
  "Consumer & Media":      ["Consumer / General", "Social Media", "Gaming", "EdTech", "Travel & Hospitality", "Media / Content"],
  "DeepTech":              ["DeepTech / General", "Quantum Computing", "Robotics", "Space Tech", "Semiconductors"],
  "Uncategorized":         [],
};

/** Which parent a given sub-sector name belongs to. */
export const PARENT_BY_SUB_SECTOR: Record<string, string> = Object.fromEntries(
  Object.entries(SECTOR_TAXONOMY).flatMap(([parent, subs]) => subs.map((sub) => [sub, parent])),
);

// ── Funding-stage buckets (canonical data) ───────────────────────────────────
// Moved here alongside SECTOR_TAXONOMY for the same reason: Onboarding's
// stage picker and the Startups.tsx sidebar's StepSlider must agree on the
// exact same bucket values, since onboarding seeds the sidebar's filter
// state directly with one of these.
export const STAGE_STEPS = [
  { value: "all",       label: "All",        rounds: [] as RoundType[] },
  { value: "pre-seed",  label: "Pre-Seed",   rounds: ["Pre-Seed", "Convertible Note"] as RoundType[] },
  { value: "seed",      label: "Seed",       rounds: ["Seed", "Bridge"] as RoundType[] },
  { value: "series-a",  label: "Series A",   rounds: ["Series A"] as RoundType[] },
  { value: "series-b",  label: "Series B",   rounds: ["Series B"] as RoundType[] },
  { value: "growth",    label: "Growth/Late", rounds: ["Series C", "Series D", "Series E+", "Growth", "Acquired", "PE Buyout", "Secondary"] as RoundType[] },
] as const;
export type StageStep = (typeof STAGE_STEPS)[number]["value"];

/** Canonical English stage -> translation-key suffix. */
const STAGE_SLUGS: Record<string, string> = {
  "Pre-Seed": "preSeed",
  "Seed": "seed",
  "Series A": "seriesA",
  "Series B": "seriesB",
  "Series C": "seriesC",
  "Series D": "seriesD",
  "Series E": "seriesE",
  "Series E+": "seriesEPlus",
  "Series F": "seriesF",
  "Series G": "seriesG",
  "Series H": "seriesH",
  "Series K": "seriesK",
  "Growth": "growth",
  "Growth/Late": "growthLate",
  "Bridge": "bridge",
  "Convertible Note": "convertibleNote",
  "Bootstrapped": "bootstrapped",
  "Grant": "grant",
  "Acquired": "acquired",
  "PE Buyout": "peBuyout",
  "Secondary": "secondary",
  "Tender": "tender",
  "Tender Offer": "tenderOffer",
  "Debt": "debt",
  "Other": "other",
  "All": "all",
};

/** Canonical English sector (parent or sub) -> translation-key suffix. */
const SECTOR_SLUGS: Record<string, string> = {
  // Parents
  "AI & ML": "aiMl",
  "Fintech": "fintech",
  "Cybersecurity": "cybersecurity",
  "SaaS & Dev Tools": "saasDevTools",
  "E-commerce & Retail": "ecommerceRetail",
  "Health & Life Sciences": "healthLifeSciences",
  "Climate & Energy": "climateEnergy",
  "Enterprise Software": "enterpriseSoftware",
  "Consumer & Media": "consumerMedia",
  "DeepTech": "deepTech",
  "Uncategorized": "uncategorized",
  // AI & ML
  "AI / General": "aiGeneral",
  "LLMs": "llms",
  "Generative AI": "generativeAi",
  "Computer Vision": "computerVision",
  "NLP / Speech": "nlpSpeech",
  "AI Agents": "aiAgents",
  "MLOps": "mlops",
  "AI Infrastructure": "aiInfrastructure",
  // Fintech
  "Fintech / General": "fintechGeneral",
  "Payments": "payments",
  "Banking / Neobanking": "banking",
  "Insurance / Insurtech": "insurance",
  "Lending": "lending",
  "Crypto / Web3": "cryptoWeb3",
  "WealthTech": "wealthTech",
  "RegTech": "regTech",
  // Cybersecurity
  "Cybersecurity / General": "cyberGeneral",
  "Identity & Access": "identityAccess",
  "Endpoint Security": "endpointSecurity",
  "Cloud Security": "cloudSecurity",
  "Threat Intelligence": "threatIntelligence",
  "Zero Trust": "zeroTrust",
  "Data Security": "dataSecurity",
  // SaaS & Dev Tools
  "SaaS / General": "saasGeneral",
  "Developer Tools": "developerTools",
  "DevOps / CI-CD": "devops",
  "API Platforms": "apiPlatforms",
  "Low-Code / No-Code": "lowCode",
  "Data Infrastructure": "dataInfrastructure",
  // E-commerce & Retail
  "E-commerce / General": "ecommerceGeneral",
  "D2C": "d2c",
  "Marketplaces": "marketplaces",
  "Logistics / Supply Chain": "logistics",
  "Retail Tech": "retailTech",
  // Health & Life Sciences
  "Digital Health": "digitalHealth",
  "MedTech": "medTech",
  "Biotech / Genomics": "biotech",
  "Mental Health": "mentalHealth",
  "Healthcare SaaS": "healthcareSaas",
  // Climate & Energy
  "CleanTech": "cleanTech",
  "EnergyTech": "energyTech",
  "Carbon Markets": "carbonMarkets",
  "Sustainability": "sustainability",
  // Enterprise Software
  "Enterprise / General": "enterpriseGeneral",
  "CRM": "crm",
  "HR Tech": "hrTech",
  "ERP / Finance": "erpFinance",
  "Analytics / BI": "analyticsBi",
  // Consumer & Media
  "Consumer / General": "consumerGeneral",
  "Social Media": "socialMedia",
  "Gaming": "gaming",
  "EdTech": "edTech",
  "Travel & Hospitality": "travelHospitality",
  "Media / Content": "mediaContent",
  // DeepTech
  "DeepTech / General": "deepTechGeneral",
  "Quantum Computing": "quantumComputing",
  "Robotics": "robotics",
  "Space Tech": "spaceTech",
  "Semiconductors": "semiconductors",
};

function lookup(table: Record<string, string>, ns: string, value: string | null | undefined, t: TFunction): string {
  if (!value) return "";
  const slug = table[value];
  // No mapping (free-text industry from the DB, a new stage we haven't seen)
  // — render it verbatim rather than showing a raw translation key.
  if (!slug) return value;
  return t(`taxonomy.${ns}.${slug}`, { defaultValue: value });
}

/** Localised label for a funding stage / round type. Falls back to the input. */
export function stageLabel(value: string | null | undefined, t: TFunction): string {
  return lookup(STAGE_SLUGS, "stage", value, t);
}

/** Localised label for a sector, parent or sub. Falls back to the input. */
export function sectorLabel(value: string | null | undefined, t: TFunction): string {
  return lookup(SECTOR_SLUGS, "sector", value, t);
}
