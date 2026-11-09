/**
 * Regression: every value the owner marked correct in a wet batch must keep being produced (owner, 2026-11-09 — the
 * headline fix of 7f4ad39 dropped 11 of 14 news items and nobody saw it until the next dry run). Each news entry goes
 * through the same two steps as a run: the extraction's checks (processMarketExtractionResponse, with the source's title
 * written the ways real sources write it) and the news gate (judgeNews, finishNews).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { processMarketExtractionResponse } from "./extractMarket";
import { judgeNews, finishNews } from "./newsGate";

type NewsFixture = { batch: string; id: string; company: string; date: string; title: string; url: string; own_site: boolean };
const fixtures = JSON.parse(readFileSync("eval/regression/correct_values.json", "utf8")) as { news: NewsFixture[]; round: unknown[] };

const host = (u: string) => new URL(u).hostname.replace(/^www\./, "");
const siteName = (u: string) => host(u).split(".")[0].replace(/^./, (c) => c.toUpperCase());
// How a source's title is written: as is; with the site's name after or before it; with entities and curly quotes; in other case.
const variants = (f: NewsFixture): Array<[string, string]> => [
  ["exact", f.title],
  ["| site", `${f.title} | ${siteName(f.url)}`],
  ["site |", `${siteName(f.url)} | ${f.title}`],
  ["- site", `${f.title} - ${siteName(f.url)}`],
  ["entities", f.title.replace(/&/g, "&amp;").replace(/'/g, "&#8217;")],
  ["lower case", f.title.toLowerCase()],
];

describe.each(fixtures.news.map((f) => [`${f.batch} ${f.id} ${f.company}`, f] as const))("marked correct: %s", (_n, f) => {
  it.each(variants(f))("the extraction keeps it when the source's title is written %s", (_v, sourceTitle) => {
    const sources = [{ source_id: "S1", source_type: f.own_site ? "company_site" : "news", url: f.url, title: sourceTitle, content: `${f.title}. ${f.company} announced it today. `.repeat(8), provider: "serper", query_label: "news" }] as never;
    const out = processMarketExtractionResponse({ news: [{ title: f.title, url: f.url, published_date: f.date }], competitors: [], acquisitions: [] }, sources, f.company, "2026-11-09");
    expect(out.result.news.map((n) => n.url)).toEqual([f.url]);
  });
  it("the extraction keeps it when the source has no title but carries the headline in its text", () => {
    const sources = [{ source_id: "S1", source_type: "news", url: f.url, title: "", content: `${f.title}\n${f.company} announced it today.`, provider: "serper", query_label: "news" }] as never;
    const out = processMarketExtractionResponse({ news: [{ title: f.title, url: f.url, published_date: f.date }], competitors: [], acquisitions: [] }, sources, f.company, "2026-11-09");
    expect(out.result.news).toHaveLength(1);
  });
});

describe("marked correct: the news gate lets every one of a company's marked values through together", () => {
  const companies = [...new Set(fixtures.news.map((f) => f.company))];
  it.each(companies)("%s", async (company) => {
    const mine = fixtures.news.filter((f) => f.company === company);
    const own = new Set(mine.filter((f) => f.own_site).map((f) => f.url));
    const deps = { companyName: company, about: "software", content: () => undefined, isOwnSite: (u: string) => own.has(u), fetchHtml: async () => null };
    const kept = [];
    for (const f of mine) { const v = await judgeNews({ title: f.title, url: f.url, published_date: f.date }, deps); if (v.keep) kept.push(v.item); }
    const { kept: out } = finishNews(kept, deps);
    expect(out.map((x) => x.url).sort()).toEqual(mine.map((f) => f.url).sort());
  });
});

describe("Datatruck (dry report 6, 2026-11-09): a search result's title cut at the colon, the model gave the rest", () => {
  const url = "https://www.globenewswire.com/news-release/2026/10/21/3385717/0/en/driving-profitability-and-streamlining-fleet-operations-datatruck-recognized.html";
  const full = "Driving Profitability and Streamlining Fleet Operations: Datatruck Recognized as a Core Transportation Management Provider by Nucleus Research";
  const sources = [{ source_id: "S1", source_type: "news", url, title: "Driving Profitability and Streamlining Fleet Operations:", content: "Datatruck announced today that it was recognized by Nucleus Research. ", provider: "serper", query_label: "news" }] as never;
  const model = "Datatruck Recognized as a Core Transportation Management Provider by Nucleus Research";
  it("the extraction keeps it, joined, and says so", () => {
    const out = processMarketExtractionResponse({ news: [{ title: model, url, published_date: "2026-10-21" }], competitors: [], acquisitions: [] }, sources, "Datatruck", "2026-11-09");
    expect(out.result.news).toHaveLength(1);
    expect(out.result.news[0].title).toBe(`Driving Profitability and Streamlining Fleet Operations: ${model}`);
    expect(out.result.news[0].title_joined).toBe(true);
  });
  it("the gate writes the page's own title (its og:title, h1 or title)", async () => {
    const item = { title: `Driving Profitability and Streamlining Fleet Operations: ${model}`, url, published_date: "2026-10-21", title_joined: true };
    const v = await judgeNews(item, { companyName: "Datatruck", about: "trucking software", content: () => undefined, isOwnSite: () => false,
      fetchHtml: async () => `<html><head><title>${full} | GlobeNewswire</title></head><body><h1>${full}</h1></body></html>` });
    expect(v.keep && v.item.title).toBe(full);
    expect(v.keep && "title_joined" in v.item).toBe(false);
  });
  it("with no page to check it against, a joined headline is not written", async () => {
    const item = { title: `Driving Profitability and Streamlining Fleet Operations: ${model}`, url, published_date: "2026-10-21", title_joined: true };
    expect((await judgeNews(item, { companyName: "Datatruck", about: "trucking software", content: () => undefined, isOwnSite: () => false, fetchHtml: async () => null })).keep).toBe(false);
  });
});

describe("Appcharge / Glilot (dry report 7, 2026-11-09): the page's own headline beats the search result's", () => {
  const url = "https://glilotcapital.com/cyberhubs/appcharge-raises-58-million-series-b-as-mobile-games-break-from-app-stores/";
  const item = { title: "Appcharge Raises $58M Series B for Mobile Web Stores", url, published_date: "2025-08-13" };
  const deps = { companyName: "Appcharge", about: "payments for mobile games", content: () => undefined, isOwnSite: () => false };
  it("the page's og:title is used (site name removed)", async () => {
    const v = await judgeNews(item, { ...deps, fetchHtml: async () => '<meta property="og:title" content="Appcharge raises $58 million Series B as mobile games break from app stores | Glilot Capital">' });
    expect(v.keep && v.item.title).toBe("Appcharge raises $58 million Series B as mobile games break from app stores");
  });
  it("a page about something else does not replace it", async () => {
    const v = await judgeNews(item, { ...deps, fetchHtml: async () => '<meta property="og:title" content="Cookie settings and privacy preferences center">' });
    expect(v.keep && v.item.title).toBe(item.title);
  });
  it("an unreadable page leaves the source's title", async () => {
    const v = await judgeNews(item, { ...deps, fetchHtml: async () => null });
    expect(v.keep && v.item.title).toBe(item.title);
  });
});
