-- Rolling back means summing every round again (debt and events included).
-- Re-run 20261109000000_total_raised_equity_only.sql with its replacement
-- reversed: the FILTER (WHERE fr.capital_type = 'equity') clause removed from
-- startups_search's total_raised sum. Kept as a note rather than a script: the
-- forward migration is what the owner decided (2026-10-27).
SELECT 'see comment' AS rollback;
