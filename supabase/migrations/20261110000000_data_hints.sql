-- =============================================================================
-- 20261110000000_data_hints.sql
--
-- data_hints: what a data platform (lib/enrichment/dataPlatforms.ts) states
-- and no primary source confirmed yet — a search lead, never a fact (owner,
-- 2026-10-28). Enrichment searches for a primary source for each one
-- (lib/enrichment/hints.ts); confirmed, the value is written with that source
-- and the hint is marked confirmed; not found, it stays here for the next
-- enrichment to look again.
--
-- Internal only: row level security with no policy — the site (anon and
-- signed-in users) and the public API read nothing; only the service role
-- (enrichment, the worker, scripts) does. No view, export or RPC reads it.
--
-- Additive. Rollback: supabase/rollback/20261110000000_data_hints_down.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.data_hints (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id    uuid        NOT NULL REFERENCES public.startups (id) ON DELETE CASCADE,
  kind          text        NOT NULL CHECK (kind IN ('funding_round')),
  -- One hint per value: for a round, its amount and month (hints.ts hintKey).
  hint_key      text        NOT NULL,
  value         jsonb       NOT NULL,
  source_url    text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  searched_at   timestamptz,
  status        text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'dismissed')),
  confirmed_source_url text,
  run_id        uuid        REFERENCES public.enrichment_runs (run_id) ON DELETE SET NULL,
  UNIQUE (startup_id, kind, hint_key)
);

COMMENT ON TABLE public.data_hints IS
  'Values only a data platform states (Dealroom, Crunchbase, PremierAlts ...): search leads for enrichment, never shown, exported or served by the API. Confirmed by a primary source → written with that source, status confirmed. lib/enrichment/hints.ts.';

CREATE INDEX IF NOT EXISTS idx_data_hints_open ON public.data_hints (startup_id) WHERE status = 'open';

ALTER TABLE public.data_hints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_hints FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_hints TO service_role;

-- Confirm: the table exists and no one but the service role can read it.
SELECT has_table_privilege('anon', 'public.data_hints', 'SELECT') AS anon_can_read,
       has_table_privilege('authenticated', 'public.data_hints', 'SELECT') AS users_can_read;
