import { describe, it, expect } from "vitest";
import { canRetry, diffLines, identitySource, promotionSummary, TAB_STATUSES, PROMOTION_TABS, type CheckPromotion } from "./checkPromotion";

const sourced = <T,>(value: T) => ({ value, source_url: "https://x", quote: null, confidence: "high" as const });

function promo(over: Partial<CheckPromotion> = {}): CheckPromotion {
  return {
    id: "p1", check_id: "c1", status: "pending", startup_id: null, reviewed_at: null, review_note: null, error: null, created_at: "2026-10-19T08:00:00Z",
    check: {
      id: "c1", created_at: "2026-10-19T07:00:00Z",
      input: { name: "nuova", website: null, host: null, country: null, founder: null, linkedin: null, sector: null },
      identity: { name: "Nuova AI", website: "https://nuova.ai", source: "search" },
      gate: { status: "ready", reason: "Passed the checks." },
      progress: { generic_name: false },
      result: {
        profile: {
          overview: {
            description: "Predicts supply-chain disruptions.", value_proposition: null, industry: null, sector: "AI & ML", sub_sectors: [],
            founded_year: sourced(2023), city: sourced("Tel Aviv"), country: sourced("Israel"), headcount: sourced(24), employee_range: "11-50", linkedin_url: null,
          },
          people: { founders: [{ name: "Dana Levi", title: "CEO", bio: null, linkedin_url: null }, { name: "Omer Katz", title: null, bio: null, linkedin_url: null }], leadership: [] },
          funding: {
            rounds: [
              { round_type: "Pre-Seed", amount: 1_500_000, valuation: null, date: "2024-01-15", lead_investor: null, investors: [], source_url: null },
              { round_type: "Seed", amount: 8_000_000, valuation: null, date: "2025-05-10", lead_investor: "Sequoia Capital", investors: [], source_url: null },
            ],
            total_raised: 9_500_000, history_complete: true,
          },
          sources_count: 31,
        },
        investors: [{ name: "Sequoia Capital", investor_id: "i1", investor_name: "Sequoia Capital", companies: 40, rounds: 55, rounds_led: 20, main_stages: ["Seed"], led_here: true }],
      },
    },
    ...over,
  };
}

describe("promotionSummary", () => {
  it("shows the confirmed identity and the research the approval would write", () => {
    expect(promotionSummary(promo())).toEqual({
      name: "Nuova AI", website: "https://nuova.ai", description: "Predicts supply-chain disruptions.",
      facts: ["AI & ML", "Tel Aviv, Israel", "founded 2023", "24 employees"],
      founders: "Dana Levi (CEO), Omer Katz",
      funding: "2 rounds · $9.5M raised · latest: Seed $8M 2025-05",
      investors: "Sequoia Capital",
      sources: 31,
    });
  });
  it("missing is shown as missing, never guessed", () => {
    const p = promo();
    p.check!.result = null;
    p.check!.identity = null;
    expect(promotionSummary(p)).toEqual({ name: "nuova", website: null, description: null, facts: [], founders: null, funding: null, investors: null, sources: 0 });
  });
});

describe("the review rules", () => {
  it("a failed write is retried only if it never created its company", () => {
    expect(canRetry({ status: "failed", startup_id: null })).toBe(true);
    expect(canRetry({ status: "failed", startup_id: "s1" })).toBe(false);
    expect(canRetry({ status: "pending", startup_id: null })).toBe(false);
  });
  it("every status is on exactly one tab", () => {
    const all = PROMOTION_TABS.flatMap((t) => TAB_STATUSES[t]);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(["approved", "failed", "linked", "pending", "rejected", "writing", "written"]);
  });
  it("tells a website the user gave from one picked in the search", () => {
    expect(identitySource(promo())).toBe("search");
    expect(identitySource(promo({ check: { ...promo().check!, identity: { source: "your_website" } } }))).toBe("your_website");
    expect(identitySource(promo({ check: null }))).toBeNull();
  });
});

describe("diffLines — an update as the admin reads it", () => {
  it("additions, changes, rounds and lists, nothing invented", () => {
    expect(diffLines({
      fields: [{ field: "country", from: null, to: "Israel" }, { field: "employee_count", from: 20, to: 45 },
        { field: "revenue_estimate", from: null, to: { range_low: 5_000_000, range_high: 10_000_000 } }],
      lists: [{ field: "founders", added: ["Omer Katz"] }],
      rounds: { inserts: [{ round_type: "Seed", amount: 8_000_000, date: "2025-05-10", lead: "Sequoia", source_url: null }],
                updates: [{ round_type: "Pre-Seed", changes: ["lead_investor"] }] },
      headcount_points: 2, tags: ["AI Agents"],
    })).toEqual([
      { kind: "add", text: "Country: Israel" },
      { kind: "change", text: "Employees: 20 → 45" },
      { kind: "add", text: "Revenue estimate: $5M–$10M" },
      { kind: "add", text: "Founders: Omer Katz" },
      { kind: "add", text: "Round: Seed $8M 2025-05 (lead: Sequoia)" },
      { kind: "change", text: "Round Pre-Seed: fills lead investor" },
      { kind: "add", text: "Headcount: 2 dated points" },
      { kind: "add", text: "Sub-sector tags: AI Agents" },
    ]);
  });
  it("no diff: no lines", () => { expect(diffLines(null)).toEqual([]); });
});
