-- =============================================================================
-- Four more job-board providers: SmartRecruiters, Teamtailor, Personio,
-- Recruitee (decision of 2026-10-23). Each has a public list of a company's
-- postings by its board name; the shapes, as seen that day on real boards, are
-- in supabase/functions/sourcing-crawl/parse.ts. Found on company websites
-- (worker/boards.ts) and verified like every other board: the company's own
-- site links to it, or the board names the company's website or domain.
--
--   * ats_provider may be any of the four
--   * a SmartRecruiters company identifier keeps its case ("BoschGroup"), as a
--     Comeet uid does (20261030000000); other tokens are lowercased as before
--   * every board-less company's website is read again, now that four more
--     providers count
--
-- Rollback: supabase/rollback/20261031000000_more_ats_providers_down.sql
-- =============================================================================

ALTER TABLE sourcing_companies DROP CONSTRAINT IF EXISTS sourcing_companies_ats_provider_check;
ALTER TABLE sourcing_companies ADD CONSTRAINT sourcing_companies_ats_provider_check
  CHECK (ats_provider IN ('greenhouse', 'lever', 'ashby', 'workable', 'comeet',
                          'smartrecruiters', 'teamtailor', 'personio', 'recruitee'));

-- Same as 20261030000000, plus SmartRecruiters among the case-kept tokens.
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
REVOKE ALL ON FUNCTION register_board_from_website(uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION register_board_from_website(uuid, text, text, jsonb, text) TO service_role;

UPDATE startups s SET board_site_scan_at = NULL
 WHERE s.board_site_scan_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sourcing_companies sc WHERE sc.startup_id = s.id);
