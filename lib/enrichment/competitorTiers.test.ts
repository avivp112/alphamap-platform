import { describe, it, expect } from "vitest";
import { namesInList, rivalSentenceClaims, vsTitleCompetitor, vsPageClaims, marketPeerClaims, marketEvidenceProblem, acceptedDeclared } from "./competitorTiers";
import { buildLabeledSources } from "./sources";

const srcs = (items: Array<{ url: string; title?: string; content: string }>) => buildLabeledSources(items.map((i) => ({ title: "t", provider: "serper" as const, query_label: "competitors", ...i })));
const names = (c: Array<{ name: string }>) => c.map((x) => x.name).sort();

describe("a list of names", () => {
  it("reads press lists", () => {
    expect(namesInList("Datadog, New Relic, and Splunk")).toEqual(["Datadog", "New Relic", "Splunk"]);
    expect(namesInList("the likes of Datadog, New Relic and Splunk in India")).toEqual(["Datadog", "New Relic", "Splunk"]);
    expect(namesInList("SoftBank-backed Blinkit in India")).toEqual(["Blinkit"]);
  });
});

describe("rival sentences, with the company as a side of the comparison (owner's sheet rows, 2026-11-06)", () => {
  const claims = (company: string, content: string, url = "https://techcrunch.com/2026/06/03/x") => rivalSentenceClaims(srcs([{ url, content }]), company);
  it("Coralogix competes with Datadog, New Relic and Splunk", () => {
    expect(names(claims("Coralogix", "The observability industry, where Coralogix competes with the likes of Datadog, New Relic, and Splunk, is crowded."))).toEqual(["Datadog", "New Relic", "Splunk"]);
  });
  it("Zepto competes with SoftBank-backed Blinkit", () => {
    expect(names(claims("Zepto", "Zepto competes with SoftBank-backed Blinkit in India, both of which promise 10-minute deliveries."))).toEqual(["Blinkit"]);
  });
  it("Helsing is a European rival to U.S. startup Anduril", () => {
    expect(names(claims("Helsing", "Helsing is a European rival to U.S. startup Anduril which has also received heavy backing."))).toEqual(["Anduril"]);
  });
  it("Boeing competes with Helsing: the rival is the subject", () => {
    expect(names(claims("Helsing", "Boeing upgrades the Ghost Bat with internal weapons and longer range as it competes with Helsing for German drone orders."))).toEqual(["Boeing"]);
  });
  it("HiBob: Rippling competes with HiBob — but BambooHR, Gusto and Workday are Rippling's rivals, not HiBob's", () => {
    expect(names(claims("HiBob", "Rippling competes with HiBob, Namely, BambooHR, Gusto, and Workday in the HR space."))).toEqual(["Rippling"]);
  });
  it("a competitors-include sentence", () => {
    expect(names(claims("Aidoc", "Aidoc's competitors include Zebra Medical Vision and Viz.ai."))).toEqual(["Viz.ai", "Zebra Medical Vision"]);
  });
  it("the company in none of these roles gives nothing", () => {
    expect(claims("Acme", "Datadog competes with New Relic and Splunk.")).toEqual([]);
  });
});

describe("X vs Y pages", () => {
  it("reads the other side of a title", () => {
    expect(vsTitleCompetitor("Port vs Backstage", "Port")).toBe("Backstage");
    expect(vsTitleCompetitor("Backstage vs Port | Compare", "Port")).toBe("Backstage");
    expect(vsTitleCompetitor("HiBob vs Namely vs Rippling: The top choice for 2026", "HiBob")).toBe("Namely");
    expect(vsTitleCompetitor("Port vs Compass · Port vs Cortex · Port vs OpsLevel · Port vs Backstage · Roadmap", "Port")).toBeNull();
    expect(vsTitleCompetitor("Datadog vs Splunk", "Port")).toBeNull();
  });
  it("accepts the company's own page and the competitor's own page, not a third site's", () => {
    const results = [
      { url: "https://www.port.io/compare/backstage", title: "Port vs Backstage" },
      { url: "https://rippling.com/compare/hibob", title: "Rippling vs HiBob" },
      { url: "https://some-blog.com/hibob-vs-bamboohr", title: "HiBob vs BambooHR" },
    ];
    const sources = srcs(results.map((r) => ({ url: r.url, title: r.title, content: r.title })));
    expect(vsPageClaims(results.slice(0, 1), sources, "Port", "port.io").map((c) => c.name)).toEqual(["Backstage"]);
    expect(vsPageClaims(results.slice(1), sources, "HiBob", "hibob.com").map((c) => c.name)).toEqual(["Rippling"]);
  });
});

describe("market competitors: a hint verified by an allowed source that puts both in one market", () => {
  const press = (content: string, url = "https://techcrunch.com/2026/05/01/x") => srcs([{ url, content }]);
  it("keeps a hint when one sentence of tier-2 press names both with a market word", () => {
    const s = press("Synthesia and HeyGen are the best-funded players in the AI video market.");
    const claims = marketPeerClaims(["HeyGen", "Pika"], s, "Synthesia");
    expect(claims.map((c) => [c.name, c.tier])).toEqual([["HeyGen", "market"]]);
    expect(claims[0].evidence_quote).toContain("AI video market");
  });
  it("refuses a data platform, a listing page and a source of tier 4", () => {
    const sentence = "Synthesia and HeyGen are players in the AI video market.";
    for (const url of ["https://www.crunchbase.com/organization/synthesia", "https://www.g2.com/products/synthesia/alternatives", "https://random-blog.example.com/post"]) {
      expect(marketPeerClaims(["HeyGen"], press(sentence, url), "Synthesia")).toEqual([]);
    }
  });
  it("a sentence that names only one of the two is no evidence", () => {
    expect(marketPeerClaims(["HeyGen"], press("Synthesia is a leader in the AI video market."), "Synthesia")).toEqual([]);
  });
  it("marketEvidenceProblem names why", () => {
    const s = press("Synthesia and HeyGen are players in the AI video market.");
    expect(marketEvidenceProblem({ name: "HeyGen", source_id: "S1", evidence_quote: "Synthesia and HeyGen are players in the AI video market." }, s, "Synthesia")).toBeNull();
    expect(marketEvidenceProblem({ name: "HeyGen", source_id: "S1", evidence_quote: "an invented sentence about Synthesia and HeyGen in the market" }, s, "Synthesia")).toBe("market_quote_not_in_source");
  });
});

describe("declared claims pass the same evidence rules as the extraction's own", () => {
  it("keeps Rippling for HiBob from HiBob's own blog and drops a data platform's", () => {
    const s = srcs([{ url: "https://www.hibob.com/blog/x", content: "Rippling competes with HiBob, Namely, BambooHR." }, { url: "https://www.crunchbase.com/organization/hibob", content: "Rippling competes with HiBob." }]).map((x, i) => ({ ...x, source_type: i === 0 ? "company_site" as const : x.source_type }));
    const claims = rivalSentenceClaims(s, "HiBob");
    expect(acceptedDeclared(claims, s, "HiBob").map((c) => c.name)).toEqual(["Rippling"]);
  });
});
