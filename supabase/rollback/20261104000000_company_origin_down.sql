-- Rollback of 20261104000000_company_origin.sql. Deploy the code that does
-- not read these columns FIRST (the worker and bulk enrichment select them).
DROP FUNCTION IF EXISTS is_israel_related(startups);
ALTER TABLE startups DROP COLUMN IF EXISTS israel_rnd_center;
ALTER TABLE startups DROP COLUMN IF EXISTS founding_country;
