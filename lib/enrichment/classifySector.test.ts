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
  it("a sub-sector of another sector than the one named wins: the sector becomes its parent (Elenium); an unknown name is dropped; at most three other fields", () => {
    expect(parseSectorChoice({ sector_name: "Enterprise Software", sub_sector_name: "Travel Tech" }, tax)).toMatchObject({ sector_name: "Consumer & Media", sub_sector_name: "Travel Tech" });
    expect(parseSectorChoice({ sector_name: "Cybersecurity", sub_sector_name: "Email Security", sub_sector_names: ["Nonsense", "Vertical SaaS", "Cloud Security", "Zero Trust", "Data Security"] }, tax))
      .toEqual({ sector_name: "Cybersecurity", sub_sector_name: "Email Security", sub_sector_names: ["Vertical SaaS", "Cloud Security", "Zero Trust"] });
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

import { definitionSupports } from "./sectorDefinitions";
import { sectorProblem } from "./classifySector";
describe("an answer the description is not about, or a General while a specific one fits (review 9, 2026-11-10)", () => {
  const ex = JSON.parse(readFileSync("eval/sector_examples.json", "utf8")) as Array<{ company: string; description: string; expect: string; was?: string }>;
  it("every expected sub-sector is supported by its description (the check never rejects a right answer)", () => {
    for (const e of ex) expect(definitionSupports(e.expect.split(" › ")[1], e.description), `${e.company}: ${e.expect}`).toBe(true);
  });
  it("the wrong answers the reviews marked are mostly caught by the check: a rocket maker is not PropTech", () => {
    const agnikul = ex.find((e) => e.company === "Agnikul Cosmos")!.description;
    expect(definitionSupports("PropTech", agnikul)).toBe(false);
    expect(definitionSupports("Space Tech", agnikul)).toBe(true);
    const verbit = ex.find((e) => e.company === "Verbit")!.description;
    expect(definitionSupports("Computer Vision", verbit)).toBe(false);
  });
  it("sectorProblem: unsupported and General are problems; a specific supported answer is none", () => {
    const d = ex.find((e) => e.company === "Malt")!.description;
    expect(sectorProblem({ sector_name: "Real Estate", sub_sector_name: "PropTech", sub_sector_names: [] }, d)).toMatch(/nothing in common/);
    expect(sectorProblem({ sector_name: "SaaS & Dev Tools", sub_sector_name: "SaaS / General", sub_sector_names: [] }, d)).toMatch(/last resort/);
    expect(sectorProblem({ sector_name: "Enterprise Software", sub_sector_name: "HR Tech", sub_sector_names: [] }, d)).toBeNull();
    expect(sectorProblem(null, d)).toMatch(/no usable/);
  });
  it("the retry text reaches the prompt", () => {
    const r = buildSectorRequest("Malt", "Malt manages freelancers.", tax, "SaaS / General: last resort.");
    expect(r.messages[0].content).toMatch(/PREVIOUS ANSWER WAS REJECTED: SaaS \/ General: last resort\./);
  });
});

import { classifyWithRetry } from "./classifySector";
describe("the classification as the pipeline runs it (one function for the collection, the check and the rejudge)", () => {
  const malt = "Malt is a freelance management system that centralizes the independent talent lifecycle, including contracts and payment.";
  const choice = (sector: string, sub?: string) => ({ sector_name: sector, sub_sector_name: sub, sub_sector_names: [] as string[] });
  it("a General gets a second look and a specific answer wins", async () => {
    const seen: Array<string | undefined> = [];
    const r = await classifyWithRetry(async (f) => { seen.push(f); return f ? choice("Enterprise Software", "HR Tech") : choice("SaaS & Dev Tools", "SaaS / General"); }, malt);
    expect(r).toMatchObject({ sub_sector_name: "HR Tech" });
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toMatch(/last resort/);
  });
  it("a General that stays General is accepted; an unsupported answer that stays unsupported keeps the sector, without the sub-sector", async () => {
    expect(await classifyWithRetry(async () => choice("SaaS & Dev Tools", "SaaS / General"), malt)).toMatchObject({ sub_sector_name: "SaaS / General" });
    const stuck = await classifyWithRetry(async () => choice("Real Estate", "PropTech"), malt);
    expect(stuck).toMatchObject({ sector_name: "Real Estate", sub_sector_name: undefined });
  });
  it("a classification always ends with a value after the retries (Motorway, Pet Circle, Versabox)", async () => {
    let n = 0;
    const r = await classifyWithRetry(async (f) => { n++; return f ? choice("Real Estate", "PropTech") : choice("Real Estate", "PropTech"); }, malt);
    expect(r).not.toBeNull();
    expect(n).toBe(3);
  });
  it("the last look asks for the closest sector with its General", async () => {
    const seen: Array<string | undefined> = [];
    await classifyWithRetry(async (f) => { seen.push(f); return choice("Real Estate", "PropTech"); }, malt);
    expect(seen[2]).toMatch(/General/);
  });
  it("a good first answer is one call", async () => {
    let n = 0;
    await classifyWithRetry(async () => { n++; return choice("Enterprise Software", "HR Tech"); }, malt);
    expect(n).toBe(1);
  });
});

describe("Vertical SaaS is a tag, not the main sub-sector (owner, 2026-11-12: SafetyCulture)", () => {
  const sc = "SafetyCulture is an operations system for the frontline that connects people, workflows and operational data, covering quality management, asset maintenance, training and compliance.";
  const choice = (sector: string, sub?: string, others: string[] = []) => ({ sector_name: sector, sub_sector_name: sub, sub_sector_names: others });
  it("as the main answer it is a problem with the reason", () => {
    expect(sectorProblem(choice("SaaS & Dev Tools", "Vertical SaaS"), sc)).toMatch(/is a tag, not the main sub-sector/);
    expect(sectorProblem(choice("Industrial & Manufacturing", "Industrial Automation", ["Vertical SaaS"]), "Industrial automation and production lines for manufacturers.")).toBeNull();
  });
  it("a second look that names the industry wins; one that stays Vertical SaaS keeps it as a tag only", async () => {
    const fixed = await classifyWithRetry(async (f) => (f ? choice("Enterprise Software", "Legal & Compliance Software", ["Vertical SaaS"]) : choice("SaaS & Dev Tools", "Vertical SaaS")), sc);
    expect(fixed).toMatchObject({ sector_name: "Enterprise Software", sub_sector_name: "Legal & Compliance Software" });
    const stuck = await classifyWithRetry(async () => choice("SaaS & Dev Tools", "Vertical SaaS"), sc);
    expect(stuck).toMatchObject({ sector_name: "SaaS & Dev Tools", sub_sector_name: undefined });
    expect(stuck?.sub_sector_names).toContain("Vertical SaaS");
  });
});
