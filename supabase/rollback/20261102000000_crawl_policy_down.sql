-- Rollback of 20261102000000_crawl_policy.sql: the functions as before it.
-- Roles deleted for an opt-out are not restored (the company asked).
DROP VIEW IF EXISTS crawlable_boards;
CREATE OR REPLACE FUNCTION claim_board_links(p_limit integer, p_rule_version integer)
RETURNS TABLE (id uuid, ats_provider text, ats_board_token text, startup_id uuid, startup_name text, website text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT sc.id FROM sourcing_companies sc
     WHERE sc.startup_id IS NOT NULL
       AND (sc.link_checked_at IS NULL
            OR ((sc.link_rule_version < p_rule_version OR sc.link_status = 'unchecked')
                AND sc.link_checked_at < now() - interval '15 minutes')
            OR sc.link_checked_at < now() - interval '30 days')
     ORDER BY sc.link_checked_at IS NULL DESC, sc.link_rule_version < p_rule_version DESC, sc.link_checked_at
     LIMIT greatest(1, least(p_limit, 50))
     FOR UPDATE SKIP LOCKED
  ), stamped AS (
    UPDATE sourcing_companies sc SET link_checked_at = now()
      FROM picked WHERE sc.id = picked.id
    RETURNING sc.id, sc.ats_provider, sc.ats_board_token, sc.startup_id
  )
  SELECT st.id, st.ats_provider::text, st.ats_board_token::text, st.startup_id, s.name, s.website
    FROM stamped st JOIN startups s ON s.id = st.startup_id;
END;
$$;

CREATE OR REPLACE FUNCTION claim_board_site_scans(p_limit integer DEFAULT 3)
RETURNS TABLE (startup_id uuid, startup_name text, website text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT s.id FROM startups s
     WHERE s.website IS NOT NULL AND btrim(s.website) <> '' AND s.board_site_scan_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM sourcing_companies sc WHERE sc.startup_id = s.id)
     ORDER BY s.last_enriched_at DESC NULLS LAST
     LIMIT greatest(1, least(p_limit, 50))
     FOR UPDATE OF s SKIP LOCKED
  ), stamped AS (
    UPDATE startups s SET board_site_scan_at = now() FROM picked WHERE s.id = picked.id
    RETURNING s.id, s.name, s.website
  )
  SELECT stamped.id, stamped.name, stamped.website FROM stamped;
END;
$$;

CREATE OR REPLACE FUNCTION register_board_from_website(
  p_startup_id uuid, p_provider text, p_token text, p_evidence jsonb, p_name text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_token text := CASE WHEN p_provider IN ('comeet', 'smartrecruiters') THEN btrim(p_token) ELSE lower(btrim(p_token)) END;
BEGIN
  SELECT startup_id INTO v_owner FROM sourcing_companies
   WHERE ats_provider = p_provider AND ats_board_token = v_token;
  IF FOUND THEN
    IF v_owner IS NOT NULL AND v_owner <> p_startup_id THEN RETURN 'taken'; END IF;
    UPDATE sourcing_companies
       SET startup_id = p_startup_id, link_status = 'verified', link_method = 'website_link',
           link_evidence = p_evidence, link_checked_at = now()
     WHERE ats_provider = p_provider AND ats_board_token = v_token;
    RETURN 'verified_existing';
  END IF;
  INSERT INTO sourcing_companies (ats_provider, ats_board_token, inferred_name, startup_id,
                                  link_status, link_method, link_evidence, link_checked_at, found_via)
  VALUES (p_provider, v_token, p_name, p_startup_id,
          'verified', 'website_link', p_evidence, now(), 'company_website');
  RETURN 'registered';
END;
$$;

CREATE OR REPLACE FUNCTION startup_hiring(p_startup_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH boards AS (
    SELECT sc.id, sc.ats_provider, sc.ats_board_token, sc.link_method, sc.last_crawled_at, sc.last_success_at,
           -- read successfully lately: only then are its "open" roles still open
           coalesce(sc.last_success_at > now() - interval '72 hours', false) AS fresh,
           coalesce(sc.first_crawled_at, sc.last_crawled_at) AS tracked_since,
           -- roles first seen within an hour of the first crawl were already open then
           coalesce(sc.first_crawled_at, sc.last_crawled_at) + interval '1 hour' AS baseline_until
      FROM sourcing_companies sc
     WHERE sc.startup_id = p_startup_id AND sc.link_status = 'verified'
  ), jobs AS (
    SELECT p.id, p.title, p.url, p.department, p.location, p.is_active, p.first_seen_at, p.closed_at,
           (b.baseline_until IS NOT NULL AND p.first_seen_at > b.baseline_until) AS is_new
      FROM early_job_postings p JOIN boards b ON b.id = p.company_id AND b.fresh
     WHERE p.url ~* '^https?://'
  ), since AS (
    SELECT min(tracked_since) AS at FROM boards WHERE fresh
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
    -- a verified board not read successfully for 72 hours: its roles are not shown
    'fresh', EXISTS (SELECT 1 FROM boards WHERE fresh),
    'tracking_since', (SELECT at FROM since),
    'sources', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'provider', ats_provider, 'token', ats_board_token, 'verified_by', link_method,
        'last_crawled_at', last_crawled_at, 'last_success_at', last_success_at, 'fresh', fresh,
        'tracking_since', tracked_since) ORDER BY ats_provider), '[]'::jsonb) FROM boards),
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

DROP FUNCTION IF EXISTS add_crawl_optout(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS crawl_opted_out(text, text, uuid, text);
DROP FUNCTION IF EXISTS site_domain(text);
DROP FUNCTION IF EXISTS disable_ats_provider(text, text);
DROP TABLE IF EXISTS crawl_optouts;
ALTER TABLE sourcing_companies DROP COLUMN IF EXISTS crawl_blocked;
DROP TABLE IF EXISTS ats_providers;
