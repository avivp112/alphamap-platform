import { describe, it, expect } from "vitest";
import { cleanNarrative, clauseProblem } from "./narrative";

describe("cleanNarrative", () => {
  it("drops the data-platform clause from a 'how it competes' line, keeping the rest", () => {
    // The owner's example (2026-10-25), Hinge Health as a competitor.
    expect(cleanNarrative(
      "Direct competitor offering digital health and employee benefits solutions; listed as a top competitor in Tracxn and CB Insights comparisons, competing for the same employer/benefits consultant customer base.",
    )).toBe("Direct competitor offering digital health and employee benefits solutions.");
  });

  it("drops sentences that say where the fact was read", () => {
    expect(cleanNarrative("Acme builds payroll software for restaurants. According to Crunchbase, it has 120 employees. It sells in the US and UK."))
      .toBe("Acme builds payroll software for restaurants. It sells in the US and UK.");
    expect(cleanNarrative("Acme sells to hospitals. Its LinkedIn profile lists 200 employees."))
      .toBe("Acme sells to hospitals.");
    expect(cleanNarrative("Acme sells to hospitals; data from PitchBook shows strong growth."))
      .toBe("Acme sells to hospitals.");
  });

  it("drops a description's sentence that names one of the company's competitors", () => {
    expect(cleanNarrative(
      "Sword Health offers digital physical therapy. Unlike Hinge Health, it uses AI care. It serves employers.",
      { avoidNames: ["Hinge Health", "Kaia"], selfName: "Sword Health" },
    )).toBe("Sword Health offers digital physical therapy. It serves employers.");
  });

  it("never treats the company's own name, or a 1–2 letter name, as a competitor", () => {
    expect(cleanNarrative("Hinge Health offers virtual MSK care.", { avoidNames: ["Hinge Health", "X"], selfName: "Hinge Health" }))
      .toBe("Hinge Health offers virtual MSK care.");
  });

  it("keeps ordinary text untouched — no false positives on common words", () => {
    expect(cleanNarrative("Clayton builds price comparisons for travellers; it partners with airlines.")).toBe("Clayton builds price comparisons for travellers; it partners with airlines.");
    expect(cleanNarrative("A craft beer marketplace that sources from local breweries.")).toBe("A craft beer marketplace that sources from local breweries.");
    expect(clauseProblem("Golden retrievers love it")).toBeNull();
  });

  it("matches a competitor's name as written, not the same ordinary word", () => {
    const opts = { avoidNames: ["Square", "Ramp", "Notion"], selfName: "Acme" };
    expect(cleanNarrative("Acme helps retailers plan square footage. Teams ramp up fast; it builds on the notion of shared ledgers.", opts))
      .toBe("Acme helps retailers plan square footage. Teams ramp up fast; it builds on the notion of shared ledgers.");
    expect(cleanNarrative("Acme sells card readers. It is an alternative to Square for cafés.", opts)).toBe("Acme sells card readers.");
  });

  it("returns empty when nothing is left", () => {
    expect(cleanNarrative("Listed as a competitor in CB Insights comparisons.")).toBe("");
    expect(cleanNarrative(null)).toBe("");
  });
});
