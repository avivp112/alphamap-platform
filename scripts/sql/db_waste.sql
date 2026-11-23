-- stage 1b (owner, 2026-11-23): READS ONLY. Run each statement on its own in the Supabase SQL Editor (it shows only the last result).
-- 1. dead rows and the last vacuum, per table (biggest first)
select relname, pg_size_pretty(pg_total_relation_size(relid)) as total, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / greatest(n_live_tup + n_dead_tup, 1), 1) as dead_pct,
       last_autovacuum::date as last_autovacuum, last_vacuum::date as last_vacuum
from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 20;
-- 2. a rough size of what dead rows hold: dead_pct x table size (an estimate, not a measurement)
select relname, pg_size_pretty(pg_relation_size(relid)) as heap,
       pg_size_pretty((pg_relation_size(relid) * n_dead_tup::numeric / greatest(n_live_tup + n_dead_tup, 1))::bigint) as est_dead_in_heap,
       pg_size_pretty(pg_indexes_size(relid)) as indexes
from pg_stat_user_tables where pg_relation_size(relid) > 5000000 order by pg_relation_size(relid) desc;
-- 3. what makes startups big: the average stored size of each column (a sample of 2000 rows)
with s as (select * from startups limit 2000)
select key as column_name, round(avg(pg_column_size(value))) as avg_bytes, round(sum(pg_column_size(value)) / 1048576.0, 2) as mb_in_sample
from s, lateral jsonb_each(to_jsonb(s)) group by key order by avg_bytes desc limit 12;
-- 4. is startups_search a copy of startups? its row count and its widest columns (same sample method)
select (select count(*) from startups) as startups_rows, (select count(*) from startups_search) as startups_search_rows;
-- 5. the scheduled jobs that are active now, and the last 5 runs of each (are the crawl / ingest jobs really running?)
select jobname, schedule, active from cron.job order by jobname;
-- 6. when the big tables were last written (job_signals and oss_projects have no timestamp column, so rows inserted/updated since the statistics began are used for them)
select 'early_job_postings' as t, max(first_seen_at)::text as last_row, count(*) from early_job_postings
union all select 'oss_project_metrics', max(observed_at)::text, count(*) from oss_project_metrics
union all select 'field_changes', max(created_at)::text, count(*) from field_changes;
select relname, n_tup_ins as inserted, n_tup_upd as updated, n_tup_del as deleted from pg_stat_user_tables where relname in ('job_signals','oss_projects','oss_project_metrics','early_job_postings');
-- 7. pg_cron's own log is the third biggest table: how many rows, since when, and which jobs write it
select count(*) as rows, min(start_time)::date as oldest, max(start_time)::date as newest from cron.job_run_details;
select j.jobname, count(*) as runs from cron.job_run_details d join cron.job j on j.jobid = d.jobid group by 1 order by 2 desc limit 12;
