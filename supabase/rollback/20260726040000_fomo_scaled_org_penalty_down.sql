-- =============================================================================
-- ROLLBACK for: 20260726040000_fomo_scaled_org_penalty.sql
--
-- Outside supabase/migrations/ on purpose. Run deliberately:
--   psql "$DATABASE_URL" -f supabase/rollback/20260726040000_fomo_scaled_org_penalty_down.sql
--
-- Drops the scaled-org penalty and restores the view to its 20260726030000
-- shape (no scaled_org_functions column, no pts_scaled_org term). The
-- 'Sales Org' / 'Customer Org' / ... rows already written to job_signals are
-- left alone — they are harmless once nothing reads them, and re-deriving
-- them would mean a full re-extraction.
-- =============================================================================

DROP VIEW IF EXISTS sourcing_fomo_scores;

CREATE VIEW sourcing_fomo_scores AS
WITH job_agg AS (
  SELECT company_id,
         count(*) FILTER (WHERE is_active) AS active_jobs,
         count(*)                          AS total_jobs,
         max(first_seen_at)                AS latest_job_seen,
         avg(EXTRACT(EPOCH FROM (closed_at - first_seen_at)) / 86400.0)
           FILTER (WHERE closed_at IS NOT NULL) AS avg_days_to_fill
  FROM early_job_postings GROUP BY company_id
),
sig_agg AS (
  SELECT p.company_id,
         count(*) FILTER (WHERE s.signal_type='seniority'
           AND s.signal_value IN ('Founding','Co-Founder','First Hire')) AS founding_signals,
         count(*) FILTER (WHERE s.signal_type='keyword'
           AND s.signal_value IN ('Stealth','Founding Team','Zero to One','Greenfield','Early Stage')) AS stealth_signals,
         count(DISTINCT s.signal_value) FILTER (WHERE s.signal_type='tech_stack') AS distinct_tech
  FROM job_signals s JOIN early_job_postings p ON p.id = s.job_id
  GROUP BY p.company_id
)
SELECT
  c.id AS company_id, c.ats_provider, c.ats_board_token, c.inferred_name,
  c.discovered_at, c.last_crawled_at,
  COALESCE(j.active_jobs,0) AS active_jobs,
  COALESCE(j.total_jobs,0)  AS total_jobs,
  j.latest_job_seen,
  round(j.avg_days_to_fill::numeric,1) AS avg_days_to_fill,
  COALESCE(g.founding_signals,0) AS founding_signals,
  COALESCE(g.stealth_signals,0)  AS stealth_signals,
  COALESCE(g.distinct_tech,0)    AS distinct_tech,
  LEAST(COALESCE(g.founding_signals,0),5)*10 AS pts_founding,
  LEAST(COALESCE(g.stealth_signals,0),3)*10  AS pts_stealth,
  CASE WHEN COALESCE(j.active_jobs,0)=0 THEN 0
       WHEN j.active_jobs BETWEEN 1 AND 10 THEN 20
       WHEN j.active_jobs BETWEEN 11 AND 25 THEN 10
       WHEN j.active_jobs BETWEEN 26 AND 50 THEN 0
       ELSE -30 END AS pts_size,
  CASE WHEN j.latest_job_seen >= now()-interval '30 days' THEN 10
       WHEN j.latest_job_seen >= now()-interval '90 days' THEN 5 ELSE 0 END AS pts_recency,
  CASE WHEN j.avg_days_to_fill IS NULL THEN 0
       WHEN j.avg_days_to_fill <= 21 THEN 10
       WHEN j.avg_days_to_fill <= 45 THEN 5 ELSE 0 END AS pts_velocity,
  GREATEST(0, LEAST(100,
      LEAST(COALESCE(g.founding_signals,0),5)*10
    + LEAST(COALESCE(g.stealth_signals,0),3)*10
    + CASE WHEN COALESCE(j.active_jobs,0)=0 THEN 0
           WHEN j.active_jobs BETWEEN 1 AND 10 THEN 20
           WHEN j.active_jobs BETWEEN 11 AND 25 THEN 10
           WHEN j.active_jobs BETWEEN 26 AND 50 THEN 0
           ELSE -30 END
    + CASE WHEN j.latest_job_seen >= now()-interval '30 days' THEN 10
           WHEN j.latest_job_seen >= now()-interval '90 days' THEN 5 ELSE 0 END
    + CASE WHEN j.avg_days_to_fill IS NULL THEN 0
           WHEN j.avg_days_to_fill <= 21 THEN 10
           WHEN j.avg_days_to_fill <= 45 THEN 5 ELSE 0 END
  )) AS fomo_score
FROM sourcing_companies c
LEFT JOIN job_agg j ON j.company_id=c.id
LEFT JOIN sig_agg g ON g.company_id=c.id;

GRANT SELECT ON sourcing_fomo_scores TO authenticated;
GRANT ALL    ON sourcing_fomo_scores TO service_role;
REVOKE ALL   ON sourcing_fomo_scores FROM anon;
