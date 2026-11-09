import { describe, it, expect } from "vitest";
import { newsProblem, isExplainer, describedProduct } from "./newsRelevance";

const superblocks = "Superblocks is a governed enterprise platform that lets business teams generate AI apps and agents on company data, while IT controls integrations, permissions and code security.";

describe("news that is not about this company (owner, 2026-11-08, review 6)", () => {
  it("Superblocks: Banzai's acquisition of 'AI Web Development and Hosting Platform Superblocks' is another company", () => {
    const title = "Banzai Acquires AI Web Development and Hosting Platform Superblocks";
    expect(describedProduct(title, "", "Superblocks")).toBe("AI Web Development and Hosting Platform");
    expect(newsProblem({ title }, "Superblocks", superblocks)).toBe("different_product");
  });
  it("an article that names the same kind of product is kept, and one that names none is not judged", () => {
    expect(newsProblem({ title: "Acme acquires enterprise app platform Superblocks" }, "Superblocks", superblocks)).toBeNull();
    expect(newsProblem({ title: "Superblocks raises $23M Series A", content: "Superblocks, a platform for internal apps and agents, raised $23 million." }, "Superblocks", superblocks)).toBeNull();
    expect(newsProblem({ title: "Superblocks raises $23M Series A" }, "Superblocks", superblocks)).toBeNull();
  });
  it("the lead can say it too: 'Nova, a hosting provider for websites, …' against an AI security company", () => {
    expect(newsProblem({ title: "Nova raises $5M", content: "Nova, a hosting provider for small websites, raised $5 million." }, "Nova", "Nova predicts vulnerabilities in cloud infrastructure using machine learning.")).toBe("different_product");
  });
  it("a guide or explainer is not news (Solana)", () => {
    expect(isExplainer("What to know before investing in Ethereum competitor Solana (SOL)")).toBe(true);
    expect(newsProblem({ title: "What to know before investing in Ethereum competitor Solana (SOL)" }, "Solana", "Solana is a high-performance network.")).toBe("explainer");
    for (const t of ["Solana raises $314M in funding led by a16z", "Tenable Plans to Acquire Vulcan Cyber", "Nym Health Announces $16.5M Series A Funding"]) expect(isExplainer(t), t).toBe(false);
  });
});

import { stripTrackingParams, namesCompanyUpFront } from "./newsRelevance";
describe("the pilot dry run of 2026-11-08: roundups, passing mentions, tracking parameters", () => {
  const pad = "A long article about early-stage startups, hiring, technical debt and how founders raise money in a bull market. ".repeat(8);
  it("Lightup: a roundup and a 'lessons from founders' piece are not news about it", () => {
    expect(newsProblem({ title: "TechCrunch+ roundup: Slashing technical debt, IPO analysis, your first comms hire", content: pad + " Lightup was mentioned once." }, "Lightup", "Lightup is a data quality platform")).toBe("explainer");
    expect(newsProblem({ title: "Lessons from founders raising their first round in a bull market", content: pad + " Lightup was mentioned once." }, "Lightup", "Lightup is a data quality platform")).toBe("explainer");
  });
  it("an article whose headline and opening never name the company is a passing mention", () => {
    expect(namesCompanyUpFront({ title: "Why founders raise early", content: pad + " Lightup said so." }, "Lightup")).toBe(false);
    expect(newsProblem({ title: "Why founders raise early", content: pad + " Lightup said so." }, "Lightup", "a data quality platform")).toBe("not_about_the_company");
  });
  it("the news the dry run got right stays (headline names the company)", () => {
    for (const [t, c] of [["Data quality startup Lightup nabs $9M in fresh funding", "Lightup"], ["Swan secures €42M to lead Embedded Banking in Europe", "Swan"], ["HeyGen Surpasses $200M ARR as AI Video Adoption Accelerates", "HeyGen"], ["Thriveni Expands Partnership with Empxtrack", "Empxtrack"], ["GetUpside rebrands as Upside, Raises $165M Series D", "Upside"]] as const)
      expect(newsProblem({ title: t, content: pad }, c, "x y z"), t).toBeNull();
  });
  it("tracking parameters leave the address (Speechify's srsltid)", () => {
    expect(stripTrackingParams("https://speechify.com/news/speechify-launches-voice-ai-assistant-ios/?srsltid=AYCX9vK7jeP")).toBe("https://speechify.com/news/speechify-launches-voice-ai-assistant-ios/");
    expect(stripTrackingParams("https://a.com/x?id=3&utm_source=tw&utm_medium=s")).toBe("https://a.com/x?id=3");
    expect(stripTrackingParams("not a url")).toBe("not a url");
  });
});

import { dateFromUrl, dateFromHtml, ownSiteNewsOk, eventKeys, dedupeNewsEvents, namesCompanyUpFront as upFront, newsProblem as problem } from "./newsRelevance";

describe("pilot dry run 2 (owner, 2026-11-09)", () => {
  it("a date is read from the address before a news item is dropped for having none", () => {
    expect(dateFromUrl("https://siliconangle.com/2024/11/06/crowdstrike-acquires-cloud-security-provider-adaptive-shield/")).toBe("2024-11-06");
    expect(dateFromUrl("https://www.businesswire.com/news/home/20240919738626/en/Adaptive-Shield-Honored")).toBe("2024-09-19");
    expect(dateFromUrl("https://www.globenewswire.com/news-release/2026/10/21/3385717/0/en/x.html")).toBe("2026-10-21");
    expect(dateFromUrl("https://www.freightwaves.com/news/datatruck-raises-12m")).toBeNull();
  });
  it("a date is read from the page's code", () => {
    expect(dateFromHtml('<meta property="article:published_time" content="2026-01-28T09:00:00+00:00">')).toBe("2026-01-28");
    expect(dateFromHtml('<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2025-08-13T10:00:00Z"}</script>')).toBe("2025-08-13");
    expect(dateFromHtml('<p>Posted <time datetime="2022-11-09">Nov 9</time></p>')).toBe("2022-11-09");
    expect(dateFromHtml("<html>no date</html>")).toBeNull();
    expect(dateFromHtml('<meta property="article:published_time" content="2999-01-01">')).toBeNull();
  });
  it("a passing mention: the company is in the headline or the first paragraph (Datatruck, Swan)", () => {
    // Datatruck d1.19: no mention up front, and with no text to read the headline alone decides.
    expect(upFront({ title: "IT Park Ventures: The First Venture Investments in Uzbekistan's Startups", content: "" }, "Datatruck")).toBe(false);
    expect(upFront({ title: "IT Park Ventures: The First Venture Investments in Uzbekistan's Startups", content: "IT Park Ventures made its first investments. ".repeat(20) + " Datatruck" }, "Datatruck")).toBe(false);
    // Swan d1.40: the name is only a possessive in the headline of another company's news.
    expect(upFront({ title: "Owen Selects Assurant to Enable Embedded Protection for Swan's Next-Generation Business Cards", content: "Owen, an insurtech, has selected Assurant to underwrite cards. ".repeat(10) }, "Swan")).toBe(false);
    expect(upFront({ title: "Swan secures €42M", content: "" }, "Swan")).toBe(true);
    expect(upFront({ title: "Speechify's new voice typing", content: "" }, "Speechify")).toBe(true);
    expect(upFront({ title: "Funding roundup", content: "Datatruck, a trucking platform, raised $12M." }, "Datatruck")).toBe(true);
    expect(problem({ title: "IT Park Ventures: The First Venture Investments", content: "" }, "Datatruck", "trucking software")).toBe("not_about_the_company");
  });
  it("the company's own site: news / press paths, or a blog post that names it (Appcharge)", () => {
    expect(ownSiteNewsOk("https://empxtrack.com/news/thriveni-expands-partnership-empxtrack/", "Thriveni Expands Partnership with Empxtrack", "Empxtrack")).toBe(true);
    expect(ownSiteNewsOk("https://www.appcharge.com/blog/epic-v-google-the-settlement-is-off-the-table", "Epic v. Google: The Settlement Is Off the Table, and That Is Good for Developers", "Appcharge")).toBe(false);
    expect(ownSiteNewsOk("https://www.heygen.com/blog/heygen-surpasses-200m-arr", "HeyGen Surpasses $200M ARR as AI Video Adoption Accelerates", "HeyGen")).toBe(true);
    expect(ownSiteNewsOk("https://www.swan.io/blog-posts/swan-secures-eu42m", "Swan secures €42M", "Swan")).toBe(false);
    expect(ownSiteNewsOk("https://www.upside.com/newsroom/press-releases/x", "Forbes recognizes Upside", "Upside")).toBe(true);
  });
  it("one row per event: the same amount or acquisition within 7 days, or one undated (Adaptive Shield, Appcharge, HeyGen)", () => {
    expect([...eventKeys("Appcharge Raises $58 Million in Series B Round")]).toEqual(["58m"]);
    expect([...eventKeys("Appcharge raises $58M Series B")]).toEqual(["58m"]);
    expect(eventKeys("CrowdStrike acquires Adaptive Shield in $300M deal").has("acquisition")).toBe(true);
    const own = (u: string) => u.includes("glilotcapital") || u.includes("heygen.com");
    const adaptive = dedupeNewsEvents([
      { title: "CrowdStrike acquires cloud security provider Adaptive Shield", url: "https://siliconangle.com/a", published_date: "2024-11-06" },
      { title: "CrowdStrike acquires Adaptive Shield in $300M deal to boost identity protection", url: "https://calcalistech.com/b", published_date: null },
    ], own);
    expect(adaptive).toHaveLength(1);
    expect(adaptive[0].published_date).toBe("2024-11-06");
    const appcharge = dedupeNewsEvents([
      { title: "Appcharge Raises $58 Million in Series B Round Led by IVP", url: "https://businesswire.com/a", published_date: "2025-08-13" },
      { title: "Appcharge raises $58M Series B as mobile games break from app stores", url: "https://glilotcapital.com/b", published_date: "2025-08-13" },
    ], own);
    expect(appcharge.map((x) => x.url)).toEqual(["https://businesswire.com/a"]);
    // The company's own copy comes first, an outlet's second: the outlet is kept.
    const heygen = dedupeNewsEvents([
      { title: "HeyGen Surpasses $200M ARR as AI Video Adoption Accelerates", url: "https://www.heygen.com/blog/x", published_date: "2026-06-25" },
      { title: "HeyGen Doubles to $200M ARR in Eight Months", url: "https://www.businesswire.com/y", published_date: "2026-06-25" },
    ], own);
    expect(heygen.map((x) => x.url)).toEqual(["https://www.businesswire.com/y"]);
    // Two raises of different size, months apart, stay two.
    expect(dedupeNewsEvents([
      { title: "Appcharge raises $26M", url: "https://a.com/1", published_date: "2024-11-25" },
      { title: "Appcharge raises $58M", url: "https://a.com/2", published_date: "2025-08-13" },
    ], own)).toHaveLength(2);
  });
});
