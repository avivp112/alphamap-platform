-- Widen funding_rounds.round_type's CHECK constraint to accept v2's richer
-- round-type taxonomy (spec issue 5), discovered necessary by a real
-- DRY_RUN test run: extraction produced "Venture Debt" for a real round,
-- which v2's own CanonicalRoundType list (lib/enrichment/rounds.ts) allows,
-- but the EXISTING constraint does not -- a real (non-DRY_RUN) insert would
-- have been rejected outright by Postgres.
--
-- Purely additive: every value the constraint already accepts stays
-- accepted (ground rule 6 -- never drop/rename), this only ADDS new
-- allowed values. No existing data is touched. 'Series E+' is kept
-- alongside the new split 'Series E'/'Series F+' rather than migrated --
-- v2's normalizeRoundType() consolidates a future 'Series E+' INPUT into
-- 'Series E' going forward, but existing rows that already say
-- 'Series E+' are left exactly as they are.

ALTER TABLE public.funding_rounds DROP CONSTRAINT IF EXISTS funding_rounds_round_type_check;

ALTER TABLE public.funding_rounds ADD CONSTRAINT funding_rounds_round_type_check
  CHECK (round_type IN (
    'Pre-Seed', 'Seed',
    'Series A', 'Series B', 'Series C', 'Series D', 'Series E', 'Series E+', 'Series F+',
    'Growth', 'Bridge', 'Venture Debt', 'Debt', 'Secondary', 'PE Buyout',
    'Convertible Note', 'Bootstrapped', 'Grant', 'Acquired', 'IPO', 'Other', 'Unknown'
  ));

COMMENT ON CONSTRAINT funding_rounds_round_type_check ON public.funding_rounds IS
  'Widened for v2 (lib/enrichment/rounds.ts CanonicalRoundType) to add Series E/Series F+/Venture Debt/Debt/Secondary/PE Buyout/Unknown alongside every value v1 already wrote. Series E+ is kept for existing rows -- v2 only stops WRITING new Series E+ rows, it never renames old ones.';
