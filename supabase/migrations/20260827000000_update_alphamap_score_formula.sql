-- =============================================================================
-- Migration: update_alphamap_score_formula
-- Created:   2026-08-27
-- Description:
--   Replaces calculate_alphamap_score(p_startup_id uuid) with a new, unified
--   5-pillar model, explicitly designed to stop unfairly penalizing early-
--   stage, stealth, and deep-tech companies whose PUBLIC visibility signals
--   (headcount growth, press mentions, recent news) are naturally thin even
--   when the underlying company is exceptional.
--
--   ── What's changing ──────────────────────────────────────────────────────
--   The previous model (20260719000300_dual_track_scoring.sql) used 3
--   pillars (capital_efficiency, talent_velocity, ecosystem_signal) and
--   switched pillar WEIGHTS based on classify_company_archetype() (a
--   'venture_backed' vs 'mature_private' split). That dual-track weighting
--   is removed here — every company is now scored on the same 5 pillars
--   with the same weights. classify_company_archetype() itself is left
--   completely untouched: it's still called here purely to surface
--   `archetype`/`archetype_reasons` as informational context in the output
--   (the frontend badge that reads it keeps working unchanged), but it no
--   longer changes how anything is weighted. Crucially, PrivateEquity.tsx's
--   portfolio split ALSO calls classify_company_archetype() directly and
--   independently of this function — since that function's signature and
--   behavior are unchanged, the PE page is unaffected by anything below.
--
--   1. Investor Quality (25%) — the BEST (highest) tier among every investor
--      matched across ALL of the startup's funding rounds (not just the
--      latest), via the existing investors.tier classification (1=top,
--      2=mid, 3=long-tail; see 20260701000001_investors_tier.sql). Tier 1 →
--      100, Tier 2 → 70, Tier 3 → 40. Investors named but none matched our
--      tier table → 25 (unranked, not zero — we know real money is in, we
--      just haven't classified the fund). No investor names on file at
--      all → pillar INVALID (weight redistributed), not zero — this is a
--      "we don't know" gap, not evidence of poor investor quality.
--
--   2. Founder & Team Quality (25%) — cumulative, capped-at-100 bonuses,
--      true if ANY person across founders[] + leadership[] carries the
--      flag: prior founder exit +40, elite technical/military background
--      (e.g. an elite intelligence/tech unit, top R&D lab) +35, a notable
--      pedigree (a key role at a unicorn, or an elite university degree)
--      +25. Requires new founders[]/leadership[] JSONB keys — see
--      src/lib/supabase.ts Founder/Leader — populated by
--      scripts/bulk_enrich_all.ts going forward; historical rows simply
--      have these keys absent, which reads as false, not a penalty by
--      itself. Invalid only when a company has literally no founders or
--      leadership on file (never researched), not when people are known
--      but nothing notable was found about them (that's a real, valid 0).
--
--   3. Growth Velocity (20%) — % headcount change between the most recent
--      headcount_history snapshot and the closest available snapshot at
--      least 150 days earlier (targeting the spec's 6-12 month window).
--      0% change → 50, +50% or more → 100 (capped), -50% or more → 0
--      (floored). INVALID — not zero — when a company doesn't yet have
--      that much headcount history on file; a brand-new/stealth company
--      with no growth curve yet should never be scored as if it were
--      shrinking.
--
--   4. Recency & Activity (15%) — days since the most recent of: a funding
--      round announcement, a leadership hire (leadership[].joined_date,
--      when known), or a news article (news[].published_date). Full
--      credit (100) through 90 days, linear decay to 0 across 90-180 days,
--      0 beyond 180. INVALID only when nothing dated is on file at all —
--      an under-researched company isn't assumed to be stale.
--
--   5. Media Coverage & Mentions (15%) — count of news[] articles with a
--      published_date in the trailing 90 days, scaled so 4+ recent
--      articles caps the pillar at 100. Always VALID: zero recent press is
--      itself a real, meaningful (if unflattering) answer — exactly what
--      you'd expect from a genuinely stealth company — not a data gap. It
--      only carries 15% of the total, and the safety floor below exists
--      precisely to stop that from unfairly sinking a strong company.
--
--   ── Safety floor (stealth / deep-tech protection) ───────────────────────
--   If Investor Quality >= 85 AND Founder & Team Quality >= 85, the final
--   score cannot fall below 70 (Tier B) — applied as the LAST step, after
--   pillar weighting and the sector macro adjustment, so nothing (weak
--   growth, zero press, a sector headwind) can drag a company with
--   excellent backing and an excellent team below a B. This is the core
--   fix for stealth/deep-tech companies: real institutional conviction and
--   real team pedigree are treated as sufficient evidence of quality on
--   their own, even when the company has (by design, in the stealth case)
--   almost no public footprint yet.
--
--   ── What's intentionally UNCHANGED ───────────────────────────────────────
--   - tier derivation (score >= 85 → A, >= 70 → B, else C) and the overall
--     output envelope (score/tier/confidence/base_score/macro_adj_pct/
--     sector_id/pillars) — so the existing frontend components
--     (ScoreRing, TIER_CONFIG, the macro-adjustment footer) keep working
--     without modification; only the `pillars` object's keys and each
--     pillar's `detail` shape change.
--   - the sector-momentum macro adjustment (macro_sector_multiples,
--     ±30% clamp) — orthogonal to the pillar rework, left exactly as-is.
--   - classify_company_archetype() itself — not modified, still used
--     elsewhere (PrivateEquity.tsx's portfolio split).
--   - confidence is now driven by how many of the 5 pillars are valid:
--     5 → high, 3-4 → medium, 1-2 → low, 0 → none (was 3/2/other over 3
--     pillars before).
--
--   Old input columns this function no longer reads (previous_employee_
--   count, is_serial_founder, has_follow_on_investors, investor_tier_score,
--   employee_count, growth_trend, acquisitions) are left in place —
--   dropping columns is out of scope for a scoring-logic change and other
--   code may still reference them.
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_alphamap_score(p_startup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_industry             text;
  v_sector_id            text;
  v_founders             jsonb;
  v_leadership           jsonb;
  v_news                 jsonb;

  v_arch                 jsonb;
  v_archetype            text;

  -- Pillar 1: Investor Quality
  v_n_investors          integer := 0;
  v_n_matched            integer := 0;
  v_best_tier            integer;
  v_investor_source      text;
  v_p1_score             numeric;
  v_p1_valid             boolean := false;

  -- Pillar 2: Founder & Team Quality
  v_any_exit             boolean := false;
  v_any_elite            boolean := false;
  v_any_pedigree         boolean := false;
  v_n_people             integer := 0;
  v_p2_score             numeric;
  v_p2_valid             boolean := false;

  -- Pillar 3: Growth Velocity
  v_latest_hc            integer;
  v_latest_hc_date       date;
  v_earliest_hc          integer;
  v_earliest_hc_date     date;
  v_growth_pct           numeric;
  v_p3_score             numeric;
  v_p3_valid             boolean := false;

  -- Pillar 4: Recency & Activity
  v_last_round_date      date;
  v_last_hire_date       date;
  v_last_news_date       date;
  v_most_recent_date     date;
  v_most_recent_signal   text;
  v_days_since           integer;
  v_p4_score             numeric;
  v_p4_valid             boolean := false;

  -- Pillar 5: Media Coverage & Mentions
  v_n_recent_news        integer := 0;
  v_p5_score             numeric;

  -- Weights (fixed — no more archetype-dependent dual track)
  v_w1 numeric := 0.25;  -- Investor Quality
  v_w2 numeric := 0.25;  -- Founder & Team Quality
  v_w3 numeric := 0.20;  -- Growth Velocity
  v_w4 numeric := 0.15;  -- Recency & Activity
  v_w5 numeric := 0.15;  -- Media Coverage & Mentions
  v_total_w              numeric;

  v_base_score           numeric;
  v_final_score          numeric;
  v_pillar_count         integer;
  v_safety_floor_applied boolean := false;

  v_cur_mult             numeric;
  v_hist_mult            numeric;
  v_macro_adj            numeric := 0.0;
BEGIN

  -- ── 1. Load startup row ─────────────────────────────────────────────────────
  SELECT s.industry, s.sector_id, s.founders, s.leadership, s.news
  INTO   v_industry, v_sector_id, v_founders, v_leadership, v_news
  FROM startups s
  WHERE s.id = p_startup_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'startup_not_found');
  END IF;

  -- Archetype: informational only now — does not change weights or pillar
  -- semantics. classify_company_archetype() itself is untouched.
  v_arch      := classify_company_archetype(p_startup_id);
  v_archetype := COALESCE(v_arch->>'archetype', 'venture_backed');

  -- ══════════════════════════════════════════════════════════════════════════
  -- PILLAR 1: Investor Quality (25%)
  -- ══════════════════════════════════════════════════════════════════════════
  WITH investor_names AS (
    SELECT DISTINCT lower(trim(t.nm)) AS nm
    FROM funding_rounds fr,
         LATERAL unnest(
           COALESCE(fr.investors, '{}'::text[]) ||
           CASE WHEN fr.lead_investor IS NOT NULL THEN ARRAY[fr.lead_investor] ELSE '{}'::text[] END
         ) AS t(nm)
    WHERE fr.startup_id = p_startup_id
      AND t.nm IS NOT NULL AND trim(t.nm) <> ''
  ),
  matched AS (
    SELECT inv.tier FROM investor_names n
    JOIN investors inv ON lower(trim(inv.name)) = n.nm
  )
  SELECT
    (SELECT COUNT(*) FROM investor_names)::integer,
    (SELECT COUNT(*) FROM matched)::integer,
    (SELECT MIN(tier) FROM matched)
  INTO v_n_investors, v_n_matched, v_best_tier;

  IF v_n_investors = 0 THEN
    v_p1_valid := false;
  ELSE
    v_p1_score := CASE
      WHEN v_best_tier = 1 THEN 100.0
      WHEN v_best_tier = 2 THEN 70.0
      WHEN v_best_tier = 3 THEN 40.0
      ELSE 25.0
    END;
    v_investor_source := CASE WHEN v_best_tier IS NOT NULL THEN 'tier_match' ELSE 'unranked' END;
    v_p1_valid := true;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- PILLAR 2: Founder & Team Quality (25%)
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT
    COUNT(*)::integer,
    bool_or(COALESCE((elem->>'had_prior_exit')::boolean, false)),
    bool_or(COALESCE((elem->>'elite_background')::boolean, false)),
    bool_or(COALESCE((elem->>'notable_pedigree')::boolean, false))
  INTO v_n_people, v_any_exit, v_any_elite, v_any_pedigree
  FROM jsonb_array_elements(
    COALESCE(v_founders, '[]'::jsonb) || COALESCE(v_leadership, '[]'::jsonb)
  ) AS elem;

  IF v_n_people = 0 THEN
    v_p2_valid := false;
  ELSE
    v_p2_score := LEAST(100.0,
        (v_any_exit::int     * 40.0)
      + (v_any_elite::int    * 35.0)
      + (v_any_pedigree::int * 25.0)
    );
    v_p2_valid := true;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- PILLAR 3: Growth Velocity (20%)
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT employee_count, recorded_date::date
  INTO   v_latest_hc, v_latest_hc_date
  FROM headcount_history
  WHERE startup_id = p_startup_id
  ORDER BY recorded_date DESC
  LIMIT 1;

  IF v_latest_hc_date IS NOT NULL THEN
    SELECT employee_count, recorded_date::date
    INTO   v_earliest_hc, v_earliest_hc_date
    FROM headcount_history
    WHERE startup_id = p_startup_id
      AND recorded_date::date <= v_latest_hc_date - INTERVAL '150 days'
      AND recorded_date::date >= v_latest_hc_date - INTERVAL '395 days'
    ORDER BY recorded_date ASC
    LIMIT 1;
  END IF;

  IF v_earliest_hc IS NOT NULL AND v_earliest_hc > 0 THEN
    v_growth_pct := (v_latest_hc - v_earliest_hc)::numeric / v_earliest_hc::numeric;
    v_p3_score   := LEAST(100.0, GREATEST(0.0, 50.0 + v_growth_pct * 100.0));
    v_p3_valid   := true;
  ELSE
    v_p3_valid := false;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- PILLAR 4: Recency & Activity (15%)
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT MAX(fr.announcement_date) INTO v_last_round_date
  FROM funding_rounds fr WHERE fr.startup_id = p_startup_id;

  SELECT MAX((elem->>'joined_date')::date) INTO v_last_hire_date
  FROM jsonb_array_elements(COALESCE(v_leadership, '[]'::jsonb)) AS elem
  WHERE elem->>'joined_date' IS NOT NULL;

  SELECT MAX((elem->>'published_date')::date) INTO v_last_news_date
  FROM jsonb_array_elements(COALESCE(v_news, '[]'::jsonb)) AS elem
  WHERE elem->>'published_date' IS NOT NULL;

  v_most_recent_date := GREATEST(v_last_round_date, v_last_hire_date, v_last_news_date);
  v_most_recent_signal := CASE
    WHEN v_most_recent_date IS NULL THEN NULL
    WHEN v_most_recent_date = v_last_round_date THEN 'funding_round'
    WHEN v_most_recent_date = v_last_hire_date  THEN 'leadership_hire'
    ELSE 'news'
  END;

  IF v_most_recent_date IS NULL THEN
    v_p4_valid := false;
  ELSE
    v_days_since := (CURRENT_DATE - v_most_recent_date);
    v_p4_score := CASE
      WHEN v_days_since <= 90  THEN 100.0
      WHEN v_days_since >= 180 THEN 0.0
      ELSE 100.0 - ((v_days_since - 90)::numeric / 90.0) * 100.0
    END;
    v_p4_valid := true;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- PILLAR 5: Media Coverage & Mentions (15%) — always valid, see header note
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT COUNT(*)::integer INTO v_n_recent_news
  FROM jsonb_array_elements(COALESCE(v_news, '[]'::jsonb)) AS elem
  WHERE (elem->>'published_date') IS NOT NULL
    AND (elem->>'published_date')::date >= CURRENT_DATE - INTERVAL '90 days';

  v_p5_score := LEAST(100.0, v_n_recent_news * 25.0);

  -- ══════════════════════════════════════════════════════════════════════════
  -- Weighted base score — redistribute weight away from invalid pillars
  -- ══════════════════════════════════════════════════════════════════════════
  IF NOT v_p1_valid THEN v_w1 := 0.0; END IF;
  IF NOT v_p2_valid THEN v_w2 := 0.0; END IF;
  IF NOT v_p3_valid THEN v_w3 := 0.0; END IF;
  IF NOT v_p4_valid THEN v_w4 := 0.0; END IF;
  -- v_w5 always kept — Pillar 5 is always valid.

  v_total_w := v_w1 + v_w2 + v_w3 + v_w4 + v_w5;

  IF v_total_w = 0.0 THEN
    RETURN jsonb_build_object('score', NULL, 'tier', NULL, 'confidence', 'none', 'reason', 'no_scored_pillars');
  END IF;

  v_w1 := v_w1 / v_total_w;  v_w2 := v_w2 / v_total_w;  v_w3 := v_w3 / v_total_w;
  v_w4 := v_w4 / v_total_w;  v_w5 := v_w5 / v_total_w;

  v_base_score :=
      COALESCE(v_p1_score, 0.0) * v_w1
    + COALESCE(v_p2_score, 0.0) * v_w2
    + COALESCE(v_p3_score, 0.0) * v_w3
    + COALESCE(v_p4_score, 0.0) * v_w4
    + v_p5_score                * v_w5;

  -- ── Sector keyword fallback + macro sector-momentum adjustment ─────────────
  -- Unchanged from the previous model — orthogonal to the pillar rework.
  IF v_sector_id IS NULL AND v_industry IS NOT NULL THEN
    v_sector_id := CASE
      WHEN lower(v_industry) ~ '\y(ai|ml|llm|nlp)\y' OR lower(v_industry) SIMILAR TO '%(machine learn%|artificial intel%|generative|deep learn%)%' THEN 'ai-ml'
      WHEN lower(v_industry) SIMILAR TO '%(fintech|payment|neobank|crypto|web3|insurtech|wealthtech|lending|defi)%' THEN 'fintech'
      WHEN lower(v_industry) SIMILAR TO '%(cyber|zero trust|endpoint sec%|cloud sec%|identity|iam)%' THEN 'cybersecurity'
      WHEN lower(v_industry) SIMILAR TO '%(saas|dev tool%|devops|api platform|no-code|low-code|data infra%)%' THEN 'saas-devtools'
      WHEN lower(v_industry) SIMILAR TO '%(e-commerce|ecommerce|marketplace|logistics|retail tech)%' THEN 'ecommerce-retail'
      WHEN lower(v_industry) SIMILAR TO '%(health|medical|biotech|genomic|mental health)%' THEN 'health-lifesci'
      WHEN lower(v_industry) SIMILAR TO '%(clean tech|cleantech|energy|renewable|carbon|climate|sustain%)%' THEN 'climate-energy'
      WHEN lower(v_industry) SIMILAR TO '%(enterprise|crm|erp|hr tech|analytics|business intel%)%' THEN 'enterprise-sw'
      WHEN lower(v_industry) SIMILAR TO '%(gaming|social media|edtech|travel|media|consumer)%' THEN 'consumer-media'
      WHEN lower(v_industry) SIMILAR TO '%(quantum|robotics|space tech|semiconductor|deeptech|deep tech)%' THEN 'deeptech'
      ELSE NULL
    END;
  END IF;

  IF v_sector_id IS NOT NULL THEN
    SELECT msm.current_multiple, msm.historical_multiple
    INTO   v_cur_mult, v_hist_mult
    FROM   macro_sector_multiples msm
    WHERE  msm.sector_id = v_sector_id
    ORDER  BY msm.effective_date DESC LIMIT 1;

    IF v_cur_mult IS NOT NULL AND v_hist_mult IS NOT NULL THEN
      v_macro_adj := (v_cur_mult / NULLIF(v_hist_mult, 0.0)) - 1.0;
      v_macro_adj := GREATEST(-0.30, LEAST(0.30, v_macro_adj));
    END IF;
  END IF;

  v_final_score := LEAST(100.0, GREATEST(1.0, ROUND((v_base_score * (1.0 + v_macro_adj))::numeric, 1)));

  -- ══════════════════════════════════════════════════════════════════════════
  -- Safety floor (stealth / deep-tech protection) — applied LAST, after
  -- pillar weighting and the macro adjustment, so nothing can undercut it.
  -- ══════════════════════════════════════════════════════════════════════════
  IF v_p1_valid AND v_p2_valid AND v_p1_score >= 85.0 AND v_p2_score >= 85.0 AND v_final_score < 70.0 THEN
    v_safety_floor_applied := true;
    v_final_score := 70.0;
  END IF;

  v_pillar_count := v_p1_valid::int + v_p2_valid::int + v_p3_valid::int + v_p4_valid::int + 1; -- pillar 5 always valid

  RETURN jsonb_build_object(
    'score',                v_final_score,
    'tier',                 CASE WHEN v_final_score >= 85 THEN 'A' WHEN v_final_score >= 70 THEN 'B' ELSE 'C' END,
    'confidence',           CASE
                               WHEN v_pillar_count = 5 THEN 'high'
                               WHEN v_pillar_count >= 3 THEN 'medium'
                               WHEN v_pillar_count >= 1 THEN 'low'
                               ELSE 'none'
                             END,
    'archetype',            v_archetype,
    'archetype_reasons',    COALESCE(v_arch->'reasons', '[]'::jsonb),
    'base_score',           ROUND(v_base_score::numeric, 1),
    'macro_adj_pct',        ROUND((v_macro_adj * 100.0)::numeric, 1),
    'sector_id',            COALESCE(v_sector_id, 'unknown'),
    'safety_floor_applied', v_safety_floor_applied,
    'pillars', jsonb_build_object(
      'investor_quality', jsonb_build_object(
        'label',  'Investor Quality', 'weight', ROUND((v_w1 * 100)::numeric, 0),
        'score',  CASE WHEN v_p1_valid THEN ROUND(v_p1_score::numeric, 1) ELSE NULL END, 'valid', v_p1_valid,
        'detail', jsonb_build_object(
          'best_tier',   v_best_tier,
          'n_investors', v_n_investors,
          'n_matched',   v_n_matched,
          'source',      v_investor_source
        )
      ),
      'team_quality', jsonb_build_object(
        'label',  'Founder & Team Quality', 'weight', ROUND((v_w2 * 100)::numeric, 0),
        'score',  CASE WHEN v_p2_valid THEN ROUND(v_p2_score::numeric, 1) ELSE NULL END, 'valid', v_p2_valid,
        'detail', jsonb_build_object(
          'prior_exit',       v_any_exit,
          'elite_background', v_any_elite,
          'notable_pedigree', v_any_pedigree,
          'n_people',         v_n_people
        )
      ),
      'growth_velocity', jsonb_build_object(
        'label',  'Growth Velocity', 'weight', ROUND((v_w3 * 100)::numeric, 0),
        'score',  CASE WHEN v_p3_valid THEN ROUND(v_p3_score::numeric, 1) ELSE NULL END, 'valid', v_p3_valid,
        'detail', jsonb_build_object(
          'growth_pct',    ROUND(COALESCE(v_growth_pct, 0)::numeric * 100.0, 1),
          'earliest_date', v_earliest_hc_date,
          'latest_date',   v_latest_hc_date
        )
      ),
      'recency_activity', jsonb_build_object(
        'label',  'Recency & Activity', 'weight', ROUND((v_w4 * 100)::numeric, 0),
        'score',  CASE WHEN v_p4_valid THEN ROUND(v_p4_score::numeric, 1) ELSE NULL END, 'valid', v_p4_valid,
        'detail', jsonb_build_object(
          'days_since',       v_days_since,
          'signal',           v_most_recent_signal,
          'most_recent_date', v_most_recent_date
        )
      ),
      'media_coverage', jsonb_build_object(
        'label',  'Media Coverage & Mentions', 'weight', ROUND((v_w5 * 100)::numeric, 0),
        'score',  ROUND(v_p5_score::numeric, 1), 'valid', true,
        'detail', jsonb_build_object(
          'n_recent_articles', v_n_recent_news,
          'window_days',       90
        )
      )
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_alphamap_score(uuid) TO anon, authenticated;
