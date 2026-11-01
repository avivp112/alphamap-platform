-- Domains a funding round came from that are on no list (owner, 2026-11-01):
-- not allowed, not denied (lib/enrichment/roundSources.ts). Each enrichment
-- notes them here; the owner reviews the most frequent each week and decides
-- allow / deny / ignore — the decision is then added to roundSources.ts.
-- Internal: RLS on, no policy (service role only).
create table if not exists public.source_domain_review (
  domain          text primary key,
  seen_count      integer not null default 0,
  example_url     text,
  example_startup uuid references public.startups(id) on delete set null,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  decision        text check (decision in ('allowed', 'denied', 'ignored')),
  decided_at      timestamptz
);
alter table public.source_domain_review enable row level security;

create or replace function public.note_source_domain(p_domain text, p_url text, p_startup_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.source_domain_review (domain, seen_count, example_url, example_startup)
  values (lower(p_domain), 1, p_url, p_startup_id)
  on conflict (domain) do update
    set seen_count = source_domain_review.seen_count + 1, last_seen = now();
$$;
revoke all on function public.note_source_domain(text, text, uuid) from public, anon, authenticated;
