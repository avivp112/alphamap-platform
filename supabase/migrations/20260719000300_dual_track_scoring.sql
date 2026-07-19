-- =============================================================================
-- Migration: dual_track_scoring
-- Created:   2026-07-19
-- Description: The AlphaMap scoring engine assumed every company is a
--              hyper-growth venture-backed startup — rewarding funding
--              velocity, recent rounds, and headcount growth *rate*. That
--              unfairly penalizes the mature private companies now in the
--              database (PE-backed buyouts like athenahealth, bootstrapped
--              businesses, long-lived private firms) which don't raise
--              frequent equity rounds by design, not by weakness.
--
--              Three changes:
--
--   1. round_type vocabulary — funding_rounds.round_type had a CHECK
--      constraint allowing only VC-style types, so non-VC financial events
--      (PE buyouts/LBOs, secondary-market transactions, debt financing)
--      could not even be stored distinctly. The constraint is rebuilt with
--      three new types: 'PE Buyout' (covers LBOs — press coverage rarely
--      distinguishes a leveraged from an unleveraged buyout, and both are
--      financial-sponsor take-overs), 'Secondary' (existing shareholders
--      selling; NO new capital reaches the company), and 'Debt' (venture
--      debt, credit facilities, term loans; capital but not equity).
--
--   2. classify_company_archetype(uuid) — pre-scoring classification into
--      'venture_backed' vs 'mature_private' using exactly the signals a
--      human would: a buyout/acquisition on record, years active with no
--      recent early-stage round, or large headcount with no recent VC
--      round at all.
--
--   3. calculate_alphamap_score(uuid) — dual-track weighting:
--        venture_backed  (unchanged behavior): Capital Efficiency 45% /
--          Talent Velocity 35% / Ecosystem Signal 20%
--        mature_private: Capital Efficiency 20% / Scale & Longevity 50%
--          (absolute headcount on a log scale + years in business +
--          headcount stability, where "stable" is GOOD, not mediocre) /
--          M&A & Backing 30% (outbound acquisitions from
--          startups.acquisitions blended with backer quality).
--      Additionally, non-equity events ('Debt', 'Secondary', 'PE Buyout',
--      'Acquired', 'IPO') are now EXCLUDED from the equity-capital sums
--      used by Capital Efficiency on BOTH tracks — a $200M debt facility
--      is not dilutive equity and was previously poisoning the
--      value-creation multiple.
--      The response JSON gains 'archetype' and 'archetype_reasons', and
--      pillar labels change per track (the UI renders labels from the
--      response, so it follows automatically).
--
-- Idempotent; safe to run more than once in the SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Widen the round_type CHECK constraint
--    (Postgres auto-named the inline CHECK 'funding_rounds_round_type_check')
-- -----------------------------------------------------------------------------
ALTER TABLE funding_rounds DROP CONSTRAINT IF EXISTS funding_rounds_round_type_check;
ALTER TABLE funding_rounds ADD CONSTRAINT funding_rounds_round_type_check
  CHECK (round_type IN (
    'Pre-Seed', 'Seed',
    'Series A', 'Series B', 'Series C', 'Series D', 'Series E+',
    'Growth', 'Bridge', 'Convertible Note',
    'Bootstrapped', 'Grant', 'Acquired', 'IPO', 'Other',
    'PE Buyout', 'Secondary', 'Debt'
  ));

-- -----------------------------------------------------------------------------
-- 2) stage_group — teach it the new types
--    'PE Buyout' and 'Secondary' are late-stage events by nature; 'Debt' can
--    happen at any stage so it carries no stage signal.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stage_group(p_round_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_round_type IS NULL OR p_round_type IN ('Other', 'Bootstrapped', 'Grant', 'Debt') THEN 'unknown'
    WHEN p_round_type IN ('Pre-Seed', 'Seed', 'Convertible Note', 'Bridge')                  THEN 'early'
    WHEN p_round_type IN ('Series A', 'Series B')                                            THEN 'growth'
    ELSE 'late'
  END;
$$;

-- -----------------------------------------------------------------------------
-- 3) classify_company_archetype — pre-scoring corporate-archetype detection
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION classify_company_archetype(p_startup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_founded_year     integer;
  v_employee_count   integer;
  v_years_active     integer;
  v_has_buyout       boolean;
  v_has_recent_early boolean;
  v_has_recent_vc    boolean;
  v_reasons          jsonb := '[]'::jsonb;
BEGIN
  SELECT s.founded_year, COALESCE(s.employee_count, 0)
  INTO   v_founded_year, v_employee_count
  FROM   startups s
  WHERE  s.id = p_startup_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('archetype', 'venture_backed',
                              'reasons', jsonb_build_array('startup_not_found_defaulted'));
  END IF;

  v_years_active := CASE
    WHEN v_founded_year IS NOT NULL AND v_founded_year > 1800
      THEN GREATEST(0, EXTRACT(YEAR FROM CURRENT_DATE)::integer - v_founded_year)
    ELSE NULL
  END;

  -- Signal 1: a financial-sponsor buyout or strategic acquisition on record.
  SELECT EXISTS (
    SELECT 1 FROM funding_rounds fr
    WHERE fr.startup_id = p_startup_id
      AND fr.round_type IN ('PE Buyout', 'Acquired')
  ) INTO v_has_buyout;

  -- Signal 2: any early-stage round in the last 8 years?
  SELECT EXISTS (
    SELECT 1 FROM funding_rounds fr
    WHERE fr.startup_id = p_startup_id
      AND fr.round_type IN ('Pre-Seed', 'Seed', 'Series A')
      AND fr.announcement_date >= CURRENT_DATE - INTERVAL '8 years'
  ) INTO v_has_recent_early;

  -- Signal 3: any VC equity round at all in the last 5 years?
  SELECT EXISTS (
    SELECT 1 FROM funding_rounds fr
    WHERE fr.startup_id = p_startup_id
      AND fr.round_type IN ('Pre-Seed','Seed','Series A','Series B','Series C',
                            'Series D','Series E+','Growth','Bridge','Convertible Note')
      AND fr.announcement_date >= CURRENT_DATE - INTERVAL '5 years'
  ) INTO v_has_recent_vc;

  IF v_has_buyout THEN
    v_reasons := jsonb_build_array('buyout_or_acquisition_on_record');
    RETURN jsonb_build_object('archetype', 'mature_private', 'reasons', v_reasons);
  END IF;

  IF v_years_active IS NOT NULL AND v_years_active >= 15 AND NOT v_has_recent_early THEN
    v_reasons := jsonb_build_array('active_15_plus_years', 'no_recent_early_stage_round');
    RETURN jsonb_build_object('archetype', 'mature_private', 'reasons', v_reasons);
  END IF;

  IF v_employee_count >= 750 AND NOT v_has_recent_vc THEN
    v_reasons := jsonb_build_array('large_headcount', 'no_recent_vc_round');
    RETURN jsonb_build_object('archetype', 'mature_private', 'reasons', v_reasons);
  END IF;

  RETURN jsonb_build_object('archetype', 'venture_backed',
                            'reasons', jsonb_build_array('venture_profile'));
END;
$$;

GRANT EXECUTE ON FUNCTION classify_company_archetype(uuid) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) calculate_alphamap_score — dual-track rewrite
-- -----------------------------------------------------------------------------
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
  v_founded_year            integer;
  v_growth_trend            text;
  v_acquisitions            jsonb;

  -- ── Archetype ───────────────────────────────────────────────────────────────
  v_arch                    jsonb;
  v_archetype               text;
  v_years_active            integer;
  v_n_acquisitions          integer := 0;

  -- ── Funding rounds (EQUITY ONLY — Debt/Secondary/PE Buyout/Acquired/IPO
  --     excluded, they are not dilutive venture equity) ───────────────────────
  v_latest_valuation        numeric;
  v_latest_amount           numeric;
  v_prev_valuation          numeric;
  v_total_raised            numeric;

  -- ── Pillar A intermediates ──────────────────────────────────────────────────
  v_value_creation          numeric;
  v_headcount_added         numeric;
  v_burn_proxy              numeric;
  v_vc_norm                 numeric;
  v_burn_norm               numeric;
  v_capital_tier            text;

  -- ── Pillar B intermediates ──────────────────────────────────────────────────
  v_hc_growth_pct           numeric;
  v_scale_score             numeric;
  v_longevity_score         numeric;
  v_stability_score         numeric;

  -- ── Pillar C intermediates ──────────────────────────────────────────────────
  v_n_investors             integer := 0;
  v_n_matched               integer := 0;
  v_n_tier1                 integer := 0;
  v_n_tier2                 integer := 0;
  v_n_tier3                 integer := 0;
  v_ecosystem_source        text;
  v_ma_score                numeric;

  -- ── Pillar scores / labels ──────────────────────────────────────────────────
  v_pillar_a                numeric;
  v_pillar_b                numeric;
  v_pillar_c                numeric;
  v_a_valid                 boolean := false;
  v_b_valid                 boolean := false;
  v_c_valid                 boolean := false;
  v_label_b                 text := 'Talent Velocity';
  v_label_c                 text := 'Ecosystem Signal';

  -- ── Weights (archetype-dependent; re-distributed when a pillar is invalid) ──
  v_wa                      numeric;
  v_wb                      numeric;
  v_wc                      numeric;
  v_total_w                 numeric;

  -- ── Macro adjustment ────────────────────────────────────────────────────────
  v_cur_mult                numeric;
  v_hist_mult               numeric;
  v_macro_adj               numeric := 0.0;

  -- ── Outputs ─────────────────────────────────────────────────────────────────
  v_base_score              numeric;
  v_final_score             numeric;
  v_pillar_count            integer;
BEGIN

  -- ── 1. Load startup row ─────────────────────────────────────────────────────
  SELECT
    s.industry,
    COALESCE(s.employee_count,          0),
    COALESCE(s.previous_employee_count, 0),
    COALESCE(s.is_serial_founder,       false),
    COALESCE(s.has_follow_on_investors, false),
    s.investor_tier_score,
    s.sector_id,
    s.founded_year,
    s.growth_trend,
    s.acquisitions
  INTO
    v_industry, v_employee_count, v_prev_employee_count,
    v_is_serial_founder, v_has_follow_on, v_investor_tier_score, v_sector_id,
    v_founded_year, v_growth_trend, v_acquisitions
  FROM startups s
  WHERE s.id = p_startup_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'startup_not_found');
  END IF;

  -- ── 2. Archetype classification (pre-scoring) ───────────────────────────────
  v_arch      := classify_company_archetype(p_startup_id);
  v_archetype := COALESCE(v_arch->>'archetype', 'venture_backed');

  v_years_active := CASE
    WHEN v_founded_year IS NOT NULL AND v_founded_year > 1800
      THEN GREATEST(0, EXTRACT(YEAR FROM CURRENT_DATE)::integer - v_founded_year)
    ELSE NULL
  END;

  v_n_acquisitions := CASE
    WHEN jsonb_typeof(v_acquisitions) = 'array' THEN jsonb_array_length(v_acquisitions)
    ELSE 0
  END;

  IF v_archetype = 'mature_private' THEN
    v_wa := 0.20;  v_wb := 0.50;  v_wc := 0.30;
    v_label_b := 'Scale & Longevity';
    v_label_c := 'M&A & Backing';
  ELSE
    v_wa := 0.45;  v_wb := 0.35;  v_wc := 0.20;
  END IF;

  RAISE NOTICE 'AlphaMapEngine[%]: archetype=% employee_count=% years_active=% n_acquisitions=%',
    p_startup_id, v_archetype, v_employee_count, v_years_active, v_n_acquisitions;

  -- ── 3. Load latest two EQUITY rounds (Debt/Secondary/buyout events excluded:
  --       they are not dilutive venture equity and poison the value-creation
  --       multiple — e.g. a $200M credit facility is not "capital raised" in
  --       the capital-efficiency sense) ─────────────────────────────────────────
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
      AND COALESCE(fr.round_type, 'Other') NOT IN ('Debt','Secondary','PE Buyout','Acquired','IPO')
  )
  SELECT
    MAX(CASE WHEN rn = 1 THEN valuation     END),
    MAX(CASE WHEN rn = 1 THEN amount_raised END),
    MAX(CASE WHEN rn = 2 THEN valuation     END)
  INTO v_latest_valuation, v_latest_amount, v_prev_valuation
  FROM ranked
  WHERE rn <= 2;

  SELECT COALESCE(SUM(fr.amount_raised), 0)
  INTO   v_total_raised
  FROM   funding_rounds fr
  WHERE  fr.startup_id = p_startup_id
    AND  fr.amount_raised IS NOT NULL
    AND  fr.amount_raised > 0
    AND  COALESCE(fr.round_type, 'Other') NOT IN ('Debt','Secondary','PE Buyout','Acquired','IPO');

  -- Valuation fallback may come from ANY round type — a buyout price or
  -- secondary-market mark is still a legitimate valuation data point.
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

  -- ══════════════════════════════════════════════════════════════════════════════
  -- PILLAR A: Capital Efficiency — same 5-tier fallback chain on both tracks
  -- (weight differs: 45% venture / 20% mature)
  -- ══════════════════════════════════════════════════════════════════════════════
  IF v_latest_valuation IS NOT NULL
     AND v_prev_valuation  IS NOT NULL
     AND v_latest_amount   IS NOT NULL
  THEN
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
    v_headcount_added := NULLIF(v_employee_count - v_prev_employee_count, 0);
    v_burn_proxy := v_total_raised / NULLIF(COALESCE(v_headcount_added, NULLIF(v_employee_count, 0)), 0);
    v_pillar_a := CASE
      WHEN v_burn_proxy IS NULL OR v_burn_proxy <= 0 THEN 50.0
      ELSE LEAST(100.0, GREATEST(0.0, 100.0 - (LEAST(v_burn_proxy, 500000.0) / 500000.0) * 100.0))
    END;
    v_capital_tier := 'burn_only';
    v_a_valid      := true;

  ELSE
    v_pillar_a     := 50.0;
    v_capital_tier := 'baseline_no_data';
    v_a_valid      := true;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- PILLAR B — track-dependent:
  --   venture_backed: Talent Velocity (headcount growth RATE — unchanged)
  --   mature_private: Scale & Longevity (absolute size + years in business +
  --                   stability, where flat headcount is a GOOD outcome)
  -- ══════════════════════════════════════════════════════════════════════════════
  IF v_archetype = 'mature_private' THEN
    -- Absolute headcount on a log10 scale: 100 emp≈40, 1k≈60, 10k≈80, 100k≈100
    v_scale_score := CASE
      WHEN v_employee_count <= 0 THEN 40.0
      ELSE LEAST(100.0, 20.0 * log(10.0, (v_employee_count + 1)::numeric))
    END;

    -- Longevity: 4 points per year in business, capped at 25 years
    v_longevity_score := CASE
      WHEN v_years_active IS NULL THEN 50.0
      ELSE LEAST(100.0, v_years_active * 4.0)
    END;

    -- Stability: for a mature company, holding headcount steady is healthy —
    -- only contraction is penalized.
    v_stability_score := CASE v_growth_trend
      WHEN 'rapid growth'    THEN 100.0
      WHEN 'moderate growth' THEN 85.0
      WHEN 'stable'          THEN 75.0
      WHEN 'reduction'       THEN 30.0
      ELSE 60.0
    END;

    v_pillar_b := ROUND((v_scale_score * 0.40 + v_longevity_score * 0.30 + v_stability_score * 0.30)::numeric, 1);
    v_b_valid  := true;

  ELSE
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
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- PILLAR C — investor-quality base on both tracks; mature track blends in
  -- M&A activity (is this company itself acquiring smaller companies?)
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

    IF v_n_investors = 0 THEN
      v_pillar_c         := 40.0;
      v_ecosystem_source := 'baseline_no_data';
    ELSE
      v_pillar_c := (
          v_n_tier1 * 95.0
        + v_n_tier2 * 75.0
        + v_n_tier3 * 55.0
        + (v_n_investors - v_n_matched) * 55.0
      ) / v_n_investors;

      IF v_n_tier1 >= 2 THEN
        v_pillar_c := LEAST(100.0, v_pillar_c + 5.0);
      END IF;
      v_ecosystem_source := 'investor_join';
    END IF;
    v_c_valid := true;
  END IF;

  -- Mature track: blend outbound M&A activity into the pillar. Acquiring
  -- smaller companies is a strong signal of a healthy, cash-generating
  -- business — the mature-company analog of raising a hot round.
  IF v_archetype = 'mature_private' THEN
    v_ma_score := LEAST(100.0, 40.0 + v_n_acquisitions * 20.0);
    v_pillar_c := LEAST(100.0, v_pillar_c * 0.70 + v_ma_score * 0.30);
  END IF;

  IF v_has_follow_on THEN
    v_pillar_c := LEAST(100.0, v_pillar_c + 10.0);
  END IF;
  v_pillar_c := ROUND(v_pillar_c, 1);

  -- ══════════════════════════════════════════════════════════════════════════════
  -- Weight redistribution + macro adjustment (unchanged mechanics)
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

  RAISE NOTICE 'AlphaMapEngine[%]: archetype=% base_score=% final_score=%',
    p_startup_id, v_archetype, v_base_score, v_final_score;

  -- ── Return full breakdown ───────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'score',             v_final_score,
    'tier',              CASE
                           WHEN v_final_score >= 85 THEN 'A'
                           WHEN v_final_score >= 70 THEN 'B'
                           ELSE 'C'
                         END,
    'confidence',        CASE v_pillar_count
                           WHEN 3 THEN 'high'
                           WHEN 2 THEN 'medium'
                           ELSE 'low'
                         END,
    'archetype',         v_archetype,
    'archetype_reasons', COALESCE(v_arch->'reasons', '[]'::jsonb),
    'base_score',        ROUND(v_base_score::numeric, 1),
    'macro_adj_pct',     ROUND((v_macro_adj * 100.0)::numeric, 1),
    'sector_id',         COALESCE(v_sector_id, 'unknown'),
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
        'label',  v_label_b,
        'weight', ROUND((v_wb * 100)::numeric, 0),
        'score',  CASE WHEN v_b_valid THEN ROUND(v_pillar_b::numeric, 1) ELSE NULL END,
        'valid',  v_b_valid,
        'detail', CASE WHEN v_archetype = 'mature_private'
          THEN jsonb_build_object(
            'headcount',     v_employee_count,
            'years_active',  v_years_active,
            'stability',     COALESCE(v_growth_trend, 'unknown'),
            'scale_score',   ROUND(COALESCE(v_scale_score, 0)::numeric, 1)
          )
          ELSE jsonb_build_object(
            'hc_growth_pct',  ROUND(COALESCE(v_hc_growth_pct, 0)::numeric * 100.0, 1),
            'serial_founder', v_is_serial_founder
          )
        END
      ),
      'ecosystem_signal', jsonb_build_object(
        'label',  v_label_c,
        'weight', ROUND((v_wc * 100)::numeric, 0),
        'score',  CASE WHEN v_c_valid THEN ROUND(v_pillar_c::numeric, 1) ELSE NULL END,
        'valid',  v_c_valid,
        'detail', jsonb_build_object(
          'investor_tier',  COALESCE(ROUND(v_investor_tier_score::numeric, 0), NULL),
          'follow_on',      v_has_follow_on,
          'source',         v_ecosystem_source,
          'n_investors',    v_n_investors,
          'n_matched',      v_n_matched,
          'n_acquisitions', CASE WHEN v_archetype = 'mature_private' THEN v_n_acquisitions ELSE NULL END
        )
      )
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_alphamap_score(uuid) TO anon, authenticated;
