/**
 * lib/enrichment/competitorRelation.ts — a partner, customer, investor or the
 * platform a company runs on is not its competitor (owner's review of the
 * 2026-10-26 run).
 *
 * The run listed "Twist Bioscience partners with Biotia to provide
 * sequencing-based diagnostic solutions" as Biotia's competitor, and Index
 * Exchange as Chalice's while saying "Zillow piloted Chalice's custom AI
 * models embedded within Index Exchange's infrastructure". The model's own
 * explanation says it is not a competitor; this reads that and drops it.
 * Pure; tested with the run's cases.
 */

export type RelationDrop = "competitor_is_partner";

const LEGAL = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|ag|sa|plc|technologies|technology|labs?|ai)\b\.?/gi;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** How a text may name the company: "Chalice Custom Algorithms, Inc." → Chalice Custom Algorithms | Chalice. */
function names(name: string): string[] {
  const full = name.replace(/,?\s*\b(inc|llc|ltd|limited|corp|corporation|gmbh|plc)\b\.?$/i, "").trim();
  const first = full.replace(LEGAL, " ").trim().split(/\s+/)[0] ?? "";
  return [...new Set([full, first].filter((n) => n.length >= 3))];
}

const alt = (list: string[]) => `(?:${list.map(esc).join("|")})(?:'s|’s)?`;

/** null when the explanation describes a competitor; otherwise why it is something else. */
export function competitorRelation(competitorName: string, howItCompetes: string, companyName: string): RelationDrop | null {
  const text = howItCompetes.replace(/\s+/g, " ");
  const co = alt(names(companyName));
  const them = alt(names(competitorName));
  const patterns = [
    // "Twist Bioscience partners with Biotia", "collaborates with Biotia", "a partnership with Biotia"
    new RegExp(`\\b(partner(?:s|ed|ing)?|collaborat\\w*|teamed up|works?|worked) with\\s+(?:\\w+\\s+){0,2}?${co}`, "i"),
    new RegExp(`\\bpartnership (?:with|between)\\s+(?:\\w+\\s+){0,3}?${co}`, "i"),
    // "Biotia partners with Twist", "Biotia's partner Twist"
    new RegExp(`${co}\\s+(?:\\w+\\s+){0,2}?(partner(?:s|ed)?|collaborat\\w*|teamed up) with\\s+(?:\\w+\\s+){0,2}?${them}`, "i"),
    new RegExp(`${co}\\s+(?:strategic |technology |channel )?(partner|customer|client|investor|supplier|vendor|reseller|distributor)\\b`, "i"),
    // "Chalice's custom AI models embedded within Index Exchange's infrastructure"
    new RegExp(`${co}[^.;]{0,80}\\b(embedded|integrated|deployed|hosted|running|runs|available|built) (?:with)?in(?:to|side)?\\s+(?:\\w+\\s+){0,3}?${them}`, "i"),
    new RegExp(`${co}[^.;]{0,80}\\b(runs|built|operates) on\\s+(?:\\w+\\s+){0,3}?${them}`, "i"),
    // "X is a customer / an investor of Biotia", "X invested in Biotia"
    new RegExp(`\\b(is|as) (?:a|an|the) (?:\\w+\\s+)?(customer|client|investor|supplier|vendor|reseller|distributor|parent company|subsidiary) (?:of|to|for|in)\\s+(?:\\w+\\s+){0,2}?${co}`, "i"),
    new RegExp(`\\b(invested|invests|investing) in\\s+(?:\\w+\\s+){0,2}?${co}`, "i"),
  ];
  return patterns.some((re) => re.test(text)) ? "competitor_is_partner" : null;
}
