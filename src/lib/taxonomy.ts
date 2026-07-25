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
