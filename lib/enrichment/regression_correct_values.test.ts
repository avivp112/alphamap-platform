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
