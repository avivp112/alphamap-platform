import { describe, it, expect } from "vitest";
import { DATA_PLATFORMS, isDataPlatformUrl } from "./dataPlatforms";
import { classifySourceType } from "./sources";
import { clauseProblem } from "./narrative";
import { competitorEvidenceProblem } from "./competitorEvidence";
import { rejectRound } from "./assemble";
import { pickArticlesToRead } from "./articles";
import { buildLabeledSources } from "./sources";

// The platforms the 2026-10-26 run and its cleanup met (owner, 2026-10-28).
const MET = [
  { name: "Owler", url: "https://www.owler.com/company/darkowl", said: "as confirmed by Owler's competitor listing" },
  { name: "RocketReach", url: "https://rocketreach.co/biotia-management_b5c1", said: "according to RocketReach" },
  { name: "GetLatka", url: "https://getlatka.com/companies/apify", said: "per GetLatka" },
  { name: "LeadIQ", url: "https://leadiq.com/c/chalice-ai/5f36ed2fa0cf8ca20b588f2e", said: "listed on LeadIQ" },
];

describe("one list of data platforms, used by every rule (dataPlatforms.ts)", () => {
  it("lists Owler, RocketReach, GetLatka and LeadIQ with their sites", () => {
    for (const p of MET) {
      expect(DATA_PLATFORMS.some((d) => d.name === p.name), p.name).toBe(true);
      expect(isDataPlatformUrl(p.url), p.url).toBe(true);
    }
  });

  it("descriptions: a text that names one loses that clause", () => {
    for (const p of MET) expect(clauseProblem(`Apify is a web scraping platform, ${p.said}.`), p.name).toBe("data_platform");
  });

  it("rounds: one cited only to any of them is not written (Apify's GetLatka 'Seed' rounds)", () => {
    for (const p of MET) {
      const sources = buildLabeledSources([{ url: p.url, title: "", content: "Seed $160K", provider: "serper", query_label: "funding_db" }]);
      expect(classifySourceType(p.url), p.name).toBe("aggregator_snippet");
      expect(rejectRound({ round_type: "Seed", amount_raised: { value: 160_000, source_id: "S1", evidence_quote: "Seed $160K" }, source_url: p.url }, "Apify", sources), p.name)
        .toBe("round_only_from_data_platform");
    }
  });

  it("competitors: none of them is a source that two companies compete", () => {
    for (const p of MET) {
      const sources = buildLabeledSources([{ url: p.url, title: "", content: "DarkOwl competes with KELA.", provider: "serper", query_label: "competitors" }]);
      expect(competitorEvidenceProblem({ name: "KELA", source_id: "S1", evidence_quote: "DarkOwl competes with KELA" }, sources), p.name).toBe("competitor_from_data_platform");
    }
  });

  it("articles: their pages are never read as news; a real article is", () => {
    const results = MET.map((p) => ({ url: p.url, title: "Apify raises funding", content: "Apify raised a Seed round.", provider: "serper" as const, query_label: "funding" }));
    expect(pickArticlesToRead(results, "Apify", "apify.com")).toEqual([]);
    const news = [{ url: "https://techcrunch.com/2025/01/10/apify-raises", title: "Apify raises funding", content: "Apify raised a Seed round.", provider: "serper" as const, query_label: "funding" }];
    expect(pickArticlesToRead([...results, ...news], "Apify", "apify.com").map((r) => r.url)).toEqual(["https://techcrunch.com/2025/01/10/apify-raises"]);
  });
});
