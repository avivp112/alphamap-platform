import { describe, it, expect } from "vitest";
import { websiteLooksLikeAnotherCompany } from "./websiteIdentity";

const filler = (s: string) => `${s} ${"Our team supports patients with scheduling, billing and care coordination every day. ".repeat(40)}`;
describe("a website that may be another company's (owner, 2026-11-08: nymhealth.com)", () => {
  const press = ["Amihai Neiderman", "Adam Rimon"];
  it("two founders named by the press, neither on the site's pages: suspect", () => {
    expect(websiteLooksLikeAnotherCompany({ sitePages: [filler("Lori Jones, Chief Executive Officer. Our leadership.")], pressFounders: press })).toBe(true);
  });
  it("one of them on the site: the site is the company's", () => {
    expect(websiteLooksLikeAnotherCompany({ sitePages: [filler("Amihai Neiderman, co-founder and CEO.")], pressFounders: press })).toBe(false);
  });
  it("too little evidence (one founder, or a thin site) is no verdict", () => {
    expect(websiteLooksLikeAnotherCompany({ sitePages: [filler("Lori Jones")], pressFounders: ["Amihai Neiderman"] })).toBe(false);
    expect(websiteLooksLikeAnotherCompany({ sitePages: ["Lori Jones, CEO."], pressFounders: press })).toBe(false);
  });
});
