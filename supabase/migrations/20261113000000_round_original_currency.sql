-- A round's amount as its source states it (owner, 2026-11-01): Helsing's
-- €102.5M Series A was written as $100M. amount_raised stays the USD figure
-- every total and chart reads — for a non-USD round, an estimate at the
-- year's average rate (lib/enrichment/currency.ts); these keep the original.
alter table public.funding_rounds add column if not exists amount_original numeric;
alter table public.funding_rounds add column if not exists amount_currency text
  check (amount_currency is null or amount_currency ~ '^[A-Z]{3}$');
