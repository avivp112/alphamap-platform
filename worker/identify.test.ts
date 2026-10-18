import { describe, it, expect } from "vitest";
import {
  buildCandidates, domainNameMatch, identifyQuery, nameTokens, parseSiteMeta, rootDomain, runIdentify, titleName,
  type IdentifyInput,
} from "./identify";
import { parseSearch, type SearchResult } from "./search";

const input = (o: Partial<IdentifyInput> = {}): IdentifyInput => ({ name: "Nuova AI", website: null, country: null, founder: null, ...o });
const r = (url: string, title: string, content = "") => ({ url, title, content, provider: "serper" as const, query_label: "check_identify" });
const results = (organic: ReturnType<typeof r>[], kg: SearchResult["knowledgeGraph"] = null): SearchResult => ({ organic, knowledgeGraph: kg });

describe("names and domains", () => {
  it("registrable domain, multi-part suffixes included", () => {
    expect(["blog.acme.co.uk", "www.acme.io", "app.acme.com", "acme.com.au"].map(rootDomain))
      .toEqual(["acme.co.uk", "acme.io", "acme.com", "acme.com.au"]);
  });
  it("the domain must carry the company's name", () => {
    expect(domainNameMatch("nuova.ai", "Nuova AI")).toBe(2);
    expect(domainNameMatch("getnuova.com", "Nuova AI")).toBe(2);
    expect(domainNameMatch("nuova-hq.io", "Nuova AI")).toBe(2);
    expect(domainNameMatch("nuovacapital.com", "Nuova AI")).toBe(1);
    expect(domainNameMatch("blackforestlabs.ai", "Black Forest Labs")).toBe(2);
    expect(domainNameMatch("techcrunch.com", "Nuova AI")).toBe(0);
    expect(domainNameMatch("ai-news.com", "Nuova AI")).toBe(0);   // generic words never match alone
  });
  it("a name of generic words only is matched as a whole", () => {
    expect(nameTokens("AI Labs Inc.")).toEqual({ distinct: [], joined: "ailabs" });
    expect(domainNameMatch("ailabs.com", "AI Labs Inc.")).toBe(2);
    expect(domainNameMatch("labs.com", "AI Labs Inc.")).toBe(0);
  });
  it("the company part of a page title, only when it names the company", () => {
    expect(titleName("Nuova AI | Supply-chain intelligence", "Nuova AI")).toBe("Nuova AI");
    expect(titleName("Nuova AI: supply chains, predicted", "Nuova AI")).toBe("Nuova AI");
    expect(titleName("10 AI tools to watch - Blog", "Nuova AI")).toBeNull();
  });
  it("one query, anchored by what the user gave", () => {
    expect(identifyQuery(input({ website: "https://www.nuova.ai/en" }))).toBe('"Nuova AI" nuova.ai');
    expect(identifyQuery(input({ founder: "Dana Levi", country: "Israel" }))).toBe('"Nuova AI" "Dana Levi" Israel');
  });
});

describe("buildCandidates — found by search", () => {
  const organic = [
    r("https://www.crunchbase.com/organization/nuova-ai", "Nuova AI - Crunchbase Company Profile", "Nuova AI builds…"),
    r("https://www.nuova.ai/", "Nuova AI | Supply-chain intelligence", "Predict supply-chain disruptions weeks ahead."),
    r("https://techcrunch.com/2026/05/nuova-raises", "Nuova AI raises $8M", "Tel Aviv-based Nuova AI…"),
    r("https://nuovacapital.com/", "Nuova Capital", "A family office in Milan."),
    r("https://blog.nuova.ai/launch", "Launching Nuova", "…"),
    r("https://il.linkedin.com/company/nuova-ai", "Nuova AI | LinkedIn", "…"),
  ];
  it("keeps only domains that carry the name; directories, news and LinkedIn drop out; one per domain", () => {
    const c = buildCandidates(input(), results(organic), null);
    expect(c.map((x) => x.domain)).toEqual(["nuova.ai", "nuovacapital.com"]);
    expect(c[0]).toMatchObject({ name: "Nuova AI", website: "https://nuova.ai", source: "search",
      description: "Predict supply-chain disruptions weeks ahead.", location: null, evidence_url: "https://www.nuova.ai/" });
  });
  it("location only from Google's panel for that same website", () => {
    const kg = { title: "Nuova AI", website: "https://www.nuova.ai/", description: "Supply-chain AI company", attributes: { Headquarters: "Tel Aviv, Israel" } };
    const c = buildCandidates(input(), results(organic, kg), null);
    expect(c[0]).toMatchObject({ domain: "nuova.ai", location: "Tel Aviv, Israel" });
    expect(c.find((x) => x.domain === "nuovacapital.com")?.location).toBeNull();
  });
  it("the panel's own website is trusted when its title names the company", () => {
    const kg = { title: "Nuova AI", website: "https://predictchain.com", description: null, attributes: {} };
    expect(buildCandidates(input(), results([], kg), null).map((x) => x.domain)).toEqual(["predictchain.com"]);
    const other = { title: "Predict Chain", website: "https://predictchain.com", description: null, attributes: {} };
    expect(buildCandidates(input(), results([], other), null)).toEqual([]);
  });
  it("nothing that carries the name: no candidates, rather than a guess", () => {
    expect(buildCandidates(input(), results([organic[0], organic[2]]), null)).toEqual([]);
  });
  it("at most four", () => {
    const many = ["nuova.ai", "nuova.io", "getnuova.com", "nuova.co", "trynuova.com", "nuova.dev"].map((d) => r(`https://${d}`, "Nuova AI"));
    expect(buildCandidates(input(), results(many), null)).toHaveLength(4);
  });
});

describe("buildCandidates — the user's own website", () => {
  it("is the one candidate, named and described by the page itself", () => {
    const site = { siteName: "Nuova", title: "Nuova — predict the supply chain", description: "Supply-chain AI for manufacturers." };
    const c = buildCandidates(input({ website: "https://nuova.ai" }), results([r("https://nuovacapital.com", "Nuova Capital")]), site);
    expect(c).toEqual([{ name: "Nuova", website: "https://nuova.ai", domain: "nuova.ai", description: "Supply-chain AI for manufacturers.",
      location: null, source: "your_website", evidence_url: "https://nuova.ai", startup_id: null, startup_name: null }]);
  });
  it("still offered when the site cannot be opened, marked so", () => {
    const c = buildCandidates(input({ website: "https://nuova.ai" }), results([r("https://www.nuova.ai/", "Nuova AI", "From search.")]), null);
    expect(c[0]).toMatchObject({ name: "Nuova AI", description: "From search.", unreachable: true });
  });
});

describe("parsing", () => {
  it("site name, title and description from the page", () => {
    const html = `<html><head><title> Nuova | Home </title><meta property="og:site_name" content="Nuova"><meta name="description" content="Supply-chain AI."></head></html>`;
    expect(parseSiteMeta(html)).toEqual({ siteName: "Nuova", title: "Nuova | Home", description: "Supply-chain AI." });
  });
  it("Serper's knowledge panel is kept, organic results as the enrichment library shapes them", () => {
    const s = parseSearch({ organic: [{ title: "T", link: "https://a.io", snippet: "s" }], knowledgeGraph: { title: "A", website: "https://a.io", attributes: { Founded: "2024" } } }, "x");
    expect(s.organic[0]).toMatchObject({ url: "https://a.io", title: "T", content: "s" });
    expect(s.knowledgeGraph).toEqual({ title: "A", website: "https://a.io", description: null, attributes: { Founded: "2024" } });
    expect(parseSearch({}, "x")).toEqual({ organic: [], knowledgeGraph: null });
  });
});

describe("runIdentify", () => {
  it("one search; a candidate already in AlphaMap is marked so confirming it opens the company", async () => {
    const queries: string[] = [];
    const c = await runIdentify(input(), {
      search: async (q) => { queries.push(q); return results([r("https://nuova.ai", "Nuova AI"), r("https://getnuova.com", "Nuova")]); },
      fetchSite: async () => { throw new Error("not called without a website"); },
      findExisting: async (w) => (w === "https://getnuova.com" ? { id: "s1", name: "Nuova (Getnuova)" } : null),
    });
    expect(queries).toEqual(['"Nuova AI"']);
    expect(c.map((x) => [x.domain, x.startup_id, x.startup_name])).toEqual([["nuova.ai", null, null], ["getnuova.com", "s1", "Nuova (Getnuova)"]]);
  });
});
