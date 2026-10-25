-- =============================================================================
-- 20261103000000_drop_public_markets.sql
--
-- The product no longer covers public markets (owner, 2026-10-25): the Public
-- Market, Private Equity and Market Map pages are gone, and so is the stock
-- data connection (Financial Modeling Prep / Yahoo via the sync-public-markets,
-- search-tickers, stock-profile and stock-history Edge Functions).
--
-- This stops the daily job that called sync-public-markets. The
-- public_companies table and its rows are kept (nothing reads them now);
-- dropping them is a separate decision.
--
-- After running this, in Cloud Shell:
--   npx supabase functions delete sync-public-markets --project-ref zoesoyvctyjpufyqtcxf
--   npx supabase functions delete search-tickers      --project-ref zoesoyvctyjpufyqtcxf
--   npx supabase functions delete stock-profile       --project-ref zoesoyvctyjpufyqtcxf
--   npx supabase functions delete stock-history       --project-ref zoesoyvctyjpufyqtcxf
--   npx supabase secrets unset FMP_API_KEY            --project-ref zoesoyvctyjpufyqtcxf
--
-- Rollback: supabase/rollback/20261103000000_drop_public_markets_down.sql
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-public-markets-daily') THEN
    PERFORM cron.unschedule('sync-public-markets-daily');
  END IF;
END;
$$;

-- Confirm: no row.
SELECT jobname FROM cron.job WHERE jobname = 'sync-public-markets-daily';
