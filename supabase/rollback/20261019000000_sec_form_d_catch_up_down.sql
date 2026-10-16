-- Rollback of 20261019000000_sec_form_d_catch_up.sql.
-- Puts back the 00:10 UTC schedule, the alert job of 20261017000000 and the
-- 24h health window. The two tables are KEPT (they are the record of what
-- was ingested); drop them by hand if the worker is abandoned. Redeploy the
-- previous ingest-sec-form-d as well — the worker code needs these tables.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ingest-sec-form-d') THEN
    PERFORM cron.unschedule('ingest-sec-form-d');
  END IF;
END;
$$;

SELECT cron.schedule(
  'ingest-sec-form-d', '10 0 * * *',
  $cron$
  SELECT net.http_post(
    url     := sourcing_required_secret('project_url') || '/functions/v1/ingest-sec-form-d',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || sourcing_required_secret('service_role_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $cron$
);

UPDATE source_expectations
   SET max_age_hours = 24, note = 'daily 00:10 UTC; Form D index is published on business days'
 WHERE source = 'sec_form_d';

-- From 20261017000000_candidate_alerts_and_company_links.sql:
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
