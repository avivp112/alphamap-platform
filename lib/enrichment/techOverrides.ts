/**
 * Owner decisions that a company is not technology (round 10, batch 5): a hard list checked in code before the model, never in a prompt.
 * Matching is on the company's name, folded to letters and digits.
 */
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");

export const TECH_OVERRIDES: ReadonlyArray<{ name: string; reason: string }> = [
  "noo.ma", "Plott", "Moft", "Routing", "ALUS Canada", "MindUP", "Grind", "Studio Feixen",
].map((name) => ({ name, reason: "the owner decided: not a technology company (batch 5, round 10)" }));

const BY_NAME = new Map(TECH_OVERRIDES.map((o) => [fold(o.name), o]));

/** The owner's decision for this company, or null. */
export function techOverride(companyName: string): { name: string; reason: string } | null {
  return BY_NAME.get(fold(companyName)) ?? null;
}
