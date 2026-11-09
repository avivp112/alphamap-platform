/**
 * lib/enrichment/newsGate.ts — the gate every news item passes before it can reach a pilot report or a write
 * (owner, 2026-11-09): collect.ts calls these two functions and nothing else decides, so the test that feeds
 * the real dry-run items through them is a test of the report's path.
 *
 *   judgeNews   one item from an allowed source: a guide / passing mention / another company's news, a page of the
 *               company's own site outside its news pages, a cut-off headline; then its date is looked for in the
 *               address and in the page's code.
 *   finishNews  one row per event (same amount or acquisition within 7 days, or either undated), then no date, no news.
 */
import { newsProblem, ownSiteNewsOk, dateFromUrl, dateFromHtml, dedupeNewsEvents } from "./newsRelevance.ts";

export interface NewsItem { title: string; url: string; published_date?: string | null; [k: string]: unknown }
export interface NewsDeps {
  companyName: string;
  /** What the company is, in its own words (for the different-product test). */
  about: string;
  /** The text of the source behind a URL, when it was fetched. */
  content: (url: string) => string | undefined;
  isOwnSite: (url: string) => boolean;
  /** The page's HTML, only asked for when the address gives no date. */
  fetchHtml: (url: string) => Promise<string | null>;
  today?: string;
}
export type NewsVerdict = { keep: true; item: NewsItem; dated?: "address" | "page" } | { keep: false; reason: string; message: string };

export async function judgeNews(n: NewsItem, d: NewsDeps): Promise<NewsVerdict> {
  const problem = newsProblem({ title: n.title, content: d.content(n.url) }, d.companyName, d.about);
  if (problem) return { keep: false, reason: `news_${problem}`, message: problem === "explainer" ? "a guide, a roundup or an explainer, not news" : problem === "not_about_the_company" ? "its headline and first paragraph do not name the company (a passing mention)" : "about another company of the same name (a different product)" };
  if (d.isOwnSite(n.url) && !ownSiteNewsOk(n.url, n.title, d.companyName)) return { keep: false, reason: "news_own_site_not_news", message: "a page of the company's own site outside its news / press pages, not naming the company" };
  if (/\.\.\.$|…$/.test(n.title.trim())) return { keep: false, reason: "news_title_cut", message: "the headline is cut off" };
  const item = { ...n };
  let dated: "address" | "page" | undefined;
  if (!item.published_date) {
    const fromUrl = dateFromUrl(item.url, d.today);
    const html = fromUrl ? null : await d.fetchHtml(item.url);
    const found = fromUrl ?? (html ? dateFromHtml(html, d.today) : null);
    if (found) { item.published_date = found; dated = fromUrl ? "address" : "page"; }
  }
  return { keep: true, item, dated };
}

export function finishNews<T extends NewsItem>(items: T[], d: Pick<NewsDeps, "isOwnSite" | "content">): { kept: T[]; dropped: Array<{ item: T; reason: string; message: string }> } {
  const dropped: Array<{ item: T; reason: string; message: string }> = [];
  const distinct = dedupeNewsEvents(items, d.isOwnSite, (x) => (d.content(x.url) ?? "").slice(0, 300));
  for (const x of items) if (!distinct.includes(x)) dropped.push({ item: x, reason: "news_same_event", message: "the same event as another item" });
  const kept = distinct.filter((x) => {
    if (x.published_date) return true;
    dropped.push({ item: x, reason: "news_no_date", message: "no date in its address or its page" });
    return false;
  });
  return { kept, dropped };
}
