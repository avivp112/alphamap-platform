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
import { newsProblem, ownSiteNewsOk, dateFromUrl, dateFromHtml, dedupeNewsEvents, cleanHeadline, headlineLooksCut, headlineIncomplete, titleFromHtml } from "./newsRelevance.ts";

export interface NewsItem { title: string; url: string; published_date?: string | null; title_joined?: boolean; [k: string]: unknown }
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
  // The site's name is not part of the headline; a cut-off headline is completed from the page's own (og:title, h1, <title>).
  let title = cleanHeadline(n.title, n.url);
  let html: string | null | undefined;
  const page = async () => (html === undefined ? (html = await d.fetchHtml(n.url)) : html);
  // A headline joined from a cut source title and the model's continuation is checked against the page's own title; the page's wins.
  if (n.title_joined) {
    const full = titleFromHtml((await page()) ?? "", n.url);
    if (!full) return { keep: false, reason: "news_title_cut", message: "the source's headline is cut off and the page does not give the whole of it" };
    title = full;
  }
  // Cut off by its marks, or stopping in the middle of a sentence: the page must give the whole headline (a headline the page confirms stays).
  if (headlineLooksCut(title) || headlineIncomplete(title)) {
    const full = titleFromHtml((await page()) ?? "", n.url);
    const a = title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (full && full.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").startsWith(a.slice(0, Math.max(12, a.length - 2)))) title = full;
    else return { keep: false, reason: "news_title_cut", message: "the headline is cut off and the page does not give the whole of it" };
  }
  // The page's own headline (og:title, then h1, then <title>) beats a search result's: Glilot's page says "…as mobile games break from
  // app stores", its search result "…for Mobile Web Stores" (dry report 7). Only when the page was read and its headline is about the
  // same story (it shares words with what we have); an unreadable page leaves the source's title as it is.
  if (!n.title_joined && !headlineLooksCut(title)) {
    const fromPage = titleFromHtml((await page()) ?? "", n.url);
    if (fromPage) {
      const words = (t: string) => new Set(t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((w) => w.length >= 2));
      const a = words(title), b = words(fromPage);
      const shared = [...a].filter((w) => b.has(w)).length / Math.max(1, Math.min(a.size, b.size));
      if (shared >= 0.4) title = fromPage;
    }
  }
  const problem = newsProblem({ title, content: d.content(n.url) }, d.companyName, d.about);
  if (problem) return { keep: false, reason: `news_${problem}`, message: problem === "explainer" ? "a guide, a roundup or an explainer, not news" : problem === "not_about_the_company" ? "its headline and first paragraph do not name the company (a passing mention)" : "about another company of the same name (a different product)" };
  if (d.isOwnSite(n.url) && !ownSiteNewsOk(n.url, title, d.companyName)) return { keep: false, reason: "news_own_site_not_news", message: "a page of the company's own site outside its news / press pages, and not an announcement naming the company" };
  const { title_joined: _j, ...rest } = n;
  const item = { ...rest, title };
  let dated: "address" | "page" | undefined;
  if (!item.published_date) {
    const fromUrl = dateFromUrl(item.url, d.today);
    const h = fromUrl ? null : await page();
    const found = fromUrl ?? (h ? dateFromHtml(h, d.today) : null);
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
