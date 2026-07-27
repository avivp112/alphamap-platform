-- =============================================================================
-- Migration: split patent evidence out of pts_inception into pts_ip
-- Created:   2026-07-26
-- Description:
--   pts_inception was built for Form D, where a filing date means the money
--   arrived days ago. Once the patent layer started writing to raw_gov_filings
--   it began receiving three different clocks through one min():
--
--     sec_form_d          filing date  ->  money arrived days ago
--     uk_companies_house  date_of_creation -> genuinely day zero
--     epo_ops             PUBLICATION date -> the work was filed ~18 MONTHS AGO
--
--   A patent published last week describes an invention from early 2025.
--   Scoring that 25 points as "inception" says something false.
--
-- ── THE min() WAS WORSE THAN THE LAG ────────────────────────────────────────
--   Because the term took min(filing_date) across ALL sources, a company with
--   an old patent AND a recent Form D took the PATENT date and scored ZERO. The
--   newer, stronger signal lost to the older, weaker one — precisely backwards,
--   and silent. Companies that had just raised were ranked as though nothing
--   had happened.
--
-- ── WHY A SEPARATE TERM RATHER THAN A CORRECTION FACTOR ─────────────────────
--   Shifting patent dates forward 18 months to "undo" the lag would make the
--   arithmetic work and the meaning still wrong. "This company just
--   incorporated" and "this company holds recent deep-tech IP" are different
--   claims. A leaderboard that cannot tell them apart cannot be trusted to
--   explain itself, and every pts_* column in this view exists so a rank can be
--   explained.
--
--   So: pts_inception keeps the two day-zero sources, pts_ip takes the patent
--   sources, and both appear beside fomo_score.
--
-- ── min() FOR INCEPTION, max() FOR IP ───────────────────────────────────────
--   Deliberately asymmetric. The FIRST government filing is a birth
--   certificate — a company filing since 2019 is not an inception story however
--   recent its newest document. The LATEST publication is the opposite
--   question: is this company still producing patentable work? An outfit whose
--   most recent publication is four years old has stopped.
--
-- ── SCALE ───────────────────────────────────────────────────────────────────
--   pts_ip caps at 15 against pts_inception's 25. Holding IP is weaker evidence
--   of STAGE than having just incorporated or just raised — a fifteen-year-old
--   company can publish a patent next week. It earns points; it does not
--   outweigh the thing this engine is actually looking for.
--
-- Rollback: supabase/rollback/20260726170000_split_patent_ip_score_down.sql
-- Tests:    supabase/tests/fomo_scoring.test.sql
--
-- Idempotent.
-- =============================================================================

-- DROP then CREATE, not CREATE OR REPLACE: replace can only APPEND columns and
-- pts_ip lands mid-list. Fifth revision of this view, same trap each time.
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
-- Day-zero registries ONLY. min() because the first one is the birth
-- certificate. Patent sources are deliberately absent — see the header.
inception_agg AS (
  SELECT
    startup_id,
    min(filing_date)  AS first_filing_date,
    max(filing_date)  AS latest_filing_date,
    count(*)          AS gov_filings
  FROM raw_gov_filings
  WHERE startup_id IS NOT NULL
    AND source IN ('sec_form_d', 'uk_companies_house')
  GROUP BY startup_id
),
-- Patent sources ONLY. max() because the question is whether the company is
-- STILL producing, not when it started.
ip_agg AS (
  SELECT
    startup_id,
    max(filing_date)  AS latest_patent_date,
    min(filing_date)  AS first_patent_date,
    count(*)          AS patent_count,
    -- Distinct CPC subclasses across all of a company's publications: breadth
    -- of technical footprint rather than volume, which the ingester's frequency
    -- cap has already bounded.
    count(DISTINCT left(c.code, 4)) AS distinct_cpc
  FROM raw_gov_filings f
  LEFT JOIN LATERAL unnest(coalesce(f.classification_codes, '{}')) AS c(code) ON true
  WHERE f.startup_id IS NOT NULL
    AND f.source IN ('epo_ops', 'uspto_patent')
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
    ip.first_patent_date,
    ip.latest_patent_date,
    COALESCE(ip.patent_count, 0)             AS patent_count,
    COALESCE(ip.distinct_cpc, 0)             AS distinct_cpc,
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

    -- Inception: the first appearance on a day-zero register. A Form D means
    -- money arrived days ago; a Companies House record means the company was
    -- incorporated. Both are what this term was built to mean.
    --
    -- Never a penalty when absent: only US issuers of exempt offerings and UK
    -- incorporations appear here at all, so a zero may simply mean the company
    -- is neither.
    CASE
      WHEN gv.first_filing_date IS NULL                               THEN   0
      WHEN gv.first_filing_date >= current_date - INTERVAL '180 days' THEN  25
      WHEN gv.first_filing_date >= current_date - INTERVAL '365 days' THEN  15
      WHEN gv.first_filing_date >= current_date - INTERVAL '730 days' THEN   5
      ELSE                                                                   0
    END                                                        AS pts_inception,

    -- IP: recent deep-tech patent activity. Scored on the LATEST publication
    -- because the question is whether the company is still producing.
    --
    -- The windows are wider than inception's on purpose. A publication trails
    -- its filing by roughly eighteen months, so "published within a year" means
    -- "was inventing about two years ago" — real evidence of technical depth,
    -- and weaker evidence about stage than a fresh incorporation. Hence a
    -- ceiling of 15 against inception's 25: it contributes, it does not
    -- outrank the thing this engine exists to find.
    --
    -- A second point for breadth, not volume: publications spread across two or
    -- more CPC subclasses indicate a company building a technical footprint
    -- rather than defending a single mechanism. Volume is deliberately not
    -- rewarded — the ingester's frequency cap already treats it as a corporate
    -- tell, and paying for it here would fight that.
    (
      CASE
        WHEN ip.latest_patent_date IS NULL                                THEN 0
        WHEN ip.latest_patent_date >= current_date - INTERVAL '365 days'  THEN 10
        WHEN ip.latest_patent_date >= current_date - INTERVAL '730 days'  THEN  6
        WHEN ip.latest_patent_date >= current_date - INTERVAL '1095 days' THEN  3
        ELSE                                                                    0
      END
      +
      CASE WHEN COALESCE(ip.distinct_cpc, 0) >= 2 THEN 5 ELSE 0 END
    )                                                          AS pts_ip
  FROM sourcing_companies c
  LEFT JOIN job_agg       j  ON j.company_id  = c.id
  LEFT JOIN sig_agg       g  ON g.company_id  = c.id
  LEFT JOIN startups      st ON st.id         = c.startup_id
  LEFT JOIN inception_agg gv ON gv.startup_id = c.startup_id
  LEFT JOIN ip_agg        ip ON ip.startup_id = c.startup_id
)
SELECT
  scored.*,
  GREATEST(0, LEAST(100,
    pts_founding + pts_stealth + pts_size + pts_recency
    + pts_velocity + pts_scaled_org + pts_age + pts_inception + pts_ip
  )) AS fomo_score
FROM scored;

COMMENT ON VIEW sourcing_fomo_scores IS
  'Per-company FOMO ranking. Every pts_* component is exposed beside fomo_score so a rank can be explained. pts_inception reads ONLY the day-zero registries (Form D, Companies House) on min(); pts_ip reads ONLY the patent sources on max(), because a publication trails its filing by ~18 months and answers a different question — is this company still producing, not when did it start. Blending them through one min() let an old patent suppress a fresh Form D.';

GRANT SELECT ON sourcing_fomo_scores TO authenticated;
GRANT ALL    ON sourcing_fomo_scores TO service_role;
REVOKE ALL   ON sourcing_fomo_scores FROM anon;
