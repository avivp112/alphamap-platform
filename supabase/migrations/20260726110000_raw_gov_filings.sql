-- =============================================================================
-- Migration: raw_gov_filings — government registration filings, as filed
-- Created:   2026-07-26
-- Description:
--   Landing table for company registrations sourced from government systems,
--   starting with SEC Form D (Regulation D exempt offering — what a US company
--   files days after closing a private round).
--
--   This is the INCEPTION layer of the sourcing pipeline. Every other source we
--   have is downstream of a company already existing publicly: an ATS board
--   means they are hiring, which means they have money and staff. Form D fires
--   at the moment the money arrives, often before there is a website, and it
--   carries the one field the FOMO engine has been missing entirely —
--   yearOfInc, the incorporation year. All 32 currently-linked boards have a
--   NULL founded_year, so pts_age has never contributed a single point.
--
-- ── WHY A RAW TABLE AND NOT STRAIGHT INTO startups ──────────────────────────
--   Three reasons, in order of how much they hurt when ignored:
--
--   1. A filing is an EVENT, a startup is an ENTITY. One company files Form D
--      at every round, plus amendments (D/A). Collapsing those into the entity
--      row destroys the sequence — and the sequence is the signal: first-ever
--      filing date is an inception proxy, filing cadence is a momentum proxy.
--
--   2. Re-parsing. The extractor will get things wrong (it always does), and
--      when it does we want to re-derive from what SEC actually served, not
--      re-fetch 200,000 documents. raw_payload holds the parse verbatim.
--
--   3. Attribution. When a startups row says founded_year 2024, this table is
--      the answer to "says who?" — accession number, CIK and filing date, all
--      independently verifiable against sec.gov.
--
-- ── ON NOT UNIQUE-ING BY COMPANY ────────────────────────────────────────────
--   The unique key is (source, accession_number). An accession number is SEC's
--   own immutable identifier for one submitted document, so it is exactly the
--   right grain: re-ingesting the same day is a no-op, while a genuine second
--   filing by the same company is a new row, which is what we want.
--
--   startup_id is NULLABLE and deliberately so. A filing whose issuer we cannot
--   confidently match to a startups row is still worth keeping — it is evidence
--   that arrived before we had anywhere to put it, and a later backfill can
--   link it. Discarding unmatched filings would silently throw away exactly the
--   earliest-stage companies this layer exists to find.
--
-- Rollback: supabase/rollback/20260726110000_raw_gov_filings_down.sql
--
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS raw_gov_filings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which government system this came from. Constrained rather than free text
  -- so a typo in one ingester cannot silently create a phantom source that
  -- every downstream query then misses.
  source            text        NOT NULL CHECK (source IN ('sec_form_d')),

  -- SEC's immutable per-document id, e.g. '0001234567-26-000123'. Together
  -- with source this is the natural key.
  accession_number  text        NOT NULL,

  -- Central Index Key: SEC's per-ENTITY id, stable across all of a company's
  -- filings forever. The strongest join key we will ever get for a US company,
  -- and far better than name matching.
  cik               text,

  form_type         text,                       -- 'D' or 'D/A' (amendment)
  entity_name       text        NOT NULL CHECK (btrim(entity_name) <> ''),
  filing_date       date        NOT NULL,

  -- Incorporation year as the ISSUER declared it. NOT copied blindly into
  -- startups.founded_year, which has a CHECK constraint — see the ingest
  -- function, which clamps and drops anything implausible.
  year_of_inc       integer,
  jurisdiction      text,                       -- 'DELAWARE', 'CALIFORNIA', ...

  -- SEC's own industry taxonomy ('Computers', 'Other Technology',
  -- 'Pooled Investment Fund'...). Preserved verbatim. NOT written into
  -- startups.industry: classify_sector_parent() has no patterns for SEC's
  -- vocabulary, so 'Computers' would classify as 'Uncategorized', and a
  -- non-blank industry that classifies as Uncategorized is EXCLUDED by
  -- board_discovery_candidates. Storing it here keeps the fact without
  -- tripping that filter.
  industry_group    text,

  -- Officers, directors and promoters from relatedPersonsList, as
  -- [{"name": "...", "relationships": ["Executive Officer", "Director"]}].
  -- jsonb not text[] because the relationship list is the interesting half:
  -- a filing listing one person who is both Executive Officer and Director
  -- looks very different from one listing nine.
  officers          jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- Short human-readable digest, composed from fields above at ingest time.
  -- Purely derived — never a substitute for the columns, and safe to rebuild.
  tech_summary      text,

  -- Offering economics. numeric, not bigint: SEC permits values above 2^63 in
  -- indefinite offerings, and a range error on ingest would drop the filing.
  total_offering    numeric,
  total_sold        numeric,

  -- The full parse as structured JSON, so a corrected extractor can re-derive
  -- every column above without re-fetching from SEC.
  raw_payload       jsonb,

  startup_id        uuid        REFERENCES startups (id) ON DELETE SET NULL,

  ingested_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT raw_gov_filings_unique_document UNIQUE (source, accession_number),
  -- A filing cannot pre-date EDGAR itself; catches a date parsed out of the
  -- wrong column far more cheaply than noticing skewed scores months later.
  CONSTRAINT raw_gov_filings_plausible_date CHECK (filing_date >= DATE '1993-01-01'),
  CONSTRAINT raw_gov_filings_officers_is_array CHECK (jsonb_typeof(officers) = 'array')
);

COMMENT ON TABLE raw_gov_filings IS
  'Government registration filings as filed, one row per document. Grain is the filing EVENT, not the company: a startup files Form D at every round. Unique on (source, accession_number) — SEC''s own document id — so re-ingesting a day is a no-op while a genuine new filing is a new row.';

COMMENT ON COLUMN raw_gov_filings.cik IS
  'SEC Central Index Key — the entity id, stable across every filing a company ever makes. The strongest join key available for a US company.';
COMMENT ON COLUMN raw_gov_filings.industry_group IS
  'SEC industry taxonomy verbatim. Deliberately not copied to startups.industry, where it would classify as Uncategorized and get the company excluded from board_discovery_candidates.';
COMMENT ON COLUMN raw_gov_filings.startup_id IS
  'Link to the entity row. NULLABLE on purpose — an unmatched filing is still evidence worth keeping, and dropping it would discard the earliest-stage companies.';

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- Inception scoring reads "earliest filing per startup", so (startup_id,
-- filing_date) serves both the join and the min() without a sort.
CREATE INDEX IF NOT EXISTS idx_raw_gov_filings_startup_date
  ON raw_gov_filings (startup_id, filing_date)
  WHERE startup_id IS NOT NULL;

-- The backfill query: filings we could not attach to an entity.
CREATE INDEX IF NOT EXISTS idx_raw_gov_filings_unlinked
  ON raw_gov_filings (filing_date DESC)
  WHERE startup_id IS NULL;

-- "What did we ingest for this day / has this day been done" — the ingester's
-- own resume check.
CREATE INDEX IF NOT EXISTS idx_raw_gov_filings_source_date
  ON raw_gov_filings (source, filing_date DESC);

CREATE INDEX IF NOT EXISTS idx_raw_gov_filings_cik
  ON raw_gov_filings (cik)
  WHERE cik IS NOT NULL;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Same posture as the sourcing tables: readable by signed-in users, writable
-- only by the service role that runs the ingester. anon gets nothing.
ALTER TABLE raw_gov_filings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS raw_gov_filings_read ON raw_gov_filings;
CREATE POLICY raw_gov_filings_read
  ON raw_gov_filings FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS raw_gov_filings_service_all ON raw_gov_filings;
CREATE POLICY raw_gov_filings_service_all
  ON raw_gov_filings FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON raw_gov_filings TO authenticated;
GRANT ALL    ON raw_gov_filings TO service_role;
REVOKE ALL   ON raw_gov_filings FROM anon;
