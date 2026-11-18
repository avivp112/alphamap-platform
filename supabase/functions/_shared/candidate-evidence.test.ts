import { describe, it, expect } from "vitest";
import { mergeCandidateEvidence, mergeOfficers, stripEmpty, DETAIL_STAMP } from "./candidate-evidence";

describe("mergeOfficers", () => {
  it("adds the new fields to the people already there, by name, and keeps their order", () => {
    const out = mergeOfficers(
      [{ name: "BLOGGS, Jo", relationships: ["director"] }, { name: "PATEL, Anya", relationships: ["director"] }],
      [{ name: "patel, anya", relationships: ["director"], nationality: "Indian", born: "1990-01" },
       { name: "BLOGGS, Jo", relationships: ["director"], appointed_on: "2026-07-20" }],
    );
    expect(out).toEqual([
      { name: "BLOGGS, Jo", relationships: ["director"], appointed_on: "2026-07-20" },
      { name: "PATEL, Anya", relationships: ["director"], nationality: "Indian", born: "1990-01" },
    ]);
  });
  it("never adds a person the ingest did not keep, and never overwrites a stored field", () => {
    const out = mergeOfficers([{ name: "A", relationships: ["director"] }], [{ name: "A", relationships: ["secretary"] }, { name: "B", relationships: ["director"] }]);
    expect(out).toEqual([{ name: "A", relationships: ["director"] }]);
  });
  it("leaves a candidate without officers alone", () => {
    expect(mergeOfficers(undefined, [{ name: "A" }])).toBeUndefined();
  });
});

describe("mergeCandidateEvidence", () => {
  const current = { summary: "UK SIC 62012", codes: ["62012"], officers: [{ name: "A", relationships: ["director"] }], total_offering: 5 };
  it("adds new keys, drops empty ones, and never replaces what the ingest wrote", () => {
    const out = mergeCandidateEvidence(current, { address: "1 High St", care_of: null, exemptions: [], summary: "OVERWRITE", total_offering: 99 });
    expect(out).toEqual({ ...current, address: "1 High St" });
  });
  it("enriches officers and stamps the check", () => {
    const out = mergeCandidateEvidence(current, {}, [{ name: "A", nationality: "British" }], "2026-12-04T00:00:00Z");
    expect(out.officers).toEqual([{ name: "A", relationships: ["director"], nationality: "British" }]);
    expect(out[DETAIL_STAMP]).toBe("2026-12-04T00:00:00Z");
  });
  it("is idempotent", () => {
    const once = mergeCandidateEvidence(current, { address: "X" }, [{ name: "A", born: "1990-01" }], "t");
    expect(mergeCandidateEvidence(once, { address: "X" }, [{ name: "A", born: "1990-01" }], "t")).toEqual(once);
  });
  it("stripEmpty keeps zero and false", () => {
    expect(stripEmpty({ a: 0, b: false, c: "", d: null, e: [] })).toEqual({ a: 0, b: false });
  });
});
