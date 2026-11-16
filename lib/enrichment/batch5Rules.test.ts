import { describe, it, expect } from "vitest";
import { isListingOrSponsoredUrl } from "./pageKind";
import { isExplainer, namesCompanyUpFront, firstParagraph } from "./newsRelevance";
import { judgeNews } from "./newsGate";
import { mergeFoundersByName } from "./people";
import { groundLeadInvestor } from "./assemble";

describe("batch 5, items 5–10 (owner, round 10)", () => {
  it("6/9: tag, list and search pages and sponsored content are no source", () => {
    expect(isListingOrSponsoredUrl("https://www.financemagnates.com/tag/cinkciarzpl/")).toBe("listing_page");
    expect(isListingOrSponsoredUrl("https://news.cision.com/cinkciarz-pl?k=FinTech")).toBe("listing_page");
    expect(isListingOrSponsoredUrl("https://www.businessinsider.com/sc/european-fintech-company-changes-money-transfer-industry-2018-6")).toBe("sponsored_content");
    expect(isListingOrSponsoredUrl("https://www.financemagnates.com/fintech/1200-alleged-victims/")).toBeNull();
  });
  it("7: a guide is an explainer", () => {
    expect(isExplainer("Four rules for choosing a patient/doctor payments system")).toBe(true);
    expect(isExplainer("Payments platform Tyro buys medical fintech startup Medipass")).toBe(false);
  });
  it("5: the company must be in the headline or the first paragraph — after the reader's header", () => {
    const header = "Title: Poland's Żabka Trials 'Jush' Home-Delivery App\nURL Source: https://x\nPublished Time: 2021-10-22\nMarkdown Content:\n";
    const body = "Żabka, the Polish convenience-store chain, is trialling Jush, a quick-delivery app, in Warsaw and several other large cities this autumn, the company said on Friday.\n" + "Elsewhere the group also owns the diet-catering marketplace Dietly.pl and other brands in its portfolio of food services.";
    expect(firstParagraph(header + body)).toMatch(/^Żabka, the Polish/);
    expect(namesCompanyUpFront({ title: "Poland's Żabka Trials 'Jush' Home-Delivery App", content: header + body }, "Dietly")).toBe(false);
  });
  it("5: a date equal to the run day that the article does not carry is an error", async () => {
    const v = await judgeNews({ title: "Żabka przejmuje Dietly", url: "https://mamstartup.pl/zabka-przejmuje-dietly/", published_date: "2026-11-16" }, { companyName: "Dietly", about: "diet catering", content: () => "Żabka przejmuje Dietly. Dietly to...", isOwnSite: () => false, fetchHtml: async () => null, today: "2026-11-16" });
    expect(v.keep).toBe(false);
  });
  it("6: a news item whose address is a tag page is refused", async () => {
    const v = await judgeNews({ title: "Conotoxia news", url: "https://www.financemagnates.com/tag/cinkciarzpl/", published_date: "2026-06-05" }, { companyName: "Conotoxia", about: "", content: () => undefined, isOwnSite: () => false, fetchHtml: async () => null, today: "2026-11-16" });
    expect(v.keep).toBe(false);
  });
  it("8: one founder per person", () => {
    const r = mergeFoundersByName([{ name: "Alastair Mills", title: "Founder" }, { name: "Alastair Mills", title: "Founder and CEO" }]);
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe("Founder and CEO");
  });
  it("10: a lead investor that no cited source names is dropped", () => {
    const src: any = { source_id: "S1", url: "https://www.hyperlatam.com/choiz", title: "Argentina's Choiz Raises USD $1.5M Seed Round", content: "Choiz announced a USD $1.5M seed round." };
    const round: any = { round_type: "Seed", source_url: src.url, lead_investor: { value: "Insud Pharma", source_id: "S1", evidence_quote: "" } };
    expect(groundLeadInvestor(round, [src]).dropped).toBe("Insud Pharma");
    const src2 = { ...src, content: "The round was led by Insud Pharma." };
    expect(groundLeadInvestor(round, [src2]).dropped).toBeNull();
  });
});
