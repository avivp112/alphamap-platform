import { describe, it, expect } from "vitest";
import { SECTOR_DEFINITIONS, sectorGuidance } from "./sectorDefinitions";
import { SECTOR_TAXONOMY } from "../../src/lib/taxonomy";

describe("every sub-sector has a one-line definition (owner, 2026-11-10)", () => {
  const subs = Object.values(SECTOR_TAXONOMY).flat();
  it("none is missing, none is extra, none is empty", () => {
    expect(subs.filter((s) => !SECTOR_DEFINITIONS[s])).toEqual([]);
    expect(Object.keys(SECTOR_DEFINITIONS).filter((s) => !subs.includes(s))).toEqual([]);
    for (const [k, v] of Object.entries(SECTOR_DEFINITIONS)) expect(v.length, k).toBeGreaterThan(20);
  });
  it("the confusable pairs say how they differ", () => {
    expect(SECTOR_DEFINITIONS["Generative AI"]).toMatch(/LLMs/);
    expect(SECTOR_DEFINITIONS["LLMs"]).toMatch(/Generative AI/);
    expect(SECTOR_DEFINITIONS["Security Testing"]).toMatch(/Vulnerability Management/);
    expect(SECTOR_DEFINITIONS["Vulnerability Management"]).toMatch(/Security Testing/);
    expect(SECTOR_DEFINITIONS["Healthcare IT & Administration"]).toMatch(/Healthcare SaaS/);
    expect(SECTOR_DEFINITIONS["Travel Tech"]).toMatch(/Travel & Hospitality/);
    expect(SECTOR_DEFINITIONS["Sales Tech"]).toMatch(/CRM/);
  });
  it("the guidance carries the definitions and the rules, limited to the sub-sectors the database knows", () => {
    const g = sectorGuidance(["Voice & Speech AI", "FoodTech"]);
    expect(g).toContain("- Voice & Speech AI:");
    expect(g).not.toContain("- Payments:");
    expect(g).toMatch(/customer's industry/i);
    expect(g).toMatch(/Vertical SaaS/);
  });
});
