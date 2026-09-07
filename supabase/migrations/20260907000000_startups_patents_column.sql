-- Individual patent/patent-application records for a startup — additive
-- alongside the existing patent_count/patent_fields summary scalars, not a
-- replacement for them. Same JSONB-array-of-objects shape as news/
-- competitors/acquisitions: [{ title, patent_number, filing_date, url, summary }].
-- Populated by scripts/bulk_enrich_all.ts's dedicated patent search pass.

alter table public.startups
  add column if not exists patents jsonb;

comment on column public.startups.patents is
  'Array of individual patent records: [{title, patent_number, filing_date, url, summary}]. Fill-null-when-empty, written by bulk_enrich_all.ts. Distinct from the older patent_count/patent_fields summary columns.';
