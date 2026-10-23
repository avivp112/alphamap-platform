-- Rollback of 20261101000000_hiring_freshness.sql: the hiring section as in
-- 20261029000000 (deploy the previous sourcing-crawl first: it stamps last_success_at).
CREATE OR REPLACE FUNCTION startup_hiring(p_startup_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH boards AS (
    SELECT sc.id, sc.ats_provider, sc.ats_board_token, sc.link_method, sc.last_crawled_at,
           coalesce(sc.first_crawled_at, sc.last_crawled_at) AS tracked_since,
           -- roles first seen within an hour of the first crawl were already open then
           coalesce(sc.first_crawled_at, sc.last_crawled_at) + interval '1 hour' AS baseline_until
      FROM sourcing_companies sc
     WHERE sc.startup_id = p_startup_id AND sc.link_status = 'verified'
  ), jobs AS (
    SELECT p.id, p.title, p.url, p.department, p.location, p.is_active, p.first_seen_at, p.closed_at,
           (b.baseline_until IS NOT NULL AND p.first_seen_at > b.baseline_until) AS is_new
      FROM early_job_postings p JOIN boards b ON b.id = p.company_id
  ), since AS (
    SELECT min(tracked_since) AS at FROM boards
  ), weeks AS (
    SELECT w::date AS week_start, w + interval '7 days' AS week_end
      FROM since, generate_series(date_trunc('week', since.at), date_trunc('week', now()), interval '7 days') w
     WHERE since.at IS NOT NULL
  ), active_signals AS (
    SELECT s.signal_type, s.signal_value, count(DISTINCT j.id) AS n
      FROM jobs j JOIN job_signals s ON s.job_id = j.id
     WHERE j.is_active AND s.signal_type IN ('seniority', 'tech_stack')
     GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'has_board', EXISTS (SELECT 1 FROM boards),
    'tracking_since', (SELECT at FROM since),
    'sources', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'provider', ats_provider, 'token', ats_board_token, 'verified_by', link_method,
        'last_crawled_at', last_crawled_at, 'tracking_since', tracked_since) ORDER BY ats_provider), '[]'::jsonb) FROM boards),
    'open_roles', (SELECT count(*) FROM jobs WHERE is_active),
    'new_roles_30d', (SELECT count(*) FROM jobs WHERE is_new AND first_seen_at > now() - interval '30 days'),
    'new_roles_since_tracking', (SELECT count(*) FROM jobs WHERE is_new),
    'closed_since_tracking', (SELECT count(*) FROM jobs WHERE closed_at IS NOT NULL),
    'departments_known', (SELECT count(*) FROM jobs WHERE is_active AND department IS NOT NULL),
    'by_department', (SELECT coalesce(jsonb_agg(jsonb_build_object('department', d, 'open', n) ORDER BY n DESC, d), '[]'::jsonb)
                        FROM (SELECT department AS d, count(*) n FROM jobs WHERE is_active AND department IS NOT NULL GROUP BY 1) x),
    'timeline', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'week', w.week_start,
          'open', (SELECT count(*) FROM jobs j WHERE j.first_seen_at < w.week_end AND (j.closed_at IS NULL OR j.closed_at >= w.week_end)),
          'new', (SELECT count(*) FROM jobs j WHERE j.is_new AND j.first_seen_at >= w.week_start AND j.first_seen_at < w.week_end),
          'closed', (SELECT count(*) FROM jobs j WHERE j.closed_at >= w.week_start AND j.closed_at < w.week_end)
        ) ORDER BY w.week_start), '[]'::jsonb) FROM weeks w),
    'latest', (SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.first_seen_at DESC), '[]'::jsonb) FROM (
        SELECT title, url, department, location, first_seen_at, is_new FROM jobs WHERE is_active
         ORDER BY first_seen_at DESC, title LIMIT 10) x),
    'seniority', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', signal_value, 'open', n) ORDER BY n DESC, signal_value), '[]'::jsonb)
                    FROM active_signals WHERE signal_type = 'seniority'),
    'tech', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', signal_value, 'open', n) ORDER BY n DESC, signal_value), '[]'::jsonb)
               FROM (SELECT * FROM active_signals WHERE signal_type = 'tech_stack' ORDER BY n DESC, signal_value LIMIT 12) t)
  );
$$;
REVOKE ALL ON FUNCTION startup_hiring(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION startup_hiring(uuid) TO authenticated, service_role;
ALTER TABLE sourcing_companies DROP COLUMN IF EXISTS last_success_at;
