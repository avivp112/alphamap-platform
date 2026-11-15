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

const finalOrigins = new Map<string, string | null>();
/** The origin (https://host) an address ends up at after its redirects; null when it cannot be reached. tymebank.co.za → https://gotyme.co.za */
export async function finalOriginOf(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (finalOrigins.has(url)) return finalOrigins.get(url)!;
  let out: string | null = null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetchImpl(url.startsWith("http") ? url : `https://${url}`, { redirect: "follow", signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; AlphaMapBot)" } });
    clearTimeout(t);
    out = new URL(r.url).origin;
  } catch { out = null; }
  finalOrigins.set(url, out);
  return out;
}
/** The registrable domain an address ends up at after its redirects; null when it cannot be reached. */
export async function finalHostOf(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const o = await finalOriginOf(url, fetchImpl);
  return o ? registrable(new URL(o).hostname.toLowerCase().replace(/^www\./, "")) : null;
}

// ── Evidence that a page of another domain is the company's own (owner, 2026-11-14, condition on MR 54) ──────────────────────────────────
// The same brand and the company's name on the page is not enough (marvel.com is not Marvel App's; datax.com is not DataX's). The brand must match AND at
// least one of: (a) the page and the registered website link to each other, in either direction; (b) the same e-mail address, phone number or street
// address on both; (c) a product name from the registered website's headings appears on the page. With the registered website unread there is no evidence.

export interface PageText { url: string; title?: string | null; content?: string | null }

const hostOfUrl = (u: string): string | null => { try { return new URL(u.startsWith("http") ? u : `https://${u}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; } };

export function emailsIn(text: string): Set<string> {
  return new Set((text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) ?? []).map((e) => e.toLowerCase().replace(/[.,;)]+$/, "")).filter((e) => !/\.(png|jpe?g|gif|svg|webp)$/.test(e)));
}
export function phonesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:\+|\b)\d[\d\s().-]{7,18}\d/g)) {
    const d = m[0].replace(/\D/g, "");
    if (d.length >= 8 && d.length <= 15 && !/^(\d)\1+$/.test(d) && !/^(19|20)\d{6,}$/.test(d)) out.add(d.slice(-8));   // the national number: a country code or a leading 0 differs between sites
  }
  return out;
}
const STREET = /\b(\d{1,5})\s+((?:[A-Z][\w.'-]*\s+){0,3}?[A-Z][\w.'-]*)\s+(Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Parkway|Pkwy|Place|Pl|Square|Sq)\b\.?/g;
const STREET_FORM: Record<string, string> = { st: "street", rd: "road", ave: "avenue", blvd: "boulevard", dr: "drive", ln: "lane", ct: "court", pkwy: "parkway", pl: "place", sq: "square" };
export function addressesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(STREET)) out.add(`${m[1]} ${m[2]} ${STREET_FORM[m[3].toLowerCase()] ?? m[3].toLowerCase()}`.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " "));
  return out;
}

const COMMON = new Set(["about", "contact", "home", "pricing", "features", "products", "product", "solutions", "company", "careers", "login", "sign", "blog", "news", "customers", "resources", "support", "learn", "request", "demo", "book", "get", "started", "free", "trial", "download", "privacy", "terms", "cookies", "cookie", "english", "services", "platform", "team", "partners", "press", "overview", "welcome", "menu", "search", "skip", "content", "main", "navigation"]);
/** Product names from the registered website: CamelCase, ALLCAPS or digit-bearing words of its title and headings (not the company's own name, not common site words). */
export function productTerms(pages: PageText[], companyName: string): string[] {
  const own = new Set(companyName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const out = new Set<string>();
  for (const p of pages) {
    const lines = [p.title ?? "", ...(p.content ?? "").split("\n").filter((l) => /^\s*#{1,3}\s/.test(l)).map((l) => l.replace(/^\s*#+\s*/, ""))];
    for (const line of lines) for (const w of line.split(/[^A-Za-z0-9-]+/)) {
      if (w.length < 3 || own.has(w.toLowerCase()) || COMMON.has(w.toLowerCase())) continue;
      if (/^[A-Z][a-z]+[A-Z]\w*$/.test(w) || /^[A-Z0-9-]{3,}$/.test(w) || /\d/.test(w) && /[A-Za-z]/.test(w)) out.add(w);
    }
  }
  return [...out];
}

/** The text points at the domain (a link or a written web address) — not an e-mail address at it ("support@moft.com"). */
export function mentionsAddress(text: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![@\\w.-])(?:https?:\\/\\/)?(?:[a-z0-9-]+\\.)*${d}(?![\\w-])`, "i").test(text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, " "));
}

export interface OwnEvidence { how: "redirect" | "link" | "contact" | "product" }
/** What shows that `page` (brand-matching, another domain) belongs to the company whose registered website is read in `registered`; null when nothing does. */
export function ownEvidence(page: PageText, registered: { host: string | null; pages: PageText[] }, companyName: string): OwnEvidence | null {
  if (!registered.pages.length) return null;
  const pageHost = hostOfUrl(page.url);
  const pageText = `${page.title ?? ""}\n${page.content ?? ""}`;
  const regText = registered.pages.map((p) => `${p.title ?? ""}\n${p.content ?? ""}`).join("\n");
  // (a) a link, either way
  if (registered.host && mentionsAddress(pageText, registrable(registered.host))) return { how: "link" };
  if (pageHost && mentionsAddress(regText, registrable(pageHost))) return { how: "link" };
  // (b) the same e-mail, phone or street address
  const shared = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));
  if (shared(emailsIn(pageText), emailsIn(regText)) || shared(phonesIn(pageText), phonesIn(regText)) || shared(addressesIn(pageText), addressesIn(regText))) return { how: "contact" };
  // (c) a product name of the registered website
  const lower = pageText;
  if (productTerms(registered.pages, companyName).some((t) => new RegExp(`(^|[^A-Za-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`).test(lower))) return { how: "product" };
  return null;
}

/**
 * The sources of other domains that are the company's own site: the domain the registered website redirects to (the site itself leads there),
 * or the same brand with evidence (ownEvidence).
 */
export function ownBrandSources<T extends PageText & { source_type?: string | null }>(
  sources: T[], companyName: string, redirectDomain?: string | null, registered: { host: string | null; pages: PageText[] } = { host: null, pages: [] },
): Array<T & { ownHow: string }> {
  const out: Array<T & { ownHow: string }> = [];
  for (const s of sources) {
    if (s.source_type === "company_site") continue;
    let reg: string | null = null;
    try { reg = registrable(new URL(s.url).hostname.toLowerCase().replace(/^www\./, "")); } catch { continue; }
    if (!!redirectDomain && reg === redirectDomain && pageNamesCompany(s, companyName)) { out.push({ ...s, ownHow: "the registered website redirects there" }); continue; }
    if (brandLabelMatches(s.url, companyName) && pageNamesCompany(s, companyName)) {
      const ev = ownEvidence(s, registered, companyName);
      if (ev) out.push({ ...s, ownHow: { link: "linked with the registered website", contact: "the same e-mail, phone or address as the registered website", product: "a product name of the registered website", redirect: "redirect" }[ev.how] });
    }
  }
  return out;
}
