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
import { isListingOrSponsoredUrl } from "./pageKind.ts";
import { completeFromSlug } from "./newsRelevance.ts";
import { acquirerIn } from "./acquisition.ts";
import { newsProblem, ownSiteNewsOk, dateFromUrl, dateFromHtml, dedupeNewsEvents, cleanHeadline, headlineLooksCut, headlineIncomplete, titleFromHtml } from "./newsRelevance.ts";

export interface NewsItem { title: string; url: string; published_date?: string | null; title_joined?: boolean; [k: string]: unknown }
export interface NewsDeps {
  companyName: string;
  /** What the company is, in its own words (for the different-product test). */
  about: string;
  /** The text of the source behind a URL, when it was fetched. */
  content: (url: string) => string | undefined;
  isOwnSite: (url: string) => boolean;
  /** The buyers several headlines name for the company (acquisition.ts knownAcquirers). */
  acquirers?: string[];
  /** The page's HTML, only asked for when the address gives no date. */
  fetchHtml: (url: string) => Promise<string | null>;
  today?: string;
}
export type NewsVerdict = { keep: true; item: NewsItem; dated?: "address" | "page" } | { keep: false; reason: string; message: string };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** Whether a text states a date: ISO, "November 12, 2026", "12 November 2026", "Nov. 12, 2026", "12.11.2026", "12/11/2026" or "11/12/2026". */
export function dateStatedIn(text: string, iso: string): boolean {
  const [y, m, dd] = iso.split("-"); const day = String(Number(dd)), mon = MONTHS[Number(m) - 1];
  if (!mon) return false;
  if (text.includes(iso)) return true;
  const t = text.toLowerCase();
  const short = mon.slice(0, 3);
  const forms = [`${mon} ${day}, ${y}`, `${mon} ${day} ${y}`, `${day} ${mon} ${y}`, `${short}. ${day}, ${y}`, `${short} ${day}, ${y}`, `${day} ${short} ${y}`, `${day}.${m}.${y}`, `${day}/${m}/${y}`, `${m}/${dd}/${y}`, `${dd}.${m}.${y}`];
  return forms.some((f) => t.includes(f));
}

export async function judgeNews(n: NewsItem, d: NewsDeps): Promise<NewsVerdict> {
  // The source of a news item is the address of the article itself: a tag / list / search page and sponsored content are no source (owner, round 10).
  const notArticle = isListingOrSponsoredUrl(n.url);
  if (notArticle) return { keep: false, reason: `news_${notArticle}`, message: notArticle === "sponsored_content" ? "sponsored content, not an article" : "a tag, list or search page, not the article itself" };
  // The site's name is not part of the headline; a cut-off headline is completed from the page's own (og:title, h1, <title>).
  let title = cleanHeadline(n.title, n.url);
  let html: string | null | undefined;
  const page = async () => (html === undefined ? (html = await d.fetchHtml(n.url)) : html);
  // A headline joined from a cut source title and the model's continuation is checked against the page's own title; the page's wins.
  if (n.title_joined) {
    // The page's own title; else the whole headline in the article's address, when it carries the words of the cut one (owner, batch 7: Lone Wolf's release, cut only in the log).
    const fromPage = titleFromHtml((await page()) ?? "", n.url);
    const full = fromPage ?? completeFromSlug(title, n.url);
    if (!full) return { keep: false, reason: "news_title_cut", message: "the source's headline is cut off and the page does not give the whole of it" };
    title = full;
  }
  // Cut off by its marks, or stopping in the middle of a sentence: the page must give the whole headline (a headline the page confirms stays).
  if (headlineLooksCut(title) || headlineIncomplete(title)) {
    // The page's own title when it carries the headline; else the address' slug (a page title with the site's name in it does not carry it, the slug may).
    const a = title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const carries = (f: string | null) => !!f && f.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").startsWith(a.slice(0, Math.max(12, a.length - 2)));
    const fromPage = titleFromHtml((await page()) ?? "", n.url);
    const full = carries(fromPage) ? fromPage : completeFromSlug(title, n.url);
    if (carries(full)) title = full!;
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
  const problem = newsProblem({ title, content: d.content(n.url) }, d.companyName, d.about, { acquirers: d.acquirers });
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
  // A date in the week before the run, or the day of it, must stand in the source in words (owner, round 10: "sold to US investors" 2026-11-12): otherwise it is the crawl date.
  const today = d.today ?? new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.parse(today) - 7 * 86_400_000).toISOString().slice(0, 10);
  if (item.published_date && item.published_date >= weekAgo && !dateStatedIn(d.content(item.url) ?? "", item.published_date)) {
    return { keep: false, reason: "news_date_not_in_source", message: `its date (${item.published_date}) is in the week before the run and the article does not state it` };
  }
  return { keep: true, item, dated };
}

export function finishNews<T extends NewsItem>(items: T[], d: Pick<NewsDeps, "isOwnSite" | "content" | "companyName">): { kept: T[]; dropped: Array<{ item: T; reason: string; message: string }> } {
  const dropped: Array<{ item: T; reason: string; message: string }> = [];
  // An item with no date is out first, under its own reason; only then are the dated ones merged to one per event. The other way round (merged first) kept an undated item as the event's one
  // and dropped it for its date, and the dated items it had absorbed were reported as "the same event as another item" with no item left (owner, regression gate, Medipass).
  const dated = items.filter((x) => {
    if (x.published_date) return true;
    dropped.push({ item: x, reason: "news_no_date", message: "no date in its address or its page" });
    return false;
  });
  let kept = dedupeNewsEvents(dated, d.isOwnSite, (x) => (d.content(x.url) ?? "").slice(0, 300), (x) => !!d.companyName && !!acquirerIn(x.title, d.companyName));
  // One purchase is one event, whatever the days between the reports: of the items that say the same buyer bought the company, the earliest announcement stays (owner, regression gate: Humi's
  // "to be acquired" of 2026-05-20, read from the page's code, beside the announcement of 2025-01-08). A different buyer is another purchase (Six Degrees: Charlesbank 2015, Claranet 2026).
  if (d.companyName) {
    const f = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const buyer = (x: T) => { const h = acquirerIn(x.title, d.companyName!); return h ? f(h.acquirer) : ""; };
    const first = new Map<string, T>();
    for (const x of kept) { const b = buyer(x); if (!b) continue; const c = first.get(b); if (!c || String(x.published_date) < String(c.published_date)) first.set(b, x); }
    kept = kept.filter((x) => { const b = buyer(x); return !b || first.get(b) === x; });
  }
  for (const x of dated) if (!kept.includes(x)) dropped.push({ item: x, reason: "news_same_event", message: "the same event as another item" });
  return { kept, dropped };
}
