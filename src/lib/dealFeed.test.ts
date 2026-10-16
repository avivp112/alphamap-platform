import { describe, it, expect } from "vitest";
import { fmtUsd, sanitizeSearch, dealAppLink, soldPct, personLabel, exportColumns, type DealFeedRow } from "./dealFeed";

const row: DealFeedRow = {
  id: "1", kind: "company", name: "Nuova AI Inc.", startup_id: null, candidate_id: "c1", investor_id: null,
  firm_name: null, fund_series: null, deal_date: "2026-10-14", updated_date: "2026-10-14",
  target_amount: 3_000_000, amount_raised: 1_000_000, deal_type: "Form D", sector: "AI & ML",
  industry_group: "Other Technology", country: "United States", review_status: "unreviewed",
  people: [{ name: "Ada Founder", relationships: ["Executive Officer", "Director"] }, { name: " " }],
  source_url: "https://www.sec.gov/Archives/edgar/data/200/000020026000001/",
};

describe("dealFeed helpers", () => {
  it("formats amounts and shows a dash for unknown", () => {
    expect(fmtUsd(12_000_000)).toBe("$12M");
    expect(fmtUsd(2_500_000)).toBe("$2.5M");
    expect(fmtUsd(950_000)).toBe("$950K");
    expect(fmtUsd(null)).toBe("—");
    expect(fmtUsd(0)).toBe("—");
  });

  it("keeps the search box from injecting filter syntax", () => {
    expect(sanitizeSearch("acme,name.eq.x)")).toBe("acme name.eq.x");
    expect(sanitizeSearch("  50%_off*  ")).toBe("50 off");
    expect(sanitizeSearch("Nuova AI")).toBe("Nuova AI");
  });

  it("links a company to its tearsheet, a candidate to its preview, a fund nowhere", () => {
    expect(dealAppLink({ kind: "company", startup_id: "s1", candidate_id: "c1" })).toBe("/startups?company=s1");
    expect(dealAppLink({ kind: "company", startup_id: null, candidate_id: "c1" })).toBe("/candidates/c1");
    expect(dealAppLink({ kind: "fund", startup_id: null, candidate_id: null })).toBeNull();
  });

  it("sold share only when both sides are known", () => {
    expect(soldPct(row)).toBe(33);
    expect(soldPct({ amount_raised: 5, target_amount: null })).toBeNull();
    expect(soldPct({ amount_raised: 9, target_amount: 4 })).toBe(100);
  });

  it("people labels drop blanks", () => {
    expect(personLabel(row.people[0])).toBe("Ada Founder (executive officer, director)");
    expect(personLabel(row.people[1])).toBeNull();
  });

  it("export carries the facts, no invented fields", () => {
    const cols = exportColumns("company");
    const out = Object.fromEntries(cols.map((c) => [c.label, c.value(row)]));
    expect(out).toEqual({
      "Company": "Nuova AI Inc.", "Sector": "AI & ML", "SEC industry": "Other Technology", "Country": "United States",
      "Filing date": "2026-10-14", "Last amended": "", "Amount sold (USD)": 1_000_000, "Offering size (USD)": 3_000_000,
      "Reviewed by AlphaMap": "no", "Related people": "Ada Founder (executive officer, director)",
      "SEC filing": "https://www.sec.gov/Archives/edgar/data/200/000020026000001/",
    });
    expect(exportColumns("fund").map((c) => c.label)).toContain("Firm");
  });
});
