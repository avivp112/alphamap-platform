-- Rollback of 20261029000000_hiring_profile.sql. The crawler keeps working
-- without the columns only once its own department/location change is
-- rolled back too (supabase/functions/sourcing-crawl): deploy that first.
DROP FUNCTION IF EXISTS startup_hiring(uuid);
DROP TRIGGER IF EXISTS trg_sourcing_companies_first_crawled_at ON sourcing_companies;
DROP FUNCTION IF EXISTS set_first_crawled_at();
ALTER TABLE sourcing_companies DROP COLUMN IF EXISTS first_crawled_at;
ALTER TABLE early_job_postings DROP COLUMN IF EXISTS location;
ALTER TABLE early_job_postings DROP COLUMN IF EXISTS department;
