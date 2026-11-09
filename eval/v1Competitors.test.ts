import { describe, it, expect } from "vitest";
import { sampleV1Competitors, v1Precision, type V1Company } from "./v1Competitors";

const company = (i: number, n: number): V1Company => ({ id: `c${i}`, name: `Co${i}`, website: null, competitors: Array.from({ length: n }, (_, k) => ({ name: `X${i}-${k}`, how_it_competes: "same market" })) });
describe("the sample of v1's competitors", () => {
  const all = [...Array.from({ length: 60 }, (_, i) => company(i, 5)), { id: "none", name: "None", website: null, competitors: [] }, { id: "blank", name: "Blank", website: null, competitors: [{ name: " " }] }];
  it("draws 30 companies and at most 3 competitors of each, never one without competitors", () => {
    const rows = sampleV1Competitors(all, { size: 30, perCompany: 3, seed: 7 });
    expect(new Set(rows.map((r) => r.company_id)).size).toBe(30);
    expect(rows).toHaveLength(90);
    expect(rows.every((r) => r.company_id !== "none" && r.company_id !== "blank")).toBe(true);
  });
  it("is repeatable for a seed and different for another", () => {
    const a = sampleV1Competitors(all, { size: 30, perCompany: 3, seed: 7 }), b = sampleV1Competitors(all, { size: 30, perCompany: 3, seed: 7 }), c = sampleV1Competitors(all, { size: 30, perCompany: 3, seed: 8 });
    expect(a).toEqual(b);
    expect(a.map((r) => r.company_id)).not.toEqual(c.map((r) => r.company_id));
  });
  it("takes a company with fewer than 3 as it is", () => {
    expect(sampleV1Competitors([company(1, 2)], { size: 5, perCompany: 3, seed: 1 })).toHaveLength(2);
  });
  it("measures precision from the marks", () => {
    const rows = [{ mark: "y" }, { mark: "y" }, { mark: "n" }, { mark: "" }] as never[];
    expect(v1Precision(rows)).toEqual({ marked: 3, right: 2, wrong: 1, share: 2 / 3 });
  });
});
