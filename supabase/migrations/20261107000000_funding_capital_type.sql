-- =============================================================================
-- 20261107000000_funding_capital_type.sql
--
-- funding_rounds.capital_type: equity, debt, or not capital — debt is marked
-- apart from equity rounds (owner, 2026-10-26). The 2026-10-26 run reported
-- BETA's $169M Export-Import Bank loan as "total raised $169.0M".
--
-- A generated column, so every row — old and new — is marked from its
-- round_type by the same rule as lib/enrichment/rounds.ts capitalKind():
--   debt         Debt, Venture Debt
--   not_capital  Secondary, IPO, Acquired, PE Buyout (no new money in)
--   equity       everything else
--
-- Additive. Rollback: supabase/rollback/20261107000000_funding_capital_type_down.sql
-- =============================================================================

ALTER TABLE funding_rounds ADD COLUMN IF NOT EXISTS capital_type text GENERATED ALWAYS AS (
  CASE
    WHEN round_type IN ('Debt', 'Venture Debt') THEN 'debt'
    WHEN round_type IN ('Secondary', 'IPO', 'Acquired', 'PE Buyout') THEN 'not_capital'
    ELSE 'equity'
  END
) STORED;

COMMENT ON COLUMN funding_rounds.capital_type IS
  'equity | debt | not_capital, from round_type (lib/enrichment/rounds.ts capitalKind). Debt is shown and summed apart from equity.';

-- Confirm: how much is debt today.
SELECT capital_type, count(*) AS rounds, sum(amount_raised) AS amount FROM funding_rounds GROUP BY capital_type ORDER BY capital_type;
