import { describe, it, expect } from "vitest";
import { recommend, VERDICT_ORDER, RAISING_MIN_USD, type RecommendationInput } from "./candidateRecommendation";

const enr = (over: Record<string, unknown> = {}) => ({
  status: "verified", website: "https://acme.ai/", match_signals: [{ kind: "director", text: "x", url: "u" }, { kind: "postcode", text: "y", url: "u" }],
  site_signals: [], description_he: "בונה רחפנים לחקלאות", description_quote: "We build drones.", description_source_url: "u", source_urls: [], notes: [], enriched_at: "t", ...over,
});
const sig = (kind: string, level: "positive" | "info" | "warning", text = kind) => ({ kind, level, text });
const cand = (evidence: Record<string, unknown>, source = "sec_form_d", extra: Partial<RecommendationInput> = {}): RecommendationInput =>
  ({ source, gate_tier: "alert", evidence: evidence as never, ...extra });

describe("recommend", () => {
  it("a verified site with a quoted description and a product signal is recommended for approval", () => {
    const r = recommend(cand({ enrichment: enr({ site_signals: [{ kind: "jobs", level: "product", text: "יש עמוד משרות", url: "u" }] }) }));
    expect(r.verdict).toBe("approve");
    expect(r.label).toBe("מומלץ לאישור");
    expect(r.rules).toContain("A1_verified_site_with_substance");
    expect(r.reasons[0]).toContain("אתר רשמי מאומת");
    expect(r.reasons.join(" ")).toContain("בונה רחפנים לחקלאות");
  });
  it("a verified site with a description is enough when the company raised real money", () => {
    const r = recommend(cand({ enrichment: enr(), total_offering: RAISING_MIN_USD, industry_group: "Technology" }));
    expect(r.verdict).toBe("approve");
    expect(r.reasons.join(" ")).toContain("גייסה $1M");
  });
  it("a verified site with a description and nothing else is borderline: no evidence of a product", () => {
    expect(recommend(cand({ enrichment: enr() })).verdict).toBe("borderline");
  });
  it("a Form D with money, a core industry and a person seen before is approved even without a site", () => {
    const r = recommend(cand({ total_offering: 3_000_000, industry_group: "Computers", signals: { checked_at: "t", items: [sig("person_prior_form_d", "positive")] } }));
    expect(r.verdict).toBe("approve");
    expect(r.rules).toContain("A2_form_d_money_and_history");
  });
  it("a site that describes an agency or a consultancy is a reject, whatever else is in the card", () => {
    const r = recommend(cand({
      total_offering: 5_000_000, industry_group: "Technology",
      enrichment: enr({ site_signals: [{ kind: "agency", level: "services", text: "האתר מתאר סוכנות", url: "u" }] }),
      signals: { checked_at: "t", items: [sig("share_allotment", "positive")] },
    }, "uk_companies_house"));
    expect(r.verdict).toBe("reject");
    expect(r.reasons[0]).toContain("סוכנות");
  });
  it("two shell warnings and no strong sign, no verified site: reject", () => {
    const r = recommend(cand({ signals: { checked_at: "t", items: [sig("many_directorships", "warning"), sig("shared_address", "warning")] } }, "uk_companies_house"));
    expect(r.verdict).toBe("reject");
    expect(r.rules).toEqual(["R2_shell_warnings"]);
  });
  it("a UK candidate that surfaced from the watchlist with a verified site is approved; without a site it is borderline", () => {
    const base = { promoted_reason: "Share allotment filed (1, latest 2026-12-01)" };
    expect(recommend(cand({ enrichment: enr() }, "uk_companies_house", base)).verdict).toBe("approve");
    expect(recommend(cand({}, "uk_companies_house", base)).verdict).toBe("borderline");
  });
  it("no verified site says so outright, in the reasons", () => {
    const r = recommend(cand({ enrichment: enr({ status: "no_site", website: null, match_signals: [] }) }));
    expect(r.reasons.join(" ")).toContain("לא נמצאה זהות דיגיטלית מאומתת");
    expect(r.verdict).toBe("borderline");
  });
  it("an unverified site is never presented as a reason for approval", () => {
    const r = recommend(cand({ enrichment: enr({ status: "unverified", description_he: "x" }) }));
    expect(r.verdict).toBe("borderline");
    expect(r.reasons.join(" ")).not.toContain("אתר רשמי מאומת");
  });
  it("two shell warnings next to a registry sign downgrade an approval to borderline", () => {
    const r = recommend(cand({
      enrichment: enr({ site_signals: [{ kind: "jobs", level: "product", text: "יש עמוד משרות", url: "u" }] }),
      signals: { checked_at: "t", items: [sig("many_directorships", "warning"), sig("holding_psc", "warning")] },
    }, "uk_companies_house"));
    expect(r.verdict).toBe("borderline");
    expect(r.rules).toContain("D_shell_downgrade");
  });
  it("an empty card is borderline and says there is not enough to recommend", () => {
    const r = recommend(cand({}, "epo_ops"));
    expect(r.verdict).toBe("borderline");
    expect(r.reasons).toEqual(["אין עדיין מספיק מידע בכרטיס כדי להמליץ"]);
  });
  it("is deterministic and sorts recommended first", () => {
    const e = { enrichment: enr(), total_offering: 2_000_000, industry_group: "Technology" };
    expect(recommend(cand(e))).toEqual(recommend(cand(e)));
    expect(VERDICT_ORDER.approve).toBeLessThan(VERDICT_ORDER.borderline);
    expect(VERDICT_ORDER.borderline).toBeLessThan(VERDICT_ORDER.reject);
  });
});
