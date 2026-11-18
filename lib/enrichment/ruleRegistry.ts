/**
 * lib/enrichment/ruleRegistry.ts — which rule made a value (owner, batch 7): every value of a report that exists because of one particular rule carries that rule's code, so that
 * (1) the precision sample can take the values the newest rules made, and (2) EXCLUDE_RULE=<code> takes every value of a rule out of a run when the rule turns out to be wrong.
 * `added` is the day the rule went in (approximate for the older ones); "recent" is the last seven days.
 */
export interface RuleInfo { code: string; added: string; what: string }

export const RULES: RuleInfo[] = [
  { code: "hq_from_approved_quote", added: "2026-11-17", what: "headquarters read from a quote that was approved for a round (\"<city>-based <company>\")" },
  { code: "hq_from_site_address", added: "2026-11-02", what: "headquarters from the single street address on the company's own site" },
  { code: "founder_from_approved_quote", added: "2026-11-17", what: "founder named in a quote approved for another field" },
  { code: "source_approved_by_round", added: "2026-11-18", what: "a source approved for a round allowed for the profile fields (city, country, founded year, size)" },
  { code: "round_from_news_headline", added: "2026-11-12", what: "round read from an accepted headline (amount, type, date)" },
  { code: "headcount_from_dated_page", added: "2026-11-18", what: "headcount point dated by the page it was read from" },
  { code: "acquired_from_news", added: "2026-11-14", what: "acquisition status read from accepted news" },
  { code: "closed_from_news", added: "2026-11-17", what: "closure status read from accepted news" },
  { code: "tag_classified_from_description", added: "2026-11-14", what: "sub-sector tag classified from the verified description" },
  { code: "competitor_from_own_comparison_page", added: "2026-11-15", what: "competitor named by the company's own \"<company> vs <other>\" page" },
  { code: "register_record", added: "2026-11-16", what: "value from a company register (founding date, legal name, address)" },
  { code: "local_language_search", added: "2026-11-15", what: "value from a source found by a local-language search" },
  { code: "sitemap_page", added: "2026-11-15", what: "value from a page chosen from the company's sitemap" },
];

export const RULE_CODES = new Set(RULES.map((r) => r.code));

/** The codes of the rules added in the last `days` days. */
export function recentRules(today = new Date().toISOString().slice(0, 10), days = 7): Set<string> {
  const from = new Date(Date.parse(today) - days * 86_400_000).toISOString().slice(0, 10);
  return new Set(RULES.filter((r) => r.added >= from).map((r) => r.code));
}

/** A value some rule made: where it shows up in the report (field, and a piece of its text or quote). */
export interface RuleHit { field: string; rule: string; value?: string; quote?: string }

/** The first rule of the hits that made this report line, or "". */
export function ruleOf(line: { field: string; after: unknown; quote?: string | null }, hits: RuleHit[] | undefined): string {
  if (!hits?.length) return "";
  const after = String(line.after ?? "").toLowerCase();
  const quote = String(line.quote ?? "").toLowerCase();
  const fam = (f: string) => (f === "description_what_only" ? "description" : f === "founder_bio" || f === "founder_background" ? "founder" : f);
  const hit = hits.find((h) => fam(h.field) === fam(line.field) && ((h.value && after.includes(h.value.toLowerCase())) || (h.quote && quote.includes(h.quote.toLowerCase().slice(0, 80))) || (!h.value && !h.quote)));
  return hit?.rule ?? "";
}
