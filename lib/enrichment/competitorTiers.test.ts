import { describe, it, expect } from "vitest";
import { namesInList, rivalSentenceClaims, vsTitleCompetitor, comparisonTitleCompetitor, vsPageClaims, marketPeerClaims, marketEvidenceProblem, acceptedDeclared } from "./competitorTiers";
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
  it("accepts the company's own page only — not the competitor's own page, not a third site's (owner, round 10)", () => {
    const results = [
      { url: "https://www.port.io/compare/backstage", title: "Port vs Backstage" },
      { url: "https://rippling.com/compare/hibob", title: "Rippling vs HiBob" },
      { url: "https://some-blog.com/hibob-vs-bamboohr", title: "HiBob vs BambooHR" },
    ];
    const sources = srcs(results.map((r) => ({ url: r.url, title: r.title, content: r.title })));
    expect(vsPageClaims(results.slice(0, 1), sources, "Port", "port.io").map((c) => c.name)).toEqual(["Backstage"]);
    expect(vsPageClaims(results.slice(1), sources, "HiBob", "hibob.com").map((c) => c.name)).toEqual([]);
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

import { competitorTierClaims } from "./competitorTiers";
describe("the tiers for one company, searches injected (owner, 2026-11-07)", () => {
  const mk = () => {
    const sources = srcs([{ url: "https://www.hibob.com/blog/x", content: "Rippling competes with HiBob, Namely, BambooHR." }]).map((s) => ({ ...s, source_type: "company_site" as const }));
    const added: Array<{ url: string; label: string }> = [];
    const queries: string[] = [];
    let n = sources.length;
    return {
      sources, added, queries,
      addSource: (r: { url: string; title?: string | null; content?: string | null }, label: string) => { added.push({ url: r.url, label }); return { source_id: `X${++n}`, url: r.url, title: r.title ?? "", content: r.content ?? r.title ?? "", provider: "serper" as const, query_label: label, source_type: label === "vs_page" && r.url.includes("hibob.com") ? "company_site" as const : "news" as const }; },
    };
  };
  it("asks, in order: the company's own vs pages, then the hints — two searches — and finds both kinds", async () => {
    const m = mk();
    const search = async (q: string, label: string) => {
      m.queries.push(`${label}: ${q}`);
      if (label === "vs_own") return [{ url: "https://www.hibob.com/compare/workday", title: "HiBob vs Workday" }];
      if (label === "vs_other") return [{ url: "https://www.paylocity.com/compare/hibob", title: "Paylocity vs HiBob" }];
      return [{ url: "https://techcrunch.com/2026/05/01/hr", title: "HR", content: "HiBob and Gusto are leading players in the mid-market HR software space." }];
    };
    const r = await competitorTierClaims({ companyName: "HiBob", domain: "hibob.com", sources: m.sources, hints: ["Gusto", "Zenefits"], search, addSource: m.addSource, known: new Set(["hibob"]) });
    expect(m.queries.map((q) => q.split(":")[0])).toEqual(["vs_own", "market_peers"]);
    expect(m.queries[0]).toContain("site:hibob.com");
    expect(m.queries[1]).toContain('"Gusto" OR "Zenefits"');
    expect(r.claims.map((c) => [c.name, c.tier]).sort()).toEqual([["Gusto", "market"], ["Rippling", "declared"], ["Workday", "declared"]].sort());
    expect(r.unconfirmedHints).toEqual(["Zenefits"]);
  });
  it("with the extra budget spent (searches return nothing) only the free sentences remain", async () => {
    const m = mk();
    const r = await competitorTierClaims({ companyName: "HiBob", domain: "hibob.com", sources: m.sources, hints: ["Gusto"], search: async () => [], addSource: m.addSource, known: new Set(["hibob"]) });
    expect(r.claims.map((c) => c.name)).toEqual(["Rippling"]);
    expect(r.unconfirmedHints).toEqual(["Gusto"]);
  });
  it("a name already a competitor is not added twice, and a data platform's result is not read", async () => {
    const m = mk();
    const search = async (_q: string, label: string) => (label === "vs_other" ? [{ url: "https://www.crunchbase.com/x", title: "Rippling vs HiBob" }] : []);
    const r = await competitorTierClaims({ companyName: "HiBob", domain: "hibob.com", sources: m.sources, hints: [], search, addSource: m.addSource, known: new Set(["hibob", "rippling"]) });
    expect(r.claims).toEqual([]);
    expect(m.added).toEqual([]);
  });
});

import { looksLikeCompanyName, vsTitleCompetitor as vsTitle } from "./competitorTiers";
describe("the other side of a vs title must be a company (review 6, 2026-11-08)", () => {
  it("a category or a blog title is not one", () => {
    expect(vsTitle("Scylos vs. EDR / AV", "Scylos")).toBeNull();
    expect(vsTitle("ClickHouse vs Prometheus for High Cardinality, Part 1", "ClickHouse")).toBeNull();
  });
  it("a company is", () => {
    expect(vsTitle("ClickHouse vs Snowflake", "ClickHouse")).toBe("Snowflake");
    expect(vsTitle("Aikido vs Pentera", "Pentera")).toBe("Aikido");
    expect(looksLikeCompanyName("Amazon Web Services")).toBe(true);
    expect(looksLikeCompanyName("SecPortal")).toBe(true);
  });
});

import { vsPageClaims as vsClaims } from "./competitorTiers";
describe("a vs page on the competitor's own site needs a known competitor (owner, 2026-11-08: SecPortal)", () => {
  const url = "https://secportal.io/compare/secportal-vs-vulcan-cyber";
  const results = [{ url, title: "SecPortal vs Vulcan Cyber | Delivery Workspace vs Orchestration" }];
  const sources = [{ source_id: "X1", url, title: results[0].title, content: "", source_type: "news_article" }] as never;
  it("an unknown small company's page is dropped", () => {
    expect(vsClaims(results, sources, "Vulcan Cyber", "vulcan.io", () => false)).toEqual([]);
  });
  it("a page on a competitor's own site is no source at all now (owner, round 10)", () => {
    expect(vsClaims(results, sources, "Vulcan Cyber", "vulcan.io", () => true)).toEqual([]);
    expect(vsClaims(results, sources, "Vulcan Cyber", "vulcan.io")).toEqual([]);
  });
  it("the company's own comparison page needs no such check", () => {
    const own = [{ url: "https://vulcan.io/compare/vulcan-vs-kenna", title: "Vulcan Cyber vs Kenna" }];
    const s2 = [{ source_id: "X2", url: own[0].url, title: own[0].title, content: "", source_type: "company_site" }] as never;
    expect(vsClaims(own, s2, "Vulcan Cyber", "vulcan.io", () => false).map((c) => c.name)).toEqual(["Kenna"]);
  });
});

import { vsPageClaims as vsPages, namesInList as listNames } from "./competitorTiers";
describe("the competitors sheet of 2026-11-08 through the tiers", () => {
  it("'India's' is not the name behind 'Swiggy, India's most valuable …'", () => {
    expect(listNames("Swiggy, India's most valuable food delivery startup")).toEqual(["Swiggy"]);
  });
  it("Hailo's community threads are no vs page, even on its own domain", () => {
    const url = "https://community.hailo.ai/t/hailo-yolov8-vs-ultralytics-yolov8/2019";
    const results = [{ url, title: "Hailo Yolov8 vs Ultralytics Yolov8 - General Discussion" }];
    const sources = [{ source_id: "X1", url, title: results[0].title, content: "", source_type: "company_site" }] as never;
    expect(vsPages(results, sources, "Hailo", "hailo.ai")).toEqual([]);
  });
  it("Bolt: lovable.dev's page about bolt.new makes no competitor of Bolt (bolt.com)", () => {
    const url = "https://lovable.dev/bolt-vs-lovable";
    const results = [{ url, title: "Comparing Bolt vs. Lovable", content: "Bolt.new vs Lovable: two AI app builders." }];
    const sources = [{ source_id: "X2", url, title: results[0].title, content: results[0].content, source_type: "news_article" }] as never;
    expect(vsPages(results, sources, "Bolt", "bolt.com", () => true, "Bolt is a one-click checkout for online stores")).toEqual([]);
    // …and no page of another company's site is read at all (owner, round 10)
    expect(vsPages(results, sources, "Bolt", "bolt.new", () => true, "Bolt builds apps with AI")).toEqual([]);
  });
  it("a page on the company's own domain stays (Phorest vs Fresha on phorest.com); the same page seen from Fresha does not", () => {
    const r = [{ url: "https://www.phorest.com/compare/phorest-vs-fresha/", title: "Phorest vs Fresha - Compare Salon & Clinic Software" }];
    const s = [{ source_id: "X3", url: r[0].url, title: r[0].title, content: "", source_type: "company_site" }] as never;
    expect(vsPages(r, s, "Phorest", "phorest.com", () => true, "Phorest is a booking platform for salons").map((c) => c.name)).toEqual(["Fresha"]);
    expect(vsPages(r, s, "Fresha", "fresha.com", () => true, "Fresha is a booking platform for salons")).toEqual([]);
  });
});

describe("own-site comparison pages (owner, round 10)", () => {
  it("names the rival of an 'alternative to' / compare page", () => {
    expect(comparisonTitleCompetitor("Alternative to Backstage", "Port")).toBe("Backstage");
    expect(comparisonTitleCompetitor("Compare Port and Backstage", "Port")).toBe("Backstage");
    expect(comparisonTitleCompetitor("The Backstage alternative | Port", "Port")).toBe("Backstage");
  });
  it("ignores categories", () => {
    expect(comparisonTitleCompetitor("Alternative to spreadsheets", "Port")).toBeNull();
    expect(comparisonTitleCompetitor("A better alternative to traditional banks", "Port")).toBeNull();
  });
});

describe("batch 6 comparison pages (owner, round 10)", () => {
  it("cleans a year and brackets: 'SAMCO Vs Dhan (2026): Which Broker Is Better'", () => {
    expect(vsTitleCompetitor("SAMCO Vs Dhan (2026): Which Broker Is Better For Active Traders", "SAMCO")).toBe("Dhan");
  });
  it("an IPO page, an investment type and a page of another site are no competitor", () => {
    expect(comparisonTitleCompetitor("Gaja Alternative Asset Management Limited IPO Date, Price, Review", "SAMCO")).toBeNull();
    expect(comparisonTitleCompetitor("Compare - StockBasket Vs Real Estate", "SAMCO")).toBeNull();
    const r = [{ url: "https://www.xe.com/compare/mbank-vs-xe/", title: "Compare mBank vs Xe" }];
    const s = [{ source_id: "X1", url: r[0].url, title: r[0].title, content: "", source_type: "news_article" }] as never;
    expect(vsPageClaims(r, s, "MBank", "mbank.ae")).toEqual([]);
  });
});
