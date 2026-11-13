import { describe, it, expect } from "vitest";
import { figureIsBiographical, extractionPointProblem } from "./headcountSources.ts";
import { sameNewsEvent, dedupeNewsEvents } from "./newsRelevance.ts";
import { industryFromTaxonomy } from "./extractProfile.ts";
import { TECH_DEFINITION } from "./techGate.ts";

const taxonomy = { parentNames: ["AI & ML", "Fintech", "Food & Agriculture"], subNames: ["AgTech"], parentOf: { AgTech: "Food & Agriculture" } };

describe("batch 4 dry run — the founder's earlier company is not the company", () => {
  const quote = "(VCi) in 1991 to service the emerging Interactive Voice Response market and led its expansion to over 100 employees in three countries, with revenue in excess of $20 million US";
  it("a sentence about leading another company's expansion is a career", () => {
    expect(figureIsBiographical(quote, true)).toBe(true);
    expect(figureIsBiographical("He founded Acme in 1991 and grew it to 100 employees", true)).toBe(true);
  });
  it("is not kept as a headcount point of Hydrostor", () => {
    const p = { date: "1991-01-01", employee_count: 100, source_id: "S1", evidence_quote: quote } as never;
    expect(extractionPointProblem(p, { url: "https://web.archive.org/web/2010/http://hydrostor.ca/about/", source_type: "company_site" }, "Hydrostor")).not.toBeNull();
  });
  it("a plain company-wide figure still passes", () => {
    expect(figureIsBiographical("We are 120+ employees located all around the world", true)).toBe(false);
  });
});

describe("batch 4 dry run — one story at two outlets is one news item", () => {
  const a = { title: "ESG Firmly on the Agenda as Brazil's AgriTech founder Krilltech Takes Top Spot as KPMG Private Enterprise's First Global Tech Innovator", url: "https://www.businesswire.com/news/home/20211110005831/en/ESG-Firmly-on-the-Agenda-as-Brazils-AgriTech-founder-Krilltech-Takes-Top-Spot-as-KPMG-Private-Enterprises-First-Global-Tech-Innovator", published_date: "2021-11-10" };
  const b = { title: "Krilltech - Brazil Nanobiotech solutions", url: "https://venturebeat.com/technology/esg-firmly-on-the-agenda-as-brazils-agritech-founder-krilltech-takes-top-spot-as-kpmg-private-enterprises-first-global-tech-innovator", published_date: "2021-11-10" };
  it("same day, same words in the headline and the address", () => {
    expect(sameNewsEvent(a, b)).toBe(true);
    expect(dedupeNewsEvents([a, b], () => false)).toHaveLength(1);
  });
  it("different stories on one day stay two", () => {
    const c = { title: "Hydrostor Announces $200 Million in Funding", url: "https://www.businesswire.com/news/home/2025/en/Hydrostor-Announces-200-Million", published_date: "2021-11-10" };
    expect(sameNewsEvent(a, c)).toBe(false);
  });
});

describe("batch 4 dry run — the industry is a sector of the closed list", () => {
  it("free text is not written", () => {
    expect(industryFromTaxonomy("Design & Prototyping Software", null, taxonomy)).toBeNull();
  });
  it("the sector the company was classified into is", () => {
    expect(industryFromTaxonomy("Design & Prototyping Software", "AI & ML", taxonomy)).toBe("AI & ML");
    expect(industryFromTaxonomy("whatever", "AgTech", taxonomy)).toBe("Food & Agriculture");
  });
  it("a model word that is a sector stays", () => {
    expect(industryFromTaxonomy("Fintech", "AI & ML", taxonomy)).toBe("Fintech");
  });
});

describe("batch 4 dry run — the scope of technology", () => {
  it("online-first retail with venture money is in, a product maker that sells online is out", () => {
    expect(TECH_DEFINITION).toContain("online pet shop");
    expect(TECH_DEFINITION).toContain("phone accessories");
  });
});
