import { describe, it, expect } from "vitest";
import { visibleCompetitors } from "./competitors";

describe("unverified competitors are hidden, not deleted (owner, 2026-10-26)", () => {
  it("hides Chalice's unverified entry and shows a sourced one", () => {
    const list = [
      { name: "Cognitiv", how_it_competes: "Custom bidding.", source_url: "https://www.adexchanger.com/x" },
      { name: "The Trade Desk", how_it_competes: "DSP.", unverified: true },
      null, "Legacy Co",
    ];
    expect(visibleCompetitors(list).map((c) => c.name)).toEqual(["Cognitiv", "Legacy Co"]);
  });
});
