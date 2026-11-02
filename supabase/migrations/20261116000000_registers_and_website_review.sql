-- 1. Company registers are a source of evidence (owner, 2026-11-02;
--    lib/enrichment/registers.ts): Companies House, the Israeli registrar, SEC Form D.
alter table public.enrichment_evidence drop constraint if exists enrichment_evidence_provider_check;
alter table public.enrichment_evidence add constraint enrichment_evidence_provider_check
  check (provider in ('serper', 'tavily', 'jina', 'tavily_extract', 'cheerio', 'jina_search', 'serper_scrape', 'registry'));

-- 2. Websites to fix (owner, 2026-11-02): the site on file shows something
--    else than the company (GuardKnox → a crypto casino), or could not be
--    read at all (flyworks.in, mentat.ai). Each enrichment notes them here;
--    the owner corrects the website and marks the row fixed.
--    Internal: RLS on, no policy (service role only).
create table if not exists public.website_review (
  startup_id  uuid primary key references public.startups(id) on delete cascade,
  website     text,
  reason      text not null check (reason in ('content_mismatch', 'unreadable')),
  detail      text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  seen_count  integer not null default 1,
  status      text not null default 'open' check (status in ('open', 'fixed', 'ignored')),
  decided_at  timestamptz
);
alter table public.website_review enable row level security;

create or replace function public.note_website_issue(p_startup_id uuid, p_website text, p_reason text, p_detail text)
returns void language sql security definer set search_path = public as $$
  insert into public.website_review (startup_id, website, reason, detail)
  values (p_startup_id, p_website, p_reason, p_detail)
  on conflict (startup_id) do update
    set website = excluded.website, reason = excluded.reason, detail = excluded.detail,
        last_seen = now(), seen_count = website_review.seen_count + 1,
        status = case when website_review.website is distinct from excluded.website then 'open' else website_review.status end;
$$;
revoke all on function public.note_website_issue(uuid, text, text, text) from public, anon, authenticated;

-- GuardKnox: the tech pre-check of 2026-11-02 found a crypto-casino page on its site.
insert into public.website_review (startup_id, website, reason, detail)
select id, website, 'content_mismatch', 'The homepage is about crypto casinos and gambling, not automotive cybersecurity (dry run 2026-11-02).'
from public.startups where id = 'a0e6c6b3-c1ea-43f2-95e2-740b367f06fc'
on conflict (startup_id) do nothing;
