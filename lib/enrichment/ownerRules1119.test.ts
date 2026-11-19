import { describe, expect, it } from "vitest";
import { applyRowRules, rowProblem } from "./rowRules.ts";
import { finishNews } from "./newsGate.ts";
const T = "2026-11-19";
const p = (field: string, after: string, quote: string, co: string, url: string, o = {}) => rowProblem({ field, after, quote, source_url: url } as never, co, T, 0, o);
describe("owner rules, batch 8 sample round 2", () => {
  it("a role at another company is not written", () => {
    expect(p("founder", "Will Hodson — Co-Founder", "Will Hodson, Co-Founder – The Big Deal", "Screaming Frog", "https://www.screamingfrog.co.uk/about/")).toMatch(/another company/);
    expect(p("founder", "Matt Hodson — Co-Founder", "Matt Hodson, Co-Founder – Screaming Frog", "Screaming Frog", "https://www.screamingfrog.co.uk/about/")).toBeNull();
  });
  it("a role absent from the quote is not written", () => {
    expect(p("leader", "Alec Dent — COO", "Alec Dent is the co-founder of Weezy", "Weezy", "https://weezy.co.uk/about")).toMatch(/not in its quote/);
    const g = applyRowRules([{ company: "Weezy", field: "founder", after: "Alec Dent — Co-Founder & COO", quote: "Alec Dent is the co-founder of Weezy", source_url: "https://weezy.co.uk/about" }] as never, "Weezy", T);
    expect(g.rows[0].after).toBe("Alec Dent — Co-Founder");
  });
  it("a data platform profile is no round source", () => {
    expect(p("round", "Series A $5M", "Lendbox raised $5M Series A", "Lendbox", "https://inc42.com/company/lendbox/")).toMatch(/profile page/);
  });
  it("a story page does not date a headcount with the run day", () => {
    expect(p("headcount_history", "120 on 2026-11-19", "We are 120", "X", "https://x.com/our-story")).toMatch(/story or history/);
  });
  it("a shared name stands only on the domain on file", () => {
    expect(p("hq_city", "Miami", "Shyft is based in Miami", "Shyft", "https://shyftmoves.com/about", { domain: "https://getshyft.co.za" })).toMatch(/several companies/);
    expect(p("tags", "Fintech", "Shyft by Standard Bank, getshyft.co.za, sends money", "Shyft", "https://news.example/a", { domain: "https://getshyft.co.za" })).toBeNull();
  });
  it("a code date needs a second source within 7 days", () => {
    const d = { isOwnSite: () => false, content: () => "", companyName: "Ionity" };
    const a = { title: "Ionity charging network adds Hyundai partner", url: "https://a.com/1", published_date: "2020-11-10", date_basis: "code" };
    expect(finishNews([a], d).kept).toHaveLength(0);
    const b = { title: "Hyundai joins Ionity charging network partner", url: "https://b.com/2", published_date: "2020-11-12", date_basis: "given" };
    expect(finishNews([a, b], d).kept.length).toBeGreaterThan(0);
  });
});
