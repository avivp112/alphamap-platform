import { describe, it, expect } from "vitest";
import { competitorEvidenceProblem, isListingPage, explanationIsListing } from "./competitorEvidence";
import { buildLabeledSources, classifySourceType, type RawSearchResult } from "./sources";

const raw: RawSearchResult[] = [
  // The 2026-10-26 run: Chalice's Powerlytics and Algocraft came from this LeadIQ page.
  { url: "https://leadiq.com/c/chalice-ai/5f36ed2fa0cf8ca20b588f2e", title: "Chalice AI - Overview, News & Similar companies | LeadIQ", provider: "jina", query_label: "competitors",
    content: "Chalice AI. Advertising Services. Similar companies: Powerlytics, Algocraft, Nano Interactive." },
  { url: "https://www.g2.com/products/ghost/competitors/alternatives", title: "Top Ghost Alternatives", provider: "serper", query_label: "competitors",
    content: "The best Ghost alternatives include Substack, WordPress.com, and Beehiiv. Many creators compare Ghost vs Substack." },
  { url: "https://www.adexchanger.com/data-driven-thinking/custom-bidding-gets-crowded/", title: "Custom Bidding Gets Crowded", provider: "serper", query_label: "competitors",
    content: "Chalice Custom Algorithms is an early rival to Cognitiv in custom bidding for programmatic buyers. Powerlytics is listed as a similar company." },
  { url: "https://www.prnewswire.com/news-releases/1ahead-glo-launch.html", title: "1AHEAD Technologies launches GLO", provider: "serper", query_label: "news",
    content: "CHARLOTTE, N.C. — 1AHEAD Technologies' GLO product directly competes with Ring in AI-driven entry management." },
  { url: "https://adtech-insider-blog.net/2025/chalice-custom-bidding", title: "Custom bidding players", provider: "serper", query_label: "competitors",
    content: "Chalice competes with Cognitiv for programmatic buyers who want custom bidding." },
  { url: "https://www.example-news.com/ai-adtech/top-10-chalice-alternatives", title: "Top 10 Chalice Alternatives in 2026", provider: "serper", query_label: "competitors",
    content: "1. Cognitiv competes with Chalice on custom bidding. 2. Powerlytics." },
];
const sources = buildLabeledSources(raw, "chalice.ai");
const id = (urlPart: string) => sources.find((s) => s.url.includes(urlPart))!.source_id;

describe("a competitor needs a primary source that says it competes (run of 2026-10-26)", () => {
  it("drops Chalice's Powerlytics — LeadIQ's 'similar companies' list is a data platform", () => {
    expect(competitorEvidenceProblem({ name: "Powerlytics", source_id: id("leadiq"), evidence_quote: "Similar companies: Powerlytics, Algocraft" }, sources))
      .toBe("competitor_from_data_platform");
  });

  it("drops a review site's 'alternatives' page and a 'top 10 alternatives' listicle", () => {
    expect(competitorEvidenceProblem({ name: "Substack", source_id: id("g2.com"), evidence_quote: "Many creators compare Ghost vs Substack" }, sources)).toBe("competitor_from_listing");
    expect(competitorEvidenceProblem({ name: "Cognitiv", source_id: id("top-10"), evidence_quote: "Cognitiv competes with Chalice on custom bidding" }, sources)).toBe("competitor_from_listing");
  });

  it("drops 'listed as a similar company' even in an article — that is a listing's words", () => {
    expect(competitorEvidenceProblem({ name: "Powerlytics", source_id: id("adexchanger"), evidence_quote: "Powerlytics is listed as a similar company." }, sources))
      .toBe("competitor_quote_not_explicit");
  });

  it("drops a competitor with no quote, or a quote the source does not contain", () => {
    expect(competitorEvidenceProblem({ name: "Algocraft" }, sources)).toBe("competitor_no_evidence");
    expect(competitorEvidenceProblem({ name: "Cognitiv", source_id: id("adexchanger"), evidence_quote: "Cognitiv competes head-to-head with Chalice" }, sources))
      .toBe("competitor_quote_not_in_source");
  });

  it("keeps a competitor an article or a press release states: Cognitiv for Chalice, Ring for 1AHEAD", () => {
    expect(competitorEvidenceProblem({ name: "Cognitiv", source_id: id("adexchanger"), evidence_quote: "Chalice Custom Algorithms is an early rival to Cognitiv in custom bidding" }, sources)).toBeNull();
    expect(competitorEvidenceProblem({ name: "Ring", source_id: id("prnewswire"), evidence_quote: "1AHEAD Technologies' GLO product directly competes with Ring" }, sources)).toBeNull();
  });

  it("recognises a data platform by any of its subdomains — BETA's debt round came from app.dealroom.co", () => {
    expect(classifySourceType("https://app.dealroom.co/companies/beta_air_1")).toBe("aggregator_snippet");
    expect(classifySourceType("https://flanders.dealroom.co/companies/beta_air_1")).toBe("aggregator_snippet");
    expect(classifySourceType("https://leadiq.com/c/chalice-ai/5f36ed2fa0cf8ca20b588f2e")).toBe("aggregator_snippet");
    expect(classifySourceType("https://www.adexchanger.com/x")).toBe("news");
  });

  it("an article counts only in a trusted outlet — the same sentence on an unknown blog does not (owner, 2026-10-26)", () => {
    expect(competitorEvidenceProblem({ name: "Cognitiv", source_id: id("adtech-insider-blog"), evidence_quote: "Chalice competes with Cognitiv for programmatic buyers" }, sources))
      .toBe("competitor_news_not_trusted");
  });

  it("reads where an explanation on file says the competitor was found — the run's Powerlytics and Algocraft", () => {
    expect(explanationIsListing("Powerlytics is listed as a similar company to Chalice AI in the advertising services space. Both operate in the programmatic advertising and custom algorithm domain.")).toBe(true);
    expect(explanationIsListing("Algocraft is identified as a similar company to Chalice AI in the custom algorithm and advertising services sector.")).toBe(true);
    expect(explanationIsListing("Cognitiv is a competitor in the custom bidding category for programmatic advertising. Like Chalice Custom Algorithms, it provides AI-driven bidding solutions.")).toBe(false);
  });

  it("does not treat the company's own comparison page as a listing", () => {
    expect(isListingPage({ url: "https://ghost.org/vs/substack/", title: "Ghost vs Substack", source_type: "company_site" })).toBe(false);
  });
});

describe("the quote says the COMPANY competes (owner, 2026-11-01: Bolt's blog '…competes with big names like Amazon' was about its merchants)", () => {
  it("names the company, or speaks as 'we / let's' on its own site; never 'helps … compete'", async () => {
    const { quoteIsAboutTheCompany } = await import("./competitorEvidence");
    expect(quoteIsAboutTheCompany("competes with big names like Amazon", "Bolt", true)).toBe(false);
    expect(quoteIsAboutTheCompany("Bolt helps independent retailers compete with Amazon", "Bolt", true)).toBe(false);
    expect(quoteIsAboutTheCompany("Let's look at the competition—first, the heavyweight hardware contender, Fortinet.", "Cato Networks", true)).toBe(true);
    expect(quoteIsAboutTheCompany("Rippling competes with HiBob, Namely, BambooHR, Gusto, and Workday in the HR space.", "HiBob", true)).toBe(true);
    expect(quoteIsAboutTheCompany("Port vs Compass · Port vs Cortex · Port vs OpsLevel", "Port", true)).toBe(true);
    expect(quoteIsAboutTheCompany("competes with big names like Amazon", "Bolt", false)).toBe(false);
  });
});

import { quoteLinksTheTwo, isLinkList } from "./competitorEvidence";
describe("a competitor needs a quote that links it to the company directly (owner, 2026-11-06 — competitor review sheet)", () => {
  const links = (company: string, competitor: string, quote: string) => quoteLinksTheTwo(quote, company, competitor);
  const hibob = "Rippling competes with HiBob, Namely, BambooHR, Gusto, and Workday in the HR space.";
  it("HiBob: Rippling is a rival of HiBob; BambooHR, Gusto and Workday are only Rippling's other rivals", () => {
    expect(links("HiBob", "Rippling", hibob)).toBe(true);
    for (const x of ["BambooHR", "Gusto", "Workday", "Namely"]) expect(links("HiBob", x, hibob)).toBe(false);
  });
  it("the company as the subject, or a party of a comparison, links", () => {
    expect(links("Coralogix", "Datadog", "The observability industry, where Coralogix competes with the likes of Datadog, New Relic, and Splunk")).toBe(true);
    expect(links("Coralogix", "Splunk", "The observability industry, where Coralogix competes with the likes of Datadog, New Relic, and Splunk")).toBe(true);
    expect(links("Zepto", "Blinkit", "Zepto competes with SoftBank-backed Blinkit in India, both of which promise 10-minute deliveries for groceries.")).toBe(true);
    expect(links("Zepto", "Dunzo", "Zepto competes with SoftBank-backed Blinkit in India, both of which promise 10-minute deliveries for groceries. Other rivals including Dunzo,")).toBe(true);
    expect(links("Helsing", "Anduril", "Helsing is a European rival to U.S. startup Anduril which has also received heavy backing")).toBe(true);
    expect(links("Helsing", "Boeing", "Boeing upgrades the Ghost Bat with internal weapons and longer range as it competes with Helsing for German drone orders")).toBe(true);
    expect(links("HiBob", "Namely", "HiBob vs Namely vs Rippling: The top choice for 2026")).toBe(true);
    expect(links("Aidoc", "Zebra Medical Vision", "Aidoc competes with Zebra Medical Vision, which spent three years developing an end-to-end computer vision system")).toBe(true);
  });
  it("a quote that does not name the company is left to the 'about the company' rule", () => {
    expect(links("Cato Networks", "Fortinet", "Let's look at the competition—first, the heavyweight hardware contender, Fortinet.")).toBe(true);
  });
  it("Port: a row of 'X vs Y' links is a menu, not a quote", () => {
    expect(isLinkList("Port vs Compass · Port vs Cortex · Port vs OpsLevel · Port vs Backstage · Roadmap")).toBe(true);
    expect(isLinkList("HiBob vs Namely vs Rippling: The top choice for 2026")).toBe(false);
    expect(isLinkList("Zepto competes with Blinkit in India.")).toBe(false);
  });
  it("end to end: the HiBob and Port quotes are refused, the direct ones kept", () => {
    const src = (url: string, type: "company_site" | "news", content: string) => buildLabeledSources([{ url, title: "t", content, provider: "serper", query_label: "competitors" }]).map((s) => ({ ...s, source_type: type }));
    const hs = src("https://www.hibob.com/blog/hibob-vs-namely-vs-rippling/", "company_site", hibob);
    expect(competitorEvidenceProblem({ name: "BambooHR", source_id: "S1", evidence_quote: hibob }, hs, "HiBob")).toBe("competitor_quote_not_explicit");
    expect(competitorEvidenceProblem({ name: "Rippling", source_id: "S1", evidence_quote: hibob }, hs, "HiBob")).toBeNull();
    const nav = "Port vs Compass · Port vs Cortex · Port vs OpsLevel · Port vs Backstage · Roadmap";
    const ps = src("https://www.port.io/glossary/developer-experience", "company_site", nav);
    expect(competitorEvidenceProblem({ name: "OpsLevel", source_id: "S1", evidence_quote: nav }, ps, "Port")).toBe("competitor_quote_not_explicit");
  });
  it("Bolt: 'competes with big names like Amazon' with no company in it is refused (already the rule; kept as a regression)", () => {
    const s = buildLabeledSources([{ url: "https://www.bolt.com/blog/early-access-bolt-bigcommerce", title: "t", content: "…competes with big names like Amazon", provider: "serper", query_label: "competitors" }]).map((x) => ({ ...x, source_type: "company_site" as const }));
    expect(competitorEvidenceProblem({ name: "Amazon", source_id: "S1", evidence_quote: "competes with big names like Amazon" }, s, "Bolt")).toBe("competitor_quote_not_explicit");
  });
});

import { isUserContentUrl, looksLikeCompanyName as isCompanyName, pageIsAboutAnotherCompany } from "./competitorEvidence";
describe("the competitors sheet of 2026-11-08: forums, names that are no company, a company of the same name", () => {
  it("a forum or a user post is no source, even on the company's own domain (Hailo 33–36, Celonis 26)", () => {
    for (const u of ["https://community.hailo.ai/t/high-resolution-model-compilation-hailo8-vs-hailo10h/18914", "https://community.hailo.ai/t/hailo-version-mismatch-4-23-vs-4-20/18373", "https://community.celonis.com/general-product-q-a-2/celonis-vs-camunda-5210", "https://www.reddit.com/r/devops/comments/abc/x", "https://stackoverflow.com/questions/1/x", "https://forum.example.com/thread/1"]) expect(isUserContentUrl(u), u).toBe(true);
    for (const u of ["https://www.hibob.com/compare/bob-vs-ukg-guide/", "https://snyk.io/comparison/snyk-vs-wiz/", "https://techcrunch.com/2022/05/02/zepto-raises/", "https://www.cyera.com/compare/cyera-vs-varonis", "https://www.parloa.com/knowledge-hub/parloa-vs-decagon/"]) expect(isUserContentUrl(u), u).toBe(false);
  });
  it("names that are no company: a possessive, a lone common word, a version, a figure, a question, a category", () => {
    for (const n of ["India's", "High", "4.20", "126 FPS on PC/RPi5", "Why Bob beats competitors?", "Conventional AI", "EDR / AV", "Prometheus for High Cardinality, Part 1"]) expect(isCompanyName(n), n).toBe(false);
  });
  it("the competitors the owner marked right are companies", () => {
    for (const n of ["Swiggy", "Sumo Logic", "SentinelOne", "HR Cloud", "UKG", "BigID", "Snyk", "Decagon", "Rasa", "Invideo", "Fliki", "Cortex", "Jira", "Chase", "Personio", "Jellyfish", "Phorest", "Varonis", "Proofpoint", "Sentra", "camunda", "Compass", "OpsLevel", "Amazon Web Services"]) expect(isCompanyName(n), n).toBe(true);
  });
  it("Bolt: lovable.dev compares itself to bolt.new, not to Bolt of bolt.com", () => {
    const bolt = "Comparing Bolt vs. Lovable. Bolt.new and Lovable are AI app builders. https://lovable.dev/bolt-vs-lovable";
    expect(pageIsAboutAnotherCompany(bolt, "Bolt", "bolt.com", "Bolt is a one-click checkout for online stores")).toBe(true);
    expect(pageIsAboutAnotherCompany("Comparing Bolt (bolt.com) vs. Lovable", "Bolt", "bolt.com")).toBe(false);
  });
  it("a comparison page that names no domain of the name is not judged; a long page that describes another product is", () => {
    expect(pageIsAboutAnotherCompany("Phorest vs Fresha - Compare Salon & Clinic Software", "Fresha", "fresha.com", "Fresha is a booking platform for salons and spas")).toBe(false);
    const long = "Lovable is a generator of web apps from prompts for developers and founders. ".repeat(20);
    expect(pageIsAboutAnotherCompany(long, "Bolt", "bolt.com", "Bolt provides one-click checkout and payments for online stores and merchants")).toBe(true);
  });
});
