import { describe, it, expect } from "vitest";
import { injectKnown } from "./knownInject";

const entry = (field: string, value: string, url = "https://example.com/about", quote = "") => ({ company_id: "c1", company: "Acme", field, value, source_url: url, quote: quote || `${value} is here`, verified_at: "2026-11-15", run_id: "r" });
const fake = () => ({ profile: { profile: {} as Record<string, unknown> }, allSources: [] as Array<Record<string, unknown>>, sourceById: new Map<string, unknown>(), validation: { accepted: { city: null, country: null, founded_year: null, employee_count: null } }, cityConfidence: 0, countryConfidence: 0 });

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
});
