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
