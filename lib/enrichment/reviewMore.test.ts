import { describe, it, expect } from "vitest";
import { unmarkedRows, type RunRow } from "./reviewMore";

const r = (field: string, company: string, value: string, run = "7"): RunRow => ({ run, company_id: `id-${company}`, company, field, value, on_file: "", source_url: "https://x.example", quote: "q" });
describe("the second marking sheet (owner, 2026-11-09)", () => {
  const rows = [
    r("sector", "Adranos", "DeepTech › DeepTech / General", "6"), r("sector", "Gloat", "HR Tech › Talent"), r("tags", "Gloat", "AI & ML, HR Tech"),
    r("description", "Pynt", "Pynt offers dynamic API security testing."), r("founder", "Pynt", "Ori Goldberg — CTO"), r("sector", "Gloat", "HR Tech › Talent", "6"),
  ];
  const marks = [{ field: "sector", company: "Adranos", value: "DeepTech › DeepTech / General" }];
  it("holds only the chosen fields, in their order, without what is marked and without a value that two runs both hold", () => {
    const out = unmarkedRows(rows, marks, ["description", "sector", "tags"]);
    expect(out.map((x) => `${x.field}:${x.company}`)).toEqual(["description:Pynt", "sector:Gloat", "tags:Gloat"]);
  });
  it("a mark covers a value whatever its spacing or case", () => {
    const out = unmarkedRows(rows, [{ field: "tags", company: "gloat", value: "ai & ml,  hr tech" }], ["tags"]);
    expect(out).toEqual([]);
  });
});
