-- =============================================================================
-- PROPOSAL ONLY — not in supabase/migrations/, not applied, needs Aviv's approval (decisions 1-3 in the brief).
-- Funds project: firms / funds / people / investments / provenance / metrics / waitlist.
--
-- Principles
--  * Purely additive: new tables only. No DROP, no DELETE, no ALTER of an existing table's data.
--    `investors`, `vc_fund_filings`, `funding_rounds`, `field_provenance` are NOT touched, so v2 and the app are unaffected.
--  * `investors` stays what the VCs page reads today; each fund_firms row may point at it (legacy_investor_id).
--  * Provenance is its own table (fund_provenance), same columns as field_provenance, but polymorphic:
--    field_provenance.startup_id is NOT NULL REFERENCES startups, and its source_type CHECK has no 'legacy'.
--  * Internal only (RLS on, no public policy), like data_hints: source and quote are never shown in the app.
--
-- Rollback (only new tables, so it is safe to run after approval): DROP TABLE fund_metrics, fund_waitlist, fund_investments,
--   fund_performance, fund_lps, fund_people, fund_vehicles, fund_firms, fund_provenance CASCADE;   -- in this order
-- =============================================================================

-- ── Provenance: one row per accepted value, for any fund entity ─────────────────────────────────
CREATE TABLE IF NOT EXISTS fund_provenance (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type      text NOT NULL CHECK (entity_type IN ('firm','fund','person','investment','lp','performance')),
  entity_id        uuid NOT NULL,                       -- polymorphic: no FK on purpose; integrity is checked by report_lint / verify
  field            text NOT NULL,                       -- 'firm.hq_city', 'fund.size_final', 'investment.role' ...
  value            jsonb NOT NULL,
  source_url       text,
  source_type      text NOT NULL CHECK (source_type IN ('manual','registry','company_site','press_release','news','aggregator_snippet','model_inferred','legacy')),
  evidence_quote   text,
  quote_original   text,                                -- as v2: the page's own words ...
  quote_translated text,                                -- ... and the English it was verified against
  confidence       integer CHECK (confidence BETWEEN 0 AND 100),
  as_of            date,                                -- the source's own date for the value (AUM, performance, hq statement)
  run_id           uuid,                                -- enrichment_runs.run_id; FK added once its pipeline CHECK allows 'funds' (see decision A)
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fund_prov_entity ON fund_provenance (entity_type, entity_id, field, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fund_prov_run    ON fund_provenance (run_id);

-- ── Level 1: the management company ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fund_firms (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,                     -- given by Aviv
  website            text NOT NULL,                     -- given by Aviv; identity is the DOMAIN, never the name
  website_domain     text GENERATED ALWAYS AS (lower(regexp_replace(regexp_replace(website, '^[a-z]+://', ''), '^www\.|/.*$', '', 'g'))) STORED,
  legal_name         text,
  investor_type      text CHECK (investor_type IN ('vc','cvc','micro_vc','accelerator','pe','family_office','angel_network')),
  classification     jsonb,                             -- the saved gate decision (like tech_overrides): who/when/why
  scope_status       text NOT NULL DEFAULT 'pending' CHECK (scope_status IN ('pending','in_scope','skipped_out_of_scope','domain_unresolved','domain_repurposed','needs_aviv')),
  hq_city            text, hq_country text,
  offices            jsonb,
  founded_year       integer CHECK (founded_year BETWEEN 1800 AND 2100),
  description        text, thesis text,
  stages             text[] NOT NULL DEFAULT '{}',
  sectors            text[] NOT NULL DEFAULT '{}',
  geographies        text[] NOT NULL DEFAULT '{}',
  check_size_text    text,                              -- as written
  aum_text           text,                              -- as written: "over $1B"
  aum_as_of          date,                              -- date of that source; the latest one wins
  team_size          integer,
  legacy_investor_id uuid REFERENCES investors (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fund_firms_domain ON fund_firms (website_domain);

-- name variants seen in rounds / press, resolved to a firm only through a decided link (never by name alone)
CREATE TABLE IF NOT EXISTS fund_name_aliases (
  alias_exact_key text NOT NULL,                        -- lib/funds/investorNames.ts exact_key
  firm_id         uuid NOT NULL REFERENCES fund_firms (id) ON DELETE CASCADE,
  basis           text NOT NULL CHECK (basis IN ('domain','full_name_and_city','aviv_decision')),
  decided_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (alias_exact_key, firm_id)
);

-- ── Level 2: the vehicles ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fund_vehicles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            uuid NOT NULL REFERENCES fund_firms (id) ON DELETE CASCADE,
  name               text NOT NULL,                     -- "Fund III"
  legal_name         text,                              -- Form D entity name
  fund_number        integer,
  vintage_year       integer,                           -- Form D date of first sale, else the announcement
  status             text CHECK (status IN ('raising','closed')),
  size_final         numeric,                           -- only with "final close"/"closed"/"raised", or Form D total sold   (rule 1)
  target_size        numeric,                           -- "target"/"seeking" — never mixed into size_final
  first_close_size   numeric,                           -- three different numbers
  currency           text,
  form_d_cik         text,
  form_d_accession   text,
  vc_fund_filing_id  uuid REFERENCES vc_fund_filings (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fund_vehicles_firm ON fund_vehicles (firm_id);

-- partners: only Partner / General / Managing / Founding Partner count; the rest are kept apart (rule 4)
CREATE TABLE IF NOT EXISTS fund_people (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    uuid NOT NULL REFERENCES fund_firms (id) ON DELETE CASCADE,
  full_name  text NOT NULL,
  title      text NOT NULL,                             -- as written
  role_class text NOT NULL CHECK (role_class IN ('partner','venture_partner','advisor','eir','operating_partner','other')),
  UNIQUE (firm_id, full_name)
);

CREATE TABLE IF NOT EXISTS fund_lps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES fund_vehicles (id) ON DELETE CASCADE,
  lp_name text NOT NULL, UNIQUE (fund_id, lp_name)
);

-- performance: official reports only, as-of mandatory (rule 6); the NOT NULLs enforce it
CREATE TABLE IF NOT EXISTS fund_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES fund_vehicles (id) ON DELETE CASCADE,
  reporting_lp text NOT NULL,                           -- 'CalPERS', 'CalSTRS', 'UC Investments' ...
  report_url   text NOT NULL,
  as_of        date NOT NULL,
  irr numeric, tvpi numeric, dpi numeric, committed numeric,
  CHECK (irr IS NOT NULL OR tvpi IS NOT NULL OR dpi IS NOT NULL),
  UNIQUE (fund_id, reporting_lp, as_of)
);

-- ── Table 3: the link to the company database ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fund_investments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id           uuid REFERENCES fund_firms (id) ON DELETE CASCADE,
  fund_id           uuid REFERENCES fund_vehicles (id) ON DELETE CASCADE,
  startup_id        uuid REFERENCES startups (id) ON DELETE CASCADE,        -- NULL while on the waitlist
  round_id          uuid REFERENCES funding_rounds (id) ON DELETE SET NULL,
  direction         text NOT NULL CHECK (direction IN ('from_fund_site','from_company_round')),
  match_basis       text CHECK (match_basis IN ('domain','full_name_and_city')),  -- rule 7; NULL only when startup_id IS NULL
  round_type        text,
  role              text NOT NULL DEFAULT 'unknown' CHECK (role IN ('lead','co_lead','participant','unknown')),  -- rule 2
  investment_date   date,
  portfolio_status  text CHECK (portfolio_status IN ('active','exited','listed_in_portfolio')),                  -- rule 3
  scanned_on        date,                               -- date of the scan, for "listed_in_portfolio"
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (firm_id IS NOT NULL OR fund_id IS NOT NULL),
  CHECK (startup_id IS NULL OR match_basis IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_fund_inv_startup ON fund_investments (startup_id) WHERE startup_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fund_inv_firm    ON fund_investments (firm_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fund_inv_round ON fund_investments (firm_id, round_id) WHERE round_id IS NOT NULL;

-- companies seen in a portfolio / round that the match rule could not settle, or that are not in startups (decision 3)
CREATE TABLE IF NOT EXISTS fund_waitlist (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       uuid NOT NULL REFERENCES fund_firms (id) ON DELETE CASCADE,
  company_name  text NOT NULL, company_website text, company_city text,
  reason        text NOT NULL CHECK (reason IN ('not_in_startups','ambiguous_match','logo_only_no_name')),
  candidate_startup_ids uuid[] NOT NULL DEFAULT '{}',
  source_url    text, evidence_quote text,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','added_to_startups','dismissed')),
  first_seen_at timestamptz NOT NULL DEFAULT now()
);

-- ── Computed benchmark metrics (derived, never collected) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS fund_metrics (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      uuid REFERENCES fund_firms (id) ON DELETE CASCADE,
  fund_id      uuid REFERENCES fund_vehicles (id) ON DELETE CASCADE,
  metric       text NOT NULL,                           -- 'deals_per_year','lead_rate','graduation_24m','exit_rate','mortality_rate',...
  slice        text NOT NULL DEFAULT 'all',             -- 'all' | 'stage=Seed' | 'year=2023' ...
  value        numeric,
  n_points     integer NOT NULL,                        -- how many observations the value rests on; the app hides low n
  numerator    integer, denominator integer,
  definition_version text NOT NULL,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (firm_id IS NOT NULL OR fund_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_fund_metrics_firm ON fund_metrics (firm_id, metric);

-- ── Access: service role only; nothing is readable from the site ───────────────────────────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fund_provenance','fund_firms','fund_name_aliases','fund_vehicles','fund_people','fund_lps','fund_performance','fund_investments','fund_waitlist','fund_metrics'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END $$;
