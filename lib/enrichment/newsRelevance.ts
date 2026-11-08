/**
 * lib/enrichment/newsRelevance.ts — what is not news about THIS company (owner, 2026-11-08, review 6).
 *   explainer          a guide or explainer, not a report of something that happened ("What to know before investing in
 *                      Ethereum competitor Solana (SOL)")
 *   different_product  an article about a company of the same name that makes something else (Banzai's acquisition of
 *                      "AI Web Development and Hosting Platform Superblocks" is not the enterprise app platform): the
 *                      product the article names after the company's name shares no word with the company's description
 * The second needs the article to say what the company makes; an article that does not is not judged (no verdict).
 */

const EXPLAINER = /\b(what (?:to know|is|are|you (?:need|should) (?:to )?know)|how to (?:buy|invest|trade|use)|should you (?:buy|invest)|is [^?]{0,50} a good (?:investment|buy)|price prediction|before investing|investing in|explained|explainer|beginner'?s guide|a guide to|everything you need to know|pros and cons|where to buy)\b/i;

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
export function newsProblem(item: { title?: string | null; content?: string | null }, companyName: string, description: string): "explainer" | "different_product" | null {
  if (isExplainer(item.title)) return "explainer";
  const product = describedProduct(item.title, item.content, companyName);
  if (!product) return null;
  const pw = words(product);
  if (!pw.length) return null;
  const dw = new Set(words(description).map(stem));
  return pw.some((w) => dw.has(stem(w))) ? null : "different_product";
}
