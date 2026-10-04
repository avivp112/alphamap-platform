import { describe, it, expect } from "vitest";
import { buildFundingExtractionRequest, processFundingExtractionResponse, roundToRoundLike, type V2Round } from "./extractFunding";
import { buildLabeledSources, type RawSearchResult } from "./sources";
import { dedupRounds } from "./rounds";

const rawSources: RawSearchResult[] = [
  {
    url: "https://techcrunch.com/2023/06/22/apex-space", provider: "serper", query_label: "history",
    content: "Satellite bus manufacturing startup Apex Space closed a $16 million Series A co-led by Andreessen Horowitz and new investor Shield Capital.",
  },
  {
    url: "https://www.apexspace.com/news/apex-announces-additional-fundraising-at-2b-valuation", provider: "jina", query_label: "website",
    content: "Apex Announces Additional Fundraising at $2.3B Valuation. The $200 million round was led by Glade Brook Capital Partners, on June 5, 2026, nearly doubling Apex's valuation to $2.3 billion.",
  },
  {
    url: "https://parsers.vc/startup/apexspace.com", provider: "serper", query_label: "amounts",
    content: "Apex Space has secured $200 million in a Series D financing round led by Interlagos, pushing its valuation to $2.3 billion, dated April 1 2026.",
  },
];
const sources = buildLabeledSources(rawSources, "apexspace.com");

describe("buildFundingExtractionRequest", () => {
  const request = buildFundingExtractionRequest("Apex", sources);

  it("forces the save_funding_extraction tool with temperature 0", () => {
    expect(request.temperature).toBe(0);
    expect(request.tool_choice).toEqual({ type: "tool", name: "save_funding_extraction" });
  });

  it("instructs against collapsing distinct rounds and against inventing an early round", () => {
    const text = request.messages[0].content as string;
    expect(text).toContain("Never collapse two distinct rounds into one");
    expect(text).toContain("never invent a round to fill a suspected gap");
  });

  it("every material round field requires value/source_id/evidence_quote", () => {
    const roundProps = (request.tools[0].input_schema.properties.funding_rounds as any).items.properties;
    for (const field of ["amount_raised", "valuation", "announcement_date", "lead_investor"]) {
      expect(roundProps[field].required).toEqual(["value", "source_id", "evidence_quote"]);
    }
  });
});

describe("processFundingExtractionResponse", () => {
  it("accepts a well-evidenced round", () => {
    const raw = {
      funding_rounds: [{
        round_type: "Series A",
        amount_raised: { value: 16_000_000, source_id: "S1", evidence_quote: "closed a $16 million Series A co-led by Andreessen Horowitz" },
        lead_investor: { value: "Andreessen Horowitz", source_id: "S1", evidence_quote: "closed a $16 million Series A co-led by Andreessen Horowitz" },
      }],
      funding_history_complete: true,
    };
    const { result, dropped } = processFundingExtractionResponse(raw, sources);
    expect(dropped).toHaveLength(0);
    expect(result.funding_rounds[0].amount_raised?.value).toBe(16_000_000);
    expect(result.funding_rounds[0].lead_investor?.value).toBe("Andreessen Horowitz");
  });

  it("drops an amount whose quote doesn't actually support it", () => {
    const raw = {
      funding_rounds: [{
        round_type: "Series A",
        amount_raised: { value: 999_000_000, source_id: "S1", evidence_quote: "closed a $16 million Series A co-led by Andreessen Horowitz" },
      }],
      funding_history_complete: true,
    };
    const { result, dropped } = processFundingExtractionResponse(raw, sources);
    expect(result.funding_rounds[0].amount_raised).toBeUndefined();
    expect(dropped).toContainEqual({ field: "funding_rounds[0].amount_raised", reason: "value_not_in_quote" });
  });

  it("drops a round entirely missing round_type (required)", () => {
    const raw = { funding_rounds: [{ amount_raised: { value: 1, source_id: "S1", evidence_quote: "x" } }], funding_history_complete: true };
    const { result } = processFundingExtractionResponse(raw, sources);
    expect(result.funding_rounds).toHaveLength(0);
  });

  it("never defaults funding_history_complete to true when missing", () => {
    const { result } = processFundingExtractionResponse({ funding_rounds: [] }, sources);
    expect(result.funding_history_complete).toBeNull();
  });

  it("verifies arr_milestones and valuation_benchmarks independently", () => {
    const raw = {
      funding_rounds: [], funding_history_complete: true,
      arr_milestones: [
        { arr: 200_000_000, source_id: "W1", evidence_quote: "nearly doubling Apex's valuation to $2.3 billion" }, // real quote, but doesn't state THIS arr value
      ],
      valuation_benchmarks: [
        { valuation: 2_300_000_000, source_id: "W1", evidence_quote: "nearly doubling Apex's valuation to $2.3 billion" },
      ],
    };
    const { result, dropped } = processFundingExtractionResponse(raw, sources);
    expect(result.arr_milestones).toHaveLength(0);
    expect(dropped.some((d) => d.field === "arr_milestones")).toBe(true);
    expect(result.valuation_benchmarks).toHaveLength(1);
  });
});

describe("roundToRoundLike", () => {
  it("normalizes round_type -- caught via a real DRY_RUN run where the model emitted 'Venture' and 'Venture Debt', neither force-constrained by the schema enum in practice", () => {
    const vague: V2Round = { round_type: "Venture" };
    expect(roundToRoundLike(vague).round_type).toBe("Other");

    const debt: V2Round = { round_type: "Venture Debt" };
    expect(roundToRoundLike(debt).round_type).toBe("Venture Debt"); // already canonical, passes through unchanged
  });
});

describe("roundToRoundLike + dedupRounds — full pipeline reproduction of the literal production bug", () => {
  it("extracts both $200M rounds, flattens them, and correctly flags them for review instead of silently merging", () => {
    const raw = {
      funding_rounds: [
        {
          round_type: "Series D",
          amount_raised: { value: 200_000_000, source_id: "S2", evidence_quote: "secured $200 million in a Series D financing round led by Interlagos" },
          lead_investor: { value: "Interlagos", source_id: "S2", evidence_quote: "secured $200 million in a Series D financing round led by Interlagos" },
          valuation: { value: 2_300_000_000, source_id: "S2", evidence_quote: "pushing its valuation to $2.3 billion" },
          announcement_date: { value: "2026-04-01", source_id: "S2", evidence_quote: "pushing its valuation to $2.3 billion, dated April 1 2026" },
        },
        {
          round_type: "Growth",
          amount_raised: { value: 200_000_000, source_id: "W1", evidence_quote: "The $200 million round was led by Glade Brook Capital Partners, on June 5, 2026" },
          lead_investor: { value: "Glade Brook Capital Partners", source_id: "W1", evidence_quote: "The $200 million round was led by Glade Brook Capital Partners, on June 5, 2026" },
          valuation: { value: 2_300_000_000, source_id: "W1", evidence_quote: "nearly doubling Apex's valuation to $2.3 billion" },
          announcement_date: { value: "2026-06-05", source_id: "W1", evidence_quote: "The $200 million round was led by Glade Brook Capital Partners, on June 5, 2026" },
        },
      ],
      funding_history_complete: true,
    };

    const { result, dropped } = processFundingExtractionResponse(raw, sources);
    expect(dropped).toHaveLength(0); // both rounds are genuinely, independently well-evidenced
    expect(result.funding_rounds).toHaveLength(2);

    const roundLikes = result.funding_rounds.map(roundToRoundLike);
    const dedupResult = dedupRounds(roundLikes);

    // The real fix: NOT silently merged into one row (which would hide a
    // real round and inflate/deflate Total Raised), and NOT left to double-
    // count either -- surfaced for a human to resolve.
    expect(dedupResult.rounds).toHaveLength(2);
    expect(dedupResult.merged).toHaveLength(0);
    expect(dedupResult.needsReview).toHaveLength(1);
  });
});
