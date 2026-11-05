import { describe, it, expect } from "vitest";
import { sheetValues, sheetText, applyVerdict } from "./originalsSheet";
import { newScoreboard, scoreCompany, type GoldenCompany } from "./score";

const v = <T,>(value: T, extra = {}) => ({ value, confidence: "verified" as const, source_url: "https://x.test/a", ...extra });
const acme: GoldenCompany = {
  id: "acme", name: "Acme", reviewed_fields: ["rounds", "competitors", "patents"],
  city: v("Paris"), country: v("France"), founded_year: v(2015), founding_country: v("France", { notes: "Acme was founded in Lyon, France" }),
  founders: [{ name: "Ann One", title: "CEO", confidence: "verified", source_url: "https://x.test/f" }, { name: "Bob Two", confidence: "verified" }],
};
const bolt: GoldenCompany = { id: "bolt", name: "Bolt", city: { ...v("Rome"), not_declared: true }, country: v("Italy"), founders: [] };
const imported: GoldenCompany = { id: "c", name: "Imported", judged_only: true, city: v("Oslo") };

describe("check sheet for the originals", () => {
  it("numbers every stated value v1.N, skipping undeclared, unknown and judged-only entries", () => {
    const s = sheetValues([acme, bolt, imported]);
    expect(s.map((x) => [x.id, x.company, x.field])).toEqual([
      ["v1.1", "Acme", "city"], ["v1.2", "Acme", "country"], ["v1.3", "Acme", "founded_year"], ["v1.4", "Acme", "founding_country"],
      ["v1.5", "Acme", "founder"], ["v1.6", "Acme", "founder"], ["v1.7", "Bolt", "country"],
    ]);
  });
  it("carries source and quote (the golden note when the page gave none, a fetched quote first)", () => {
    const s = sheetValues([acme], { "v1.1": "Acme, Paris-based, builds engines." });
    expect(s[0]).toMatchObject({ source_url: "https://x.test/a", quote: "Acme, Paris-based, builds engines." });
    expect(s[3].quote).toBe("Acme was founded in Lyon, France");
    expect(sheetText(s)).toContain('quote:  "Acme, Paris-based, builds engines."');
  });
  it("only the wrong numbers are marked: the rest are correct and their fields become reviewed", () => {
    const s = sheetValues([acme]);
    const r = applyVerdict([acme], s, ["v1.2", "v1.6"]);
    const a = r.companies[0];
    expect(r.wrongApplied).toBe(2);
    expect(a.country).toMatchObject({ confidence: "unknown" });
    expect(a.country!.notes).toContain("v1.2");
    expect(a.city!.confidence).toBe("verified");
    expect(a.founders!.map((p) => p.name)).toEqual(["Ann One"]);
    expect([...a.reviewed_fields!].sort()).toEqual(["city", "competitors", "country", "founded_year", "founders", "founding_country", "patents", "rounds"]);
  });
  it("v1.N=value keeps the right value; without a value it becomes unknown", () => {
    const s = sheetValues([acme]);
    const a = applyVerdict([acme], s, ["v1.1=London", "v1.3=2016", "v1.2", "v1.5=Anna One"]).companies[0];
    expect(a.city).toMatchObject({ value: "London", confidence: "verified" });
    expect(a.city!.notes).toContain("Paris");
    expect(a.founded_year).toMatchObject({ value: 2016, confidence: "verified" });
    expect(a.country!.confidence).toBe("unknown");
    expect(a.founders!.map((p) => p.name)).toEqual(["Anna One", "Bob Two"]);
    expect(applyVerdict([acme], s, ["v1.99=x"]).unknown).toEqual(["v1.99"]);
  });
  it("an unknown number is reported and nothing is guessed", () => {
    expect(applyVerdict([acme], sheetValues([acme]), ["v1.99"]).unknown).toEqual(["v1.99"]);
  });
  it("before the import a sheet field is not scored; after it, it is", () => {
    const out = { city: "Berlin", country: null, founded_year: null, founders: [], rounds: [], employee_range: null, arr_usd: null } as never;
    const b1 = newScoreboard();
    expect(scoreCompany(b1, acme, out).city).toBe("excluded");
    const after = applyVerdict([acme], sheetValues([acme]), []).companies[0];
    const b2 = newScoreboard();
    expect(scoreCompany(b2, after, out).city).toBe("wrong");
  });
});
