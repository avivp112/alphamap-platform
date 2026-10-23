-- Rollback of 20261030000000_comeet_boards.sql. Comeet boards (and their
-- postings) go: the first rules know no such provider.
DELETE FROM sourcing_companies WHERE ats_provider = 'comeet';
ALTER TABLE sourcing_companies DROP CONSTRAINT IF EXISTS sourcing_companies_ats_provider_check;
ALTER TABLE sourcing_companies ADD CONSTRAINT sourcing_companies_ats_provider_check
  CHECK (ats_provider IN ('greenhouse', 'lever', 'ashby', 'workable'));
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
