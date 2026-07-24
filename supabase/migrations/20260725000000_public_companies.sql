-- =============================================================================
-- Migration: public_companies
-- Created:   2026-07-25
-- Description: Backing table for the Public Market Hub. Holds one row per tracked
--              listed company with the market metrics the hub reads: market cap,
--              enterprise value, TTM revenue/EBITDA, EV/Revenue, EV/EBITDA, YoY
--              growth, and a ~1-year price-momentum figure. Kept fresh in the
--              background by the `sync-public-markets` Supabase Edge Function
--              (see supabase/functions/sync-public-markets/), which upserts on
--              `ticker` from Financial Modeling Prep once a day.
--
--              Seeded here with the app's static reference snapshot so the hub
--              renders immediately, before the first sync runs. `synced_at`
--              stays NULL until the Edge Function first writes a row — the UI
--              shows "Snapshot" until then, "Synced · <time>" after.
--
--              All monetary columns are in USD MILLIONS (the Edge Function and
--              client agree on this unit). ev_revenue / ev_ebitda are ratios.
--
-- Idempotent; safe to run more than once (seed uses ON CONFLICT DO NOTHING, so
-- it never clobbers live-synced values).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public_companies (
  ticker            text PRIMARY KEY,
  name              text NOT NULL,
  sector            text NOT NULL CHECK (sector IN ('cyber', 'saas', 'fintech', 'ai')),
  market_cap        numeric,   -- USD millions
  enterprise_value  numeric,   -- USD millions
  ttm_revenue       numeric,   -- USD millions
  ttm_ebitda        numeric,   -- USD millions (can be negative)
  ev_revenue        numeric,   -- ratio
  ev_ebitda         numeric,   -- ratio (NULL when EBITDA <= 0)
  yoy_growth_pct    numeric,
  momentum_pct      numeric,   -- ~trailing 12-month price change %
  private_comp_hint text,      -- curated private counterpart (matched in startups_search)
  synced_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_public_companies_sector ON public_companies (sector);

-- Public read; writes happen only via the service-role key inside the Edge
-- Function (service_role bypasses RLS), so no write policy is exposed.
ALTER TABLE public_companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_companies_read" ON public_companies;
CREATE POLICY "public_companies_read" ON public_companies FOR SELECT USING (true);
GRANT SELECT ON public_companies TO anon, authenticated;

-- ── Seed: static reference snapshot (USD millions) ──────────────────────────
INSERT INTO public_companies
  (ticker, name, sector, market_cap, enterprise_value, ttm_revenue, ttm_ebitda, ev_revenue, ev_ebitda, yoy_growth_pct, momentum_pct, private_comp_hint)
VALUES
  -- Cybersecurity
  ('CRWD', 'CrowdStrike',        'cyber',    95000,   91500,   3900,    850,  23.46, 107.65, 33,  45, 'Wiz'),
  ('PANW', 'Palo Alto Networks', 'cyber',   120000,  119000,   8500,   1900,  14.00,  62.63, 15,  30, 'Snyk'),
  ('ZS',   'Zscaler',            'cyber',    30000,   28500,   2300,    250,  12.39, 114.00, 30,  20, 'Netskope'),
  ('FTNT', 'Fortinet',           'cyber',    72000,   70000,   5700,   1700,  12.28,  41.18, 12,  25, NULL),
  ('S',    'SentinelOne',        'cyber',     7000,    6000,    800,    -50,   7.50,  NULL,   30,   5, 'Abnormal Security'),
  -- B2B SaaS / Dev Tools
  ('NOW',  'ServiceNow',         'saas',    200000,  197000,  11000,   2600,  17.91,  75.77, 22,  30, NULL),
  ('DDOG', 'Datadog',            'saas',     48000,   45500,   2700,    500,  16.85,  91.00, 25,  35, 'Grafana Labs'),
  ('SNOW', 'Snowflake',          'saas',     55000,   51000,   3600,    150,  14.17, 340.00, 28,  15, 'Databricks'),
  ('MDB',  'MongoDB',            'saas',     22000,   20000,   2000,    120,  10.00, 166.67, 20,  -5, 'Cockroach Labs'),
  ('GTLB', 'GitLab',             'saas',      9000,    8000,    750,     30,  10.67, 266.67, 30,  10, NULL),
  -- Fintech
  ('PYPL', 'PayPal',             'fintech',  75000,   77000,  31000,   6500,   2.48,  11.85,  8,  12, 'Stripe'),
  ('COIN', 'Coinbase',           'fintech',  65000,   61000,   6500,   2500,   9.38,  24.40, 50,  60, 'Kraken'),
  ('XYZ',  'Block',              'fintech',  45000,   45000,  24000,   3000,   1.88,  15.00, 10,  18, 'Brex'),
  ('AFRM', 'Affirm',             'fintech',  20000,   23000,   2700,    200,   8.52, 115.00, 40,  55, 'Klarna'),
  ('NU',   'Nu Holdings',        'fintech',  55000,   55000,  11000,   3000,   5.00,  18.33, 40,  25, NULL),
  -- AI
  ('NVDA', 'NVIDIA',             'ai',     3400000, 3375000, 130000,  85000,  25.96,  39.71, 90,  80, 'Cerebras'),
  ('PLTR', 'Palantir',           'ai',      180000,  175000,   2900,    800,  60.34, 218.75, 30, 150, 'Scale AI'),
  ('ARM',  'Arm Holdings',       'ai',      140000,  138000,   3500,    900,  39.43, 153.33, 25,  40, 'SiFive'),
  ('AI',   'C3.ai',              'ai',        3500,    2800,    380,   -280,   7.37,  NULL,   25, -10, 'Anthropic')
ON CONFLICT (ticker) DO NOTHING;
