import { describe, it, expect } from "vitest";
import { checkPatent, countStatedForCompany, numberFromUrl, patentDigits, nameKey } from "./patents";
import type { LabeledSource } from "./sources";

const src = (source_id: string, url: string, content: string, title = ""): LabeledSource =>
  ({ source_id, url, content, title } as unknown as LabeledSource);

describe("patents belong to the company only when a source says so (run of 2026-10-26)", () => {
  it("drops a patent listed on a page about other companies — AS0001 and the USPTO gazette", () => {
    const gazette = src("S4", "https://patentsgazette.uspto.gov/week03/OG/patentee/alphaT.html",
      "Patentees A: ... AS0001, Inc. — 12,470,594 ... [3,000 entries] ... Acme Trading Corp — 10,169,814 High speed processing of financial information using FPGA ...".padEnd(4000, " x"));
    const r = checkPatent({ title: "High speed processing of financial information using FPGA", patent_number: "US10169814B2", url: "https://patents.google.com/patent/US10169814B2/en" },
      [gazette], { companyName: "AS0001, Inc." });
    expect(r.drop).toBe("patent_not_the_company");
  });

  it("drops another company's patent found in an article — 1AHEAD and Snap's AR patent", () => {
    const article = src("S2", "https://example.com/ar-landscape",
      "Snap Inc. was granted US10102680B2, Image based tracking in augmented reality systems, covering lens overlays. " + "Unrelated filler. ".repeat(60) + " 1AHEAD Technologies develops GLO.");
    expect(checkPatent({ title: "Image based tracking in augmented reality systems", url: "https://patents.google.com/patent/US10102680B2/en" },
      [article], { companyName: "1AHEAD Technologies" }).drop).toBe("patent_not_the_company");
  });

  it("drops a record whose number and link are different patents — Azumo", () => {
    const page = src("W1", "https://www.azumotech.com/patents", "Azumo patents: US11442213B2, US8917962B1.");
    expect(checkPatent({ title: "Film-based lightguide", patent_number: "US11442213B2", url: "https://patents.google.com/patent/US20060061008A1/en" },
      [page], { companyName: "Azumo, Inc." }).drop).toBe("patent_number_url_mismatch");
  });

  it("drops a patent with no number at all", () => {
    expect(checkPatent({ title: "System and method for mapping and routing" }, [], { companyName: "Chalice" }).drop).toBe("patent_unidentified");
  });

  it("keeps a patent the company's own site lists", () => {
    const page = src("W1", "https://www.azumotech.com/patents", "Our patents: US 8,917,962 B1 — Method of manufacturing a light input coupler.");
    const r = checkPatent({ title: "Method of manufacturing a light input coupler and lightguide", url: "https://patents.google.com/patent/US8917962B1/en" },
      [page], { companyName: "Azumo, Inc." });
    expect(r.drop).toBeNull();
    expect(r.patent?.patent_number).toBe("US8917962B1");
  });

  it("keeps a patent named next to the company — an assignee line, a news article", () => {
    const article = src("S1", "https://news.example.com/1ahead-patent",
      "Charlotte-based 1AHEAD Technologies was awarded patent US 11,756,357 B2 for its security surveillance and entry management system.");
    expect(checkPatent({ title: "Security surveillance and entry management system", patent_number: "US11756357B2" },
      [article], { companyName: "1AHEAD Technologies" }).drop).toBeNull();
    const assignee = src("S3", "https://patents.justia.com/assignee/azumo-inc", "US 11442213 Film-based lightguide with extended coupling lightguide region");
    expect(checkPatent({ title: "Film-based lightguide", patent_number: "US11442213B2" }, [assignee], { companyName: "Azumo, Inc." }).drop).toBeNull();
  });

  it("a stated count counts only for this company — BETA and the patent-landscape blog", () => {
    const landscape = src("S9", "https://www.patsnap.com/resources/blog/battery-thermal-management-uav",
      "Leading holders: Joby with 21 patent families, Archer with 13 patent families in battery thermal management for drones.");
    expect(countStatedForCompany(13, [landscape], { companyName: "BETA AIR LLC" })).toBe(false);
    const press = src("S1", "https://www.azumotech.com/resource-center/funding", "Azumo holds 47 patents across reflective display technology.");
    expect(countStatedForCompany(47, [press], { companyName: "Azumo, Inc." })).toBe(true);
  });

  it("reads numbers the way patents are written", () => {
    expect(numberFromUrl("https://patents.google.com/patent/US11756357B2/en")).toBe("US11756357B2");
    expect(patentDigits("US 11,756,357 B2")).toBe("11756357");
    expect(patentDigits("US11756357B2")).toBe("11756357");
    expect(nameKey("AS0001, Inc.")).toBe("as0001");
    expect(nameKey("BETA AIR LLC")).toBe("betaair");
  });
});
