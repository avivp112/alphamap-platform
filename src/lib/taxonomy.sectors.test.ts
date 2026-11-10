import { describe, it, expect } from "vitest";
import { SECTOR_TAXONOMY, PARENT_BY_SUB_SECTOR } from "./taxonomy";
import en from "../../locales/en.json";
import { readFileSync, readdirSync } from "node:fs";

describe("sectors added in review 7 (2026-11-09)", () => {
  it("PropTech, AdTech, AgTech, Security Testing and Industrial & Manufacturing exist, each under one parent", () => {
    expect(PARENT_BY_SUB_SECTOR["PropTech"]).toBe("Real Estate");
    expect(PARENT_BY_SUB_SECTOR["AdTech"]).toBe("Consumer & Media");
        expect(PARENT_BY_SUB_SECTOR["Security Testing"]).toBe("Cybersecurity");
    expect(SECTOR_TAXONOMY["Industrial & Manufacturing"]).toContain("Industrial / General");
  });
  it("review 8 (2026-11-10): the sectors the owner asked for", () => {
    expect(PARENT_BY_SUB_SECTOR["Voice & Speech AI"]).toBe("AI & ML");
    expect(PARENT_BY_SUB_SECTOR["FoodTech"]).toBe("Food & Agriculture");
    expect(PARENT_BY_SUB_SECTOR["AgTech"]).toBe("Food & Agriculture");
    expect(PARENT_BY_SUB_SECTOR["Vehicle Security"]).toBe("Automotive & Mobility");
    expect(PARENT_BY_SUB_SECTOR["Productivity & Collaboration"]).toBe("Enterprise Software");
    expect(PARENT_BY_SUB_SECTOR["Vulnerability Management"]).toBe("Cybersecurity");
    expect(PARENT_BY_SUB_SECTOR["RegTech"]).toBe("Fintech");
    expect(PARENT_BY_SUB_SECTOR["Developer Tools"]).toBe("SaaS & Dev Tools");
  });
  it("sub-sector names are unique across the tree and none is a parent's name", () => {
    const subs = Object.values(SECTOR_TAXONOMY).flat();
    expect(new Set(subs).size).toBe(subs.length);
    for (const s of subs) expect(Object.keys(SECTOR_TAXONOMY)).not.toContain(s);
  });
  it("the migration adds the same names", () => {
    const f = readdirSync("supabase/migrations").find((n) => n.includes("sector_taxonomy_additions"))!;
    const sql = readFileSync(`supabase/migrations/${f}`, "utf8");
    for (const n of ["PropTech", "AdTech", "AgTech", "Security Testing", "Industrial / General", "Industrial & Manufacturing", "Real Estate", "Sales Tech", "Travel Tech"]) expect(sql).toContain(`'${n}'`);
  });
  it("the English labels exist", () => {
    const labels = JSON.stringify(en);
    for (const n of ["PropTech", "AdTech", "AgTech", "Security Testing", "Industrial & Manufacturing"]) expect(labels).toContain(`"${n}"`);
  });
});
