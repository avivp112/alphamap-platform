/**
 * Lessons from the 50-company v2 run of 2026-10-08 (Highland Electric Fleets
 * .. Hubstaff). Each test is a general rule that a real mistake in that run
 * would have hit.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanPersonName, cleanFounderTitle, cleanPeople, foundersFromText } from "./people";
import { parseLinkedInFacts } from "./linkedin";
import { rejectRound } from "./assemble";
import { countryFromLocationQuote, isRegionNotCity } from "./location";
import { filterByEntity } from "./entity";
import { createSearchProviderState, fetchArticleText, jinaDisabled } from "./searchProviders";
import type { V2Round } from "./extractFunding";
import type { LabeledSource } from "./sources";

describe("people: a name is only the name", () => {
  it("drops a title, a relation or a symbol written in front of the name (Houzz, Hubpay, Housecall Pro)", () => {
    expect(cleanPersonName("CEO Adi Tatarko")).toBe("Adi Tatarko");
    expect(cleanPersonName("CEO Kevin Kilty")).toBe("Kevin Kilty");
    expect(cleanPersonName("⚡ Roland Ligtenberg")).toBe("Roland Ligtenberg");
    expect(cleanPersonName("Dr. Reece Akhtar")).toBe("Reece Akhtar");
    expect(cleanPersonName("Jean-Louis Quéguiner")).toBe("Jean-Louis Quéguiner");
  });
  it("reads both Houzz founders from 'founded by CEO Adi Tatarko and her husband Alon Cohen'", () => {
    expect(foundersFromText("Houzz was founded in 2009 by CEO Adi Tatarko and her husband Alon Cohen.", "Houzz").map((f) => f.name))
      .toEqual(["Adi Tatarko", "Alon Cohen"]);
  });
  it("folds 'CEO Adi Tatarko' into 'Adi Tatarko' instead of listing her twice", () => {
    const out = cleanPeople([{ name: "CEO Adi Tatarko", title: "Founder" }, { name: "Adi Tatarko", title: "Co-Founder and Executive Chair", linkedin_url: "x" }]);
    expect(out.map((p) => p.name)).toEqual(["Adi Tatarko"]);
  });
});

describe("people: a founder title naming another organisation describes another company", () => {
  it("resets 'Founder of BellQR' (Hotjar) and 'Founder Artu Capital' (Highview Power)", () => {
    expect(cleanFounderTitle("Founder of BellQR", "Hotjar")).toBe("Founder");
    expect(cleanFounderTitle("Founder Artu Capital", "Highview Power")).toBe("Founder");
    expect(cleanFounderTitle("Co-founder at Acme Labs", "Gladia")).toBe("Co-founder");
  });
  it("keeps role titles and this company's own name", () => {
    expect(cleanFounderTitle("Co-Founder and CEO,", "Holvi")).toBe("Co-Founder and CEO");
    expect(cleanFounderTitle("Cofounder of Honeybadger.io", "Honeybadger")).toBe("Cofounder of Honeybadger.io");
    expect(cleanFounderTitle("Founder, Group CEO (until 2023)", "HReasily")).toBe("Founder, Group CEO");
    expect(cleanFounderTitle("Chairman and Co-Founder", "Highview Power")).toBe("Chairman and Co-Founder");
  });
});

describe("people: 'It was founded by' belongs to whatever the previous sentence was about", () => {
  it("never gives Honeycomb Credit the founders of Dropbox from a page that names Honeycomb", () => {
    const text = "Dropbox is a file hosting service. It was founded by Drew Houston and Arash Ferdowsi.";
    expect(foundersFromText(text, "Honeycomb Credit", { url: "https://example.com/honeycomb-credit-alternatives" })).toEqual([]);
  });
  it("still reads it when the previous sentence is about the company", () => {
    const text = "Gladia raised $16 million. It was founded in 2022 by Jean-Louis Queguiner and Jonathan Soto.";
    expect(foundersFromText(text, "Gladia", { url: "https://techcrunch.com/2024/10/15/gladia-series-a" })).toHaveLength(2);
  });
});

describe("LinkedIn: an accelerator is not where someone studied", () => {
  it("drops Y Combinator from Education (Holy Grail's 'Studied at Y Combinator')", () => {
    expect(parseLinkedInFacts("Education: Y Combinator · Experience: Orange Collective").education).toEqual([]);
    expect(parseLinkedInFacts("Education: Stanford University · Experience: Google").education).toEqual(["Stanford University"]);
  });
});

describe("rounds that are not written", () => {
  const src = (id: string, url: string): LabeledSource => ({ source_id: id, url, title: "", content: "", provider: "serper", query_label: "q", source_type: "news" } as unknown as LabeledSource);
  const sources = [src("S1", "https://www.cbinsights.com/company/homelane/financials"), src("S2", "https://www.hirist.tech/j/agrim-senior-business-analyst-1653090"), src("S3", "https://mycodelesswebsite.com/hotjar-statistics")];
  const round = (r: Partial<V2Round>): V2Round => ({ round_type: "Seed", ...r });

  it("drops a round that is only a label — no amount, valuation or investor (HomeLane's Series F+)", () => {
    expect(rejectRound(round({ round_type: "Series F+", announcement_date: { value: "2025-09-02", source_id: "S1", evidence_quote: "Sep 2, 2025" } }), "HomeLane", sources)).toBe("round_without_substance");
    expect(rejectRound(round({ round_type: "Acquired", announcement_date: { value: "2022-06-03", source_id: "S1", evidence_quote: "x" } }), "Hitch Works", sources)).toBeNull();
  });
  it("drops a round read off a job posting (Hirist's 'Series B' was another company's job ad)", () => {
    expect(rejectRound(round({ round_type: "Series B", amount_raised: { value: 20_500_000, source_id: "S2", evidence_quote: "raised $20.5M Series B" }, lead_investor: { value: "Asia Impact", source_id: "S2", evidence_quote: "led by Asia Impact" } }), "Hirist", sources))
      .toBe("round_from_job_posting");
  });
  it("drops a round the quote says someone else raised (Contentsquare's $500M was not Hotjar's)", () => {
    expect(rejectRound(round({ round_type: "Series E", amount_raised: { value: 500_000_000, source_id: "S3", evidence_quote: "In 2021, Contentsquare raised a $500M Series E and bought Hotjar." } }), "Hotjar", sources))
      .toBe("round_raised_by_another_company");
    expect(rejectRound(round({ round_type: "Seed", amount_raised: { value: 8_000_000, source_id: "S3", evidence_quote: "Highlight raised an $8M seed round led by Afore" } }), "Highlight.io", sources)).toBeNull();
    expect(rejectRound(round({ round_type: "Seed", amount_raised: { value: 3_000_000, source_id: "S3", evidence_quote: "The company raised $3M" } }), "Hoppscotch", sources)).toBeNull();
  });
});

describe("location: the state or region right after the city gives the country", () => {
  it("reads 'Beverly, MA-based' and 'Docklands, Victoria 3008, AU'", () => {
    expect(countryFromLocationQuote("Highland Electric Fleets, a Beverly, MA-based electrification-as-a-service company", "Beverly")).toBe("United States");
    expect(countryFromLocationQuote("Address850 Collins St L 3, Docklands, Victoria 3008, AU", "Docklands")).toBe("Australia");
  });
  it("still accepts Victoria itself as a city", () => {
    expect(isRegionNotCity("Victoria")).toBe(false);
  });
});

describe("entity: a namesake's site with a marketing prefix is still a namesake", () => {
  it("drops gethightower.com results for Hightower (hightoweradvisors.com)", () => {
    const v = filterByEntity({ url: "https://o.parsers.vc/startup/gethightower.com", title: "Hightower — funding rounds", snippet: "Hightower raised a $2M seed" }, { domain: "hightoweradvisors.com" }, "Hightower");
    expect(v).toMatchObject({ kept: false, drop_reason: "namesake_domain" });
  });
});

describe("Jina Reader out of credit", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("is switched off after the first 402 instead of failing on every page", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 402 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = createSearchProviderState();
    expect(await fetchArticleText("https://example.com/a", state)).toBeNull();
    expect(jinaDisabled()).toMatch(/402/);
    const calls = fetchMock.mock.calls.length;
    await fetchArticleText("https://example.com/b", state);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});
