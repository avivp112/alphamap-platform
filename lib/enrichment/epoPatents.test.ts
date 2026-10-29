import { describe, it, expect } from "vitest";
import { parseEpoSearch, companyPatents, applicantMatch, applicantQuery, splitApplicant, lookupEpoPatents, type EpoPublication } from "./epoPatents";

/** One exchange-document in OPS's JSON shape, with both applicant forms (epodoc with its [CC] tag, and original). */
function doc(country: string, number: string, kind: string, title: string, applicants: string[], family: string, pubDate = "20220913", appDate = "20200115") {
  return {
    "@country": country, "@doc-number": number, "@kind": kind, "@family-id": family,
    "bibliographic-data": {
      "publication-reference": { "document-id": [{ "@document-id-type": "docdb", country: { $: country }, "doc-number": { $: number }, kind: { $: kind }, date: { $: pubDate } }] },
      "application-reference": { "document-id": { "@document-id-type": "docdb", "doc-number": { $: "16743000" }, date: { $: appDate } } },
      "invention-title": { "@lang": "en", $: title },
      parties: {
        applicants: {
          applicant: applicants.flatMap((a) => [
            { "@data-format": "epodoc", "applicant-name": { name: { $: a } } },
            { "@data-format": "original", "applicant-name": { name: { $: a.replace(/\s*\[[A-Z]{2}\]$/, "") } } },
          ]),
        },
      },
    },
  };
}
const page = (docs: unknown[], total = docs.length) => ({
  "ops:world-patent-data": { "ops:biblio-search": { "@total-result-count": String(total), "ops:search-result": { "exchange-documents": docs.map((d) => ({ "exchange-document": d })) } } },
});

describe("patents come only from the EPO register, as the company's own (run of 2026-10-26)", () => {
  it("never gives 1AHEAD Snap's AR patent — Snap is its applicant", () => {
    const { publications } = parseEpoSearch(page([doc("US", "10102680", "B2", "Image based tracking in augmented reality systems", ["SNAP INC [US]"], "55542411")]));
    const r = companyPatents(publications, { name: "1AHEAD Technologies", countries: ["United States"] });
    expect(r.patents).toEqual([]);
    expect(r.rejected).toEqual([{ number: "US10102680B2", reason: "epo_applicant_not_the_company" }]);
  });

  it("never gives AS0001 a gazette neighbour's FPGA patent", () => {
    const { publications } = parseEpoSearch(page([doc("US", "10169814", "B2", "High speed processing of financial information using FPGA devices", ["IP RESERVOIR LLC [US]"], "40263711")]));
    expect(companyPatents(publications, { name: "AS0001, Inc." }).patents).toEqual([]);
  });

  it("keeps Azumo's own patent with the register's number, link and dates — no mismatched link possible", () => {
    const { publications } = parseEpoSearch(page([doc("US", "11442213", "B2", "Film-based lightguide with extended coupling lightguide region", ["AZUMO INC [US]"], "62625091")]));
    const r = companyPatents(publications, { name: "Azumo, Inc.", countries: ["United States"] });
    expect(r.patents).toEqual([{
      title: "Film-based lightguide with extended coupling lightguide region", patent_number: "US11442213B2",
      filing_date: "2020-01-15", url: "https://worldwide.espacenet.com/patent/search?q=pn%3DUS11442213B2", source: "epo",
    }]);
    expect(r.familyCount).toBe(1);
  });

  it("counts a family once — the US grant and its EP and WO publications are one invention", () => {
    const { publications } = parseEpoSearch(page([
      doc("US", "11442213", "B2", "Film-based lightguide", ["AZUMO INC [US]"], "62625091", "20220913"),
      doc("WO", "2019152024", "A1", "Film-based lightguide", ["AZUMO INC [US]"], "62625091", "20190808"),
      doc("US", "8917962", "B1", "Method of manufacturing a light input coupler", ["AZUMO INC [US]", "SMITH, JOHN [US]"], "47750221", "20141223"),
    ]));
    const r = companyPatents(publications, { name: "Azumo, Inc.", countries: ["United States"] });
    expect(r.familyCount).toBe(2);
    expect(r.patents.map((p) => p.patent_number)).toEqual(["US11442213B2", "US8917962B1"]);
  });

  it("rejects a namesake abroad — the same name with another country's tag", () => {
    const pub: EpoPublication = { number: "DE102021000001A1", title: "x", publicationDate: null, filingDate: null, familyId: "1", applicants: [{ name: "AZUMO GMBH", country: "DE" }] };
    expect(applicantMatch(pub, { name: "Azumo, Inc.", countries: ["United States"] })).toBe("epo_applicant_other_country");
    expect(applicantMatch(pub, { name: "Azumo, Inc.", countries: ["United States", "Germany"] })).toBeNull();
  });

  it("matches the applicant as a whole name — a longer name that contains it is another company", () => {
    const pub: EpoPublication = { number: "US1A1", title: "x", publicationDate: null, filingDate: null, familyId: "1", applicants: [{ name: "BETA AIR LLC", country: "US" }] };
    expect(applicantMatch(pub, { name: "BETA AIR LLC", countries: ["United States"] })).toBeNull();
    expect(applicantMatch({ ...pub, applicants: [{ name: "BETA AIR SUPPLY CO", country: "US" }] }, { name: "BETA AIR LLC", countries: ["United States"] })).toBe("epo_applicant_not_the_company");
  });

  it("reads OPS's single-record shape and the applicant country tag", () => {
    const one = page([doc("EP", "3000000", "A1", "Solo", ["AZUMO INC [US]"], "9")]);
    (one["ops:world-patent-data"]["ops:biblio-search"]["ops:search-result"] as { "exchange-documents": unknown })["exchange-documents"] =
      { "exchange-document": doc("EP", "3000000", "A1", "Solo", ["AZUMO INC [US]"], "9") };
    expect(parseEpoSearch(one).publications[0].applicants).toEqual([{ name: "AZUMO INC", country: "US" }]);
    expect(splitApplicant("SNAP INC [US]")).toEqual({ name: "SNAP INC", country: "US" });
    expect(applicantQuery("Azumo, Inc.")).toBe('pa="Azumo"');
  });

  it("does not look up a name many companies share, or without EPO keys — unknown, not 'no patents'", async () => {
    const never = (() => { throw new Error("no network in this case"); }) as unknown as typeof fetch;
    expect(await lookupEpoPatents({ name: "Apex" }, { key: "k", secret: "s", fetch: never })).toBeNull();
    expect(await lookupEpoPatents({ name: "Azumo, Inc." }, { key: "", secret: "", fetch: never })).toBeNull();
  });

  it("an applicant with no country is the company's only through a fitting office — Zepto (India) and a Japanese 'ZEPTO'", () => {
    const jp: EpoPublication = { number: "JP2017074554A", title: "x", publicationDate: null, filingDate: null, familyId: "1", applicants: [{ name: "ZEPTO", country: null }] };
    expect(applicantMatch(jp, { name: "Zepto", countries: ["India"] })).toBe("epo_applicant_other_country");
    expect(applicantMatch({ ...jp, number: "IN202141000001A" }, { name: "Zepto", countries: ["India"] })).toBeNull();
    expect(applicantMatch({ ...jp, number: "WO2024000001A1" }, { name: "Zepto", countries: ["India"] })).toBeNull();
  });

  it("a name alone is never enough — a company whose country is unknown gets no patents (owner, 2026-10-29)", () => {
    const pub: EpoPublication = { number: "US11442213B2", title: "x", publicationDate: null, filingDate: null, familyId: "1", applicants: [{ name: "AZUMO INC", country: "US" }] };
    expect(applicantMatch(pub, { name: "Azumo, Inc." })).toBe("epo_company_country_unknown");
    expect(applicantMatch(pub, { name: "Azumo, Inc.", countries: [null, undefined] })).toBe("epo_company_country_unknown");
  });
});

