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

  it("never changes the case of a name — the first owner review (2026-10-25)", () => {
    for (const t of [
      "mParticle is a competing customer data platform.",
      "eClinicalWorks develops EHR software. It competes in ambulatory care.",
      "uMed is a clinical research platform.",
      "happyhotel is an AI revenue management platform.",
      "greytHR automates HR and payroll.",
    ]) expect(cleanNarrative(t)).toBe(t);
    // A plain word that now opens the sentence is capitalized; a lowercase name is not.
    expect(cleanNarrative("Listed among top competitors in Owler; provides cyber risk testing.")).toBe("Provides cyber risk testing.");
    expect(cleanNarrative("Listed among top competitors in Owler; eMed offers telehealth.")).toBe("eMed offers telehealth.");
  });

  it("keeps what the first review showed to be information", () => {
    // "data from CAD …" is the product, not a source.
    expect(cleanNarrative("Sensat consolidates fragmented data from CAD, BIM and GIS into one context."))
      .toBe("Sensat consolidates fragmented data from CAD, BIM and GIS into one context.");
    // A listing that names no source.
    expect(cleanNarrative("Fondeadora is listed as a direct alternative and competitor to Hey Banco, offering digital banking in Mexico."))
      .toBe("Fondeadora is listed as a direct alternative and competitor to Hey Banco, offering digital banking in Mexico.");
    expect(cleanNarrative("The company received government funding, as noted in its submissions to Australia's Cyber Security Strategy."))
      .toBe("The company received government funding, as noted in its submissions to Australia's Cyber Security Strategy.");
    // Still dropped: a named platform, or "according to".
    expect(cleanNarrative("Offers credit products; a direct competitor according to Tracxn comparables.")).toBe("Offers credit products.");
  });

  it("returns a text with nothing to drop exactly as stored", () => {
    const t = "Acme builds  payroll software.\nIt sells in the US.";
    expect(cleanNarrative(t)).toBe(t);
  });

  it("returns empty when nothing is left", () => {
    expect(cleanNarrative("Listed as a competitor in CB Insights comparisons.")).toBe("");
    expect(cleanNarrative(null)).toBe("");
  });
});
