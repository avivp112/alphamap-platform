import { describe, it, expect } from "vitest";
import { competitorRowsFromRun } from "./competitorRows";

describe("competitor rows for a company the golden set has no list for", () => {
  const found = [{ name: "HeyGen", source_url: "https://x.test/a", quote: "Synthesia competes with HeyGen." }, { name: "Colossyan", source_url: "https://x.test/a", quote: "…" }, { name: "Veed", source_url: null, quote: null }];
  it("adds the names with their source and quote, unmarked", () => {
    const rows = competitorRowsFromRun("synthesia", "Synthesia", found, []);
    expect(rows.map((r) => r.competitor)).toEqual(["HeyGen", "Colossyan", "Veed"]);
    expect(rows[0]).toMatchObject({ company_id: "synthesia", company: "Synthesia", source_url: "https://x.test/a", mark: "" });
  });
  it("does not add a name twice, or one already on the sheet", () => {
    const existing = [{ company_id: "synthesia", company: "Synthesia", competitor: "heygen", source_url: "", quote: "", mark: "y" }];
    expect(competitorRowsFromRun("synthesia", "Synthesia", [...found, found[1]], existing).map((r) => r.competitor)).toEqual(["Colossyan", "Veed"]);
  });
  it("a company the run has nothing for adds nothing", () => {
    expect(competitorRowsFromRun("x", "X", undefined, [])).toEqual([]);
  });
});
