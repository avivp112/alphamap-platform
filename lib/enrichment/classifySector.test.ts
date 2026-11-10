import { describe, it, expect } from "vitest";
import { buildSectorRequest, parseSectorChoice } from "./classifySector";
import { SECTOR_TAXONOMY, PARENT_BY_SUB_SECTOR } from "../../src/lib/taxonomy";

const tax = { parentNames: Object.keys(SECTOR_TAXONOMY).filter((p) => p !== "Uncategorized"), subNames: Object.values(SECTOR_TAXONOMY).flat(), parentOf: PARENT_BY_SUB_SECTOR };

describe("the sector is classified from the verified description alone (owner, 2026-11-10)", () => {
  it("the request holds the description, the definitions and the rules — and no search results", () => {
    const r = buildSectorRequest("Verbit", "Verbit sells a voice AI platform that combines speech recognition with human transcribers.", tax);
    const text = r.messages[0].content;
    expect(text).toContain("Verbit sells a voice AI platform");
    expect(text).toContain("- Voice & Speech AI:");
    expect(text).toMatch(/customer's industry/i);
    expect(r.tools[0].input_schema.properties.sector_name.enum).toContain("Automotive & Mobility");
  });
  it("a sub-sector of another sector is dropped; an unknown name is dropped; at most three other fields", () => {
    expect(parseSectorChoice({ sector_name: "Cybersecurity", sub_sector_name: "Payments", sub_sector_names: ["Email Security", "Nonsense", "Vertical SaaS", "Cloud Security", "Zero Trust"] }, tax))
      .toEqual({ sector_name: "Cybersecurity", sub_sector_name: undefined, sub_sector_names: ["Email Security", "Vertical SaaS", "Cloud Security"] });
    expect(parseSectorChoice({ sector_name: "Made Up" }, tax)).toBeNull();
    expect(parseSectorChoice(undefined, tax)).toBeNull();
  });
  it("the main sub-sector is not repeated among the other fields", () => {
    expect(parseSectorChoice({ sector_name: "Real Estate", sub_sector_name: "PropTech", sub_sector_names: ["PropTech", "Vertical SaaS"] }, tax)?.sub_sector_names).toEqual(["Vertical SaaS"]);
  });
});

import { readFileSync } from "node:fs";
describe("the examples the reviews marked wrong (eval/sector_examples.json)", () => {
  const ex = JSON.parse(readFileSync("eval/sector_examples.json", "utf8")) as Array<{ company: string; description: string; expect: string }>;
  it("each expected category exists in the taxonomy and its definition fits the description's field", () => {
    for (const e of ex) {
      const [parent, sub] = e.expect.split(" › ");
      expect(SECTOR_TAXONOMY[parent], `${e.company}: ${parent}`).toBeDefined();
      expect(SECTOR_TAXONOMY[parent], `${e.company}: ${sub}`).toContain(sub);
      expect(e.description.length).toBeGreaterThan(80);
    }
  });
  it("covers the companies of reviews 7 and 8 the owner named", () => {
    const names = ex.map((e) => e.company);
    for (const n of ["Verbit", "SuperMeat", "Upstream Security", "Dazz", "Headway", "Pentera", "TurboTenant", "Anzu.io", "Elenium Automation"]) expect(names).toContain(n);
  });
});
