import { describe, it, expect } from "vitest";
import { planPatentCleanup, planCompetitorCleanup, planRoundCleanup, type Page } from "./legacyCleanup";

describe("patents: everything read off the web goes; the EPO register's stay (owner, 2026-10-27)", () => {
  it("clears AS0001's gazette patents with their count and fields", () => {
    const r = planPatentCleanup({
      patents: [{ title: "High speed processing of financial information using FPGA", patent_number: "US10169814B2" }, { title: "Print engine", patent_number: null }],
      patent_count: 3, patent_fields: ["Machine Learning"],
    });
    expect(r.patch).toEqual({ patents: [], patent_count: null, patent_fields: [] });
    expect(r.removed).toEqual(["US10169814B2", "Print engine"]);
  });

  it("keeps Azumo's register patents and their count", () => {
    const r = planPatentCleanup({ patents: [{ title: "Film-based lightguide", patent_number: "US11442213B2", source: "epo" }], patent_count: 1, patent_fields: [] });
    expect(r.patch).toEqual({});
  });
});

describe("competitors: listing finds and relationships go, the rest is hidden until the next enrichment", () => {
  const chalice = [
    { name: "Cognitiv", how_it_competes: "Cognitiv is a competitor in the custom bidding category for programmatic advertising. Like Chalice Custom Algorithms, it provides AI-driven bidding solutions." },
    { name: "Index Exchange", how_it_competes: "Index Exchange is an SSP (supply-side platform) that competes with Chalice's containerized RTB approach. Zillow piloted Chalice's custom AI models embedded within Index Exchange's infrastructure, showing how Chalice's intelligence can be integrated into SSP platforms." },
    { name: "Powerlytics", how_it_competes: "Powerlytics is listed as a similar company to Chalice AI in the advertising services space. Both operate in the programmatic advertising and custom algorithm domain." },
    { name: "Algocraft", how_it_competes: "Algocraft is identified as a similar company to Chalice AI in the custom algorithm and advertising services sector." },
  ];

  it("Chalice (2026-10-26): Powerlytics and Algocraft deleted, Index Exchange deleted as a host platform, Cognitiv hidden", () => {
    const r = planCompetitorCleanup(chalice, "Chalice Custom Algorithms, Inc.");
    expect(r.changes.map((c) => [c.name, c.action])).toEqual([
      ["Cognitiv", "hidden_unverified"], ["Index Exchange", "deleted_relationship"], ["Powerlytics", "deleted_listing"], ["Algocraft", "deleted_listing"],
    ]);
    expect(r.competitors).toEqual([{ ...chalice[0], unverified: true }]);
  });

  it("Biotia: Twist Bioscience, a partner, is deleted", () => {
    const r = planCompetitorCleanup([{ name: "Twist Bioscience", how_it_competes: "Twist Bioscience partners with Biotia to provide sequencing-based diagnostic solutions." }], "Biotia, Inc.");
    expect(r.changes[0].action).toBe("deleted_relationship");
    expect(r.competitors).toEqual([]);
  });

  it("leaves a sourced competitor, and one already hidden, as they are", () => {
    const sourced = { name: "Ring", how_it_competes: "Ring makes video doorbells.", source_url: "https://www.prnewswire.com/x" };
    const hidden = { name: "Nest", how_it_competes: "Nest makes doorbells.", unverified: true };
    expect(planCompetitorCleanup([sourced, hidden], "1AHEAD Technologies")).toEqual({ competitors: [sourced, hidden], changes: [] });
  });
});

describe("rounds of 2026-10-26", () => {
  const biotiaPage: Page = {
    title: "Biotia Raises New Oversubscribed $9M Financing and Expands Board",
    text: "NEW YORK — Biotia announced an oversubscribed $9 million financing and expanded its board with healthcare leaders.",
  };
  const pr = "https://www.prnewswire.com/news-releases/biotia-raises-new-oversubscribed-9m-financing-302894904.html";

  it("BETA's $169M debt round, from Dealroom only, is deleted", () => {
    expect(planRoundCleanup(
      { id: "r1", round_type: "Debt", amount_raised: 169_000_000, lead_investor: "Export-Import Bank of the United States", source_url: "https://app.dealroom.co/companies/beta_air_1" },
      [{ column: "amount_raised", source_url: "https://flanders.dealroom.co/companies/beta_air_1", evidence_quote: "Debt $169M" }], new Map(),
    )).toEqual({ action: "delete", reason: "round_only_from_data_platform" });
  });

  it("Biotia's '$9M financing' written as Growth becomes Unknown; the amount stays — the press release backs it", () => {
    const r = planRoundCleanup(
      { id: "r2", round_type: "Growth", amount_raised: 9_000_000, source_url: pr },
      [{ column: "amount_raised", source_url: pr, evidence_quote: "Biotia announced an oversubscribed $9 million financing" }], new Map([[pr, biotiaPage]]),
    );
    expect(r).toEqual({ action: "update", patch: { round_type: "Unknown" }, notes: ['"Growth" is not stated in the source'] });
  });

  it("Azumo's '$30M in funding' written as Series B becomes Unknown, found in the page without a stored quote", () => {
    const url = "https://www.azumotech.com/resource-center/funding";
    const r = planRoundCleanup({ id: "r3", round_type: "Series B", amount_raised: 30_000_000, source_url: url }, [],
      new Map([[url, { title: "$30M in Funding to Fuel Growth of Next Gen LCD 2.0 Display Technology", text: "Azumo announced $30 million in funding led by Anzu Partners to accelerate international expansion." }]]));
    expect(r).toMatchObject({ action: "update", patch: { round_type: "Unknown" } });
  });

  it("Biotia's Series A, stated in the headline, stays as it is", () => {
    const url = "https://www.prnewswire.com/news-releases/biotia-series-a.html";
    expect(planRoundCleanup({ id: "r4", round_type: "Series A", amount_raised: 8_000_000, source_url: url }, [],
      new Map([[url, { title: "Biotia Raises an Oversubscribed $8M Series A", text: "The company raised $8 million led by OCA Ventures." }]]))).toEqual({ action: "keep" });
  });

  it("a type no one can check — page unreadable, no quote — becomes Unknown and says why", () => {
    const url = "https://example-news.com/acme";
    expect(planRoundCleanup({ id: "r5", round_type: "Seed", amount_raised: 2_000_000, source_url: url }, [], new Map([[url, null]])))
      .toEqual({ action: "update", patch: { round_type: "Unknown" }, notes: ['"Seed" is not stated in the source (its page could not be read)'] });
  });

  it("an amount with no source at all is removed", () => {
    expect(planRoundCleanup({ id: "r6", round_type: "Unknown", amount_raised: 5_000_000, source_url: null }, [], new Map()))
      .toEqual({ action: "update", patch: { amount_raised: null }, notes: ["amount has no source"] });
  });
});
