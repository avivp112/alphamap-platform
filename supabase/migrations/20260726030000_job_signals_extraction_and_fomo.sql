-- =============================================================================
-- Migration: signal-extraction bookkeeping + FOMO scoring view
-- Created:   2026-07-26
-- Description:
--   Two things the signal extractor needs.
--
--   1. early_job_postings.signals_extracted_at
--      Lets the extractor process only postings it has not seen. Without it
--      every run rescans the whole table — already 536 rows from a single
--      board, so this matters immediately, not eventually. NULL = pending.
--      Setting it to NULL again is how you force a re-extraction after the
--      taxonomy changes.
--
--   2. sourcing_fomo_scores (view)
--      Ranks companies by how much they look like an under-the-radar company
--      worth a first conversation.
--
--      The scoring is deliberately a plain arithmetic view, not a model: every
--      term is inspectable in SQL, and the component columns are exposed
--      alongside the total so a score can always be explained rather than
--      just trusted.
--
--      The load-bearing idea is that HEADCOUNT OF OPEN ROLES IS AN INVERSE
--      SIGNAL. A company advertising 500 roles is not stealth — it is Stripe.
--      A company advertising three, one of which is a Founding Engineer, is
--      the entire point of this product. So a large board is penalised hard
--      and a small one rewarded.
--
-- Rollback: supabase/rollback/20260726030000_job_signals_extraction_and_fomo_down.sql
--
-- Idempotent; safe to run more than once.
-- =============================================================================

-- ── 1. Extraction bookkeeping ───────────────────────────────────────────────

ALTER TABLE early_job_postings
  ADD COLUMN IF NOT EXISTS signals_extracted_at timestamptz;

COMMENT ON COLUMN early_job_postings.signals_extracted_at IS
  'When signals were last extracted from this posting. NULL = pending. Set to NULL to force re-extraction after a taxonomy change.';

-- The extractor''s work queue: pending rows only, so the index stays tiny even
-- as the table grows into the millions.
CREATE INDEX IF NOT EXISTS idx_early_job_postings_signals_pending
  ON early_job_postings (first_seen_at)
  WHERE signals_extracted_at IS NULL;

-- ── 2. FOMO scoring ─────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW sourcing_fomo_scores AS
WITH job_agg AS (
  SELECT
    company_id,
    count(*) FILTER (WHERE is_active)                          AS active_jobs,
    count(*)                                                   AS total_jobs,
    max(first_seen_at)                                         AS latest_job_seen,
    -- Only closed postings carry a fill time. A company that fills roles fast
    -- is hiring with urgency, which is itself a momentum signal.
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
    count(DISTINCT s.signal_value) FILTER (WHERE s.signal_type = 'tech_stack')
                                                               AS distinct_tech
  FROM job_signals s
  JOIN early_job_postings p ON p.id = s.job_id
  GROUP BY p.company_id
)
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
  COALESCE(g.distinct_tech, 0)             AS distinct_tech,

  -- ── Score components, exposed so a rank can be explained ──────────────────
  -- Founding/first-hire roles: the strongest single tell that a company is at
  -- the stage worth catching. Capped so one company cannot run away with it.
  LEAST(COALESCE(g.founding_signals, 0), 5) * 10                       AS pts_founding,
  -- Explicit stealth / early-stage language in the title.
  LEAST(COALESCE(g.stealth_signals, 0), 3) * 10                        AS pts_stealth,
  -- Board size, inverted. This is what keeps Stripe off the list.
  CASE
    WHEN COALESCE(j.active_jobs, 0) = 0                THEN   0
    WHEN j.active_jobs BETWEEN 1  AND 10               THEN  20
    WHEN j.active_jobs BETWEEN 11 AND 25               THEN  10
    WHEN j.active_jobs BETWEEN 26 AND 50               THEN   0
    ELSE                                                    -30
  END                                                                  AS pts_size,
  -- Actively hiring right now, not a board last touched a year ago.
  CASE
    WHEN j.latest_job_seen >= now() - interval '30 days' THEN 10
    WHEN j.latest_job_seen >= now() - interval '90 days' THEN  5
    ELSE                                                       0
  END                                                                  AS pts_recency,
  -- Filling roles quickly = urgency. Only meaningful once something closed.
  CASE
    WHEN j.avg_days_to_fill IS NULL      THEN 0
    WHEN j.avg_days_to_fill <= 21        THEN 10
    WHEN j.avg_days_to_fill <= 45        THEN  5
    ELSE                                       0
  END                                                                  AS pts_velocity,

  -- ── Total, clamped to 0..100 ─────────────────────────────────────────────
  GREATEST(0, LEAST(100,
      LEAST(COALESCE(g.founding_signals, 0), 5) * 10
    + LEAST(COALESCE(g.stealth_signals, 0), 3) * 10
    + CASE
        WHEN COALESCE(j.active_jobs, 0) = 0  THEN   0
        WHEN j.active_jobs BETWEEN 1  AND 10 THEN  20
        WHEN j.active_jobs BETWEEN 11 AND 25 THEN  10
        WHEN j.active_jobs BETWEEN 26 AND 50 THEN   0
        ELSE                                      -30
      END
    + CASE
        WHEN j.latest_job_seen >= now() - interval '30 days' THEN 10
        WHEN j.latest_job_seen >= now() - interval '90 days' THEN  5
        ELSE                                                       0
      END
    + CASE
        WHEN j.avg_days_to_fill IS NULL THEN 0
        WHEN j.avg_days_to_fill <= 21   THEN 10
        WHEN j.avg_days_to_fill <= 45   THEN  5
        ELSE                                  0
      END
  ))                                                                   AS fomo_score
FROM sourcing_companies c
LEFT JOIN job_agg j ON j.company_id = c.id
LEFT JOIN sig_agg g ON g.company_id = c.id;

COMMENT ON VIEW sourcing_fomo_scores IS
  'Per-company FOMO ranking. Component pts_* columns are exposed alongside fomo_score so any rank can be explained. Open-role count is an INVERSE signal — a 500-role board is an incumbent, not a stealth startup.';

-- Same access model as the underlying tables: proprietary, authenticated read.
GRANT SELECT ON sourcing_fomo_scores TO authenticated;
GRANT ALL    ON sourcing_fomo_scores TO service_role;
REVOKE ALL   ON sourcing_fomo_scores FROM anon;
