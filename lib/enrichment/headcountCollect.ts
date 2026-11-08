/**
 * lib/enrichment/headcountCollect.ts — headcount points from registers and archived pages (owner, 2026-11-08):
 *   Companies House   AverageNumberEmployeesDuringPeriod of the annual accounts (iXBRL), one point per period end;
 *                     only for the certain register match whose country is the decided headquarters (registerDecides)
 *   Brreg (Norway)    the register's employee count, dated the day it was read
 *   Wayback Machine   team-size sentences ("a team of 200", "150+ employees") of archived About / Careers pages,
 *                     dated by the copy; the company's robots.txt is honoured and requests are paced
 * Network is injected; a source that fails gives no points, never an error. Every point has a date, source, quote,
 * type and measure (headcountHistory.ts). Form 5500 and CVR wait for the coverage measurement.
 */
import { parseIxbrlEmployees, sizeStatement } from "./headcountSources.ts";
import type { HistoryPoint } from "./headcountHistory.ts";
import { sameEntityName } from "./registers.ts";

export interface HeadcountIo {
  fetchJson: (url: string, headers?: Record<string, string>) => Promise<unknown>;
  fetchText: (url: string, headers?: Record<string, string>) => Promise<string>;
  /** Waits between requests to one host (default 1 s). */
  pause?: () => Promise<void>;
  env?: Record<string, string | undefined>;
}

// ── Companies House ─────────────────────────────────────────────────────────
export async function companiesHouseHeadcount(number: string, entity: string, io: HeadcountIo): Promise<HistoryPoint[]> {
  const key = io.env?.COMPANIES_HOUSE_API_KEY;
  if (!key) return [];
  const headers = { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` };
  const out = new Map<string, HistoryPoint>();
  try {
    const f = await io.fetchJson(`https://api.company-information.service.gov.uk/company/${number}/filing-history?category=accounts&items_per_page=4`, headers) as { items?: Array<{ links?: { document_metadata?: string } }> };
    for (const it of (f.items ?? []).slice(0, 3)) {
      const doc = it.links?.document_metadata;
      if (!doc) continue;
      await io.pause?.();
      const xhtml = await io.fetchText(`${doc}/content`, { ...headers, Accept: "application/xhtml+xml" }).catch(() => "");
      for (const r of parseIxbrlEmployees(xhtml)) {
        if (!out.has(r.date)) out.set(r.date, {
          date: r.date, value: r.value, type: "registry", measure: "average_in_period",
          sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${number}/filing-history`,
          quote: `${entity} (${number}): average number of employees during the period ending ${r.date}: ${r.value}`,
        });
      }
    }
  } catch { /* no register data */ }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ── Brreg ───────────────────────────────────────────────────────────────────
const noNordicForm = (s: string) => s.replace(/\s+(asa|as|a\/s|aps)\.?\s*$/i, "").trim();
export async function brregHeadcount(name: string, legalName: string | null | undefined, io: HeadcountIo, today: string): Promise<HistoryPoint[]> {
  try {
    const res = await io.fetchJson(`https://data.brreg.no/enhetsregisteret/api/enheter?navn=${encodeURIComponent(legalName || name)}&size=10`) as { _embedded?: { enheter?: Array<{ navn: string; organisasjonsnummer: string; antallAnsatte?: number }> } };
    const hits = (res._embedded?.enheter ?? []).filter((e) => sameEntityName(noNordicForm(e.navn), name) || (!!legalName && sameEntityName(noNordicForm(e.navn), noNordicForm(legalName))));
    // Two entities of the same name: not certain, so none.
    if (hits.length !== 1 || hits[0].antallAnsatte == null || hits[0].antallAnsatte <= 0) return [];
    const e = hits[0];
    return [{
      date: today, value: e.antallAnsatte!, type: "registry", measure: "count_at_date",
      sourceUrl: `https://data.brreg.no/enhetsregisteret/api/enheter/${e.organisasjonsnummer}`,
      quote: `${e.navn} (${e.organisasjonsnummer}): antallAnsatte ${e.antallAnsatte}, read ${today}`,
    }];
  } catch { return []; }
}

// ── Wayback Machine ─────────────────────────────────────────────────────────
/** Whether the User-agent: * group of a robots.txt lets a path be fetched (the longest matching rule wins; Allow on a tie). */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  let applies = false, sawAgent = false;
  const rules: Array<{ allow: boolean; prefix: string }> = [];
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) { if (!line) sawAgent = false; continue; }
    const [k, v] = [m[1].toLowerCase(), m[2].trim()];
    if (k === "user-agent") { applies = sawAgent ? applies || v === "*" : v === "*"; sawAgent = true; continue; }
    sawAgent = false;
    if (!applies || (k !== "allow" && k !== "disallow") || !v) continue;
    rules.push({ allow: k === "allow", prefix: v.replace(/\*$/, "") });
  }
  const hit = rules.filter((r) => path.startsWith(r.prefix)).sort((a, b) => b.prefix.length - a.prefix.length || Number(b.allow) - Number(a.allow))[0];
  return hit ? hit.allow : true;
}

const PATHS = ["about", "about-us", "careers", "company"];
const textOf = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

export async function waybackHeadcount(domain: string, companyName: string, io: HeadcountIo, opts: { maxSnapshots?: number } = {}): Promise<HistoryPoint[]> {
  const max = opts.maxSnapshots ?? 6;
  const robots = await io.fetchText(`https://${domain}/robots.txt`).catch(() => "");
  const firstWord = companyName.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).find((w) => w.length >= 3) ?? "";
  // One candidate per (path, year): the year's first copy of that page.
  const cands: Array<{ ts: string; orig: string; path: string }> = [];
  for (const path of PATHS) {
    if (!robotsAllows(robots, `/${path}`)) continue;
    try {
      await io.pause?.();
      const rows = await io.fetchJson(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(`${domain}/${path}`)}&output=json&filter=statuscode:200&filter=mimetype:text/html&collapse=timestamp:4&limit=15`) as string[][];
      for (const [, ts, orig] of rows.slice(1)) if (ts && orig) cands.push({ ts, orig, path });
    } catch { /* no copies */ }
  }
  // Spread over the years: the newest and oldest first, then the ones between.
  const byYear = new Map<string, typeof cands>();
  for (const c of cands) byYear.set(c.ts.slice(0, 4), [...(byYear.get(c.ts.slice(0, 4)) ?? []), c]);
  const years = [...byYear.keys()].sort();
  const order = years.length <= max ? years : [years[0], years[years.length - 1], ...years.slice(1, -1)];
  const points: HistoryPoint[] = [];
  const seenYear = new Set<string>();
  let fetched = 0;
  for (const y of order) {
    for (const c of byYear.get(y) ?? []) {
      if (fetched >= max || seenYear.has(y)) break;
      fetched++;
      try {
        await io.pause?.();
        const page = textOf(await io.fetchText(`https://web.archive.org/web/${c.ts}id_/${c.orig}`));
        if (firstWord && !page.toLowerCase().includes(firstWord)) continue;   // another owner of the domain
        const st = sizeStatement(page);
        if (!st) continue;
        // The quote must carry the number and be about the company (review 6: CaPow's quote was about SolarEdge).
        const q = st.sentence.replace(/(\d),(\d)/g, "$1$2");
        if (!new RegExp(`(^|[^\\d])${st.value}([^\\d]|$)`).test(q)) continue;
        if (!(firstWord && q.toLowerCase().includes(firstWord)) && !/\b(?:we|our|us)\b|\bthe\b[^.]{0,40}\b(?:company|startup|firm|team|business)\b/i.test(q)) continue;
        // A figure the text dates to a year belongs to that year, not to the day of the copy (BrowserStack's 2014 milestone).
        if (st.year && st.year > Number(c.ts.slice(0, 4))) continue;
        seenYear.add(st.year ? String(st.year) : y);
        points.push({
          date: st.year ? `${st.year}-01-01` : `${c.ts.slice(0, 4)}-${c.ts.slice(4, 6)}-${c.ts.slice(6, 8)}`, value: st.value, lowerBound: st.lowerBound || undefined,
          type: "site_stated", measure: st.year ? "count_in_year" : "count_at_date", sourceUrl: `https://web.archive.org/web/${c.ts}/${c.orig}`, quote: st.sentence,
        });
      } catch { /* copy not readable */ }
    }
    if (fetched >= max) break;
  }
  return points.filter((p, i) => points.findIndex((x) => x.date === p.date && x.type === p.type) === i).sort((a, b) => a.date.localeCompare(b.date));
}
