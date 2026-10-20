import { describe, it, expect } from "vitest";
import { validateCheckInput, normalizeWebsite, normalizeLinkedIn, decideAllowance, monthStartUtc, applyChoice, decideDeepen } from "./company-check";
import { CHECK_LIMITS, FREE_OF_CHARGE_STATUSES } from "./check-limits";

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

describe("applyChoice", () => {
  const typed = (validateCheckInput({ name: "Nuova AI", country: "Israel" }) as { ok: true; input: import("./company-check").CheckInput }).input;
  const cands = [
    { name: "Nuova AI", website: "https://www.nuova.ai/", startup_id: null },
    { name: "Nuova", website: "https://getnuova.com", startup_id: "6f1c2a7e-1b2c-4d5e-8f90-123456789abc" },
  ];
  it("a chosen candidate's website becomes the check's website", () => {
    const r = applyChoice(typed, cands, 0);
    expect(r).toMatchObject({ ok: true, startupId: null, input: { name: "Nuova AI", website: "https://nuova.ai", host: "nuova.ai", country: "Israel" } });
  });
  it("a candidate already in AlphaMap returns its id: nothing runs", () => {
    expect(applyChoice(typed, cands, 1)).toMatchObject({ ok: true, startupId: "6f1c2a7e-1b2c-4d5e-8f90-123456789abc" });
  });
  it("'none of these' runs with what the user typed", () => {
    expect(applyChoice(typed, cands, "none")).toEqual({ ok: true, identity: {}, input: typed, startupId: null });
  });
  it("anything else is refused, never guessed", () => {
    for (const c of [2, -1, 0.5, "0", null]) expect(applyChoice(typed, cands, c).ok).toBe(false);
    expect(applyChoice(typed, null, 0).ok).toBe(false);
  });
});

describe("FREE_OF_CHARGE_STATUSES", () => {
  it("charges only checks that ran on a company AlphaMap covers", () => {
    for (const s of ["rejected_public", "rejected_non_tech", "matched", "failed", "cancelled", "awaiting_confirmation"]) {
      expect(FREE_OF_CHARGE_STATUSES as readonly string[]).toContain(s);
    }
    for (const s of ["queued", "running", "ready", "stealth", "done"]) {
      expect(FREE_OF_CHARGE_STATUSES as readonly string[]).not.toContain(s);
    }
  });
});

describe("decideDeepen", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  it("a thin profile (below 7) may always be deepened, free of the allowance", () => {
    expect(decideDeepen({ completeness: 3, enrichedV2At: daysAgo(2) }, now)).toEqual({ ok: true, free: true });
    expect(decideDeepen({ completeness: 6, enrichedV2At: null }, now)).toEqual({ ok: true, free: true });
  });
  it("a fuller profile updated by v2 in the last 30 days is shown as is", () => {
    expect(decideDeepen({ completeness: 7, enrichedV2At: daysAgo(10) }, now)).toEqual({ ok: false, reason: "recently_updated", updatedDaysAgo: 10 });
  });
  it("…and may be deepened once older, using the allowance", () => {
    expect(decideDeepen({ completeness: 12, enrichedV2At: daysAgo(45) }, now)).toEqual({ ok: true, free: false });
    expect(decideDeepen({ completeness: 12, enrichedV2At: null }, now)).toEqual({ ok: true, free: false });
  });
  it("the thresholds come from the config", () => {
    expect(decideDeepen({ completeness: 8, enrichedV2At: daysAgo(1) }, now, { freeBelow: 10, alwaysBelow: 10, freshDays: 30 })).toEqual({ ok: true, free: true });
  });
});
