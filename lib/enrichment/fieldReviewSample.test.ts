import { describe, it, expect } from "vitest";
import { capPerCompany } from "./fieldReview";

describe("the marking sample (owner, 2026-11-04)", () => {
  it("at most 2 values of one company in a field", () => {
    const xs = [..."aaaaab"].map((c, i) => ({ company_id: c, i }));
    expect(capPerCompany(xs, 2).map((x) => x.company_id)).toEqual(["a", "a", "b"]);
  });
});

import { sameReviewValue, countedMarks, type Mark } from "./fieldReview";
describe("the marks counted against the current rules (owner, 2026-11-04)", () => {
  it("a re-derived value is the marked one", () => {
    expect(sameReviewValue("leader", "Gil Hirsch — Board & Advisor; Founder & CMO, StreamElements", "Gil Hirsch — Board member")).toBe(true);
    expect(sameReviewValue("round", "Other $4M · 2024-03-21", "Other $4.0M · 2022-04-05")).toBe(true);
    expect(sameReviewValue("round", "Debt amount not disclosed · 2024-09-19", "Debt $450.0M · 2024-09-19")).toBe(false);
    expect(sameReviewValue("hq_city", "London", "London")).toBe(true);
    expect(sameReviewValue("office", "Tel Aviv, Israel", "Tel Aviv, Israel")).toBe(true);
    expect(sameReviewValue("patent", "EP4381061A1 SYSTEMS FOR MODULATING", "EP4381061A1 Systems for modulating drug metabolism")).toBe(true);
    expect(sameReviewValue("news", "2025-01-06 — Masttro Appoints Jay McNamara as Chief Executive Officer", "Masttro Appoints Jay McNamara as Chief Executive Officer")).toBe(true);
    expect(sameReviewValue("founded_year", "2019", "2013")).toBe(false);
  });
  it("a mark the current rules no longer produce leaves the count; the rest stay, right or wrong", () => {
    const m = (id: string, verdict: Mark["verdict"]): Mark => ({ id, field: "leader", company: "X", value: "A — CEO", source_url: "", verdict, source_of_mark: "" });
    const marks = [m("1", "correct"), m("2", "wrong"), m("3", "wrong"), m("4", "correct")];
    const counted = countedMarks(marks, new Map([["2", false], ["3", true], ["4", true]]));
    expect(counted.map((x) => x.id)).toEqual(["1", "3", "4"]);
  });
});

import { malformedRows } from "./fieldReview";
import { judgeMark } from "./markRules";
describe("the tracker and the rules-only judgment of a mark (owner, 2026-11-04)", () => {
  it("every row of the tracker has seven columns and a verdict (run 1's 1.35 was read as wrong by a comma)", () => {
    expect(malformedRows()).toEqual([]);
  });
  const m = (field: string, value: string, source_url = "", company = "X") => ({ id: "t", field, company, value, source_url, verdict: "wrong" as const, source_of_mark: "" });
  it("a mark leaves the count only when a rule rejects its value", () => {
    expect(judgeMark(m("leader", "Gil Hirsch — Board & Advisor; Founder & CMO, StreamElements", "https://infinigrow.com/company", "InfiniGrow"), { domain: "infinigrow.com" }).produced).toBe(false);
    expect(judgeMark(m("leader", "Kristina Cross — VP Sales", "https://incredosugar.com/about", "Incredo"), { domain: "incredosugar.com" }).produced).toBe(true);
    expect(judgeMark(m("leader", "Paul Thomas — CEO")).produced).toBe(false); // no source
    expect(judgeMark(m("founder", "GE Healthcare — Founder", "https://insightec.com/x", "Insightec")).produced).toBe(false);
    expect(judgeMark(m("round", "Debt amount not disclosed · 2024-09-19", "https://www.forwardfinancing.com/forward-announces-expanded-450-million-credit-facility/")).produced).toBe(false);
    expect(judgeMark(m("round", "Other $4M · 2024-03-21", "https://siliconangle.com/2024/03/21/redis-acquires-storage-engine-startup-speedb/")).produced).toBe(false);
    expect(judgeMark(m("round", "Other $4M · 2022-04-05", "https://siliconangle.com/2022/04/05/speedb-raises-4m/")).produced).toBe(true);
    // The register page of a company is never a "directory"; a patent is never judged by its source.
    expect(judgeMark(m("founded_year", "2019", "https://find-and-update.company-information.service.gov.uk/company/12014731")).produced).toBe(true);
    expect(judgeMark(m("patent", "EP4381061A1 Systems", "https://worldwide.espacenet.com/patent/search?q=pn%3DEP4381061A1")).produced).toBe(true);
    // A republisher is judged by its text, which is not stored: it stays.
    expect(judgeMark(m("leader", "Ran Strauss — CEO & Co-Founder", "https://www.tradingview.com/news/financewire:d7752dcc1094b:0-leverate/")).produced).toBe(true);
    // An unlisted site may be an investor's: judged only for profile fields, never for news.
    expect(judgeMark(m("news", "Laminar Emerges from Stealth with $32 Million Series A", "https://www.insightpartners.com/ideas/israeli-data-security-startup-laminar/", "Laminar"), { domain: "laminarsecurity.com" }).produced).toBe(true);
    // A company database is denied outright.
    expect(judgeMark(m("founded_year", "2015", "https://startupintros.com/orgs/braincheck")).produced).toBe(false);
  });
});
