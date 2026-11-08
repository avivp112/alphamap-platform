import { describe, it, expect } from "vitest";

import { judgeMark as judge6 } from "./markRules";
import type { Mark } from "./fieldReview";
const m6 = (field: string, company: string, value: string, source_url = "", id = "6.x"): Mark => ({ id, field, company, value, source_url, verdict: "wrong", source_of_mark: "" }) as Mark;
describe("review 6 (2026-11-08): marks the current rules no longer produce", () => {
  it("EngFlow's HQ from the Impressum is an office, not an HQ (6.5, 6.10)", () => {
    for (const f of ["hq_city", "hq_country"]) expect(judge6(m6(f, "EngFlow", "Austin", "https://www.engflow.com/impressum")).produced, f).toBe(false);
    expect(judge6(m6("office", "EngFlow", "Austin, United States", "https://www.engflow.com/impressum")).produced).toBe(true);
  });
  it("headcount: RocketReach, no date, number missing from the quote, a milestone, own page typed as press (6.37–6.41)", () => {
    expect(judge6(m6("employee_history", "Kitov.ai", "19 employees @ undated (press_reported)", "https://rocketreach.co/kitovai-management_b564ee9af639146d")).produced).toBe(false);
    expect(judge6({ ...m6("employee_history", "CaPow", "300+ employees @ 2025-01-30 (site_stated)", "https://web.archive.org/web/20250130221138/https://capow.energy/about/") } as Mark, { quote: "Fishelov is a Co-Founder of the leading smart energy transfer provider, SolarEdge" }).produced).toBe(false);
    expect(judge6(m6("employee_history", "BrowserStack", "50 employees @ 2026-01-17 (site_stated)", "https://web.archive.org/web/20260117013019/https://www.browserstack.com/company"), { quote: "2013 Launched Automate 2014 Reached the milestone of 50 employees 2015 Launched global device cloud" }).produced).toBe(false);
    expect(judge6(m6("employee_history", "BrowserStack", "800 employees @ 2021 (press_reported)", "https://browserstack.com/company"), { quote: "Grew to 800 employees across the globe" }).produced).toBe(false);
  });
  it("a headcount point that is right stays (SeeTree, 6.40)", () => {
    expect(judge6(m6("employee_history", "SeeTree", "40 employees @ 2019-07-22 (site_stated)", "https://web.archive.org/web/20190722082156/https://www.seetree.ai/about"), { quote: "The company is based in Tel Aviv with offices in California and Brazil, and has 40 employees including global experts" }).produced).toBe(true);
  });
  it("tags no sentence supports; a sector at odds with its sub-sector (6.34, 6.35, 6.30)", () => {
    expect(judge6(m6("tags", "BrowserStack", "Developer Tools, Cybersecurity / General"), { quote: "Developer Tools: BrowserStack provides … | Cybersecurity / General: no sentence found" }).produced).toBe(false);
    expect(judge6(m6("sector", "EngFlow", "DeepTech › DevOps / CI-CD")).produced).toBe(false);
    expect(judge6(m6("sector", "BrowserStack", "SaaS & Dev Tools › Developer Tools")).produced).toBe(true);
  });
  it("competitors that are not companies; a guide that is not news (6.59, 6.61, 6.73)", () => {
    expect(judge6(m6("competitor_declared", "Scylos", "EDR / AV", "https://www.scylos.com/compare/edr")).produced).toBe(false);
    expect(judge6(m6("competitor_declared", "ClickHouse", "Prometheus for High Cardinality, Part 1", "https://clickhouse.com/blog/x")).produced).toBe(false);
    expect(judge6(m6("news", "Solana", "2021-11-05 — What to know before investing in Ethereum competitor Solana (SOL)", "https://www.cnbc.com/make-it/2021/11/05/x.html")).produced).toBe(false);
    expect(judge6(m6("news", "Vulcan Cyber", "2025-01-29 — Tenable Plans to Acquire Vulcan Cyber", "https://investors.tenable.com/news-releases/x")).produced).toBe(true);
  });
});
