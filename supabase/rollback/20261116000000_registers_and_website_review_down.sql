drop function if exists public.note_website_issue(uuid, text, text, text);
drop table if exists public.website_review;
alter table public.enrichment_evidence drop constraint if exists enrichment_evidence_provider_check;
alter table public.enrichment_evidence add constraint enrichment_evidence_provider_check
  check (provider in ('serper', 'tavily', 'jina', 'tavily_extract', 'cheerio', 'jina_search', 'serper_scrape'));
