-- Candidate values and field status (owner, 2026-11-20).
-- candidate_values: the Tier 3 fields (tags, news, competitors, headcount, leaders, founder background, offices, name proposals) with full provenance. Never read by the app, never shown.
-- field_status: which core field the pilot shows. A field is visible only after 150 random audited values above its tier's accuracy bar (scripts/field_status.ts decides; nothing else sets it).
create table if not exists public.candidate_values (
  id             uuid primary key default gen_random_uuid(),
  startup_id     uuid not null references public.startups(id) on delete cascade,
  field          text not null,
  value          text not null,
  source_url     text,
  evidence_quote text,
  quote_original text,
  rule           text,
  batch          integer not null default 0,
  value_hash     text generated always as (md5(value)) stored,
  run_label      text,
  created_at     timestamptz not null default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'candidate_values_unique') then
    alter table public.candidate_values add constraint candidate_values_unique unique (startup_id, field, value_hash, batch);
  end if;
end $$;
create index if not exists candidate_values_field on public.candidate_values (field);
comment on table public.candidate_values is 'Tier 3 enrichment values (owner, 2026-11-20): written only here, with provenance; not part of startups and not shown in the app.';
alter table public.candidate_values enable row level security;

create table if not exists public.field_status (
  field         text primary key,
  tier          integer not null check (tier in (1, 2)),
  pilot_visible boolean not null default false,
  audited       integer not null default 0,
  wrong         integer not null default 0,
  updated_at    timestamptz not null default now()
);
comment on table public.field_status is 'Core field → shown in the pilot (owner, 2026-11-20). Set by scripts/field_status.ts from eval/field_audit.json: ≥150 random audited values and accuracy above the tier bar (Tier 1 98%, Tier 2 95%).';
alter table public.field_status enable row level security;
insert into public.field_status (field, tier) values
  ('round', 1), ('acquired', 1),
  ('description', 2), ('sector', 2), ('hq_city', 2), ('hq_country', 2), ('founded_year', 2), ('founder', 2),
  ('legal_name', 2), ('company_number', 2), ('incorporation_date', 2), ('incorporation_jurisdiction', 2), ('registered_address', 2)
on conflict (field) do nothing;
