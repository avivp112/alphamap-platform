-- =============================================================================
-- DOWN migration for 20260726120000_form_d_pipeline.sql
--
-- RUN THIS BEFORE 20260726110000_raw_gov_filings_down.sql — both views below
-- reference raw_gov_filings, so dropping the table first would fail.
--
-- Restores board_discovery_candidates to its 20260726090000 form (website
-- required, no slug column) and sourcing_fomo_scores to its 20260726070000
-- form (no pts_inception), then drops the Form D functions.
--
-- Data in raw_gov_filings is NOT touched here. Neither is anything written into
-- startups: founded_year values sourced from Form D stay, because they are
-- correct facts regardless of which pipeline layer put them there. Undo those
-- by hand if that is really what you want:
--   UPDATE startups s SET founded_year = NULL
--    WHERE EXISTS (SELECT 1 FROM raw_gov_filings f WHERE f.startup_id = s.id);
--
-- Deliberately NOT in supabase/migrations/ — the CLI would run it as a forward
-- migration and immediately undo the migration it reverses.
-- =============================================================================

DROP VIEW IF EXISTS board_discovery_candidates;

CREATE VIEW board_discovery_candidates AS
SELECT
  s.id                                                       AS startup_id,
  s.name,
  s.website,
  s.industry,
  COALESCE(sec.name, classify_sector_parent(s.industry))     AS sector_parent,
  classify_company_archetype(s.id)->>'archetype'             AS archetype,
  s.founded_year,
  s.created_at
FROM startups s
LEFT JOIN sectors sec ON sec.id = s.sector_id
WHERE
  s.website IS NOT NULL
  AND btrim(s.website) <> ''
  AND s.board_discovery_at IS NULL
  AND classify_company_archetype(s.id)->>'archetype' <> 'mature_private'
  AND (
        COALESCE(sec.name, classify_sector_parent(s.industry)) <> 'Uncategorized'
     OR s.industry IS NULL
     OR btrim(s.industry) = ''
  )
  AND NOT EXISTS (
    SELECT 1 FROM sourcing_companies sc
     WHERE sc.startup_id = s.id
        OR (sc.inferred_name IS NOT NULL
            AND lower(btrim(sc.inferred_name)) = lower(btrim(s.name)))
  );

GRANT SELECT ON board_discovery_candidates TO authenticated;
GRANT ALL    ON board_discovery_candidates TO service_role;
REVOKE ALL   ON board_discovery_candidates FROM anon;

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
    END                                                        AS pts_age
  FROM sourcing_companies c
  LEFT JOIN job_agg j  ON j.company_id = c.id
  LEFT JOIN sig_agg g  ON g.company_id = c.id
  LEFT JOIN startups st ON st.id = c.startup_id
)
SELECT
  scored.*,
  GREATEST(0, LEAST(100,
    pts_founding + pts_stealth + pts_size + pts_recency
    + pts_velocity + pts_scaled_org + pts_age
  )) AS fomo_score
FROM scored;

GRANT SELECT ON sourcing_fomo_scores TO authenticated;
GRANT ALL    ON sourcing_fomo_scores TO service_role;
REVOKE ALL   ON sourcing_fomo_scores FROM anon;

DROP FUNCTION IF EXISTS ingest_form_d_filing(text,text,text,text,date,integer,text,text,jsonb,text,numeric,numeric,jsonb);
DROP FUNCTION IF EXISTS gov_company_slug(text);
