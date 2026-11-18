// =============================================================================
// src/lib/companyLink.ts — the shareable address of a company: /company/<name>-<id>.
//
// The name is only there so the link reads well in a message; the id at the end is
// what is looked up. A company is found by its full UUID because a database cannot
// search by the start of one. /company/... redirects to /startups?company=<id>, so a
// shared link and a click inside the app end up on the same page and the same state.
// =============================================================================

const UUID_AT_END = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** "Ibex Medical Analytics, Inc." -> "ibex-medical-analytics-inc". Empty when nothing usable is left. */
export function slugifyName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")          // São -> Sao
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** The path part of a company's shareable address. */
export function companyPermalinkPath(name: string, id: string): string {
  const slug = slugifyName(name);
  return `/company/${slug ? `${slug}-` : ""}${id}`;
}

/** The company id out of a /company/:slug parameter, or null if it does not end in one. */
export function parseCompanySlug(slug: string | undefined | null): string | null {
  if (!slug) return null;
  const m = UUID_AT_END.exec(slug.trim());
  return m ? m[1].toLowerCase() : null;
}
