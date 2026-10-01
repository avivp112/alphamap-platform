-- =============================================================================
-- Migration: fix_thesis_match_alert_embedding_timing
-- Created:   2026-10-03
-- Description:
--   Root cause of "connector-discovered companies never show up as a Live
--   Alert in My Area": generate_live_alerts()'s thesis-match branch
--   (20261002010000) gates candidates on
--
--     s.created_at >= now() - make_interval(hours => p_lookback_hours)
--
--   i.e. "was this startups row INSERTED in the last 2 hours". But a startup
--   discovered through ingest_gov_entity_filing() (UK Companies House, USPTO,
--   EPO, SEC Form D — 20260726220000) is created with NO embedding at all;
--   embedding/embedding_updated_at is only ever populated later, by a
--   completely separate, asynchronous step (scripts/backfill_embeddings.ts).
--   That script has no guaranteed SLA relative to row creation — it runs
--   whenever it's next invoked, which in practice is anywhere from minutes to
--   days after the row was inserted, depending on how often it's run.
--
--   Consequence: by the time `s.embedding IS NOT NULL` finally becomes true
--   for a newly-discovered company, `s.created_at` has almost always already
--   fallen outside the 2-hour lookback window. Both conditions in the
--   thesis-match WHERE clause are individually easy to satisfy, but the
--   WINDOW during which they're BOTH true simultaneously is typically empty —
--   so a "new high-match" thesis alert silently never fires for companies
--   discovered via these connectors, even when everything else (ingestion,
--   entity linking, embedding backfill) is working correctly.
--
--   The fix: key the lookback window off embedding_updated_at (when the
--   startup actually BECAME matchable) instead of created_at (when the row
--   was first inserted). This is the semantically correct check for "was
--   this startup newly added to the matchable corpus" — it fires exactly
--   once, in whichever 30-minute cron tick first observes the startup with a
--   fresh embedding, regardless of how long ago the row itself was created.
--   A company embedded the same hour it's created and one embedded three
--   weeks after creation are now treated identically: both get exactly one
--   shot at a "new match" alert, in the first run after their embedding
--   lands, which is the one point in time a user could not already have seen
--   the match.
--
--   NOTE: this is scoped to the alert-generation bug only. Two related but
--   separate findings from the same investigation, NOT addressed here:
--
--   1. GitHub and Hugging Face discoveries never create a startups row at
--      all — link_oss_projects() (20260726230000) deliberately only links an
--      oss_projects row to an EXISTING startup (by github_org/hf_org
--      identifier or homepage domain), and explicitly never falls back to
--      name-matching or row creation ("an OSS project existing is NOT
--      evidence a company has incorporated"). This is a documented, correct
--      design choice guarding against false-positive company creation, not a
--      bug — but its consequence is that a company known ONLY via a GitHub
--      repo or HF model/dataset/space has no path into startups, and
--      therefore no path into My Area, until it's independently discovered
--      some other way (a filing, a manual add). Fixing this would mean
--      building a human review/promotion surface for oss_projects (there is
--      currently no such UI anywhere in the app for ANY sourcing-engine
--      table, including the longer-standing board_discovery_candidates view
--      for Greenhouse/Lever boards) — a real feature, not a one-line fix,
--      and out of scope here.
--
--   2. The embedding backfill that this very fix now depends on has NO
--      recurring schedule configured in this project (confirmed via the
--      GitLab API: zero pipeline schedules exist). Per .gitlab-ci.yml's own
--      backfill-embeddings job comment, this requires a one-time manual step
--      in GitLab -> Build -> Pipeline schedules (daily, SCHEDULED_TASK =
--      embeddings) plus OPENAI_API_KEY / SUPABASE_URL /
--      SUPABASE_SERVICE_ROLE_KEY as CI/CD variables. Without that schedule,
--      embedding_updated_at never advances for ANY startup, old or new, and
--      this fix (along with top_thesis_matches and Thesis Matches tab
--      results generally) has nothing to act on. This is an operational
--      setup step for a human with GitLab access, not something fixable from
--      inside this migration.
--
-- Rollback: supabase/rollback/20261003000000_fix_thesis_match_alert_embedding_timing_down.sql
-- Idempotent: CREATE OR REPLACE, unschedules by name before re-scheduling.
-- =============================================================================

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
BEGIN
  -- ── 1. Watchlist filing alerts ──────────────────────────────────────────
  WITH candidates AS (
    SELECT wi.user_id, f.id AS filing_id, f.source, f.entity_name, f.filing_date
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
      '/my-area',
      'filing:' || c.filing_id::text
    FROM candidates c
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_filing FROM inserted;

  -- ── 2. Watchlist GitHub velocity spikes ──────────────────────────────────
  WITH candidates AS (
    SELECT wi.user_id, v.project_id, v.name, v.stars, v.stars_delta_1d, v.last_observed_at
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
      '/my-area',
      'velocity:' || c.project_id::text || ':' || c.last_observed_at::text
    FROM candidates c
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_velocity FROM inserted;

  -- ── 3. New high-match thesis alerts ──────────────────────────────────────
  -- Deliberately not auth.uid()-scoped (unlike top_thesis_matches): this is
  -- the batch job, run once for every calibrated user against every
  -- recently-EMBEDDED startup, not a per-caller read.
  --
  -- CHANGED: windowed on embedding_updated_at, not created_at (see this
  -- migration's header). created_at reflects row-insertion time, which for
  -- a connector-discovered company (UK Companies House / USPTO / EPO / SEC)
  -- predates embedding availability by an unbounded, asynchronous gap — so
  -- the old check almost always missed its own window before the startup
  -- was even matchable. embedding_updated_at reflects the moment the
  -- startup actually BECAME eligible for thesis-match scoring, which is the
  -- correct thing to call "new" here regardless of how old the row itself
  -- is.
  WITH candidates AS (
    SELECT
      pv.user_id, s.id AS startup_id, s.name,
      GREATEST(0, LEAST(100, round((1 - (s.embedding <=> pv.embedding)) * 100)))::integer AS match_pct
    FROM startups s
    JOIN user_preference_vectors pv ON pv.signal_count >= 3
   WHERE s.embedding IS NOT NULL
     AND s.embedding_updated_at >= now() - make_interval(hours => p_lookback_hours)
     AND NOT EXISTS (
       SELECT 1 FROM watchlist_items wi
        WHERE wi.user_id = pv.user_id AND wi.entity_type = 'startup' AND wi.entity_id = s.id)
     AND NOT EXISTS (
       SELECT 1 FROM user_interactions ui
        WHERE ui.user_id = pv.user_id AND ui.startup_id = s.id AND ui.action_type = 'pass')
  ), qualifying AS (
    SELECT * FROM candidates WHERE match_pct >= p_match_threshold
  ), inserted AS (
    INSERT INTO notifications (user_id, type, title, body, link, dedupe_key)
    SELECT
      q.user_id,
      'thesis_match',
      'New ' || q.match_pct || '% match: ' || q.name,
      q.name || ' was just added and matches ' || q.match_pct || '% of your investment thesis.',
      '/my-area?tab=matches',
      'thesis_match:' || q.startup_id::text
    FROM qualifying q
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_match FROM inserted;

  RETURN jsonb_build_object(
    'watchlist_filing_alerts',   n_filing,
    'watchlist_velocity_alerts', n_velocity,
    'thesis_match_alerts',       n_match
  );
END;
$$;

COMMENT ON FUNCTION generate_live_alerts(integer, integer, integer) IS
  'My Area Phase E: scans a rolling lookback window for new watchlist filings, watchlist GitHub velocity spikes, and high-scoring thesis matches on recently-EMBEDDED startups (embedding_updated_at, not created_at -- see 20261003000000), inserting deduplicated notifications rows for each. Safe to re-run on any schedule -- repeat events on overlapping windows are no-ops via the dedupe_key unique index, not something this function has to track itself.';

REVOKE ALL ON FUNCTION generate_live_alerts(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION generate_live_alerts(integer, integer, integer) TO service_role;

-- ── Re-schedule (unchanged cadence/args, just re-affirming after replace) ──
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-live-alerts') THEN
    PERFORM cron.unschedule('generate-live-alerts');
  END IF;
END;
$$;

SELECT cron.schedule(
  'generate-live-alerts',
  '0,30 * * * *',
  $cron$ SELECT generate_live_alerts(2, 85, 20); $cron$
);
