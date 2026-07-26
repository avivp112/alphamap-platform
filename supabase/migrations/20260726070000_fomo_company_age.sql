-- =============================================================================
-- Migration: link sourcing_companies -> startups, and score company age
-- Created:   2026-07-26
-- Description:
--   Two changes so founding date can influence the FOMO ranking.
--
--   1. sourcing_companies.startup_id
--      There was no join path from a crawled board to the company record that
--      holds the founding year. Nullable FK, ON DELETE SET NULL: losing the
--      startup row should orphan the link, never delete the sourcing history.
--
--      Backfilled by exact case-insensitive name match, and ONLY where the
--      match is unambiguous. A name matching two startups is left NULL rather
--      than guessed — a wrong link would attribute another company's founding
--      year to this board and silently skew its score.
--
--   2. A company-age term in the scoring view.
--
--      NOTE ON THE COLUMN: the request mentioned `founded_at`. No such column
--      exists — it is `startups.founded_year`, an INTEGER YEAR. So age is
--      year-granular: a company founded in January and one founded in December
--      of the same year are indistinguishable here. Good enough for a stage
--      signal, not precise enough for anything finer.
--
--      Unknown age scores ZERO, not a penalty. Most sourcing_companies rows
--      will have no startup_id at all, and punishing them would rank every
--      newly discovered board below every enriched one — the exact opposite of
--      what a discovery tool should do.
--
-- Rollback: supabase/rollback/20260726070000_fomo_company_age_down.sql
--
-- Idempotent.
-- =============================================================================

ALTER TABLE sourcing_companies
  ADD COLUMN IF NOT EXISTS startup_id uuid REFERENCES startups (id) ON DELETE SET NULL;

COMMENT ON COLUMN sourcing_companies.startup_id IS
  'Optional link to the enriched startups row, used to read founded_year for age scoring. NULL when the board has not been matched to a known company.';

CREATE INDEX IF NOT EXISTS idx_sourcing_companies_startup_id
  ON sourcing_companies (startup_id)
  WHERE startup_id IS NOT NULL;

-- Backfill: exact, case-insensitive, UNAMBIGUOUS name matches only.
UPDATE sourcing_companies sc
   SET startup_id = m.id
  FROM (
    -- (array_agg(id))[1] rather than min(id): Postgres has no min() for uuid,
    -- and HAVING count(*) = 1 guarantees the array holds exactly one element.
    SELECT lower(btrim(name)) AS key, (array_agg(id))[1] AS id
      FROM startups
     WHERE name IS NOT NULL AND btrim(name) <> ''
     GROUP BY lower(btrim(name))
    HAVING count(*) = 1            -- ambiguous names are skipped on purpose
  ) m
 WHERE sc.startup_id IS NULL
   AND sc.inferred_name IS NOT NULL
   AND lower(btrim(sc.inferred_name)) = m.key;

-- ── Scoring view, now with pts_age ──────────────────────────────────────────
-- DROP then CREATE, not CREATE OR REPLACE: replace can only APPEND columns,
-- and startup_id / founded_year / company_age_years land mid-list. Same trap
-- as the scaled-org migration. A view holds no data, so dropping is free.

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
    -- NULL when founding year is unknown, which is most rows.
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
    -- Company age. Unknown = 0, never a penalty: a board we have not yet
    -- matched to a startup row must not rank below an enriched incumbent.
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

COMMENT ON VIEW sourcing_fomo_scores IS
  'Per-company FOMO ranking. Every pts_* component is exposed beside fomo_score so a rank can be explained. Positive: founding/stealth signals, small board, recent activity, fast fills, young company. Negative: large board and distinct scaled corporate/GTM functions. Unknown founding year scores 0, never a penalty.';

GRANT SELECT ON sourcing_fomo_scores TO authenticated;
GRANT ALL    ON sourcing_fomo_scores TO service_role;
REVOKE ALL   ON sourcing_fomo_scores FROM anon;
