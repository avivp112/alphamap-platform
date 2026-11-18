import { describe, it, expect } from "vitest";
import {
  parseMoneyUsd, parseCheckRange, parseFundSizeMillions, regionOfHq, stageOptions, normalizeSectors, sectorShare, sectorOptions, toVcFirm,
  matchesVcFilters, EMPTY_VC_FILTERS, sortFirms, nextVcSort, isOpenOffering, groupFilings, raisingInvestorIds, soldPercent, activeVcFilterCount,
  toggleIn, type VcFirm, type VcFilterState, type FundFiling,
} from "./vcFirms";
import type { InvestorRow } from "./supabase";

const row = (over: Partial<InvestorRow> = {}): InvestorRow => ({
  id: "i1", name: "Northlight Capital", slug: "northlight", description: " Early-stage software. ", founded_year: 2014, headquarters: "Tel Aviv, Israel",
  fund_size: "$150M", typical_check_size: "$1M-$5M", portfolio_size: 64, stages: ["Seed", "Series A"], sector_allocation: { AI: 55, FinTech: 25, Cyber: 20 },
  notable_investments: ["Lumora Health"], website: "https://example.com", tier: 2, updated_at: "2026-11-01", ...over,
});

describe("money and ranges", () => {
  it("parses amounts with units", () => {
    expect(parseMoneyUsd("$1.5M")).toBe(1_500_000);
    expect(parseMoneyUsd("500K")).toBe(500_000);
    expect(parseMoneyUsd("$2B")).toBe(2_000_000_000);
    expect(parseMoneyUsd("$1,200,000")).toBe(1_200_000);
    expect(parseMoneyUsd("")).toBeNull();
    expect(parseMoneyUsd("n/a")).toBeNull();
  });
  it("parses check ranges", () => {
    expect(parseCheckRange("$1M-$5M")).toEqual({ min: 1e6, max: 5e6 });
    expect(parseCheckRange("$500K to $2M")).toEqual({ min: 5e5, max: 2e6 });
    expect(parseCheckRange("$1M")).toEqual({ min: 1e6, max: 1e6 });
    expect(parseCheckRange("$1-5M")).toEqual({ min: 1e6, max: 5e6 });
    expect(parseCheckRange(null)).toBeNull();
    expect(parseCheckRange("varies")).toBeNull();
  });
  it("parses fund size to millions", () => {
    expect(parseFundSizeMillions("$150M")).toBe(150);
    expect(parseFundSizeMillions("$1.2B")).toBe(1200);
    expect(parseFundSizeMillions("undisclosed")).toBeNull();
  });
});

describe("regions", () => {
  it("matches whole words only", () => {
    expect(regionOfHq("Tel Aviv, Israel")).toBe("Israel");
    expect(regionOfHq("London, UK")).toBe("Europe");
    expect(regionOfHq("Duke Street, Durham")).toBeNull();
    expect(regionOfHq("New York, NY, USA")).toBe("North America");
    expect(regionOfHq("Singapore")).toBe("Asia-Pacific");
    expect(regionOfHq("Dubai, UAE")).toBe("MENA");
  });
  it("leaves an unknown or empty place unknown, never a guess", () => {
    expect(regionOfHq("Atlantis")).toBeNull();
    expect(regionOfHq("")).toBeNull();
    expect(regionOfHq(null)).toBeNull();
  });
});

describe("toVcFirm", () => {
  it("keeps what the row says and nothing else", () => {
    const f = toVcFirm(row());
    expect(f).toMatchObject({ name: "Northlight Capital", description: "Early-stage software.", foundedYear: 2014, region: "Israel", fundSizeM: 150, checkMinUsd: 1e6, checkMaxUsd: 5e6, portfolio: 64 });
    expect(f.sectors.map((s) => s.sector)).toEqual(["AI", "FinTech", "Cyber"]);
  });
  it("leaves missing values missing", () => {
    const f = toVcFirm(row({ fund_size: null, typical_check_size: null, portfolio_size: null, founded_year: null, headquarters: null, description: null, sector_allocation: {}, stages: [], notable_investments: [] }));
    expect(f).toMatchObject({ fundSizeM: null, fundSizeLabel: null, checkMinUsd: null, checkLabel: null, portfolio: null, foundedYear: null, hq: null, region: null, description: null });
    expect(f.sectors).toEqual([]);
  });
  it("treats a zero portfolio or year as not filled in", () => {
    const f = toVcFirm(row({ portfolio_size: 0, founded_year: 0 }));
    expect(f.portfolio).toBeNull();
    expect(f.foundedYear).toBeNull();
  });
});

describe("sectors and stages", () => {
  it("measures the share of a sector", () => {
    const f = toVcFirm(row());
    expect(sectorShare(f, "ai")).toBeCloseTo(0.55);
    expect(sectorShare(f, "Biotech")).toBe(0);
    expect(normalizeSectors({ A: 0, B: -3, C: 10 })).toEqual([{ sector: "C", weight: 10 }]);
  });
  it("lists the sectors firms focus on, most firms first", () => {
    const firms = [toVcFirm(row()), toVcFirm(row({ id: "i2", sector_allocation: { FinTech: 70, SaaS: 30 } })), toVcFirm(row({ id: "i3", sector_allocation: { FinTech: 90, AI: 10 } }))];
    expect(sectorOptions(firms)[0]).toEqual({ sector: "FinTech", count: 3 });
    expect(sectorOptions(firms).map((s) => s.sector)).not.toContain("Cyber"); // 20% is under the focus share
  });
  it("orders stages early to late and keeps unknown ones", () => {
    const firms = [toVcFirm(row({ stages: ["Growth", "Seed"] })), toVcFirm(row({ id: "x", stages: ["Series A", "Mezzanine"] }))];
    expect(stageOptions(firms)).toEqual(["Seed", "Series A", "Growth", "Mezzanine"]);
  });
});

describe("filters", () => {
  const ctx = { followed: new Set(["i1"]), raising: new Set(["i2"]) };
  const f1 = toVcFirm(row());
  const f2 = toVcFirm(row({ id: "i2", name: "Harbor", headquarters: "London, UK", stages: ["Series A", "Series B"], fund_size: "$420M", typical_check_size: "$5M-$20M", sector_allocation: { FinTech: 80, SaaS: 20 } }));
  const f3 = toVcFirm(row({ id: "i3", name: "Mystery", headquarters: null, fund_size: null, typical_check_size: null, stages: [], sector_allocation: {} }));
  const S = (over: Partial<VcFilterState>): VcFilterState => ({ ...EMPTY_VC_FILTERS, ...over });
  const names = (s: VcFilterState) => [f1, f2, f3].filter((f) => matchesVcFilters(f, s, ctx)).map((f) => f.name);

  it("keeps everything with no filter", () => expect(names(EMPTY_VC_FILTERS)).toEqual(["Northlight Capital", "Harbor", "Mystery"]));
  it("filters by stage, sector and region", () => {
    expect(names(S({ stages: ["seed"] }))).toEqual(["Northlight Capital"]);
    expect(names(S({ sectors: ["FinTech"] }))).toEqual(["Northlight Capital", "Harbor"]);
    expect(names(S({ regions: ["Europe"] }))).toEqual(["Harbor"]);
  });
  it("matches a check range by overlap", () => {
    expect(names(S({ checkIds: ["a"] }))).toEqual(["Northlight Capital", "Harbor"]);   // $1-5M and $5-20M both reach $2M-$10M
    expect(names(S({ checkIds: ["micro"] }))).toEqual([]);
    expect(names(S({ checkIds: ["growth"] }))).toEqual(["Harbor"]);
  });
  it("drops firms with no value when a value is asked for", () => {
    expect(names(S({ fundIds: ["mid"] }))).toEqual(["Northlight Capital", "Harbor"]);
    expect(names(S({ fundIds: ["small", "mid", "large", "xl"] }))).not.toContain("Mystery");
  });
  it("follows the watchlist and open offerings", () => {
    expect(names(S({ followingOnly: true }))).toEqual(["Northlight Capital"]);
    expect(names(S({ raisingOnly: true }))).toEqual(["Harbor"]);
  });
  it("counts and toggles", () => {
    expect(activeVcFilterCount(S({ stages: ["Seed"], raisingOnly: true }))).toBe(2);
    expect(toggleIn(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleIn(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("sorting", () => {
  const firms: VcFirm[] = [
    toVcFirm(row({ id: "a", name: "Alpha", fund_size: "$100M", portfolio_size: 10 })),
    toVcFirm(row({ id: "b", name: "Beta", fund_size: null, portfolio_size: 50 })),
    toVcFirm(row({ id: "c", name: "Gamma", fund_size: "$900M", portfolio_size: null })),
  ];
  it("puts firms without a value last, both ways", () => {
    expect(sortFirms(firms, { key: "fundSize", dir: "desc" }).map((f) => f.name)).toEqual(["Gamma", "Alpha", "Beta"]);
    expect(sortFirms(firms, { key: "fundSize", dir: "asc" }).map((f) => f.name)).toEqual(["Alpha", "Gamma", "Beta"]);
    expect(sortFirms(firms, { key: "portfolio", dir: "desc" }).map((f) => f.name)).toEqual(["Beta", "Alpha", "Gamma"]);
  });
  it("sorts names A to Z first and cycles back to the default", () => {
    let s = nextVcSort(null, "name");
    expect(s).toEqual({ key: "name", dir: "asc" });
    s = nextVcSort(s, "name"); expect(s).toEqual({ key: "name", dir: "desc" });
    expect(nextVcSort(s, "name")).toBeNull();
    expect(nextVcSort(null, "fundSize")).toEqual({ key: "fundSize", dir: "desc" });
  });
});

describe("SEC fund filings", () => {
  const now = Date.UTC(2026, 10, 17);
  const filing = (over: Partial<FundFiling> = {}): FundFiling => ({ investorId: "i1", name: "Fund III", fundSeries: 3, filedOn: "2026-10-28", amendedOn: null, offering: 150e6, sold: 128e6, url: null, ...over });
  it("calls an offering open when recent and not fully sold", () => {
    expect(isOpenOffering(filing(), now)).toBe(true);
    expect(isOpenOffering(filing({ sold: 150e6 }), now)).toBe(false);
    expect(isOpenOffering(filing({ filedOn: "2024-01-01" }), now)).toBe(false);
    expect(isOpenOffering(filing({ sold: null }), now)).toBe(false);
    expect(isOpenOffering(filing({ offering: 0 }), now)).toBe(false);
  });
  it("groups newest first and finds who is raising", () => {
    const g = groupFilings([filing({ filedOn: "2025-01-01", name: "Fund II" }), filing(), filing({ investorId: "i2", sold: 1e6, offering: 1e6 })]);
    expect(g.get("i1")!.map((f) => f.name)).toEqual(["Fund III", "Fund II"]);
    expect([...raisingInvestorIds(g, now)]).toEqual(["i1"]);
  });
  it("computes how much of an offering is sold", () => {
    expect(soldPercent({ sold: 128e6, offering: 150e6 })).toBe(85);
    expect(soldPercent({ sold: 200e6, offering: 150e6 })).toBe(100);
    expect(soldPercent({ sold: null, offering: 150e6 })).toBeNull();
  });
});
