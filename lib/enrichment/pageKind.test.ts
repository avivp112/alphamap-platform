import { describe, it, expect } from "vitest";
import { isNonDescriptivePage } from "./pageKind";
import { supportedTags } from "./quoteFinder";
import { judgeMark } from "./markRules";
import type { Mark } from "./fieldReview";

describe("pages that say nothing about what a company does (review 7, 2026-11-09)", () => {
  it("the sources the owner marked wrong are recognised", () => {
    for (const u of ["https://pentera.io/privacy", "https://safetydocs.safetyculture.com/terms-and-conditions/?srsltid=AY", "https://dealhub.io/glossary/committed-arr/", "https://freedcamp.com/help_/tutorials/wiki/wiki_public/view/3Tbab", "https://www.engflow.com/company/careers", "https://kb.aampe.com/user-guide/managing-agents-strategically/experiment-overview", "https://scylos.com/contact".replace("contact", "legal")]) expect(isNonDescriptivePage(u), u).toBe(true);
  });
  it("the company's home, about and product pages are not", () => {
    for (const u of ["https://pentera.io/", "https://www.engflow.com/", "https://datarails.com/about", "https://www.pynt.io/product", "https://seetree.ai"]) expect(isNonDescriptivePage(u), u).toBe(false);
  });
  it("a tag whose only supporting sentence is on a privacy page is not written", () => {
    const r = supportedTags(["Data Security"], [{ id: "S1", url: "https://pentera.io/privacy", content: "Data Security: this privacy policy governs how Pentera stores personal data and data security." }]);
    expect(r.kept).toEqual([]);
    expect(r.dropped).toEqual(["Data Security"]);
  });
  it("the replay drops a tag or a sector with no source, or from such a page", () => {
    const m = (field: string, value: string, source_url: string): Mark => ({ id: "x", field, company: "Acme", value, source_url, verdict: "wrong", source_of_mark: "" }) as Mark;
    expect(judgeMark(m("tags", "Payments", "")).produced).toBe(false);
    expect(judgeMark(m("tags", "Data Security", "https://pentera.io/privacy")).produced).toBe(false);
    expect(judgeMark(m("tags", "Payments", "https://acme.com/about")).produced).toBe(true);
    expect(judgeMark(m("sector", "Fintech › Payments", "https://acme.com/terms/")).produced).toBe(false);
  });
});
