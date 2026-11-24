import { describe, it, expect } from "vitest";
import { rowProblem } from "./rowRules.ts";
import { purchaseEvents } from "./acquisition.ts";

const row = (r: Record<string, string>) => ({ company_id: "1", company: "Aperio", before: "", origin: "new", quote: "", ...r }) as never;
describe("a name several companies carry: news and the purchase may stand on another site, every other field only on the site on file (owner, 2026-11-24: Aperio)", () => {
  it("the purchase by Leica, a wire release, is accepted", () => {
    const p = rowProblem(row({ field: "news", after: "2012-08-21 — Leica Biosystems To Acquire Aperio", source_url: "https://www.prnewswire.com/news-releases/leica-biosystems-to-acquire-aperio-166949336.html", quote: "Leica Biosystems To Acquire Aperio" }), "Aperio", "2026-11-24", 0, { domain: "aperio.com" });
    expect(p ?? "").not.toMatch(/several companies carry/);
  });
  it("a round of Aperio Systems from an article is refused: the name is shared and the source is not the site on file", () => {
    const p = rowProblem(row({ field: "round", after: "Seed $4.5M · 2018-01 (month only)", source_url: "https://www.calcalistech.com/ctech/articles/0,7340,L-3731403,00.html", quote: "Tel Aviv-based cybersecurity startup Aperio Technology PTE Ltd. secured $4.5 million in investments" }), "Aperio", "2026-11-24", 0, { domain: "aperio.com" });
    expect(p).toMatch(/several companies carry/);
  });
  it("the same round on the site on file stands", () => {
    const p = rowProblem(row({ field: "round", after: "Seed $4.5M · 2018-01 (month only)", source_url: "https://www.aperio.com/news/seed", quote: "Aperio secured $4.5 million in a seed round." }), "Aperio", "2026-11-24", 0, { domain: "aperio.com" });
    expect(p ?? "").not.toMatch(/several companies carry/);
  });
});

describe("the date of a purchase: a wire release's own date is trusted, a page's code date elsewhere is not (owner, 2026-11-24)", () => {
  const mk = (title: string, url: string, d: string, basis: string) => ({ title, url, published_date: d, date_basis: basis });
  it("Aperio: Leica's release on prnewswire (code date 2012-08-21) beats a later report dated from its address", () => {
    const xs = [
      mk("Leica Biosystems To Acquire Aperio", "https://www.prnewswire.com/news-releases/leica-biosystems-to-acquire-aperio-166949336.html", "2012-08-21", "code"),
      mk("Leica Biosystems Completes Acquisition of Aperio, a Galen Partners portfolio company", "http://www.galen.com/news/2012/10/24/leica-biosystems-completes-acquisition-of-aperio", "2012-10-24", "address"),
    ];
    expect(purchaseEvents(xs as never, "Aperio")[0].rep.published_date).toBe("2012-08-21");
  });
  it("a buyer's site with a code date still does not beat an address date (Qnami, UltraVox)", () => {
    const xs = [
      mk("Quantum Design Completes Acquisition of Qnami", "https://qd-europe.com/ch/en/news/x", "2026-06-03", "code"),
      mk("Quantum Design Acquires Quantum Sensing Company Qnami", "https://thequantuminsider.com/2026/06/04/quantum-design-acquires-qnami/", "2026-06-04", "address"),
    ];
    expect(purchaseEvents(xs as never, "Qnami")[0].rep.published_date).toBe("2026-06-04");
  });
});
