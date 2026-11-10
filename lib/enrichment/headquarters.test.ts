import { describe, it, expect } from "vitest";
import { hqStatementsIn, decideHeadquarters, contactPageAddresses, quoteSaysHqOf, hqBelongsToAnother, canonicalCity, type HqStatement } from "./headquarters";
import { buildLabeledSources } from "./sources";
import { declaresHeadquarters, validateEnrichment } from "./validation";

const src = (url: string, content: string, title = "") => buildLabeledSources([{ url, title, content, provider: "serper", query_label: "overview" }], "hailo.ai")[0];

describe("the headquarters (owner, 2026-11-01): the company's declaration, else the latest tier 1–3 press; a recent disagreement leaves it empty", () => {
  it("reads '<city>-based' and 'headquartered in' from allowed press about the company — Hailo, Mistral", () => {
    const s = src("https://techcrunch.com/2021/10/12/hailo-raises-136m-ai-chips/", "Tel Aviv-based Hailo raised $136 million for its AI chips.");
    expect(hqStatementsIn(s, "Hailo")).toMatchObject([{ city: "Tel Aviv", kind: "press", date: "2021-10-12" }]);
    expect(hqStatementsIn(src("https://www.reuters.com/x", "Mistral AI, the Paris-based startup, raised €600 million."), "Mistral AI")).toMatchObject([{ city: "Paris" }]);
  });
  it("never from an unlisted site, a regional office, or a sentence about another company", () => {
    expect(hqStatementsIn(src("https://devops.com/x", "Tel Aviv-based Hailo raised $136 million."), "Hailo")).toEqual([]);
    expect(hqStatementsIn(src("https://techcrunch.com/x", "Hailo opened its US headquarters in New York."), "Hailo")).toEqual([]);
    expect(hqStatementsIn(src("https://techcrunch.com/x", "London-based Wayve raised $20 million."), "Hailo")).toEqual([]);
  });
  const st = (city: string, kind: "company" | "press", date: string | null): HqStatement => ({ city, kind, date, quote: `${city}-based`, source_id: "S1", url: "https://x" });
  it("the company's own declaration wins over any press", () => {
    expect(decideHeadquarters([st("New York", "press", "2026-05-01"), st("Tel Aviv", "company", null)], "2026-11-01")).toMatchObject({ kind: "declared", statement: { city: "Tel Aviv" } });
  });
  it("otherwise the latest press; press of the last two years that disagrees → empty, both cities offices", () => {
    expect(decideHeadquarters([st("Tel Aviv", "press", "2021-10-12"), st("Tel Aviv", "press", "2024-04-02")], "2026-11-01")).toMatchObject({ kind: "declared", statement: { date: "2024-04-02" } });
    expect(decideHeadquarters([st("New York", "press", "2026-01-10"), st("Tel Aviv", "press", "2025-06-01")], "2026-11-01")).toMatchObject({ kind: "conflict" });
    // An old disagreement is history: the latest recent one stands.
    expect(decideHeadquarters([st("Tel Aviv", "press", "2019-01-10"), st("New York", "press", "2026-02-01")], "2026-11-01")).toMatchObject({ kind: "declared", statement: { city: "New York" } });
    expect(decideHeadquarters([], "2026-11-01")).toEqual({ kind: "none" });
  });
  it("the site lists several offices, no HQ, and the press is older than two years → empty (owner, 2026-11-02: Aidoc)", () => {
    const sites = ["New York", "Tel Aviv"];
    // Aidoc: a 2022 (or undated) "Tel Aviv-based" does not outweigh the site of today.
    expect(decideHeadquarters([st("Tel Aviv", "press", "2022-06-16")], "2026-11-02", sites)).toEqual({ kind: "site_offices", cities: sites });
    expect(decideHeadquarters([st("Tel Aviv", "press", null)], "2026-11-02", sites)).toMatchObject({ kind: "site_offices" });
    // Recent press still decides; one office on the site is not "several".
    expect(decideHeadquarters([st("Tel Aviv", "press", "2026-03-01")], "2026-11-02", sites)).toMatchObject({ kind: "declared", statement: { city: "Tel Aviv" } });
    expect(decideHeadquarters([st("Tel Aviv", "press", "2022-06-16")], "2026-11-02", ["Tel Aviv", "tel aviv"])).toMatchObject({ kind: "declared" });
    // The company's own declaration still wins.
    expect(decideHeadquarters([st("New York", "company", null)], "2026-11-02", sites)).toMatchObject({ kind: "declared", statement: { city: "New York" } });
  });
  it("'Headquartered in <city>, …, <Company>'s team' — the company's own release (Photonic, dry run 2026-11-02)", () => {
    const s = src("https://www.globenewswire.com/news-release/2026/05/12/3293143/0/en/photonic-inc-closes.html",
      "Headquartered in Vancouver, British Columbia, with operations in the United States and United Kingdom,Photonic’s team of 160+ experts is advancing quantum technologies.");
    expect(hqStatementsIn(s, "Photonic")).toMatchObject([{ city: "Vancouver" }]);
    // Another company as the subject is not the company's HQ.
    expect(hqStatementsIn(src("https://www.globenewswire.com/x", "Headquartered in Toronto, investor BCI backed Photonic in 2023."), "Photonic")).toEqual([]);
  });
  it("the apposition is the noun right before ', a <City>-based' — not a company named earlier (EnerVenue / Avid Group, model check 2026-11-02)", () => {
    const s1 = src("https://www.globenewswire.com/news-release/2024/08/27/x.html", "EnerVenue signed a master supply agreement with Avid Group, a Perth-based energy installer.");
    expect(hqStatementsIn(s1, "EnerVenue")).toEqual([]);
    expect(hqStatementsIn(src("https://www.reuters.com/x", "Mistral AI, the Paris-based startup, raised €600 million."), "Mistral AI")).toMatchObject([{ city: "Paris" }]);
  });
  it("the model's own HQ quote must be about the company (EnerVenue's 'Avid Group, a Perth-based …')", () => {
    const q = "EnerVenue signed a master supply agreement with Avid Group, a Perth-based energy installer.";
    expect(quoteSaysHqOf(q, "Perth", "EnerVenue", false)).toBe(false);
    expect(hqBelongsToAnother(q, "Perth", "EnerVenue")).toBe(true);
    expect(quoteSaysHqOf("Fremont-based EnerVenue makes nickel-hydrogen batteries.", "Fremont", "EnerVenue", false)).toBe(true);
    expect(hqBelongsToAnother("Fremont-based EnerVenue makes batteries.", "Fremont", "EnerVenue")).toBe(false);
    expect(hqBelongsToAnother("Headquarters: Fremont, California", "Fremont", "EnerVenue")).toBe(false);
  });
  it("'<Other>, headquartered in <City>' is the other company's HQ, even when the company is named earlier", () => {
    expect(hqStatementsIn(src("https://www.globenewswire.com/news-release/2024/08/27/x.html", "EnerVenue today announced a supply agreement with Avid Group, headquartered in Perth, to expand in Australia."), "EnerVenue")).toEqual([]);
    expect(hqStatementsIn(src("https://www.globenewswire.com/news-release/2024/08/27/x.html", "EnerVenue, headquartered in Fremont, makes nickel-hydrogen batteries."), "EnerVenue")).toMatchObject([{ city: "Fremont" }]);
    expect(hqStatementsIn(src("https://www.reuters.com/x", "Mistral AI is headquartered in Paris."), "Mistral AI")).toMatchObject([{ city: "Paris" }]);
  });
  it("'The Perth-based energy solutions provider plans to install EnerVenue's …' is not EnerVenue's HQ (its GlobeNewswire release)", () => {
    expect(hqStatementsIn(src("https://www.globenewswire.com/news-release/2024/08/27/x.html", "The Perth-based energy solutions provider plans to install EnerVenue's high-efficiency batteries."), "EnerVenue")).toEqual([]);
    expect(hqStatementsIn(src("https://techcrunch.com/x", "Tel Aviv-based chipmaker Hailo raised $136 million."), "Hailo")).toMatchObject([{ city: "Tel Aviv" }]);
  });
  it("validation takes the HQ the decision took, without an HQ word in its quote (Anonymised's Contact page)", () => {
    const v = validateEnrichment({ existing: { founded_year: null, country: { value: null, is_manually_verified: false }, employee_count: null },
      extracted: { founded_year: null, city: "London", country: "United Kingdom", city_quote: "7 Bell Yard, London WC2A 2JR", country_quote: "7 Bell Yard, London WC2A 2JR", city_source_type: "company_site", country_source_type: "company_site", hq_decided: true, employee_count: null },
      rounds: [], totalRaisedUsd: null } as never);
    expect(v.accepted.city).toBe("London");
  });
  it("the page /contact rendered counts as the Contact page (Soda's /contact is its /about)", () => {
    expect(contactPageAddresses({ url: "https://soda.io/about", also_urls: ["https://soda.io/company", "https://soda.io/contact"], content: "Soda Data NV\nRue Picard 7 / 100 1000 Brussels, Belgium", source_type: "company_site", source_id: "W2" }))
      .toMatchObject([{ city: "Brussels" }]);
  });
  it("a link to another company's site is not an address (Koi's 'return to main Palo Alto Networks site')", () => {
    const page = { url: "https://koi.security/contact", content: "![Image 4: white arrow icon pointing left to return to main Palo Alto Networks site](https://www.paloaltonetworks.com/x)", source_type: "company_site" as const, source_id: "W2" };
    expect(contactPageAddresses(page)).toEqual([]);
    expect(contactPageAddresses({ ...page, content: "Visit Palo Alto Networks, 3000 Tannery Way" })).toEqual([]);
    expect(contactPageAddresses({ ...page, content: "Koi Security, 3 Rothschild Blvd, Tel Aviv, Israel" })).toMatchObject([{ city: "Tel Aviv" }]);
  });
  it("a street named after a city is not the city ('46430 Fremont Blvd')", () => {
    const page = { url: "https://enervenue.com/contact", content: "Visit us\n46430 Fremont Blvd", source_type: "company_site" as const, source_id: "W3" };
    expect(contactPageAddresses(page)).toEqual([]);
    expect(contactPageAddresses({ ...page, content: "46430 Fremont Blvd\nFremont, CA 94538" })).toMatchObject([{ city: "Fremont" }]);
  });
  it("one street address on the Contact page is the headquarters (owner, 2026-11-02); a list of offices is not one", () => {
    const page = (content: string, url = "https://kets-quantum.com/contact") => ({ url, content, source_type: "company_site" as const, source_id: "W3" });
    expect(contactPageAddresses(page("Get in touch\nKETS Quantum Security\nUnit DX, St Philips Central, Bristol BS2 0QR\nhello@kets-quantum.com")))
      .toMatchObject([{ city: "Bristol", kind: "company" }]);
    expect(contactPageAddresses(page("Offices\n1674 Broadway, New York, NY 10019\nHamasger 34, Tel Aviv"))).toHaveLength(2);
    // Not the Contact page, or no street on the line.
    expect(contactPageAddresses(page("Unit DX, Bristol BS2 0QR", "https://kets-quantum.com/about"))).toEqual([]);
    expect(contactPageAddresses(page("We work with teams in Bristol and beyond."))).toEqual([]);
  });
  it("Bangalore and Bengaluru are one city — no 'conflict' between them (Unacademy, field review run 1)", () => {
    expect(canonicalCity("Bangalore")).toBe(canonicalCity("Bengaluru"));
    expect(decideHeadquarters([st("Bangalore", "press", "2025-09-02"), st("Bengaluru", "press", "2026-01-10")], "2026-11-02")).toMatchObject({ kind: "declared" });
  });
  it("validation accepts an HQ declared in the press of tiers 1–3, not in an unlisted site", () => {
    expect(declaresHeadquarters("Tel Aviv-based Hailo", "news", "https://techcrunch.com/x")).toBe(true);
    expect(declaresHeadquarters("Tel Aviv-based Hailo", "news", "https://devops.com/x")).toBe(false);
    expect(declaresHeadquarters("offices in Tel Aviv", "company_site", null)).toBe(false);
  });
});

describe("the HQ phrase must be about THIS company (Fresha's blog gave 'Paris', an investor's HQ — eval of 2026-11-01)", () => {
  it("another company's '<city>-based' or 'headquartered in' in the same sentence is not the company's", () => {
    const s = buildLabeledSources([{ url: "https://www.fresha.com/blog/general-atlantic-lead-100m-in-freshas-future", title: "",
      content: "Fresha raised $100 million led by General Atlantic, with Paris-based Partech joining the round.", provider: "jina", query_label: "website" }], "fresha.com")[0];
    expect(hqStatementsIn(s, "Fresha")).toEqual([]);
    const own = buildLabeledSources([{ url: "https://www.fresha.com/about", title: "", content: "We are headquartered in London, with teams across Europe.", provider: "jina", query_label: "website" }], "fresha.com")[0];
    expect(hqStatementsIn(own, "Fresha")).toMatchObject([{ city: "London", kind: "company" }]);
    expect(hqStatementsIn(src("https://techcrunch.com/x", "Hailo, headquartered in Tel Aviv, raised $120 million."), "Hailo")).toMatchObject([{ city: "Tel Aviv" }]);
  });
});

import { isLegalPageUrl, hqStatementsIn as hqIn, statementKind as kindOf } from "./headquarters";
describe("a legal page's address is an office, not the headquarters (owner, 2026-11-08: EngFlow)", () => {
  const impressum = { source_id: "W3", source_type: "company_site", url: "https://www.engflow.com/impressum", title: "Impressum",
    content: "EngFlow Inc. is a Delaware corporation based in the US at 2025 Guadalupe Street, Suite 260, Austin, TX 78705." } as never;
  it("knows legal pages", () => {
    for (const u of ["https://x.com/impressum", "https://x.com/legal", "https://x.com/terms-of-service", "https://x.com/privacy", "https://x.com/legal/terms", "https://x.com/imprint"]) expect(isLegalPageUrl(u), u).toBe(true);
    for (const u of ["https://x.com/about", "https://x.com/contact", "https://x.com/company/team", "https://x.com/blog/legal-tech-trends"]) expect(isLegalPageUrl(u), u).toBe(false);
  });
  it("the impressum's 'based in … Austin' is not an HQ statement", () => {
    expect(kindOf(impressum)).toBeNull();
    expect(hqIn(impressum, "EngFlow")).toEqual([]);
  });
  it("the same sentence on the About page is", () => {
    const about = { ...impressum, url: "https://www.engflow.com/about", title: "About", content: "EngFlow is headquartered in Austin, Texas." };
    const legalToo = { ...about, url: "https://www.engflow.com/legal/terms" };
    expect(hqIn(legalToo, "EngFlow")).toEqual([]);
    expect(hqIn(about, "EngFlow").map((s: { city: string }) => s.city)).toEqual(["Austin"]);
  });
});

describe("review 9 (2026-11-10): the Contact page's addresses and an article of 2014", () => {
  const st = (over: Partial<HqStatement>): HqStatement => ({ city: "New York", quote: "q", source_id: "S1", url: "https://sentra.io/contact", kind: "company", date: null, ...over });
  it("Sentra: two addresses on the Contact page are offices, not a headquarters", () => {
    const d = decideHeadquarters([st({ viaAddress: true }), st({ city: "Tel Aviv", viaAddress: true })], "2026-11-10");
    expect(d.kind).toBe("site_offices");
  });
  it("one address there is the headquarters; a sentence that declares one wins over addresses", () => {
    expect(decideHeadquarters([st({ viaAddress: true })], "2026-11-10")).toMatchObject({ kind: "declared" });
    const d = decideHeadquarters([st({ viaAddress: true }), st({ city: "Tel Aviv", viaAddress: true }), st({ city: "Tel Aviv", quote: "headquartered in Tel Aviv" })], "2026-11-10");
    expect(d).toMatchObject({ kind: "declared", statement: { city: "Tel Aviv", quote: "headquartered in Tel Aviv" } });
  });
  it("Chargebee: an article of 2014 alone is not today's headquarters; of 2021 it is", () => {
    const press = (date: string | null, city = "Chennai"): HqStatement => ({ city, quote: `${city}-based`, source_id: "S2", url: "https://techcrunch.com/x", kind: "press", date });
    expect(decideHeadquarters([press("2014-01-12")], "2026-11-10").kind).toBe("none");
    expect(decideHeadquarters([press("2021-12-17", "New York")], "2026-11-10")).toMatchObject({ kind: "declared" });
    expect(decideHeadquarters([press(null)], "2026-11-10")).toMatchObject({ kind: "declared" });
    expect(decideHeadquarters([press("2014-01-12"), press("2024-05-01", "San Francisco")], "2026-11-10")).toMatchObject({ kind: "declared", statement: { city: "San Francisco" } });
  });
});
