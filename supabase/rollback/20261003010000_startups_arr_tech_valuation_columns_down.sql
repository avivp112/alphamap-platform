alter table public.startups
  drop column if exists value_proposition,
  drop column if exists employee_range,
  drop column if exists tech_stack,
  drop column if exists github_url,
  drop column if exists huggingface_url,
  drop column if exists arr_milestones,
  drop column if exists revenue_estimate,
  drop column if exists valuation_benchmarks;

comment on column public.startups.founders is
  'JSONB array of founder objects: [{name, linkedin_url, had_prior_exit, elite_background, notable_pedigree}]. Merged as a union across runs, never destructive (see patchStartupProfile in bulk_enrich_all.ts).';

comment on column public.startups.leadership is
  'JSONB array of {name, role, linkedin_url, joined_date, had_prior_exit, elite_background, notable_pedigree}. Set only when currently NULL (see patchStartupProfile in bulk_enrich_all.ts).';
