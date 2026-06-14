-- calculate_alphamap_score(p_startup_id uuid) → jsonb
--
-- Returns a JSONB object with:
--   score          numeric(1 dp)  1–100 final score
--   tier           text           'A' | 'B' | 'C'
--   confidence     text           'high' | 'medium' | 'low' | 'none'
--   base_score     numeric
--   macro_adj_pct  numeric        percentage points of macro adjustment
--   sector_id      text
--   pillars        jsonb          per-pillar score, weight, valid flag, raw detail
--
-- NULL Graceful Degradation:
--   If an entire Pillar's input data is absent, its weight is zeroed and
--   the remaining weights are re-distributed proportionally.  The function
--   never returns NULL for the score as long as at least one pillar has data.

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
  v_investor_tier_score     numeric;
  v_sector_id               text;

  -- ── Funding rounds (latest = rank 1, previous = rank 2) ─────────────────────
  v_latest_valuation        numeric;
  v_latest_amount           numeric;
  v_prev_valuation          numeric;

  -- ── Pillar A intermediates ───────────────────────────────────────────────────
  v_value_creation          numeric;   -- (val_new – val_old) / amount_raised
  v_headcount_added         numeric;   -- employee_count – previous_employee_count
  v_burn_proxy              numeric;   -- amount_raised / headcount_added
  v_vc_norm                 numeric;   -- normalised value_creation  0-100
  v_burn_norm               numeric;   -- normalised burn_proxy (inverted) 0-100

  -- ── Pillar B intermediates ───────────────────────────────────────────────────
  v_hc_growth_pct           numeric;   -- (cur – prev) / prev

  -- ── Pillar scores (0-100) ────────────────────────────────────────────────────
  v_pillar_a                numeric;   -- Capital Efficiency  (default 45 %)
  v_pillar_b                numeric;   -- Talent Velocity     (default 35 %)
  v_pillar_c                numeric;   -- Ecosystem Signal    (default 20 %)
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

  -- ══════════════════════════════════════════════════════════════════════════════
  -- PILLAR A: Capital Efficiency  (default weight 45 %)
  -- Requires: two valuations + latest funding amount
  -- ══════════════════════════════════════════════════════════════════════════════
  IF v_latest_valuation IS NOT NULL
     AND v_prev_valuation  IS NOT NULL
     AND v_latest_amount   IS NOT NULL
  THEN
    -- Value Creation: (val_new – val_old) / funding_amount
    -- Interpretation: how many $ of value per $ raised.  5× → 100 pts (linear)
    v_value_creation := (v_latest_valuation - v_prev_valuation)
                        / NULLIF(v_latest_amount, 0);

    v_vc_norm := LEAST(100.0, GREATEST(0.0,
      COALESCE(v_value_creation, 0.0) / 5.0 * 100.0
    ));

    -- Burn Proxy: funding_amount / headcount_added  (lower → better)
    -- Normalization range: $10 k/head = 100 pts → $500 k/head = 0 pts (linear)
    v_headcount_added := NULLIF(v_employee_count - v_prev_employee_count, 0);
    v_burn_proxy      := v_latest_amount / NULLIF(v_headcount_added, 0);

    v_burn_norm := CASE
      WHEN v_burn_proxy IS NULL OR v_burn_proxy <= 0 THEN 50.0   -- neutral
      ELSE LEAST(100.0, GREATEST(0.0,
        100.0 - (LEAST(v_burn_proxy, 500000.0) / 500000.0) * 100.0
      ))
    END;

    -- Weighted average: value_creation 60 %, burn_proxy 40 %
    v_pillar_a := ROUND((v_vc_norm * 0.6 + v_burn_norm * 0.4)::numeric, 1);
    v_a_valid  := true;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- PILLAR B: Talent Velocity  (default weight 35 %)
  -- Requires: current headcount (prior-year snapshot is optional; neutral if absent)
  -- ══════════════════════════════════════════════════════════════════════════════
  IF v_employee_count > 0 AND v_prev_employee_count > 0 THEN
    v_hc_growth_pct := (v_employee_count - v_prev_employee_count)::numeric
                       / NULLIF(v_prev_employee_count::numeric, 0);
    -- 0 % growth → 50 pts;  +100 % → 100 pts;  –100 % → 0 pts  (linear)
    v_pillar_b := LEAST(100.0, GREATEST(0.0, 50.0 + v_hc_growth_pct * 50.0));
  ELSIF v_employee_count > 0 THEN
    v_pillar_b := 50.0;   -- headcount present but no YoY snapshot → neutral
  END IF;

  IF v_pillar_b IS NOT NULL THEN
    -- Serial-founder flat bonus (+10 pts, capped at 100)
    IF v_is_serial_founder THEN
      v_pillar_b := LEAST(100.0, v_pillar_b + 10.0);
    END IF;
    v_pillar_b := ROUND(v_pillar_b, 1);
    v_b_valid  := true;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- PILLAR C: Ecosystem Signal  (default weight 20 %)
  -- Requires: investor_tier_score (0-100)
  -- ══════════════════════════════════════════════════════════════════════════════
  IF v_investor_tier_score IS NOT NULL THEN
    v_pillar_c := LEAST(100.0, GREATEST(0.0, v_investor_tier_score));
    -- Follow-on investor bonus (+10 pts, capped at 100)
    IF v_has_follow_on THEN
      v_pillar_c := LEAST(100.0, v_pillar_c + 10.0);
    END IF;
    v_pillar_c := ROUND(v_pillar_c, 1);
    v_c_valid  := true;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- NULL GRACEFUL DEGRADATION
  -- Zero the weight of any invalid pillar, then re-normalise so weights sum to 1.
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

  -- Proportional redistribution
  v_wa := v_wa / v_total_w;
  v_wb := v_wb / v_total_w;
  v_wc := v_wc / v_total_w;

  -- ── Base score (weighted sum of valid pillars) ────────────────────────────────
  v_base_score :=
      COALESCE(v_pillar_a, 0.0) * v_wa
    + COALESCE(v_pillar_b, 0.0) * v_wb
    + COALESCE(v_pillar_c, 0.0) * v_wc;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- X-FACTOR: Macro Market Adjustment
  -- Final_Score = Base × (1 + (cur_mult / NULLIF(hist_mult, 0) − 1))
  -- Capped at ±30 % to prevent extreme swings from stale multiples.
  -- ══════════════════════════════════════════════════════════════════════════════

  -- Derive sector_id from industry text when not explicitly stored
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
          'burn_proxy_k',     ROUND(COALESCE(v_burn_proxy, 0)::numeric / 1000.0, 1)
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
          'follow_on',     v_has_follow_on
        )
      )
    )
  );
END;
$$;

-- Grant anon + authenticated roles read access (RLS is enforced upstream)
GRANT EXECUTE ON FUNCTION calculate_alphamap_score(uuid) TO anon, authenticated;
