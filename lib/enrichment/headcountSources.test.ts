import { describe, it, expect } from "vitest";
import { parseIxbrlEmployees, isPayrollProvider, form5500Columns, sizeStatement } from "./headcountSources";

const ixbrl = `
<xbrli:context id="c1"><xbrli:entity/><xbrli:period><xbrli:startDate>2023-01-01</xbrli:startDate><xbrli:endDate>2023-12-31</xbrli:endDate></xbrli:period></xbrli:context>
<xbrli:context id="c0"><xbrli:entity/><xbrli:period><xbrli:startDate>2022-01-01</xbrli:startDate><xbrli:endDate>2022-12-31</xbrli:endDate></xbrli:period></xbrli:context>
<xbrli:context id="cx"><xbrli:entity><xbrli:segment><xbrldi:explicitMember dimension="d">Sales</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:endDate>2023-12-31</xbrli:endDate></xbrli:period></xbrli:context>
<ix:nonFraction name="uk-core:AverageNumberEmployeesDuringPeriod" contextRef="c1" unitRef="u" decimals="0">1,204</ix:nonFraction>
<ix:nonFraction name="uk-core:AverageNumberEmployeesDuringPeriod" contextRef="c0" unitRef="u">980</ix:nonFraction>
<ix:nonFraction name="uk-core:AverageNumberEmployeesDuringPeriod" contextRef="cx" unitRef="u">50</ix:nonFraction>
<ix:nonFraction name="uk-core:Turnover" contextRef="c1">5</ix:nonFraction>`;

describe("Companies House iXBRL: average employees per period end", () => {
  it("one reading per year end, the category-split context skipped, sorted", () => {
    expect(parseIxbrlEmployees(ixbrl)).toEqual([{ date: "2022-12-31", value: 980 }, { date: "2023-12-31", value: 1204 }]);
  });
  it("no employees tag, no readings", () => { expect(parseIxbrlEmployees("<html/>")).toEqual([]); });
});

describe("Form 5500", () => {
  it("payroll and PEO providers are not the company", () => {
    for (const n of ["JUSTWORKS EMPLOYMENT GROUP LLC", "TriNet HR Corporation", "ADP TotalSource Inc", "Insperity PEO Services", "Gusto Inc"]) expect(isPayrollProvider(n)).toBe(true);
    expect(isPayrollProvider("Wayve Technologies Inc")).toBe(false);
  });
  it("finds the columns of the full form and of the short form by header", () => {
    expect(form5500Columns(["ACK_ID", "SPONSOR_DFE_NAME", "SPONS_DFE_EIN", "SPONS_DFE_MAIL_US_STATE", "TOT_ACTIVE_PARTCP_CNT"])).toMatchObject({ sponsor: 1, active: 4, ein: 2, state: 3 });
    expect(form5500Columns(["ACK_ID", "SF_SPONSOR_NAME", "SF_SPONS_EIN", "SF_SPONS_US_STATE", "SF_TOT_ACT_PARTCP_EOY_CNT"])?.sponsor).toBe(1);
    expect(form5500Columns(["a", "b"])).toBeNull();
  });
});

describe("a team-size sentence: past counts and long sentences (review 6, 2026-11-08)", () => {
  it("a figure the text dates to a year belongs to that year (BrowserStack's 2014 milestone), not to the copy's day", () => {
    expect(sizeStatement("2014 📈 Reached the milestone of 50 employees")).toMatchObject({ value: 50, year: 2014 });
    expect(sizeStatement("We grew to 800 employees in 2021.")).toMatchObject({ value: 800, year: 2021 });
  });
  it("a milestone with no year, or several years, has no date: nothing", () => {
    expect(sizeStatement("Reached the milestone of 50 employees")).toBeNull();
    expect(sizeStatement("From 10 employees in 2015 to 200 employees in 2020.")).toBeNull();
  });
  it("a long sentence keeps its number in the excerpt", () => {
    const long = "Fishelov is a co-founder of a leading smart energy transfer provider that was listed on a major index, where he was responsible for strategic planning, partnerships and customer success across several markets and also leads a team of 300+ people today.";
    const st = sizeStatement(long);
    expect(st?.value).toBe(300);
    expect(st?.sentence).toContain("300+");
  });
});

describe("a team-size sentence", () => {
  it("reads 'a team of 200' as exact and '150+ employees' / 'over 100' as lower bounds", () => {
    expect(sizeStatement("We are a team of 200 across three offices.")).toMatchObject({ value: 200, lowerBound: false });
    expect(sizeStatement("Join our 150+ employees worldwide.")).toMatchObject({ value: 150, lowerBound: true });
    expect(sizeStatement("The company has over 100 employees.")).toMatchObject({ value: 100, lowerBound: true });
    expect(sizeStatement("We're 75+ people building security.")).toMatchObject({ value: 75, lowerBound: true });
  });
  it("customers, years and funding are not a team size", () => {
    expect(sizeStatement("Trusted by 10,000 customers in 40 countries.")).toBeNull();
    expect(sizeStatement("Founded in 2015, we raised $50 million.")).toBeNull();
  });
});

import { extractionPointProblem, extractionPoints } from "./headcountSources";
describe("a headcount point the extraction read (review 6, 2026-11-08)", () => {
  const src = (url: string, type = "news_article") => ({ url, source_type: type, content: "", title: "" });
  const pt = (o: Record<string, unknown>) => ({ date: "2021", employee_count: 800, source_id: "S1", evidence_quote: "BrowserStack grew to 800 employees across the globe", ...o });
  it("RocketReach and other data platforms are not a source (Kitov.ai)", () => {
    expect(extractionPointProblem(pt({ evidence_quote: "Kitov.ai employs 19 employees.", employee_count: 19 }), src("https://rocketreach.co/kitovai-management_b564ee9af639146d"), "Kitov.ai")).toBe("source_not_allowed");
  });
  it("a point with no date is not kept", () => {
    expect(extractionPointProblem(pt({ date: "" }), src("https://browserstack.com/company", "company_site"), "BrowserStack")).toBe("undated");
  });
  it("the number must be in the quote, and the quote about the company (CaPow: a quote about SolarEdge)", () => {
    const own = src("https://capow.energy/about", "company_site");
    expect(extractionPointProblem(pt({ employee_count: 300, evidence_quote: "Fishelov is a Co-Founder of SolarEdge, where he was responsible for strategic planning" }), own, "CaPow")).toBe("number_not_in_quote");
    expect(extractionPointProblem(pt({ employee_count: 300, evidence_quote: "Fishelov, co-founder of SolarEdge, now leads 300 people in sales" }), own, "CaPow")).toBe("quote_not_about_the_company");
    expect(extractionPointProblem(pt({ employee_count: 300, evidence_quote: "CaPow now has 300 employees" }), own, "CaPow")).toBeNull();
  });
  it("the company's own site is site_stated, an article press_reported", () => {
    const byId = new Map([["S1", src("https://browserstack.com/company", "company_site")], ["S2", src("https://techcrunch.com/2021/x/", "news_article")]]);
    const out = extractionPoints([pt({}), pt({ source_id: "S2" })], byId as never, "BrowserStack");
    expect(out.map((p) => p.point_type)).toEqual(["site_stated", "press_reported"]);
  });
});
