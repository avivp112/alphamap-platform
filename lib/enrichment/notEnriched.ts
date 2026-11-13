/**
 * Why a company was not enriched (owner, 2026-11-13): the report of a batch says how many were turned away and for what — not a technology
 * company, closed or acquired, no website, an identity that is not certain.
 */
export type NotEnrichedWhy = "not_technology" | "public_company" | "closed_or_acquired" | "no_website" | "website_unreadable" | "identity_uncertain" | "technology_undetermined" | "no_data" | "error";

export const NOT_ENRICHED_LABEL: Record<NotEnrichedWhy, string> = {
  not_technology: "not a technology company",
  public_company: "listed on an exchange (archived as ipo)",
  closed_or_acquired: "closed or acquired (the sources say so)",
  no_website: "no website on file",
  website_unreadable: "website unreadable (down, blocked or closed)",
  identity_uncertain: "identity not certain (the site is another company's, or too few results are about this company)",
  technology_undetermined: "technology status could not be determined (to be tried again)",
  no_data: "nothing found",
  error: "failed (API, extraction)",
};

export interface NotEnrichedRow { company: string; website: string; why: NotEnrichedWhy; detail: string }

/** The reason of a collect outcome; `websiteIssue` is what onWebsiteIssue said for this company, when it did. */
export function whyNotEnriched(outcome: string, reason: string | undefined, websiteIssue: "content_mismatch" | "unreadable" | undefined, website: string | null | undefined): NotEnrichedWhy | null {
  if (!website?.trim()) return "no_website";
  switch (outcome) {
    case "collected": case "no_change": return null;
    case "public": return "public_company";
    case "rejected": return /closed|acquired/i.test(reason ?? "") ? "closed_or_acquired" : "not_technology";
    case "low_evidence": if (reason === "technology_undetermined") return "technology_undetermined"; return websiteIssue === "unreadable" ? "website_unreadable" : "identity_uncertain";
    case "no_data": return websiteIssue === "unreadable" ? "website_unreadable" : websiteIssue === "content_mismatch" ? "identity_uncertain" : "no_data";
    case "error": return "error";
    default: return "error";
  }
}

export function notEnrichedReport(rows: NotEnrichedRow[], processed: number): string[] {
  const counts = new Map<NotEnrichedWhy, number>();
  for (const r of rows) counts.set(r.why, (counts.get(r.why) ?? 0) + 1);
  const lines = [`Not enriched: ${rows.length} of ${processed} companies`];
  for (const why of Object.keys(NOT_ENRICHED_LABEL) as NotEnrichedWhy[]) if (counts.get(why)) lines.push(`  ${String(counts.get(why)).padStart(4)}  ${NOT_ENRICHED_LABEL[why]}`);
  return lines;
}
