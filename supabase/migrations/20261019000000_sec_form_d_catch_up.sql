-- =============================================================================
-- Migration: SEC Form D — catch-up worker, full daily coverage, backfill
-- Created:   2026-10-19
-- Description:
--   Since it was scheduled, ingest-sec-form-d ran at 00:10 UTC for
--   "yesterday". EDGAR builds a day's index from about 22:00 New York time
--   (02:00-03:00 UTC), so at 00:10 UTC the index did not exist yet: every
--   nightly run logged "empty" and the day was never retried. On top of that
--   a run read only the first 50 Form D filings of the day's index, which is
--   sorted by company name. Result: no SEC filings since the schedule began,
--   other than hand-started runs.
--
--   1. sec_form_d_days — one row per EDGAR business day: pending (backfill,
--      not started), waiting (index not published yet), in_progress,
--      complete, no_index (holiday). The worker re-checks the last 7 business
--      days on every run and works through any open day, newest first.
--   2. sec_form_d_seen — every Form D / D/A accession already handled, with
--      its outcome (company / fund / not_tech / no_name / doc_missing),
--      industry group and fund type. Lets a run resume mid-day, and is the
--      measurement table for tuning the industry scope later.
--   3. Backfill: every business day from 2026-07-21 (the last row the
--      manual deals script wrote) to yesterday, as pending.
--   4. pg_cron: every 10 minutes 04:00-13:50 UTC (was once at 00:10).
--   5. New-company alerts only for filings from the last 7 days, so the
--      backfill cannot announce August filings as news.
--   6. Health rule: SEC may now go 80h without new rows before the daily
--      check flags it (Saturday's ingest of Friday's index to Tuesday's of
--      Monday's is ~73h). A day-by-day completeness check replaces this in
--      the monitoring step.
--
-- Rollback: supabase/rollback/20261019000000_sec_form_d_catch_up_down.sql
-- Idempotent.
-- =============================================================================

-- ── 1. Days ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sec_form_d_days (
  index_date      date        PRIMARY KEY,
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'waiting', 'in_progress', 'complete', 'no_index')),
  filings_total   integer,
  last_attempt_at timestamptz,
  completed_at    timestamptz,
  note            text
);

COMMENT ON TABLE sec_form_d_days IS
  'EDGAR business days for the SEC Form D worker (ingest-sec-form-d): pending = not started (backfill), waiting = index not published yet, in_progress, complete, no_index = holiday. Re-open a day with UPDATE ... SET status = ''pending''.';

ALTER TABLE sec_form_d_days ENABLE ROW LEVEL SECURITY;   -- service role only

-- ── 2. Filings already handled ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sec_form_d_seen (
  accession      text        PRIMARY KEY,
  index_date     date        NOT NULL,
  form_type      text,
  entity_name    text,
  industry_group text,
  fund_type      text,
  outcome        text        NOT NULL CHECK (outcome IN ('company', 'fund', 'not_tech', 'no_name', 'doc_missing')),
  seen_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sec_form_d_seen_day ON sec_form_d_seen (index_date);

COMMENT ON TABLE sec_form_d_seen IS
  'Every Form D / D/A accession the worker has handled, and what it was: company (stored in raw_gov_filings, gated), fund (vc_fund_filings), not_tech, no_name, doc_missing. Transient failures are not recorded, so they are retried.';

ALTER TABLE sec_form_d_seen ENABLE ROW LEVEL SECURITY;   -- service role only

-- ── 3. Backfill ──────────────────────────────────────────────────────────────
INSERT INTO sec_form_d_days (index_date, status, note)
SELECT d::date, 'pending', 'backfill 2026-10-19'
  FROM generate_series(date '2026-07-21', current_date - 1, interval '1 day') d
 WHERE extract(isodow FROM d) < 6
ON CONFLICT (index_date) DO NOTHING;

-- ── 4. Schedule ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ingest-sec-form-d') THEN
    PERFORM cron.unschedule('ingest-sec-form-d');
  END IF;
END;
$$;

SELECT cron.schedule(
  'ingest-sec-form-d', '*/10 4-13 * * *',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/ingest-sec-form-d',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $cron$
);

-- ── 5. New-company alerts: recent filings only ──────────────────────────────
-- generate_live_alerts as in 20261017000000, plus one condition in section 4.
CREATE OR REPLACE FUNCTION generate_live_alerts(
  p_lookback_hours     integer DEFAULT 2,
  p_match_threshold    integer DEFAULT 85,
  p_velocity_min_stars integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  n_filing   integer;
  n_velocity integer;
  n_match    integer;
  n_company  integer;
BEGIN
  -- ── 1. Watchlist filing alerts ──────────────────────────────────────────
  WITH candidates AS (
    SELECT wi.user_id, f.id AS filing_id, f.source, f.entity_name, f.filing_date, f.startup_id
      FROM raw_gov_filings f
      JOIN watchlist_items wi
        ON wi.entity_type = 'startup' AND wi.entity_id = f.startup_id
     WHERE f.startup_id IS NOT NULL
       AND f.ingested_at >= now() - make_interval(hours => p_lookback_hours)
  ), inserted AS (
    INSERT INTO notifications (user_id, type, title, body, link, dedupe_key)
    SELECT
      c.user_id,
      'watchlist_filing',
      'New filing: ' || c.entity_name,
      c.entity_name || ' filed a new ' ||
        CASE c.source
          WHEN 'sec_form_d'          THEN 'SEC Form D'
          WHEN 'uk_companies_house'  THEN 'UK Companies House'
          WHEN 'uspto_patent'        THEN 'USPTO patent'
          WHEN 'epo_ops'             THEN 'EPO patent'
          ELSE c.source
        END || ' filing on ' || to_char(c.filing_date, 'Mon DD, YYYY') || '.',
      '/startups?company=' || c.startup_id::text,              -- CHANGED: was '/my-area'
      'filing:' || c.filing_id::text
    FROM candidates c
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_filing FROM inserted;

  -- ── 2. Watchlist GitHub velocity spikes ──────────────────────────────────
  WITH candidates AS (
    SELECT wi.user_id, v.project_id, v.name, v.stars, v.stars_delta_1d, v.last_observed_at, v.startup_id
      FROM oss_project_velocity v
      JOIN watchlist_items wi
        ON wi.entity_type = 'startup' AND wi.entity_id = v.startup_id
     WHERE v.startup_id IS NOT NULL
       AND v.stars_delta_1d IS NOT NULL
       AND v.stars_delta_1d >= p_velocity_min_stars
       AND v.last_observed_at >= now() - make_interval(hours => p_lookback_hours)
  ), inserted AS (
    INSERT INTO notifications (user_id, type, title, body, link, dedupe_key)
    SELECT
      c.user_id,
      'watchlist_velocity',
      c.name || ' is trending',
      c.name || ' gained ' || c.stars_delta_1d || ' GitHub stars in the last day (now ' || c.stars || ' total).',
      '/startups?company=' || c.startup_id::text,              -- CHANGED: was '/my-area'
      'velocity:' || c.project_id::text || ':' || c.last_observed_at::text
    FROM candidates c
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_velocity FROM inserted;

  -- ── 3. New high-match thesis alerts ──────────────────────────────────────
  -- Windowed on embedding_updated_at AND created_at within 14 days — see
  -- 20261003000000 and 20261015000000.
  WITH candidates AS (
    SELECT
      pv.user_id, s.id AS startup_id, s.name,
      GREATEST(0, LEAST(100, round((1 - (s.embedding <=> pv.embedding)) * 100)))::integer AS match_pct
    FROM startups s
    JOIN user_preference_vectors pv ON pv.signal_count >= 3
   WHERE s.embedding IS NOT NULL
     AND s.embedding_updated_at >= now() - make_interval(hours => p_lookback_hours)
     AND s.created_at >= now() - interval '14 days'
     AND NOT EXISTS (
       SELECT 1 FROM watchlist_items wi
        WHERE wi.user_id = pv.user_id AND wi.entity_type = 'startup' AND wi.entity_id = s.id)
     AND NOT EXISTS (
       SELECT 1 FROM user_interactions ui
        WHERE ui.user_id = pv.user_id AND ui.startup_id = s.id AND ui.action_type = 'pass')
     -- NEW: not if this user was already told about the company as a new
     -- candidate — approval turning it into a startups row is not news twice.
     AND NOT EXISTS (
       SELECT 1 FROM company_candidates cc
         JOIN notifications n ON n.user_id = pv.user_id AND n.dedupe_key = 'candidate:' || cc.id::text
        WHERE cc.startup_id = s.id)
  ), qualifying AS (
    SELECT * FROM candidates WHERE match_pct >= p_match_threshold
  ), inserted AS (
    INSERT INTO notifications (user_id, type, title, body, link, dedupe_key)
    SELECT
      q.user_id,
      'thesis_match',
      'New ' || q.match_pct || '% match: ' || q.name,
      q.name || ' was just added and matches ' || q.match_pct || '% of your investment thesis.',
      '/startups?company=' || q.startup_id::text,              -- CHANGED: was '/my-area?tab=matches'
      'thesis_match:' || q.startup_id::text
    FROM qualifying q
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_match FROM inserted;

  -- ── 4. NEW: new companies found by the sourcing engine ──────────────────
  -- Alert-tier, not rejected, seen in the window (last_seen_at, so a queue
  -- candidate later upgraded to alert by a new filing is caught too; the
  -- dedupe key makes every later sighting a no-op).
  WITH pairs AS (
    SELECT u.id AS user_id, c.id, c.source, c.name, c.evidence,
           candidate_sector(c.source, c.name, c.evidence) AS sector
      FROM company_candidates c
      CROSS JOIN auth.users u
     WHERE c.gate_tier = 'alert'
       AND c.status <> 'rejected'
       AND c.last_seen_at >= now() - make_interval(hours => p_lookback_hours)
       -- NEW (20261019000000): only for a filing from the last 7 days. The
       -- SEC catch-up backfills filings back to July; a company that filed
       -- in August is not "new" today, and must not reach users' bells as such.
       AND EXISTS (SELECT 1 FROM raw_gov_filings f
                    WHERE f.candidate_id = c.id AND f.filing_date >= current_date - 7)
       AND candidate_alert_wanted(u.id, c)
  ), inserted AS (
    INSERT INTO notifications (user_id, type, title, body, link, dedupe_key)
    SELECT
      p.user_id,
      'new_company',
      'New company: ' || p.name,
      CASE p.source
        WHEN 'sec_form_d' THEN
          p.name || ' filed an SEC Form D'
            || coalesce(' to raise ' || format_usd_short(
                 CASE WHEN (p.evidence->>'total_offering') ~ '^[0-9]+(\.[0-9]+)?$'
                      THEN (p.evidence->>'total_offering')::numeric END), '')
            || coalesce(' (' || coalesce(p.sector, p.evidence->>'industry_group') || ')', '') || '.'
        ELSE
          p.name || ' was just registered at UK Companies House'
            || coalesce(' (' || p.sector || ')', '') || '.'
      END || ' Not yet reviewed by AlphaMap.',
      '/candidates/' || p.id::text,
      'candidate:' || p.id::text
    FROM pairs p
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_company FROM inserted;

  RETURN jsonb_build_object(
    'watchlist_filing_alerts',   n_filing,
    'watchlist_velocity_alerts', n_velocity,
    'thesis_match_alerts',       n_match,
    'new_company_alerts',        n_company
  );
END;
$$;

-- ── 6. Health rule ───────────────────────────────────────────────────────────
UPDATE source_expectations
   SET max_age_hours = 80,
       note = 'every 10 min 04:00-13:50 UTC, catch-up worker (sec_form_d_days); a business day is ingested the next morning'
 WHERE source = 'sec_form_d';
