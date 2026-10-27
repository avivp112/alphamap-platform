// =============================================================================
// src/lib/competitors.ts — which competitors the profile shows (owner,
// 2026-10-26). A competitor an earlier run wrote without a verified source is
// marked `unverified` (scripts/clean_legacy_market_data.ts) and hidden, not
// deleted, until the next enrichment replaces it with competitors a primary
// source says compete (lib/enrichment/writeCompany.ts drops it then).
// =============================================================================

import type { Competitor } from "./supabase";

export function visibleCompetitors(list: Array<Competitor | string | null | undefined> | null | undefined): Competitor[] {
  return (list ?? [])
    .filter((c): c is Competitor | string => !!c)
    .map((c) => (typeof c === "string" ? { name: c, how_it_competes: "", website: null, startup_id: null } : c))
    .filter((c) => !c.unverified);
}
