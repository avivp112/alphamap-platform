-- Rollback of 20261024000000_crm.sql. Drops users' CRM data and the
-- document metadata — export first. Files already uploaded stay in the
-- crm-documents bucket until removed through the Storage API (deleting
-- storage.objects rows from SQL does not delete the files).
DROP TRIGGER IF EXISTS trg_company_checks_to_crm ON company_checks;
DROP FUNCTION IF EXISTS crm_add_checked_company();
DROP POLICY IF EXISTS crm_documents_owner_read ON storage.objects;
DROP POLICY IF EXISTS crm_documents_owner_insert ON storage.objects;
DROP POLICY IF EXISTS crm_documents_owner_delete ON storage.objects;
DROP TABLE IF EXISTS crm_documents;
DROP TABLE IF EXISTS crm_deal_terms;
DROP TABLE IF EXISTS crm_companies;
DROP FUNCTION IF EXISTS crm_watch_company();
DROP FUNCTION IF EXISTS crm_touch_updated_at();
-- The bucket is left in place (it may hold files); remove it in the dashboard when empty.
