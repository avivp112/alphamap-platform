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
