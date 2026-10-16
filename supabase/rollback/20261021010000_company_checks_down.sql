-- Rollback of 20261021010000_company_checks.sql. Drops users' checks — export
-- them first if any exist. enrichment_runs keeps RLS (it should have had it).
ALTER TABLE enrichment_runs DROP CONSTRAINT IF EXISTS enrichment_runs_run_kind_check;
ALTER TABLE enrichment_runs DROP COLUMN IF EXISTS check_id;
ALTER TABLE enrichment_runs DROP COLUMN IF EXISTS llm_output_tokens;
ALTER TABLE enrichment_runs DROP COLUMN IF EXISTS llm_input_tokens;
ALTER TABLE enrichment_runs DROP COLUMN IF EXISTS search_calls;
ALTER TABLE enrichment_runs DROP COLUMN IF EXISTS duration_ms;
ALTER TABLE enrichment_runs DROP COLUMN IF EXISTS run_kind;
DROP FUNCTION IF EXISTS finish_company_check(uuid, text, text, jsonb, text, integer);
DROP FUNCTION IF EXISTS patch_company_check(uuid, text, jsonb);
DROP FUNCTION IF EXISTS heartbeat_company_check(uuid, text, integer);
DROP FUNCTION IF EXISTS claim_company_check(text, integer);
DROP FUNCTION IF EXISTS find_existing_startup(text, text);
DROP TABLE IF EXISTS company_checks;
