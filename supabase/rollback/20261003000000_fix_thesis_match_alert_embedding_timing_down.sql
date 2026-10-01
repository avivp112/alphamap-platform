-- Rollback for 20261003000000_fix_thesis_match_alert_embedding_timing.sql
-- Restores the prior generate_live_alerts() body (thesis-match branch keyed
-- on s.created_at instead of s.embedding_updated_at). Does not touch the
-- notifications already written under either version, and does not need to
-- touch the cron.schedule entry -- the function's name/signature/cadence are
-- unchanged, only its body.

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
