/**
 * Adding companies to the database from a list of names and websites (owner, 2026-11-13). Add only: a company already there — by its website's
 * domain or its exact name — is reported and left exactly as it is. Pure: the parsing, the clean-up and the sorting of the rows; the script
 * (scripts/add_companies.ts) does the database.
 */
export interface ListRow { name: string; website: string | null }
export type Verdict = "new" | "same_domain_in_database" | "in_file_duplicate" | "already_in_database" | "name_already_in_database" | "no_name" | "no_website" | "bad_website" | "not_a_company_site";
export interface Sorted { row: ListRow; line: number; verdict: Verdict; website: string | null; note: string }

const clean = (s: string) => s.replace(/^﻿/, "").replace(/ /g, " ").replace(/​/g, "").trim();

/** One CSV line into cells ("quoted, with commas" and "" escapes); the delimiter is a comma, or a semicolon / tab when the header uses one. */
export function parseLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === delimiter) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** The rows of a list with a header that has a name column and a website column (any case; Hebrew or English names of the columns are not guessed). */
export function parseList(text: string): { rows: Array<ListRow & { line: number }>; problem: string | null } {
  const lines = text.replace(/\r/g, "").split("\n");
  const headerAt = lines.findIndex((l) => clean(l) !== "");
  if (headerAt < 0) return { rows: [], problem: "the file is empty" };
  const head = clean(lines[headerAt]);
  const raw = lines[headerAt].replace(/^\uFEFF/, "");
  const delimiter = [",", ";", "\t"].map((d) => [d, raw.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const header = parseLine(head, delimiter).map((h) => clean(h).toLowerCase());
  // A list with no header line: "Name<TAB>website" (the second cell of the first line is an address). Name first, website second.
  const firstCells = parseLine(raw, delimiter).map(clean);
  if (firstCells.length === 2 && normalizeSite(firstCells[1]) && !/^(website|site|url|domain|web)$/i.test(firstCells[1])) {
    const rows: Array<ListRow & { line: number }> = [];
    for (let i = headerAt; i < lines.length; i++) {
      if (clean(lines[i]) === "") continue;
      const c = parseLine(lines[i].replace(/^\uFEFF/, ""), delimiter).map(clean);
      rows.push({ name: c[0] ?? "", website: c[1] || null, line: i + 1 });
    }
    return { rows, problem: null };
  }
  const nameIdx = header.findIndex((h) => ["name", "company", "company name", "שם"].includes(h));
  const siteIdx = header.findIndex((h) => ["website", "site", "url", "domain", "web", "אתר"].includes(h));
  if (nameIdx < 0 || siteIdx < 0) return { rows: [], problem: `the first line must name two columns, name and website; found: ${header.join(", ")}` };
  const rows: Array<ListRow & { line: number }> = [];
  for (let i = headerAt + 1; i < lines.length; i++) {
    if (clean(lines[i]) === "") continue;
    const cells = parseLine(lines[i], delimiter);
    rows.push({ name: clean(cells[nameIdx] ?? ""), website: clean(cells[siteIdx] ?? "") || null, line: i + 1 });
  }
  return { rows, problem: null };
}

/** https://host, no path, query, fragment or www; null when it is not an address of a site. */
export function normalizeSite(raw: string | null): { site: string; host: string; path: string } | null {
  const w = clean(raw ?? "");
  if (!w || /\s/.test(w)) return null;
  if (/^[^/]*@/.test(w.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""))) return null;   // an email address, or an address with a user name in it
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(w) ? w : `https://${w}`); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || host.length > 120) return null;
  return { site: `https://${host}`, host, path: u.pathname.replace(/\/+$/, "") };
}

/**
 * A page of a platform is not a company's own site: linkedin.com/company/x, crunchbase.com/organization/x. The platform's bare address is
 * not a page (a company may be called Linktree, with linktr.ee as its site). A site hosted on a platform's subdomain (x.github.io) is not
 * the company's own domain either.
 */
const PLATFORM_PAGES = /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|github\.com|gitlab\.com|medium\.com|crunchbase\.com|pitchbook\.com|tracxn\.com|wikipedia\.org|apps\.apple\.com|play\.google\.com|linktr\.ee|bit\.ly|google\.com|notion\.so)$/i;
const PLATFORM_SUBDOMAINS = /\.(github\.io|gitlab\.io|wixsite\.com|weebly\.com|blogspot\.com|wordpress\.com|vercel\.app|netlify\.app|herokuapp\.com|notion\.site|pages\.dev)$/i;
export const isPlatformAddress = (host: string, path: string) => (PLATFORM_PAGES.test(host) && path !== "" && path !== "/") || PLATFORM_SUBDOMAINS.test(host);

export const nameKey = (name: string) => name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/\b(inc|ltd|llc|gmbh|corp|corporation|limited|co)\b\.?/g, " ").replace(/[^a-z0-9֐-׿]+/g, "");

/**
 * Each row's verdict. `known`: the websites' hosts and the names (as nameKey) already in the database.
 * An address that is a platform page is not added (a company's LinkedIn page is not its site); a row with no website is not added either:
 * the enrichment starts from the site.
 */
/** example.com for app.example.com; example.co.uk for www.example.co.uk. */
export function registrable(host: string): string {
  const p = host.split(".");
  if (p.length <= 2) return host;
  return p.length >= 3 && p[p.length - 1].length === 2 && ["co", "com", "org", "net", "gov", "ac", "edu"].includes(p[p.length - 2]) ? p.slice(-3).join(".") : p.slice(-2).join(".");
}

export function sortRows(rows: Array<ListRow & { line: number }>, known: { hosts: Set<string>; names: Set<string> }): Sorted[] {
  const knownRegistrable = new Map<string, string>();
  for (const h of known.hosts) knownRegistrable.set(registrable(h), h);
  const seenHost = new Set<string>();
  const seenName = new Set<string>();
  return rows.map((r) => {
    const base = { row: { name: r.name, website: r.website }, line: r.line };
    if (!r.name) return { ...base, verdict: "no_name" as const, website: null, note: "no name" };
    if (!r.website) return { ...base, verdict: "no_website" as const, website: null, note: "no website: the enrichment starts from the site" };
    const n = normalizeSite(r.website);
    if (!n) return { ...base, verdict: "bad_website" as const, website: null, note: `not an address of a site: "${r.website}"` };
    if (isPlatformAddress(n.host, n.path)) return { ...base, verdict: "not_a_company_site" as const, website: null, note: `${n.host}${n.path} is a page of a platform, not the company's own site` };
    if (seenHost.has(n.host)) return { ...base, verdict: "in_file_duplicate" as const, website: n.site, note: `${n.host} is twice in the file` };
    seenHost.add(n.host);
    if (known.hosts.has(n.host)) return { ...base, verdict: "already_in_database" as const, website: n.site, note: `${n.host} is already in the database` };
    const kr = knownRegistrable.get(registrable(n.host));
    if (kr) return { ...base, verdict: "same_domain_in_database" as const, website: n.site, note: `${n.host} and ${kr}, already in the database, are one domain: check, it may be the same company` };
    const nk = nameKey(r.name);
    if (nk.length >= 3 && (known.names.has(nk) || seenName.has(nk))) return { ...base, verdict: "name_already_in_database" as const, website: n.site, note: `a company named "${r.name}" is already ${known.names.has(nk) ? "in the database" : "in the file"} with another website: check, it may be the same company` };
    if (nk.length >= 3) seenName.add(nk);
    return { ...base, verdict: "new" as const, website: n.site, note: n.site === clean(r.website) ? "" : `website written as ${n.site}` };
  });
}

export function summaryOf(sorted: Sorted[]): string[] {
  const label: Record<Verdict, string> = {
    new: "new (will be added)", in_file_duplicate: "twice in the file", already_in_database: "already in the database (same website)",
    same_domain_in_database: "same domain as a company already there, another address (not added: check)", name_already_in_database: "same name as a company already there, other website (not added: check)", no_name: "no name", no_website: "no website",
    bad_website: "not an address of a site", not_a_company_site: "a platform page, not the company's site",
  };
  const n = new Map<Verdict, number>();
  for (const s of sorted) n.set(s.verdict, (n.get(s.verdict) ?? 0) + 1);
  return [`${sorted.length} rows`, ...(Object.keys(label) as Verdict[]).filter((v) => n.get(v)).map((v) => `  ${String(n.get(v)).padStart(5)}  ${label[v]}`)];
}
