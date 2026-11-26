/**
 * Other names a company is written under (owner, round 10): news about an alias is news of the company. Conotoxia is a brand of Cinkciarz.pl: the collapse and the
 * licence withdrawals were reported under "Cinkciarz.pl".
 */
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
export const COMPANY_ALIASES: Record<string, string[]> = {
  conotoxia: ["Cinkciarz.pl", "Cinkciarz"],
};
export const aliasesOf = (companyName: string): string[] => COMPANY_ALIASES[fold(companyName)] ?? [];
