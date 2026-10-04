-- Enrichment Pipeline v2 — Phase 1 (accuracy core): per-field provenance and
-- change history. Purely additive — two new tables, no changes to any
-- existing table. See docs/enrichment_v2_spec.md, issue 3.
--
--   field_provenance — one row per material value v2 accepted and wrote,
--     recording exactly which source backed it and at what confidence.
--     This is what lets write.ts's "overwrite only if higher-ranked source,
--     or 2 independent verified sources vs. no existing provenance" rule
--     work at all — without a provenance row for the CURRENT value, there's
--     nothing to compare a new candidate value against.
--   field_changes — one row per overwrite of an existing value, so every
--     correction v2 ever makes is visible and reversible, not just visible
--     in the moment it happened.

create table if not exists public.field_provenance (
  id             uuid primary key default gen_random_uuid(),
  startup_id     uuid not null references public.startups(id) on delete cascade,
  field          text not null,
  value          jsonb not null,
  source_url     text,
  source_type    text not null check (source_type in (
                   'manual', 'registry', 'company_site', 'press_release',
                   'news', 'aggregator_snippet', 'model_inferred'
                 )),
  evidence_quote text,
  confidence     integer check (confidence between 0 and 100),
  run_id         uuid references public.enrichment_runs(run_id) on delete set null,
  created_at     timestamptz not null default now()
);

comment on table public.field_provenance is
  'One row per material value v2 accepted and wrote to startups (or a related table) — field name, the value itself, its source and source_type rank, the verbatim evidence_quote that supported it, and the run that wrote it. The CURRENT provenance for a field is its most recent row by created_at. Enables the overwrite rule in lib/enrichment/write.ts (issue 3): a new value may replace an existing one only when it outranks this row''s source_type, or is corroborated by 2 independent verified sources while this field has no provenance row at all.';

comment on column public.field_provenance.field is
  'Dot-path of the field this value belongs to, e.g. "profile.city", "funding_rounds[<round-id>].amount_raised" — matches the field names used in lib/enrichment/validation.ts and confidence.ts.';

comment on column public.field_provenance.source_type is
  'Ranking (highest first) used by write.ts''s overwrite rule: manual > registry > company_site > press_release > news > aggregator_snippet > model_inferred. Classified by domain in lib/enrichment/sources.ts.';

create index if not exists idx_field_provenance_startup_field
  on public.field_provenance (startup_id, field, created_at desc);
create index if not exists idx_field_provenance_run
  on public.field_provenance (run_id);

create table if not exists public.field_changes (
  id          uuid primary key default gen_random_uuid(),
  startup_id  uuid not null references public.startups(id) on delete cascade,
  field       text not null,
  old_value   jsonb,
  new_value   jsonb not null,
  source_url  text,
  run_id      uuid references public.enrichment_runs(run_id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.field_changes is
  'One row per time v2 OVERWRITES an existing non-null value (never fires for a plain fill-null-once write — only for a genuine correction). Makes every correction v2 ever makes visible and reversible, independent of field_provenance (which only tracks the current accepted value, not the history of what it replaced).';

create index if not exists idx_field_changes_startup_field
  on public.field_changes (startup_id, field, created_at desc);
