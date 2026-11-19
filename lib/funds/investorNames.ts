/**
 * lib/funds/investorNames.ts — investor-name keys for the funds project (stage 0).
 *
 * "Index", "Index Ventures", "Index Ventures Growth VI L.P." and "Index Capital" are DIFFERENT entities
 * (brief, section A). So there are two keys and they have different jobs:
 *
 *   exact_key  legal-form words (L.P., LLC, Ltd …) and the fund number removed, nothing else. Two names with the
 *              same exact_key are the same name; this is the only key a count may be attributed on.
 *   loose_key  also drops generic firm words (Capital, Ventures, Partners …). It exists ONLY to surface clusters
 *              that need a human decision ("index" ← "Index", "Index Ventures", "Index Capital"). Never merges.
 *
 * Matching an investor name to an entity on Aviv's list is by DOMAIN, or by full name + city — never by name
 * alone (rule 7). A name-only match is an estimate and is reported as such. Pure; no I/O.
 */

export interface InvestorKey {
  raw: string;
  exact_key: string;
  loose_key: string;
  /** Fund number read from the name ("Fund VII" → 7, "Growth VI" → 6), or null. */
  fund_series: number | null;
  /** The name carries a fund/vehicle marker ("Fund", "L.P.", a fund number): a vehicle, not necessarily the firm. */
  vehicle_like: boolean;
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15 };
const LEGAL = new Set(["lp", "llp", "llc", "ltd", "limited", "inc", "incorporated", "corp", "corporation", "gmbh", "sa", "ag", "bv", "plc", "co", "sarl", "kg", "ab", "as", "oy", "pte"]);
/** Generic firm words: dropped for loose_key only. "growth" / "opportunities" are NOT here: they name a distinct vehicle. */
const GENERIC = new Set(["capital", "ventures", "venture", "partners", "partner", "vc", "fund", "funds", "management", "investments", "investment", "group", "holdings", "advisors", "advisers", "equity", "the", "and"]);

const fold = (s: string): string =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\bl\s*\.\s*l\s*\.\s*c\b\.?/g, "llc").replace(/\bl\s*\.\s*l\s*\.\s*p\b\.?/g, "llp").replace(/\bl\s*\.\s*p\b\.?/g, "lp")
    .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function investorKey(raw: string): InvestorKey {
  let toks = fold(raw).split(" ").filter(Boolean);
  let vehicle = false;
  let series: number | null = null;
  // trailing legal-form words, then a trailing fund number (in either order, a few passes: "Fund VII L.P.")
  for (let pass = 0; pass < 3; pass++) {
    const last = toks[toks.length - 1];
    if (last && LEGAL.has(last) && toks.length > 1) { toks.pop(); if (last === "lp" || last === "llp") vehicle = true; continue; }
    if (last && series === null && toks.length > 1 && (ROMAN[last] || /^[0-9]{1,2}$/.test(last))) {
      series = ROMAN[last] ?? Number(last); toks.pop(); vehicle = true;
      if (toks[toks.length - 1] === "fund" && toks.length > 1) toks.pop();
      continue;
    }
    break;
  }
  if (toks[toks.length - 1] === "fund" && toks.length > 1) { toks.pop(); vehicle = true; }
  if (toks[0] === "the" && toks.length > 1) toks.shift();
  const exact = toks.join(" ");
  const loose = toks.filter((t) => !GENERIC.has(t)).join(" ") || exact;
  return { raw, exact_key: exact, loose_key: loose, fund_series: series, vehicle_like: vehicle };
}

/** The registrable host of a website, for domain matching ("https://www.indexventures.com/x" → "indexventures.com"). */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const h = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
    return h || null;
  } catch { return null; }
}

export interface Cluster { loose_key: string; exact_keys: string[] }

/** loose_keys shared by two or more different exact_keys: the clusters a human must look at. Never merged. */
export function ambiguousClusters(keys: Iterable<InvestorKey>): Cluster[] {
  const by = new Map<string, Set<string>>();
  for (const k of keys) { if (!by.has(k.loose_key)) by.set(k.loose_key, new Set()); by.get(k.loose_key)!.add(k.exact_key); }
  return [...by].filter(([, s]) => s.size > 1).map(([loose_key, s]) => ({ loose_key, exact_keys: [...s].sort() })).sort((a, b) => b.exact_keys.length - a.exact_keys.length);
}
