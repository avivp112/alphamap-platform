import { describe, it, expect } from "vitest";
import { hfOrgFromUrl, mapOrgProfile, orgModelsUrl, newestModelsUrl } from "./logic";

describe("snapshot-huggingface logic", () => {
  it("takes the org from an HF URL and nothing from a non-org path", () => {
    expect(hfOrgFromUrl("https://huggingface.co/BetaOrg/")).toBe("betaorg");
    expect(hfOrgFromUrl("huggingface.co/acme/model-1")).toBe("acme");
    expect(hfOrgFromUrl("https://huggingface.co/models")).toBeNull();
    expect(hfOrgFromUrl("https://example.com/acme")).toBeNull();
    expect(hfOrgFromUrl(null)).toBeNull();
  });
  it("maps an org overview and keeps only a published website that is not HF itself", () => {
    const p = mapOrgProfile("NewCo", { fullname: "NewCo Inc", type: "company", websiteUrl: "https://newco.dev", numFollowers: 40, numModels: 3, isEnterprise: false });
    expect(p).toMatchObject({ org: "newco", fullname: "NewCo Inc", orgType: "company", website: "https://newco.dev", followers: 40, modelsCount: 3, isEnterprise: false });
    expect(mapOrgProfile("x", { website: "newco.dev" }).website).toBe("https://newco.dev");
    expect(mapOrgProfile("x", { websiteUrl: "https://huggingface.co/x" }).website).toBeNull();
    expect(mapOrgProfile("x", { websiteUrl: "not a site" }).website).toBeNull();
    expect(mapOrgProfile("x", null).website).toBeNull();
  });
  it("lists an org's models by downloads and the newest models by creation", () => {
    expect(orgModelsUrl("acme", 100)).toContain("author=acme");
    expect(orgModelsUrl("acme", 100)).toContain("skip=100");
    expect(newestModelsUrl(0)).toContain("sort=createdAt");
  });
});

import { readFileSync } from "node:fs";
import { parseOrgPage } from "./logic";

describe("org page header (live structure, 2026-11-12)", () => {
  const pages = JSON.parse(readFileSync("supabase/functions/snapshot-huggingface/fixtures/org_pages.json", "utf8")) as Record<string, string>;
  it("reads the website, GitHub and Twitter from the profile header", () => {
    expect(parseOrgPage(pages.mistralai)).toEqual({ website: "https://mistral.ai", github: "https://github.com/mistralai", twitter: "https://twitter.com/mistralai" });
    expect(parseOrgPage(pages.stabilityai).website).toBe("https://stability.ai/license");
  });
  it("never takes a link outside the header, and returns nulls when the structure is missing", () => {
    const far = "x".repeat(130_000) + pages.mistralai;
    expect(parseOrgPage(far).website).toBeNull();
    expect(parseOrgPage("<html></html>")).toEqual({ website: null, github: null, twitter: null });
    expect(parseOrgPage('<a class="leading-snug text-gray-600 hover:underline" href="https://huggingface.co/x" rel="nofollow">x</a>').website).toBeNull();
  });
});
