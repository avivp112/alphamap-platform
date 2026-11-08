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
