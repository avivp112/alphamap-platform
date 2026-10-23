-- =============================================================================
-- The hiring section of a company's profile (stage B, decision of 2026-10-21)
--
-- Read from the company's VERIFIED job boards only (link_status = 'verified',
-- 20261028000000): a low_confidence, mismatched or unverifiable board is never
-- shown. What it shows, all from our own crawl:
--   * open roles, by department
--   * new roles — first seen AFTER the board's first crawl, so the roles that
--     were already open when tracking began are not counted as new
--   * a weekly timeline since tracking began (open / new / closed)
--   * the latest roles, with their links
--   * seniority and technologies (job_signals, read from the titles)
--   * the source: which board, when it was last read, since when it is tracked
--
--   early_job_postings.department / .location   filled by sourcing-crawl
--   sourcing_companies.first_crawled_at          the first successful-or-not
--       read of the board: set once, by trigger, when last_crawled_at is first
--       stamped. Existing boards: their earliest posting's first_seen_at.
--   startup_hiring(startup_id) -> jsonb          the section's data
--
-- Rollback: supabase/rollback/20261029000000_hiring_profile_down.sql
-- =============================================================================

ALTER TABLE early_job_postings ADD COLUMN IF NOT EXISTS department varchar(255);
ALTER TABLE early_job_postings ADD COLUMN IF NOT EXISTS location varchar(255);
COMMENT ON COLUMN early_job_postings.department IS 'The department the ATS gives the posting (Greenhouse: /departments; Lever: categories.department or team; Ashby: department or team; Workable: department). NULL = not given.';
COMMENT ON COLUMN early_job_postings.location IS 'The location the ATS gives the posting. NULL = not given.';

ALTER TABLE sourcing_companies ADD COLUMN IF NOT EXISTS first_crawled_at timestamptz;
COMMENT ON COLUMN sourcing_companies.first_crawled_at IS
  'When the crawler first read this board. Postings first seen within an hour of it were already open when tracking began, and are not "new".';

-- Existing boards: the earliest posting we hold is from the first crawl that
-- found any. (A board whose first crawl found nothing gets a later date — its
-- first roles then count as already open, never wrongly as new.)
UPDATE sourcing_companies sc
   SET first_crawled_at = least(p.first_seen, sc.last_crawled_at)
  FROM (SELECT company_id, min(first_seen_at) AS first_seen FROM early_job_postings GROUP BY company_id) p
 WHERE p.company_id = sc.id AND sc.first_crawled_at IS NULL;
UPDATE sourcing_companies SET first_crawled_at = last_crawled_at
 WHERE first_crawled_at IS NULL AND last_crawled_at IS NOT NULL;

CREATE OR REPLACE FUNCTION set_first_crawled_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.first_crawled_at IS NULL AND NEW.last_crawled_at IS NOT NULL THEN
    NEW.first_crawled_at := NEW.last_crawled_at;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sourcing_companies_first_crawled_at ON sourcing_companies;
CREATE TRIGGER trg_sourcing_companies_first_crawled_at
  BEFORE INSERT OR UPDATE OF last_crawled_at ON sourcing_companies
  FOR EACH ROW EXECUTE FUNCTION set_first_crawled_at();

-- ── The section's data ───────────────────────────────────────────────────────
-- SECURITY INVOKER: the job tables are readable by signed-in users (their own
-- RLS), not by anon. has_board = false means no verified board: the profile
-- shows that, and nothing else.
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
