import { describe, it, expect } from "vitest";
import { factProblem, processBackgroundResponse, backgroundSearchQuery, type BackgroundFact } from "./founderBackground";

const text = "Amnon Shashua, co-founder of Mobileye, previously served in the Israeli army. Shashua sold Mobileye to Intel. Shashua studied at the Hebrew University of Jerusalem. Ziv Aviram met Dana in 2020.";
const sources = { S1: { content: text } };
const ok = () => true;
const fact = (o: Partial<BackgroundFact>): BackgroundFact => ({ kind: "exit", organization: "Mobileye", source_id: "S1", evidence_quote: "Shashua sold Mobileye to Intel.", ...o });

describe("founder background facts are verified like any field", () => {
  it("accepts an exit whose quote names the founder and the organization", () => {
    expect(factProblem("Amnon Shashua", "OrCam", fact({}), sources, ok)).toBeNull();
  });
  it("rejects a quote that is not in the source, a source not allowed, an unknown source", () => {
    expect(factProblem("Amnon Shashua", "OrCam", fact({ evidence_quote: "Shashua founded Mobileye in a garage." }), sources, ok)).toBe("quote_not_in_source");
    expect(factProblem("Amnon Shashua", "OrCam", fact({}), sources, () => false)).toBe("source_not_allowed");
    expect(factProblem("Amnon Shashua", "OrCam", fact({ source_id: "S9" }), sources, ok)).toBe("source_not_found");
  });
  it("the quote must name the founder and the organization", () => {
    expect(factProblem("Ziv Aviram", "OrCam", fact({}), sources, ok)).toBe("founder_not_in_quote");
    expect(factProblem("Amnon Shashua", "OrCam", fact({ organization: "Intel Corp Labs" }), sources, ok)).toBe("organization_not_in_quote");
  });
  it("the quote must say the kind: two names in one sentence is not an exit", () => {
    expect(factProblem("Ziv Aviram", "OrCam", fact({ organization: "Dana", evidence_quote: "Ziv Aviram met Dana in 2020." }), sources, ok)).toBe("quote_does_not_say_it");
  });
  it("education and military are read from their own words", () => {
    expect(factProblem("Amnon Shashua", "OrCam", fact({ kind: "education", organization: "Hebrew University of Jerusalem", evidence_quote: "Shashua studied at the Hebrew University of Jerusalem." }), sources, ok)).toBeNull();
  });
  it("the company itself is not a previous company", () => {
    expect(factProblem("Amnon Shashua", "Mobileye", fact({}), sources, ok)).toBe("is_the_company_itself");
  });
  it("processing keeps verified facts per known founder, drops and names the rest, dedupes", () => {
    const r = processBackgroundResponse({ founders: [
      { name: "Amnon Shashua", facts: [fact({}), fact({}), fact({ evidence_quote: "invented" })] },
      { name: "Someone Else", facts: [fact({})] },
    ] }, ["Amnon Shashua"], "OrCam", sources, ok);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].facts).toHaveLength(1);
    expect(r.dropped.map((d) => d.why)).toEqual(["quote_not_in_source"]);
  });
  it("garbage input yields nothing", () => {
    expect(processBackgroundResponse(null, ["A B"], "Co", sources, ok).kept).toEqual([]);
  });
  it("one targeted search names the founders and the company", () => {
    expect(backgroundSearchQuery("OrCam", ["Amnon Shashua", "Ziv Aviram", "Third Person"])).toBe('"Amnon Shashua" OR "Ziv Aviram" "OrCam" founder previously OR formerly OR "before founding" OR graduated OR served');
  });
});

import { factBelongsToFounder } from "./founderBackground";
describe("a fact belongs to the founder the sentence says it of (review 7, x67.133 Cado)", () => {
  const both = ["James Campbell", "Christopher Doman"];
  it("Cado: AlienVault is Doman's, PwC is shared work, neither goes to Campbell by the other's name", () => {
    const q1 = "Campbell co-founded Cado with Christopher Doman (the CTO) last April, with the concept coming out of their respective experiences working on security services together at PwC, and respectively for government organizations (Campbell) and AlienVault (Doman).";
    expect(factBelongsToFounder(q1, "James Campbell", "AlienVault", both)).toBe(false);
    expect(factBelongsToFounder(q1, "Christopher Doman", "AlienVault", both)).toBe(true);
    const q2 = "Christopher Doman previously worked at AlienVault, and Campbell at PwC.";
    expect(factBelongsToFounder(q2, "James Campbell", "AlienVault", both)).toBe(false);
    expect(factBelongsToFounder(q2, "James Campbell", "PwC", both)).toBe(true);
  });
  it("Piiano: a firm of both founders, 'whose', is both of theirs", () => {
    const q = "Founded by security experts Gil Dabah and Ariel Shiftan-whose cybersecurity firm, NorthBit, was acquired by Magic Leap in 2016";
    const both = ["Gil Dabah", "Ariel Shiftan"];
    expect(factBelongsToFounder(q, "Gil Dabah", "NorthBit", both)).toBe(true);
    expect(factBelongsToFounder(q, "Ariel Shiftan", "NorthBit", both)).toBe(true);
  });
  it("one founder named, or no other founder: unchanged", () => {
    expect(factBelongsToFounder("Saar Safra formerly was CTO of Ad4Ever acquired by aQuantive.", "Saar Safra", "Ad4Ever", ["Saar Safra", "Other Person"])).toBe(true);
    expect(factBelongsToFounder("Saar Safra formerly was CTO of Ad4Ever.", "Saar Safra", "Ad4Ever", [])).toBe(true);
  });
});

import { founderSearchQuery } from "./founderBackground";
describe("one search per founder (owner, 2026-11-10)", () => {
  it("names one founder and the company", () => {
    expect(founderSearchQuery("Cado Security", "James Campbell")).toBe('"James Campbell" "Cado Security" founder previously OR formerly OR "before founding" OR graduated OR served OR "co-founder of"');
  });
});
