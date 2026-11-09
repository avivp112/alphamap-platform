import { describe, it, expect } from "vitest";
import { visibleCompetitors } from "./competitors";

describe("competitors on the profile (owner, 2026-10-27)", () => {
  it("shows an unverified competitor (labelled by the page), hides only one a verification run hid", () => {
    const list = [
      { name: "Cognitiv", how_it_competes: "Custom bidding.", source_url: "https://www.adexchanger.com/x" },
      { name: "Soda Core", how_it_competes: "Open-source data quality.", unverified: true },
      { name: "Gone Co", how_it_competes: "x", unverified: true, hidden: true },
      null, "Legacy Co",
    ];
    expect(visibleCompetitors(list).map((c) => [c.name, !!c.unverified])).toEqual([["Cognitiv", false], ["Soda Core", true], ["Legacy Co", false]]);
  });
});

import { splitCompetitors } from "./competitors";
describe("splitCompetitors (owner, 2026-11-07)", () => {
  it("market ones are apart, in order; no tier counts as declared", () => {
    const r = splitCompetitors([{ name: "A", how_it_competes: "" }, { name: "B", how_it_competes: "", tier: "market" }, { name: "C", how_it_competes: "", tier: "declared" }]);
    expect(r.declared.map((c) => c.name)).toEqual(["A", "C"]);
    expect(r.market.map((c) => c.name)).toEqual(["B"]);
  });
});
