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
