-- Financial milestones, tech/IP links, and valuation benchmarks for a
-- startup — additive columns for scripts/bulk_enrich_all.ts's expanded
-- extraction pass (Serper + Jina Reader research -> Claude extraction).
-- Same JSONB-array-of-objects shape as news/competitors/acquisitions/patents
-- where the field is a history of point-in-time facts; a plain scalar
-- column otherwise. All fill-null or append-and-dedupe written, never
-- destructive — see patchStartupProfile() in bulk_enrich_all.ts.

alter table public.startups
  add column if not exists value_proposition   text,
  add column if not exists employee_range      text,
  add column if not exists tech_stack          text[],
  add column if not exists github_url          text,
  add column if not exists huggingface_url     text,
  add column if not exists arr_milestones      jsonb,
  add column if not exists revenue_estimate    jsonb,
  add column if not exists valuation_benchmarks jsonb;

comment on column public.startups.value_proposition is
  'One-to-two sentence differentiator/positioning statement, distinct from the fuller multi-sentence `description`. Fill-null-only, written by bulk_enrich_all.ts.';

comment on column public.startups.employee_range is
  'Best-fit employee-count bracket (e.g. "51-200"), alongside the exact employee_count scalar — some sources (LinkedIn company size, Crunchbase) only ever report a range. Always refreshed (time-varying), written by bulk_enrich_all.ts.';

comment on column public.startups.tech_stack is
  'Core technologies/frameworks the company is known to build on (e.g. "Python", "Kubernetes", "PyTorch") — best-effort, omitted rather than guessed. Fill-null-when-empty, written by bulk_enrich_all.ts.';

comment on column public.startups.github_url is
  'Company/org GitHub URL, when found. Fill-null-only, written by bulk_enrich_all.ts.';

comment on column public.startups.huggingface_url is
  'Company/org Hugging Face URL, when found. Fill-null-only, written by bulk_enrich_all.ts.';

comment on column public.startups.arr_milestones is
  'Array of reported ARR milestones: [{arr, date, source, confidence}] (arr = USD plain integer; confidence = "low"|"medium"|"high"). Point-in-time facts accumulated across runs, append-and-dedupe by (arr, date) — never overwritten wholesale. Written by bulk_enrich_all.ts.';

comment on column public.startups.revenue_estimate is
  'Single current best-estimate revenue range: {range_low, range_high, as_of_date, source, confidence}, all USD plain integers where numeric. Fill-null-only (a single current snapshot, not a history — see arr_milestones for the time series). Written by bulk_enrich_all.ts.';

comment on column public.startups.valuation_benchmarks is
  'Array of press/analyst-reported valuation benchmarks NOT tied to a specific confirmed funding_rounds entry: [{valuation, date, source, is_estimated}] (valuation = USD plain integer). Distinct from funding_rounds.valuation, which is the post-money valuation of one specific announced round. Point-in-time facts accumulated across runs, append-and-dedupe by (valuation, date). Written by bulk_enrich_all.ts.';

comment on column public.startups.founders is
  'JSONB array of founder objects: [{name, linkedin_url, title, bio, had_prior_exit, elite_background, notable_pedigree}]. title/bio are optional and additive (added alongside arr_milestones/tech_stack in 20261003010000) — omitted when not found, never guessed. Merged as a union across runs, never destructive (see patchStartupProfile in bulk_enrich_all.ts).';

comment on column public.startups.leadership is
  'JSONB array of {name, role, linkedin_url, joined_date, bio, had_prior_exit, elite_background, notable_pedigree}. bio is optional and additive (added in 20261003010000) — omitted when not found, never guessed. Set only when currently NULL (see patchStartupProfile in bulk_enrich_all.ts).';
