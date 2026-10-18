import { describe, it, expect } from "vitest";
import { buildProfile, investorNames, confidenceOf } from "./profile";
import { validateEnrichment } from "../lib/enrichment/validation";
import { planRoundWrites } from "../lib/enrichment/assemble";
import type { CollectedCompany } from "../lib/enrichment/collect";
import type { SourceType } from "../lib/enrichment/sourceTypes";

// Sources the research "read": S1 a press release, S2 a directory profile, W1 the company's own page.
const sources: Record<string, { url: string; type: SourceType }> = {
  S1: { url: "https://www.prnewswire.com/nuova-seed", type: "press_release" },
  S2: { url: "https://www.crunchbase.com/organization/nuova-ai", type: "aggregator_snippet" },
  W1: { url: "https://nuova.ai/about", type: "company_site" },
};

function collected(over: { city?: string; cityType?: SourceType; founders?: Array<{ name: string; title?: string; bio?: string }>; employees?: number } = {}): CollectedCompany {
  const profile = {
    is_public_company: false, is_tech_company: true,
    profile: {
      description: "Nuova predicts supply-chain disruptions.",
      founded_year: { value: 2023, source_id: "S1", evidence_quote: "founded in 2023" },
      city: over.city ? { value: over.city, source_id: "X", evidence_quote: `based in ${over.city}` } : undefined,
      country: { value: "Israel", source_id: "S1", evidence_quote: "Tel Aviv, Israel-based Nuova" },
      founders: over.founders ?? [
        { name: "Dana Levi", title: "Co-founder & CEO" },
        { name: "Omer Katz", title: "VP Sales", bio: "Omer joined Nuova in 2025 as VP Sales." },
      ],
      sector_name: "AI & ML", sub_sector_names: ["AI Agents"],
    },
    leadership: [{ name: "Ruth Ben", role: "CTO" }],
    metrics: over.employees ? { employee_count: { value: over.employees, source_id: "S1", evidence_quote: `${over.employees} employees` } } : {},
  };
  const rounds = [
    { round_type: "Seed", amount_raised: 8_000_000, announcement_date: "2025-05-10", lead_investor: "Sequoia Capital", other_investors: ["Y Combinator"], source_url: sources.S1.url },
    { round_type: "Pre-Seed", amount_raised: 1_500_000, announcement_date: "2024-01-15", lead_investor: "Y Combinator", other_investors: [], source_url: sources.S2.url },
  ];
  const types: Record<string, SourceType> = { S1: sources.S1.type, S2: sources.S2.type, W1: sources.W1.type, X: over.cityType ?? "press_release" };
  const validation = validateEnrichment({
    existing: { founded_year: null, country: { value: null, is_manually_verified: false }, employee_count: null },
    extracted: {
      founded_year: 2023, city: over.city ?? null, country: "Israel", country_source_type: "press_release",
      employee_count: over.employees ?? null, city_quote: over.city ? `based in ${over.city}` : null, country_quote: "Tel Aviv, Israel-based Nuova",
    },
    rounds,
    totalRaisedUsd: 9_500_000,
  });
  return {
    outcome: "collected",
    profile: profile as unknown as CollectedCompany["profile"],
    funding: { funding_rounds: [], funding_history_complete: true, arr_milestones: [], revenue_estimate: null, valuation_benchmarks: [] } as unknown as CollectedCompany["funding"],
    market: {} as CollectedCompany["market"],
    allSources: Object.keys(types).map((id) => ({ source_id: id })) as unknown as CollectedCompany["allSources"],
    sourceById: new Map(),
    sourceTypeFor: (id) => (id ? types[id] : undefined),
    sourceUrlFor: (id) => (id && id in sources ? sources[id].url : null),
    linkedinFounders: [{ name: "Dana Levi", linkedin_url: "https://www.linkedin.com/in/danalevi" }],
    linkedinLeaders: [],
    existingRefs: [],
    validation,
    plan: planRoundWrites([], validation.acceptedRounds),
    cityConfidence: over.city ? (over.cityType === "model_inferred" ? 0 : 70) : 0,
    countryConfidence: 70,
    domain: "nuova.ai",
  };
}

describe("buildProfile", () => {
  it("every shown value keeps its source and a confidence", () => {
    const p = buildProfile(collected(), "Nuova AI");
    expect(p.overview.founded_year).toEqual({ value: 2023, source_url: sources.S1.url, quote: "founded in 2023", confidence: "high" });
    expect(p.overview.country).toMatchObject({ value: "Israel", source_url: sources.S1.url });
    expect(p.overview.sector).toBe("AI & ML");
    expect(p.overview.sub_sectors).toEqual(["AI Agents"]);
  });
  it("a city below the confidence threshold is withheld, as in the bulk run", () => {
    expect(buildProfile(collected({ city: "Tel Aviv", cityType: "model_inferred" }), "Nuova AI").overview.city).toBeNull();
    expect(buildProfile(collected({ city: "Tel Aviv" }), "Nuova AI").overview.city?.value).toBe("Tel Aviv");
  });
  it("a hired executive listed as founder moves to leadership; LinkedIn adds the founder's profile", () => {
    const p = buildProfile(collected(), "Nuova AI");
    expect(p.people.founders).toEqual([{ name: "Dana Levi", title: "Co-founder & CEO", bio: null, linkedin_url: "https://www.linkedin.com/in/danalevi" }]);
    expect(p.people.leadership.map((l) => l.name).sort()).toEqual(["Omer Katz", "Ruth Ben"]);
  });
  it("rounds newest first, total raised from them, with their sources", () => {
    const p = buildProfile(collected(), "Nuova AI");
    expect(p.funding.rounds.map((r) => [r.round_type, r.date, r.lead_investor, r.source_url])).toEqual([
      ["Seed", "2025-05-10", "Sequoia Capital", sources.S1.url],
      ["Pre-Seed", "2024-01-15", "Y Combinator", sources.S2.url],
    ]);
    expect(p.funding.total_raised).toBe(9_500_000);
    expect(p.funding.history_complete).toBe(true);
  });
  it("headcount only with a sourced figure", () => {
    expect(buildProfile(collected(), "Nuova AI").overview.headcount).toBeNull();
    expect(buildProfile(collected({ employees: 45 }), "Nuova AI").overview.headcount).toMatchObject({ value: 45, source_url: sources.S1.url });
  });
});

describe("investorNames", () => {
  it("every investor once, leads first", () => {
    const { names, led } = investorNames(buildProfile(collected(), "Nuova AI"));
    expect(names).toEqual(["Sequoia Capital", "Y Combinator"]);
    expect([...led].sort()).toEqual(["sequoia capital", "y combinator"]);
  });
});

describe("confidenceOf", () => {
  it("press release high, unknown low", () => {
    expect(confidenceOf("press_release")).toBe("high");
    expect(confidenceOf(undefined)).toBe("low");
  });
});
