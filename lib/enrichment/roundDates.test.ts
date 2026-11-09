import { describe, it, expect } from "vitest";
import { pressOnlyDate, originalReleaseQuery, resolveRoundDate } from "./roundDates";
import type { LabeledSource } from "./sources";
import type { V2Round } from "./extractFunding";

const src = (id: string, url: string, title: string, content: string, type: LabeledSource["source_type"] = "news_article" as never): LabeledSource =>
  ({ source_id: id, url, title, content, provider: "serper", query_label: "x", source_type: type }) as LabeledSource;

const spacenews = src("S1", "https://spacenews.com/spacecraft-manufacturer-apex-emerges-from-stealth-with-7-5m-in-funding/", "Spacecraft manufacturer Apex emerges from stealth with $7.5M in funding",
  "Date: Oct 27, 2022 — Apex, a Los Angeles startup, raised $7.5 million led by Andreessen Horowitz.");
const round = (dateQuote: string, sourceId = "S1"): V2Round => ({
  round_type: "Unknown",
  amount_raised: { value: 7_500_000, source_id: "S1", evidence_quote: "raised $7.5 million" },
  announcement_date: { value: "2022-10-27", source_id: sourceId, evidence_quote: dateQuote },
  lead_investor: { value: "Andreessen Horowitz", source_id: "S1", evidence_quote: "led by Andreessen Horowitz" },
});

describe("a date that is a press article's dateline only (owner, 2026-11-08: Apex)", () => {
  it("SpaceNews' dateline alone is press-only", () => {
    expect(pressOnlyDate(round("Date: Oct 27, 2022"), [spacenews], "Apex")).toBe(true);
  });
  it("a date the sentence states is the day: not press-only", () => {
    expect(pressOnlyDate(round("Apex announced the round on October 24, 2022"), [spacenews], "Apex")).toBe(false);
  });
  it("a company page, a wire or no date is not press-only", () => {
    const site = src("W1", "https://www.apexspace.com/news/seed", "Apex raises", "Date: Oct 24, 2022", "company_site");
    expect(pressOnlyDate(round("Date: Oct 24, 2022", "W1"), [site], "Apex")).toBe(false);
    expect(pressOnlyDate({ round_type: "Seed" }, [spacenews], "Apex")).toBe(false);
  });
  it("the search asks for the company, the amount as a release writes it, and the original's homes", () => {
    const q = originalReleaseQuery(round("Date: Oct 27, 2022"), "Apex", "apexspace.com");
    expect(q).toContain('"Apex"'); expect(q).toContain('"$7.5 million"');
    expect(q).toContain("site:prnewswire.com"); expect(q).toContain("site:apexspace.com");
  });
});

describe("the day from the original release, else the month", () => {
  const release = src("H1", "https://www.businesswire.com/news/home/20221024005001/en/Apex-Raises-7.5-Million", "Apex Raises $7.5 Million in Seed Funding",
    "LOS ANGELES, Oct. 24, 2022 /BUSINESS WIRE/ Apex today announced it has raised $7.5 million in funding led by Andreessen Horowitz.");
  it("an original release three days earlier gives the day", () => {
    const r = resolveRoundDate(round("Date: Oct 27, 2022"), [release], spacenews, "Apex");
    expect(r.kind).toBe("original");
    if (r.kind === "original") expect(r.iso).toBe("2022-10-24");
  });
  it("nothing found: the month", () => {
    expect(resolveRoundDate(round("Date: Oct 27, 2022"), [], spacenews, "Apex")).toEqual({ kind: "month", month: "2022-10" });
  });
  it("a release dated after the article is not the original", () => {
    const later = src("H2", "https://www.businesswire.com/news/home/20221101/en/Apex", "Apex Raises $7.5 Million", "LOS ANGELES, Nov. 1, 2022 /BUSINESS WIRE/ Apex today announced it has raised $7.5 million led by Andreessen Horowitz.");
    expect(resolveRoundDate(round("Date: Oct 27, 2022"), [later], spacenews, "Apex").kind).toBe("month");
  });
  it("another press article is not an original", () => {
    const press = src("H3", "https://techcrunch.com/2022/10/24/apex-raises/", "Apex raises $7.5 million", "Date: Oct 24, 2022 — Apex raised $7.5 million led by Andreessen Horowitz.");
    expect(resolveRoundDate(round("Date: Oct 27, 2022"), [press], spacenews, "Apex").kind).toBe("month");
  });
});
