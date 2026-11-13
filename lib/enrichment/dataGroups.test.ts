import { describe, it, expect } from "vitest";
import { dataGroup, presentFields, tldBucket, spreadPick } from "./dataGroups";
import { whyNotEnriched, notEnrichedReport } from "./notEnriched";

const base = { description: null, city: null, country: null, founded_year: null, founders: [], rounds: 0 };
describe("data groups (owner, 2026-11-13)", () => {
  it("empty: none of description, headquarters, founded year, rounds, founders", () => {
    expect(dataGroup(base)).toBe("empty");
    expect(dataGroup({ ...base, description: "  " })).toBe("empty");
  });
  it("partial: one to four, or five with a short description", () => {
    expect(dataGroup({ ...base, country: "Israel" })).toBe("partial");
    expect(dataGroup({ description: "x".repeat(150), city: "Tel Aviv", country: null, founded_year: 2019, founders: [{}], rounds: 1 })).toBe("partial");
    expect(presentFields({ ...base, rounds: 2, founders: [{}] })).toEqual(["rounds", "founders"]);
  });
  it("full: all five, a description of 200 characters or more", () => {
    expect(dataGroup({ description: "x".repeat(250), city: "Tel Aviv", country: "Israel", founded_year: 2019, founders: [{}], rounds: 1 })).toBe("full");
  });
  it("buckets by the website's domain ending; generic domains have no country", () => {
    expect(["https://a.co.il", "https://b.co.uk", "https://c.de", "https://d.com", "https://e.io", "https://f.in", "https://g.com.br", "https://h.ae", "https://i.ca", "https://j.co"].map(tldBucket))
      .toEqual(["israel", "uk_ireland", "europe", "generic", "generic", "asia_pacific", "latin_america", "middle_east_africa", "north_america", "generic"]);
  });
  it("a spread pick takes round-robin from the buckets, generic last", () => {
    const pool = ["a.il", "b.il", "c.il", "d.de", "e.in", "f.com", "g.com", "h.com"].map((w, i) => ({ id: String(i), website: `https://${w}` }));
    const picked = spreadPick(pool, 5).map((c) => c.bucket);
    expect(picked.slice(0, 3).sort()).toEqual(["asia_pacific", "europe", "israel"]);
    expect(picked).toHaveLength(5);
    expect(picked.filter((b) => b === "israel").length).toBeLessThanOrEqual(2);
  });
});

describe("why a company was not enriched (owner, 2026-11-13)", () => {
  it("maps each outcome to a reason", () => {
    expect(whyNotEnriched("rejected", "not_technology", undefined, "https://x.com")).toBe("not_technology");
    expect(whyNotEnriched("public", undefined, undefined, "https://x.com")).toBe("public_company");
    expect(whyNotEnriched("low_evidence", undefined, "content_mismatch", "https://x.com")).toBe("identity_uncertain");
    expect(whyNotEnriched("no_data", "all_searches_failed", "unreadable", "https://x.com")).toBe("website_unreadable");
    expect(whyNotEnriched("collected", undefined, undefined, "https://x.com")).toBeNull();
    expect(whyNotEnriched("collected", undefined, undefined, "")).toBe("no_website");
  });
  it("the report counts by reason", () => {
    const rows = [{ company: "A", website: "w", why: "not_technology" as const, detail: "" }, { company: "B", website: "w", why: "not_technology" as const, detail: "" }, { company: "C", website: "w", why: "identity_uncertain" as const, detail: "" }];
    expect(notEnrichedReport(rows, 25)).toEqual(["Not enriched: 3 of 25 companies", "     2  not a technology company", "     1  identity not certain (the site is another company's, or too few results are about this company)"]);
  });
});
