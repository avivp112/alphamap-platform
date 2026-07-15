-- =============================================================================
-- Migration: startups_scalable_search
-- Created:   2026-07-13
-- Description: Supports server-side filtered + paginated startup search
--              (Startups Hub refactor) without fetching all rows client-side.
--
--              Adds:
--              1. classify_sector_parent(industry) — SQL port of the client's
--                 classifyIndustry() keyword map (parent-level only; the finer
--                 sub-sector drill-down stays client-driven via a dynamic
--                 ILIKE-OR built from the same keyword source, to avoid
--                 duplicating ~90 keyword→sub mappings in two languages).
--              2. stage_group(round_type) — SQL port of getStageGroup().
--              3. startups_search — a view exposing, per startup:
--                   - latest_round_type / latest_valuation / latest_round_date /
--                     latest_round_is_estimated (resolves the "which funding
--                     round is current" ambiguity that the old client code had
--                     — it read funding_rounds[0] with no guaranteed order)
--                   - total_raised (sum of all rounds, so cards/compare don't
--                     need the full funding_rounds array)
--                   - has_recent_round (raised in the last 6 months, for the
--                     "Financial Momentum" filter)
--                   - sector_parent, stage_group_val (bucket keys)
--                   - peer_count / peer_count_valid — a scalable replacement
--                     for the old O(n²) in-memory peer-similarity scoring:
--                     counts how many other startups share the same
--                     {sector_parent, stage_group} bucket, computed via a
--                     window function instead of pairwise comparison. This
--                     drops the original's fine-grained weighted score (and
--                     its geography component, which the original scoring
--                     rarely needed to cross its 75-point threshold anyway —
--                     industry(50)+stage(30)=80 already clears it), in
--                     exchange for being indexable and paginate-safe at
--                     10,000+ rows.
--              4. distinct_startup_countries() — RPC returning only the
--                 distinct non-null country values (for the sidebar's country
--                 list), instead of downloading every row to derive it
--                 client-side.
--              5. suggested_startup_peers(p_startup_id, p_exclude_ids, p_limit)
--                 — RPC used by the Compare modal's "Suggested Peers", now
--                 that there's no full in-memory dataset to search client-side.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) classify_sector_parent — parent-level port of classifyIndustry()
--    Keyword order matches src/app/pages/Startups.tsx INDUSTRY_KEYWORD_MAP
--    exactly (first match wins), so results agree with the client's display
--    classification whenever industry text is present.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION classify_sector_parent(p_industry text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_industry IS NULL OR trim(p_industry) = '' THEN 'Uncategorized'
    -- AI & ML
    WHEN p_industry ILIKE '%generative ai%'         THEN 'AI & ML'
    WHEN p_industry ILIKE '%large language model%'  THEN 'AI & ML'
    WHEN p_industry ILIKE '%computer vision%'       THEN 'AI & ML'
    WHEN p_industry ILIKE '%natural language%'      THEN 'AI & ML'
    WHEN p_industry ILIKE '%speech recognition%'    THEN 'AI & ML'
    WHEN p_industry ILIKE '%ai agent%'              THEN 'AI & ML'
    WHEN p_industry ILIKE '%agentic%'               THEN 'AI & ML'
    WHEN p_industry ILIKE '%mlops%'                 THEN 'AI & ML'
    WHEN p_industry ILIKE '%ai infrastructure%'     THEN 'AI & ML'
    WHEN p_industry ILIKE '%machine learning%'      THEN 'AI & ML'
    WHEN p_industry ILIKE '%artificial intelligence%' THEN 'AI & ML'
    -- Fintech
    WHEN p_industry ILIKE '%insurtech%'             THEN 'Fintech'
    WHEN p_industry ILIKE '%wealthtech%'            THEN 'Fintech'
    WHEN p_industry ILIKE '%regtech%'                THEN 'Fintech'
    WHEN p_industry ILIKE '%neobank%'               THEN 'Fintech'
    WHEN p_industry ILIKE '%digital bank%'          THEN 'Fintech'
    WHEN p_industry ILIKE '%payment%'                THEN 'Fintech'
    WHEN p_industry ILIKE '%lending%'                THEN 'Fintech'
    WHEN p_industry ILIKE '%credit%'                 THEN 'Fintech'
    WHEN p_industry ILIKE '%blockchain%'            THEN 'Fintech'
    WHEN p_industry ILIKE '%crypto%'                 THEN 'Fintech'
    WHEN p_industry ILIKE '%defi%'                   THEN 'Fintech'
    WHEN p_industry ILIKE '%web3%'                   THEN 'Fintech'
    WHEN p_industry ILIKE '%compliance%'             THEN 'Fintech'
    WHEN p_industry ILIKE '%financial technology%'  THEN 'Fintech'
    WHEN p_industry ILIKE '%fintech%'                THEN 'Fintech'
    -- Cybersecurity
    WHEN p_industry ILIKE '%zero trust%'            THEN 'Cybersecurity'
    WHEN p_industry ILIKE '%cloud security%'        THEN 'Cybersecurity'
    WHEN p_industry ILIKE '%data security%'         THEN 'Cybersecurity'
    WHEN p_industry ILIKE '%identity%'                THEN 'Cybersecurity'
    WHEN p_industry ILIKE '%endpoint security%'     THEN 'Cybersecurity'
    WHEN p_industry ILIKE '%threat intelligence%'   THEN 'Cybersecurity'
    WHEN p_industry ILIKE '%cybersecurity%'          THEN 'Cybersecurity'
    WHEN p_industry ILIKE '%information security%'  THEN 'Cybersecurity'
    -- SaaS & Dev Tools
    WHEN p_industry ILIKE '%developer tool%'        THEN 'SaaS & Dev Tools'
    WHEN p_industry ILIKE '%devops%'                 THEN 'SaaS & Dev Tools'
    WHEN p_industry ILIKE '%api platform%'          THEN 'SaaS & Dev Tools'
    WHEN p_industry ILIKE '%low-code%'               THEN 'SaaS & Dev Tools'
    WHEN p_industry ILIKE '%no-code%'                THEN 'SaaS & Dev Tools'
    WHEN p_industry ILIKE '%data infrastructure%'   THEN 'SaaS & Dev Tools'
    WHEN p_industry ILIKE '%data platform%'         THEN 'SaaS & Dev Tools'
    WHEN p_industry ILIKE '%saas%'                    THEN 'SaaS & Dev Tools'
    -- E-commerce & Retail
    WHEN p_industry ILIKE '%supply chain%'          THEN 'E-commerce & Retail'
    WHEN p_industry ILIKE '%logistics%'              THEN 'E-commerce & Retail'
    WHEN p_industry ILIKE '%marketplace%'           THEN 'E-commerce & Retail'
    WHEN p_industry ILIKE '%retail tech%'           THEN 'E-commerce & Retail'
    WHEN p_industry ILIKE '%e-commerce%'             THEN 'E-commerce & Retail'
    WHEN p_industry ILIKE '%ecommerce%'              THEN 'E-commerce & Retail'
    WHEN p_industry ILIKE '%d2c%'                    THEN 'E-commerce & Retail'
    -- Health & Life Sciences
    WHEN p_industry ILIKE '%digital health%'        THEN 'Health & Life Sciences'
    WHEN p_industry ILIKE '%healthtech%'             THEN 'Health & Life Sciences'
    WHEN p_industry ILIKE '%medtech%'                THEN 'Health & Life Sciences'
    WHEN p_industry ILIKE '%medical device%'        THEN 'Health & Life Sciences'
    WHEN p_industry ILIKE '%genomics%'               THEN 'Health & Life Sciences'
    WHEN p_industry ILIKE '%biotech%'                THEN 'Health & Life Sciences'
    WHEN p_industry ILIKE '%life sciences%'         THEN 'Health & Life Sciences'
    WHEN p_industry ILIKE '%mental health%'         THEN 'Health & Life Sciences'
    WHEN p_industry ILIKE '%healthcare%'             THEN 'Health & Life Sciences'
    -- Climate & Energy
    WHEN p_industry ILIKE '%cleantech%'              THEN 'Climate & Energy'
    WHEN p_industry ILIKE '%clean energy%'          THEN 'Climate & Energy'
    WHEN p_industry ILIKE '%energytech%'             THEN 'Climate & Energy'
    WHEN p_industry ILIKE '%renewable%'              THEN 'Climate & Energy'
    WHEN p_industry ILIKE '%carbon%'                 THEN 'Climate & Energy'
    WHEN p_industry ILIKE '%sustainability%'        THEN 'Climate & Energy'
    WHEN p_industry ILIKE '%climate tech%'          THEN 'Climate & Energy'
    -- Enterprise Software
    WHEN p_industry ILIKE '%business intelligence%' THEN 'Enterprise Software'
    WHEN p_industry ILIKE '%analytics%'              THEN 'Enterprise Software'
    WHEN p_industry ILIKE '%human resources%'       THEN 'Enterprise Software'
    WHEN p_industry ILIKE '%hr tech%'                THEN 'Enterprise Software'
    WHEN p_industry ILIKE '%hrtech%'                 THEN 'Enterprise Software'
    WHEN p_industry ILIKE '%crm%'                    THEN 'Enterprise Software'
    WHEN p_industry ILIKE '%erp%'                    THEN 'Enterprise Software'
    WHEN p_industry ILIKE '%enterprise%'             THEN 'Enterprise Software'
    -- Consumer & Media
    WHEN p_industry ILIKE '%social media%'          THEN 'Consumer & Media'
    WHEN p_industry ILIKE '%gaming%'                 THEN 'Consumer & Media'
    WHEN p_industry ILIKE '%game%'                   THEN 'Consumer & Media'
    WHEN p_industry ILIKE '%edtech%'                 THEN 'Consumer & Media'
    WHEN p_industry ILIKE '%education%'              THEN 'Consumer & Media'
    WHEN p_industry ILIKE '%travel%'                 THEN 'Consumer & Media'
    WHEN p_industry ILIKE '%hospitality%'           THEN 'Consumer & Media'
    WHEN p_industry ILIKE '%media%'                  THEN 'Consumer & Media'
    WHEN p_industry ILIKE '%content%'                THEN 'Consumer & Media'
    -- DeepTech
    WHEN p_industry ILIKE '%quantum%'                THEN 'DeepTech'
    WHEN p_industry ILIKE '%robotics%'               THEN 'DeepTech'
    WHEN p_industry ILIKE '%space tech%'            THEN 'DeepTech'
    WHEN p_industry ILIKE '%semiconductor%'         THEN 'DeepTech'
    WHEN p_industry ILIKE '%deep tech%'              THEN 'DeepTech'
    WHEN p_industry ILIKE '%deeptech%'                THEN 'DeepTech'
    -- Word-boundary fallbacks (short tokens — avoid substring false positives)
    WHEN p_industry ~* '\yai\y'                      THEN 'AI & ML'
    WHEN p_industry ~* '\yml\y'                      THEN 'AI & ML'
    WHEN p_industry ~* '\yllm\y'                     THEN 'AI & ML'
    WHEN p_industry ~* '\ynlp\y'                     THEN 'AI & ML'
    WHEN p_industry ~* '\ysec\y'                     THEN 'Cybersecurity'
    WHEN p_industry ~* '\yiam\y'                     THEN 'Cybersecurity'
    ELSE 'Uncategorized'
  END;
$$;

COMMENT ON FUNCTION classify_sector_parent(text) IS
  'Parent-level port of the client classifyIndustry() keyword map (Startups.tsx). Keeps sector filtering/bucketing server-side without fetching all rows.';

-- -----------------------------------------------------------------------------
-- 2) stage_group — SQL port of getStageGroup()
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stage_group(p_round_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_round_type IS NULL OR p_round_type IN ('Other', 'Bootstrapped', 'Grant') THEN 'unknown'
    WHEN p_round_type IN ('Pre-Seed', 'Seed', 'Convertible Note', 'Bridge')          THEN 'early'
    WHEN p_round_type IN ('Series A', 'Series B')                                   THEN 'growth'
    ELSE 'late'
  END;
$$;

-- -----------------------------------------------------------------------------
-- 3) startups_search view
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW startups_search AS
SELECT
  s.*,
  classify_sector_parent(s.industry) AS sector_parent,
  stage_group(latest.round_type)     AS stage_group_val,
  latest.round_type                  AS latest_round_type,
  latest.valuation                   AS latest_valuation,
  latest.announcement_date           AS latest_round_date,
  latest.is_valuation_estimated      AS latest_round_is_estimated,
  COALESCE(totals.total_raised, 0)   AS total_raised,
  (latest.announcement_date IS NOT NULL
    AND latest.announcement_date >= (CURRENT_DATE - INTERVAL '6 months')) AS has_recent_round,
  COUNT(*) OVER (
    PARTITION BY classify_sector_parent(s.industry), stage_group(latest.round_type)
  ) AS peer_count,
  (classify_sector_parent(s.industry) <> 'Uncategorized'
    AND stage_group(latest.round_type) <> 'unknown') AS peer_count_valid
FROM startups s
LEFT JOIN LATERAL (
  SELECT fr.round_type, fr.valuation, fr.announcement_date, fr.is_valuation_estimated
  FROM funding_rounds fr
  WHERE fr.startup_id = s.id
  ORDER BY fr.announcement_date DESC NULLS LAST, fr.created_at DESC
  LIMIT 1
) latest ON true
LEFT JOIN LATERAL (
  SELECT SUM(fr.amount_raised) AS total_raised
  FROM funding_rounds fr
  WHERE fr.startup_id = s.id
) totals ON true;

COMMENT ON VIEW startups_search IS
  'Read-optimized view for the Startups Hub sidebar/search: precomputes latest funding round, total raised, sector bucket, and a scalable peer_count (replaces the old O(n²) client-side density scoring) so the page can filter+paginate entirely server-side.';

-- Indexes to keep the underlying filters/sorts fast at 10,000+ rows.
CREATE INDEX IF NOT EXISTS idx_startups_country        ON startups(country);
CREATE INDEX IF NOT EXISTS idx_startups_employee_count  ON startups(employee_count);
CREATE INDEX IF NOT EXISTS idx_startups_updated_at      ON startups(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_funding_rounds_startup_announce
  ON funding_rounds(startup_id, announcement_date DESC NULLS LAST, created_at DESC);

-- -----------------------------------------------------------------------------
-- 4) distinct_startup_countries — lightweight sidebar filter option list
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION distinct_startup_countries()
RETURNS TABLE (country text)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT s.country
  FROM startups s
  WHERE s.country IS NOT NULL AND trim(s.country) <> ''
  ORDER BY s.country;
$$;

-- -----------------------------------------------------------------------------
-- 5) suggested_startup_peers — Compare modal's "Suggested Peers", server-side
--    (same bucket as the target startup: sector_parent + stage_group)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION suggested_startup_peers(
  p_startup_id  uuid,
  p_exclude_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_limit       int DEFAULT 5
)
RETURNS SETOF startups_search
LANGUAGE sql
STABLE
AS $$
  SELECT peer.*
  FROM startups_search target
  JOIN startups_search peer
    ON peer.sector_parent    = target.sector_parent
   AND peer.stage_group_val  = target.stage_group_val
   AND target.peer_count_valid
   AND peer.id <> target.id
   AND peer.id <> ALL (p_exclude_ids)
  WHERE target.id = p_startup_id
  ORDER BY peer.total_raised DESC NULLS LAST
  LIMIT p_limit;
$$;

-- RLS: views/functions run with the querying role's own permissions by default
-- (SECURITY INVOKER), so they inherit the existing public-read policy on
-- `startups` — no separate grants needed for anon/read access.
