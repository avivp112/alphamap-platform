import { describe, it, expect } from "vitest";
import {
  parseMillions, formatUsdShort, rangeLabel, normalizeRange, rangeIsActive, valuationOrClause, EMPTY_RANGE,
  stageRounds, toggleStage, nextSort, isSortKey, daysSince, freshnessLabel, isStale, trendView, buildChips,
  type MoneyRange, type ChipInput,
} from "./startupFilters";

const R = (min: number | null, max: number | null, includeUnknown = true): MoneyRange => ({ min, max, includeUnknown });

describe("money ranges", () => {
  it("parses millions typed by the user", () => {
    expect(parseMillions("50")).toBe(50_000_000);
    expect(parseMillions(" $1,250 ")).toBe(1_250_000_000);
    expect(parseMillions("0.5")).toBe(500_000);
    expect(parseMillions("")).toBeNull();
    expect(parseMillions("abc")).toBeNull();
    expect(parseMillions("-3")).toBeNull();
  });
  it("formats short USD", () => {
    expect(formatUsdShort(480_000_000)).toBe("$480M");
    expect(formatUsdShort(1_200_000_000)).toBe("$1.2B");
    expect(formatUsdShort(6_500_000)).toBe("$6.5M");
    expect(formatUsdShort(750_000)).toBe("$750K");
  });
  it("labels bounded, half-open and empty ranges", () => {
    expect(rangeLabel(R(50e6, 500e6))).toBe("$50M to $500M");
    expect(rangeLabel(R(50e6, null))).toBe("$50M and up");
    expect(rangeLabel(R(null, 500e6))).toBe("Up to $500M");
    expect(rangeLabel(EMPTY_RANGE)).toBe("");
  });
  it("swaps reversed bounds and detects activity", () => {
    expect(normalizeRange(R(500e6, 50e6))).toMatchObject({ min: 50e6, max: 500e6 });
    expect(rangeIsActive(EMPTY_RANGE)).toBe(false);
    expect(rangeIsActive(R(null, 1))).toBe(true);
  });
});

describe("valuationOrClause", () => {
  it("keeps companies without a valuation when asked", () => {
    expect(valuationOrClause(R(50e6, 500e6, true))).toBe("and(latest_valuation.gte.50000000,latest_valuation.lte.500000000),latest_valuation.is.null");
    expect(valuationOrClause(R(50e6, null, true))).toBe("latest_valuation.gte.50000000,latest_valuation.is.null");
    expect(valuationOrClause(R(null, 500e6, true))).toBe("latest_valuation.lte.500000000,latest_valuation.is.null");
  });
  it("returns null when unbounded or when unknowns are not wanted", () => {
    expect(valuationOrClause(EMPTY_RANGE)).toBeNull();
    expect(valuationOrClause(R(50e6, 500e6, false))).toBeNull();
  });
});

describe("stages", () => {
  it("unions the rounds behind several buckets", () => {
    const rounds = stageRounds(["seed", "series-a"]);
    expect(rounds).toEqual(expect.arrayContaining(["Seed", "Bridge", "Series A"]));
    expect(rounds).not.toContain("Series B");
  });
  it("is empty when nothing is chosen", () => expect(stageRounds([])).toEqual([]));
  it("toggles a bucket on and off", () => {
    expect(toggleStage([], "seed")).toEqual(["seed"]);
    expect(toggleStage(["seed", "series-a"], "seed")).toEqual(["series-a"]);
  });
});

describe("sorting", () => {
  it("only accepts whitelisted columns", () => {
    expect(isSortKey("latest_valuation")).toBe(true);
    expect(isSortKey("id; drop table")).toBe(false);
  });
  it("cycles text A-Z, Z-A, default and numbers high-low, low-high, default", () => {
    let s = nextSort(null, "name");
    expect(s).toEqual({ key: "name", dir: "asc" });
    s = nextSort(s, "name"); expect(s).toEqual({ key: "name", dir: "desc" });
    expect(nextSort(s, "name")).toBeNull();
    s = nextSort(null, "total_raised"); expect(s).toEqual({ key: "total_raised", dir: "desc" });
    s = nextSort(s, "total_raised"); expect(s).toEqual({ key: "total_raised", dir: "asc" });
    expect(nextSort(s, "total_raised")).toBeNull();
  });
  it("switching column starts that column's first direction", () => {
    expect(nextSort({ key: "name", dir: "desc" }, "employee_count")).toEqual({ key: "employee_count", dir: "desc" });
  });
});

describe("freshness", () => {
  const now = Date.UTC(2026, 10, 17);
  it("computes whole days", () => {
    expect(daysSince("2026-11-14T00:00:00Z", now)).toBe(3);
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince("not a date", now)).toBeNull();
    expect(daysSince("2026-11-20T00:00:00Z", now)).toBe(0);
  });
  it("labels and flags stale", () => {
    expect(freshnessLabel(0)).toBe("Today");
    expect(freshnessLabel(5)).toBe("5d");
    expect(freshnessLabel(20)).toBe("2w");
    expect(freshnessLabel(90)).toBe("3mo");
    expect(freshnessLabel(null)).toBe("—");
    expect(isStale(13)).toBe(false);
    expect(isStale(14)).toBe(true);
    expect(isStale(null)).toBe(false);
  });
});

describe("trendView", () => {
  it("maps the categorical trend", () => {
    expect(trendView("rapid growth")).toMatchObject({ arrow: "▲", tone: "pos" });
    expect(trendView("reduction")).toMatchObject({ arrow: "▼", tone: "neg" });
    expect(trendView("stable").tone).toBe("flat");
    expect(trendView("unknown").tone).toBe("none");
    expect(trendView(null).tone).toBe("none");
  });
});

describe("buildChips", () => {
  const base: ChipInput = {
    search: "", parentSector: "", subSector: "", subSectorTag: "", country: "", city: "", israelRelated: false,
    stageLabels: [], headcountLabel: null, momentum: false, density: "all", fundedWithinDays: null,
    valuation: EMPTY_RANGE, raised: EMPTY_RANGE, updatedWithinDays: null,
  };
  it("is empty when nothing is active", () => expect(buildChips(base)).toEqual([]));
  it("lists each active filter once", () => {
    const chips = buildChips({
      ...base, parentSector: "Fintech", subSector: "Payments", stageLabels: ["Seed", "Series A"],
      valuation: R(50e6, 500e6, true), updatedWithinDays: 7, density: "blue-ocean",
    });
    expect(chips.map((c) => c.id)).toEqual(["sector", "stage", "valuation", "density", "updated"]);
    expect(chips[0].label).toBe("Sector: Fintech › Payments");
    expect(chips[2].label).toBe("Valuation: $50M to $500M, or none");
  });
  it("a tag replaces the sector chip, as the two filters exclude each other", () => {
    const chips = buildChips({ ...base, parentSector: "Fintech", subSectorTag: "AI Agents" });
    expect(chips.map((c) => c.id)).toEqual(["subSectorTag"]);
  });
  it("uses the translator when given", () => {
    const chips = buildChips({ ...base, country: "Israel" }, (k, v) => `${k}:${v.value}`);
    expect(chips[0].label).toBe("chip.country:Israel");
  });
});
