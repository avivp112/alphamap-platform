import { describe, it, expect } from "vitest";
import { waybackHeadcount, type HeadcountIo } from "./headcountCollect";
import { extractionPoints } from "./headcountSources";
import { judgeMark } from "./markRules";
import type { Mark } from "./fieldReview";

/** The pipeline end to end on the review 7 headcount values the owner marked wrong (2026-11-09): collectors, filter, replay. */
const pageIo = (page: string): HeadcountIo => ({
  fetchText: async (url) => (url.endsWith("robots.txt") ? "" : `<html><body>${page}</body></html>`),
  fetchJson: async () => [["urlkey", "timestamp", "original"], ["k", "20230402221834", "https://x.example/about/"]],
});
const archivePage = (company: string, sentence: string) => `${company} about us. ${sentence}`;

describe("archived pages: a number about someone else is not the company's headcount", () => {
  const cases: Array<[string, string, string]> = [
    ["CaPow", "capow.energy", "Fishelov is a Co-Founder of the leading smart energy transfer provider, SolarEdge (S&P 500 listed), where he was responsible for strategic planning, and customer partnerships while managing a team of 300+ engineers."],
    ["Kitov.ai", "kitov.ai", "Prior to joining Kitov, Hanan served as the CEO of Verint Israel and as President of Verint's Security Intelligence business worldwide ($400M in annual revenues, 1200 employees)."],
    ["Kitov.ai", "kitov.ai", "Elas Based in Budapest and has a team of 26 professionals who are providing the sales , installation , trainings and service / support for the customers in Hungary."],
    ["Armorblox", "armorblox.com", "Anand was a founding team member and product manager at Blue Jeans Network, helping to grow it from four employees to 200+ employees and 2,000+ customers."],
    ["BrowserStack", "browserstack.com", "2014 Reached the milestone of 50 employees"],
  ];
  for (const [company, domain, sentence] of cases) {
    it(`${company}: "${sentence.slice(0, 50)}…" gives no point`, async () => {
      const pts = await waybackHeadcount(domain, company, pageIo(archivePage(company, sentence)), { maxSnapshots: 2 });
      expect(pts).toEqual([]);
    });
  }
  it("a sentence that is the company's own is kept (Piiano, Beewise)", async () => {
    const a = await waybackHeadcount("piiano.com", "Piiano", pageIo(archivePage("Piiano", "Based in Tel Aviv, Israel, and now working with a team of 20, Gil and Ariel continue to push the Piiano Paradigm.")), { maxSnapshots: 2 });
    expect(a.map((p) => p.value)).toEqual([20]);
    const b = await waybackHeadcount("beewise.ag", "Beewise", pageIo(archivePage("Beewise", "We are more than 150 people strong, and span the US, Ukraine, Poland, and Israel.")), { maxSnapshots: 2 });
    expect(b.map((p) => p.value)).toEqual([150]);
  });
});

describe("articles and platforms: the extraction's points", () => {
  const src = (url: string, type = "web") => new Map([["S1", { url, source_type: type, content: "", title: "" }]]);
  const pt = (quote: string, n: number) => [{ date: "2026-09", employee_count: n, source_id: "S1", evidence_quote: quote }];
  const platforms = [
    ["https://getlatka.com/companies/affogata.com/vs/iperceptions.com", "Affogata generates $2.4M in revenue with 22 employees, headquartered in San Francisco", 22],
    ["https://tracxn.com/d/companies/pentest-people/__Owq", "Pentest People Latest Employee Count: 80 (As on Mar 31, 2024)", 80],
    ["https://research.crustdata.com/company/engflow", "EngFlow research as of September 2026: 63 employees, org chart, talent flow.", 63],
    ["https://contactout.com/company/Adranos-Inc-61922", "Adranos, Inc. is a Defense & Space company located in West Lafayette with 39 employees", 39],
    ["https://startupim.com/company/datarails", "DataRails 400 employees (2026-09) · 1 point", 400],
    ["https://rocketreach.co/kitovai-profile_b564ee9af639146d", "Kitov located in IL with 28 employees. Find top employees", 28],
  ] as const;
  for (const [url, quote, n] of platforms) {
    it(`${new URL(url).hostname} gives no point`, () => {
      expect(extractionPoints(pt(quote, n), src(url), "Company")).toEqual([]);
    });
  }
  it("a TechCrunch sentence about the company stays (Xflow, Pynt)", () => {
    expect(extractionPoints(pt("The startup currently has about 65 employees as it scales.", 65), src("https://techcrunch.com/2026/02/23/x"), "Xflow")).toHaveLength(1);
  });
  it("the company's own page is site_stated, whatever the extraction called it (BrowserStack)", () => {
    const [p] = extractionPoints(pt("We are BrowserStack and have 800 employees across the globe", 800), src("https://browserstack.com/company", "company_site"), "BrowserStack");
    expect(p.point_type).toBe("site_stated");
  });
});

describe("the replay (field_review_replay) drops each of the 21 marked values by the same rules", () => {
  const m = (company: string, value: string, source_url: string): Mark => ({ id: "x", field: "employee_history", company, value, source_url, verdict: "wrong", source_of_mark: "" }) as Mark;
  const rows: Array<[string, string, string, string]> = [
    ["CaPow", "300+ employees @ 2023-04-02 (site_stated)", "https://web.archive.org/web/20230402221834/https://capow.energy/about/", "Fishelov is a Co-Founder of the leading smart energy transfer provider, SolarEdge (S&P 500 listed), where he was responsible for strategic planning, and customer partnerships while managing a team of 300+ engineers."],
    ["Kitov.ai", "1200 employees @ 2019-07-05 (site_stated)", "https://web.archive.org/web/20190705063956/https://kitov.ai/about/", "Prior to joining Kitov, Hanan served as the CEO of Verint Israel and as President of Verint's Security Intelligence business worldwide ($400M in annual revenues, 1200 employees)."],
    ["Kitov.ai", "26 employees @ 2020-03-13 (site_stated)", "https://web.archive.org/web/20200313051905/https://www.kitov.ai/about/", "Elas Based in Budapest and has a team of 26 professionals who are providing the sales , installation , trainings and service / support for the customers in Hungary."],
    ["Armorblox", "200+ employees @ 2020-05-23 (site_stated)", "https://web.archive.org/web/20200523071535/https://www.armorblox.com/about/", "Anand was a founding team member and product manager at Blue Jeans Network, helping to grow it from four employees to 200+ employees and 2,000+ customers."],
    ["BrowserStack", "50 employees @ 2014 (press_reported)", "https://browserstack.com/company", "2014 📈 Reached the milestone of 50 employees"],
    ["Affogata", "22 employees @ 2026-08-10 (press_reported)", "https://getlatka.com/companies/affogata.com/vs/iperceptions.com", "Date: Aug 10, 2026 — Affogata generates $2.4M in revenue with 22 employees"],
    ["EngFlow", "63 employees @ 2026-09 (press_reported)", "https://research.crustdata.com/company/engflow", "EngFlow research as of September 2026: 63 employees, org chart, talent flow."],
    ["Adranos", "39 employees @ undated (press_reported)", "https://contactout.com/company/Adranos-Inc-61922", "Adranos, Inc. is a Defense & Space company located in West Lafayette, Indiana 47906, US with 39 employees"],
    ["DataRails", "400 employees @ 2026-09 (press_reported)", "https://startupim.com/company/datarails", "400 employees (2026-09) · 1 point"],
  ];
  for (const [c, v, u, q] of rows) it(`${c}: ${v}`, () => expect(judgeMark(m(c, v, u), { quote: q }).produced).toBe(false));
});

import { figureIsJobPosting, quoteStatesLowerBound } from "./headcountSources";
describe("review 8 (2026-11-10): headcount", () => {
  const src = new Map([["S1", { url: "https://venturebeat.com/x", source_type: "web", content: "", title: "" }], ["S2", { url: "https://venturebeat.com/y", source_type: "web", content: "", title: "" }]]);
  it("a team of a job posting is not the company's size (Myndshft)", () => {
    expect(figureIsJobPosting("As the head of a team of 4 Software Engineers, you&#8217;ll translate business requirements into user stories")).toBe(true);
    expect(figureIsJobPosting("Our team of more than 50 scientists and business leaders share the same vision")).toBe(false);
    const p = [{ date: "2019-07", employee_count: 4, source_id: "S1", evidence_quote: "As the head of a team of 4 Software Engineers, you'll translate business requirements" }];
    expect(extractionPoints(p, src, "Myndshft")).toEqual([]);
  });
  it("over N, more than N and N+ are a floor; about and nearly are not (Verbit)", () => {
    expect(quoteStatesLowerBound("Verbit currently employs a team of over 30 across its offices", 30)).toBe(true);
    expect(quoteStatesLowerBound("a team of more than 50 scientists", 50)).toBe(true);
    expect(quoteStatesLowerBound("about 65 employees", 65)).toBe(false);
    const [p] = extractionPoints([{ date: "2019-01-29", employee_count: 30, source_id: "S1", evidence_quote: "Verbit currently employs a team of over 30 across its Tel Aviv and New York offices" }], src, "Verbit");
    expect(p.lower_bound).toBe(true);
  });
  it("the same point twice is one point (Verbit, Ezetap, Stytch)", () => {
    const q = "Verbit currently employs a team of over 30 across its Tel Aviv and New York offices";
    const pts = extractionPoints([{ date: "2019-01-29", employee_count: 30, source_id: "S1", evidence_quote: q }, { date: "2019-01-29", employee_count: 30, source_id: "S2", evidence_quote: q }], src, "Verbit");
    expect(pts).toHaveLength(1);
  });
  it("the replay drops the job-posting point", () => {
    const m = { id: "x", field: "employee_history", company: "Myndshft", value: "4 employees @ 2019-07-23 (site_stated)", source_url: "https://web.archive.org/web/20190723021855/https://www.myndshft.com/careers", verdict: "wrong", source_of_mark: "" } as Mark;
    expect(judgeMark(m, { quote: "As the head of a team of 4 Software Engineers, you&#8217;ll translate business requirements into user stories" }).produced).toBe(false);
  });
});

import { duplicateMarkIds } from "./markRules";
describe("review 8 marks counted against the current rules (2026-11-10)", () => {
  const m = (company: string, value: string, source_url: string): Mark => ({ id: "x", field: "employee_history", company, value, source_url, verdict: "wrong", source_of_mark: "" }) as Mark;
  it("'over 30' marked as 30 is a floor: it is produced as 30+ (Verbit)", () => {
    const q = "Verbit currently employs a team of over 30 across its Tel Aviv and New York offices";
    expect(judgeMark(m("Verbit", "30 employees @ 2019-01-29 (press_reported)", "https://venturebeat.com/business/verbit"), { quote: q }).produced).toBe(false);
    expect(judgeMark(m("Verbit", "30+ employees @ 2019-01-29 (press_reported)", "https://venturebeat.com/business/verbit"), { quote: q }).produced).toBe(true);
    expect(judgeMark(m("Stytch", "27 employees @ 2021-11-18 (press_reported)", "https://www.businessinsider.com/stytch"), { quote: "Stytch currently has 27 employees but will look to grow to more than 150" }).produced).toBe(true);
  });
  it("the same point twice is one mark: the later ones leave", () => {
    const rows = [
      { id: "8.51", field: "employee_history", company: "Verbit", value: "30 employees @ 2019-01-29 (press_reported)" },
      { id: "8.46", field: "employee_history", company: "Ezetap", value: "200 employees @ 2017-08-24 (press_reported)" },
      { id: "8.55", field: "employee_history", company: "Verbit", value: "30 employees @ 2019-01-29 (press_reported)" },
      { id: "8.56", field: "employee_history", company: "Ezetap", value: "200 employees @ 2017-08-24 (press_reported)" },
      { id: "9.1", field: "founder", company: "Verbit", value: "30 employees @ 2019-01-29 (press_reported)" },
    ];
    expect([...duplicateMarkIds(rows)].sort()).toEqual(["8.55", "8.56"]);
  });
});
