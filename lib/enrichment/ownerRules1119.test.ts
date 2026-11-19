import { describe, expect, it } from "vitest";
import { applyRowRules, rowProblem } from "./rowRules.ts";
const T = "2026-11-19";
const p = (field: string, after: string, quote: string, co: string, url: string, o = {}) => rowProblem({ field, after, quote, source_url: url } as never, co, T, 0, o);
describe("owner rules, batch 8 sample round 2", () => {
  it("a role at another company is not written", () => {
    expect(p("founder", "Will Hodson — Co-Founder", "Will Hodson, Co-Founder – The Big Deal", "Screaming Frog", "https://www.screamingfrog.co.uk/about/")).toMatch(/another company/);
    expect(p("founder", "Matt Hodson — Co-Founder", "Matt Hodson, Co-Founder – Screaming Frog", "Screaming Frog", "https://www.screamingfrog.co.uk/about/")).toBeNull();
  });
  it("a data platform profile is no round source", () => {
    expect(p("round", "Series A $5M", "Lendbox raised $5M Series A", "Lendbox", "https://inc42.com/company/lendbox/")).toMatch(/profile page/);
  });
  it("a story page does not date a headcount with the run day", () => {
    expect(p("headcount_history", "120 on 2026-11-19", "We are 120", "X", "https://x.com/our-story")).toMatch(/story or history/);
  });
  it("a shared name stands only on the domain on file", () => {
    expect(p("hq_city", "Dallas", "Shyft is based in Dallas", "Shyft", "https://shyftdallas.com/about", { domain: "https://getshyft.co.za" })).toMatch(/several companies/);
    expect(p("tags", "Fintech", "Shyft by Standard Bank, getshyft.co.za, sends money", "Shyft", "https://news.example/a", { domain: "https://getshyft.co.za" })).toBeNull();
  });
  it("a shared name: words of the other companies are refused even on the domain", () => {
    expect(p("hq_city", "Miami", "Shyft is based in Miami", "Shyft", "https://getshyft.co.za/about", { domain: "https://getshyft.co.za" })).toMatch(/another company/);
  });
  it("a Debt type needs its words; a round needs a funding quote; a name is clean", () => {
    const g = applyRowRules([{ company: "Nordigen", field: "round", after: "Debt $0.8M · 2017-09-07 · lead Seedcamp", quote: "Nordigen has raised $800,000 from Inventure and Seedcamp", source_url: "https://tech.eu/x",
      payload: JSON.stringify({ round: { round_type: "Debt", lead_investor: "Seedcamp" }, evidence: [] }) }] as never, "Nordigen", T);
    expect(g.rows[0].after).toBe("Unknown $0.8M · 2017-09-07 · lead Seedcamp");
    expect(p("round", "Unknown", "", "Orizuru", "https://x.com/a")).toMatch(/needs a quote/);
    expect(p("name_proposal", 'name = "Lula. We", former_names += "Lulalend"', "", "Lulalend", "https://lula.co.za")).toMatch(/clean brand name/);
    expect(p("founder_background", "Kristof: previous role — McKinsey & Company, consumer goods", "Kristof worked in consumer goods at P&G and McKinsey", "Weezy", "https://x.com")).toMatch(/belongs to P&G/);
  });
});
