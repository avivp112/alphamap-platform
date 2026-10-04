-- Rollback: restore the original (narrower) round_type CHECK constraint.
-- Only safe to run if no row has been written with one of the newly-added
-- values (Series E, Series F+, Venture Debt, Debt, Secondary, PE Buyout,
-- Unknown) -- otherwise this ALTER itself will fail with a constraint
-- violation, which is the correct, safe behavior (never silently drops
-- data to satisfy a tighter constraint).

ALTER TABLE public.funding_rounds DROP CONSTRAINT IF EXISTS funding_rounds_round_type_check;

ALTER TABLE public.funding_rounds ADD CONSTRAINT funding_rounds_round_type_check
  CHECK (round_type IN (
    'Pre-Seed', 'Seed',
    'Series A', 'Series B', 'Series C', 'Series D', 'Series E+',
    'Growth', 'Bridge', 'Convertible Note',
    'Bootstrapped', 'Grant', 'Acquired', 'IPO', 'Other'
  ));
