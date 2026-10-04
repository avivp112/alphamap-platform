import { describe, it, expect } from "vitest";
import { quoteMatchesSource, valueAppearsInQuote, extractNumbersFromText, verifyEvidence, type EvidenceSource } from "./evidence";

describe("quoteMatchesSource", () => {
  // Real TechCrunch snippet text seen during this project's own Apex
  // research (eval/debug_funding_search.ts output).
  const sourceContent = "Satellite bus manufacturing startup Apex Space closed a $16 million Series A co-led by Andreessen Horowitz and new investor Shield Capital.";

  it("matches an exact verbatim quote", () => {
    const result = quoteMatchesSource(
      "Apex Space closed a $16 million Series A co-led by Andreessen Horowitz",
      sourceContent,
    );
    expect(result.matched).toBe(true);
    expect(result.similarity).toBe(1);
  });

  it("matches modulo whitespace/punctuation differences", () => {
    const result = quoteMatchesSource(
      "apex space closed a $16 million series a co led by andreessen horowitz",
      sourceContent,
    );
    expect(result.matched).toBe(true);
  });

  it("rejects an invented quote not actually in the source (evidence_mismatch case)", () => {
    const result = quoteMatchesSource(
      "Apex Space raised $50 million in a Series B led by Sequoia Capital",
      sourceContent,
    );
    expect(result.matched).toBe(false);
  });

  it("rejects a quote from a completely unrelated source", () => {
    const result = quoteMatchesSource("Fresha raised $80 million from KKR", sourceContent);
    expect(result.matched).toBe(false);
  });
});

describe("extractNumbersFromText / valueAppearsInQuote — money-scaled figures", () => {
  it("parses '$16 million' as 16000000", () => {
    expect(extractNumbersFromText("closed a $16 million Series A")).toContain(16_000_000);
  });
  it("parses '$2.3 billion' as 2300000000", () => {
    expect(extractNumbersFromText("valuation rises to $2.3 billion")).toContain(2_300_000_000);
  });
  it("confirms a claimed amount against its textual money form", () => {
    expect(valueAppearsInQuote(16_000_000, "Apex Space closed a $16 million Series A")).toBe(true);
    expect(valueAppearsInQuote(2_300_000_000, "valuation rises to $2.3 billion after latest $200 million raise")).toBe(true);
  });
  it("rejects a claimed amount the quote does not actually support", () => {
    expect(valueAppearsInQuote(50_000_000, "Apex Space closed a $16 million Series A")).toBe(false);
  });
  it("confirms a plain year value", () => {
    expect(valueAppearsInQuote(2022, "Apex was founded in 2022 by Ian Cinnamon")).toBe(true);
    expect(valueAppearsInQuote(2026, "Apex was founded in 2022 by Ian Cinnamon")).toBe(false);
  });
  it("confirms a city/investor name value case-insensitively", () => {
    expect(valueAppearsInQuote("Andreessen Horowitz", "co-led by Andreessen Horowitz and Shield Capital")).toBe(true);
    expect(valueAppearsInQuote("Sequoia Capital", "co-led by Andreessen Horowitz and Shield Capital")).toBe(false);
  });
});

describe("valueAppearsInQuote — ISO date vs. natural-language date phrasing", () => {
  it("matches an ISO date against a 'Month Day, Year' phrase in the quote", () => {
    expect(valueAppearsInQuote("2026-04-01", "pushing its valuation up, dated April 1 2026")).toBe(true);
    expect(valueAppearsInQuote("2026-04-01", "on April 1, 2026, the company announced")).toBe(true);
  });
  it("matches a 'Day Month Year' phrase too", () => {
    expect(valueAppearsInQuote("2026-06-05", "the round closed on 5 June 2026")).toBe(true);
  });
  it("matches a numeric date already in ISO or slash form", () => {
    expect(valueAppearsInQuote("2026-06-05", "closed on 2026-06-05 per the filing")).toBe(true);
    expect(valueAppearsInQuote("2026-06-05", "closed on 06/05/2026 per the filing")).toBe(true);
  });
  it("rejects a quote stating a genuinely different date", () => {
    expect(valueAppearsInQuote("2026-04-01", "the round closed on 5 June 2026")).toBe(false);
  });
});

describe("verifyEvidence — end to end", () => {
  const sources: Record<string, EvidenceSource> = {
    S1: {
      url: "https://techcrunch.com/2023/06/22/apex-space",
      content: "Satellite bus manufacturing startup Apex Space closed a $16 million Series A co-led by Andreessen Horowitz and new investor Shield Capital.",
    },
    S2: {
      url: "https://www.apexspace.com/news/apex-announces-additional-fundraising-at-2b-valuation",
      content: "Apex Announces Additional Fundraising at $2.3B Valuation. $200M in new capital nearly doubles Apex's valuation to $2.3 billion.",
    },
  };

  it("verifies a genuine, well-cited claim", () => {
    const result = verifyEvidence(
      { field: "funding_rounds[0].amount_raised", value: 16_000_000, source_id: "S1", evidence_quote: "closed a $16 million Series A co-led by Andreessen Horowitz" },
      sources,
    );
    expect(result.verified).toBe(true);
  });

  it("rejects a claim citing a source_id that does not exist", () => {
    const result = verifyEvidence(
      { field: "profile.city", value: "London", source_id: "S99", evidence_quote: "anything" },
      sources,
    );
    expect(result.verified).toBe(false);
    expect(result.drop_reason).toBe("source_not_found");
  });

  it("rejects a quote that isn't actually in the cited source", () => {
    const result = verifyEvidence(
      { field: "funding_rounds[0].amount_raised", value: 16_000_000, source_id: "S2", evidence_quote: "closed a $16 million Series A co-led by Andreessen Horowitz" },
      sources,
    );
    expect(result.verified).toBe(false);
    expect(result.drop_reason).toBe("evidence_mismatch");
  });

  it("rejects a real quote that doesn't actually support the specific claimed value", () => {
    const result = verifyEvidence(
      { field: "funding_rounds[2].amount_raised", value: 999_000_000, source_id: "S2", evidence_quote: "$200M in new capital nearly doubles Apex's valuation to $2.3 billion" },
      sources,
    );
    expect(result.verified).toBe(false);
    expect(result.drop_reason).toBe("value_not_in_quote");
  });

  it("verifies a URL value only when it appears verbatim in the source", () => {
    const withUrl: Record<string, EvidenceSource> = {
      S3: { url: "https://x.com", content: "Our CTO's LinkedIn is https://www.linkedin.com/in/maxbenassi and you can reach us there." },
    };
    const ok = verifyEvidence(
      { field: "founders[1].linkedin_url", value: "https://www.linkedin.com/in/maxbenassi", source_id: "S3", evidence_quote: "Our CTO's LinkedIn is https://www.linkedin.com/in/maxbenassi", is_url: true },
      withUrl,
    );
    expect(ok.verified).toBe(true);

    const invented = verifyEvidence(
      { field: "founders[1].linkedin_url", value: "https://www.linkedin.com/in/someone-else", source_id: "S3", evidence_quote: "Our CTO's LinkedIn is https://www.linkedin.com/in/maxbenassi", is_url: true },
      withUrl,
    );
    expect(invented.verified).toBe(false);
    expect(invented.drop_reason).toBe("url_not_in_source");
  });

  it("does not crash when the model omits evidence_quote despite the schema marking it required -- the real DRY_RUN=false crash (Frameplay, 'Cannot read properties of undefined (reading toLowerCase)')", () => {
    const claim = { field: "profile.founded_year", value: 2020, source_id: "S1" } as unknown as {
      field: string; value: number; source_id: string; evidence_quote: string;
    };
    expect(() => verifyEvidence(claim, sources)).not.toThrow();
    const result = verifyEvidence(claim, sources);
    expect(result.verified).toBe(false);
    expect(result.drop_reason).toBe("evidence_mismatch");
  });

  it("does not crash when the model omits value but supplies a real evidence_quote", () => {
    const claim = { field: "profile.founded_year", source_id: "S1", evidence_quote: "closed a $16 million Series A co-led by Andreessen Horowitz" } as unknown as {
      field: string; value: number; source_id: string; evidence_quote: string;
    };
    expect(() => verifyEvidence(claim, sources)).not.toThrow();
    const result = verifyEvidence(claim, sources);
    expect(result.verified).toBe(false);
    expect(result.drop_reason).toBe("value_not_in_quote");
  });

  it("does not crash on a URL claim missing its value", () => {
    const withUrl: Record<string, EvidenceSource> = {
      S3: { url: "https://x.com", content: "Our CTO's LinkedIn is https://www.linkedin.com/in/maxbenassi and you can reach us there." },
    };
    const claim = { field: "founders[1].linkedin_url", source_id: "S3", evidence_quote: "Our CTO's LinkedIn is https://www.linkedin.com/in/maxbenassi", is_url: true } as unknown as {
      field: string; value: string; source_id: string; evidence_quote: string; is_url: boolean;
    };
    expect(() => verifyEvidence(claim, withUrl)).not.toThrow();
    expect(verifyEvidence(claim, withUrl).verified).toBe(false);
  });
});
