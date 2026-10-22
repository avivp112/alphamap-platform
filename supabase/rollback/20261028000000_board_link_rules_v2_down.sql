-- Rollback of 20261028000000_board_link_rules_v2.sql: back to the first rules.
-- Statuses the first rules do not know become unverifiable (not shown), and
-- posting_domain is recorded as the content_match it was a part of.
DROP FUNCTION IF EXISTS claim_board_links(integer, integer);
DROP FUNCTION IF EXISTS record_board_link(uuid, text, text, jsonb, integer);
UPDATE sourcing_companies SET link_status = 'unverifiable' WHERE link_status = 'low_confidence';
UPDATE sourcing_companies SET link_method = 'content_match' WHERE link_method = 'posting_domain';
ALTER TABLE sourcing_companies DROP CONSTRAINT IF EXISTS sourcing_companies_link_status_check;
ALTER TABLE sourcing_companies ADD CONSTRAINT sourcing_companies_link_status_check
  CHECK (link_status IN ('unchecked', 'verified', 'mismatch', 'unverifiable'));
ALTER TABLE sourcing_companies DROP CONSTRAINT IF EXISTS sourcing_companies_link_method_check;
ALTER TABLE sourcing_companies ADD CONSTRAINT sourcing_companies_link_method_check
  CHECK (link_method IS NULL OR link_method IN ('website_link', 'domain_match', 'name_match', 'content_match'));
ALTER TABLE sourcing_companies DROP COLUMN IF EXISTS link_previous;
ALTER TABLE sourcing_companies DROP COLUMN IF EXISTS link_rule_version;

-- The first report, as 20261027000000 created it.
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
