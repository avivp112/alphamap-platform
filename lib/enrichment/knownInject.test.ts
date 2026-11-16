import { describe, it, expect } from "vitest";
import { injectKnown } from "./knownInject";

const entry = (field: string, value: string, url = "https://example.com/about", quote = "") => ({ company_id: "c1", company: "Acme", field, value, source_url: url, quote: quote || `${value} is here`, verified_at: "2026-11-15", run_id: "r" });
const fake = () => ({ funding: { funding_rounds: [] as Array<Record<string, unknown>> }, existingRefs: [] as Array<Record<string, unknown>>, plan: { inserts: [] as Array<Record<string, unknown>>, updates: [], conflicts: [] }, market: { news: [] as Array<Record<string, unknown>> }, profile: { profile: {} as Record<string, unknown>, leadership: [] as Array<Record<string, unknown>> }, allSources: [] as Array<Record<string, unknown>>, sourceById: new Map<string, unknown>(), validation: { accepted: { city: null, country: null, founded_year: null, employee_count: null } }, cityConfidence: 0, countryConfidence: 0 });

describe("the memory enters the write stage (owner, round 10)", () => {
  it("fills what the run did not find, with a source of its own, and leaves what it found", () => {
    const c = fake();
    (c.profile.profile as Record<string, unknown>).country = { value: "Canada", source_id: "S1", evidence_quote: "q" };
    const done = injectKnown(c as never, [entry("hq_city", "Toronto"), entry("hq_country", "Canada"), entry("founded_year", "2016"), entry("description", "Acme sells widgets to factories."), entry("sector", "Industrial & Manufacturing (industry: Industrial & Manufacturing)"), entry("tags", "Robotics, Industrial Automation")], "example.com");
    expect(done).toEqual(["hq_city", "founded_year", "description", "sector", "tags"]);
    const p = c.profile.profile as Record<string, any>;
    expect(p.city.value).toBe("Toronto");
    expect(p.city.source_id).toMatch(/^K\d/);
    expect(c.validation.accepted.city).toBe("Toronto");
    expect(c.validation.accepted.founded_year).toBe(2016);
    expect(p.description_sentences[0].source_ids).toHaveLength(1);
    expect(p.description_complete).toBe(true);
    expect(p.sector_name).toBe("Industrial & Manufacturing");
    expect(p.sub_sector_names).toEqual(["Robotics", "Industrial Automation"]);
    expect(c.sourceById.size).toBeGreaterThan(0);
    expect((c.allSources.find((s) => s.url === "https://example.com/about") as any).source_type).toBe("company_site");
  });
  it("a what-only description stays what-only", () => {
    const c = fake();
    injectKnown(c as never, [entry("description_what_only", "Acme sells widgets.")], null);
    expect((c.profile.profile as any).description_complete).toBe(false);
  });
  it("news, founders and leaders are added once, by address and by name", () => {
    const c = fake();
    (c.market.news as Array<Record<string, unknown>>).push({ title: "Found", url: "https://a.com/1" });
    const done = injectKnown(c as never, [entry("news", "2024-05-01 — Acme raises", "https://a.com/1"), entry("news", "2024-06-01 — Acme launches", "https://a.com/2"), entry("founder", "Ann Lee — Co-founder & CEO"), entry("leader", "Bob Roy — CFO · bio text")], null);
    expect(c.market.news.map((n) => n.url)).toEqual(["https://a.com/1", "https://a.com/2"]);
    expect(((c.profile.profile as any).founders[0])).toMatchObject({ name: "Ann Lee", title: "Co-founder & CEO", grounded_url: "https://example.com/about" });
    expect(c.profile.leadership[0]).toMatchObject({ name: "Bob Roy", role: "CFO" });
    expect(done).toEqual(expect.arrayContaining(["news", "founder", "leader"]));
  });
  it("a round returns with its sources and enters the plan once", () => {
    const payload = JSON.stringify({ round: { round_type: "Series B", amount_raised: 70_000_000, announcement_date: "2021-12-01", announcement_date_precision: "month", lead_investor: "Tencent" }, evidence: [{ field: "amount_raised", value: 70_000_000, source_url: "https://techcrunch.com/x", quote: "raised $70 million" }, { field: "lead_investor", value: "Tencent", source_url: "https://techcrunch.com/x", quote: "led by Tencent" }] });
    const c = fake();
    const e = { ...entry("round", "Series B $70M · 2021-12 (month only) · lead Tencent"), payload };
    expect(injectKnown(c as never, [e], null)).toContain("round");
    expect(c.plan.inserts).toHaveLength(1);
    expect((c.funding.funding_rounds[0] as any).amount_raised).toMatchObject({ value: 70_000_000, evidence_quote: "raised $70 million" });
    expect(injectKnown(c as never, [e], null)).not.toContain("round");
    expect(c.plan.inserts).toHaveLength(1);
  });
});
