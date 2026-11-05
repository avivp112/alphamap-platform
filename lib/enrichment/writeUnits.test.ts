import { describe, it, expect } from "vitest";
import { restrictPatch, openColumnsOf, fieldOfColumn, withoutBio, WRITABLE_FIELDS } from "./writeUnits";
import { openFieldNames, type Mark } from "./fieldReview";
import { enrichmentWriteRefusal } from "./writeGate";

const marks = (field: string, correct: number, wrong: number): Mark[] => [
  ...Array.from({ length: correct }, (_, i) => ({ id: `${field}.c${i}`, field, company: "Co", value: "v", source_url: "", verdict: "correct" as const, source_of_mark: "" })),
  ...Array.from({ length: wrong }, (_, i) => ({ id: `${field}.w${i}`, field, company: "Co", value: "v", source_url: "", verdict: "wrong" as const, source_of_mark: "" })),
];

describe("the tracker is the gate (owner, 2026-11-05)", () => {
  it("only the open fields' columns are written; the rest is held back and named", () => {
    const patch = { news: [1], city: "London", founders: [{ name: "A" }], description: "x", patents: [], patent_count: 0 };
    const r = restrictPatch(patch, ["news", "patent"]);
    expect(Object.keys(r.patch).sort()).toEqual(["news", "patent_count", "patents"]);
    expect(r.heldBack.sort()).toEqual(["city", "description", "founders"]);
    expect(restrictPatch(patch, []).patch).toEqual({});
  });
  it("a field with no marks is never open; 20 marked and 90% correct opens it", () => {
    expect(openFieldNames([])).toEqual([]);
    expect(openFieldNames([...marks("leader", 19, 0), ...marks("round", 18, 4), ...marks("news", 20, 0), ...marks("patent", 18, 2)])).toEqual(["news", "patent"]);
  });
  it("every review field maps to columns, rounds or bios; a column belongs to one field", () => {
    expect(WRITABLE_FIELDS).toHaveLength(14);
    expect(openColumnsOf(["office", "competitor"])).toEqual(new Set(["offices", "office_countries", "competitors"]));
    expect(fieldOfColumn("leadership")).toBe("leader");
    expect(fieldOfColumn("description")).toBeNull();
  });
  it("bios and the tags read off them are cut from a person unless the bios field is open", () => {
    expect(withoutBio({ name: "A", role: "CEO", bio: "x", elite_background: true, linkedin_url: "u" })).toEqual({ name: "A", role: "CEO", linkedin_url: "u" });
  });
  it("the pilot may be asked for any review field, nothing else", () => {
    expect(enrichmentWriteRefusal("bulk", true, false, { fields: ["news", "competitor", "round"], companies: 5 })).toBeNull();
    expect(enrichmentWriteRefusal("bulk", true, false, { fields: ["news", "description"], companies: 5 })).toMatch(/description/);
  });
});

import { drawReviewSample, missingFieldCount, FOCUS_FIELDS, type PilotCandidate } from "./pilotSample";
describe("FOCUS: a review run pointed at the fields short of marks (owner, 2026-11-05)", () => {
  const co = (id: string, o: Partial<PilotCandidate> = {}): PilotCandidate => ({ id, name: id, website: `${id}.com`, description: "x", city: "X", country: "Y", founded_year: 2020, founding_country: "Y", founders: [{}], competitors: [{}], leadership: [{}], patents: [{}], rounds_on_file: 3, ...o });
  it("counts only the focused fields", () => {
    const c = co("a", { competitors: [], patents: [], rounds_on_file: 0 });
    expect(missingFieldCount(c, ["competitors", "rounds"])).toBe(2);
    expect(missingFieldCount(c, ["leadership"])).toBe(0);
    expect(Object.keys(FOCUS_FIELDS)).toEqual(expect.arrayContaining(["competitors", "rounds", "patents", "leadership", "founded_year", "founding_country"]));
  });
  it("the targeted share takes companies short of any focused field; the rest stays random", () => {
    const rows = [...Array.from({ length: 10 }, (_, i) => co(`short${i}`, { competitors: [] })), ...Array.from({ length: 20 }, (_, i) => co(`full${i}`))];
    const covered = new Set(rows.map((r) => r.id));
    const s = drawReviewSample(rows, covered, { size: 15, targeted: 8, seed: 3, focus: ["competitors"] });
    expect(s.filter((c) => c.why.includes("targeted"))).toHaveLength(8);
    expect(s.filter((c) => c.why.includes("targeted")).every((c) => c.id.startsWith("short"))).toBe(true);
    // Without FOCUS the default needs three missing fields: these companies miss one, so none is targeted.
    expect(drawReviewSample(rows, covered, { size: 15, targeted: 8, seed: 3 }).filter((c) => c.why.includes("targeted"))).toHaveLength(0);
  });
});
