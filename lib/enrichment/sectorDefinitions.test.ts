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

describe("the definitions tell a rocket maker from a factory (review 9 rejudge, 2026-11-10)", () => {
  it("Space Tech and Advanced Manufacturing say where the line is", () => {
    expect(SECTOR_DEFINITIONS["Space Tech"]).toMatch(/rockets/);
    expect(SECTOR_DEFINITIONS["Advanced Manufacturing"]).toMatch(/never by how it is made/);
    expect(SECTOR_DEFINITIONS["Biotech / Genomics"]).toMatch(/biological manufacturing/);
  });
});

describe("the sector is the market, technology is a tag (owner, 2026-11-12)", () => {
  it("the rules and the AI definitions say so; Fintech Infrastructure is for banks' builders", () => {
    expect(sectorGuidance()).toMatch(/MARKET the company serves/);
    expect(SECTOR_DEFINITIONS["AI Agents"]).toMatch(/belongs to that industry/);
    expect(SECTOR_DEFINITIONS["Fintech Infrastructure"]).toMatch(/banking as a service/);
    expect(SECTOR_DEFINITIONS["ERP / Finance"]).toMatch(/FP&A/);
    expect(SECTOR_DEFINITIONS["Payments"]).toMatch(/terminals/);
  });
});
