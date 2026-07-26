-- =============================================================================
-- Migration: FOMO scoring — scaled-organisation penalty
-- Created:   2026-07-26
-- Description:
--   Adds a negative term to sourcing_fomo_scores driven by evidence that a
--   company already has corporate functions.
--
--   WHY, from real data. The first production crawl (Stripe, 536 postings)
--   left 367 titles matching nothing. Inspecting them showed they were not
--   random misses — they were Account Executive, Sales Development
--   Representative, Customer Success Manager, Accounts Receivable Manager,
--   Risk Operations Analyst, People Consultant, Manager/Global Sanctions.
--
--   The tempting fix was to widen the seniority taxonomy so those titles
--   matched. That would have raised coverage from 31% to roughly 70% and
--   changed ZERO scores, because the score only reads founding/stealth
--   signals. A better-looking metric, an unchanged product.
--
--   The useful reading is the opposite one: a company staffing a sales org, a
--   support org, a finance function AND a compliance function is demonstrably
--   past the stage this tool exists to catch. So those roles now emit
--   'Sales Org' / 'Customer Org' / 'Finance Org' / 'People Org' /
--   'Compliance Org' keywords, and this migration subtracts on the count of
--   DISTINCT functions present.
--
--   Distinct functions, not raw count, deliberately: an early company making
--   its first commercial hire trips one function and is not penalised. Four
--   separate corporate functions is the actual signal.
--
-- Rollback: supabase/rollback/20260726040000_fomo_scaled_org_penalty_down.sql
--           (restores the previous view definition)
--
-- Idempotent.
--
-- NOTE: DROP then CREATE, not CREATE OR REPLACE. Replace can only append
-- columns, and this adds scaled_org_functions in the middle of the column
-- list — replace fails with "cannot change name of view column". Dropping is
-- safe here because a view holds no data; nothing depends on it yet either.
-- =============================================================================

DROP VIEW IF EXISTS sourcing_fomo_scores;

CREATE VIEW sourcing_fomo_scores AS
WITH job_agg AS (
  SELECT
    company_id,
    count(*) FILTER (WHERE is_active)                          AS active_jobs,
    count(*)                                                   AS total_jobs,
    max(first_seen_at)                                         AS latest_job_seen,
    avg(EXTRACT(EPOCH FROM (closed_at - first_seen_at)) / 86400.0)
      FILTER (WHERE closed_at IS NOT NULL)                     AS avg_days_to_fill
  FROM early_job_postings
  GROUP BY company_id
),
sig_agg AS (
  SELECT
    p.company_id,
    count(*) FILTER (
      WHERE s.signal_type = 'seniority'
        AND s.signal_value IN ('Founding', 'Co-Founder', 'First Hire')
    )                                                          AS founding_signals,
    count(*) FILTER (
      WHERE s.signal_type = 'keyword'
        AND s.signal_value IN ('Stealth', 'Founding Team', 'Zero to One', 'Greenfield', 'Early Stage')
    )                                                          AS stealth_signals,
    -- DISTINCT, so five Account Executive postings count as ONE sales org
    -- rather than five strikes.
    count(DISTINCT s.signal_value) FILTER (
      WHERE s.signal_type = 'keyword'
        AND s.signal_value IN ('Sales Org', 'Customer Org', 'Finance Org', 'People Org', 'Compliance Org')
    )                                                          AS scaled_org_functions,
    count(DISTINCT s.signal_value) FILTER (WHERE s.signal_type = 'tech_stack')
                                                               AS distinct_tech
  FROM job_signals s
  JOIN early_job_postings p ON p.id = s.job_id
  GROUP BY p.company_id
),
scored AS (
  SELECT
    c.id                                     AS company_id,
    c.ats_provider,
    c.ats_board_token,
    c.inferred_name,
    c.discovered_at,
    c.last_crawled_at,
    COALESCE(j.active_jobs, 0)               AS active_jobs,
    COALESCE(j.total_jobs, 0)                AS total_jobs,
    j.latest_job_seen,
    round(j.avg_days_to_fill::numeric, 1)    AS avg_days_to_fill,
    COALESCE(g.founding_signals, 0)          AS founding_signals,
    COALESCE(g.stealth_signals, 0)           AS stealth_signals,
    COALESCE(g.scaled_org_functions, 0)      AS scaled_org_functions,
    COALESCE(g.distinct_tech, 0)             AS distinct_tech,

    LEAST(COALESCE(g.founding_signals, 0), 5) * 10             AS pts_founding,
    LEAST(COALESCE(g.stealth_signals, 0), 3) * 10              AS pts_stealth,
    CASE
      WHEN COALESCE(j.active_jobs, 0) = 0                THEN   0
      WHEN j.active_jobs BETWEEN 1  AND 10               THEN  20
      WHEN j.active_jobs BETWEEN 11 AND 25               THEN  10
      WHEN j.active_jobs BETWEEN 26 AND 50               THEN   0
      ELSE                                                    -30
    END                                                        AS pts_size,
    CASE
      WHEN j.latest_job_seen >= now() - interval '30 days' THEN 10
      WHEN j.latest_job_seen >= now() - interval '90 days' THEN  5
      ELSE                                                       0
    END                                                        AS pts_recency,
    CASE
      WHEN j.avg_days_to_fill IS NULL      THEN 0
      WHEN j.avg_days_to_fill <= 21        THEN 10
      WHEN j.avg_days_to_fill <= 45        THEN  5
      ELSE                                       0
    END                                                        AS pts_velocity,
    -- One corporate function is normal for an early company making its first
    -- commercial hire. Three or more is a company with departments.
    CASE
      WHEN COALESCE(g.scaled_org_functions, 0) >= 4 THEN -30
      WHEN     g.scaled_org_functions          =  3 THEN -20
      WHEN     g.scaled_org_functions          =  2 THEN -10
      ELSE                                                0
    END                                                        AS pts_scaled_org
  FROM sourcing_companies c
  LEFT JOIN job_agg j ON j.company_id = c.id
  LEFT JOIN sig_agg g ON g.company_id = c.id
)
SELECT
  scored.*,
  GREATEST(0, LEAST(100,
    pts_founding + pts_stealth + pts_size + pts_recency + pts_velocity + pts_scaled_org
  )) AS fomo_score
FROM scored;

COMMENT ON VIEW sourcing_fomo_scores IS
  'Per-company FOMO ranking. pts_* columns are exposed beside fomo_score so any rank can be explained. Two inverse signals keep incumbents out: open-role count (a 500-role board is not a startup) and scaled_org_functions (a company with sales, support, finance and compliance orgs has departments).';

GRANT SELECT ON sourcing_fomo_scores TO authenticated;
GRANT ALL    ON sourcing_fomo_scores TO service_role;
REVOKE ALL   ON sourcing_fomo_scores FROM anon;
