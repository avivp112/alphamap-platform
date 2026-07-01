-- calculate_alphamap_score(p_startup_id uuid) → jsonb  [v2 — fixes broken pillars]
--
-- Bug fixed: Capital Efficiency and Ecosystem Signal were returning "—/0%"
-- for nearly every startup.
--
--   Capital Efficiency required TWO valued funding rounds (latest + prior)
--   before it would compute anything — startups with a single round (the
--   overwhelming majority) always fell through to `valid = false`, zeroing
--   the pillar's weight. Now uses a 5-tier fallback chain (see below) so it
--   always produces a real score.
--
--   Ecosystem Signal depended entirely on `startups.investor_tier_score`, a
--   column nothing in the ingestion pipeline ever wrote to. It now derives
--   quality directly from WHICH investors backed the round
--   (funding_rounds.lead_investor / funding_rounds.investors[]), joined
--   against the new `investors.tier` column (see
--   20260701000001_investors_tier.sql). A manual override on
--   startups.investor_tier_score, if ever set, still takes priority.
--
-- Debugging: RAISE NOTICE lines trace every intermediate value (funding
-- amounts, valuations, investor match counts, per-pillar scores) so a
-- `supabase functions logs` / Postgres log tail shows exactly which inputs
-- were null for a given startup_id.
--
-- NULL Graceful Degradation is preserved as a structural safety net, but in
-- practice all three pillars now resolve to a numeric score (with baseline
-- fallbacks) rather than ever reporting `valid = false` for missing data —
-- per the fix request, sparse data should degrade to a neutral estimate,
-- not a broken "0%" pillar.

CREATE OR REPLACE FUNCTION calculate_alphamap_score(p_startup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── Startup fields ──────────────────────────────────────────────────────────
  v_industry                text;
  v_employee_count          integer;
  v_prev_employee_count     integer;
  v_is_serial_founder       boolean;
  v_has_follow_on           boolean;
  v_investor_tier_score     numeric;   -- manual override, if ever set
  v_sector_id               text;

  -- ── Funding rounds ────────────────────────────────────────────────────────────
  v_latest_valuation        numeric;
  v_latest_amount           numeric;
  v_prev_valuation          numeric;
  v_total_raised            numeric;   -- cumulative amount_raised across ALL rounds

  -- ── Pillar A intermediates ───────────────────────────────────────────────────
  v_value_creation          numeric;
  v_headcount_added         numeric;
  v_burn_proxy              numeric;
  v_vc_norm                 numeric;
  v_burn_norm               numeric;
  v_capital_tier            text;      -- which fallback tier Pillar A resolved via

  -- ── Pillar B intermediates ───────────────────────────────────────────────────
  v_hc_growth_pct           numeric;

  -- ── Pillar C intermediates (Ecosystem Signal / investor join) ────────────────
  v_n_investors             integer := 0;   -- distinct named investors on any round
  v_n_matched                integer := 0;  -- of those, matched to investors.tier
  v_n_tier1                  integer := 0;
  v_n_tier2                  integer := 0;
  v_n_tier3                  integer := 0;
  v_ecosystem_source         text;          -- 'manual_override' | 'investor_join' | 'baseline_no_data'

  -- ── Pillar scores (0-100) ────────────────────────────────────────────────────
  v_pillar_a                numeric;
  v_pillar_b                numeric;
  v_pillar_c                numeric;
  v_a_valid                 boolean := false;
  v_b_valid                 boolean := false;
  v_c_valid                 boolean := false;

  -- ── Weights (mutable; re-distributed when a pillar is invalid) ───────────────
  v_wa                      numeric := 0.45;
  v_wb                      numeric := 0.35;
  v_wc                      numeric := 0.20;
  v_total_w                 numeric;

  -- ── Macro adjustment ─────────────────────────────────────────────────────────
  v_cur_mult                numeric;
  v_hist_mult               numeric;
  v_macro_adj               numeric := 0.0;

  -- ── Outputs ──────────────────────────────────────────────────────────────────
  v_base_score              numeric;
  v_final_score             numeric;
  v_pillar_count            integer;
BEGIN

  -- ── 1. Load startup row ──────────────────────────────────────────────────────
  SELECT
    s.industry,
    COALESCE(s.employee_count,          0),
    COALESCE(s.previous_employee_count, 0),
    COALESCE(s.is_serial_founder,       false),
    COALESCE(s.has_follow_on_investors, false),
    s.investor_tier_score,
    s.sector_id
  INTO
    v_industry,
    v_employee_count,
    v_prev_employee_count,
    v_is_serial_founder,
    v_has_follow_on,
    v_investor_tier_score,
    v_sector_id
  FROM startups s
  WHERE s.id = p_startup_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'startup_not_found');
  END IF;

  RAISE NOTICE 'AlphaMapEngine[%]: employee_count=% prev_employee_count=% sector_id=% investor_tier_score(manual)=%',
    p_startup_id, v_employee_count, v_prev_employee_count, v_sector_id, v_investor_tier_score;

  -- ── 2. Load latest two funding rounds, ordered by date then created_at ────────
  WITH ranked AS (
    SELECT
      fr.valuation,
      fr.amount_raised,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(fr.announcement_date, '1970-01-01'::date) DESC,
                 fr.created_at DESC
      ) AS rn
    FROM funding_rounds fr
    WHERE fr.startup_id = p_startup_id
      AND fr.amount_raised IS NOT NULL
      AND fr.amount_raised > 0
  )
  SELECT
    MAX(CASE WHEN rn = 1 THEN valuation    END),
    MAX(CASE WHEN rn = 1 THEN amount_raised END),
    MAX(CASE WHEN rn = 2 THEN valuation    END)
  INTO v_latest_valuation, v_latest_amount, v_prev_valuation
  FROM ranked
  WHERE rn <= 2;

  -- Cumulative capital raised across every round on file (the "total_raised"
  -- the fix request refers to — there's no such column on startups, so we
  -- derive it from the funding_rounds ledger).
  SELECT COALESCE(SUM(fr.amount_raised), 0)
  INTO   v_total_raised
  FROM   funding_rounds fr
  WHERE  fr.startup_id = p_startup_id
    AND  fr.amount_raised IS NOT NULL
    AND  fr.amount_raised > 0;

  -- Some rounds carry a valuation without a disclosed amount_raised (e.g. an
  -- acquisition or an estimated mark) — fall back to the most recent
  -- valuation on ANY round if the amount-filtered query above found none.
  IF v_latest_valuation IS NULL THEN
    SELECT fr.valuation
    INTO   v_latest_valuation
    FROM   funding_rounds fr
    WHERE  fr.startup_id = p_startup_id
      AND  fr.valuation IS NOT NULL
    ORDER  BY COALESCE(fr.announcement_date, '1970-01-01'::date) DESC,
              fr.created_at DESC
    LIMIT  1;
  END IF;

  RAISE NOTICE 'AlphaMapEngine[%]: latest_valuation=% prev_valuation=% latest_amount=% total_raised=%',
    p_startup_id, v_latest_valuation, v_prev_valuation, v_latest_amount, v_total_raised;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- PILLAR A: Capital Efficiency  (default weight 45 %)
  --
  -- Fallback chain (best signal → neutral baseline), so a startup is never
  -- penalized to "—/0%" purely for having sparse funding data:
  --   1. value_creation_delta      — two valued rounds on file (best signal)
  --   2. valuation_over_total_raised — one valuation + cumulative capital raised
  --   3. valuation_only            — a valuation exists but total_raised is null
  --   4. burn_only                 — total_raised exists but no valuation at all
  --   5. baseline_no_data          — neither raised amount nor valuation on file
  -- ══════════════════════════════════════════════════════════════════════════════
  IF v_latest_valuation IS NOT NULL
     AND v_prev_valuation  IS NOT NULL
     AND v_latest_amount   IS NOT NULL
  THEN
    -- Tier 1: true value-creation delta between two valued rounds
    v_value_creation := (v_latest_valuation - v_prev_valuation) / NULLIF(v_latest_amount, 0);
    v_vc_norm := LEAST(100.0, GREATEST(0.0, COALESCE(v_value_creation, 0.0) / 5.0 * 100.0));

    v_headcount_added := NULLIF(v_employee_count - v_prev_employee_count, 0);
    v_burn_proxy      := v_latest_amount / NULLIF(v_headcount_added, 0);
    v_burn_norm := CASE
      WHEN v_burn_proxy IS NULL OR v_burn_proxy <= 0 THEN 50.0
      ELSE LEAST(100.0, GREATEST(0.0, 100.0 - (LEAST(v_burn_proxy, 500000.0) / 500000.0) * 100.0))
    END;

    v_pillar_a     := ROUND((v_vc_norm * 0.6 + v_burn_norm * 0.4)::numeric, 1);
    v_capital_tier := 'value_creation_delta';
    v_a_valid      := true;

  ELSIF v_total_raised > 0 AND v_latest_valuation IS NOT NULL THEN
    -- Tier 2: valuation ÷ cumulative capital raised (no prior round needed)
    v_value_creation := v_latest_valuation / NULLIF(v_total_raised, 0);
    v_vc_norm := LEAST(100.0, GREATEST(0.0, COALESCE(v_value_creation, 0.0) / 5.0 * 100.0));

    v_headcount_added := NULLIF(v_employee_count - v_prev_employee_count, 0);
    v_burn_proxy      := v_total_raised / NULLIF(v_headcount_added, 0);
    v_burn_norm := CASE
      WHEN v_burn_proxy IS NULL OR v_burn_proxy <= 0 THEN 50.0
      ELSE LEAST(100.0, GREATEST(0.0, 100.0 - (LEAST(v_burn_proxy, 500000.0) / 500000.0) * 100.0))
    END;

    v_pillar_a     := ROUND((v_vc_norm * 0.6 + v_burn_norm * 0.4)::numeric, 1);
    v_capital_tier := 'valuation_over_total_raised';
    v_a_valid      := true;

  ELSIF v_total_raised = 0 AND v_latest_valuation IS NOT NULL THEN
    -- Tier 3: total_raised is unknown, but a valuation is on file — use it
    -- alone as a coarse capital-efficiency proxy (bucketed by scale).
    v_pillar_a := CASE
      WHEN v_latest_valuation >= 1000000000 THEN 90.0
      WHEN v_latest_valuation >= 200000000  THEN 75.0
      WHEN v_latest_valuation >= 50000000   THEN 60.0
      WHEN v_latest_valuation >= 10000000   THEN 45.0
      ELSE 30.0
    END;
    v_capital_tier := 'valuation_only';
    v_a_valid      := true;

  ELSIF v_total_raised > 0 THEN
    -- Tier 4: no valuation anywhere, but capital raised is known — burn-only
    v_headcount_added := NULLIF(v_employee_count - v_prev_employee_count, 0);
    v_burn_proxy := v_total_raised / NULLIF(COALESCE(v_headcount_added, NULLIF(v_employee_count, 0)), 0);
    v_pillar_a := CASE
      WHEN v_burn_proxy IS NULL OR v_burn_proxy <= 0 THEN 50.0
      ELSE LEAST(100.0, GREATEST(0.0, 100.0 - (LEAST(v_burn_proxy, 500000.0) / 500000.0) * 100.0))
    END;
    v_capital_tier := 'burn_only';
    v_a_valid      := true;

  ELSE
    -- Tier 5: neither a valuation nor a funding amount exists anywhere on
    -- file — neutral baseline rather than collapsing the pillar entirely.
    v_pillar_a     := 50.0;
    v_capital_tier := 'baseline_no_data';
    v_a_valid      := true;
  END IF;

  RAISE NOTICE 'AlphaMapEngine[%]: Pillar A (Capital Efficiency) tier=% score=%',
    p_startup_id, v_capital_tier, v_pillar_a;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- PILLAR B: Talent Velocity  (default weight 35 %) — unchanged, already working
  -- ══════════════════════════════════════════════════════════════════════════════
  IF v_employee_count > 0 AND v_prev_employee_count > 0 THEN
    v_hc_growth_pct := (v_employee_count - v_prev_employee_count)::numeric
                       / NULLIF(v_prev_employee_count::numeric, 0);
    v_pillar_b := LEAST(100.0, GREATEST(0.0, 50.0 + v_hc_growth_pct * 50.0));
  ELSIF v_employee_count > 0 THEN
    v_pillar_b := 50.0;
  END IF;

  IF v_pillar_b IS NOT NULL THEN
    IF v_is_serial_founder THEN
      v_pillar_b := LEAST(100.0, v_pillar_b + 10.0);
    END IF;
    v_pillar_b := ROUND(v_pillar_b, 1);
    v_b_valid  := true;
  END IF;

  RAISE NOTICE 'AlphaMapEngine[%]: Pillar B (Talent Velocity) valid=% score=%',
    p_startup_id, v_b_valid, v_pillar_b;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- PILLAR C: Ecosystem Signal  (default weight 20 %)
  --
  -- Root cause fixed: this used to read ONLY startups.investor_tier_score, a
  -- column the ingestion pipeline never wrote to, so it was always NULL and
  -- the pillar was always invalid. It now:
  --   1. Still honors a manual override on investor_tier_score, if ever set.
  --   2. Otherwise collects every distinct investor name across this
  --      startup's funding_rounds (lead_investor + investors[]) and joins
  --      them against investors.tier (1 = top-tier … 3 = long-tail).
  --   3. Unmatched investor names (not in our investors table) score as
  --      "unranked" (55) rather than being dropped.
  --   4. If literally no investor name exists on any round, falls back to a
  --      neutral baseline instead of reporting "—".
  -- ══════════════════════════════════════════════════════════════════════════════
  IF v_investor_tier_score IS NOT NULL THEN
    v_pillar_c         := LEAST(100.0, GREATEST(0.0, v_investor_tier_score));
    v_ecosystem_source := 'manual_override';
    v_c_valid          := true;
  ELSE
    WITH investor_names AS (
      SELECT DISTINCT lower(trim(t.nm)) AS nm
      FROM funding_rounds fr,
           LATERAL unnest(
             COALESCE(fr.investors, '{}'::text[]) ||
             CASE WHEN fr.lead_investor IS NOT NULL THEN ARRAY[fr.lead_investor] ELSE '{}'::text[] END
           ) AS t(nm)
      WHERE fr.startup_id = p_startup_id
        AND t.nm IS NOT NULL
        AND trim(t.nm) <> ''
    ),
    matched AS (
      SELECT inv.tier
      FROM investor_names n
      JOIN investors inv ON lower(trim(inv.name)) = n.nm
    )
    SELECT
      (SELECT COUNT(*) FROM investor_names)::integer,
      (SELECT COUNT(*) FROM matched)::integer,
      COALESCE((SELECT COUNT(*) FROM matched WHERE tier = 1), 0)::integer,
      COALESCE((SELECT COUNT(*) FROM matched WHERE tier = 2), 0)::integer,
      COALESCE((SELECT COUNT(*) FROM matched WHERE tier = 3), 0)::integer
    INTO v_n_investors, v_n_matched, v_n_tier1, v_n_tier2, v_n_tier3;

    RAISE NOTICE 'AlphaMapEngine[%]: Ecosystem Signal — n_investors=% n_matched=% tier1=% tier2=% tier3=%',
      p_startup_id, v_n_investors, v_n_matched, v_n_tier1, v_n_tier2, v_n_tier3;

    IF v_n_investors = 0 THEN
      -- No investor name recorded on any round for this startup
      v_pillar_c         := 40.0;
      v_ecosystem_source := 'baseline_no_data';
    ELSE
      -- Weighted average across every named investor: matched investors
      -- score by tier (1=95, 2=75, 3=55); names we don't recognise default
      -- to 55 ("unranked") rather than being excluded from the average.
      v_pillar_c := (
          v_n_tier1 * 95.0
        + v_n_tier2 * 75.0
        + v_n_tier3 * 55.0
        + (v_n_investors - v_n_matched) * 55.0
      ) / v_n_investors;

      -- Two-or-more top-tier backers is a strong signal on its own
      IF v_n_tier1 >= 2 THEN
        v_pillar_c := LEAST(100.0, v_pillar_c + 5.0);
      END IF;
      v_ecosystem_source := 'investor_join';
    END IF;
    v_c_valid := true;
  END IF;

  IF v_has_follow_on THEN
    v_pillar_c := LEAST(100.0, v_pillar_c + 10.0);
  END IF;
  v_pillar_c := ROUND(v_pillar_c, 1);

  RAISE NOTICE 'AlphaMapEngine[%]: Pillar C (Ecosystem Signal) source=% score=%',
    p_startup_id, v_ecosystem_source, v_pillar_c;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- NULL GRACEFUL DEGRADATION (safety net — all 3 pillars now resolve above)
  -- ══════════════════════════════════════════════════════════════════════════════
  IF NOT v_a_valid THEN v_wa := 0.0; END IF;
  IF NOT v_b_valid THEN v_wb := 0.0; END IF;
  IF NOT v_c_valid THEN v_wc := 0.0; END IF;

  v_total_w := v_wa + v_wb + v_wc;

  IF v_total_w = 0.0 THEN
    RETURN jsonb_build_object(
      'score', NULL, 'tier', NULL,
      'confidence', 'none', 'reason', 'no_scored_pillars'
    );
  END IF;

  v_wa := v_wa / v_total_w;
  v_wb := v_wb / v_total_w;
  v_wc := v_wc / v_total_w;

  v_base_score :=
      COALESCE(v_pillar_a, 0.0) * v_wa
    + COALESCE(v_pillar_b, 0.0) * v_wb
    + COALESCE(v_pillar_c, 0.0) * v_wc;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- X-FACTOR: Macro Market Adjustment (unchanged)
  -- ══════════════════════════════════════════════════════════════════════════════
  IF v_sector_id IS NULL AND v_industry IS NOT NULL THEN
    v_sector_id := CASE
      WHEN lower(v_industry) ~ '\y(ai|ml|llm|nlp)\y'
        OR lower(v_industry) SIMILAR TO '%(machine learn%|artificial intel%|generative|deep learn%)%'
        THEN 'ai-ml'
      WHEN lower(v_industry) SIMILAR TO '%(fintech|payment|neobank|crypto|web3|insurtech|wealthtech|lending|defi)%'
        THEN 'fintech'
      WHEN lower(v_industry) SIMILAR TO '%(cyber|zero trust|endpoint sec%|cloud sec%|identity|iam)%'
        THEN 'cybersecurity'
      WHEN lower(v_industry) SIMILAR TO '%(saas|dev tool%|devops|api platform|no-code|low-code|data infra%)%'
        THEN 'saas-devtools'
      WHEN lower(v_industry) SIMILAR TO '%(e-commerce|ecommerce|marketplace|logistics|retail tech)%'
        THEN 'ecommerce-retail'
      WHEN lower(v_industry) SIMILAR TO '%(health|medical|biotech|genomic|mental health)%'
        THEN 'health-lifesci'
      WHEN lower(v_industry) SIMILAR TO '%(clean tech|cleantech|energy|renewable|carbon|climate|sustain%)%'
        THEN 'climate-energy'
      WHEN lower(v_industry) SIMILAR TO '%(enterprise|crm|erp|hr tech|analytics|business intel%)%'
        THEN 'enterprise-sw'
      WHEN lower(v_industry) SIMILAR TO '%(gaming|social media|edtech|travel|media|consumer)%'
        THEN 'consumer-media'
      WHEN lower(v_industry) SIMILAR TO '%(quantum|robotics|space tech|semiconductor|deeptech|deep tech)%'
        THEN 'deeptech'
      ELSE NULL
    END;
  END IF;

  IF v_sector_id IS NOT NULL THEN
    SELECT msm.current_multiple, msm.historical_multiple
    INTO   v_cur_mult, v_hist_mult
    FROM   macro_sector_multiples msm
    WHERE  msm.sector_id = v_sector_id
    ORDER  BY msm.effective_date DESC
    LIMIT  1;

    IF v_cur_mult IS NOT NULL AND v_hist_mult IS NOT NULL THEN
      v_macro_adj := (v_cur_mult / NULLIF(v_hist_mult, 0.0)) - 1.0;
      v_macro_adj := GREATEST(-0.30, LEAST(0.30, v_macro_adj));
    END IF;
  END IF;

  v_final_score := LEAST(100.0, GREATEST(1.0,
    ROUND((v_base_score * (1.0 + v_macro_adj))::numeric, 1)
  ));

  v_pillar_count := v_a_valid::int + v_b_valid::int + v_c_valid::int;

  RAISE NOTICE 'AlphaMapEngine[%]: base_score=% macro_adj_pct=% final_score=% confidence_pillars=%',
    p_startup_id, v_base_score, v_macro_adj * 100.0, v_final_score, v_pillar_count;

  -- ── Return full breakdown ────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'score',         v_final_score,
    'tier',          CASE
                       WHEN v_final_score >= 85 THEN 'A'
                       WHEN v_final_score >= 70 THEN 'B'
                       ELSE 'C'
                     END,
    'confidence',    CASE v_pillar_count
                       WHEN 3 THEN 'high'
                       WHEN 2 THEN 'medium'
                       ELSE 'low'
                     END,
    'base_score',    ROUND(v_base_score::numeric, 1),
    'macro_adj_pct', ROUND((v_macro_adj * 100.0)::numeric, 1),
    'sector_id',     COALESCE(v_sector_id, 'unknown'),
    'pillars', jsonb_build_object(
      'capital_efficiency', jsonb_build_object(
        'label',  'Capital Efficiency',
        'weight', ROUND((v_wa * 100)::numeric, 0),
        'score',  CASE WHEN v_a_valid THEN ROUND(v_pillar_a::numeric, 1) ELSE NULL END,
        'valid',  v_a_valid,
        'detail', jsonb_build_object(
          'value_creation_x', ROUND(COALESCE(v_value_creation, 0)::numeric, 2),
          'burn_proxy_k',     ROUND(COALESCE(v_burn_proxy, 0)::numeric / 1000.0, 1),
          'tier',             v_capital_tier
        )
      ),
      'talent_velocity', jsonb_build_object(
        'label',  'Talent Velocity',
        'weight', ROUND((v_wb * 100)::numeric, 0),
        'score',  CASE WHEN v_b_valid THEN ROUND(v_pillar_b::numeric, 1) ELSE NULL END,
        'valid',  v_b_valid,
        'detail', jsonb_build_object(
          'hc_growth_pct',  ROUND(COALESCE(v_hc_growth_pct, 0)::numeric * 100.0, 1),
          'serial_founder', v_is_serial_founder
        )
      ),
      'ecosystem_signal', jsonb_build_object(
        'label',  'Ecosystem Signal',
        'weight', ROUND((v_wc * 100)::numeric, 0),
        'score',  CASE WHEN v_c_valid THEN ROUND(v_pillar_c::numeric, 1) ELSE NULL END,
        'valid',  v_c_valid,
        'detail', jsonb_build_object(
          'investor_tier', COALESCE(ROUND(v_investor_tier_score::numeric, 0), NULL),
          'follow_on',     v_has_follow_on,
          'source',        v_ecosystem_source,
          'n_investors',   v_n_investors,
          'n_matched',     v_n_matched
        )
      )
    )
  );
END;
$$;

-- Grant anon + authenticated roles read access (RLS is enforced upstream)
GRANT EXECUTE ON FUNCTION calculate_alphamap_score(uuid) TO anon, authenticated;
