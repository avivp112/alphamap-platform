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
