/**
 * lib/enrichment/reviewDefinitions.ts — what "correct" means for the fields added to the review (owner, 2026-11-08).
 * Printed at the top of the marking report, so the marker applies one yardstick to every value.
 */
export const DEFINITIONS: Record<string, string> = {
  description: "Correct: it describes what the company does today and for whom. No claim that is not in its sources. Not an old product, not empty marketing copy. The v1 text on file is shown beside it for comparison.",
  sector: "Correct: an investor would look for the company in this category.",
  tags: "Correct: every tag names something the company really does. One wrong tag makes the whole list not correct.",
  employee_history: "Correct: the number, the date and the type match the source, and the source is about this company.",
  competitor_market: "Correct: both companies sell a product in the same category to the same kind of customer.",
  competitor_declared: "Correct: a source says in so many words that they compete, and the sentence is about this company.",
  founder_background: "Correct: the fact (previous company and role, exit, education, military unit) is in the quote, and the quote is about this founder.",
};

export function definitionLines(fields: readonly string[]): string[] {
  return fields.filter((f) => DEFINITIONS[f]).map((f) => `  [${f}] ${DEFINITIONS[f]}`);
}
