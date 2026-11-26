/**
 * lib/enrichment/sitemap.ts — the pages of a company's own site chosen from its sitemap (owner, round 10): sitemap.xml, or the Sitemap line of robots.txt; of its addresses, the
 * pages whose path says about, team, leadership, company, contact, press, news, careers, jobs, story, history, impressum, legal or investors — and the same words in the language
 * of the site. At most 30 pages a company; a site with no sitemap keeps the fixed list.
 */
export const MAX_SITE_PAGES = 30;   // back to what it was (owner, 2026-11-26: the reading cuts of the maintenance window are undone)

// Higher first. A path segment is matched whole (or as a hyphenated part): "/about-us/leadership" scores for both.
const KEYWORDS: Array<[number, string[]]> = [
  [10, ["about", "about-us", "aboutus", "company", "who-we-are", "our-story", "story", "o-nas", "o-firmie", "sobre", "sobre-nos", "sobre-nosotros", "quienes-somos", "nosotros", "ueber-uns", "über-uns", "uber-uns", "unternehmen", "a-propos", "qui-sommes-nous", "societe", "chi-siamo", "over-ons", "om-oss", "hakkimizda", "关于我们", "about_us"]],
  [10, ["team", "leadership", "management", "people", "founders", "board", "zespol", "zespół", "equipe", "equipo", "equipa", "mannschaft", "unser-team", "l-equipe", "leitung", "geschaeftsfuehrung"]],
  [9, ["contact", "contact-us", "contacts", "kontakt", "contacto", "contato", "contactez-nous", "contatti", "contactenos", "fale-conosco"]],
  [8, ["impressum", "legal", "legal-notice", "imprint", "mentions-legales", "aviso-legal", "nota-legal", "informacje-prawne", "stopka", "datenschutz", "privacy", "terms", "terms-of-service", "regulamin", "politica-de-privacidade"]],
  [7, ["press", "newsroom", "media", "press-releases", "pressemitteilungen", "presse", "prensa", "imprensa", "dla-mediow", "komunikaty", "pressroom"]],
  [6, ["news", "blog", "updates", "actualites", "noticias", "aktuelles", "wiadomosci", "aktualnosci", "novedades"]],
  [6, ["investors", "investor-relations", "investor", "inwestorzy", "investidores", "inversores", "investisseurs", "anleger"]],
  [5, ["history", "historia", "histoire", "geschichte", "historico", "mission", "values"]],
  [4, ["careers", "jobs", "career", "kariera", "carreiras", "carreras", "empleo", "karriere", "emplois", "recrutement", "trabalhe-conosco", "praca"]],
];
const SCORE = new Map<string, number>();
for (const [score, words] of KEYWORDS) for (const w of words) SCORE.set(w, Math.max(score, SCORE.get(w) ?? 0));

/** The one main product page a site may give (owner, 2026-11-24): /products, /solutions or /platform at the first level — the first that exists, in this order. No customers, industries, privacy, terms or jobs pages. */
export const PRODUCT_PAGES = ["products", "solutions", "platform"] as const;
const productRank = (pathname: string): number => { const segs = pathname.toLowerCase().split("/").filter(Boolean); return segs.length === 1 ? (PRODUCT_PAGES as readonly string[]).indexOf(segs[0]) : -1; };
/**
 * A press or news page of the company about money (owner, 2026-11-24: Kry's "kry-secures-over-300-million-investment", read when 30 pages were read, left out at 12): in a press / news section, a page whose
 * last path segment speaks of a raise. Scored above the general press pages and the legal pages, at most three of them (pickSitePages).
 */
const PRESS_SECTION = new Set(["press", "newsroom", "news", "media", "nyheter", "pressemitteilungen", "presse", "prensa", "imprensa", "noticias", "actualites", "aktuelles", "press-releases", "pressroom"]);
const FUNDING_SLUG = /(?:^|[-_])(?:raise[sd]?|raising|funding|series[-_][a-f]|seed|investments?|invests?|invested|secures?|secured|financing|round|capital|million|\d+m|usd\d+|us\d+)(?:[-_]|$)/i;
export const isFundingPage = (pathname: string): boolean => {
  const segs = pathname.toLowerCase().split("/").filter(Boolean).map((x) => decodeURIComponent(x).replace(/\.(html?|php|aspx?)$/, ""));
  return segs.length >= 2 && segs.slice(0, -1).some((x) => PRESS_SECTION.has(x)) && FUNDING_SLUG.test(segs[segs.length - 1]);
};
const LEGAL_WORDS = new Set(["impressum", "legal", "legal-notice", "imprint", "mentions-legales", "aviso-legal", "nota-legal", "informacje-prawne", "stopka", "regulamin"]);
const isLegalPath = (pathname: string) => pathname.toLowerCase().split("/").filter(Boolean).some((seg) => LEGAL_WORDS.has(seg) || seg.split(/[-_]/).some((w) => LEGAL_WORDS.has(w)));

/** The addresses in a sitemap: <loc> of a urlset, or of a sitemapindex (those are returned with kind "index"). */
export function parseSitemap(xml: string): { kind: "urlset" | "index"; urls: string[] } {
  const urls = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  return { kind: /<sitemapindex\b/i.test(xml) ? "index" : "urlset", urls };
}

/** The Sitemap: lines of a robots.txt. */
export function robotsSitemaps(robots: string): string[] {
  return [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
}

const hostBare = (h: string) => h.toLowerCase().replace(/^www\./, "");

/** How well a path says "a page about the company": the best score of its segments (a hyphenated segment scores by its parts, a little lower). */
export function pageScore(pathname: string): number {
  const segs = pathname.toLowerCase().split("/").filter(Boolean).map((s) => decodeURIComponent(s).replace(/\.(html?|php|aspx?)$/, ""));
  if (!segs.length) return 0;
  if (isFundingPage(pathname)) return 9;
  if (productRank(pathname) >= 0) return 5;   // the main product page, at most one of them is taken (pickSitePages)
  let best = 0;
  for (const s of segs) {
    const whole = SCORE.get(s);
    if (whole != null) { best = Math.max(best, whole); continue; }
    for (const part of s.split(/[-_]/)) { const p = SCORE.get(part); if (p != null) best = Math.max(best, p - 2); }
  }
  // A blog or news article (a deep path under /blog or /news) is not one of the company's own pages: only the section itself counts.
  if (segs.length >= 2 && /^(blog|news|articles?|noticias|actualites|aktuelles|wiadomosci|aktualnosci)$/.test(segs[0])) return 0;
  return best;
}

/**
 * The pages to read: the home page, then the best-scoring same-site pages by score, then fewer path segments (the shallow page is the section itself), at most `max`.
 * Files that are not pages (images, documents, feeds) are left out.
 */
export function pickSitePages(urls: string[], root: string, max = MAX_SITE_PAGES): string[] {
  let rootHost: string;
  try { rootHost = hostBare(new URL(root).hostname); } catch { return []; }
  const seen = new Set<string>();
  const scored: Array<{ url: string; score: number; depth: number }> = [];
  for (const raw of urls) {
    let u: URL;
    try { u = new URL(raw); } catch { continue; }
    if (hostBare(u.hostname) !== rootHost && !hostBare(u.hostname).endsWith(`.${rootHost}`)) continue;
    if (/\.(?:jpe?g|png|gif|svg|webp|pdf|docx?|xlsx?|zip|mp4|mp3|xml|json|css|js|ico|rss)$/i.test(u.pathname)) continue;
    const clean = `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
    if (seen.has(clean)) continue;
    seen.add(clean);
    const score = pageScore(u.pathname);
    if (score <= 0) continue;
    scored.push({ url: clean, score, depth: u.pathname.split("/").filter(Boolean).length });
  }
  scored.sort((a, b) => b.score - a.score || a.depth - b.depth || a.url.length - b.url.length);
  return scored.slice(0, Math.max(0, max - 1)).map((s) => s.url);
}
