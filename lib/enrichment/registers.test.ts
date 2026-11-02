import { describe, it, expect } from "vitest";
import { matchCompaniesHouse, matchIlRegistrar, matchFormD, parseFormDIssuer, sameEntityName, nameMatch, founderAmong, lookupRegisters, type RegisterContext } from "./registers";
import { profileSourceAllowed } from "./roundSources";

const ctx = (over: Partial<RegisterContext> = {}): RegisterContext => ({ name: "KETS Quantum Security", siteText: "", siteCities: [], ...over });

describe("registers (owner, 2026-11-02): a certain match only — the name AND one more tie", () => {
  it("the name, legal suffixes aside", () => {
    expect(sameEntityName("KETS QUANTUM SECURITY LTD", "KETS Quantum Security")).toBe(true);
    expect(sameEntityName("GUARDZ LTD", "Guardz")).toBe(true);
    expect(sameEntityName("KETS HOLDINGS LTD", "KETS Quantum Security")).toBe(false);
  });

  it("Companies House: the site gives the company number or the registered postcode", () => {
    const item = { title: "KETS QUANTUM SECURITY LTD", company_number: "10239876", company_status: "active", date_of_creation: "2016-06-17", address: { postal_code: "BS1 6QH" }, address_snippet: "Unit DX, Bristol, BS1 6QH" };
    expect(matchCompaniesHouse([item], ctx({ siteText: "KETS Quantum Security Ltd, registered in England and Wales, company no. 10239876" })))
      .toMatchObject({ founded_year: 2016, founding_country: "United Kingdom", match: expect.stringContaining("company number") });
    expect(matchCompaniesHouse([item], ctx({ siteText: "Visit us: Unit DX, St Philips, Bristol BS1 6QH" }))).toMatchObject({ match: expect.stringContaining("postcode") });
    // The name alone is not certain.
    expect(matchCompaniesHouse([item], ctx({ siteText: "Quantum-secure communications." }))).toBeNull();
    // A dissolved namesake never counts.
    expect(matchCompaniesHouse([{ ...item, company_status: "dissolved" }], ctx({ siteText: "company no. 10239876" }))).toBeNull();
  });

  it("the Israeli registrar: the English name, and the company number on the site or the registered city among the site's addresses", () => {
    const row = { "מספר חברה": "516123456", "שם חברה": "גארדז בע\"מ", "שם באנגלית": "GUARDZ LTD", "סטטוס חברה": "פעילה", "תאריך התאגדות": "10/03/2022", "שם עיר": "תל אביב - יפו" };
    expect(matchIlRegistrar([row], ctx({ name: "Guardz", siteCities: ["Tel Aviv"] }))).toMatchObject({ founded_year: 2022, founding_country: "Israel", number: "516123456" });
    expect(matchIlRegistrar([row], ctx({ name: "Guardz", siteText: "Guardz Ltd. (516123456)" }))).toMatchObject({ match: expect.stringContaining("company number") });
    expect(matchIlRegistrar([row], ctx({ name: "Guardz", siteCities: ["New York"] }))).toBeNull();
    expect(matchIlRegistrar([{ ...row, "סטטוס חברה": "מחוקה" }], ctx({ name: "Guardz", siteCities: ["Tel Aviv"] }))).toBeNull();
  });

  const xml = `<edgarSubmission><primaryIssuer><cik>0001889000</cik><entityName>Crossmint, Inc.</entityName><issuerAddress><street1>99 Wall Street</street1><city>New York</city><stateOrCountry>NY</stateOrCountry><zipCode>10005</zipCode></issuerAddress><jurisdictionOfInc>DELAWARE</jurisdictionOfInc><yearOfInc><withinFiveYears>true</withinFiveYears><value>2021</value></yearOfInc></primaryIssuer></edgarSubmission>`;
  it("SEC Form D: the site gives the issuer's street or ZIP; never against a stated non-US founding (a Delaware flip)", () => {
    const issuer = parseFormDIssuer(xml)!;
    expect(issuer).toMatchObject({ entityName: "Crossmint, Inc.", year: 2021, zip: "10005" });
    const c = ctx({ name: "Crossmint", siteText: "Crossmint · 99 Wall Street, New York, NY 10005" });
    expect(matchFormD(issuer, c, "https://sec")).toMatchObject({ founded_year: 2021, founding_country: "United States" });
    expect(matchFormD(issuer, { ...c, statedFoundingCountry: "Israel" }, "https://sec")).toBeNull();
    expect(matchFormD(issuer, { ...c, siteText: "Crossmint, payments for AI agents" }, "https://sec")).toBeNull();
  });

  it("the name plus one generic word (owner, 2026-11-02 — GUARDZ CYBER LTD in the probe) needs a strong tie", () => {
    expect(nameMatch("GUARDZ CYBER LTD", "Guardz")).toBe("plus_one");
    expect(nameMatch("FLYWORKS LTD", "Flyworks Technologies")).toBe("plus_one");
    expect(nameMatch("SODA BUBBLE LABS LTD", "Soda")).toBeNull(); // two words more
    expect(nameMatch("SODA INVESTMENTS LTD", "Soda")).toBeNull(); // not a generic word
    const row = { "מספר חברה": "516588902", "שם באנגלית": "GUARDZ CYBER LTD", "שם חברה": "גארדז סייבר בע\"מ", "סטטוס חברה": "פעילה", "תאריך התאגדות": "29/03/2022", "שם עיר": "גבעתיים" };
    // The probe: registered in Givatayim, the site says Tel Aviv — no tie, no match.
    expect(matchIlRegistrar([row], ctx({ name: "Guardz", siteCities: ["Tel Aviv"] }))).toBeNull();
    expect(matchIlRegistrar([row], ctx({ name: "Guardz", siteCities: ["Givatayim"] }))).toMatchObject({ founded_year: 2022, match: expect.stringContaining("name plus one generic word") });
    expect(matchIlRegistrar([row], ctx({ name: "Guardz", siteText: "© Guardz Cyber Ltd 516588902" }))).toMatchObject({ match: expect.stringContaining("company number") });
  });

  it("a known founder among the register's people — a tie for the same name, and a strong one for name plus one word", () => {
    expect(founderAmong(["Rodrigo Fernández Touza"], ["FERNANDEZ TOUZA, Rodrigo"])).toMatch(/Rodrigo/);
    expect(founderAmong(["Dor Eisner"], ["EISNER, Michal"])).toBeNull();
    const item = { title: "GUARDZ CYBER LTD", company_number: "14000001", company_status: "active", date_of_creation: "2022-04-01", address: { postal_code: "EC1A 1BB", locality: "London" } };
    expect(matchCompaniesHouse([item], ctx({ name: "Guardz", founders: ["Dor Eisner"] }), { "14000001": ["EISNER, Dor"] })).toMatchObject({ match: expect.stringContaining("officer") });
    // Name plus one word: the postcode alone is not a strong tie.
    expect(matchCompaniesHouse([item], ctx({ name: "Guardz", siteText: "London EC1A 1BB" }))).toBeNull();
  });

  it("Form D: Crossmint's related persons tie it although its Orlando address is not on the site", () => {
    const withPeople = xml.replace("</primaryIssuer>", "</primaryIssuer><relatedPersonsList><relatedPersonInfo><relatedPersonName><firstName>Rodrigo</firstName><lastName>Fernandez Touza</lastName></relatedPersonName></relatedPersonInfo></relatedPersonsList>");
    const issuer = parseFormDIssuer(withPeople)!;
    expect(issuer.people).toEqual(["Rodrigo Fernandez Touza"]);
    expect(matchFormD(issuer, ctx({ name: "Crossmint", siteCities: ["Miami", "Madrid"], founders: ["Rodrigo Fernández Touza"] }), "https://sec"))
      .toMatchObject({ match: expect.stringContaining("related person") });
    expect(matchFormD(issuer, ctx({ name: "Crossmint", siteCities: ["Miami"], founders: ["Alfonso Gómez-Jordana"] }), "https://sec")).toBeNull();
  });

  it("the legal name from its legal pages anchors the match (Anonymised is ID Ward Limited)", () => {
    const item = { title: "ID WARD LIMITED", company_number: "10848384", company_status: "active", date_of_creation: "2017-06-29", address: { postal_code: "WC2A 2JR", locality: "London" } };
    expect(matchCompaniesHouse([item], ctx({ name: "Anonymised", siteText: "company number 10848384" }))).toBeNull();
    expect(matchCompaniesHouse([item], ctx({ name: "Anonymised", legalName: "ID Ward Limited", siteText: "company number 10848384" })))
      .toMatchObject({ founded_year: 2017, match: expect.stringContaining("same name") });
  });

  it("a register that fails is skipped, never an error", async () => {
    const io = { env: { COMPANIES_HOUSE_API_KEY: "k" }, fetchJson: async () => { throw new Error("HTTP 500"); }, fetchText: async () => "" };
    const logs: string[] = [];
    await expect(lookupRegisters(ctx(), io, (m) => logs.push(m))).resolves.toEqual([]);
    expect(logs.join(" ")).toMatch(/Companies House lookup failed/);
  });
});

describe("HQ, founded year and founding country only from allowed sources (owner, 2026-11-02 — the 10-company dry run)", () => {
  it("company site, own release, register, tiers 1–3 — not Tracxn, SourceForge or an unlisted site", () => {
    expect(profileSourceAllowed({ url: "https://guardz.com/about", source_type: "company_site" })).toBe(true);
    expect(profileSourceAllowed({ url: "https://find-and-update.company-information.service.gov.uk/company/1", source_type: "registry" })).toBe(true);
    expect(profileSourceAllowed({ url: "https://www.calcalistech.com/ctechnews/article/me21lhfo7", source_type: "news" })).toBe(true);
    expect(profileSourceAllowed({ url: "https://tracxn.com/d/companies/kets-quantum-security/x", source_type: "aggregator_snippet" })).toBe(false);
    expect(profileSourceAllowed({ url: "https://sourceforge.net/software/compare/Anodot-vs-Soda/", source_type: "news" })).toBe(false);
    expect(profileSourceAllowed({ url: "https://www.thecompanycheck.com/company/b/ofbusiness/x", source_type: "news" })).toBe(false);
  });
});
