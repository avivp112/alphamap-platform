/**
 * lib/funds/investorNames.ts — investor-name keys for the funds project (stage 0). Pure; no I/O.
 *
 * Conservative merge rule (owner, 2026-11-26): names are merged automatically ONLY after case, accents, punctuation and
 * LEGAL suffixes (LLC, L.P., Ltd, Inc, GmbH …) are cleaned. Ventures / Capital / Partners / Fund / Growth are NEVER dropped:
 * "Index Ventures" and "Index Capital" stay two entities, and "Sequoia Capital Fund VII" is not auto-merged into
 * "Sequoia Capital". Everything else is a CANDIDATE pair, listed for a human; the 100–200 most frequent get a manual pass.
 *
 *   exact_key           legal suffixes removed, nothing else. The only key a count is attributed on.
 *   firm_candidate_key  the same name without a trailing fund number / "Fund" — a candidate parent of a fund vehicle. Never merged.
 *   loose_key           also drops generic firm words — only to surface candidate clusters. Never merged.
 *
 * Matching to an entity on Aviv's list is by DOMAIN, or by full name + city — never by name alone (rule 7).
 */

export interface InvestorKey {
  raw: string;
  exact_key: string;
  /** Candidate parent of a fund vehicle ("sequoia capital fund vii" → "sequoia capital"); null when the name has no fund marker. */
  firm_candidate_key: string | null;
  loose_key: string;
  /** Fund number read from the name ("Fund VII" → 7, "Growth VI" → 6), or null. An attribute, not a merge. */
  fund_series: number | null;
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15 };
const LEGAL = new Set(["lp", "llp", "llc", "ltd", "limited", "inc", "incorporated", "corp", "corporation", "gmbh", "sa", "ag", "bv", "plc", "co", "sarl", "kg", "ab", "as", "oy", "pte"]);
/** Generic firm words: dropped for loose_key only. */
const GENERIC = new Set(["capital", "ventures", "venture", "partners", "partner", "vc", "fund", "funds", "management", "investments", "investment", "group", "holdings", "advisors", "advisers", "equity", "the", "and"]);

const fold = (s: string): string =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\bl\s*\.\s*l\s*\.\s*c\b\.?/g, "llc").replace(/\bl\s*\.\s*l\s*\.\s*p\b\.?/g, "llp").replace(/\bl\s*\.\s*p\b\.?/g, "lp")
    .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function investorKey(raw: string): InvestorKey {
  const toks = fold(raw).split(" ").filter(Boolean);
  while (toks.length > 1 && LEGAL.has(toks[toks.length - 1])) toks.pop();      // legal suffixes only
  const exact = toks.join(" ");
  // candidate parent: strip a trailing fund number and a trailing "fund"
  const p = [...toks];
  let series: number | null = null;
  const last = p[p.length - 1];
  if (p.length > 1 && (ROMAN[last] || /^[0-9]{1,2}$/.test(last))) { series = ROMAN[last] ?? Number(last); p.pop(); if (p[p.length - 1] === "fund" && p.length > 1) p.pop(); }
  else if (p.length > 2 && last === "fund") p.pop();
  const parent = p.join(" ");
  const loose = toks.filter((t) => !GENERIC.has(t)).join(" ") || exact;
  return { raw, exact_key: exact, firm_candidate_key: parent !== exact ? parent : null, loose_key: loose, fund_series: series };
}

/** The registrable host of a website, for domain matching ("https://www.indexventures.com/x" → "indexventures.com"). */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const h = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
    return h || null;
  } catch { return null; }
}

/** funding_rounds.lead_investor sometimes holds several names ("A, B; C"). Split on , and ; — but not before a legal suffix ("Bain Capital, LP"). */
export function splitLeadInvestors(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(/\s*[,;](?!\s*(?:l\.?p\.?|llc|l\.l\.c\.|inc\.?|ltd\.?|llp|gmbh|limited)(?:\s|,|;|$))\s*/i).map((x) => x.trim()).filter(Boolean);
}

const ORG_WORDS = new Set(["capital", "ventures", "venture", "partners", "fund", "funds", "group", "holdings", "labs", "lab", "studio", "studios", "management", "investments", "investment", "equity", "growth",
  "technologies", "technology", "tech", "bank", "foundation", "institute", "university", "corp", "inc", "ltd", "llc", "lp", "company", "co", "ai", "vc", "angels", "angel", "network", "collective", "combinator",
  "catalyst", "accelerator", "advisors", "associates", "family", "office", "trust", "society", "innovation", "innovations", "digital", "health", "global", "international", "invest", "syndicate", "seed", "round", "square", "ventures"]);
/** A name that looks like a private person ("Jane Smith"). Only a HINT: firms named after people (Kleiner Perkins, Andreessen Horowitz) match it too, so the script applies it only to rarely-seen names not on Aviv's list. */
export function looksLikePerson(raw: string): boolean {
  const toks = raw.trim().split(/\s+/);
  if (toks.length < 2 || toks.length > 3) return false;
  if (!toks.every((t) => /^\p{Lu}[\p{L}'’.\-]*$/u.test(t))) return false;
  return !toks.some((t) => ORG_WORDS.has(t.toLowerCase().replace(/\./g, "")));
}
/** Angel networks / syndicates are out of scope for now (owner, 2026-11-26). */
export const looksLikeAngelGroup = (raw: string): boolean => /\b(angels?|angel (network|group|investors?)|syndicate|business angels)\b/i.test(raw);

export interface Cluster { loose_key: string; exact_keys: string[] }

/** loose_keys shared by two or more different exact_keys: candidate pairs for a human. Never merged. */
export function ambiguousClusters(keys: Iterable<InvestorKey>): Cluster[] {
  const by = new Map<string, Set<string>>();
  for (const k of keys) { if (!by.has(k.loose_key)) by.set(k.loose_key, new Set()); by.get(k.loose_key)!.add(k.exact_key); }
  return [...by].filter(([, s]) => s.size > 1).map(([loose_key, s]) => ({ loose_key, exact_keys: [...s].sort() })).sort((a, b) => b.exact_keys.length - a.exact_keys.length);
}
