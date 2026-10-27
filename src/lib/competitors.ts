// =============================================================================
// src/lib/competitors.ts — the competitors the profile lists (owner,
// 2026-10-27). One an earlier run wrote without a verified source is marked
// `unverified` (scripts/clean_legacy_market_data.ts): still shown, with an
// "Unverified" label and muted, so a reader sees it is low confidence. After
// v2 passes Phase 1, a verification run gives each one a source or hides it
// (`hidden`).
// =============================================================================

import type { Competitor } from "./supabase";

export function visibleCompetitors(list: Array<Competitor | string | null | undefined> | null | undefined): Competitor[] {
  return (list ?? [])
    .filter((c): c is Competitor | string => !!c)
    .map((c) => (typeof c === "string" ? { name: c, how_it_competes: "", website: null, startup_id: null } : c))
    .filter((c) => !c.hidden);
}
