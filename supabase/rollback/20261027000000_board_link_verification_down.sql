-- Rollback of 20261027000000_board_link_verification.sql. Boards registered
-- from company websites stay (they are real boards); only the checking goes.
DELETE FROM source_expectations WHERE source = 'board_verify';
DROP FUNCTION IF EXISTS board_link_report();
DROP FUNCTION IF EXISTS register_board_from_website(uuid, text, text, jsonb, text);
DROP FUNCTION IF EXISTS claim_board_site_scans(integer);
DROP FUNCTION IF EXISTS record_board_link(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS claim_board_links(integer);
ALTER TABLE startups DROP COLUMN IF EXISTS board_site_scan_at;
DROP INDEX IF EXISTS idx_sourcing_companies_link_status;
ALTER TABLE sourcing_companies DROP CONSTRAINT IF EXISTS sourcing_companies_found_via_check;
ALTER TABLE sourcing_companies DROP CONSTRAINT IF EXISTS sourcing_companies_link_method_check;
ALTER TABLE sourcing_companies DROP CONSTRAINT IF EXISTS sourcing_companies_link_status_check;
ALTER TABLE sourcing_companies DROP COLUMN IF EXISTS found_via;
ALTER TABLE sourcing_companies DROP COLUMN IF EXISTS link_checked_at;
ALTER TABLE sourcing_companies DROP COLUMN IF EXISTS link_evidence;
ALTER TABLE sourcing_companies DROP COLUMN IF EXISTS link_method;
ALTER TABLE sourcing_companies DROP COLUMN IF EXISTS link_status;
