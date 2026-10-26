import { describe, it, expect } from "vitest";
import { groundRoundType } from "./assemble";
import type { V2Round } from "./extractFunding";
import type { LabeledSource } from "./sources";

const src = (source_id: string, content: string, title = ""): LabeledSource =>
  ({ source_id, url: `https://example.com/${source_id}`, content, title } as unknown as LabeledSource);
const ev = <T,>(value: T, source_id: string, evidence_quote: string) => ({ value, source_id, evidence_quote });

describe("a round's type must be stated (run of 2026-10-26)", () => {
  it("Biotia's '$9M financing' is not a Growth round", () => {
    const s = src("S1", "Biotia announced an oversubscribed $9 million financing and expanded its board with healthcare leaders.",
      "Biotia Raises New Oversubscribed $9M Financing and Expands Board");
    const r: V2Round = { round_type: "Growth", amount_raised: ev(9_000_000, "S1", "Biotia announced an oversubscribed $9 million financing") };
    expect(groundRoundType(r, [s])).toEqual({ round_type: "Unknown", stated: false });
  });

  it("Azumo's '$30M in funding' is not a Series B", () => {
    const s = src("S1", "Azumo announced $30 million in funding led by Anzu Partners to accelerate international expansion.", "$30M in Funding to Fuel Growth of Next Gen LCD 2.0 Display Technology");
    const r: V2Round = { round_type: "Series B", amount_raised: ev(30_000_000, "S1", "Azumo announced $30 million in funding led by Anzu Partners") };
    expect(groundRoundType(r, [s]).round_type).toBe("Unknown");
  });

  it("keeps a type the quote, the passage around it or the headline states", () => {
    const quote = src("S1", "Biotia raised an oversubscribed $8 million Series A round led by OCA Ventures.");
    expect(groundRoundType({ round_type: "Series A", amount_raised: ev(8_000_000, "S1", "raised an oversubscribed $8 million Series A round") }, [quote]).round_type).toBe("Series A");
    const headline = src("S2", "The company raised $8 million led by OCA Ventures to expand its lab.", "Biotia Raises an Oversubscribed $8M Series A");
    expect(groundRoundType({ round_type: "Series A", amount_raised: ev(8_000_000, "S2", "The company raised $8 million led by OCA Ventures") }, [headline]).round_type).toBe("Series A");
    const debt = src("S3", "BETA secured a $169 million loan from the Export-Import Bank.");
    expect(groundRoundType({ round_type: "Debt", amount_raised: ev(169_000_000, "S3", "BETA secured a $169 million loan") }, [debt]).round_type).toBe("Debt");
  });

  it("leaves Unknown and Other as they are", () => {
    expect(groundRoundType({ round_type: "Other" }, []).round_type).toBe("Other");
  });
});
