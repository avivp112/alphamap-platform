-- =============================================================================
-- DOWN migration for 20260726170000_split_patent_ip_score.sql
--
-- Restores the 20260726120000 view: one pts_inception term taking
-- min(filing_date) across ALL government sources, and no pts_ip.
--
-- BE CLEAR ABOUT WHAT THIS REINSTATES. It is not a neutral older version — it
-- is the bug. With a fresh Form D 90 days old, measured on PostgreSQL 16:
--
--     patent  200 days old -> pts_inception 15   (should be 25)
--     patent  400 days old -> pts_inception  5   (should be 25)
--     patent 1200 days old -> pts_inception  0   (should be 25)
--
-- Every company holding both a patent and a recent raise is under-scored, and
-- nothing errors. Roll back only to unblock something else, and go forward
-- again quickly.
--
-- Deliberately NOT in supabase/migrations/ — the CLI would run it as a forward
-- migration.
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
gov_agg AS (
  SELECT
    startup_id,
    min(filing_date)  AS first_filing_date,
    max(filing_date)  AS latest_filing_date,
    count(*)          AS gov_filings
  FROM raw_gov_filings
  WHERE startup_id IS NOT NULL
  GROUP BY startup_id
),
scored AS (
  SELECT
    c.id                                     AS company_id,
    c.ats_provider,
    c.ats_board_token,
    c.inferred_name,
    c.startup_id,
    c.discovered_at,
    c.last_crawled_at,
    st.founded_year,
    (EXTRACT(YEAR FROM now())::int - st.founded_year)          AS company_age_years,
    gv.first_filing_date,
    gv.latest_filing_date,
    COALESCE(gv.gov_filings, 0)              AS gov_filings,
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
    END                                                        AS pts_scaled_org,
    CASE
      WHEN st.founded_year IS NULL                                   THEN   0
      WHEN EXTRACT(YEAR FROM now())::int - st.founded_year <= 2      THEN  20
      WHEN EXTRACT(YEAR FROM now())::int - st.founded_year <= 4      THEN  10
      WHEN EXTRACT(YEAR FROM now())::int - st.founded_year <= 7      THEN   0
      ELSE                                                                -10
    END                                                        AS pts_age,
    CASE
      WHEN gv.first_filing_date IS NULL                               THEN   0
      WHEN gv.first_filing_date >= current_date - INTERVAL '180 days' THEN  25
      WHEN gv.first_filing_date >= current_date - INTERVAL '365 days' THEN  15
      WHEN gv.first_filing_date >= current_date - INTERVAL '730 days' THEN   5
      ELSE                                                                   0
    END                                                        AS pts_inception
  FROM sourcing_companies c
  LEFT JOIN job_agg  j  ON j.company_id  = c.id
  LEFT JOIN sig_agg  g  ON g.company_id  = c.id
  LEFT JOIN startups st ON st.id         = c.startup_id
  LEFT JOIN gov_agg  gv ON gv.startup_id = c.startup_id
)
SELECT
  scored.*,
  GREATEST(0, LEAST(100,
    pts_founding + pts_stealth + pts_size + pts_recency
    + pts_velocity + pts_scaled_org + pts_age + pts_inception
  )) AS fomo_score
FROM scored;

GRANT SELECT ON sourcing_fomo_scores TO authenticated;
GRANT ALL    ON sourcing_fomo_scores TO service_role;
REVOKE ALL   ON sourcing_fomo_scores FROM anon;
