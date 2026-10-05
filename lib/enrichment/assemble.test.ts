import { describe, it, expect } from "vitest";
import {
  groundRoundDetails, announcementDateFromSource, isSameRound, planRoundWrites, mergeProfileExtractions, mergeMarketExtractions,
  mergeFundingExtractions, normalizeIsoDate, appendNew, reconcileOnFile,
} from "./assemble";
import { buildLabeledSources } from "./sources";
import { emptyMarketExtraction } from "./extractMarket";
import type { V2ProfileExtraction } from "./extractProfile";

const sources = buildLabeledSources([
  {
    url: "https://techcrunch.com/2023/06/22/apex-raises", provider: "serper", query_label: "history",
    content: "Apex raised a $16 million Series A led by a16z, with participation from Shield Capital and Andreessen. Shield Capital put in $4 million.",
  },
  { url: "https://apexspace.com/about", provider: "jina", query_label: "website", content: "About Apex." },
]);

describe("groundRoundDetails", () => {
  const base = {
    round_type: "Series A",
    amount_raised: { value: 16_000_000, source_id: "S1", evidence_quote: "Apex raised a $16 million Series A" },
    lead_investor: { value: "a16z", source_id: "S1", evidence_quote: "led by a16z" },
  };

  it("keeps only co-investors that some source names, never duplicating the lead", () => {
    const { round, dropped } = groundRoundDetails({ ...base, other_investors: ["Shield Capital", "Sequoia", "a16z"] }, sources);
    expect(round.other_investors).toEqual(["Shield Capital"]);
    expect(dropped).toContain("investor_not_in_source");
  });

  it("keeps a per-investor amount only when a source states that investor AND that figure", () => {
    const { round } = groundRoundDetails({
      ...base, investor_amounts: [{ name: "Shield Capital", amount: 4_000_000 }, { name: "Shield Capital", amount: 8_000_000 }],
    }, sources);
    expect(round.investor_amounts).toEqual([{ name: "Shield Capital", amount: 4_000_000 }]);
  });

  it("replaces a guessed source_url with the URL of the source its evidence came from", () => {
    const { round, dropped } = groundRoundDetails({ ...base, source_url: "https://example.com/made-up" }, sources);
    expect(round.source_url).toBe("https://techcrunch.com/2023/06/22/apex-raises");
    expect(dropped).toContain("round_source_url_not_in_sources");
  });
});

describe("round dates from the announcing article (Gladia/Glamsquad rounds came back undated)", () => {
  const src = (url: string, title: string, content: string) => buildLabeledSources([{ url, title, content, provider: "serper", query_label: "funding" }])[0];
  const seriesA = { round_type: "Series A", amount_raised: { value: 16_000_000, source_id: "S1", evidence_quote: "a $16 million Series A" } };
  it("dates a round from its own announcement's press-wire dateline / Date line / URL", () => {
    expect(announcementDateFromSource(seriesA, src("https://www.prnewswire.com/x", "Gladia Raises $16 Million in Series A Funding", "PARIS, Oct. 15, 2024 /PRNewswire/ -- Gladia raised a $16 million Series A"))).toBe("2024-10-15");
    expect(announcementDateFromSource(seriesA, src("https://slator.com/x", "Gladia raises USD 16M Series A", "Source: Slator — Date: Oct 15, 2024 — Gladia raised $16 million"))).toBe("2024-10-15");
    expect(announcementDateFromSource(seriesA, src("https://techcrunch.com/2024/10/15/gladia/", "Gladia raises $16M", "Gladia raised $16 million"))).toBe("2024-10-15");
  });
  it("never dates a round from a later article that only mentions it", () => {
    expect(announcementDateFromSource(seriesA, src("https://venturebeat.com/2025/04/02/x/", "Gladia launches Solaria", "Following its $16 million Series A round in 2024, Gladia launched Solaria"))).toBeNull();
  });
  it("needs a real date, not a relative one", () => {
    expect(announcementDateFromSource(seriesA, src("https://x.com/a", "Gladia raises $16M Series A", "Source: X — Date: 3 days ago — Gladia raised $16 million"))).toBeNull();
  });
  it("groundRoundDetails fills a missing date this way and flags it", () => {
    const sources2 = buildLabeledSources([{ url: "https://www.prnewswire.com/x", title: "Gladia Raises $16 Million in Series A Funding", provider: "serper", query_label: "funding", content: "PARIS, Oct. 15, 2024 /PRNewswire/ -- Gladia raised a $16 million Series A" }]);
    const { round, dropped } = groundRoundDetails(seriesA, sources2);
    expect(round.announcement_date?.value).toBe("2024-10-15");
    expect(dropped).toContain("round_date_from_article");
  });
});

describe("isSameRound", () => {
  it("treats the same named stage as the same round when a date is missing or within 9 months", () => {
    expect(isSameRound({ round_type: "Seed", announcement_date: "2020-01-01" }, { round_type: "Seed", announcement_date: "2020-03-15" })).toBe(true);
    expect(isSameRound({ round_type: "Series B" }, { round_type: "Series B", announcement_date: "2022-01-01" })).toBe(true);
    expect(isSameRound({ round_type: "Seed", announcement_date: "2018-01-01" }, { round_type: "Seed", announcement_date: "2020-06-01" })).toBe(false);
  });
  it("matches different labels for the same money announced at the same time", () => {
    expect(isSameRound({ round_type: "Other", amount_raised: 5e6, announcement_date: "2021-03-01" }, { round_type: "Seed", amount_raised: 5.2e6, announcement_date: "2021-03-20" })).toBe(true);
  });
});

describe("planRoundWrites", () => {
  it("fills empty fields of the round already on file instead of inserting a duplicate (the double-Seed bug)", () => {
    const plan = planRoundWrites(
      [{ id: "r1", round_type: "Seed", amount_raised: 2e6, announcement_date: "2020-01-01", lead_investor: null, other_investors: null }],
      [{ round_type: "Seed", amount_raised: 2e6, announcement_date: "2020-03-01", lead_investor: "YC", other_investors: ["SV Angel"] }],
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toEqual([{ id: "r1", round_type: "Seed", patch: { lead_investor: "YC", investors: ["SV Angel"] } }]);
  });

  it("reports a same-round amount contradiction and leaves the row on file untouched", () => {
    const plan = planRoundWrites(
      [{ id: "r1", round_type: "Series A", amount_raised: 10e6, announcement_date: "2021-01-01" }],
      [{ round_type: "Series A", amount_raised: 25e6, announcement_date: "2021-02-01", lead_investor: "X" }],
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.conflicts[0].message).toContain("amount on file");
  });

  it("inserts genuinely new rounds, collapsing duplicates among the new ones and never storing IPO", () => {
    const plan = planRoundWrites([], [
      { round_type: "Seed", amount_raised: 1e6, announcement_date: "2019-01-01" },
      { round_type: "Seed", lead_investor: "YC", announcement_date: "2019-02-01" },
      { round_type: "Series A", amount_raised: 8e6, announcement_date: "2020-05-01" },
      { round_type: "IPO", announcement_date: "2024-01-01" },
    ]);
    expect(plan.inserts.map((r) => r.round_type)).toEqual(["Seed", "Series A"]);
    expect(plan.inserts[0]).toMatchObject({ amount_raised: 1e6, lead_investor: "YC" });
  });

  it("adds a newly found participant to an existing round's investors without dropping any on file", () => {
    const plan = planRoundWrites(
      [{ id: "r1", round_type: "Series A", amount_raised: 8e6, lead_investor: "a16z", other_investors: ["GV"] }],
      [{ round_type: "Series A", amount_raised: 8e6, lead_investor: "Andreessen Horowitz (a16z)", other_investors: ["GV", "Accel"] }],
    );
    expect(plan.updates[0].patch.investors).toEqual(["GV", "Accel"]);
  });
});

describe("deep-dive merges are fill-only", () => {
  const ev = <T,>(value: T) => ({ value, source_id: "S1", evidence_quote: "q" });
  const profile = (p: Partial<V2ProfileExtraction["profile"]>, extra: Partial<V2ProfileExtraction> = {}): V2ProfileExtraction => ({
    is_public_company: false, is_tech_company: true, profile: p, leadership: [], metrics: {}, ...extra,
  });

  it("never replaces a first-pass value, fills blanks, unions founders", () => {
    const merged = mergeProfileExtractions(
      profile({ founded_year: ev(2020), founders: [{ name: "Ann Lee" }] }),
      profile({ founded_year: ev(2019), description: "x", founders: [{ name: "ann lee" }, { name: "Bo Chen" }] }),
    );
    expect(merged.profile.founded_year?.value).toBe(2020);
    expect(merged.profile.description).toBe("x");
    expect(merged.profile.founders?.map((f) => f.name)).toEqual(["Ann Lee", "Bo Chen"]);
  });

  it("takes a deep-dive city only when its country agrees with the first pass", () => {
    const agree = mergeProfileExtractions(profile({ country: ev("Israel") }), profile({ city: ev("Tel Aviv"), country: ev("Israel") }));
    expect(agree.profile.city?.value).toBe("Tel Aviv");
    const disagree = mergeProfileExtractions(profile({ country: ev("Israel") }), profile({ city: ev("London"), country: ev("United Kingdom") }));
    expect(disagree.profile.city).toBeUndefined();
    expect(disagree.profile.country?.value).toBe("Israel");
  });

  it("unions competitors/news by identity, newest news first", () => {
    const base = { ...emptyMarketExtraction(), competitors: [{ name: "Substack", how_it_competes: "a" }], news: [{ title: "a", url: "https://x.com/a", published_date: "2024-01-01" }] };
    const extra = { ...emptyMarketExtraction(), competitors: [{ name: "substack", how_it_competes: "b" }, { name: "Beehiiv", how_it_competes: "c" }], news: [{ title: "b", url: "https://www.x.com/a/", published_date: "2024-01-01" }, { title: "c", url: "https://y.com/c", published_date: "2025-01-01" }] };
    const merged = mergeMarketExtractions(base, extra);
    expect(merged.competitors.map((c) => c.name)).toEqual(["Substack", "Beehiiv"]);
    expect(merged.news.map((n) => n.url)).toEqual(["https://y.com/c", "https://x.com/a"]);
  });

  it("a deep dive that finds rounds overturns a first-pass 'history complete'", () => {
    const empty = { funding_rounds: [], funding_history_complete: true, arr_milestones: [], revenue_estimate: null, valuation_benchmarks: [] };
    const merged = mergeFundingExtractions(empty, { ...empty, funding_history_complete: false, funding_rounds: [{ round_type: "Seed" }] });
    expect(merged.funding_history_complete).toBe(false);
    expect(merged.funding_rounds).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("normalizeIsoDate pads partial dates and rejects future/garbage", () => {
    expect(normalizeIsoDate("2023-06", "2026-01-01")).toBe("2023-06-01");
    expect(normalizeIsoDate("2023", "2026-01-01")).toBe("2023-01-01");
    expect(normalizeIsoDate("2027-01-01", "2026-01-01")).toBeNull();
    expect(normalizeIsoDate("last year")).toBeNull();
  });
  it("appendNew keeps every existing entry and appends only unseen ones", () => {
    expect(appendNew([1, 2], [2, 3, 4], String, 3)).toEqual([1, 2, 3]);
  });
});

describe("reconcileOnFile — contradictions written by earlier runs", () => {
  it("removes a self-acquisition, a competitor that is also an acquisition, and a pre-founding news date", () => {
    const out = reconcileOnFile({
      companyName: "Glamsquad", foundedYear: 2014,
      competitors: [{ name: "Zeel" }, { name: "Blow" }],
      acquisitions: [{ company_name: "Veluxe" }, { company_name: "Blow Me" }, { company_name: "GLAMSQUAD" }],
      news: [{ published_date: "2011-05-05" }, { published_date: "2014-10-22" }, { published_date: null }],
    });
    expect(out.competitors.map((c) => c.name)).toEqual(["Zeel"]);
    expect(out.acquisitions.map((a) => a.company_name)).toEqual(["Veluxe", "Blow Me"]);
    expect(out.news.map((n) => n.published_date)).toEqual([null, "2014-10-22", null]);
    expect(out.notes).toHaveLength(3);
  });
  it("leaves consistent data untouched", () => {
    const out = reconcileOnFile({ companyName: "Gladia", foundedYear: 2022, competitors: [{ name: "Deepgram" }], acquisitions: [], news: [{ published_date: "2023-06-19" }] });
    expect(out.notes).toEqual([]);
  });
});
