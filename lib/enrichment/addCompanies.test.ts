import { describe, it, expect } from "vitest";
import { parseList, normalizeSite, sortRows, summaryOf, nameKey } from "./addCompanies";

describe("adding companies from a list (owner, 2026-11-13)", () => {
  it("reads a list with a name and a website column, whatever the case, the BOM or the delimiter", () => {
    expect(parseList('﻿Name,Website\nAcme,acme.com\n"Foo, Inc.",https://foo.io/\n').rows).toMatchObject([{ name: "Acme", website: "acme.com", line: 2 }, { name: "Foo, Inc.", website: "https://foo.io/", line: 3 }]);
    expect(parseList("company;site\nA;a.com\nB;b.com").rows.map((r) => r.website)).toEqual(["a.com", "b.com"]);
    expect(parseList("Name,Revenue\nA,1").problem).toMatch(/name and website/);
    expect(parseList("").problem).toMatch(/empty/);
  });
  it("writes a website as https://host, with no www, path or query", () => {
    expect(normalizeSite("WWW.Acme.com/en/about?x=1")?.site).toBe("https://acme.com");
    expect(normalizeSite("http://foo.io")?.site).toBe("https://foo.io");
    expect(normalizeSite("not a site")).toBeNull();
    expect(normalizeSite("localhost")).toBeNull();
    expect(normalizeSite("mailto:a@b.com")).toBeNull();
  });
  it("sorts the rows: new, repeats, known, platforms, no site", () => {
    const rows = [
      { name: "Acme", website: "acme.com", line: 2 }, { name: "Acme Again", website: "https://www.acme.com/x", line: 3 }, { name: "Known", website: "known.io", line: 4 },
      { name: "Renamed Co", website: "renamed.ai", line: 5 }, { name: "Page", website: "linkedin.com/company/page", line: 6 }, { name: "NoSite", website: null, line: 7 },
      { name: "", website: "x.com", line: 8 }, { name: "Fresh Inc.", website: "fresh.dev", line: 9 },
    ];
    const s = sortRows(rows, { hosts: new Set(["known.io"]), names: new Set([nameKey("Renamed Co")]) });
    expect(s.map((x) => x.verdict)).toEqual(["new", "in_file_duplicate", "already_in_database", "name_already_in_database", "not_a_company_site", "no_website", "no_name", "new"]);
    expect(summaryOf(s)[0]).toBe("8 rows");
  });
  it("a company's legal suffix does not hide a name already there", () => {
    expect(nameKey("Fresh Inc.")).toBe(nameKey("Fresh"));
    expect(sortRows([{ name: "Fresh Ltd", website: "fresh.co.uk", line: 2 }], { hosts: new Set(), names: new Set([nameKey("Fresh")]) })[0].verdict).toBe("name_already_in_database");
  });
});
