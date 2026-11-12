/**
 * The company's own Hugging Face and GitHub organization, read from its own website (owner, 2026-11-12).
 *
 * Pages are read in full here, before the 6,000-character cap: the links sit in the footer, which the cap cuts off.
 * A link counts only as a bare organization address (huggingface.co/<org>, github.com/<org>), never a model or a repo of someone else,
 * and only when the whole site names ONE such organization: two different ones is a page that points at partners, not at itself.
 * That link, from the company's own site, is what makes the Hugging Face / GitHub organization certain (migration 20261126 site_link).
 */

const HF_RESERVED = new Set(["models", "datasets", "spaces", "docs", "blog", "papers", "organizations", "collections", "login", "join", "pricing", "enterprise", "tasks", "chat", "settings", "huggingface", "learn", "posts", "jobs", "new", "api", "terms-of-service", "privacy", "code-of-conduct", "content-guidelines", "support"]);
const GH_RESERVED = new Set(["features", "about", "pricing", "topics", "marketplace", "sponsors", "login", "join", "enterprise", "orgs", "settings", "explore", "collections", "trending", "readme", "security", "customer-stories", "resources", "solutions", "contact", "site", "apps", "notifications", "new", "organizations", "search", "pulls", "issues", "codespaces", "copilot", "premium-support", "team", "why-github", "github", "login", "signup"]);

export interface DevLinks { github: string[]; huggingface: string[] }

/** Bare organization links found in a page's text or markdown. The set is lower-cased; the first spelling seen is kept for the URL. */
export function devLinksFromText(text: string): DevLinks {
  const out: DevLinks = { github: [], huggingface: [] };
  const seen = { github: new Set<string>(), huggingface: new Set<string>() };
  const re = /https?:\/\/(?:www\.)?(huggingface\.co|github\.com)\/([A-Za-z0-9][A-Za-z0-9._-]{0,38})(\/?)(?=[\s)"'<>\]?#]|$)/gi;
  for (const m of text.matchAll(re)) {
    const host = m[1].toLowerCase();
    const org = m[2];
    const key = org.toLowerCase();
    // a bare organization address: the slash after it ends the address (a deeper path is a repo or a model, not the organization)
    const kind = host === "github.com" ? "github" : "huggingface";
    if ((kind === "github" ? GH_RESERVED : HF_RESERVED).has(key)) continue;
    if (seen[kind].has(key)) continue;
    seen[kind].add(key);
    out[kind].push(`https://${host}/${org}`);
  }
  return out;
}

/** One organization across all the site's pages, or null (none, or several: a page that points at partners). */
export function pickDevLinks(pages: Array<{ url: string; dev_links?: DevLinks }>): { github: { url: string; page: string } | null; huggingface: { url: string; page: string } | null } {
  const pick = (kind: keyof DevLinks) => {
    const byOrg = new Map<string, { url: string; page: string }>();
    for (const p of pages) for (const u of p.dev_links?.[kind] ?? []) { const k = u.toLowerCase(); if (!byOrg.has(k)) byOrg.set(k, { url: u, page: p.url }); }
    return byOrg.size === 1 ? [...byOrg.values()][0] : null;
  };
  return { github: pick("github"), huggingface: pick("huggingface") };
}
