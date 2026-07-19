-- =============================================================================
-- Migration: investor_amounts_acquisitions_patents
-- Created:   2026-07-19
-- Description: Three additive fields for scripts/bulk_enrich_all.ts, all
--              following the pipeline's existing conventions (fill-null-only
--              writes, omit rather than guess, jsonb for irregular shapes):
--
--   1. funding_rounds.investor_amounts — per-investor dollar amounts within a
--      round, for the rare case where a specific investor's contribution is
--      disclosed (e.g. "Sequoia led with $20M of the $50M round"). Layered on
--      top of the existing lead_investor/investors[] name columns, which
--      remain the source of truth for WHO participated; this only adds HOW
--      MUCH for whichever names happen to be disclosed. A per-investor total
--      across a company's full history is computed client-side by summing
--      this across rounds (src/app/pages/Startups.tsx buildInvestorSchedule);
--      the company-wide total is the existing SUM(funding_rounds.amount_raised).
--
--   2. startups.acquisitions — companies THIS startup has acquired (the
--      reverse direction from being acquired, which is already tracked via
--      funding_rounds.round_type = 'Acquired'). Same shape/cross-linking
--      pattern as startups.competitors (20260719000000_automate_competitors.sql):
--      an array of {company_name, website, acquired_date, amount,
--      description, acquired_startup_id}, with acquired_startup_id set when
--      domain-matched to another row in this table.
--
--   3. startups.patent_count / patent_fields — best-effort IP signal, mined
--      opportunistically (no dedicated search call) since general web search
--      often can't surface real patent data. NULL is the honest default, not
--      "zero patents".
-- =============================================================================

ALTER TABLE funding_rounds
  ADD COLUMN IF NOT EXISTS investor_amounts jsonb;

COMMENT ON COLUMN funding_rounds.investor_amounts IS
  'JSONB array of {name, amount}, one entry per investor (matching lead_investor or an entry in investors[]) whose specific dollar contribution to THIS round is disclosed. Rare — most rounds only disclose the round total. Auto-populated by scripts/bulk_enrich_all.ts; null/absent means no per-investor split is known, not zero.';

ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS acquisitions jsonb;

COMMENT ON COLUMN startups.acquisitions IS
  'JSONB array of {company_name, website, acquired_date, amount, description, acquired_startup_id} — companies THIS startup has acquired. Auto-populated by scripts/bulk_enrich_all.ts (fill-null only — never overwrites pre-existing curated data). acquired_startup_id is set when domain-matched to another tracked startup.';

ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS patent_count integer CHECK (patent_count >= 0);

ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS patent_fields text[];

COMMENT ON COLUMN startups.patent_count IS
  'Best-available count of patents held/filed, mined opportunistically during enrichment (no dedicated search — general web search rarely surfaces real patent data). NULL when not found — never guessed or defaulted to 0.';

COMMENT ON COLUMN startups.patent_fields IS
  'Technology/subject areas the company''s patents cover (e.g. "Natural Language Processing"), when identifiable alongside patent_count.';
