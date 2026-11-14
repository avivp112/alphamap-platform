/**
 * lib/enrichment/ownDomain.ts — the company's own site is tier 1 even when its domain is not the one on file (owner, 2026-11-14: aerobotix.com for
 * aerobotix.co.il, moft.com for moft.us were blocked as "company_owned"). A page belongs to the company when
 *   - its domain is the one the registered website redirects to, or
 *   - the brand is the same: the domain's name is the company's name (aerobotix.com / Aerobotix, moft.com / Moft) and the page names the company.
 * Pure except finalHostOf (one fetch, injected where tested).
 */
import { registrable } from "./addCompanies.ts";

const SUFFIX = /\b(inc|ltd|llc|gmbh|ag|ab|as|oy|plc|corp|co|limited|technologies|technology|labs|group|holdings|ai|io)\b\.?/g;
const squash = (s: string) => s.toLowerCase().replace(SUFFIX, " ").replace(/[^\p{L}\p{N}]/gu, "");

/** The domain's name (without the country or generic ending) written as the company's name: "aerobotix.com" / "Aerobotix, Inc.". */
export function brandLabelMatches(url: string, companyName: string): boolean {
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
    const label = registrable(host).split(".")[0].replace(/-/g, "");
    const name = squash(companyName);
    // a short or generic name ("Bold", "Ada") is not enough on its own: the page must name the company too (below)
    return !!name && name.length >= 3 && label === name;
  } catch { return false; }
}

/** The page names the company (its name in the title or the text). */
export function pageNamesCompany(page: { title?: string | null; content?: string | null }, companyName: string): boolean {
  const name = companyName.toLowerCase().replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
  if (name.length < 3) return false;
  return `${page.title ?? ""} ${(page.content ?? "").slice(0, 6000)}`.toLowerCase().includes(name);
}

export function isSameBrandPage(page: { url: string; title?: string | null; content?: string | null }, companyName: string): boolean {
  return brandLabelMatches(page.url, companyName) && pageNamesCompany(page, companyName);
}

const finalHosts = new Map<string, string | null>();
/** The registrable domain an address ends up at after its redirects (3.5 s per hop is plenty); null when it cannot be reached. */
export async function finalHostOf(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (finalHosts.has(url)) return finalHosts.get(url)!;
  let out: string | null = null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetchImpl(url.startsWith("http") ? url : `https://${url}`, { redirect: "follow", signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; AlphaMapBot)" } });
    clearTimeout(t);
    out = registrable(new URL(r.url).hostname.toLowerCase().replace(/^www\./, ""));
  } catch { out = null; }
  finalHosts.set(url, out);
  return out;
}

/** The sources of other domains that are the company's own site: the redirect target of the registered website, or the same brand. */
export function ownBrandSources<T extends { url: string; title?: string | null; content?: string | null; source_type?: string | null }>(
  sources: T[], companyName: string, redirectDomain?: string | null,
): T[] {
  return sources.filter((s) => {
    if (s.source_type === "company_site") return false;
    let reg: string | null = null;
    try { reg = registrable(new URL(s.url).hostname.toLowerCase().replace(/^www\./, "")); } catch { return false; }
    return (!!redirectDomain && reg === redirectDomain && pageNamesCompany(s, companyName)) || isSameBrandPage(s, companyName);
  });
}
