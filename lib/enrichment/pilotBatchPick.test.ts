import { describe, it, expect } from "vitest";
import { pickBatch, isRich } from "./pilotBatchPick";
import { isThin, isIsraeli, type PilotCandidate } from "./pilotSample";

const mk = (i: number, country: string, rich: boolean, thin = false): PilotCandidate => ({
  id: `id${i}`, name: `Co${i}`, website: `https://co${i}.com`, description: thin ? null : rich ? "x".repeat(300) : "short description", city: thin ? null : "City", country, founded_year: thin ? null : 2019, founding_country: country,
  founders: rich ? [{}] : [], leadership: [],
});
const rows = [
  ...Array.from({ length: 6 }, (_, i) => mk(i, "Israel", i % 2 === 0)),
  ...Array.from({ length: 6 }, (_, i) => mk(10 + i, i % 2 ? "Germany" : "France", i % 2 === 0)),
  ...Array.from({ length: 6 }, (_, i) => mk(20 + i, "United States", i % 2 === 0, i === 5)),
  ...Array.from({ length: 4 }, (_, i) => mk(30 + i, "Canada", false, i === 0)),
];
describe("pickBatch", () => {
  it("five new companies: an Israeli, a European, an American, a thin one and a data-rich one", () => {
    const out = pickBatch(rows, { exclude: new Set(["id0", "id10"]), seed: 7 });
    expect(out).toHaveLength(5);
    expect(out.some(isIsraeli)).toBe(true);
    expect(out.some((c) => ["Germany", "France"].includes(c.country ?? ""))).toBe(true);
    expect(out.some((c) => c.country === "United States")).toBe(true);
    expect(out.some(isThin)).toBe(true);
    expect(out.some(isRich)).toBe(true);
    expect(out.map((c) => c.id)).not.toContain("id0");
    expect(new Set(out.map((c) => c.id)).size).toBe(5);
  });
  it("the same seed gives the same five", () => {
    expect(pickBatch(rows, { exclude: new Set(), seed: 3 }).map((c) => c.id)).toEqual(pickBatch(rows, { exclude: new Set(), seed: 3 }).map((c) => c.id));
  });
});

describe("a batch of 25 (owner, 2026-11-09)", () => {
  const many = [
    ...Array.from({ length: 30 }, (_, i) => mk(100 + i, "Israel", i % 2 === 0, i % 7 === 0)),
    ...Array.from({ length: 30 }, (_, i) => mk(200 + i, i % 2 ? "Germany" : "United Kingdom", i % 2 === 0, i % 7 === 0)),
    ...Array.from({ length: 30 }, (_, i) => mk(300 + i, "United States", i % 2 === 0, i % 7 === 0)),
    ...Array.from({ length: 20 }, (_, i) => mk(400 + i, "Canada", false, i % 3 === 0)),
  ];
  it("25 new companies with at least five Israeli, five European, five American, five thin and five data-rich", () => {
    const out = pickBatch(many, { size: 25, exclude: new Set(["id100"]), seed: 11 });
    expect(out).toHaveLength(25);
    expect(new Set(out.map((c) => c.id)).size).toBe(25);
    expect(out.map((c) => c.id)).not.toContain("id100");
    expect(out.filter(isIsraeli).length).toBeGreaterThanOrEqual(5);
    expect(out.filter((c) => ["Germany", "United Kingdom"].includes(c.country ?? "")).length).toBeGreaterThanOrEqual(5);
    expect(out.filter((c) => c.country === "United States").length).toBeGreaterThanOrEqual(5);
    expect(out.filter(isThin).length).toBeGreaterThanOrEqual(5);
    expect(out.filter(isRich).length).toBeGreaterThanOrEqual(5);
  });
});
