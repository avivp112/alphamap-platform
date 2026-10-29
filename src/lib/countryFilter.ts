// =============================================================================
// src/lib/countryFilter.ts — the country filter on the Private Market list
// (owner, 2026-10-29). "Israel" also lists companies FOUNDED in Israel whose
// headquarters is elsewhere (Port, HiBob, Aidoc, Oligo — HQ New York or
// London, founded in Tel Aviv), not only those with an Israeli HQ. Other
// countries filter on the headquarters only.
// =============================================================================

/** Countries whose filter also matches the founding country. */
const BY_ORIGIN_TOO = new Set(["israel"]);

/** A PostgREST or() clause for the country filter, or null to filter on the HQ country alone. */
export function countryFilterOr(country: string | null | undefined): string | null {
  const c = (country ?? "").trim();
  if (!BY_ORIGIN_TOO.has(c.toLowerCase())) return null;
  const v = c.replace(/[,()]/g, "");
  return `country.ilike.${v},founding_country.ilike.${v}`;
}
