/**
 * Owner decisions that a company is not technology (round 10, batch 5): a hard list checked in code before the model, never in a prompt.
 * Matching is on the company's name, folded to letters and digits.
 */
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");

export const TECH_OVERRIDES: ReadonlyArray<{ name: string; reason: string }> = [
  "noo.ma", "Plott", "Mototech", "Spin Studio", "zpharm", "Moft", "Routing", "ALUS Canada", "MindUP", "Grind", "Studio Feixen",
].map((name) => ({ name, reason: "the owner decided: not a technology company (batch 5, round 10)" })).concat([
  { name: "Freedom Quit Smoking Laser", reason: "the owner decided: not a technology company — a smoking-cessation laser clinic (batch 8, 2026-11-19)" },
  { name: "3D Printing Systems", reason: "the owner decided: not a technology company — a reseller of 3D printers and scanners (batch 8, 2026-11-19)" },
]);

/** Decided as technology by the owner (batch 6): never rejected by the early check, the stored decisions or the profile call. */
// Batch 8 (2026-11-19): Screaming Frog (its product is the SEO Spider) and Lendbox (a peer-to-peer lending platform).
// Triskell Interactive (owner, 2026-11-19): a game developer — technology, with Gaming as a tag, like Isar Interactive.
export const TECH_ACCEPTED: readonly string[] = ["Datahut", "Holu", "Screaming Frog", "Lendbox", "Triskell Interactive"];
const ACCEPTED = new Set(TECH_ACCEPTED.map(fold));
export const techAccepted = (companyName: string): boolean => ACCEPTED.has(fold(companyName));

const BY_NAME = new Map(TECH_OVERRIDES.map((o) => [fold(o.name), o]));

/** The owner's decision for this company, or null. */
export function techOverride(companyName: string): { name: string; reason: string } | null {
  return BY_NAME.get(fold(companyName)) ?? null;
}

/** Sector decisions the owner locked (round 10): applied after the classification, whatever the model says. */
export const SECTOR_DECISIONS: ReadonlyArray<{ name: string; sector: string; sub_sector: string }> = [
  { name: "Dietly", sector: "E-commerce & Retail", sub_sector: "Marketplaces" },
  // Batch 6 (owner, round 10): an education product, a mortgage-broker finance tool, an indoor-location device maker.
  { name: "Kiwify", sector: "Consumer & Media", sub_sector: "EdTech" },
  { name: "Sherlok", sector: "Fintech", sub_sector: "Lending" },
  { name: "Estimote", sector: "DeepTech", sub_sector: "IoT & Connectivity" },
];
export function sectorDecision(companyName: string): { sector: string; sub_sector: string } | null {
  const d = SECTOR_DECISIONS.find((x) => fold(x.name) === fold(companyName));
  return d ? { sector: d.sector, sub_sector: d.sub_sector } : null;
}

/** Companies the owner decided are listed on an exchange (batch 8, 2026-11-19): turned away as public, whatever the sources say. */
export const PUBLIC_OVERRIDES: ReadonlyArray<{ name: string; reason: string }> = [
  { name: "valu", reason: "EGX-listed since June 2025" },
  { name: "Xintela", reason: "listed (Nasdaq First North Stockholm)" },
];
export const publicOverride = (companyName: string): { name: string; reason: string } | null => PUBLIC_OVERRIDES.find((o) => fold(o.name) === fold(companyName)) ?? null;
