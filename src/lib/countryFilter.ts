// =============================================================================
// src/lib/countryFilter.ts — the country filter on the Private Market list.
// A country lists the companies with it as their headquarters, as an office,
// or as the country they were founded in (owner, 2026-11-01; Israel since
// 2026-10-29): Port, Aidoc and SSI declare no headquarters but have offices in
// Tel Aviv; HiBob's HQ is London, founded in Tel Aviv.
// =============================================================================

/** A PostgREST or() clause for the country filter on startups_market, or null for no filter. */
export function countryFilterOr(country: string | null | undefined): string | null {
  const v = (country ?? "").trim().replace(/[,()"{}]/g, "");
  if (!v) return null;
  return `country.ilike.${v},founding_country.ilike.${v},office_countries.cs.{"${v}"}`;
}
