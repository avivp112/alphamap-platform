import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { suspiciousUrl } from "./searchProviders";
import { websiteDecision } from "./websiteDecisions";
import { whyNotEnriched } from "./notEnriched";
import { techAccepted, techOverride } from "./techOverrides";

describe("batch 8 follow-up (owner, 2026-11-19)", () => {
  it("suspicious domains are not read, a company's usual sites are", () => {
    for (const u of ["https://wpnaf.onlyfanstg.shop/news/uxjzf6w", "https://best-casino-x.com/a", "https://spam.xyz/p"]) expect(suspiciousUrl(u)).toBe(true);
    for (const u of ["https://www.heartlandbank.com.au/contact-us", "https://techcrunch.com/2026/x", "https://www.zabka.pl/dietly"]) expect(suspiciousUrl(u)).toBe(false);
  });
  it("fetch_failed is a reason of its own, not domain_unresolved", () => {
    expect(whyNotEnriched("no_data", "fetch_failed", undefined, "https://cerbomed.com")).toBe("fetch_failed");
    expect(whyNotEnriched("no_data", "domain_unresolved", undefined, "https://x.com")).toBe("domain_unresolved");
  });
  it("the owner's technology decisions", () => {
    expect(techAccepted("Screaming Frog")).toBe(true);
    expect(techAccepted("Lendbox")).toBe(true);
    expect(techOverride("3D Printing Systems")?.reason).toMatch(/reseller/);
    expect(techOverride("Vibe")).toBeNull();
    expect(techOverride("Punkta")).toBeNull();
  });
  it("a decided address is read from the owner's file", () => {
    const f = join(mkdtempSync(join(tmpdir(), "wd-")), "d.json");
    writeFileSync(f, JSON.stringify({ Lulalend: "https://lula.co.za" }));
    expect(websiteDecision("lulalend", f)).toBe("https://lula.co.za");
    expect(websiteDecision("Other", f)).toBeNull();
  });
});

import { isLeadershipRole } from "./people";
import { publicOverride } from "./techOverrides";
describe("batch 8 follow-up 2 (owner, 2026-11-19)", () => {
  it("a VP of corporate affairs is not senior management; a VP of product is", () => {
    expect(isLeadershipRole("VP Corporate Affairs")).toBe(false);
    expect(isLeadershipRole("SVP, Investor Relations")).toBe(false);
    expect(isLeadershipRole("VP Product")).toBe(true);
    expect(isLeadershipRole("CEO")).toBe(true);
  });
  it("dead and unreachable addresses are reasons of their own; valu and Xintela are public", () => {
    expect(whyNotEnriched("no_data", "website_dead", undefined, "https://x.com")).toBe("website_dead");
    expect(whyNotEnriched("no_data", "website_unreachable", undefined, "https://x.com")).toBe("website_unreachable");
    expect(publicOverride("Valu")?.reason).toMatch(/EGX/);
    expect(publicOverride("Xintela")).not.toBeNull();
    expect(publicOverride("Stripe")).toBeNull();
  });
});
