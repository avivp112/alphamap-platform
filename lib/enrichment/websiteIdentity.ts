/**
 * lib/enrichment/websiteIdentity.ts — a website that may belong to another company (owner, 2026-11-08, review 6).
 * The row "Nym Health" had the website nymhealth.com; the company that raised $16.5M from GV is at nym.health. The
 * allowed press named its founders (Amihai Neiderman, Adam Rimon); the site's team page named neither and showed a
 * "CEO" nobody else knows. When allowed press outside the site names at least two founders and none of them appears
 * on any page of the site (that was read in full), the site's people are not written: leaders come from a page that
 * is about this company or from none. Pure.
 */
const lastNameOf = (full: string) => full.trim().split(/\s+/).filter((w) => /\p{L}{3,}/u.test(w)).pop()?.toLowerCase() ?? "";

export function websiteLooksLikeAnotherCompany(o: { sitePages: string[]; pressFounders: string[] }): boolean {
  const names = [...new Set(o.pressFounders.map(lastNameOf).filter((n) => n.length >= 4))];
  const text = o.sitePages.join(" ").toLowerCase();
  if (names.length < 2 || text.length < 3000) return false;
  return !names.some((n) => text.includes(n));
}
