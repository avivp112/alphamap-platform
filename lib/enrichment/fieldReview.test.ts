import { describe, it, expect } from "vitest";
import { fieldStatus, openColumns, type Mark } from "./fieldReview";

const marks = (field: string, correct: number, wrong: number): Mark[] => [
  ...Array.from({ length: correct }, (_, i) => ({ id: `${field}.c${i}`, field, company: "Co", value: "v", source_url: "", verdict: "correct" as const, source_of_mark: "t" })),
  ...Array.from({ length: wrong }, (_, i) => ({ id: `${field}.w${i}`, field, company: "Co", value: "v", source_url: "", verdict: "wrong" as const, source_of_mark: "t" })),
];

describe("a field opens for writing at ≥20 marked and ≥90% correct (owner, 2026-11-02)", () => {
  it("counts per field", () => {
    const s = fieldStatus([...marks("founded_year", 18, 2), ...marks("hq_city", 17, 3), ...marks("round", 19, 0)]);
    expect(s.find((x) => x.field === "founded_year")).toMatchObject({ marked: 20, correct: 18, open: true });
    expect(s.find((x) => x.field === "hq_city")).toMatchObject({ marked: 20, open: false }); // 85%
    expect(s.find((x) => x.field === "round")).toMatchObject({ marked: 19, open: false });   // too few
  });
  it("maps open fields to the columns the pilot writes", () => {
    expect(openColumns([...marks("founded_year", 20, 0), ...marks("hq_country", 5, 0)])).toEqual(["founded_year"]);
  });
});
