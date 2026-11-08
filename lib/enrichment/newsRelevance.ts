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

/** The article names the company in its headline or opening: one that mentions it only in passing is not news about it. */
export function namesCompanyUpFront(item: { title?: string | null; content?: string | null }, companyName: string): boolean {
  const core = companyName.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
  if (!core) return true;
  const flat = (s: string) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ")} `;
  const text = flat(`${item.title ?? ""} ${(item.content ?? "").slice(0, 600)}`);
  return text.includes(` ${core} `) || text.includes(` ${core.replace(/ /g, "")} `);
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
  // With the article's text at hand: its headline or opening must name the company (TechCrunch+ roundups mention it in passing).
  if ((item.content ?? "").length >= 300 && !namesCompanyUpFront(item, companyName)) return "not_about_the_company";
  const product = describedProduct(item.title, item.content, companyName);
  if (!product) return null;
  const pw = words(product);
  if (!pw.length) return null;
  const dw = new Set(words(description).map(stem));
  return pw.some((w) => dw.has(stem(w))) ? null : "different_product";
}
