/**
 * lib/enrichment/newsRelevance.ts — what is not news about THIS company (owner, 2026-11-08, review 6).
 *   explainer          a guide or explainer, not a report of something that happened ("What to know before investing in
 *                      Ethereum competitor Solana (SOL)")
 *   different_product  an article about a company of the same name that makes something else (Banzai's acquisition of
 *                      "AI Web Development and Hosting Platform Superblocks" is not the enterprise app platform): the
 *                      product the article names after the company's name shares no word with the company's description
 * The second needs the article to say what the company makes; an article that does not is not judged (no verdict).
 */

const EXPLAINER = /\b(roundup|round-up|weekly digest|newsletter|lessons from|lessons learned|tips for|tips to|how to|what (?:to know|is|are|you (?:need|should) (?:to )?know)|how to (?:buy|invest|trade|use)|should you (?:buy|invest)|is [^?]{0,50} a good (?:investment|buy)|price prediction|before investing|investing in|explained|explainer|beginner'?s guide|a guide to|everything you need to know|pros and cons|where to buy)\b/i;

/** Tracking parameters (Google's srsltid, utm_*, fbclid…) are not part of an article's address. */
export function stripTrackingParams(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^(?:srsltid|utm_[a-z]+|gclid|fbclid|mc_cid|mc_eid|msclkid|igshid|ref_src)$/i.test(k)) u.searchParams.delete(k);
    return u.toString().replace(/\?$/, "");
  } catch { return url; }
}

/**
 * The article names the company in its headline or in its first paragraph: one that mentions it only in passing is not
 * news about it. A possessive in the headline ("… for Swan's Next-Generation Business Cards") is another company's news
 * that mentions this one: it counts only when the first paragraph names the company too. With no text to read, the
 * headline alone must name it (Datatruck's "IT Park Ventures: The First Venture Investments in Uzbekistan's Startups").
 */
export function namesCompanyUpFront(item: { title?: string | null; content?: string | null }, companyName: string): boolean {
  const core = companyName.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
  if (!core) return true;
  const flat = (s: string, poss: boolean) => ` ${s.toLowerCase().replace(/[’']s\b/g, poss ? " s" : "_poss").replace(/[^\p{L}\p{N} _]/gu, " ").replace(/\s+/g, " ")} `;
  const has = (t: string) => t.includes(` ${core} `) || t.includes(` ${core.replace(/ /g, "")} `);
  const title = item.title ?? "";
  if (has(flat(title, false))) return true; // named outright in the headline
  if (has(flat(title, true)) && flat(title, true).trim().startsWith(core)) return true; // "Speechify's new feature…"
  return has(flat((item.content ?? "").slice(0, 400), true)); // else the first paragraph must name it
}

export const isExplainer = (title: string | null | undefined): boolean => !!title && EXPLAINER.test(title);

const GENERIC = new Set(["platform", "software", "company", "solution", "solutions", "technology", "technologies", "provider", "startup", "based", "leading", "global", "digital", "services", "service", "business", "businesses", "tools", "product", "products", "application", "applications", "system", "systems", "firm", "maker", "developer", "developers", "enterprise", "cloud", "online", "powered", "driven", "first", "next", "generation", "new", "that", "with", "from", "into", "their", "which", "your", "other"]);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const words = (s: string) => (s.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => !GENERIC.has(w));
const stem = (w: string) => w.slice(0, 5);

/** What the article says the company is, read after the company's name in the headline or in the lead, or null. */
export function describedProduct(title: string | null | undefined, content: string | null | undefined, companyName: string): string | null {
  const name = esc(companyName.trim());
  const fromTitle = (title ?? "").match(new RegExp(`(?:acquires?|acquired|buys?|to acquire|merges? with|invests? in|backs?|funds?|takes? over)\\s+(.{6,90}?)\\s+${name}\\b`, "i"));
  if (fromTitle) return fromTitle[1];
  const lead = (content ?? "").replace(/\s+/g, " ").slice(0, 600);
  const fromLead = lead.match(new RegExp(`${name},? (?:a|an|the) ([^,.;]{6,90}?)(?:[,.;]| (?:that|which|has|is|was|announced)\\b)`, "i"));
  return fromLead ? fromLead[1] : null;
}

/** Why an article is not news about this company, or null. `description` is what the company is (its own text). */
export function newsProblem(item: { title?: string | null; content?: string | null }, companyName: string, description: string): "explainer" | "different_product" | "not_about_the_company" | null {
  if (isExplainer(item.title)) return "explainer";
  // Its headline or first paragraph must name the company (TechCrunch+ roundups mention it in passing).
  if (!namesCompanyUpFront(item, companyName)) return "not_about_the_company";
  const product = describedProduct(item.title, item.content, companyName);
  if (!product) return null;
  const pw = words(product);
  if (!pw.length) return null;
  const dw = new Set(words(description).map(stem));
  return pw.some((w) => dw.has(stem(w))) ? null : "different_product";
}

// ── Dates, the company's own pages, and one item per event (owner, 2026-11-09, pilot dry run 2) ───────────────────────

const validDate = (y: string, m: string, d: string, today: string): string | null => {
  const iso = `${y}-${m}-${d}`;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t) || +m < 1 || +m > 12 || +d < 1 || +d > 31 || +y < 1990) return null;
  return iso <= today ? iso : null;
};

/** The date in an article's address: /2024/11/06/…, /news-release/2026/10/21/…, businesswire's /home/20240919738626/. */
export function dateFromUrl(url: string, today = new Date().toISOString().slice(0, 10)): string | null {
  const m = url.match(/\/((?:19|20)\d{2})[\/-](\d{2})[\/-](\d{2})(?=[\/\-_?#]|$)/) ?? url.match(/\/home\/((?:19|20)\d{2})(\d{2})(\d{2})\d{4,}/) ?? url.match(/\/((?:19|20)\d{2})(\d{2})(\d{2})(?=[\/\-_?#]|$)/);
  return m ? validDate(m[1], m[2], m[3], today) : null;
}

/** The date in a page's code: article:published_time, JSON-LD datePublished, <time datetime>. */
export function dateFromHtml(html: string, today = new Date().toISOString().slice(0, 10)): string | null {
  const head = html.slice(0, 400_000);
  const patterns = [
    /<meta[^>]+(?:property|name|itemprop)=["'](?:article:published_time|og:article:published_time|datePublished|pubdate|date|publishdate|DC\.date\.issued)["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["'](?:article:published_time|og:article:published_time|datePublished|pubdate|date|publishdate|DC\.date\.issued)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = head.match(re)?.[1]?.match(/((?:19|20)\d{2})-(\d{2})-(\d{2})/);
    const iso = m ? validDate(m[1], m[2], m[3], today) : null;
    if (iso) return iso;
  }
  return null;
}

/**
 * An announcement: a raise, an acquisition, a launch, a partnership, an appointment, a milestone with a number. A personal
 * or opinion post ("Full Circle: Why I Joined Appcharge") is not.
 */
export function isAnnouncement(title: string): boolean {
  if (/\b(?:I|my|me)\b/.test(title.replace(/^.*?[|:]\s+(?=\S)/, (m) => m)) && !/\b(?:announce|launch|raise|acqui)/i.test(title)) return false;
  return /\b(?:raises?|raised|secures?|funding|series [a-z]|seed|acquir\w+|acquisition|launch\w*|introduc\w+|unveil\w*|announc\w+|partner\w*|appoint\w*|names?|hires?|expands?|opens?|releases?|surpass\w*|reach\w*|crosse?s|doubles?|triples?|wins?|awarded|award|recogni[sz]ed|integrat\w+)\b/i.test(title) || /[$€£]\s?\d|\b\d+(?:[.,]\d+)?\s?(?:m|bn?|million|billion)\b/i.test(title);
}

/**
 * A page of the company's own site counts as news only under its news / press paths; a blog post only when the
 * company is named in its headline (Appcharge's "Epic v. Google: The Settlement Is Off the Table" is about Google).
 */
export function ownSiteNewsOk(url: string, title: string | null | undefined, companyName: string): boolean {
  let path = "";
  try { path = new URL(url).pathname.toLowerCase(); } catch { return false; }
  if (/\/(?:news|press|newsroom|press-releases?|pressroom|media|in-the-news|announcements?|company-news)(?:\/|$)/.test(path)) return true;
  if (/\/(?:blog|blog-posts|insights|resources|articles|posts|stories)(?:\/|$)/.test(path)) return namesCompanyUpFront({ title, content: "" }, companyName) && isAnnouncement(title ?? "");
  return false;
}

/** What an item reports, for telling two reports of one event apart from two events: amounts raised and an acquisition. */
export function eventKeys(title: string): Set<string> {
  const keys = new Set<string>();
  for (const m of title.matchAll(/(\d+(?:[.,]\d+)?)\s?(billion|bn|million|mn|m|b|k|thousand)\b/gi)) {
    const unit = m[2].toLowerCase();
    const n = parseFloat(m[1].replace(",", "."));
    const u = unit.startsWith("b") ? "b" : unit.startsWith("k") || unit.startsWith("t") ? "k" : "m";
    keys.add(`${n}${u}`);
  }
  if (/\bacqui(?:re|res|red|sition|ring)\b|\bbuys\b|\bbought\b/i.test(title)) keys.add("acquisition");
  return keys;
}

const dayMs = 86_400_000;
/**
 * One row per event (owner, 2026-11-09): the same amount, or the same acquisition, within 7 days — or when either has no
 * date — is one report. The one kept is dated over undated, then an outlet over the company's own site, then the first.
 */
export function dedupeNewsEvents<T extends { title: string; url: string; published_date?: string | null }>(items: T[], isOwnSite: (url: string) => boolean, lead: (item: T) => string = () => ""): T[] {
  const kept: T[] = [];
  const rank = (x: T) => (x.published_date ? 0 : 2) + (isOwnSite(x.url) ? 1 : 0);
  for (const it of items) {
    // The headline and the opening of the article: Bloomberg's "HeyGen Valued at $500 Million" is the $60M Series A.
    const keys = eventKeys(`${it.title} ${lead(it)}`);
    const i = kept.findIndex((k) => {
      const kk = eventKeys(`${k.title} ${lead(k)}`);
      if (![...keys].some((x) => kk.has(x))) return false;
      if (!it.published_date || !k.published_date) return true;
      return Math.abs(Date.parse(it.published_date) - Date.parse(k.published_date)) <= 7 * dayMs;
    });
    if (i < 0) kept.push(it);
    else if (rank(it) < rank(kept[i])) kept[i] = it;
  }
  return kept;
}

/** A headline cut off: ends in a colon, comma, dash, ellipsis or a dangling word. */
export const headlineLooksCut = (t: string): boolean => /(?:[:;,\u2013\u2014-]|\.\.\.|\u2026)\s*$/.test(t.trim()) || /\b(?:and|or|of|to|for|the|a|an|in|on|with|as)\s*$/i.test(t.trim());

const flatHost = (url: string) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9]/g, ""); } catch { return ""; } };
const SITE_WORDS = /\b(?:blog|news|newsroom|press|wire|times|post|journal|magazine|insights|updates|media)\b/i;

/**
 * The headline without the site's name: "Appcharge Blog | Full Circle: …" → "Full Circle: …", "… | TechCrunch" → "…",
 * "… - EU-Startups" → "…". A segment is the site's name when it names the host or reads as a site / section name.
 */
export function cleanHeadline(title: string, url = ""): string {
  let t = title.replace(/\s+/g, " ").trim();
  const host = flatHost(url);
  const isSite = (seg: string, hyphenOnly = false) => {
    const flat = seg.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (flat.length >= 3 && host && (host.includes(flat) || flat.includes(host.split(".")[0] || "\u0000"))) return true;
    return !hyphenOnly && seg.split(/\s+/).length <= 4 && SITE_WORDS.test(seg);
  };
  const lead = t.match(/^([^|\u2013\u2014]{2,40}?)\s+[|\u2013\u2014]\s+(.{15,})$/);
  if (lead && isSite(lead[1])) t = lead[2];
  const tail = t.match(/^(.{15,}?)\s+(?:[|\u2013\u2014]|-)\s+([^|\u2013\u2014]{2,40})$/);
  if (tail && isSite(tail[2], /\s-\s/.test(t.slice(tail[1].length, tail[1].length + 4)))) t = tail[1];
  return t.trim();
}

/** The article's own headline in its page code: og:title, then h1, then <title>. */
export function titleFromHtml(html: string, url = ""): string | null {
  const head = html.slice(0, 400_000);
  const dec = (x: string) => x.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const cands = [
    head.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1],
    head.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1],
    head.match(/<h1[^>]*>([\s\S]{5,300}?)<\/h1>/i)?.[1],
    head.match(/<title[^>]*>([\s\S]{5,300}?)<\/title>/i)?.[1],
  ];
  for (const c of cands) { const t = c ? cleanHeadline(dec(c), url) : ""; if (t.length >= 15 && !headlineLooksCut(t)) return t; }
  return null;
}

/**
 * A headline is the source's own words and the whole of them (pilot dry run 4: the model wrote "Swan's raises a €37m Series B…"
 * over eu-startups' "Paris-based Swan raises €37 million Series B…"; wet batch 1: "Driving Profitability and Streamlining
 * Fleet Operations:" was cut at the colon). The source's own title, without the site's name, is used when it carries the
 * model's; a model title the source carries whole stays; otherwise the source's title, or null (dropped).
 */
export function sourceHeadline(modelTitle: string, source: { title?: string | null; content?: string | null; url?: string }): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
  const t = norm(modelTitle);
  const own = cleanHeadline(source.title ?? "", source.url ?? "");
  const ownOk = own.length >= 15 && !headlineLooksCut(own);
  if (ownOk && t && norm(own).includes(t)) return own;
  const hay = norm(`${source.title ?? ""} ${(source.content ?? "").slice(0, 4000)}`);
  const cleaned = cleanHeadline(modelTitle, source.url ?? "");
  if (t && hay.includes(t) && !headlineLooksCut(cleaned)) return cleaned;
  if (ownOk) return own;
  return cleaned && !headlineLooksCut(cleaned) && t && hay.includes(t) ? cleaned : (headlineLooksCut(modelTitle) && t && hay.includes(t) ? modelTitle.trim() : null);
}
