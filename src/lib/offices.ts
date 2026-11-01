// =============================================================================
// src/lib/offices.ts — a company's offices, shown when it declares no
// headquarters (owner, 2026-11-01): Port, Aidoc and SSI list offices — "New
// York, Tel Aviv", "Palo Alto, Tel Aviv" — and say nothing of a headquarters.
// =============================================================================

export interface Office { city: string; country?: string | null; source_url?: string | null }

/** "New York, Tel Aviv" — the cities, in the site's order; null when none. */
export function officesLabel(offices: Office[] | null | undefined): string | null {
  const cities = [...new Set((offices ?? []).map((o) => o?.city?.trim()).filter((c): c is string => !!c))];
  return cities.length ? cities.join(", ") : null;
}
