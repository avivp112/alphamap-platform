-- =============================================================================
-- Migration: allow 'epo_ops' as a government filing source
-- Created:   2026-07-26
-- Description:
--   One CHECK value. Everything else this source needs already exists —
--   classification_codes, title, abstract and the unlinked/inventor-held path
--   were built for patents in 20260726130000.
--
-- ── WHY A SEPARATE SOURCE AND NOT 'uspto_patent' ────────────────────────────
--   The records are US publications either way, so reusing the existing value
--   was tempting. It would have been wrong: provenance is not cosmetic here.
--
--   EPO OPS serves DOCDB, which is EPO's own worldwide collection assembled
--   from national office feeds. It lags USPTO direct by days to weeks, it
--   normalises applicant names through EPO's rules rather than USPTO's, and it
--   carries EPO's classification assignments. If we ever DO get a PatentsView
--   key and run both, rows from the two would disagree on names and dates for
--   the same invention — and with one source label there would be no way to
--   tell which pipeline produced which row, or to prefer one over the other.
--
--   The cost of a second value is one CHECK entry. The cost of conflating them
--   is a dataset nobody can reason about later.
--
-- Rollback: supabase/rollback/20260726150000_epo_ops_source_down.sql
--
-- Idempotent.
-- =============================================================================

ALTER TABLE raw_gov_filings DROP CONSTRAINT IF EXISTS raw_gov_filings_source_check;
ALTER TABLE raw_gov_filings
  ADD CONSTRAINT raw_gov_filings_source_check
  CHECK (source IN ('sec_form_d', 'uk_companies_house', 'uspto_patent', 'epo_ops'));

COMMENT ON COLUMN raw_gov_filings.source IS
  'Originating registry. epo_ops and uspto_patent both yield US publications but from different corpora — EPO DOCDB versus USPTO direct — with different lag and different applicant-name normalisation. Kept distinct so rows remain attributable if both ever run.';
