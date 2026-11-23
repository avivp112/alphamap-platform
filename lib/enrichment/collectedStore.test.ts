import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { encode, decode, sameData, saveCollected, loadCollected } from "./collectedStore.ts";

const src = { source_id: "S1", source_type: "news", url: "https://x.test/a" };
const company = () => {
  const allSources = [src];
  const sourceById = new Map(allSources.map((s) => [s.source_id, s]));
  return {
    outcome: "collected", profile: { profile: { city: { value: "Paris", source_id: "S1", evidence_quote: "based in Paris" } } },
    allSources, sourceById, sourceTypeFor: (id?: string) => (id ? sourceById.get(id)?.source_type : undefined), sourceUrlFor: (id?: string) => (id ? sourceById.get(id)?.url ?? null : null),
    seenAt: new Date("2026-11-20T10:00:00Z"), tags: new Set(["a", "b"]), nested: new Map([["k", new Map([["x", [1, 2]]])]]), nothing: undefined, zero: 0, empty: "",
  };
};
describe("collectedStore", () => {
  it("Map, Set and Date go through JSON and come back", () => {
    const c = company(); const { sourceTypeFor: _a, sourceUrlFor: _b, ...plain } = c;
    expect(sameData(decode(JSON.parse(JSON.stringify(encode(plain)))), plain)).toBe(true);
  });
  it("a function or a class instance is refused, not dropped", () => {
    expect(() => encode({ f: () => 1 })).toThrow(/function/);
    expect(() => encode({ d: new (class Foo { x = 1 })() })).toThrow(/Foo/);
  });
  it("sameData tells a changed value", () => { expect(sameData(new Set([1]), new Set([2]))).toBe(false); expect(sameData({ a: [1] }, { a: [2] })).toBe(false); });
  it("save then load rebuilds the two source functions and finds the rounds unchanged", () => {
    const dir = mkdtempSync(`${tmpdir()}/collected-`); const rounds = [{ id: "r1", round_type: "Seed", amount_raised: 1e6, announcement_date: "2020-01-01" }];
    saveCollected(dir, "c1", company(), rounds);
    const r = loadCollected(dir, "c1", rounds);
    expect(r.ok).toBe(true);
    if (r.ok) { const c = r.collected as ReturnType<typeof company>; expect(c.sourceTypeFor("S1")).toBe("news"); expect(c.sourceUrlFor("S9")).toBeNull(); expect(c.tags).toBeInstanceOf(Set); expect(c.seenAt).toBeInstanceOf(Date); }
  });
  it("a changed round list is stale, an absent file is missing", () => {
    const dir = mkdtempSync(`${tmpdir()}/collected-`); const rounds = [{ id: "r1", round_type: "Seed", amount_raised: 1e6, announcement_date: "2020-01-01" }];
    saveCollected(dir, "c1", company(), rounds);
    const stale = loadCollected(dir, "c1", [...rounds, { id: "r2", round_type: "A", amount_raised: 2e6, announcement_date: null }]);
    expect(stale.ok === false && stale.reason).toBe("stale");
    const missing = loadCollected(dir, "zzz", rounds); expect(missing.ok === false && missing.reason).toBe("missing");
  });
});
