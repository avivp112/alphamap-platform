-- The week's review list (owner, 2026-11-01): unlisted domains a funding
-- round came from, most frequent first, not yet decided. Read-only.
select domain, seen_count, example_url, s.name as example_company, first_seen::date, last_seen::date
from public.source_domain_review r
left join public.startups s on s.id = r.example_startup
where r.decision is null
order by seen_count desc, last_seen desc
limit 30;
