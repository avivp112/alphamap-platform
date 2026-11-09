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
 * A page of the company's own site counts as news only under its news / press paths; a blog post only when the
 * company is named in its headline (Appcharge's "Epic v. Google: The Settlement Is Off the Table" is about Google).
 */
export function ownSiteNewsOk(url: string, title: string | null | undefined, companyName: string): boolean {
  let path = "";
  try { path = new URL(url).pathname.toLowerCase(); } catch { return false; }
  if (/\/(?:news|press|newsroom|press-releases?|pressroom|media|in-the-news|announcements?|company-news)(?:\/|$)/.test(path)) return true;
  if (/\/(?:blog|insights|resources|articles|posts|stories)(?:\/|$)/.test(path)) return namesCompanyUpFront({ title, content: "" }, companyName);
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
export function dedupeNewsEvents<T extends { title: string; url: string; published_date?: string | null }>(items: T[], isOwnSite: (url: string) => boolean): T[] {
  const kept: T[] = [];
  const rank = (x: T) => (x.published_date ? 0 : 2) + (isOwnSite(x.url) ? 1 : 0);
  for (const it of items) {
    const keys = eventKeys(it.title);
    const i = kept.findIndex((k) => {
      const kk = eventKeys(k.title);
      if (![...keys].some((x) => kk.has(x))) return false;
      if (!it.published_date || !k.published_date) return true;
      return Math.abs(Date.parse(it.published_date) - Date.parse(k.published_date)) <= 7 * dayMs;
    });
    if (i < 0) kept.push(it);
    else if (rank(it) < rank(kept[i])) kept[i] = it;
  }
  return kept;
}
