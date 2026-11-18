import { describe, it, expect, beforeEach } from "vitest";
import {
  EMPTY_DEAL_FILTERS, activeDealFilterCount, toggleSector, filedCutoff, buildDealChips,
  isNewDeal, readSeenThrough, writeSeenThrough, followTarget, followedIds, type DealFilterState,
} from "./dealFilters";

const F = (over: Partial<DealFilterState> = {}): DealFilterState => ({ ...EMPTY_DEAL_FILTERS, ...over });

describe("filters", () => {
  it("counts each active filter once", () => {
    expect(activeDealFilterCount(EMPTY_DEAL_FILTERS)).toBe(0);
    expect(activeDealFilterCount(F({ sectors: ["AI & ML", "Fintech"], filedWithinDays: 30, status: "verified", followingOnly: true,
      sold: { min: 5e6, max: null, includeUnknown: true } }))).toBe(5);
  });
  it("toggles a sector", () => {
    expect(toggleSector([], "Fintech")).toEqual(["Fintech"]);
    expect(toggleSector(["Fintech", "AI & ML"], "Fintech")).toEqual(["AI & ML"]);
  });
  it("cuts off by filing date in UTC", () => {
    const now = Date.UTC(2026, 10, 17, 15, 0, 0);
    expect(filedCutoff(7, now)).toBe("2026-11-10");
    expect(filedCutoff(30, now)).toBe("2026-10-18");
  });
});

describe("chips", () => {
  it("is empty with no filters", () => expect(buildDealChips(EMPTY_DEAL_FILTERS)).toEqual([]));
  it("lists each active filter in bar order", () => {
    const chips = buildDealChips(F({ sectors: ["AI & ML"], filedWithinDays: 7, status: "unreviewed", followingOnly: true,
      sold: { min: 25e6, max: 100e6, includeUnknown: true } }));
    expect(chips.map((c) => c.id)).toEqual(["sectors", "filed", "sold", "status", "following"]);
    expect(chips[2].label).toBe("Sold: $25M to $100M");
    expect(chips[3].label).toBe("Not yet reviewed");
  });
  it("uses the translator when given", () => {
    expect(buildDealChips(F({ filedWithinDays: 30 }), (k, v) => `${k}:${v.count}`)[0].label).toBe("chip.filed:30");
  });
});

describe("new since the last visit", () => {
  const store: Record<string, string> = {};
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => {}, key: () => null, length: 0,
    } as Storage;
  });
  it("is not new when nothing has been seen yet", () => expect(isNewDeal({ deal_date: "2026-11-14" }, null)).toBe(false));
  it("is new only when filed after the newest seen filing", () => {
    expect(isNewDeal({ deal_date: "2026-11-14" }, "2026-11-13")).toBe(true);
    expect(isNewDeal({ deal_date: "2026-11-13" }, "2026-11-13")).toBe(false);
    expect(isNewDeal({ deal_date: "2026-11-01" }, "2026-11-13")).toBe(false);
  });
  it("remembers the marker per kind and ignores junk", () => {
    expect(readSeenThrough("company")).toBeNull();
    writeSeenThrough("company", "2026-11-14");
    expect(readSeenThrough("company")).toBe("2026-11-14");
    expect(readSeenThrough("fund")).toBeNull();
    writeSeenThrough("fund", "yesterday");
    expect(readSeenThrough("fund")).toBeNull();
    store["am_deals_seen_company"] = "not a date";
    expect(readSeenThrough("company")).toBeNull();
  });
});

describe("following", () => {
  it("finds the watchlist entry of a deal", () => {
    expect(followTarget({ kind: "company", startup_id: "s1", investor_id: null })).toEqual({ type: "startup", id: "s1" });
    expect(followTarget({ kind: "fund", startup_id: null, investor_id: "i1" })).toEqual({ type: "investor", id: "i1" });
    expect(followTarget({ kind: "company", startup_id: null, investor_id: null })).toBeNull();
    expect(followTarget({ kind: "fund", startup_id: null, investor_id: null })).toBeNull();
  });
  it("reads ids of one kind from membership keys", () => {
    const keys = new Set(["startup:a", "investor:b", "startup:c"]);
    expect(followedIds(keys, "startup")).toEqual(["a", "c"]);
    expect(followedIds(keys, "investor")).toEqual(["b"]);
    expect(followedIds(new Set(), "startup")).toEqual([]);
  });
});
