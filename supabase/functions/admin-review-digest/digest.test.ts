import { describe, it, expect } from "vitest";
import { buildDigest, daysSince, reviewUrl, type ReviewSummary } from "./digest";

const now = new Date("2026-10-18T06:10:00Z");
const base: ReviewSummary = {
  pending: 12, pending_alert: 5, pending_queue: 7,
  by_source: { epo_ops: 7, sec_form_d: 3, uk_companies_house: 2 },
  new_24h: 4, new_7d: 20, approved_7d: 6, rejected_7d: 2,
  oldest_pending_at: "2026-10-15T01:00:00Z",
  top: [{ name: "APR Labs <Inc>", source: "sec_form_d", tier: "alert", first_seen_at: "2026-10-17T00:10:00Z" }],
  admin_emails: ["avivp112@gmail.com"],
};

describe("buildDigest", () => {
  it("leads with the count and what is waiting", () => {
    const d = buildDigest(base, { now, siteUrl: "https://example.com/" });
    expect(d.subject).toBe("[AlphaMap] 12 companies are waiting for your review");
    expect(d.html).toContain("5 already alerted users, 7 review-only. The oldest has waited 3 days.");
    expect(d.html).toContain("EPO patents: 7 · SEC Form D: 3 · UK Companies House: 2");
    expect(d.html).toContain("This week: 20 found, 6 approved, 2 rejected.");
    expect(d.html).toContain('href="https://example.com/admin/review"');
  });
  it("escapes company names", () => {
    expect(buildDigest(base, { now }).html).toContain("APR Labs &lt;Inc&gt;");
  });
  it("never guesses the site: no SITE_URL, no link", () => {
    const html = buildDigest(base, { now }).html;
    expect(html).not.toContain("href=");
    expect(html).toContain("account menu");
  });
  it("singular and test wording", () => {
    const d = buildDigest({ ...base, pending: 1, pending_alert: 1, pending_queue: 0 }, { now, test: true });
    expect(d.subject).toBe("[AlphaMap] 1 company is waiting for your review (test)");
    expect(d.html).toContain("Test email");
  });
  it("empty queue says so (only ever sent as a test)", () => {
    const d = buildDigest({ ...base, pending: 0, pending_alert: 0, pending_queue: 0, by_source: {}, top: [], oldest_pending_at: null }, { now, test: true });
    expect(d.subject).toBe("[AlphaMap] Review queue is empty (test)");
    expect(d.html).toContain("Nothing is waiting for review.");
  });
});

describe("helpers", () => {
  it("daysSince", () => {
    expect(daysSince("2026-10-17T06:10:00Z", now)).toBe(1);
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince("garbage", now)).toBeNull();
  });
  it("reviewUrl accepts only an https origin", () => {
    expect(reviewUrl("https://alphamap.example")).toBe("https://alphamap.example/admin/review");
    expect(reviewUrl("http://x.com")).toBeNull();
    expect(reviewUrl("  ")).toBeNull();
    expect(reviewUrl(undefined)).toBeNull();
  });
});
