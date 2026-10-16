import { describe, it, expect } from "vitest";
import { validateCheckInput, normalizeWebsite, normalizeLinkedIn, decideAllowance, monthStartUtc } from "./company-check";
import { CHECK_LIMITS } from "./check-limits";

describe("validateCheckInput", () => {
  it("requires only a name and normalises the rest", () => {
    const r = validateCheckInput({ name: "  Nuova   AI ", website: "www.nuova.ai/", linkedin: "linkedin.com/company/Nuova-AI/about", sector: "AI & ML" });
    expect(r).toEqual({ ok: true, input: {
      name: "Nuova AI", website: "https://nuova.ai", host: "nuova.ai",
      linkedin: "https://www.linkedin.com/company/nuova-ai", country: null, founder: null, sector: "AI & ML",
    } });
  });
  it("says which field is wrong instead of guessing", () => {
    const r = validateCheckInput({ name: "", website: "not a url", linkedin: "https://linkedin.com/in/jane" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["linkedin", "name", "website"]);
  });
});

describe("normalizeWebsite", () => {
  it("keeps the company's own site, drops platform profiles", () => {
    expect(normalizeWebsite("HTTP://Acme.co.uk/en")).toEqual({ website: "https://acme.co.uk/en", host: "acme.co.uk" });
    expect(normalizeWebsite("https://www.linkedin.com/company/acme")).toBeNull();
    expect(normalizeWebsite("crunchbase.com/organization/acme")).toBeNull();
    expect(normalizeWebsite("localhost")).toBeNull();
  });
});

describe("normalizeLinkedIn", () => {
  it("accepts company pages only", () => {
    expect(normalizeLinkedIn("https://il.linkedin.com/company/acme-ai/")).toBe("https://www.linkedin.com/company/acme-ai");
    expect(normalizeLinkedIn("https://www.linkedin.com/in/jane-doe")).toBeNull();
  });
});

describe("decideAllowance", () => {
  it("free plan: one check a month; a match of an existing company is not charged", () => {
    expect(decideAllowance({ plan: "free", chargedThisMonth: 0, requestsLastHour: 0 }, true).ok).toBe(true);
    expect(decideAllowance({ plan: "free", chargedThisMonth: 1, requestsLastHour: 0 }, true))
      .toMatchObject({ ok: false, reason: "monthly_limit", remaining: 0 });
    expect(decideAllowance({ plan: "free", chargedThisMonth: 1, requestsLastHour: 0 }, false).ok).toBe(true);
  });
  it("the rate limit applies to every request", () => {
    expect(decideAllowance({ plan: "pro", chargedThisMonth: 0, requestsLastHour: CHECK_LIMITS.pro.requestsPerHour }, false))
      .toMatchObject({ ok: false, reason: "rate_limited" });
  });
  it("an unknown plan string is treated as free", () => {
    expect(decideAllowance({ plan: "gold", chargedThisMonth: 0, requestsLastHour: 0 }, true).limits).toEqual(CHECK_LIMITS.free);
  });
  it("month boundary is UTC", () => {
    expect(monthStartUtc(new Date("2026-10-31T23:30:00-05:00")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});
