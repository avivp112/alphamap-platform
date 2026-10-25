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

  it("keeps ordinary text untouched — no false positives on common words", () => {
    expect(cleanNarrative("Clayton builds price comparisons for travellers; it partners with airlines.")).toBe("Clayton builds price comparisons for travellers; it partners with airlines.");
    expect(cleanNarrative("A craft beer marketplace that sources from local breweries.")).toBe("A craft beer marketplace that sources from local breweries.");
    expect(clauseProblem("Golden retrievers love it")).toBeNull();
  });

  it("keeps a sentence about the company's own competitors — that is information (owner, 2026-10-25)", () => {
    expect(cleanNarrative("Sword Health offers digital physical therapy. Unlike Hinge Health, it uses AI care.", { selfName: "Sword Health" }))
      .toBe("Sword Health offers digital physical therapy. Unlike Hinge Health, it uses AI care.");
  });

  it("matches an ambiguous platform name only as written (dataPlatforms.ts caseSensitive)", () => {
    expect(cleanNarrative("Acme models harmonic signals in power grids.")).toBe("Acme models harmonic signals in power grids.");
    expect(cleanNarrative("Acme sells to utilities. It is tracked on Harmonic and Specter.")).toBe("Acme sells to utilities.");
    expect(cleanNarrative("Acme sells to utilities; Dealigence lists it among peers.")).toBe("Acme sells to utilities.");
  });

  it("lets a data platform's own profile name itself", () => {
    expect(cleanNarrative("Tracxn is a startup data platform for investors.", { selfName: "Tracxn" })).toBe("Tracxn is a startup data platform for investors.");
  });

  it("returns empty when nothing is left", () => {
    expect(cleanNarrative("Listed as a competitor in CB Insights comparisons.")).toBe("");
    expect(cleanNarrative(null)).toBe("");
  });
});
