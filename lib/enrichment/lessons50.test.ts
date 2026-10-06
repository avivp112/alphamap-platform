/**
 * One case per data error seen in the 50-company run of 2026-10-06 (Gretel
 * through GXBank), each turned into a general rule so it cannot recur.
 */
import { describe, it, expect } from "vitest";
import { groundRoundDetails, announcementDateFromSource, isSameRound, planRoundWrites } from "./assemble";
import { buildLabeledSources } from "./sources";
import { validateEnrichment, checkHeadcountOutlier, cityExistsInCountry } from "./validation";
import { countryFromLocationQuote, isRegionNotCity } from "./location";
import { foundersFromText, cleanPeople, isFounderEntry } from "./people";
import { samePersonName } from "./linkedin";
import { nearPatentWord, patentCountStated } from "./extractMarket";
import { filterCrossSectorTags } from "./extractProfile";
import { filterByEntity, nameQualifiersOnOwnSite } from "./entity";
import { findListingStatement } from "./listing";

describe("funding", () => {
  const sources = buildLabeledSources([{
    url: "https://www.businesswire.com/gretel-series-b", provider: "serper", query_label: "funding",
    content: "Gretel.ai closed a $50 million Series B led by Anthos Capital, bringing total funding to $65.5 million.",
  }]);

  it("drops a 'valuation' whose quote never calls it a valuation (Gretel's total funding, GrowthBar's ARR)", () => {
    const { round, dropped } = groundRoundDetails({
      round_type: "Series B",
      amount_raised: { value: 50_000_000, source_id: "S1", evidence_quote: "closed a $50 million Series B" },
      valuation: { value: 65_500_000, source_id: "S1", evidence_quote: "bringing total funding to $65.5 million" },
    }, sources);
    expect(round.valuation).toBeUndefined();
    expect(dropped).toContain("valuation_not_stated_as_valuation");
  });

  it("keeps a valuation that is stated as one", () => {
    const { round } = groundRoundDetails({
      round_type: "Series D",
      valuation: { value: 3_000_000_000, source_id: "S1", evidence_quote: "at a $3 billion valuation" },
    }, sources);
    expect(round.valuation?.value).toBe(3_000_000_000);
  });

  it("never dates a round with a 'published' date from the last few days — that is the crawl date of an old article (Grofers)", () => {
    const today = "2026-10-06";
    const src = buildLabeledSources([{
      url: "https://www.vccircle.com/softbank-leads-62-mn-funding-round-in-grofers", provider: "jina", query_label: "article",
      title: "SoftBank leads $62 mn funding round in Grofers", content: "Published Time: 2026-10-06T08:00:00Z\nGrofers has raised $62 million led by SoftBank.",
    }])[0];
    expect(announcementDateFromSource({ round_type: "Series E", amount_raised: { value: 62_000_000, source_id: "S1", evidence_quote: "" } }, src, today)).toBeNull();
  });

  it("treats the same named stage for the same amount as one round, whatever the dates (Griffin's Series A)", () => {
    expect(isSameRound(
      { round_type: "Series A", amount_raised: 13_500_000, announcement_date: "2022-04-01" },
      { round_type: "Series A", amount_raised: 13_500_000, announcement_date: "2024-03-11" },
    )).toBe(true);
    const plan = planRoundWrites(
      [{ id: "r1", round_type: "Series A", amount_raised: 13_500_000, announcement_date: "2022-04-01" }],
      [
        { round_type: "Series A", amount_raised: 24_000_000 },
        { round_type: "Series A", amount_raised: 13_500_000, announcement_date: "2024-03-11" },
      ],
    );
    expect(plan.inserts).toHaveLength(0);
  });

  it("drops the vaguely dated round of an impossible stage order (Grit's 'Series A 2022' before its 2023 Seed)", () => {
    const seed = { round_type: "Seed", amount_raised: 7_000_000, announcement_date: "2023-08-15" };
    const seriesA = { round_type: "Series A", amount_raised: 25_000_000, announcement_date: "2022-01-01" };
    const v = validateEnrichment({ existing: {}, extracted: {}, rounds: [seriesA, seed] });
    expect(v.acceptedRounds).toEqual([seed]);
    expect(v.issues.some((i) => i.rule === "stage_order")).toBe(true);
  });

  it("drops both rounds when the dates are equally precise and nothing says which is wrong", () => {
    const b = { round_type: "Series B", announcement_date: "2015-07-16" };
    const a = { round_type: "Series A", announcement_date: "2016-08-04" };
    expect(validateEnrichment({ existing: {}, extracted: {}, rounds: [b, a] }).acceptedRounds).toEqual([]);
  });
});

describe("location", () => {
  it("rejects a state, region or country as the HQ city, and the country read off the same line", () => {
    expect(isRegionNotCity("Delaware")).toBe(true);
    expect(isRegionNotCity("Canton Appenzell Ausserrhoden")).toBe(true);
    expect(isRegionNotCity("New York")).toBe(false);
    expect(isRegionNotCity("Singapore")).toBe(false);
    const quote = "HeadquartersDelaware, United States";
    const v = validateEnrichment({ existing: {}, extracted: { city: "Delaware", country: "United States", city_quote: quote, country_quote: quote }, rounds: [] });
    expect(v.accepted.city).toBeNull();
    expect(v.accepted.country).toBeNull();
  });

  it("reads the country from the city's own quote", () => {
    expect(countryFromLocationQuote("Gretel.ai, a Poway, Calif.-based data privacy startup", "Poway")).toBe("United States");
    expect(countryFromLocationQuote("It was founded in 2016 and is based in Cambridge, Massachusetts.", "Cambridge")).toBe("United States");
    expect(countryFromLocationQuote("Hørsholm Kongevej 11B 2970 Hørsholm Denmark", "Hørsholm")).toBe("Denmark");
    expect(countryFromLocationQuote("Registered Address: 1950 W CORPORATE WAY # 34560,ANAHEIM,CA,92801,0.", "Anaheim")).toBe("United States");
    expect(countryFromLocationQuote("HQ Address: Level 5, 1 First Avenue, Bandar Utama, 47800 Petaling Jaya, Selangor", "Petaling Jaya")).toBe("Malaysia");
    expect(countryFromLocationQuote("Headquarters: El Segundo, CA", "El Segundo")).toBe("United States");
    expect(countryFromLocationQuote("Although the foundry is based in Lucerne, we're active on a global scale", "Lucerne")).toBeNull();
  });

  it("knows San Jose is also a US city (Gummicube lost its city to a false mismatch)", () => {
    expect(cityExistsInCountry("San Jose", "United States")).toBe(true);
  });
});

describe("headcount", () => {
  it("does not apply the employees-per-dollar-raised check to a company 12+ years old (greytHR, 1994)", () => {
    expect(checkHeadcountOutlier(1038, 17_040_000, 1994)).toBeNull();
    expect(checkHeadcountOutlier(70_000 / 10, 20_000_000, 2022)).not.toBeNull();
  });
});

describe("people", () => {
  it("never takes an organisation or a glued sentence word as a founder (Griffin's 'Virgin Money', GrowthBar's 'Mark Spera. However')", () => {
    const griffin = foundersFromText("Griffin was founded by David Jarvis, Allen Rohner and Virgin Money.", "Griffin");
    expect(griffin.map((f) => f.name)).toEqual(["David Jarvis", "Allen Rohner"]);
    expect(cleanPeople([{ name: "Mark Spera" }, { name: "Mark Spera.  However" }, { name: "Virgin Money" }]).map((p) => p.name)).toEqual(["Mark Spera"]);
    expect(cleanPeople([{ name: "Daniel J. Mandell" }, { name: "Dr. Jane Roe" }])).toHaveLength(2);
  });

  it("folds a nickname or a one-letter surname slip into one person, keeping both entries' details", () => {
    expect(samePersonName("Mitch Stewart", "Mitchell Stewart")).toBe(true);
    expect(samePersonName("Albert Sebag", "Albert Sebago")).toBe(true);
    expect(samePersonName("John Smith", "Jane Smith")).toBe(false);
    expect(samePersonName("Dan Cohen", "Dan Cohn")).toBe(false);
    const merged = cleanPeople([{ name: "Mitchell Stewart", bio: "Co-founder of Guru." }, { name: "Mitch Stewart", title: "Founder" }]);
    expect(merged).toEqual([{ name: "Mitchell Stewart", bio: "Co-founder of Guru.", title: "Founder" }]);
  });

  it("keeps a hired CEO out of the founders (GreyNoise's Ash Devata)", () => {
    expect(isFounderEntry({ title: "CEO", bio: "Ash Devata was hired as CEO at GreyNoise." })).toBe(false);
    expect(isFounderEntry({ title: "CEO & Co-Founder" })).toBe(true);
    expect(isFounderEntry({ bio: "Mitchell Stewart is a co-founder of Guru." })).toBe(true);
    expect(isFounderEntry({ title: "CEO" })).toBe(true);
  });
});

describe("patents", () => {
  it("needs a patent title next to the word 'patent', and a count stated as a count", () => {
    expect(nearPatentWord("Contact", "Pricing Docs Contact Login")).toBe(false);
    expect(nearPatentWord("Dynamic overlay ad-insertion", "GumGum granted two patents for dynamic overlay ad-insertion within video streams")).toBe(true);
    expect(patentCountStated(120, "The company holds over 120 technology patents.")).toBe(true);
    expect(patentCountStated(1, "Contact us about our product.")).toBe(false);
  });
});

describe("sub-sector tags", () => {
  const taxonomy = {
    parentNames: ["Fintech", "Health & Life Sciences"], subNames: ["Banking / Neobanking", "Digital Health"],
    parentOf: { "Banking / Neobanking": "Fintech", "Digital Health": "Health & Life Sciences" },
  };
  it("drops a tag from another sector that the description never mentions (GXBank tagged Digital Health)", () => {
    const r = filterCrossSectorTags(["Banking / Neobanking", "Digital Health"], "Fintech", taxonomy, "GXBank is Malaysia's first digital bank offering savings accounts and insurance products.");
    expect(r).toEqual({ kept: ["Banking / Neobanking"], dropped: ["Digital Health"] });
  });
  it("keeps a cross-sector tag the description is about", () => {
    expect(filterCrossSectorTags(["Digital Health"], "Fintech", taxonomy, "A payments app for health clinics.").kept).toEqual(["Digital Health"]);
  });
});

describe("entity filter", () => {
  const anchors = { domain: "guidepoint.com", ownQualifiers: nameQualifiersOnOwnSite(["Guidepoint connects clients with experts. Guidepoint Qsight analytics."], "Guidepoint") };
  it("drops '<Name> Security' when the company never calls itself that (GuidePoint Security vs Guidepoint)", () => {
    expect(filterByEntity({ url: "https://abscapital.com/guidepoint-security-attracts-new-round-of-growth-capital", title: "GuidePoint Security attracts new round of growth capital" }, anchors, "Guidepoint"))
      .toMatchObject({ kept: false, drop_reason: "namesake_qualified_name" });
  });
  it("keeps the company's own qualified name (Guardant Health on guardanthealth.com)", () => {
    const a = { domain: "guardanthealth.com", ownQualifiers: [] };
    expect(filterByEntity({ url: "https://www.fiercebiotech.com/x", title: "Guardant Health raises $360M" }, a, "Guardant").drop_reason).not.toBe("namesake_qualified_name");
  });
  it("drops multi-company job-board pages (Grit's 'Series A' from hnhiring.com)", () => {
    expect(filterByEntity({ url: "https://hnhiring.com/technologies/rust/months/february-2023", title: "Rust jobs February 2023 grit.io" }, { domain: "grit.io" }, "Grit"))
      .toMatchObject({ kept: false, drop_reason: "multi_company_page" });
  });
});

describe("public companies", () => {
  it("recognises a listed company from '<Name>, Inc. (Exchange: TICKER)' (Guardant, Gritstone)", () => {
    const src = (content: string) => [{ url: "https://example.com/pr", content }];
    expect(findListingStatement("Guardant", src("Guardant Health, Inc. (Nasdaq: GH), a leading precision oncology company"), "guardanthealth.com")).not.toBeNull();
    expect(findListingStatement("Gritstone", src("Gritstone bio, Inc. (Nasdaq: GRTS) today announced"), "gritstonebio.com")).not.toBeNull();
  });
  it("ignores another company's ticker in the same sentence", () => {
    const src = (content: string) => [{ url: "https://example.com/pr", content }];
    expect(findListingStatement("Guardsquare", src("Guardsquare Acquires Verimatrix (Euronext Paris: VMX) XTD assets"), "guardsquare.com")).toBeNull();
    expect(findListingStatement("GXBank", src("GXBank, backed by Grab Holdings (NASDAQ: GRAB) and Singtel"), "gxbank.my")).toBeNull();
  });
});
