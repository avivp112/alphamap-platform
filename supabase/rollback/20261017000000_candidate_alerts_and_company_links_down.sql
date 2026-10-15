-- Rollback of 20261017000000_candidate_alerts_and_company_links.sql.
-- Restores generate_live_alerts() as of 20261015000000 (no new-company
-- alerts, links back to My Area) and drops the stage-4 helpers. Notifications
-- already sent keep their new links — /startups?company= and /candidates/
-- stay valid routes in the app. user_mandates.alerts_filtered is KEPT (users'
-- choices); drop it by hand if the toggle is abandoned for good.

DROP FUNCTION IF EXISTS get_candidate_preview(uuid);

-- From 20261015000000_thesis_alerts_new_companies_only.sql:
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
     -- NEW: and the company itself is new. A fresh embedding alone is not
     -- "just added": re-embedding an old company (the 2026-10-15 backfill of
     -- all 7,179 rows, an enrichment run rewriting a description, a model
     -- change) would otherwise announce it as a new match. 14 days covers the
     -- gap between a connector creating the row and the nightly embedding.
     AND s.created_at >= now() - interval '14 days'
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

DROP FUNCTION IF EXISTS candidate_alert_wanted(uuid, company_candidates);
DROP FUNCTION IF EXISTS candidate_stage_steps(text, jsonb);
DROP FUNCTION IF EXISTS candidate_sector(text, text, jsonb);
DROP FUNCTION IF EXISTS format_usd_short(numeric);
