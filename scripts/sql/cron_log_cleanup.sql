-- Owner's decision 2026-11-23. Run in the Supabase SQL Editor, each numbered statement on its own, in this order. Touches only cron.job_run_details (pg_cron's log) and the statistics of startups.
-- 1. what is there: rows, the oldest day, and how many are older than 30 days (nothing is changed)
select count(*) as rows, min(start_time)::date as oldest, count(*) filter (where coalesce(end_time, start_time) < now() - interval '30 days') as older_than_30_days, pg_size_pretty(pg_total_relation_size('cron.job_run_details')) as size from cron.job_run_details;
-- 2. statistics of startups (changes no data)
ANALYZE startups;
-- 3. the migration supabase/migrations/20261205000000_cron_log_retention.sql: paste its whole text and run it (deletes rows older than 30 days, schedules the daily clean-up)
-- 4. return the freed space to the database (a separate statement, alone; locks only cron.job_run_details for a moment; skip it if step 1 showed 0 rows older than 30 days)
VACUUM FULL cron.job_run_details;
-- 5. the size now
select pg_size_pretty(pg_database_size(current_database())) as database_size, pg_size_pretty(pg_total_relation_size('cron.job_run_details')) as cron_log;
-- 6. the daily job exists
select jobname, schedule, active from cron.job where jobname = 'cron-log-retention';
