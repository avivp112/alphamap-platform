import { describe, it, expect } from "vitest";
import {
  personName, textHasPerson, plainName, matchSignals, isVerified, siteSignals, quoteInText, pickSiteCandidates,
  isForbiddenDomain, cityOf, aboutLink, originOf, extraLinks, MAX_PAGES, probeDomains, withDomainMatch, enrichCandidate, displayName, MAX_SEARCHES,
  type CandidateInput, type Page, type IdentityDeps,
} from "./candidateIdentity.ts";
import type { SearchResult } from "./search.ts";

const uk: CandidateInput = {
  id: "c1", source: "uk_companies_house", name: "HIGHLINE AI LIMITED", country: "United Kingdom", founded_year: 2026,
  entity_number: "14567890", website: null,
  evidence: { address: "Monomark House, 27 Old Gloucester Street, London, WC1N 3AX, England", postal_code: "WC1N 3AX",
    officers: [{ name: "ROPAS, Ioannis", relationships: ["director"] }, { name: "VRAILA, Eleni Christina", relationships: ["director"] }] },
};
const sec: CandidateInput = {
  id: "c2", source: "sec_form_d", name: "Lumen Quantum, Inc.", country: "United States", founded_year: 2025, entity_number: null, website: null,
  evidence: { address: "100 MAIN ST, SUITE 4, AUSTIN, TX, 78701",
    officers: [{ name: "Ada Lovelace", relationships: ["Executive Officer"] }, { name: "Sam Iyer", relationships: ["Promoter"] }] },
};
const page = (url: string, text: string, html = ""): Page => ({ url, text, html: html || `<html><body>${text}</body></html>` });
const result = (urls: Array<[string, string?, string?]>): SearchResult => ({
  organic: urls.map(([url, title, content]) => ({ url, title, content: content ?? "", provider: "serper", query_label: "t" } as never)), knowledgeGraph: null,
});

describe("people and names", () => {
  it("reads both name forms", () => {
    expect(personName("ROPAS, Ioannis")).toEqual({ first: "ioannis", last: "ropas" });
    expect(personName("BLOGGS, Jo Simon")).toEqual({ first: "jo", last: "bloggs" });
    expect(personName("Dana R Okonkwo")).toEqual({ first: "dana", last: "okonkwo" });
    expect(personName("")).toBeNull();
    expect(personName("Madonna")).toBeNull();
  });
  it("finds a person near each other in either order, not just anywhere", () => {
    const p = personName("Ada Lovelace")!;
    expect(textHasPerson("Our CEO Ada B. Lovelace founded the firm", p)).toBe(true);
    expect(textHasPerson("Lovelace, Ada — advisor", p)).toBe(true);
    expect(textHasPerson("Ada works with Charles. Later a Lovelace street was named by the council in town", p)).toBe(false);
  });
  it("strips legal suffixes and formats names for search", () => {
    expect(plainName("UCHU Biosensors, Inc.")).toBe("UCHU Biosensors");
    expect(plainName("HIGHLINE AI LIMITED")).toBe("HIGHLINE AI");
    expect(displayName("ROPAS, Ioannis")).toBe("Ioannis Ropas");
  });
  it("city comes from a Form D address, not from a UK one", () => {
    expect(cityOf(sec)).toBe("AUSTIN");
    expect(cityOf(uk)).toBeNull();
  });
});

describe("matching the site to the record", () => {
  it("two kinds incl. an identity kind verify the site", () => {
    const s = matchSignals(uk, [page("https://highline.ai/about", "Founded by Ioannis Ropas. Highline AI Limited, registered office 27 Old Gloucester Street, London WC1N 3AX")]);
    expect(s.map((x) => x.kind).sort()).toEqual(["director", "legal_name", "postcode"]);
    expect(isVerified(s)).toBe(true);
  });
  it("the company number counts only as a whole token", () => {
    expect(matchSignals(uk, [page("u", "Company no. 14567890")]).map((x) => x.kind)).toEqual(["company_number"]);
    expect(matchSignals(uk, [page("u", "Invoice 145678901")]).map((x) => x.kind)).toEqual([]);
  });
  it("one match is not enough, and city + year alone (a namesake) never verifies", () => {
    expect(isVerified(matchSignals(uk, [page("u", "Ioannis Ropas, advisor")]))).toBe(false);
    const s = matchSignals(sec, [page("u", "Lumen Quantum — founded in 2025, based in Austin")]);
    expect(s.map((x) => x.kind).sort()).toEqual(["city", "founded"]);
    expect(isVerified(s)).toBe(false);
  });
  it("only directors and officers count, not a promoter", () => {
    expect(matchSignals(sec, [page("u", "Sam Iyer is our friend")]).length).toBe(0);
    expect(matchSignals(sec, [page("u", "CEO Ada Lovelace, Austin")]).map((x) => x.kind).sort()).toEqual(["city", "director"]);
  });
});

describe("a domain named exactly like the company", () => {
  const site = (domain: string) => ({ url: `https://${domain}/`, domain });
  const sig = (kind: string) => ({ kind, text: "x", url: "u" }) as never;
  it("counts as the second match next to a director, the company number or the postcode", () => {
    for (const kind of ["director", "company_number", "postcode"]) {
      const s = withDomainMatch([sig(kind)], uk, site("highline.ai"));
      expect(s.map((x) => x.kind)).toEqual([kind, "domain_name"]);
      expect(isVerified(s)).toBe(true);
    }
  });
  it("counts for nothing alone, or next to a city, a year or a legal name", () => {
    expect(withDomainMatch([], uk, site("highline.ai"))).toEqual([]);
    for (const kind of ["city", "founded", "legal_name"]) {
      expect(withDomainMatch([sig(kind)], uk, site("highline.ai")).map((x) => x.kind)).toEqual([kind]);
    }
  });
  it("needs the domain to BE the name, not just contain a word of it", () => {
    expect(withDomainMatch([sig("director")], uk, site("highline-bikes.com")).map((x) => x.kind)).toEqual(["director"]);
    expect(isVerified(withDomainMatch([sig("director")], uk, site("highline-bikes.com")))).toBe(false);
  });
  it("makes HoneyHive-style cases verify: exact domain + a director of the filing", async () => {
    const e = await enrichCandidate(
      { ...uk, name: "HoneyHive Inc.", source: "sec_form_d", entity_number: null, evidence: { officers: [{ name: "Mohak Sharma", relationships: ["Executive Officer"] }] } },
      {
        search: async () => result([["https://www.honeyhive.ai/"]]),
        fetch: (async () => new Response("<html><body>Meet Mohak Sharma, CEO.</body></html>", { headers: { "content-type": "text/html" } })) as typeof fetch,
        describe: async () => null, now: () => new Date("2026-12-04T00:00:00Z"),
      },
    );
    expect(e.status).toBe("verified");
    expect(e.match_signals.map((m) => m.kind).sort()).toEqual(["director", "domain_name"]);
  });
});

describe("site signals", () => {
  it("a product site: jobs, pricing, login, demo", () => {
    const html = `<a href="/careers">Careers</a><a href="/pricing">Pricing</a><a href="/login">Log in</a><a href="/demo">Book a demo</a>`;
    expect(siteSignals([page("https://a.ai/", "Welcome", html)]).map((s) => s.kind).sort()).toEqual(["demo", "jobs", "login", "pricing"]);
  });
  it("an agency says so", () => {
    const s = siteSignals([page("https://b.com/", "We are a digital agency and our consultants help brands.")]);
    expect(s.map((x) => [x.kind, x.level])).toEqual([["agency", "services"], ["consulting", "services"]]);
  });
});

describe("quoteInText", () => {
  const text = "Highline AI builds   autonomous drones for  wildfire detection. Contact us.";
  it("finds a quote despite spacing, case and quote marks", () => {
    expect(quoteInText("highline ai builds autonomous drones for wildfire detection", text)).toBe(true);
    expect(quoteInText("Highline AI builds autonomous drones for wildfire detection.", text)).toBe(true);
  });
  it("rejects a paraphrase, an invention, and anything too short", () => {
    expect(quoteInText("Highline AI makes drones that detect wildfires", text)).toBe(false);
    expect(quoteInText("Highline AI builds", text)).toBe(false);
  });
});

describe("choosing sites", () => {
  it("keeps a domain that carries the name, drops databases, directories and wikipedia", () => {
    const r = result([
      ["https://www.crunchbase.com/organization/highline-ai"], ["https://en.wikipedia.org/wiki/Highline"],
      ["https://linkedin.com/company/highline-ai"], ["https://highline.ai/"], ["https://random-news.com/x", "Highline AI raises", ""],
    ]);
    expect(pickSiteCandidates(uk, r).map((s) => s.domain)).toEqual(["highline.ai"]);
  });
  it("a page that only mentions the company and a director is not its site (StreetInsider, JustRaisedFunding)", () => {
    const r = result([
      ["https://www.streetinsider.com/SEC+Filings/Form+D/x", "Highline AI Form D", "Ioannis Ropas, Highline AI Limited"],
      ["https://justraisedfunding.com/founders/ioannis-ropas", "Highline AI", "Ioannis Ropas, Highline AI"],
      ["https://hl-labs.io/", "Highline AI — team", "Ioannis Ropas, CEO of Highline AI"],
    ]);
    expect(pickSiteCandidates(uk, r)).toEqual([]);
  });
  it("forbidden domains", () => {
    for (const d of ["crunchbase.com", "x.pitchbook.com", "dealroom.co", "en.wikipedia.org", "opencorporates.com", "streetinsider.com", "justraisedfunding.com", "sec.report"]) expect(isForbiddenDomain(d)).toBe(true);
    expect(isForbiddenDomain("highline.ai")).toBe(false);
  });
  it("the stored website is the front page, not the deep link the search returned", () => {
    expect(originOf("https://www.broccoli.com/privacy-policy")).toBe("https://www.broccoli.com/");
    expect(originOf("https://tabiconnect.com/privacy-policy/?x=1")).toBe("https://tabiconnect.com/");
  });
  it("reads up to four pages: the front page, about, team and contact", () => {
    expect(MAX_PAGES).toBe(4);
    const home = page("https://highline.ai/", "", `<a href="/about">About</a><a href="/team">Our team</a><a href="/contact-us">Contact</a><a href="/blog">Blog</a><a href="https://other.com/team">x</a>`);
    expect(extraLinks(home)).toEqual(["https://highline.ai/about", "https://highline.ai/team", "https://highline.ai/contact-us"]);
  });
  it("finds an about page on the same site only", () => {
    const home = page("https://highline.ai/", "", `<a href="https://other.com/about">x</a><a href="/about-us">About</a>`);
    expect(aboutLink(home)).toBe("https://highline.ai/about-us");
  });
});

describe("enrichCandidate", () => {
  const html = (body: string) => new Response(body, { headers: { "content-type": "text/html" } });
  const site = `<a href="/about">About</a><a href="/careers">Careers</a>Highline AI Limited builds autonomous drones for wildfire detection. Founded by Ioannis Ropas, registered at WC1N 3AX.`;
  const mkDeps = (over: Partial<IdentityDeps> = {}, searches: string[] = []): IdentityDeps => ({
    search: async (q) => { searches.push(q); return result([["https://highline.ai/"], ["https://www.crunchbase.com/o/highline"]]); },
    fetch: (async (u: RequestInfo | URL) => String(u).endsWith("/about") ? html("About: Ioannis Ropas, CEO") : html(site)) as typeof fetch,
    describe: async () => ({ quote: "Highline AI Limited builds autonomous drones for wildfire detection.", description_he: "בונה רחפנים אוטונומיים לזיהוי שריפות יער" }),
    now: () => new Date("2026-12-04T00:00:00Z"),
    ...over,
  });

  it("verified site, quote found: status verified with description and sources", async () => {
    const searches: string[] = [];
    const e = await enrichCandidate(uk, mkDeps({}, searches));
    expect(e.status).toBe("verified");
    expect(e.website).toBe("https://highline.ai/");
    expect(e.match_signals.map((s) => s.kind).sort()).toEqual(["director", "domain_name", "legal_name", "postcode"]);
    expect(e.description_quote).toBe("Highline AI Limited builds autonomous drones for wildfire detection.");
    expect(e.description_he).toBe("בונה רחפנים אוטונומיים לזיהוי שריפות יער");
    expect(e.site_signals.map((s) => s.kind)).toContain("jobs");
    expect(e.search_calls).toBe(1);
    expect(searches.length).toBeLessThanOrEqual(MAX_SEARCHES);
  });
  it("an invented quote is thrown away, the site stays verified", async () => {
    const e = await enrichCandidate(uk, mkDeps({ describe: async () => ({ quote: "Highline AI is the world's leading wildfire drone company.", description_he: "x" }) }));
    expect(e.status).toBe("verified");
    expect(e.description_he).toBeNull();
    expect(e.description_quote).toBeNull();
    expect(e.notes.join(" ")).toContain("התיאור נזרק");
  });
  it("no site found: no_site, nothing guessed", async () => {
    const e = await enrichCandidate(uk, mkDeps({
      search: async () => result([["https://www.crunchbase.com/o/x"]]),
      fetch: (async () => new Response("", { status: 404 })) as typeof fetch,   // no domain answers either
    }));
    expect(e.status).toBe("no_site");
    expect(e.website).toBeNull();
    expect(e.description_he).toBeNull();
    // The audit trail: which domains the search returned, so a wrongly dropped site can be seen.
    expect(e.notes.join(" ")).toContain("crunchbase.com");
  });
  it("probe domains come from the name, shortest first, and need a real name token", () => {
    expect(probeDomains("Slazer Labs, Inc.")).toEqual(["slazer.com", "slazerlabs.com", "slazer.ai", "slazerlabs.ai", "slazer.io"]);
    expect(probeDomains("Tractian Inc.", 3)).toEqual(["tractian.com", "tractian.ai", "tractian.io"]);
    expect(probeDomains("AI Co Inc.")).toEqual([]);
  });
  it("when the search misses the site, the name as a domain is tried and verified like any site", async () => {
    const asked: string[] = [];
    const e = await enrichCandidate(uk, mkDeps({
      search: async () => result([["https://www.crunchbase.com/o/x"]]),
      fetch: (async (u: RequestInfo | URL) => { asked.push(String(u)); return String(u).startsWith("https://highline.com/") ? html(site) : new Response("", { status: 404 }); }) as typeof fetch,
    }));
    expect(e.status).toBe("verified");
    expect(e.website).toBe("https://highline.com/");
    expect(e.notes.join(" ")).toContain("לפי שם החברה כדומיין");
    expect(asked[0]).toBe("https://highline.com/");
  });
  it("a namesake found by name as a domain is unverified, never presented as the company", async () => {
    const e = await enrichCandidate(uk, mkDeps({
      search: async () => result([]),
      fetch: (async (u: RequestInfo | URL) => String(u).startsWith("https://highline.com/") ? html("Highline sells bike helmets in Leeds.") : new Response("", { status: 404 })) as typeof fetch,
    }));
    expect(e.status).toBe("unverified");
    expect(e.description_he).toBeNull();
  });
  it("a namesake site that shares nothing but the name is unverified and carries no description", async () => {
    const other = `Highline AI sells bike helmets in Leeds.`;
    const e = await enrichCandidate(uk, mkDeps({ fetch: (async () => html(other)) as typeof fetch }));
    expect(e.status).toBe("unverified");
    expect(e.description_he).toBeNull();
    expect(e.notes.join(" ")).toContain("אין בו אף התאמה");
    expect(e.website).toBe("https://highline.ai/");
  });
  it("a namesake with the same domain AND a director's name on it is verified: the accepted risk of the domain rule", async () => {
    // Owner's decision, 2026-11-18: an exact-name domain plus a director of the filing is enough. A common
    // director name on another company's site of the same name would pass. The log shows what matched.
    const other = `Highline AI sells bike helmets. Ioannis Ropas is our advisor.`;
    const e = await enrichCandidate(uk, mkDeps({ fetch: (async () => html(other)) as typeof fetch }));
    expect(e.status).toBe("verified");
    expect(e.match_signals.map((m) => m.kind).sort()).toEqual(["director", "domain_name"]);
  });
  it("robots.txt-blocked pages (451) give a note, not a verdict", async () => {
    const e = await enrichCandidate(uk, mkDeps({ fetch: (async () => new Response("", { status: 451 })) as typeof fetch }));
    expect(e.status).toBe("no_site");
    expect(e.notes.join(" ")).toContain("לא נקרא");
  });
  it("never exceeds the search budget", async () => {
    const searches: string[] = [];
    await enrichCandidate(uk, mkDeps({ search: async (q) => { searches.push(q); return result([]); } }, searches));
    expect(searches.length).toBeLessThanOrEqual(MAX_SEARCHES);
  });
});
