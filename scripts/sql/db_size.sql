-- stage 1.3 (owner, 2026-11-23): READS ONLY. Paste in the Supabase SQL Editor. Free plan limit: 500 MB.
-- 1. database size and each table (data + indexes), biggest first
select pg_size_pretty(pg_database_size(current_database())) as database_size;
select relname as table_name, pg_size_pretty(pg_total_relation_size(c.oid)) as total, pg_size_pretty(pg_relation_size(c.oid)) as data,
       pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) as indexes_and_toast, c.reltuples::bigint as approx_rows
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','m') order by pg_total_relation_size(c.oid) desc limit 20;
-- 2. what the biggest table grows with: companies, rows per company
select (select count(*) from startups) as startups,
       (select count(distinct startup_id) from field_provenance) as companies_with_provenance,
       (select count(*) from field_provenance) as provenance_rows,
       (select count(*) from field_changes) as field_changes_rows,
       (select count(*) from candidate_values) as candidate_rows;
-- 3. estimate for 12,500 companies, if every company gets the provenance rows an enriched company has now
select pg_size_pretty(pg_total_relation_size('field_provenance')) as provenance_now,
       pg_size_pretty((pg_total_relation_size('field_provenance')::numeric / greatest((select count(distinct startup_id) from field_provenance),1) * 12500)::bigint) as provenance_at_12500,
       pg_size_pretty((pg_database_size(current_database())
         + pg_total_relation_size('field_provenance')::numeric / greatest((select count(distinct startup_id) from field_provenance),1) * (12500 - (select count(distinct startup_id) from field_provenance)))::bigint) as database_at_12500_if_only_provenance_grows;
