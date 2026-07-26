-- =============================================================================
-- Migration: FOMO scoring — count GTM-maturity functions in the scaled-org term
-- Created:   2026-07-26
-- Description:
--   The first genuinely non-incumbent crawl (oak, 13 openings on Ashby) scored
--   20 and ranked ABOVE Stripe. Reading its titles showed that was wrong:
--
--     Enterprise Account Executive - Central
--     Enterprise Account Executive - East Coast
--     Enterprise Solutions Engineer - Central / East / West
--     Cloud & Tech Alliances Lead
--     Senior {AI,Backend,Data,DevOps} Engineer, Senior PM, Senior Researcher
--
--   Territory-segmented enterprise sales, a pre-sales Solutions Engineering
--   function, a partnerships lead, and no role below Senior. That is a
--   Series-B-and-later go-to-market org that happens to have a small current
--   requisition count — not an under-the-radar startup.
--
--   The lesson is that ACTIVE JOB COUNT IS A WEAK PROXY FOR STAGE. A funded
--   company in a hiring freeze and a stealth startup both post ~13 roles. What
--   actually separates them is the SHAPE of the roles.
--
--   So the extractor now also emits 'Enterprise GTM', 'Territory Org' and
--   'Partnerships Org', and this migration folds them into the same
--   distinct-function penalty. oak trips several, which pulls it down to where
--   it belongs.
--
-- Rollback: supabase/rollback/20260726060000_fomo_gtm_signals_down.sql
--
-- Idempotent.
-- =============================================================================

CREATE OR REPLACE VIEW sourcing_fomo_scores AS
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
    -- Eight functions now. DISTINCT still, so five Account Executive postings
    -- remain ONE sales org rather than five strikes.
    count(DISTINCT s.signal_value) FILTER (
      WHERE s.signal_type = 'keyword'
        AND s.signal_value IN ('Sales Org', 'Customer Org', 'Finance Org', 'People Org',
                               'Compliance Org', 'Enterprise GTM', 'Territory Org', 'Partnerships Org')
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
  'Per-company FOMO ranking. pts_* columns exposed beside fomo_score so any rank can be explained. Open-role count is a WEAK stage proxy and is deliberately outweighed by scaled_org_functions, which counts distinct corporate/GTM functions (sales, customer, finance, people, compliance, enterprise GTM, territory, partnerships) — the shape of the roles separates stages far better than the number of them.';

GRANT SELECT ON sourcing_fomo_scores TO authenticated;
GRANT ALL    ON sourcing_fomo_scores TO service_role;
REVOKE ALL   ON sourcing_fomo_scores FROM anon;
