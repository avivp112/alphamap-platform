-- =============================================================================
-- Job boards: is each board really the company's? (decision of 2026-10-21)
--
-- discover-boards links a board to a company by GUESSING the board's slug
-- from the company's domain (invisible.ai -> greenhouse "invisible"). Right
-- for most companies, but a generic slug can be another company's board, and
-- its jobs would then show on the wrong profile. Nothing is shown until the
-- link is verified (the profile's hiring section reads only verified links).
--
-- The check worker (worker/boards.ts) verifies, strongest evidence first:
--   website_link   the company's own site links to this board
--   domain_match   the board shows a website whose domain is the company's
--   name_match     the board's company name is the company's name
--   content_match  the postings name the company or its domain
-- A generic or short slug (invisible, fetch, ema, incident) is verified only
-- by website_link or domain_match; otherwise it is "unverifiable".
--
-- The same website reading finds boards slug-guessing missed: a careers link
-- to an ATS registers that board, already verified (found_via =
-- company_website).
--
--   sourcing_companies.link_status   unchecked / verified / mismatch / unverifiable
--   board_link_report()              counts by status and method, 10 mismatches
--   source_expectations 'board_verify' — the daily health check watches it
--
-- Rollback: supabase/rollback/20261027000000_board_link_verification_down.sql
-- =============================================================================

ALTER TABLE sourcing_companies ADD COLUMN IF NOT EXISTS link_status text NOT NULL DEFAULT 'unchecked';
ALTER TABLE sourcing_companies ADD COLUMN IF NOT EXISTS link_method text;
ALTER TABLE sourcing_companies ADD COLUMN IF NOT EXISTS link_evidence jsonb;
ALTER TABLE sourcing_companies ADD COLUMN IF NOT EXISTS link_checked_at timestamptz;
ALTER TABLE sourcing_companies ADD COLUMN IF NOT EXISTS found_via text NOT NULL DEFAULT 'slug_guess';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sourcing_companies_link_status_check') THEN
    ALTER TABLE sourcing_companies ADD CONSTRAINT sourcing_companies_link_status_check
      CHECK (link_status IN ('unchecked', 'verified', 'mismatch', 'unverifiable'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sourcing_companies_link_method_check') THEN
    ALTER TABLE sourcing_companies ADD CONSTRAINT sourcing_companies_link_method_check
      CHECK (link_method IS NULL OR link_method IN ('website_link', 'domain_match', 'name_match', 'content_match'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sourcing_companies_found_via_check') THEN
    ALTER TABLE sourcing_companies ADD CONSTRAINT sourcing_companies_found_via_check
      CHECK (found_via IN ('slug_guess', 'company_website', 'manual'));
  END IF;
END;
$$;
COMMENT ON COLUMN sourcing_companies.link_status IS
  'Is this board the linked company''s? Only verified links are shown on a profile. Set by the check worker (worker/boards.ts).';
COMMENT ON COLUMN sourcing_companies.link_evidence IS
  'What decided link_status: the page that links to the board, the board''s own website/name, or the postings that name the company.';

CREATE INDEX IF NOT EXISTS idx_sourcing_companies_link_status ON sourcing_companies (link_status, link_checked_at NULLS FIRST)
  WHERE startup_id IS NOT NULL;

-- When the worker last read a company's website looking for its job board.
ALTER TABLE startups ADD COLUMN IF NOT EXISTS board_site_scan_at timestamptz;

-- ── Worker (service role) ────────────────────────────────────────────────────
-- Boards to check: never checked first, then any not checked for 30 days. The
-- stamp is taken at claim time, so a batch is never handed out twice; a
-- claim that never answered (the worker stopped) is handed out again after
-- 15 minutes.
CREATE OR REPLACE FUNCTION claim_board_links(p_limit integer DEFAULT 3)
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
            OR (sc.link_status = 'unchecked' AND sc.link_checked_at < now() - interval '15 minutes')
            OR sc.link_checked_at < now() - interval '30 days')
     ORDER BY sc.link_checked_at NULLS FIRST
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

CREATE OR REPLACE FUNCTION record_board_link(p_id uuid, p_status text, p_method text, p_evidence jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE sourcing_companies
     SET link_status = p_status, link_method = p_method, link_evidence = p_evidence, link_checked_at = now()
   WHERE id = p_id;
$$;

-- Companies with a website and no board yet, whose site has not been read for one.
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

-- A board the company's own site links to: registered verified. A board already
-- linked to ANOTHER company is left alone and reported (returns 'taken').
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
BEGIN
  SELECT startup_id INTO v_owner FROM sourcing_companies
   WHERE ats_provider = p_provider AND ats_board_token = lower(btrim(p_token));
  IF FOUND THEN
    IF v_owner IS NOT NULL AND v_owner <> p_startup_id THEN RETURN 'taken'; END IF;
    UPDATE sourcing_companies
       SET startup_id = p_startup_id, link_status = 'verified', link_method = 'website_link',
           link_evidence = p_evidence, link_checked_at = now()
     WHERE ats_provider = p_provider AND ats_board_token = lower(btrim(p_token));
    RETURN 'verified_existing';
  END IF;
  INSERT INTO sourcing_companies (ats_provider, ats_board_token, inferred_name, startup_id,
                                  link_status, link_method, link_evidence, link_checked_at, found_via)
  VALUES (p_provider, lower(btrim(p_token)), p_name, p_startup_id,
          'verified', 'website_link', p_evidence, now(), 'company_website');
  RETURN 'registered';
END;
$$;

REVOKE ALL ON FUNCTION claim_board_links(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_board_link(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_board_site_scans(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION register_board_from_website(uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_board_links(integer) TO service_role;
GRANT EXECUTE ON FUNCTION record_board_link(uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION claim_board_site_scans(integer) TO service_role;
GRANT EXECUTE ON FUNCTION register_board_from_website(uuid, text, text, jsonb, text) TO service_role;

-- ── The report ───────────────────────────────────────────────────────────────
-- SELECT board_link_report();   (SQL Editor, or an admin in the app)
CREATE OR REPLACE FUNCTION board_link_report()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No user at all = the SQL Editor (anon has no EXECUTE on this function).
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR is_app_admin() OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'board_link_report: admins only' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'boards_linked', (SELECT count(*) FROM sourcing_companies WHERE startup_id IS NOT NULL),
    'by_status', (SELECT coalesce(jsonb_object_agg(link_status, n), '{}'::jsonb)
                    FROM (SELECT link_status, count(*) n FROM sourcing_companies WHERE startup_id IS NOT NULL GROUP BY 1) x),
    'by_status_and_method', (SELECT coalesce(jsonb_agg(jsonb_build_object('status', link_status, 'method', coalesce(link_method, '—'), 'boards', n) ORDER BY link_status, n DESC), '[]'::jsonb)
                    FROM (SELECT link_status, link_method, count(*) n FROM sourcing_companies WHERE startup_id IS NOT NULL GROUP BY 1, 2) x),
    'found_on_company_websites', (SELECT count(*) FROM sourcing_companies WHERE found_via = 'company_website'),
    'mismatch_examples', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
        SELECT sc.ats_provider AS provider, sc.ats_board_token AS slug, s.name AS company, s.website, sc.link_method AS method, sc.link_evidence AS evidence
          FROM sourcing_companies sc JOIN startups s ON s.id = sc.startup_id
         WHERE sc.link_status = 'mismatch' ORDER BY sc.link_checked_at DESC LIMIT 10) x)
  );
END;
$$;
REVOKE ALL ON FUNCTION board_link_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION board_link_report() TO authenticated, service_role;

-- ── Health: the daily check notices when verification stops ──────────────────
INSERT INTO source_expectations (source, label, enabled, max_age_hours, require_rows, weekend_tolerant, note) VALUES
  ('board_verify', 'Job boards (link check)', true, 26, false, false, 'check worker on Fly, between users'' checks; an empty run is normal once every board is checked')
ON CONFLICT (source) DO NOTHING;
