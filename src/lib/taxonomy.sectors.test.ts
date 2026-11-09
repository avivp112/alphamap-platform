import { describe, it, expect } from "vitest";
import { SECTOR_TAXONOMY, PARENT_BY_SUB_SECTOR } from "./taxonomy";
import en from "../../locales/en.json";
import { readFileSync, readdirSync } from "node:fs";

describe("sectors added in review 7 (2026-11-09)", () => {
  it("PropTech, AdTech, AgTech, Security Testing and Industrial & Manufacturing exist, each under one parent", () => {
    expect(PARENT_BY_SUB_SECTOR["PropTech"]).toBe("Real Estate");
    expect(PARENT_BY_SUB_SECTOR["AdTech"]).toBe("Consumer & Media");
    expect(PARENT_BY_SUB_SECTOR["AgTech"]).toBe("Industrial & Manufacturing");
    expect(PARENT_BY_SUB_SECTOR["Security Testing"]).toBe("Cybersecurity");
    expect(SECTOR_TAXONOMY["Industrial & Manufacturing"]).toContain("Industrial / General");
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
