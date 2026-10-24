-- =============================================================================
-- How AlphaMap reads other people's sites (owner's decisions of 2026-10-24)
--
--   * ats_providers — one row per job-board provider: whether we read it at
--     all, and where its legal review stands. The crawlers switch a provider
--     off by themselves when its robots.txt disallows the path we read
--     (disable_ats_provider); a person switches it back on after a look.
--     A switched-off provider's boards are not read, not registered, and
--     their roles are not shown.
--   * crawl_optouts — a company that asks us not to collect its jobs: by
--     AlphaMap company, website domain, or board. add_crawl_optout() takes it
--     in at once: its boards are blocked (sourcing_companies.crawl_blocked),
--     their stored roles deleted, and nothing of it is read again.
--   * What is stored of a role stays: title, link, department, location.
--
-- Rollback: supabase/rollback/20261102000000_crawl_policy_down.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS ats_providers (
  provider        text PRIMARY KEY,
  enabled         boolean NOT NULL DEFAULT true,
  legal_status    text NOT NULL,
  note            text,
  disabled_reason text,
  disabled_at     timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE ats_providers IS
  'Job-board providers AlphaMap reads. enabled = false: not read, not registered, roles not shown (robots.txt or a person decided). legal_status: where the terms review stands.';
INSERT INTO ats_providers (provider, enabled, legal_status, note) VALUES
  ('greenhouse',      true,  'not_reviewed',              'public job board API'),
  ('lever',           true,  'not_reviewed',              'public postings API'),
  ('ashby',           true,  'not_reviewed',              'public job board API'),
  ('workable',        true,  'not_reviewed',              'public widget API'),
  ('smartrecruiters', true,  'approved_by_owner',         'Posting API: documented as public, no authentication (owner, 2026-10-24)'),
  ('recruitee',       true,  'legal_review_before_launch','Careers Site API: documented as needing no authorisation; 2022 API terms limit bulk copying'),
  ('personio',        true,  'legal_review_before_launch','public XML feed, switched on by the employer for its own site'),
  ('teamtailor',      true,  'legal_review_before_launch','public jobs.json feed; no official terms found'),
  ('comeet',          true,  'pending_robots_review',     'hosted careers page only; the careers API with a site''s token is not used (owner, 2026-10-24)')
ON CONFLICT (provider) DO NOTHING;
ALTER TABLE ats_providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ats_providers_read_admin ON ats_providers;
CREATE POLICY ats_providers_read_admin ON ats_providers FOR SELECT TO authenticated USING (is_app_admin());
REVOKE ALL ON ats_providers FROM anon;
GRANT SELECT ON ats_providers TO authenticated;
GRANT ALL ON ats_providers TO service_role;

-- Called by a crawler that found the provider's data path disallowed by its robots.txt.
CREATE OR REPLACE FUNCTION disable_ats_provider(p_provider text, p_reason text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE ats_providers SET enabled = false, disabled_reason = p_reason, disabled_at = now(), updated_at = now()
   WHERE provider = p_provider AND enabled;
$$;
REVOKE ALL ON FUNCTION disable_ats_provider(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION disable_ats_provider(text, text) TO service_role;

-- ── Opt-outs ─────────────────────────────────────────────────────────────────
ALTER TABLE sourcing_companies ADD COLUMN IF NOT EXISTS crawl_blocked boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN sourcing_companies.crawl_blocked IS 'The company asked not to be collected (crawl_optouts): not read, roles deleted and not shown.';

CREATE TABLE IF NOT EXISTS crawl_optouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id      uuid REFERENCES startups(id) ON DELETE SET NULL,
  domain          text,
  ats_provider    text,
  ats_board_token text,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  CHECK (startup_id IS NOT NULL OR domain IS NOT NULL OR (ats_provider IS NOT NULL AND ats_board_token IS NOT NULL))
);
COMMENT ON TABLE crawl_optouts IS 'Companies that asked AlphaMap not to collect their jobs. Add with add_crawl_optout().';
ALTER TABLE crawl_optouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crawl_optouts_read_admin ON crawl_optouts;
CREATE POLICY crawl_optouts_read_admin ON crawl_optouts FOR SELECT TO authenticated USING (is_app_admin());
REVOKE ALL ON crawl_optouts FROM anon;
GRANT SELECT ON crawl_optouts TO authenticated;
GRANT ALL ON crawl_optouts TO service_role;

-- "https://www.Acme.com/careers" -> "acme.com"
CREATE OR REPLACE FUNCTION site_domain(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(lower(regexp_replace(regexp_replace(regexp_replace(btrim(coalesce(p_url, '')), '^[a-z]+://', '', 'i'), '^www\.', '', 'i'), '[/:?#].*$', '')), '');
$$;

/** Does an opt-out cover this board, company or website? */
CREATE OR REPLACE FUNCTION crawl_opted_out(p_provider text, p_token text, p_startup_id uuid, p_website text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM crawl_optouts o
     WHERE (p_startup_id IS NOT NULL AND o.startup_id = p_startup_id)
        OR (p_provider IS NOT NULL AND o.ats_provider = p_provider AND o.ats_board_token = p_token)
        OR (o.domain IS NOT NULL AND (
              site_domain(p_website) = o.domain OR site_domain(p_website) LIKE '%.' || o.domain
           OR (p_startup_id IS NOT NULL AND EXISTS (SELECT 1 FROM startups s WHERE s.id = p_startup_id
                 AND (site_domain(s.website) = o.domain OR site_domain(s.website) LIKE '%.' || o.domain))))));
$$;
REVOKE ALL ON FUNCTION crawl_opted_out(text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION crawl_opted_out(text, text, uuid, text) TO service_role;

/**
 * Take in an opt-out at once: record it, block every board it covers, and
 * delete their stored roles. Returns how many boards were blocked.
 *   SELECT add_crawl_optout(p_domain => 'acme.com', p_note => 'email from HR, 2026-11-02');
 */
CREATE OR REPLACE FUNCTION add_crawl_optout(
  p_startup_id uuid DEFAULT NULL, p_domain text DEFAULT NULL,
  p_provider text DEFAULT NULL, p_token text DEFAULT NULL, p_note text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_domain text := site_domain(p_domain);
  v_ids uuid[];
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR is_app_admin() OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'add_crawl_optout: admins only' USING ERRCODE = '42501';
  END IF;
  INSERT INTO crawl_optouts (startup_id, domain, ats_provider, ats_board_token, note, created_by)
  VALUES (p_startup_id, v_domain, p_provider, p_token, p_note, auth.uid());
  SELECT array_agg(sc.id) INTO v_ids FROM sourcing_companies sc
   WHERE crawl_opted_out(sc.ats_provider, sc.ats_board_token, sc.startup_id, NULL);
  UPDATE sourcing_companies SET crawl_blocked = true WHERE id = ANY (coalesce(v_ids, '{}'));
  DELETE FROM early_job_postings WHERE company_id = ANY (coalesce(v_ids, '{}'));
  RETURN coalesce(array_length(v_ids, 1), 0);
END;
$$;
REVOKE ALL ON FUNCTION add_crawl_optout(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION add_crawl_optout(uuid, text, text, text, text) TO authenticated, service_role;

-- ── Enforced everywhere boards are read, registered or shown ─────────────────
-- Same as 20261028000000: not a blocked board, not a switched-off provider.
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
       AND NOT sc.crawl_blocked
       AND EXISTS (SELECT 1 FROM ats_providers ap WHERE ap.provider = sc.ats_provider AND ap.enabled)
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

-- Same as 20261027000000: not a company that opted out.
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
       AND NOT crawl_opted_out(NULL, NULL, s.id, s.website)
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

-- Same as 20261031000000: nothing for a switched-off provider or an opt-out.
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
  IF NOT EXISTS (SELECT 1 FROM ats_providers WHERE provider = p_provider AND enabled) THEN RETURN 'provider_disabled'; END IF;
  IF crawl_opted_out(p_provider, v_token, p_startup_id, NULL) THEN RETURN 'opted_out'; END IF;
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

-- Same as 20261101000000: no blocked board, no switched-off provider.
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
       AND NOT sc.crawl_blocked
       AND EXISTS (SELECT 1 FROM ats_providers ap WHERE ap.provider = sc.ats_provider AND ap.enabled)
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

-- The crawler's queue (sourcing-crawl): boards it may read.
CREATE OR REPLACE VIEW crawlable_boards
WITH (security_invoker = on) AS
SELECT sc.id, sc.ats_provider, sc.ats_board_token, sc.inferred_name, sc.last_crawled_at, sc.startup_id
  FROM sourcing_companies sc JOIN ats_providers ap ON ap.provider = sc.ats_provider AND ap.enabled
 WHERE NOT sc.crawl_blocked;
REVOKE ALL ON crawlable_boards FROM anon, authenticated;
GRANT SELECT ON crawlable_boards TO service_role;
