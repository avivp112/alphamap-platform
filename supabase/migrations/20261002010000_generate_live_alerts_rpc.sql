-- =============================================================================
-- Migration: generate_live_alerts_rpc
-- Created:   2026-10-02
-- Description:
--   My Area / Phase E: the alert-matching job that 20260930000000's own
--   header explicitly deferred as "separate, later infrastructure". This is
--   that job -- the first thing to ever write a notifications row beyond the
--   one-time onboarding welcome message.
--
--   Three independent categories, each its own INSERT...SELECT so a bug or a
--   missing dependency in one can never block the others in the same run:
--
--   1. WATCHLIST FILING ALERTS -- a new raw_gov_filings row (SEC Form D, UK
--      Companies House, USPTO or EPO patent) lands for a startup that is on
--      SOMEONE's watchlist. One notification per (user, filing) pair -- two
--      users watching the same company both get their own alert for the same
--      filing, correctly, since watchlists are per-user.
--
--   2. WATCHLIST VELOCITY ALERTS -- a startup on someone's watchlist has a
--      GitHub star-growth spike (stars_delta_1d >= p_velocity_min_stars, a
--      plain absolute threshold -- there is no production traffic yet to
--      calibrate a relative one against, and an absolute floor is at least
--      honest about being a starting guess rather than dressed up as
--      calibrated). This is the one category that depends on Sourcing Engine
--      infrastructure built earlier in this same effort: oss_project_velocity
--      only has a startup_id to join watchlist_items against because
--      link_oss_projects() (20260726230000) exists to populate it -- before
--      that migration, this category would silently find nothing, not error.
--
--   3. THESIS MATCH ALERTS -- a startup created within the lookback window
--      scores >= p_match_threshold against some user's preference-vector
--      centroid. Same exclusions as the client-facing top_thesis_matches
--      RPC (20261001000000) -- never alerting on something already
--      watchlisted or explicitly passed on -- but this one is NOT
--      auth.uid()-scoped: it is the batch counterpart, iterating every
--      calibrated user (signal_count >= 3) against every recent startup,
--      because a scheduled job has no single caller to scope itself to.
--
-- ── DEDUPLICATION ────────────────────────────────────────────────────────────
--   Every INSERT carries a dedupe_key (see 20261002000000) and targets the
--   partial unique index with ON CONFLICT ... DO NOTHING. This is what makes
--   re-scanning a rolling lookback window safe on every run, instead of
--   needing a separate "last processed" watermark table: a filing/spike/match
--   already alerted on the last run (or three runs ago, if one was missed)
--   simply no-ops the second time, cheaply, via the index rather than
--   needing job logic to remember what it already did.
--
-- ── WHY A ROLLING WINDOW AND NOT A WATERMARK ─────────────────────────────────
--   p_lookback_hours defaults to 2 -- four times the 30-minute cron cadence
--   this is scheduled at, the same "safety margin against one missed run"
--   reasoning as EPO's 14-day window on a weekly cron (20260726250000). A
--   missed or delayed run still catches everything on the next one; the only
--   cost of the overlap is a handful of no-op ON CONFLICT hits, which is
--   exactly the trade this codebase makes everywhere else it re-scans instead
--   of tracking state.
--
-- ── LINKS ─────────────────────────────────────────────────────────────────
--   None of these three sources have a per-company deep-link route in the
--   app today, so every link points at a My Area tab (watchlist alerts ->
--   the default watchlist tab; thesis-match alerts -> ?tab=matches) rather
--   than a company page that doesn't exist yet. Whoever adds a company
--   detail route can make these more specific without touching dedup logic.
--
-- Rollback: supabase/rollback/20261002010000_generate_live_alerts_rpc_down.sql
-- Idempotent: unschedules by name before scheduling.
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
  -- recently-created startup, not a per-caller read.
  WITH candidates AS (
    SELECT
      pv.user_id, s.id AS startup_id, s.name,
      GREATEST(0, LEAST(100, round((1 - (s.embedding <=> pv.embedding)) * 100)))::integer AS match_pct
    FROM startups s
    JOIN user_preference_vectors pv ON pv.signal_count >= 3
   WHERE s.embedding IS NOT NULL
     AND s.created_at >= now() - make_interval(hours => p_lookback_hours)
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
  'My Area Phase E: scans a rolling lookback window for new watchlist filings, watchlist GitHub velocity spikes, and high-scoring thesis matches on recently-created startups, inserting deduplicated notifications rows for each. Safe to re-run on any schedule -- repeat events on overlapping windows are no-ops via the dedupe_key unique index, not something this function has to track itself.';

REVOKE ALL ON FUNCTION generate_live_alerts(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION generate_live_alerts(integer, integer, integer) TO service_role;

-- ── Schedule: every 30 minutes ────────────────────────────────────────────
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
