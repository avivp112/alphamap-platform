-- Serper and Jina back each other up (owner, 2026-10-29): Jina Search answers
-- a search Serper could not, Serper's scrape endpoint reads a page Jina could
-- not. Their results are stored as evidence under their own provider names.
alter table public.enrichment_evidence drop constraint if exists enrichment_evidence_provider_check;
alter table public.enrichment_evidence add constraint enrichment_evidence_provider_check
  check (provider in ('serper', 'tavily', 'jina', 'tavily_extract', 'cheerio', 'jina_search', 'serper_scrape'));
