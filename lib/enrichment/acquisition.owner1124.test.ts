import { describe, it, expect } from "vitest";
import { acquirerIn, brandName, purchaseEvents } from "./acquisition.ts";

describe("acquisitions: brand name and first announcement (owner, 2026-11-24, acquired check of batch 9)", () => {
  it("the buyer is its brand, not its legal entity", () => {
    expect(brandName("Lightspeed POS Inc")).toBe("Lightspeed");
    expect(brandName("Everfield Germany")).toBe("Everfield");
    expect(brandName("Acme GmbH")).toBe("Acme");
    expect(brandName("Snyk")).toBe("Snyk");
    expect(brandName("Inc")).toBe("Inc");
    expect(acquirerIn("Gastrofix acquired by Lightspeed POS Inc", "Gastrofix")?.acquirer).toBe("Lightspeed");
  });
  it("the earliest report of the purchase gives the date, whoever published it (a party's later completion report does not beat an earlier one)", () => {
    const items = [
      { title: "RealPage to acquire Buildium", url: "https://a.com/1", published_date: "2019-11-06", date_basis: "address" },
      { title: "RealPage completes acquisition of Buildium", url: "https://realpage.com/2", published_date: "2019-12-20", date_basis: "address" },
    ];
    const ev = purchaseEvents(items, "Buildium", () => true, (x) => x.url.includes("realpage"));
    expect(ev[0].rep.published_date).toBe("2019-11-06");
  });
  it("no word of a headline decides: an earlier report that says completed still gives the date (Qnami)", () => {
    const items = [
      { title: "Quantum Design completes acquisition of Qnami", url: "https://a.com/1", published_date: "2026-06-03", date_basis: "address" },
      { title: "Quantum Design to acquire Qnami", url: "https://b.com/2", published_date: "2026-06-04", date_basis: "address" },
    ];
    expect(purchaseEvents(items, "Qnami")[0].rep.published_date).toBe("2026-06-03");
  });
  it("a completion report stands when the event has no announcement", () => {
    const ev = purchaseEvents([{ title: "Snyk completes acquisition of Enso", url: "https://a.com/1", published_date: "2023-06-12", date_basis: "address" }], "Enso");
    expect(ev[0].rep.published_date).toBe("2023-06-12");
  });
});
