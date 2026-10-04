-- Enrichment Pipeline v2 — Phase 0 (measurement baseline): evidence storage
-- and run metadata. Purely additive — two new tables, no changes to any
-- existing table. Needed before any v2 extraction code exists, because:
--   1. eval/run_eval.ts (Phase 0) needs somewhere to record what v1 produced
--      on the golden set, and v2 (Phase 1+) needs somewhere to record what
--      every search/fetch actually returned, so a value can be traced back
--      to the exact source that supported it (issue 1) and a run can be
--      replayed from stored evidence without paying for new searches
--      (issue 14, REEXTRACT_FROM_RUN).
--   2. field_provenance / field_changes (issue 3) and tech_signal_snapshots
--      (issue 11) are NOT created here — those are Phase 1 and Phase 2
--      concerns respectively, per the phased rollout plan. Only what Phase 0
--      itself needs lands in this migration.

create table if not exists public.enrichment_runs (
  run_id          uuid primary key default gen_random_uuid(),
  pipeline        text not null check (pipeline in ('v1', 'v2')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  git_sha         text,
  profile_model   text,
  funding_model   text,
  prompt_version  text,
  thresholds      jsonb,
  dry_run         boolean not null default true,
  total_cost_usd  numeric,
  companies_count integer,
  created_at      timestamptz not null default now()
);

comment on table public.enrichment_runs is
  'One row per bulk_enrich_all.ts / bulk_enrich_v2.ts / eval/run_eval.ts invocation — the thresholds/models/prompt_version actually used, so a result can always be traced back to exactly how it was produced. Written by all three scripts once v2/eval land; v1 writes nothing here until it is explicitly wired up (optional, not required by Phase 0).';

comment on column public.enrichment_runs.pipeline is
  '''v1'' (bulk_enrich_all.ts / its baseline eval run) or ''v2'' (bulk_enrich_v2.ts) — lets later phases compare the two directly.';

comment on column public.enrichment_runs.thresholds is
  'Snapshot of the threshold env vars in effect for this run (MIN_CONFIDENCE, MIN_PROFILE_CONFIDENCE, MIN_FUNDING_CONFIDENCE, etc.) — so a later change to a default cannot silently reinterpret an old run''s results.';

create index if not exists idx_enrichment_runs_pipeline_started
  on public.enrichment_runs (pipeline, started_at desc);

create table if not exists public.enrichment_evidence (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.enrichment_runs(run_id) on delete cascade,
  startup_id    uuid not null references public.startups(id) on delete cascade,
  source_id     text not null,
  query_label   text,
  provider      text not null check (provider in ('serper', 'tavily', 'jina', 'tavily_extract', 'cheerio')),
  url           text,
  title         text,
  content       text,
  fetched_at    timestamptz not null default now(),
  kept          boolean not null default true,
  drop_reason   text
);

comment on table public.enrichment_evidence is
  'Every raw search result / fetched page a run looked at for a company, labeled with the source_id (S1, W1, ...) referenced by field_provenance.evidence_quote and the save_enrichment schema''s source_id fields (issue 1). kept=false + drop_reason records what filterByEntity()/verifyEvidence() rejected and why (issue 2), so a run is fully auditable even when most of what it saw was discarded. Retention: full content kept 90 days (issue 14) — a follow-up migration adds the cleanup job once that policy is implemented in code.';

comment on column public.enrichment_evidence.source_id is
  'The short id this piece of evidence was labeled with in the extraction context, e.g. "S3" (a search result) or "W1" (a fetched website page) — matches the source_id an extracted field cites.';

comment on column public.enrichment_evidence.drop_reason is
  'Reason code when kept=false, e.g. entity_mismatch, not_distinctive_name, country_contradiction, low_evidence — see lib/enrichment/entity.ts and lib/enrichment/evidence.ts (Phase 1).';

create index if not exists idx_enrichment_evidence_run
  on public.enrichment_evidence (run_id);
create index if not exists idx_enrichment_evidence_startup
  on public.enrichment_evidence (startup_id, fetched_at desc);
create index if not exists idx_enrichment_evidence_source_id
  on public.enrichment_evidence (run_id, source_id);
