import { describe, it, expect } from "vitest";
import { parseMarkSpec, applySheetMarks, sheetListing } from "./sheetCli";
import type { SheetRow } from "./reviewSheet";

const row = (o: Partial<SheetRow>): SheetRow => ({ company_id: "c", company: "Acme", competitor: "Rival", source_url: "https://x.test", quote: "Acme competes with Rival.", mark: "", ...o });

describe("marking a review sheet by number", () => {
  it("reads numbers and ranges", () => {
    expect([...parseMarkSpec("1-3=y, 5=n")]).toEqual([[1, "y"], [2, "y"], [3, "y"], [5, "n"]]);
  });
  it("refuses what it cannot read, so nothing is half-applied", () => {
    expect(() => parseMarkSpec("1=maybe")).toThrow(/cannot read/);
    expect(() => parseMarkSpec("5-2=y")).toThrow(/backwards/);
  });
  it("marks the numbered rows, leaves the others, and reports a number that is not there", () => {
    const rows = [row({}), row({ competitor: "B" }), row({ competitor: "C", mark: "n" })];
    const r = applySheetMarks(rows, new Map([[1, "y"], [9, "n"]]));
    expect(r.rows.map((x) => x.mark)).toEqual(["y", "", "n"]);
    expect(r.unknown).toEqual([9]);
  });
  it("lists only the unmarked rows, numbered by their place in the file", () => {
    const text = sheetListing([row({ mark: "y" }), row({ competitor: "B" })], "competitors");
    expect(text).toContain("  2  B");
    expect(text).not.toContain("  1  Rival");
    expect(sheetListing([row({ mark: "y" })], "competitors", true)).toContain("[y]");
  });
});
